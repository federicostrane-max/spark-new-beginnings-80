import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEIGHTS = {
  semantic_relevance: 0.30,
  concept_coverage: 0.25,
  procedural_match: 0.15,
  vocabulary_alignment: 0.10,
  bibliographic_match: 0.20
};

const REMOVAL_THRESHOLD = 0.30;
const MAX_AUTO_REMOVALS = 50;

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

    // 1. Fetch requirements
    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (reqError || !requirements) {
      throw new Error('No requirements found. Run extract-task-requirements first.');
    }

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
          duration_ms: Date.now() - startTime
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
          const finalScore = calculateWeightedScore(scores);
          
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
              analysis_reasoning: scores.reasoning
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

    // Handle low relevance chunks
    const chunksToRemove = chunkScores.filter(s => s.final_score < REMOVAL_THRESHOLD);
    let chunksAutoRemoved = 0;
    let requiresManualApproval = false;

    if (chunksToRemove.length <= MAX_AUTO_REMOVALS) {
      for (const chunk of chunksToRemove) {
        await supabase
          .from('agent_knowledge')
          .update({
            is_active: false,
            removed_at: new Date().toISOString(),
            removal_reason: `relevance score ${chunk.final_score.toFixed(3)} below threshold ${REMOVAL_THRESHOLD}`
          })
          .eq('id', chunk.chunk_id);
      }
      chunksAutoRemoved = chunksToRemove.length;
    } else {
      requiresManualApproval = true;
    }

    // Save analysis log
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
        duration_ms: Date.now() - startTime
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
        requires_manual_approval: requiresManualApproval
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[analyze-alignment] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzeChunkWithAI(chunk: any, requirements: any) {
  const prompt = `Analyze this knowledge chunk against agent requirements.

REQUIREMENTS:
- Theoretical Concepts: ${requirements.theoretical_concepts.join(', ')}
- Operational Concepts: ${requirements.operational_concepts.join(', ')}
- Procedural Knowledge: ${requirements.procedural_knowledge.join(', ')}
- Explicit Rules: ${requirements.explicit_rules.join(', ')}
- Domain Vocabulary: ${requirements.domain_vocabulary.join(', ')}

CHUNK TO ANALYZE:
Document: ${chunk.document_name}
Category: ${chunk.category}
Content: ${chunk.content.substring(0, 800)}...

Score each dimension 0.0-1.0:

1. SEMANTIC_RELEVANCE: How relevant to agent's core task?
   - 1.0: Directly addresses primary task domain
   - 0.7: Related to secondary tasks
   - 0.4: Tangentially related
   - 0.0: Completely unrelated

2. CONCEPT_COVERAGE: Covers theoretical/operational concepts?
   - 1.0: Explains multiple concepts in depth
   - 0.7: Covers some concepts well
   - 0.4: Mentions concepts briefly
   - 0.0: No relevant concepts

3. PROCEDURAL_MATCH: Contains needed procedures/rules?
   - 1.0: Complete step-by-step procedures
   - 0.7: Partial procedures
   - 0.4: Mentions procedures without steps
   - 0.0: No procedural content

4. VOCABULARY_ALIGNMENT: Uses required domain terms?
   - 1.0: Uses multiple domain terms correctly
   - 0.7: Uses some domain terms
   - 0.4: Basic domain terms occasionally
   - 0.0: No domain vocabulary

5. BIBLIOGRAPHIC_MATCH: Quality of use of sources?
   - 1.0: Directly from required sources
   - 0.7: Cites related sources
   - 0.4: Mentions similar sources
   - 0.0: No connection to required sources

Return ONLY valid JSON:
{
  "semantic_relevance": 0.0,
  "concept_coverage": 0.0,
  "procedural_match": 0.0,
  "vocabulary_alignment": 0.0,
  "bibliographic_match": 0.0,
  "reasoning": "brief explanation"
}`;

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

function calculateWeightedScore(scores: any): number {
  return (
    (scores.semantic_relevance * WEIGHTS.semantic_relevance) +
    (scores.concept_coverage * WEIGHTS.concept_coverage) +
    (scores.procedural_match * WEIGHTS.procedural_match) +
    (scores.vocabulary_alignment * WEIGHTS.vocabulary_alignment) +
    ((scores.bibliographic_match || 0) * WEIGHTS.bibliographic_match)
  );
}
