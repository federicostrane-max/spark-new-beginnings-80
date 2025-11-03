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
  console.log('=== AGENT CHAT REQUEST RECEIVED ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', {
    authorization: req.headers.get('Authorization') ? 'Present' : 'Missing',
    contentType: req.headers.get('Content-Type')
  });
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
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
      console.error('Authentication failed:', userError);
      throw new Error('Unauthorized');
    }

    console.log('User authenticated:', user.id);

    const requestBody = await req.json();
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    const { conversationId, message, agentSlug, attachments } = requestBody;

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

    // Get conversation history - EXCLUDE empty/incomplete messages at DB level
    const { data: messages, error: msgError } = await supabase
      .from('agent_messages')
      .select('id, role, content')
      .eq('conversation_id', conversation.id)
      .not('content', 'is', null)
      .neq('content', '')
      .order('created_at', { ascending: true });

    if (msgError) throw msgError;

    // Clean up duplicate consecutive user messages and ensure no empty content
    const cleanedMessages = messages?.filter((m, index, arr) => {
      // Skip if content is empty or whitespace
      if (!m.content || m.content.trim() === '') return false;
      
      // For user messages, check if next message is a duplicate
      if (m.role === 'user' && index < arr.length - 1) {
        const nextMsg = arr[index + 1];
        // Skip this message if next is also user with identical content
        if (nextMsg.role === 'user' && nextMsg.content === m.content) {
          console.log('🧹 Skipping duplicate user message:', m.content.slice(0, 50));
          return false;
        }
      }
      
      return true;
    }) || [];

    console.log(`📊 Messages: ${messages?.length || 0} → ${cleanedMessages.length} after cleanup`);

    // Truncate conversation history to prevent context overflow
    // Strategy: Keep more messages but with stricter char limit to prevent Claude confusion
    const MAX_MESSAGES = 15;
    const MAX_TOTAL_CHARS = 20000; // Reduced from 50k to prevent Claude from getting confused
    const MAX_SINGLE_MESSAGE_CHARS = 8000; // New: cap individual messages
    
    let truncatedMessages = cleanedMessages;
    
    // First, truncate individual messages that are too long
    truncatedMessages = truncatedMessages.map(m => {
      if (m.content && m.content.length > MAX_SINGLE_MESSAGE_CHARS) {
        console.log(`✂️ Truncating ${m.role} message from ${m.content.length} to ${MAX_SINGLE_MESSAGE_CHARS} chars`);
        return {
          ...m,
          content: m.content.slice(0, MAX_SINGLE_MESSAGE_CHARS) + '\n\n[Message truncated for length...]'
        };
      }
      return m;
    });
    
    // Then, limit by message count (keep most recent)
    if (truncatedMessages.length > MAX_MESSAGES) {
      truncatedMessages = truncatedMessages.slice(-MAX_MESSAGES);
      console.log(`✂️ Truncated to last ${MAX_MESSAGES} messages`);
    }
    
    // Finally, check total character count
    let totalChars = truncatedMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    
    if (totalChars > MAX_TOTAL_CHARS) {
      // Remove oldest messages until under limit
      while (totalChars > MAX_TOTAL_CHARS && truncatedMessages.length > 2) {
        const removed = truncatedMessages.shift();
        totalChars -= (removed?.content?.length || 0);
      }
      console.log(`✂️ Truncated to ${totalChars} chars across ${truncatedMessages.length} messages`);
    }
    
    console.log(`📊 Final context: ${truncatedMessages.length} messages, ${totalChars} total chars`);

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

        let placeholderMsg: any = null; // Declare outside try block for catch access

        try {
          // Create placeholder message in DB FIRST
          const { data: placeholder, error: placeholderError } = await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: ''
            })
            .select()
            .single();

          if (placeholderError) throw placeholderError;
          placeholderMsg = placeholder;

          // Cleanup any previous incomplete assistant messages (excluding the current placeholder)
          // This includes NULL, empty strings, and messages shorter than 10 characters
          const { data: incompleteMsgs } = await supabase
            .from('agent_messages')
            .select('id, content')
            .eq('conversation_id', conversation.id)
            .eq('role', 'assistant')
            .neq('id', placeholderMsg.id);
          
          if (incompleteMsgs) {
            const idsToDelete = incompleteMsgs
              .filter(m => !m.content || m.content.trim() === '' || m.content.length < 10)
              .map(m => m.id);
            
            if (idsToDelete.length > 0) {
              console.log(`Cleaning up ${idsToDelete.length} incomplete assistant messages`);
              await supabase
                .from('agent_messages')
                .delete()
                .in('id', idsToDelete);
            }
          }

          // Send message_start event with message ID
          sendSSE(JSON.stringify({ 
            type: 'message_start', 
            messageId: placeholderMsg.id 
          }));

          let fullResponse = '';
          let toolCalls: ToolUseBlock[] = [];
          let lastUpdateTime = Date.now();
          
          // Use truncatedMessages instead of cleanedMessages
          const anthropicMessages = truncatedMessages
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

          // Verify no empty messages remain before sending to Anthropic
          const hasEmptyMessages = anthropicMessages.some(m => !m.content || m.content.trim() === '');
          if (hasEmptyMessages) {
            console.error('Found empty messages after filtering!', anthropicMessages);
            throw new Error('Cannot send empty messages to Anthropic');
          }

          console.log('📤 Sending to Anthropic:');
          console.log('Total messages:', anthropicMessages.length);
          console.log('Messages:', JSON.stringify(anthropicMessages, null, 2));

          const enhancedSystemPrompt = `CRITICAL INSTRUCTION: You MUST provide extremely detailed, comprehensive, and thorough responses. Never limit yourself to brief answers. When explaining concepts, you must provide:
- Multiple detailed examples with concrete scenarios
- In-depth explanations of each point with complete context
- All relevant background information and nuances
- Complete breakdowns of complex topics with step-by-step analysis
- Extended elaborations with practical examples and real-world applications
- Comprehensive coverage of all aspects of the topic

Your responses should be as long as necessary to FULLY and EXHAUSTIVELY address the user's question. Do NOT self-impose any brevity limits. Do NOT apply concepts you're explaining to your own response length. Be thorough and complete.

${agent.system_prompt}`;

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              max_tokens: 64000,
              temperature: 0.7,
              system: enhancedSystemPrompt,
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

          console.log('🔄 Starting stream from Anthropic...');

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`✅ Stream ended. Total response length: ${fullResponse.length} chars`);
                // Save before breaking
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
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
            console.log(`📝 Stream completed successfully. Final length: ${fullResponse.length} chars`);
          } catch (error) {
            console.error('❌ Streaming interrupted:', error);
            console.error('📊 Partial response length:', fullResponse.length);
            // Save whatever we have so far
            if (fullResponse) {
              await supabase
                .from('agent_messages')
                .update({ content: fullResponse })
                .eq('id', placeholderMsg.id);
            }
            throw error;
          }

          console.log(`🎯 Total tokens received: ${fullResponse.length} chars, ${toolCalls.length} tool calls`);

          // Handle tool calls (agent consultations)
          if (toolCalls.length > 0) {
            console.log(`🔧 Tool calls detected: ${toolCalls.length}`);
            sendSSE(JSON.stringify({ type: 'thinking', content: 'Consulting with other experts...' }));

            const toolResults = [];
            for (const toolCall of toolCalls) {
              const { question, consulted_agent_slug } = toolCall.input;
              console.log(`  - Consulting ${consulted_agent_slug} with question: ${question.slice(0, 100)}`);
              
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
                    model: 'claude-sonnet-4-5',
                    max_tokens: 8192,
                    system: consultedAgent.system_prompt,
                    messages: [{ role: 'user', content: question }]
                  })
                });

                if (!consultResponse.ok) {
                  console.error(`❌ Failed to consult ${consulted_agent_slug}: ${consultResponse.status}`);
                  const errorText = await consultResponse.text();
                  console.error('Error details:', errorText);
                  continue; // Skip this tool result
                }

                const consultData = await consultResponse.json();
                const answer = consultData.content?.[0]?.type === 'text' 
                  ? consultData.content[0].text 
                  : '';
                
                console.log(`✅ Answer from ${consultedAgent.name}: ${answer ? answer.slice(0, 150) + '...' : 'EMPTY'}`);

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
                
                // Validate answer before adding to toolResults
                if (answer && answer.trim()) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: answer
                  });
                } else {
                  console.warn(`Empty answer from agent ${consultedAgent.name}, skipping tool result`);
                }
              }
            }

            // Validate tool results before proceeding
            console.log(`📊 Tool results: ${toolResults.length} of ${toolCalls.length} consultations succeeded`);
            
            if (toolResults.length === 0) {
              console.warn('⚠️ No valid tool results collected, responding without consultations');
              
              // If agent has a partial response, save it and complete
              if (fullResponse && fullResponse.trim()) {
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
                
                sendSSE(JSON.stringify({ type: 'content', text: '\n\n[Note: Unable to consult other agents]' }));
              } else {
                // Otherwise, send error
                sendSSE(JSON.stringify({ type: 'error', message: 'Unable to complete agent consultations' }));
              }
              
              sendSSE(JSON.stringify({ type: 'done' }));
              controller.close();
              return;
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

            console.log('🔄 Follow-up to Anthropic with tool results:');
            console.log('assistantContent:', JSON.stringify(assistantContent, null, 2));
            console.log('toolResults:', JSON.stringify(toolResults, null, 2));
            console.log('followUpMessages length:', followUpMessages.length);

            const enhancedSystemPromptFollowUp = `CRITICAL INSTRUCTION: You MUST provide extremely detailed, comprehensive, and thorough responses. Never limit yourself to brief answers. When explaining concepts, you must provide:
- Multiple detailed examples with concrete scenarios
- In-depth explanations of each point with complete context
- All relevant background information and nuances
- Complete breakdowns of complex topics with step-by-step analysis
- Extended elaborations with practical examples and real-world applications
- Comprehensive coverage of all aspects of the topic

Your responses should be as long as necessary to FULLY and EXHAUSTIVELY address the user's question. Do NOT self-impose any brevity limits. Do NOT apply concepts you're explaining to your own response length. Be thorough and complete.

${agent.system_prompt}`;

            const followUpResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 64000,
                temperature: 0.7,
                system: enhancedSystemPromptFollowUp,
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
            
            console.log('🔄 Starting follow-up stream from Anthropic...');

            try {
              while (true) {
                const { done, value } = await followUpReader.read();
                if (done) {
                  console.log(`✅ Follow-up stream ended. Total response length: ${fullResponse.length} chars`);
                  // Save before breaking
                  await supabase
                    .from('agent_messages')
                    .update({ content: fullResponse })
                    .eq('id', placeholderMsg.id);
                  break;
                }

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
              console.log(`📝 Follow-up stream completed successfully. Final length: ${fullResponse.length} chars`);
            } catch (error) {
              console.error('❌ Follow-up streaming interrupted:', error);
              console.error('📊 Partial follow-up response length:', fullResponse.length);
              // Save whatever we have so far
              if (fullResponse) {
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
              }
              throw error;
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
          
          // Delete the placeholder message if stream failed
          try {
            await supabase
              .from('agent_messages')
              .delete()
              .eq('id', placeholderMsg.id);
            console.log('Deleted placeholder message after stream failure');
          } catch (deleteError) {
            console.error('Error deleting placeholder:', deleteError);
          }
          
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
