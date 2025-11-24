import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// INTERFACCE BASATE SU DOCUMENTAZIONE UFFICIALE LANDING AI GITHUB
// ============================================================================

interface LandingAIGroundingBox {
  l: number;  // left
  t: number;  // top
  r: number;  // right
  b: number;  // bottom
}

interface LandingAIGrounding {
  box: LandingAIGroundingBox;
  page: number;
}

interface LandingAIChunk {
  text: string;              // REQUIRED - mai null nella documentazione ufficiale
  chunk_type: string;        // REQUIRED
  chunk_id: string;          // REQUIRED
  grounding: LandingAIGrounding[];  // REQUIRED
}

// Formato risposta "wrapped" (nuovo API /v1/ade/parse)
interface LandingAIResponseWrapped {
  data: {
    markdown: string;
    chunks: LandingAIChunk[];
    metadata?: any;
  };
  errors?: Array<{ message: string; code: string }>;
  metadata?: any;
}

// Formato risposta "direct" (legacy API /v1/tools/agentic-document-analysis)
interface LandingAIResponseDirect {
  markdown: string;
  chunks: LandingAIChunk[];
}

// ============================================================================
// FUNZIONE RICOSTRUITA: extractWithLandingAI
// ============================================================================

async function extractWithLandingAI(
  content: Blob,
  fileName: string
): Promise<LandingAIChunk[]> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  // 1️⃣ PREPARAZIONE REQUEST
  const formData = new FormData();
  formData.append('document', content, fileName);
  
  console.log(`🚀 [Landing AI] Calling API for: ${fileName}`);
  console.log(`🚀 [Landing AI] Content size: ${content.size} bytes`);
  console.log(`🚀 [Landing AI] Content type: ${content.type}`);

  // 2️⃣ CHIAMATA API
  const response = await fetch('https://api.va.landing.ai/v1/ade/parse', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${landingApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing AI] HTTP Error: ${response.status}`);
    console.error(`❌ [Landing AI] Error body: ${errorText}`);
    throw new Error(`Landing AI API failed: ${response.status} - ${errorText}`);
  }

  // 3️⃣ PARSING RISPOSTA
  const rawResult = await response.json();
  
  console.log('📊 [Landing AI] Raw Response Structure:', {
    hasData: 'data' in rawResult,
    hasChunks: 'chunks' in rawResult,
    hasMarkdown: 'markdown' in rawResult,
    hasErrors: 'errors' in rawResult,
    isArray: Array.isArray(rawResult),
    topLevelKeys: Object.keys(rawResult),
  });

  // 4️⃣ GESTIONE FORMATO WRAPPED (nuovo API)
  let chunks: LandingAIChunk[];
  
  if ('data' in rawResult && rawResult.data) {
    console.log('✓ [Landing AI] Response format: WRAPPED (new API)');
    
    // Controllare errori API
    if (rawResult.errors && rawResult.errors.length > 0) {
      console.warn('⚠️ [Landing AI] API returned errors:', rawResult.errors);
      rawResult.errors.forEach((err: any) => {
        console.warn(`   - ${err.code}: ${err.message}`);
      });
    }
    
    const wrappedResponse = rawResult as LandingAIResponseWrapped;
    chunks = wrappedResponse.data.chunks;
    
    console.log(`📄 [Landing AI] Markdown length: ${wrappedResponse.data.markdown?.length || 0} chars`);
    
  } else if ('chunks' in rawResult && Array.isArray(rawResult.chunks)) {
    console.log('✓ [Landing AI] Response format: DIRECT (legacy API)');
    const directResponse = rawResult as LandingAIResponseDirect;
    chunks = directResponse.chunks;
    
  } else {
    console.error('❌ [Landing AI] Unexpected response structure:', JSON.stringify(rawResult, null, 2));
    throw new Error('Landing AI returned unexpected response structure');
  }

  // 5️⃣ LOGGING DETTAGLIATO CHUNKS
  console.log(`📄 [Landing AI] Total chunks received: ${chunks.length}`);
  
  if (chunks.length > 0) {
    console.log('📄 [Landing AI] First 3 chunks (full structure):');
    chunks.slice(0, 3).forEach((chunk, i) => {
      console.log(`\n--- Chunk ${i} ---`);
      console.log(JSON.stringify(chunk, null, 2));
    });
  }

  // 6️⃣ VALIDAZIONE RIGOROSA
  const validatedChunks: LandingAIChunk[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Controllo presenza campi REQUIRED
    if (!chunk.text || typeof chunk.text !== 'string') {
      console.error(`❌ [Landing AI] Chunk ${i} missing or invalid 'text' field:`, {
        hasTextField: 'text' in chunk,
        textType: typeof chunk.text,
        textValue: chunk.text,
        allKeys: Object.keys(chunk),
      });
      throw new Error(`Landing AI chunk ${i} has null/invalid text field - this violates API schema`);
    }
    
    if (!chunk.chunk_type) {
      console.error(`❌ [Landing AI] Chunk ${i} missing 'chunk_type':`, chunk);
      throw new Error(`Landing AI chunk ${i} missing required chunk_type field`);
    }
    
    if (!chunk.chunk_id) {
      console.error(`❌ [Landing AI] Chunk ${i} missing 'chunk_id':`, chunk);
      throw new Error(`Landing AI chunk ${i} missing required chunk_id field`);
    }
    
    if (!Array.isArray(chunk.grounding)) {
      console.error(`❌ [Landing AI] Chunk ${i} missing/invalid 'grounding':`, chunk);
      throw new Error(`Landing AI chunk ${i} missing required grounding array`);
    }
    
    // Se arriviamo qui, il chunk è valido
    validatedChunks.push(chunk);
  }
  
  console.log(`✅ [Landing AI] Validated ${validatedChunks.length}/${chunks.length} chunks`);
  
  if (validatedChunks.length === 0) {
    throw new Error('Landing AI returned 0 valid chunks - all chunks failed validation');
  }
  
  return validatedChunks;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Pipeline B Process Chunks - Starting...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch up to 5 documents with status 'ingested'
    const { data: documents, error: fetchError } = await supabase
      .from('pipeline_b_documents')
      .select('*')
      .eq('status', 'ingested')
      .limit(5);

    if (fetchError) throw fetchError;

    if (!documents || documents.length === 0) {
      console.log('✓ No documents to process');
      return new Response(
        JSON.stringify({ message: 'No documents pending processing' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Processing ${documents.length} documents`);

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    for (const doc of documents) {
      try {
        console.log(`\n📄 Processing: ${doc.file_name}`);

        // Mark as processing
        await supabase
          .from('pipeline_b_documents')
          .update({ status: 'processing' })
          .eq('id', doc.id);

        let content: Blob;

        // Get content based on source type
        if (doc.source_type === 'pdf') {
          // Download PDF from storage
          const { data: fileData, error: downloadError } = await supabase.storage
            .from(doc.storage_bucket)
            .download(doc.file_path);

          if (downloadError) throw downloadError;
          content = fileData;

        } else if (doc.source_type === 'github' || doc.source_type === 'text') {
          // Convert full_text to Blob
          content = new Blob([doc.full_text], { type: 'text/plain' });

        } else {
          throw new Error(`Unsupported source_type: ${doc.source_type}`);
        }

        // Extract chunks with Landing AI (già validati)
        const landingChunks = await extractWithLandingAI(content, doc.file_name);
        console.log(`✓ Landing AI returned ${landingChunks.length} validated chunks`);

        // Non servono più filtri - extractWithLandingAI restituisce SOLO chunks validi
        const chunksToInsert = landingChunks.map((chunk, index) => ({
          document_id: doc.id,
          content: chunk.text,  // Garantito essere stringa non-vuota
          chunk_type: chunk.chunk_type,
          chunk_index: index,
          chunk_id: chunk.chunk_id,  // Nuovo campo da Landing AI
          page_number: chunk.grounding[0]?.page || null,
          visual_grounding: chunk.grounding || null,
          embedding_status: 'pending',
        }));

        const { error: insertError } = await supabase
          .from('pipeline_b_chunks_raw')
          .insert(chunksToInsert);

        if (insertError) throw insertError;

        // Mark document as chunked
        await supabase
          .from('pipeline_b_documents')
          .update({
            status: 'chunked',
            processed_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        console.log(`✓ Created ${landingChunks.length} chunks for ${doc.file_name}`);
        results.processed++;

      } catch (error) {
        console.error(`❌ Failed to process ${doc.file_name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Mark as failed
        await supabase
          .from('pipeline_b_documents')
          .update({
            status: 'failed',
            error_message: errorMessage,
          })
          .eq('id', doc.id);

        results.failed++;
        results.errors.push({ id: doc.id, error: errorMessage });
      }
    }

    console.log(`\n✅ Processing complete:`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Failed: ${results.failed}`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Process Chunks error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
