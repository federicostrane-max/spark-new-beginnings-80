import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========== QUERY-AWARE CHUNK BOOSTING ==========

type QueryIntent = 
  | 'balance_sheet_metric'      // ROA, quick ratio, debt ratios, assets, liabilities
  | 'income_statement_metric'   // margins, revenue growth, EPS, net income
  | 'cash_flow_metric'          // capex, FCF, operating cash flow
  | 'filing_metadata'           // securities registered, filing date, auditor, exhibits
  | 'segment_analysis'          // segment revenue, geographic breakdown
  | 'general';

// Intent detection patterns (rule-based, fast)
const INTENT_PATTERNS: Record<QueryIntent, RegExp[]> = {
  'filing_metadata': [
    /\b(securities?\s+registered|exchange\s+listing|trading\s+symbol|ticker|cusip)\b/i,
    /\b(auditor|independent\s+accountant|filing\s+date|form\s+(10-[kq]|8-k)|sec\s+filing)\b/i,
    /\b(registrant|cover\s+page|exhibit\s+index|signatures?)\b/i,
    /\b(debt\s+securities?\s+(registered|listed|traded))\b/i,
  ],
  'balance_sheet_metric': [
    /\b(quick\s+ratio|current\s+ratio|debt[- ]to[- ]equity|working\s+capital)\b/i,
    /\b(total\s+(assets?|liabilities?|equity|debt)|book\s+value)\b/i,
    /\b(roa|roe|return\s+on\s+(assets?|equity))\b/i,
    /\b(accounts?\s+(receivable|payable)|inventory|cash\s+and\s+equivalents?)\b/i,
    /\b(balance\s+sheet|financial\s+position)\b/i,
  ],
  'income_statement_metric': [
    /\b(revenue|sales|net\s+income|gross\s+profit|operating\s+income)\b/i,
    /\b(eps|earnings\s+per\s+share|diluted\s+eps)\b/i,
    /\b(gross\s+margin|operating\s+margin|net\s+margin|profit\s+margin)\b/i,
    /\b(income\s+statement|statement\s+of\s+operations?)\b/i,
    /\b(cost\s+of\s+(goods\s+sold|revenue|sales)|cogs)\b/i,
  ],
  'cash_flow_metric': [
    /\b(capex|capital\s+expenditure|property[,\s]+plant[,\s]+and\s+equipment)\b/i,
    /\b(free\s+cash\s+flow|fcf|operating\s+cash\s+flow|cash\s+from\s+operations?)\b/i,
    /\b(cash\s+flow\s+statement|statement\s+of\s+cash\s+flows?)\b/i,
    /\b(depreciation|amortization|investing\s+activities?|financing\s+activities?)\b/i,
  ],
  'segment_analysis': [
    /\b(segment|geographic|regional|by\s+(region|country|product\s+line))\b/i,
    /\b(business\s+unit|operating\s+segment|reportable\s+segment)\b/i,
  ],
  'general': [], // fallback, no patterns
};

// Boost multipliers: intent → chunk_type → boost factor
const BOOST_MAPS: Record<QueryIntent, Record<string, number>> = {
  'filing_metadata': {
    'cover_page': 3.0,
    'header': 2.5,
    'exhibit': 2.0,
    'text': 1.2,
    'table': 0.6,
    'visual': 0.5,
  },
  'balance_sheet_metric': {
    'balance_sheet': 2.5,
    'financial_statement': 2.0,
    'table': 1.8,
    'visual': 1.5,
    'text': 0.9,
  },
  'income_statement_metric': {
    'income_statement': 2.5,
    'financial_statement': 2.0,
    'table': 1.8,
    'visual': 1.5,
    'text': 0.9,
  },
  'cash_flow_metric': {
    'cash_flow_statement': 2.5,
    'financial_statement': 2.0,
    'table': 1.8,
    'visual': 1.5,
    'text': 0.9,
  },
  'segment_analysis': {
    'segment': 2.0,
    'table': 1.8,
    'visual': 1.5,
    'text': 1.0,
  },
  'general': {}, // no boosts applied
};

function detectQueryIntent(query: string): QueryIntent {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [QueryIntent, RegExp[]][]) {
    if (intent === 'general') continue; // skip fallback
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return intent;
      }
    }
  }
  return 'general';
}

interface ChunkWithScore {
  id: string;
  content: string;
  category: string;
  similarity: number;
  document_name: string;
  chunk_type: string;
  pipeline_source: string;
  search_type?: string;
  semantic_score?: number | null;
  keyword_score?: number | null;
  boosted_score?: number;
  intent_boost?: number;
}

// Simple re-ranking based on chunk_type only (no content-based detection)
function rerankWithBoost(
  chunks: ChunkWithScore[], 
  queryIntent: QueryIntent
): ChunkWithScore[] {
  const boostMap = BOOST_MAPS[queryIntent];
  
  // If general intent, no re-ranking needed
  if (queryIntent === 'general' || Object.keys(boostMap).length === 0) {
    return chunks;
  }
  
  return chunks
    .map(chunk => {
      const chunkCategory = chunk.chunk_type?.toLowerCase() || 'text';
      const boostFactor = boostMap[chunkCategory] || 1.0;
      
      const baseScore = chunk.similarity || 0;
      return {
        ...chunk,
        boosted_score: baseScore * boostFactor,
        intent_boost: boostFactor,
      };
    })
    .sort((a, b) => (b.boosted_score || 0) - (a.boosted_score || 0));
}

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
      match_threshold: 0.05, // LOWERED: 0.05 to improve retrieval with document pre-filter active
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

    // Step 3: Convert to array
    let combinedResults = Array.from(mergedMap.values());

    // ========== QUERY-AWARE CHUNK BOOSTING (POST-RETRIEVAL RE-RANKING) ==========
    const queryIntent = detectQueryIntent(query);
    console.log(`[Intent Detection] Query intent: "${queryIntent}" for query: "${query.substring(0, 80)}..."`);
    
    if (queryIntent !== 'general') {
      console.log(`[Chunk Boosting] Applying ${queryIntent} boost to ${combinedResults.length} chunks`);
      combinedResults = rerankWithBoost(combinedResults as ChunkWithScore[], queryIntent);
      
      // Log top 3 boosted scores for debugging
      const topBoosted = combinedResults.slice(0, 3).map(c => ({
        chunk_type: c.chunk_type,
        boost: (c as any).intent_boost,
        original: c.similarity?.toFixed(3),
        boosted: (c as any).boosted_score?.toFixed(3),
      }));
      console.log('[Chunk Boosting] Top 3 after re-ranking:', JSON.stringify(topBoosted));
    }

    // Limit to topK after boosting
    combinedResults = combinedResults.slice(0, topK);

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
