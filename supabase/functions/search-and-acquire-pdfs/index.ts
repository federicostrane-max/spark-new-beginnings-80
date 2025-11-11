import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchAndAcquireRequest {
  topic: string;
  maxBooks?: number;
}

interface PDFResult {
  title: string;
  url: string;
  source: string;
  snippet?: string;
  credibilityScore: number;
}

interface AcquisitionResult {
  success: boolean;
  pdfs_found: number;
  pdfs_queued: number;
  pdfs_already_existing: number;
  pdfs_failed: number;
  found_pdfs: Array<{
    title: string;
    url: string;
    source: string;
    status: 'queued' | 'existing' | 'failed';
  }>;
  message: string;
}

// Blacklist domains that require login or are unreliable
const BLACKLIST_DOMAINS = [
  'scribd.com',
  'academia.edu',
  'researchgate.net',
  'chegg.com',
  'coursehero.com',
  'jstor.org'
];

async function validatePdfUrl(url: string, title: string): Promise<{
  valid: boolean;
  contentType?: string;
  fileSize?: number;
  credibilityScore?: number;
}> {
  try {
    const domain = new URL(url).hostname;
    
    // Check blacklist
    if (BLACKLIST_DOMAINS.some(d => domain.includes(d))) {
      console.log(`    ⛔ Blacklisted domain: ${domain}`);
      return { valid: false };
    }
    
    // HEAD request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(url, { 
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const contentType = response.headers.get('content-type') || '';
    
    if (!contentType.includes('application/pdf')) {
      console.log(`    ❌ Not a PDF: ${contentType}`);
      return { valid: false };
    }
    
    const fileSize = parseInt(response.headers.get('content-length') || '0');
    
    // Check size (min 100KB, max 100MB)
    if (fileSize > 0 && (fileSize < 100000 || fileSize > 100000000)) {
      console.log(`    ⚠️ Size out of range: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
      return { valid: false };
    }
    
    // Calculate credibility score
    let credibilityScore = 3; // Default
    
    if (domain.endsWith('.edu')) credibilityScore = 10;
    else if (domain.includes('arxiv')) credibilityScore = 9;
    else if (['springer.com', 'ieee.org', 'acm.org', 'nature.com', 'science.org'].some(d => domain.includes(d))) {
      credibilityScore = 8;
    }
    else if (['oreilly.com', 'manning.com', 'packtpub.com'].some(d => domain.includes(d))) {
      credibilityScore = 6;
    }
    
    // Boost if title matches URL
    const urlLower = url.toLowerCase();
    const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchingWords = titleWords.filter(word => urlLower.includes(word));
    
    if (matchingWords.length >= 2) {
      credibilityScore = Math.min(10, credibilityScore + 2);
      console.log(`    🎯 Title match boost: +2 → ${credibilityScore}`);
    }
    
    console.log(`    ✅ Valid PDF: ${(fileSize / 1024 / 1024).toFixed(1)}MB, score: ${credibilityScore}`);
    
    return {
      valid: true,
      contentType,
      fileSize,
      credibilityScore
    };
    
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log(`    ⏱️ Timeout`);
    } else {
      console.log(`    ❌ Validation error: ${(error as Error).message}`);
    }
    return { valid: false };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { topic, maxBooks = 10 }: SearchAndAcquireRequest = await req.json();
    
    console.log(`🔍 [SEARCH & ACQUIRE] Starting direct PDF search for: "${topic}"`);
    console.log(`   Max results: ${maxBooks}`);
    
    // Get auth info first
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader) {
      console.error('[search-and-acquire-pdfs] Missing authorization header');
      throw new Error('No authorization header');
    }
    
    // Extract JWT token from "Bearer <token>"
    const token = authHeader.replace('Bearer ', '').trim();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get user using the explicit token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError) {
      console.error('[search-and-acquire-pdfs] Auth error:', authError);
      throw new Error('Unauthorized: ' + authError.message);
    }
    
    if (!user) {
      console.error('[search-and-acquire-pdfs] No user found from token');
      throw new Error('Unauthorized: No user found');
    }
    
    console.log('[search-and-acquire-pdfs] User authenticated:', user.id);
    
    const result: AcquisitionResult = {
      success: true,
      pdfs_found: 0,
      pdfs_queued: 0,
      pdfs_already_existing: 0,
      pdfs_failed: 0,
      found_pdfs: [],
      message: ''
    };
    
    // Get agent_id
    const { data: agentData } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', user.id)
      .eq('active', true)
      .limit(1)
      .single();
    
    if (!agentData) {
      throw new Error('No active agent found');
    }
    
    const agentId = agentData.id;
    
    // Get or create conversation
    const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
      p_user_id: user.id,
      p_agent_id: agentId
    });
    
    if (!conversationId) {
      throw new Error('Failed to get conversation');
    }
    
    // STEP 1: Direct PDF search on SerpAPI
    console.log(`📚 [STEP 1] Direct SerpAPI search with filetype:pdf`);
    
    const apiKey = Deno.env.get('SERPAPI_API_KEY');
    if (!apiKey) {
      throw new Error('Missing SerpAPI API key');
    }
    
    const searchQuery = `"${topic}" filetype:pdf`;
    const searchUrl = `https://serpapi.com/search?api_key=${apiKey}&q=${encodeURIComponent(searchQuery)}&num=${maxBooks}&hl=en&lr=lang_en`;
    
    console.log(`🔎 Query: ${searchQuery}`);
    
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) {
      throw new Error(`SerpAPI request failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    
    if (!searchData.organic_results || searchData.organic_results.length === 0) {
      console.log('ℹ️ No PDF results found');
      result.message = `No PDFs found for topic: ${topic}`;
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const organicResults = searchData.organic_results;
    console.log(`✅ Found ${organicResults.length} results from Google`);
    
    // STEP 2: Light validation + deduplication + queueing
    console.log(`🔄 [STEP 2] Validating and queueing PDFs`);
    
    const validatedPdfs: PDFResult[] = [];
    
    for (let i = 0; i < organicResults.length; i++) {
      const item = organicResults[i];
      const url = item.link;
      const title = item.title || 'Unknown Title';
      const snippet = item.snippet || '';
      
      console.log(`\n📄 [${i + 1}/${organicResults.length}] ${title}`);
      console.log(`   URL: ${url.slice(0, 80)}...`);
      
      // Light validation
      const validation = await validatePdfUrl(url, title);
      
      if (!validation.valid) {
        result.pdfs_failed++;
        continue;
      }
      
      validatedPdfs.push({
        title,
        url,
        source: new URL(url).hostname,
        snippet,
        credibilityScore: validation.credibilityScore || 3
      });
    }
    
    result.pdfs_found = validatedPdfs.length;
    console.log(`\n✅ [STEP 2] Validated ${validatedPdfs.length} PDFs`);
    
    if (validatedPdfs.length === 0) {
      result.message = `Found ${organicResults.length} results but none passed validation`;
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // STEP 3: Check duplicates and queue
    console.log(`\n📥 [STEP 3] Checking duplicates and queueing`);
    
    for (const pdf of validatedPdfs) {
      try {
        // Check if already in knowledge base
        const { data: existingDoc } = await supabase
          .from('knowledge_documents')
          .select('id, file_name')
          .eq('source_url', pdf.url)
          .maybeSingle();
        
        if (existingDoc) {
          console.log(`   ✅ Already exists: ${existingDoc.file_name}`);
          result.pdfs_already_existing++;
          result.found_pdfs.push({
            title: pdf.title,
            url: pdf.url,
            source: pdf.source,
            status: 'existing'
          });
          continue;
        }
        
        // Check if already in queue
        const { data: existingQueue } = await supabase
          .from('pdf_download_queue')
          .select('id, status')
          .eq('url', pdf.url)
          .eq('conversation_id', conversationId)
          .maybeSingle();
        
        if (existingQueue) {
          console.log(`   ⏳ Already queued: ${existingQueue.status}`);
          result.pdfs_queued++;
          result.found_pdfs.push({
            title: pdf.title,
            url: pdf.url,
            source: pdf.source,
            status: 'queued'
          });
          continue;
        }
        
        // Add to queue
        const { error: queueError } = await supabase
          .from('pdf_download_queue')
          .insert({
            url: pdf.url,
            search_query: topic,
            expected_title: pdf.title,
            agent_id: agentId,
            conversation_id: conversationId,
            source: pdf.source,
            status: 'pending'
          });
        
        if (queueError) {
          console.error(`   ❌ Failed to queue:`, queueError);
          result.pdfs_failed++;
          result.found_pdfs.push({
            title: pdf.title,
            url: pdf.url,
            source: pdf.source,
            status: 'failed'
          });
        } else {
          console.log(`   ✅ Queued for download`);
          result.pdfs_queued++;
          result.found_pdfs.push({
            title: pdf.title,
            url: pdf.url,
            source: pdf.source,
            status: 'queued'
          });
        }
        
      } catch (error) {
        console.error(`   ❌ Error processing PDF:`, error);
        result.pdfs_failed++;
        result.found_pdfs.push({
          title: pdf.title,
          url: pdf.url,
          source: pdf.source,
          status: 'failed'
        });
      }
    }
    
    // Start background processing
    if (result.pdfs_queued > 0) {
      console.log(`\n🚀 Starting background PDF download processing...`);
      supabase.functions.invoke('process-pdf-queue', {
        body: { conversationId }
      }).catch(err => {
        console.error('Failed to invoke background processor:', err);
      });
    }
    
    result.message = `Found ${result.pdfs_found} PDFs: ${result.pdfs_queued} queued for download, ${result.pdfs_already_existing} already in pool`;
    
    console.log(`\n✅ [SEARCH & ACQUIRE] Completed!`);
    console.log(`   🔎 PDFs found: ${result.pdfs_found}`);
    console.log(`   📥 PDFs queued: ${result.pdfs_queued}`);
    console.log(`   ♻️ Already existing: ${result.pdfs_already_existing}`);
    console.log(`   ❌ Failed: ${result.pdfs_failed}`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [SEARCH & ACQUIRE] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        pdfs_found: 0,
        pdfs_queued: 0,
        pdfs_already_existing: 0,
        pdfs_failed: 0,
        found_pdfs: [],
        message: `Error: ${errorMessage}`
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});