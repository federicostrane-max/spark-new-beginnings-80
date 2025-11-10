import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapeRequest {
  url: string;
  renderJs?: boolean;
  blockAds?: boolean;
  blockResources?: boolean;
  premiumProxy?: boolean;
  countryCode?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, renderJs = true, blockAds = true, blockResources = true, premiumProxy = false, countryCode }: ScrapeRequest = await req.json();
    const scrapingBeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');

    if (!scrapingBeeApiKey) {
      throw new Error('SCRAPINGBEE_API_KEY not configured');
    }

    if (!url) {
      throw new Error('URL is required');
    }

    console.log(`[WebScrape] Scraping URL: ${url}`);

    // Build ScrapingBee API URL with parameters
    const params = new URLSearchParams({
      api_key: scrapingBeeApiKey,
      url: url,
      render_js: renderJs.toString(),
      block_ads: blockAds.toString(),
      block_resources: blockResources.toString(),
      premium_proxy: premiumProxy.toString(),
    });

    if (countryCode) {
      params.append('country_code', countryCode);
    }

    const scrapingBeeUrl = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;

    console.log(`[WebScrape] Calling ScrapingBee API`);

    const response = await fetch(scrapingBeeUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WebScrape] ScrapingBee API error:', response.status, errorText);
      throw new Error(`ScrapingBee API error: ${response.status} - ${errorText}`);
    }

    const html = await response.text();
    const creditsUsed = response.headers.get('spb-cost') || '0';
    const creditsRemaining = response.headers.get('spb-credits-remaining') || 'unknown';

    console.log(`[WebScrape] Successfully scraped. Credits used: ${creditsUsed}, remaining: ${creditsRemaining}`);

    // Extract text content from HTML (basic extraction)
    const textContent = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return new Response(
      JSON.stringify({
        success: true,
        url: url,
        html: html,
        textContent: textContent,
        contentLength: html.length,
        creditsUsed: parseInt(creditsUsed),
        creditsRemaining: creditsRemaining,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[WebScrape] Error:', error);
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
