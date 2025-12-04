import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { suite = 'financebench', limit = 50 } = await req.json().catch(() => ({}));
    
    console.log(`[Run Benchmark] Starting event-driven benchmark for suite: ${suite}, limit: ${limit}`);

    // Step 1: Fetch active benchmark questions
    const { data: questions, error: questionsError } = await supabase
      .from('benchmark_datasets')
      .select('*')
      .eq('suite_category', suite)
      .eq('is_active', true)
      .not('document_id', 'is', null)
      .limit(limit);

    if (questionsError) {
      throw new Error(`Failed to fetch questions: ${questionsError.message}`);
    }

    if (!questions || questions.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No benchmark questions found',
        suite 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Step 2: Verify documents are ready
    const documentIds = [...new Set(questions.map(q => q.document_id))];
    const { data: readyDocs } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id')
      .in('id', documentIds)
      .eq('status', 'ready');

    const readyDocIds = new Set(readyDocs?.map(d => d.id) || []);
    const validQuestions = questions.filter(q => readyDocIds.has(q.document_id));

    if (validQuestions.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No questions with ready documents',
        total_questions: questions.length,
        ready_documents: readyDocIds.size
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Run Benchmark] Found ${validQuestions.length} valid questions across ${readyDocIds.size} ready documents`);

    // Step 3: Generate run_id
    const run_id = crypto.randomUUID();

    // Step 4: Insert all jobs into queue (trigger will invoke processing)
    const jobsToInsert = validQuestions.map(q => ({
      run_id,
      question_id: q.id,
      status: 'pending',
      attempts: 0,
      max_attempts: 3
    }));

    const { error: insertError } = await supabase
      .from('benchmark_jobs_queue')
      .insert(jobsToInsert);

    if (insertError) {
      throw new Error(`Failed to insert jobs: ${insertError.message}`);
    }

    console.log(`[Run Benchmark] ✅ Enqueued ${jobsToInsert.length} jobs with run_id: ${run_id}`);

    // EVENT-DRIVEN: Immediately trigger job processing instead of waiting for cron
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Use EdgeRuntime.waitUntil to invoke process-benchmark-job in background
    // This starts processing immediately without blocking the response
    const triggerProcessing = async () => {
      try {
        console.log(`[Run Benchmark] 🚀 Triggering immediate job processing...`);
        
        // Invoke process-benchmark-job with batch mode
        const response = await fetch(`${supabaseUrl}/functions/v1/process-benchmark-job`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`
          },
          body: JSON.stringify({ fallback_mode: true })
        });
        
        if (!response.ok) {
          console.error(`[Run Benchmark] ❌ Failed to trigger processing: ${response.status}`);
        } else {
          console.log(`[Run Benchmark] ✅ Processing triggered successfully`);
        }
      } catch (err) {
        console.error(`[Run Benchmark] ❌ Error triggering processing:`, err);
      }
    };

    // Fire and forget - don't block response
    (globalThis as any).EdgeRuntime?.waitUntil?.(triggerProcessing()) || triggerProcessing();

    return new Response(JSON.stringify({
      success: true,
      run_id,
      total_jobs: jobsToInsert.length,
      suite,
      message: 'Benchmark avviato! Jobs in elaborazione immediata.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`[Run Benchmark] Critical error:`, error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
