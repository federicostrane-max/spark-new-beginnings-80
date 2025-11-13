import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    const { documentId, strategies = ['content_inference'] } = await req.json();
    
    console.log(`[test-aggressive] Testing strategies:`, strategies);
    
    // Get target document
    let targetDoc: any;
    if (documentId) {
      const { data } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('id', documentId)
        .single();
      targetDoc = data;
    } else {
      const { data } = await supabase
        .from('knowledge_documents')
        .select('*')
        .or('metadata_confidence.eq.low,metadata_confidence.eq.medium')
        .limit(1)
        .single();
      targetDoc = data;
    }
    
    if (!targetDoc) {
      return new Response(
        JSON.stringify({ error: 'No document found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[test-aggressive] Testing: ${targetDoc.file_name}`);
    
    const results = [];
    
    // Content-Based Inference
    const startTime = Date.now();
    try {
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('content')
        .eq('pool_document_id', targetDoc.id)
        .limit(30);
      
      if (chunks?.length > 0) {
        const combinedContent = chunks.map((c: any) => c.content).join('\n\n');
        
        const prompt = `Extract title and authors from these excerpts:

${combinedContent.slice(0, 3000)}

Return JSON: {"title": "...", "authors": ["..."], "confidence": "high|medium|low"}`;
        
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          })
        });
        
        const data = await response.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        
        results.push({
          strategy: 'content_inference',
          success: true,
          title: result.title,
          authors: result.authors || [],
          confidence: result.confidence,
          executionTimeMs: Date.now() - startTime
        });
      }
    } catch (e) {
      results.push({
        strategy: 'content_inference',
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime
      });
    }
    
    return new Response(
      JSON.stringify({
        document: {
          id: targetDoc.id,
          fileName: targetDoc.file_name,
          currentTitle: targetDoc.extracted_title,
          currentConfidence: targetDoc.metadata_confidence
        },
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[test-aggressive] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
