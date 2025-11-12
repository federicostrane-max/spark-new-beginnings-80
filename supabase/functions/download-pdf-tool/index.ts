import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation helpers
function validateUrl(url: string): void {
  const MAX_URL_LENGTH = 2048;
  
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }
  
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`URL too long: maximum ${MAX_URL_LENGTH} characters allowed`);
  }
  
  // Basic URL format validation
  try {
    const urlObj = new URL(url);
    
    // Block potentially dangerous protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS protocols are allowed');
    }
    
    // Block internal/private IPs
    const hostname = urlObj.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname === '::1' ||
      hostname.match(/^169\.254\./)
    ) {
      throw new Error('Access to internal/private IPs is not allowed');
    }
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error('Invalid URL format');
    }
    throw e;
  }
}

function validateStringLength(value: string | undefined, fieldName: string, maxLength: number): void {
  if (value && value.length > maxLength) {
    throw new Error(`${fieldName} too long: maximum ${maxLength} characters allowed`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url: originalUrl, search_query, expected_title, expected_author } = await req.json();
    
    // Validate inputs
    validateUrl(originalUrl);
    validateStringLength(search_query, 'search_query', 500);
    validateStringLength(expected_title, 'expected_title', 300);
    validateStringLength(expected_author, 'expected_author', 200);
    
    let url = originalUrl; // Mutable for extraction flow

    // Initialize Supabase early for duplicate check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // STEP 1: Check for duplicates BEFORE downloading
    console.log('🔍 Checking for duplicate PDF...');
    const { data: existingDoc, error: checkError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('source_url', url)
      .maybeSingle();

    if (checkError) {
      console.warn('⚠️ Error checking for duplicates:', checkError);
    }

    if (existingDoc) {
      console.log(`✅ PDF already exists in knowledge base: ${existingDoc.file_name}`);
      
      // Update queue entry
      await supabase
        .from('pdf_download_queue')
        .update({
          status: 'completed',
          document_id: existingDoc.id,
          downloaded_file_name: existingDoc.file_name,
          completed_at: new Date().toISOString()
        })
        .eq('url', url)
        .eq('search_query', search_query || '');

      return new Response(
        JSON.stringify({ 
          success: true,
          document: {
            id: existingDoc.id,
            file_name: existingDoc.file_name,
            status: 'already_exists'
          },
          message: `PDF "${existingDoc.file_name}" is already in your knowledge base (skipped duplicate download)`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 2: Validate link availability BEFORE downloading (Hewson 2014 best practice)
    console.log('🔍 [PRE-CHECK] Validating link availability...');
    
    const validateLinkAvailability = async (url: string): Promise<{
      available: boolean;
      isPdf: boolean;
      error?: string;
    }> => {
      try {
        console.log(`🔍 [PRE-CHECK] Testing: ${url.slice(0, 80)}...`);
        
        const response = await fetch(url, { 
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/pdf,*/*'
          },
          signal: AbortSignal.timeout(5000)
        });
        
        const contentType = response.headers.get('content-type') || '';
        const isPdf = contentType.includes('application/pdf') || contentType.includes('octet-stream');
        
        if (!response.ok) {
          return { 
            available: false, 
            isPdf: false, 
            error: `HTTP ${response.status}` 
          };
        }
        
        if (!isPdf) {
          return { 
            available: true, 
            isPdf: false, 
            error: `Invalid content-type: ${contentType}` 
          };
        }
        
        console.log(`✅ [PRE-CHECK] Link is valid and accessible`);
        return { available: true, isPdf: true };
        
      } catch (error) {
        console.error(`❌ [PRE-CHECK] Validation failed:`, error);
        return { 
          available: false, 
          isPdf: false, 
          error: error instanceof Error ? error.message : 'Timeout or network error' 
        };
      }
    };

    // ============================================
    // PDF EXTRACTION SYSTEM (for landing pages)
    // ============================================
    
    interface PDFExtractor {
      name: string;
      detect: (url: string) => boolean;
      extractPDFUrl: (html: string, baseUrl: string) => string | null;
    }

    const PDF_EXTRACTORS: PDFExtractor[] = [
      // arXiv - Convert /abs/ to /pdf/
      {
        name: 'arXiv',
        detect: (url) => url.includes('arxiv.org'),
        extractPDFUrl: (html, baseUrl) => {
          const match = baseUrl.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
          if (match) return `https://arxiv.org/pdf/${match[1]}.pdf`;
          return null;
        }
      },
      
      // bioRxiv/medRxiv - Direct pattern
      {
        name: 'bioRxiv/medRxiv',
        detect: (url) => url.includes('biorxiv.org') || url.includes('medrxiv.org'),
        extractPDFUrl: (html, baseUrl) => {
          const match = baseUrl.match(/(biorxiv|medrxiv)\.org\/content\/([^\/]+)/);
          if (match) {
            const [_, domain, doi] = match;
            return `https://www.${domain}.org/content/${doi}.full.pdf`;
          }
          return null;
        }
      },
      
      // PubMed Central - Find PDF link in HTML
      {
        name: 'PubMed Central',
        detect: (url) => url.includes('ncbi.nlm.nih.gov/pmc'),
        extractPDFUrl: (html, baseUrl) => {
          const metaMatch = html.match(/<meta name="citation_pdf_url" content="([^"]+)"/);
          if (metaMatch) return metaMatch[1];
          
          const linkMatch = html.match(/href="(\/pmc\/articles\/[^"]+\.pdf)"/);
          if (linkMatch) return new URL(linkMatch[1], baseUrl).href;
          
          return null;
        }
      },
      
      // Springer Link - Find content/pdf/
      {
        name: 'Springer',
        detect: (url) => url.includes('link.springer.com'),
        extractPDFUrl: (html, baseUrl) => {
          const match = html.match(/href="(\/content\/pdf\/[^"]+\.pdf)"/);
          if (match) return new URL(match[1], baseUrl).href;
          
          const btnMatch = html.match(/data-track-action="download pdf"[^>]+href="([^"]+)"/);
          if (btnMatch) return new URL(btnMatch[1], baseUrl).href;
          
          return null;
        }
      },
      
      // IEEE Xplore - Find in JSON embed
      {
        name: 'IEEE',
        detect: (url) => url.includes('ieeexplore.ieee.org'),
        extractPDFUrl: (html, baseUrl) => {
          const match = html.match(/"pdfUrl":"([^"]+)"/);
          if (match) return match[1].replace(/\\\//g, '/');
          
          const metaMatch = html.match(/<meta name="citation_pdf_url" content="([^"]+)"/);
          if (metaMatch) return metaMatch[1];
          
          return null;
        }
      },
      
      // Generic extractor (fallback)
      {
        name: 'Generic',
        detect: (url) => true,
        extractPDFUrl: (html, baseUrl) => {
          // Standard academic meta tag
          const citationMatch = html.match(/<meta name="citation_pdf_url" content="([^"]+)"/);
          if (citationMatch) return citationMatch[1];
          
          // Link with "download" and ".pdf"
          const downloadMatch = html.match(/href="([^"]*download[^"]*\.pdf[^"]*)"/i);
          if (downloadMatch) return new URL(downloadMatch[1], baseUrl).href;
          
          // Link with keywords + .pdf
          const keywordMatch = html.match(/href="([^"]*(?:full|view|read|pdf)[^"]*\.pdf[^"]*)"/i);
          if (keywordMatch) return new URL(keywordMatch[1], baseUrl).href;
          
          // Any href ending with .pdf
          const anyPdfMatch = html.match(/href="([^"]+\.pdf)"/i);
          if (anyPdfMatch) return new URL(anyPdfMatch[1], baseUrl).href;
          
          return null;
        }
      }
    ];

    const extractPDFUrlFromLandingPage = async (
      landingUrl: string
    ): Promise<{ success: boolean; pdfUrl?: string; method?: string; error?: string }> => {
      try {
        console.log(`🔍 [EXTRACTION] Attempting to extract PDF URL from: ${landingUrl.slice(0, 80)}...`);
        
        const response = await fetch(landingUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}` };
        }
        
        const contentType = response.headers.get('content-type') || '';
        
        // Already a PDF
        if (contentType.includes('application/pdf')) {
          console.log(`✅ [EXTRACTION] URL is already a direct PDF`);
          return { success: true, pdfUrl: landingUrl, method: 'direct' };
        }
        
        // Not HTML
        if (!contentType.includes('text/html')) {
          return { success: false, error: `Unexpected content-type: ${contentType}` };
        }
        
        const html = await response.text();
        
        // Find appropriate extractor
        const extractor = PDF_EXTRACTORS.find(e => e.detect(landingUrl));
        
        if (!extractor) {
          return { success: false, error: 'No suitable extractor found' };
        }
        
        console.log(`🔧 [EXTRACTION] Using ${extractor.name} extractor`);
        
        const pdfUrl = extractor.extractPDFUrl(html, landingUrl);
        
        if (!pdfUrl) {
          return { success: false, error: `${extractor.name} extractor found no PDF URL` };
        }
        
        console.log(`✅ [EXTRACTION] Extracted PDF URL: ${pdfUrl.slice(0, 80)}...`);
        
        return { success: true, pdfUrl, method: extractor.name };
        
      } catch (error) {
        console.error(`❌ [EXTRACTION] Error:`, error);
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    };
    
    // ============================================
    // VALIDATION & EXTRACTION FLOW
    // ============================================
    
    let extractionMethod: string | undefined;
    
    const validation = await validateLinkAvailability(url);
    
    // SCENARIO 1: Direct PDF → proceed normally
    if (validation.available && validation.isPdf) {
      console.log('✅ [PRE-CHECK] Link is a direct PDF, proceeding with download...');
    }
    // SCENARIO 2: Not a PDF (landing page) → try extraction
    else if (validation.available && !validation.isPdf) {
      console.log('⚠️ [PRE-CHECK] Link is not a direct PDF (content-type: text/html)');
      console.log('🔄 [EXTRACTION] Attempting to extract PDF URL from landing page...');
      
      const extraction = await extractPDFUrlFromLandingPage(url);
      
      if (extraction.success && extraction.pdfUrl) {
        console.log(`✅ [EXTRACTION] Successfully extracted PDF URL using ${extraction.method}`);
        console.log(`📥 [DOWNLOAD] Now downloading from extracted URL: ${extraction.pdfUrl.slice(0, 80)}...`);
        
        // Update URL and track method
        url = extraction.pdfUrl;
        extractionMethod = extraction.method;
        
        // Validate extracted URL
        const extractedValidation = await validateLinkAvailability(url);
        if (!extractedValidation.available || !extractedValidation.isPdf) {
          throw new Error(`Extracted URL is not a valid PDF: ${extractedValidation.error}`);
        }
        
        console.log('✅ Extracted PDF URL validated, proceeding with download...');
      } else {
        // Extraction failed
        const errorMsg = `Could not extract PDF URL from landing page: ${extraction.error}`;
        console.error(`❌ [EXTRACTION] ${errorMsg}`);
        
        // Get conversation_id for notification
        const { data: queueEntry } = await supabase
          .from('pdf_download_queue')
          .select('conversation_id')
          .eq('url', originalUrl)
          .eq('search_query', search_query || '')
          .maybeSingle();
        
        await supabase
          .from('pdf_download_queue')
          .update({
            status: 'failed',
            error_message: errorMsg,
            completed_at: new Date().toISOString()
          })
          .eq('url', originalUrl)
          .eq('search_query', search_query || '');
        
        // 📬 Send download failed notification
        if (queueEntry?.conversation_id) {
          try {
            await supabase
              .from('agent_messages')
              .insert({
                conversation_id: queueEntry.conversation_id,
                role: 'system',
                content: `__PDF_DOWNLOAD_FAILED__${JSON.stringify({
                  title: expected_title || 'Document',
                  reason: errorMsg,
                  url: originalUrl
                })}`
              });
          } catch (notifError) {
            console.warn('[download-pdf-tool] ⚠️ Failed to send notification:', notifError);
          }
        }
        
        throw new Error(errorMsg);
      }
    }
    // SCENARIO 3: Link not available
    else {
      const errorMsg = validation.error || 'Link not accessible';
      console.error(`❌ [PRE-CHECK] ${errorMsg}`);
      
      // Get conversation_id for notification
      const { data: queueEntry } = await supabase
        .from('pdf_download_queue')
        .select('conversation_id')
        .eq('url', originalUrl)
        .eq('search_query', search_query || '')
        .maybeSingle();
      
      await supabase
        .from('pdf_download_queue')
        .update({
          status: 'failed',
          error_message: `Link validation failed: ${errorMsg}`,
          completed_at: new Date().toISOString()
        })
        .eq('url', originalUrl)
        .eq('search_query', search_query || '');
      
      // 📬 Send download failed notification
      if (queueEntry?.conversation_id) {
        try {
          await supabase
            .from('agent_messages')
            .insert({
              conversation_id: queueEntry.conversation_id,
              role: 'system',
              content: `__PDF_DOWNLOAD_FAILED__${JSON.stringify({
                title: expected_title || 'Document',
                reason: `Link non accessibile: ${errorMsg}`,
                url: originalUrl
              })}`
            });
        } catch (notifError) {
          console.warn('[download-pdf-tool] ⚠️ Failed to send notification:', notifError);
        }
      }
      
      throw new Error(`Cannot download PDF: ${errorMsg}`);
    }
    
    console.log('📥 Downloading PDF from:', url);

    // User-Agent rotation to bypass 403 errors
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];

    // Retry logic with User-Agent rotation
    let pdfResponse: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const userAgent = userAgents[attempt - 1] || userAgents[0];
        console.log(`📥 Download attempt ${attempt}/3 with User-Agent: ${userAgent.slice(0, 50)}...`);
        
        pdfResponse = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/pdf,application/octet-stream,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': new URL(url).origin
          }
        });
        
        if (pdfResponse.ok) {
          console.log(`✅ Download successful on attempt ${attempt}`);
          break;
        }
        
        console.warn(`⚠️ Attempt ${attempt} failed with status ${pdfResponse.status}`);
        
        if (attempt < 3) {
          const delayMs = 1000 * attempt;
          console.log(`⏳ Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (fetchError) {
        console.error(`❌ Attempt ${attempt} failed:`, fetchError);
        if (attempt === 3) throw fetchError;
        
        const delayMs = 1000 * attempt;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    if (!pdfResponse || !pdfResponse.ok) {
      const status = pdfResponse?.status;
      let errorMsg = `Failed to download PDF after 3 attempts`;
      
      if (status === 403) {
        errorMsg = `PDF requires authentication or blocks automated access (HTTP 403). The source website is preventing downloads.`;
      } else if (status === 404) {
        errorMsg = `PDF not found at this URL (HTTP 404). The link may be broken or expired.`;
      } else if (status === 401) {
        errorMsg = `PDF requires login credentials (HTTP 401). Cannot download protected content.`;
      } else if (status) {
        errorMsg = `${errorMsg} (HTTP ${status})`;
      }
      
      throw new Error(errorMsg);
    }

    // Validate Content-Type
    const contentType = pdfResponse.headers.get('content-type');
    console.log(`📄 Content-Type: ${contentType}`);

    if (!contentType?.includes('application/pdf') && !contentType?.includes('octet-stream')) {
      throw new Error(`Invalid content type: ${contentType}. Expected PDF.`);
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    
    // ===== PDF PAGE COUNT VALIDATION =====
    let pageCount: number;
    try {
      // Import pdf-lib dynamically
      const { PDFDocument } = await import('https://esm.sh/pdf-lib@1.17.1');
      
      // Load and count pages
      const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
      pageCount = pdfDoc.getPageCount();
      
      console.log(`📄 PDF has ${pageCount} pages`);
      
      // FILTER: Reject if < 30 pages
      if (pageCount < 30) {
        await supabase
          .from('pdf_download_queue')
          .update({
            status: 'failed',
            error_message: `Documento troppo breve: ${pageCount} pagine (minimo 30)`,
            completed_at: new Date().toISOString()
          })
          .eq('url', originalUrl);
        
        throw new Error(`PDF too short: ${pageCount} pages (minimum 30 required)`);
      }
    } catch (error) {
      // If it's our "too short" error, propagate it
      if (error instanceof Error && error.message.includes('too short')) {
        throw error;
      }
      
      // If it's a PDF reading error (corrupted/protected), reject
      console.error('❌ Cannot read PDF (corrupted/protected):', error);
      
      await supabase
        .from('pdf_download_queue')
        .update({
          status: 'failed',
          error_message: 'PDF corrotto o protetto: impossibile leggere il contenuto',
          completed_at: new Date().toISOString()
        })
        .eq('url', originalUrl);
      
      throw new Error('PDF corrupted or protected - cannot read content');
    }
    // ===== END PAGE COUNT VALIDATION =====
    
    // Extract filename from URL or generate one
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split('/').pop() || `document_${Date.now()}.pdf`;
    const filePath = `${Date.now()}_${fileName}`;

    console.log('📄 File size:', pdfArrayBuffer.byteLength, 'bytes');

    // Upload to storage (Supabase client already initialized at top)
    const { error: uploadError } = await supabase.storage
      .from('knowledge-pdfs')
      .upload(filePath, pdfArrayBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    console.log('✅ PDF uploaded to storage:', filePath);

    // Get conversation_id for notifications
    const { data: queueEntry } = await supabase
      .from('pdf_download_queue')
      .select('conversation_id')
      .eq('url', originalUrl)
      .maybeSingle();

    // Create document record (skip text extraction - will be done by process-document)
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        source_url: url,
        search_query: search_query || null,
        file_size_bytes: pdfArrayBuffer.byteLength,
        page_count: pageCount, // Add page count
        validation_status: 'validating', // Start with validating status
        processing_status: 'downloaded'
      })
      .select()
      .single();

    if (docError) {
      console.error('Document insert error:', docError);
      
      // Provide user-friendly error for duplicate filename
      if (docError.code === '23505' && docError.message.includes('unique_file_name')) {
        throw new Error(`A PDF with filename "${fileName}" already exists in your knowledge base. This PDF was downloaded from a different URL but has the same filename.`);
      }
      
      throw new Error(`Failed to create document record: ${docError.message}`);
    }

    console.log('📝 Document record created:', document.id);
    
    // Update queue entry to processing
    await supabase
      .from('pdf_download_queue')
      .update({
        status: 'processing',
        document_id: document.id,
        downloaded_file_name: fileName
      })
      .eq('url', url)
      .eq('search_query', search_query || '');

    // Trigger validation with retry mechanism
    console.log('[download-pdf-tool] Triggering validate-document...');
    
    let validationSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[download-pdf-tool] Validation attempt ${attempt}/2...`);
        
        const { data: validationResult, error: validationError } = await supabase.functions.invoke('validate-document', {
          body: { 
            documentId: document.id,
            searchQuery: search_query,
            expected_title: expected_title,
            expected_author: expected_author,
            fullText: ''
          }
        });
        
        if (!validationError) {
          console.log(`✅ Validation successful on attempt ${attempt}`);
          validationSuccess = true;
          break;
        }
        
        console.warn(`⚠️ Validation attempt ${attempt} failed:`, validationError);
        
        if (attempt < 2) {
          console.log('⏳ Retrying validation in 10s...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (err) {
        console.error(`❌ Validation attempt ${attempt} exception:`, err);
        if (attempt === 2) {
          console.error('❌ All validation attempts failed');
          // The validate-document function will handle marking as failed
        }
      }
    }
    
    if (!validationSuccess) {
      console.warn('⚠️ Validation did not succeed after 2 attempts');
    }

    console.log('[download-pdf-tool] ========== END SUCCESS ==========');
    console.log('[download-pdf-tool] Summary:', {
      originalUrl,
      finalPdfUrl: url,
      method: extractionMethod || 'direct',
      fileName,
      documentId: document.id
    });
    
    // 📬 Send download complete notification
    if (queueEntry?.conversation_id) {
      console.log(`[download-pdf-tool] 📬 Sending download notification...`);
      try {
        // System message for toast
        await supabase
          .from('agent_messages')
          .insert({
            conversation_id: queueEntry.conversation_id,
            role: 'system',
            content: `__PDF_DOWNLOADED__${JSON.stringify({
              title: fileName,
              documentId: document.id
            })}`
          });
        
        // Assistant message for chat feedback
        await supabase
          .from('agent_messages')
          .insert({
            conversation_id: queueEntry.conversation_id,
            role: 'assistant',
            content: `✅ **PDF scaricato con successo**: ${fileName}\n\n📄 Il documento è stato scaricato correttamente. Procedo ora con la validazione del contenuto...`
          });
        
        console.log('[download-pdf-tool] ✓ Download notifications sent');
      } catch (notifError) {
        console.warn('[download-pdf-tool] ⚠️ Failed to send notification:', notifError);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true,
        document: {
          id: document.id,
          file_name: fileName,
          status: 'validating'
        },
        message: `PDF "${fileName}" downloaded successfully and validation started`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[download-pdf-tool] ❌ ERROR:', error);
    console.error('[download-pdf-tool] Stack:', (error as Error).stack);
    console.log('[download-pdf-tool] ========== END ERROR ==========');
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
