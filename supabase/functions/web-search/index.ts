import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  query: string;
  numResults?: number;
  scrapeResults?: boolean;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  scrapedContent?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, numResults = 5, scrapeResults = false }: SearchRequest = await req.json();
    const serpApiKey = Deno.env.get('SERPAPI_API_KEY');
    const scrapingBeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');

    if (!serpApiKey) {
      throw new Error('SerpAPI credentials not configured');
    }

    if (!query) {
      throw new Error('Query is required');
    }

    console.log(`[WebSearch] Searching for: ${query}`);

    // Build SerpAPI URL with English language filters
    const searchUrl = `https://serpapi.com/search?api_key=${serpApiKey}&q=${encodeURIComponent(query)}&num=${numResults}&hl=en&lr=lang_en`;

    const searchResponse = await fetch(searchUrl);

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('[WebSearch] SerpAPI error:', searchResponse.status, errorText);
      throw new Error(`SerpAPI error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const results: SearchResult[] = [];

    if (searchData.organic_results && searchData.organic_results.length > 0) {
      for (const item of searchData.organic_results) {
        const result: SearchResult = {
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        };

        // Optionally scrape each result for full content
        if (scrapeResults && scrapingBeeApiKey) {
          try {
            const params = new URLSearchParams({
              api_key: scrapingBeeApiKey,
              url: item.link,
              render_js: 'false',
              block_ads: 'true',
              block_resources: 'true',
            });

            const scrapeUrl = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;
            const scrapeResponse = await fetch(scrapeUrl);

            if (scrapeResponse.ok) {
              const html = await scrapeResponse.text();
              const textContent = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 2000); // Limit to first 2000 chars

              result.scrapedContent = textContent;
            }
          } catch (scrapeError) {
            console.warn(`[WebSearch] Failed to scrape ${item.link}:`, scrapeError);
          }
        }

        results.push(result);
      }
    }

    console.log(`[WebSearch] Found ${results.length} results`);

    return new Response(
      JSON.stringify({
        success: true,
        query: query,
        results: results,
        totalResults: searchData.searchInformation?.totalResults || 0,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[WebSearch] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        details: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
