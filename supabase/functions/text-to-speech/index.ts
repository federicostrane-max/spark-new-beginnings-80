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
    const { text, voice = 'alloy' } = await req.json();
    
    if (!text) {
      throw new Error('No text provided');
    }

    // OpenAI TTS has a 4096 character limit
    const MAX_TTS_LENGTH = 4000; // Leave some buffer
    let processedText = text;
    
    if (text.length > MAX_TTS_LENGTH) {
      console.log(`Text too long (${text.length} chars), truncating to ${MAX_TTS_LENGTH}`);
      processedText = text.substring(0, MAX_TTS_LENGTH) + '...';
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    // OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer
    // Default to 'alloy' if not specified
    const voiceName = voice || 'alloy';
    
    console.log('Generating speech with OpenAI voice:', voiceName, `(${processedText.length} chars)`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: processedText,
        voice: voiceName,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI TTS error:', error);
      throw new Error(`OpenAI TTS error: ${error}`);
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
