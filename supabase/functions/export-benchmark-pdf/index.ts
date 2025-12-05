import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BenchmarkResult {
  pdf_file: string;
  question: string;
  ground_truth: string;
  agent_response: string;
  correct: boolean;
  reason: string;
  response_time_ms: number;
}

interface ChunkMatch {
  content: string;
  chunk_type: string;
  page_number: number | null;
}

// Extract key financial/domain terms from question text
function extractKeyTerms(text: string): string[] {
  const keywords: string[] = [];
  
  const financialTerms = [
    'revenue', 'sales', 'income', 'expense', 'profit', 'loss', 'margin',
    'capex', 'capital expenditure', 'pp&e', 'ppne', 'property plant',
    'cash flow', 'dividend', 'earnings', 'eps', 'assets', 'liabilities',
    'debt', 'equity', 'ratio', 'turnover', 'operating', 'gross', 'net',
    'fiscal', 'quarter', 'annual', 'fy2018', 'fy2019', 'fy2020', 'fy2021', 'fy2022', 'fy2023',
    'segment', 'growth', 'organic', 'acquisition', 'consumer', 'industrial'
  ];
  
  const textLower = text.toLowerCase();
  
  for (const term of financialTerms) {
    if (textLower.includes(term)) {
      keywords.push(term);
    }
  }
  
  const yearMatches = text.match(/\b20\d{2}\b/g);
  if (yearMatches) {
    keywords.push(...yearMatches);
  }
  
  return keywords;
}

// Fix common UTF-8 mojibake encoding issues
function fixEncoding(text: string): string {
  if (!text) return '';
  return text
    .replace(/Ã¨/g, 'e')
    .replace(/Ã©/g, 'e')
    .replace(/Ã /g, 'a')
    .replace(/Ã¹/g, 'u')
    .replace(/Ã²/g, 'o')
    .replace(/Ã¬/g, 'i')
    .replace(/Ã§/g, 'c')
    .replace(/Ã±/g, 'n')
    .replace(/Ã¶/g, 'o')
    .replace(/Ã¼/g, 'u')
    .replace(/Ã¤/g, 'a')
    .replace(/ÃŸ/g, 'ss')
    .replace(/Ã‰/g, 'E')
    .replace(/Ã€/g, 'A')
    .replace(/â€"/g, '-')
    .replace(/â€"/g, '-')
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¦/g, '...')
    .replace(/Â°/g, ' deg')
    .replace(/Â·/g, '.')
    .replace(/Â®/g, '(R)')
    .replace(/â„¢/g, '(TM)')
    .replace(/Â©/g, '(C)')
    .replace(/Â /g, ' ')
    .replace(/\u0000/g, '')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Remove any remaining non-ASCII that jsPDF can't handle
    .replace(/[^\x00-\x7F]/g, ' ');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { runId } = await req.json();

    console.log(`[export-benchmark-pdf] Exporting benchmark run ${runId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all benchmark results for this run
    const { data: results, error: resultsError } = await supabase
      .from('benchmark_results')
      .select('*')
      .eq('run_id', runId)
      .order('pdf_file')
      .order('created_at');

    if (resultsError) throw resultsError;
    if (!results || results.length === 0) {
      throw new Error('No results found for this run');
    }

    console.log(`[export-benchmark-pdf] Found ${results.length} results`);

    // Calculate statistics
    const totalQuestions = results.length;
    const correctAnswers = results.filter(r => r.correct).length;
    const accuracy = ((correctAnswers / totalQuestions) * 100).toFixed(1);

    // Cache document IDs
    const docIdCache: Record<string, string | null> = {};
    
    // For each result, find the chunk containing the ground truth
    const resultsWithChunks: Array<BenchmarkResult & { sourceChunk: ChunkMatch | null }> = [];
    
    for (const result of results) {
      let sourceChunk: ChunkMatch | null = null;
      
      if (!(result.pdf_file in docIdCache)) {
        const { data: doc } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id')
          .eq('file_name', result.pdf_file)
          .maybeSingle();
        docIdCache[result.pdf_file] = doc?.id || null;
      }
      
      const docId = docIdCache[result.pdf_file];
      
      if (docId && result.ground_truth) {
        const groundTruth = result.ground_truth;
        const question = result.question || '';
        const questionKeywords = extractKeyTerms(question);
        const numbers = groundTruth.match(/[\d,]+\.?\d*%?/g) || [];
        const cleanNumbers = numbers.map((n: string) => n.replace(/,/g, '').replace(/%$/, ''));
        
        const { data: allChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('content, chunk_type, page_number')
          .eq('document_id', docId)
          .eq('embedding_status', 'ready');
        
        if (allChunks && allChunks.length > 0) {
          const scoredChunks = allChunks.map((chunk: any) => {
            let score = 0;
            const contentLower = chunk.content.toLowerCase();
            
            for (const num of cleanNumbers) {
              if (num && chunk.content.includes(num)) {
                score += 10;
              }
            }
            
            for (const keyword of questionKeywords) {
              if (contentLower.includes(keyword.toLowerCase())) {
                score += 5;
              }
            }
            
            if (cleanNumbers.length > 0 && (chunk.chunk_type === 'visual' || chunk.chunk_type === 'table')) {
              score += 3;
            }
            
            const len = chunk.content.length;
            if (len < 100) score -= 2;
            if (len > 3000) score -= 1;
            
            return { ...chunk, score };
          });
          
          scoredChunks.sort((a: any, b: any) => b.score - a.score);
          
          if (scoredChunks.length > 0 && scoredChunks[0].score >= 5) {
            const c = scoredChunks[0];
            sourceChunk = {
              content: c.content,
              chunk_type: c.chunk_type || 'text',
              page_number: c.page_number
            };
          }
        }
      }

      resultsWithChunks.push({
        ...result,
        sourceChunk
      });
    }

    // Generate PDF using jsPDF
    console.log('[export-benchmark-pdf] Generating PDF...');
    
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    let y = margin;
    
    // Helper to add new page if needed
    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };
    
    // Helper to write wrapped text
    const writeText = (text: string, fontSize: number, isBold: boolean = false): number => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      const cleanText = fixEncoding(text);
      const lines = doc.splitTextToSize(cleanText, contentWidth);
      const lineHeight = fontSize * 0.4;
      
      for (const line of lines) {
        checkPageBreak(lineHeight + 2);
        doc.text(line, margin, y);
        y += lineHeight;
      }
      y += 2;
      return lines.length;
    };
    
    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('BENCHMARK REPORT', margin, y);
    y += 10;
    
    // Summary
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Run ID: ${runId.substring(0, 8)}`, margin, y);
    y += 5;
    doc.text(`Accuracy: ${accuracy}% (${correctAnswers}/${totalQuestions})`, margin, y);
    y += 5;
    doc.text(`Date: ${new Date().toISOString().split('T')[0]}`, margin, y);
    y += 15;
    
    // Separator
    doc.setDrawColor(0);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;
    
    // Questions
    for (let i = 0; i < resultsWithChunks.length; i++) {
      const result = resultsWithChunks[i];
      
      // Check if we need a new page for this question (estimate ~80mm per question)
      checkPageBreak(80);
      
      // Question header
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      const status = result.correct ? '[CORRECT]' : '[INCORRECT]';
      doc.text(`QUESTION #${i + 1} ${status}`, margin, y);
      y += 4;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Document: ${fixEncoding(result.pdf_file)}`, margin, y);
      y += 8;
      
      // DOMANDA
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('DOMANDA:', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      writeText(result.question || 'N/A', 9);
      y += 3;
      
      // GROUND TRUTH
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('RISPOSTA ATTESA (GROUND TRUTH):', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      writeText(result.ground_truth || 'N/A', 9);
      y += 3;
      
      // RISPOSTA AGENTE
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('RISPOSTA AGENTE:', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      // Truncate long responses
      let agentResponse = result.agent_response || 'N/A';
      if (agentResponse.length > 1500) {
        agentResponse = agentResponse.substring(0, 1500) + '... [TRUNCATED]';
      }
      writeText(agentResponse, 8);
      y += 3;
      
      // CHUNK SORGENTE
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('CHUNK CONTENENTE INFORMAZIONE:', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      
      if (result.sourceChunk) {
        const chunkMeta = `[Type: ${result.sourceChunk.chunk_type}${result.sourceChunk.page_number ? `, Page: ${result.sourceChunk.page_number}` : ''}]`;
        doc.setFontSize(7);
        doc.text(chunkMeta, margin, y);
        y += 4;
        // Truncate long chunks
        let chunkContent = result.sourceChunk.content;
        if (chunkContent.length > 1000) {
          chunkContent = chunkContent.substring(0, 1000) + '... [TRUNCATED]';
        }
        writeText(chunkContent, 7);
      } else {
        doc.setFontSize(8);
        doc.text('NESSUN CHUNK TROVATO CONTENENTE L\'INFORMAZIONE RICHIESTA', margin, y);
        y += 5;
      }
      
      // Separator between questions
      y += 5;
      doc.setDrawColor(180);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;
    }
    
    // Generate PDF as array buffer
    const pdfArrayBuffer = doc.output('arraybuffer');
    const pdfUint8Array = new Uint8Array(pdfArrayBuffer);

    // Save PDF to Supabase Storage
    const fileName = `benchmark_report_${runId.substring(0, 8)}_${Date.now()}.pdf`;
    const filePath = `benchmarks/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('pdf-exports')
      .upload(filePath, pdfUint8Array, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('[export-benchmark-pdf] Upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('pdf-exports')
      .getPublicUrl(filePath);

    console.log(`[export-benchmark-pdf] PDF exported successfully: ${fileName}`);

    return new Response(JSON.stringify({ 
      success: true,
      url: urlData.publicUrl,
      fileName,
      stats: { total: totalQuestions, correct: correctAnswers, accuracy }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[export-benchmark-pdf] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Export error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
