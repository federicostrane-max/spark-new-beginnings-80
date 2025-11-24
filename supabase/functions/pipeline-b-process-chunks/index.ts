import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LandingAIChunk {
  text?: string;
  content?: string;
  chunk_type?: string;
  chunk_id?: string;
  grounding?: Array<{
    box?: { l: number; t: number; r: number; b: number };
    page?: number;
  }>;
  chunk_references?: {
    page?: number;
    grounding?: Array<{ x: number; y: number; width: number; height: number }>;
  };
}

async function extractWithLandingAI(
  content: Blob,
  fileName: string
): Promise<LandingAIChunk[]> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  const formData = new FormData();
  formData.append('document', content, fileName);

  console.log(`🚀 Calling Landing AI for ${fileName}...`);

  const response = await fetch('https://api.va.landing.ai/v1/ade/parse', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${landingApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Landing AI failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  // 📊 DETAILED LOGGING - Response Structure
  console.log('📊 Landing AI Response Structure:', {
    hasChunks: 'chunks' in result,
    hasMarkdown: 'markdown' in result,
    isArray: Array.isArray(result),
    keys: Object.keys(result),
    resultType: typeof result,
  });
  
  // Determine chunks array from different possible structures
  let rawChunks: any[];
  
  if (Array.isArray(result)) {
    console.log('✓ Response is direct array');
    rawChunks = result;
  } else if (result.chunks && Array.isArray(result.chunks)) {
    console.log('✓ Response has chunks property');
    rawChunks = result.chunks;
  } else {
    console.error('❌ Unexpected response structure:', JSON.stringify(result, null, 2));
    throw new Error('Unexpected response structure from Landing AI');
  }
  
  // 📄 DETAILED LOGGING - First 3 Chunks
  console.log(`📄 Total chunks received: ${rawChunks.length}`);
  console.log('📄 First 3 chunks detailed structure:', JSON.stringify(rawChunks.slice(0, 3), null, 2));
  
  // Map chunks to standardized format, supporting multiple field names
  const mappedChunks = rawChunks.map((chunk, index) => {
    const text = chunk.text || chunk.content || '';
    const chunkType = chunk.chunk_type || 'text';
    
    // Log any chunks with empty text
    if (!text || text.trim().length === 0) {
      console.warn(`⚠️ Chunk ${index} has empty text field:`, {
        hasText: 'text' in chunk,
        hasContent: 'content' in chunk,
        textValue: chunk.text,
        contentValue: chunk.content,
        allKeys: Object.keys(chunk),
      });
    }
    
    return {
      text,
      chunk_type: chunkType,
      chunk_references: {
        page: chunk.grounding?.[0]?.page || chunk.chunk_references?.page,
        grounding: chunk.grounding || chunk.chunk_references?.grounding,
      },
    };
  });
  
  console.log(`✓ Mapped ${mappedChunks.length} chunks to standard format`);
  return mappedChunks;
}

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

        // Extract chunks with Landing AI
        const landingChunks = await extractWithLandingAI(content, doc.file_name);
        console.log(`✓ Landing AI returned ${landingChunks.length} chunks`);

        if (landingChunks.length === 0) {
          throw new Error('No chunks returned by Landing AI');
        }

        // Filter out chunks with null/empty text and insert into pipeline_b_chunks_raw
        const validChunks = landingChunks.filter(chunk => chunk.text && chunk.text.trim().length > 0);
        console.log(`✓ Filtered to ${validChunks.length} valid chunks (removed ${landingChunks.length - validChunks.length} empty chunks)`);
        
        if (validChunks.length === 0) {
          throw new Error('No valid chunks after filtering empty content');
        }
        
        const chunksToInsert = validChunks.map((chunk, index) => ({
          document_id: doc.id,
          content: chunk.text,
          chunk_type: chunk.chunk_type || 'text',
          chunk_index: index,
          page_number: chunk.chunk_references?.page || null,
          visual_grounding: chunk.chunk_references?.grounding || null,
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

        console.log(`✓ Created ${validChunks.length} chunks for ${doc.file_name}`);
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