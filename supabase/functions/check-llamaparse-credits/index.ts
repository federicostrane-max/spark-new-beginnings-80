import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkCreditsBalance, estimateCreditsNeeded, validateCreditsBeforeProcessing } from "../_shared/llamaParseClient.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Edge Function: Check LlamaParse Credits
 * 
 * Returns current credit balance and validates if a specific job can be processed.
 * 
 * Query params:
 * - pages: Number of pages to validate (optional)
 * - mode: Extraction mode - 'basic', 'premium', 'multimodal' (default: 'basic')
 * 
 * Response:
 * - credits_remaining: Current credit balance
 * - credits_used: Credits used this period
 * - period_start/end: Billing period dates
 * - validation (if pages provided): Whether the job can be processed
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('LLAMA_CLOUD_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'LLAMA_CLOUD_API_KEY not configured',
          message: 'LlamaParse API key is not set. Please configure it in your environment.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body or query params
    let pages: number | undefined;
    let mode: 'basic' | 'premium' | 'multimodal' = 'basic';

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      pages = body.pages;
      mode = body.mode || 'basic';
    } else {
      const url = new URL(req.url);
      const pagesParam = url.searchParams.get('pages');
      pages = pagesParam ? parseInt(pagesParam, 10) : undefined;
      mode = (url.searchParams.get('mode') as any) || 'basic';
    }

    // Fetch current credit balance
    const usage = await checkCreditsBalance(apiKey);
    
    const response: any = {
      success: true,
      credits_remaining: usage.credits_remaining,
      credits_used: usage.total_credits_used,
      period_start: usage.period_start,
      period_end: usage.period_end,
      plan: usage.plan_name || 'unknown',
      breakdown: usage.breakdown
    };

    // If pages provided, validate if job can be processed
    if (pages && pages > 0) {
      const estimatedCredits = estimateCreditsNeeded(pages, mode);
      
      try {
        const validation = await validateCreditsBeforeProcessing(apiKey, estimatedCredits);
        response.validation = {
          can_process: true,
          estimated_credits: estimatedCredits,
          credits_after_job: validation.remaining - estimatedCredits,
          warning: validation.warning,
          mode: mode
        };
      } catch (validationError: any) {
        if (validationError.code === 'INSUFFICIENT_CREDITS') {
          response.validation = {
            can_process: false,
            estimated_credits: estimatedCredits,
            credits_needed: estimatedCredits,
            credits_available: validationError.remaining,
            shortfall: estimatedCredits - validationError.remaining,
            mode: mode,
            message: `Insufficient credits: need ${estimatedCredits}, have ${validationError.remaining}`
          };
        } else {
          throw validationError;
        }
      }
    }

    // Add credit tier reference
    response.credit_reference = {
      basic: '2 credits/page (Fast + layout)',
      premium: '4 credits/page (Cost Effective + layout)',
      multimodal: '11 credits/page (Agentic + layout)',
      note: 'Agentic mode recommended for complex documents with tables/charts'
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Check LlamaParse Credits] Error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        hint: 'Check if LLAMA_CLOUD_API_KEY is valid and LlamaCloud service is available'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
