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
}

async function verifyPdfUrl(url: string): Promise<{
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
    
    const apiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      throw new Error('Missing Google Custom Search credentials');
    }
    
    const allVerifiedPdfs: VerifiedPDF[] = [];
    
    for (const book of books) {
      console.log(`📖 Processing: ${book.title} by ${book.authors}`);
      
      // 3 query variations
      const queryVariations = [
        `"${book.title}" "${book.authors}" PDF`,
        `"${book.title}" "${book.authors}" download`,
        `"${book.title}" "${book.authors}" PDF download`
      ];
      
      let foundForBook = false;
      
      for (const query of queryVariations) {
        if (foundForBook) break;
        
        console.log(`  🔍 Query: ${query}`);
        
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=10`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`  ❌ Query failed: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        
        if (!data.items) continue;
        
        // Check up to maxUrlsToCheck URLs
        const urlsToCheck = Math.min(data.items.length, maxUrlsToCheck);
        
        for (let i = 0; i < urlsToCheck; i++) {
          if (foundForBook) break;
          
          const item = data.items[i];
          const pdfUrl = item.link;
          
          console.log(`    🔗 Checking URL ${i + 1}/${urlsToCheck}: ${pdfUrl.slice(0, 60)}...`);
          
          const verification = await verifyPdfUrl(pdfUrl);
          
          if (verification.success && verification.metadata) {
            console.log(`    ✅ VERIFIED: ${pdfUrl}`);
            
            allVerifiedPdfs.push({
              bookTitle: book.title,
              bookAuthors: book.authors,
              pdfUrl,
              verificationStatus: 'verified',
              contentType: verification.metadata.contentType,
              fileSize: verification.metadata.fileSize,
              domain: verification.metadata.domain,
              credibilityScore: verification.metadata.credibilityScore,
              foundViaQuery: query
            });
            
            foundForBook = true;
            break;
          } else {
            console.log(`    ❌ Failed verification`);
          }
        }
        
        // Rate limiting between variations
        if (!foundForBook) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      if (!foundForBook) {
        console.log(`  ⚠️ No verified PDF found for: ${book.title}`);
      }
      
      // Rate limiting between books
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`✅ [PDF VALIDATION] Completed: ${allVerifiedPdfs.length}/${books.length} books verified`);
    
    return new Response(
      JSON.stringify({ pdfs: allVerifiedPdfs }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [PDF VALIDATION] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, pdfs: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
