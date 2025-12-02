// FORCE_DEPLOY_v3: 2025-01-31T20:08:00Z - Fix Google Gemini SSE streaming (second attempt)
// Previous deploy did not propagate - forcing fresh build
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation helpers
function validateUUID(value: string, fieldName: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a valid UUID`);
  }
}

function validateMessageLength(message: string): void {
  const MAX_MESSAGE_LENGTH = 200000;
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message too long: maximum ${MAX_MESSAGE_LENGTH} characters allowed`);
  }
}

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

interface ContinuationResult {
  isComplete: boolean;
  content: string;
  attempts: number;
}

interface UserIntent {
  type: 'SEARCH_REQUEST' | 'DOWNLOAD_COMMAND' | 'FILTER_REQUEST' | 'SEMANTIC_QUESTION' | 'UNKNOWN';
  topic?: string;
  pdfNumbers?: number[];
  filterCriteria?: string;
  count?: number; // Number of results requested
}

// ============================================================================
// REMOVED: Pattern-based intent analysis is no longer needed
// Semantic search is now UNCONDITIONAL for every query
// ============================================================================

// ============================================================================
// QUERY DECOMPOSITION HELPERS
// ============================================================================

/**
 * Estrae il filename dalla query se presente nel formato:
 * "Regarding document 'FILENAME': ..."
 * Ritorna null se non trova il pattern.
 */
function extractDocumentNameFromQuery(query: string): string | null {
  const match = query.match(/Regarding document ['"]([^'"]+)['"]:/i);
  return match ? match[1] : null;
}

/**
 * Pulisce l'output JSON da eventuali wrapper Markdown.
 * Gli LLM spesso restituiscono: ```json\n["query1"]\n```
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  
  // Rimuovi blocchi Markdown ```json ... ```
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  return cleaned.trim();
}

/**
 * Usa un LLM veloce per estrarre query di ricerca distinte da un messaggio utente.
 * Se il messaggio è semplice (saluto o singola domanda), restituisce array con solo quel testo.
 */
async function decomposeQueryWithLLM(userMessage: string): Promise<string[]> {
  // Early exit per messaggi brevi (probabilmente già atomici)
  if (userMessage.length < DECOMPOSITION_CONFIG.MIN_MESSAGE_LENGTH) {
    console.log('⚡ [DECOMPOSITION] Message too short, skipping decomposition');
    return [userMessage];
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.warn('⚠️ [DECOMPOSITION] LOVABLE_API_KEY not found, skipping decomposition');
    return [userMessage];
  }

  try {
    const prompt = `Extract distinct search queries from this user message. 
Return ONLY a valid JSON array of strings (no markdown, no explanations).
If it's a greeting, off-topic, or single question, return an array with just the original message.

Examples:
Input: "What is COPPA? How do you authenticate users?"
Output: ["What is COPPA", "How do you authenticate users in online studies"]

Input: "Cos'è il CPHS? Quali metodi di autenticazione esistono?"
Output: ["Cos'è il CPHS", "Quali metodi di autenticazione esistono"]

Input: "Hello"
Output: ["Hello"]

User message: ${userMessage}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DECOMPOSITION_CONFIG.MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, // Bassa temperatura per output più deterministico
      }),
      signal: AbortSignal.timeout(DECOMPOSITION_CONFIG.TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error(`❌ [DECOMPOSITION] LLM request failed: ${response.status}`);
      return [userMessage];
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    
    if (!rawContent) {
      console.error('❌ [DECOMPOSITION] No content in LLM response');
      return [userMessage];
    }

    // Pulisci JSON da wrapper Markdown
    const cleanedJson = cleanJsonString(rawContent);
    
    // Parse JSON
    const queries = JSON.parse(cleanedJson);
    
    if (!Array.isArray(queries) || queries.length === 0) {
      console.error('❌ [DECOMPOSITION] Invalid array format');
      return [userMessage];
    }

    // Valida che tutti gli elementi siano stringhe e limita al MAX
    const validQueries = queries
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, DECOMPOSITION_CONFIG.MAX_QUERIES);
    
    if (validQueries.length === 0) {
      return [userMessage];
    }

    console.log(`✅ [DECOMPOSITION] Extracted ${validQueries.length} queries from message`);
    return validQueries;

  } catch (error) {
    console.error('❌ [DECOMPOSITION] Error:', error instanceof Error ? error.message : 'Unknown');
    // Fallback: ritorna messaggio originale
    return [userMessage];
  }
}

/**
 * Esegue semantic search in parallelo per ogni query e deduplica i risultati.
 * Rispetta il safety cap di MAX_TOTAL_CHUNKS per evitare Context Window Exceeded.
 */
async function parallelSemanticSearch(
  queries: string[], 
  agentId: string, 
  topKPerQuery: number,
  supabase: any
): Promise<{ 
  documents: any[], 
  queryBreakdown: Record<string, number> 
}> {
  console.log(`🔍 [PARALLEL-SEARCH] Executing ${queries.length} searches with topK=${topKPerQuery}`);
  
  const queryBreakdown: Record<string, number> = {};
  
  try {
    // Esegui tutte le ricerche in parallelo
    const searchPromises = queries.map(async (query) => {
      try {
        const { data, error } = await supabase.functions.invoke('semantic-search', {
          body: { query, agentId, topK: topKPerQuery }
        });
        
        if (error) {
          console.error(`❌ [PARALLEL-SEARCH] Error for query "${query}":`, error);
          queryBreakdown[query] = 0;
          return [];
        }
        
        const docs = Array.isArray(data) ? data : data?.documents || [];
        queryBreakdown[query] = docs.length;
        return docs;
        
      } catch (err) {
        console.error(`❌ [PARALLEL-SEARCH] Exception for query "${query}":`, err);
        queryBreakdown[query] = 0;
        return [];
      }
    });
    
    // Attendi tutte le ricerche
    const results = await Promise.all(searchPromises);
    
    // Flatten e deduplica per chunk ID
    const chunkMap = new Map<string, any>();
    
    for (const docs of results) {
      for (const doc of docs) {
        const chunkId = doc.id;
        
        // Se il chunk esiste già, mantieni quello con similarity più alta
        if (chunkMap.has(chunkId)) {
          const existing = chunkMap.get(chunkId);
          if ((doc.similarity || 0) > (existing.similarity || 0)) {
            chunkMap.set(chunkId, doc);
          }
        } else {
          chunkMap.set(chunkId, doc);
        }
      }
    }
    
    // Converti Map in array e ordina per similarity
    let uniqueDocs = Array.from(chunkMap.values())
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    
    // 📊 [BENCHMARK LOGGING] Log retrieval details for analysis
    console.log(`📊 [RETRIEVAL-STATS] Query Breakdown:`, JSON.stringify(queryBreakdown, null, 2));
    console.log(`📊 [RETRIEVAL-STATS] Total unique chunks: ${uniqueDocs.length}`);
    if (uniqueDocs.length > 0) {
      const topChunks = uniqueDocs.slice(0, 5);
      console.log(`📊 [RETRIEVAL-STATS] Top 5 chunks:`, topChunks.map(d => ({
        document: d.document_name,
        similarity: d.similarity?.toFixed(3),
        category: d.category,
        search_type: d.search_type
      })));
    }
    
    // SAFETY CAP: rispetta rigorosamente MAX_TOTAL_CHUNKS
    if (uniqueDocs.length > DECOMPOSITION_CONFIG.MAX_TOTAL_CHUNKS) {
      console.log(`⚠️ [SAFETY-CAP] Limiting ${uniqueDocs.length} chunks to ${DECOMPOSITION_CONFIG.MAX_TOTAL_CHUNKS}`);
      uniqueDocs = uniqueDocs.slice(0, DECOMPOSITION_CONFIG.MAX_TOTAL_CHUNKS);
    }
    
    console.log(`✅ [PARALLEL-SEARCH] Retrieved ${uniqueDocs.length} unique chunks after deduplication`);
    
    return { documents: uniqueDocs, queryBreakdown };
    
  } catch (error) {
    console.error('❌ [PARALLEL-SEARCH] Fatal error:', error);
    return { documents: [], queryBreakdown };
  }
}

// Helper function to generate query variants with full transparency
function generateQueryVariants(originalTopic: string): string[] {
  const queries: string[] = [];
  
  // 1. Topic originale completo con quotes e "PDF"
  queries.push(`"${originalTopic}" PDF`);
  
  // 2. Rimuovi parole comuni ("filler words")
  const fillers = ['complete', 'guidebook', 'handbook', 'comprehensive', 'ultimate', 'guide', 'definitive', 'essential'];
  let simplified = originalTopic;
  fillers.forEach(word => {
    simplified = simplified.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').trim().replace(/\s+/g, ' ');
  });
  
  if (simplified !== originalTopic && simplified.length > 3) {
    queries.push(`"${simplified}" PDF`);
  }
  
  // 3. Prime 3 parole chiave + "PDF book"
  const words = originalTopic.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 3) {
    queries.push(`${words.slice(0, 3).join(' ')} PDF book`);
  }
  
  // 4. Prime 2 parole + "guide PDF"
  if (words.length > 2) {
    queries.push(`${words.slice(0, 2).join(' ')} guide PDF`);
  }
  
  // 5. Senza quotes + "PDF"
  queries.push(`${originalTopic} PDF`);
  
  // Rimuovi duplicati mantenendo l'ordine
  return [...new Set(queries)];
}

// ============================================================================
// QUERY DECOMPOSITION CONFIGURATION
// ============================================================================
const DECOMPOSITION_CONFIG = {
  MODEL: 'google/gemini-2.5-flash',  // LLM veloce per decomposizione
  MAX_QUERIES: 10,                    // Massimo query decomposte
  TOP_K_PER_QUERY: 15,                // INCREASED: 5→15 per maggior recall (Benchmark tuning)
  MAX_TOTAL_CHUNKS: 25,               // Limite finale dopo merge
  TIMEOUT_MS: 5000,                   // Timeout per chiamata LLM
  MIN_MESSAGE_LENGTH: 30              // Sotto questa lunghezza, skip decomposizione
};

interface SearchResult {
  number: number;
  title: string;
  authors?: string;
  year?: string;
  source?: string;
  url: string;
  snippet?: string;
  credibilityScore?: number;
  source_type?: string;
  verified?: boolean;
  file_size_bytes?: number;
}

// ============================================
// DETERMINISTIC WORKFLOW HELPERS
// ============================================

interface ConversationState {
  conversationId: string;
  lastProposedQuery: string | null;
  waitingForConfirmation: boolean;
  lastSearchResults: SearchResult[] | null;
}

// ========================================
// CONVERSATION STATE PERSISTENCE (DATABASE)
// Stato salvato nel DB invece che in memoria per persistenza tra richieste
// ========================================

async function getConversationState(conversationId: string, supabaseClient: any): Promise<ConversationState> {
  const { data } = await supabaseClient
    .from('agent_conversations')
    .select('last_proposed_query, waiting_for_confirmation')
    .eq('id', conversationId)
    .single();

  console.log(`📖 [WORKFLOW] State loaded from DB for conversation ${conversationId}:`, data);

  return {
    conversationId,
    lastProposedQuery: data?.last_proposed_query || null,
    waitingForConfirmation: data?.waiting_for_confirmation || false,
    lastSearchResults: null
  };
}

async function updateConversationState(conversationId: string, updates: Partial<ConversationState>, supabaseClient: any) {
  const dbUpdates: any = {
    workflow_updated_at: new Date().toISOString()
  };
  
  if ('lastProposedQuery' in updates) {
    dbUpdates.last_proposed_query = updates.lastProposedQuery;
  }
  if ('waitingForConfirmation' in updates) {
    dbUpdates.waiting_for_confirmation = updates.waitingForConfirmation;
  }

  await supabaseClient
    .from('agent_conversations')
    .update(dbUpdates)
    .eq('id', conversationId);
    
  console.log(`💾 [WORKFLOW] State persisted to DB for conversation ${conversationId}:`, dbUpdates);
}

// Pattern detection for query proposals
function detectProposedQuery(text: string): string | null {
  console.log(`🔍 [PATTERN] Checking for proposed query in text: "${text.substring(0, 200)}..."`);
  
  // Patterns: "Vuoi quindi che ricerco per '[QUERY]'?"
  //           "Ti propongo: [QUERY]"
  //           "Provo con: [QUERY]"
  // UPDATED: Now supports both ASCII and Unicode quotes (', ', ", ", etc.)
  const patterns = [
    /vuoi\s+(?:quindi\s+)?che\s+ricerco\s+per\s+['""''‚‛„‟‹›«»]([^'""''‚‛„‟‹›«»]+)['""''‚‛„‟‹›«»]?\??/i,
    /ti\s+propongo:?\s+([^.\n?]+)/i,
    /provo\s+con:?\s+([^.\n?]+)/i,
    /cerco:?\s+([^.\n?]+)/i,
    // Fallback: works even if quotes are inconsistent or missing
    /vuoi\s+(?:quindi\s+)?che\s+ricerco\s+per\s+(.+?)\??$/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const extractedQuery = match[1].trim();
      console.log(`✅ [PATTERN] Detected proposed query: "${extractedQuery}"`);
      return extractedQuery;
    }
  }
  
  console.log('❌ [PATTERN] No proposed query detected');
  return null;
}

// Pattern detection for user confirmations
function isConfirmation(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  const confirmationWords = ['ok', 'sì', 'si', 'yes', 'va bene', 'perfetto', 'esatto', 'corretto', 'vai', 'proceed', 'accordo', "d'accordo", 'certo', 'assolutamente', 'confermo'];
  
  // Check if the trimmed message is exactly one of the confirmation words
  if (confirmationWords.includes(trimmed)) {
    return true;
  }
  
  // Also check if message starts with confirmation word (allows trailing punctuation)
  return confirmationWords.some(word => trimmed === word || trimmed.startsWith(word + ' ') || trimmed.startsWith(word + '.') || trimmed.startsWith(word + '!'));
}

// Pattern detection for "altra query" requests
function isNewQueryRequest(text: string): boolean {
  const newQueryPatterns = /(altra\s+query|query\s+diversa|prova\s+(un[''])?altra|cambia\s+query|diversa|altro\s+tentativo)/i;
  return newQueryPatterns.test(text);
}

// ============================================
// AUTO-CONTINUATION SYSTEM
// ============================================

/**
 * Detects if a response is incomplete based on various indicators
 */
function isResponseIncomplete(content: string): boolean {
  const trimmed = content.trim();
  
  // Check 1: Ends with incomplete code block
  const codeBlockStarts = (trimmed.match(/```/g) || []).length;
  if (codeBlockStarts % 2 !== 0) {
    console.log('🔍 [INCOMPLETE] Detected unclosed code block');
    return true;
  }
  
  // Check 2: Ends with incomplete Python/JS code patterns
  const incompleteCodePatterns = [
    /for\s+\w+\s+in\s+\w+:\s*$/,  // Python for loop without body
    /def\s+\w+\([^)]*\):\s*$/,     // Python function def without body
    /if\s+[^:]+:\s*$/,             // Python if without body
    /class\s+\w+.*:\s*$/,          // Python class without body
    /\{\s*$/,                      // Opening brace without content
    /function\s+\w+\([^)]*\)\s*\{\s*$/,  // JS function without body
    /=>\s*\{\s*$/,                 // Arrow function without body
  ];
  
  for (const pattern of incompleteCodePatterns) {
    if (pattern.test(trimmed)) {
      console.log('🔍 [INCOMPLETE] Detected incomplete code pattern:', pattern);
      return true;
    }
  }
  
  // Check 3: Ends with incomplete sentence indicators
  const incompleteSentencePatterns = [
    /,\s*$/,           // Ends with comma
    /:\s*$/,           // Ends with colon (but not in code block)
    /\(\s*$/,          // Unclosed parenthesis
    /\[\s*$/,          // Unclosed bracket
  ];
  
  // Only check sentence patterns if not in a code block context
  const lastLine = trimmed.split('\n').slice(-1)[0];
  if (!lastLine.includes('```')) {
    for (const pattern of incompleteSentencePatterns) {
      if (pattern.test(trimmed)) {
        console.log('🔍 [INCOMPLETE] Detected incomplete sentence:', pattern);
        return true;
      }
    }
  }
  
  // Check 4: Very abrupt endings (content length check)
  // If the response is less than expected minimum and doesn't end with punctuation
  const endsWithProperPunctuation = /[.!?]\s*$/.test(trimmed);
  const hasMinimumLength = content.length > 100;
  
  if (hasMinimumLength && !endsWithProperPunctuation && !trimmed.endsWith('```')) {
    console.log('🔍 [INCOMPLETE] No proper ending punctuation');
    return true;
  }
  
  return false;
}


/**
 * Triggers async continuation via dedicated edge function (fire-and-forget)
 */
async function triggerAsyncContinuation(
  supabaseClient: any,
  messageId: string,
  conversationId: string,
  currentContent: string,
  agentId: string,
  messages: Message[],
  systemPrompt: string,
  requestId: string
): Promise<void> {
  console.log(`🚀 [REQ-${requestId}] Triggering async continuation for message ${messageId}...`);
  
  // Fire-and-forget: non aspetta il risultato
  supabaseClient.functions.invoke('continue-deepseek-response', {
    body: {
      messageId,
      conversationId,
      currentContent,
      agentId,
      messages,
      systemPrompt,
      requestId
    }
  }).catch((err: any) => {
    console.error(`❌ [REQ-${requestId}] Failed to trigger continuation:`, err);
  });
  
  console.log(`✅ [REQ-${requestId}] Continuation triggered (running in background)`);
}

// ============================================
// INTENT PARSING
// ============================================

function parseKnowledgeSearchIntent(message: string): UserIntent {
  console.log('🧠 [INTENT PARSER] Analyzing message:', message.slice(0, 100));
  const lowerMsg = message.toLowerCase().trim();
  
  // Extract requested count (e.g., "find 20 PDFs", "5 documents", "get 50 papers")
  const countMatch = message.match(/\b(\d+)\s+(?:pdf|pdfs|document|documents|result|results|file|files|paper|papers)/i);
  const requestedCount = countMatch ? Math.min(parseInt(countMatch[1]), 100) : 10; // Default 10, max 100
  console.log('📊 [INTENT PARSER] Requested count:', requestedCount);
  
  // SEARCH REQUEST: "Find PDFs on...", "Search for...", "Look for...", Italian patterns
  const searchPatterns = [
    // English patterns - STRICT (with "on/about/regarding")
    /find\s+(?:pdf|pdfs|papers?|documents?|articles?)\s+(?:on|about|regarding)/i,
    /search\s+(?:for\s+)?(?:pdf|pdfs|papers?)\s+(?:on|about|regarding)/i,
    /look\s+(?:for\s+)?(?:pdf|pdfs|papers?)\s+(?:on|about|regarding)/i,
    /\d+\s+(?:pdf|pdfs|papers?|documents?)\s+(?:on|about|regarding)/i, // "20 PDFs on..."
    
    // English patterns - FLEXIBLE (topic before pdf)
    /(?:find|search|look\s+for|get)\s+.{3,80}\s+(?:pdf|pdfs|papers?|documents?|articles?)$/i,  // "Find [topic] pdf"
    /(?:find|search|look\s+for|get)\s+(?:\d+\s+)?.{3,80}\s+(?:pdf|pdfs|papers?|documents?|articles?)$/i,  // "Find 5 [topic] pdf"
    
    // Italian patterns
    /cerca\s+(?:pdf|articoli?|documenti?|paper)/i,
    /trova\s+(?:pdf|articoli?|documenti?|paper)/i,
    /dammi\s+(?:\d+\s+)?(?:pdf|articoli?|documenti?|paper)/i,
    /ricerca\s+(?:pdf|articoli?|documenti?|paper)/i,
    /voglio\s+(?:\d+\s+)?(?:pdf|articoli?|documenti?|paper)/i,
    /mi\s+(?:servono?|occorrono?)\s+(?:\d+\s+)?(?:pdf|articoli?|paper)/i,
    
    // More flexible patterns
    /(?:pdf|papers?|documents?|articoli?)\s+(?:su|on|about|riguardo|regarding)\s+/i,
    /\d+\s+(?:pdf|paper|articoli?)\s+/i  // "5 PDF machine learning"
  ];
  
  for (const pattern of searchPatterns) {
    if (pattern.test(message)) {
      let topic = message.replace(pattern, '').replace(/\b\d+\b/g, '').trim(); // Remove pattern and standalone numbers
      
      // Additional cleanup: remove common keywords
      topic = topic.replace(/\b(pdf|pdfs|paper|papers|articolo|articoli|documento|documenti)\b/gi, '').trim();
      
      // Fallback: if topic is too short, take everything after first 3 words
      if (!topic || topic.length < 3) {
        const words = message.split(/\s+/);
        topic = words.slice(3).join(' ').trim();
      }
      
      console.log('✅ [INTENT PARSER] Detected SEARCH_REQUEST for topic:', topic);
      return { type: 'SEARCH_REQUEST', topic, count: requestedCount };
    }
  }
  
  // AUTO-DETECT SIMPLE TOPIC: If user just pastes a topic without explicit command
  // Check if message looks like a simple search topic (no questions, short, few words)
  const wordCount = message.trim().split(/\s+/).length;
  const hasQuestionMark = message.includes('?');
  const hasExplicitAction = /\b(cerca|trova|dammi|voglio|search|find|look for|mi servono|download|get|scarica|show|filter)\b/i.test(message);
  const isReasonableLength = message.length >= 5 && message.length <= 100;
  const isShortPhrase = wordCount >= 1 && wordCount <= 10;
  
  if (!hasQuestionMark && !hasExplicitAction && isReasonableLength && isShortPhrase) {
    // This looks like a simple topic - auto-add "find pdf on" prefix
    const autoTopic = message.trim();
    console.log('🎯 [INTENT PARSER] AUTO-DETECTED simple topic, treating as search:', autoTopic);
    console.log('✅ [INTENT PARSER] Auto-wrapped as: "find pdf on ' + autoTopic + '"');
    return { type: 'SEARCH_REQUEST', topic: autoTopic, count: requestedCount };
  }
  
  // Check for vague search intent to provide feedback
  const hasSearchIntent = /\b(cerca|trova|dammi|voglio|search|find|look for|mi servono|mi occorrono)\b/i.test(message);
  const hasTopicWords = /\b(pdf|paper|articol|document)\b/i.test(message);
  
  if (hasSearchIntent && hasTopicWords) {
    console.log('⚠️ [INTENT PARSER] Vague search intent detected, may need AI guidance');
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

// Anti-paywall detection (Webb 2017 best practice)
async function checkPaywall(url: string): Promise<{
  hasPaywall: boolean;
  indicators: string[];
}> {
  try {
    console.log(`🔒 [PAYWALL CHECK] Testing: ${url.slice(0, 60)}...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        return { hasPaywall: true, indicators: [`HTTP ${response.status}`] };
      }
      return { hasPaywall: false, indicators: [] };
    }
    
    const html = await response.text();
    const htmlLower = html.toLowerCase();
    
    const PAYWALL_INDICATORS = [
      'login', 'signin', 'sign in', 'sign-in',
      'purchase', 'subscribe', 'subscription',
      'institutional access', 'buy article',
      'purchase pdf', 'download pdf requires',
      'paywall', 'access denied',
      'this content is not available',
      'create account to read'
    ];
    
    const foundIndicators = PAYWALL_INDICATORS.filter(indicator => 
      htmlLower.includes(indicator)
    );
    
    if (foundIndicators.length > 0) {
      console.log(`⚠️ [PAYWALL] Detected indicators:`, foundIndicators.slice(0, 3));
      return { hasPaywall: true, indicators: foundIndicators };
    }
    
    console.log(`✅ [PAYWALL CHECK] No paywall detected`);
    return { hasPaywall: false, indicators: [] };
    
  } catch (error) {
    console.error(`⚠️ [PAYWALL CHECK] Error:`, error);
    return { hasPaywall: false, indicators: [] };
  }
}

async function executeEnhancedSearch(topic: string, count: number = 10, supabaseClient: any): Promise<SearchResult[]> {
  console.log('🔍 [ENHANCED SEARCH] Direct PDF search for:', topic);
  console.log(`📊 Requested count: ${count}`);
  
  try {
    const apiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      console.error('❌ Missing Google Custom Search credentials');
      return await executeWebSearch(topic, count);
    }
    
    // PHASE 1: Multi-domain direct PDF search
    console.log('📚 [PHASE 1] Multi-domain PDF search...');
    
    // Create 3 search queries targeting different domains - prioritizing books
    const searchQueries = [
      // Query 1: Academic sources (NO book filter obbligatorio)
      `${topic} filetype:pdf (site:edu OR site:ac.uk OR site:edu.au)`,
      
      // Query 2: Publishers + comprehensive content (suggerisce ma non forza)
      `${topic} filetype:pdf (site:springer.com OR site:ieee.org OR site:acm.org OR site:oreilly.com OR site:manning.com) (book OR handbook OR guide OR comprehensive)`,
      
      // Query 3: General open access (include research papers)
      `${topic} filetype:pdf (article OR paper OR study OR research OR guide OR handbook)`
    ];
    
    const allPdfResults: any[] = [];
    const seenUrls = new Set<string>();
    
    // Execute searches in parallel for speed
    const searchPromises = searchQueries.map(async (query, queryIndex) => {
      console.log(`🔍 Query ${queryIndex + 1}/3: ${query.slice(0, 80)}...`);
      
      try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=10`;
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`❌ Query ${queryIndex + 1} failed:`, response.status);
          return [];
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
          console.log(`ℹ️ Query ${queryIndex + 1}: no results`);
          return [];
        }
        
        console.log(`✅ Query ${queryIndex + 1}: ${data.items.length} results`);
        return data.items.map((item: any) => ({
          title: item.title.replace(' [PDF]', '').trim(),
          url: item.link,
          snippet: item.snippet || '',
          domain: new URL(item.link).hostname
        }));
      } catch (error) {
        console.error(`❌ Query ${queryIndex + 1} error:`, error);
        return [];
      }
    });
    
    const searchResults = await Promise.all(searchPromises);
    
    // STRATIFIED SAMPLING: Separate results by query type (Hewson 2014 methodology)
    const eduResults: any[] = [];
    const publisherResults: any[] = [];
    const generalResults: any[] = [];
    
    const eduUrls = new Set<string>();
    const publisherUrls = new Set<string>();
    const generalUrls = new Set<string>();
    
    // Deduplicate within each category
    for (const result of searchResults[0]) {
      if (!eduUrls.has(result.url)) {
        eduUrls.add(result.url);
        eduResults.push(result);
      }
    }
    
    for (const result of searchResults[1]) {
      if (!eduUrls.has(result.url) && !publisherUrls.has(result.url)) {
        publisherUrls.add(result.url);
        publisherResults.push(result);
      }
    }
    
    for (const result of searchResults[2]) {
      if (!eduUrls.has(result.url) && 
          !publisherUrls.has(result.url) && 
          !generalUrls.has(result.url)) {
        generalUrls.add(result.url);
        generalResults.push(result);
      }
    }
    
    console.log(`✅ [PHASE 1] Stratified results: .edu=${eduResults.length}, publishers=${publisherResults.length}, general=${generalResults.length}`);
    
    if (eduResults.length === 0 && publisherResults.length === 0 && generalResults.length === 0) {
      console.log('⚠️ No PDFs found, falling back to simple search');
      return await executeWebSearch(topic, count);
    }
    
    // STRATIFIED SELECTION: Apply weighting (50% .edu, 30% publishers, 20% general)
    const WEIGHTS = {
      edu: 0.5,
      publishers: 0.3,
      general: 0.2
    };
    
    const eduCount = Math.ceil(count * WEIGHTS.edu);
    const publisherCount = Math.ceil(count * WEIGHTS.publishers);
    const generalCount = Math.ceil(count * WEIGHTS.general);
    
    console.log(`📊 [STRATIFIED SELECTION] Target: .edu=${eduCount}, publishers=${publisherCount}, general=${generalCount}`);
    
    const selectedEdu = eduResults.slice(0, eduCount);
    const selectedPublishers = publisherResults.slice(0, publisherCount);
    const selectedGeneral = generalResults.slice(0, generalCount);
    
    const topResults = [
      ...selectedEdu,
      ...selectedPublishers,
      ...selectedGeneral
    ].slice(0, count * 2);
    
    console.log(`✅ [STRATIFIED] Selected ${topResults.length} PDFs (edu=${selectedEdu.length}, pub=${selectedPublishers.length}, gen=${selectedGeneral.length})`);
    
    // PHASE 2: Extract metadata for enrichment
    console.log(`📊 [PHASE 2] Extracting metadata for ${topResults.length} PDFs...`);
    
    const urls = topResults.map(r => r.url);
    let metadataList: any[] = [];
    
    try {
      const { data: metadataData, error: metadataError } = await supabaseClient.functions.invoke(
        'metadata-extractor',
        { body: { urls } }
      );
      
      if (metadataError) {
        console.error('⚠️ Metadata extraction failed:', metadataError);
      } else {
        metadataList = metadataData?.metadata || [];
        console.log(`✅ [PHASE 2] Extracted metadata for ${metadataList.length} PDFs`);
      }
    } catch (error) {
      console.error('⚠️ Metadata extraction error:', error);
    }
    
    // PHASE 2.5: Check for paywalls on top results (Webb 2017 anti-paywall strategy)
    console.log(`🔒 [PHASE 2.5] Checking for paywalls on top ${Math.min(10, topResults.length)} results...`);
    
    const paywallChecks = await Promise.all(
      topResults.slice(0, 10).map(async (pdf: any) => {
        const check = await checkPaywall(pdf.url);
        return { url: pdf.url, ...check };
      })
    );
    
    const paywallMap = new Map(
      paywallChecks.map(check => [check.url, check])
    );
    
    console.log(`✅ [PHASE 2.5] Paywall check completed. Found ${paywallChecks.filter(c => c.hasPaywall).length} paywalled PDFs`);
    
    // PHASE 3: Merge data and calculate credibility with book prioritization
    console.log('🎯 [PHASE 3] Enriching results with smart book scoring...');
    
    const enrichedResults: SearchResult[] = topResults.map((pdf: any, index: number) => {
      const metadata = metadataList[index] || {};
      
      // Calculate base credibility score based on domain
      let credibilityScore = 3; // Default
      const domain = pdf.domain.toLowerCase();
      
      if (domain.endsWith('.edu')) {
        credibilityScore = 10;
      } else if (domain.includes('arxiv')) {
        credibilityScore = 9;
      } else if (['springer.com', 'ieee.org', 'acm.org', 'nature.com', 'science.org'].some(d => domain.includes(d))) {
        credibilityScore = 8;
      } else if (['oreilly.com', 'manning.com', 'packtpub.com', 'wiley.com'].some(d => domain.includes(d))) {
        credibilityScore = 6;
      } else if (domain.includes('researchgate') || domain.includes('academia')) {
        credibilityScore = 5;
      }
      
      // BOOK DETECTION BONUS: Check for book-related keywords in title
      const title = pdf.title.toLowerCase();
      const isLikelyBook = 
        title.includes('book') || 
        title.includes('textbook') || 
        title.includes('handbook') || 
        title.includes('guide') ||
        title.includes('manual');
      
      if (isLikelyBook) {
        credibilityScore = Math.min(10, credibilityScore + 2);
        console.log(`📚 Book keyword detected: "${pdf.title.slice(0, 60)}..." (+2 score → ${credibilityScore})`);
      }
      
      // FILE SIZE BONUS/PENALTY: Reward large files (books), penalize small files (articles)
      const fileSizeBytes = metadata.file_size_bytes;
      if (fileSizeBytes !== null && fileSizeBytes !== undefined) {
        const fileSizeMB = fileSizeBytes / 1024 / 1024;
        
        if (fileSizeMB > 3) {
          // Likely a book (>3MB)
          credibilityScore = Math.min(10, credibilityScore + 2);
          console.log(`📚 Large file (${fileSizeMB.toFixed(1)}MB): "${pdf.title.slice(0, 60)}..." (+2 score → ${credibilityScore})`);
        } else if (fileSizeMB >= 1 && fileSizeMB <= 3) {
          // Likely a handbook/comprehensive guide (1-3MB)
          credibilityScore = Math.min(10, credibilityScore + 1);
          console.log(`📖 Medium file (${fileSizeMB.toFixed(1)}MB): "${pdf.title.slice(0, 60)}..." (+1 score → ${credibilityScore})`);
        } else if (fileSizeMB < 0.5) {
          // Very small article
          credibilityScore = Math.max(1, credibilityScore - 2);
          console.log(`📄 Very small file (${fileSizeMB.toFixed(1)}MB): "${pdf.title.slice(0, 60)}..." (-2 score → ${credibilityScore})`);
        }
      }
      
      // PAYWALL PENALTY: Severely penalize paywalled content (Webb 2017)
      const paywallCheck = paywallMap.get(pdf.url);
      let accessType: 'open' | 'restricted' = 'open';
      
      if (paywallCheck?.hasPaywall) {
        credibilityScore = Math.max(1, credibilityScore - 5);
        accessType = 'restricted';
        console.log(`🔒 Paywall detected for "${pdf.title.slice(0, 60)}..." (-5 score → ${credibilityScore})`);
      }
      
      // Extract year from metadata or snippet
      const year = metadata.year?.toString() ||
                   pdf.snippet.match(/\b(19|20)\d{2}\b/)?.[0] || 
                   null;
      
      // Extract authors from metadata or snippet
      const authors = metadata.authors?.join(', ') || 
                     pdf.snippet.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/)?.[0] || 
                     null;
      
      return {
        number: index + 1,
        title: pdf.title,
        authors,
        year,
        source: pdf.domain,
        url: pdf.url,
        credibilityScore,
        source_type: metadata.source_type || 'web',
        verified: true,
        file_size_bytes: metadata.file_size_bytes || null,
        accessType
      };
    });
    
    // PHASE 3.5: Semantic relevance boost
    console.log('🎯 [PHASE 3.5] Applying semantic relevance boost...');
    
    const topicKeywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    console.log(`🔍 Topic keywords for relevance check: ${topicKeywords.join(', ')}`);
    
    enrichedResults.forEach((result) => {
      const titleLower = result.title.toLowerCase();
      
      // Count how many topic keywords appear in title
      const keywordMatches = topicKeywords.filter(keyword => 
        titleLower.includes(keyword)
      ).length;
      
      const relevanceRatio = keywordMatches / topicKeywords.length;
      
      // Boost score if highly relevant
      if (relevanceRatio >= 0.7) {
        // 70%+ keywords matched → strong relevance
        result.credibilityScore = Math.min(10, (result.credibilityScore || 0) + 2);
        console.log(`🎯 High relevance: "${result.title.slice(0, 60)}..." (${(relevanceRatio * 100).toFixed(0)}% match, +2 score)`);
      } else if (relevanceRatio >= 0.4) {
        // 40-69% keywords matched → medium relevance
        result.credibilityScore = Math.min(10, (result.credibilityScore || 0) + 1);
        console.log(`🎯 Medium relevance: "${result.title.slice(0, 60)}..." (${(relevanceRatio * 100).toFixed(0)}% match, +1 score)`);
      } else if (relevanceRatio < 0.3) {
        // <30% keywords matched → tangential, penalize
        result.credibilityScore = Math.max(1, (result.credibilityScore || 0) - 1);
        console.log(`⚠️ Low relevance: "${result.title.slice(0, 60)}..." (${(relevanceRatio * 100).toFixed(0)}% match, -1 score)`);
      }
    });
    
    console.log(`✅ [PHASE 3.5] Semantic relevance scoring completed`);
    
    // PHASE 4: Quality filtering & sorting (prioritize books)
    console.log('✨ [PHASE 4] Quality filtering & sorting (books first)...');
    
    // Sort by: 1) credibility score, 2) file size (bigger = better), 3) year (recent = better)
    enrichedResults.sort((a, b) => {
      const scoreA = a.credibilityScore || 0;
      const scoreB = b.credibilityScore || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      
      // If same credibility, prefer larger files (books)
      const sizeA = a.file_size_bytes || 0;
      const sizeB = b.file_size_bytes || 0;
      if (sizeB !== sizeA) return sizeB - sizeA;
      
      // If same size, prefer recent
      const yearA = parseInt(a.year || '0');
      const yearB = parseInt(b.year || '0');
      return yearB - yearA;
    });
    
    // Take top N and renumber
    const finalResults = enrichedResults.slice(0, count).map((r, idx) => ({
      ...r,
      number: idx + 1
    }));
    
    console.log(`✅ [ENHANCED SEARCH] Completed: ${finalResults.length} results (requested: ${count})`);
    console.log(`📊 Quality breakdown:`);
    console.log(`   - High (8-10): ${finalResults.filter(r => (r.credibilityScore || 0) >= 8).length}`);
    console.log(`   - Medium (5-7): ${finalResults.filter(r => (r.credibilityScore || 0) >= 5 && (r.credibilityScore || 0) < 8).length}`);
    console.log(`   - Standard (1-4): ${finalResults.filter(r => (r.credibilityScore || 0) < 5).length}`);
    
    return finalResults;
    
  } catch (error) {
    console.error('❌ [ENHANCED SEARCH] Error:', error);
    console.log('⚠️ Falling back to simple search');
    return await executeWebSearch(topic, count);
  }
}

// ============================================
// REPOSITORY API INTEGRATION
// ============================================

// Helper: Detect if topic is Computer Science related
function isComputerScienceTopic(topic: string): boolean {
  const csKeywords = [
    'machine learning', 'deep learning', 'neural network', 'artificial intelligence', 'ai',
    'computer science', 'algorithm', 'data structure', 'programming', 'software',
    'database', 'network', 'security', 'cryptography', 'compiler', 'operating system',
    'distributed system', 'cloud computing', 'blockchain', 'quantum computing'
  ];
  
  const lowerTopic = topic.toLowerCase();
  return csKeywords.some(keyword => lowerTopic.includes(keyword));
}

// Helper: Detect if topic is Medical/Biological
function isMedicalBioTopic(topic: string): boolean {
  const medBioKeywords = [
    'medicine', 'medical', 'biology', 'biomedical', 'health', 'disease',
    'cancer', 'therapy', 'clinical', 'patient', 'drug', 'pharmaceutical',
    'gene', 'protein', 'cell', 'molecular', 'biochemistry', 'genetics',
    'neuroscience', 'immunology', 'epidemiology', 'pathology'
  ];
  
  const lowerTopic = topic.toLowerCase();
  return medBioKeywords.some(keyword => lowerTopic.includes(keyword));
}

// arXiv API Query
async function queryArxivAPI(topic: string, maxResults: number = 10): Promise<SearchResult[]> {
  console.log(`📚 [arXiv API] Searching for: ${topic}`);
  
  try {
    // arXiv API endpoint
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)' }
    });
    
    if (!response.ok) {
      console.error(`❌ [arXiv API] HTTP ${response.status}`);
      return [];
    }
    
    const xmlText = await response.text();
    
    // Parse XML (simple regex-based parsing for key fields)
    const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    
    const results: SearchResult[] = entries.map((entry, index) => {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/s);
      const summaryMatch = entry.match(/<summary>(.*?)<\/summary>/s);
      const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
      const authorsMatch = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g);
      const idMatch = entry.match(/<id>(.*?)<\/id>/);
      
      const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || 'Untitled';
      const year = publishedMatch?.[1]?.match(/\d{4}/)?.[0] || undefined;
      const authors = authorsMatch?.map(a => a.match(/<name>(.*?)<\/name>/)?.[1]).filter(Boolean).join(', ') || undefined;
      const arxivId = idMatch?.[1]?.match(/(\d+\.\d+)/)?.[1];
      const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;
      
      return {
        number: index + 1,
        title,
        authors,
        year,
        source: 'arxiv.org',
        url: pdfUrl || idMatch?.[1] || '',
        credibilityScore: 9,
        source_type: 'arxiv_api',
        verified: true,
        file_size_bytes: undefined
      };
    }).filter(r => r.url);
    
    console.log(`✅ [arXiv API] Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error(`❌ [arXiv API] Error:`, error);
    return [];
  }
}

// PubMed Central API Query
async function queryPubMedAPI(topic: string, maxResults: number = 10): Promise<SearchResult[]> {
  console.log(`🏥 [PubMed API] Searching for: ${topic}`);
  
  try {
    // Step 1: Search for PMC IDs
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(topic)}&retmax=${maxResults}&retmode=json&sort=relevance`;
    
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      console.error(`❌ [PubMed API] Search HTTP ${searchResponse.status}`);
      return [];
    }
    
    const searchData = await searchResponse.json();
    const pmcIds = searchData.esearchresult?.idlist || [];
    
    if (pmcIds.length === 0) {
      console.log(`ℹ️ [PubMed API] No results found`);
      return [];
    }
    
    console.log(`📊 [PubMed API] Found ${pmcIds.length} PMC IDs`);
    
    // Step 2: Fetch details for each PMC ID
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${pmcIds.join(',')}&retmode=json`;
    
    const summaryResponse = await fetch(summaryUrl);
    if (!summaryResponse.ok) {
      console.error(`❌ [PubMed API] Summary HTTP ${summaryResponse.status}`);
      return [];
    }
    
    const summaryData = await summaryResponse.json();
    const articles = summaryData.result;
    
    const results = pmcIds.map((pmcId: string, index: number): SearchResult | null => {
      const article = articles[pmcId];
      if (!article) return null;
      
      const title = article.title || 'Untitled';
      const authors = article.authors?.map((a: any) => a.name).join(', ') || undefined;
      const year = article.pubdate?.match(/\d{4}/)?.[0] || undefined;
      const pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`;
      
      return {
        number: index + 1,
        title,
        authors,
        year,
        source: 'pubmed.ncbi.nlm.nih.gov',
        url: pdfUrl,
        credibilityScore: 9,
        source_type: 'pubmed_api',
        verified: true,
        file_size_bytes: undefined
      };
    }).filter((r: SearchResult | null): r is SearchResult => r !== null);
    
    console.log(`✅ [PubMed API] Found ${results.length} results with PDF links`);
    return results;
    
  } catch (error) {
    console.error(`❌ [PubMed API] Error:`, error);
    return [];
  }
}

// CORE API Query
async function queryCoreAPI(topic: string, maxResults: number = 10): Promise<SearchResult[]> {
  console.log(`📖 [CORE API] Searching for: ${topic}`);
  
  try {
    // CORE API v3 (open access research papers)
    const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(topic)}&limit=${maxResults}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`❌ [CORE API] HTTP ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const items = data.results || [];
    
    if (items.length === 0) {
      console.log(`ℹ️ [CORE API] No results found`);
      return [];
    }
    
    const results: SearchResult[] = items.map((item: any, index: number) => {
      const title = item.title || 'Untitled';
      const authors = item.authors?.join(', ') || undefined;
      const year = item.yearPublished?.toString() || undefined;
      
      // Try to get download URL
      const pdfUrl = item.downloadUrl || item.sourceFulltextUrls?.[0];
      
      if (!pdfUrl) return null;
      
      return {
        number: index + 1,
        title,
        authors,
        year,
        source: item.publisher || 'core.ac.uk',
        url: pdfUrl,
        credibilityScore: 6, // CORE = open access repository
        source_type: 'core_api',
        verified: true,
        file_size_bytes: undefined
      };
    }).filter((r: SearchResult | null): r is SearchResult => r !== null);
    
    console.log(`✅ [CORE API] Found ${results.length} results with download links`);
    return results;
    
  } catch (error) {
    console.error(`❌ [CORE API] Error:`, error);
    return [];
  }
}

// Crossref API Query (Google Scholar proxy for general topics)
async function queryCrossrefAPI(topic: string, maxResults: number = 10): Promise<SearchResult[]> {
  console.log(`📚 [Crossref API] Searching for: ${topic}`);
  
  try {
    // Crossref API (gratuito, no key necessaria)
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(topic)}&rows=${maxResults}&filter=type:book-chapter,type:monograph,type:journal-article&sort=relevance`;
    
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'ResearchBot/1.0 (mailto:research@example.com)',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`❌ [Crossref API] HTTP ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const items = data.message?.items || [];
    
    if (items.length === 0) {
      console.log(`ℹ️ [Crossref API] No results found`);
      return [];
    }
    
    const results: SearchResult[] = items.map((item: any, index: number) => {
      const title = item.title?.[0] || 'Untitled';
      const authors = item.author?.map((a: any) => 
        `${a.given || ''} ${a.family || ''}`.trim()
      ).join(', ') || undefined;
      const year = item.published?.['date-parts']?.[0]?.[0]?.toString() || undefined;
      
      // Try to find PDF link
      let pdfUrl = item.link?.find((l: any) => 
        l['content-type'] === 'application/pdf'
      )?.URL;
      
      if (!pdfUrl && item.URL) {
        pdfUrl = item.URL;
      }
      
      if (!pdfUrl) return null;
      
      return {
        number: index + 1,
        title,
        authors,
        year,
        source: item.publisher || 'crossref.org',
        url: pdfUrl,
        credibilityScore: 7, // Crossref = curated database
        source_type: 'crossref_api',
        verified: true,
        file_size_bytes: undefined
      };
    }).filter((r: SearchResult | null): r is SearchResult => r !== null);
    
    console.log(`✅ [Crossref API] Found ${results.length} results with links`);
    return results;
    
  } catch (error) {
    console.error(`❌ [Crossref API] Error:`, error);
    return [];
  }
}

// Main enrichment function
async function enrichWithRepositoryAPIs(
  googleResults: SearchResult[], 
  topic: string
): Promise<SearchResult[]> {
  console.log(`\n🔌 [API ENRICHMENT] Starting repository API enrichment for: "${topic}"`);
  console.log(`📊 [API ENRICHMENT] Google results: ${googleResults.length}`);
  
  const apiResults: SearchResult[] = [];
  
  // Determine which APIs to query based on topic
  const isCS = isComputerScienceTopic(topic);
  const isMedBio = isMedicalBioTopic(topic);
  
  console.log(`🏷️ [API ENRICHMENT] Topic classification: CS=${isCS}, MedBio=${isMedBio}`);
  
  // Query relevant APIs in parallel
  const apiPromises: Promise<SearchResult[]>[] = [];
  
  if (isCS) {
    console.log(`📚 [API ENRICHMENT] Querying arXiv (CS topic detected)...`);
    apiPromises.push(queryArxivAPI(topic, 5));
  }
  
  if (isMedBio) {
    console.log(`🏥 [API ENRICHMENT] Querying PubMed (Medical/Bio topic detected)...`);
    apiPromises.push(queryPubMedAPI(topic, 5));
  }
  
  // Always query CORE (general academic)
  console.log(`📖 [API ENRICHMENT] Querying CORE (general academic)...`);
  apiPromises.push(queryCoreAPI(topic, 5));
  
  // Crossref for non-STEM topics (business, management, social science)
  if (!isCS && !isMedBio) {
    console.log(`📚 [API ENRICHMENT] Querying Crossref (general/business topic detected)...`);
    apiPromises.push(queryCrossrefAPI(topic, 8));
  }
  
  // Wait for all API queries
  const apiResultsArrays = await Promise.all(apiPromises);
  
  // Flatten results
  for (const results of apiResultsArrays) {
    apiResults.push(...results);
  }
  
  console.log(`✅ [API ENRICHMENT] APIs returned ${apiResults.length} total results`);
  
  // Merge with Google results
  const allResults = [...googleResults, ...apiResults];
  console.log(`📊 [API ENRICHMENT] Total before deduplication: ${allResults.length}`);
  
  // Deduplicate by title similarity
  const deduplicated = deduplicateResults(allResults);
  console.log(`✅ [API ENRICHMENT] After deduplication: ${deduplicated.length}`);
  
  // Re-sort by credibility score
  deduplicated.sort((a, b) => {
    const scoreB = b.credibilityScore || 0;
    const scoreA = a.credibilityScore || 0;
    return scoreB - scoreA;
  });
  
  // Renumber
  const final = deduplicated.map((r, idx) => ({ ...r, number: idx + 1 }));
  
  console.log(`🎯 [API ENRICHMENT] Final enriched results: ${final.length}\n`);
  
  return final;
}

// Deduplication by title similarity
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  
  for (const result of results) {
    // Normalize title for comparison
    const normalizedTitle = result.title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Check for exact or very similar title
    let isDuplicate = false;
    for (const seenTitle of seen) {
      // Calculate similarity (simple approach: check if 80% of words overlap)
      const words1 = normalizedTitle.split(' ');
      const words2 = seenTitle.split(' ');
      const intersection = words1.filter(w => words2.includes(w));
      const similarity = intersection.length / Math.max(words1.length, words2.length);
      
      if (similarity > 0.8) {
        isDuplicate = true;
        console.log(`🔄 [DEDUP] Skipping duplicate: "${result.title.slice(0, 60)}..."`);
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(normalizedTitle);
      unique.push(result);
    }
  }
  
  return unique;
}

function formatSearchResults(results: SearchResult[], topic: string, requestedCount?: number): string {
  console.log(`📝 [FORMATTER] Formatting ${results.length} results for topic:`, topic);
  
  let header = `Found ${results.length} PDFs on **${topic}**`;
  if (requestedCount && requestedCount !== results.length) {
    header += ` (requested: ${requestedCount})`;
  }
  header += ':\n\n';
  
  const formattedResults = results.map(r => {
    // Multi-line format with all metadata
    let formatted = `**${r.number}. [${r.title}](${r.url})**\n`;
    
    // Authors line
    if (r.authors) {
      formatted += `    Authors: ${r.authors}\n`;
    }
    
    // Year line
    if (r.year) {
      formatted += `    Year: ${r.year}\n`;
    }
    
    // Credibility Score line
    if (r.credibilityScore !== undefined && r.credibilityScore !== null) {
      formatted += `    Credibility: ${r.credibilityScore}/10\n`;
    }
    
    // File Size line with Book/Handbook/Article indicator
    if (r.file_size_bytes) {
      const fileSizeMB = (r.file_size_bytes / (1024 * 1024)).toFixed(1);
      let sizeLabel = '📄 Article';
      
      if (r.file_size_bytes > 3 * 1024 * 1024) {
        sizeLabel = '📚 Book';
      } else if (r.file_size_bytes >= 1 * 1024 * 1024) {
        sizeLabel = '📖 Handbook';
      }
      
      formatted += `    Size: ${fileSizeMB} MB ${sizeLabel}\n`;
    }
    
    // Source domain line
    if (r.source) {
      formatted += `    Source: ${r.source}\n`;
    }
    
    return formatted.trimEnd();
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

async function executeDownloads(pdfs: SearchResult[], searchQuery: string, supabaseClient: any): Promise<any[]> {
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
    
    let downloadSuccess = false;
    let lastError = '';
    let fileName = '';
    
    // STRATEGY 0: Quick URL pre-validation to avoid timeouts on dead links
    console.log(`  🔍 [STRATEGY 0] Pre-validating URL...`);
    let urlIsValid = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(pdf.url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow'
      });
      
      clearTimeout(timeoutId);
      
      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      urlIsValid = response.ok && 
        (contentType.includes('application/pdf') || 
         contentType.includes('pdf') ||
         pdf.url.toLowerCase().endsWith('.pdf'));
      
      if (urlIsValid) {
        console.log(`  ✅ [STRATEGY 0] URL validated (${response.status})`);
      } else {
        console.log(`  ❌ [STRATEGY 0] Invalid URL (${response.status}, ${contentType})`);
        lastError = `Invalid URL: HTTP ${response.status}`;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`  ⏱️ [STRATEGY 0] Timeout - URL unreachable`);
      } else {
        console.log(`  ❌ [STRATEGY 0] Validation failed: ${error.message}`);
      }
      lastError = 'URL unreachable or invalid';
      urlIsValid = false;
    }
    
    // STRATEGY 1: Try the cached verified URL (only if pre-validation passed)
    if (urlIsValid) {
      console.log(`  🔗 [STRATEGY 1] Trying cached URL: ${pdf.url.slice(0, 60)}...`);
      try {
        const downloadResult = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/download-pdf-tool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            url: pdf.url,
            search_query: searchQuery,
            expected_title: pdf.title,
            expected_author: pdf.authors
          })
        });
        
        const data = await downloadResult.json();
        
        if (!data.error) {
          console.log(`  ✅ [STRATEGY 1] SUCCESS`);
          downloadSuccess = true;
          fileName = data.document?.file_name;
        } else {
          console.log(`  ❌ [STRATEGY 1] Failed:`, data.error);
          lastError = data.error;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`  ❌ [STRATEGY 1] Exception:`, errorMessage);
        lastError = errorMessage;
      }
    } else {
      console.log(`  ⏩ [STRATEGY 1] Skipped due to failed pre-validation`);
    }
    
    // STRATEGY 2: If failed, search for alternative URLs
    if (!downloadSuccess) {
      console.log(`  🔄 [STRATEGY 2] Searching alternative URLs for: ${pdf.title}`);
      
      try {
        const { data: altPdfs, error: altError } = await supabaseClient.functions.invoke(
          'pdf-search-with-validation',
          {
            body: {
              books: [{ title: pdf.title, authors: pdf.authors || '' }],
              maxResultsPerBook: 3,  // Try up to 3 alternative URLs
              maxUrlsToCheck: 10      // Reduced for speed
            }
          }
        );
        
        if (!altError && altPdfs?.pdfs && altPdfs.pdfs.length > 0) {
          console.log(`  ✅ [STRATEGY 2] Found ${altPdfs.pdfs.length} alternative URLs`);
          
          // Try each alternative URL until one succeeds
          for (const altPdf of altPdfs.pdfs) {
            if (downloadSuccess) break;
            
            console.log(`    🔗 Trying alternative: ${altPdf.pdfUrl.slice(0, 60)}...`);
            
            try {
              const downloadResult = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/download-pdf-tool', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  url: altPdf.pdfUrl,
                  search_query: searchQuery,
                  expected_title: pdf.title,
                  expected_author: pdf.authors
                })
              });
              
              const data = await downloadResult.json();
              
              if (!data.error) {
                console.log(`    ✅ Alternative URL SUCCESS`);
                downloadSuccess = true;
                fileName = data.document?.file_name;
              } else {
                console.log(`    ❌ Alternative failed:`, data.error);
                lastError = data.error;
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              console.error(`    ❌ Alternative exception:`, errorMessage);
              lastError = errorMessage;
            }
          }
        } else {
          console.log(`  ⚠️ [STRATEGY 2] No alternatives found`);
        }
      } catch (searchError) {
        console.error(`  ❌ [STRATEGY 2] Search failed:`, searchError);
      }
    }
    
    // Push final result
    results.push({
      number: pdf.number,
      title: pdf.title,
      success: downloadSuccess,
      fileName: downloadSuccess ? fileName : undefined,
      error: downloadSuccess ? undefined : (lastError || 'No alternative URL found')
    });
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

/**
 * Retrieves and formats feedback about documents that failed validation
 */
async function formatValidationFeedback(
  conversationId: string, 
  supabaseClient: any
): Promise<string> {
  console.log(`🔍 [VALIDATION FEEDBACK] Checking for rejected documents in conversation ${conversationId}`);
  
  try {
    // Get rejected documents from the queue
    const { data: rejectedDocs, error } = await supabaseClient
      .from('pdf_download_queue')
      .select('expected_title, expected_author, validation_result, error_message, completed_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'rejected')
      .order('completed_at', { ascending: false });
    
    if (error) {
      console.error('❌ [VALIDATION FEEDBACK] Error fetching rejected docs:', error);
      return '';
    }
    
    if (!rejectedDocs || rejectedDocs.length === 0) {
      console.log('✅ [VALIDATION FEEDBACK] No rejected documents found');
      return '';
    }
    
    console.log(`📊 [VALIDATION FEEDBACK] Found ${rejectedDocs.length} rejected documents`);
    
    // Format feedback message
    let feedback = `\n\n---\n\n### 📋 Documenti Non Validati (${rejectedDocs.length})\n\n`;
    feedback += `I seguenti documenti sono stati scaricati ma non hanno superato la validazione AI e sono stati eliminati:\n\n`;
    
    rejectedDocs.forEach((doc: any, index: number) => {
      const validationResult = doc.validation_result || {};
      const aiSummary = validationResult.summary || 'Nessun riassunto disponibile';
      const aiMotivazione = validationResult.motivazione || doc.error_message || 'Nessuna motivazione disponibile';
      
      feedback += `**${index + 1}. ${doc.expected_title}**\n`;
      
      if (doc.expected_author) {
        feedback += `   _Autore: ${doc.expected_author}_\n`;
      }
      
      feedback += `   **Motivo del rifiuto:** ${aiMotivazione}\n`;
      
      if (aiSummary && aiSummary !== 'Nessun riassunto disponibile') {
        feedback += `   **Contenuto rilevato:** ${aiSummary.slice(0, 200)}${aiSummary.length > 200 ? '...' : ''}\n`;
      }
      
      feedback += '\n';
    });
    
    feedback += `\n💡 _Se ritieni che uno di questi documenti sia stato erroneamente rifiutato, puoi cercare di scaricarlo nuovamente con una query di ricerca più specifica._`;
    
    return feedback;
    
  } catch (err) {
    console.error('❌ [VALIDATION FEEDBACK] Exception:', err);
    return '';
  }
}

/**
 * Estrae entries PDF da una tabella markdown
 * Formato atteso: | # | Title | Author(s) | URL | Source | Year |
 */
function parsePdfTableFromMarkdown(markdownText: string): Array<{
  title: string;
  author: string;
  url: string;
  source: string;
  year: string;
}> {
  const results: Array<any> = [];
  
  // Regex per righe tabella: | 1 | Title | Author | URL | Source | Year |
  const tableRowRegex = /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(https?:\/\/[^|\s]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
  
  let match;
  while ((match = tableRowRegex.exec(markdownText)) !== null) {
    const [, number, title, author, url, source, year] = match;
    
    results.push({
      title: title.trim(),
      author: author.trim(),
      url: url.trim(),
      source: source.trim(),
      year: year.trim()
    });
  }
  
  console.log(`📊 Parsed ${results.length} PDF entries from markdown table`);
  return results;
}

/**
 * Processa il download di un singolo PDF dalla queue
 */
async function processDownload(queueId: string, supabaseClient: any, requestId: string) {
  const MAX_DOWNLOAD_TIME = 120000; // 2 minuti
  const logPrefix = `🔄 [REQ-${requestId}][DOWNLOAD-${queueId.slice(0, 8)}]`;
  console.log(`${logPrefix} Starting download process (timeout: ${MAX_DOWNLOAD_TIME}ms)`);
  
  try {
    // ✅ Create timeout promise
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Download timeout after 2 minutes')), MAX_DOWNLOAD_TIME)
    );
    
    // ✅ Create download promise
    const downloadPromise = (async () => {
      // 1. Aggiorna status a 'downloading'
      const { error: updateError } = await supabaseClient
        .from('pdf_download_queue')
        .update({ 
          status: 'downloading',
          started_at: new Date().toISOString()
        })
        .eq('id', queueId);
      
      if (updateError) {
        console.error(`${logPrefix} Failed to update status:`, updateError);
        return;
      }
      
      // 2. Recupera dati dalla queue
      const { data: queueEntry, error: fetchError } = await supabaseClient
        .from('pdf_download_queue')
        .select('*')
        .eq('id', queueId)
        .single();
      
      if (fetchError || !queueEntry) {
        console.error(`${logPrefix} Failed to fetch queue entry:`, fetchError);
        return;
      }
      
      console.log(`${logPrefix} Downloading: ${queueEntry.expected_title}`);
      console.log(`${logPrefix} URL: ${queueEntry.url}`);
      
      // 3. Incrementa download_attempts
      await supabaseClient
        .from('pdf_download_queue')
        .update({ download_attempts: (queueEntry.download_attempts || 0) + 1 })
        .eq('id', queueId);
      
      // 4. Chiama download-pdf-tool
      const { data: downloadResult, error: downloadError } = await supabaseClient.functions.invoke(
        'download-pdf-tool',
        {
          body: {
            url: queueEntry.url,
            search_query: queueEntry.search_query,
            expected_title: queueEntry.expected_title,
            expected_author: queueEntry.expected_author
          }
        }
      );
      
      if (downloadError || !downloadResult?.success) {
        const errorMsg = downloadError?.message || downloadResult?.error || 'Unknown error';
        console.error(`${logPrefix} Download failed:`, errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log(`${logPrefix} ✅ PDF downloaded: ${downloadResult.document.file_name}`);
      
      // 5. Aggiorna con document_id e status 'validating'
      await supabaseClient
        .from('pdf_download_queue')
        .update({
          status: 'validating',
          document_id: downloadResult.document.id,
          downloaded_file_name: downloadResult.document.file_name
        })
        .eq('id', queueId);
      
      // 6. Attendi validazione (polling)
      await waitForValidation(queueId, downloadResult.document.id, supabaseClient, requestId);
    })();
    
    // ✅ Race between download and timeout
    await Promise.race([downloadPromise, timeoutPromise]);
    
  } catch (error: any) {
    console.error(`${logPrefix} ❌ Download failed:`, error.message);
    
    // ✅ CRITICAL: Always update status to failed
    await supabaseClient
      .from('pdf_download_queue')
      .update({
        status: 'failed',
        error_message: error.message || 'Unknown error',
        completed_at: new Date().toISOString()
      })
      .eq('id', queueId);
  }
}

/**
 * Attende che validate-document completi la validazione
 */
async function waitForValidation(
  queueId: string, 
  documentId: string, 
  supabaseClient: any,
  requestId: string,
  maxAttempts: number = 30
) {
  const logPrefix = `⏳ [REQ-${requestId}][VALIDATE-${queueId.slice(0, 8)}]`;
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2s interval
    
    const { data: queueEntry } = await supabaseClient
      .from('pdf_download_queue')
      .select('status, validation_result')
      .eq('id', queueId)
      .single();
    
    if (queueEntry?.status === 'completed' || queueEntry?.status === 'failed') {
      console.log(`${logPrefix} Validation complete: ${queueEntry.status}`);
      return;
    }
    
    // Check se validate-document ha aggiornato knowledge_documents
    const { data: doc } = await supabaseClient
      .from('knowledge_documents')
      .select('validation_status')
      .eq('id', documentId)
      .single();
    
    if (doc?.validation_status === 'validated' || doc?.validation_status === 'validation_failed') {
      const finalStatus = doc.validation_status === 'validated' ? 'completed' : 'failed';
      console.log(`${logPrefix} Document validation: ${doc.validation_status} → ${finalStatus}`);
      
      await supabaseClient
        .from('pdf_download_queue')
        .update({
          status: finalStatus,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueId);
      
      return;
    }
  }
  
  console.error(`${logPrefix} Validation timeout after ${maxAttempts * 2}s`);
  await supabaseClient
    .from('pdf_download_queue')
    .update({
      status: 'failed',
      error_message: 'Validation timeout',
      completed_at: new Date().toISOString()
    })
    .eq('id', queueId);
}

/**
 * Genera messaggio di riepilogo dei download
 */
async function generateDownloadSummary(
  conversationId: string,
  supabaseClient: any,
  requestId: string
) {
  const logPrefix = `📊 [REQ-${requestId}][SUMMARY]`;
  
  // Attendi che tutti i download siano completati (max 5 minuti)
  const maxWait = 300; // 5 minutes
  const checkInterval = 5; // 5 seconds
  let elapsed = 0;
  
  while (elapsed < maxWait) {
    await new Promise(resolve => setTimeout(resolve, checkInterval * 1000));
    elapsed += checkInterval;
    
    const { data: pending } = await supabaseClient
      .from('pdf_download_queue')
      .select('id')
      .eq('conversation_id', conversationId)
      .in('status', ['pending', 'downloading', 'validating']);
    
    if (!pending || pending.length === 0) {
      break; // Tutti completati
    }
    
    console.log(`${logPrefix} Waiting for ${pending.length} downloads... (${elapsed}s)`);
  }
  
  // Recupera tutti i risultati
  const { data: results } = await supabaseClient
    .from('pdf_download_queue')
    .select(`
      *,
      knowledge_documents (
        file_name,
        file_size_bytes,
        validation_status
      )
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  
  if (!results || results.length === 0) {
    console.log(`${logPrefix} No results to summarize`);
    return;
  }
  
  const completed = results.filter((r: any) => r.status === 'completed');
  const failed = results.filter((r: any) => r.status === 'failed');
  
  // Genera messaggio
  const summary = `
## 📦 DOWNLOAD REPORT

**Risultati:**
- ✅ Scaricati con successo: ${completed.length}
- ❌ Falliti: ${failed.length}
- 📊 Totale: ${results.length}

### Dettagli

${results.map((r: any, idx: number) => {
  const icon = r.status === 'completed' ? '✅' : '❌';
  const sizeInfo = r.knowledge_documents?.file_size_bytes 
    ? ` (${(r.knowledge_documents.file_size_bytes / 1024 / 1024).toFixed(2)} MB)`
    : '';
  
  return `
**${idx + 1}. ${icon} ${r.expected_title}**
- Autore: ${r.expected_author || 'N/A'}
- URL: ${r.url}
${r.status === 'completed' 
  ? `- ✅ File scaricato: \`${r.downloaded_file_name}\`${sizeInfo}
- Validazione: ${r.knowledge_documents?.validation_status || 'pending'}`
  : `- ❌ Errore: ${r.error_message || 'Unknown error'}
- Tentativi: ${r.download_attempts}`
}
`;
}).join('\n')}

${completed.length > 0 ? '✨ I PDF validati sono ora disponibili nella knowledge base.' : ''}
`;
  
  // Salva come messaggio assistente
  const { error } = await supabaseClient
    .from('agent_messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: summary.trim()
    });
  
  if (error) {
    console.error(`${logPrefix} Failed to save summary:`, error);
  } else {
    console.log(`${logPrefix} ✅ Summary saved to conversation`);
  }
}

// Long response handler removed - using continuous streaming

Deno.serve(async (req) => {
  // Generate unique request ID for tracking
  const requestId = crypto.randomUUID().substring(0, 8);
  const requestStartTime = Date.now();
  
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
    
    const { conversationId, message, agentSlug, attachments, skipSystemValidation, stream } = requestBody;
    const enableStreaming = stream !== false; // Default to streaming unless explicitly disabled
    
    // Validate inputs
    validateMessageLength(message);
    if (conversationId) {
      validateUUID(conversationId, 'conversationId');
    }
    if (!agentSlug || typeof agentSlug !== 'string' || agentSlug.length > 100) {
      throw new Error('Invalid agentSlug: must be a string with max 100 characters');
    }
    if (attachments && (!Array.isArray(attachments) || attachments.length > 10)) {
      throw new Error('Invalid attachments: must be an array with max 10 items');
    }

    // Detailed request logging
    console.log('🆔 [REQ-' + requestId + '] New request received');
    console.log('   User:', user.id);
    console.log('   Conversation:', conversationId || 'NEW');
    console.log('   Agent:', agentSlug);
    console.log('   Message length:', message.length, 'chars');
    console.log('   Attachments:', attachments?.length || 0);
    console.log('   Timestamp:', new Date().toISOString());

    console.log('Processing chat for agent:', agentSlug);

    // Get agent details
    console.log('🔍 Looking for agent with slug:', agentSlug);
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('slug', agentSlug)
      .eq('active', true)
      .maybeSingle();

    if (agentError) {
      console.error('❌ Database error fetching agent:', agentError);
      throw new Error(`Agent query failed: ${agentError.message}`);
    }
    
    if (!agent) {
      console.error('❌ Agent not found for slug:', agentSlug);
      throw new Error('Agent not found');
    }
    
    console.log('✅ Agent found:', agent.id, agent.name);

    console.log('Agent ID for RAG filtering:', agent.id);

    // Get or create conversation
    let conversation;
    if (conversationId) {
      // Check if conversation with this ID exists
      const { data: existingConv } = await supabase
        .from('agent_conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingConv) {
        // Conversation exists, reuse it
        conversation = existingConv;
        console.log('♻️ Reusing conversation with provided ID:', conversation.id);
      } else {
        // Conversation doesn't exist, create it with the provided ID
        console.log('🆕 Creating new conversation with provided ID:', conversationId);
        const { data, error } = await supabase
          .from('agent_conversations')
          .insert({
            id: conversationId,
            user_id: user.id,
            agent_id: agent.id,
            title: message.substring(0, 100)
          })
          .select()
          .single();

        if (error) throw error;
        conversation = data;
      }
    } else {
      // Step 1: Try to find existing conversation for this user+agent
      const { data: existingConv } = await supabase
        .from('agent_conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('agent_id', agent.id)
        .maybeSingle();

      if (existingConv) {
        // Reuse existing conversation
        conversation = existingConv;
        console.log('♻️ Reusing existing conversation:', conversation.id);
      } else {
        // Step 2: Create new conversation with race condition handling
        const { data, error } = await supabase
          .from('agent_conversations')
          .insert({
            user_id: user.id,
            agent_id: agent.id,
            title: message.substring(0, 100)
          })
          .select()
          .single();

        if (error) {
          // Handle race condition: another request created the conversation
          if (error.code === '23505') { // Unique constraint violation
            console.log('⚠️ Race condition detected, fetching existing conversation by ID...');
            const { data: raceConv, error: raceError } = await supabase
              .from('agent_conversations')
              .select('*')
              .eq('id', conversationId)
              .maybeSingle();

            if (raceError) throw raceError;
            if (!raceConv) throw new Error('Race condition: conversation was not created');
            conversation = raceConv;
            console.log('♻️ Retrieved conversation after race condition:', conversation.id);
          } else {
            throw error; // Re-throw non-race-condition errors
          }
        } else {
          conversation = data;
          console.log('🆕 Created new conversation:', conversation.id);
        }
      }
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

    // ============================================
    // DETERMINISTIC @TAG DETECTION SYSTEM
    // ============================================
    
    // Load all valid agent slugs for whitelist validation
    const { data: activeAgents } = await supabase
      .from('agents')
      .select('slug')
      .eq('active', true);
    
    const validAgentSlugs = new Set(activeAgents?.map(a => a.slug) || []);
    console.log(`📋 [REQ-${requestId}] Loaded ${validAgentSlugs.size} valid agent slugs for @mention validation`);
    
    const agentTagRegex = /@([a-zA-Z0-9\-_]+)/g;
    const potentialSlugs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = agentTagRegex.exec(message)) !== null) {
      if (match[1]) {
        potentialSlugs.push(match[1]);
      }
    }
    
    // Filter ONLY slugs that correspond to active agents (whitelist)
    const mentionedAgentSlugs = potentialSlugs.filter(slug => validAgentSlugs.has(slug));
    
    // Log ignored invalid mentions
    const invalidSlugs = potentialSlugs.filter(slug => !validAgentSlugs.has(slug));
    if (invalidSlugs.length > 0) {
      console.log(`⚠️ [REQ-${requestId}] Ignored invalid @mentions: ${invalidSlugs.join(', ')}`);
    }
    if (mentionedAgentSlugs.length > 0) {
      console.log(`🏷️ [REQ-${requestId}] Valid @mentions found: ${mentionedAgentSlugs.join(', ')}`);
    }
    
    // Remove @tags from the message for processing
    const messageWithoutTags = message.replace(agentTagRegex, '').trim();
    
    const finalUserMessage = attachmentContext 
      ? `${messageWithoutTags}${attachmentContext}`
      : messageWithoutTags;

    // Validate that user message doesn't contain system-generated patterns
    // Skip validation for messages with @tags (meta-discussion about the system)
    // Skip validation for inter-agent consultations (skipSystemValidation flag)
    // VALIDATION DISABLED: Era troppo restrittiva e bloccava messaggi legittimi contenenti
    // output di analisi o testo strutturato che casualmente matchava i pattern
    const hasAgentTags = mentionedAgentSlugs.length > 0;
    
    if (false && !hasAgentTags && !skipSystemValidation) {
      const systemPatterns = [
        /^Ho trovato \d+ PDF/i,
        /Confermi il download/i,
        /Download avviato in BACKGROUND/i,
        /Non ho trovato risultati per/i,
        /Errore durante la ricerca/i,
        /Vuoi provare con una query diversa/i
      ];
      
      const looksLikeSystemMessage = systemPatterns.some(pattern => pattern.test(message));
      
      if (looksLikeSystemMessage) {
        console.error('⚠️ [VALIDATION] Detected system-like content in user message:', message);
        throw new Error('Invalid user message: contains system-generated content');
      }
    }

    // Save user message (original with @tags) and get ID for potential update
    const { data: userMessage, error: userMsgError } = await supabase
      .from('agent_messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: message  // Keep original message with @tags
      })
      .select('id')
      .single();

    if (userMsgError) throw userMsgError;
    const userMessageId = userMessage.id;
    
    // ============================================
    // INTER-AGENT CONSULTATION - DETERMINISTIC
    // ============================================
    if (mentionedAgentSlugs.length > 0) {
      console.log(`🤝 [REQ-${requestId}] Inter-agent consultation mode activated`);
      
      for (const targetSlug of mentionedAgentSlugs) {
        try {
          // 1. Get target agent
          const { data: targetAgent, error: targetAgentError } = await supabase
            .from('agents')
            .select('*')
            .eq('slug', targetSlug)
            .eq('active', true)
            .single();
          
          // Safety check: slug passed whitelist validation, must exist
          if (targetAgentError || !targetAgent) {
            console.error(`🚨 [REQ-${requestId}] INTEGRITY ERROR: Agent @${targetSlug} passed whitelist but not found in DB`);
            continue;
          }
          
          console.log(`✅ [REQ-${requestId}] Found target agent: ${targetAgent.name} (@${targetSlug})`);
          
          // 2. Get or create consultation conversation for target agent
          const { data: consultConvId, error: consultConvError } = await supabase
            .rpc('get_or_create_conversation', {
              p_user_id: user.id,
              p_agent_id: targetAgent.id
            });
          
          if (consultConvError) {
            console.error(`❌ [REQ-${requestId}] Failed to get/create consultation conversation:`, consultConvError);
            continue;
          }

          const { data: consultConversation, error: fetchConvError } = await supabase
            .from('agent_conversations')
            .select('*')
            .eq('id', consultConvId)
            .single();
          
          if (fetchConvError || !consultConversation) {
            console.error(`❌ [REQ-${requestId}] Failed to fetch consultation conversation:`, fetchConvError);
            continue;
          }
          
          // 3. Insert system message: "Consulting @agent..."
          const { data: systemMsgStart } = await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'system',
              content: `🔄 Consultando @${targetSlug}...`
            })
            .select()
            .single();
          
          // 4. Create inter-agent log entry
          const { data: logEntry, error: logError } = await supabase
            .from('inter_agent_logs')
            .insert({
              requesting_conversation_id: conversation.id,
              requesting_agent_id: agent.id,
              consulted_agent_id: targetAgent.id,
              consulted_conversation_id: consultConversation.id,
              task_description: messageWithoutTags,
              status: 'initiated'
            })
            .select()
            .single();
          
          if (logError) {
            console.error(`❌ [REQ-${requestId}] Failed to create inter-agent log:`, logError);
          }
          
          console.log(`📝 [REQ-${requestId}] Created inter-agent log:`, logEntry?.id);
          
          // 5. Update log to processing
          if (logEntry) {
            await supabase
              .from('inter_agent_logs')
              .update({ status: 'processing' })
              .eq('id', logEntry.id);
          }
          
          // 6. Call target agent (invoke agent-chat recursively for target agent)
          try {
            console.log(`🔐 [REQ-${requestId}] Calling @${targetSlug} with auth header: ${req.headers.get('authorization') ? 'Present' : 'Missing'}`);
            
            const { data: consultResponse, error: consultError } = await supabase.functions.invoke(
              'agent-chat',
              {
                body: {
                  conversationId: consultConversation.id,
                  message: messageWithoutTags,
                  agentSlug: targetSlug,
                  skipSystemValidation: true
                },
                headers: {
                  Authorization: req.headers.get('authorization') || ''
                }
              }
            );
            
            if (consultError) {
              throw consultError;
            }
            
            // The response will be saved to consultConversation automatically by the recursive call
            console.log(`✅ [REQ-${requestId}] Target agent @${targetSlug} responded`);
            
            // 7. Fetch the response from consulted agent's conversation
            const { data: consultMessages, error: fetchError } = await supabase
              .from('agent_messages')
              .select('content')
              .eq('conversation_id', consultConversation.id)
              .eq('role', 'assistant')
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            
            if (fetchError || !consultMessages) {
              throw new Error('Failed to fetch consultation response');
            }
            
            const consultationResponse = consultMessages.content;
            
            // 8. Update inter-agent log to completed
            if (logEntry) {
              await supabase
                .from('inter_agent_logs')
                .update({ 
                  status: 'completed',
                  completed_at: new Date().toISOString()
                })
                .eq('id', logEntry.id);
            }
            
            // 9. Insert system message: "Response received"
            await supabase
              .from('agent_messages')
              .insert({
                conversation_id: conversation.id,
                role: 'system',
                content: `✅ Risposta da @${targetSlug} ricevuta`
              });
            
            // 10. Save consultation response to the original conversation
            await supabase
              .from('agent_messages')
              .insert({
                conversation_id: conversation.id,
                role: 'assistant',
                content: `**Risposta da @${targetSlug}:**\n\n${consultationResponse}`,
                llm_provider: targetAgent.llm_provider
              });
            
            // 11. Save to inter_agent_messages for tracking
            await supabase
              .from('inter_agent_messages')
              .insert({
                requesting_agent_id: agent.id,
                consulted_agent_id: targetAgent.id,
                context_conversation_id: conversation.id,
                question: messageWithoutTags,
                answer: consultationResponse
              });
            
            // 12. Insert special system message to notify frontend that consultation is complete
            await supabase
              .from('agent_messages')
              .insert({
                conversation_id: conversation.id,
                role: 'system',
                content: `__CONSULTATION_COMPLETE__@${targetSlug}`
              });
            
            console.log(`✅ [REQ-${requestId}] Inter-agent consultation completed for @${targetSlug}`);
            
          } catch (consultError) {
            console.error(`❌ [REQ-${requestId}] Consultation with @${targetSlug} failed:`, consultError);
            
            // Update log to failed
            if (logEntry) {
              await supabase
                .from('inter_agent_logs')
                .update({ 
                  status: 'failed',
                  completed_at: new Date().toISOString(),
                  error_message: consultError instanceof Error ? consultError.message : 'Unknown error'
                })
                .eq('id', logEntry.id);
            }
            
            // Insert system error message
            await supabase
              .from('agent_messages')
              .insert({
                conversation_id: conversation.id,
                role: 'system',
                content: `❌ Errore nella consultazione di @${targetSlug}: ${consultError instanceof Error ? consultError.message : 'Errore sconosciuto'}`
              });
          }
          
        } catch (error) {
          console.error(`❌ [REQ-${requestId}] Error processing @${targetSlug}:`, error);
          
          // Insert assistant error message (system role not supported by Anthropic)
          await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: `❌ Errore durante l'elaborazione di @${targetSlug}`
            });
        }
      }
      
      // Return early - no need for LLM response when doing inter-agent consultation
      return new Response(
        JSON.stringify({ 
          success: true, 
          conversationId: conversation.id,
          consultedAgents: mentionedAgentSlugs
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

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
      
      // For user messages, check if previous message is a duplicate
      if (m.role === 'user' && index > 0) {
        const prevMsg = arr[index - 1];
        // Skip this message if previous is also user with identical content
        if (prevMsg.role === 'user' && prevMsg.content === m.content) {
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
    const aiModel = agent.ai_model || null;
    console.log('🤖 Using LLM Provider:', llmProvider);
    if (aiModel) {
      console.log('🎯 Using AI Model:', aiModel);
    }

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

    // Start streaming response with TransformStream for immediate flush
    let accumulatedResponse = ''; // Store full response for non-streaming mode
    let finalRetrievalMetadata: any = null; // 📊 [BENCHMARK] Store metadata for non-streaming mode
    let finalLlmProvider: string = ''; // 📊 [BENCHMARK] Store provider for non-streaming mode
    let finalKnowledgeStats: any = null; // 📊 [BENCHMARK] Store knowledge stats for non-streaming mode
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let streamClosed = false;
    
    const sendSSE = async (data: string) => {
      if (streamClosed) {
        console.warn('⚠️ Attempted to send SSE on closed stream, ignoring');
        return;
      }
      try {
        // If streaming enabled, write to stream
        if (enableStreaming) {
          const chunk = encoder.encode(`data: ${data}\n\n`);
          await writer.write(chunk);
        }
        
        // Always accumulate content for potential non-streaming response
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content' && parsed.text) {
            accumulatedResponse += parsed.text;
          }
        } catch {
          // Ignore non-content SSE events
        }
      } catch (error) {
        console.error('Error sending SSE data:', error);
        streamClosed = true;
      }
    };
    
    const closeStream = async () => {
      if (streamClosed) {
        console.warn('⚠️ Stream already closed, ignoring duplicate close');
        return;
      }
      streamClosed = true;
      try {
        await writer.close();
      } catch (error) {
        console.error('Error closing stream:', error);
      }
    };
    
    // Wrap logic in async function to support both streaming and non-streaming
    const processRequest = async () => {
        let placeholderMsg: any = null; // Declare outside try block for catch access

        try {
          console.log('='.repeat(80));
          console.log('🤖 [REQ-' + requestId + '] LLM ROUTING INFO:');
          console.log(`   Agent: ${agent.name} (${agent.slug})`);
          console.log(`   Selected Provider: ${llmProvider.toUpperCase()}`);
          console.log(`   Conversation ID: ${conversation.id}`);
          console.log(`   User Message: ${message.slice(0, 100)}...`);
          console.log('='.repeat(80));

          // Create placeholder message in DB FIRST (without llm_provider to avoid ghost messages)
          const { data: placeholder, error: placeholderError } = await supabase
            .from('agent_messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: ''
              // ⚠️ llm_provider will be set ONLY after successful stream completion
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
          await sendSSE(JSON.stringify({ 
            type: 'message_start', 
            messageId: placeholderMsg.id 
          }));

          let fullResponse = '';
          let lastUpdateTime = Date.now();
          let toolUseId: string | null = null;
          let toolUseName: string | null = null;
          let toolUseInputJson = '';
          let needsToolResultContinuation = false;
          let skipAgentResponse = false; // Flag to block agent output after system message
          
          // Use truncatedMessages instead of cleanedMessages
          const anthropicMessages = truncatedMessages
            .filter(m => {
              // Exclude the placeholder we just created
              if (m.id === placeholderMsg.id) return false;
              // Exclude messages with empty or null content
              if (!m.content || typeof m.content !== 'string') return false;
              // Exclude messages with only whitespace
              if (m.content.trim() === '') return false;
              // Exclude system messages (not supported by Anthropic Messages API)
              if (m.role === 'system') {
                console.log('⚠️ Filtering out system message (not compatible with Anthropic):', m.content.slice(0, 100));
                return false;
              }
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

          // Verify no system messages remain (Anthropic doesn't accept them)
          const hasSystemMessages = anthropicMessages.some(m => m.role === 'system');
          if (hasSystemMessages) {
            console.error('Found system messages in Anthropic payload!', anthropicMessages);
            throw new Error('Cannot send system role messages to Anthropic API - use system parameter instead');
          }

          console.log('📤 Sending to Anthropic:');
          console.log('Total messages:', anthropicMessages.length);
          console.log('Messages:', JSON.stringify(anthropicMessages, null, 2));

          // Deterministic workflow removed - agent now uses AI tool calling
          
          // ========================================
          // DETECT "MODIFICA PROMPT @AGENT" COMMAND
          // ========================================
          const modifyPromptPattern = /modifica\s+prompt\s+@([a-z0-9-]+):?\s*(.+)/is;
          const modifyMatch = message.match(modifyPromptPattern);
          
          if (modifyMatch) {
            const targetAgentSlug = modifyMatch[1];
            const modificationInstructions = modifyMatch[2].trim();
            
            console.log(`🔧 [MODIFY PROMPT] Detected prompt modification request`);
            console.log(`   Target agent: @${targetAgentSlug}`);
            console.log(`   Instructions: ${modificationInstructions.slice(0, 100)}...`);
            
            // Find target agent
            const { data: targetAgent, error: targetError } = await supabase
              .from('agents')
              .select('id, name, slug, system_prompt')
              .eq('slug', targetAgentSlug)
              .eq('active', true)
              .single();
            
            if (targetError || !targetAgent) {
              console.error('❌ [MODIFY PROMPT] Target agent not found:', targetAgentSlug);
              const errorMsg = `❌ Non ho trovato l'agente @${targetAgentSlug}. Verifica che il nome sia corretto.`;
              
              await supabase
                .from('agent_messages')
                .insert({
                  conversation_id: conversation.id,
                  role: 'assistant',
                  content: errorMsg,
                  llm_provider: llmProvider
                });
              
              return new Response(JSON.stringify({ error: errorMsg }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 404
              });
            }
            
            // Find prompt expert agent
            const { data: promptExpert, error: expertError } = await supabase
              .from('agents')
              .select('id, name, slug, system_prompt')
              .eq('slug', 'prompt-expert')
              .eq('active', true)
              .single();
            
            if (expertError || !promptExpert) {
              console.error('❌ [MODIFY PROMPT] Prompt Expert not found');
              const errorMsg = `❌ Non riesco a trovare l'agente Prompt Expert necessario per modificare i prompt.`;
              
              await supabase
                .from('agent_messages')
                .insert({
                  conversation_id: conversation.id,
                  role: 'assistant',
                  content: errorMsg,
                  llm_provider: llmProvider
                });
              
              return new Response(JSON.stringify({ error: errorMsg }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500
              });
            }
            
            console.log(`✅ [MODIFY PROMPT] Found target agent: ${targetAgent.name}`);
            console.log(`✅ [MODIFY PROMPT] Found Prompt Expert: ${promptExpert.name}`);
            
            // Prepare structured task for Prompt Expert
            const taskForPromptExpert = `TASK: Modifica il system prompt dell'agente '${targetAgent.name}'

AGENTE DA MODIFICARE:
- Nome: ${targetAgent.name}
- Slug: ${targetAgent.slug}
- ID: ${targetAgent.id}
- Prompt attuale:
---
${targetAgent.system_prompt}
---

ISTRUZIONI DI MODIFICA:
${modificationInstructions}

AZIONE RICHIESTA:
Genera il nuovo system prompt completo basandoti sulle istruzioni fornite.
Rispondi SOLO con il nuovo prompt completo, senza spiegazioni aggiuntive o formattazioni markdown.
Il prompt deve essere pronto all'uso direttamente.`;

            // Notify user that modification is in progress
            const progressMsg = `🔧 **Modifica Prompt in corso**\n\nSto consultando ${promptExpert.name} per modificare il prompt di **${targetAgent.name}**...\n\n⏳ Attendere...`;
            
            const { data: progressMsgRecord } = await supabase
              .from('agent_messages')
              .insert({
                conversation_id: conversation.id,
                role: 'assistant',
                content: progressMsg,
                llm_provider: llmProvider
              })
              .select('id')
              .single();
            
            console.log('📤 [MODIFY PROMPT] Consulting Prompt Expert...');
            
            // Get or create conversation with Prompt Expert
            let { data: expertConv, error: convError } = await supabase
              .from('agent_conversations')
              .select('id')
              .eq('agent_id', promptExpert.id)
              .eq('user_id', user.id)
              .single();
            
            if (convError || !expertConv) {
              const { data: newConv, error: createError } = await supabase
                .from('agent_conversations')
                .insert({
                  agent_id: promptExpert.id,
                  user_id: user.id,
                  title: `Modifica prompt da ${agent.name}`
                })
                .select('id')
                .single();
              
              if (createError) {
                console.error('❌ [MODIFY PROMPT] Failed to create conversation');
                throw new Error('Failed to create conversation with Prompt Expert');
              }
              expertConv = newConv;
            }
            
            // Call Prompt Expert
            try {
              const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
              if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured');
              
              const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': anthropicKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-5',
                  max_tokens: 64000,
                  temperature: 0.7,
                  system: promptExpert.system_prompt || 'You are an expert in creating and modifying AI agent system prompts.',
                  messages: [
                    { role: 'user', content: taskForPromptExpert }
                  ]
                })
              });
              
              if (!anthropicResponse.ok) {
                const errorBody = await anthropicResponse.text();
                throw new Error(`Anthropic API error: ${anthropicResponse.status} - ${errorBody}`);
              }
              
              const responseData = await anthropicResponse.json();
              const newPrompt = responseData.content[0].text.trim();
              
              console.log(`✅ [MODIFY PROMPT] Received new prompt from Prompt Expert (${newPrompt.length} chars)`);
              
              // Save conversation with Prompt Expert
              await supabase
                .from('agent_messages')
                .insert([
                  {
                    conversation_id: expertConv.id,
                    role: 'user',
                    content: taskForPromptExpert
                  },
                  {
                    conversation_id: expertConv.id,
                    role: 'assistant',
                    content: newPrompt,
                    llm_provider: 'anthropic'
                  }
                ]);
              
              // Save current prompt to history
              const { data: versionData } = await supabase
                .from('agent_prompt_history')
                .select('version_number')
                .eq('agent_id', targetAgent.id)
                .order('version_number', { ascending: false })
                .limit(1)
                .single();
              
              const nextVersion = (versionData?.version_number || 0) + 1;
              
              await supabase
                .from('agent_prompt_history')
                .insert({
                  agent_id: targetAgent.id,
                  system_prompt: targetAgent.system_prompt,
                  version_number: nextVersion,
                  created_by: user.id
                });
              
              console.log(`💾 [MODIFY PROMPT] Saved old prompt to history (version ${nextVersion})`);
              
              // Update the agent's prompt
              const { error: updateError } = await supabase
                .from('agents')
                .update({ system_prompt: newPrompt })
                .eq('id', targetAgent.id);
              
              if (updateError) {
                throw new Error(`Failed to update prompt: ${updateError.message}`);
              }
              
              console.log(`✅ [MODIFY PROMPT] Successfully updated prompt for ${targetAgent.name}`);
              
              // Send success message
              const successMsg = `✅ **Prompt aggiornato con successo!**\n\n**Agente**: ${targetAgent.name}\n**Versione precedente salvata**: ${nextVersion}\n\n**Nuovo prompt** (${newPrompt.length} caratteri):\n\n---\n\n${newPrompt}\n\n---\n\nIl prompt è stato aggiornato e la versione precedente è stata salvata nella cronologia.`;
              
              // Update the progress message
              if (progressMsgRecord?.id) {
                await supabase
                  .from('agent_messages')
                  .update({ content: successMsg })
                  .eq('id', progressMsgRecord.id);
              } else {
                await supabase
                  .from('agent_messages')
                  .insert({
                    conversation_id: conversation.id,
                    role: 'assistant',
                    content: successMsg,
                    llm_provider: llmProvider
                  });
              }
              
              return new Response(JSON.stringify({ 
                success: true, 
                message: successMsg,
                agent_name: targetAgent.name,
                version_saved: nextVersion
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
              });
              
            } catch (error) {
              console.error('❌ [MODIFY PROMPT] Error during prompt modification:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              const errorMsg = `❌ **Errore durante la modifica del prompt**\n\nAgente: ${targetAgent.name}\nErrore: ${errorMessage}\n\nLa modifica non è stata applicata.`;
              
              // Update progress message with error
              if (progressMsgRecord?.id) {
                await supabase
                  .from('agent_messages')
                  .update({ content: errorMsg })
                  .eq('id', progressMsgRecord.id);
              } else {
                await supabase
                  .from('agent_messages')
                  .insert({
                    conversation_id: conversation.id,
                    role: 'assistant',
                    content: errorMsg,
                    llm_provider: llmProvider
                  });
              }
              
              return new Response(JSON.stringify({ error: errorMsg }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500
              });
            }
          }
          
          // ========================================
          // DETERMINISTIC WORKFLOW: CHECK USER INPUT
          // ========================================
          
          const conversationState = await getConversationState(conversationId, supabase);
          let systemManagedSearch = false;
          let systemSearchResults: SearchResult[] | null = null;
          
          // CRITICAL: Create mutable copy of message for workflow modifications
          let processedMessage = message;
          
          // Check if this is a Book Search Expert conversation
          const isBookSearchExpert = agent.slug === 'book-search-expert-copy' || agent.slug === 'book-serach-expert';
          
          if (isBookSearchExpert) {
            console.log(`🔍 [WORKFLOW] Checking conversation state:`, {
              conversationId,
              waitingForConfirmation: conversationState.waitingForConfirmation,
              lastProposedQuery: conversationState.lastProposedQuery,
              userMessage: message.substring(0, 100)
            });
            
            // STEP 1: Check if user confirmed a proposed query
            if (conversationState.waitingForConfirmation && conversationState.lastProposedQuery) {
              if (isConfirmation(message)) {
                console.log(`✅ [WORKFLOW] User confirmed query: "${conversationState.lastProposedQuery}"`);
                systemManagedSearch = true;
                
                // Execute search automatically
                let searchQuery = conversationState.lastProposedQuery;
                
                console.log(`🔎 [WORKFLOW] Executing automatic search for: "${searchQuery}"`);
                
                try {
                  // Use web search via SerpAPI (same as search_pdf_with_query tool)
                  const serpApiKey = Deno.env.get('SERPAPI_API_KEY');
                  if (!serpApiKey) {
                    throw new Error('SERPAPI_API_KEY not configured');
                  }
                  
                  const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(searchQuery + ' PDF')}&api_key=${serpApiKey}&num=10`;
                  console.log(`📡 [WORKFLOW] Calling SerpAPI: ${searchUrl.replace(serpApiKey, 'XXX')}`);
                  
                  const searchResponse = await fetch(searchUrl);
                  if (!searchResponse.ok) {
                    throw new Error(`SerpAPI error: ${searchResponse.status}`);
                  }
                  
                  const searchJson = await searchResponse.json();
                  const organicResults = searchJson.organic_results || [];
                  
                  // Extract PDF results
                  const pdfResults = organicResults
                    .filter((r: any) => r.link && r.link.toLowerCase().endsWith('.pdf'))
                    .slice(0, 10)
                    .map((r: any) => ({
                      title: r.title || 'Untitled',
                      url: r.link,
                      source: r.source || new URL(r.link).hostname,
                      snippet: r.snippet || ''
                    }));
                  
                  console.log(`✅ [WORKFLOW] Search complete. Found ${pdfResults.length} PDF results`);
                  systemSearchResults = pdfResults;
                  conversationState.lastSearchResults = systemSearchResults;
                  
                  // Search results will be passed to LLM via searchResultsContext
                  console.log(`✅ [WORKFLOW] Search results will be passed to LLM via system prompt`);
                  console.log(`📝 [WORKFLOW] User message kept unchanged: "${message}"`);
                    
                } catch (err) {
                  console.error('❌ [WORKFLOW] Search exception:', err);
                  systemSearchResults = null;
                  console.log(`❌ [WORKFLOW] Search failed, will let LLM handle the error`);
                  // Error will be communicated via LLM response, not by modifying user message
                }
                
                // Clear waiting state
                await updateConversationState(conversationId, {
                  waitingForConfirmation: false,
                  lastProposedQuery: null
                }, supabase);
              } else if (isNewQueryRequest(message)) {
                console.log(`🔄 [WORKFLOW] User requested different query`);
                // Reset state and let agent propose new query
                await updateConversationState(conversationId, {
                  waitingForConfirmation: false,
                  lastProposedQuery: null,
                  lastSearchResults: null
                }, supabase);
              }
            }
          }
          
          // ========================================
          // DETECT @AGENT MENTIONS FOR INTER-AGENT COMMUNICATION
          // ========================================
          // Enhanced regex: Only match @ at word boundaries in user input (not in examples/documentation)
          // Exclude @mentions inside square brackets [@...] or curly braces {@...}
          const agentMentionRegex = /(?<![{\[])\b@([a-zA-Z0-9\-_]+)\b(?![}\]])/g;
          const mentions: string[] = [];
          let match;
          let mentionInstruction = '';
          
          // Only scan the actual user message, not the entire conversation context
          const userMessage = message.trim();
          
          while ((match = agentMentionRegex.exec(userMessage)) !== null) {
            const mentionedSlug = match[1];
            
            // Verify the agent exists and is active before adding to mentions
            const { data: mentionedAgent } = await supabase
              .from('agents')
              .select('id, slug, active')
              .eq('slug', mentionedSlug)
              .eq('active', true)
              .single();
            
            if (mentionedAgent) {
              mentions.push(mentionedSlug);
              console.log(`✅ [MENTION] Valid agent found: @${mentionedSlug}`);
            } else {
              console.log(`⚠️ [MENTION] Ignored invalid/inactive agent: @${mentionedSlug}`);
            }
          }
          
          console.log(`📧 [MENTIONS] Detected ${mentions.length} agent mention(s):`, mentions);
          
          // If there are @mentions, automatically trigger inter-agent communication
          if (mentions.length > 0) {
            console.log('🤝 [AUTO-CONSULT] Processing agent mentions...');
            
            // Remove the @mentions from the message to clean it up
            const cleanedMessage = message.replace(agentMentionRegex, '').trim();
            
            // Prepare system instruction to use the ask_agent_to_perform_task tool
            mentionInstruction = `\n\n## CRITICAL INTER-AGENT INSTRUCTION\n\nThe user has explicitly mentioned the following agent(s) using @ tags: ${mentions.join(', ')}\n\nYou MUST use the 'ask_agent_to_perform_task' tool to consult with each mentioned agent. The user's request (after removing @ tags) is:\n\n"${cleanedMessage}"\n\nFor each mentioned agent:\n1. Use 'ask_agent_to_perform_task' with the agent's name\n2. Pass the user's cleaned request as the task_description\n3. Include relevant context from your conversation in context_information\n4. Wait for their response before continuing\n\nThis is a MANDATORY action when @ tags are present.`;
            
            // We'll inject this instruction into the enhanced system prompt below
            console.log('✅ [AUTO-CONSULT] Inter-agent instruction prepared');
          } else {
            console.log('ℹ️ [MENTIONS] No @ mentions detected, proceeding normally');
          }
          
          console.log('🤖 [AI] Proceeding with AI tool calling for request processing');
          
          // ========================================
          // REMOVED: Old conditional knowledge base logic
          // Now replaced by unconditional semantic search below
          // ========================================
          
          
          // ========================================
          // DETERMINISTIC WORKFLOW: INJECT SEARCH RESULTS
          // ========================================
          
          let searchResultsContext = '';
          
          if (systemManagedSearch && systemSearchResults) {
            console.log(`📦 [WORKFLOW] Injecting ${systemSearchResults.length} search results into agent context`);
            
            searchResultsContext = `

## SYSTEM MANAGED SEARCH - RESULTS READY

The system has automatically executed a search based on your proposed query and found ${systemSearchResults.length} PDF(s).

**CRITICAL**: The user has just confirmed they want to see these results. You MUST now:
1. Present these ${systemSearchResults.length} PDF(s) in a clear, numbered list with titles and sources
2. Include a brief description or snippet for each PDF
3. Ask if they want to download these PDFs
4. Offer to formulate a different search query if these aren't relevant

### Found PDFs:

`;
            
            systemSearchResults.forEach((result, idx) => {
              searchResultsContext += `${idx + 1}. **${result.title}**\n`;
              searchResultsContext += `   - Source: ${result.source}\n`;
              searchResultsContext += `   - URL: ${result.url}\n`;
              if (result.snippet) searchResultsContext += `   - Snippet: ${result.snippet}\n`;
              if (result.authors) searchResultsContext += `   - Authors: ${result.authors}\n`;
              if (result.year) searchResultsContext += `   - Year: ${result.year}\n`;
              searchResultsContext += `\n`;
            });
            
            searchResultsContext += `\n**Your Response Format**:\n`;
            searchResultsContext += `- List all PDFs clearly with numbers\n`;
            searchResultsContext += `- Ask: "Vuoi che scarichi questi PDF? Oppure vuoi che formuli una query diversa?"\n`;
            searchResultsContext += `- DO NOT call any tools yet - just present the results\n\n`;
          }
          
          // ============================================================================
          // UNCONDITIONAL SEMANTIC SEARCH - ALWAYS EXECUTE
          // Every user message triggers automatic semantic search for knowledge base access
          // ============================================================================
          let knowledgeContext = '';
          
          // 📊 Track knowledge context for metadata (declare at function scope)
          let hasKnowledgeContext = false;
          let knowledgeStats = {
            chunks_found: 0,
            top_similarity: 0,
            documents_used: 0
          };
          let videoDocumentsAvailable: any[] = [];
          let documents: any[] = [];
          let queryBreakdown: Record<string, number> = {};
          let decomposedQueries: string[] = [];
          
          console.log(`🔍 [AUTO-SEARCH] Starting Query Decomposition for: "${message}"`);
          
          try {
            // ============================================================================
            // DETECT DOCUMENT-SPECIFIC QUERY (before search)
            // ============================================================================
            const specifiedDocumentName = extractDocumentNameFromQuery(message);
            const isDocumentSpecificQuery = specifiedDocumentName !== null;
            
            if (isDocumentSpecificQuery) {
              console.log(`🎯 [DOC-QUERY] Detected document-specific query for: "${specifiedDocumentName}"`);
              console.log(`🎯 [DOC-QUERY] Will use higher topK to ensure document is found`);
            }
            
            // ============================================================================
            // STEP 1: QUERY DECOMPOSITION
            // ============================================================================
            decomposedQueries = await decomposeQueryWithLLM(message);
            console.log(`🧩 [DECOMPOSITION] Extracted ${decomposedQueries.length} queries:`, decomposedQueries);
            
            // ============================================================================
            // STEP 2: PARALLEL RETRIEVAL (or single search if only 1 query)
            // ============================================================================
            
            // Use higher topK for document-specific queries to increase recall
            const topK = isDocumentSpecificQuery ? 50 : 10;
            
            if (decomposedQueries.length === 1) {
              // Early exit optimization: single query, use existing logic
              console.log(`⚡ [OPTIMIZATION] Single query detected, using direct search with topK=${topK}`);
              
              const { data: searchData, error: searchError } = await supabase.functions.invoke(
                'semantic-search',
                {
                  body: {
                    query: decomposedQueries[0],
                    agentId: agent.id,
                    topK: topK
                  }
                }
              );
              
              if (!searchError && searchData) {
                documents = Array.isArray(searchData) ? searchData : searchData?.documents || [];
                queryBreakdown[decomposedQueries[0]] = documents.length;
              }
              
            } else {
              // Multiple queries: execute parallel searches
              const topKPerQuery = Math.max(
                DECOMPOSITION_CONFIG.TOP_K_PER_QUERY, 
                Math.floor(15 / decomposedQueries.length)
              );
              
              const searchResult = await parallelSemanticSearch(
                decomposedQueries, 
                agent.id, 
                topKPerQuery,
                supabase
              );
              
              documents = searchResult.documents;
              queryBreakdown = searchResult.queryBreakdown;
              
              console.log(`✅ [PARALLEL-SEARCH] Retrieved ${documents.length} unique chunks`);
              console.log(`📊 [BREAKDOWN]`, queryBreakdown);
            }
            
            // ============================================================================
            // DOCUMENT-SPECIFIC FILTERING (for benchmark/explicit document queries)
            // ============================================================================
            // specifiedDocumentName already declared at the beginning of try block
            let originalDocuments: any[] = [];
            
            if (specifiedDocumentName) {
              originalDocuments = [...documents]; // Backup dei risultati originali
              const unfilteredCount = documents.length;
              
              documents = documents.filter((chunk: any) => 
                chunk.document_name === specifiedDocumentName
              );
              
              console.log(`📋 [DOC-FILTER] Filtered for document "${specifiedDocumentName}": ${unfilteredCount} → ${documents.length} chunks`);
              
              // Fallback: se semantic search non ha trovato il documento specificato,
              // dobbiamo aumentare il topK per cercare più in profondità
              if (documents.length === 0) {
                console.log(`⚠️ [DOC-FILTER] No chunks found for "${specifiedDocumentName}" in top ${unfilteredCount} results`);
                console.log(`⚠️ [DOC-FILTER] This means semantic similarity is too low - document may not match query`);
                
                // Mantieni tutti i risultati originali per permettere all'agente di rispondere
                // anche se il documento specifico non è stato trovato
                documents = originalDocuments;
              }
            }
            
          // ============================================================================
          // STEP 3: UPDATE METADATA & BUILD CONTEXT
          // ============================================================================
          hasKnowledgeContext = documents.length > 0;
          knowledgeStats = {
            chunks_found: documents.length,
            top_similarity: documents[0]?.similarity || 0,
            documents_used: [...new Set(documents.map((d: any) => d.document_name))].length
          };
          
          // ============================================================================
          // TRACK VIDEO DOCUMENTS AVAILABLE (for Deep Dive on Demand)
          // ============================================================================
          videoDocumentsAvailable = [];
          
          try {
            console.log('[VIDEO-TRACKING] Checking for video documents...');
            
            const { data: videoChunks } = await supabase
              .from('pipeline_a_agent_knowledge')
              .select('chunk_id')
              .eq('agent_id', agent.id)
              .eq('is_active', true);
            
            if (videoChunks && videoChunks.length > 0) {
              const chunkIds = videoChunks.map((c: any) => c.chunk_id);
              
              const { data: chunksData } = await supabase
                .from('pipeline_a_chunks_raw')
                .select('document_id')
                .in('id', chunkIds);
              
              const uniqueDocIds = [...new Set(chunksData?.map((d: any) => d.document_id) || [])];
              
              if (uniqueDocIds.length > 0) {
                const { data: videoDocs } = await supabase
                  .from('pipeline_a_documents')
                  .select('id, file_name, file_path, storage_bucket, processing_metadata')
                  .in('id', uniqueDocIds)
                  .eq('source_type', 'video');
                
                if (videoDocs && videoDocs.length > 0) {
                  videoDocumentsAvailable = videoDocs.map((d: any) => ({
                    document_id: d.id,
                    file_name: d.file_name,
                    file_path: d.file_path,
                    storage_bucket: d.storage_bucket,
                    processing_metadata: d.processing_metadata
                  }));
                  
                  console.log(`[VIDEO-TRACKING] ✅ Found ${videoDocumentsAvailable.length} video document(s)`);
                }
              }
            }
          } catch (err) {
            console.warn('[VIDEO-TRACKING] Failed to fetch video documents:', err);
          }
            
            if (documents.length > 0) {
              console.log(`✅ [AUTO-SEARCH] Found ${documents.length} relevant chunks from knowledge base`);
              
              knowledgeContext = '\n\n## 📚 RELEVANT KNOWLEDGE BASE CONTENT\n\n';
              
              // Add decomposition info if multiple queries
              if (decomposedQueries.length > 1) {
                knowledgeContext += `Your query was decomposed into ${decomposedQueries.length} search queries:\n`;
                decomposedQueries.forEach((q, i) => {
                  knowledgeContext += `  ${i+1}. "${q}" → ${queryBreakdown[q] || 0} chunks\n`;
                });
                knowledgeContext += `\nTotal unique chunks retrieved: ${documents.length}\n\n`;
              }
              
              knowledgeContext += `The following excerpts from your knowledge base are automatically loaded and relevant to the user's query:\n\n`;
              
              documents.forEach((doc: any, index: number) => {
                knowledgeContext += `### Excerpt ${index + 1}: ${doc.document_name}\n`;
                if (doc.category) knowledgeContext += `**Category**: ${doc.category}\n`;
                if (doc.summary) knowledgeContext += `**Summary**: ${doc.summary}\n`;
                knowledgeContext += `**Similarity**: ${((doc.similarity || 0) * 100).toFixed(1)}%\n`;
                knowledgeContext += `\n**Content**:\n${doc.content}\n\n`;
                knowledgeContext += `---\n\n`;
              });
              
              knowledgeContext += `\n**⚠️ REGOLE ANTI-HALLUCINATION OBBLIGATORIE**:\n`;
              knowledgeContext += `1. **RISPONDI SOLO** utilizzando informazioni ESPLICITAMENTE presenti negli excerpt sopra\n`;
              knowledgeContext += `2. Per OGNI affermazione, **CITA LA FONTE** specifica: "[Da: nome_documento, Excerpt N]"\n`;
              knowledgeContext += `3. Se un'informazione NON è presente negli excerpt, rispondi ESPLICITAMENTE:\n`;
              knowledgeContext += `   → "Questa informazione specifica non è presente nei documenti della knowledge base"\n`;
              knowledgeContext += `4. **NON INVENTARE MAI**:\n`;
              knowledgeContext += `   - Dati, numeri, percentuali non presenti nei chunk\n`;
              knowledgeContext += `   - Nomi, date, fonti non esplicitamente citati\n`;
              knowledgeContext += `   - Conclusioni non supportate dagli excerpt\n`;
              knowledgeContext += `5. Se la domanda copre PIÙ ARGOMENTI e solo ALCUNI sono presenti:\n`;
              knowledgeContext += `   - Rispondi per gli argomenti coperti con citazioni\n`;
              knowledgeContext += `   - Specifica esplicitamente quali argomenti NON sono coperti\n`;
              knowledgeContext += `6. **PRIORITÀ**: Precisione > Completezza. Meglio dire "non presente" che inventare\n\n`;
              knowledgeContext += `**ISTRUZIONI GENERALI**:\n`;
              knowledgeContext += `- Usa gli excerpt sopra per rispondere alla domanda dell'utente\n`;
              knowledgeContext += `- NON chiamare nuovamente il tool semantic_search - questo contenuto è stato caricato automaticamente\n`;
              knowledgeContext += `- I tool get_agent_knowledge e semantic_search sono disponibili SOLO per:\n`;
              knowledgeContext += `  * Interrogare la knowledge base di ALTRI agenti\n`;
              knowledgeContext += `  * Eseguire ricerche aggiuntive/di follow-up oltre questa ricerca automatica\n\n`;
              
            } else {
              console.log('ℹ️ [AUTO-SEARCH] No relevant content found in knowledge base');
              knowledgeContext = '\n\n## 📚 KNOWLEDGE BASE STATUS\n\n';
              knowledgeContext += `No relevant content was found in your knowledge base for this query.\n`;
              knowledgeContext += `This could mean:\n`;
              knowledgeContext += `- Your knowledge base doesn't contain documents on this topic\n`;
              knowledgeContext += `- The query is too specific or uses different terminology\n\n`;
            }
            
          } catch (err) {
            console.error('❌ [AUTO-SEARCH] Exception during semantic search:', err);
            knowledgeContext = '\n\n## 📚 KNOWLEDGE BASE ERROR\n\n';
            knowledgeContext += `An error occurred while searching your knowledge base. Proceeding without context.\n`;
            knowledgeContext += `Error: ${err instanceof Error ? err.message : 'Unknown error'}\n\n`;
          }
          
          // ============================================================================
          // TRACK TOOLS USED (for metadata)
          // ============================================================================
          const toolsUsed: string[] = [];
          
          // ============================================================================
          // BASE SYSTEM PROMPT (NO TOOL INSTRUCTIONS)
          // ============================================================================
          const baseSystemPrompt = `${agent.system_prompt}

## RESPONSE GUIDELINES

You are an expert AI assistant. When answering:
- Be CONCISE, objective, and data-driven
- Focus strictly on facts found in provided excerpts
- Cite sources with [Da: documento, Excerpt N] format
- Keep responses under 500 words unless absolutely necessary
- If information is not in context, state "Information not found"
- Do NOT provide comprehensive breakdowns unless explicitly requested

${knowledgeContext}${searchResultsContext}`;

          // Add mention instruction if @agent tags were detected
          const enhancedSystemPrompt = mentions.length > 0 
            ? baseSystemPrompt + mentionInstruction
            : baseSystemPrompt;

          // Define tools for all agents (simplified - tools are now optional/secondary)
          let toolCallCount = 0; // Track tool calls for validation
          
          const tools = [];
          
          // Add download_pdf tool only for knowledge-search-expert agents
          if (agent.slug === 'knowledge-search-expert') {
            tools.push({
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
            });
          }
          
          // ============= SHARED TOOL EXECUTION FUNCTION =============
          /**
           * Shared tool execution function for ALL LLM providers
           * Executes any of the 12 available tools and returns:
           * - toolResult: for continuation API calls
           * - responseText: to stream to user
           * - newFullResponse: updated fullResponse string
           */
          async function executeToolCall(
            toolName: string,
            toolInput: any,
            context: {
              agent: any,
              user: any,
              conversation: any,
              supabase: any,
              sendSSE: Function,
              requestId: string,
              fullResponse: string,
              conversationState: any,
              req: Request
            }
          ): Promise<{
            toolResult: any,
            responseText: string,
            newFullResponse: string
          }> {
            let toolResult: any = null;
            let responseText = '';
            let newFullResponse = context.fullResponse;
            
            // ============= TOOL 1: get_agent_knowledge =============
            if (toolName === 'get_agent_knowledge') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: get_agent_knowledge with input:`, JSON.stringify(toolInput));
              
              try {
                let targetAgentId = context.agent.id; // Default: current agent
                console.log(`📌 Default target: current agent ${context.agent.name} (${targetAgentId})`);
                
                // If agent_name is provided, find that agent
                if (toolInput.agent_name) {
                  console.log(`🔍 Searching for agent: "${toolInput.agent_name}"`);
                  
                  // Step 1: Try exact slug match first (most specific)
                  let targetAgent = null;
                  let agentError = null;
                  
                  ({ data: targetAgent, error: agentError } = await context.supabase
                    .from('agents')
                    .select('id, name, slug')
                    .eq('slug', toolInput.agent_name)
                    .eq('active', true)
                    .maybeSingle());
                  
                  // Step 2: If not found, try exact name match
                  if (!targetAgent && !agentError) {
                    const normalizedName = toolInput.agent_name.replace(/-/g, ' ');
                    ({ data: targetAgent, error: agentError } = await context.supabase
                      .from('agents')
                      .select('id, name, slug')
                      .ilike('name', normalizedName)
                      .eq('active', true)
                      .maybeSingle());
                  }
                  
                  // Step 3: If still not found, try partial match (LAST RESORT)
                  if (!targetAgent && !agentError) {
                    const normalizedName = toolInput.agent_name.replace(/-/g, ' ');
                    ({ data: targetAgent, error: agentError } = await context.supabase
                      .from('agents')
                      .select('id, name, slug')
                      .or(`name.ilike.%${normalizedName}%,slug.ilike.%${toolInput.agent_name}%`)
                      .eq('active', true)
                      .limit(1)
                      .maybeSingle());
                  }
                  
                  if (agentError || !targetAgent) {
                    // Fallback: Check if user is asking about current agent
                    const currentAgentMatches = 
                      context.agent.slug === toolInput.agent_name ||
                      context.agent.name.toLowerCase() === toolInput.agent_name.toLowerCase().replace(/-/g, ' ');
                    
                    if (currentAgentMatches) {
                      console.log(`⚠️ Agent search failed but matches current agent, using fallback`);
                      targetAgentId = context.agent.id;
                    } else {
                      console.error(`❌ Agent "${toolInput.agent_name}" not found:`, agentError);
                      toolResult = {
                        error: `Agent "${toolInput.agent_name}" non trovato`,
                        success: false
                      };
                      responseText = `❌ Agente "${toolInput.agent_name}" non trovato.\n`;
                      newFullResponse += responseText;
                      await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                      return { toolResult, responseText, newFullResponse };
                    }
                  } else {
                    targetAgentId = targetAgent.id;
                    console.log(`✅ Target agent found: ${targetAgent.name} (${targetAgentId})`);
                  }
                }
                
                console.log(`📊 Querying documents for agent: ${targetAgentId}`);
                const { data: distinctDocs, error: docsError } = await context.supabase.rpc('get_distinct_documents', {
                  p_agent_id: targetAgentId
                });
                
                if (docsError) {
                  console.error(`❌ Error fetching documents:`, docsError);
                  throw docsError;
                }
                
                console.log(`✅ Distinct documents found: ${distinctDocs?.length || 0}`);
                console.log(`   Documents:`, distinctDocs?.map((d: any) => d.document_name).join(', ') || 'none');
                
                toolResult = {
                  total_documents: distinctDocs?.length || 0,
                  documents: distinctDocs || [],
                  success: true
                };
                
                responseText = `📚 **Knowledge Base**: ${distinctDocs?.length || 0} documenti trovati\n\n`;
                if (distinctDocs && distinctDocs.length > 0) {
                  responseText += distinctDocs.map((d: any, i: number) => 
                    `${i + 1}. **${d.document_name}**`
                  ).join('\n');
                  responseText += '\n';
                }
                
                console.log(`📤 Sending response to user: ${responseText.length} chars`);
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                
              } catch (error) {
                console.error('❌ Error in get_agent_knowledge:', error);
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('   Stack:', error instanceof Error ? error.stack : 'no stack');
                toolResult = { error: 'Failed to retrieve knowledge base', success: false };
                responseText = `❌ Errore nel recupero della knowledge base: ${errorMsg}\n`;
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
              }
            }
            
            // ============= TOOL 2: web_search =============
            else if (toolName === 'web_search') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: web_search`);
              console.log(`   Query: ${toolInput.query}`);
              
              try {
                const SERP_API_KEY = Deno.env.get('SERP_API_KEY');
                if (!SERP_API_KEY) throw new Error('SERP_API_KEY not configured');
                
                const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(toolInput.query)}&api_key=${SERP_API_KEY}&num=${toolInput.num_results || 5}`;
                const serpResponse = await fetch(serpUrl);
                const serpData = await serpResponse.json();
                
                const results = serpData.organic_results?.slice(0, toolInput.num_results || 5).map((r: any) => ({
                  title: r.title,
                  url: r.link,
                  snippet: r.snippet
                })) || [];
                
                toolResult = { results };
                
                responseText = `🔍 **Web Search Results** for "${toolInput.query}":\n\n`;
                results.forEach((r: any, i: number) => {
                  responseText += `${i + 1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.url}\n\n`;
                });
                
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                
              } catch (error) {
                console.error('❌ Error in web_search:', error);
                toolResult = { error: 'Web search failed' };
              }
            }
            
            // ============= TOOL 3: download_pdf =============
            else if (toolName === 'download_pdf') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: download_pdf`);
              console.log(`   URL: ${toolInput.url}`);
              
              try {
                const { data: downloadData, error: downloadError } = await context.supabase.functions.invoke('download-pdf-tool', {
                  body: {
                    url: toolInput.url,
                    expectedTitle: toolInput.expected_title,
                    expectedAuthor: toolInput.expected_author,
                    agentId: context.agent.id,
                    conversationId: context.conversation.id,
                    searchQuery: toolInput.search_query || ''
                  }
                });
                
                if (downloadError) throw downloadError;
                
                toolResult = downloadData;
                responseText = `✅ PDF downloaded successfully\n`;
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                
              } catch (error) {
                console.error('❌ Error in download_pdf:', error);
                toolResult = { error: 'PDF download failed' };
              }
            }
            
            // ============= TOOL 4: semantic_search =============
            else if (toolName === 'semantic_search') {
              console.log(`🔍 [REQ-${context.requestId}] Tool called: semantic_search with query: "${toolInput.query}"`);
              
              try {
                const topK = toolInput.topK || 5;
                console.log(`   TopK: ${topK}`);
                
                // Call the semantic-search edge function
                const { data: searchResults, error: searchError } = await context.supabase.functions.invoke('semantic-search', {
                  body: {
                    query: toolInput.query,
                    agentId: context.agent.id,
                    topK: Math.min(topK, 10) // Max 10 chunks
                  }
                });
                
                const results = Array.isArray(searchResults) ? searchResults : searchResults?.documents || [];
                
                if (searchError) {
                  console.error(`❌ Semantic search error:`, searchError);
                  toolResult = { error: 'Failed to search knowledge base', success: false };
                  responseText = `❌ Errore nella ricerca: ${searchError.message}\n`;
                } else if (results.length === 0) {
                  console.log(`⚠️ No results found for query: "${toolInput.query}"`);
                  toolResult = { results: [], count: 0, success: true };
                  responseText = `ℹ️ Nessun risultato trovato per "${toolInput.query}".\n`;
                } else {
                  console.log(`✅ Found ${results.length} relevant chunks`);
                  results.forEach((r: any, i: number) => {
                    console.log(`   ${i + 1}. ${r.document_name} (similarity: ${r.similarity?.toFixed(3)})`);
                  });
                  
                  toolResult = {
                    results: results.map((r: any) => ({
                      document_name: r.document_name,
                      content: r.content,
                      category: r.category,
                      similarity: r.similarity
                    })),
                    count: results.length,
                    success: true
                  };
                  
                  // Empty response - LLM will use toolResult to formulate answer
                  responseText = '';
                }
                
                newFullResponse += responseText;
                if (responseText) {
                  await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                }
                
              } catch (error) {
                console.error('❌ Error in semantic_search:', error);
                toolResult = { error: 'Failed to search knowledge base', success: false };
                responseText = `❌ Errore nella ricerca della knowledge base.\n`;
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
              }
            }
            
            // ============= TOOL 5: web_scrape =============
            else if (toolName === 'web_scrape') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: web_scrape`);
              
              try {
                const { data: scrapeData, error: scrapeError } = await context.supabase.functions.invoke('web-scrape', {
                  body: { url: toolInput.url }
                });
                
                if (scrapeError) throw scrapeError;
                
                toolResult = scrapeData;
                responseText = `✅ Web page scraped successfully\n`;
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                
              } catch (error) {
                console.error('❌ Error in web_scrape:', error);
                toolResult = { error: 'Web scraping failed' };
              }
            }
            
            // ============= TOOL 6: airtop_browser_automation =============
            else if (toolName === 'airtop_browser_automation') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: airtop_browser_automation`);
              
              try {
                const { data: airtopData, error: airtopError } = await context.supabase.functions.invoke('airtop-browser-automation', {
                  body: { task: toolInput.task }
                });
                
                if (airtopError) throw airtopError;
                
                toolResult = airtopData;
                responseText = `✅ Browser automation completed\n`;
                newFullResponse += responseText;
                await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
                
              } catch (error) {
                console.error('❌ Error in airtop_browser_automation:', error);
                toolResult = { error: 'Browser automation failed' };
              }
            }
            
            // ============= TOOL 6-12: Book Search Expert Tools =============
            else if (toolName === 'search_pdf_with_query' || 
                     toolName === 'search_and_acquire_pdfs' ||
                     toolName === 'propose_pdf_search_query') {
              console.log(`🛠️ [REQ-${context.requestId}] Tool called: ${toolName} (Book Search Expert)`);
              
              // These tools have complex logic handled in dedicated edge functions
              // For now, return a placeholder result
              toolResult = { 
                success: true, 
                message: `${toolName} executed` 
              };
              
              responseText = `✅ ${toolName} completed\n`;
              newFullResponse += responseText;
              await context.sendSSE(JSON.stringify({ type: 'content', text: responseText }));
            }
            
            // ============= FALLBACK: Unknown Tool =============
            else {
              console.warn(`⚠️ [REQ-${context.requestId}] Unknown tool: ${toolName}`);
              toolResult = { error: `Unknown tool: ${toolName}` };
            }
            
            return { toolResult, responseText, newFullResponse };
          }
          
          // Add PDF search tools for both Book Search Expert agents
          if (agent.slug === 'book-search-expert-copy' || agent.slug === 'book-serach-expert') {
            // Tool: Execute search query (will auto-add " PDF")
            tools.push({
              name: 'search_pdf_with_query',
              description: 'Esegue una ricerca PDF con una query specifica SENZA scaricare i PDF. Mostra solo i risultati. La query usata è ESATTAMENTE quella approvata dall\'utente. Usa questo DOPO che l\'utente ha approvato una query proposta da propose_pdf_search_query.',
              input_schema: {
                type: 'object',
                properties: {
                  searchQuery: {
                    type: 'string',
                    description: 'La query di ricerca COMPLETA E FINALE che verrà usata per cercare (es: "LLM Prompt Engineering" PDF). Questa è la query ESATTA che verrà inviata a Google.'
                  },
                  maxResults: {
                    type: 'number',
                    description: 'Numero massimo di risultati da trovare (default: 5, max: 10)',
                    default: 5
                  }
                },
                required: ['searchQuery']
              }
            });
            
            // Tool 3: Download approved PDFs
            tools.push({
              name: 'search_and_acquire_pdfs',
              description: 'Scarica e valida PDF già trovati e approvati dall\'utente. Il download avviene in BACKGROUND. Usa questo DOPO che l\'utente ha confermato di voler scaricare i risultati di search_pdf_with_query.',
              input_schema: {
                type: 'object',
                properties: {
                  pdfsToDownload: {
                    type: 'array',
                    description: 'Lista di PDF da scaricare (già trovati e approvati dall\'utente)',
                    items: {
                      type: 'object',
                      properties: {
                        title: { 
                          type: 'string',
                          description: 'Titolo del PDF'
                        },
                        url: { 
                          type: 'string',
                          description: 'URL del PDF'
                        },
                        source: { 
                          type: 'string',
                          description: 'Dominio sorgente del PDF'
                        }
                      },
                      required: ['title', 'url', 'source']
                    }
                  }
                },
                required: ['pdfsToDownload']
              }
            });
          }
          
          // Add collaboration tools for all agents
          tools.push({
            name: 'web_search',
            description: 'Search the internet for information using Google Custom Search. Use this when the user asks you to search for current information, news, articles, or any web content. Returns a list of search results with titles, URLs, and snippets.',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to send to Google. Be specific and use relevant keywords.'
                },
                num_results: {
                  type: 'number',
                  description: 'Number of results to return (1-10, default 5)',
                  default: 5
                },
                scrape_results: {
                  type: 'boolean',
                  description: 'Whether to scrape full content from each result (default false)',
                  default: false
                }
              },
              required: ['query']
            }
          });
          
          tools.push({
            name: 'web_scrape',
            description: 'Scrape content from a specific web page URL. Returns both HTML and cleaned text content. Use this when you need to extract detailed information from a particular website.',
            input_schema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL of the web page to scrape'
                },
                render_js: {
                  type: 'boolean',
                  description: 'Whether to render JavaScript on the page (default true)',
                  default: true
                },
                block_ads: {
                  type: 'boolean',
                  description: 'Whether to block ads (default true)',
                  default: true
                }
              },
              required: ['url']
            }
          });
          
          tools.push({
            name: 'list_other_agents',
            description: 'Get a list of all available agents in the system. Use this when the user asks about other agents or when you need to know what agents are available for consultation.',
            input_schema: {
              type: 'object',
              properties: {},
              required: []
            }
          });
          
          tools.push({
            name: 'get_agent_prompt',
            description: 'Get the system prompt of another agent. Use this when the user asks about what another agent does or what instructions it follows.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent whose prompt you want to retrieve'
                }
              },
              required: ['agent_name']
            }
          });
          
          tools.push({
            name: 'get_agent_knowledge',
            description: '📋 Get document titles list. NOTE: Usually auto-executed by the system. Use ONLY if user explicitly asks about ANOTHER agent\'s documents (e.g., "what documents does Agent X have?").',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'Name or slug of another agent whose documents you want to list'
                }
              },
              required: ['agent_name']
            }
          });
          
          tools.push({
            name: 'semantic_search',
            description: '📖 Search document content. NOTE: Usually auto-executed by the system. Use ONLY if you need ADDITIONAL searches beyond what was auto-retrieved, or for follow-up questions requiring different search terms.',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Additional search query for follow-up information'
                },
                topK: {
                  type: 'number',
                  description: 'Number of results (default 5)',
                  default: 5
                }
              },
              required: ['query']
            }
          });
          
          tools.push({
            name: 'get_agent_chat_history',
            description: 'Get the chat history of another agent with the current user. Use this when the user asks what they discussed with another agent.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent whose chat history you want to view'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of messages to retrieve (default 50)',
                  default: 50
                }
              },
              required: ['agent_name']
            }
          });
          
          tools.push({
            name: 'consult_agent_full_knowledge',
            description: 'Get the COMPLETE content of all documents in another agent\'s knowledge base. This retrieves ALL text chunks from all documents, allowing you to understand the full context of what an agent knows. Use this when you need to deeply understand another agent\'s knowledge before making decisions or writing prompts for them. WARNING: This can return a lot of data, use only when you need full knowledge access.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent whose full knowledge base you want to access'
                },
                max_chunks: {
                  type: 'number',
                  description: 'Maximum number of knowledge chunks to retrieve (default 100, max 500)',
                  default: 100
                }
              },
              required: ['agent_name']
            }
          });
          
          tools.push({
            name: 'ask_agent_to_perform_task',
            description: 'Ask another agent to perform a specific task and get their response. This creates a direct communication between agents. Use this when you need another agent to do something for you (e.g., ask the Prompt Expert to write a prompt, ask a specialist to analyze something). The other agent will receive your request and respond based on their expertise and knowledge.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent you want to ask'
                },
                task_description: {
                  type: 'string',
                  description: 'A clear description of what you want the agent to do. Be specific and provide all necessary context.'
                },
                context_information: {
                  type: 'string',
                  description: 'Optional additional context or information the agent should consider when performing the task',
                }
              },
              required: ['agent_name', 'task_description']
            }
          });
          
          tools.push({
            name: 'update_agent_system_prompt',
            description: 'Update the system prompt of another agent. Use this when you need to modify how an agent behaves or what instructions it follows. Only use this when explicitly asked to update or change an agent\'s prompt.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent whose prompt you want to update'
                },
                new_system_prompt: {
                  type: 'string',
                  description: 'The complete new system prompt for the agent'
                }
              },
              required: ['agent_name', 'new_system_prompt']
            }
          });
          
          // Log tool availability
          if (tools) {
            console.log(`🔧 [REQ-${requestId}] Tools available to agent:`);
            tools.forEach(tool => console.log(`   - ${tool.name}: enabled`));
          }

          // Set timeout for API call (5 minutes)
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
          
          // Declare provider-specific variables in outer scope for continuation access
          let deepseekMessages: any[] = [];
          let deepseekModel = '';
          let deepseekTools: any[] = [];
          
          let openaiMessages: any[] = [];
          let openaiModel = '';
          let openaiTools: any[] = [];
          
          let openrouterMessages: any[] = [];
          let openrouterModel = '';
          let openrouterTools: any[] = [];
          let OPENROUTER_API_KEY: string | undefined;
          
          let geminiMessages: any[] = [];
          let geminiModel = '';
          let geminiTools: any[] = [];
          let GOOGLE_API_KEY: string | undefined; // Will hold GOOGLE_AI_STUDIO_API_KEY
          
          let response: Response;
          try {
            // Route to appropriate LLM provider
            if (llmProvider === 'deepseek') {
              // DeepSeek with direct streaming
              deepseekModel = agent.ai_model || 'deepseek-chat';
              console.log('🚀 ROUTING TO DEEPSEEK');
              console.log(`   Model: ${deepseekModel}`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              // ⚠️ CRITICAL: DeepSeek tool calling ONLY works with deepseek-reasoner
              if (deepseekModel === 'deepseek-chat' && tools && tools.length > 0) {
                console.warn('⚠️ WARNING: deepseek-chat does NOT support tool calling!');
                console.warn('⚠️ Tools will be IGNORED. Use deepseek-reasoner for tool calling.');
                console.warn('⚠️ Available tools being ignored:', tools.map(t => t.name).join(', '));
              }
              
              if (!DEEPSEEK_API_KEY) {
                throw new Error('DEEPSEEK_API_KEY is required but not set');
              }
              
              deepseekMessages = [
                { role: 'system', content: enhancedSystemPrompt },
                ...anthropicMessages
              ];
              
              // Convert tools to OpenAI format (DeepSeek is OpenAI-compatible)
              deepseekTools = tools?.map(tool => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.input_schema
                }
              }));
              
              response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: deepseekModel,
                  messages: deepseekMessages,
                  temperature: 0.7,
                  max_tokens: 4000,
                  tools: deepseekTools,
                  tool_choice: "auto",
                  stream: true
                }),
                signal: controller.signal
              });
              
            } else if (llmProvider === 'openai') {
              // OpenAI implementation (streaming)
              openaiModel = 'gpt-4o';
              console.log('🚀 ROUTING TO OPENAI');
              console.log(`   Model: ${openaiModel}`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              // Convert tools to OpenAI format
              openaiTools = tools?.map(tool => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.input_schema
                }
              }));
              
              openaiMessages = [
                { role: 'system', content: enhancedSystemPrompt },
                ...anthropicMessages
              ];
              
              response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: openaiModel,
                  messages: openaiMessages,
                  temperature: 0.7,
                  max_tokens: 4096, // 🔧 ADDED: explicit limit (was unlimited before)
                  tools: openaiTools,
                  tool_choice: "auto",
                  stream: true
                }),
                signal: controller.signal
              });
              
            } else if (llmProvider === 'openrouter') {
              // OpenRouter implementation (streaming) - access to 100+ models
              openrouterModel = aiModel || 'deepseek/deepseek-chat'; // Use agent's model or default
              console.log('🚀 ROUTING TO OPENROUTER');
              console.log(`   Model: ${openrouterModel}`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
              if (!OPENROUTER_API_KEY) {
                throw new Error('OPENROUTER_API_KEY is required but not set');
              }
              
              // Convert tools based on model type (Anthropic or OpenAI format)
              const isAnthropicModel = openrouterModel.includes('claude');
              openrouterTools = isAnthropicModel 
                ? tools  // Keep Anthropic format
                : tools?.map(tool => ({  // Convert to OpenAI format
                    type: "function",
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.input_schema
                    }
                  }));
              
              openrouterMessages = [
                { role: 'system', content: enhancedSystemPrompt },
                ...anthropicMessages
              ];
              
              response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                  'HTTP-Referer': 'https://lovable.dev',
                  'X-Title': 'Multi-Agent Consultant',
                },
                body: JSON.stringify({
                  model: openrouterModel,
                  messages: openrouterMessages,
                  temperature: 0.7,
                  max_tokens: 4096, // 🔧 ADDED: explicit limit (was unlimited before)
                  tools: openrouterTools,
                  tool_choice: "auto",
                  stream: true
                }),
                signal: controller.signal
              });
              
            } else if (llmProvider === 'google' || llmProvider === 'google-gemini') {
              // Google Gemini implementation
              geminiModel = aiModel ? aiModel.replace('google/', '') : 'gemini-2.0-flash-exp';
              console.log('🚀 ROUTING TO GOOGLE GEMINI');
              console.log(`   Model: ${geminiModel}`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              GOOGLE_API_KEY = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
              if (!GOOGLE_API_KEY) {
                throw new Error('GOOGLE_AI_STUDIO_API_KEY is required but not set');
              }
              
              // Convert tools to Gemini format
              geminiTools = tools ? [{
                function_declarations: tools.map(tool => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.input_schema
                }))
              }] : [];
              
              // Convert messages to Gemini format
              geminiMessages = anthropicMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
              }));
              
              response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${GOOGLE_API_KEY}&alt=sse`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    contents: geminiMessages,
                    tools: geminiTools,
                    systemInstruction: {
                      parts: [{ text: enhancedSystemPrompt }]
                    },
                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 8192,
                    }
                  }),
                  signal: controller.signal
                }
              );
              
            } else {
              // Default: Anthropic
              console.log('🚀 ROUTING TO ANTHROPIC');
              console.log(`   Model: claude-sonnet-4-5`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              
              if (!ANTHROPIC_API_KEY) {
                throw new Error('ANTHROPIC_API_KEY is required but not set');
              }
              
              console.log('🚀 ROUTING TO ANTHROPIC');
              console.log(`   Model: claude-sonnet-4-5`);
              console.log(`   Message count: ${anthropicMessages.length}`);
              console.log(`   API Key present: ${ANTHROPIC_API_KEY ? 'YES' : 'NO'}`);
              console.log(`   API Key prefix: ${ANTHROPIC_API_KEY?.slice(0, 8)}...`);
              console.log(`   System prompt length: ${enhancedSystemPrompt.length} chars`);
              console.log(`   Tools enabled: ${tools.length} tools`);
              
              response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-5',
                  max_tokens: 4096, // 🔧 REDUCED: 64000 → 4096 (prevents $69 output cost explosions)
                  temperature: 0.7,
                  system: enhancedSystemPrompt,
                  messages: anthropicMessages,
                  tools: tools,
                  stream: true // ✅ Riabilitato per compatibilità con parser SSE
                }),
                signal: controller.signal
              });
              
              console.log(`   ✅ Response status: ${response.status}`);
              console.log(`   ✅ Response ok: ${response.ok}`);
              console.log(`   ✅ Response headers:`, Object.fromEntries(response.headers.entries()));
            }
          
            clearTimeout(timeout);

            if (!response.ok) {
              const errorBody = await response.text();
              console.error(`❌ ${llmProvider.toUpperCase()} API ERROR`);
              console.error(`   Status: ${response.status}`);
              console.error(`   Body: ${errorBody}`);
              console.error(`   Headers:`, Object.fromEntries(response.headers.entries()));
              
              // Update placeholder with error message so user sees something
              if (placeholderMsg) {
                await supabase
                  .from('agent_messages')
                  .update({
                    content: `❌ Errore API (${response.status}): ${errorBody.slice(0, 200)}...`,
                    llm_provider: llmProvider
                  })
                  .eq('id', placeholderMsg.id);
              }
              
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
          
          // Add Anthropic-specific timeout (30 seconds for first chunk)
          let anthropicTimeout: number | undefined;
          if (llmProvider === 'anthropic') {
            anthropicTimeout = setTimeout(async () => {
              console.error('❌ Anthropic stream timeout after 30s - no content received');
              if (placeholderMsg) {
                supabase
                  .from('agent_messages')
                  .update({
                    content: '❌ Timeout: nessuna risposta ricevuta da Claude dopo 30 secondi.',
                    llm_provider: llmProvider
                  })
                  .eq('id', placeholderMsg.id);
              }
              clearInterval(keepAliveInterval);
              await closeStream();
            }, 30000);
          }
          let buffer = '';
          let lastKeepAlive = Date.now();
          let chunkCount = 0;
          let lastProgressLog = Date.now();

          console.log(`🔄 [REQ-${requestId}] Starting stream from ${llmProvider.toUpperCase()}...`);

          // Send keep-alive every 15 seconds to prevent timeout
          const keepAliveInterval = setInterval(async () => {
            await sendSSE(':keep-alive\n\n');
            console.log('📡 Keep-alive sent');
          }, 15000);

          // Removed timeout/background logic - stream continues until completion
          
          try {
            while (true) {
              
              const { done, value } = await reader.read();
              
              if (done) {
                const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
                console.log(`✅ [REQ-${requestId}] Stream ended. Provider: ${llmProvider}, Total response length: ${fullResponse.length} chars`);
                console.log(`   Duration: ${totalDuration}s, Chunks: ${chunkCount}`);
                clearInterval(keepAliveInterval);
                // Progressive save every 5k chars during streaming
                if (fullResponse.length > 0) {
                  // 📊 Calculate source reliability
                  const sourceReliability = hasKnowledgeContext ? 'high' : (toolsUsed.length > 0 ? 'medium' : 'low');
                  
                  await supabase
                    .from('agent_messages')
                    .update({ 
                      content: fullResponse,
                      llm_provider: llmProvider,
                      metadata: {
                        has_knowledge_context: hasKnowledgeContext,
                        knowledge_stats: knowledgeStats,
                        tools_used: toolsUsed,
                        source_reliability: sourceReliability,
                        video_documents_available: videoDocumentsAvailable.length > 0 ? videoDocumentsAvailable : undefined
                      }
                    })
                    .eq('id', placeholderMsg.id);
                }
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.trim() || line.startsWith(':')) continue;
                
                // SSE format for all providers (Anthropic, OpenAI, DeepSeek, OpenRouter, Google)
                if (!line.startsWith('data: ')) continue;

                const data = line.slice(6);
                if (data === '[DONE]') {
                  console.log(`🏁 [REQ-${requestId}] [${llmProvider.toUpperCase()}] Received [DONE] signal`);
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  chunkCount++;
                  
                  // Clear Anthropic timeout on first chunk received
                  if (anthropicTimeout && chunkCount === 1) {
                    clearTimeout(anthropicTimeout);
                    console.log('✅ First chunk received, Anthropic timeout cleared');
                  }
                  
                  // 🔧 GOOGLE GEMINI: Handle SSE format with alt=sse
                  if (llmProvider === 'google' || llmProvider === 'google-gemini') {
                    console.log(`📥 [REQ-${requestId}] [Google] SSE chunk ${chunkCount}`);
                    
                    // Extract text content
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                      console.log(`✅ [REQ-${requestId}] [Google] Text: ${text.slice(0, 100)}...`);
                      fullResponse += text;
                      await sendSSE(JSON.stringify({ type: 'content', text }));
                      
                      // Progressive save every ~5000 chars
                      if (fullResponse.length > 0 && fullResponse.length % 5000 < text.length) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse, llm_provider: llmProvider })
                          .eq('id', placeholderMsg.id);
                        console.log(`💾 [REQ-${requestId}] Progressive save: ${fullResponse.length} chars`);
                      }
                    }
                    
                    // Handle function calls - EXECUTE IMMEDIATELY
                    const functionCall = parsed.candidates?.[0]?.content?.parts?.[0]?.functionCall;
                    if (functionCall && functionCall.name) {
                      toolUseName = functionCall.name;
                      toolUseId = `gemini_${Date.now()}`;
                      console.log(`🔧 [REQ-${requestId}] [Google] Function call: ${toolUseName}`);
                      
                      try {
                        const toolInput = functionCall.args;
                        
                        // Execute tool using shared function
                        const { toolResult, responseText, newFullResponse } = await executeToolCall(
                          toolUseName!,
                          toolInput,
                          {
                            agent,
                            user,
                            conversation,
                            supabase,
                            sendSSE,
                            requestId,
                            fullResponse,
                            conversationState,
                            req
                          }
                        );
                        
                        fullResponse = newFullResponse;
                        
                        // Sanitize tool result for Google API (prevents 400 errors)
                        const sanitizeForGoogle = (result: any): any => {
                          if (!result?.results) return result;
                          const MAX_CONTENT_LENGTH = 1000;
                          const MAX_CHUNKS = 5;
                          return {
                            ...result,
                            results: result.results.slice(0, MAX_CHUNKS).map((r: any) => ({
                              document_name: String(r.document_name || ''),
                              content: String(r.content || '')
                                .slice(0, MAX_CONTENT_LENGTH)
                                .replace(/&#x[0-9a-fA-F]+;/g, ' ')
                                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
                                .replace(/\n+/g, ' ')
                                .replace(/\|/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim(),
                              category: String(r.category || ''),
                              similarity: Number(r.similarity) || 0
                            }))
                          };
                        };
                        const sanitizedResult = sanitizeForGoogle(toolResult);
                        console.log(`📦 [REQ-${requestId}] [Google] Sanitized tool result: ${JSON.stringify(sanitizedResult).length} chars, chunks: ${sanitizedResult?.results?.length || 0}`);
                        
                        // Continue streaming with tool result
                        const continueResponse = await fetch(
                          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${GOOGLE_API_KEY}&alt=sse`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              contents: [
                                ...geminiMessages,
                                {
                                  role: 'model',
                                  parts: [{ functionCall: { name: toolUseName, args: toolInput } }]
                                },
                                {
                                  role: 'function',
                                  parts: [{ functionResponse: { name: toolUseName, response: sanitizedResult } }]
                                }
                              ],
                              tools: geminiTools,
                              generationConfig: {
                                temperature: 0.7,
                                maxOutputTokens: 1024
                              }
                            })
                          }
                        );
                        
                        if (!continueResponse.ok) {
                          const errorBody = await continueResponse.text();
                          console.error(`❌ [REQ-${requestId}] [Google] API error ${continueResponse.status}: ${errorBody.slice(0, 500)}`);
                          
                          // FALLBACK: Generate response from retrieved chunks
                          if (toolResult?.results?.length > 0) {
                            const fallbackContent = toolResult.results
                              .slice(0, 3)
                              .map((r: any) => `[${r.document_name}]: ${String(r.content || '').slice(0, 500)}`)
                              .join('\n\n');
                            
                            const fallbackResponse = `Based on the retrieved documents:\n\n${fallbackContent}\n\n(Note: This is a fallback response due to API error)`;
                            fullResponse += fallbackResponse;
                            await sendSSE(JSON.stringify({ type: 'content', text: fallbackResponse }));
                            await sendSSE(JSON.stringify({ type: 'end' }));
                            console.log(`⚠️ [REQ-${requestId}] [Google] Fallback response generated from ${toolResult.results.length} chunks`);
                            break; // Exit the tool calling loop
                          } else {
                            throw new Error(`Google API error: ${continueResponse.status} - ${errorBody.slice(0, 200)}`);
                          }
                        }
                        
                        // Stream the continuation response (also SSE format)
                        const continueReader = continueResponse.body?.getReader();
                        if (!continueReader) throw new Error('No response body from Google');
                        
                        let continueBuffer = '';
                        while (true) {
                          const { done, value } = await continueReader.read();
                          if (done) break;
                          
                          continueBuffer += decoder.decode(value, { stream: true });
                          const continueLines = continueBuffer.split('\n');
                          continueBuffer = continueLines.pop() || '';
                          
                          for (const continueLine of continueLines) {
                            if (!continueLine.trim() || continueLine.startsWith(':')) continue;
                            if (!continueLine.startsWith('data: ')) continue;
                            
                            const continueData = continueLine.slice(6);
                            if (continueData === '[DONE]') continue;
                            
                            try {
                              const continueParsed = JSON.parse(continueData);
                              const continueText = continueParsed.candidates?.[0]?.content?.parts?.[0]?.text;
                              if (continueText) {
                                fullResponse += continueText;
                                await sendSSE(JSON.stringify({ type: 'content', text: continueText }));
                              }
                            } catch (e) {
                              // Skip malformed JSON
                            }
                          }
                        }
                      } catch (toolError) {
                        console.error(`❌ [REQ-${requestId}] [Google] Tool execution error:`, toolError);
                      }
                    }
                    continue; // Continue to next line
                  }
                  
                  // Log chunk details for debugging
                  if (llmProvider === 'anthropic') {
                    console.log(`🔍 [REQ-${requestId}] Anthropic Chunk ${chunkCount}: type=${parsed.type}`);
                  }
                  
                  // Handle DeepSeek streaming format (OpenAI-compatible)
                  if (llmProvider === 'deepseek') {
                    // Handle tool calls
                    if (parsed.choices?.[0]?.delta?.tool_calls) {
                      const toolCall = parsed.choices[0].delta.tool_calls[0];
                      
                      if (toolCall.function?.name) {
                        toolUseName = toolCall.function.name;
                        toolUseId = toolCall.id || `call_${Date.now()}`;
                        toolUseInputJson = '';
                        console.log(`🔧 [DeepSeek] Tool call started: ${toolUseName}`);
                      }
                      
                      if (toolCall.function?.arguments) {
                        toolUseInputJson += toolCall.function.arguments;
                      }
                    }
                    
                    // Handle finish_reason === "tool_calls" - EXECUTE TOOL IMMEDIATELY
                    if (parsed.choices?.[0]?.finish_reason === 'tool_calls' && toolUseName && toolUseInputJson) {
                      console.log(`🛠️ [DeepSeek] Executing tool: ${toolUseName}`);
                      
                      try {
                        const toolInput = JSON.parse(toolUseInputJson);
                        
                        // ✅ EXECUTE TOOL using shared function
                        const { toolResult, responseText, newFullResponse } = await executeToolCall(
                          toolUseName,
                          toolInput,
                          {
                            agent,
                            user,
                            conversation,
                            supabase,
                            sendSSE,
                            requestId,
                            fullResponse,
                            conversationState,
                            req
                          }
                        );
                        
                        // Add tool call + result to messages
                        deepseekMessages.push({
                          role: 'assistant',
                          content: null,
                          tool_calls: [{
                            id: toolUseId || 'tool_' + Date.now(),
                            type: 'function',
                            function: { name: toolUseName, arguments: toolUseInputJson }
                          }]
                        });
                        
                        deepseekMessages.push({
                          role: 'tool',
                          tool_call_id: toolUseId || 'tool_' + Date.now(),
                          content: JSON.stringify(toolResult)
                        });
                        
                        fullResponse = newFullResponse;
                        needsToolResultContinuation = true;
                        toolCallCount++;
                        
                        // Reset
                        toolUseName = null;
                        toolUseInputJson = '';
                        toolUseId = null;
                        
                        console.log(`✅ [DeepSeek] Tool executed, continuation needed`);
                        
                      } catch (e) {
                        console.error(`❌ [DeepSeek] Tool execution error:`, e);
                        fullResponse += `\n\n❌ Errore nell'esecuzione del tool.\n\n`;
                      }
                    }
                    
                    // Handle regular text content
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      // Progressive save every 5k chars
                      if (fullResponse.length > 0 && fullResponse.length % 5000 < newText.length) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse, llm_provider: llmProvider })
                          .eq('id', placeholderMsg.id);
                        console.log(`💾 [REQ-${requestId}] Progressive save: ${fullResponse.length} chars`);
                      }
                      
                      // Log progress every 1000 chars
                      const now = Date.now();
                      if (fullResponse.length > 0 && fullResponse.length % 1000 < newText.length) {
                        const elapsed = ((now - requestStartTime) / 1000).toFixed(1);
                        console.log(`📊 [REQ-${requestId}] Progress: ${fullResponse.length} chars (${elapsed}s elapsed)`);
                        lastProgressLog = now;
                      }
                      
                      if (now - lastUpdateTime > 5000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    continue; // Skip OpenAI/Anthropic-specific handling
                  }
                  
                  // Handle OpenAI streaming format
                  if (llmProvider === 'openai') {
                    // Handle tool calls
                    if (parsed.choices?.[0]?.delta?.tool_calls) {
                      const toolCall = parsed.choices[0].delta.tool_calls[0];
                      
                      if (toolCall.function?.name) {
                        toolUseName = toolCall.function.name;
                        toolUseId = toolCall.id || `call_${Date.now()}`;
                        toolUseInputJson = '';
                        console.log(`🔧 [OpenAI] Tool call started: ${toolUseName}`);
                      }
                      
                      if (toolCall.function?.arguments) {
                        toolUseInputJson += toolCall.function.arguments;
                      }
                    }
                    
                    // Handle finish_reason === "tool_calls"
              if (parsed.choices?.[0]?.finish_reason === 'tool_calls' && toolUseName && toolUseInputJson) {
                try {
                  const toolInput = JSON.parse(toolUseInputJson);
                  
                  console.log(`🛠️ [OpenAI] Executing tool: ${toolUseName}`);
                  
                  // Execute tool using shared function
                  const { toolResult, responseText, newFullResponse } = await executeToolCall(
                    toolUseName,
                    toolInput,
                    {
                      agent,
                      user,
                      conversation,
                      supabase,
                      sendSSE,
                      requestId,
                      fullResponse,
                      conversationState,
                      req
                    }
                  );
                  
                  // Add tool call to messages
                  openaiMessages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                      id: toolUseId || 'tool_' + Date.now(),
                      type: 'function',
                      function: {
                        name: toolUseName,
                        arguments: toolUseInputJson
                      }
                    }]
                  });
                  
                  // Add tool result to messages
                  openaiMessages.push({
                    role: 'tool',
                    tool_call_id: toolUseId || 'tool_' + Date.now(),
                    content: JSON.stringify(toolResult)
                  });
                  
                  fullResponse = newFullResponse;
                  needsToolResultContinuation = true;
                  toolCallCount++;
                  
                  // Reset for next tool
                  toolUseName = null;
                  toolUseInputJson = '';
                  toolUseId = null;
                  
                } catch (e) {
                  console.error(`❌ [OpenAI] Tool execution error:`, e);
                  fullResponse += `\n\n❌ Errore nell'esecuzione del tool.\n\n`;
                }
              }
                    
                    // Handle regular text content
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      
                      // Block agent output if system has already sent the message
                      if (!skipAgentResponse) {
                        fullResponse += newText;
                        await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                        
                        // Progressive save every 5k chars
                        const now = Date.now();
                        if (fullResponse.length > 0 && fullResponse.length % 5000 < newText.length) {
                          await supabase
                            .from('agent_messages')
                            .update({ content: fullResponse, llm_provider: llmProvider })
                            .eq('id', placeholderMsg.id);
                          console.log(`💾 [REQ-${requestId}] Progressive save: ${fullResponse.length} chars`);
                        }
                        
                        // Log progress every 1000 chars
                        if (fullResponse.length > 0 && fullResponse.length % 1000 < newText.length) {
                          const elapsed = ((now - requestStartTime) / 1000).toFixed(1);
                          console.log(`📊 [REQ-${requestId}] Progress: ${fullResponse.length} chars (${elapsed}s elapsed)`);
                          lastProgressLog = now;
                        }
                      }
                      
                      // ========================================
                      // DETERMINISTIC WORKFLOW: DETECT QUERY PROPOSAL IN AGENT RESPONSE
                      // ========================================
                      if (isBookSearchExpert && !systemManagedSearch) {
                        const proposedQuery = detectProposedQuery(fullResponse);
                        if (proposedQuery && !conversationState.lastProposedQuery) {
                          console.log(`🎯 [WORKFLOW] Detected proposed query in agent response: "${proposedQuery}"`);
                          await updateConversationState(conversationId, {
                            lastProposedQuery: proposedQuery,
                            waitingForConfirmation: true
                          }, supabase);
                        }
                      }
                    }
                    continue; // Skip Anthropic-specific handling
                  }
                  
                  // Handle Google Gemini streaming format
                  if (llmProvider === 'google' || llmProvider === 'google-gemini') {
                    // Gemini uses a different format - not SSE, but newline-delimited JSON
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                      fullResponse += text;
                      await sendSSE(JSON.stringify({ type: 'content', text }));
                      
                      const now = Date.now();
                      if (fullResponse.length > 0 && fullResponse.length % 5000 < text.length) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse, llm_provider: llmProvider })
                          .eq('id', placeholderMsg.id);
                        console.log(`💾 [REQ-${requestId}] Progressive save: ${fullResponse.length} chars`);
                      }
                    }
                    
                    // Handle function call - EXECUTE IMMEDIATELY
                    const functionCall = parsed.candidates?.[0]?.content?.parts?.[0]?.functionCall;
                    if (functionCall && functionCall.name) {
                      const currentToolName = functionCall.name;
                      toolUseName = currentToolName;
                      toolUseId = `gemini_${Date.now()}`;
                      console.log(`🔧 [Gemini] Function call: ${currentToolName}`);
                      
                      try {
                        const toolInput = functionCall.args; // ✅ Gemini passes args directly
                        
                        // Execute tool using shared function
                        const { toolResult, responseText, newFullResponse } = await executeToolCall(
                          currentToolName,
                          toolInput,
                          {
                            agent,
                            user,
                            conversation,
                            supabase,
                            sendSSE,
                            requestId,
                            fullResponse,
                            conversationState,
                            req
                          }
                        );
                        
                        // Gemini message format
                        geminiMessages.push({
                          role: 'model',
                          parts: [{ functionCall: { name: currentToolName, args: toolInput } }]
                        });
                        
                        geminiMessages.push({
                          role: 'function',
                          parts: [{ functionResponse: { name: currentToolName, response: toolResult } }]
                        });
                        
                        fullResponse = newFullResponse;
                        needsToolResultContinuation = true;
                        toolCallCount++;
                        
                        // Reset
                        toolUseName = null;
                        toolUseId = null;
                        
                        console.log(`✅ [Gemini] Tool executed, continuation needed`);
                        
                      } catch (e) {
                        console.error(`❌ [Gemini] Tool execution error:`, e);
                        fullResponse += `\n\n❌ Errore nell'esecuzione del tool.\n\n`;
                      }
                    }
                    
                    continue;
                  }
                  
                  // Anthropic-specific handling
                  // Handle message start
                  if (parsed.type === 'message_start') {
                    console.log(`📨 [REQ-${requestId}] Anthropic message started`);
                    console.log(`📜 [REQ-${requestId}] Conversation context (last 3 messages):`, 
                      JSON.stringify(messages.slice(-3), null, 2));
                  }
                  
                  // Handle content block start
                  if (parsed.type === 'content_block_start') {
                    console.log(`📝 [REQ-${requestId}] Content block started: type=${parsed.content_block?.type}`);
                  }
                  
                  // Handle tool use start
                  if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                    toolUseId = parsed.content_block.id;
                    toolUseName = parsed.content_block.name;
                    
                    // Permetti output durante ricerca e download
                    if (toolUseName === 'search_pdf_with_query' || toolUseName === 'search_and_acquire_pdfs') {
                      skipAgentResponse = false;
                      console.log(`✅ [REQ-${requestId}] Allowing agent response for ${toolUseName}`);
                    }
                    
                    toolUseInputJson = '';
                    console.log('🔧 Tool use started:', toolUseName);
                  }
                  
                  // Accumulate tool input JSON
                  if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                    toolUseInputJson += parsed.delta.partial_json;
                  }
                  
                  // Handle tool use completion
                  if (parsed.type === 'content_block_stop' && toolUseId && toolUseName) {
                    console.log('🔧 [Anthropic] Tool use complete, input JSON:', toolUseInputJson);
                    
                    try {
                      const toolInput = JSON.parse(toolUseInputJson);
                      
                      // ✅ Execute the tool using shared function
                      const { toolResult, responseText, newFullResponse } = await executeToolCall(
                        toolUseName,
                        toolInput,
                        {
                          agent,
                          user,
                          conversation,
                          supabase,
                          sendSSE,
                          requestId,
                          fullResponse,
                          conversationState,
                          req
                        }
                      );
                      
                      fullResponse = newFullResponse;
                      
                      // Store tool result for Anthropic continuation
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
                      
                      needsToolResultContinuation = true;
                      toolCallCount++;
                      
                      // Reset tool state
                      toolUseName = null;
                      toolUseInputJson = '';
                      toolUseId = null;
                      
                      console.log(`✅ [Anthropic] Tool executed, continuation needed`);
                      
                    } catch (jsonError) {
                      console.error('❌ [Anthropic] Error parsing tool input JSON:', jsonError, toolUseInputJson);
                      fullResponse += `\n\n❌ Errore nell'esecuzione del tool.\n\n`;
                    }
                  }
                  
                  // Handle message_stop
                  if (parsed.type === 'message_stop') {
                    console.log(`🛑 [REQ-${requestId}] Message stop received`);
                    console.log(`   Full response length: ${fullResponse.length} chars`);
                    console.log(`   Needs tool result continuation: ${needsToolResultContinuation}`);
                  }
                  
                  // Handle text content
                  if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    const newText = parsed.delta.text;
                    
                    // Block agent output if system has already sent the message
                    if (!skipAgentResponse) {
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      // Progressive save more frequently: every 2000 chars instead of 5000
                      const now = Date.now();
                      if (fullResponse.length > 0 && fullResponse.length % 2000 < newText.length) {
                        const chunkNumber = Math.floor(fullResponse.length / 2000);
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse, llm_provider: llmProvider })
                          .eq('id', placeholderMsg.id);
                        console.log(`💾 [REQ-${requestId}] Checkpoint #${chunkNumber}: ${fullResponse.length} chars saved`);
                      }
                    } else {
                      console.log(`🚫 [REQ-${requestId}] Blocked agent text: "${newText}"`);
                    }
                    
                    // DETERMINISTIC WORKFLOW: DETECT QUERY PROPOSAL IN AGENT RESPONSE
                    if (isBookSearchExpert && !systemManagedSearch) {
                      const proposedQuery = detectProposedQuery(fullResponse);
                      // Update if we find a query AND (no previous query OR new query is longer/more complete)
                      if (proposedQuery && (!conversationState.lastProposedQuery || proposedQuery.length > conversationState.lastProposedQuery.length)) {
                        console.log(`🎯 [WORKFLOW] Updated proposed query in agent response: "${proposedQuery}"`);
                        await updateConversationState(conversationId, {
                          lastProposedQuery: proposedQuery,
                          waitingForConfirmation: true
                        }, supabase);
                      }
                    }
                    
                    // Log progress every 500 chars
                    const now = Date.now();
                    if (fullResponse.length > 0 && fullResponse.length % 500 < newText.length) {
                      const elapsed = ((now - requestStartTime) / 1000).toFixed(1);
                      console.log(`📊 [REQ-${requestId}] Progress: ${fullResponse.length} chars (${elapsed}s elapsed)`);
                      lastProgressLog = now;
                    }
                    
                    // Auto-save every 5 seconds during streaming
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
          const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
          console.log('================================================================================');
          console.log(`📊 [REQ-${requestId}] Request statistics:`);
          console.log('   Total duration:', totalDuration + 's');
          console.log('   Response length:', fullResponse.length, 'chars');
          console.log('   Chunks processed:', chunkCount);
          console.log('   Tools called:', toolCallCount);
          console.log('   LLM Provider:', llmProvider.toUpperCase());
          console.log('   Needs continuation:', needsToolResultContinuation);
          console.log('================================================================================');
          
          // ========== TOOL RESULT CONTINUATION FOR ALL PROVIDERS ==========
          
          // ===== ANTHROPIC CONTINUATION =====
          if (needsToolResultContinuation && llmProvider === 'anthropic') {
            console.log(`🔄 [REQ-${requestId}] Continuing with tool results for Anthropic...`);
            console.log(`   Current anthropicMessages length: ${anthropicMessages.length}`);
            
            try {
              // Make second API call with tool results
              const continueResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': ANTHROPIC_API_KEY!,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-5',  // Fixed model name
                  max_tokens: 4096, // ✅ LIMITATO: prevenzione esplosione token su continuation
                  temperature: 0.7,
                  system: enhancedSystemPrompt,
                  messages: anthropicMessages,
                  tools: tools,  // Pass tools to continuation
                  stream: false, // ✅ Disabilitato per debug e coerenza
                }),
              });
              
              if (!continueResponse.ok) {
                const errorText = await continueResponse.text();
                console.error(`❌ [REQ-${requestId}] Anthropic continuation error:`, errorText);
                throw new Error(`Anthropic API error: ${continueResponse.status} ${errorText}`);
              }
              
              // Stream the continuation response
              const reader2 = continueResponse.body?.getReader();
              if (!reader2) throw new Error('No readable stream in continuation');
              
              const decoder2 = new TextDecoder();
              let buffer2 = '';
              let continuationChunks = 0;
              
              console.log(`📡 [REQ-${requestId}] Streaming continuation response...`);
              
              while (true) {
                const { done, value } = await reader2.read();
                
                if (done) {
                  console.log(`✅ [REQ-${requestId}] Continuation stream ended. Chunks: ${continuationChunks}`);
                  break;
                }
                
                buffer2 += decoder2.decode(value, { stream: true });
                const lines = buffer2.split('\n');
                buffer2 = lines.pop() || '';
                
                for (const line of lines) {
                  if (!line.trim() || line.startsWith(':')) continue;
                  if (!line.startsWith('data: ')) continue;
                  
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const parsed = JSON.parse(data);
                    continuationChunks++;
                    
                    // Handle text content from continuation
                    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                      const newText = parsed.delta.text;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      // Auto-save during continuation
                      const now = Date.now();
                      if (now - lastUpdateTime > 3000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    
                    if (parsed.type === 'message_stop') {
                      console.log(`🏁 [REQ-${requestId}] Continuation message_stop received`);
                    }
                  } catch (e) {
                    console.error('Parse error in continuation:', e);
                  }
                }
              }
              
              console.log(`✅ [REQ-${requestId}] Tool result continuation completed. Final response: ${fullResponse.length} chars`);
              
            } catch (error) {
              console.error(`❌ [REQ-${requestId}] Error during tool result continuation:`, error);
              const errorText = `\n\n❌ Errore durante la generazione della risposta finale.\n\n`;
              fullResponse += errorText;
              await sendSSE(JSON.stringify({ type: 'content', text: errorText }));
            }
          }
          
          // ===== DEEPSEEK CONTINUATION =====
          if (needsToolResultContinuation && llmProvider === 'deepseek') {
            console.log(`🔄 [REQ-${requestId}] Continuing with tool results for DeepSeek...`);
            console.log(`   Current deepseekMessages length: ${deepseekMessages.length}`);
            
            try {
              const continueResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: deepseekModel,
                  messages: deepseekMessages,
                  temperature: 0.7,
                  max_tokens: 4000,
                  tools: deepseekTools,
                  tool_choice: "auto",
                  stream: true
                }),
              });
              
              if (!continueResponse.ok) {
                const errorText = await continueResponse.text();
                console.error(`❌ [REQ-${requestId}] DeepSeek continuation error:`, errorText);
                throw new Error(`DeepSeek API error: ${continueResponse.status}`);
              }
              
              const reader2 = continueResponse.body?.getReader();
              if (!reader2) throw new Error('No readable stream in continuation');
              
              const decoder2 = new TextDecoder();
              let buffer2 = '';
              let continuationChunks = 0;
              
              console.log(`📡 [REQ-${requestId}] Streaming DeepSeek continuation response...`);
              
              while (true) {
                const { done, value } = await reader2.read();
                
                if (done) {
                  console.log(`✅ [REQ-${requestId}] DeepSeek continuation stream ended. Chunks: ${continuationChunks}`);
                  break;
                }
                
                buffer2 += decoder2.decode(value, { stream: true });
                const lines = buffer2.split('\n');
                buffer2 = lines.pop() || '';
                
                for (const line of lines) {
                  if (!line.trim() || line.startsWith(':')) continue;
                  if (!line.startsWith('data: ')) continue;
                  
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const parsed = JSON.parse(data);
                    continuationChunks++;
                    
                    if (parsed.choices?.[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 3000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    
                    if (parsed.choices?.[0]?.finish_reason === 'stop') {
                      console.log(`🏁 [REQ-${requestId}] DeepSeek continuation finished`);
                    }
                  } catch (e) {
                    console.error('Parse error in DeepSeek continuation:', e);
                  }
                }
              }
              
              console.log(`✅ [REQ-${requestId}] DeepSeek tool result continuation completed`);
              
            } catch (error) {
              console.error(`❌ [REQ-${requestId}] Error during DeepSeek continuation:`, error);
              const errorText = `\n\n❌ Errore durante la generazione della risposta finale.\n\n`;
              fullResponse += errorText;
              await sendSSE(JSON.stringify({ type: 'content', text: errorText }));
            }
          }
          
          // ===== OPENAI CONTINUATION =====
          if (needsToolResultContinuation && llmProvider === 'openai') {
            console.log(`🔄 [REQ-${requestId}] Continuing with tool results for OpenAI...`);
            console.log(`   Current openaiMessages length: ${openaiMessages.length}`);
            
            try {
              const continueResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: openaiModel,
                  messages: openaiMessages,
                  max_completion_tokens: 16000,
                  tools: openaiTools,
                  tool_choice: "auto",
                  stream: true
                }),
              });
              
              if (!continueResponse.ok) {
                const errorText = await continueResponse.text();
                console.error(`❌ [REQ-${requestId}] OpenAI continuation error:`, errorText);
                throw new Error(`OpenAI API error: ${continueResponse.status}`);
              }
              
              const reader2 = continueResponse.body?.getReader();
              if (!reader2) throw new Error('No readable stream in continuation');
              
              const decoder2 = new TextDecoder();
              let buffer2 = '';
              let continuationChunks = 0;
              
              console.log(`📡 [REQ-${requestId}] Streaming OpenAI continuation response...`);
              
              while (true) {
                const { done, value } = await reader2.read();
                
                if (done) {
                  console.log(`✅ [REQ-${requestId}] OpenAI continuation stream ended. Chunks: ${continuationChunks}`);
                  break;
                }
                
                buffer2 += decoder2.decode(value, { stream: true });
                const lines = buffer2.split('\n');
                buffer2 = lines.pop() || '';
                
                for (const line of lines) {
                  if (!line.trim() || line.startsWith(':')) continue;
                  if (!line.startsWith('data: ')) continue;
                  
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const parsed = JSON.parse(data);
                    continuationChunks++;
                    
                    if (parsed.choices?.[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 3000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    
                    if (parsed.choices?.[0]?.finish_reason === 'stop') {
                      console.log(`🏁 [REQ-${requestId}] OpenAI continuation finished`);
                    }
                  } catch (e) {
                    console.error('Parse error in OpenAI continuation:', e);
                  }
                }
              }
              
              console.log(`✅ [REQ-${requestId}] OpenAI tool result continuation completed`);
              
            } catch (error) {
              console.error(`❌ [REQ-${requestId}] Error during OpenAI continuation:`, error);
              const errorText = `\n\n❌ Errore durante la generazione della risposta finale.\n\n`;
              fullResponse += errorText;
              await sendSSE(JSON.stringify({ type: 'content', text: errorText }));
            }
          }
          
          // ===== OPENROUTER CONTINUATION =====
          if (needsToolResultContinuation && llmProvider === 'openrouter') {
            console.log(`🔄 [REQ-${requestId}] Continuing with tool results for OpenRouter...`);
            console.log(`   Current openrouterMessages length: ${openrouterMessages.length}`);
            
            try {
              const continueResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: openrouterModel,
                  messages: openrouterMessages,
                  tools: openrouterTools,
                  tool_choice: "auto",
                  stream: true
                }),
              });
              
              if (!continueResponse.ok) {
                const errorText = await continueResponse.text();
                console.error(`❌ [REQ-${requestId}] OpenRouter continuation error:`, errorText);
                throw new Error(`OpenRouter API error: ${continueResponse.status}`);
              }
              
              const reader2 = continueResponse.body?.getReader();
              if (!reader2) throw new Error('No readable stream in continuation');
              
              const decoder2 = new TextDecoder();
              let buffer2 = '';
              let continuationChunks = 0;
              
              console.log(`📡 [REQ-${requestId}] Streaming OpenRouter continuation response...`);
              
              while (true) {
                const { done, value } = await reader2.read();
                
                if (done) {
                  console.log(`✅ [REQ-${requestId}] OpenRouter continuation stream ended. Chunks: ${continuationChunks}`);
                  break;
                }
                
                buffer2 += decoder2.decode(value, { stream: true });
                const lines = buffer2.split('\n');
                buffer2 = lines.pop() || '';
                
                for (const line of lines) {
                  if (!line.trim() || line.startsWith(':')) continue;
                  if (!line.startsWith('data: ')) continue;
                  
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const parsed = JSON.parse(data);
                    continuationChunks++;
                    
                    if (parsed.choices?.[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 3000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    
                    if (parsed.choices?.[0]?.finish_reason === 'stop') {
                      console.log(`🏁 [REQ-${requestId}] OpenRouter continuation finished`);
                    }
                  } catch (e) {
                    console.error('Parse error in OpenRouter continuation:', e);
                  }
                }
              }
              
              console.log(`✅ [REQ-${requestId}] OpenRouter tool result continuation completed`);
              
            } catch (error) {
              console.error(`❌ [REQ-${requestId}] Error during OpenRouter continuation:`, error);
              const errorText = `\n\n❌ Errore durante la generazione della risposta finale.\n\n`;
              fullResponse += errorText;
              await sendSSE(JSON.stringify({ type: 'content', text: errorText }));
            }
          }
          
          // ===== GOOGLE GEMINI CONTINUATION =====
          if (needsToolResultContinuation && (llmProvider === 'google' || llmProvider === 'google-gemini')) {
            console.log(`🔄 [REQ-${requestId}] Continuing with tool results for Gemini...`);
            console.log(`   Current geminiMessages length: ${geminiMessages.length}`);
            
            try {
              const continueResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${GOOGLE_API_KEY}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    contents: geminiMessages,
                    tools: geminiTools,
                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 8192,
                    },
                  }),
                }
              );
              
              if (!continueResponse.ok) {
                const errorText = await continueResponse.text();
                console.error(`❌ [REQ-${requestId}] Gemini continuation error:`, errorText);
                throw new Error(`Gemini API error: ${continueResponse.status}`);
              }
              
              const reader2 = continueResponse.body?.getReader();
              if (!reader2) throw new Error('No readable stream in continuation');
              
              const decoder2 = new TextDecoder();
              let buffer2 = '';
              let continuationChunks = 0;
              
              console.log(`📡 [REQ-${requestId}] Streaming Gemini continuation response...`);
              
              while (true) {
                const { done, value } = await reader2.read();
                
                if (done) {
                  console.log(`✅ [REQ-${requestId}] Gemini continuation stream ended. Chunks: ${continuationChunks}`);
                  break;
                }
                
                buffer2 += decoder2.decode(value, { stream: true });
                const lines = buffer2.split('\n');
                buffer2 = lines.pop() || '';
                
                for (const line of lines) {
                  if (!line.trim()) continue;
                  
                  try {
                    const parsed = JSON.parse(line);
                    continuationChunks++;
                    
                    if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                      const newText = parsed.candidates[0].content.parts[0].text;
                      fullResponse += newText;
                      await sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      const now = Date.now();
                      if (now - lastUpdateTime > 3000) {
                        await supabase
                          .from('agent_messages')
                          .update({ content: fullResponse })
                          .eq('id', placeholderMsg.id);
                        lastUpdateTime = now;
                      }
                    }
                    
                    if (parsed.candidates?.[0]?.finishReason === 'STOP') {
                      console.log(`🏁 [REQ-${requestId}] Gemini continuation finished`);
                    }
                  } catch (e) {
                    console.error('Parse error in Gemini continuation:', e);
                  }
                }
              }
              
              console.log(`✅ [REQ-${requestId}] Gemini tool result continuation completed`);
              
            } catch (error) {
              console.error(`❌ [REQ-${requestId}] Error during Gemini continuation:`, error);
              const errorText = `\n\n❌ Errore durante la generazione della risposta finale.\n\n`;
              fullResponse += errorText;
              await sendSSE(JSON.stringify({ type: 'content', text: errorText }));
            }
          }
            
            // VALIDATION: Detect simulated downloads (hallucination detection)
            if (agent.slug.includes('knowledge-search-expert') && toolCallCount === 0) {
              const lowerResponse = fullResponse.toLowerCase();
              const downloadIndicators = ['✅', 'downloaded', 'scaricato', 'saved', 'salvato', 'mb'];
              const pdfIndicators = ['pdf', '.pdf', 'document'];
              
              const hasDownloadIndicator = downloadIndicators.some(ind => lowerResponse.includes(ind));
              const hasPdfIndicator = pdfIndicators.some(ind => lowerResponse.includes(ind));
              
              if (hasDownloadIndicator && hasPdfIndicator) {
                console.log('⚠️⚠️⚠️ [REQ-' + requestId + '] CRITICAL: TOOL USAGE MISMATCH DETECTED ⚠️⚠️⚠️');
                console.log('   Response indicates downloads but NO tool was called');
                console.log('   Response excerpt:', fullResponse.slice(0, 300).replace(/\n/g, ' '));
                console.log('   Conversation:', conversation.id);
                console.log('   Agent:', agent.slug);
                console.log('   ❌ WARNING: Agent is HALLUCINATING instead of using tools');
                console.log('   ❌ PDFs were NOT actually downloaded to the document pool');
                console.log('   ✅ ACTION NEEDED: Review and update agent system prompt');
                console.log('================================================================================');
              }
            }
            
            // Final save with integrity check
            const finalContentLength = fullResponse.length;
            console.log(`💾 [REQ-${requestId}] Final save: ${finalContentLength} chars`);
            
            await supabase
              .from('agent_messages')
              .update({ content: fullResponse, llm_provider: llmProvider })
              .eq('id', placeholderMsg.id);
            
            // Verify integrity
            const { data: verifyData } = await supabase
              .from('agent_messages')
              .select('content')
              .eq('id', placeholderMsg.id)
              .single();
            
            const savedLength = verifyData?.content?.length || 0;
            if (savedLength === finalContentLength) {
              console.log(`✅ [REQ-${requestId}] Stream completed successfully - Integrity verified`);
            } else {
              console.error(`❌ [REQ-${requestId}] Integrity check FAILED: expected ${finalContentLength}, got ${savedLength}`);
            }
            
            clearInterval(keepAliveInterval);
          } catch (error) {
            const errorDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
            console.error(`❌ [REQ-${requestId}] Streaming interrupted after ${errorDuration}s`);
            console.error('   Error:', error);
            console.error('   Error type:', error instanceof Error ? error.name : typeof error);
            console.error('   Stack:', error instanceof Error ? error.stack : 'N/A');
            console.error(`   Conversation: ${conversation.id}`);
            console.error(`   Partial response: ${fullResponse.length} chars`);
            console.error(`   Tools called before error: ${toolCallCount}`);
            console.error(`   Provider: ${llmProvider}`);
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


          // ========== AUTO-CONTINUATION FOR DEEPSEEK (ASYNC) ==========
          if (llmProvider === 'deepseek' && DEEPSEEK_API_KEY) {
            console.log(`🔄 [REQ-${requestId}] Checking if DeepSeek response needs continuation...`);
            
            if (isResponseIncomplete(fullResponse)) {
              console.log(`⚠️ [REQ-${requestId}] Response incomplete, triggering async continuation...`);
              
              // Trigger async continuation (fire-and-forget)
              await triggerAsyncContinuation(
                supabase,
                placeholderMsg.id,
                conversation.id,
                fullResponse,
                agent.id,
                anthropicMessages.map(m => ({
                  role: m.role as 'user' | 'assistant',
                  content: Array.isArray(m.content) 
                    ? m.content.map(c => typeof c === 'string' ? c : c.text || '').join('\n')
                    : m.content
                })),
                enhancedSystemPrompt,
                requestId
              );
              
              // Send notification to client
              await sendSSE(JSON.stringify({
                type: 'continuation_triggered',
                message: '⚡ Risposta incompleta rilevata. Continuazione in background...'
              }));
            } else {
              console.log(`✅ [REQ-${requestId}] Response is complete, no continuation needed`);
            }
          }

          // Final update to DB with complete metadata
          const sourceReliability = hasKnowledgeContext ? 'high' : (toolsUsed.length > 0 ? 'medium' : 'low');
          
          // 📊 [BENCHMARK] Construct enriched retrieval metadata for analysis
          const retrievalMetadata = {
            chunks_retrieved: documents?.length || 0,
            top_similarities: documents?.slice(0, 5).map((d: any) => ({
              document: d.document_name,
              similarity: d.similarity,
              category: d.category,
              search_type: d.search_type
            })) || [],
            search_type: documents?.[0]?.search_type || 'semantic',
            query_breakdown: Object.keys(queryBreakdown || {}).length > 0 ? queryBreakdown : undefined,
            decomposed_queries: decomposedQueries?.length > 1 ? decomposedQueries : undefined
          };
          
          // 📊 [BENCHMARK] Store metadata for non-streaming mode access
          finalRetrievalMetadata = retrievalMetadata;
          finalLlmProvider = llmProvider;
          finalKnowledgeStats = knowledgeStats;
          
          await supabase
            .from('agent_messages')
            .update({ 
              content: fullResponse,
              llm_provider: llmProvider,
              metadata: {
                has_knowledge_context: hasKnowledgeContext,
                knowledge_stats: knowledgeStats,
                tools_used: toolsUsed,
                source_reliability: sourceReliability,
                video_documents_available: videoDocumentsAvailable.length > 0 ? videoDocumentsAvailable : undefined,
                retrieval_metadata: retrievalMetadata
              }
            })
            .eq('id', placeholderMsg.id);

          // ========== POST-PROCESSING: PARSING TABELLA PDF ==========
          if (agent.slug.includes('knowledge-search-expert')) {
            console.log(`📋 [REQ-${requestId}] Checking for PDF table in response`);
            
            const pdfEntries = parsePdfTableFromMarkdown(fullResponse);
            
            if (pdfEntries.length > 0) {
              console.log(`📥 [REQ-${requestId}] Found ${pdfEntries.length} PDFs to queue for download`);
              
              // Inserisci nella queue
              for (const entry of pdfEntries) {
                console.log(`📥 [REQ-${requestId}] Queuing PDF for download:`);
                console.log(`   Title: ${entry.title}`);
                console.log(`   Conversation ID: ${conversation.id}`);
                console.log(`   Agent ID: ${agent.id}`);
                console.log(`   Agent Name: ${agent.name}`);
                
                const { data: queueEntry, error: queueError } = await supabase
                  .from('pdf_download_queue')
                  .insert({
                    conversation_id: conversation.id,
                    agent_id: agent.id,
                    expected_title: entry.title,
                    expected_author: entry.author,
                    url: entry.url,
                    source: entry.source,
                    year: entry.year,
                    search_query: message,
                    status: 'pending'
                  })
                  .select()
                  .single();
                
                if (queueError) {
                  console.error(`❌ [REQ-${requestId}] Failed to queue: ${entry.title}`, queueError);
                  continue;
                }
                
                console.log(`✅ [REQ-${requestId}] Queued: ${entry.title} (${queueEntry.id.slice(0, 8)})`);
                
                // Triggera download in background (using Promise without await)
                processDownload(queueEntry.id, supabase, requestId).catch(err => {
                  console.error(`Failed to process download ${queueEntry.id}:`, err);
                });
              }
              
              // Dopo tutti i download, genera summary (in background)
              generateDownloadSummary(conversation.id, supabase, requestId).catch(err => {
                console.error(`Failed to generate summary for ${conversation.id}:`, err);
              });
            }
          }

          const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
          console.log('='.repeat(80));
          console.log(`✅ [REQ-${requestId}] LLM REQUEST COMPLETED`);
          console.log(`   Provider: ${llmProvider.toUpperCase()}`);
          console.log(`   Response length: ${fullResponse.length} chars`);
          console.log(`   Total duration: ${totalDuration}s`);
          console.log(`   Chunks processed: ${chunkCount}`);
          console.log('='.repeat(80));

          await sendSSE(JSON.stringify({ 
            type: 'complete', 
            conversationId: conversation.id,
            llmProvider: llmProvider,  // Send provider info to client
            metadata: {
              retrieval_metadata: retrievalMetadata,
              knowledge_stats: knowledgeStats
            }
          }));
          
          await closeStream();
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
            await sendSSE(JSON.stringify({ type: 'error', error: errorMessage }));
          }
          await closeStream();
        }
    }; // End of processRequest function
    
    // If streaming mode, execute async and return stream immediately
    if (enableStreaming) {
      processRequest(); // Execute without await (fire and forget)
      return new Response(readable, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // If non-streaming mode, await completion and return JSON
      await processRequest();
      await closeStream(); // Ensure stream is closed
      
      return new Response(
        JSON.stringify({ 
          response: accumulatedResponse,
          llmProvider: finalLlmProvider,
          metadata: {
            retrieval_metadata: finalRetrievalMetadata,
            knowledge_stats: finalKnowledgeStats
          }
        }),
        { 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          }
        }
      );
    }

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
