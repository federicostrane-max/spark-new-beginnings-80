import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

Deno.serve(async (req) => {
  console.log('=== DEEPSEEK CHAT REQUEST RECEIVED ===');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    const { messages, systemPrompt } = await req.json();
    console.log('📨 Messages count:', messages.length);

    // Build messages array with system prompt
    const deepseekMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role,
        content: m.content
      }))
    ];

    console.log('🚀 Calling DeepSeek API with streaming...');
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner', // DeepSeek-R1 for best reasoning
        messages: deepseekMessages,
        temperature: 0.7,
        max_tokens: 4000,
        stream: true // Enable streaming
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ DeepSeek API Error:', response.status, errorText);
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    console.log('✅ DeepSeek streaming started');

    // Create a TransformStream to handle SSE formatting
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullMessage = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log('✅ DeepSeek stream complete. Total length:', fullMessage.length);
              
              // Send final message with usage stats
              const finalData = JSON.stringify({ 
                message: fullMessage,
                done: true
              });
              controller.enqueue(new TextEncoder().encode(`data: ${finalData}\n\n`));
              controller.close();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || line.startsWith(':')) continue;
              if (!line.startsWith('data: ')) continue;

              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                
                // Extract content delta from DeepSeek response
                if (parsed.choices && parsed.choices[0]?.delta?.content) {
                  const chunk = parsed.choices[0].delta.content;
                  fullMessage += chunk;
                  
                  // Forward the chunk to client
                  const chunkData = JSON.stringify({ 
                    message: chunk,
                    done: false
                  });
                  controller.enqueue(new TextEncoder().encode(`data: ${chunkData}\n\n`));
                }
              } catch (e) {
                console.error('Error parsing DeepSeek chunk:', e);
              }
            }
          }
        } catch (error) {
          console.error('❌ DeepSeek streaming error:', error);
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
    });

  } catch (error) {
    console.error('❌ Error in deepseek-chat:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
