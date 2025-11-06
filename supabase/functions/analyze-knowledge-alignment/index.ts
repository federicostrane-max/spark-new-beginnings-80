import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CONFIG = {
  auto_removal: {
    enabled: true,
    threshold: 0.3,
    max_removals_per_run: 50,
    cooldown_minutes: 60,
  },
  safe_mode: {
    duration_days: 7,
  },
  score_weights: {
    semantic_relevance: 0.35,
    concept_coverage: 0.30,
    procedural_match: 0.20,
    vocabulary_alignment: 0.15,
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, forceReanalysis = false } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: 'Agent ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[analyze-alignment] Starting analysis for agent:', agentId);

    // Check cooldown
    if (!forceReanalysis) {
      const { data: lastLog } = await supabase
        .from('alignment_analysis_log')
        .select('started_at')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (lastLog) {
        const timeSinceLastAnalysis = Date.now() - new Date(lastLog.started_at).getTime();
        const cooldownMs = CONFIG.auto_removal.cooldown_minutes * 60 * 1000;
        
        if (timeSinceLastAnalysis < cooldownMs) {
          console.log('[analyze-alignment] Cooldown active, skipping');
          return new Response(
            JSON.stringify({ 
              success: false, 
              message: 'Cooldown active',
              next_analysis_available_at: new Date(new Date(lastLog.started_at).getTime() + cooldownMs).toISOString(),
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Check safe mode
    const { data: agent } = await supabase
      .from('agents')
      .select('first_alignment_completed_at')
      .eq('id', agentId)
      .single();

    const safeModeActive = !agent?.first_alignment_completed_at || 
      (Date.now() - new Date(agent.first_alignment_completed_at).getTime()) < (CONFIG.safe_mode.duration_days * 24 * 60 * 60 * 1000);

    console.log('[analyze-alignment] Safe mode:', safeModeActive);

    // Fetch requirements
    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (reqError || !requirements) {
      console.error('[analyze-alignment] Requirements not found:', reqError);
      return new Response(
        JSON.stringify({ error: 'Task requirements not found. Run extract-task-requirements first.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch active chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('id, content, category, summary, document_name')
      .eq('agent_id', agentId)
      .eq('is_active', true);

    if (chunksError) {
      console.error('[analyze-alignment] Chunks fetch error:', chunksError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch chunks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[analyze-alignment] Analyzing', chunks?.length || 0, 'chunks');

    // Create analysis log
    const { data: analysisLog, error: logError } = await supabase
      .from('alignment_analysis_log')
      .insert({
        agent_id: agentId,
        trigger_type: forceReanalysis ? 'manual' : 'scheduled',
        total_chunks_analyzed: chunks?.length || 0,
        chunks_flagged_for_removal: 0,
        safe_mode_active: safeModeActive,
      })
      .select()
      .single();

    if (logError) {
      console.error('[analyze-alignment] Log creation error:', logError);
      return new Response(
        JSON.stringify({ error: 'Failed to create analysis log' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
    const chunkScores: Array<{ chunk_id: string; final_score: number }> = [];
    let analysisConcurrent = 0;
    const maxConcurrent = 5;

    // Analyze chunks in batches
    if (chunks && chunks.length > 0) {
      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        
        await Promise.all(batch.map(async (chunk) => {
          try {
            const analysisPrompt = `Analyze this knowledge chunk against the agent's task requirements.

Task Requirements:
${JSON.stringify(requirements, null, 2)}

Knowledge Chunk:
- Content: ${chunk.content.substring(0, 1000)}${chunk.content.length > 1000 ? '...' : ''}
- Category: ${chunk.category}
- Summary: ${chunk.summary || 'N/A'}

Rate relevance (0.0-1.0) for:
- semantic_relevance: How semantically related is this to core concepts?
- concept_coverage: Does it cover key concepts needed?
- procedural_match: Does it support workflows/processes?
- vocabulary_alignment: Does it use domain vocabulary?

Return ONLY valid JSON:
{
  "semantic_relevance": 0.0-1.0,
  "concept_coverage": 0.0-1.0,
  "procedural_match": 0.0-1.0,
  "vocabulary_alignment": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'openai/gpt-5-mini',
                messages: [
                  { role: 'system', content: 'You are an expert at analyzing knowledge relevance. Return only valid JSON.' },
                  { role: 'user', content: analysisPrompt }
                ],
              }),
            });

            if (!aiResponse.ok) {
              console.error('[analyze-alignment] AI error for chunk:', chunk.id);
              return;
            }

            const aiData = await aiResponse.json();
            let scores;
            try {
              const content = aiData.choices[0].message.content;
              scores = JSON.parse(content);
            } catch {
              const content = aiData.choices[0].message.content;
              const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
              if (jsonMatch) {
                scores = JSON.parse(jsonMatch[1]);
              } else {
                console.error('[analyze-alignment] Failed to parse scores for chunk:', chunk.id);
                return;
              }
            }

            // Calculate final score
            const finalScore = 
              (scores.semantic_relevance * CONFIG.score_weights.semantic_relevance) +
              (scores.concept_coverage * CONFIG.score_weights.concept_coverage) +
              (scores.procedural_match * CONFIG.score_weights.procedural_match) +
              (scores.vocabulary_alignment * CONFIG.score_weights.vocabulary_alignment);

            // Store score
            await supabase
              .from('knowledge_relevance_scores')
              .upsert({
                chunk_id: chunk.id,
                agent_id: agentId,
                requirement_id: requirements.id,
                semantic_relevance: scores.semantic_relevance,
                concept_coverage: scores.concept_coverage,
                procedural_match: scores.procedural_match,
                vocabulary_alignment: scores.vocabulary_alignment,
                final_relevance_score: finalScore,
                analysis_model: 'openai/gpt-5-mini',
                analysis_reasoning: scores.reasoning,
                analyzed_at: new Date().toISOString(),
              }, {
                onConflict: 'chunk_id,requirement_id',
              });

            chunkScores.push({ chunk_id: chunk.id, final_score: finalScore });

          } catch (error) {
            console.error('[analyze-alignment] Error analyzing chunk:', chunk.id, error);
          }
        }));

        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between batches
      }
    }

    // Identify chunks for removal
    const chunksToRemove = chunkScores.filter(s => s.final_score < CONFIG.auto_removal.threshold);
    console.log('[analyze-alignment] Chunks flagged for removal:', chunksToRemove.length);

    let chunksAutoRemoved = 0;
    let requiresManualApproval = false;

    // Auto-removal logic
    if (!safeModeActive && CONFIG.auto_removal.enabled && chunksToRemove.length > 0) {
      if (chunksToRemove.length > CONFIG.auto_removal.max_removals_per_run) {
        console.log('[analyze-alignment] Too many chunks to remove, flagging for manual approval');
        requiresManualApproval = true;
      } else {
        console.log('[analyze-alignment] Auto-removing', chunksToRemove.length, 'chunks');
        
        for (const { chunk_id, final_score } of chunksToRemove) {
          const { data: chunk } = await supabase
            .from('agent_knowledge')
            .select('*')
            .eq('id', chunk_id)
            .single();

          if (chunk) {
            // Backup to history
            await supabase
              .from('knowledge_removal_history')
              .insert({
                chunk_id: chunk.id,
                agent_id: chunk.agent_id,
                document_name: chunk.document_name,
                content: chunk.content,
                category: chunk.category,
                summary: chunk.summary,
                embedding: chunk.embedding,
                pool_document_id: chunk.pool_document_id,
                source_type: chunk.source_type,
                removal_reason: 'auto_removed_low_relevance',
                final_relevance_score: final_score,
                removal_type: 'auto',
              });

            // Soft delete
            await supabase
              .from('agent_knowledge')
              .update({
                is_active: false,
                removed_at: new Date().toISOString(),
                removal_reason: `Auto-removed: relevance score ${final_score.toFixed(2)} below threshold ${CONFIG.auto_removal.threshold}`,
              })
              .eq('id', chunk_id);

            chunksAutoRemoved++;
          }
        }
      }
    }

    // Update first alignment timestamp if needed
    if (!agent?.first_alignment_completed_at) {
      await supabase
        .from('agents')
        .update({ first_alignment_completed_at: new Date().toISOString() })
        .eq('id', agentId);
    }

    // Calculate coverage metrics
    const conceptCoverage = 75; // Placeholder - would need more sophisticated calculation
    const gaps: any[] = []; // Placeholder
    const surplus: any[] = []; // Placeholder

    // Update analysis log
    await supabase
      .from('alignment_analysis_log')
      .update({
        chunks_flagged_for_removal: chunksToRemove.length,
        chunks_auto_removed: chunksAutoRemoved,
        concept_coverage_percentage: conceptCoverage,
        identified_gaps: gaps,
        surplus_categories: surplus,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - new Date(analysisLog.started_at).getTime(),
      })
      .eq('id', analysisLog.id);

    console.log('[analyze-alignment] Analysis completed');

    return new Response(
      JSON.stringify({
        success: true,
        analysis_id: analysisLog.id,
        safe_mode_active: safeModeActive,
        total_chunks_analyzed: chunks?.length || 0,
        chunks_flagged_for_removal: chunksToRemove.length,
        chunks_auto_removed: chunksAutoRemoved,
        requires_manual_approval: requiresManualApproval,
        concept_coverage_percentage: conceptCoverage,
        identified_gaps: gaps,
        surplus_categories: surplus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[analyze-alignment] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
