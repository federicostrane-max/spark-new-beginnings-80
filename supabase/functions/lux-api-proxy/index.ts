// ============================================================
// LUX API PROXY - Edge Function
// Proxies calls to OpenAGI Lux API to avoid CORS issues
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LuxApiRequest {
  image: string;      // Base64 encoded screenshot
  task: string;       // Task description
  model?: string;     // 'lux-actor-1' or 'lux-thinker-1'
  temperature?: number;
}

interface LuxAction {
  type: string;
  coordinate?: [number, number];
  text?: string;
  key?: string;
  direction?: string;
  scroll_amount?: number;
  duration_ms?: number;
  reason?: string;
}

interface LuxApiResponse {
  success: boolean;
  actions?: LuxAction[];
  is_done?: boolean;
  reasoning?: string;
  error?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LUX_API_KEY = Deno.env.get('LUX_API_KEY');
    if (!LUX_API_KEY) {
      console.error('❌ [LUX-PROXY] LUX_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'LUX_API_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const body: LuxApiRequest = await req.json();
    
    if (!body.image || !body.task) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: image, task' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const model = body.model || 'lux-actor-1';
    const temperature = body.temperature ?? 0.1;

    console.log(`🔮 [LUX-PROXY] Calling Lux API - model: ${model}, temp: ${temperature}`);
    console.log(`📋 [LUX-PROXY] Task: ${body.task.slice(0, 100)}...`);

    // Call OpenAGI Lux API
    const luxResponse = await fetch('https://api.agiopen.org/v1/act', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LUX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        image: body.image,
        task: body.task,
        temperature
      })
    });

    if (!luxResponse.ok) {
      const errorText = await luxResponse.text();
      console.error(`❌ [LUX-PROXY] API error: ${luxResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Lux API error: ${luxResponse.status}`,
          details: errorText
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: luxResponse.status }
      );
    }

    const luxData = await luxResponse.json();
    
    console.log(`✅ [LUX-PROXY] Response received:`);
    console.log(`   - Actions: ${luxData.actions?.length || 0}`);
    console.log(`   - is_done: ${luxData.is_done}`);
    if (luxData.reasoning) {
      console.log(`   - Reasoning: ${luxData.reasoning.slice(0, 100)}...`);
    }

    // Normalize response
    const response: LuxApiResponse = {
      success: true,
      actions: luxData.actions || [],
      is_done: luxData.is_done || false,
      reasoning: luxData.reasoning
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [LUX-PROXY] Exception:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
