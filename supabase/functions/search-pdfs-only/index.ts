import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Blacklist solo per paywall sicuramente inaccessibili senza pagamento
const BLACKLIST_DOMAINS = [
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

/**
 * Funzione helper intelligente per identificare potenziali PDF
 * basandosi su URL, domini noti e keywords
 */
function isProbablyPDF(url: string, title: string, snippet: string): boolean {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  const snippetLower = snippet.toLowerCase();
  
  // ALTA PRIORITÀ: URL contiene .pdf
  if (urlLower.includes('.pdf')) {
    return true;
  }
  
  // MEDIA PRIORITÀ: Domini noti per hosting PDF
  const pdfHostingDomains = [
    'archive.org',
    'scribd.com',
    'academia.edu',
    'researchgate.net',
    'arxiv.org',
    'ssrn.com',
    'zenodo.org',
    'core.ac.uk',
    'semanticscholar.org',
    'philpapers.org'
  ];
  
  if (pdfHostingDomains.some(domain => urlLower.includes(domain))) {
    // Verifica che title/snippet menzioni PDF o document
    if (titleLower.includes('pdf') || snippetLower.includes('pdf') ||
        titleLower.includes('document') || snippetLower.includes('download') ||
        snippetLower.includes('full text')) {
      return true;
    }
  }
  
  // BASSA PRIORITÀ: Keywords PDF nel title/snippet anche senza dominio noto
  if ((titleLower.includes('[pdf]') || titleLower.includes('(pdf)')) &&
      (snippetLower.includes('download') || snippetLower.includes('view pdf'))) {
    return true;
  }
  
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, maxResults = 10 } = await req.json();
    
    console.log(`🔎 Searching with query: "${query}"`);
    console.log(`📊 Max results: ${maxResults}`);
    
    const apiKey = Deno.env.get('SERPAPI_API_KEY');
    if (!apiKey) {
      throw new Error('Missing SerpAPI API key');
    }
    
    // Use the EXACT query provided by the user/agent
    // Richiediamo più risultati del necessario per compensare il filtraggio intelligente
    const searchUrl = `https://serpapi.com/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=${maxResults * 2}&hl=en&lr=lang_en`;
    
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
        
        console.log(`   ℹ️ Evaluating: ${title.slice(0, 50)}... from ${source}`);
        
        // Check blacklist
        const isBlacklisted = BLACKLIST_DOMAINS.some(domain => url.toLowerCase().includes(domain));
        if (isBlacklisted) {
          console.log(`   ⏭️ Skipped: blacklisted paywall domain (${source})`);
          continue;
        }
        
        // Validazione intelligente: usa isProbablyPDF invece di semplice check .pdf
        if (isProbablyPDF(url, title, snippet)) {
          pdfs.push({
            title,
            url,
            source,
            snippet
          });
          console.log(`   ✅ Added PDF: ${title.slice(0, 60)}...`);
        } else {
          console.log(`   ⏭️ Skipped: not identified as PDF (${url.slice(0, 60)}...)`);
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
