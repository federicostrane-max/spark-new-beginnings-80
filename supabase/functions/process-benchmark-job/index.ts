import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BENCHMARK_AGENT_SLUG = 'book-serach-expert';
const BENCHMARK_USER_ID = '00000000-0000-0000-0000-000000000001';
const BATCH_SIZE = 5; // Process up to 5 jobs per invocation

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
    
    // Single job mode (explicit job_id provided)
    if (job_id && !fallback_mode) {
      console.log(`[Process Benchmark Job] Single job mode: ${job_id}`);
      const result = await processJob(supabase, supabaseUrl, supabaseServiceKey, job_id);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Batch mode: pick up to BATCH_SIZE pending jobs
    const { data: pendingJobs } = await supabase
      .from('benchmark_jobs_queue')
      .select('id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);
    
    if (!pendingJobs || pendingJobs.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'No pending jobs' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`[Process Benchmark Job] Batch mode: processing ${pendingJobs.length} jobs`);
    
    // Process each job sequentially within this invocation
    const results: any[] = [];
    for (const job of pendingJobs) {
      try {
        const result = await processJob(supabase, supabaseUrl, supabaseServiceKey, job.id);
        results.push({ job_id: job.id, ...result });
      } catch (jobError) {
        console.error(`[Process Benchmark Job] Error processing job ${job.id}:`, jobError);
        results.push({ job_id: job.id, error: String(jobError) });
      }
    }
    
    const completed = results.filter(r => r.success).length;
    const failed = results.filter(r => r.error).length;
    console.log(`[Process Benchmark Job] Batch complete: ${completed} success, ${failed} failed`);

    // SELF-CONTINUATION: Check for more pending jobs and trigger next batch
    const { count: remainingCount } = await supabase
      .from('benchmark_jobs_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (remainingCount && remainingCount > 0) {
      console.log(`[Process Benchmark Job] 🔄 ${remainingCount} jobs remaining - triggering self-continuation`);
      
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      
      const triggerNext = async () => {
        try {
          await fetch(`${supabaseUrl}/functions/v1/process-benchmark-job`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${anonKey}`
            },
            body: JSON.stringify({ fallback_mode: true })
          });
        } catch (err) {
          console.error(`[Process Benchmark Job] Self-continuation error:`, err);
        }
      };

      // Fire and forget
      (globalThis as any).EdgeRuntime?.waitUntil?.(triggerNext()) || triggerNext();
    } else {
      console.log(`[Process Benchmark Job] ✅ All jobs processed - no continuation needed`);
    }

    return new Response(JSON.stringify({
      batch: true,
      processed: results.length,
      completed,
      failed,
      remaining: remainingCount || 0,
      results
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

async function processJob(
  supabase: any, 
  supabaseUrl: string, 
  supabaseServiceKey: string, 
  targetJobId: string
): Promise<any> {
  console.log(`[Process Benchmark Job] Starting job: ${targetJobId}`);

  // Step 1: Fetch job with pessimistic locking pattern
  const { data: job, error: fetchError } = await supabase
    .from('benchmark_jobs_queue')
    .select('*, benchmark_datasets(*)')
    .eq('id', targetJobId)
    .eq('status', 'pending')
    .single();

  if (fetchError || !job) {
    console.log(`[Process Benchmark Job] Job ${targetJobId} not found or not pending - skipping`);
    return { skipped: true, reason: 'Job not pending or not found' };
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
    return { error: 'Failed to acquire job lock' };
  }

  const question = job.benchmark_datasets;
  if (!question) {
    await markJobFailed(supabase, targetJobId, 'Question data not found');
    return { error: 'Question not found' };
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

    // Parse JSON response (stream: false returns JSON, not SSE)
    const responseData = await agentChatResponse.json();
    
    if (responseData.response) {
      agentResponse = responseData.response;
    } else if (responseData.error) {
      throw new Error(`Agent error: ${responseData.error}`);
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
      return { retry: true, attempt: job.attempts + 1 };
    }
    
    await markJobFailed(supabase, targetJobId, errorMessage);
    return { error: errorMessage };
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

  return {
    success: true,
    job_id: targetJobId,
    correct: evaluationResult.correct,
    response_time_ms: responseTimeMs
  };
}

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
