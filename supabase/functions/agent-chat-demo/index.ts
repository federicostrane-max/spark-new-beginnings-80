import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: {
    question: string;
    consulted_agent_slug: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { messages, agentSlug } = await req.json();

    console.log('Demo chat for agent:', agentSlug);

    // Get agent details
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('slug', agentSlug)
      .eq('active', true)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    // Get other agents for tool calling
    const { data: otherAgents } = await supabase
      .from('agents')
      .select('slug, name, description')
      .eq('active', true)
      .neq('id', agent.id);

    const tools = otherAgents?.map(a => ({
      name: `consult_${a.slug.replace(/-/g, '_')}`,
      description: `Consult with ${a.name}: ${a.description}`,
      input_schema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The specific question to ask this expert agent"
          },
          consulted_agent_slug: {
            type: "string",
            const: a.slug,
            description: "The slug of the agent being consulted"
          }
        },
        required: ["question", "consulted_agent_slug"]
      }
    })) || [];

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Start streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        const sendSSE = (data: string) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        try {
          let fullResponse = '';
          let toolCalls: ToolUseBlock[] = [];
          
          const anthropicMessages = messages.map((m: Message) => ({
            role: m.role,
            content: m.content
          }));

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 4096,
              system: agent.system_prompt,
              messages: anthropicMessages,
              tools: tools.length > 0 ? tools : undefined,
              stream: true
            })
          });

          if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

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
                
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  const text = parsed.delta.text;
                  fullResponse += text;
                  sendSSE(JSON.stringify({ type: 'token', content: text }));
                } else if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                  toolCalls.push(parsed.content_block);
                }
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }

          // Handle tool calls (agent consultations)
          if (toolCalls.length > 0) {
            sendSSE(JSON.stringify({ type: 'thinking', content: 'Consulting with other experts...' }));

            for (const toolCall of toolCalls) {
              const { question, consulted_agent_slug } = toolCall.input;
              
              // Get consulted agent
              const { data: consultedAgent } = await supabase
                .from('agents')
                .select('*')
                .eq('slug', consulted_agent_slug)
                .single();

              if (consultedAgent) {
                // Call consulted agent
                const consultResponse = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 2048,
                    system: consultedAgent.system_prompt,
                    messages: [{ role: 'user', content: question }]
                  })
                });

                const consultData = await consultResponse.json();
                const answer = consultData.content?.[0]?.type === 'text' 
                  ? consultData.content[0].text 
                  : '';

                fullResponse += `\n\n[Consulted ${consultedAgent.name}]\n${answer}`;
                sendSSE(JSON.stringify({ type: 'consultation', agent: consultedAgent.name, answer }));
              }
            }
          }

          sendSSE(JSON.stringify({ type: 'done' }));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          sendSSE(JSON.stringify({ type: 'error', error: errorMessage }));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in agent-chat-demo:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
