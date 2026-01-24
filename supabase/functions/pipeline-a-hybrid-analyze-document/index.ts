import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DocumentMetadata {
  ai_summary: string;
  keywords: string[];
  topics: string[];
  complexity_level: 'basic' | 'intermediate' | 'advanced';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY required for document analysis');
    }

    const { documentId, backfill } = await req.json();

    // If backfill mode, process all documents missing metadata
    if (backfill) {
      console.log('[Analyze Document] Starting backfill mode for documents missing metadata');

      const { data: documentsToProcess, error: fetchError } = await supabase
        .from('pipeline_a_hybrid_documents')
        .select('id, file_name')
        .eq('status', 'ready')
        .is('ai_summary', null)
        .limit(10); // Process in batches

      if (fetchError) throw fetchError;

      if (!documentsToProcess || documentsToProcess.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No documents need metadata backfill', processed: 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Analyze Document] Found ${documentsToProcess.length} documents to backfill`);

      let processedCount = 0;
      for (const doc of documentsToProcess) {
        try {
          await analyzeDocument(supabase, doc.id, anthropicKey);
          processedCount++;
          console.log(`[Analyze Document] ✓ Backfilled ${doc.file_name}`);
        } catch (err) {
          console.error(`[Analyze Document] Failed to backfill ${doc.file_name}:`, err);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Backfilled ${processedCount}/${documentsToProcess.length} documents`,
          processed: processedCount,
          remaining: documentsToProcess.length - processedCount
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single document mode
    if (!documentId) {
      throw new Error('documentId is required');
    }

    console.log(`[Analyze Document] Processing document ${documentId}`);

    // Verify document exists and is ready
    const { data: document, error: docError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, file_name, status, ai_summary')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    if (document.status !== 'ready') {
      return new Response(
        JSON.stringify({ success: false, message: `Document not ready (status: ${document.status})` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Skip if already has metadata (unless forced)
    if (document.ai_summary) {
      console.log(`[Analyze Document] Document ${document.file_name} already has metadata, skipping`);
      return new Response(
        JSON.stringify({ success: true, message: 'Document already has metadata', skipped: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await analyzeDocument(supabase, documentId, anthropicKey);

    return new Response(
      JSON.stringify({ success: true, message: 'Document metadata generated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Analyze Document] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzeDocument(
  supabase: any,
  documentId: string,
  anthropicKey: string
): Promise<void> {
  // Fetch document info
  const { data: document } = await supabase
    .from('pipeline_a_hybrid_documents')
    .select('file_name, folder')
    .eq('id', documentId)
    .single();

  // Fetch first N chunks for analysis (to keep token usage reasonable)
  const { data: chunks, error: chunksError } = await supabase
    .from('pipeline_a_hybrid_chunks_raw')
    .select('content, chunk_index')
    .eq('document_id', documentId)
    .eq('embedding_status', 'ready')
    .order('chunk_index', { ascending: true })
    .limit(15); // First 15 chunks should cover intro + key sections

  if (chunksError || !chunks || chunks.length === 0) {
    throw new Error(`No chunks found for document ${documentId}`);
  }

  // Combine chunks for analysis
  const combinedText = chunks.map(c => c.content).join('\n\n---\n\n');
  const truncatedText = combinedText.substring(0, 12000); // ~3000 tokens

  console.log(`[Analyze Document] Analyzing ${document?.file_name} with ${chunks.length} chunks (${truncatedText.length} chars)`);

  // Call Claude for analysis
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this document and provide structured metadata. Document: "${document?.file_name}"

CONTENT:
${truncatedText}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "ai_summary": "2-3 sentence summary of the document's main purpose and content",
  "keywords": ["keyword1", "keyword2", ...], // 5-8 most relevant keywords
  "topics": ["topic1", "topic2", ...], // 3-5 main topics covered
  "complexity_level": "basic|intermediate|advanced" // based on technical depth
}

Guidelines:
- ai_summary: Brief, informative, focuses on what the document is about
- keywords: Technical terms, proper nouns, key concepts (no generic words)
- topics: Broad subject areas covered
- complexity_level:
  - basic: introductory, general audience
  - intermediate: requires some domain knowledge
  - advanced: highly technical, expert-level`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const content = result.content[0]?.text;

  if (!content) {
    throw new Error('Empty response from Claude');
  }

  // Parse JSON response
  let metadata: DocumentMetadata;
  try {
    // Handle potential markdown code blocks
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    metadata = JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('[Analyze Document] Failed to parse response:', content);
    throw new Error(`Failed to parse Claude response: ${parseError}`);
  }

  // Validate and sanitize
  if (!metadata.ai_summary || !metadata.keywords || !metadata.topics || !metadata.complexity_level) {
    throw new Error('Incomplete metadata from Claude');
  }

  // Ensure arrays
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords.slice(0, 10) : [];
  const topics = Array.isArray(metadata.topics) ? metadata.topics.slice(0, 5) : [];
  const complexity = ['basic', 'intermediate', 'advanced'].includes(metadata.complexity_level)
    ? metadata.complexity_level
    : 'intermediate';

  // Update document with metadata
  const { error: updateError } = await supabase
    .from('pipeline_a_hybrid_documents')
    .update({
      ai_summary: metadata.ai_summary.substring(0, 1000), // Limit length
      keywords: keywords,
      topics: topics,
      complexity_level: complexity,
      updated_at: new Date().toISOString()
    })
    .eq('id', documentId);

  if (updateError) {
    throw new Error(`Failed to update document: ${updateError.message}`);
  }

  console.log(`[Analyze Document] ✓ Saved metadata for ${document?.file_name}: ${keywords.length} keywords, ${topics.length} topics, complexity: ${complexity}`);
}
