import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMarkdownFromPDF } from "../_shared/llamaParseClient.ts";
import { parseMarkdownElements } from "../_shared/markdownElementParser.ts";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5;

// Text file extensions that bypass LlamaParse
const TEXT_EXTENSIONS = [
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs',
  '.cpp', '.c', '.h', '.cs', '.swift', '.kt', '.sh', '.bash', '.sql',
  '.php', '.html', '.css', '.scss', '.sass', '.vue', '.svelte',
];

function isTextFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

function wrapCodeAsMarkdown(content: string, fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    'ts': 'typescript', 'tsx': 'tsx', 'js': 'javascript', 'jsx': 'jsx',
    'py': 'python', 'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
    'toml': 'toml', 'xml': 'xml', 'ini': 'ini',
    'go': 'go', 'java': 'java', 'rb': 'ruby', 'rs': 'rust',
    'cpp': 'cpp', 'c': 'c', 'h': 'c', 'cs': 'csharp', 'swift': 'swift',
    'kt': 'kotlin', 'sh': 'bash', 'bash': 'bash', 'sql': 'sql',
    'php': 'php', 'html': 'html', 'css': 'css', 'scss': 'scss',
    'sass': 'sass', 'vue': 'vue', 'svelte': 'svelte',
  };
  const lang = langMap[extension] || extension;
  
  return `# ${fileName}\n\n\`\`\`${lang}\n${content}\n\`\`\``;
}

function prepareMarkdownForParsing(content: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Markdown files: pass through directly
  if (['md', 'mdx', 'txt', 'rst', 'adoc'].includes(ext)) {
    return content;
  }
  
  // Code/Config files: wrap in Markdown code block
  return wrapCodeAsMarkdown(content, fileName);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const documentId = body.documentId;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const llamaApiKey = Deno.env.get('LLAMA_CLOUD_API_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!llamaApiKey) {
      throw new Error('LLAMA_CLOUD_API_KEY not configured');
    }
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('[Pipeline A Process] Starting batch processing...');

    // Fetch documents to process
    let query = supabase
      .from('pipeline_a_documents')
      .select('*')
      .eq('status', 'ingested')
      .order('created_at', { ascending: true });

    if (documentId) {
      // Event-driven mode: process specific document
      query = query.eq('id', documentId);
      console.log(`[Pipeline A Process] Event-driven mode: processing document ${documentId}`);
    } else {
      // Cron mode: process batch
      query = query.limit(BATCH_SIZE);
      console.log(`[Pipeline A Process] Cron mode: processing up to ${BATCH_SIZE} documents`);
    }

    const { data: documents, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch documents: ${fetchError.message}`);
    }

    if (!documents || documents.length === 0) {
      console.log('[Pipeline A Process] No documents to process');
      return new Response(
        JSON.stringify({ success: true, message: 'No documents to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A Process] Found ${documents.length} documents to process`);

    const results = {
      processed: 0,
      failed: 0,
      details: [] as any[],
    };

    for (const doc of documents) {
      try {
        // Check if chunks already exist
        const { data: existingChunks } = await supabase
          .from('pipeline_a_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        if (existingChunks && existingChunks.length > 0) {
          console.log(`[Pipeline A Process] Document ${doc.id} already has chunks, skipping`);
          
          // Update status to chunked if stuck in ingested
          if (doc.status === 'ingested') {
            await supabase
              .from('pipeline_a_documents')
              .update({ status: 'chunked' })
              .eq('id', doc.id);
          }
          
          results.processed++;
          continue;
        }

        // Update status to processing
        await supabase
          .from('pipeline_a_documents')
          .update({ status: 'processing' })
          .eq('id', doc.id);

        let markdown: string;
        let jobId: string | null = null;

        // ⭐ AMPHIBIOUS BYPASS LOGIC
        if (doc.source_type === 'github' && doc.full_text) {
          // 🚀 BYPASS: GitHub text file - no LlamaParse needed!
          console.log(`[Pipeline A Process] BYPASS mode (GitHub text): ${doc.file_name}`);
          markdown = prepareMarkdownForParsing(doc.full_text, doc.file_name);
        } else if (isTextFile(doc.file_name) && doc.full_text) {
          // 🚀 BYPASS: Text file with content already available
          console.log(`[Pipeline A Process] BYPASS mode (text file): ${doc.file_name}`);
          markdown = prepareMarkdownForParsing(doc.full_text, doc.file_name);
        } else {
          // 📄 PDF: Standard LlamaParse processing
          console.log(`[Pipeline A Process] LlamaParse mode: ${doc.file_name}`);
          
          // Download PDF from storage
          const { data: fileData, error: downloadError } = await supabase.storage
            .from(doc.storage_bucket || 'pipeline-a-uploads')
            .download(doc.file_path);

          if (downloadError || !fileData) {
            throw new Error(`Failed to download file: ${downloadError?.message || 'Unknown error'}`);
          }

          const arrayBuffer = await fileData.arrayBuffer();
          const pdfBuffer = new Uint8Array(arrayBuffer);

          console.log(`[Pipeline A Process] Processing ${doc.file_name} (${pdfBuffer.length} bytes)`);

          // CORE PIPELINE A: Extract Markdown with LlamaParse
          const result = await extractMarkdownFromPDF(
            pdfBuffer,
            doc.file_name,
            llamaApiKey
          );
          markdown = result.markdown;
          jobId = result.jobId;

          console.log(`[Pipeline A Process] LlamaParse complete: ${markdown.length} characters`);
        }

        // Parse structured elements with LLM summarization
        const { baseNodes } = await parseMarkdownElements(markdown, lovableApiKey);

        console.log(`[Pipeline A Process] Parsed ${baseNodes.length} nodes`);

        if (baseNodes.length === 0) {
          throw new Error('No chunks extracted from Markdown');
        }

        // Insert chunks in batches
        const CHUNK_BATCH = 50;
        for (let i = 0; i < baseNodes.length; i += CHUNK_BATCH) {
          const batch = baseNodes.slice(i, i + CHUNK_BATCH);
          const chunksToInsert = batch.map(node => ({
            document_id: doc.id,
            chunk_index: node.chunk_index,
            content: node.content,
            original_content: node.original_content || null,
            summary: node.summary || null,
            chunk_type: node.chunk_type,
            is_atomic: node.is_atomic,
            heading_hierarchy: node.heading_hierarchy || null,
            page_number: node.page_number || null,
            embedding_status: 'pending',
          }));

          const { error: insertError } = await supabase
            .from('pipeline_a_chunks_raw')
            .insert(chunksToInsert);

          if (insertError) {
            throw new Error(`Failed to insert chunks: ${insertError.message}`);
          }
        }

        // Update document status and save LlamaParse job ID
        await supabase
          .from('pipeline_a_documents')
          .update({
            status: 'chunked',
            llamaparse_job_id: jobId,
            page_count: baseNodes.length,
            processed_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        results.processed++;
        results.details.push({
          documentId: doc.id,
          fileName: doc.file_name,
          chunks: baseNodes.length,
          status: 'success',
        });

        console.log(`[Pipeline A Process] Document ${doc.id} processed: ${baseNodes.length} chunks`);

        // Trigger embedding generation (event-driven)
        try {
          EdgeRuntime.waitUntil(
            supabase.functions.invoke('pipeline-a-generate-embeddings', {
              body: { documentId: doc.id },
            })
          );
        } catch (triggerError) {
          console.warn('[Pipeline A Process] Failed to trigger embeddings:', triggerError);
        }

      } catch (docError) {
        console.error(`[Pipeline A Process] Failed to process document ${doc.id}:`, docError);
        
        // Update document to failed status
        await supabase
          .from('pipeline_a_documents')
          .update({
            status: 'failed',
            error_message: docError instanceof Error ? docError.message : 'Unknown error',
          })
          .eq('id', doc.id);

        results.failed++;
        results.details.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: 'failed',
          error: docError instanceof Error ? docError.message : 'Unknown error',
        });
      }
    }

    console.log(`[Pipeline A Process] Batch complete: ${results.processed} processed, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.processed,
        failed: results.failed,
        details: results.details,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A Process] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
