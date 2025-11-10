import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchAndAcquireRequest {
  topic: string;
  maxBooks?: number;
  maxResultsPerBook?: number;
}

interface AcquisitionResult {
  success: boolean;
  books_discovered: number;
  pdfs_found: number;
  pdfs_queued: number;
  pdfs_already_existing: number;
  pdfs_failed: number;
  details: Array<{
    book_title: string;
    book_authors: string;
    pdf_url: string;
    status: 'queued' | 'existing' | 'failed';
    message: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { topic, maxBooks = 5, maxResultsPerBook = 2 }: SearchAndAcquireRequest = await req.json();
    
    console.log(`🔍 [SEARCH & ACQUIRE] Starting for topic: "${topic}"`);
    console.log(`   Max books: ${maxBooks}, Max PDFs per book: ${maxResultsPerBook}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const result: AcquisitionResult = {
      success: true,
      books_discovered: 0,
      pdfs_found: 0,
      pdfs_queued: 0,
      pdfs_already_existing: 0,
      pdfs_failed: 0,
      details: []
    };
    
    // STEP 1: Book Discovery
    console.log(`📚 [STEP 1] Discovering books on topic: ${topic}`);
    
    const { data: discoveryData, error: discoveryError } = await supabase.functions.invoke(
      'book-discovery',
      { body: { topic, maxBooks } }
    );
    
    if (discoveryError || !discoveryData?.books || discoveryData.books.length === 0) {
      console.error('❌ Book discovery failed:', discoveryError);
      result.success = false;
      return new Response(
        JSON.stringify({ ...result, error: 'Failed to discover books' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const books = discoveryData.books;
    result.books_discovered = books.length;
    console.log(`✅ [STEP 1] Discovered ${books.length} books`);
    
    // STEP 2: PDF Search & Validation
    console.log(`🔎 [STEP 2] Searching for PDFs for ${books.length} books`);
    
    const { data: pdfData, error: pdfError } = await supabase.functions.invoke(
      'pdf-search-with-validation',
      { body: { books, maxResultsPerBook, maxUrlsToCheck: 15 } }
    );
    
    if (pdfError || !pdfData?.pdfs) {
      console.error('❌ PDF search failed:', pdfError);
      result.success = false;
      return new Response(
        JSON.stringify({ ...result, error: 'Failed to search for PDFs' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const pdfs = pdfData.pdfs;
    result.pdfs_found = pdfs.length;
    console.log(`✅ [STEP 2] Found ${pdfs.length} verified PDFs`);
    
    if (pdfs.length === 0) {
      console.log('ℹ️ No PDFs found - completing early');
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // STEP 3: Check for duplicates and download
    console.log(`📥 [STEP 3] Processing ${pdfs.length} PDFs (checking duplicates + downloading)`);
    
    for (const pdf of pdfs) {
      console.log(`\n🔄 Processing: ${pdf.bookTitle} by ${pdf.bookAuthors}`);
      console.log(`   URL: ${pdf.pdfUrl}`);
      
      try {
        // Check if PDF already exists in knowledge base
        const { data: existingDoc } = await supabase
          .from('knowledge_documents')
          .select('id, file_name')
          .eq('source_url', pdf.pdfUrl)
          .maybeSingle();
        
        if (existingDoc) {
          console.log(`   ✅ Already exists: ${existingDoc.file_name}`);
          result.pdfs_already_existing++;
          result.details.push({
            book_title: pdf.bookTitle,
            book_authors: pdf.bookAuthors,
            pdf_url: pdf.pdfUrl,
            status: 'existing',
            message: `Already in knowledge base: ${existingDoc.file_name}`
          });
          continue;
        }
        
        // Not a duplicate - proceed with download
        console.log(`   📥 Queueing download...`);
        
        const { data: downloadData, error: downloadError } = await supabase.functions.invoke(
          'download-pdf-tool',
          {
            body: {
              url: pdf.pdfUrl,
              search_query: topic,
              expected_title: pdf.bookTitle,
              expected_author: pdf.bookAuthors
            }
          }
        );
        
        if (downloadError) {
          console.error(`   ❌ Download failed:`, downloadError);
          result.pdfs_failed++;
          result.details.push({
            book_title: pdf.bookTitle,
            book_authors: pdf.bookAuthors,
            pdf_url: pdf.pdfUrl,
            status: 'failed',
            message: `Download failed: ${downloadError.message || 'Unknown error'}`
          });
        } else {
          console.log(`   ✅ Queued for processing`);
          result.pdfs_queued++;
          result.details.push({
            book_title: pdf.bookTitle,
            book_authors: pdf.bookAuthors,
            pdf_url: pdf.pdfUrl,
            status: 'queued',
            message: 'Successfully queued for validation and processing'
          });
        }
        
        // Rate limiting between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ Error processing PDF:`, error);
        result.pdfs_failed++;
        result.details.push({
          book_title: pdf.bookTitle,
          book_authors: pdf.bookAuthors,
          pdf_url: pdf.pdfUrl,
          status: 'failed',
          message: `Processing error: ${error instanceof Error ? error.message : 'Unknown'}`
        });
      }
    }
    
    console.log(`\n✅ [SEARCH & ACQUIRE] Completed!`);
    console.log(`   📚 Books discovered: ${result.books_discovered}`);
    console.log(`   🔎 PDFs found: ${result.pdfs_found}`);
    console.log(`   📥 PDFs queued: ${result.pdfs_queued}`);
    console.log(`   ♻️ Already existing: ${result.pdfs_already_existing}`);
    console.log(`   ❌ Failed: ${result.pdfs_failed}`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [SEARCH & ACQUIRE] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        books_discovered: 0,
        pdfs_found: 0,
        pdfs_queued: 0,
        pdfs_already_existing: 0,
        pdfs_failed: 0,
        details: []
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
