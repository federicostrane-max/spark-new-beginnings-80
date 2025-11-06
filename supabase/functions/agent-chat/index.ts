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
  credibilityScore?: number;
  source_type?: string;
  verified?: boolean;
  file_size_bytes?: number;
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
  
  // SEARCH REQUEST: "Find PDFs on...", "Search for...", "Look for...", Italian patterns
  const searchPatterns = [
    // English patterns
    /find\s+(?:pdf|pdfs|papers?|documents?|articles?)\s+(?:on|about|regarding)/i,
    /search\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i,
    /look\s+(?:for\s+)?(?:pdf|pdfs|papers?)/i,
    /\d+\s+(?:pdf|pdfs|papers?|documents?)\s+(?:on|about|regarding)/i, // "20 PDFs on..."
    
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
    let formatted = `#${r.number}. **${r.title}**\n`;
    
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
  const logPrefix = `🔄 [REQ-${requestId}][DOWNLOAD-${queueId.slice(0, 8)}]`;
  console.log(`${logPrefix} Starting download process`);
  
  try {
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
      
      await supabaseClient
        .from('pdf_download_queue')
        .update({
          status: 'failed',
          error_message: errorMsg,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueId);
      
      return;
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
    
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    
    await supabaseClient
      .from('pdf_download_queue')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
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
    
    const { conversationId, message, agentSlug, attachments } = requestBody;

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
          sendSSE(JSON.stringify({ 
            type: 'message_start', 
            messageId: placeholderMsg.id 
          }));

          let fullResponse = '';
          let lastUpdateTime = Date.now();
          let toolUseId: string | null = null;
          let toolUseName: string | null = null;
          let toolUseInputJson = '';
          let needsToolResultContinuation = false;
          
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
          let userIntent: UserIntent | undefined; // Declare it here for logging later
          
          if (agent.slug === 'knowledge-search-expert' || agent.slug === 'knowledge-search-expert-copy') {
            console.log('🤖 [WORKFLOW] Knowledge Search Expert detected, checking intent...');
            userIntent = parseKnowledgeSearchIntent(message); // Assign to the outer variable
            console.log('🤖 [WORKFLOW] Intent result:', userIntent);
            
            if (userIntent.type === 'SEARCH_REQUEST' && userIntent.topic) {
              console.log('🔍 [WORKFLOW] Handling SEARCH_REQUEST automatically');
              console.log('📊 [WORKFLOW] Requested count:', userIntent.count);
              workflowHandled = true;
              
              // Execute ENHANCED search with full metadata extraction
              try {
                const googleResults = await executeEnhancedSearch(userIntent.topic, userIntent.count || 10, supabase);
                
                // PHASE 1.5: Enrich with Repository APIs (arXiv, PubMed, CORE)
                console.log('🔌 [WORKFLOW] Enriching with repository APIs...');
                const searchResults = await enrichWithRepositoryAPIs(googleResults, userIntent.topic);
                console.log(`✅ [WORKFLOW] Enrichment complete: ${searchResults.length} results (was ${googleResults.length})`);
                
                // Save results to database cache (INCLUDING NEW FIELDS)
                console.log(`💾 [CACHE] Saving ${searchResults.length} results to database`);
                const cacheInserts = searchResults.map(r => ({
                  conversation_id: conversation.id,
                  result_number: r.number,
                  title: r.title,
                  authors: r.authors,
                  year: r.year,
                  source: r.source,
                  url: r.url,
                  source_type: r.source_type,
                  credibility_score: r.credibilityScore,
                  verified: r.verified,
                  file_size_bytes: r.file_size_bytes
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
                
                // Execute downloads WITH RETRY LOGIC
                const downloadResults = await executeDownloads(selectedPdfs, message, supabase);
                workflowResponse = formatDownloadResults(downloadResults);
                
                // Wait 3 seconds for validation to complete and check for rejected documents
                console.log('⏳ [WORKFLOW] Waiting 3 seconds for validation to complete...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Get validation feedback for rejected documents
                const validationFeedback = await formatValidationFeedback(conversationId, supabase);
                if (validationFeedback) {
                  workflowResponse += validationFeedback;
                }
                
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
            if (agent.slug === 'knowledge-search-expert') {
              console.log('⚠️ [WORKFLOW] Message NOT handled by automated workflow for Knowledge Search Expert');
              console.log(`   Intent detected: ${userIntent?.type || 'UNKNOWN'}`);
              console.log(`   Message: ${message.slice(0, 200)}`);
              console.log('   → Passing to AI for semantic analysis');
            }
          }
          
          // ========================================
          // KNOWLEDGE BASE: Retrieve relevant context
          // ========================================
          console.log('🔍 [KNOWLEDGE] Processing user query for knowledge base...');
          
          let knowledgeContext = '';
          try {
            // Check if user is asking for list of documents
            const listQueryPatterns = [
              // Pattern italiani migliorati
              /qual[ei]\s+(pdf|documenti|libri|file|doc)/i,
              /hai\s+(?:dei\s+|nel\s+|nel\s+tuo\s+)?(pdf|documenti|libri|file)/i,
              /elenco\s+(?:dei\s+)?(pdf|documenti|libri)/i,
              /dimmi\s+(?:quali?|cosa)\s+.{0,30}(pdf|documenti|libri|knowledge\s*base)/i,
              /mostra(?:mi)?\s+.{0,20}(pdf|documenti|libri)/i,
              /cosa\s+(?:c'è|hai)\s+(?:nel|in)\s+.{0,20}(knowledge|base|documenti)/i,
              /possiedi\s+.{0,20}(pdf|documenti|libri)/i,
              
              // Pattern inglesi migliorati
              /what\s+(pdfs?|documents?|books?|files?)/i,
              /list\s+(?:of\s+)?(?:all\s+)?(pdfs?|documents?|books?|files?)/i,
              /show\s+(?:me\s+)?(?:all\s+)?(?:your\s+)?(pdfs?|documents?|books?|files?)/i,
              /do\s+you\s+have\s+(?:any\s+)?(pdfs?|documents?|books?|files?)/i,
              /what'?s?\s+in\s+(?:your\s+|the\s+)?(knowledge\s*base|library)/i,
              /tell\s+me\s+(?:about\s+)?(?:your\s+)?(pdfs?|documents?|books?)/i
            ];
            
            const isListQuery = listQueryPatterns.some(pattern => pattern.test(message));
            
            if (isListQuery) {
              console.log('📋 [KNOWLEDGE] User is asking for document list - querying unique documents');
              
              // Query for distinct documents assigned to this agent
              const { data: distinctDocs, error: docsError } = await supabase
                .from('agent_knowledge')
                .select('document_name, category, summary, pool_document_id')
                .eq('agent_id', agent.id)
                .not('embedding', 'is', null);
              
              if (!docsError && distinctDocs && distinctDocs.length > 0) {
                // Get unique documents by document_name
                const uniqueDocs = Array.from(
                  new Map(distinctDocs.map(doc => [doc.document_name, doc])).values()
                );
                
                console.log(`✅ [KNOWLEDGE] Found ${uniqueDocs.length} unique documents in knowledge base`);
                
                knowledgeContext = '\n\n## YOUR KNOWLEDGE BASE DOCUMENTS\n\n';
                knowledgeContext += `You have access to ${uniqueDocs.length} document(s) in your knowledge base:\n\n`;
                
                uniqueDocs.forEach((doc: any, index: number) => {
                  knowledgeContext += `${index + 1}. **${doc.document_name}**\n`;
                  if (doc.category) knowledgeContext += `   - Category: ${doc.category}\n`;
                  if (doc.summary) knowledgeContext += `   - Summary: ${doc.summary}\n`;
                  knowledgeContext += '\n';
                });
                
                knowledgeContext += '\nIMPORTANT: List ALL documents above when the user asks what documents you have. Do not say you only have one document when you actually have multiple.\n';
              } else {
                console.log('ℹ️ [KNOWLEDGE] No documents found in knowledge base');
                knowledgeContext = '\n\n## YOUR KNOWLEDGE BASE\n\nYou currently have no documents in your knowledge base.\n';
              }
            } else {
              // Regular semantic search for content queries
              console.log('🔍 [SEMANTIC SEARCH] Searching knowledge base for relevant content...');
              
              const { data: searchData, error: searchError } = await supabase.functions.invoke(
                'semantic-search',
                {
                  body: {
                    query: message,
                    agentId: agent.id,
                    topK: 5
                  }
                }
              );

              if (!searchError && searchData?.documents && searchData.documents.length > 0) {
                console.log(`✅ [SEMANTIC SEARCH] Found ${searchData.documents.length} relevant chunks`);
                
                knowledgeContext = '\n\n## KNOWLEDGE BASE CONTEXT\n\n';
                knowledgeContext += 'Here are relevant excerpts from your knowledge base:\n\n';
                
                searchData.documents.forEach((doc: any, index: number) => {
                  knowledgeContext += `### Excerpt ${index + 1} from: ${doc.document_name}\n`;
                  knowledgeContext += `**Category**: ${doc.category || 'General'}\n`;
                  if (doc.summary) knowledgeContext += `**Document Summary**: ${doc.summary}\n`;
                  knowledgeContext += `**Content**:\n${doc.content}\n\n`;
                  knowledgeContext += `---\n\n`;
                });
                
                knowledgeContext += 'Use the above excerpts to answer the user\'s question accurately.\n';
              } else {
                console.log('ℹ️ [SEMANTIC SEARCH] No relevant content found');
                if (searchError) {
                  console.error('⚠️ [SEMANTIC SEARCH] Error:', searchError);
                }
              }
            }
          } catch (err) {
            console.error('❌ [KNOWLEDGE] Failed:', err);
            // Continue without knowledge context if query fails
          }
          
          const enhancedSystemPrompt = `CRITICAL INSTRUCTION: You MUST provide extremely detailed, comprehensive, and thorough responses. Never limit yourself to brief answers. When explaining concepts, you must provide:
- Multiple detailed examples with concrete scenarios
- In-depth explanations of each point with complete context
- All relevant background information and nuances
- Complete breakdowns of complex topics with step-by-step analysis
- Extended elaborations with practical examples and real-world applications
- Comprehensive coverage of all aspects of the topic

Your responses should be as long as necessary to FULLY and EXHAUSTIVELY address the user's question. Do NOT self-impose any brevity limits. Do NOT apply concepts you're explaining to your own response length. Be thorough and complete.

${agent.system_prompt}${knowledgeContext}`;

          // Define tools for all agents
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
          
          // Add collaboration tools for all agents
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
            description: 'Get a list of documents in another agent\'s knowledge base. Use this when the user asks what documents an agent has access to.',
            input_schema: {
              type: 'object',
              properties: {
                agent_name: {
                  type: 'string',
                  description: 'The name or slug of the agent whose knowledge base you want to view'
                }
              },
              required: ['agent_name']
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
          
          // Log tool availability
          if (tools) {
            console.log(`🔧 [REQ-${requestId}] Tools available to agent:`);
            tools.forEach(tool => console.log(`   - ${tool.name}: enabled`));
          }

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
                  max_tokens: 64000,
                  temperature: 0.7,
                  system: enhancedSystemPrompt,
                  messages: anthropicMessages,
                  tools: tools,
                  stream: true
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
            anthropicTimeout = setTimeout(() => {
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
              closeStream();
            }, 30000);
          }
          let buffer = '';
          let lastKeepAlive = Date.now();
          let chunkCount = 0;
          let lastProgressLog = Date.now();

          console.log(`🔄 [REQ-${requestId}] Starting stream from ${llmProvider.toUpperCase()}...`);

          // Send keep-alive every 15 seconds to prevent timeout
          const keepAliveInterval = setInterval(() => {
            sendSSE(':keep-alive\n\n');
            console.log('📡 Keep-alive sent');
          }, 15000);

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
                console.log(`✅ [REQ-${requestId}] Stream ended. Provider: ${llmProvider}, Total response length: ${fullResponse.length} chars`);
                console.log(`   Duration: ${totalDuration}s, Chunks: ${chunkCount}`);
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
                  
                  // Log chunk details for debugging
                  if (llmProvider === 'anthropic') {
                    console.log(`🔍 [REQ-${requestId}] Anthropic Chunk ${chunkCount}: type=${parsed.type}`);
                  }
                  
                  // Handle DeepSeek streaming format
                  if (llmProvider === 'deepseek') {
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      // Log progress every 500 chars
                      const now = Date.now();
                      if (fullResponse.length > 0 && fullResponse.length % 500 < newText.length) {
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
                    if (parsed.choices && parsed.choices[0]?.delta?.content) {
                      const newText = parsed.choices[0].delta.content;
                      fullResponse += newText;
                      sendSSE(JSON.stringify({ type: 'content', text: newText }));
                      
                      // Log progress every 500 chars
                      const now = Date.now();
                      if (fullResponse.length > 0 && fullResponse.length % 500 < newText.length) {
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
                    continue; // Skip Anthropic-specific handling
                  }
                  
                  // Anthropic-specific handling
                  // Handle message start
                  if (parsed.type === 'message_start') {
                    console.log(`📨 [REQ-${requestId}] Anthropic message started`);
                  }
                  
                  // Handle content block start
                  if (parsed.type === 'content_block_start') {
                    console.log(`📝 [REQ-${requestId}] Content block started: type=${parsed.content_block?.type}`);
                  }
                  
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
                        toolCallCount++; // Increment tool call counter
                        console.log(`🛠️ [REQ-${requestId}] Tool called: download_pdf`);
                        console.log('   Input parameters:', JSON.stringify(toolInput));
                        console.log('   Conversation:', conversation.id);
                        console.log('   Timestamp:', new Date().toISOString());
                        
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
                      
                      if (toolUseName === 'get_agent_prompt') {
                        toolCallCount++;
                        console.log(`🛠️ [REQ-${requestId}] Tool called: get_agent_prompt`);
                        console.log('   Agent name:', toolInput.agent_name);
                        
                        // Normalize agent name: replace hyphens with spaces for better matching
                        const normalizedName = toolInput.agent_name.replace(/-/g, ' ');
                        console.log('   Normalized name:', normalizedName);
                        
                        const { data: targetAgent, error: agentError } = await supabase
                          .from('agents')
                          .select('id, name, slug, system_prompt')
                          .or(`name.ilike.%${normalizedName}%,slug.ilike.%${toolInput.agent_name}%`)
                          .eq('active', true)
                          .single();
                        
                        if (agentError || !targetAgent) {
                          console.error('❌ Agent not found:', toolInput.agent_name);
                          console.error('   Search attempted with normalized name:', normalizedName);
                          console.error('   Error:', agentError);
                          toolResult = { success: false, error: 'Agent not found' };
                          
                          // Aggiungi risposta testuale per l'utente
                          const errorText = `\n\n❌ Mi dispiace, non ho trovato l'agente "${toolInput.agent_name}". Assicurati che il nome sia corretto.\n\n`;
                          fullResponse += errorText;
                          sendSSE(JSON.stringify({ type: 'content', text: errorText }));
                        } else {
                          console.log('✅ Retrieved prompt for agent:', targetAgent.name);
                          toolResult = {
                            success: true,
                            agent_name: targetAgent.name,
                            agent_slug: targetAgent.slug,
                            system_prompt: targetAgent.system_prompt
                          };
                          
                          // Aggiungi il prompt nella risposta per l'utente  
                          const promptText = `\n\n✅ Ho recuperato il prompt di **${targetAgent.name}**:\n\n---\n\n${targetAgent.system_prompt}\n\n---\n\n`;
                          fullResponse += promptText;
                          sendSSE(JSON.stringify({ type: 'content', text: promptText }));
                        }
                      }
                      
                      if (toolUseName === 'get_agent_knowledge') {
                        toolCallCount++;
                        console.log(`🛠️ [REQ-${requestId}] Tool called: get_agent_knowledge`);
                        console.log('   Agent name:', toolInput.agent_name);
                        
                        // Normalize agent name: replace hyphens with spaces for better matching
                        const normalizedName = toolInput.agent_name.replace(/-/g, ' ');
                        console.log('   Normalized name:', normalizedName);
                        
                        const { data: targetAgent, error: agentError } = await supabase
                          .from('agents')
                          .select('id, name, slug')
                          .or(`name.ilike.%${normalizedName}%,slug.ilike.%${toolInput.agent_name}%`)
                          .eq('active', true)
                          .single();
                        
                        if (agentError || !targetAgent) {
                          console.error('❌ Agent not found:', toolInput.agent_name);
                          console.error('   Search attempted with normalized name:', normalizedName);
                          console.error('   Error:', agentError);
                          toolResult = { success: false, error: 'Agent not found' };
                          
                          // Aggiungi risposta testuale per l'utente
                          const errorText = `\n\n❌ Mi dispiace, non ho trovato l'agente "${toolInput.agent_name}".\n\n`;
                          fullResponse += errorText;
                          sendSSE(JSON.stringify({ type: 'content', text: errorText }));
                        } else {
                          const { data: documents, error: docsError } = await supabase
                            .from('agent_knowledge')
                            .select('document_name, category, summary, created_at, source_type')
                            .eq('agent_id', targetAgent.id)
                            .order('created_at', { ascending: false });
                          
                          if (docsError) {
                            console.error('❌ Error retrieving documents:', docsError);
                            toolResult = { success: false, error: 'Failed to retrieve documents' };
                            
                            const errorText = `\n\n❌ Errore nel recuperare i documenti di ${targetAgent.name}.\n\n`;
                            fullResponse += errorText;
                            sendSSE(JSON.stringify({ type: 'content', text: errorText }));
                          } else {
                            console.log(`✅ Retrieved ${documents.length} documents for agent:`, targetAgent.name);
                            
                            // Group by document_name to avoid duplicates
                            const uniqueDocs = new Map();
                            documents.forEach(doc => {
                              if (!uniqueDocs.has(doc.document_name)) {
                                uniqueDocs.set(doc.document_name, doc);
                              }
                            });
                            
                            toolResult = {
                              success: true,
                              agent_name: targetAgent.name,
                              agent_slug: targetAgent.slug,
                              document_count: uniqueDocs.size,
                              documents: Array.from(uniqueDocs.values())
                            };
                            
                            // Aggiungi lista documenti nella risposta
                            let docsText = `\n\n✅ **${targetAgent.name}** ha accesso a ${uniqueDocs.size} documenti:\n\n`;
                            Array.from(uniqueDocs.values()).forEach((doc: any, idx: number) => {
                              docsText += `${idx + 1}. **${doc.document_name}**\n`;
                              if (doc.category) docsText += `   - Categoria: ${doc.category}\n`;
                              if (doc.summary) docsText += `   - ${doc.summary}\n`;
                              docsText += `\n`;
                            });
                            fullResponse += docsText;
                            sendSSE(JSON.stringify({ type: 'content', text: docsText }));
                          }
                        }
                      }
                      
                      if (toolUseName === 'get_agent_chat_history') {
                        toolCallCount++;
                        console.log(`🛠️ [REQ-${requestId}] Tool called: get_agent_chat_history`);
                        console.log('   Agent name:', toolInput.agent_name);
                        
                        // Normalize agent name: replace hyphens with spaces for better matching
                        const normalizedName = toolInput.agent_name.replace(/-/g, ' ');
                        console.log('   Normalized name:', normalizedName);
                        
                        const { data: targetAgent, error: agentError } = await supabase
                          .from('agents')
                          .select('id, name, slug')
                          .or(`name.ilike.%${normalizedName}%,slug.ilike.%${toolInput.agent_name}%`)
                          .eq('active', true)
                          .single();
                        
                        if (agentError || !targetAgent) {
                          console.error('❌ Agent not found:', toolInput.agent_name);
                          console.error('   Search attempted with normalized name:', normalizedName);
                          console.error('   Error:', agentError);
                          toolResult = { success: false, error: 'Agent not found' };
                          
                          const errorText = `\n\n❌ Non ho trovato l'agente "${toolInput.agent_name}".\n\n`;
                          fullResponse += errorText;
                          sendSSE(JSON.stringify({ type: 'content', text: errorText }));
                        } else {
                          // Get conversation for this agent and user
                          const { data: targetConv, error: convError } = await supabase
                            .from('agent_conversations')
                            .select('id')
                            .eq('agent_id', targetAgent.id)
                            .eq('user_id', user.id)
                            .single();
                          
                          if (convError || !targetConv) {
                            console.log('ℹ️ No conversation found for this agent and user');
                            toolResult = {
                              success: true,
                              agent_name: targetAgent.name,
                              agent_slug: targetAgent.slug,
                              message_count: 0,
                              messages: []
                            };
                            
                            const noHistoryText = `\n\n📭 Non hai ancora conversazioni con **${targetAgent.name}**.\n\n`;
                            fullResponse += noHistoryText;
                            sendSSE(JSON.stringify({ type: 'content', text: noHistoryText }));
                          } else {
                            const limit = toolInput.limit || 50;
                            const { data: messages, error: msgsError } = await supabase
                              .from('agent_messages')
                              .select('role, content, created_at')
                              .eq('conversation_id', targetConv.id)
                              .order('created_at', { ascending: false })
                              .limit(limit);
                            
                            if (msgsError) {
                              console.error('❌ Error retrieving messages:', msgsError);
                              toolResult = { success: false, error: 'Failed to retrieve messages' };
                              
                              const errorText = `\n\n❌ Errore nel recuperare la cronologia di ${targetAgent.name}.\n\n`;
                              fullResponse += errorText;
                              sendSSE(JSON.stringify({ type: 'content', text: errorText }));
                            } else {
                              console.log(`✅ Retrieved ${messages.length} messages for agent:`, targetAgent.name);
                              toolResult = {
                                success: true,
                                agent_name: targetAgent.name,
                                agent_slug: targetAgent.slug,
                                message_count: messages.length,
                                messages: messages.reverse() // Return in chronological order
                              };
                              
                              // Aggiungi riepilogo cronologia
                              let historyText = `\n\n💬 **Cronologia conversazione con ${targetAgent.name}** (${messages.length} messaggi):\n\n`;
                              messages.reverse().slice(-10).forEach((msg: any) => {
                                const role = msg.role === 'user' ? '👤 Tu' : '🤖 Agente';
                                const preview = msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '');
                                historyText += `**${role}**: ${preview}\n\n`;
                              });
                              fullResponse += historyText;
                              sendSSE(JSON.stringify({ type: 'content', text: historyText }));
                            }
                          }
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
                      
                      // Flag che indica che dobbiamo fare un'altra chiamata API con il tool result
                      needsToolResultContinuation = true;
                      
                    } catch (jsonError) {
                      console.error('❌ Error parsing tool input JSON:', jsonError, toolUseInputJson);
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
                    fullResponse += newText;
                    sendSSE(JSON.stringify({ type: 'content', text: newText }));
                    
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
            console.log('================================================================================');
            
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
            
            console.log(`✅ [REQ-${requestId}] Stream completed successfully`);
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

          // Final update to DB
          await supabase
            .from('agent_messages')
            .update({ 
              content: fullResponse,
              llm_provider: llmProvider  // Persist which LLM was used
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
