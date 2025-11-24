import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LandingAIGroundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LandingAIGrounding {
  box: LandingAIGroundingBox;
  page: number;
}

interface LandingAIChunk {
  markdown: string;
  type: string;
  id: string;
  grounding?: LandingAIGrounding;
}

interface LandingAIJobResponse {
  job_id: string;
  status: string;
  data?: {
    chunks: LandingAIChunk[];
    metadata?: any;
  };
  metadata?: {
    filename: string;
    page_count: number;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
    if (!landingApiKey) {
      throw new Error('LANDING_AI_API_KEY not configured');
    }

    // Step 1: Get list of all jobs
    console.log('📋 Fetching list of Landing AI jobs...');
    const listResponse = await fetch(
      'https://api.va.landing.ai/v1/ade/parse/jobs?pageSize=100',
      { headers: { 'Authorization': `Bearer ${landingApiKey}` } }
    );

    if (!listResponse.ok) {
      throw new Error(`Failed to list jobs: ${listResponse.status}`);
    }

    const jobList = await listResponse.json();
    console.log('📋 Full jobList response:', JSON.stringify(jobList, null, 2));
    console.log(`📋 Found ${jobList.jobs?.length || 0} jobs`);

    // Step 2: Find job for AIRTOP MANUALE OPERATIVO.pdf
    const targetFilename = 'AIRTOP MANUALE OPERATIVO.pdf';
    let targetJobId: string | null = null;

    for (const job of jobList.jobs || []) {
      console.log(`🔍 Checking job ${job.job_id}...`);
      
      // Get job details to check filename
      const detailResponse = await fetch(
        `https://api.va.landing.ai/v1/ade/parse/jobs/${job.job_id}`,
        { headers: { 'Authorization': `Bearer ${landingApiKey}` } }
      );

      if (detailResponse.ok) {
        const detail: LandingAIJobResponse = await detailResponse.json();
        const filename = detail.metadata?.filename;
        
        console.log(`  Filename: ${filename}`);
        
        if (filename === targetFilename) {
          targetJobId = job.job_id;
          console.log(`✅ Found target job: ${targetJobId}`);
          break;
        }
      }
    }

    if (!targetJobId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Job for "${targetFilename}" not found`,
          jobsChecked: jobList.jobs?.length || 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Retrieve chunks using the new implementation logic
    console.log(`📥 Retrieving chunks from job ${targetJobId}...`);
    const jobResponse = await fetch(
      `https://api.va.landing.ai/v1/ade/parse/jobs/${targetJobId}`,
      { headers: { 'Authorization': `Bearer ${landingApiKey}` } }
    );

    if (!jobResponse.ok) {
      throw new Error(`Failed to get job: ${jobResponse.status}`);
    }

    const jobResult: LandingAIJobResponse = await jobResponse.json();

    // Extract chunks using NEW implementation
    const chunks = jobResult.data?.chunks;
    
    if (!chunks || !Array.isArray(chunks)) {
      throw new Error('No chunks array in response');
    }

    console.log(`📄 Retrieved ${chunks.length} raw chunks`);

    // Validate chunks (same logic as new retrieveJobChunks)
    const validChunks: LandingAIChunk[] = [];
    const invalidChunks: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (!chunk.markdown || typeof chunk.markdown !== 'string') {
        invalidChunks.push({ index: i, reason: 'missing/invalid markdown', chunk });
        continue;
      }
      
      if (!chunk.type || typeof chunk.type !== 'string') {
        invalidChunks.push({ index: i, reason: 'missing type', chunk });
        continue;
      }
      
      if (!chunk.id || typeof chunk.id !== 'string') {
        invalidChunks.push({ index: i, reason: 'missing id', chunk });
        continue;
      }
      
      validChunks.push(chunk);
    }

    // Return detailed test results
    return new Response(
      JSON.stringify({
        success: true,
        jobId: targetJobId,
        filename: jobResult.metadata?.filename,
        totalChunks: chunks.length,
        validChunks: validChunks.length,
        invalidChunks: invalidChunks.length,
        sampleValidChunks: validChunks.slice(0, 3).map(c => ({
          markdown_preview: c.markdown.substring(0, 100) + '...',
          type: c.type,
          id: c.id,
          has_grounding: !!c.grounding,
          page: c.grounding?.page
        })),
        invalidChunksDetails: invalidChunks,
        fullResponse: jobResult // Include full response for debugging
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Test failed:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
