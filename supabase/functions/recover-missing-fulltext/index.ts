import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RecoveryResult {
  documentId: string;
  fileName: string;
  status: 'success' | 'file_missing' | 'ocr_failed' | 'already_has_fulltext';
  chunksCreated?: number;
  error?: string;
  bucket?: string;
  filePath?: string;
}

/**
 * Verifica se il file esiste nello storage
 */
async function checkFileExists(supabase: any, filePath: string): Promise<{ exists: boolean; bucket?: string; actualPath?: string }> {
  console.log(`[Storage Check] Checking existence of: ${filePath}`);
  
  // Parse bucket and path
  let targetBucket = 'shared-pool-uploads';
  let targetPath = filePath;
  
  const knownBuckets = ['shared-pool-uploads', 'knowledge-pdfs', 'agent-attachments'];
  for (const bucket of knownBuckets) {
    if (filePath.startsWith(`${bucket}/`)) {
      targetBucket = bucket;
      targetPath = filePath.substring(bucket.length + 1);
      break;
    }
  }
  
  targetPath = decodeURIComponent(targetPath);
  
  // Try exact paths in all buckets
  const bucketsToTry = [
    { name: targetBucket, path: targetPath },
    { name: 'knowledge-pdfs', path: targetPath },
    { name: 'agent-attachments', path: targetPath }
  ];
  
  for (const bucket of bucketsToTry) {
    const { data, error } = await supabase.storage
      .from(bucket.name)
      .download(bucket.path);
    
    if (!error && data) {
      console.log(`[Storage Check] ✅ File found in ${bucket.name}/${bucket.path}`);
      return { exists: true, bucket: bucket.name, actualPath: bucket.path };
    }
  }
  
  // Try pattern matching for timestamped files
  const { data: fileList } = await supabase.storage
    .from(targetBucket)
    .list('', { 
      search: targetPath.replace(/[^a-zA-Z0-9]/g, '')
    });
  
  if (fileList && fileList.length > 0) {
    const potentialFile = fileList[0];
    const { data, error } = await supabase.storage
      .from(targetBucket)
      .download(potentialFile.name);
    
    if (!error && data) {
      console.log(`[Storage Check] ✅ File found via pattern matching: ${targetBucket}/${potentialFile.name}`);
      return { exists: true, bucket: targetBucket, actualPath: potentialFile.name };
    }
  }
  
  console.log(`[Storage Check] ❌ File not found in any bucket`);
  return { exists: false };
}

/**
 * Chunka il testo in blocchi di dimensione fissa con overlap
 */
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);
    
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }

    startIndex += (chunkSize - overlap);
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
    const openAIKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { batchSize = 10 } = await req.json();

    console.log('[Recover] Starting advanced recovery process...');

    // Find documents without full_text
    const { data: documents, error: docsError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, full_text, processing_status, validation_status')
      .is('full_text', null)
      .eq('processing_status', 'ready_for_assignment')
      .eq('validation_status', 'validated')
      .limit(batchSize);

    if (docsError) throw docsError;

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No documents need recovery',
          results: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Recover] Found ${documents.length} documents to recover`);

    const results: RecoveryResult[] = [];

    // Process each document
    for (const doc of documents) {
      try {
        console.log(`[Recover] Processing ${doc.file_name}...`);

        // Check if file already has full_text (shouldn't happen but defensive check)
        if (doc.full_text && doc.full_text.trim().length > 0) {
          results.push({
            documentId: doc.id,
            fileName: doc.file_name,
            status: 'already_has_fulltext'
          });
          continue;
        }

        // STEP 1: Check if file exists in storage
        const fileCheck = await checkFileExists(supabase, doc.file_path);
        
        if (!fileCheck.exists) {
          console.log(`[Recover] ❌ File not found for ${doc.file_name}`);
          
          // Mark document as validation_failed
          await supabase
            .from('knowledge_documents')
            .update({
              validation_status: 'validation_failed',
              validation_reason: `File not found in storage: ${doc.file_path}`,
              validation_date: new Date().toISOString()
            })
            .eq('id', doc.id);
          
          results.push({
            documentId: doc.id,
            fileName: doc.file_name,
            status: 'file_missing',
            error: 'File not found in any storage bucket',
            filePath: doc.file_path
          });
          continue;
        }

        console.log(`[Recover] ✅ File found in ${fileCheck.bucket}/${fileCheck.actualPath}`);

        // STEP 2: Extract text using extract-pdf-text function
        const { data: extractData, error: extractError } = await supabase.functions.invoke(
          'extract-pdf-text',
          {
            body: { filePath: doc.file_path }
          }
        );

        if (extractError || !extractData || !extractData.text) {
          console.log(`[Recover] ❌ OCR extraction failed for ${doc.file_name}`);
          
          results.push({
            documentId: doc.id,
            fileName: doc.file_name,
            status: 'ocr_failed',
            error: extractError?.message || 'OCR service returned no text',
            bucket: fileCheck.bucket,
            filePath: fileCheck.actualPath
          });
          continue;
        }

        const extractedText = extractData.text;
        console.log(`[Recover] ✅ Text extracted (${extractedText.length} chars)`);

        // STEP 3: Save full_text to knowledge_documents
        await supabase
          .from('knowledge_documents')
          .update({
            full_text: extractedText,
            text_length: extractedText.length,
            processed_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        // STEP 4: Create chunks
        const chunks = chunkText(extractedText);
        console.log(`[Recover] Created ${chunks.length} chunks`);

        // STEP 5: Generate embeddings and save chunks
        let chunksCreated = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          try {
            // Generate embedding
            const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openAIKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                input: chunk,
                model: 'text-embedding-3-small',
              }),
            });

            if (!embeddingResponse.ok) {
              throw new Error(`Embedding API error: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();
            const embedding = embeddingData.data[0].embedding;

            // Insert chunk to agent_knowledge (shared pool)
            const { error: chunkError } = await supabase
              .from('agent_knowledge')
              .insert({
                agent_id: null, // Shared pool
                pool_document_id: doc.id,
                category: 'documents',
                document_name: doc.file_name,
                content: chunk,
                embedding: embedding,
                source_type: 'shared_pool',
                chunking_metadata: {
                  chunk_index: i,
                  total_chunks: chunks.length,
                  chunk_size: chunk.length,
                  recovery_timestamp: new Date().toISOString()
                }
              });

            if (!chunkError) {
              chunksCreated++;
            }
          } catch (chunkError: any) {
            console.error(`[Recover] Error creating chunk ${i}:`, chunkError.message);
          }
        }

        console.log(`[Recover] ✅ Successfully created ${chunksCreated} chunks for ${doc.file_name}`);

        results.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: 'success',
          chunksCreated,
          bucket: fileCheck.bucket,
          filePath: fileCheck.actualPath
        });

      } catch (error: any) {
        console.error(`[Recover] Error processing ${doc.file_name}:`, error);
        results.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: 'ocr_failed',
          error: error.message
        });
      }
    }

    // Calculate summary
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'success').length,
      fileMissing: results.filter(r => r.status === 'file_missing').length,
      ocrFailed: results.filter(r => r.status === 'ocr_failed').length,
      alreadyHasFulltext: results.filter(r => r.status === 'already_has_fulltext').length
    };

    console.log('[Recover] Summary:', summary);

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        results
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('[Recover] Fatal error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
