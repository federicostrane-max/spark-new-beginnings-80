import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Book {
  title: string;
  authors: string;
}

interface ValidationRequest {
  books: Book[];
  maxResultsPerBook: number;
  maxUrlsToCheck: number;
}

interface VerifiedPDF {
  bookTitle: string;
  bookAuthors: string;
  pdfUrl: string;
  verificationStatus: 'verified' | 'failed';
  contentType: string;
  fileSize: number;
  domain: string;
  credibilityScore: number;
  foundViaQuery: string;
  googlePosition: number; // Position in Google results (lower = better)
}

async function verifyPdfUrl(url: string, bookTitle: string): Promise<{
  success: boolean;
  metadata?: {
    contentType: string;
    fileSize: number;
    domain: string;
    credibilityScore: number;
  }
}> {
  // Blacklist check
  const blacklistDomains = [
    'scribd.com',
    'academia.edu',
    'researchgate.net', // Requires login
    'chegg.com',
    'coursehero.com'
  ];
  
  try {
    const domain = new URL(url).hostname;
    
    if (blacklistDomains.some(d => url.toLowerCase().includes(d))) {
      return { success: false };
    }
    
    // HEAD request to verify PDF
    const response = await fetch(url, { 
      method: 'HEAD',
      redirect: 'follow'
    });
    
    const contentType = response.headers.get('content-type') || '';
    
    if (!contentType.includes('application/pdf')) {
      return { success: false };
    }
    
    // Check paywall indicators
    const isPaywall = 
      response.headers.get('x-paywall') ||
      url.includes('/purchase/') ||
      url.includes('/subscribe/') ||
      url.includes('/buy/');
    
    if (isPaywall) return { success: false };
    
    // Whitelist credibility scoring
    let credibilityScore = 3; // Default
    
    if (domain.endsWith('.edu')) credibilityScore = 10;
    else if (domain.includes('arxiv')) credibilityScore = 9;
    else if (['springer.com', 'ieee.org', 'acm.org', 'nature.com', 'science.org'].some(d => domain.includes(d))) {
      credibilityScore = 8;
    }
    else if (['oreilly.com', 'manning.com', 'packtpub.com'].some(d => domain.includes(d))) {
      credibilityScore = 6;
    }
    
    // BOOST: Direct PDF link with book title in filename/URL
    const urlLower = url.toLowerCase();
    const titleWords = bookTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchingWords = titleWords.filter(word => urlLower.includes(word));
    
    if (matchingWords.length >= 2) {
      // URL contains multiple words from title - likely a direct match
      credibilityScore = Math.min(10, credibilityScore + 3);
      console.log(`    🎯 TITLE MATCH BOOST: ${matchingWords.length} words matched, score +3 → ${credibilityScore}`);
    }
    
    return {
      success: true,
      metadata: {
        contentType,
        fileSize: parseInt(response.headers.get('content-length') || '0'),
        domain,
        credibilityScore
      }
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Verification failed for ${url}:`, errorMessage);
    return { success: false };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { books, maxResultsPerBook = 2, maxUrlsToCheck = 15 }: ValidationRequest = await req.json();
    
    console.log(`🔍 [PDF VALIDATION] Starting for ${books.length} books`);
    
    const apiKey = Deno.env.get('SERPAPI_API_KEY');
    
    if (!apiKey) {
      console.error('❌ [PDF VALIDATION] Missing SerpAPI credentials');
      return new Response(
        JSON.stringify({ pdfs: [], error: 'Missing API credentials' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const allVerifiedPdfs: VerifiedPDF[] = [];
    
    for (const book of books) {
      console.log(`📖 Processing: ${book.title} by ${book.authors}`);
      
      // Query variations - PRIORITIZE DIRECT SEARCHES
      const queryVariations = [
        `${book.title} ${book.authors} filetype:pdf`, // Most direct
        `"${book.title}" PDF`, // Simple title search
        `"${book.title}" "${book.authors}" PDF`,
        `${book.title} download pdf`,
        `"${book.title}" "${book.authors}" PDF download`
      ];
      
      const bookPdfs: VerifiedPDF[] = [];
      
      for (const query of queryVariations) {
        console.log(`  🔍 Query: ${query}`);
        
        try {
          const url = `https://serpapi.com/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10`;
          
          const response = await fetch(url);
          
          if (!response.ok) {
            console.error(`  ❌ Query failed: ${response.status}`);
            continue;
          }
          
          const data = await response.json();
          
          if (!data.organic_results || data.organic_results.length === 0) {
            console.log(`  ℹ️ No results for query`);
            continue;
          }
          
          // Check up to maxUrlsToCheck URLs
          const urlsToCheck = Math.min(data.organic_results.length, maxUrlsToCheck);
          
          for (let i = 0; i < urlsToCheck; i++) {
            const item = data.organic_results[i];
            const pdfUrl = item.link;
            
            // Skip if already found
            if (bookPdfs.some(p => p.pdfUrl === pdfUrl)) continue;
            
            console.log(`    🔗 Checking URL ${i + 1}/${urlsToCheck}: ${pdfUrl.slice(0, 60)}...`);
            
            const verification = await verifyPdfUrl(pdfUrl, book.title);
            
            if (verification.success && verification.metadata) {
              console.log(`    ✅ VERIFIED: ${pdfUrl} (score: ${verification.metadata.credibilityScore})`);
              
              bookPdfs.push({
                bookTitle: book.title,
                bookAuthors: book.authors,
                pdfUrl,
                verificationStatus: 'verified',
                contentType: verification.metadata.contentType,
                fileSize: verification.metadata.fileSize,
                domain: verification.metadata.domain,
                credibilityScore: verification.metadata.credibilityScore,
                foundViaQuery: query,
                googlePosition: i + 1 // Track Google ranking
              });
              
              // Found enough? (but keep searching for better ones)
              if (bookPdfs.length >= maxResultsPerBook * 2) break;
            } else {
              console.log(`    ❌ Failed verification`);
            }
          }
        } catch (queryError) {
          console.error(`  ❌ Error processing query "${query}":`, queryError instanceof Error ? queryError.message : 'Unknown error');
          continue;
        }
        
        // Rate limiting between variations
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Stop if we have plenty of options
        if (bookPdfs.length >= maxResultsPerBook * 3) break;
      }
      
      // Sort by GOOGLE POSITION first (earlier = better), then credibility
      bookPdfs.sort((a, b) => {
        // Primary: Google position (lower is better)
        if (a.googlePosition !== b.googlePosition) {
          return a.googlePosition - b.googlePosition;
        }
        // Secondary: Credibility score (higher is better)
        return b.credibilityScore - a.credibilityScore;
      });
      
      // Take only top results
      const topPdfs = bookPdfs.slice(0, maxResultsPerBook);
      allVerifiedPdfs.push(...topPdfs);
      
      console.log(`  ✅ Found ${bookPdfs.length} PDFs, keeping top ${topPdfs.length}`);
      
      if (topPdfs.length === 0) {
        console.log(`  ⚠️ No verified PDF found for: ${book.title}`);
      }
      
      // Rate limiting between books
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`✅ [PDF VALIDATION] Completed: ${allVerifiedPdfs.length}/${books.length} books verified`);
    
    // ALWAYS return { pdfs: [] } even if empty, never null
    return new Response(
      JSON.stringify({ pdfs: allVerifiedPdfs }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [PDF VALIDATION] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // CRITICAL: Return { pdfs: [] } not null on error
    return new Response(
      JSON.stringify({ pdfs: [], error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
