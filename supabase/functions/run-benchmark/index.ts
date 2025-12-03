import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BENCHMARK_AGENT_ID = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c';
const BENCHMARK_USER_ID = 'benchmark-system-user';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { suite = 'financebench', limit = 50 } = await req.json().catch(() => ({}));
    
    const runId = crypto.randomUUID();
    console.log(`[Run Benchmark] 🚀 Starting server-side benchmark run: ${runId}`);
    console.log(`[Run Benchmark] Suite: ${suite}, Limit: ${limit}`);

    // 1. Fetch benchmark questions
    const { data: questions, error: questionsError } = await supabase
      .from('benchmark_datasets')
      .select('*')
      .eq('suite_category', suite)
      .eq('is_active', true)
      .limit(limit);

    if (questionsError) throw questionsError;
    if (!questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No questions found for suite', suite }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Run Benchmark] Found ${questions.length} questions to process`);

    const results = {
      runId,
      total: questions.length,
      completed: 0,
      correct: 0,
      failed: 0,
      errors: [] as string[]
    };

    // 2. Process each question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const fileName = q.file_name;
      const question = `Regarding document '${fileName}': ${q.question}`;
      
      console.log(`[Run Benchmark] Processing ${i + 1}/${questions.length}: ${fileName}`);

      try {
        // Check document exists
        const { data: docs } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id, status')
          .eq('file_name', fileName)
          .eq('status', 'ready')
          .order('created_at', { ascending: false })
          .limit(1);

        if (!docs || docs.length === 0) {
          console.warn(`[Run Benchmark] ⚠️ Document not ready: ${fileName}`);
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question: q.question,
            ground_truth: q.ground_truth,
            status: 'missing',
            error: 'Document not found or not ready',
            suite_category: suite
          });
          results.failed++;
          continue;
        }

        // Generate unique conversation ID for isolation
        const conversationId = crypto.randomUUID();
        const startTime = Date.now();

        // Call agent-chat with serverUserId for server-to-server authentication
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        
        const agentChatResponse = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`
          },
          body: JSON.stringify({
            agentSlug: 'book-serach-expert',
            message: question,
            conversationId,
            stream: false,
            serverUserId: BENCHMARK_USER_ID
          })
        });

        if (!agentChatResponse.ok) {
          const errorText = await agentChatResponse.text();
          throw new Error(`agent-chat error ${agentChatResponse.status}: ${errorText.slice(0, 200)}`);
        }

        const agentData = await agentChatResponse.json();

        const agentResponse = agentData?.response || agentData?.message || '';
        const responseTimeMs = Date.now() - startTime;

        if (!agentResponse) {
          console.error(`[Run Benchmark] ❌ Empty response for ${fileName}`);
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question: q.question,
            ground_truth: q.ground_truth,
            status: 'failed',
            error: 'Agent returned empty response',
            response_time_ms: responseTimeMs,
            suite_category: suite
          });
          results.failed++;
          continue;
        }

        // Evaluate answer using LLM Judge
        const { data: evaluation, error: evalError } = await supabase.functions.invoke('evaluate-answer', {
          body: {
            question: q.question,
            agentResponse,
            groundTruths: [q.ground_truth],
            suiteCategory: suite
          }
        });

        if (evalError) throw evalError;

        const isCorrect = evaluation?.correct === true;

        await supabase.from('benchmark_results').insert({
          run_id: runId,
          pdf_file: fileName,
          question: q.question,
          ground_truth: q.ground_truth,
          agent_response: agentResponse,
          correct: isCorrect,
          reason: evaluation?.reason || '',
          response_time_ms: responseTimeMs,
          status: 'completed',
          suite_category: suite
        });

        results.completed++;
        if (isCorrect) results.correct++;
        
        console.log(`[Run Benchmark] ✅ ${fileName}: ${isCorrect ? 'CORRECT' : 'INCORRECT'} (${responseTimeMs}ms)`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Run Benchmark] ❌ Error processing ${fileName}:`, errorMsg);
        
        await supabase.from('benchmark_results').insert({
          run_id: runId,
          pdf_file: fileName,
          question: q.question,
          ground_truth: q.ground_truth,
          status: 'error',
          error: errorMsg,
          suite_category: suite
        });
        
        results.failed++;
        results.errors.push(`${fileName}: ${errorMsg}`);
      }
    }

    const accuracy = results.completed > 0 
      ? ((results.correct / results.completed) * 100).toFixed(1)
      : '0';

    console.log(`[Run Benchmark] 🎉 Benchmark complete!`);
    console.log(`[Run Benchmark] Results: ${results.correct}/${results.completed} correct (${accuracy}%)`);
    console.log(`[Run Benchmark] Failed: ${results.failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        runId,
        summary: {
          total: results.total,
          completed: results.completed,
          correct: results.correct,
          failed: results.failed,
          accuracy: `${accuracy}%`
        },
        errors: results.errors
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Run Benchmark] Critical error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
