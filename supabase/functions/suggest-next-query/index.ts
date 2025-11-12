import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Genera varianti di query per la ricerca
function generateQueryVariants(originalTopic: string): string[] {
  const queries: string[] = [];
  
  // 1. Topic originale con PDF
  queries.push(`"${originalTopic}" PDF`);
  
  // 2. Variante con "guide"
  queries.push(`${originalTopic} guide PDF`);
  
  // 3. Variante con "book"
  queries.push(`${originalTopic} book PDF`);
  
  // 4. Variante con "manual"
  queries.push(`${originalTopic} manual PDF`);
  
  // 5. Variante con "handbook"
  queries.push(`${originalTopic} handbook PDF`);
  
  // 6. Variante con "tutorial"
  queries.push(`${originalTopic} tutorial PDF`);
  
  // 7. Parole chiave principali
  const words = originalTopic.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 3) {
    queries.push(`${words.slice(0, 3).join(' ')} PDF`);
  }
  
  // 8. Prime 2 parole + resources
  if (words.length >= 2) {
    queries.push(`${words.slice(0, 2).join(' ')} resources PDF`);
  }
  
  // 9. Topic + "complete"
  queries.push(`${originalTopic} complete guide PDF`);
  
  // 10. Topic + "comprehensive"
  queries.push(`${originalTopic} comprehensive PDF`);
  
  return [...new Set(queries)]; // Rimuovi duplicati
}

interface SuggestNextQueryRequest {
  conversationId: string;
  agentId: string;
  originalTopic: string;
}

interface SuggestNextQueryResponse {
  success: boolean;
  hasNextQuery: boolean;
  nextQuery?: string;
  variantIndex?: number;
  totalVariants: number;
  executedCount: number;
  message?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversationId, agentId, originalTopic }: SuggestNextQueryRequest = await req.json();
    
    if (!conversationId || !agentId || !originalTopic) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`🔍 [SUGGEST QUERY] For topic: "${originalTopic}"`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Genera tutte le varianti possibili
    const allVariants = generateQueryVariants(originalTopic);
    console.log(`📋 Generated ${allVariants.length} query variants`);
    
    // Recupera query già eseguite per questa conversazione
    const { data: executedQueries, error: fetchError } = await supabase
      .from('search_query_history')
      .select('executed_query')
      .eq('conversation_id', conversationId)
      .eq('original_topic', originalTopic);
    
    if (fetchError) {
      console.error('❌ Failed to fetch query history:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch query history' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const executedSet = new Set(executedQueries?.map(q => q.executed_query) || []);
    console.log(`📊 Already executed: ${executedSet.size} queries`);
    
    // Trova la prossima query non ancora eseguita
    const nextQueryIndex = allVariants.findIndex(q => !executedSet.has(q));
    
    if (nextQueryIndex === -1) {
      console.log('✅ All query variants exhausted');
      
      const response: SuggestNextQueryResponse = {
        success: true,
        hasNextQuery: false,
        totalVariants: allVariants.length,
        executedCount: executedSet.size,
        message: `Ho esaurito tutte le ${allVariants.length} varianti di ricerca per "${originalTopic}".`
      };
      
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const nextQuery = allVariants[nextQueryIndex];
    console.log(`✨ Next suggested query (${nextQueryIndex + 1}/${allVariants.length}): "${nextQuery}"`);
    
    const response: SuggestNextQueryResponse = {
      success: true,
      hasNextQuery: true,
      nextQuery,
      variantIndex: nextQueryIndex,
      totalVariants: allVariants.length,
      executedCount: executedSet.size
    };
    
    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [SUGGEST QUERY] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
