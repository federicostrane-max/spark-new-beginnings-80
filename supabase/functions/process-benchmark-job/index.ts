import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BENCHMARK_AGENT_SLUG = 'pipiline-c-tester';
const BENCHMARK_USER_ID = '00000000-0000-0000-0000-000000000001';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { job_id, fallback_mode } = body;
    
    let targetJobId = job_id;
    
    // Fallback mode: pick oldest pending job
    if (fallback_mode || !job_id) {
      const { data: pendingJob } = await supabase
        .from('benchmark_jobs_queue')
        .select('id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      
      if (!pendingJob) {
        return new Response(JSON.stringify({ skipped: true, reason: 'No pending jobs' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      targetJobId = pendingJob.id;
      console.log(`[Process Benchmark Job] Fallback mode: picked job ${targetJobId}`);
    } else {
      console.log(`[Process Benchmark Job] Starting job: ${targetJobId}`);
    }

    // Step 1: Fetch job with pessimistic locking pattern
    const { data: job, error: fetchError } = await supabase
      .from('benchmark_jobs_queue')
      .select('*, benchmark_datasets(*)')
      .eq('id', targetJobId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !job) {
      console.log(`[Process Benchmark Job] Job ${targetJobId} not found or not pending - skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: 'Job not pending or not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Step 2: Mark as processing with incremented attempts
    const { error: updateError } = await supabase
      .from('benchmark_jobs_queue')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        attempts: job.attempts + 1
      })
      .eq('id', targetJobId)
      .eq('status', 'pending'); // Double-check still pending

    if (updateError) {
      console.error(`[Process Benchmark Job] Failed to mark job as processing:`, updateError);
      return new Response(JSON.stringify({ error: 'Failed to acquire job lock' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const question = job.benchmark_datasets;
    if (!question) {
      await markJobFailed(supabase, targetJobId, 'Question data not found');
      return new Response(JSON.stringify({ error: 'Question not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Process Benchmark Job] Processing: "${question.question.substring(0, 50)}..."`);

    // Step 3: Generate unique conversation ID
    const conversationId = crypto.randomUUID();

    // Step 4: Call agent-chat with extended timeout
    const startTime = Date.now();
    let agentResponse = '';
    let responseTimeMs = 0;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min timeout

      const prefixedQuestion = `Regarding document '${question.file_name}': ${question.question}`;
      
      const agentChatResponse = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentSlug: BENCHMARK_AGENT_SLUG,
          message: prefixedQuestion,
          conversationId,
          stream: false,
          serverUserId: BENCHMARK_USER_ID
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      responseTimeMs = Date.now() - startTime;

      if (!agentChatResponse.ok) {
        const errorText = await agentChatResponse.text();
        throw new Error(`Agent chat failed: ${agentChatResponse.status} - ${errorText}`);
      }

      // Parse SSE response
      const responseText = await agentChatResponse.text();
      const lines = responseText.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'token' && data.content) {
              agentResponse += data.content;
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      if (!agentResponse.trim()) {
        throw new Error('Empty response from agent');
      }

      console.log(`[Process Benchmark Job] Got response (${agentResponse.length} chars) in ${responseTimeMs}ms`);

    } catch (agentError) {
      const errorMessage = agentError instanceof Error ? agentError.message : 'Unknown agent error';
      console.error(`[Process Benchmark Job] Agent error:`, errorMessage);
      
      // Check if we should retry
      if (job.attempts + 1 < job.max_attempts) {
        await supabase
          .from('benchmark_jobs_queue')
          .update({
            status: 'pending',
            error_message: errorMessage
          })
          .eq('id', targetJobId);
        
        console.log(`[Process Benchmark Job] Job will retry (attempt ${job.attempts + 1}/${job.max_attempts})`);
        return new Response(JSON.stringify({ retry: true, attempt: job.attempts + 1 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      await markJobFailed(supabase, targetJobId, errorMessage);
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Step 5: Evaluate answer
    let evaluationResult = { correct: false, reason: 'Evaluation failed' };
    
    try {
      const evalResponse = await supabase.functions.invoke('evaluate-answer', {
        body: {
          question: question.question,
          agentResponse,
          groundTruths: [question.ground_truth],
          suiteCategory: question.suite_category
        }
      });

      if (evalResponse.data) {
        evaluationResult = evalResponse.data;
      }
    } catch (evalError) {
      console.error(`[Process Benchmark Job] Evaluation error:`, evalError);
      evaluationResult = { correct: false, reason: 'Evaluation failed: ' + String(evalError) };
    }

    // Step 6: Save to benchmark_results
    await supabase.from('benchmark_results').insert({
      run_id: job.run_id,
      question: question.question,
      ground_truth: question.ground_truth,
      agent_response: agentResponse,
      correct: evaluationResult.correct,
      reason: evaluationResult.reason,
      response_time_ms: responseTimeMs,
      status: 'completed',
      pdf_file: question.file_name,
      suite_category: question.suite_category
    });

    // Step 7: Mark job completed
    await supabase
      .from('benchmark_jobs_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          correct: evaluationResult.correct,
          reason: evaluationResult.reason,
          response_time_ms: responseTimeMs
        }
      })
      .eq('id', targetJobId);

    console.log(`[Process Benchmark Job] ✅ Job completed: ${evaluationResult.correct ? 'CORRECT' : 'INCORRECT'}`);

    return new Response(JSON.stringify({
      success: true,
      job_id: targetJobId,
      correct: evaluationResult.correct,
      response_time_ms: responseTimeMs
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`[Process Benchmark Job] Critical error:`, error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function markJobFailed(supabase: any, jobId: string, errorMessage: string) {
  await supabase
    .from('benchmark_jobs_queue')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq('id', jobId);
}
