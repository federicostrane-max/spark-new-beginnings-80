import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeepDiveRequest {
  documentId: string;
  searchQuery: string;
  agentId: string;
}

/**
 * Uploads video to Gemini File API with retry logic
 */
async function uploadToGeminiFileAPI(
  videoUrl: string,
  fileName: string,
  apiKey: string
): Promise<{ fileUri: string; mimeType: string }> {
  console.log('[Deep Dive] Downloading video from Storage...');
  
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video: ${videoResponse.status}`);
  }
  
  const videoBlob = await videoResponse.blob();
  const videoBytes = await videoBlob.arrayBuffer();
  const fileSizeMB = (videoBytes.byteLength / (1024 * 1024)).toFixed(2);
  
  console.log(`[Deep Dive] Video downloaded: ${fileSizeMB} MB`);
  
  // Upload to Gemini File API
  console.log('[Deep Dive] Starting resumable upload to Gemini File API...');
  
  const mimeType = fileName.endsWith('.mp4') ? 'video/mp4' : 'video/quicktime';
  
  // Step 1: Start resumable upload
  const startUploadResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': videoBytes.byteLength.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: {
          display_name: fileName
        }
      })
    }
  );
  
  if (!startUploadResponse.ok) {
    throw new Error(`Failed to start upload: ${startUploadResponse.status}`);
  }
  
  const uploadUrl = startUploadResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL returned from Gemini');
  }
  
  console.log('[Deep Dive] Upload URL obtained, uploading video bytes...');
  
  // Step 2: Upload video bytes
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': videoBytes.byteLength.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: videoBytes
  });
  
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload video: ${uploadResponse.status}`);
  }
  
  const uploadResult = await uploadResponse.json();
  console.log('[Deep Dive] Upload complete:', uploadResult);
  
  return {
    fileUri: uploadResult.file.uri,
    mimeType: uploadResult.file.mimeType
  };
}

/**
 * Polls Gemini File API until video is ACTIVE
 */
async function pollUntilActive(
  fileUri: string,
  apiKey: string,
  maxAttempts: number = 60
): Promise<void> {
  console.log('[Deep Dive] Polling for ACTIVE status...');
  
  const fileName = fileUri.split('/').pop();
  
  for (let i = 0; i < maxAttempts; i++) {
    // fileUri is already a complete URL from Gemini, use it directly
    const pollUrl = fileUri.startsWith('http') 
      ? `${fileUri}?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`;
    
    const response = await fetch(pollUrl, { method: 'GET' });
    
    if (!response.ok) {
      console.error(`[Deep Dive] Poll attempt ${i + 1} failed:`, response.status);
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
    
    const data = await response.json();
    console.log(`[Deep Dive] Poll ${i + 1}: state=${data.state}`);
    
    if (data.state === 'ACTIVE') {
      console.log('[Deep Dive] ✅ Video is ACTIVE');
      return;
    }
    
    if (data.state === 'FAILED') {
      throw new Error('Gemini video processing failed');
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  throw new Error('Timeout waiting for video to become ACTIVE');
}

/**
 * Calls Gemini with surgical prompt to extract specific information
 */
async function extractWithSurgicalPrompt(
  fileUri: string,
  mimeType: string,
  searchQuery: string,
  apiKey: string
): Promise<string> {
  console.log(`[Deep Dive] Generating surgical prompt for: "${searchQuery}"`);
  
  const surgicalPrompt = `IGNORA TUTTO IL RESTO DEL VIDEO.

COMPITO UNICO: Scansiona il video cercando ESCLUSIVAMENTE:
${searchQuery}

OUTPUT RICHIESTO:
- Lista di timestamp [MM:SS] dove trovi ciò che cerchi
- Per ogni timestamp, includi il valore/contesto specifico rilevante
- Se non trovi nulla, dillo chiaramente: "Non ho trovato ${searchQuery} nel video."

NON includere altra analisi. NON fare riassunti. NON commentare altri aspetti del video.
SOLO i risultati della ricerca specifica richiesta.

Se trovi informazioni parziali o approssimative, includile comunque specificando [STIMATO] o [PARZIALE].`;

  console.log('[Deep Dive] Calling Gemini with surgical prompt...');
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              fileData: {
                mimeType: mimeType,
                fileUri: fileUri
              }
            },
            { text: surgicalPrompt }
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096
        }
      })
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  const extractedContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!extractedContent) {
    throw new Error('No content extracted from Gemini');
  }
  
  console.log(`[Deep Dive] ✅ Extraction complete: ${extractedContent.length} chars`);
  return extractedContent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('='.repeat(80));
    console.log('🔍 DEEP DIVE VIDEO - START');
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { documentId, searchQuery, agentId }: DeepDiveRequest = await req.json();
    
    if (!documentId || !searchQuery || !agentId) {
      throw new Error('Missing required parameters: documentId, searchQuery, agentId');
    }
    
    console.log(`   Document ID: ${documentId}`);
    console.log(`   Search Query: ${searchQuery}`);
    console.log(`   Agent ID: ${agentId}`);
    
    // Step 1: Retrieve document details
    console.log('[Deep Dive] Step 1: Fetching document details...');
    
    const { data: document, error: docError } = await supabase
      .from('pipeline_a_documents')
      .select('id, file_name, file_path, storage_bucket, full_text, processing_metadata')
      .eq('id', documentId)
      .single();
    
    if (docError || !document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    
    console.log(`[Deep Dive] Document found: ${document.file_name}`);
    
    // Step 2: Get public URL from storage
    console.log('[Deep Dive] Step 2: Getting video URL from storage...');
    
    const { data: signedUrlData } = await supabase.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.file_path, 3600); // 1 hour expiry
    
    if (!signedUrlData?.signedUrl) {
      throw new Error('Failed to get video URL from storage');
    }
    
    console.log('[Deep Dive] ✅ Video URL obtained');
    
    // Step 3: Upload to Gemini (always fresh upload - handles 48h expiration)
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');
    }
    
    const { fileUri, mimeType } = await uploadToGeminiFileAPI(
      signedUrlData.signedUrl,
      document.file_name,
      GOOGLE_API_KEY
    );
    
    // Step 4: Poll until ACTIVE
    await pollUntilActive(fileUri, GOOGLE_API_KEY);
    
    // Step 5: Extract with surgical prompt
    const extractedContent = await extractWithSurgicalPrompt(
      fileUri,
      mimeType,
      searchQuery,
      GOOGLE_API_KEY
    );
    
    // Step 6: Append to full_text (preserving original analysis)
    console.log('[Deep Dive] Step 6: Appending extraction to document...');
    
    const timestamp = new Date().toISOString();
    const appendedContent = `

---
## 🔍 Deep Dive: ${searchQuery}
*Estratto su richiesta il ${new Date(timestamp).toLocaleString('it-IT')}*

${extractedContent}
---
`;
    
    const updatedFullText = (document.full_text || '') + appendedContent;
    
    await supabase
      .from('pipeline_a_documents')
      .update({
        full_text: updatedFullText,
        updated_at: timestamp,
        status: 'ingested' // Reset to trigger re-chunking
      })
      .eq('id', documentId);
    
    console.log(`[Deep Dive] ✅ Content appended (${appendedContent.length} chars)`);
    
    // Step 7: Trigger re-chunking (event-driven)
    console.log('[Deep Dive] Step 7: Triggering re-chunking...');
    
    try {
      const rechunkResponse = await supabase.functions.invoke('pipeline-a-process-chunks', {
        body: { documentId }
      });
      
      if (rechunkResponse.error) {
        console.error('[Deep Dive] Re-chunking error:', rechunkResponse.error);
      } else {
        console.log('[Deep Dive] ✅ Re-chunking triggered');
      }
    } catch (rechunkError) {
      console.error('[Deep Dive] Re-chunking invocation failed:', rechunkError);
      // Non-blocking error - re-chunking can be triggered by cron fallback
    }
    
    console.log('='.repeat(80));
    console.log('✅ DEEP DIVE VIDEO - COMPLETE');
    console.log(`   Added content: ${appendedContent.length} chars`);
    console.log(`   Total document size: ${updatedFullText.length} chars`);
    console.log('='.repeat(80));
    
    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        addedContentLength: appendedContent.length,
        message: 'Video analizzato con successo. Ripeti la domanda per vedere i nuovi risultati.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('❌ Deep Dive Video error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
