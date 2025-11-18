import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationRequest {
  title: string;
  authors?: string[] | null;
}

interface ValidationResult {
  verified: boolean;
  confidence: 'verified' | 'likely' | 'uncertain';
  source?: string;
  reasoning: string;
  matchedResults: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, authors }: ValidationRequest = await req.json();
    
    if (!title) {
      throw new Error('Title is required for validation');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[validate-metadata-online] Validating: "${title}" by ${authors?.join(', ') || 'unknown'}`);

    // Build search query
    let searchQuery = `"${title}"`;
    if (authors && authors.length > 0) {
      // Add first author to search
      searchQuery += ` "${authors[0]}"`;
    }
    searchQuery += ' academic paper OR book OR article';

    console.log(`[validate-metadata-online] Search query: ${searchQuery}`);

    // Use web-search function to search for the document
    const { data: searchData, error: searchError } = await supabase.functions.invoke('web-search', {
      body: {
        query: searchQuery,
        numResults: 5
      }
    });

    if (searchError) {
      console.error('[validate-metadata-online] ❌ Search failed:', searchError);
      return new Response(
        JSON.stringify({
          verified: false,
          confidence: 'uncertain',
          reasoning: 'Web search failed',
          matchedResults: 0
        } as ValidationResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = searchData.results || [];
    console.log(`[validate-metadata-online] Found ${results.length} search results`);

    // Analyze results to see if they match our metadata
    let matchedResults = 0;
    let bestMatch: any = null;
    let bestMatchScore = 0;

    const titleLower = title.toLowerCase();
    const authorNames = authors?.map(a => a.toLowerCase()) || [];

    for (const result of results) {
      const resultTitle = (result.title || '').toLowerCase();
      const resultText = (result.text || '').toLowerCase();
      let score = 0;

      // Check title similarity (fuzzy match)
      if (resultTitle.includes(titleLower) || titleLower.includes(resultTitle)) {
        score += 3;
      } else {
        // Check for partial title match (at least 50% of words)
        const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
        const matchedWords = titleWords.filter(word => 
          resultTitle.includes(word) || resultText.includes(word)
        ).length;
        if (matchedWords >= titleWords.length * 0.5) {
          score += 2;
        }
      }

      // Check author names
      for (const author of authorNames) {
        if (resultTitle.includes(author) || resultText.includes(author)) {
          score += 2;
        }
      }

      // Check for academic indicators
      const academicKeywords = ['paper', 'research', 'journal', 'conference', 'proceedings', 'ieee', 'acm', 'springer', 'elsevier', 'arxiv', 'doi'];
      const hasAcademicIndicator = academicKeywords.some(kw => 
        resultTitle.includes(kw) || resultText.includes(kw)
      );
      if (hasAcademicIndicator) {
        score += 1;
      }

      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatch = result;
      }

      if (score >= 3) {
        matchedResults++;
      }
    }

    console.log(`[validate-metadata-online] Matched ${matchedResults} results, best score: ${bestMatchScore}`);

    // Determine confidence based on matches
    let confidence: 'verified' | 'likely' | 'uncertain';
    let verified = false;
    let reasoning = '';

    if (bestMatchScore >= 5) {
      confidence = 'verified';
      verified = true;
      reasoning = `Strong match found: "${bestMatch?.title}" with author names present`;
    } else if (bestMatchScore >= 3) {
      confidence = 'likely';
      verified = true;
      reasoning = `Good match found: "${bestMatch?.title}" with partial metadata match`;
    } else if (matchedResults >= 2) {
      confidence = 'likely';
      verified = true;
      reasoning = `Multiple partial matches found (${matchedResults} results)`;
    } else if (bestMatchScore >= 2) {
      confidence = 'uncertain';
      reasoning = `Weak match found: "${bestMatch?.title}" with low similarity`;
    } else {
      confidence = 'uncertain';
      reasoning = 'No strong matches found online';
    }

    const result: ValidationResult = {
      verified,
      confidence,
      source: bestMatch?.url || undefined,
      reasoning,
      matchedResults
    };

    console.log('[validate-metadata-online] ✅ Validation result:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[validate-metadata-online] ❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        verified: false,
        confidence: 'uncertain',
        reasoning: `Error: ${errorMessage}`,
        matchedResults: 0
      } as ValidationResult),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
