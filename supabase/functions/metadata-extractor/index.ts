import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MetadataRequest {
  urls: string[];
}

interface ExtractedMetadata {
  url: string;
  authors: string[] | null;
  year: number | null;
  publisher: string | null;
  source_type: string;
  citations: number | null;
  domain: string;
}

function classifySourceType(domain: string, html: string): string {
  if (domain.includes('arxiv')) return 'preprint';
  if (['springer.com', 'ieee.org', 'acm.org', 'nature.com', 'science.org', 'sciencedirect.com'].some(d => domain.includes(d))) {
    return 'journal';
  }
  if (domain.endsWith('.edu') || domain.includes('university')) return 'institutional';
  if (domain.includes('github') || domain.includes('gitlab')) return 'repository';
  if (['oreilly.com', 'manning.com', 'packtpub.com'].some(d => domain.includes(d))) return 'book';
  return 'web';
}

async function extractMetadata(url: string): Promise<ExtractedMetadata> {
  const domain = new URL(url).hostname;
  
  const defaultResult: ExtractedMetadata = {
    url,
    authors: null,
    year: null,
    publisher: null,
    source_type: classifySourceType(domain, ''),
    citations: null,
    domain
  };
  
  try {
    // Fetch HTML (with timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MetadataExtractor/1.0)'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return defaultResult;
    }
    
    const html = await response.text();
    
    // Strategy 1: JSON-LD structured data
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/is);
    
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        
        const authors = jsonLd.author 
          ? (Array.isArray(jsonLd.author) 
              ? jsonLd.author.map((a: any) => a.name || a).filter(Boolean)
              : [jsonLd.author.name || jsonLd.author])
          : null;
        
        const year = jsonLd.datePublished 
          ? new Date(jsonLd.datePublished).getFullYear()
          : null;
        
        const publisher = jsonLd.publisher?.name || null;
        const citations = jsonLd.citation?.length || null;
        
        return {
          url,
          authors,
          year,
          publisher,
          source_type: classifySourceType(domain, html),
          citations,
          domain
        };
      } catch (jsonError) {
        console.error('JSON-LD parsing error:', jsonError);
      }
    }
    
    // Strategy 2: Meta tags
    let authors: string[] | null = null;
    let year: number | null = null;
    let publisher: string | null = null;
    
    // Extract authors from meta tags
    const authorMeta = html.match(/<meta\s+name=["'](?:author|citation_author)["']\s+content=["']([^"']+)["']/i);
    if (authorMeta) {
      authors = [authorMeta[1]];
    } else {
      // Try multiple authors
      const authorsMeta = html.matchAll(/<meta\s+name=["']citation_author["']\s+content=["']([^"']+)["']/gi);
      const authorsArray = Array.from(authorsMeta).map(m => m[1]);
      if (authorsArray.length > 0) authors = authorsArray;
    }
    
    // Extract year
    const yearMeta = html.match(/<meta\s+name=["'](?:citation_year|citation_publication_date|datePublished)["']\s+content=["'](\d{4})/i);
    if (yearMeta) {
      year = parseInt(yearMeta[1]);
    }
    
    // Extract publisher
    const publisherMeta = html.match(/<meta\s+(?:property=["']og:site_name["']|name=["']citation_publisher["'])\s+content=["']([^"']+)["']/i);
    if (publisherMeta) {
      publisher = publisherMeta[1];
    }
    
    // Strategy 3: Heuristic fallback from title
    if (!year) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) {
        const titleYearMatch = titleMatch[1].match(/\b(19|20)\d{2}\b/);
        if (titleYearMatch) year = parseInt(titleYearMatch[0]);
      }
    }
    
    if (!authors) {
      // Try to extract from title pattern "Title - Author"
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) {
        const authorPattern = titleMatch[1].match(/[-–]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/);
        if (authorPattern) authors = [authorPattern[1]];
      }
    }
    
    return {
      url,
      authors,
      year,
      publisher,
      source_type: classifySourceType(domain, html),
      citations: null,
      domain
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Metadata extraction failed for ${url}:`, errorMessage);
    return defaultResult;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { urls }: MetadataRequest = await req.json();
    
    console.log(`📊 [METADATA EXTRACTOR] Processing ${urls.length} URLs`);
    
    // Process all URLs in parallel (with concurrency limit)
    const concurrencyLimit = 5;
    const results: ExtractedMetadata[] = [];
    
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const batch = urls.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(url => extractMetadata(url))
      );
      results.push(...batchResults);
      
      console.log(`  Processed batch ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(urls.length / concurrencyLimit)}`);
    }
    
    console.log(`✅ [METADATA EXTRACTOR] Completed: ${results.length} URLs processed`);
    
    return new Response(
      JSON.stringify({ metadata: results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [METADATA EXTRACTOR] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, metadata: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
