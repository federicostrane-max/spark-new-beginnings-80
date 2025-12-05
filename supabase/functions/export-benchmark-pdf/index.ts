import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  
  // Financial terms
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
  
  // Extract year patterns (2018, 2019, etc.)
  const yearMatches = text.match(/\b20\d{2}\b/g);
  if (yearMatches) {
    keywords.push(...yearMatches);
  }
  
  return keywords;
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

    // Group by document for statistics
    const docStats: Record<string, { total: number; correct: number }> = {};
    results.forEach(r => {
      if (!docStats[r.pdf_file]) {
        docStats[r.pdf_file] = { total: 0, correct: 0 };
      }
      docStats[r.pdf_file].total++;
      if (r.correct) docStats[r.pdf_file].correct++;
    });

    // Cache document IDs
    const docIdCache: Record<string, string | null> = {};
    
    // For each result, find the chunk containing the ground truth
    const resultsWithChunks: Array<BenchmarkResult & { sourceChunk: ChunkMatch | null }> = [];
    
    for (const result of results) {
      let sourceChunk: ChunkMatch | null = null;
      
      // Get or fetch document ID
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
        // Extract key search terms from ground truth AND question for better matching
        const groundTruth = result.ground_truth;
        const question = result.question || '';
        
        // Extract key financial/domain terms from question
        const questionKeywords = extractKeyTerms(question);
        
        // Extract numbers from ground truth
        const numbers = groundTruth.match(/[\d,]+\.?\d*%?/g) || [];
        const cleanNumbers = numbers.map((n: string) => n.replace(/,/g, '').replace(/%$/, ''));
        
        // Fetch multiple candidate chunks
        const { data: allChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('content, chunk_type, page_number')
          .eq('document_id', docId)
          .eq('embedding_status', 'ready');
        
        if (allChunks && allChunks.length > 0) {
          // Score each chunk based on relevance
          const scoredChunks = allChunks.map((chunk: any) => {
            let score = 0;
            const contentLower = chunk.content.toLowerCase();
            
            // Score: +10 for each ground truth number found in chunk
            for (const num of cleanNumbers) {
              if (num && chunk.content.includes(num)) {
                score += 10;
              }
            }
            
            // Score: +5 for each question keyword found
            for (const keyword of questionKeywords) {
              if (contentLower.includes(keyword.toLowerCase())) {
                score += 5;
              }
            }
            
            // Prefer visual/table chunks for numerical data
            if (cleanNumbers.length > 0 && (chunk.chunk_type === 'visual' || chunk.chunk_type === 'table')) {
              score += 3;
            }
            
            // Penalize very short or very long chunks
            const len = chunk.content.length;
            if (len < 100) score -= 2;
            if (len > 3000) score -= 1;
            
            return { ...chunk, score };
          });
          
          // Sort by score descending
          scoredChunks.sort((a: any, b: any) => b.score - a.score);
          
          // Take the best match if it has a reasonable score
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

    // Generate HTML report
    const htmlContent = generateHtmlReport(
      runId,
      resultsWithChunks,
      { total: totalQuestions, correct: correctAnswers, accuracy },
      docStats
    );

    console.log('[export-benchmark-pdf] Generating HTML report...');

    // Save HTML to Supabase Storage
    const fileName = `benchmark_report_${runId.substring(0, 8)}_${Date.now()}.html`;
    const filePath = `benchmarks/${fileName}`;

    const htmlBuffer = new TextEncoder().encode(htmlContent);

    const { error: uploadError } = await supabase.storage
      .from('pdf-exports')
      .upload(filePath, htmlBuffer, {
        contentType: 'text/html',
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

    console.log(`[export-benchmark-pdf] HTML report exported successfully: ${fileName}`);

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

function generateHtmlReport(
  runId: string,
  results: Array<BenchmarkResult & { sourceChunk: ChunkMatch | null }>,
  stats: { total: number; correct: number; accuracy: string },
  docStats: Record<string, { total: number; correct: number }>
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Benchmark Report - ${timestamp}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', system-ui, sans-serif; 
      font-size: 11px; 
      line-height: 1.5;
      color: #1f2937;
      background: #f9fafb;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    
    h1 { 
      font-size: 24px; 
      color: #111827; 
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 3px solid #2563eb;
    }
    
    /* Summary Card */
    .summary-card {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
      display: flex;
      gap: 30px;
      align-items: center;
    }
    .big-stat {
      text-align: center;
      min-width: 100px;
    }
    .big-stat-value { font-size: 36px; font-weight: bold; }
    .big-stat-label { font-size: 11px; opacity: 0.9; text-transform: uppercase; }
    .summary-meta { font-size: 10px; opacity: 0.8; margin-top: 10px; }
    
    /* Document Table */
    .doc-section { margin-bottom: 30px; }
    .doc-section h2 { font-size: 16px; color: #1e40af; margin-bottom: 12px; }
    .doc-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .doc-table th {
      background: #f3f4f6;
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
    }
    .doc-table td {
      padding: 10px 12px;
      border-top: 1px solid #e5e7eb;
    }
    .accuracy-bar {
      height: 6px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
    }
    .accuracy-fill { height: 100%; background: #22c55e; }
    
    /* Question Cards */
    .questions-section h2 { 
      font-size: 18px; 
      color: #111827; 
      margin: 30px 0 20px 0;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
    }
    
    .question-card {
      background: white;
      border-radius: 10px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
      page-break-inside: avoid;
    }
    
    .card-header {
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e5e7eb;
    }
    .card-header.correct { background: #f0fdf4; border-left: 4px solid #22c55e; }
    .card-header.incorrect { background: #fef2f2; border-left: 4px solid #ef4444; }
    
    .card-title {
      font-weight: 600;
      font-size: 12px;
      color: #374151;
    }
    .card-doc { font-size: 10px; color: #6b7280; margin-top: 2px; }
    
    .badge {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 600;
    }
    .badge-correct { background: #dcfce7; color: #166534; }
    .badge-incorrect { background: #fee2e2; color: #991b1b; }
    
    .card-body { padding: 16px; }
    
    .field {
      margin-bottom: 14px;
    }
    .field:last-child { margin-bottom: 0; }
    
    .field-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      margin-bottom: 6px;
    }
    
    .field-content {
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 11px;
      line-height: 1.6;
    }
    
    .question-box {
      background: #fefce8;
      border: 1px solid #fde047;
    }
    
    .expected-box {
      background: #f0fdf4;
      border: 1px solid #86efac;
      font-weight: 600;
      color: #166534;
    }
    
    .response-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      max-height: 150px;
      overflow-y: auto;
    }
    
    .judge-box {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      font-style: italic;
      color: #92400e;
    }
    
    .chunk-box {
      background: #eff6ff;
      border: 1px solid #93c5fd;
      font-size: 10px;
      max-height: 200px;
      overflow-y: auto;
    }
    .chunk-meta {
      font-size: 9px;
      color: #3b82f6;
      margin-bottom: 6px;
      font-weight: 600;
    }
    
    .no-chunk {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      color: #991b1b;
      font-style: italic;
    }
    
    .response-time {
      font-size: 9px;
      color: #9ca3af;
      text-align: right;
      margin-top: 8px;
    }
    
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: inherit;
      margin: 0;
    }
    
    @media print {
      body { padding: 10px; background: white; }
      .question-card { box-shadow: none; border: 1px solid #e5e7eb; }
      .summary-card { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Benchmark Analysis Report</h1>
    
    <div class="summary-card">
      <div class="big-stat">
        <div class="big-stat-value">${stats.accuracy}%</div>
        <div class="big-stat-label">Accuracy</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-value">${stats.correct}</div>
        <div class="big-stat-label">Correct</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-value">${stats.total - stats.correct}</div>
        <div class="big-stat-label">Errors</div>
      </div>
      <div class="big-stat">
        <div class="big-stat-value">${Object.keys(docStats).length}</div>
        <div class="big-stat-label">Documents</div>
      </div>
      <div style="flex-grow: 1;">
        <div class="summary-meta">Run ID: ${runId.substring(0, 8)}</div>
        <div class="summary-meta">Generated: ${timestamp}</div>
      </div>
    </div>

    <div class="doc-section">
      <h2>Accuracy by Document</h2>
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 50%">Document</th>
            <th>Questions</th>
            <th>Correct</th>
            <th style="width: 20%">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(docStats)
            .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))
            .map(([doc, s]) => {
              const acc = ((s.correct / s.total) * 100).toFixed(0);
              return `
            <tr>
              <td>${doc}</td>
              <td>${s.total}</td>
              <td>${s.correct}</td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="accuracy-bar" style="flex-grow: 1;">
                    <div class="accuracy-fill" style="width: ${acc}%"></div>
                  </div>
                  <span style="min-width: 35px;">${acc}%</span>
                </div>
              </td>
            </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>

    <div class="questions-section">
      <h2>Detailed Question Analysis (${results.length} questions)</h2>
      
      ${results.map((r, idx) => `
        <div class="question-card">
          <div class="card-header ${r.correct ? 'correct' : 'incorrect'}">
            <div>
              <div class="card-title">Question #${idx + 1}</div>
              <div class="card-doc">${r.pdf_file}</div>
            </div>
            <span class="badge ${r.correct ? 'badge-correct' : 'badge-incorrect'}">
              ${r.correct ? 'CORRECT' : 'INCORRECT'}
            </span>
          </div>
          
          <div class="card-body">
            <div class="field">
              <div class="field-label">Question</div>
              <div class="field-content question-box">${escapeHtml(r.question)}</div>
            </div>
            
            <div class="field">
              <div class="field-label">Expected Answer (Ground Truth)</div>
              <div class="field-content expected-box">${escapeHtml(r.ground_truth)}</div>
            </div>
            
            <div class="field">
              <div class="field-label">Agent Response</div>
              <div class="field-content response-box">${escapeHtml(r.agent_response?.substring(0, 2000) || 'No response')}</div>
            </div>
            
            ${r.reason ? `
            <div class="field">
              <div class="field-label">Judge Evaluation</div>
              <div class="field-content judge-box">${escapeHtml(r.reason)}</div>
            </div>
            ` : ''}
            
            <div class="field">
              <div class="field-label">Source Chunk (where answer should be found)</div>
              ${r.sourceChunk ? `
              <div class="field-content chunk-box">
                <div class="chunk-meta">
                  Type: ${r.sourceChunk.chunk_type} 
                  ${r.sourceChunk.page_number ? '| Page: ' + r.sourceChunk.page_number : ''}
                </div>
                ${escapeHtml(r.sourceChunk.content)}
              </div>
              ` : `
              <div class="field-content no-chunk">
                No matching chunk found in knowledge base containing the expected answer
              </div>
              `}
            </div>
            
            <div class="response-time">Response time: ${r.response_time_ms}ms</div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  // Only escape characters that are dangerous in HTML content
  // Don't escape apostrophes - they display as &#039; otherwise
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
