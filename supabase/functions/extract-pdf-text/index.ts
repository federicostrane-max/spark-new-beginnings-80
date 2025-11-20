import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract text from PDF using simple text extraction
 * This works for PDFs with embedded text (not scanned images)
 */
async function extractTextNatively(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    console.log('[extract-pdf-text] Attempting native text extraction...');
    
    // Convert ArrayBuffer to string to look for text content
    const uint8Array = new Uint8Array(pdfBuffer);
    const decoder = new TextDecoder('latin1'); // PDFs use latin1 encoding
    const pdfString = decoder.decode(uint8Array);
    
    // Extract text between stream objects (simple PDF text extraction)
    // This regex finds text content in PDF streams
    const textMatches = pdfString.match(/\(([^)]+)\)/g) || [];
    
    let extractedText = '';
    for (const match of textMatches) {
      // Remove parentheses and clean up
      const text = match.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\([()])/g, '$1');
      
      // Filter out control characters and keep meaningful text
      if (text.length > 2 && !/^[\x00-\x1F]+$/.test(text)) {
        extractedText += text + ' ';
      }
    }
    
    // Also try to extract text from BT/ET blocks (more sophisticated)
    const btEtPattern = /BT\s*(.*?)\s*ET/gs;
    const btEtMatches = pdfString.match(btEtPattern) || [];
    
    for (const block of btEtMatches) {
      const tjMatches = block.match(/\[(.*?)\]\s*TJ/g) || [];
      for (const tj of tjMatches) {
        const content = tj.match(/\(([^)]+)\)/g) || [];
        for (const c of content) {
          const cleaned = c.slice(1, -1);
          if (cleaned.length > 1) {
            extractedText += cleaned + ' ';
          }
        }
      }
    }
    
    const finalText = extractedText.trim();
    const extractedLength = finalText.length;
    console.log(`[extract-pdf-text] Native extraction complete: ${extractedLength} characters`);
    
    return finalText;
  } catch (error) {
    console.error('[extract-pdf-text] Native extraction failed:', error);
    return '';
  }
}

interface ExtractionRequest {
  documentId?: string;
  filePath?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, filePath: providedFilePath }: ExtractionRequest = await req.json();

    console.log(`[extract-pdf-text] Starting for documentId: ${documentId || 'N/A'}, filePath: ${providedFilePath || 'N/A'}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let filePath = providedFilePath;

    // If documentId provided, get file_path from database
    if (documentId && !filePath) {
      const { data: doc, error: docError } = await supabase
        .from('knowledge_documents')
        .select('file_path, file_name')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Cannot find document: ${docError?.message || 'Not found'}`);
      }

      filePath = doc.file_path;
    }

    if (!filePath) {
      throw new Error('No file path provided or found');
    }

    console.log(`[extract-pdf-text] Attempting to download PDF: ${filePath}`);

    // Extract bucket name and clean path if path includes bucket prefix
    let targetBucket = 'shared-pool-uploads';
    let targetPath = filePath;
    
    const knownBuckets = ['shared-pool-uploads', 'knowledge-pdfs', 'agent-attachments'];
    for (const bucket of knownBuckets) {
      if (filePath.startsWith(`${bucket}/`)) {
        targetBucket = bucket;
        targetPath = filePath.substring(bucket.length + 1);
        console.log(`[extract-pdf-text] Detected bucket '${bucket}' in path, extracted: ${targetPath}`);
        break;
      }
    }
    
    // Decode URL-encoded characters (%20 -> space, %2C -> comma, etc.)
    targetPath = decodeURIComponent(targetPath);
    console.log(`[extract-pdf-text] Target bucket: ${targetBucket}, decoded path: ${targetPath}`);

    // Priority order: detected bucket with extracted path -> fallback to other buckets
    const bucketsToTry = [
      { name: targetBucket, path: targetPath, strategy: 'exact' },
      { name: 'knowledge-pdfs', path: targetPath, strategy: 'fallback' },
      { name: 'agent-attachments', path: targetPath, strategy: 'fallback' }
    ];

    let pdfBlob = null;
    let successfulBucket = null;
    let actualPath = null;

    // Try exact paths first
    for (const bucket of bucketsToTry) {
      console.log(`[extract-pdf-text] Trying ${bucket.strategy}: ${bucket.name}/${bucket.path}`);
      
      const { data, error } = await supabase.storage
        .from(bucket.name)
        .download(bucket.path);
      
      if (!error && data) {
        pdfBlob = data;
        successfulBucket = bucket;
        actualPath = bucket.path;
        console.log(`[extract-pdf-text] ✅ Download successful from ${bucket.name}/${bucket.path}`);
        break;
      }
      
      console.log(`[extract-pdf-text] ❌ Failed from ${bucket.name}:`, error?.message);
    }

    // FASE 3 Enhancement: If exact path fails, try pattern matching for timestamped files
    if (!pdfBlob) {
      console.log(`[extract-pdf-text] Exact paths failed, trying pattern matching for: ${targetPath}`);
      
      // List files in target bucket to find potential matches
      const { data: fileList, error: listError } = await supabase.storage
        .from(targetBucket)
        .list('', { 
          search: targetPath.replace(/[^a-zA-Z0-9]/g, '') // Remove special chars for search
        });
      
      if (!listError && fileList && fileList.length > 0) {
        // Try to find file matching the target path (could have timestamp prefix)
        for (const file of fileList) {
          if (file.name.includes(targetPath) || targetPath.includes(file.name)) {
            console.log(`[extract-pdf-text] Found potential match: ${file.name}`);
            
            const { data, error } = await supabase.storage
              .from(targetBucket)
              .download(file.name);
            
            if (!error && data) {
              pdfBlob = data;
              successfulBucket = { name: targetBucket, path: file.name };
              actualPath = file.name;
              console.log(`[extract-pdf-text] ✅ Pattern match successful: ${file.name}`);
              
              // FASE 6: Update database with correct path
              if (documentId && `${targetBucket}/${file.name}` !== filePath) {
                console.log(`[extract-pdf-text] Updating DB path from ${filePath} to ${targetBucket}/${file.name}`);
                await supabase
                  .from('knowledge_documents')
                  .update({ file_path: `${targetBucket}/${file.name}` })
                  .eq('id', documentId);
              }
              
              break;
            }
          }
        }
      }
    }

    if (!pdfBlob || !successfulBucket) {
      const triedPaths = bucketsToTry.map(b => `${b.name}/${b.path}`).join(', ');
      console.log('[extract-pdf-text] ❌ File not found in any bucket, marking document as validation_failed');
      
      // Mark document as validation_failed if documentId is provided
      if (documentId) {
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'validation_failed',
            validation_status: 'rejected',
            validation_reason: `File not found in storage. Tried: ${triedPaths}`
          })
          .eq('id', documentId);
      }
      
      // Return 200 with success: false to avoid blocking workflow
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `File not found in any storage bucket. Tried: ${triedPaths}`,
          text: ''
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[extract-pdf-text] PDF downloaded from ${successfulBucket.name}, size: ${pdfBlob.size} bytes`);

    // ========================================
    // PHASE 1: Try native text extraction first
    // ========================================
    console.log('[extract-pdf-text] PHASE 1: Attempting native text extraction...');
    const pdfBuffer = await pdfBlob.arrayBuffer();
    const nativeText = await extractTextNatively(pdfBuffer);
    
    let extractedText = '';
    let extractionMethod = 'native';
    
    // Check if native extraction was successful (more than 100 characters)
    if (nativeText.length > 100) {
      console.log(`[extract-pdf-text] ✅ Native extraction successful: ${nativeText.length} characters`);
      extractedText = nativeText;
      extractionMethod = 'native';
    } else {
      console.log(`[extract-pdf-text] ⚠️ Native extraction insufficient (${nativeText.length} chars), falling back to OCR...`);
      
      // ========================================
      // PHASE 2: Fallback to OCR if native extraction failed
      // ========================================
      console.log('[extract-pdf-text] PHASE 2: Creating signed URL for OCR fallback...');
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from(successfulBucket.name)
        .createSignedUrl(successfulBucket.path, 300); // 300 seconds = 5 minutes

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error(`Failed to create signed URL: ${signedUrlError?.message || 'Unknown error'}`);
      }

      console.log('[extract-pdf-text] Calling ocr-image for fallback extraction...');
      const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
        body: {
          imageUrl: signedUrlData.signedUrl,
          fileName: filePath.split('/').pop() || 'document.pdf'
        }
      });

      if (ocrError) {
        console.error('[extract-pdf-text] OCR fallback failed:', ocrError);
        // If OCR fails, use whatever native extraction got
        extractedText = nativeText;
        extractionMethod = 'native-fallback';
      } else {
        extractedText = ocrData?.extractedText || nativeText;
        extractionMethod = 'ocr';
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('[extract-pdf-text] ⚠️ Warning: All extraction methods returned empty text');
    }

    console.log(`[extract-pdf-text] ✅ Final extraction successful (${extractionMethod}): ${extractedText.length} characters`);

    return new Response(
      JSON.stringify({ 
        success: true,
        text: extractedText,
        length: extractedText.length,
        method: extractionMethod
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-pdf-text] ❌ ERROR:', error);
    
    // Provide more detailed error message
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('[extract-pdf-text] Error stack:', error.stack);
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        text: ''
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
