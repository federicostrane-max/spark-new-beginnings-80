import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const CHUNKS_PER_BATCH = 10;
const BATCH_TIMEOUT_MS = 50000;
const MAX_AUTO_RESUME_RETRIES = 3;
const AUTO_RESUME_DELAY_MS = 2000;

interface ScoringWeights {
  semantic_relevance: number;
  concept_coverage: number;
  procedural_match: number;
  vocabulary_alignment: number;
  bibliographic_match: number;
}

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

function detectAgentType(systemPrompt: string): string {
  const prompt = systemPrompt.toLowerCase();
  if (prompt.includes('research') || prompt.includes('academic') || prompt.includes('paper')) return 'research';
  if (prompt.includes('technical') || prompt.includes('engineering') || prompt.includes('code')) return 'technical';
  if (prompt.includes('creative') || prompt.includes('writing') || prompt.includes('story')) return 'creative';
  return 'general';
}

function detectDomainCriticality(requirements: AgentRequirements): 'high' | 'medium' | 'low' {
  const hasStrictRules = requirements.explicit_rules && requirements.explicit_rules.length > 5;
  const hasCriticalVocabulary = requirements.domain_vocabulary && requirements.domain_vocabulary.length > 20;
  const hasDetailedProcedures = requirements.procedural_knowledge && requirements.procedural_knowledge.length > 10;

  if (hasStrictRules && hasCriticalVocabulary) return 'high';
  if (hasCriticalVocabulary || hasDetailedProcedures) return 'medium';
  return 'low';
}

function getWeightsForAgent(agentType: string, domainCriticality: string): ScoringWeights {
  const baseWeights: Record<string, ScoringWeights> = {
    research: { semantic_relevance: 0.15, concept_coverage: 0.30, procedural_match: 0.10, vocabulary_alignment: 0.20, bibliographic_match: 0.25 },
    technical: { semantic_relevance: 0.20, concept_coverage: 0.25, procedural_match: 0.30, vocabulary_alignment: 0.20, bibliographic_match: 0.05 },
    creative: { semantic_relevance: 0.40, concept_coverage: 0.30, procedural_match: 0.05, vocabulary_alignment: 0.20, bibliographic_match: 0.05 },
    general: { semantic_relevance: 0.25, concept_coverage: 0.25, procedural_match: 0.20, vocabulary_alignment: 0.20, bibliographic_match: 0.10 }
  };

  let weights = baseWeights[agentType] || baseWeights.general;
  if (domainCriticality === 'high') {
    weights = {
      ...weights,
      vocabulary_alignment: Math.min(weights.vocabulary_alignment * 1.3, 0.4),
      procedural_match: Math.min(weights.procedural_match * 1.2, 0.4)
    };
  }
  return weights;
}

function getRemovalConfig(domainCriticality: string): RemovalConfig {
  const configs: Record<string, RemovalConfig> = {
    high: { auto_remove_threshold: 0.20, flag_for_review_threshold: 0.35 },
    medium: { auto_remove_threshold: 0.25, flag_for_review_threshold: 0.40 },
    low: { auto_remove_threshold: 0.30, flag_for_review_threshold: 0.45 }
  };
  return configs[domainCriticality] || configs.medium;
}

function normalizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[_\s-]+/g, ' ').replace(/\.pdf$/i, '').trim();
}

async function analyzeChunk(chunk: KnowledgeChunk, requirements: AgentRequirements, weights: ScoringWeights): Promise<any> {
  const prompt = `You are an AI knowledge alignment analyst. Analyze the relevance of this knowledge chunk to the agent's requirements.

AGENT REQUIREMENTS:
- Theoretical Concepts: ${requirements.theoretical_concepts?.join(', ') || 'None'}
- Operational Concepts: ${requirements.operational_concepts?.join(', ') || 'None'}
- Procedural Knowledge: ${requirements.procedural_knowledge?.join(', ') || 'None'}
- Domain Vocabulary: ${requirements.domain_vocabulary?.join(', ') || 'None'}
- Critical References: ${JSON.stringify(requirements.bibliographic_references || {}, null, 2)}

KNOWLEDGE CHUNK:
Document: ${chunk.document_name}
Category: ${chunk.category}
Summary: ${chunk.summary || 'N/A'}
Content: ${chunk.content.substring(0, 1500)}...

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
}`;

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.statusText}`);

  const data = await response.json();
  const scores = JSON.parse(data.choices[0].message.content);

  const finalScore = (
    (scores.semantic_relevance / 100) * weights.semantic_relevance +
    (scores.concept_coverage / 100) * weights.concept_coverage +
    (scores.procedural_match / 100) * weights.procedural_match +
    (scores.vocabulary_alignment / 100) * weights.vocabulary_alignment +
    (scores.bibliographic_match / 100) * weights.bibliographic_match
  );

  return {
    chunk_id: chunk.id,
    agent_id: requirements.agent_id,
    requirement_id: requirements.id,
    semantic_relevance: scores.semantic_relevance / 100,
    concept_coverage: scores.concept_coverage / 100,
    procedural_match: scores.procedural_match / 100,
    vocabulary_alignment: scores.vocabulary_alignment / 100,
    bibliographic_match: scores.bibliographic_match / 100,
    final_relevance_score: finalScore,
    analysis_model: OPENAI_MODEL,
    analysis_reasoning: scores.reasoning,
    weights_used: weights,
    analyzed_at: new Date().toISOString()
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  try {
    const { agentId, forceReanalysis = false } = await req.json();
    console.log(`[analyze-knowledge-alignment] Starting for agent: ${agentId}, force: ${forceReanalysis}`);

    const { data: agent, error: agentError } = await supabase.from('agents').select('id, name, system_prompt').eq('id', agentId).single();
    if (agentError || !agent) throw new Error(`Agent not found: ${agentId}`);

    // ✅ FIX: Recupera i requirements PIÙ RECENTI ordinando per created_at DESC
    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (reqError || !requirements) {
      console.error(`[analyze-knowledge-alignment] Requirements error:`, reqError);
      await supabase.from('prerequisite_checks').insert({ 
        agent_id: agentId, 
        check_passed: false, 
        missing_critical_sources: { error: 'Requirements not extracted' } 
      });
      throw new Error('Requirements not found. Run extract-task-requirements first.');
    }
    
    console.log(`[analyze-knowledge-alignment] Using requirement ID: ${requirements.id}, created at: ${requirements.created_at}`);

    const { data: chunks, error: chunksError } = await supabase.from('agent_knowledge').select('id, content, document_name, category, summary, pool_document_id').eq('agent_id', agentId).eq('is_active', true);
    if (chunksError || !chunks || chunks.length === 0) {
      await supabase.from('prerequisite_checks').insert({ agent_id: agentId, requirement_id: requirements.id, check_passed: false, missing_critical_sources: { error: 'No active chunks found' } });
      throw new Error('No active knowledge chunks found for agent');
    }

    console.log(`[analyze-knowledge-alignment] Found ${chunks.length} active chunks to analyze`);

    const agentType = detectAgentType(agent.system_prompt);
    const domainCriticality = detectDomainCriticality(requirements);
    const weights = getWeightsForAgent(agentType, domainCriticality);
    const removalConfig = getRemovalConfig(domainCriticality);

    console.log(`[analyze-knowledge-alignment] Agent type: ${agentType}, Criticality: ${domainCriticality}`);

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
    const startBatch = startFromBatch;

    console.log(`[analyze-knowledge-alignment] Processing batch ${startBatch + 1}/${totalBatches}`);

    const batchChunks = chunks.slice(startBatch * CHUNKS_PER_BATCH, Math.min((startBatch + 1) * CHUNKS_PER_BATCH, chunks.length));
    const batchScores: any[] = [];
    let timeoutOccurred = false;

    try {
      const processingPromise = (async () => {
        for (let i = 0; i < batchChunks.length; i++) {
          const chunk = batchChunks[i];
          console.log(`[analyze-knowledge-alignment] Analyzing chunk ${startBatch * CHUNKS_PER_BATCH + i + 1}/${chunks.length}: ${chunk.document_name}`);
          try {
            const score = await analyzeChunk(chunk, requirements, weights);
            batchScores.push(score);
            console.log(`[analyze-knowledge-alignment] ✓ Chunk analyzed, final score: ${score.final_relevance_score.toFixed(3)}`);
          } catch (error) {
            console.error(`[analyze-knowledge-alignment] ✗ Failed to analyze chunk ${chunk.id}:`, error);
          }
        }
      })();

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout')), BATCH_TIMEOUT_MS));
      await Promise.race([processingPromise, timeoutPromise]);
      console.log(`[analyze-knowledge-alignment] Batch completed successfully`);
    } catch (error: any) {
      if (error?.message === 'Batch timeout') {
        console.warn(`[analyze-knowledge-alignment] ⚠️ Batch timeout after ${BATCH_TIMEOUT_MS}ms, saving progress...`);
        timeoutOccurred = true;
      } else {
        throw error;
      }
    } finally {
      if (batchScores.length > 0) {
        console.log(`[analyze-knowledge-alignment] 💾 Saving ${batchScores.length} scores to knowledge_relevance_scores...`);
        const { error: upsertError } = await supabase.from('knowledge_relevance_scores').upsert(batchScores, { onConflict: 'chunk_id,requirement_id' });
        if (upsertError) {
          console.error(`[analyze-knowledge-alignment] ❌ UPSERT FAILED:`, upsertError);
          throw upsertError;
        }
        console.log(`[analyze-knowledge-alignment] ✅ Successfully saved ${batchScores.length} scores to database`);
      }

      const chunksProcessed = (startBatch + 1) * CHUNKS_PER_BATCH;
      const isComplete = chunksProcessed >= chunks.length;
      const newStatus = timeoutOccurred ? 'timeout' : (isComplete ? 'completed' : 'running');

      console.log(`[analyze-knowledge-alignment] Updating progress: ${chunksProcessed}/${chunks.length} chunks, status: ${newStatus}`);

      const { error: updateError } = await supabase.from('alignment_analysis_progress').update({
        chunks_processed: Math.min(chunksProcessed, chunks.length),
        current_batch: startBatch + 1,
        status: newStatus,
        updated_at: new Date().toISOString()
      }).eq('id', progressId);

      if (updateError) console.error(`[analyze-knowledge-alignment] ❌ Failed to update progress:`, updateError);

      if (!isComplete) {
        console.log(`[analyze-knowledge-alignment] 🔄 Scheduling next batch...`);
        for (let attempt = 1; attempt <= MAX_AUTO_RESUME_RETRIES; attempt++) {
          try {
            await new Promise(resolve => setTimeout(resolve, AUTO_RESUME_DELAY_MS));
            const { error: resumeError } = await supabase.functions.invoke('analyze-knowledge-alignment', { body: { agentId, forceReanalysis: false } });
            if (resumeError) {
              console.error(`[analyze-knowledge-alignment] ❌ Auto-resume attempt ${attempt} failed:`, resumeError);
              if (attempt === MAX_AUTO_RESUME_RETRIES) throw resumeError;
            } else {
              console.log(`[analyze-knowledge-alignment] ✅ Next batch scheduled successfully`);
              break;
            }
          } catch (error: any) {
            console.error(`[analyze-knowledge-alignment] ❌ Auto-resume attempt ${attempt} error:`, error);
          }
        }
      } else {
        console.log(`[analyze-knowledge-alignment] 🎉 Analysis complete! Finalizing...`);
        await finalizeAnalysis(supabase, agentId, requirements.id, chunks.length, removalConfig);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      agentId,
      batch: startBatch + 1,
      totalBatches,
      chunksProcessed: Math.min((startBatch + 1) * CHUNKS_PER_BATCH, chunks.length),
      totalChunks: chunks.length,
      complete: (startBatch + 1) * CHUNKS_PER_BATCH >= chunks.length
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[analyze-knowledge-alignment] ❌ Fatal error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error', stack: error?.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function finalizeAnalysis(supabase: any, agentId: string, requirementId: string, totalChunks: number, removalConfig: RemovalConfig) {
  console.log('[analyze-knowledge-alignment] Finalizing analysis...');

  const { data: allScores } = await supabase.from('knowledge_relevance_scores').select('*').eq('agent_id', agentId).eq('requirement_id', requirementId);
  if (!allScores || allScores.length === 0) {
    console.error('[analyze-knowledge-alignment] ❌ No scores found for finalization');
    return;
  }

  const scores = allScores.map((s: any) => s.final_relevance_score);
  const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
  const belowAutoRemove = allScores.filter((s: any) => s.final_relevance_score < removalConfig.auto_remove_threshold);
  const belowFlagThreshold = allScores.filter((s: any) => s.final_relevance_score >= removalConfig.auto_remove_threshold && s.final_relevance_score < removalConfig.flag_for_review_threshold);

  console.log(`[analyze-knowledge-alignment] Statistics: avg=${avgScore.toFixed(3)}, auto_remove=${belowAutoRemove.length}, flagged=${belowFlagThreshold.length}`);

  await supabase.from('alignment_analysis_log').insert({
    agent_id: agentId,
    requirement_id: requirementId,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    total_chunks_analyzed: totalChunks,
    chunks_flagged_for_removal: belowFlagThreshold.length,
    chunks_auto_removed: belowAutoRemove.length,
    overall_alignment_percentage: avgScore * 100,
    prerequisite_check_passed: true
  });

  console.log('[analyze-knowledge-alignment] ✅ Analysis finalized');
}
