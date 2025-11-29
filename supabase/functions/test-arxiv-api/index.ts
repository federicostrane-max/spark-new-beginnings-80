import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[Test ArXiv] Starting ArXiv API test...');
    
    const arxivUrl = 'https://export.arxiv.org/api/query?search_query=cat:cs.CV+OR+cat:cs.AI&sortBy=submittedDate&sortOrder=descending&start=0&max_results=3';
    console.log('[Test ArXiv] URL:', arxivUrl);
    
    const response = await fetch(arxivUrl);
    console.log('[Test ArXiv] Response status:', response.status, response.statusText);
    
    const xmlText = await response.text();
    console.log('[Test ArXiv] Response length:', xmlText.length);
    console.log('[Test ArXiv] First 500 chars:', xmlText.substring(0, 500));
    
    // Parse XML to count entries
    const entryMatches = xmlText.match(/<entry>/g);
    const entryCount = entryMatches ? entryMatches.length : 0;
    console.log('[Test ArXiv] Found', entryCount, 'entries');
    
    return new Response(
      JSON.stringify({
        success: true,
        status: response.status,
        xmlLength: xmlText.length,
        entriesFound: entryCount,
        preview: xmlText.substring(0, 500)
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
    
  } catch (error) {
    console.error('[Test ArXiv] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
