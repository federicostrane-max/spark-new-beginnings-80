import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, agentId } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('🔍 Searching pool documents with query:', query, 'for agent:', agentId);

    // Get OpenAI API key
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // Generate embedding for the search query
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
      const error = await embeddingResponse.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error}`);
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    console.log('✅ Generated embedding for query');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // DUAL SEARCH STRATEGY: Combine semantic search with title search
    
    // 1. SEMANTIC SEARCH - Search for similar documents using match_documents function
    const { data: matches, error: matchError } = await supabase.rpc(
      'match_documents',
      {
        query_embedding: queryEmbedding,
        filter_agent_id: agentId,
        match_threshold: 0.3,
        match_count: 50
      }
    );

    if (matchError) {
      console.error('Error matching documents:', matchError);
      throw matchError;
    }

    console.log('📊 Semantic search found', matches?.length || 0, 'chunk matches');

    // Get unique pool_document_ids from semantic matches
    const semanticDocIds = [...new Set(
      matches
        ?.map((m: any) => m.pool_document_id)
        .filter((id: any) => id != null) || []
    )];

    // 2. TITLE SEARCH - Search by file name
    const { data: titleMatches, error: titleError } = await supabase
      .from('knowledge_documents')
      .select('id')
      .ilike('file_name', `%${query}%`)
      .eq('validation_status', 'validated')
      .eq('processing_status', 'ready_for_assignment');

    if (titleError) {
      console.error('Error in title search:', titleError);
    }

    const titleDocIds = titleMatches?.map(d => d.id) || [];
    console.log('📝 Title search found', titleDocIds.length, 'matches');

    // Combine both search results (union)
    const allDocIds = [...new Set([...semanticDocIds, ...titleDocIds])];
    
    if (allDocIds.length === 0) {
      return new Response(
        JSON.stringify({ results: [], count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Total unique documents:', allDocIds.length, '(semantic:', semanticDocIds.length, 'title:', titleDocIds.length, ')');

    // Get full document details
    const { data: poolDocs, error: poolError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, ai_summary, created_at')
      .in('id', allDocIds)
      .eq('validation_status', 'validated')
      .eq('processing_status', 'ready_for_assignment');

    if (poolError) {
      console.error('Error fetching pool documents:', poolError);
      throw poolError;
    }

    console.log('📚 Found', poolDocs?.length || 0, 'ready pool documents');

    // Check which documents are already assigned to this agent
    const { data: assignedLinks, error: linksError } = await supabase
      .from('agent_document_links')
      .select('document_id')
      .eq('agent_id', agentId);

    if (linksError) {
      console.error('Error fetching assigned links:', linksError);
      throw linksError;
    }

    const assignedIds = new Set(assignedLinks?.map(l => l.document_id) || []);

    // Calculate similarity scores and combine with document info
    const results = (poolDocs || []).map(doc => {
      // Find if this doc was found in title search
      const fromTitleSearch = titleDocIds.includes(doc.id);
      
      // Find max similarity for this document from semantic search
      const docMatches = matches?.filter((m: any) => {
        return m.pool_document_id === doc.id;
      }) || [];
      
      const maxSimilarity = docMatches.length > 0 
        ? Math.max(...docMatches.map((m: any) => m.similarity || 0))
        : 0;
      
      // Boost similarity for title matches
      const finalSimilarity = fromTitleSearch 
        ? Math.max(maxSimilarity, 0.95) // Title match gets at least 0.95 similarity
        : maxSimilarity;

      return {
        id: doc.id,
        file_name: doc.file_name,
        ai_summary: doc.ai_summary,
        created_at: doc.created_at,
        similarity: finalSimilarity,
        isAssigned: assignedIds.has(doc.id),
        matchType: fromTitleSearch ? 'title' : 'semantic'
      };
    })
    .sort((a, b) => b.similarity - a.similarity); // Sort by similarity descending

    console.log('✅ Returning', results.length, 'search results');

    return new Response(
      JSON.stringify({ 
        results,
        count: results.length,
        query 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in search-pool-documents function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
