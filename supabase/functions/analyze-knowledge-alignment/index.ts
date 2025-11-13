import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// ADAPTIVE WEIGHTS SYSTEM (copied from src/utils/agentWeights.ts)
// Edge functions cannot import from src/, so we inline the logic here
// ============================================================================

interface ScoringWeights {
  semantic_relevance: number;
  concept_coverage: number;
  procedural_match: number;
  vocabulary_alignment: number;
  bibliographic_match: number;
}

const AGENT_TYPE_WEIGHTS: Record<string, ScoringWeights> = {
  conceptual: {
    semantic_relevance: 0.25,
    concept_coverage: 0.35,
    procedural_match: 0.10,
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.15
  },
  procedural: {
    semantic_relevance: 0.20,
    concept_coverage: 0.20,
    procedural_match: 0.35,
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.10
  },
  technical: {
    semantic_relevance: 0.25,
    concept_coverage: 0.25,
    procedural_match: 0.20,
    vocabulary_alignment: 0.20,
    bibliographic_match: 0.10
  },
  medical: {
    semantic_relevance: 0.20,
    concept_coverage: 0.30,
    procedural_match: 0.25,
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.10
  },
  legal: {
    semantic_relevance: 0.25,
    concept_coverage: 0.25,
    procedural_match: 0.20,
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.15
  }
};

function detectAgentType(systemPrompt: string): string {
  const promptLower = systemPrompt.toLowerCase();
  
  if (promptLower.includes('diagnose') || promptLower.includes('medical') || 
      promptLower.includes('health') || promptLower.includes('patient') ||
      promptLower.includes('clinical') || promptLower.includes('treatment')) {
    return 'medical';
  }
  
  if (promptLower.includes('code') || promptLower.includes('technical') || 
      promptLower.includes('engineer') || promptLower.includes('develop') ||
      promptLower.includes('programming') || promptLower.includes('software')) {
    return 'technical';
  }
  
  if (promptLower.includes('support') || promptLower.includes('help') || 
      promptLower.includes('guide') || promptLower.includes('assist') ||
      promptLower.includes('workflow') || promptLower.includes('procedure')) {
    return 'procedural';
  }
  
  if (promptLower.includes('legal') || promptLower.includes('contract') || 
      promptLower.includes('compliance') || promptLower.includes('law') ||
      promptLower.includes('regulation') || promptLower.includes('policy')) {
    return 'legal';
  }
  
  return 'conceptual';
}

function getWeightsForAgent(systemPrompt: string): ScoringWeights {
  const agentType = detectAgentType(systemPrompt);
  return AGENT_TYPE_WEIGHTS[agentType] || AGENT_TYPE_WEIGHTS.conceptual;
}

// ============================================================================
// SMART REMOVAL THRESHOLDS (copied from src/utils/removalThresholds.ts)
// ============================================================================

interface RemovalConfig {
  threshold: number;
  maxRemovalsPerRun: number;
  requiresApproval: boolean;
}

const AGENT_REMOVAL_THRESHOLDS: Record<string, RemovalConfig> = {
  conceptual: {
    threshold: 0.25,
    maxRemovalsPerRun: 20,
    requiresApproval: false
  },
  procedural: {
    threshold: 0.35,
    maxRemovalsPerRun: 15,
    requiresApproval: false
  },
  technical: {
    threshold: 0.40,
    maxRemovalsPerRun: 10,
    requiresApproval: true
  },
  medical: {
    threshold: 0.45,
    maxRemovalsPerRun: 5,
    requiresApproval: true
  },
  financial: {
    threshold: 0.40,
    maxRemovalsPerRun: 8,
    requiresApproval: true
  },
  legal: {
    threshold: 0.40,
    maxRemovalsPerRun: 8,
    requiresApproval: true
  }
};

function detectDomainCriticality(systemPrompt: string): 'high' | 'medium' | 'low' {
  const promptLower = systemPrompt.toLowerCase();
  
  const highCriticalityKeywords = [
    'medical', 'health', 'patient', 'diagnose', 'treatment',
    'financial', 'investment', 'money', 'compliance', 'legal',
    'safety', 'security', 'emergency', 'critical', 'regulation'
  ];
  
  const mediumCriticalityKeywords = [
    'technical', 'engineering', 'code', 'development',
    'contract', 'agreement', 'business', 'operational'
  ];
  
  if (highCriticalityKeywords.some(keyword => promptLower.includes(keyword))) {
    return 'high';
  }
  
  if (mediumCriticalityKeywords.some(keyword => promptLower.includes(keyword))) {
    return 'medium';
  }
  
  return 'low';
}

function getRemovalConfig(agentType: string, domainCriticality: 'high' | 'medium' | 'low' = 'medium'): RemovalConfig {
  const baseConfig = AGENT_REMOVAL_THRESHOLDS[agentType] || AGENT_REMOVAL_THRESHOLDS.conceptual;
  
  const criticalityMultipliers = {
    high: 1.1,
    medium: 1.0,
    low: 0.9
  };
  
  const adjustedThreshold = baseConfig.threshold * criticalityMultipliers[domainCriticality];
  
  return {
    ...baseConfig,
    threshold: Math.min(adjustedThreshold, 0.6)
  };
}

// ============================================================================
// MAIN EDGE FUNCTION
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { agentId, forceReanalysis } = await req.json();
    
    console.log('[analyze-alignment] Starting analysis for agent:', agentId);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Fetch agent and requirements
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('system_prompt')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (reqError || !requirements) {
      throw new Error('No requirements found. Run extract-task-requirements first.');
    }

    // Determine agent configuration based on system prompt
    const agentType = detectAgentType(agent.system_prompt);
    const domainCriticality = detectDomainCriticality(agent.system_prompt);
    const weights = getWeightsForAgent(agent.system_prompt);
    const removalConfig = getRemovalConfig(agentType, domainCriticality);

    console.log('[analyze-alignment] Agent configuration:', {
      type: agentType,
      criticality: domainCriticality,
      weights,
      removalThreshold: removalConfig.threshold
    });

    console.log('[analyze-alignment] Requirements loaded');

    // ==========================================
    // FASE 1: CHECK PREREQUISITI (GATING)
    // ==========================================
    console.log('[analyze-alignment] FASE 1: Checking bibliographic prerequisites...');
    
    const criticalSources = (requirements.bibliographic_references as any[])
      .filter(ref => ref.importance === 'critical');

    let prerequisiteCheck = {
      passed: true,
      missing_sources: [] as any[],
      critical_sources_found: criticalSources.length
    };

    if (criticalSources.length > 0) {
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('document_name')
        .eq('agent_id', agentId)
        .eq('is_active', true);

      const documentNames = (chunks || []).map(c => c.document_name.toLowerCase());
      
      prerequisiteCheck.missing_sources = criticalSources.filter(source => {
        const titleLower = source.title.toLowerCase();
        return !documentNames.some(doc => doc.includes(titleLower));
      });

      prerequisiteCheck.passed = prerequisiteCheck.missing_sources.length === 0;
      prerequisiteCheck.critical_sources_found = criticalSources.length - prerequisiteCheck.missing_sources.length;
    }

    // Save prerequisite check
    await supabase
      .from('prerequisite_checks')
      .insert({
        agent_id: agentId,
        requirement_id: requirements.id,
        check_passed: prerequisiteCheck.passed,
        missing_critical_sources: prerequisiteCheck.missing_sources,
        critical_sources_found: Array(prerequisiteCheck.critical_sources_found).fill({}),
      });

    if (!prerequisiteCheck.passed) {
      console.log('❌ [analyze-alignment] Prerequisiti non passati - BLOCCO analisi');
      
      await supabase
        .from('alignment_analysis_log')
        .insert({
          agent_id: agentId,
          requirement_id: requirements.id,
          prerequisite_check_passed: false,
          missing_critical_sources: prerequisiteCheck.missing_sources,
          total_chunks_analyzed: 0,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          analysis_config: {
            agent_type: agentType,
            domain_criticality: domainCriticality,
            weights_used: weights,
            removal_threshold: removalConfig.threshold
          }
        });

      return new Response(
        JSON.stringify({
          success: false,
          blocked: true,
          reason: 'Missing critical bibliographic sources',
          missing_sources: prerequisiteCheck.missing_sources
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [analyze-alignment] Prerequisiti passati - PROCEDO con scoring');

    // ==========================================
    // FASE 2: SCORING QUALITATIVO (5 DIMENSIONI)
    // ==========================================
    console.log('[analyze-alignment] FASE 2: Starting quality scoring...');

    const { data: activeChunks } = await supabase
      .from('agent_knowledge')
      .select('*')
      .eq('agent_id', agentId)
      .eq('is_active', true);

    if (!activeChunks || activeChunks.length === 0) {
      throw new Error('No active knowledge chunks found');
    }

    console.log(`[analyze-alignment] Analyzing ${activeChunks.length} chunks...`);

    // Analyze chunks in batches
    const BATCH_SIZE = 10;
    let totalScored = 0;
    const chunkScores: Array<{chunk_id: string, final_score: number}> = [];

    for (let i = 0; i < activeChunks.length; i += BATCH_SIZE) {
      const batch = activeChunks.slice(i, i + BATCH_SIZE);
      
      for (const chunk of batch) {
        try {
          const scores = await analyzeChunkWithAI(chunk, requirements);
          const finalScore = calculateWeightedScore(scores, weights);
          
          await supabase
            .from('knowledge_relevance_scores')
            .insert({
              chunk_id: chunk.id,
              agent_id: agentId,
              requirement_id: requirements.id,
              semantic_relevance: scores.semantic_relevance,
              concept_coverage: scores.concept_coverage,
              procedural_match: scores.procedural_match,
              vocabulary_alignment: scores.vocabulary_alignment,
              bibliographic_match: scores.bibliographic_match,
              final_relevance_score: finalScore,
              analysis_model: 'openai/gpt-5-mini',
              analysis_reasoning: scores.reasoning,
              weights_used: weights
            });

          chunkScores.push({ chunk_id: chunk.id, final_score: finalScore });
          totalScored++;
        } catch (error) {
          console.error(`[analyze-alignment] Error scoring chunk ${chunk.id}:`, error);
        }
      }

      console.log(`[analyze-alignment] Progress: ${Math.min(i + BATCH_SIZE, activeChunks.length)}/${activeChunks.length}`);
    }

    // Calculate overall metrics
    const { data: allScores } = await supabase
      .from('knowledge_relevance_scores')
      .select('*')
      .eq('requirement_id', requirements.id);

    const overallAlignment = allScores && allScores.length > 0
      ? (allScores.reduce((sum, s) => sum + (s.final_relevance_score || 0), 0) / allScores.length) * 100
      : 0;

    const dimensionBreakdown = {
      semantic_relevance: allScores && allScores.length > 0
        ? (allScores.reduce((sum, s) => sum + (s.semantic_relevance || 0), 0) / allScores.length) * 100
        : 0,
      concept_coverage: allScores && allScores.length > 0
        ? (allScores.reduce((sum, s) => sum + (s.concept_coverage || 0), 0) / allScores.length) * 100
        : 0,
      procedural_match: allScores && allScores.length > 0
        ? (allScores.reduce((sum, s) => sum + (s.procedural_match || 0), 0) / allScores.length) * 100
        : 0,
      vocabulary_alignment: allScores && allScores.length > 0
        ? (allScores.reduce((sum, s) => sum + (s.vocabulary_alignment || 0), 0) / allScores.length) * 100
        : 0,
      bibliographic_match: allScores && allScores.length > 0
        ? (allScores.reduce((sum, s) => sum + (s.bibliographic_match || 0), 0) / allScores.length) * 100
        : 0
    };

    // Handle low relevance chunks with ADAPTIVE THRESHOLDS
    const chunksToRemove = chunkScores.filter(s => s.final_score < removalConfig.threshold);
    let chunksAutoRemoved = 0;
    let requiresManualApproval = false;

    console.log(`[analyze-alignment] Removal config for ${agentType}/${domainCriticality}:`, removalConfig);
    console.log(`[analyze-alignment] Chunks below threshold ${removalConfig.threshold}: ${chunksToRemove.length}`);

    if (chunksToRemove.length <= removalConfig.maxRemovalsPerRun && !removalConfig.requiresApproval) {
      for (const chunk of chunksToRemove) {
        await supabase
          .from('agent_knowledge')
          .update({
            is_active: false,
            removed_at: new Date().toISOString(),
            removal_reason: `Relevance score ${chunk.final_score.toFixed(3)} below adaptive threshold ${removalConfig.threshold} for ${agentType} agent (criticality: ${domainCriticality})`
          })
          .eq('id', chunk.chunk_id);
      }
      chunksAutoRemoved = chunksToRemove.length;
    } else {
      requiresManualApproval = true;
      console.log(`[analyze-alignment] Manual approval required: ${chunksToRemove.length} chunks to remove`);
    }

    // Save analysis log with full configuration
    await supabase
      .from('alignment_analysis_log')
      .insert({
        agent_id: agentId,
        requirement_id: requirements.id,
        prerequisite_check_passed: true,
        missing_critical_sources: [],
        overall_alignment_percentage: Math.round(overallAlignment * 100) / 100,
        dimension_breakdown: dimensionBreakdown,
        total_chunks_analyzed: totalScored,
        chunks_flagged_for_removal: chunksToRemove.length,
        chunks_auto_removed: chunksAutoRemoved,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        analysis_config: {
          agent_type: agentType,
          domain_criticality: domainCriticality,
          weights_used: weights,
          removal_threshold: removalConfig.threshold,
          removal_max: removalConfig.maxRemovalsPerRun,
          requires_approval: removalConfig.requiresApproval
        }
      });

    console.log('[analyze-alignment] Analysis completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        overall_alignment_percentage: Math.round(overallAlignment * 100) / 100,
        dimension_breakdown: {
          semantic_relevance: Math.round(dimensionBreakdown.semantic_relevance * 100) / 100,
          concept_coverage: Math.round(dimensionBreakdown.concept_coverage * 100) / 100,
          procedural_match: Math.round(dimensionBreakdown.procedural_match * 100) / 100,
          vocabulary_alignment: Math.round(dimensionBreakdown.vocabulary_alignment * 100) / 100,
          bibliographic_match: Math.round(dimensionBreakdown.bibliographic_match * 100) / 100
        },
        chunks_analyzed: totalScored,
        chunks_removed: chunksAutoRemoved,
        requires_manual_approval: requiresManualApproval,
        analysis_config: {
          agent_type: agentType,
          domain_criticality: domainCriticality,
          weights_used: weights,
          removal_threshold: removalConfig.threshold
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[analyze-alignment] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzeChunkWithAI(chunk: any, requirements: any) {
  // FASE 4: IMPROVED AI PROMPT (user-provided detailed prompt)
  const prompt = `CRITICAL: Score based ONLY on WHAT IS EXPLICITLY IN THE CHUNK TEXT. Do not use your external knowledge or make assumptions.

AGENT REQUIREMENTS:
${JSON.stringify(requirements, null, 2)}

KNOWLEDGE CHUNK TO ANALYZE:
Document: ${chunk.document_name}
Content: ${chunk.content.substring(0, 1000)}...

ANALYZE THESE 5 DIMENSIONS with STRICT CRITERIA:

## 1. SEMANTIC_RELEVANCE - General topic alignment
- 1.0: Directly addresses agent's PRIMARY task from requirements
- 0.7: Related to secondary tasks or provides useful context  
- 0.4: Tangentially related, background information only
- 0.0: Completely unrelated to agent's purpose

EDGE CASES:
- If chunk is about "medical diagnosis" but agent is financial → 0.0
- If chunk provides historical context for current procedures → 0.4
- If chunk explains core methodology agent uses → 1.0
- If chunk is about general concepts in agent's domain → 0.7

## 2. CONCEPT_COVERAGE - Required theoretical concepts
- 1.0: Explains MULTIPLE core concepts from "theoretical_concepts" in depth
- 0.7: Covers 1-2 core concepts with substantive explanations
- 0.4: Mentions concepts briefly without substantive content
- 0.0: No relevant concepts from requirements

EDGE CASES:
- If mentions concept names but doesn't explain → 0.4
- If explains related concepts not in requirements → 0.0
- If deeply explains one critical concept → 0.7
- If defines concepts from requirements → 1.0

## 3. PROCEDURAL_MATCH - Step-by-step methodologies
- 1.0: Provides COMPLETE workflow from "procedural_knowledge" requirements with actionable steps
- 0.7: Contains partial procedures or methodologies with some actionable elements
- 0.4: Mentions procedures conceptually without specific implementation details
- 0.0: No procedural content matching requirements

EDGE CASES:
- If describes "how to calculate" without formulas → 0.4
- If provides alternative workflow not in requirements → 0.0
- If gives troubleshooting for required procedures → 0.7
- If chunk is purely theoretical about procedures → 0.4

## 4. VOCABULARY_ALIGNMENT - Domain terminology usage
- 1.0: Uses 3+ terms from "domain_vocabulary" correctly in operational context
- 0.7: Uses 1-2 domain terms appropriately with proper context
- 0.4: Uses basic domain terms occasionally or in generic context
- 0.0: No domain-specific vocabulary from requirements

EDGE CASES:
- If uses synonyms instead of exact required terms → 0.4
- If uses terms incorrectly or out of context → 0.0
- If defines/explains required terms → 1.0
- If uses terms only in examples/dialogue → 0.4

## 5. BIBLIOGRAPHIC_MATCH - Connection to required sources
- 1.0: DIRECT QUOTES or extensive citation of required "bibliographic_references"
- 0.7: Substantial content from required source without direct citation
- 0.4: Mentions similar topics/sources tangentially related
- 0.0: No connection to required bibliographic references

EDGE CASES:
- If cites "Che Guevara Biography" vs exact "Che Guevara - A Biography.pdf" → 0.7
- If discusses same historical events from different source → 0.4
- If exact title match with specific page/chapter references → 1.0
- If references updated version of required source → 0.7

## 🚫 STRICT SCORING RULES - ENFORCE THESE:

❌ NEVER assume knowledge not explicitly stated in chunk text
❌ NEVER score based on your external domain knowledge  
❌ NEVER infer connections not explicitly written in content
❌ NEVER extrapolate beyond the literal words in the chunk
❌ NEVER consider examples/dialogues as primary content for scoring

## ✅ VALIDATION CHECK - BEFORE FINALIZING SCORES:

For each dimension, ask:
1. "Is this score based SOLELY on explicit chunk content?"
2. "Can I point to specific text that justifies this score?"
3. "Am I following the exact criteria scale provided?"
4. "Have I excluded all external knowledge from consideration?"

## 📊 RESPONSE FORMAT - STRICT JSON ONLY:

{
  "semantic_relevance": 0.0,
  "concept_coverage": 0.0, 
  "procedural_match": 0.0,
  "vocabulary_alignment": 0.0,
  "bibliographic_match": 0.0,
  "reasoning": "Concise justification referencing specific criteria and chunk content. Maximum 2 sentences per dimension."
}

## 🎯 SCORING CALIBRATION EXAMPLES:

EXAMPLE 1 - High Alignment:
Chunk: "According to Financial Compliance Guidelines 2023, risk assessment requires calculating Value at Risk using the formula: VaR = Portfolio Value × Z-score × Volatility. This procedural methodology must be documented in audit trails."
Scores: {
  "semantic_relevance": 1.0,
  "concept_coverage": 0.7,
  "procedural_match": 1.0,
  "vocabulary_alignment": 1.0,
  "bibliographic_match": 1.0
}

EXAMPLE 2 - Medium Alignment:
Chunk: "Risk management involves assessing potential financial losses. Companies should maintain proper documentation for regulatory compliance purposes."
Scores: {
  "semantic_relevance": 0.7,
  "concept_coverage": 0.4,
  "procedural_match": 0.0,
  "vocabulary_alignment": 0.7,
  "bibliographic_match": 0.0
}

EXAMPLE 3 - Low Alignment:
Chunk: "General business operations require effective team management and communication strategies for organizational success."
Scores: {
  "semantic_relevance": 0.0,
  "concept_coverage": 0.0,
  "procedural_match": 0.0,
  "vocabulary_alignment": 0.0,
  "bibliographic_match": 0.0
}

REMEMBER: Your scoring will be verified against deterministic rules. Inconsistent or biased scoring will be detected and invalidated.

Before finalizing response, verify:
1. All scores are between 0.0 and 1.0
2. Reasoning explicitly references chunk content and criteria
3. No external knowledge influenced the scoring
4. JSON structure is exact and valid
5. Each dimension has clear justification

FINAL VALIDATION: If any score seems inconsistent with the explicit criteria, revise it to match the defined scale exactly.

Respond with ONLY the JSON object. No additional commentary.`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }

  const aiData = await response.json();
  const content = aiData.choices[0].message.content;
  
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error('Invalid AI response format');
  }
}

function calculateWeightedScore(scores: any, weights: ScoringWeights): number {
  return (
    (scores.semantic_relevance * weights.semantic_relevance) +
    (scores.concept_coverage * weights.concept_coverage) +
    (scores.procedural_match * weights.procedural_match) +
    (scores.vocabulary_alignment * weights.vocabulary_alignment) +
    ((scores.bibliographic_match || 0) * weights.bibliographic_match)
  );
}
