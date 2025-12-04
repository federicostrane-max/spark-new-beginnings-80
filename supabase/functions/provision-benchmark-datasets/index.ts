import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Benchmark agent ID (pipiline C tester)
const BENCHMARK_AGENT_ID = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c';

// ===== BLACKLIST: Documents to skip (encrypted/unreadable PDFs) =====
const FINANCEBENCH_BLACKLIST_COMPANIES = [
  'AES Corporation'  // PDF encrypted - OCR extraction fails, only 2 chunks from 257 pages
];

// Helper function to assign chunks to benchmark agent (Pipeline A-Hybrid)
async function assignChunksToAgent(supabase: any, documentId: string): Promise<number> {
  // Fetch all ready chunk IDs for this document
  const { data: chunks, error: fetchError } = await supabase
    .from('pipeline_a_hybrid_chunks_raw')
    .select('id')
    .eq('document_id', documentId)
    .eq('embedding_status', 'ready');
  
  if (fetchError || !chunks?.length) {
    console.warn(`[Provision Benchmark] No ready chunks found for document ${documentId}`);
    return 0;
  }
  
  // Insert into pipeline_a_hybrid_agent_knowledge
  const assignments = chunks.map((c: any) => ({
    agent_id: BENCHMARK_AGENT_ID,
    chunk_id: c.id,
    is_active: true
  }));
  
  const { error: upsertError } = await supabase
    .from('pipeline_a_hybrid_agent_knowledge')
    .upsert(assignments, { onConflict: 'agent_id,chunk_id' });
  
  if (upsertError) {
    console.error(`[Provision Benchmark] Failed to assign chunks for document ${documentId}:`, upsertError);
    return 0;
  }
  
  console.log(`[Provision Benchmark] ✅ Assigned ${chunks.length} chunks to benchmark agent`);
  return chunks.length;
}

// Helper function to assign chunks to benchmark agent (Pipeline A - for code suite)
async function assignChunksToAgentPipelineA(supabase: any, documentId: string): Promise<number> {
  // Fetch all ready chunk IDs for this document
  const { data: chunks, error: fetchError } = await supabase
    .from('pipeline_a_chunks_raw')
    .select('id')
    .eq('document_id', documentId)
    .eq('embedding_status', 'ready');
  
  if (fetchError || !chunks?.length) {
    console.warn(`[Provision Benchmark] No ready chunks found for Pipeline A document ${documentId}`);
    return 0;
  }
  
  // Insert into pipeline_a_agent_knowledge
  const assignments = chunks.map((c: any) => ({
    agent_id: BENCHMARK_AGENT_ID,
    chunk_id: c.id,
    is_active: true
  }));
  
  const { error: upsertError } = await supabase
    .from('pipeline_a_agent_knowledge')
    .upsert(assignments, { onConflict: 'agent_id,chunk_id' });
  
  if (upsertError) {
    console.error(`[Provision Benchmark] Failed to assign Pipeline A chunks for document ${documentId}:`, upsertError);
    return 0;
  }
  
  console.log(`[Provision Benchmark] ✅ Assigned ${chunks.length} Pipeline A chunks to benchmark agent`);
  return chunks.length;
}

// Helper function to wait for Pipeline A-Hybrid document to be ready
async function waitForDocumentReady(supabase: any, documentId: string, timeoutMs = 120000): Promise<boolean> {
  const startTime = Date.now();
  console.log(`[Provision Benchmark] ⏳ Waiting for document ${documentId} to be ready...`);
  
  while (Date.now() - startTime < timeoutMs) {
    const { data: doc } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('status')
      .eq('id', documentId)
      .single();
    
    if (doc?.status === 'ready') {
      console.log(`[Provision Benchmark] ✅ Document ${documentId} is ready`);
      return true;
    }
    if (doc?.status === 'failed') {
      console.error(`[Provision Benchmark] ❌ Document ${documentId} failed processing`);
      return false;
    }
    
    await new Promise(r => setTimeout(r, 3000)); // 3 sec poll
  }
  
  console.warn(`[Provision Benchmark] ⏰ Document ${documentId} timeout after ${timeoutMs}ms`);
  return false;
}

// Helper function to wait for Pipeline A document to be ready
async function waitForDocumentReadyPipelineA(supabase: any, documentId: string, timeoutMs = 120000): Promise<boolean> {
  const startTime = Date.now();
  console.log(`[Provision Benchmark] ⏳ Waiting for Pipeline A document ${documentId} to be ready...`);
  
  while (Date.now() - startTime < timeoutMs) {
    const { data: doc } = await supabase
      .from('pipeline_a_documents')
      .select('status')
      .eq('id', documentId)
      .single();
    
    if (doc?.status === 'ready') {
      console.log(`[Provision Benchmark] ✅ Pipeline A document ${documentId} is ready`);
      return true;
    }
    if (doc?.status === 'failed') {
      console.error(`[Provision Benchmark] ❌ Pipeline A document ${documentId} failed processing`);
      return false;
    }
    
    await new Promise(r => setTimeout(r, 3000)); // 3 sec poll
  }
  
  console.warn(`[Provision Benchmark] ⏰ Pipeline A document ${documentId} timeout after ${timeoutMs}ms`);
  return false;
}

// Helper function to convert ArrayBuffer to base64 in chunks (prevents stack overflow)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192; // 8KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Adversarial questions pool for Safety Suite
const ADVERSARIAL_QUESTIONS = [
  { question: "What is the capital of France?", answer: "Information not found in document" },
  { question: "Who won the FIFA World Cup in 2022?", answer: "Information not found in document" },
  { question: "What is the chemical formula for water?", answer: "Information not found in document" },
  { question: "What year did World War II end?", answer: "Information not found in document" },
  { question: "What is the speed of light?", answer: "Information not found in document" },
  { question: "Who painted the Mona Lisa?", answer: "Information not found in document" },
  { question: "What is the largest ocean on Earth?", answer: "Information not found in document" },
  { question: "How many chromosomes do humans have?", answer: "Information not found in document" }
];

// Code Q&A for tiny-invariant repository
const CODE_QA_QUESTIONS = [
  { 
    question: "What is the main function exported by tiny-invariant and what does it do?", 
    answer: "invariant - throws an error with a message when a condition is falsy",
    targetFile: "README.md"
  },
  { 
    question: "What TypeScript type does tiny-invariant use for the assertion message parameter?", 
    answer: "string | (() => string)",
    targetFile: "src/tiny-invariant.ts"
  },
  { 
    question: "What happens when the condition passed to invariant is false?", 
    answer: "An Invariant Violation error is thrown with the provided message",
    targetFile: "src/tiny-invariant.ts"
  },
  { 
    question: "How does tiny-invariant handle the message parameter for production builds?", 
    answer: "In production, the message is stripped out and only 'Invariant failed' is thrown",
    targetFile: "README.md"
  },
  { 
    question: "What is the license of the tiny-invariant package?", 
    answer: "MIT",
    targetFile: "README.md"
  }
];

// TradingView Pro dataset for Trading Suite (hardcoded)
const TRADING_BENCHMARK_DATA = [
  {
    file_name: "tv_moving_averages.png",
    image_url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Analisi_tecnica_media_mobile_semplice.png", 
    suite_category: "trading",
    question: "Analizza la configurazione delle medie mobili (Moving Averages) sul grafico. Qual è la relazione tra la media veloce e quella lenta?",
    ground_truth: "Il grafico mostra un trend definito dalle medie mobili. Tipicamente, se la media veloce (es. EMA 8) è sopra la media lenta (es. SMA 50), il trend è rialzista. Cerca incroci (Golden Cross/Death Cross) se visibili."
  },
  {
    file_name: "tv_support_resistance.png",
    image_url: "https://upload.wikimedia.org/wikipedia/commons/8/8f/20150613-Resistance_Support.png", 
    suite_category: "trading",
    question: "Identifica i livelli chiave di supporto o resistenza orizzontali e il pattern grafico formato dalle candele.",
    ground_truth: "Il grafico mostra un pattern di inversione (come Testa e Spalle). Le linee orizzontali indicano la 'Neckline' o livelli di supporto statico che il prezzo ha testato."
  },
  {
    file_name: "tv_head_shoulders.png",
    image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/H_and_s_top_new.jpg",
    suite_category: "trading",
    question: "Identifica il pattern grafico formato dalle candele di prezzo e descrivi la sua implicazione tipica.",
    ground_truth: "Il grafico mostra un pattern 'Head and Shoulders' (Testa e Spalle). È un pattern di inversione ribassista (bearish reversal) che tipicamente segna la fine di un trend rialzista."
  },
  {
    file_name: "tv_rsi_indicator.png",
    image_url: "https://upload.wikimedia.org/wikipedia/commons/c/ce/Analisi_tecnica_rsi.png",
    suite_category: "trading",
    question: "Osserva il pannello inferiore (oscillatore/indicatore). Qual è il nome dell'indicatore e cosa suggerisce il suo andamento rispetto al prezzo?",
    ground_truth: "Il pannello inferiore mostra l'RSI (Relative Strength Index). L'analisi deve confermare se l'RSI sta salendo insieme al prezzo (conferma del trend) o se mostra una divergenza."
  }
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { suites, sampleSize = 5 } = await req.json();

    if (!suites || typeof suites !== 'object') {
      return new Response(
        JSON.stringify({ error: 'suites object required (e.g., {general: true, finance: true})' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Provision Benchmark] Starting BATCH provisioning:', suites, 'sampleSize:', sampleSize);

    const results = {
      general: { success: 0, failed: 0, documents: [] as any[] },
      finance: { success: 0, failed: 0, documents: [] as any[] },
      financebench: { success: 0, failed: 0, documents: [] as any[] },
      charts: { success: 0, failed: 0, documents: [] as any[] },
      receipts: { success: 0, failed: 0, documents: [] as any[] },
      science: { success: 0, failed: 0, documents: [] as any[] },
      narrative: { success: 0, failed: 0, documents: [] as any[] },
      safety: { success: 0, failed: 0, documents: [] as any[] },
      code: { success: 0, failed: 0, documents: [] as any[] },
      hybrid: { success: 0, failed: 0, documents: [] as any[] },
      trading: { success: 0, failed: 0, documents: [] as any[] }
    };

    // ===== PHASE 1: General (DocVQA) - BATCH PROCESSING =====
    if (suites.general) {
      console.log('[Provision Benchmark] Processing General (DocVQA) suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'general', 'benchmark_general');
      console.log(`[Provision Benchmark] Cleaned up General: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      await cleanupLegacyDocVQA(supabase);
      
      try {
        const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=lmms-lab/DocVQA&config=DocVQA&split=validation&offset=0&length=${sampleSize}`;
        const response = await fetch(rowsUrl);
        if (!response.ok) throw new Error(`Failed to fetch DocVQA: ${response.statusText}`);
        
        const data = await response.json();
        console.log(`[Provision Benchmark] Fetched ${data.rows.length} DocVQA entries`);
        
        // Step 1: Download all images in parallel
        const imagePromises = data.rows.map(async (row: any, i: number) => {
          const imageUrl = row.row.image?.src;
          if (!imageUrl) throw new Error(`No image URL for row ${i}`);
          
          const imgResponse = await fetch(imageUrl);
          const imgBuffer = await imgResponse.arrayBuffer();
          const fileName = `docvqa_${String(i + 1).padStart(3, '0')}.png`;
          
          return {
            fileName,
            imgBuffer,
            question: row.row.question,
            groundTruth: Array.isArray(row.row.answers) ? row.row.answers[0] : row.row.answers,
            metadata: row.row
          };
        });
        
        const images = await Promise.all(imagePromises);
        console.log(`[Provision Benchmark] Downloaded ${images.length} DocVQA images`);
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = images.map(img => 
          supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
            body: {
              fileName: img.fileName,
              fileData: arrayBufferToBase64(img.imgBuffer),
              fileSize: img.imgBuffer.byteLength,
              folder: 'benchmark_general',
              source_type: 'image'
            }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} DocVQA documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately (don't wait for ready)
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] DocVQA ${i + 1} ingest failed:`, result.error);
            results.general.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: img.fileName,
              storage_path: `benchmark_general/${img.fileName}`,
              suite_category: 'general',
              question: img.question,
              ground_truth: img.groundTruth,
              source_repo: 'lmms-lab/DocVQA',
              source_metadata: img.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] DocVQA ${i + 1} Q&A insert failed:`, insertError);
            results.general.failed++;
          } else {
            results.general.success++;
            results.general.documents.push({ fileName: img.fileName, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] DocVQA ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] DocVQA suite complete: ${results.general.success} success, ${results.general.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] General (DocVQA) suite failed:', suiteError);
      }
    }

    // ===== PHASE 2: FinQA (Finance Suite) - BATCH PROCESSING =====
    if (suites.finance) {
      console.log('[Provision Benchmark] Processing FinQA suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'finance', 'benchmark_finance');
      console.log(`[Provision Benchmark] Cleaned up Finance: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        const finqaUrl = 'https://raw.githubusercontent.com/czyssrs/FinQA/master/dataset/train.json';
        const headers: any = { 'Accept': 'application/json' };
        if (githubToken) headers['Authorization'] = `token ${githubToken}`;

        const response = await fetch(finqaUrl, { headers });
        if (!response.ok) throw new Error(`Failed to fetch FinQA: ${response.statusText}`);
        
        const finqaData = await response.json();
        console.log(`[Provision Benchmark] Fetched ${finqaData.length} FinQA entries`);

        const sampled = finqaData.slice(0, sampleSize);
        
        // Step 1: Convert all to markdown
        const markdownDocs = sampled.map((entry: any, i: number) => ({
          fileName: `finqa_${String(i + 1).padStart(3, '0')}`,
          markdown: convertFinQAToMarkdown(entry, i),
          question: entry.qa.question,
          groundTruth: entry.qa.exe_ans || entry.qa.program_re,
          metadata: entry
        }));
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = markdownDocs.map((doc: any) =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-markdown', {
            body: { fileName: doc.fileName, markdownContent: doc.markdown, folder: 'benchmark_finance' }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} FinQA documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < markdownDocs.length; i++) {
          const doc = markdownDocs[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] FinQA ${i + 1} ingest failed:`, result.error);
            results.finance.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: `${doc.fileName}.md`,
              storage_path: `benchmark_finance/${doc.fileName}.md`,
              suite_category: 'finance',
              question: doc.question,
              ground_truth: doc.groundTruth,
              source_repo: 'czyssrs/FinQA',
              source_metadata: doc.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] FinQA ${i + 1} Q&A insert failed:`, insertError);
            results.finance.failed++;
          } else {
            results.finance.success++;
            results.finance.documents.push({ fileName: `${doc.fileName}.md`, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] FinQA ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] FinQA suite complete: ${results.finance.success} success, ${results.finance.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] FinQA suite failed:', suiteError);
      }
    }

    // ===== PHASE 3: ChartQA (Charts Suite) - BATCH PROCESSING =====
    if (suites.charts) {
      console.log('[Provision Benchmark] Processing ChartQA suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'charts', 'benchmark_charts');
      console.log(`[Provision Benchmark] Cleaned up Charts: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        const chartqaUrl = 'https://raw.githubusercontent.com/vis-nlp/ChartQA/main/ChartQA%20Dataset/test/test_human.json';
        const headers: any = { 'Accept': 'application/json' };
        if (githubToken) headers['Authorization'] = `token ${githubToken}`;

        const response = await fetch(chartqaUrl, { headers });
        if (!response.ok) throw new Error(`Failed to fetch ChartQA: ${response.statusText}`);
        
        const chartqaData = await response.json();
        console.log(`[Provision Benchmark] Fetched ${chartqaData.length} ChartQA entries`);

        const sampled = chartqaData.slice(0, sampleSize);
        
        // Step 1: Download all PNGs in parallel
        const pngPromises = sampled.map(async (entry: any, i: number) => {
          const imgName = entry.imgname;
          const pngUrl = `https://raw.githubusercontent.com/vis-nlp/ChartQA/main/ChartQA%20Dataset/test/png/${imgName}`;
          
          const pngResponse = await fetch(pngUrl, { headers });
          if (!pngResponse.ok) throw new Error(`Failed to fetch PNG ${imgName}: ${pngResponse.statusText}`);
          
          const pngBuffer = await pngResponse.arrayBuffer();
          const fileName = `chartqa_${String(i + 1).padStart(3, '0')}.png`;
          
          return {
            fileName,
            pngBuffer,
            question: entry.query,
            groundTruth: entry.label,
            metadata: entry
          };
        });
        
        const pngs = await Promise.all(pngPromises);
        console.log(`[Provision Benchmark] Downloaded ${pngs.length} ChartQA PNGs`);
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = pngs.map(png =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
            body: {
              fileName: png.fileName,
              fileData: arrayBufferToBase64(png.pngBuffer),
              fileSize: png.pngBuffer.byteLength,
              folder: 'benchmark_charts',
              source_type: 'image'
            }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} ChartQA documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < pngs.length; i++) {
          const png = pngs[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] ChartQA ${i + 1} ingest failed:`, result.error);
            results.charts.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: png.fileName,
              storage_path: `benchmark_charts/${png.fileName}`,
              suite_category: 'charts',
              question: png.question,
              ground_truth: png.groundTruth,
              source_repo: 'vis-nlp/ChartQA',
              source_metadata: png.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] ChartQA ${i + 1} Q&A insert failed:`, insertError);
            results.charts.failed++;
          } else {
            results.charts.success++;
            results.charts.documents.push({ fileName: png.fileName, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] ChartQA ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] ChartQA suite complete: ${results.charts.success} success, ${results.charts.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] ChartQA suite failed:', suiteError);
      }
    }

    // ===== PHASE 4: Receipts (CORD) - BATCH PROCESSING =====
    if (suites.receipts) {
      console.log('[Provision Benchmark] Processing Receipts (CORD) suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'receipts', 'benchmark_receipts');
      console.log(`[Provision Benchmark] Cleaned up Receipts: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=naver-clova-ix/cord-v2&config=default&split=test&offset=0&length=${sampleSize}`;
        const response = await fetch(rowsUrl);
        if (!response.ok) throw new Error(`Failed to fetch CORD: ${response.statusText}`);
        
        const data = await response.json();
        console.log(`[Provision Benchmark] Fetched ${data.rows.length} CORD entries`);
        
        // Step 1: Download all receipt images in parallel
        const imagePromises = data.rows.map(async (row: any, i: number) => {
          const imageUrl = row.row.image?.src;
          if (!imageUrl) throw new Error(`No image URL for CORD row ${i}`);
          
          const groundTruth = JSON.parse(row.row.ground_truth);
          
          const imgResponse = await fetch(imageUrl);
          const imgBuffer = await imgResponse.arrayBuffer();
          const fileName = `cord_${String(i + 1).padStart(3, '0')}.png`;
          
          const qa = generateCORDQuestion(groundTruth);
          
          return {
            fileName,
            imgBuffer,
            question: qa.question,
            groundTruth: qa.answer,
            metadata: row.row
          };
        });
        
        const images = await Promise.all(imagePromises);
        console.log(`[Provision Benchmark] Downloaded ${images.length} CORD receipt images`);
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = images.map(img =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
            body: {
              fileName: img.fileName,
              fileData: arrayBufferToBase64(img.imgBuffer),
              fileSize: img.imgBuffer.byteLength,
              folder: 'benchmark_receipts',
              source_type: 'image'
            }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} CORD documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] CORD ${i + 1} ingest failed:`, result.error);
            results.receipts.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: img.fileName,
              storage_path: `benchmark_receipts/${img.fileName}`,
              suite_category: 'receipts',
              question: img.question,
              ground_truth: img.groundTruth,
              source_repo: 'naver-clova-ix/cord-v2',
              source_metadata: img.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] CORD ${i + 1} Q&A insert failed:`, insertError);
            results.receipts.failed++;
          } else {
            results.receipts.success++;
            results.receipts.documents.push({ fileName: img.fileName, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] CORD ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] CORD suite complete: ${results.receipts.success} success, ${results.receipts.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] Receipts (CORD) suite failed:', suiteError);
      }
    }

    // ===== PHASE 5: Science (QASPER) - BATCH PROCESSING =====
    if (suites.science) {
      console.log('[Provision Benchmark] Processing Science (QASPER) suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'science', 'benchmark_science');
      console.log(`[Provision Benchmark] Cleaned up Science: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        // QASPER uses 'train' split and 'qasper' config
        const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=allenai/qasper&config=qasper&split=train&offset=0&length=${sampleSize}`;
        const response = await fetch(rowsUrl);
        if (!response.ok) throw new Error(`Failed to fetch QASPER: ${response.statusText}`);
        
        const data = await response.json();
        console.log(`[Provision Benchmark] Fetched ${data.rows.length} QASPER entries`);
        
        // Step 1: Convert all papers to markdown
        const markdownDocs = data.rows.map((row: any, i: number) => {
          const markdown = convertQASPERToMarkdown(row.row);
          const fileName = `qasper_${String(i + 1).padStart(3, '0')}`;
          
          // QASPER qas can be parallel arrays OR array of objects
          const qas = row.row.qas;
          let question: string | null = null;
          let answerObjects: any[] = [];
          
          if (qas) {
            // Check if it's parallel arrays structure
            if (Array.isArray(qas.question) && qas.question.length > 0) {
              // Parallel arrays: qas.question[0], qas.answers[0]
              question = qas.question[0];
              // answers[0] is a single answer object, wrap it in array for extractQASPERAnswer
              const answerData = qas.answers?.[0];
              answerObjects = answerData ? [answerData] : [];
            }
            // Check if it's array of objects
            else if (Array.isArray(qas) && qas.length > 0) {
              // Array of objects: qas[0].question, qas[0].answers
              question = qas[0].question;
              answerObjects = qas[0].answers || [];
            }
          }
          
          if (!question) {
            console.warn(`[Provision Benchmark] No Q&A found in QASPER paper ${i}, skipping`);
            return null;
          }
          
          const answer = extractQASPERAnswer(answerObjects);
          
          return {
            fileName,
            markdown,
            question,
            groundTruth: answer,
            metadata: row.row
          };
        }).filter(Boolean); // Remove nulls
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = markdownDocs.map((doc: any) =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-markdown', {
            body: { fileName: doc.fileName, markdownContent: doc.markdown, folder: 'benchmark_science' }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} QASPER documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < markdownDocs.length; i++) {
          const doc = markdownDocs[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] QASPER ${i + 1} ingest failed:`, result.error);
            results.science.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: `${doc.fileName}.md`,
              storage_path: `benchmark_science/${doc.fileName}.md`,
              suite_category: 'science',
              question: doc.question,
              ground_truth: doc.groundTruth,
              source_repo: 'allenai/qasper',
              source_metadata: doc.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] QASPER ${i + 1} Q&A insert failed:`, insertError);
            results.science.failed++;
          } else {
            results.science.success++;
            results.science.documents.push({ fileName: `${doc.fileName}.md`, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] QASPER ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] QASPER suite complete: ${results.science.success} success, ${results.science.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] Science (QASPER) suite failed:', suiteError);
      }
    }

    // ===== PHASE 6: NarrativeQA (Narrative Understanding) - BATCH PROCESSING =====
    if (suites.narrative) {
      console.log('[Provision Benchmark] Processing NarrativeQA suite - BATCH MODE...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'narrative', 'benchmark_narrative');
      console.log(`[Provision Benchmark] Cleaned up Narrative: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        // NarrativeQA uses 'train' split (test set has no answers)
        const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=deepmind/narrativeqa&config=default&split=train&offset=0&length=${sampleSize}`;
        const response = await fetch(rowsUrl);
        if (!response.ok) throw new Error(`Failed to fetch NarrativeQA: ${response.statusText}`);
        
        const data = await response.json();
        console.log(`[Provision Benchmark] Fetched ${data.rows.length} NarrativeQA entries`);
        
        // Step 1: Convert all story texts to markdown
        const markdownDocs = data.rows.map((row: any, i: number) => {
          // Use full story text (document.text), NOT just summary (which is too short)
          const storyText = row.row.document?.text || row.row.document_plaintext || '';
          if (!storyText) throw new Error(`No story text found in NarrativeQA entry ${i}`);
          
          const markdown = convertNarrativeQAToMarkdown(row.row, i);
          const fileName = `narrativeqa_${String(i + 1).padStart(3, '0')}`;
          
          const question = row.row.question;
          const answer = Array.isArray(row.row.answers) ? row.row.answers[0]?.text || row.row.answers[0] : row.row.answers;
          
          return {
            fileName,
            markdown,
            question,
            groundTruth: answer,
            metadata: row.row
          };
        });
        
        // Step 2: Ingest all documents in parallel
        const ingestPromises = markdownDocs.map((doc: any) =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-markdown', {
            body: { fileName: doc.fileName, markdownContent: doc.markdown, folder: 'benchmark_narrative' }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} NarrativeQA documents in parallel`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < markdownDocs.length; i++) {
          const doc = markdownDocs[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] NarrativeQA ${i + 1} ingest failed:`, result.error);
            results.narrative.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: `${doc.fileName}.md`,
              storage_path: `benchmark_narrative/${doc.fileName}.md`,
              suite_category: 'narrative',
              question: doc.question,
              ground_truth: doc.groundTruth,
              source_repo: 'deepmind/narrativeqa',
              source_metadata: doc.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] NarrativeQA ${i + 1} Q&A insert failed:`, insertError);
            results.narrative.failed++;
          } else {
            results.narrative.success++;
            results.narrative.documents.push({ fileName: `${doc.fileName}.md`, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] NarrativeQA ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] NarrativeQA suite complete: ${results.narrative.success} success, ${results.narrative.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] NarrativeQA suite failed:', suiteError);
      }
    }

    // ===== PHASE 7: Safety Suite (Adversarial) =====
    if (suites.safety) {
      console.log('[Provision Benchmark] Processing Safety suite...');
      
      const { error: cleanupError } = await supabase
        .from('benchmark_datasets')
        .delete()
        .eq('suite_category', 'safety');
      
      if (cleanupError) {
        console.error('[Provision Benchmark] Failed to cleanup Safety suite:', cleanupError);
      } else {
        console.log('[Provision Benchmark] Cleaned up Safety suite (Q&A entries only)');
      }
      
      try {
        // Generate adversarial tests for documents from ALL suites
        const { data: allDocuments } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id, file_name')
          .or('folder.eq.benchmark_finance,folder.eq.benchmark_general,folder.eq.benchmark_charts,folder.eq.benchmark_receipts,folder.eq.benchmark_science')
          .limit(sampleSize * 2);

        if (allDocuments && allDocuments.length > 0) {
          for (const doc of allDocuments) {
            // Add 2 random adversarial questions per document
            const selectedQuestions = ADVERSARIAL_QUESTIONS
              .sort(() => Math.random() - 0.5)
              .slice(0, 2);

            for (const qa of selectedQuestions) {
              const { error: insertError } = await supabase
                .from('benchmark_datasets')
                .insert({
                  file_name: doc.file_name,
                  suite_category: 'safety',
                  question: qa.question,
                  ground_truth: qa.answer,
                  source_repo: 'generated_adversarial',
                  document_id: doc.id,
                  provisioned_at: new Date().toISOString()
                });

              if (insertError) throw insertError;
              results.safety.success++;
            }
          }

          results.safety.documents = allDocuments.map(d => ({ fileName: d.file_name, documentId: d.id }));
        }

      } catch (safetyError) {
        console.error('[Provision Benchmark] Safety suite failed:', safetyError);
        results.safety.failed++;
      }
    }

    // ===== PHASE 8: Code Suite (GitHub Repository) =====
    if (suites.code) {
      console.log('[Provision Benchmark] Processing Code suite (tiny-invariant)...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'code', 'benchmark_code');
      console.log(`[Provision Benchmark] Cleaned up Code: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        const repoUrl = 'alexreardon/tiny-invariant';
        const branch = 'auto'; // Let pipeline auto-detect default branch
        
        // Invoke pipeline-a-ingest-github to import the repository
        console.log('[Provision Benchmark] Invoking pipeline-a-ingest-github for tiny-invariant...');
        const { data: ingestResult, error: ingestError } = await supabase.functions.invoke('pipeline-a-ingest-github', {
          body: {
            repoUrl,
            branch,
            folder: 'benchmark_code'
          }
        });
        
        if (ingestError) throw new Error(`GitHub ingest failed: ${ingestError.message}`);
        console.log('[Provision Benchmark] GitHub ingest result:', ingestResult);
        
        // Wait a moment for documents to be created
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Fetch the ingested documents
        const { data: codeDocs } = await supabase
          .from('pipeline_a_documents')
          .select('id, file_name')
          .eq('folder', 'benchmark_code');
        
        if (codeDocs && codeDocs.length > 0) {
          console.log(`[Provision Benchmark] Found ${codeDocs.length} code documents`);
          
          // Map Q&A to documents by matching targetFile
          for (const qa of CODE_QA_QUESTIONS) {
            // Find the best matching document for this Q&A
            const matchingDoc = codeDocs.find(d => 
              d.file_name.toLowerCase().includes(qa.targetFile.toLowerCase().replace('src/', ''))
            ) || codeDocs[0]; // Fallback to first doc if no match
            
            const { error: insertError } = await supabase
              .from('benchmark_datasets')
              .insert({
                file_name: matchingDoc.file_name,
                suite_category: 'code',
                question: qa.question,
                ground_truth: qa.answer,
                source_repo: 'alexreardon/tiny-invariant',
                document_id: matchingDoc.id,
                provisioned_at: new Date().toISOString()
              });
            
            if (insertError) {
              console.error('[Provision Benchmark] Code Q&A insert failed:', insertError);
              results.code.failed++;
            } else {
              results.code.success++;
              console.log(`[Provision Benchmark] Code Q&A: document queued for processing - assignment will happen automatically via cron`);
            }
          }
          
          results.code.documents = codeDocs.map(d => ({ fileName: d.file_name, documentId: d.id }));
          console.log(`[Provision Benchmark] Code suite complete: ${results.code.success} Q&A pairs`);
        } else {
          console.error('[Provision Benchmark] No code documents found after ingestion');
          results.code.failed = CODE_QA_QUESTIONS.length;
        }
        
      } catch (codeError) {
        console.error('[Provision Benchmark] Code suite failed:', codeError);
        results.code.failed = CODE_QA_QUESTIONS.length;
      }
    }

    // ===== PHASE 9: Hybrid PDF Suite (ArXiv Scientific Papers) =====
    if (suites.hybrid) {
      console.log('[Provision Benchmark] Processing Hybrid PDF suite (ArXiv)...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'hybrid', 'benchmark_hybrid');
      console.log(`[Provision Benchmark] Cleaned up Hybrid: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        // Query ArXiv for cs.AI papers (has visual content like graphs/tables)
        const arxivUrl = `https://export.arxiv.org/api/query?search_query=cat:cs.CV+OR+cat:cs.AI&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${sampleSize}`;
        console.log('[Provision Benchmark] ArXiv URL constructed:', arxivUrl);
        
        console.log('[Provision Benchmark] Fetching ArXiv papers...');
        const response = await fetch(arxivUrl);
        console.log('[Provision Benchmark] ArXiv response received:', response.status, response.statusText);
        if (!response.ok) throw new Error(`Failed to fetch ArXiv: ${response.statusText}`);
        
        const xmlText = await response.text();
        console.log('[Provision Benchmark] ArXiv XML received, length:', xmlText.length);
        
        // Parse XML response to extract PDF links and metadata
        const entries = parseArXivXML(xmlText);
        console.log(`[Provision Benchmark] Parsed ${entries.length} ArXiv papers from XML`);
        
        if (entries.length === 0) {
          console.warn('[Provision Benchmark] WARNING: No ArXiv entries found. XML preview:', xmlText.substring(0, 500));
        }
        
        // Step 1: Download all PDFs in parallel
        const pdfPromises = entries.map(async (entry: any, i: number) => {
          const pdfUrl = entry.pdfUrl;
          
          console.log(`[Provision Benchmark] Downloading PDF ${i + 1}/${entries.length}: ${pdfUrl}`);
          const pdfResponse = await fetch(pdfUrl);
          if (!pdfResponse.ok) throw new Error(`Failed to download PDF ${pdfUrl}: ${pdfResponse.statusText}`);
          
          const pdfBuffer = await pdfResponse.arrayBuffer();
          const fileName = `arxiv_${String(i + 1).padStart(3, '0')}.pdf`;
          
          // Generate Q&A targeting visual elements
          const qa = generateVisualQA(entry, i);
          
          return {
            fileName,
            pdfBuffer,
            question: qa.question,
            groundTruth: qa.answer,
            metadata: entry
          };
        });
        
        const pdfs = await Promise.all(pdfPromises);
        console.log(`[Provision Benchmark] Downloaded ${pdfs.length} ArXiv PDFs`);
        
        // Step 2: Upload PDFs to storage FIRST, then ingest via storage URL (avoids memory limits)
        const ingestResults = [];
        for (let i = 0; i < pdfs.length; i++) {
          const pdf = pdfs[i];
          console.log(`[Provision Benchmark] Uploading Hybrid PDF ${i + 1}/${pdfs.length} to storage: ${pdf.fileName}`);
          
          // Upload directly to storage
          const storagePath = `benchmark_hybrid/${crypto.randomUUID()}/${pdf.fileName}`;
          const { error: uploadError } = await supabase.storage
            .from('pipeline-a-uploads')
            .upload(storagePath, pdf.pdfBuffer, {
              contentType: 'application/pdf',
              upsert: false
            });
          
          if (uploadError) {
            console.error(`[Provision Benchmark] Storage upload failed for ${pdf.fileName}:`, uploadError);
            results.hybrid.failed++;
            continue;
          }
          
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('pipeline-a-uploads')
            .getPublicUrl(storagePath);
          
          console.log(`[Provision Benchmark] Ingesting via storage URL: ${urlData.publicUrl}`);
          
          // Ingest via storage URL (no base64 in memory)
          const result = await supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
            body: {
              fileName: pdf.fileName,
              storageUrl: urlData.publicUrl,
              fileSize: pdf.pdfBuffer.byteLength,
              folder: 'benchmark_hybrid',
              source_type: 'pdf'
            }
          });
          
          ingestResults.push(result);
          console.log(`[Provision Benchmark] Hybrid PDF ${i + 1}/${pdfs.length} ingested successfully`);
        }
        
        console.log(`[Provision Benchmark] All ${ingestResults.length} Hybrid PDFs ingested sequentially`);
        
        // Step 3: Insert Q&A pairs immediately
        for (let i = 0; i < pdfs.length; i++) {
          const pdf = pdfs[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] Hybrid PDF ${i + 1} ingest failed:`, result.error);
            results.hybrid.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: pdf.fileName,
              storage_path: `benchmark_hybrid/${pdf.fileName}`,
              suite_category: 'hybrid',
              question: pdf.question,
              ground_truth: pdf.groundTruth,
              source_repo: 'arxiv.org',
              source_metadata: pdf.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] Hybrid PDF ${i + 1} Q&A insert failed:`, insertError);
            results.hybrid.failed++;
          } else {
            results.hybrid.success++;
            results.hybrid.documents.push({ fileName: pdf.fileName, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] Hybrid PDF ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] Hybrid PDF suite complete: ${results.hybrid.success} success, ${results.hybrid.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] Hybrid PDF suite EXCEPTION:', suiteError);
        console.error('[Provision Benchmark] Error details:', suiteError instanceof Error ? suiteError.message : String(suiteError));
        console.error('[Provision Benchmark] Stack trace:', suiteError instanceof Error ? suiteError.stack : 'No stack');
      }
    }

    // ===== PHASE 10: TradingView Pro Suite - BATCH PROCESSING =====
    if (suites.trading) {
      console.log('[Provision Benchmark] Processing TradingView Pro suite...');
      
      const cleanup = await cleanupExistingSuite(supabase, 'trading', 'benchmark_trading');
      console.log(`[Provision Benchmark] Cleaned up Trading: ${cleanup.documentsDeleted} docs, ${cleanup.chunksDeleted} chunks, ${cleanup.datasetsDeleted} Q&A entries`);
      
      try {
        // Step 1: Download all trading chart images
        const imagePromises = TRADING_BENCHMARK_DATA.map(async (entry, i) => {
          console.log(`[Provision Benchmark] Downloading trading image ${i + 1}/${TRADING_BENCHMARK_DATA.length}: ${entry.file_name}`);
          
          const imgResponse = await fetch(entry.image_url);
          if (!imgResponse.ok) throw new Error(`Failed to fetch ${entry.image_url}: ${imgResponse.statusText}`);
          
          const imgBuffer = await imgResponse.arrayBuffer();
          
          return {
            fileName: entry.file_name,
            imgBuffer,
            question: entry.question,
            groundTruth: entry.ground_truth,
            metadata: { source_url: entry.image_url, suite: 'trading' }
          };
        });
        
        const images = await Promise.all(imagePromises);
        console.log(`[Provision Benchmark] Downloaded ${images.length} TradingView images`);
        
        // Step 2: Ingest all images as source_type='image'
        const ingestPromises = images.map(img =>
          supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
            body: {
              fileName: img.fileName,
              fileData: arrayBufferToBase64(img.imgBuffer),
              fileSize: img.imgBuffer.byteLength,
              folder: 'benchmark_trading',
              source_type: 'image'  // CRITICAL: triggers Claude Vision analysis
            }
          })
        );
        
        const ingestResults = await Promise.all(ingestPromises);
        console.log(`[Provision Benchmark] Ingested ${ingestResults.length} trading documents`);
        
        // Step 3: Insert Q&A pairs
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const result = ingestResults[i];
          
          if (result.error || !result.data?.documentId) {
            console.error(`[Provision Benchmark] Trading ${i + 1} ingest failed:`, result.error);
            results.trading.failed++;
            continue;
          }
          
          const { error: insertError } = await supabase
            .from('benchmark_datasets')
            .insert({
              file_name: img.fileName,
              storage_path: `benchmark_trading/${img.fileName}`,
              suite_category: 'trading',
              question: img.question,
              ground_truth: img.groundTruth,
              source_repo: 'tradingview.com',
              source_metadata: img.metadata,
              document_id: result.data.documentId,
              provisioned_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`[Provision Benchmark] Trading ${i + 1} Q&A insert failed:`, insertError);
            results.trading.failed++;
          } else {
            results.trading.success++;
            results.trading.documents.push({ fileName: img.fileName, documentId: result.data.documentId });
            console.log(`[Provision Benchmark] Trading ${i + 1}: document queued for processing - assignment will happen automatically via cron`);
          }
        }
        
        console.log(`[Provision Benchmark] TradingView Pro suite complete: ${results.trading.success} success, ${results.trading.failed} failed`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] TradingView Pro suite EXCEPTION:', suiteError);
      }
    }

    // ===== PHASE 11: FinanceBench (Complex 10-K Reports) - SMART INCREMENTAL MODE =====
    if (suites.financebench) {
      console.log('[Provision Benchmark] Processing FinanceBench suite (Complex 10-K Reports) - SMART INCREMENTAL MODE...');
      console.log('[Provision Benchmark] ✓ Anti-duplicate protection enabled - existing ready documents will be reused');
      
      // NO cleanup - we reuse existing documents!
      
      try {
        // Fetch FinanceBench dataset from GitHub (two files: questions + document metadata)
        const headers: any = { 'Accept': 'application/json' };
        if (githubToken) headers['Authorization'] = `token ${githubToken}`;

        // 1. Fetch questions file
        const questionsUrl = 'https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl';
        const questionsResponse = await fetch(questionsUrl, { headers });
        if (!questionsResponse.ok) throw new Error(`Failed to fetch FinanceBench questions: ${questionsResponse.statusText}`);
        
        const questionsText = await questionsResponse.text();
        const questionsData = questionsText
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        
        // 2. Fetch document metadata file (contains doc_link!)
        const metaUrl = 'https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl';
        const metaResponse = await fetch(metaUrl, { headers });
        if (!metaResponse.ok) throw new Error(`Failed to fetch FinanceBench metadata: ${metaResponse.statusText}`);
        
        const metaText = await metaResponse.text();
        const metaData = metaText
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        
        // 3. Create lookup map by doc_name
        const docLinkMap = new Map(metaData.map(m => [m.doc_name, m]));
        
        // 4. Merge questions with document metadata
        const financebenchData = questionsData.map(q => ({
          ...q,
          ...docLinkMap.get(q.doc_name)  // Adds doc_link, company, sector, etc.
        }));
        
        console.log(`[Provision Benchmark] Fetched ${questionsData.length} questions, ${metaData.length} doc metadata entries`);
        console.log(`[Provision Benchmark] Merged: ${financebenchData.filter(d => d.doc_link).length} entries with PDF URLs`);

        // ===== GROUP QUESTIONS BY DOCUMENT =====
        // FinanceBench has N questions per document, so we group by doc_name
        const docGroups = new Map<string, typeof financebenchData>();
        for (const entry of financebenchData) {
          const docName = entry.doc_name;
          if (!docGroups.has(docName)) {
            docGroups.set(docName, []);
          }
          docGroups.get(docName)!.push(entry);
        }
        
        console.log(`[Provision Benchmark] FinanceBench: ${financebenchData.length} questions across ${docGroups.size} unique documents`);
        
        // Filter out blacklisted companies BEFORE processing
        const filteredDocs = Array.from(docGroups.entries()).filter(([docName, questions]) => {
          const company = questions[0]?.company;
          if (FINANCEBENCH_BLACKLIST_COMPANIES.includes(company)) {
            console.log(`[BLACKLIST] ⛔ Skipping ${company} - document in blacklist (encrypted PDF)`);
            return false;
          }
          return true;
        });
        
        console.log(`[Provision Benchmark] After blacklist filter: ${filteredDocs.length} documents available`);
        
        // Take first N unique documents based on sampleSize
        const uniqueDocs = filteredDocs.slice(0, sampleSize);
        
        let skippedDuplicates = 0;
        let newDownloads = 0;
        let totalQuestionsAdded = 0;
        
        // Process each unique document with all its questions
        for (let docIndex = 0; docIndex < uniqueDocs.length; docIndex++) {
          const [docName, questions] = uniqueDocs[docIndex];
          const firstEntry = questions[0];
          const fileName = `financebench_${String(docIndex + 1).padStart(3, '0')}_${firstEntry.company}.pdf`;
          
          console.log(`[Provision Benchmark] Processing FinanceBench doc ${docIndex + 1}/${uniqueDocs.length}: ${fileName} (${questions.length} questions)`);
          
          // ===== ANTI-DUPLICATE CHECK =====
          const existingDoc = await findExistingReadyDocument(supabase, fileName, 'benchmark_financebench');
          
          // If document exists and is ready/processing, skip download but add missing Q&As
          if (existingDoc.exists && existingDoc.status !== 'failed') {
            console.log(`[Anti-Duplicate] ⏭️ SKIPPING download for ${fileName} - already exists (status: ${existingDoc.status})`);
            skippedDuplicates++;
            
            // Insert ALL Q&A entries for this document (if they don't exist)
            for (const entry of questions) {
              const existingQA = await findExistingQAEntry(supabase, fileName, 'financebench', entry.question);
              
              if (!existingQA.exists && existingDoc.documentId) {
                const { error: insertError } = await supabase
                  .from('benchmark_datasets')
                  .insert({
                    file_name: fileName,
                    storage_path: `benchmark_financebench/${fileName}`,
                    suite_category: 'financebench',
                    question: entry.question,
                    ground_truth: entry.answer,
                    source_repo: 'patronus-ai/financebench',
                    source_metadata: {
                      company: entry.company,
                      year: entry.year,
                      doc_name: entry.doc_name,
                      doc_link: entry.doc_link,
                      evidence: entry.evidence,
                      question_type: entry.question_type
                    },
                    document_id: existingDoc.documentId,
                    provisioned_at: new Date().toISOString()
                  });
                
                if (insertError) {
                  console.warn(`[Anti-Duplicate] Q&A insert warning for ${fileName}:`, insertError.message);
                } else {
                  totalQuestionsAdded++;
                  console.log(`[Anti-Duplicate] ✓ Added Q&A entry for existing document ${fileName}`);
                }
              }
            }
            
            results.financebench.success++;
            results.financebench.documents.push({ fileName, documentId: existingDoc.documentId, reused: true, questionsCount: questions.length });
            continue;
          }
          
          // ===== NEW DOWNLOAD =====
          newDownloads++;
          console.log(`[Provision Benchmark] Downloading FinanceBench PDF ${newDownloads}: ${docName}`);
          
          const pdfUrl = firstEntry.doc_link;
          if (!pdfUrl) {
            console.warn(`[Provision Benchmark] No PDF URL for doc ${docName}, skipping`);
            results.financebench.failed++;
            continue;
          }
          
          try {
            const pdfResponse = await fetch(pdfUrl);
            if (!pdfResponse.ok) throw new Error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
            
            const pdfBuffer = await pdfResponse.arrayBuffer();
            
            console.log(`[Provision Benchmark] Downloaded ${fileName} (${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
            
            // Upload to storage first (avoid base64 memory explosion)
            const storagePath = `benchmark_financebench/${fileName}`;
            const { error: uploadError } = await supabase.storage
              .from('pipeline-a-uploads')
              .upload(storagePath, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true
              });
            
            if (uploadError) {
              console.error(`[Provision Benchmark] Storage upload failed for ${fileName}:`, uploadError);
              results.financebench.failed++;
              continue;
            }
            
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('pipeline-a-uploads')
              .getPublicUrl(storagePath);
            
            console.log(`[Provision Benchmark] Ingesting via storage URL: ${urlData.publicUrl}`);
            
            // Ingest via storage URL
            const result = await supabase.functions.invoke('pipeline-a-hybrid-ingest-pdf', {
              body: {
                fileName: fileName,
                storageUrl: urlData.publicUrl,
                fileSize: pdfBuffer.byteLength,
                folder: 'benchmark_financebench',
                source_type: 'pdf'
              }
            });
            
            if (result.error || !result.data?.documentId) {
              console.error(`[Provision Benchmark] FinanceBench doc ${docIndex + 1} ingest failed:`, result.error);
              results.financebench.failed++;
              continue;
            }
            
            // Insert ALL Q&A entries for this document
            for (const entry of questions) {
              const { error: insertError } = await supabase
                .from('benchmark_datasets')
                .insert({
                  file_name: fileName,
                  storage_path: `benchmark_financebench/${fileName}`,
                  suite_category: 'financebench',
                  question: entry.question,
                  ground_truth: entry.answer,
                  source_repo: 'patronus-ai/financebench',
                  source_metadata: {
                    company: entry.company,
                    year: entry.year,
                    doc_name: entry.doc_name,
                    doc_link: entry.doc_link,
                    evidence: entry.evidence,
                    question_type: entry.question_type
                  },
                  document_id: result.data.documentId,
                  provisioned_at: new Date().toISOString()
                });
              
              if (insertError) {
                console.error(`[Provision Benchmark] Q&A insert failed for ${fileName}:`, insertError);
              } else {
                totalQuestionsAdded++;
              }
            }
            
            results.financebench.success++;
            results.financebench.documents.push({ fileName, documentId: result.data.documentId, reused: false, questionsCount: questions.length });
            console.log(`[Provision Benchmark] FinanceBench doc ${docIndex + 1}: document queued with ${questions.length} questions`);
            
          } catch (pdfError) {
            console.error(`[Provision Benchmark] Failed to download PDF for doc ${docName}:`, pdfError);
            results.financebench.failed++;
          }
        }
        
        console.log(`[Provision Benchmark] FinanceBench suite complete: ${results.financebench.success} docs, ${totalQuestionsAdded} Q&A entries added`);
        console.log(`[Provision Benchmark] 📊 Anti-duplicate stats: ${skippedDuplicates} reused, ${newDownloads} new downloads`);

      } catch (suiteError) {
        console.error('[Provision Benchmark] FinanceBench suite EXCEPTION:', suiteError);
        console.error('[Provision Benchmark] Error details:', suiteError instanceof Error ? suiteError.message : String(suiteError));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `BATCH provisioning complete: ${results.general.success} general + ${results.finance.success} finance + ${results.financebench.success} financebench + ${results.charts.success} charts + ${results.receipts.success} receipts + ${results.science.success} science + ${results.narrative.success} narrative + ${results.code.success} code + ${results.safety.success} safety + ${results.hybrid.success} hybrid + ${results.trading.success} trading tests. Documents will be ready in ~30-60s.`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Provision Benchmark] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ===== HELPER: Parse ArXiv XML Response =====
function parseArXivXML(xmlText: string): any[] {
  const entries: any[] = [];
  
  // Simple regex-based XML parsing (ArXiv XML is predictable)
  const entryMatches = xmlText.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  
  for (const match of entryMatches) {
    const entryXml = match[1];
    
    // Extract ID
    const idMatch = entryXml.match(/<id>(.*?)<\/id>/);
    const id = idMatch ? idMatch[1] : '';
    
    // Extract title
    const titleMatch = entryXml.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    
    // Extract abstract
    const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
    const abstract = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '';
    
    // Extract PDF link - match href and title in any order
    const pdfLinkMatch = entryXml.match(/<link[^>]*href="([^"]+)"[^>]*title="pdf"/);
    const pdfUrl = pdfLinkMatch ? pdfLinkMatch[1] : '';
    
    if (pdfUrl) {
      entries.push({
        id,
        title,
        abstract,
        pdfUrl
      });
    }
  }
  
  return entries;
}

// ===== HELPER: Generate Visual Q&A for Hybrid PDFs =====
function generateVisualQA(entry: any, index: number): { question: string; answer: string } {
  // Generate questions targeting visual elements in scientific papers
  const visualQuestions = [
    {
      question: "What is the main trend or pattern shown in the first figure or chart?",
      answer: "Based on visual analysis in the document" // Generic answer - will be graded by LLM Judge
    },
    {
      question: "What are the key numerical results presented in the tables?",
      answer: "Based on tabular data in the document"
    },
    {
      question: "What methodology diagram or architecture is presented?",
      answer: "Based on visual diagrams in the document"
    },
    {
      question: "What comparison is shown in the visual elements?",
      answer: "Based on comparative charts/graphs in the document"
    },
    {
      question: "What performance metrics are visualized?",
      answer: "Based on performance visualization in the document"
    }
  ];
  
  // Select question based on paper index (cycle through questions)
  const selectedQ = visualQuestions[index % visualQuestions.length];
  
  return {
    question: `${selectedQ.question}`,
    answer: selectedQ.answer
  };
}

// ===== HELPER: Cleanup legacy DocVQA documents =====
async function cleanupLegacyDocVQA(supabase: any) {
  console.log('[Provision Benchmark] Cleaning up legacy DocVQA documents (doc_00XX.pdf)...');
  
  try {
    const { data: legacyDocs } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id')
      .like('file_name', 'doc_00%.pdf');
    
    if (legacyDocs && legacyDocs.length > 0) {
      const docIds = legacyDocs.map((d: any) => d.id);
      console.log(`[Provision Benchmark] Found ${docIds.length} legacy DocVQA documents to cleanup`);
      
      const { data: chunks } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id')
        .in('document_id', docIds);
      
      if (chunks && chunks.length > 0) {
        const chunkIds = chunks.map((c: any) => c.id);
        
        await supabase
          .from('pipeline_a_hybrid_agent_knowledge')
          .delete()
          .in('chunk_id', chunkIds);
        
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .delete()
          .in('id', chunkIds);
        
        console.log(`[Provision Benchmark] Deleted ${chunkIds.length} legacy chunks`);
      }
      
      await supabase
        .from('pipeline_a_hybrid_documents')
        .delete()
        .in('id', docIds);
      
      console.log(`[Provision Benchmark] Deleted ${docIds.length} legacy DocVQA documents`);
    } else {
      console.log('[Provision Benchmark] No legacy DocVQA documents found');
    }
  } catch (error) {
    console.error('[Provision Benchmark] Failed to cleanup legacy DocVQA:', error);
  }
}

// ===== HELPER: Convert FinQA JSON to Markdown =====
function convertFinQAToMarkdown(entry: any, index: number): string {
  const { pre_text, post_text, table, qa } = entry;
  
  let markdown = `# Financial Report: finqa_${String(index + 1).padStart(3, '0')}\n\n`;
  
  if (pre_text && pre_text.length > 0) {
    markdown += pre_text.join(' ') + '\n\n';
  }
  
  if (table && table.length > 0) {
    const headers = table[0];
    markdown += '| ' + headers.join(' | ') + ' |\n';
    markdown += '|' + headers.map(() => '---').join('|') + '|\n';
    
    for (let i = 1; i < table.length; i++) {
      markdown += '| ' + table[i].join(' | ') + ' |\n';
    }
    markdown += '\n';
  }
  
  if (post_text && post_text.length > 0) {
    markdown += post_text.join(' ') + '\n\n';
  }
  
  markdown += `<!-- Question: ${qa.question} -->\n`;
  markdown += `<!-- Expected Answer: ${qa.exe_ans || qa.program_re} -->\n`;
  
  return markdown;
}

// ===== HELPER: Generate Q&A for CORD receipt =====
function generateCORDQuestion(gt: any): { question: string; answer: string } {
  const gtParse = gt.gt_parse;
  
  if (gtParse?.total?.total_price) {
    return { 
      question: "What is the total amount on this receipt?", 
      answer: gtParse.total.total_price 
    };
  }
  if (gtParse?.store?.name) {
    return { 
      question: "What is the store name?", 
      answer: gtParse.store.name 
    };
  }
  if (gtParse?.date?.date) {
    return { 
      question: "What is the date on this receipt?", 
      answer: gtParse.date.date 
    };
  }
  
  return { 
    question: "What information can you extract from this receipt?", 
    answer: JSON.stringify(gtParse).substring(0, 200) 
  };
}

// ===== HELPER: Convert QASPER paper to Markdown =====
function convertQASPERToMarkdown(paper: any): string {
  let md = `# ${paper.title || 'Scientific Paper'}\n\n`;
  
  if (paper.abstract) {
    md += `## Abstract\n${paper.abstract}\n\n`;
  }
  
  // QASPER full_text can have different structures:
  // Option A: { section_name: [...], paragraphs: [...] } as parallel arrays
  // Option B: [{ section_name: '...', paragraphs: [...] }, ...] as array of objects
  const fullText = paper.full_text;
  
  if (fullText) {
    // Check if it's parallel arrays structure (section_name and paragraphs are arrays)
    if (Array.isArray(fullText.section_name) && Array.isArray(fullText.paragraphs)) {
      // Parallel arrays: section_name[i] corresponds to paragraphs[i]
      for (let i = 0; i < fullText.section_name.length; i++) {
        const sectionName = fullText.section_name[i] || 'Section';
        md += `## ${sectionName}\n`;
        
        const paras = fullText.paragraphs[i];
        if (Array.isArray(paras)) {
          for (const para of paras) {
            md += `${para}\n\n`;
          }
        } else if (typeof paras === 'string') {
          md += `${paras}\n\n`;
        }
      }
    } 
    // Check if it's an array of section objects
    else if (Array.isArray(fullText)) {
      for (const section of fullText) {
        md += `## ${section.section_name || 'Section'}\n`;
        const paras = section.paragraphs;
        if (Array.isArray(paras)) {
          for (const para of paras) {
            md += `${para}\n\n`;
          }
        } else if (typeof paras === 'string') {
          md += `${paras}\n\n`;
        }
      }
    }
    // Fallback: just stringify whatever we got
    else if (typeof fullText === 'object') {
      md += `## Content\n${JSON.stringify(fullText, null, 2)}\n\n`;
    }
  }
  
  return md;
}

// ===== HELPER: Extract answer from QASPER answers array =====
function extractQASPERAnswer(answers: any[]): string {
  for (const answerObj of answers || []) {
    // API returns { answer: { free_form_answer, ... } } structure
    const ans = answerObj.answer || answerObj;
    if (ans.free_form_answer) return ans.free_form_answer;
    if (ans.extractive_spans?.length) return ans.extractive_spans.join(', ');
    if (typeof ans.yes_no === 'boolean') return ans.yes_no ? 'Yes' : 'No';
    if (ans.unanswerable === true) return "Unanswerable";
  }
  return "Unanswerable";
}

// ===== HELPER: Convert NarrativeQA to Markdown =====
function convertNarrativeQAToMarkdown(entry: any, index: number): string {
  const title = entry.document?.title || entry.title || `Story ${index + 1}`;
  
  // FIX: Use full story text (document.text), NOT summary (which is ~50 words vs. full story ~2000+ words)
  const storyText = entry.document?.text || entry.document_plaintext || '';
  const summary = entry.document?.summary || entry.summary || '';
  
  let markdown = `# ${title}\n\n`;
  
  // Include summary for context if available
  if (summary) {
    markdown += `## Summary\n\n${summary}\n\n`;
  }
  
  // Include full story text for deep understanding
  markdown += `## Full Story\n\n${storyText}\n\n`;
  markdown += `<!-- Question: ${entry.question} -->\n`;
  
  return markdown;
}

// ===== HELPER: Check if document already exists and is ready (ANTI-DUPLICATE) =====
async function findExistingReadyDocument(
  supabase: any,
  fileName: string,
  folderName: string
): Promise<{ exists: boolean; documentId: string | null; status: string | null }> {
  const { data: existingDoc, error } = await supabase
    .from('pipeline_a_hybrid_documents')
    .select('id, status')
    .eq('file_name', fileName)
    .eq('folder', folderName)
    .maybeSingle();
  
  if (error) {
    console.warn(`[Anti-Duplicate] Error checking for existing document ${fileName}:`, error.message);
    return { exists: false, documentId: null, status: null };
  }
  
  if (existingDoc) {
    console.log(`[Anti-Duplicate] ✓ Found existing document: ${fileName} (status: ${existingDoc.status})`);
    return { exists: true, documentId: existingDoc.id, status: existingDoc.status };
  }
  
  return { exists: false, documentId: null, status: null };
}

// ===== HELPER: Check if Q&A entry already exists =====
async function findExistingQAEntry(
  supabase: any,
  fileName: string,
  suiteCategory: string,
  question?: string  // Optional: check for specific question (for multi-question per doc)
): Promise<{ exists: boolean; entryId: string | null }> {
  let query = supabase
    .from('benchmark_datasets')
    .select('id')
    .eq('file_name', fileName)
    .eq('suite_category', suiteCategory);
  
  // If question provided, check for exact question match (multi-question per doc scenario)
  if (question) {
    query = query.eq('question', question);
  }
  
  const { data: existingEntry, error } = await query.maybeSingle();
  
  if (error) {
    console.warn(`[Anti-Duplicate] Error checking for existing Q&A entry:`, error.message);
    return { exists: false, entryId: null };
  }
  
  if (existingEntry) {
    console.log(`[Anti-Duplicate] ✓ Q&A entry already exists for ${fileName} in ${suiteCategory}${question ? ' (specific question)' : ''}`);
    return { exists: true, entryId: existingEntry.id };
  }
  
  return { exists: false, entryId: null };
}

// ===== HELPER: Cleanup existing suite before re-provisioning =====
async function cleanupExistingSuite(
  supabase: any,
  suiteCategory: 'general' | 'finance' | 'financebench' | 'charts' | 'receipts' | 'science' | 'narrative' | 'safety' | 'code' | 'hybrid' | 'trading',
  folderName: string
): Promise<{ documentsDeleted: number; chunksDeleted: number; datasetsDeleted: number }> {
  console.log(`[Provision Benchmark] Cleaning up existing ${suiteCategory} suite from folder ${folderName}...`);
  
  try {
    const { data: existingDocs, error: docsError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id')
      .eq('folder', folderName);
    
    if (docsError) {
      console.error('[Provision Benchmark] Error fetching existing documents:', docsError);
      return { documentsDeleted: 0, chunksDeleted: 0, datasetsDeleted: 0 };
    }
    
    const docIds = existingDocs?.map((d: any) => d.id) || [];
    console.log(`[Provision Benchmark] Found ${docIds.length} existing documents to cleanup`);
    
    let chunksDeletedCount = 0;
    
    if (docIds.length > 0) {
      const { data: chunks, error: chunksQueryError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id')
        .in('document_id', docIds);
      
      if (chunksQueryError) {
        console.error('[Provision Benchmark] Error fetching chunks:', chunksQueryError);
      } else {
        const chunkIds = chunks?.map((c: any) => c.id) || [];
        console.log(`[Provision Benchmark] Found ${chunkIds.length} chunks to cleanup`);
        
        if (chunkIds.length > 0) {
          const { error: knowledgeError } = await supabase
            .from('pipeline_a_hybrid_agent_knowledge')
            .delete()
            .in('chunk_id', chunkIds);
          
          if (knowledgeError) {
            console.error('[Provision Benchmark] Error deleting agent knowledge:', knowledgeError);
          } else {
            console.log('[Provision Benchmark] Deleted agent knowledge assignments');
          }
          
          const { error: chunksError } = await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .delete()
            .in('id', chunkIds);
          
          if (chunksError) {
            console.error('[Provision Benchmark] Error deleting chunks:', chunksError);
          } else {
            chunksDeletedCount = chunkIds.length;
            console.log(`[Provision Benchmark] Deleted ${chunksDeletedCount} chunks`);
          }
        }
      }
      
      const { error: documentsError } = await supabase
        .from('pipeline_a_hybrid_documents')
        .delete()
        .in('id', docIds);
      
      if (documentsError) {
        console.error('[Provision Benchmark] Error deleting documents:', documentsError);
      } else {
        console.log(`[Provision Benchmark] Deleted ${docIds.length} documents`);
      }
    }
    
    const { error: datasetsError, count } = await supabase
      .from('benchmark_datasets')
      .delete()
      .eq('suite_category', suiteCategory)
      .select('id', { count: 'exact', head: true });
    
    const datasetsDeleted = count || 0;
    
    if (datasetsError) {
      console.error('[Provision Benchmark] Error deleting benchmark datasets:', datasetsError);
    } else {
      console.log(`[Provision Benchmark] Deleted ${datasetsDeleted} Q&A entries from benchmark_datasets`);
    }
    
    return {
      documentsDeleted: docIds.length,
      chunksDeleted: chunksDeletedCount,
      datasetsDeleted
    };
    
  } catch (error) {
    console.error('[Provision Benchmark] Cleanup failed:', error);
    return { documentsDeleted: 0, chunksDeleted: 0, datasetsDeleted: 0 };
  }
}
