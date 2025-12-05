import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========== FINANCE QUERY EXPANSION DICTIONARY ==========
const FINANCE_EXPANSION_DICTIONARY: Record<string, string[]> = {
  // Acronimi bilancio
  'ppne': ['property', 'plant', 'equipment', 'net', 'PP&E', 'fixed assets'],
  'ppe': ['property', 'plant', 'equipment', 'PP&E', 'fixed assets'],
  'net ppne': ['net property plant equipment', 'PP&E net', 'fixed assets net'],
  
  // Working Capital Metrics
  'dpo': ['days', 'payable', 'outstanding', 'accounts payable', 'payment terms'],
  'dso': ['days', 'sales', 'outstanding', 'accounts receivable', 'collection'],
  'dio': ['days', 'inventory', 'outstanding', 'inventory turnover'],
  
  // Profitability Metrics
  'eps': ['earnings', 'per', 'share', 'net income', 'shares outstanding'],
  'ebitda': ['earnings', 'before', 'interest', 'taxes', 'depreciation', 'amortization', 'operating income'],
  'ebit': ['earnings', 'before', 'interest', 'taxes', 'operating income'],
  'roe': ['return', 'on', 'equity', 'net income', 'shareholders equity'],
  'roa': ['return', 'on', 'assets', 'net income', 'total assets'],
  'roic': ['return', 'on', 'invested', 'capital'],
  
  // Liquidity Ratios
  'quick ratio': ['acid test', 'current assets', 'current liabilities', 'inventory'],
  'current ratio': ['current assets', 'current liabilities', 'liquidity'],
  
  // Leverage Ratios
  'd/e': ['debt', 'to', 'equity', 'leverage', 'financial leverage'],
  'p/e': ['price', 'to', 'earnings', 'valuation', 'multiple'],
  
  // Fiscal Year Patterns
  'fy': ['fiscal', 'year', 'annual', 'yearly'],
  'fy2016': ['fiscal year 2016', '2016', 'annual 2016'],
  'fy2017': ['fiscal year 2017', '2017', 'annual 2017'],
  'fy2018': ['fiscal year 2018', '2018', 'annual 2018'],
  'fy2019': ['fiscal year 2019', '2019', 'annual 2019'],
  'fy2020': ['fiscal year 2020', '2020', 'annual 2020'],
  'fy2021': ['fiscal year 2021', '2021', 'annual 2021'],
  'fy2022': ['fiscal year 2022', '2022', 'annual 2022'],
  'fy2023': ['fiscal year 2023', '2023', 'annual 2023'],
  
  // Cash Flow
  'ocf': ['operating', 'cash', 'flow', 'cash from operations'],
  'fcf': ['free', 'cash', 'flow', 'capital expenditure'],
  'capex': ['capital', 'expenditure', 'investment', 'PP&E additions'],
  
  // Income Statement
  'cogs': ['cost', 'of', 'goods', 'sold', 'cost of sales', 'cost of revenue'],
  'sga': ['selling', 'general', 'administrative', 'operating expenses'],
  'r&d': ['research', 'development', 'R&D expense'],
  
  // Balance Sheet
  'goodwill': ['intangible', 'assets', 'acquisition'],
  'inventory': ['inventories', 'stock', 'merchandise'],
  'receivables': ['accounts receivable', 'trade receivables', 'AR'],
  'payables': ['accounts payable', 'trade payables', 'AP'],
  
  // FinanceBench-specific (dai casi di errore benchmark)
  'debt securities': ['notes', 'bonds', 'debentures', 'fixed income', 'investments'],
  'restructuring': ['restructuring charges', 'restructuring liability', 'employee severance', 'impairment'],
  'organic growth': ['organic', 'excluding acquisitions', 'excluding M&A', 'core growth'],
  'segment': ['business segment', 'operating segment', 'division', 'reportable segment'],
  'revenue growth': ['sales growth', 'top line growth', 'net sales change'],
};

// Funzione di Query Expansion (solo per dominio finance)
function expandFinanceQuery(query: string): string {
  let expandedTerms: string[] = [];
  const queryLower = query.toLowerCase();
  
  for (const [term, expansions] of Object.entries(FINANCE_EXPANSION_DICTIONARY)) {
    // Word boundary match (case-insensitive), escape special regex chars
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
    if (regex.test(queryLower)) {
      expandedTerms.push(...expansions);
    }
  }
  
  if (expandedTerms.length > 0) {
    // Deduplicate and append to original query
    const uniqueExpansions = [...new Set(expandedTerms)];
    return `${query} ${uniqueExpansions.join(' ')}`;
  }
  
  return query;
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

    // ========== FINANCE QUERY EXPANSION (Solo Semantic) ==========
    const expandedQuery = expandFinanceQuery(query);
    const expansionApplied = expandedQuery !== query;

    if (expansionApplied) {
      console.log(`[Finance Query Expansion] Original: "${query}"`);
      console.log(`[Finance Query Expansion] Expanded: "${expandedQuery}"`);
    }

    console.log('Performing semantic search for:', expansionApplied ? expandedQuery : query);

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
