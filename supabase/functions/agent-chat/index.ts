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

interface Attachment {
  url: string;
  name: string;
  type: string;
  extracted_text?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { conversationId, message, agentSlug, attachments } = await req.json();

    console.log('Processing chat for agent:', agentSlug);

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

    console.log('Agent ID for RAG filtering:', agent.id);

    // Get or create conversation
    let conversation;
    if (conversationId) {
      const { data, error } = await supabase
        .from('agent_conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      conversation = data;
    } else {
      const { data, error } = await supabase
        .from('agent_conversations')
        .insert({
          user_id: user.id,
          agent_id: agent.id,
          title: message.substring(0, 100)
        })
        .select()
        .single();

      if (error) throw error;
      conversation = data;
    }

    // Process attachments and build context
    let attachmentContext = '';
    if (attachments && attachments.length > 0) {
      for (const att of attachments as Attachment[]) {
        if (att.extracted_text) {
          attachmentContext += `\n\n[Content from ${att.name}]:\n${att.extracted_text}`;
        }
      }
    }

    const finalUserMessage = attachmentContext 
      ? `${message}${attachmentContext}`
      : message;

    // Save user message
    const { error: userMsgError } = await supabase
      .from('agent_messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: finalUserMessage
      });

    if (userMsgError) throw userMsgError;

    // Get conversation history
    const { data: messages, error: msgError } = await supabase
      .from('agent_messages')
      .select('id, role, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    if (msgError) throw msgError;

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
          // Cleanup any previous incomplete assistant messages in this conversation
          // This includes NULL, empty strings, and messages shorter than 10 characters
          const { data: incompleteMsgs } = await supabase
            .from('agent_messages')
            .select('id, content')
            .eq('conversation_id', conversation.id)
            .eq('role', 'assistant');
          
          if (incompleteMsgs) {
            const idsToDelete = incompleteMsgs
              .filter(m => !m.content || m.content.trim() === '' || m.content.length < 10)
              .map(m => m.id);
            
            if (idsToDelete.length > 0) {
              await supabase
                .from('agent_messages')
                .delete()
                .in('id', idsToDelete);
            }
          }

          // Create placeholder message in DB
          const { data: placeholderMsg, error: placeholderError } = await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: ''
            })
            .select()
            .single();

          if (placeholderError) throw placeholderError;

          // Send message_start event with message ID
          sendSSE(JSON.stringify({ 
            type: 'message_start', 
            messageId: placeholderMsg.id 
          }));

          let fullResponse = '';
          let toolCalls: ToolUseBlock[] = [];
          let lastUpdateTime = Date.now();
          
          const anthropicMessages = messages
            .filter(m => {
              // Exclude the placeholder we just created
              if (m.id === placeholderMsg.id) return false;
              // Exclude messages with empty or null content
              if (!m.content || typeof m.content !== 'string') return false;
              // Exclude messages with only whitespace
              if (m.content.trim() === '') return false;
              return true;
            })
            .map(m => ({
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
              model: 'claude-sonnet-4-20250514',
              max_tokens: 4096,
              system: agent.system_prompt,
              messages: anthropicMessages,
              tools: tools.length > 0 ? tools : undefined,
              stream: true
            })
          });

          if (!response.ok) {
            const errorBody = await response.text();
            console.error('Anthropic API error details:', response.status, errorBody);
            throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
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
                  sendSSE(JSON.stringify({ type: 'content', text }));

                  // Periodic DB update (every 500ms)
                  const now = Date.now();
                  if (now - lastUpdateTime > 500) {
                    await supabase
                      .from('agent_messages')
                      .update({ content: fullResponse })
                      .eq('id', placeholderMsg.id);
                    lastUpdateTime = now;
                  }
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

            const toolResults = [];
            for (const toolCall of toolCalls) {
              const { question, consulted_agent_slug } = toolCall.input;
              
              const { data: consultedAgent } = await supabase
                .from('agents')
                .select('*')
                .eq('slug', consulted_agent_slug)
                .single();

              if (consultedAgent) {
                const consultResponse = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 2048,
                    system: consultedAgent.system_prompt,
                    messages: [{ role: 'user', content: question }]
                  })
                });

                const consultData = await consultResponse.json();
                const answer = consultData.content?.[0]?.type === 'text' 
                  ? consultData.content[0].text 
                  : '';

                await supabase
                  .from('inter_agent_messages')
                  .insert({
                    requesting_agent_id: agent.id,
                    consulted_agent_id: consultedAgent.id,
                    context_conversation_id: conversation.id,
                    question,
                    answer
                  });

                sendSSE(JSON.stringify({ type: 'consultation', agent: consultedAgent.name, answer }));
                
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolCall.id,
                  content: answer
                });
              }
            }

            // Continue conversation with tool results
            // Costruisci il messaggio assistant solo se ha contenuto
            const assistantContent = [
              ...(fullResponse ? [{ type: 'text', text: fullResponse }] : []),
              ...toolCalls
            ];

            const followUpMessages = [
              ...anthropicMessages,
              ...(assistantContent.length > 0 ? [{
                role: 'assistant',
                content: assistantContent
              }] : []),
              {
                role: 'user',
                content: toolResults
              }
            ];

            const followUpResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: agent.system_prompt,
                messages: followUpMessages,
                stream: true
              })
            });

            if (!followUpResponse.ok) {
              const errorBody = await followUpResponse.text();
              console.error('Anthropic API error details (follow-up):', followUpResponse.status, errorBody);
              throw new Error(`Anthropic API error: ${followUpResponse.status} - ${errorBody}`);
            }

            const followUpReader = followUpResponse.body?.getReader();
            if (!followUpReader) throw new Error('No response body');

            let followUpBuffer = '';
            
            while (true) {
              const { done, value } = await followUpReader.read();
              if (done) break;

              followUpBuffer += decoder.decode(value, { stream: true });
              const lines = followUpBuffer.split('\n');
              followUpBuffer = lines.pop() || '';

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
                    sendSSE(JSON.stringify({ type: 'content', text }));

                    const now = Date.now();
                    if (now - lastUpdateTime > 500) {
                      await supabase
                        .from('agent_messages')
                        .update({ content: fullResponse })
                        .eq('id', placeholderMsg.id);
                      lastUpdateTime = now;
                    }
                  }
                } catch (e) {
                  console.error('Parse error:', e);
                }
              }
            }
          }

          // Final update to DB
          await supabase
            .from('agent_messages')
            .update({ content: fullResponse })
            .eq('id', placeholderMsg.id);

          sendSSE(JSON.stringify({ 
            type: 'complete', 
            conversationId: conversation.id 
          }));
          
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
    console.error('Error in agent-chat:', error);
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
