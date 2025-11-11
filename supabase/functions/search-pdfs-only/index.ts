import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BLACKLIST_DOMAINS = [
  'researchgate.net',
  'academia.edu',
  'scribd.com',
  'coursehero.com',
  'chegg.com',
  'studypool.com'
];

interface PDFResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, maxResults = 5 } = await req.json();
    
    console.log(`🔎 Searching with query: "${query}"`);
    console.log(`📊 Max results: ${maxResults}`);
    
    const apiKey = Deno.env.get('SERPAPI_API_KEY');
    if (!apiKey) {
      throw new Error('Missing SerpAPI API key');
    }
    
    // Use the EXACT query provided by the user/agent
    const searchUrl = `https://serpapi.com/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=${maxResults}&hl=en&lr=lang_en`;
    
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) {
      throw new Error(`SerpAPI request failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    const pdfs: PDFResult[] = [];
    
    if (searchData.organic_results && searchData.organic_results.length > 0) {
      console.log(`✅ Found ${searchData.organic_results.length} organic results from Google`);
      
      for (const item of searchData.organic_results) {
        if (pdfs.length >= maxResults) break;
        
        const url = item.link;
        const title = item.title || 'Unknown Title';
        const snippet = item.snippet || '';
        const source = new URL(url).hostname;
        
        // Check blacklist
        const isBlacklisted = BLACKLIST_DOMAINS.some(domain => url.toLowerCase().includes(domain));
        if (isBlacklisted) {
          console.log(`⏭️ Skipping blacklisted domain: ${source}`);
          continue;
        }
        
        // Lightweight validation: check if URL contains .pdf
        if (url.toLowerCase().includes('.pdf')) {
          pdfs.push({
            title,
            url,
            source,
            snippet
          });
          console.log(`   ✅ Added PDF: ${title.slice(0, 60)}...`);
        } else {
          console.log(`   ⏭️ Skipping non-PDF URL: ${url.slice(0, 60)}...`);
        }
      }
    } else {
      console.log('ℹ️ No organic results found');
    }
    
    console.log(`\n📊 Search complete: found ${pdfs.length} valid PDFs`);
    
    return new Response(
      JSON.stringify({ 
        pdfs, 
        query, 
        totalFound: pdfs.length 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
    
  } catch (error) {
    console.error('❌ Search error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
