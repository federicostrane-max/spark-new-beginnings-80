import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========== STATIC DICTIONARY FALLBACK ==========
const FINANCE_EXPANSION_DICTIONARY: Record<string, string[]> = {
  'ppne': ['property', 'plant', 'equipment', 'net', 'PP&E', 'fixed assets'],
  'ppe': ['property', 'plant', 'equipment', 'PP&E', 'fixed assets'],
  'net ppne': ['net property plant equipment', 'PP&E net', 'fixed assets net'],
  'dpo': ['days', 'payable', 'outstanding', 'accounts payable', 'payment terms'],
  'dso': ['days', 'sales', 'outstanding', 'accounts receivable', 'collection'],
  'dio': ['days', 'inventory', 'outstanding', 'inventory turnover'],
  'eps': ['earnings', 'per', 'share', 'net income', 'shares outstanding'],
  'ebitda': ['earnings', 'before', 'interest', 'taxes', 'depreciation', 'amortization', 'operating income'],
  'ebit': ['earnings', 'before', 'interest', 'taxes', 'operating income'],
  'roe': ['return', 'on', 'equity', 'net income', 'shareholders equity'],
  'roa': ['return', 'on', 'assets', 'net income', 'total assets'],
  'roic': ['return', 'on', 'invested', 'capital'],
  'quick ratio': ['acid test', 'current assets', 'current liabilities', 'inventory'],
  'current ratio': ['current assets', 'current liabilities', 'liquidity'],
  'd/e': ['debt', 'to', 'equity', 'leverage', 'financial leverage'],
  'p/e': ['price', 'to', 'earnings', 'valuation', 'multiple'],
  'fy': ['fiscal', 'year', 'annual', 'yearly'],
  'ocf': ['operating', 'cash', 'flow', 'cash from operations'],
  'fcf': ['free', 'cash', 'flow', 'capital expenditure'],
  'capex': ['capital', 'expenditure', 'investment', 'PP&E additions'],
  'cogs': ['cost', 'of', 'goods', 'sold', 'cost of sales', 'cost of revenue'],
  'sga': ['selling', 'general', 'administrative', 'operating expenses'],
  'r&d': ['research', 'development', 'R&D expense'],
  'goodwill': ['intangible', 'assets', 'acquisition'],
  'inventory': ['inventories', 'stock', 'merchandise'],
  'receivables': ['accounts receivable', 'trade receivables', 'AR'],
  'payables': ['accounts payable', 'trade payables', 'AP'],
  'debt securities': ['notes', 'bonds', 'debentures', 'fixed income', 'investments'],
  'restructuring': ['restructuring charges', 'restructuring liability', 'employee severance', 'impairment'],
  'organic growth': ['organic', 'excluding acquisitions', 'excluding M&A', 'core growth'],
  'segment': ['business segment', 'operating segment', 'division', 'reportable segment'],
  'revenue growth': ['sales growth', 'top line growth', 'net sales change'],
};

// Dictionary-based fallback expansion
function expandWithDictionary(query: string): string {
  let expandedTerms: string[] = [];
  const queryLower = query.toLowerCase();
  
  for (const [term, expansions] of Object.entries(FINANCE_EXPANSION_DICTIONARY)) {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
    if (regex.test(queryLower)) {
      expandedTerms.push(...expansions);
    }
  }
  
  if (expandedTerms.length > 0) {
    const uniqueExpansions = [...new Set(expandedTerms)];
    return `${query} ${uniqueExpansions.join(' ')}`;
  }
  
  return query;
}

// Normalize query for cache key
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Generate SHA-256 hash for cache key (MD5 not supported in all environments)
async function hashQuery(query: string): Promise<string> {
  const normalized = normalizeQuery(query);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32); // Truncate to 32 chars
}

// LLM expansion using Lovable AI Gateway
async function expandWithLLM(query: string, lovableApiKey: string): Promise<string | null> {
  const prompt = `Expand this financial query with synonyms and related terms found in SEC filings (10-K, 10-Q, 8-K).
Add:
- GAAP/IFRS equivalent terms
- Common variations in corporate filings
- Relevant time period formats (e.g., Q2 2023 → second quarter June 30 2023)
- Related line items that might contain the answer

Return ONLY the expanded query as a single line, no explanation or formatting.

Query: "${query}"`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite', // Cheapest model
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.3, // Low temp for consistency
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[LLM Expand] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const expandedQuery = data.choices?.[0]?.message?.content?.trim();
    
    if (!expandedQuery) {
      console.error('[LLM Expand] Empty response from LLM');
      return null;
    }

    console.log(`[LLM Expand] Success: "${expandedQuery.substring(0, 100)}..."`);
    return expandedQuery;

  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      console.error('[LLM Expand] Timeout after 5s');
    } else {
      console.error('[LLM Expand] Error:', err.message);
    }
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query) {
      throw new Error('No query provided');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('[QUERY EXPANSION] Starting expansion process');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📝 ORIGINAL QUERY: "${query}"`);
    console.log(`📏 Query length: ${query.length} chars`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Normalize and hash
    const normalizedQuery = normalizeQuery(query);
    const queryHash = await hashQuery(query);
    console.log('───────────────────────────────────────────────────────────');
    console.log(`🔄 NORMALIZATION:`);
    console.log(`   Original:   "${query}"`);
    console.log(`   Normalized: "${normalizedQuery}"`);
    console.log(`   Hash:       ${queryHash}`);

    // Step 2: Check cache
    console.log('───────────────────────────────────────────────────────────');
    console.log(`🗄️  CACHE LOOKUP: hash=${queryHash}`);

    const { data: cached, error: cacheError } = await supabase
      .from('query_expansion_cache')
      .select('expanded_query, expansion_source')
      .eq('query_hash', queryHash)
      .maybeSingle();

    if (cached) {
      console.log(`✅ CACHE HIT!`);
      console.log(`   Source: ${cached.expansion_source}`);
      console.log(`   Expanded: "${cached.expanded_query}"`);
      console.log('═══════════════════════════════════════════════════════════');
      return new Response(
        JSON.stringify({
          original_query: query,
          expanded_query: cached.expanded_query,
          source: cached.expansion_source,
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('❌ CACHE MISS - generating new expansion...');

    let expandedQuery: string;
    let source: string;

    // Step 3: Try LLM expansion (if API key available)
    if (lovableApiKey) {
      console.log('───────────────────────────────────────────────────────────');
      console.log('🤖 LLM EXPANSION:');
      console.log(`   API Key: ${lovableApiKey ? '✅ Available' : '❌ Missing'}`);
      console.log(`   Model: google/gemini-2.5-flash-lite`);
      console.log('   Calling Lovable AI Gateway...');
      
      const startTime = Date.now();
      const llmResult = await expandWithLLM(query, lovableApiKey);
      const elapsed = Date.now() - startTime;
      
      console.log(`   ⏱️  LLM call took: ${elapsed}ms`);
      
      if (llmResult) {
        expandedQuery = llmResult;
        source = 'llm';
        console.log(`   ✅ LLM SUCCESS`);
        console.log(`   📤 LLM Output: "${llmResult}"`);
      } else {
        console.log('   ⚠️  LLM FAILED - falling back to dictionary');
        expandedQuery = expandWithDictionary(query);
        source = 'dictionary';
      }
    } else {
      console.log('───────────────────────────────────────────────────────────');
      console.log('📚 DICTIONARY EXPANSION (no LOVABLE_API_KEY):');
      expandedQuery = expandWithDictionary(query);
      source = 'dictionary';
    }

    // Log expansion comparison
    console.log('───────────────────────────────────────────────────────────');
    console.log('📊 EXPANSION RESULT:');
    console.log(`   Source: ${source.toUpperCase()}`);
    console.log(`   Original (${query.length} chars): "${query}"`);
    console.log(`   Expanded (${expandedQuery.length} chars): "${expandedQuery}"`);
    
    const expansionApplied = expandedQuery !== query;
    if (expansionApplied) {
      // Calculate what was added
      const addedTerms = expandedQuery.replace(query, '').trim();
      console.log(`   ✅ Expansion applied: YES`);
      console.log(`   ➕ Added terms: "${addedTerms}"`);
      console.log(`   📈 Expansion ratio: ${(expandedQuery.length / query.length).toFixed(2)}x`);
    } else {
      console.log(`   ℹ️  Expansion applied: NO (query unchanged)`);
    }

    // Step 4: Store in cache
    console.log('───────────────────────────────────────────────────────────');
    console.log('💾 CACHING RESULT...');
    
    const { error: insertError } = await supabase
      .from('query_expansion_cache')
      .upsert({
        query_hash: queryHash,
        original_query: query,
        expanded_query: expandedQuery,
        expansion_source: source,
      });
    
    if (insertError) {
      console.error(`   ❌ Cache insert failed: ${insertError.message}`);
    } else {
      console.log(`   ✅ Cached successfully (hash: ${queryHash})`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('[QUERY EXPANSION] Complete');
    console.log('═══════════════════════════════════════════════════════════');

    return new Response(
      JSON.stringify({
        original_query: query,
        expanded_query: expandedQuery,
        source: source,
        cached: false,
        expansion_applied: expansionApplied,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error('[QUERY EXPANSION] ERROR:', error);
    console.error('═══════════════════════════════════════════════════════════');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
