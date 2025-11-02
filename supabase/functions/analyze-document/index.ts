import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunking function
function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  
  return chunks;
}

// Extract text from PDF URL using PDF.js (server-side)
async function extractTextFromPDF(fileUrl: string): Promise<string> {
  try {
    console.log('Downloading PDF from:', fileUrl);
    
    // Download the PDF file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    console.log('PDF downloaded, size:', uint8Array.length, 'bytes');
    
    // Import PDF.js for Deno
    const pdfjsLib = await import('https://esm.sh/pdfjs-dist@3.11.174/build/pdf.mjs');
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;
    
    console.log('PDF loaded, pages:', pdf.numPages);
    
    let fullText = '';
    
    // Extract text from each page
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n\n';
      console.log(`Page ${i} extracted, length: ${pageText.length}`);
    }
    
    console.log('Total text extracted:', fullText.length, 'characters');
    return fullText.trim();
    
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileUrl, fileName, agentId, category, summary } = await req.json();
    
    console.log('Processing document:', { fileName, agentId, category, hasFileUrl: !!fileUrl });
    
    if (!fileName || !agentId) {
      throw new Error('fileName and agentId are required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let textContent = '';
    
    // Extract text from PDF if fileUrl is provided
    if (fileUrl) {
      console.log('Extracting text from PDF URL');
      textContent = await extractTextFromPDF(fileUrl);
    } else {
      throw new Error('fileUrl is required');
    }

    if (!textContent || textContent.length === 0) {
      throw new Error('No text content extracted from PDF');
    }

    console.log('Text content length:', textContent.length);

    // Chunk the text
    const chunks = chunkText(textContent, 1000, 200);
    console.log('Created chunks:', chunks.length);

    let successfulChunks = 0;
    let failedChunks = 0;

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        console.log(`Processing chunk ${i + 1}/${chunks.length}, length: ${chunk.length}`);
        
        // Generate embedding for this chunk
        const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('generate-embedding', {
          body: { text: chunk }
        });

        if (embeddingError) {
          console.error(`Error generating embedding for chunk ${i + 1}:`, embeddingError);
          failedChunks++;
          continue;
        }

        const embedding = embeddingData?.embedding;
        
        if (!embedding) {
          console.error(`No embedding returned for chunk ${i + 1}`);
          failedChunks++;
          continue;
        }

        // Insert chunk into agent_knowledge
        const { error: insertError } = await supabase
          .from('agent_knowledge')
          .insert({
            agent_id: agentId,
            document_name: `${fileName} (chunk ${i + 1}/${chunks.length})`,
            content: chunk,
            category: category || 'General',
            summary: summary || `Chunk ${i + 1} of ${fileName}`,
            embedding: embedding
          });

        if (insertError) {
          console.error(`Error inserting chunk ${i + 1}:`, insertError);
          failedChunks++;
          continue;
        }

        successfulChunks++;
        console.log(`Chunk ${i + 1} inserted successfully`);
        
      } catch (chunkError) {
        console.error(`Error processing chunk ${i + 1}:`, chunkError);
        failedChunks++;
      }
    }

    console.log(`Processing complete: ${successfulChunks} successful, ${failedChunks} failed`);

    if (successfulChunks === 0) {
      throw new Error('Failed to process any chunks');
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunks: successfulChunks,
        failed: failedChunks,
        documentName: fileName
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-document:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
