import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RepairResult {
  chunksCreated: number;
  revalidated: number;
  validationTriggered: number;
  unblocked: number;
  errors: Array<{ id: string; fileName: string; error: string }>;
}

function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  // For very large texts, use larger chunks to prevent stack overflow
  if (text.length > 1000000) {
    chunkSize = 5000;
    overlap = 500;
  }
  
  const chunks: string[] = [];
  const maxChunks = 5000; // Hard limit to prevent memory issues
  
  for (let start = 0; start < text.length && chunks.length < maxChunks; start += chunkSize - overlap) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.substring(start, end));
  }
  
  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const result: RepairResult = {
      chunksCreated: 0,
      revalidated: 0,
      validationTriggered: 0,
      unblocked: 0,
      errors: []
    };

    console.log('[repair-documents] Starting repair process...');

    // 1. Find documents validated but without chunks (LIMIT 3 at a time for stability)
    const { data: validatedDocs, error: validatedError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path')
      .eq('validation_status', 'validated')
      .eq('processing_status', 'ready_for_assignment')
      .limit(3);

    if (validatedError) throw validatedError;

    console.log(`[repair-documents] Found ${validatedDocs?.length || 0} validated documents (processing max 3)`);

    // Check which ones actually need chunks
    const docsNeedingChunks = [];
    for (const doc of validatedDocs || []) {
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('id')
        .eq('pool_document_id', doc.id)
        .limit(1);
      
      if (!chunks || chunks.length === 0) {
        docsNeedingChunks.push(doc);
      }
    }

    console.log(`[repair-documents] ${docsNeedingChunks.length} documents need chunks`);

    // Create chunks for documents that need them
    for (const doc of docsNeedingChunks) {
      try {
        console.log(`[repair-documents] Creating chunks for ${doc.file_name}`);

        // Download PDF - try multiple path patterns
        let fileData;
        let downloadError;
        
        // List of paths to try - prioritize exact path, then variations
        const pathsToTry = [
          doc.file_path, // Try exact path from DB first
          doc.file_path.startsWith('shared-pool-uploads/') 
            ? doc.file_path.substring('shared-pool-uploads/'.length) 
            : `shared-pool-uploads/${doc.file_path}`, // If has prefix, remove it; otherwise add it
          doc.file_name, // Try just filename
          `shared-pool-uploads/${doc.file_name}` // Try with prefix
        ].filter((path, index, self) => self.indexOf(path) === index); // Remove duplicates
        
        for (const path of pathsToTry) {
          const result = await supabase.storage
            .from('knowledge-pdfs')
            .download(path);
          
          if (!result.error && result.data) {
            fileData = result.data;
            downloadError = null;
            console.log(`[repair-documents] ✅ Downloaded successfully using path: ${path}`);
            break;
          }
          downloadError = result.error;
          console.log(`[repair-documents] ❌ Failed to download using path: ${path}`);
        }

        if (downloadError || !fileData) {
          console.error(`[repair-documents] ⚠️ Cannot find file for ${doc.file_name}. Marking as failed.`);
          
          // Mark document as failed instead of throwing error
          await supabase
            .from('knowledge_documents')
            .update({ 
              processing_status: 'failed',
              validation_status: 'validation_failed',
              validation_reason: `File not found in storage. Tried paths: ${pathsToTry.join(', ')}`
            })
            .eq('id', doc.id);
          
          result.errors.push({
            id: doc.id,
            fileName: doc.file_name,
            error: `File not found in storage (marked as failed)`
          });
          
          continue; // Skip to next document
        }

        // Convert to base64 for OCR
        const arrayBuffer = await fileData.arrayBuffer();
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        // Extract text using OCR
        const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
          body: { 
            base64Data,
            fileName: doc.file_name 
          }
        });

        if (ocrError || !ocrData?.text) {
          throw new Error(`OCR failed: ${ocrError?.message || 'No text extracted'}`);
        }

        const fullText = ocrData.text;
        console.log(`[repair-documents] Extracted ${fullText.length} chars of text`);
        
        // Skip if text is too large (> 5MB for safety)
        if (fullText.length > 5000000) {
          throw new Error(`Text too large (${fullText.length} chars), skipping to prevent timeout`);
        }

        // Create chunks with error handling
        let textChunks: string[];
        try {
          textChunks = chunkText(fullText);
          console.log(`[repair-documents] Created ${textChunks.length} chunks`);
        } catch (chunkError: any) {
          throw new Error(`Failed to chunk text: ${chunkError.message}`);
        }
        
        // Limit chunks to prevent timeout
        if (textChunks.length > 1000) {
          console.log(`[repair-documents] Too many chunks (${textChunks.length}), limiting to 1000`);
          textChunks = textChunks.slice(0, 1000);
        }

        // Process chunks in smaller batches with rate limiting
        const batchSize = 5; // Reduced for stability
        for (let i = 0; i < textChunks.length; i += batchSize) {
          const batch = textChunks.slice(i, i + batchSize);
          
          await Promise.all(batch.map(async (chunkContent) => {
            try {
              // Generate embedding with retry
              let embeddingData;
              let retries = 2;
              
              while (retries > 0) {
                const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${openAIApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'text-embedding-3-small',
                    input: chunkContent.substring(0, 8000), // Limit input size
                  }),
                });

                if (embeddingResponse.ok) {
                  embeddingData = await embeddingResponse.json();
                  break;
                }
                
                retries--;
                if (retries === 0) {
                  throw new Error(`OpenAI embedding failed: ${embeddingResponse.statusText}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
              }

              const embedding = embeddingData.data[0].embedding;

              // Insert chunk into agent_knowledge with agent_id = null (shared pool)
              const { error: insertError } = await supabase
                .from('agent_knowledge')
                .insert({
                  agent_id: null,
                  pool_document_id: doc.id,
                  document_name: doc.file_name,
                  content: chunkContent,
                  category: 'pool_document',
                  summary: null,
                  embedding: embedding,
                  source_type: 'shared_pool',
                  is_active: true
                });

              if (insertError) throw insertError;
            } catch (chunkInsertError: any) {
              console.error(`[repair-documents] Failed to process chunk: ${chunkInsertError.message}`);
              // Continue with other chunks even if one fails
            }
          }));

          console.log(`[repair-documents] Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(textChunks.length / batchSize)}`);
          
          // Rate limiting between batches
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Update document status to completed
        await supabase
          .from('knowledge_documents')
          .update({ processing_status: 'completed' })
          .eq('id', doc.id);

        result.chunksCreated++;
        console.log(`[repair-documents] Successfully created chunks for ${doc.file_name}`);

      } catch (error: any) {
        console.error(`[repair-documents] Error processing ${doc.file_name}:`, error);
        result.errors.push({
          id: doc.id,
          fileName: doc.file_name,
          error: error.message
        });
      }

      // Rate limiting - pause between documents
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 2. Re-validate failed documents
    const { data: failedDocs, error: failedError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, search_query')
      .eq('validation_status', 'validation_failed');

    if (!failedError && failedDocs) {
      console.log(`[repair-documents] Re-validating ${failedDocs.length} failed documents`);
      
      for (const doc of failedDocs) {
        try {
          // Reset status
          await supabase
            .from('knowledge_documents')
            .update({ 
              validation_status: 'pending',
              processing_status: 'downloaded'
            })
            .eq('id', doc.id);

          // Trigger validation
          const { error: validateError } = await supabase.functions.invoke('validate-document', {
            body: {
              documentId: doc.id,
              searchQuery: doc.search_query || '',
              fullText: ''
            }
          });

          if (validateError) throw validateError;
          result.revalidated++;
          console.log(`[repair-documents] Re-validation triggered for ${doc.file_name}`);
        } catch (error: any) {
          console.error(`[repair-documents] Error re-validating ${doc.file_name}:`, error);
          result.errors.push({
            id: doc.id,
            fileName: doc.file_name,
            error: error.message
          });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 3. Trigger validation for downloaded but pending documents
    const { data: pendingDocs, error: pendingError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, search_query, created_at')
      .eq('processing_status', 'downloaded')
      .eq('validation_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (!pendingError && pendingDocs) {
      console.log(`[repair-documents] Triggering validation for ${pendingDocs.length} pending documents:`, 
        pendingDocs.map(d => d.file_name).join(', '));
      
      for (const doc of pendingDocs) {
        try {
          const { error: validateError } = await supabase.functions.invoke('validate-document', {
            body: {
              documentId: doc.id,
              searchQuery: doc.search_query || '',
              fullText: ''
            }
          });

          if (validateError) throw validateError;
          result.validationTriggered++;
          console.log(`[repair-documents] Validation triggered for ${doc.file_name}`);
        } catch (error: any) {
          console.error(`[repair-documents] Error triggering validation for ${doc.file_name}:`, error);
          result.errors.push({
            id: doc.id,
            fileName: doc.file_name,
            error: error.message
          });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 4. Unblock documents stuck in processing
    const { data: stuckDocs, error: stuckError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, created_at')
      .or('processing_status.eq.processing,processing_status.eq.pending_processing')
      .order('created_at', { ascending: true })
      .limit(10);

    if (!stuckError && stuckDocs) {
      console.log(`[repair-documents] Unblocking ${stuckDocs.length} stuck documents:`, 
        stuckDocs.map(d => d.file_name).join(', '));
      
      for (const doc of stuckDocs) {
        try {
          // Check if they have chunks
          const { data: chunks } = await supabase
            .from('agent_knowledge')
            .select('id')
            .eq('pool_document_id', doc.id)
            .limit(1);

          if (chunks && chunks.length > 0) {
            // Has chunks, mark as ready
            await supabase
              .from('knowledge_documents')
              .update({ processing_status: 'ready_for_assignment' })
              .eq('id', doc.id);
          } else {
            // No chunks, reset to downloaded
            await supabase
              .from('knowledge_documents')
              .update({ 
                processing_status: 'downloaded',
                validation_status: 'pending'
              })
              .eq('id', doc.id);
          }

          result.unblocked++;
          console.log(`[repair-documents] Unblocked ${doc.file_name}`);
        } catch (error: any) {
          console.error(`[repair-documents] Error unblocking ${doc.file_name}:`, error);
          result.errors.push({
            id: doc.id,
            fileName: doc.file_name,
            error: error.message
          });
        }
      }
    }

    console.log('[repair-documents] Repair complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[repair-documents] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
