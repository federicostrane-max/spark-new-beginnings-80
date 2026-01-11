// ============================================================
// Edge Function: tool-server-vision
// ============================================================
// Proxy per chiamate a Lux Actor API e Gemini Vision API.
// Usato dal frontend per localizzare elementi visivamente.
//
// Provider supportati:
// - lux: Lux Actor API (veloce ~1s, coordinate lux_sdk)
// - gemini: Gemini Vision API (lento ~3s, coordinate viewport)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface LuxRequest {
  provider: 'lux';
  image: string;
  task: string;
  model?: string;
}

interface GeminiRequest {
  provider: 'gemini';
  image: string;
  prompt: string;
}

interface VisionResponse {
  success: boolean;
  x?: number;
  y?: number;
  confidence?: number;
  reasoning?: string;
  action?: string;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// Main Handler
// ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`\n👁️ [${requestId}] tool-server-vision called`);

  try {
    const body = await req.json();
    const { provider } = body;

    if (!provider) {
      throw new Error('provider is required (lux or gemini)');
    }

    let result: VisionResponse;

    switch (provider) {
      case 'lux':
        result = await callLuxActor(body as LuxRequest, requestId);
        break;
      case 'gemini':
        result = await callGeminiVision(body as GeminiRequest, requestId);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}. Use 'lux' or 'gemini'.`);
    }

    console.log(`✅ [${requestId}] Result: ${result.success ? `(${result.x}, ${result.y})` : result.error}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`❌ [${requestId}] Error:`, error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ════════════════════════════════════════════════════════════
// LUX ACTOR API
// ════════════════════════════════════════════════════════════

async function callLuxActor(request: LuxRequest, requestId: string): Promise<VisionResponse> {
  const apiKey = Deno.env.get('LUX_API_KEY');
  if (!apiKey) {
    throw new Error('LUX_API_KEY not configured. Add it to Supabase secrets.');
  }

  const { image, task, model = 'lux-actor-1' } = request;

  if (!image) throw new Error('image (base64) is required');
  if (!task) throw new Error('task description is required');

  console.log(`🟠 [${requestId}] Lux Actor: "${task.substring(0, 50)}..."`);

  const startTime = Date.now();

  const response = await fetch('https://api.agiopen.org/v1/act', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image,
      task,
      model,
      temperature: 0,
    }),
  });

  const elapsed = Date.now() - startTime;
  console.log(`⏱️ [${requestId}] Lux response in ${elapsed}ms`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [${requestId}] Lux API error: ${response.status} - ${errorText}`);
    throw new Error(`Lux API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (typeof data.x !== 'number' || typeof data.y !== 'number') {
    console.warn(`⚠️ [${requestId}] Lux returned invalid coordinates:`, data);
    return {
      success: false,
      error: 'Lux did not return valid coordinates. Element may not be visible.',
    };
  }

  return {
    success: true,
    x: data.x,
    y: data.y,
    confidence: data.confidence || 1.0,
    action: data.action,
  };
}

// ════════════════════════════════════════════════════════════
// GEMINI VISION API
// ════════════════════════════════════════════════════════════

async function callGeminiVision(request: GeminiRequest, requestId: string): Promise<VisionResponse> {
  const apiKey = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
  if (!apiKey) {
    throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');
  }

  const { image, prompt } = request;

  if (!image) throw new Error('image (base64) is required');
  if (!prompt) throw new Error('prompt is required');

  console.log(`🔵 [${requestId}] Gemini Vision: "${prompt.substring(0, 50)}..."`);

  const startTime = Date.now();

  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/png',
              data: image,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
      },
    }),
  });

  const elapsed = Date.now() - startTime;
  console.log(`⏱️ [${requestId}] Gemini response in ${elapsed}ms`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [${requestId}] Gemini API error: ${response.status} - ${errorText}`);
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!text) {
    return {
      success: false,
      error: 'Gemini returned empty response',
    };
  }

  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    console.warn(`⚠️ [${requestId}] No JSON found in Gemini response: ${text.substring(0, 200)}`);
    return {
      success: false,
      error: 'Could not parse coordinates from Gemini response',
      reasoning: text,
    };
  }

  try {
    const coords = JSON.parse(jsonMatch[0]);

    if (typeof coords.x !== 'number' || typeof coords.y !== 'number') {
      return {
        success: false,
        error: 'Gemini returned invalid coordinates',
        reasoning: text,
      };
    }

    return {
      success: true,
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      confidence: coords.confidence || 0.8,
      reasoning: coords.reasoning || coords.explanation,
    };

  } catch (parseError) {
    console.error(`❌ [${requestId}] JSON parse error:`, parseError);
    return {
      success: false,
      error: 'Failed to parse JSON from Gemini response',
      reasoning: text,
    };
  }
}
