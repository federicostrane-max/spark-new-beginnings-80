// ============================================================
// Edge Function: tool-server-vision
// ============================================================
// Proxy per chiamate a Lux Actor API e Gemini Vision API.
// Usato dal frontend per localizzare elementi visivamente.
//
// Tool Server v8.4.1: Viewport = Lux SDK (1260×700, 1:1 mapping)
// L'Orchestrator riceve sempre coordinate viewport.
//
// Provider supportati:
// - lux: Lux Actor API (veloce ~1s, output 1260×700 = viewport diretto)
// - gemini: Gemini Vision API (lento ~3s, output 0-999 → convertito a viewport)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ────────────────────────────────────────────────────────────
// COORDINATE SYSTEM CONSTANTS
// ────────────────────────────────────────────────────────────
// Tool Server v8.4.1: viewport = lux_sdk (1:1 mapping)
// Lux API returns coordinates in 1260×700 space = viewport
// Gemini Computer Use returns normalized 0-999 coordinates
// ────────────────────────────────────────────────────────────
const LUX_SDK_WIDTH = 1260;
const LUX_SDK_HEIGHT = 700;
const DEFAULT_VIEWPORT_WIDTH = 1260;  // Aligned with Lux SDK & Tool Server v8.4.1
const DEFAULT_VIEWPORT_HEIGHT = 700;  // Aligned with Lux SDK & Tool Server v8.4.1

/**
 * Convert Lux SDK coordinates to viewport coordinates.
 * In v8.4.1: viewport = lux_sdk (1:1 mapping, no conversion needed).
 * This function is kept for API consistency but returns input unchanged.
 */
function luxToViewport(
  x: number,
  y: number,
  viewportWidth = DEFAULT_VIEWPORT_WIDTH,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT
): { x: number; y: number } {
  // v8.4.1: viewport = lux_sdk, 1:1 mapping
  // No conversion needed when dimensions match
  if (viewportWidth === LUX_SDK_WIDTH && viewportHeight === LUX_SDK_HEIGHT) {
    return { x, y };
  }
  // Fallback for custom viewport sizes
  return {
    x: Math.round(x * viewportWidth / LUX_SDK_WIDTH),
    y: Math.round(y * viewportHeight / LUX_SDK_HEIGHT),
  };
}

/**
 * Convert Gemini normalized coordinates (0-999) to viewport pixels.
 * Gemini 2.5 Computer Use outputs coords in 0-999 range.
 * Formula from orchestrator.ts: x / 1000 * VIEWPORT_WIDTH
 */
function normalizedToViewport(
  x: number,
  y: number,
  viewportWidth = DEFAULT_VIEWPORT_WIDTH,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT
): { x: number; y: number } {
  return {
    x: Math.round(x / 1000 * viewportWidth),
    y: Math.round(y / 1000 * viewportHeight),
  };
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface LuxRequest {
  provider: 'lux';
  image: string;
  task: string;
  model?: string;
  viewport_width?: number;   // For converting lux_sdk to viewport
  viewport_height?: number;  // For converting lux_sdk to viewport
}

interface GeminiRequest {
  provider: 'gemini';
  image: string;
  prompt: string;
  viewport_width?: number;   // For denormalizing Gemini coordinates
  viewport_height?: number;  // For denormalizing Gemini coordinates
}

interface VisionResponse {
  success: boolean;
  x?: number;                  // Final viewport coordinates
  y?: number;                  // Final viewport coordinates
  x_raw?: number;              // Raw coords before conversion
  y_raw?: number;              // Raw coords before conversion
  was_converted?: boolean;     // True if coords were converted to viewport
  confidence?: number;
  reasoning?: string;
  action?: string;
  error?: string;
  coordinate_system: 'viewport';  // Always viewport after conversion
  source_system?: 'lux_sdk' | 'normalized_0_999';  // Original coord system
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
      coordinate_system: 'viewport',
    };
  }

  // Raw Lux coordinates in lux_sdk space (1260x700)
  const rawX = data.x;
  const rawY = data.y;

  // Convert lux_sdk (1260×700) → viewport (1260×700) [1:1 in v8.4.1]
  const viewportWidth = request.viewport_width ?? DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = request.viewport_height ?? DEFAULT_VIEWPORT_HEIGHT;
  const converted = luxToViewport(rawX, rawY, viewportWidth, viewportHeight);

  console.log(`🔄 [${requestId}] Lux: lux_sdk(${rawX}, ${rawY}) → viewport(${converted.x}, ${converted.y})`);

  return {
    success: true,
    x: converted.x,
    y: converted.y,
    x_raw: rawX,
    y_raw: rawY,
    was_converted: true,
    confidence: data.confidence || 1.0,
    action: data.action,
    coordinate_system: 'viewport',
    source_system: 'lux_sdk',
  };
}

// ════════════════════════════════════════════════════════════
// GEMINI VISION API (Computer Use Model)
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

  // Use Gemini 2.5 Computer Use model - outputs normalized 0-999 coordinates
  const model = 'gemini-2.5-computer-use-preview-10-2025';
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
      coordinate_system: 'viewport',
    };
  }

  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    console.warn(`⚠️ [${requestId}] No JSON found in Gemini response: ${text.substring(0, 200)}`);
    return {
      success: false,
      error: 'Could not parse coordinates from Gemini response',
      reasoning: text,
      coordinate_system: 'viewport',
    };
  }

  try {
    const coords = JSON.parse(jsonMatch[0]);

    if (typeof coords.x !== 'number' || typeof coords.y !== 'number') {
      return {
        success: false,
        error: 'Gemini returned invalid coordinates',
        reasoning: text,
        coordinate_system: 'viewport',
      };
    }

    // Gemini Computer Use ALWAYS returns normalized 0-999 coordinates
    const rawX = Math.round(coords.x);
    const rawY = Math.round(coords.y);

    // Convert normalized (0-999) → viewport pixels
    const viewportWidth = request.viewport_width ?? DEFAULT_VIEWPORT_WIDTH;
    const viewportHeight = request.viewport_height ?? DEFAULT_VIEWPORT_HEIGHT;
    const converted = normalizedToViewport(rawX, rawY, viewportWidth, viewportHeight);

    console.log(`🔄 [${requestId}] Gemini: normalized(${rawX}, ${rawY}) → viewport(${converted.x}, ${converted.y})`);

    return {
      success: true,
      x: converted.x,
      y: converted.y,
      x_raw: rawX,
      y_raw: rawY,
      was_converted: true,
      confidence: coords.confidence || 0.8,
      reasoning: coords.reasoning || coords.explanation,
      coordinate_system: 'viewport',
      source_system: 'normalized_0_999',
    };

  } catch (parseError) {
    console.error(`❌ [${requestId}] JSON parse error:`, parseError);
    return {
      success: false,
      error: 'Failed to parse JSON from Gemini response',
      reasoning: text,
      coordinate_system: 'viewport',
    };
  }
}
