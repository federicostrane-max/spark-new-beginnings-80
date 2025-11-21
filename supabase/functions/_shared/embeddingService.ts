/**
 * Embedding Service
 * Provides reliable OpenAI embedding generation with retry logic and batch processing
 */

export interface EmbeddingResult {
  embedding: number[];
  text: string;
  model: string;
}

export interface EmbeddingError {
  text: string;
  error: string;
  attemptNumber: number;
}

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Generate embedding for a single text with retry logic
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  attemptNumber: number = 1
): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Empty text provided for embedding generation');
  }

  if (!apiKey) {
    throw new Error('OpenAI API key not provided');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Invalid response format from OpenAI API');
    }

    return {
      embedding: data.data[0].embedding,
      text,
      model: OPENAI_EMBEDDING_MODEL,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Retry logic
    if (attemptNumber < MAX_RETRIES) {
      console.warn(
        `[embeddingService] Attempt ${attemptNumber} failed: ${errorMessage}. Retrying in ${RETRY_DELAY_MS}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attemptNumber));
      return generateEmbedding(text, apiKey, attemptNumber + 1);
    }

    // Max retries exceeded
    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${errorMessage}`);
  }
}

/**
 * Generate embeddings for multiple texts in batches
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string,
  batchSize: number = 10,
  onProgress?: (completed: number, total: number) => void
): Promise<{ successes: EmbeddingResult[]; failures: EmbeddingError[] }> {
  const successes: EmbeddingResult[] = [];
  const failures: EmbeddingError[] = [];
  const totalTexts = texts.length;

  console.log(`[embeddingService] Processing ${totalTexts} texts in batches of ${batchSize}`);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);

    console.log(`[embeddingService] Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)`);

    // Process batch in parallel with individual retry logic
    const batchPromises = batch.map(async (text, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        const result = await generateEmbedding(text, apiKey);
        successes.push(result);
        
        if (onProgress) {
          onProgress(successes.length + failures.length, totalTexts);
        }
        
        return { success: true, result };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[embeddingService] Failed to generate embedding for text ${globalIndex}:`, errorMessage);
        
        failures.push({
          text: text.slice(0, 100) + '...', // Truncate for logging
          error: errorMessage,
          attemptNumber: MAX_RETRIES,
        });

        if (onProgress) {
          onProgress(successes.length + failures.length, totalTexts);
        }

        return { success: false, error: errorMessage };
      }
    });

    await Promise.all(batchPromises);

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(
    `[embeddingService] Batch complete: ${successes.length} successes, ${failures.length} failures`
  );

  return { successes, failures };
}

/**
 * Validate embedding result
 */
export function validateEmbedding(embedding: number[]): { valid: boolean; reason?: string } {
  if (!Array.isArray(embedding)) {
    return { valid: false, reason: 'Embedding is not an array' };
  }

  if (embedding.length === 0) {
    return { valid: false, reason: 'Embedding is empty' };
  }

  // text-embedding-3-small produces 1536-dimensional vectors
  if (embedding.length !== 1536) {
    return { valid: false, reason: `Invalid embedding dimension: ${embedding.length} (expected 1536)` };
  }

  // Check for NaN or Infinity values
  if (embedding.some(val => !isFinite(val))) {
    return { valid: false, reason: 'Embedding contains invalid values (NaN or Infinity)' };
  }

  return { valid: true };
}
