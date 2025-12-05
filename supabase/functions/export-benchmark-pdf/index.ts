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
  similarity: number;
  chunk_type: string;
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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

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

    // For each incorrect answer, try to find matching chunks
    const resultsWithChunks: Array<BenchmarkResult & { relevantChunks: ChunkMatch[] }> = [];
    
    for (const result of results) {
      let relevantChunks: ChunkMatch[] = [];
      
      // Only search for chunks if we have a ground truth to search for
      if (!result.correct && result.ground_truth) {
        // Extract key terms from ground truth for search
        const searchTerms = result.ground_truth
          .replace(/[^\w\s\d.%$]/g, ' ')
          .split(/\s+/)
          .filter((t: string) => t.length > 2)
          .slice(0, 5)
          .join(' ');
        
        // Find document ID
        const { data: doc } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id')
          .eq('file_name', result.pdf_file)
          .maybeSingle();

        if (doc) {
          // Search for chunks containing the answer
          const { data: chunks } = await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .select('content, chunk_type')
            .eq('document_id', doc.id)
            .eq('embedding_status', 'ready')
            .ilike('content', `%${searchTerms.split(' ')[0]}%`)
            .limit(3);

          if (chunks && chunks.length > 0) {
            relevantChunks = chunks.map(c => ({
              content: c.content.substring(0, 500) + (c.content.length > 500 ? '...' : ''),
              similarity: 0,
              chunk_type: c.chunk_type || 'text'
            }));
          }
        }
      }

      resultsWithChunks.push({
        ...result,
        relevantChunks
      });
    }

    // Generate HTML report
    const htmlContent = generateHtmlReport(
      runId,
      resultsWithChunks,
      { total: totalQuestions, correct: correctAnswers, accuracy },
      docStats
    );

    console.log('[export-benchmark-pdf] Converting HTML to PDF...');
    
    const pdfResponse = await fetch('https://api.lovable.app/api/html-to-pdf', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlContent,
        options: {
          format: 'A4',
          margin: {
            top: '15mm',
            right: '10mm',
            bottom: '15mm',
            left: '10mm',
          },
          printBackground: true,
        }
      }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      throw new Error(`PDF generation failed: ${errorText}`);
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = await pdfBlob.arrayBuffer();
    
    console.log(`[export-benchmark-pdf] PDF generated, size: ${pdfBuffer.byteLength} bytes`);

    // Save PDF to Supabase Storage
    const fileName = `benchmark_report_${runId.substring(0, 8)}_${Date.now()}.pdf`;
    const filePath = `benchmarks/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('pdf-exports')
      .upload(filePath, pdfBuffer, {
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

function generateHtmlReport(
  runId: string,
  results: Array<BenchmarkResult & { relevantChunks: ChunkMatch[] }>,
  stats: { total: number; correct: number; accuracy: string },
  docStats: Record<string, { total: number; correct: number }>
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Benchmark Report - ${timestamp}</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      font-size: 10px; 
      line-height: 1.4;
      color: #1a1a1a;
      margin: 0;
      padding: 10px;
    }
    h1 { 
      font-size: 18px; 
      color: #0f172a; 
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    h2 { 
      font-size: 14px; 
      color: #1e40af;
      margin-top: 20px;
      margin-bottom: 10px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 12px;
      color: #374151;
      margin: 15px 0 8px 0;
      page-break-after: avoid;
    }
    .summary-box {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 15px;
    }
    .stats-grid {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
    }
    .stat-item {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 8px 12px;
      min-width: 100px;
    }
    .stat-value { 
      font-size: 18px; 
      font-weight: bold; 
      color: #0f172a; 
    }
    .stat-label { 
      font-size: 9px; 
      color: #6b7280; 
      text-transform: uppercase;
    }
    .doc-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9px;
    }
    .doc-table th, .doc-table td {
      border: 1px solid #e5e7eb;
      padding: 5px 8px;
      text-align: left;
    }
    .doc-table th {
      background: #f3f4f6;
      font-weight: 600;
    }
    .question-block {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin: 12px 0;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .question-header {
      background: #f8fafc;
      padding: 8px 10px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .question-doc {
      font-weight: 600;
      color: #374151;
      font-size: 9px;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 8px;
      font-weight: 600;
    }
    .badge-correct {
      background: #dcfce7;
      color: #166534;
    }
    .badge-incorrect {
      background: #fee2e2;
      color: #991b1b;
    }
    .question-body { padding: 10px; }
    .section-label {
      font-size: 8px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .question-text {
      background: #fefce8;
      border-left: 3px solid #eab308;
      padding: 8px;
      margin: 8px 0;
      font-size: 10px;
    }
    .ground-truth {
      background: #dcfce7;
      border-left: 3px solid #22c55e;
      padding: 8px;
      margin: 8px 0;
    }
    .agent-response {
      background: #f1f5f9;
      border-left: 3px solid #64748b;
      padding: 8px;
      margin: 8px 0;
      max-height: 200px;
      overflow: hidden;
    }
    .judge-reason {
      background: #fef3c7;
      border-left: 3px solid #f59e0b;
      padding: 8px;
      margin: 8px 0;
      font-style: italic;
    }
    .chunks-section {
      background: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding: 8px;
      margin: 8px 0;
    }
    .chunk-item {
      background: white;
      border: 1px solid #dbeafe;
      border-radius: 4px;
      padding: 6px;
      margin: 4px 0;
      font-size: 8px;
      max-height: 100px;
      overflow: hidden;
    }
    .meta-info {
      font-size: 8px;
      color: #9ca3af;
      margin-top: 5px;
    }
    .page-break { page-break-before: always; }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
      font-family: inherit;
    }
  </style>
</head>
<body>
  <h1>📊 FinanceBench Benchmark Report</h1>
  
  <div class="summary-box">
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${stats.accuracy}%</div>
        <div class="stat-label">Accuracy</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.correct}/${stats.total}</div>
        <div class="stat-label">Correct</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${Object.keys(docStats).length}</div>
        <div class="stat-label">Documents</div>
      </div>
    </div>
    <div class="meta-info">
      Run ID: ${runId} | Generated: ${timestamp}
    </div>
  </div>

  <h2>📁 Results by Document</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th>Document</th>
        <th>Questions</th>
        <th>Correct</th>
        <th>Accuracy</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(docStats).map(([doc, s]) => `
        <tr>
          <td>${doc}</td>
          <td>${s.total}</td>
          <td>${s.correct}</td>
          <td>${((s.correct / s.total) * 100).toFixed(0)}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="page-break"></div>
  
  <h2>📝 Detailed Results</h2>
  
  ${results.map((r, idx) => `
    <div class="question-block">
      <div class="question-header">
        <span class="question-doc">#${idx + 1} | ${r.pdf_file}</span>
        <span class="badge ${r.correct ? 'badge-correct' : 'badge-incorrect'}">
          ${r.correct ? '✓ CORRECT' : '✗ INCORRECT'}
        </span>
      </div>
      <div class="question-body">
        <div class="section-label">Question</div>
        <div class="question-text"><pre>${escapeHtml(r.question)}</pre></div>
        
        <div class="section-label">Expected Answer (Ground Truth)</div>
        <div class="ground-truth"><pre>${escapeHtml(r.ground_truth)}</pre></div>
        
        <div class="section-label">Agent Response</div>
        <div class="agent-response"><pre>${escapeHtml(r.agent_response?.substring(0, 1500) || 'No response')}</pre></div>
        
        ${r.reason ? `
          <div class="section-label">Judge Evaluation</div>
          <div class="judge-reason"><pre>${escapeHtml(r.reason)}</pre></div>
        ` : ''}
        
        ${r.relevantChunks && r.relevantChunks.length > 0 ? `
          <div class="section-label">Relevant Chunks Found (containing answer)</div>
          <div class="chunks-section">
            ${r.relevantChunks.map(c => `
              <div class="chunk-item">
                <strong>[${c.chunk_type}]</strong> ${escapeHtml(c.content)}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <div class="meta-info">Response time: ${r.response_time_ms}ms</div>
      </div>
    </div>
  `).join('')}
  
</body>
</html>
  `;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
