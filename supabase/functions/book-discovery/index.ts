import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DiscoveryRequest {
  topic: string;
  maxBooks: number;
}

interface BookResult {
  title: string;
  authors: string;
  relevanceScore: number;
  sourceUrls: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { topic, maxBooks = 5 }: DiscoveryRequest = await req.json();
    
    console.log(`📚 [BOOK DISCOVERY] Starting for topic: "${topic}", maxBooks: ${maxBooks}`);
    
    const apiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      throw new Error('Missing Google Custom Search credentials');
    }
    
    // Phase 1: Execute 3 discovery queries
    const discoveryQueries = [
      `"${topic}" best books`,
      `"${topic}" essential reading`,
      `"${topic}" textbook`
    ];
    
    const booksMap = new Map<string, BookResult>();
    
    for (const query of discoveryQueries) {
      console.log(`🔍 Discovery query: ${query}`);
      
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=10`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ Discovery query failed: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      if (!data.items) continue;
      
      // Parse results to extract book titles and authors
      for (const item of data.items) {
        const text = `${item.title} ${item.snippet}`;
        
        // Pattern 1: "Title by Author"
        const pattern1 = /([A-Z][^:]+?)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g;
        let match;
        
        while ((match = pattern1.exec(text)) !== null) {
          const title = match[1].trim().replace(/["\u201C\u201D]/g, '');
          const authors = match[2].trim();
          
          // Skip if too short or generic
          if (title.length < 5 || title.toLowerCase().includes('review')) continue;
          
          const key = `${title.toLowerCase()}||${authors.toLowerCase()}`;
          
          if (!booksMap.has(key)) {
            booksMap.set(key, {
              title,
              authors,
              relevanceScore: 0,
              sourceUrls: []
            });
          }
          
          const book = booksMap.get(key)!;
          
          // Score boost logic
          if (item.title.toLowerCase().includes('best')) book.relevanceScore += 2;
          if (item.title.toLowerCase().includes('essential')) book.relevanceScore += 2;
          if (item.title.toLowerCase().includes('classic')) book.relevanceScore += 2;
          
          // Domain scoring
          const domain = new URL(item.link).hostname;
          if (domain.endsWith('.edu')) book.relevanceScore += 2;
          if (['springer.com', 'cambridge.org', 'oreilly.com', 'manning.com', 'packtpub.com'].some(d => domain.includes(d))) {
            book.relevanceScore += 2;
          }
          
          // Position scoring (top 3 results)
          const position = data.items.indexOf(item);
          if (position < 3) book.relevanceScore += 3;
          
          book.sourceUrls.push(item.link);
        }
        
        // Pattern 2: Extract from meta tags pattern (e.g., "Machine Learning - Tom Mitchell")
        const pattern2 = /([A-Z][^-]+?)\s*[-–]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/;
        const match2 = text.match(pattern2);
        
        if (match2) {
          const title = match2[1].trim().replace(/["\u201C\u201D]/g, '');
          const authors = match2[2].trim();
          
          if (title.length >= 5 && !title.toLowerCase().includes('review')) {
            const key = `${title.toLowerCase()}||${authors.toLowerCase()}`;
            
            if (!booksMap.has(key)) {
              booksMap.set(key, {
                title,
                authors,
                relevanceScore: 1,
                sourceUrls: [item.link]
              });
            }
          }
        }
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Convert map to array and sort by relevance
    const books = Array.from(booksMap.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxBooks);
    
    console.log(`✅ [BOOK DISCOVERY] Found ${books.length} books:`, books.map(b => `${b.title} (score: ${b.relevanceScore})`));
    
    return new Response(
      JSON.stringify({ books }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [BOOK DISCOVERY] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, books: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
