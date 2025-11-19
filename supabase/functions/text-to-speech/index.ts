import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Voice mapping: common names to ElevenLabs voice IDs
const VOICE_MAP: Record<string, string> = {
  'alloy': '9BWtsMINqrJLrRacOk9x', // Aria
  'echo': 'TX3LPaxmHKxFdv7VOQHJ', // Liam
  'fable': 'XB0fDUnXU5powFXDhCwa', // Charlotte
  'onyx': 'bIHbv24MWmeRgasZH58o', // Will
  'nova': 'EXAVITQu4vr4xnSDxMaL', // Sarah
  'shimmer': 'pFZP5JQG7iQjIQuC4Bku', // Lily
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voice = 'alloy' } = await req.json();
    
    if (!text) {
      throw new Error('No text provided');
    }

    // ElevenLabs has a 5000 character limit for free tier
    const MAX_TTS_LENGTH = 4500;
    let processedText = text;
    
    if (text.length > MAX_TTS_LENGTH) {
      console.log(`Text too long (${text.length} chars), truncating to ${MAX_TTS_LENGTH}`);
      processedText = text.substring(0, MAX_TTS_LENGTH) + '...';
    }

    const elevenLabsApiKey = Deno.env.get('ELEVEN_LABS_API_KEY');
    if (!elevenLabsApiKey) {
      throw new Error('ELEVEN_LABS_API_KEY not configured');
    }

    // Map voice name to ElevenLabs voice ID
    const voiceId = VOICE_MAP[voice] || VOICE_MAP['alloy'];
    
    console.log('Generating speech with ElevenLabs voice:', voice, `-> ${voiceId} (${processedText.length} chars)`);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: processedText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs TTS error:', error);
      throw new Error(`ElevenLabs TTS error: ${error}`);
    }

    console.log('Speech generated successfully, streaming response');

    // Stream the audio directly
    return new Response(response.body, {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline'
      }
    });

  } catch (error) {
    console.error('Error in text-to-speech:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
