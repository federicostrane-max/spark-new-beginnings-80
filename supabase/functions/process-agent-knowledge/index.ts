import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Chunk text into overlapping segments
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, fileUrl, fileName, category = 'uploaded', summary } = await req.json();

    if (!agentId || !fileUrl || !fileName) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: agentId, fileUrl, fileName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document: ${fileName} for agent: ${agentId}`);

    // Download the file from storage
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from ${fileUrl}`);
    }

    const fileBlob = await fileResponse.blob();
    const arrayBuffer = await fileBlob.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    console.log(`Downloaded file, size: ${fileBuffer.length} bytes`);

    // Extract text using PDF.js (similar to analyze-document)
    const pdfjs = await import('https://esm.sh/pdfjs-dist@3.11.174/build/pdf.mjs');
    
    // Load the PDF
    const loadingTask = pdfjs.getDocument({ data: fileBuffer });
    const pdf = await loadingTask.promise;
    
    console.log(`PDF loaded, ${pdf.numPages} pages`);

    // Extract text from all pages
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }

    console.log(`Extracted ${fullText.length} characters of text`);

    if (!fullText.trim()) {
      throw new Error('No text could be extracted from the PDF');
    }

    // Chunk the text
    const chunks = chunkText(fullText, 1000, 200);
    console.log(`Created ${chunks.length} chunks`);

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process each chunk: generate embedding and insert
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);

      // Generate embedding
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: chunk,
        }),
      });

      if (!embeddingResponse.ok) {
        const error = await embeddingResponse.text();
        console.error('OpenAI embedding error:', error);
        throw new Error(`Failed to generate embedding for chunk ${i + 1}`);
      }

      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.data[0].embedding;

      // Insert into database
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert({
          agent_id: agentId,
          document_name: fileName,
          content: chunk,
          category: category,
          summary: summary || null,
          embedding: embedding,
        });

      if (insertError) {
        console.error('Database insert error:', insertError);
        throw new Error(`Failed to insert chunk ${i + 1}: ${insertError.message}`);
      }
    }

    console.log(`Successfully processed ${chunks.length} chunks for ${fileName}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunks: chunks.length,
        fileName: fileName
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in process-agent-knowledge function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
