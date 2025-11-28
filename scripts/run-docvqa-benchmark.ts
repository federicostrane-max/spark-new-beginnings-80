#!/usr/bin/env node
/**
 * DocVQA Benchmark Suite for Pipeline A-Hybrid
 * 
 * Automated evaluation script that:
 * 1. Ingests DocVQA PDFs through Pipeline A-Hybrid
 * 2. Queries the agent with test questions
 * 3. Uses LLM-as-a-Judge to evaluate responses
 * 4. Generates accuracy report
 * 
 * Usage: npx tsx scripts/run-docvqa-benchmark.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration
const AGENT_ID = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c'; // Pipeline C Tester
const BENCHMARK_USER_ID = 'benchmark-runner';
const INGESTION_TIMEOUT_MS = 180000; // 3 minutes
const POLL_INTERVAL_MS = 5000; // 5 seconds
const PDF_DIR = path.join(process.cwd(), 'tests/docvqa/pdfs');
const DATASET_PATH = path.join(process.cwd(), 'public/data/docvqa-annotations.json');
const OUTPUT_DIR = path.join(process.cwd(), 'tests/docvqa');

// Types
interface DatasetEntry {
  questionId: number;
  question: string;
  answers: string[];
  image: string;
}

interface IngestResult {
  success: boolean;
  documentId?: string;
  ingestionTimeMs?: number;
  alreadyReady?: boolean;
  error?: string;
}

interface JudgeResult {
  correct: boolean;
  reason: string;
}

interface BenchmarkResult {
  docId: string;
  questionId: number;
  question: string;
  groundTruths: string[];
  agentResponse: string;
  correct: boolean;
  judgeReason: string;
  ingestionTimeMs: number;
  queryTimeMs: number;
}

// Utility functions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function cleanJsonString(str: string): string {
  // Remove markdown code blocks (```json ... ```)
  let cleaned = str.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  return cleaned;
}

function getFileName(imagePath: string): string {
  return path.basename(imagePath).replace(/\.(png|jpg|jpeg)$/i, '.pdf');
}

// Phase 1: Ingestion
async function ingestDocument(fileName: string, pdfPath: string): Promise<IngestResult> {
  console.log(`  📄 Processing ${fileName}...`);
  
  try {
    // 1. Check if document already exists and is ready
    const { data: existing } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, status')
      .eq('file_name', fileName)
      .maybeSingle();

    let documentId: string;

    if (existing) {
      documentId = existing.id;
      if (existing.status === 'ready') {
        console.log(`     ✓ Already ready (cached)`);
        return { success: true, documentId, alreadyReady: true, ingestionTimeMs: 0 };
      }
      console.log(`     ⏳ Existing document found, waiting for processing...`);
    } else {
      // 2. Upload new document
      console.log(`     ⏳ Uploading...`);
      const fileBuffer = fs.readFileSync(pdfPath);
      const base64Data = fileBuffer.toString('base64');
      const fileSize = fileBuffer.length;

      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke(
        'pipeline-a-hybrid-ingest-pdf',
        {
          body: { 
            fileName, 
            fileData: base64Data, 
            fileSize,
            folder: 'DocVQA-Benchmark' 
          }
        }
      );

      if (uploadError || !uploadResult?.documentId) {
        return { 
          success: false, 
          error: `Upload failed: ${uploadError?.message || 'No document ID returned'}` 
        };
      }

      documentId = uploadResult.documentId;
      console.log(`     ✓ Uploaded (ID: ${documentId.substring(0, 8)}...)`);
    }

    // 3. Poll until ready (timeout: 3 minutes)
    const startTime = Date.now();
    let lastStatus = '';

    while (Date.now() - startTime < INGESTION_TIMEOUT_MS) {
      const { data: doc } = await supabase
        .from('pipeline_a_hybrid_documents')
        .select('status')
        .eq('id', documentId)
        .single();

      if (!doc) {
        return { success: false, error: 'Document not found during polling', documentId };
      }

      if (doc.status !== lastStatus) {
        console.log(`     ⏳ Status: ${doc.status}...`);
        lastStatus = doc.status;
      }

      if (doc.status === 'ready') {
        const ingestionTimeMs = Date.now() - startTime;
        console.log(`     ✅ Ready (${(ingestionTimeMs / 1000).toFixed(1)}s)`);
        return { success: true, documentId, ingestionTimeMs };
      }

      if (doc.status === 'failed') {
        return { success: false, error: 'Processing failed', documentId };
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return { 
      success: false, 
      error: `Timeout waiting for processing (last status: ${lastStatus})`, 
      documentId 
    };

  } catch (error: any) {
    return { 
      success: false, 
      error: `Exception during ingestion: ${error.message}` 
    };
  }
}

// Phase 2: Agent Assignment + Query
async function assignAndQuery(
  documentId: string, 
  agentId: string, 
  question: string
): Promise<{ response: string; timeMs: number }> {
  const startTime = Date.now();

  try {
    // 1. Assign document to agent (idempotent - no error if already assigned)
    const { error: assignError } = await supabase.functions.invoke(
      'assign-document-to-agent',
      {
        body: { 
          documentId, 
          agentId, 
          pipeline: 'a-hybrid' 
        }
      }
    );

    // Ignore "already assigned" errors - this is idempotent behavior
    if (assignError && !assignError.message?.includes('already')) {
      console.warn(`     ⚠️  Assignment warning: ${assignError.message}`);
    }

    // 2. Get or create conversation
    const { data: conversationId, error: convError } = await supabase.rpc(
      'get_or_create_conversation',
      {
        p_user_id: BENCHMARK_USER_ID,
        p_agent_id: agentId
      }
    );

    if (convError || !conversationId) {
      throw new Error(`Conversation creation failed: ${convError?.message}`);
    }

    // 3. Send question to agent
    const { data: chatResponse, error: chatError } = await supabase.functions.invoke(
      'agent-chat',
      {
        body: {
          agentId,
          conversationId,
          message: question,
          messages: []
        }
      }
    );

    if (chatError) {
      throw new Error(`Agent chat failed: ${chatError.message}`);
    }

    const response = chatResponse?.response || '';
    const timeMs = Date.now() - startTime;

    return { response, timeMs };

  } catch (error: any) {
    return { 
      response: `ERROR: ${error.message}`, 
      timeMs: Date.now() - startTime 
    };
  }
}

// Phase 3: LLM-as-a-Judge Evaluation
async function evaluateAnswer(
  question: string,
  agentResponse: string,
  groundTruths: string[]
): Promise<JudgeResult> {
  try {
    const prompt = `You are an impartial judge evaluating QA accuracy.

Question: ${question}
Ground Truth(s): ${groundTruths.join(' OR ')}
Candidate Answer: ${agentResponse}

Is the candidate's answer FACTUALLY CORRECT with respect to the Ground Truth?
Ignore style, formatting, and verbosity. Focus ONLY on the factual content.
A response that contains the correct information IS correct, even if it adds context.

Respond ONLY with valid JSON:
{"correct": boolean, "reason": "brief explanation"}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`LLM Judge API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from LLM Judge');
    }

    // Robust JSON parsing with markdown cleanup
    const cleanedContent = cleanJsonString(content);
    const result: JudgeResult = JSON.parse(cleanedContent);

    return result;

  } catch (error: any) {
    console.error(`     ⚠️  Judge evaluation error: ${error.message}`);
    
    // Fallback: simple string matching
    const agentLower = agentResponse.toLowerCase();
    const foundTruth = groundTruths.some(truth => 
      agentLower.includes(truth.toLowerCase())
    );

    return {
      correct: foundTruth,
      reason: `Fallback string matching (judge failed: ${error.message})`
    };
  }
}

// Report Generation
function generateReport(results: BenchmarkResult[]): void {
  const totalTests = results.length;
  const passed = results.filter(r => r.correct).length;
  const accuracy = ((passed / totalTests) * 100).toFixed(2);

  const avgIngestionTime = (
    results.reduce((sum, r) => sum + r.ingestionTimeMs, 0) / totalTests / 1000
  ).toFixed(1);

  const avgQueryTime = (
    results.reduce((sum, r) => sum + r.queryTimeMs, 0) / totalTests / 1000
  ).toFixed(1);

  // Markdown Report
  let markdown = `# DocVQA Benchmark Report - Pipeline A-Hybrid\n\n`;
  markdown += `**Date**: ${new Date().toISOString()}\n`;
  markdown += `**Agent**: Pipeline C Tester (${AGENT_ID})\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- **Total Tests**: ${totalTests}\n`;
  markdown += `- **Passed**: ✅ ${passed}\n`;
  markdown += `- **Failed**: ❌ ${totalTests - passed}\n`;
  markdown += `- **Accuracy**: **${accuracy}%**\n`;
  markdown += `- **Avg Ingestion Time**: ${avgIngestionTime}s\n`;
  markdown += `- **Avg Query Time**: ${avgQueryTime}s\n\n`;

  markdown += `## Detailed Results\n\n`;
  markdown += `| Doc ID | Question | Ground Truth | Agent Response | Result | Judge Reason | Ingestion | Query |\n`;
  markdown += `|--------|----------|--------------|----------------|--------|--------------|-----------|-------|\n`;

  for (const r of results) {
    const status = r.correct ? '✅ PASS' : '❌ FAIL';
    const questionShort = r.question.length > 40 
      ? r.question.substring(0, 37) + '...' 
      : r.question;
    const responseShort = r.agentResponse.length > 60 
      ? r.agentResponse.substring(0, 57) + '...' 
      : r.agentResponse;
    const truthShort = r.groundTruths[0].length > 20 
      ? r.groundTruths[0].substring(0, 17) + '...' 
      : r.groundTruths[0];
    const reasonShort = r.judgeReason.length > 30 
      ? r.judgeReason.substring(0, 27) + '...' 
      : r.judgeReason;

    markdown += `| ${r.docId} | ${questionShort} | ${truthShort} | ${responseShort} | ${status} | ${reasonShort} | ${(r.ingestionTimeMs / 1000).toFixed(1)}s | ${(r.queryTimeMs / 1000).toFixed(1)}s |\n`;
  }

  markdown += `\n## Analysis\n\n`;
  
  const failedTests = results.filter(r => !r.correct);
  if (failedTests.length > 0) {
    markdown += `### Failed Tests\n\n`;
    failedTests.forEach(f => {
      markdown += `#### ${f.docId} - Q${f.questionId}\n`;
      markdown += `- **Question**: ${f.question}\n`;
      markdown += `- **Expected**: ${f.groundTruths.join(' OR ')}\n`;
      markdown += `- **Got**: ${f.agentResponse}\n`;
      markdown += `- **Reason**: ${f.judgeReason}\n\n`;
    });
  }

  // Write files
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), markdown);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'report.json'), 
    JSON.stringify(results, null, 2)
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 FINAL ACCURACY: ${accuracy}% (${passed}/${totalTests})`);
  console.log(`⏱️  Avg Ingestion: ${avgIngestionTime}s | Avg Query: ${avgQueryTime}s`);
  console.log(`📊 Reports saved to ${OUTPUT_DIR}/`);
  console.log(`${'='.repeat(60)}\n`);
}

// Main execution
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 DocVQA Benchmark Suite - Pipeline A-Hybrid`);
  console.log(`${'='.repeat(60)}\n`);

  // Load dataset
  console.log(`📚 Loading dataset from ${DATASET_PATH}...`);
  const rawDataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  
  // Convert dataset format
  const dataset: { file: string; questionId: number; question: string; groundTruths: string[] }[] = 
    rawDataset.data.map((entry: DatasetEntry) => ({
      file: getFileName(entry.image),
      questionId: entry.questionId,
      question: entry.question,
      groundTruths: entry.answers
    }));

  console.log(`   ✓ Loaded ${dataset.length} test cases\n`);

  // Check PDF directory
  if (!fs.existsSync(PDF_DIR)) {
    console.error(`❌ ERROR: PDF directory not found: ${PDF_DIR}`);
    console.error(`   Please create the directory and add DocVQA PDF files.`);
    process.exit(1);
  }

  const results: BenchmarkResult[] = [];

  // Process each test case
  for (let i = 0; i < dataset.length; i++) {
    const test = dataset[i];
    const pdfPath = path.join(PDF_DIR, test.file);

    console.log(`\n[${i + 1}/${dataset.length}] ${test.file}`);
    console.log(`   Q: ${test.question}`);
    console.log(`   Expected: ${test.groundTruths.join(' OR ')}`);

    // Check if PDF exists
    if (!fs.existsSync(pdfPath)) {
      console.error(`     ❌ PDF not found: ${pdfPath}`);
      results.push({
        docId: test.file,
        questionId: test.questionId,
        question: test.question,
        groundTruths: test.groundTruths,
        agentResponse: 'ERROR: PDF file not found',
        correct: false,
        judgeReason: 'PDF file missing',
        ingestionTimeMs: 0,
        queryTimeMs: 0
      });
      continue;
    }

    // Phase 1: Ingest
    const ingestResult = await ingestDocument(test.file, pdfPath);
    
    if (!ingestResult.success || !ingestResult.documentId) {
      console.error(`     ❌ Ingestion failed: ${ingestResult.error}`);
      results.push({
        docId: test.file,
        questionId: test.questionId,
        question: test.question,
        groundTruths: test.groundTruths,
        agentResponse: `ERROR: ${ingestResult.error}`,
        correct: false,
        judgeReason: 'Ingestion failed',
        ingestionTimeMs: ingestResult.ingestionTimeMs || 0,
        queryTimeMs: 0
      });
      continue;
    }

    // Phase 2: Query
    console.log(`     🤖 Querying agent...`);
    const { response: agentResponse, timeMs: queryTimeMs } = await assignAndQuery(
      ingestResult.documentId,
      AGENT_ID,
      test.question
    );

    console.log(`     💬 Response: ${agentResponse.substring(0, 80)}...`);

    // Phase 3: Judge
    console.log(`     ⚖️  Evaluating...`);
    const judgeResult = await evaluateAnswer(
      test.question,
      agentResponse,
      test.groundTruths
    );

    const statusIcon = judgeResult.correct ? '✅' : '❌';
    console.log(`     ${statusIcon} ${judgeResult.correct ? 'PASS' : 'FAIL'}: ${judgeResult.reason}`);

    results.push({
      docId: test.file,
      questionId: test.questionId,
      question: test.question,
      groundTruths: test.groundTruths,
      agentResponse,
      correct: judgeResult.correct,
      judgeReason: judgeResult.reason,
      ingestionTimeMs: ingestResult.ingestionTimeMs || 0,
      queryTimeMs
    });
  }

  // Generate final report
  generateReport(results);
}

// Run
main().catch(error => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});
