/**
 * LlamaParse API Client
 * 
 * Handles interaction with LlamaParse for advanced PDF to Markdown conversion
 * with multimodal support (automatic graph/chart descriptions via GPT-4o/Gemini)
 */

const LLAMAPARSE_API_BASE = 'https://api.cloud.llamaindex.ai/api/parsing';

export interface LlamaParseUploadResponse {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'ERROR';
}

export interface LlamaParseJobStatus {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'ERROR';
  result?: {
    markdown: string;
    images?: string[];
  };
  error?: string;
}

export interface LlamaParseResult {
  jobId: string;
  markdown: string;
  status: 'SUCCESS';
}

/**
 * Upload PDF to LlamaParse for processing
 * @param pdfBuffer - PDF file as Uint8Array
 * @param fileName - Original file name
 * @param apiKey - LlamaParse API key
 * @returns Job ID for status polling
 */
export async function uploadToLlamaParse(
  pdfBuffer: Uint8Array,
  fileName: string,
  apiKey: string
): Promise<string> {
  console.log(`[LlamaParse] Uploading ${fileName} (${pdfBuffer.length} bytes)`);

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
  formData.append('file', blob, fileName);
  
  // CRITICAL: Enable multimodal mode for graph/chart descriptions
  formData.append('vendor_multimodal_mode', 'true');
  formData.append('result_type', 'markdown');
  formData.append('language', 'it');

  const response = await fetch(`${LLAMAPARSE_API_BASE}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LlamaParse upload failed (${response.status}): ${errorText}`);
  }

  const data: LlamaParseUploadResponse = await response.json();
  console.log(`[LlamaParse] Upload successful, job_id: ${data.id}`);
  
  return data.id;
}

/**
 * Poll LlamaParse job status until completion
 * @param jobId - Job ID from upload
 * @param apiKey - LlamaParse API key
 * @param maxAttempts - Maximum polling attempts (default: 60)
 * @param pollInterval - Interval between polls in ms (default: 5000)
 * @returns Job status when completed
 */
export async function pollJobUntilComplete(
  jobId: string,
  apiKey: string,
  maxAttempts: number = 60,
  pollInterval: number = 5000
): Promise<LlamaParseJobStatus> {
  console.log(`[LlamaParse] Polling job ${jobId}...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LlamaParse poll failed (${response.status}): ${errorText}`);
    }

    const status: LlamaParseJobStatus = await response.json();
    
    if (status.status === 'SUCCESS') {
      console.log(`[LlamaParse] Job ${jobId} completed successfully`);
      return status;
    }

    if (status.status === 'ERROR') {
      throw new Error(`LlamaParse job failed: ${status.error || 'Unknown error'}`);
    }

    // Still pending, wait and retry
    console.log(`[LlamaParse] Job ${jobId} still pending (attempt ${attempt + 1}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`LlamaParse job ${jobId} timed out after ${maxAttempts} attempts`);
}

/**
 * Get Markdown result from completed job
 * @param jobId - Job ID
 * @param apiKey - LlamaParse API key
 * @returns Parsed Markdown content
 */
export async function getMarkdownResult(
  jobId: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}/result/markdown`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LlamaParse result fetch failed (${response.status}): ${errorText}`);
  }

  // LlamaParse returns JSON: { "markdown": "..." }
  const data = await response.json();
  const markdown = typeof data === 'string' ? data : (data.markdown || JSON.stringify(data));
  
  console.log(`[LlamaParse] Retrieved ${markdown.length} characters of Markdown`);
  
  return markdown;
}

/**
 * Complete PDF to Markdown extraction workflow
 * @param pdfBuffer - PDF file as Uint8Array
 * @param fileName - Original file name
 * @param apiKey - LlamaParse API key
 * @returns Markdown content and job ID
 */
export async function extractMarkdownFromPDF(
  pdfBuffer: Uint8Array,
  fileName: string,
  apiKey: string
): Promise<LlamaParseResult> {
  // Step 1: Upload PDF
  const jobId = await uploadToLlamaParse(pdfBuffer, fileName, apiKey);
  
  // Step 2: Poll until complete
  const jobStatus = await pollJobUntilComplete(jobId, apiKey);
  
  // Step 3: Extract Markdown
  let markdown: string;
  if (jobStatus.result?.markdown) {
    markdown = jobStatus.result.markdown;
  } else {
    markdown = await getMarkdownResult(jobId, apiKey);
  }

  return {
    jobId,
    markdown,
    status: 'SUCCESS',
  };
}
