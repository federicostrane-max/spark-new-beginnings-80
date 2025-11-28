import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, agentId, topK = 5 } = await req.json();
    
    if (!query) {
      throw new Error('No query provided');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    console.log('Performing semantic search for:', query);

    // Generate query embedding
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    });

    if (!embeddingResponse.ok) {
      throw new Error('Failed to generate query embedding');
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Search in knowledge base
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Lower threshold to 0.3 for better recall (was 0.5 = 50% similarity)
    // Step 1: Semantic search with embeddings
    const { data: semanticResults, error: semanticError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      p_agent_id: agentId || null,
      match_threshold: 0.3,  // 30% similarity threshold
      match_count: topK,
    });
    
    console.log('Semantic search params:', { 
      agentId, 
      topK, 
      threshold: 0.3,
      hasEmbedding: !!queryEmbedding 
    });

    if (semanticError) {
      console.error('Semantic search error:', semanticError);
      throw new Error(`Database error: ${semanticError.message}`);
    }

    console.log(`Semantic search found ${semanticResults?.length || 0} matching documents`);

    // Step 2: Keyword fallback with PostgreSQL FTS if semantic search returns 0 results
    if (!semanticResults || semanticResults.length === 0) {
      console.log('Semantic search returned 0 results, trying keyword fallback with PostgreSQL FTS...');
      
      const { data: keywordResults, error: keywordError } = await supabase.rpc('keyword_search_documents', {
        search_query: query,
        p_agent_id: agentId,
        match_count: topK,
      });
      
      if (keywordError) {
        console.error('Keyword search error:', keywordError);
        // Non-blocking error: continue with empty results
      } else {
        console.log(`Keyword fallback found ${keywordResults?.length || 0} documents`);
        
        if (keywordResults && keywordResults.length > 0) {
          return new Response(
            JSON.stringify(keywordResults),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Return semantic results (or empty array)
    const documents = semanticResults || [];

    return new Response(
      JSON.stringify(documents || []),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in semantic-search:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
