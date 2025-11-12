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

    const { messages, systemPrompt, tools, agentId, conversationId } = await req.json();
    console.log('📨 Messages count:', messages.length);
    console.log('🔧 Tools provided:', tools ? 'Yes' : 'No');

    // Build messages array with system prompt
    const deepseekMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role,
        content: m.content
      }))
    ];

    console.log('🚀 Calling DeepSeek API with streaming...');
    
    const requestBody: any = {
      model: 'deepseek-chat',
      messages: deepseekMessages,
      temperature: 0.7,
      max_tokens: 4000,
      stream: true
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      console.log('🔧 Tools added to request:', tools.length);
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
        let toolCalls: any[] = [];

        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log('✅ DeepSeek stream complete. Total length:', fullMessage.length);
              
              // Handle tool calls if present
              if (toolCalls.length > 0) {
                console.log('🔧 Tool calls detected:', toolCalls.length);
                
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(toolCall.function.arguments);
                  
                  console.log(`🔧 Executing tool: ${functionName}`, functionArgs);
                  
                  if (functionName === 'search_and_acquire_pdfs') {
                    try {
                      const { data: toolResult, error: toolError } = await supabase.functions.invoke(
                        'search-and-acquire-pdfs',
                        {
                          body: {
                            agentId,
                            conversationId,
                            ...functionArgs
                          }
                        }
                      );

                      if (toolError) {
                        console.error('❌ Tool execution error:', toolError);
                        const errorMsg = `Errore nell'esecuzione dello strumento: ${toolError.message}`;
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ message: errorMsg, done: false })}\n\n`));
                      } else {
                        console.log('✅ Tool execution result:', toolResult);
                        
                        // Format and send tool result
                        let resultMessage = '';
                        if (toolResult.message) {
                          resultMessage = `\n\n${toolResult.message}`;
                        }
                        
                        if (toolResult.found_pdfs && toolResult.found_pdfs.length > 0) {
                          resultMessage += `\n\n📚 **PDF trovati:**\n`;
                          toolResult.found_pdfs.forEach((pdf: any, idx: number) => {
                            resultMessage += `\n${idx + 1}. **${pdf.title}**`;
                            if (pdf.url) resultMessage += `\n   🔗 ${pdf.url}`;
                            if (pdf.source) resultMessage += `\n   📍 Fonte: ${pdf.source}`;
                            resultMessage += '\n';
                          });
                          resultMessage += `\n💡 Vuoi scaricare qualche PDF? (es. "scarica il primo", "scarica tutti")`;
                        }
                        
                        if (resultMessage) {
                          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ message: resultMessage, done: false })}\n\n`));
                        }
                      }
                    } catch (error) {
                      console.error('❌ Tool execution failed:', error);
                      const errorMsg = `\n\nErrore nell'esecuzione dello strumento: ${error instanceof Error ? error.message : 'Unknown error'}`;
                      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ message: errorMsg, done: false })}\n\n`));
                    }
                  }
                }
              }
              
              // Send final message
              const finalData = JSON.stringify({ 
                message: fullMessage || '',
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
                
                // Check for tool calls
                if (parsed.choices && parsed.choices[0]?.delta?.tool_calls) {
                  const deltaToolCalls = parsed.choices[0].delta.tool_calls;
                  
                  for (const deltaToolCall of deltaToolCalls) {
                    if (!toolCalls[deltaToolCall.index]) {
                      toolCalls[deltaToolCall.index] = {
                        id: deltaToolCall.id,
                        type: 'function',
                        function: {
                          name: deltaToolCall.function?.name || '',
                          arguments: deltaToolCall.function?.arguments || ''
                        }
                      };
                    } else {
                      if (deltaToolCall.function?.arguments) {
                        toolCalls[deltaToolCall.index].function.arguments += deltaToolCall.function.arguments;
                      }
                    }
                  }
                }
                
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
