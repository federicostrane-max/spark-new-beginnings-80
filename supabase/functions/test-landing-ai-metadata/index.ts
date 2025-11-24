import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
    if (!landingApiKey) {
      throw new Error('LANDING_AI_API_KEY not configured');
    }

    const results = {
      test_timestamp: new Date().toISOString(),
      jobs_list: null as any,
      job_detail: null as any,
    };

    // Test 1: GET /v1/ade/parse/jobs - Lista di tutti i job
    console.log('🔍 Test 1: Fetching jobs list...');
    const jobsListResponse = await fetch('https://api.va.landing.ai/v1/ade/parse/jobs', {
      headers: { 'Authorization': `Bearer ${landingApiKey}` },
    });

    if (jobsListResponse.ok) {
      results.jobs_list = await jobsListResponse.json();
      console.log('✓ Jobs list retrieved:', {
        totalJobs: results.jobs_list?.jobs?.length || 0,
        sampleJob: results.jobs_list?.jobs?.[0] || null,
      });
    } else {
      results.jobs_list = {
        error: `HTTP ${jobsListResponse.status}`,
        message: await jobsListResponse.text(),
      };
    }

    // Test 2: GET /v1/ade/jobs/{job_id} - Dettagli di un job specifico
    const sampleJobId = results.jobs_list?.jobs?.[0]?.job_id;
    if (sampleJobId) {
      console.log(`🔍 Test 2: Fetching job detail for: ${sampleJobId}`);
      const jobDetailResponse = await fetch(
        `https://api.va.landing.ai/v1/ade/jobs/${sampleJobId}`,
        { headers: { 'Authorization': `Bearer ${landingApiKey}` } }
      );

      if (jobDetailResponse.ok) {
        results.job_detail = await jobDetailResponse.json();
        console.log('✓ Job detail retrieved:', {
          status: results.job_detail?.status,
          hasResult: !!results.job_detail?.result,
          topLevelKeys: Object.keys(results.job_detail || {}),
        });
      } else {
        results.job_detail = {
          error: `HTTP ${jobDetailResponse.status}`,
          message: await jobDetailResponse.text(),
        };
      }
    } else {
      results.job_detail = { message: 'No jobs available to test detail endpoint' };
    }

    // Analisi metadata
    console.log('\n📊 ANALISI METADATA:');
    console.log('1. Jobs List Endpoint (/v1/ade/parse/jobs):');
    if (results.jobs_list?.jobs) {
      const firstJob = results.jobs_list.jobs[0];
      console.log('   Fields per job:', Object.keys(firstJob));
      console.log('   Has filename?', 'filename' in firstJob);
      console.log('   Has document_url?', 'document_url' in firstJob);
      console.log('   Has metadata?', 'metadata' in firstJob);
    }

    console.log('\n2. Job Detail Endpoint (/v1/ade/jobs/{job_id}):');
    if (results.job_detail && !results.job_detail.error) {
      console.log('   Top-level fields:', Object.keys(results.job_detail));
      console.log('   Has filename?', 'filename' in results.job_detail);
      console.log('   Has result.metadata?', 'result' in results.job_detail && 'metadata' in (results.job_detail.result || {}));
    }

    return new Response(
      JSON.stringify(results, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Test Landing AI Metadata error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
