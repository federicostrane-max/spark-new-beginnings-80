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
  batch_processing: {
    batch_size: 100, // Reduced to 100 to stay under 150s timeout
    max_concurrent: 20, // Increased to 20 to compensate
  },
  retry: {
    max_attempts: 3,
    initial_delay_ms: 1000,
    max_delay_ms: 10000,
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

    // Get total chunks count
    const { count: totalChunks } = await supabase
      .from('agent_knowledge')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('is_active', true);

    console.log('[analyze-alignment] Total chunks:', totalChunks);

    if (!totalChunks || totalChunks === 0) {
      console.log('[analyze-alignment] No active chunks found for agent');
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'No active knowledge chunks found for this agent',
          total_chunks: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing analysis log to resume
    const { data: existingLog } = await supabase
      .from('alignment_analysis_log')
      .select('*')
      .eq('agent_id', agentId)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const startOffset = existingLog?.progress_chunks_analyzed || 0;
    const endOffset = Math.min(startOffset + CONFIG.batch_processing.batch_size, totalChunks);

    console.log('[analyze-alignment] Batch range:', startOffset, '-', endOffset);

    // Fetch batch of chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('id, content, category, summary, document_name')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .range(startOffset, endOffset - 1);

    if (chunksError) {
      console.error('[analyze-alignment] Chunks fetch error:', chunksError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch chunks', details: chunksError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[analyze-alignment] Processing batch of', chunks?.length || 0, 'chunks');

    // Use existing log or create new one
    let analysisLog = existingLog;
    
    if (!analysisLog) {
      const { data: newLog, error: logError } = await supabase
        .from('alignment_analysis_log')
        .insert({
          agent_id: agentId,
          trigger_type: forceReanalysis ? 'manual' : 'scheduled',
          total_chunks_analyzed: totalChunks || 0,
          chunks_flagged_for_removal: 0,
          safe_mode_active: safeModeActive,
          progress_chunks_analyzed: 0,
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
      
      analysisLog = newLog;
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
    const chunkScores: Array<{ chunk_id: string; final_score: number }> = [];
    const maxConcurrent = CONFIG.batch_processing.max_concurrent;

    // Resume logic: Check which chunks already have scores (skip if force reanalysis)
    let chunksToAnalyze = chunks || [];
    
    if (!forceReanalysis) {
      const { data: existingScores } = await supabase
        .from('knowledge_relevance_scores')
        .select('chunk_id')
        .eq('requirement_id', requirements.id);

      const analyzedChunkIds = new Set(existingScores?.map(s => s.chunk_id) || []);
      chunksToAnalyze = chunks?.filter(c => !analyzedChunkIds.has(c.id)) || [];

      console.log('[analyze-alignment] Already analyzed:', analyzedChunkIds.size, 'chunks');
      console.log('[analyze-alignment] Need to analyze:', chunksToAnalyze.length, 'chunks');
    } else {
      console.log('[analyze-alignment] Force reanalysis: analyzing all', chunksToAnalyze.length, 'chunks in batch');
    }

    // Helper function to call AI with retry logic
    const callAIWithRetry = async (chunk: any, attempt = 1): Promise<any> => {
      const analysisPrompt = `Analyze chunk vs requirements.

Requirements: ${JSON.stringify(requirements, null, 2)}
Chunk: ${chunk.content.substring(0, 500)}...
Category: ${chunk.category}

Rate 0.0-1.0: semantic_relevance, concept_coverage, procedural_match, vocabulary_alignment
JSON only: {"semantic_relevance": 0.0, "concept_coverage": 0.0, "procedural_match": 0.0, "vocabulary_alignment": 0.0, "reasoning": "brief"}`;

      try {
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
          const errorText = await aiResponse.text();
          
          // Check if we should retry
          if (attempt < CONFIG.retry.max_attempts && (aiResponse.status === 429 || aiResponse.status >= 500)) {
            const delay = Math.min(
              CONFIG.retry.initial_delay_ms * Math.pow(2, attempt - 1),
              CONFIG.retry.max_delay_ms
            );
            console.log(`[analyze-alignment] Retry ${attempt}/${CONFIG.retry.max_attempts} for chunk ${chunk.id} after ${delay}ms (status: ${aiResponse.status})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callAIWithRetry(chunk, attempt + 1);
          }
          
          throw new Error(`AI API error (${aiResponse.status}): ${errorText}`);
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
            throw new Error('Failed to parse AI response JSON');
          }
        }

        return scores;
      } catch (error: any) {
        if (attempt < CONFIG.retry.max_attempts) {
          const delay = Math.min(
            CONFIG.retry.initial_delay_ms * Math.pow(2, attempt - 1),
            CONFIG.retry.max_delay_ms
          );
          console.log(`[analyze-alignment] Retry ${attempt}/${CONFIG.retry.max_attempts} for chunk ${chunk.id} after ${delay}ms (error: ${error?.message || 'Unknown'})`);

          await new Promise(resolve => setTimeout(resolve, delay));
          return callAIWithRetry(chunk, attempt + 1);
        }
        throw error;
      }
    };

    // Analyze chunks in batches with improved error handling
    let successCount = 0;
    let errorCount = 0;
    
    if (chunksToAnalyze.length > 0) {
      for (let i = 0; i < chunksToAnalyze.length; i += maxConcurrent) {
        const batch = chunksToAnalyze.slice(i, i + maxConcurrent);
        console.log(`[analyze-alignment] Processing batch ${Math.floor(i / maxConcurrent) + 1}, chunks ${i + 1}-${i + batch.length}/${chunksToAnalyze.length}`);
        
        const results = await Promise.allSettled(batch.map(async (chunk) => {
          try {
            const scores = await callAIWithRetry(chunk);

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
            successCount++;
            
          } catch (error: any) {
            console.error('[analyze-alignment] Failed to analyze chunk after retries:', chunk.id, error?.message || 'Unknown error');

            errorCount++;
            throw error;
          }
        }));

        // Log batch results
        const batchSuccess = results.filter(r => r.status === 'fulfilled').length;
        const batchErrors = results.filter(r => r.status === 'rejected').length;
        console.log(`[analyze-alignment] Batch completed: ${batchSuccess} success, ${batchErrors} errors`);

        // Reduced delay between batches for faster overall processing
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    console.log(`[analyze-alignment] Total results: ${successCount} success, ${errorCount} errors`);

    // Calculate if more batches are needed
    const currentProgress = startOffset + (chunks?.length || 0);
    console.log(`[analyze-alignment] Progress: ${currentProgress}/${totalChunks} chunks analyzed`);
    const moreBatchesNeeded = currentProgress < (totalChunks || 0);

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

    // Calculate real coverage metrics
    const { data: allScores } = await supabase
      .from('knowledge_relevance_scores')
      .select('concept_coverage, semantic_relevance, chunk_id')
      .eq('requirement_id', requirements.id);

    const totalScored = allScores?.length || 0;
    const avgConceptCoverage = totalScored > 0
      ? (allScores!.reduce((sum, s) => sum + (s.concept_coverage || 0), 0) / totalScored) * 100
      : 0;

    // Identify gaps (core concepts with low coverage)
    const coreConcepts = requirements.core_concepts || [];
    const gaps = coreConcepts.filter((concept: any) => {
      const conceptScores = allScores?.filter(s => s.concept_coverage < 0.5) || [];
      return conceptScores.length > totalScored * 0.3; // More than 30% of chunks have low coverage
    }).slice(0, 5); // Top 5 gaps

    // Identify surplus (categories with many low-scoring chunks)
    const categoryScores = new Map<string, number[]>();
    chunks?.forEach(chunk => {
      const score = allScores?.find(s => s.chunk_id === chunk.id);
      if (score) {
        const scores = categoryScores.get(chunk.category) || [];
        scores.push(score.semantic_relevance);
        categoryScores.set(chunk.category, scores);
      }
    });

    const surplus = Array.from(categoryScores.entries())
      .filter(([_, scores]) => {
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        return avgScore < 0.3 && scores.length > 3;
      })
      .map(([category, _]) => category)
      .slice(0, 5);

    // Count actual chunks analyzed (saved in DB)
    const { count: actualAnalyzedCount } = await supabase
      .from('knowledge_relevance_scores')
      .select('*', { count: 'exact', head: true })
      .eq('requirement_id', requirements.id);

    const realProgress = actualAnalyzedCount || 0;
    console.log(`[analyze-alignment] Real progress from DB: ${realProgress}/${totalChunks} chunks`);

    // Update analysis log with real progress
    const updateData: any = {
      chunks_flagged_for_removal: chunksToRemove.length,
      progress_chunks_analyzed: realProgress, // Use real DB count instead of estimated
      chunks_auto_removed: chunksAutoRemoved,
      concept_coverage_percentage: avgConceptCoverage,
      identified_gaps: gaps,
      surplus_categories: surplus,
    };

    // Mark as completed only if all batches are done
    if (!moreBatchesNeeded) {
      updateData.completed_at = new Date().toISOString();
      updateData.duration_ms = Date.now() - new Date(analysisLog.started_at).getTime();
    }

    await supabase
      .from('alignment_analysis_log')
      .update(updateData)
      .eq('id', analysisLog.id);

    const statusMessage = moreBatchesNeeded 
      ? `Batch completed: ${currentProgress}/${totalChunks} chunks`
      : 'Analysis completed';
    
    console.log('[analyze-alignment]', statusMessage);

    return new Response(
      JSON.stringify({
        success: true,
        analysis_id: analysisLog.id,
        safe_mode_active: safeModeActive,
        batch_completed: true,
        chunks_analyzed_this_batch: chunks?.length || 0,
        total_progress: currentProgress,
        total_chunks: totalChunks || 0,
        more_batches_needed: moreBatchesNeeded,
        next_batch_offset: currentProgress,
        chunks_flagged_for_removal: chunksToRemove.length,
        chunks_auto_removed: chunksAutoRemoved,
        requires_manual_approval: requiresManualApproval,
        concept_coverage_percentage: avgConceptCoverage,
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
