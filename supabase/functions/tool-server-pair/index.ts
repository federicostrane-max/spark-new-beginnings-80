// ============================================================
// Edge Function: tool-server-pair
// ============================================================
// Sistema di pairing one-time tra Web App e Desktop Tool Server.
//
// Actions:
// - generate: Genera codice 6 caratteri (richiede auth)
// - validate: Valida codice e crea config (no auth, chiamato da Desktop)
// - update_url: Aggiorna ngrok URL (no auth, chiamato da Desktop)
// - disconnect: Rimuove pairing (richiede auth)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Caratteri per generare token (esclusi caratteri ambigui: 0,O,I,1,L)
const TOKEN_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 6;
const TOKEN_EXPIRY_MINUTES = 10;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface GenerateRequest {
  action: 'generate';
}

interface ValidateRequest {
  action: 'validate';
  token: string;
  device_name?: string;
  ngrok_url?: string;
}

interface UpdateUrlRequest {
  action: 'update_url';
  user_id: string;
  device_secret: string;
  ngrok_url: string;
}

interface DisconnectRequest {
  action: 'disconnect';
}

interface GetConfigRequest {
  action: 'get_config';
}

interface CreateAutoPairCredentialsRequest {
  action: 'create_auto_pair_credentials';
}

type RequestBody = GenerateRequest | ValidateRequest | UpdateUrlRequest | DisconnectRequest | GetConfigRequest | CreateAutoPairCredentialsRequest;

// ────────────────────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────────────────────

function generateToken(): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_CHARS.charAt(Math.floor(Math.random() * TOKEN_CHARS.length));
  }
  return token;
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

function getAuthClient(authHeader: string | null) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader || '' } }
  });
}

// ────────────────────────────────────────────────────────────
// Action Handlers
// ────────────────────────────────────────────────────────────

async function handleGenerate(userId: string): Promise<Response> {
  const supabase = getSupabaseClient();

  // Delete any existing unused tokens for this user
  await supabase
    .from('tool_server_pairing_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('used', false);

  // Generate unique token
  let token = generateToken();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const { error } = await supabase
      .from('tool_server_pairing_tokens')
      .insert({
        user_id: userId,
        token: token,
        used: false,
      });

    if (!error) break;

    if (error.code === '23505') { // Unique violation
      token = generateToken();
      attempts++;
    } else {
      throw new Error(`Failed to create token: ${error.message}`);
    }
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique token');
  }

  console.log(`[PAIR] Generated token for user ${userId}: ${token}`);

  return new Response(JSON.stringify({
    success: true,
    token: token,
    expires_in_seconds: TOKEN_EXPIRY_MINUTES * 60,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleValidate(body: ValidateRequest): Promise<Response> {
  const supabase = getSupabaseClient();
  const { token, device_name, ngrok_url } = body;

  if (!token || token.length !== TOKEN_LENGTH) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid token format',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Find valid token (not used, not expired)
  const { data: tokenData, error: tokenError } = await supabase
    .from('tool_server_pairing_tokens')
    .select('*')
    .eq('token', token.toUpperCase())
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (tokenError || !tokenData) {
    console.log(`[PAIR] Token validation failed: ${token}`);
    return new Response(JSON.stringify({
      success: false,
      error: 'Token invalid or expired',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Mark token as used
  await supabase
    .from('tool_server_pairing_tokens')
    .update({ used: true })
    .eq('id', tokenData.id);

  // Check if config already exists
  const { data: existingConfig } = await supabase
    .from('tool_server_config')
    .select('*')
    .eq('user_id', tokenData.user_id)
    .single();

  let config;

  if (existingConfig) {
    // Update existing config
    const { data, error } = await supabase
      .from('tool_server_config')
      .update({
        device_name: device_name || existingConfig.device_name,
        ngrok_url: ngrok_url || existingConfig.ngrok_url,
        device_secret: crypto.randomUUID(), // Regenerate secret on re-pair
        paired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', tokenData.user_id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update config: ${error.message}`);
    config = data;
  } else {
    // Create new config
    const { data, error } = await supabase
      .from('tool_server_config')
      .insert({
        user_id: tokenData.user_id,
        device_name: device_name || 'Desktop',
        ngrok_url: ngrok_url || null,
        device_secret: crypto.randomUUID(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create config: ${error.message}`);
    config = data;
  }

  console.log(`[PAIR] Pairing successful for user ${tokenData.user_id}`);

  // Return config with Supabase credentials for Desktop App
  return new Response(JSON.stringify({
    success: true,
    user_id: tokenData.user_id,
    device_secret: config.device_secret,
    supabase_url: Deno.env.get('SUPABASE_URL'),
    supabase_anon_key: Deno.env.get('SUPABASE_ANON_KEY'),
    function_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/tool-server-pair`,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleUpdateUrl(body: UpdateUrlRequest): Promise<Response> {
  const supabase = getSupabaseClient();
  const { user_id, device_secret, ngrok_url } = body;

  if (!user_id || !device_secret || !ngrok_url) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Missing required fields: user_id, device_secret, ngrok_url',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify device_secret matches
  const { data: config, error: configError } = await supabase
    .from('tool_server_config')
    .select('*')
    .eq('user_id', user_id)
    .eq('device_secret', device_secret)
    .single();

  if (configError || !config) {
    console.log(`[PAIR] Update URL failed: invalid credentials for user ${user_id}`);
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid credentials or pairing revoked',
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update URL
  const { error: updateError } = await supabase
    .from('tool_server_config')
    .update({
      ngrok_url: ngrok_url,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user_id);

  if (updateError) {
    throw new Error(`Failed to update URL: ${updateError.message}`);
  }

  console.log(`[PAIR] URL updated for user ${user_id}: ${ngrok_url}`);

  return new Response(JSON.stringify({
    success: true,
    ngrok_url: ngrok_url,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleDisconnect(userId: string): Promise<Response> {
  const supabase = getSupabaseClient();

  // Delete config (will trigger Realtime event)
  const { error } = await supabase
    .from('tool_server_config')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to disconnect: ${error.message}`);
  }

  console.log(`[PAIR] Disconnected user ${userId}`);

  return new Response(JSON.stringify({
    success: true,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleGetConfig(userId: string): Promise<Response> {
  const supabase = getSupabaseClient();

  const { data: config, error } = await supabase
    .from('tool_server_config')
    .select('user_id, ngrok_url, device_name, paired_at, updated_at')
    .eq('user_id', userId)
    .single();

  if (error || !config) {
    return new Response(JSON.stringify({
      success: true,
      paired: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    paired: true,
    config: config,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// v10.3.0: Auto-pairing - crea credenziali direttamente per il Tool Server
async function handleCreateAutoPairCredentials(userId: string): Promise<Response> {
  const supabase = getSupabaseClient();

  // Check if config already exists
  const { data: existingConfig } = await supabase
    .from('tool_server_config')
    .select('*')
    .eq('user_id', userId)
    .single();

  let config;

  if (existingConfig) {
    // Update existing config with new device_secret
    const { data, error } = await supabase
      .from('tool_server_config')
      .update({
        device_secret: crypto.randomUUID(),
        device_name: 'Desktop (Auto)',
        paired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update config: ${error.message}`);
    config = data;
  } else {
    // Create new config
    const { data, error } = await supabase
      .from('tool_server_config')
      .insert({
        user_id: userId,
        device_name: 'Desktop (Auto)',
        device_secret: crypto.randomUUID(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create config: ${error.message}`);
    config = data;
  }

  console.log(`[PAIR] Auto-pair credentials created for user ${userId}`);

  // Return credentials for Tool Server
  return new Response(JSON.stringify({
    success: true,
    user_id: userId,
    device_secret: config.device_secret,
    supabase_url: Deno.env.get('SUPABASE_URL'),
    function_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/tool-server-pair`,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ────────────────────────────────────────────────────────────
// Main Handler
// ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const action = body.action;

    console.log(`[PAIR] Action: ${action}`);

    // Actions that DON'T require auth
    if (action === 'validate') {
      return await handleValidate(body as ValidateRequest);
    }

    if (action === 'update_url') {
      return await handleUpdateUrl(body as UpdateUrlRequest);
    }

    // Actions that REQUIRE auth
    const authHeader = req.headers.get('Authorization');
    const authClient = getAuthClient(authHeader);
    const { data: { user }, error: userError } = await authClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication required',
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    switch (action) {
      case 'generate':
        return await handleGenerate(user.id);

      case 'disconnect':
        return await handleDisconnect(user.id);

      case 'get_config':
        return await handleGetConfig(user.id);

      case 'create_auto_pair_credentials':
        return await handleCreateAutoPairCredentials(user.id);

      default:
        return new Response(JSON.stringify({
          success: false,
          error: `Unknown action: ${action}`,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error('[PAIR] Error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
