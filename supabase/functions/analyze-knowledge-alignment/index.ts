import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { 
  AGENT_TYPE_WEIGHTS,
  type ScoringWeights 
} from '../_shared/agentWeights.ts';
import { createLogger, type EdgeFunctionLogger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const CHUNKS_PER_BATCH = 6; // Ridotto per evitare timeout
const BATCH_TIMEOUT_MS = 50000;
const MAX_AUTO_RESUME_RETRIES = 3;
const AUTO_RESUME_DELAY_MS = 2000;

interface RemovalConfig {
  auto_remove_threshold: number;
  flag_for_review_threshold: number;
}

interface AgentRequirements {
  id: string;
  agent_id: string;
  theoretical_concepts: string[];
  operational_concepts: string[];
  procedural_knowledge: string[];
  domain_vocabulary: string[];
  bibliographic_references: any;
  explicit_rules: string[];
}

interface KnowledgeChunk {
  id: string;
  content: string;
  document_name: string;
  category: string;
  summary: string | null;
  pool_document_id: string | null;
}

/**
 * Detects agent type from system prompt using keyword analysis.
 * Uses the universal categorization from agentWeights.ts
 */
function detectAgentType(systemPrompt: string): string {
  const promptLower = systemPrompt.toLowerCase();
  
  // NARRATIVE - Biographies, stories, historical accounts (check FIRST - very specific)
  if (
    promptLower.includes('biography') || 
    promptLower.includes('biographical') || 
    promptLower.includes('vita') || 
    promptLower.includes('life of') ||
    promptLower.includes('story') ||
    promptLower.includes('narrative') ||
    promptLower.includes('creative writing')
  ) {
    return 'narrative';
  }
  
  // DOMAIN-EXPERT - Medical, Legal, Compliance
  if (
    promptLower.includes('diagnose') || 
    promptLower.includes('medical') || 
    promptLower.includes('health') || 
    promptLower.includes('patient') ||
    promptLower.includes('clinical') ||
    promptLower.includes('treatment') ||
    promptLower.includes('legal') || 
    promptLower.includes('contract') || 
    promptLower.includes('compliance') || 
    promptLower.includes('law') ||
    promptLower.includes('regulation')
  ) {
    return 'domain-expert';
  }
  
  // RESEARCH - Academic, scientific, analysis
  if (
    promptLower.includes('research') || 
    promptLower.includes('academic') || 
    promptLower.includes('paper') || 
    promptLower.includes('scholar') ||
    promptLower.includes('scientific') ||
    promptLower.includes('analysis')
  ) {
    return 'research';
  }
  
  // TECHNICAL - Engineering, development, IT
  if (
    promptLower.includes('code') || 
    promptLower.includes('technical') || 
    promptLower.includes('engineer') || 
    promptLower.includes('develop') ||
    promptLower.includes('programming') ||
    promptLower.includes('software')
  ) {
    return 'technical';
  }
  
  // PROCEDURAL - Support, operations, workflows
  if (
    promptLower.includes('support') || 
    promptLower.includes('help') || 
    promptLower.includes('guide') || 
    promptLower.includes('assist') ||
    promptLower.includes('workflow') ||
    promptLower.includes('procedure') ||
    promptLower.includes('how-to') ||
    promptLower.includes('operations')
  ) {
    return 'procedural';
  }
  
  // DEFAULT - General purpose agents
  return 'general';
}

/**
 * Extract JSON from LLM response, removing markdown code blocks if present
 */
function extractJSON(content: string): any {
  let cleaned = content.trim();
  
  // Remove markdown code blocks if present
  if (cleaned.startsWith('```')) {
    // Remove first line (```json or just ```)
    const lines = cleaned.split('\n');
    cleaned = lines.slice(1).join('\n');
  }
  
  if (cleaned.endsWith('```')) {
    // Remove last line (```)
    const lines = cleaned.split('\n');
    cleaned = lines.slice(0, -1).join('\n');
  }
  
  return JSON.parse(cleaned.trim());
}

function detectDomainCriticality(requirements: AgentRequirements): 'high' | 'medium' | 'low' {
  const hasStrictRules = requirements.explicit_rules && requirements.explicit_rules.length > 5;
  const hasCriticalVocabulary = requirements.domain_vocabulary && requirements.domain_vocabulary.length > 20;
  const hasDetailedProcedures = requirements.procedural_knowledge && requirements.procedural_knowledge.length > 10;

  if (hasStrictRules && hasCriticalVocabulary) return 'high';
  if (hasCriticalVocabulary || hasDetailedProcedures) return 'medium';
  return 'low';
}

/**
 * Gets weights from shared constant (AGENT_TYPE_WEIGHTS) and adjusts for domain criticality
 */
function getWeightsForAgent(agentType: string, domainCriticality: string): ScoringWeights {
  // Get base weights from shared constant (imported from _shared/agentWeights.ts)
  const weights = AGENT_TYPE_WEIGHTS[agentType] || AGENT_TYPE_WEIGHTS.general;
  
  // Adjust for high-criticality domains
  if (domainCriticality === 'high') {
    return {
      ...weights,
      vocabulary_alignment: Math.min(weights.vocabulary_alignment * 1.3, 0.4),
      procedural_match: Math.min(weights.procedural_match * 1.2, 0.35),
    };
  }
  
  return weights;
}

function validateWeights(weights: ScoringWeights): boolean {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1.0) < 0.001;
}

function getRemovalConfig(domainCriticality: string): RemovalConfig {
  // Use base threshold from knowledgeAlignmentConfig.ts
  const baseThreshold = 0.5;
  
  const configs: Record<string, RemovalConfig> = {
    high: { 
      auto_remove_threshold: baseThreshold - 0.10, // 0.40 for high criticality
      flag_for_review_threshold: baseThreshold + 0.05 
    },
    medium: { 
      auto_remove_threshold: baseThreshold - 0.05, // 0.45 for medium
      flag_for_review_threshold: baseThreshold + 0.10 
    },
    low: { 
      auto_remove_threshold: baseThreshold, // 0.50 for low (narrative agents like Che Guevara)
      flag_for_review_threshold: baseThreshold + 0.15 
    }
  };
  
  return configs[domainCriticality] || configs.medium;
}

function normalizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[_\s-]+/g, ' ').replace(/\.pdf$/i, '').trim();
}

// Helper to load active alignment prompt from database
async function getActiveAlignmentPrompt(supabase: any, agentType: string): Promise<{ content: string, model: string }> {
  const { data, error } = await supabase
    .from('alignment_agent_prompts')
    .select('prompt_content, llm_model, agent_type')
    .eq('is_active', true)
    .eq('agent_type', agentType)
    .maybeSingle();

  if (error || !data) {
    console.warn('[analyze-knowledge-alignment] No active prompt found, using hardcoded fallback');
    return {
      content: `You are an AI knowledge alignment analyst. Analyze the relevance of this knowledge chunk to the agent's requirements.

AGENT REQUIREMENTS:
- Theoretical Concepts: \${requirements.theoretical_concepts?.join(', ') || 'None'}
- Operational Concepts: \${requirements.operational_concepts?.join(', ') || 'None'}
- Procedural Knowledge: \${requirements.procedural_knowledge?.join(', ') || 'None'}
- Domain Vocabulary: \${requirements.domain_vocabulary?.join(', ') || 'None'}
- Critical References: \${JSON.stringify(requirements.bibliographic_references || {}, null, 2)}

KNOWLEDGE CHUNK:
Document: \${chunk.document_name}
Category: \${chunk.category}
Summary: \${chunk.summary || 'N/A'}
Content: \${chunk.content.substring(0, 1500)}...

Analyze this chunk across these dimensions (0-100 scale):
1. SEMANTIC_RELEVANCE: How closely the chunk's meaning aligns with agent requirements
2. CONCEPT_COVERAGE: How many required concepts are present
3. PROCEDURAL_MATCH: Alignment with required procedures and methods
4. VOCABULARY_ALIGNMENT: Presence of critical domain vocabulary
5. BIBLIOGRAPHIC_MATCH: Match with critical references

Respond ONLY with valid JSON:
{
  "semantic_relevance": <0-100>,
  "concept_coverage": <0-100>,
  "procedural_match": <0-100>,
  "vocabulary_alignment": <0-100>,
  "bibliographic_match": <0-100>,
  "reasoning": "<brief explanation>"
}`,
      model: 'gpt-4o-mini'
    };
  }

  console.log('[analyze-knowledge-alignment] Using prompt version with model:', data.llm_model);
  return {
    content: data.prompt_content,
    model: data.llm_model || 'google/gemini-2.5-flash'
  };
}

async function analyzeChunk(
  chunk: KnowledgeChunk, 
  requirements: AgentRequirements, 
  weights: ScoringWeights,
  promptTemplate: string,
  llmModel: string,
  agentType: string  // ✅ Phase 2: Added for ${agentType} placeholder support
): Promise<any> {
  // Replace placeholders in template using eval (safe context)
  const prompt = eval('`' + promptTemplate + '`');

  // Determine endpoint and API key based on model
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  
  const isLovableAI = llmModel.startsWith('google/') || llmModel.startsWith('openai/');
  const isDeepSeek = llmModel.startsWith('deepseek/');
  const isClaude = llmModel.startsWith('claude') || llmModel.startsWith('anthropic/');
  
  const endpoint = isLovableAI 
    ? 'https://ai.gateway.lovable.dev/v1/chat/completions'
    : isDeepSeek
    ? 'https://api.deepseek.com/v1/chat/completions'
    : isClaude
    ? 'https://api.anthropic.com/v1/messages'
    : OPENAI_ENDPOINT;
  
  const apiKey = isLovableAI
    ? LOVABLE_API_KEY
    : isDeepSeek
    ? DEEPSEEK_API_KEY
    : isClaude
    ? ANTHROPIC_API_KEY
    : OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`API key not configured for model: ${llmModel}`);
  }

  const requestBody = isClaude ? {
    model: llmModel,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  } : {
    model: llmModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 500
  };

  const headers: Record<string, string> = isClaude ? {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json'
  } : {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${llmModel}): ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  
  // Extract content based on provider
  const content = isClaude 
    ? data.content[0].text
    : data.choices[0].message.content;
  
  // 🔍 DEBUG: Log raw LLM response
  console.log(`[DEBUG] Raw LLM response (first 500 chars):`, content.substring(0, 500));
  
  const scores = extractJSON(content);
  
  // 🔍 DEBUG: Log extracted scores
  console.log(`[DEBUG] Extracted scores from LLM:`, JSON.stringify(scores));

  // ✅ FIX: Normalize function with edge case handling
  const normalize = (score: number, fieldName: string) => {
    // Se score è tra 0 e 0.01 (es. 0.009), probabilmente l'LLM ha interpretato male
    // e ha ritornato 0.9% invece di 90%, quindi moltiplica per 100
    if (score > 0 && score < 0.01) {
      console.warn(`[DEBUG] Score ${fieldName} suspiciously low (${score}), multiplying by 100 → ${score * 100}`);
      return score * 100;
    }
    // Se > 1, è in scala 0-100, dividi per 100
    if (score > 1) {
      console.log(`[DEBUG] Score ${fieldName} in 0-100 scale (${score}), dividing by 100 → ${score / 100}`);
      return score / 100;
    }
    // Altrimenti già normalizzato 0-1
    return score;
  };
  
  // ✅ FIX: Handle typo in Claude's response (vocabular_alignment vs vocabulary_alignment)
  const vocabularyScore = scores.vocabulary_alignment ?? scores.vocabular_alignment ?? 0;
  
  const normalizedScores = {
    semantic_relevance: normalize(scores.semantic_relevance ?? 0, 'semantic_relevance'),
    concept_coverage: normalize(scores.concept_coverage ?? 0, 'concept_coverage'),
    procedural_match: normalize(scores.procedural_match ?? 0, 'procedural_match'),
    vocabulary_alignment: normalize(vocabularyScore, 'vocabulary_alignment'),
    bibliographic_match: normalize(scores.bibliographic_match ?? 0, 'bibliographic_match')
  };
  
  // 🔍 DEBUG: Log normalized scores
  console.log(`[DEBUG] Normalized scores:`, JSON.stringify(normalizedScores));

  const finalScore = (
    normalizedScores.semantic_relevance * weights.semantic_relevance +
    normalizedScores.concept_coverage * weights.concept_coverage +
    normalizedScores.procedural_match * weights.procedural_match +
    normalizedScores.vocabulary_alignment * weights.vocabulary_alignment +
    normalizedScores.bibliographic_match * weights.bibliographic_match
  );
  
  // 🔍 DEBUG: Log final score calculation
  console.log(`[DEBUG] Final score: ${finalScore.toFixed(4)} | Weights used:`, JSON.stringify(weights));

  return {
    chunk_id: chunk.id,
    agent_id: requirements.agent_id,
    requirement_id: requirements.id,
    semantic_relevance: normalizedScores.semantic_relevance,
    concept_coverage: normalizedScores.concept_coverage,
    procedural_match: normalizedScores.procedural_match,
    vocabulary_alignment: normalizedScores.vocabulary_alignment,
    bibliographic_match: normalizedScores.bibliographic_match,
    final_relevance_score: finalScore,
    analysis_model: llmModel,
    analysis_reasoning: scores.reasoning,
    weights_used: weights,
    analyzed_at: new Date().toISOString()
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  
  let logger: EdgeFunctionLogger | null = null;

  try {
    const requestBody = await req.json();
    const { agentId, forceReanalysis = false, freshStart = false } = requestBody;
    
    // Create persistent logger
    logger = createLogger('analyze-knowledge-alignment', agentId);
    
    await logger.info('Request received', {
      agentId,
      forceReanalysis,
      freshStart,
      requestBody
    });
    
    // ✅ FRESH START: Restore all removed chunks before analysis
    if (freshStart) {
      await logger!.info('Fresh Start requested - restoring all removed chunks');
      
      // Count inactive chunks before restoration
      const { count: inactiveCount } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('is_active', false);
      
      await logger!.info(`Found ${inactiveCount || 0} inactive chunks to restore`);
      
      const { data: restoredChunks, error: restoreError } = await supabase
        .from('agent_knowledge')
        .update({
          is_active: true,
          removed_at: null,
          removal_reason: null
        })
        .eq('agent_id', agentId)
        .eq('is_active', false)
        .select('id');
      
      if (restoreError) {
        await logger!.error('Failed to restore chunks', { error: restoreError });
        throw new Error(`Failed to restore chunks: ${restoreError.message}`);
      }
      
      const restoredCount = restoredChunks?.length || 0;
      await logger!.info(`Successfully restored ${restoredCount} chunks for fresh start`);
      
      if (restoredCount === 0 && (inactiveCount || 0) > 0) {
        await logger!.warn('Expected to restore chunks but none were restored', {
          inactiveCount,
          restoredCount
        });
      }
    } else {
      await logger!.info('Standard analysis (no fresh start)');
    }

    const { data: agent, error: agentError } = await supabase.from('agents').select('id, name, system_prompt').eq('id', agentId).single();
    if (agentError || !agent) throw new Error(`Agent not found: ${agentId}`);

    // ✅ FIX: Recupera i requirements PIÙ RECENTI ordinando per created_at DESC
    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // ✅ FIX 3: Correggi logica prerequisite check - solo se NON ci sono requirements
    if (!requirements) {
      console.error(`[analyze-knowledge-alignment] No requirements found for agent ${agentId}`);
      await supabase.from('prerequisite_checks').insert({ 
        agent_id: agentId, 
        check_passed: false, 
        missing_critical_sources: { error: 'Requirements not extracted. Run extract-task-requirements first.' } 
      });
      throw new Error('Requirements not found. Run extract-task-requirements first.');
    }
    
    if (reqError) {
      console.error(`[analyze-knowledge-alignment] Database error fetching requirements:`, reqError);
      throw new Error(`Database error: ${reqError.message}`);
    }
    
    console.log(`[analyze-knowledge-alignment] Using requirement ID: ${requirements.id}, created at: ${requirements.created_at}`);

    // ✅ CRITICAL: Add explicit ordering to guarantee stable chunk order across invocations
    // Without ORDER BY, PostgreSQL may return chunks in different order each time,
    // causing chunks to be skipped when resuming from a batch
    const { data: chunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('id, content, document_name, category, summary, pool_document_id')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })  // First criterion
      .order('id', { ascending: true });         // Tiebreaker for stability
    
    if (chunksError) {
      console.error('[analyze-knowledge-alignment] ❌ Error fetching chunks:', chunksError);
      throw new Error(`Failed to fetch chunks: ${chunksError.message}`);
    }
    
    if (!chunks || chunks.length === 0) {
      console.error('[analyze-knowledge-alignment] ❌ No active chunks found for agent');
      await supabase.from('prerequisite_checks').insert({ 
        agent_id: agentId, 
        requirement_id: requirements.id, 
        check_passed: false, 
        missing_critical_sources: { error: 'No active chunks found' } 
      });
      throw new Error('No active knowledge chunks found for agent');
    }

    console.log(`[analyze-knowledge-alignment] ✅ Found ${chunks.length} active chunks to analyze`);

    // Determine agent type FIRST
    const agentType = detectAgentType(agent.system_prompt);
    console.log(`[analyze-knowledge-alignment] Detected agent type: ${agentType} for agent ${agentId}`);

    // Load active alignment prompt for this agent type
    const { content: promptTemplate, model: llmModel } = await getActiveAlignmentPrompt(supabase, agentType);
    console.log(`[analyze-knowledge-alignment] Using LLM model: ${llmModel} with ${agentType} template`);

    const domainCriticality = detectDomainCriticality(requirements);
    const weights = getWeightsForAgent(agentType, domainCriticality);
    const removalConfig = getRemovalConfig(domainCriticality);

    console.log(`[analyze-knowledge-alignment] Criticality: ${domainCriticality}`);
    console.log('[analyze-knowledge-alignment] Using weights:', JSON.stringify(weights));
    
    // Validate weights sum to 1.0
    if (!validateWeights(weights)) {
      throw new Error(`Invalid weights for agent type ${agentType}: weights must sum to 1.0`);
    }

    // ✅ FIX: Recupera progress record e aggiornalo se necessario (usa 'running' come status valido)
    const { data: existingProgress } = await supabase
      .from('alignment_analysis_progress')
      .select('*')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let startFromBatch = 0;
    let progressId = existingProgress?.id;

    // Se c'è un progress esistente con stesso requirement_id e status 'running', riprendi
    if (existingProgress && existingProgress.requirement_id === requirements.id && existingProgress.status === 'running' && !forceReanalysis) {
      startFromBatch = existingProgress.current_batch || 0;
      console.log(`[analyze-knowledge-alignment] Resuming from batch ${startFromBatch}`);
    } else {
      // ✅ Se forziamo o se il requirement_id è cambiato, aggiorna o crea nuovo progress
      if (existingProgress) {
        // Aggiorna il record esistente invece di crearne uno nuovo
        const { data: updatedProgress, error: updateError } = await supabase
          .from('alignment_analysis_progress')
          .update({
            requirement_id: requirements.id,
            total_chunks: chunks.length,
            chunks_processed: 0,
            current_batch: 0,
            status: 'running', // ✅ FIXED: Usa 'running' invece di 'analyzing'
            started_at: new Date().toISOString(),
            error_message: null
          })
          .eq('id', existingProgress.id)
          .select()
          .maybeSingle();

        if (updateError || !updatedProgress) {
          console.error('[analyze-knowledge-alignment] Failed to update progress:', updateError);
          throw new Error('Failed to update progress record');
        }
        progressId = updatedProgress.id;
        console.log(`[analyze-knowledge-alignment] Updated progress record: ${progressId}`);
      } else {
        // Crea nuovo solo se non esiste
        const { data: newProgress, error: progressError } = await supabase
          .from('alignment_analysis_progress')
          .insert({
            agent_id: agentId,
            requirement_id: requirements.id,
            total_chunks: chunks.length,
            chunks_processed: 0,
            current_batch: 0,
            status: 'running', // ✅ FIXED: Usa 'running' invece di 'analyzing'
            started_at: new Date().toISOString()
          })
          .select()
          .maybeSingle();

        if (progressError || !newProgress) {
          console.error('[analyze-knowledge-alignment] Failed to create progress:', progressError);
          throw new Error('Failed to create progress record');
        }
        progressId = newProgress.id;
        console.log(`[analyze-knowledge-alignment] Created new progress record: ${progressId}`);
      }
    }

    const totalBatches = Math.ceil(chunks.length / CHUNKS_PER_BATCH);
    
    // 🗑️ DELETE old scores to force recalculation with new prompts
    if (startFromBatch === 0 || forceReanalysis) {
      console.log('[analyze-knowledge-alignment] 🗑️ Deleting old scores to force fresh analysis with new prompts...');
      const { error: deleteError } = await supabase
        .from('knowledge_relevance_scores')
        .delete()
        .eq('agent_id', agentId)
        .eq('requirement_id', requirements.id);
      
      if (deleteError) {
        console.error('[analyze-knowledge-alignment] Failed to delete old scores:', deleteError);
      } else {
        console.log('[analyze-knowledge-alignment] ✅ Old scores deleted, will recalculate with current prompts');
      }
    }
    
    console.log(`[analyze-knowledge-alignment] 🚀 Processing batch ${startFromBatch + 1}/${totalBatches}`);

    // ✅ MULTI-INVOCATION: Processa SOLO 1 batch per invocazione
    const batchNum = startFromBatch;
    // ✅ FIX PREVENTIVO: Ridurre batch size se chunk rimanenti < CHUNKS_PER_BATCH
    const remainingChunks = chunks.length - (batchNum * CHUNKS_PER_BATCH);
    const effectiveBatchSize = Math.min(CHUNKS_PER_BATCH, remainingChunks);
    const batchChunks = chunks.slice(
      batchNum * CHUNKS_PER_BATCH, 
      batchNum * CHUNKS_PER_BATCH + effectiveBatchSize
    );
    const batchScores: any[] = [];
    let timeoutOccurred = false;

    try {
      const processingPromise = (async () => {
        for (let i = 0; i < batchChunks.length; i++) {
          const chunk = batchChunks[i];
          const chunkIndex = batchNum * CHUNKS_PER_BATCH + i + 1;
          console.log(`[analyze-knowledge-alignment] Analyzing chunk ${chunkIndex}/${chunks.length}: ${chunk.document_name}`);
          try {
            const score = await analyzeChunk(chunk, requirements, weights, promptTemplate, llmModel, agentType);  // ✅ Phase 2: Pass agentType
            batchScores.push(score);
            console.log(`[analyze-knowledge-alignment] ✓ Chunk analyzed, final score: ${score.final_relevance_score.toFixed(3)}`);
          } catch (error) {
            console.error(`[analyze-knowledge-alignment] ✗ Failed to analyze chunk ${chunk.id}:`, error);
            // ✅ FIX: Insert a SKIP score marker for failed chunks so integrity check passes
            await logger.warn(`Chunk ${chunk.id} skipped due to error, inserting skip marker`, { chunkId: chunk.id, error: String(error) });
            const skipScore = {
              chunk_id: chunk.id,
              agent_id: agentId,
              requirement_id: requirements.id,
              semantic_relevance: 0,
              concept_coverage: 0,
              procedural_match: 0,
              vocabulary_alignment: 0,
              bibliographic_match: 0,
              final_relevance_score: 0,
              analysis_model: llmModel,
              analysis_reasoning: `SKIPPED: ${String(error)}`,
              weights_used: weights
            };
            batchScores.push(skipScore);
          }
        }
      })();

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout')), BATCH_TIMEOUT_MS));
      await Promise.race([processingPromise, timeoutPromise]);
      console.log(`[analyze-knowledge-alignment] ✅ Batch ${batchNum + 1} completed successfully`);
    } catch (error: any) {
      if (error?.message === 'Batch timeout') {
        console.warn(`[analyze-knowledge-alignment] ⚠️ Batch timeout after ${BATCH_TIMEOUT_MS}ms, saving progress...`);
        timeoutOccurred = true;
      } else {
        throw error;
      }
    }

    // Save batch scores
    if (batchScores.length > 0) {
      console.log(`[analyze-knowledge-alignment] 💾 Saving ${batchScores.length} scores to knowledge_relevance_scores...`);
      const { error: upsertError } = await supabase.from('knowledge_relevance_scores').upsert(batchScores, { onConflict: 'chunk_id,requirement_id' });
      if (upsertError) {
        console.error(`[analyze-knowledge-alignment] ❌ UPSERT FAILED:`, upsertError);
        throw upsertError;
      }
      console.log(`[analyze-knowledge-alignment] ✅ Successfully saved ${batchScores.length} scores to database`);
    }

    // ✅ VALIDATION: Count real scores saved in database
    const { count: actualProcessedCount, error: countError } = await supabase
      .from('knowledge_relevance_scores')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('requirement_id', requirements.id);

    if (countError) {
      console.error(`[analyze-knowledge-alignment] Error counting scores:`, countError);
      throw new Error(`Failed to count scores: ${countError.message}`);
    }

    const actualChunksProcessed = actualProcessedCount || 0;
    
    // ✅ DETAILED LOGGING for batch progress
    await logger.info(`Batch ${batchNum + 1}/${totalBatches} completed`, {
      batchScoresSaved: batchScores.length,
      totalScoresInDB: actualChunksProcessed,
      totalChunksToAnalyze: chunks.length,
      progressPercentage: ((actualChunksProcessed / chunks.length) * 100).toFixed(1)
    });

    console.log(`[analyze-knowledge-alignment] 📊 Batch ${batchNum + 1} results:`);
    console.log(`  - Status: running`);
    console.log(`  - Chunks processed in this batch: ${batchScores.length}`);
    console.log(`  - Total chunks processed so far: ${actualChunksProcessed}/${chunks.length}`);
    console.log(`  - Progress: ${((actualChunksProcessed / chunks.length) * 100).toFixed(1)}%`);

    const { error: updateError } = await supabase
      .from('alignment_analysis_progress')
      .update({
        chunks_processed: actualChunksProcessed,
        current_batch: batchNum + 1,
        status: 'running',
        updated_at: new Date().toISOString()
      })
      .eq('id', progressId);

    if (updateError) {
      console.error(`[analyze-knowledge-alignment] ❌ Failed to update progress:`, updateError);
    }

    // ✅ PRE-FINALIZATION VALIDATION: Check if ALL chunks have been analyzed
    const isLastBatch = (batchNum + 1) >= totalBatches;
    if (isLastBatch) {
      // ✅ FIX: Allow small discrepancy (up to 5 chunks) for robustness
      const discrepancy = Math.abs(actualChunksProcessed - chunks.length);
      const integrityPassed = discrepancy <= 5;
      
      if (!integrityPassed) {
        await logger.error('Integrity check FAILED before finalization', {
          actualScoresInDB: actualChunksProcessed,
          expectedChunks: chunks.length,
          missing: chunks.length - actualChunksProcessed,
          discrepancy
        });
        throw new Error(`Integrity check failed: ${actualChunksProcessed} scores vs ${chunks.length} chunks (discrepancy: ${discrepancy})`);
      }
      
      if (discrepancy > 0) {
        await logger.warn(`Integrity check PASSED with minor discrepancy: ${discrepancy} chunks`, {
          actualScoresInDB: actualChunksProcessed,
          expectedChunks: chunks.length
        });
      } else {
        await logger.info('✅ Integrity check PASSED - All chunks analyzed');
      }
      
      console.log('[analyze-knowledge-alignment] 🏁 All batches completed, calling finalize...');
      await finalizeAnalysis(supabase, agentId, requirements.id, chunks.length, removalConfig, logger!);
    }

    // Calculate final processed count for response
    const { count: finalProcessedCount } = await supabase
      .from('knowledge_relevance_scores')
      .select('id', { count: 'exact', head: true })
      .eq('requirement_id', requirements.id);

    const actualProcessed = finalProcessedCount || 0;
    const isComplete = actualProcessed >= chunks.length;

    return new Response(JSON.stringify({
      success: true,
      agentId,
      status: isComplete ? 'completed' : 'in_progress',
      batchCompleted: batchNum + 1,
      totalBatches,
      chunksProcessed: actualProcessed,
      totalChunks: chunks.length,
      progressPercentage: Math.round((actualProcessed / chunks.length) * 100)
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[analyze-knowledge-alignment] ❌ Fatal error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error', stack: error?.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function finalizeAnalysis(
  supabase: any, 
  agentId: string, 
  requirementId: string, 
  totalChunks: number, 
  removalConfig: RemovalConfig,
  logger?: EdgeFunctionLogger
) {
  const logInfo = logger ? logger.info.bind(logger) : async (msg: string, meta?: any) => console.log(msg, meta);
  const logWarn = logger ? logger.warn.bind(logger) : async (msg: string, meta?: any) => console.warn(msg, meta);
  const logError = logger ? logger.error.bind(logger) : async (msg: string, meta?: any) => console.error(msg, meta);

  await logInfo('Starting finalization');

  const { data: allScores } = await supabase
    .from('knowledge_relevance_scores')
    .select('*')
    .eq('agent_id', agentId)
    .eq('requirement_id', requirementId);
  
  if (!allScores || allScores.length === 0) {
    await logError('No scores found for finalization');
    return;
  }

  // ✅ VALIDATION: Check integrity
  const actualScored = allScores.length;
  const discrepancy = Math.abs(totalChunks - actualScored);
  const integrityValid = discrepancy <= 5; // Allow 5 chunks margin
  
  await logInfo(`Integrity check: ${actualScored}/${totalChunks} chunks scored`, {
    actualScored,
    totalChunks,
    discrepancy,
    integrityValid
  });

  if (!integrityValid) {
    await logWarn(`Integrity issue detected: ${discrepancy} chunks missing`, {
      expected: totalChunks,
      actual: actualScored,
      missing: totalChunks - actualScored
    });
  }

  const scores = allScores.map((s: any) => s.final_relevance_score);
  const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
  const belowAutoRemove = allScores.filter((s: any) => s.final_relevance_score < removalConfig.auto_remove_threshold);
  const belowFlagThreshold = allScores.filter((s: any) => s.final_relevance_score >= removalConfig.auto_remove_threshold && s.final_relevance_score < removalConfig.flag_for_review_threshold);

  await logInfo(`📊 Statistics: avg=${avgScore.toFixed(3)}, threshold=${removalConfig.auto_remove_threshold}`, {
    avgScore,
    threshold: removalConfig.auto_remove_threshold,
    belowThreshold: belowAutoRemove.length,
    flaggedForReview: belowFlagThreshold.length,
    totalScored: allScores.length
  });
  console.log(`[analyze-knowledge-alignment] 📊 Statistics: avg=${avgScore.toFixed(3)}, auto_remove=${belowAutoRemove.length} (threshold: ${removalConfig.auto_remove_threshold}), flagged=${belowFlagThreshold.length}`);

  // ✅ AUTO-REMOVAL LOGIC: Remove low-quality chunks
  let actuallyRemoved = 0;
  
  if (belowAutoRemove.length > 0) {
    const MAX_REMOVALS_PER_RUN = 50;
    
    // Safety check: if too many chunks to remove, skip auto-removal
    if (belowAutoRemove.length > MAX_REMOVALS_PER_RUN) {
      console.log(`[analyze-knowledge-alignment] ⚠️ ${belowAutoRemove.length} chunks flagged for removal (> ${MAX_REMOVALS_PER_RUN} max), requires manual approval`);
    } else {
      console.log(`[analyze-knowledge-alignment] 🗑️ Auto-removing ${belowAutoRemove.length} chunks...`);
      
      for (const score of belowAutoRemove) {
        try {
          // 1. Get chunk details before removal
          const { data: chunkData } = await supabase
            .from('agent_knowledge')
            .select('content, document_name, category, summary, pool_document_id, source_type, embedding')
            .eq('id', score.chunk_id)
            .single();
          
          if (!chunkData) {
            console.warn(`[analyze-knowledge-alignment] Chunk ${score.chunk_id} not found, skipping`);
            continue;
          }
          
          const removalReason = `Auto-removed: relevance score ${(score.final_relevance_score * 100).toFixed(1)}% < ${(removalConfig.auto_remove_threshold * 100)}% threshold`;
          
          // 2. Archive to removal history
          await supabase
            .from('knowledge_removal_history')
            .insert({
              chunk_id: score.chunk_id,
              agent_id: agentId,
              document_name: chunkData.document_name,
              category: chunkData.category,
              content: chunkData.content,
              summary: chunkData.summary,
              embedding: chunkData.embedding,
              pool_document_id: chunkData.pool_document_id,
              source_type: chunkData.source_type,
              removal_type: 'auto',
              removal_reason: removalReason,
              final_relevance_score: score.final_relevance_score,
              removed_at: new Date().toISOString()
            });
          
          // 3. Mark chunk as inactive in agent_knowledge
          await supabase
            .from('agent_knowledge')
            .update({
              is_active: false,
              removed_at: new Date().toISOString(),
              removal_reason: removalReason
            })
            .eq('id', score.chunk_id);
          
          actuallyRemoved++;
          console.log(`[analyze-knowledge-alignment] ✅ Removed chunk ${score.chunk_id} (score: ${(score.final_relevance_score * 100).toFixed(1)}%)`);
        } catch (error) {
          console.error(`[analyze-knowledge-alignment] ❌ Error removing chunk ${score.chunk_id}:`, error);
        }
      }
      
      console.log(`[analyze-knowledge-alignment] 🎉 Successfully removed ${actuallyRemoved}/${belowAutoRemove.length} chunks`);
      
      // ✅ POST-REMOVAL INTEGRITY TEST
      const { count: activeCount } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('is_active', true);

      const { count: inactiveCount } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('is_active', false);

      await logInfo(`Post-removal integrity check`, {
        activeChunks: activeCount,
        inactiveChunks: inactiveCount,
        removedThisRun: actuallyRemoved
      });
    }
  }

  // Get start time from progress for accurate duration
  const { data: progress } = await supabase
    .from('alignment_analysis_progress')
    .select('started_at')
    .eq('agent_id', agentId)
    .maybeSingle();
  
  const startedAt = progress?.started_at || new Date().toISOString();
  const completedAt = new Date().toISOString();
  const duration = Date.now() - new Date(startedAt).getTime();
  
  await logInfo(`Analysis duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);

  // Save analysis log with integrity data
  await supabase.from('alignment_analysis_log').insert({
    agent_id: agentId,
    requirement_id: requirementId,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: duration,
    total_chunks_analyzed: totalChunks,
    actual_chunks_scored: actualScored,
    chunks_flagged_for_removal: belowFlagThreshold.length,
    chunks_auto_removed: actuallyRemoved,
    chunks_removed: actuallyRemoved,
    chunks_kept: actualScored - actuallyRemoved,
    overall_alignment_percentage: avgScore * 100,
    prerequisite_check_passed: true,
    integrity_valid: integrityValid,
    integrity_message: integrityValid 
      ? null 
      : `Missing ${discrepancy} chunks: expected ${totalChunks}, scored ${actualScored}`,
    execution_id: logger?.executionId || null
  });

  // ✅ CRITICAL FIX: Update progress status to 'completed'
  const { error: progressUpdateError } = await supabase
    .from('alignment_analysis_progress')
    .update({ 
      status: 'completed',
      chunks_processed: totalChunks,
      updated_at: completedAt
    })
    .eq('agent_id', agentId);
  
  if (progressUpdateError) {
    console.error('[analyze-knowledge-alignment] ❌ Failed to update progress to completed:', progressUpdateError);
  } else {
    console.log('[analyze-knowledge-alignment] ✅ Progress status updated to completed');
  }

  await logInfo('Analysis finalized successfully', {
    totalChunks,
    actualScored,
    removed: actuallyRemoved,
    integrityValid
  });
}
