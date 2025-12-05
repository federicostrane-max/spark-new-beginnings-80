import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========== HYBRID QUERY EXPANSION (LLM + Cache + Fallback) ==========
async function expandQueryHybrid(
  query: string
): Promise<{ expandedQuery: string; source: string; cached: boolean }> {
  try {
    // Call expand-query-llm edge function via internal HTTP
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const response = await fetch(`${supabaseUrl}/functions/v1/expand-query-llm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.error(`[Hybrid Expansion] expand-query-llm returned ${response.status}`);
      return { expandedQuery: query, source: 'none', cached: false };
    }

    const data = await response.json();
    return {
      expandedQuery: data.expanded_query || query,
      source: data.source || 'unknown',
      cached: data.cached || false,
    };
  } catch (error) {
    console.error('[Hybrid Expansion] Error calling expand-query-llm:', error);
    return { expandedQuery: query, source: 'error', cached: false };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, agentId, topK = 5, documentFilter = null } = await req.json();
    
    // ========== DIAGNOSTIC LOGGING ==========
    console.log('[DEBUG] Received agentId:', agentId);
    console.log('[DEBUG] agentId type:', typeof agentId);
    console.log('[DEBUG] agentId === null:', agentId === null);
    console.log('[DEBUG] agentId === undefined:', agentId === undefined);
    console.log('[DEBUG] Query:', query);
    console.log('[DEBUG] topK:', topK);
    console.log('[DEBUG] documentFilter:', documentFilter);
    // ========================================
    
    // ========== PRE-FILTER LOGGING ==========
    if (documentFilter) {
      console.log(`[PRE-FILTER] Restricting search to document: "${documentFilter}"`);
    }
    
    if (!query) {
      throw new Error('No query provided');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    // ========== HYBRID QUERY EXPANSION (LLM + Cache + Dictionary Fallback) ==========
    const { expandedQuery, source: expansionSource, cached: wasCached } = await expandQueryHybrid(query);
    const expansionApplied = expandedQuery !== query;

    console.log(`[Hybrid Query Expansion] Source: ${expansionSource}, Cached: ${wasCached}`);
    if (expansionApplied) {
      console.log(`[Hybrid Query Expansion] Original: "${query}"`);
      console.log(`[Hybrid Query Expansion] Expanded: "${expandedQuery.substring(0, 200)}..."`);
    }

    console.log('Performing semantic search for:', expansionApplied ? 'expanded query' : 'original query');

    // Generate query embedding (usa query ESPANSA per semantic search)
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: expandedQuery,  // ← Query espansa per embedding più ricco
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

    // ========== TRUE HYBRID SEARCH WITH PRE-FILTERING ==========
    // Execute BOTH semantic and keyword searches in parallel (never skip keyword)
    console.log('Executing True Hybrid Search (semantic + keyword in parallel)...');
    
    const semanticParams = {
      query_embedding: queryEmbedding,
      p_agent_id: agentId || null,
      match_threshold: 0.10, // OPTIMAL: 0.10 confirmed by FinanceBench testing (65% vs 60% at 0.07)
      match_count: topK * 2,
      p_document_name: documentFilter, // PRE-FILTER: restrict to specific document
    };
    const keywordParams = {
      search_query: query,  // ← Query ORIGINALE (non espansa) per match esatto
      p_agent_id: agentId,
      match_count: topK * 2,
      p_document_name: documentFilter, // PRE-FILTER: restrict to specific document
    };
    
    const [semanticResponse, keywordResponse] = await Promise.all([
      supabase.rpc('match_documents', semanticParams),
      supabase.rpc('keyword_search_documents', keywordParams)
    ]);

    // Handle errors gracefully (non-blocking)
    if (semanticResponse.error) {
      console.error('Semantic search error:', semanticResponse.error);
    }
    if (keywordResponse.error) {
      console.error('Keyword search error:', keywordResponse.error);
    }

    const semanticResults = semanticResponse.data || [];
    const keywordResults = keywordResponse.data || [];

    console.log(`Semantic search found: ${semanticResults.length} chunks`);
    console.log(`Keyword search found: ${keywordResults.length} chunks`);

    // Step 2: Merge and deduplicate by chunk ID
    const mergedMap = new Map();

    // Add semantic results first
    for (const chunk of semanticResults) {
      mergedMap.set(chunk.id, {
        ...chunk,
        search_type: 'semantic',
        semantic_score: chunk.similarity,
        keyword_score: null,
      });
    }

    // Add or merge keyword results
    for (const chunk of keywordResults) {
      if (mergedMap.has(chunk.id)) {
        // Chunk found by BOTH searches - mark as 'hybrid'
        const existing = mergedMap.get(chunk.id);
        existing.search_type = 'hybrid';
        existing.keyword_score = chunk.similarity; // FTS ts_rank score
      } else {
        // Chunk found ONLY by keyword search
        mergedMap.set(chunk.id, {
          ...chunk,
          search_type: 'keyword',
          semantic_score: null,
          keyword_score: chunk.similarity,
        });
      }
    }

    // Step 3: Convert to array and limit to topK
    const combinedResults = Array.from(mergedMap.values()).slice(0, topK);

    // Detailed logging for debugging
    console.log(`True Hybrid Search: returning ${combinedResults.length} unique chunks`);
    console.log('Search type breakdown:', {
      semantic_only: combinedResults.filter(c => c.search_type === 'semantic').length,
      keyword_only: combinedResults.filter(c => c.search_type === 'keyword').length,
      hybrid: combinedResults.filter(c => c.search_type === 'hybrid').length,
    });

    return new Response(
      JSON.stringify(combinedResults),
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
