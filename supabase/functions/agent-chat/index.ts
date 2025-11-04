import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Attachment {
  url: string;
  name: string;
  type: string;
  extracted_text?: string;
}

interface UserIntent {
  type: 'SEARCH_REQUEST' | 'DOWNLOAD_COMMAND' | 'FILTER_REQUEST' | 'SEMANTIC_QUESTION' | 'UNKNOWN';
  topic?: string;
  pdfNumbers?: number[];
  filterCriteria?: string;
}

interface SearchResult {
  number: number;
  title: string;
  authors?: string;
  year?: string;
  source?: string;
  url: string;
}

// ============================================
// DETERMINISTIC WORKFLOW HELPERS
// ============================================

function parseKnowledgeSearchIntent(message: string): UserIntent {
  console.log('🧠 [INTENT PARSER] Analyzing message:', message.slice(0, 100));
  const lowerMsg = message.toLowerCase().trim();
  
  // SEARCH REQUEST: "Find PDFs on...", "Search for...", "Look for..."
  const searchPatterns = [
    /find\s+(?:pdf|pdfs|papers?|documents?|articles?)\s+(?:on|about|regarding)/i,
    /search\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i,
    /look\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i
  ];
  
  for (const pattern of searchPatterns) {
    if (pattern.test(message)) {
      const topic = message.replace(pattern, '').trim();
      console.log('✅ [INTENT PARSER] Detected SEARCH_REQUEST for topic:', topic);
      return { type: 'SEARCH_REQUEST', topic };
    }
  }
  
  // DOWNLOAD COMMAND: "Download #2, #5", "Get PDFs #1, #3, #7"
  const downloadPattern = /download|get|scarica/i;
  const numberPattern = /#(\d+)/g;
  
  if (downloadPattern.test(message)) {
    const matches = Array.from(message.matchAll(numberPattern));
    if (matches.length > 0) {
      const pdfNumbers = matches.map(m => parseInt(m[1]));
      console.log('✅ [INTENT PARSER] Detected DOWNLOAD_COMMAND for PDFs:', pdfNumbers);
      return { type: 'DOWNLOAD_COMMAND', pdfNumbers };
    }
  }
  
  // FILTER REQUEST: "only last 3 years", "most authoritative"
  const filterPatterns = [
    /only|filter|show|keep|remove/i,
    /last\s+\d+\s+years?/i,
    /most\s+(?:authoritative|cited|recent)/i,
    /from\s+(?:universities|arxiv)/i
  ];
  
  for (const pattern of filterPatterns) {
    if (pattern.test(message)) {
      console.log('✅ [INTENT PARSER] Detected FILTER_REQUEST:', message.slice(0, 100));
      return { type: 'FILTER_REQUEST', filterCriteria: message };
    }
  }
  
  // Default: semantic question for AI
  console.log('✅ [INTENT PARSER] Detected SEMANTIC_QUESTION (default)');
  return { type: 'SEMANTIC_QUESTION' };
}

async function executeWebSearch(topic: string): Promise<SearchResult[]> {
  console.log('🔍 [WEB SEARCH] Starting Google Custom Search for topic:', topic);
  
  try {
    const apiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      console.error('❌ Missing Google Custom Search credentials');
      throw new Error('Google Custom Search not configured');
    }
    
    // Construct search query optimized for academic PDFs
    const searchQuery = `${topic} filetype:pdf`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;
    
    console.log('📡 Calling Google Custom Search API...');
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Google API Error:', response.status, errorText);
      throw new Error(`Google Custom Search failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      console.log('⚠️ No results found for:', topic);
      return [];
    }
    
    // Transform Google results to SearchResult format
    const results: SearchResult[] = data.items.map((item: any, index: number) => {
      // Extract metadata from snippet/title
      const yearMatch = item.snippet?.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : undefined;
      
      // Try to extract authors from snippet (heuristic)
      const authorsMatch = item.snippet?.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
      const authors = authorsMatch ? authorsMatch[0] : undefined;
      
      return {
        number: index + 1,
        title: item.title.replace(' [PDF]', '').trim(),
        authors,
        year,
        source: new URL(item.link).hostname,
        url: item.link
      };
    });
    
    console.log(`✅ [WEB SEARCH] Found ${results.length} PDFs`);
    return results;
    
  } catch (error) {
    console.error('❌ [WEB SEARCH] Error:', error);
    throw error;
  }
  
  // TODO: Call actual web_search tool here
  // For now, return mock data
  const mockResults = [
    {
      number: 1,
      title: "Example Paper on " + topic,
      authors: "Smith et al.",
      year: "2023",
      source: "arXiv",
      url: "https://arxiv.org/pdf/example1.pdf"
    },
    {
      number: 2,
      title: "Survey on " + topic,
      authors: "Johnson et al.",
      year: "2024",
      source: "ResearchGate",
      url: "https://researchgate.net/example2.pdf"
    }
  ];
  
  console.log(`✅ [WEB SEARCH] Found ${mockResults.length} results (MOCK DATA)`);
  console.log('[WEB SEARCH] Results:', JSON.stringify(mockResults, null, 2));
  
  return mockResults;
}

function formatSearchResults(results: SearchResult[], topic: string): string {
  console.log(`📝 [FORMATTER] Formatting ${results.length} results for topic:`, topic);
  const header = `Found ${results.length} PDFs on **${topic}**:\n\n`;
  
  const formattedResults = results.map(r => {
    const authors = r.authors ? ` | ${r.authors}` : '';
    const year = r.year ? ` | ${r.year}` : '';
    const source = r.source ? ` | ${r.source}` : '';
    return `#${r.number}. **${r.title}**${authors}${year}${source}`;
  }).join('\n\n');
  
  const footer = `\n\nYou can now:\n- Ask me to filter these results (e.g., "only last 3 years", "most authoritative only")\n- Ask questions about specific PDFs\n- Tell me which ones to download (e.g., "Download #1, #3, and #5")`;
  
  return header + formattedResults + footer;
}

function extractCachedSearchResults(messages: any[]): SearchResult[] | null {
  console.log(`🔍 [CACHE] Searching for cached results in ${messages.length} messages`);
  // Find the most recent assistant message containing search results
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content) {
      const match = msg.content.match(/Found (\d+) PDFs on/);
      if (match) {
        console.log(`✅ [CACHE] Found search results in message ${i}:`, match[0]);
        // Extract results from formatted message
        const results: SearchResult[] = [];
        const lines = msg.content.split('\n');
        
        for (const line of lines) {
          const resultMatch = line.match(/#(\d+)\.\s+\*\*(.+?)\*\*(?:\s+\|\s+(.+?))?(?:\s+\|\s+(\d{4}))?(?:\s+\|\s+(.+?))?$/);
          if (resultMatch) {
            results.push({
              number: parseInt(resultMatch[1]),
              title: resultMatch[2],
              authors: resultMatch[3],
              year: resultMatch[4],
              source: resultMatch[5],
              url: '' // URL not stored in formatted output - need to maintain separately
            });
          }
        }
        
        if (results.length > 0) {
          console.log(`✅ [CACHE] Extracted ${results.length} cached results`);
          return results;
        } else {
          console.log('⚠️ [CACHE] No valid results extracted from message');
          return null;
        }
      }
    }
  }
  
  console.log('❌ [CACHE] No cached search results found in conversation history');
  return null;
}

async function executeDownloads(pdfs: SearchResult[], searchQuery: string): Promise<any[]> {
  console.log(`⬇️ [DOWNLOAD] Starting download of ${pdfs.length} PDFs`);
  const results = [];
  
  for (const pdf of pdfs) {
    console.log(`⬇️ [DOWNLOAD] Processing PDF #${pdf.number}:`, pdf.title);
    
    if (!pdf.url) {
      console.log(`❌ [DOWNLOAD] PDF #${pdf.number} has no URL`);
      results.push({
        number: pdf.number,
        title: pdf.title,
        success: false,
        error: 'URL non disponibile'
      });
      continue;
    }
    
    try {
      // Call download-pdf-tool edge function
      const downloadResult = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/download-pdf-tool', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          url: pdf.url,
          search_query: searchQuery
        })
      });
      
      const data = await downloadResult.json();
      console.log(`✅ [DOWNLOAD] PDF #${pdf.number} response:`, data.error ? 'ERROR' : 'SUCCESS');
      
      results.push({
        number: pdf.number,
        title: pdf.title,
        success: !data.error,
        fileName: data.document?.file_name,
        error: data.error
      });
    } catch (error) {
      console.error(`❌ [DOWNLOAD] PDF #${pdf.number} exception:`, error);
      results.push({
        number: pdf.number,
        title: pdf.title,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  console.log(`✅ [DOWNLOAD] Completed. Success: ${results.filter(r => r.success).length}/${results.length}`);
  return results;
}

function formatDownloadResults(results: any[]): string {
  const successCount = results.filter(r => r.success).length;
  console.log(`📝 [FORMATTER] Formatting download results: ${successCount}/${results.length} successful`);
  const header = `Downloaded ${successCount} PDF(s):\n\n`;
  
  const formattedResults = results.map(r => {
    if (r.success) {
      return `✅ #${r.number}. **${r.title}**\n   Salvato come: ${r.fileName}`;
    } else {
      return `❌ #${r.number}. **${r.title}**\n   Errore: ${r.error}`;
    }
  }).join('\n\n');
  
  return header + formattedResults;
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
    // Keep enough messages to allow forwarding long agent responses
    const MAX_MESSAGES = 20;
    const MAX_TOTAL_CHARS = 100000; // Allow long forwarded messages
    
    let truncatedMessages = cleanedMessages;
    
    // Limit by message count (keep most recent)
    if (truncatedMessages.length > MAX_MESSAGES) {
      truncatedMessages = truncatedMessages.slice(-MAX_MESSAGES);
      console.log(`✂️ Truncated to last ${MAX_MESSAGES} messages`);
    }
    
    // Check total character count
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

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Start streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let streamClosed = false;
        
        const sendSSE = (data: string) => {
          if (streamClosed) {
            console.warn('⚠️ Attempted to send SSE on closed stream, ignoring');
            return;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch (error) {
            console.error('Error enqueueing SSE data:', error);
            streamClosed = true;
          }
        };
        
        const closeStream = () => {
          if (streamClosed) {
            console.warn('⚠️ Stream already closed, ignoring duplicate close');
            return;
          }
          streamClosed = true;
          try {
            controller.close();
          } catch (error) {
            console.error('Error closing stream:', error);
          }
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
          let lastUpdateTime = Date.now();
          let toolUseId: string | null = null;
          let toolUseName: string | null = null;
          let toolUseInputJson = '';
          
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

          // ============================================
          // DETERMINISTIC WORKFLOW FOR KNOWLEDGE SEARCH EXPERT
          // ============================================
          let workflowHandled = false;
          let workflowResponse = '';
          
          if (agent.slug === 'knowledge-search-expert') {
            console.log('🤖 [WORKFLOW] Knowledge Search Expert detected, checking intent...');
            const userIntent = parseKnowledgeSearchIntent(message);
            console.log('🤖 [WORKFLOW] Intent result:', userIntent);
            
            if (userIntent.type === 'SEARCH_REQUEST' && userIntent.topic) {
              console.log('🔍 [WORKFLOW] Handling SEARCH_REQUEST automatically');
              workflowHandled = true;
              
              // Execute web search immediately
              try {
                const searchResults = await executeWebSearch(userIntent.topic);
                workflowResponse = formatSearchResults(searchResults, userIntent.topic);
                
                // Send formatted results to user
                sendSSE(JSON.stringify({ type: 'content', text: workflowResponse }));
                fullResponse = workflowResponse;
                
                // Save to DB
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
                
                sendSSE(JSON.stringify({ 
                  type: 'complete', 
                  conversationId: conversation.id 
                }));
                
                closeStream();
                return; // Exit early, no AI call needed
              } catch (searchError) {
                console.error('Search error:', searchError);
                workflowHandled = false; // Fall back to AI
              }
            }
            
            if (userIntent.type === 'DOWNLOAD_COMMAND' && userIntent.pdfNumbers) {
              console.log('⬇️ [WORKFLOW] Handling DOWNLOAD_COMMAND automatically for:', userIntent.pdfNumbers);
              workflowHandled = true;
              
              // Get cached search results from conversation history
              const cachedResults = extractCachedSearchResults(truncatedMessages);
              
              if (cachedResults && cachedResults.length > 0) {
                const selectedPdfs = userIntent.pdfNumbers
                  .map(num => cachedResults[num - 1])
                  .filter(Boolean);
                
                // Execute downloads
                const downloadResults = await executeDownloads(selectedPdfs, message);
                workflowResponse = formatDownloadResults(downloadResults);
                
                sendSSE(JSON.stringify({ type: 'content', text: workflowResponse }));
                fullResponse = workflowResponse;
                
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
                
                sendSSE(JSON.stringify({ 
                  type: 'complete', 
                  conversationId: conversation.id 
                }));
                
                closeStream();
                return;
              } else {
                workflowResponse = '⚠️ Non trovo risultati di ricerca precedenti. Per favore, esegui prima una ricerca con "Find PDFs on [topic]".';
                sendSSE(JSON.stringify({ type: 'content', text: workflowResponse }));
                fullResponse = workflowResponse;
                
                await supabase
                  .from('agent_messages')
                  .update({ content: fullResponse })
                  .eq('id', placeholderMsg.id);
                
                sendSSE(JSON.stringify({ 
                  type: 'complete', 
                  conversationId: conversation.id 
                }));
                
                closeStream();
                return;
              }
            }
          }
          
          // If workflow didn't handle it, proceed with normal AI call
          if (workflowHandled) {
            console.log('✅ [WORKFLOW] Request handled deterministically, AI call skipped');
            return;
          } else {
            console.log('🤖 [WORKFLOW] Workflow not handled, proceeding with AI call for semantic processing');
          }
          
          const enhancedSystemPrompt = `CRITICAL INSTRUCTION: You MUST provide extremely detailed, comprehensive, and thorough responses. Never limit yourself to brief answers. When explaining concepts, you must provide:
- Multiple detailed examples with concrete scenarios
- In-depth explanations of each point with complete context
- All relevant background information and nuances
- Complete breakdowns of complex topics with step-by-step analysis
- Extended elaborations with practical examples and real-world applications
- Comprehensive coverage of all aspects of the topic

Your responses should be as long as necessary to FULLY and EXHAUSTIVELY address the user's question. Do NOT self-impose any brevity limits. Do NOT apply concepts you're explaining to your own response length. Be thorough and complete.

${agent.system_prompt}`;

          // Define tools for Knowledge Search Expert agent
          const tools = agent.slug === 'knowledge-search-expert' ? [
            {
              name: 'download_pdf',
              description: 'Downloads a PDF document from a URL and adds it to the document pool. Use this when you find relevant PDF documents that should be saved for later use.',
              input_schema: {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                    description: 'The direct URL of the PDF file to download'
                  },
                  search_query: {
                    type: 'string',
                    description: 'The search query or context that led to finding this document'
                  }
                },
                required: ['url']
              }
            }
          ] : undefined;

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
              tools: tools,
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
                  
                  // Handle tool use start
                  if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                    toolUseId = parsed.content_block.id;
                    toolUseName = parsed.content_block.name;
                    toolUseInputJson = '';
                    console.log('🔧 Tool use started:', toolUseName);
                  }
                  
                  // Accumulate tool input JSON
                  if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                    toolUseInputJson += parsed.delta.partial_json;
                    console.log('🔧 Tool input accumulated, length:', toolUseInputJson.length);
                  }
                  
                  // Execute tool when block stops
                  if (parsed.type === 'content_block_stop' && toolUseId && toolUseName) {
                    try {
                      const toolInput = toolUseInputJson ? JSON.parse(toolUseInputJson) : {};
                      console.log('🔧 Executing tool:', toolUseName, 'with input:', toolInput);
                      
                      if (toolUseName === 'download_pdf') {
                        const toolResult = await supabase.functions.invoke('download-pdf-tool', {
                          body: toolInput
                        });
                        
                        if (toolResult.error) {
                          console.error('Tool execution error:', toolResult.error);
                          fullResponse += `\n\n[Errore nel download del PDF: ${toolResult.error.message}]`;
                        } else {
                          const result = toolResult.data;
                          console.log('✅ Tool executed successfully:', result);
                          fullResponse += `\n\n✅ PDF "${result.document.file_name}" scaricato con successo! Il documento è stato aggiunto al pool e sarà validato automaticamente.`;
                        }
                        
                        sendSSE(JSON.stringify({ 
                          type: 'content', 
                          text: fullResponse.slice(Math.max(0, fullResponse.lastIndexOf('\n\n')))
                        }));
                      }
                    } catch (toolError) {
                      console.error('Error executing tool:', toolError);
                      const errorMsg = toolError instanceof Error ? toolError.message : 'Unknown error';
                      fullResponse += `\n\n[Errore nell'esecuzione del tool: ${errorMsg}]`;
                    }
                    
                    // Reset tool state
                    toolUseId = null;
                    toolUseName = null;
                    toolUseInputJson = '';
                  }
                  
                  // Handle regular text content
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

          // Final update to DB
          await supabase
            .from('agent_messages')
            .update({ content: fullResponse })
            .eq('id', placeholderMsg.id);

          sendSSE(JSON.stringify({ 
            type: 'complete', 
            conversationId: conversation.id 
          }));
          
          closeStream();
        } catch (error) {
          console.error('Stream error:', error);
          
          // Update placeholder with error message instead of deleting
          try {
            if (placeholderMsg?.id) {
              await supabase
                .from('agent_messages')
                .update({
                  content: '❌ Si è verificato un errore di connessione durante la generazione della risposta. Per favore riprova.'
                })
                .eq('id', placeholderMsg.id);
              console.log('Updated placeholder message with error after stream failure');
            }
          } catch (updateError) {
            console.error('Error updating placeholder with error:', updateError);
          }
          
          // Only send error if stream is not closed yet
          if (!streamClosed) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            sendSSE(JSON.stringify({ type: 'error', error: errorMessage }));
          }
          closeStream();
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
