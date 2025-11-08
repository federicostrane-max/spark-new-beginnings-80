import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DebugRequest {
  url: string; // URL della preview Lovable (es. https://yourapp.lovable.app)
  action?: 'screenshot' | 'click' | 'type' | 'evaluate';
  selector?: string; // Per click/type
  text?: string; // Per type
  script?: string; // Per evaluate
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, action = 'screenshot', selector, text, script }: DebugRequest = await req.json();

    console.log(`[visual-debug] Starting ${action} on ${url}`);

    // Launch headless browser
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to the Lovable preview
    console.log(`[visual-debug] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    let result: any = {};

    switch (action) {
      case 'screenshot': {
        const screenshot = await page.screenshot({ 
          encoding: 'base64',
          fullPage: true 
        });
        result = { screenshot, type: 'base64' };
        console.log(`[visual-debug] Screenshot captured (${screenshot.length} chars)`);
        break;
      }

      case 'click': {
        if (!selector) throw new Error('Selector required for click action');
        await page.click(selector);
        await page.waitForTimeout(1000);
        const screenshot = await page.screenshot({ encoding: 'base64' });
        result = { screenshot, type: 'base64', message: `Clicked ${selector}` };
        console.log(`[visual-debug] Clicked ${selector}`);
        break;
      }

      case 'type': {
        if (!selector || !text) throw new Error('Selector and text required for type action');
        await page.type(selector, text);
        await page.waitForTimeout(500);
        const screenshot = await page.screenshot({ encoding: 'base64' });
        result = { screenshot, type: 'base64', message: `Typed "${text}" into ${selector}` };
        console.log(`[visual-debug] Typed into ${selector}`);
        break;
      }

      case 'evaluate': {
        if (!script) throw new Error('Script required for evaluate action');
        const evalResult = await page.evaluate(script);
        result = { result: evalResult, type: 'evaluation' };
        console.log(`[visual-debug] Evaluated script:`, evalResult);
        break;
      }
    }

    // Get console logs
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    // Get page errors
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await browser.close();

    return new Response(
      JSON.stringify({ 
        success: true, 
        ...result,
        logs,
        errors,
        url 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[visual-debug] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
