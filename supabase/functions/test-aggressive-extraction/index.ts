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
    console.log('[test-aggressive] Starting content inference...');
    
    try {
      console.log('[test-aggressive] Fetching chunks from agent_knowledge...');
      const { data: chunks, error: chunkError } = await supabase
        .from('agent_knowledge')
        .select('content')
        .eq('pool_document_id', targetDoc.id)
        .limit(10); // Reduced from 30 to 10
      
      if (chunkError) {
        console.error('[test-aggressive] Chunk fetch error:', chunkError);
        throw new Error(`Chunk fetch failed: ${chunkError.message}`);
      }
      
      console.log(`[test-aggressive] Fetched ${chunks?.length || 0} chunks`);
      
      if (chunks?.length > 0) {
        const combinedContent = chunks.map((c: any) => c.content).join('\n\n');
        console.log(`[test-aggressive] Combined content length: ${combinedContent.length} chars`);
        
        const truncatedContent = combinedContent.slice(0, 2000); // Reduced from 3000 to 2000
        const prompt = `Extract title and authors from these excerpts:

${truncatedContent}

Return JSON: {"title": "...", "authors": ["..."], "confidence": "high|medium|low"}`;
        
        console.log('[test-aggressive] Calling AI gateway...');
        
        // Add timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout
        
        try {
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
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          console.log(`[test-aggressive] AI response status: ${response.status}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('[test-aggressive] AI gateway error:', errorText);
            throw new Error(`AI gateway returned ${response.status}: ${errorText}`);
          }
          
          const data = await response.json();
          console.log('[test-aggressive] AI response received, parsing...');
          
          if (!data.choices?.[0]?.message?.content) {
            console.error('[test-aggressive] Invalid AI response structure:', JSON.stringify(data));
            throw new Error('Invalid AI response structure');
          }
          
          const rawContent = data.choices[0].message.content;
          const cleanedContent = rawContent.replace(/```json|```/g, '').trim();
          console.log('[test-aggressive] Cleaned content:', cleanedContent);
          
          const result = JSON.parse(cleanedContent);
          console.log('[test-aggressive] ✓ Successfully extracted metadata:', result);
          
          results.push({
            strategy: 'content_inference',
            success: true,
            title: result.title,
            authors: result.authors || [],
            confidence: result.confidence,
            executionTimeMs: Date.now() - startTime
          });
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            console.error('[test-aggressive] AI call timed out after 45 seconds');
            throw new Error('AI call timed out after 45 seconds');
          }
          throw fetchError;
        }
      } else {
        console.warn('[test-aggressive] No chunks found for document');
        results.push({
          strategy: 'content_inference',
          success: false,
          error: 'No chunks found for document',
          executionTimeMs: Date.now() - startTime
        });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      const errorStack = e instanceof Error ? e.stack : undefined;
      
      console.error('[test-aggressive] ❌ Content inference failed:', errorMessage);
      if (errorStack) {
        console.error('[test-aggressive] Stack trace:', errorStack);
      }
      
      results.push({
        strategy: 'content_inference',
        success: false,
        error: errorMessage,
        errorStack: errorStack,
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
