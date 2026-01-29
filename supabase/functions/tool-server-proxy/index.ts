// ============================================================
// TOOL SERVER PROXY - Edge Function
// Proxies requests from Web App to user's local Tool Server via ngrok
// This solves CORS and Mixed Content issues when calling Tool Server from HTTPS web app
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tool-token',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
};

interface ProxyRequest {
  endpoint: string;           // Tool Server endpoint (e.g., "/status", "/browser/start")
  method?: string;            // HTTP method (default: GET)
  body?: any;                 // Request body for POST/PUT/PATCH
  ngrok_url?: string;         // Optional: override ngrok URL
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Parse request body
    const proxyReq: ProxyRequest = await req.json();

    if (!proxyReq.endpoint) {
      return new Response(
        JSON.stringify({ error: 'Missing endpoint parameter' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Get Tool Server config (ngrok URL) from pairing
    const { data: pairingData, error: pairingError} = await supabase
      .from('tool_server_pairing')
      .select('ngrok_url')
      .eq('user_id', user.id)
      .single();

    if (pairingError || !pairingData?.ngrok_url) {
      return new Response(
        JSON.stringify({
          error: 'Tool Server not paired. Please configure Tool Server in settings.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    const toolServerUrl = proxyReq.ngrok_url || pairingData.ngrok_url;

    // Build full URL
    const fullUrl = `${toolServerUrl}${proxyReq.endpoint}`;

    console.log(`🔄 [TOOL-SERVER-PROXY] ${proxyReq.method || 'GET'} ${fullUrl}`);

    // Prepare headers
    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };

    // Forward security token from request header if provided
    const requestToken = req.headers.get('X-Tool-Token');
    if (requestToken) {
      proxyHeaders['X-Tool-Token'] = requestToken;
    }

    // Make request to Tool Server
    const fetchOptions: RequestInit = {
      method: proxyReq.method || 'GET',
      headers: proxyHeaders,
    };

    if (proxyReq.body && (proxyReq.method === 'POST' || proxyReq.method === 'PUT' || proxyReq.method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(proxyReq.body);
    }

    const toolServerResponse = await fetch(fullUrl, fetchOptions);

    // Forward Tool Server response
    const responseBody = await toolServerResponse.text();

    console.log(`✅ [TOOL-SERVER-PROXY] Response: ${toolServerResponse.status}`);

    return new Response(
      responseBody,
      {
        headers: {
          ...corsHeaders,
          'Content-Type': toolServerResponse.headers.get('Content-Type') || 'application/json',
        },
        status: toolServerResponse.status,
      }
    );

  } catch (error) {
    console.error('❌ [TOOL-SERVER-PROXY] Exception:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
