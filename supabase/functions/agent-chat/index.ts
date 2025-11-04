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
  count?: number; // Number of results requested
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
  
  // Extract requested count (e.g., "find 20 PDFs", "5 documents", "get 50 papers")
  const countMatch = message.match(/\b(\d+)\s+(?:pdf|pdfs|document|documents|result|results|file|files|paper|papers)/i);
  const requestedCount = countMatch ? Math.min(parseInt(countMatch[1]), 100) : 10; // Default 10, max 100
  console.log('📊 [INTENT PARSER] Requested count:', requestedCount);
  
  // SEARCH REQUEST: "Find PDFs on...", "Search for...", "Look for..."
  const searchPatterns = [
    /find\s+(?:pdf|pdfs|papers?|documents?|articles?)\s+(?:on|about|regarding)/i,
    /search\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i,
    /look\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i,
    /\d+\s+(?:pdf|pdfs|papers?|documents?)\s+(?:on|about|regarding)/i // "20 PDFs on..."
  ];
  
  for (const pattern of searchPatterns) {
    if (pattern.test(message)) {
      const topic = message.replace(pattern, '').replace(/\b\d+\b/g, '').trim(); // Remove pattern and standalone numbers
      console.log('✅ [INTENT PARSER] Detected SEARCH_REQUEST for topic:', topic);
      return { type: 'SEARCH_REQUEST', topic, count: requestedCount };
    }
  }
  
  // DOWNLOAD COMMAND: "Download #2, #5", "Get PDFs #1, #3, #7", "Download all"
  const downloadPattern = /download|get|scarica/i;
  const numberPattern = /#(\d+)/g;
  
  if (downloadPattern.test(message)) {
    // Check for "all" command first (download all, scaricali tutti, get all)
    const allPattern = /\b(all|tutti|everything|tutte|tutto)\b/i;
    if (allPattern.test(message)) {
      console.log('✅ [INTENT PARSER] Detected DOWNLOAD_COMMAND for ALL PDFs');
      return { type: 'DOWNLOAD_COMMAND', pdfNumbers: [] }; // Empty array signals "download all"
    }
    
    // Otherwise look for specific numbers
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

async function executeWebSearch(topic: string, count: number = 10): Promise<SearchResult[]> {
  console.log('🔍 [WEB SEARCH] Starting Google Custom Search for topic:', topic);
  console.log('📊 [WEB SEARCH] Requested count:', count);
  
  try {
    const apiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      console.error('❌ Missing Google Custom Search credentials');
      throw new Error('Google Custom Search not configured');
    }
    
    // Google API max is 10 per request, so we need pagination
    const resultsPerPage = 10;
    const totalRequests = Math.ceil(count / resultsPerPage);
    console.log(`📡 Will make ${totalRequests} API call(s) to fetch ${count} results`);
    
    const allResults: SearchResult[] = [];
    const searchQuery = `${topic} filetype:pdf`;
    
    for (let page = 0; page < totalRequests; page++) {
      const startIndex = page * resultsPerPage + 1; // Google uses 1-based indexing
      const numResults = Math.min(resultsPerPage, count - allResults.length);
      
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=${numResults}&start=${startIndex}`;
      
      console.log(`📡 Page ${page + 1}/${totalRequests}: start=${startIndex}, num=${numResults}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google API Error:', response.status, errorText);
        
        // If we got some results already, return what we have
        if (allResults.length > 0) {
          console.log(`⚠️ Error on page ${page + 1}, returning ${allResults.length} results collected so far`);
          break;
        }
        throw new Error(`Google Custom Search failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        console.log(`⚠️ No more results found on page ${page + 1}`);
        break;
      }
      
      // Transform Google results to SearchResult format
      const pageResults: SearchResult[] = data.items.map((item: any, index: number) => {
        const yearMatch = item.snippet?.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : undefined;
        
        const authorsMatch = item.snippet?.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
        const authors = authorsMatch ? authorsMatch[0] : undefined;
        
        return {
          number: allResults.length + index + 1, // Global numbering
          title: item.title.replace(' [PDF]', '').trim(),
          authors,
          year,
          source: new URL(item.link).hostname,
          url: item.link
        };
      });
      
      allResults.push(...pageResults);
      console.log(`✅ Page ${page + 1} complete: ${pageResults.length} results (total: ${allResults.length})`);
      
      // If we have enough results, stop
      if (allResults.length >= count) {
        break;
      }
      
      // Rate limiting: wait 500ms between requests to avoid hitting Google API limits
      if (page < totalRequests - 1) {
        console.log('⏱️ Rate limiting: waiting 500ms before next request...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`✅ [WEB SEARCH] Completed: ${allResults.length} PDFs found (requested: ${count})`);
    return allResults;
    
  } catch (error) {
    console.error('❌ [WEB SEARCH] Error:', error);
    throw error;
  }
}

function formatSearchResults(results: SearchResult[], topic: string, requestedCount?: number): string {
  console.log(`📝 [FORMATTER] Formatting ${results.length} results for topic:`, topic);
  
  let header = `Found ${results.length} PDFs on **${topic}**`;
  if (requestedCount && requestedCount !== results.length) {
    header += ` (requested: ${requestedCount})`;
  }
  header += ':\n\n';
  
  const formattedResults = results.map(r => {
    const authors = r.authors ? ` | ${r.authors}` : '';
    const year = r.year ? ` | ${r.year}` : '';
    const source = r.source ? ` | ${r.source}` : '';
    return `#${r.number}. **${r.title}**${authors}${year}${source}`;
  }).join('\n\n');
  
  const footer = `\n\nYou can now:\n- Ask me to filter these results (e.g., "only last 3 years", "most authoritative only")\n- Ask questions about specific PDFs\n- Tell me which ones to download (e.g., "Download #1, #3, and #5")`;
  
  return header + formattedResults + footer;
}

async function extractCachedSearchResults(
  messages: any[], 
  conversationId: string,
  supabaseClient: any
): Promise<SearchResult[] | null> {
  console.log(`🔍 [CACHE] Searching for cached results in conversation ${conversationId}`);
  
  // First try to get results from database cache (most reliable, includes URLs)
  try {
    const { data: cachedResults, error } = await supabaseClient
      .from('search_results_cache')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('result_number', { ascending: true });
    
    if (!error && cachedResults && cachedResults.length > 0) {
      console.log(`✅ [CACHE] Found ${cachedResults.length} results in database cache`);
      return cachedResults.map((r: any) => ({
        number: r.result_number,
        title: r.title,
        authors: r.authors,
        year: r.year,
        source: r.source,
        url: r.url
      }));
    }
  } catch (dbError) {
    console.error('⚠️ [CACHE] Database cache lookup failed:', dbError);
  }
  
  // Fallback: extract from message history (no URLs)
  console.log(`🔍 [CACHE] Fallback: Searching in ${messages.length} messages`);
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content) {
      const match = msg.content.match(/Found (\d+) PDFs on/);
      if (match) {
        console.log(`✅ [CACHE] Found search results in message ${i}:`, match[0]);
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
              url: '' // URL not available from formatted message
            });
          }
        }
        
        if (results.length > 0) {
          console.log(`⚠️ [CACHE] Extracted ${results.length} results but URLs missing`);
          return results;
        }
      }
    }
  }
  
  console.log('❌ [CACHE] No cached search results found');
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

    // Determine which LLM provider to use
    const llmProvider = agent.llm_provider || 'anthropic';
    console.log('🤖 Using LLM Provider:', llmProvider);

    // Get and validate API keys based on provider
    let ANTHROPIC_API_KEY: string | undefined;
    let DEEPSEEK_API_KEY: string | undefined;
    let OPENAI_API_KEY: string | undefined;

    if (llmProvider === 'anthropic') {
      ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
      if (!ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
    } else if (llmProvider === 'deepseek') {
      DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
      if (!DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY not configured');
      }
    } else if (llmProvider === 'openai') {
      OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }
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
          console.log('='.repeat(80));
          console.log('🤖 LLM ROUTING INFO:');
          console.log(`   Agent: ${agent.name} (${agent.slug})`);
          console.log(`   Selected Provider: ${llmProvider.toUpperCase()}`);
          console.log(`   Conversation ID: ${conversation.id}`);
          console.log(`   User Message: ${message.slice(0, 100)}...`);
          console.log('='.repeat(80));

          // Create placeholder message in DB FIRST
          const { data: placeholder, error: placeholderError } = await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: '',
              llm_provider: llmProvider  // Track which LLM will respond
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
              console.log('📊 [WORKFLOW] Requested count:', userIntent.count);
              workflowHandled = true;
              
              // Execute web search immediately with requested count
              try {
                const searchResults = await executeWebSearch(userIntent.topic, userIntent.count || 10);
                
                // Save results to database cache
                console.log(`💾 [CACHE] Saving ${searchResults.length} results to database`);
                const cacheInserts = searchResults.map(r => ({
                  conversation_id: conversation.id,
                  result_number: r.number,
                  title: r.title,
                  authors: r.authors,
                  year: r.year,
                  source: r.source,
                  url: r.url
                }));
                
                // Delete old cache for this conversation first
                await supabase
                  .from('search_results_cache')
                  .delete()
                  .eq('conversation_id', conversation.id);
                
                // Insert new cache
                const { error: cacheError } = await supabase
                  .from('search_results_cache')
                  .insert(cacheInserts);
                
                if (cacheError) {
                  console.error('⚠️ [CACHE] Failed to save to database:', cacheError);
                } else {
                  console.log('✅ [CACHE] Results saved to database successfully');
                }
                
                workflowResponse = formatSearchResults(searchResults, userIntent.topic, userIntent.count);
                
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
            
            if (userIntent.type === 'DOWNLOAD_COMMAND' && userIntent.pdfNumbers !== undefined) {
              console.log('⬇️ [WORKFLOW] Handling DOWNLOAD_COMMAND automatically for:', userIntent.pdfNumbers.length === 0 ? 'ALL PDFs' : userIntent.pdfNumbers);
              workflowHandled = true;
              
              // Get cached search results from conversation history
              const cachedResults = await extractCachedSearchResults(truncatedMessages, conversation.id, supabase);
              
              if (cachedResults && cachedResults.length > 0) {
                // If pdfNumbers is empty, download all; otherwise download specific ones
                const selectedPdfs = userIntent.pdfNumbers.length === 0 
                  ? cachedResults 
                  : userIntent.pdfNumbers
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

          // Set timeout for API call (5 minutes)
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
          
          let response: Response;
          try {
            // Route to appropriate LLM provider
            if (llmProvider === 'deepseek') {
              // DeepSeek with direct streaming
              console.log('🚀 ROUTING TO DEEPSEEK');
              console.log(`   Model: deepseek-chat`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              if (!DEEPSEEK_API_KEY) {
                throw new Error('DEEPSEEK_API_KEY is required but not set');
              }
              
              const deepseekMessages = [
                { role: 'system', content: enhancedSystemPrompt },
                ...anthropicMessages
              ];
              
              response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'deepseek-chat',
                  messages: deepseekMessages,
                  temperature: 0.7,
                  max_tokens: 4000,
                  stream: true
                }),
                signal: controller.signal
              });
              
            } else if (llmProvider === 'openai') {
              // OpenAI implementation (streaming)
              console.log('🚀 ROUTING TO OPENAI');
              console.log(`   Model: gpt-4o`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'gpt-4o',
                  messages: [
                    { role: 'system', content: enhancedSystemPrompt },
                    ...anthropicMessages
                  ],
                  temperature: 0.7,
                  stream: true
                }),
                signal: controller.signal
              });
              
            } else {
              // Default: Anthropic
              console.log('🚀 ROUTING TO ANTHROPIC');
              console.log(`   Model: claude-sonnet-4-5`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              if (!ANTHROPIC_API_KEY) {
                throw new Error('ANTHROPIC_API_KEY is required but not set');
              }
              
              response = await fetch('https://api.anthropic.com/v1/messages', {
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
                }),
                signal: controller.signal
              });
            }
          
            clearTimeout(timeout);

            if (!response.ok) {
              const errorBody = await response.text();
              console.error(`${llmProvider.toUpperCase()} API error details:`, response.status, errorBody);
              throw new Error(`${llmProvider.toUpperCase()} API error: ${response.status} - ${errorBody}`);
            }
          } catch (error: any) {
            clearTimeout(timeout);
            if (error.name === 'AbortError') {
              throw new Error('Request timeout after 5 minutes');
            }
            throw error;
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';
          let lastKeepAlive = Date.now();

          console.log(`🔄 Starting stream from ${llmProvider.toUpperCase()}...`);

          // Send keep-alive every 15 seconds to prevent timeout
          const keepAliveInterval = setInterval(() => {
            sendSSE(':keep-alive\n\n');
            console.log('📡 Keep-alive sent');
          }, 15000);

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`✅ Stream ended. Provider: ${llmProvider}, Total response length: ${fullResponse.length} chars`);
                clearInterval(keepAliveInterval);
                // Save before breaking
                await supabase
                  .from('agent_messages')
                  .update({ 
                    content: fullResponse,
                    llm_provider: llmProvider 
                  })
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
                if (data === '[DONE]') {
                  console.log(`🏁 [${llmProvider.toUpperCase()}] Received [DONE] signal`);
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  
                  // Handle DeepSeek streaming format
                  if (llmProvider === 'deepseek') {
                    console.log('🔵 [DEEPSEEK] Parsed chunk:', JSON.stringify(parsed).substring(0, 200));
                    
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      console.log('🔵 [DEEPSEEK] Content chunk length:', newText.length);
                      fullResponse += newText;
                      sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 5000) {
                        console.log('🔵 [DEEPSEEK] Saving intermediate response, length:', fullResponse.length);
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    } else {
                      console.log('🔵 [DEEPSEEK] No content in delta:', JSON.stringify(parsed.choices?.[0]?.delta || 'no delta'));
                    }
                    continue; // Skip OpenAI/Anthropic-specific handling
                  }
                  
                  // Handle OpenAI streaming format
                  if (llmProvider === 'openai') {
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 5000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    continue; // Skip Anthropic-specific handling
                  }
                  
                  // Anthropic-specific handling
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
                  }
                  
                  // Handle tool use completion
                  if (parsed.type === 'content_block_stop' && toolUseId) {
                    console.log('🔧 Tool use complete, input JSON:', toolUseInputJson);
                    
                    try {
                      const toolInput = JSON.parse(toolUseInputJson);
                      
                      // Execute the tool
                      let toolResult: any = null;
                      
                      if (toolUseName === 'download_pdf') {
                        console.log('📥 Executing download_pdf with:', toolInput);
                        
                        const { data: downloadData, error: downloadError } = await supabase.functions.invoke(
                          'download-pdf-tool',
                          {
                            body: {
                              url: toolInput.url,
                              search_query: toolInput.search_query || 'User requested'
                            }
                          }
                        );
                        
                        if (downloadError) {
                          console.error('❌ Download error:', downloadError);
                          toolResult = { success: false, error: downloadError.message };
                        } else {
                          console.log('✅ Download successful:', downloadData);
                          toolResult = downloadData;
                        }
                      }
                      
                      // Store tool result
                      anthropicMessages.push({
                        role: 'assistant',
                        content: [
                          {
                            type: 'tool_use',
                            id: toolUseId,
                            name: toolUseName,
                            input: toolInput
                          }
                        ]
                      });
                      
                      anthropicMessages.push({
                        role: 'user',
                        content: [
                          {
                            type: 'tool_result',
                            tool_use_id: toolUseId,
                            content: JSON.stringify(toolResult)
                          }
                        ]
                      });
                      
                      // Reset tool use tracking
                      toolUseId = null;
                      toolUseName = null;
                      toolUseInputJson = '';
                      
                    } catch (jsonError) {
                      console.error('❌ Error parsing tool input JSON:', jsonError, toolUseInputJson);
                    }
                  }
                  
                  // Handle text content
                  if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    const newText = parsed.delta.text;
                    fullResponse += newText;
                    sendSSE(JSON.stringify({ type: 'content', text: newText }));
                    
                    // Auto-save every 5 seconds during streaming
                    const now = Date.now();
                    if (now - lastUpdateTime > 5000) {
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
            clearInterval(keepAliveInterval);
          } catch (error) {
            console.error('❌ Streaming interrupted:', error);
            console.error('📊 Partial response length:', fullResponse.length);
            clearInterval(keepAliveInterval);
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
            .update({ 
              content: fullResponse,
              llm_provider: llmProvider  // Persist which LLM was used
            })
            .eq('id', placeholderMsg.id);

          console.log('✅ LLM REQUEST COMPLETED');
          console.log(`   Provider: ${llmProvider.toUpperCase()}`);
          console.log(`   Response length: ${fullResponse.length} chars`);
          console.log('='.repeat(80));

          sendSSE(JSON.stringify({ 
            type: 'complete', 
            conversationId: conversation.id,
            llmProvider: llmProvider  // Send provider info to client
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
