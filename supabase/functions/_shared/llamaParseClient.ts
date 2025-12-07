/**
 * LlamaParse API Client
 * 
 * Handles interaction with LlamaParse for advanced PDF to Markdown conversion
 * with multimodal support (automatic graph/chart descriptions via GPT-4o/Gemini)
 */

const LLAMAPARSE_API_BASE = 'https://api.cloud.llamaindex.ai/api/parsing';

/**
 * Retry with exponential backoff for API calls
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = 'API call'
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[${context}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}

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

export interface LlamaParseJsonResult {
  jobId: string;
  rawJson: any;
  status: 'SUCCESS';
}

export interface LlamaParseLayoutElement {
  type: string;
  content?: string;
  bbox?: any;
  page?: number;
  reading_order?: number;
  [key: string]: any; // For undiscovered fields
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

  return retryWithBackoff(async () => {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
    formData.append('file', blob, fileName);
    
    // CRITICAL: Enable multimodal mode for graph/chart descriptions
    formData.append('vendor_multimodal_mode', 'true');
    formData.append('vendor_multimodal_model_name', 'anthropic-sonnet-3.5');
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
  }, 3, 1000, 'LlamaParse upload');
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
  maxAttempts: number = 120, // AUMENTATO: 120 attempts × 2s = 4 minuti (era 60 = 2min)
  pollInterval: number = 2000
): Promise<LlamaParseJobStatus> {
  console.log(`[LlamaParse] Polling job ${jobId} (max ${maxAttempts} attempts, ${(maxAttempts * pollInterval / 1000).toFixed(0)}s timeout)...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Retry with backoff ONLY for network/5xx errors, NOT for PENDING status
    const status = await retryWithBackoff(async () => {
      const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`); // Trigger retry
      }

      return response.json() as Promise<LlamaParseJobStatus>;
    }, 3, 500, 'LlamaParse poll');
    
    if (status.status === 'SUCCESS') {
      console.log(`[LlamaParse] Job ${jobId} completed successfully`);
      return status;
    }

    if (status.status === 'ERROR') {
      throw new Error(`LlamaParse job failed: ${status.error || 'Unknown error'}`);
    }

    // PENDING: polling costante, NON backoff esponenziale
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
  return retryWithBackoff(async () => {
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
  }, 3, 1000, 'LlamaParse getMarkdown');
}

/**
 * Upload PDF to LlamaParse for JSON + Layout extraction
 * @param pdfBuffer - PDF file as Uint8Array
 * @param fileName - Original file name
 * @param apiKey - LlamaParse API key
 * @param forcePremium - Force multimodal OCR mode for scanned PDFs
 * @param vendorApiKey - Optional vendor API key (Anthropic) for OCR
 * @returns Job ID for status polling
 */
export async function uploadToLlamaParseJson(
  pdfBuffer: Uint8Array,
  fileName: string,
  apiKey: string,
  forcePremium: boolean = false,
  vendorApiKey?: string
): Promise<string> {
  console.log(`[LlamaParse] Uploading ${fileName} for JSON extraction (forcePremium: ${forcePremium}) (${pdfBuffer.length} bytes)`);

  return retryWithBackoff(async () => {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
    formData.append('file', blob, fileName);
    
    // Enable JSON output with layout extraction
    formData.append('result_type', 'json');
    formData.append('extract_layout', 'true');
    formData.append('extract_images', 'true');
    formData.append('language', 'en');
    
    if (forcePremium && vendorApiKey) {
      // LVM MODE: parse_mode + model + vendor key (GitHub Issue #685)
      // CRITICAL: Use "model" parameter (NOT vendor_multimodal_model_name) with parse_page_with_lvm
      console.log(`[LlamaParse] Using LVM mode with vendor API key (parse_page_with_lvm + model)`);
      formData.append('parse_mode', 'parse_page_with_lvm');
      formData.append('model', 'anthropic-sonnet-3.5');
      formData.append('vendor_multimodal_api_key', vendorApiKey);
    } else if (forcePremium) {
      // PREMIUM MODE without vendor key (auto_mode with all triggers)
      console.log(`[LlamaParse] Using PREMIUM mode (auto_mode with ALL triggers)`);
      formData.append('auto_mode', 'true');
      formData.append('auto_mode_trigger_on_table_in_page', 'true');
      formData.append('auto_mode_trigger_on_image_in_page', 'true');
    } else {
      // BASIC MODE: auto_mode with BOTH triggers (tables + images)
      // CRITICAL: Tables on cover pages are NOT images - need explicit table trigger!
      console.log(`[LlamaParse] Using BASIC mode (auto_mode with table + image triggers)`);
      formData.append('auto_mode', 'true');
      formData.append('auto_mode_trigger_on_table_in_page', 'true');
      formData.append('auto_mode_trigger_on_image_in_page', 'true');
    }

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
  }, 3, 1000, 'LlamaParse JSON upload');
}

/**
 * Get JSON result from completed job
 * @param jobId - Job ID
 * @param apiKey - LlamaParse API key
 * @returns Parsed JSON content with layout
 */
export async function getJsonResult(
  jobId: string,
  apiKey: string
): Promise<any> {
  return retryWithBackoff(async () => {
    const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}/result/json`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LlamaParse JSON result fetch failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log(`[LlamaParse] Retrieved JSON with ${JSON.stringify(data).length} characters`);
    console.log(`[LlamaParse] JSON top-level keys: ${Object.keys(data).join(', ')}`);
    if (data.pages) console.log(`[LlamaParse] pages count: ${data.pages.length}`);
    if (data.items) console.log(`[LlamaParse] items count: ${data.items.length}`);
    
    return data;
  }, 3, 1000, 'LlamaParse getJson');
}

/**
 * Complete PDF to JSON + Layout extraction workflow
 * @param pdfBuffer - PDF file as Uint8Array
 * @param fileName - Original file name
 * @param apiKey - LlamaParse API key
 * @returns JSON content with layout and job ID
 */
export async function extractJsonWithLayout(
  pdfBuffer: Uint8Array,
  fileName: string,
  apiKey: string
): Promise<LlamaParseJsonResult> {
  // Step 1: Upload PDF with JSON + layout settings
  const jobId = await uploadToLlamaParseJson(pdfBuffer, fileName, apiKey);
  
  // Step 2: Poll until complete
  const jobStatus = await pollJobUntilComplete(jobId, apiKey);
  
  // Step 3: Extract JSON
  let rawJson: any;
  if (jobStatus.result) {
    rawJson = jobStatus.result;
  } else {
    rawJson = await getJsonResult(jobId, apiKey);
  }

  return {
    jobId,
    rawJson,
    status: 'SUCCESS',
  };
}

/**
 * Resilient PDF to JSON extraction with immediate job ID persistence
 * Allows saving job ID BEFORE polling starts (critical for timeout recovery)
 * @param pdfBuffer - PDF file as Uint8Array
 * @param fileName - Original file name
 * @param apiKey - LlamaParse API key
 * @param onJobCreated - Optional callback executed immediately after job creation
 * @param forcePremium - Force multimodal OCR mode for scanned PDFs
 * @param vendorApiKey - Optional vendor API key (Anthropic) for OCR
 * @returns JSON content with layout and job ID
 */
export async function extractJsonWithLayoutAndCallback(
  pdfBuffer: Uint8Array,
  fileName: string,
  apiKey: string,
  onJobCreated?: (jobId: string) => Promise<void>,
  forcePremium: boolean = false,
  vendorApiKey?: string
): Promise<LlamaParseJsonResult> {
  // Step 1: Upload PDF (otteniamo subito il Job ID)
  const jobId = await uploadToLlamaParseJson(pdfBuffer, fileName, apiKey, forcePremium, vendorApiKey);
  console.log(`[LlamaParse] Upload successful, job_id: ${jobId}`);

  // ✅ CRITICAL: Persist job ID IMMEDIATELY via callback (before polling)
  if (onJobCreated) {
    console.log(`[LlamaParse] Executing persistence callback for ${jobId}...`);
    await onJobCreated(jobId);
    console.log(`[LlamaParse] Persistence callback completed`);
  }

  // Step 2: Poll until complete (questa fase può andare in timeout, ma l'ID è salvo)
  console.log(`[LlamaParse] Starting polling for ${jobId}...`);
  const jobStatus = await pollJobUntilComplete(jobId, apiKey);

  // Step 3: Extract JSON
  let rawJson: any;
  if (jobStatus.result) {
    rawJson = jobStatus.result;
  } else {
    rawJson = await getJsonResult(jobId, apiKey);
  }

  return {
    jobId,
    rawJson,
    status: 'SUCCESS',
  };
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

/**
 * Download extracted image from LlamaParse job
 * Used for Context-Aware Visual Enrichment
 * @param jobId - LlamaParse job ID
 * @param imageName - Image name from pages[].images[].name
 * @param apiKey - LlamaParse API key
 * @returns Image as Uint8Array
 */
export async function downloadJobImage(
  jobId: string,
  imageName: string,
  apiKey: string
): Promise<Uint8Array> {
  console.log(`[LlamaParse] Downloading image: ${imageName} from job ${jobId}`);
  
  return retryWithBackoff(async () => {
    const response = await fetch(
      `${LLAMAPARSE_API_BASE}/job/${jobId}/result/image/${imageName}`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to download image ${imageName}: ${response.status} - ${errorText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`[LlamaParse] Downloaded image: ${imageName} (${arrayBuffer.byteLength} bytes)`);
    
    return new Uint8Array(arrayBuffer);
  }, 3, 1000, 'LlamaParse downloadImage');
}
