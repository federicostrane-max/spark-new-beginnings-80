import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScoringWeights {
  semantic_relevance: number;
  concept_coverage: number;
  procedural_match: number;
  vocabulary_alignment: number;
  bibliographic_match: number;
}

const AGENT_TYPE_WEIGHTS: Record<string, ScoringWeights> = {
  conceptual: { semantic_relevance: 0.25, concept_coverage: 0.35, procedural_match: 0.10, vocabulary_alignment: 0.15, bibliographic_match: 0.15 },
  procedural: { semantic_relevance: 0.20, concept_coverage: 0.20, procedural_match: 0.35, vocabulary_alignment: 0.15, bibliographic_match: 0.10 },
  technical: { semantic_relevance: 0.25, concept_coverage: 0.25, procedural_match: 0.20, vocabulary_alignment: 0.20, bibliographic_match: 0.10 },
  medical: { semantic_relevance: 0.20, concept_coverage: 0.30, procedural_match: 0.25, vocabulary_alignment: 0.15, bibliographic_match: 0.10 },
  legal: { semantic_relevance: 0.25, concept_coverage: 0.25, procedural_match: 0.20, vocabulary_alignment: 0.15, bibliographic_match: 0.15 }
};

const AGENT_REMOVAL_THRESHOLDS: Record<string, { threshold: number; maxRemovalsPerRun: number; requiresApproval: boolean }> = {
  conceptual: { threshold: 0.25, maxRemovalsPerRun: 20, requiresApproval: false },
  procedural: { threshold: 0.35, maxRemovalsPerRun: 15, requiresApproval: false },
  technical: { threshold: 0.40, maxRemovalsPerRun: 10, requiresApproval: true },
  medical: { threshold: 0.45, maxRemovalsPerRun: 5, requiresApproval: true },
  legal: { threshold: 0.40, maxRemovalsPerRun: 8, requiresApproval: true }
};

function detectAgentType(systemPrompt: string): string {
  const p = systemPrompt.toLowerCase();
  if (p.includes('medical') || p.includes('health')) return 'medical';
  if (p.includes('technical') || p.includes('code')) return 'technical';
  if (p.includes('support') || p.includes('help')) return 'procedural';
  if (p.includes('legal') || p.includes('contract')) return 'legal';
  return 'conceptual';
}

function detectDomainCriticality(systemPrompt: string): 'high' | 'medium' | 'low' {
  const p = systemPrompt.toLowerCase();
  if (p.includes('critical') || p.includes('safety')) return 'high';
  if (p.includes('important') || p.includes('professional')) return 'medium';
  return 'low';
}

function getWeightsForAgent(systemPrompt: string): ScoringWeights {
  return AGENT_TYPE_WEIGHTS[detectAgentType(systemPrompt)] || AGENT_TYPE_WEIGHTS.conceptual;
}

function getRemovalConfig(agentType: string, crit: 'high' | 'medium' | 'low') {
  const base = AGENT_REMOVAL_THRESHOLDS[agentType] || AGENT_REMOVAL_THRESHOLDS.conceptual;
  if (crit === 'high') return { ...base, threshold: Math.min(base.threshold + 0.05, 0.50), maxRemovalsPerRun: Math.max(Math.floor(base.maxRemovalsPerRun * 0.5), 3), requiresApproval: true };
  if (crit === 'low') return { ...base, threshold: Math.max(base.threshold - 0.05, 0.20), maxRemovalsPerRun: Math.floor(base.maxRemovalsPerRun * 1.5) };
  return base;
}

const CHUNKS_PER_BATCH = 20;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const { agentId, progressId } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let progress: any = null;
    
    if (progressId) {
      const { data } = await supabase.from('alignment_analysis_progress').select('*').eq('id', progressId).single();
      progress = data;
      if (!progress || progress.status === 'completed') {
        return new Response(JSON.stringify({ success: true, status: 'completed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      // Initialize new analysis
      const { data: agent } = await supabase.from('agents').select('system_prompt').eq('id', agentId).single();
      const { data: requirements } = await supabase.from('agent_task_requirements').select('*').eq('agent_id', agentId).single();
      if (!agent || !requirements) throw new Error('Agent or requirements not found');

      const agentType = detectAgentType(agent.system_prompt);
      const domainCriticality = detectDomainCriticality(agent.system_prompt);
      const weights = getWeightsForAgent(agent.system_prompt);
      const removalConfig = getRemovalConfig(agentType, domainCriticality);

      // Check prerequisites
      const criticalSources = (requirements.bibliographic_references as any[]).filter(r => r.importance === 'critical');
      if (criticalSources.length > 0) {
        const { data: chunks } = await supabase.from('agent_knowledge').select('pool_document_id').eq('agent_id', agentId).eq('is_active', true);
        const poolDocIds = [...new Set(chunks?.map(c => c.pool_document_id).filter(Boolean))];
        const { data: docs } = await supabase.from('knowledge_documents').select('file_name, extracted_title').in('id', poolDocIds);
        
        const normalize = (t: string) => {
          if (!t) return '';
          try {
            // Decode URL-encoded strings (e.g., %20 → space)
            t = decodeURIComponent(t);
          } catch {
            // If decoding fails, use original string
          }
          return t.toLowerCase().replace(/[^\w\s.\-]/g, '').replace(/\s+/g, ' ').trim();
        };
        const missing = criticalSources.filter(s => {
          const ref = normalize(s.title);
          return !docs?.some(d => {
            const ext = d.extracted_title ? normalize(d.extracted_title) : null;
            const file = normalize(d.file_name);
            return (ext && (ext.includes(ref) || ref.includes(ext))) || file.includes(ref) || ref.includes(file);
          });
        });

        if (missing.length > 0) {
          await supabase.from('alignment_analysis_log').insert({
            agent_id: agentId, requirement_id: requirements.id, prerequisite_check_passed: false,
            missing_critical_sources: missing, total_chunks_analyzed: 0, completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime
          });
          return new Response(JSON.stringify({ success: false, blocked: true, missing_sources: missing }), 
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      const { count } = await supabase.from('agent_knowledge').select('*', { count: 'exact', head: true }).eq('agent_id', agentId).eq('is_active', true);
      const { data: newProgress } = await supabase.from('alignment_analysis_progress').insert({
        agent_id: agentId, requirement_id: requirements.id, total_chunks: count, chunks_processed: 0,
        status: 'running', current_batch: 0,
        partial_results: { agent_type: agentType, domain_criticality: domainCriticality, weights, removal_config: removalConfig }
      }).select().single();
      progress = newProgress;
    }

    // Process batch
    const offset = progress.chunks_processed;
    const { data: chunks } = await supabase.from('agent_knowledge').select('*').eq('agent_id', progress.agent_id).eq('is_active', true).range(offset, offset + CHUNKS_PER_BATCH - 1);

    if (!chunks?.length) {
      await finalizeAnalysis(supabase, progress, startTime);
      return new Response(JSON.stringify({ success: true, status: 'completed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: requirements } = await supabase.from('agent_task_requirements').select('*').eq('id', progress.requirement_id).single();
    
    console.log(`
🔍 Analysis Batch Started
- Progress ID: ${progress.id}
- Agent: ${progress.agent_id}
- Batch: ${progress.current_batch + 1}
- Chunks in batch: ${chunks.length}
- Total progress: ${progress.chunks_processed}/${progress.total_chunks}
    `);

    let successfullyProcessed = 0;
    const failedChunks: string[] = [];

    // Clean previous scores only at the start of a fresh analysis
    if (progress.current_batch === 0 && progress.chunks_processed === 0) {
      const { error: deleteError } = await supabase
        .from('knowledge_relevance_scores')
        .delete()
        .eq('agent_id', progress.agent_id)
        .eq('requirement_id', requirements.id);
      
      if (!deleteError) {
        console.log('🗑️ Cleaned previous scores for fresh analysis');
      }
    }

    for (const chunk of chunks) {
      try {
        const scores = await analyzeChunk(chunk, requirements);
        const final = scores.semantic_relevance * progress.partial_results.weights.semantic_relevance +
                     scores.concept_coverage * progress.partial_results.weights.concept_coverage +
                     scores.procedural_match * progress.partial_results.weights.procedural_match +
                     scores.vocabulary_alignment * progress.partial_results.weights.vocabulary_alignment +
                     scores.bibliographic_match * progress.partial_results.weights.bibliographic_match;
        
        const { error: upsertError } = await supabase
          .from('knowledge_relevance_scores')
          .upsert({
            chunk_id: chunk.id,
            agent_id: progress.agent_id,
            requirement_id: requirements.id,
            semantic_relevance: scores.semantic_relevance,
            concept_coverage: scores.concept_coverage,
            procedural_match: scores.procedural_match,
            vocabulary_alignment: scores.vocabulary_alignment,
            bibliographic_match: scores.bibliographic_match,
            final_relevance_score: final,
            analysis_model: 'openai/gpt-5-mini',
            weights_used: progress.partial_results.weights,
            analyzed_at: new Date().toISOString()
          }, {
            onConflict: 'chunk_id,requirement_id'
          });

        if (upsertError) throw upsertError;
        
        successfullyProcessed++;
        console.log(`✅ Chunk ${chunk.id} analyzed: ${final.toFixed(3)}`);
      } catch (e: any) {
        failedChunks.push(chunk.id);
        console.error(`❌ Chunk ${chunk.id} failed:`, e.message);
        if (e.message?.includes('duplicate key')) {
          console.error(`   ⚠️ UPSERT conflict - questo non dovrebbe accadere!`);
        }
      }
    }

    const newProcessed = progress.chunks_processed + successfullyProcessed;
    const done = newProcessed >= progress.total_chunks;

    await supabase.from('alignment_analysis_progress').update({
      chunks_processed: newProcessed, 
      current_batch: progress.current_batch + 1,
      updated_at: new Date().toISOString(), 
      status: done ? 'completed' : 'running',
      partial_results: {
        ...progress.partial_results,
        failed_chunks: [...(progress.partial_results.failed_chunks || []), ...failedChunks],
        last_batch_size: successfullyProcessed
      }
    }).eq('id', progress.id);

    console.log(`📊 Batch ${progress.current_batch + 1}: ${successfullyProcessed}/${chunks.length} chunks processed. Total: ${newProcessed}/${progress.total_chunks}`);

    if (done) {
      await finalizeAnalysis(supabase, { ...progress, chunks_processed: newProcessed }, startTime);
      return new Response(JSON.stringify({ success: true, status: 'completed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Schedule next batch as guaranteed background task
    EdgeRuntime.waitUntil(
      supabase.functions.invoke('analyze-knowledge-alignment', {
        body: { agentId: progress.agent_id, progressId: progress.id }
      }).then(({ error }: any) => {
        if (error) {
          console.error('❌ Failed to invoke next batch:', error);
          supabase.from('alignment_analysis_progress').update({
            status: 'failed',
            error_message: `Auto-invocation failed: ${error.message}`
          }).eq('id', progress.id);
        } else {
          console.log('✅ Next batch scheduled');
        }
      })
    );
    
    return new Response(JSON.stringify({ 
      success: true, status: 'in_progress', chunks_processed: newProcessed, total_chunks: progress.total_chunks,
      percentage: Math.round((newProcessed / progress.total_chunks) * 100),
      batch_stats: { successful: successfullyProcessed, failed: failedChunks.length }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function finalizeAnalysis(supabase: any, progress: any, startTime: number) {
  const { data: requirements } = await supabase.from('agent_task_requirements').select('*').eq('id', progress.requirement_id).single();
  const { data: scores } = await supabase.from('knowledge_relevance_scores').select('*').eq('requirement_id', requirements.id);

  const avg = (field: string) => scores?.length ? (scores.reduce((s: number, x: any) => s + (x[field] || 0), 0) / scores.length) * 100 : 0;
  const overall = scores?.length ? (scores.reduce((s: number, x: any) => s + (x.final_relevance_score || 0), 0) / scores.length) * 100 : 0;

  const config = progress.partial_results.removal_config;
  const toRemove = scores?.filter((s: any) => s.final_relevance_score < config.threshold) || [];
  let removed = 0;

  if (toRemove.length <= config.maxRemovalsPerRun && !config.requiresApproval) {
    for (const s of toRemove) {
      await supabase.from('agent_knowledge').update({
        is_active: false, removed_at: new Date().toISOString(),
        removal_reason: `Score ${s.final_relevance_score.toFixed(3)} < ${config.threshold}`
      }).eq('id', s.chunk_id);
    }
    removed = toRemove.length;
  }

  await supabase.from('alignment_analysis_log').insert({
    agent_id: progress.agent_id, requirement_id: requirements.id, prerequisite_check_passed: true,
    overall_alignment_percentage: Math.round(overall * 100) / 100,
    dimension_breakdown: { semantic_relevance: avg('semantic_relevance'), concept_coverage: avg('concept_coverage'),
      procedural_match: avg('procedural_match'), vocabulary_alignment: avg('vocabulary_alignment'),
      bibliographic_match: avg('bibliographic_match') },
    total_chunks_analyzed: progress.total_chunks, chunks_flagged_for_removal: toRemove.length,
    chunks_auto_removed: removed, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
    analysis_config: progress.partial_results
  });
}

async function analyzeChunk(chunk: any, requirements: any, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`,
          'HTTP-Referer': Deno.env.get('SUPABASE_URL') || '',
        },
        body: JSON.stringify({
          model: 'openai/gpt-5-mini',
          messages: [{ role: 'user', content: `Score chunk (0-1 per dimension): ${JSON.stringify({
            concepts: requirements.theoretical_concepts, procedures: requirements.procedural_knowledge, vocab: requirements.domain_vocabulary,
            chunk: { doc: chunk.document_name, content: chunk.content.substring(0, 500) }
          })}. Return JSON: {"semantic_relevance":0-1,"concept_coverage":0-1,"procedural_match":0-1,"vocabulary_alignment":0-1,"bibliographic_match":0-1,"reasoning":""}` }],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      
      const data = await res.json();
      return JSON.parse(data.choices[0]?.message?.content);
      
    } catch (e: any) {
      if (attempt < retries) {
        console.log(`⚠️ Retry ${attempt + 1}/${retries} for chunk ${chunk.id}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
        continue;
      }
      throw e; // Final attempt failed
    }
  }
  throw new Error('All retry attempts exhausted');
}
