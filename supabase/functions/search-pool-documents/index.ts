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

    // Search for similar documents using match_documents function
    // We'll search across ALL documents first, then filter for ready_for_assignment
    const { data: matches, error: matchError } = await supabase.rpc(
      'match_documents',
      {
        query_embedding: queryEmbedding,
        filter_agent_id: agentId, // This will check if docs are assigned
        match_threshold: 0.3, // Lower threshold to get more results
        match_count: 50 // Get more results initially
      }
    );

    if (matchError) {
      console.error('Error matching documents:', matchError);
      throw matchError;
    }

    console.log('📊 Found', matches?.length || 0, 'matches from match_documents');

    // Get unique pool_document_ids from matches (filter out nulls for direct uploads)
    const poolDocumentIds = [...new Set(
      matches
        ?.map((m: any) => m.pool_document_id)
        .filter((id: any) => id != null) || []
    )];
    
    if (poolDocumentIds.length === 0) {
      return new Response(
        JSON.stringify({ results: [], count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get full document details from knowledge_documents
    const { data: poolDocs, error: poolError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, ai_summary, created_at')
      .in('id', poolDocumentIds)
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
      // Find max similarity for this document across all its chunks
      const docMatches = matches?.filter((m: any) => {
        // Use pool_document_id to match chunks to documents
        return m.pool_document_id === doc.id;
      }) || [];
      
      const maxSimilarity = docMatches.length > 0 
        ? Math.max(...docMatches.map((m: any) => m.similarity || 0))
        : 0;

      return {
        id: doc.id,
        file_name: doc.file_name,
        ai_summary: doc.ai_summary,
        created_at: doc.created_at,
        similarity: maxSimilarity,
        isAssigned: assignedIds.has(doc.id),
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
