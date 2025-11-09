import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GapItem {
  item: string;
  description?: string;
  current_coverage: number;
  required_coverage: number;
  gap_percentage: number;
  suggestion: string;
}

interface GapAnalysisResult {
  agent_id: string;
  requirement_id: string;
  analysis_date: string;
  missing_core_concepts: GapItem[];
  missing_procedural_knowledge: GapItem[];
  missing_decision_patterns: GapItem[];
  missing_domain_vocabulary: GapItem[];
  overall_gap_score: number;
  recommendations: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const executionStartTime = Date.now();
    const MAX_EXECUTION_TIME = 50000; // 50 seconds (leave 10s buffer for Edge Function timeout)
    
    const { agentId } = await req.json();
    
    if (!agentId) {
      throw new Error('agentId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Gap Analysis] ========== STARTING ==========`);
    console.log(`[Gap Analysis] Agent: ${agentId}`);

    // 1. Fetch agent task requirements
    const { data: requirements, error: reqError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (reqError || !requirements) {
      throw new Error(`Failed to fetch requirements: ${reqError?.message}`);
    }

    // 2. Fetch all knowledge relevance scores for this agent
    const { data: scores, error: scoresError } = await supabase
      .from('knowledge_relevance_scores')
      .select('*, agent_knowledge!inner(content, document_name)')
      .eq('agent_id', agentId);

    if (scoresError) {
      console.error('Error fetching scores:', scoresError);
    }

    // 3. Fetch all active knowledge chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('*')
      .eq('agent_id', agentId)
      .eq('is_active', true);

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
    }

    const totalChunks = chunks?.length || 0;
    console.log(`[Gap Analysis] Total chunks: ${totalChunks}, Scored chunks: ${scores?.length || 0}`);

    // 4. Analyze gaps for each category
    console.log(`[Gap Analysis] Starting category analysis...`);
    
    // Check for timeout before each category
    if (Date.now() - executionStartTime > MAX_EXECUTION_TIME) {
      console.warn('[Gap Analysis] ⚠️ Approaching timeout, saving partial results');
      throw new Error('Analysis timeout - partial results saved');
    }
    
    const missingCoreConcepts = await analyzeCategory(
      requirements.core_concepts,
      scores || [],
      chunks || [],
      'core_concepts',
      lovableApiKey
    );

    if (Date.now() - executionStartTime > MAX_EXECUTION_TIME) {
      console.warn('[Gap Analysis] ⚠️ Timeout after core concepts analysis');
      throw new Error('Analysis timeout after core concepts');
    }

    const missingProcedural = await analyzeCategory(
      requirements.procedural_knowledge,
      scores || [],
      chunks || [],
      'procedural_knowledge',
      lovableApiKey
    );

    if (Date.now() - executionStartTime > MAX_EXECUTION_TIME) {
      console.warn('[Gap Analysis] ⚠️ Timeout after procedural analysis');
      throw new Error('Analysis timeout after procedural');
    }

    const missingDecisionPatterns = await analyzeCategory(
      requirements.decision_patterns,
      scores || [],
      chunks || [],
      'decision_patterns',
      lovableApiKey
    );

    if (Date.now() - executionStartTime > MAX_EXECUTION_TIME) {
      console.warn('[Gap Analysis] ⚠️ Timeout after decision patterns analysis');
      throw new Error('Analysis timeout after decision patterns');
    }

    const missingVocabulary = await analyzeCategory(
      requirements.domain_vocabulary,
      scores || [],
      chunks || [],
      'domain_vocabulary',
      lovableApiKey
    );

    console.log(`[Gap Analysis] ✅ All category analysis completed`);

    // 5. Calculate overall gap score
    const allGaps = [
      ...missingCoreConcepts,
      ...missingProcedural,
      ...missingDecisionPatterns,
      ...missingVocabulary
    ];
    
    const totalRequirements = 
      (requirements.core_concepts?.length || 0) +
      (requirements.procedural_knowledge?.length || 0) +
      (requirements.decision_patterns?.length || 0) +
      (requirements.domain_vocabulary?.length || 0);

    const overallGapScore = totalRequirements > 0 
      ? allGaps.length / totalRequirements 
      : 0;

    // 6. Generate AI recommendations
    const recommendations = await generateRecommendations(
      requirements,
      { missingCoreConcepts, missingProcedural, missingDecisionPatterns, missingVocabulary },
      lovableApiKey
    );

    const result: GapAnalysisResult = {
      agent_id: agentId,
      requirement_id: requirements.id,
      analysis_date: new Date().toISOString(),
      missing_core_concepts: missingCoreConcepts,
      missing_procedural_knowledge: missingProcedural,
      missing_decision_patterns: missingDecisionPatterns,
      missing_domain_vocabulary: missingVocabulary,
      overall_gap_score: overallGapScore,
      recommendations
    };

    // 7. Save to database
    const { error: insertError } = await supabase
      .from('knowledge_gap_analysis')
      .insert({
        agent_id: agentId,
        requirement_id: requirements.id,
        missing_core_concepts: missingCoreConcepts,
        missing_procedural_knowledge: missingProcedural,
        missing_decision_patterns: missingDecisionPatterns,
        missing_domain_vocabulary: missingVocabulary,
        overall_gap_score: overallGapScore,
        recommendations
      });

    if (insertError) {
      console.error('Error saving gap analysis:', insertError);
    } else {
      console.log(`[Gap Analysis] ✅ Results saved to database`);
    }

    const totalExecutionTime = Date.now() - executionStartTime;
    console.log(`[Gap Analysis] ========== COMPLETED ==========`);
    console.log(`[Gap Analysis] Overall gap score: ${overallGapScore.toFixed(2)}`);
    console.log(`[Gap Analysis] Total execution time: ${totalExecutionTime}ms`);
    console.log(`[Gap Analysis] Total gaps found: ${allGaps.length}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Gap Analysis] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzeCategory(
  items: any[] | null,
  scores: any[],
  chunks: any[],
  categoryName: string,
  lovableApiKey: string
): Promise<GapItem[]> {
  if (!items || items.length === 0) return [];

  console.log(`[Gap Analysis] Processing ${categoryName}: ${items.length} items`);
  const startTime = Date.now();
  const gaps: GapItem[] = [];

  // PASS 1: Identify ALL gaps without AI suggestions
  for (const item of items) {
    const itemText = typeof item === 'string' ? item : (item.name || item.term || item.title || '');
    if (!itemText) continue;

    // Calculate coverage: count chunks with high scores for this item
    const relevantScores = scores.filter(s => {
      const content = s.agent_knowledge?.content || '';
      return content.toLowerCase().includes(itemText.toLowerCase());
    });

    const highScoreCount = relevantScores.filter(s => {
      if (categoryName === 'core_concepts') return s.concept_coverage > 0.5;
      if (categoryName === 'procedural_knowledge') return s.procedural_match > 0.5;
      if (categoryName === 'decision_patterns') return s.procedural_match > 0.5;
      if (categoryName === 'domain_vocabulary') return s.vocabulary_alignment > 0.5;
      return s.final_relevance_score > 0.5;
    }).length;

    // Coverage based on minimum chunks needed
    const minChunksNeeded = 3;
    const currentCoverage = highScoreCount >= minChunksNeeded 
      ? 1.0 
      : highScoreCount / minChunksNeeded;
    const requiredCoverage = 0.3; // 30% minimum coverage
    const gapPercentage = Math.max(0, (requiredCoverage - currentCoverage) * 100);

    // If gap is significant, add to gaps list (without AI suggestion yet)
    if (currentCoverage < requiredCoverage) {
      gaps.push({
        item: itemText,
        description: typeof item === 'object' ? (item.description || item.definition) : undefined,
        current_coverage: Math.round(currentCoverage * 100) / 100,
        required_coverage: requiredCoverage,
        gap_percentage: Math.round(gapPercentage),
        suggestion: '' // Placeholder
      });
    }
  }

  console.log(`[Gap Analysis] ${categoryName}: Found ${gaps.length} gaps`);

  // Sort by gap_percentage (most critical first)
  gaps.sort((a, b) => b.gap_percentage - a.gap_percentage);

  // PASS 2: Generate AI suggestions for top 5 critical gaps
  const MAX_AI_SUGGESTIONS = 5;
  const topGaps = gaps.slice(0, MAX_AI_SUGGESTIONS);
  const remainingGaps = gaps.slice(MAX_AI_SUGGESTIONS);

  console.log(`[Gap Analysis] ${categoryName}: Generating AI suggestions for top ${topGaps.length} gaps`);

  // Process AI suggestions in batches of 3 (parallel)
  const BATCH_SIZE = 3;
  for (let i = 0; i < topGaps.length; i += BATCH_SIZE) {
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(topGaps.length / BATCH_SIZE);
    console.log(`[Gap Analysis] ${categoryName}: Processing AI batch ${batchNumber}/${totalBatches}`);
    
    const batch = topGaps.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async gap => {
        gap.suggestion = await generateGapSuggestion(gap.item, categoryName, chunks, lovableApiKey, 'high');
      })
    );
    
    console.log(`[Gap Analysis] ${categoryName}: Completed AI batch ${batchNumber}/${totalBatches}`);
  }

  // Generic suggestions for remaining gaps
  remainingGaps.forEach(gap => {
    gap.suggestion = `Aggiungi documentazione specifica su "${gap.item}" per migliorare la copertura al ${Math.round(gap.required_coverage * 100)}%.`;
  });

  const elapsedTime = Date.now() - startTime;
  console.log(`[Gap Analysis] ${categoryName}: Completed in ${elapsedTime}ms`);

  return [...topGaps, ...remainingGaps];
}

async function generateGapSuggestion(
  itemText: string,
  categoryName: string,
  chunks: any[],
  lovableApiKey: string,
  priority: 'high' | 'normal' = 'high'
): Promise<string> {
  try {
    // Use faster model and fewer tokens for normal priority
    const model = priority === 'high' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash-lite';
    const maxTokens = priority === 'high' ? 300 : 150;

    // Create better context with actual chunk content
    const relevantChunks = chunks
      .filter(c => c.content?.toLowerCase().includes(itemText.toLowerCase()))
      .slice(0, 3);

    const contextSummary = relevantChunks.length > 0
      ? relevantChunks.map(c => `${c.document_name}: "${c.content.substring(0, 200)}..."`).join('\n')
      : `Nessun chunk esistente tratta direttamente "${itemText}"`;

    const prompt = `Analizza questo gap nel knowledge base:

**Categoria:** ${categoryName}
**Elemento mancante:** ${itemText}
**Contesto attuale:**
${contextSummary}

Fornisci 2-3 suggerimenti SPECIFICI e CONCRETI in italiano per colmare questo gap. 
Indica esattamente quali documenti, guide o risorse devono essere aggiunte.
Sii chiaro, completo e non tagliare le frasi a metà.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Sei un esperto di knowledge management. Fornisci suggerimenti pratici e specifici in italiano.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      console.error('AI API error:', await response.text());
      return 'Aggiungi documentazione specifica su questo argomento.';
    }

    const data = await response.json();
    let suggestion = data.choices?.[0]?.message?.content || 'Aggiungi documentazione specifica su questo argomento.';
    
    // Handle potential truncation
    if (suggestion && !suggestion.match(/[.!?]$/)) {
      suggestion += '...';
    }
    
    return suggestion;
  } catch (error) {
    console.error('Error generating suggestion:', error);
    return 'Aggiungi documentazione specifica su questo argomento.';
  }
}

async function generateRecommendations(
  requirements: any,
  gaps: any,
  lovableApiKey: string
): Promise<string[]> {
  try {
    const totalGaps = 
      gaps.missingCoreConcepts.length +
      gaps.missingProcedural.length +
      gaps.missingDecisionPatterns.length +
      gaps.missingVocabulary.length;

    if (totalGaps === 0) {
      return ['Il knowledge base copre adeguatamente tutti i requisiti dell\'agente.'];
    }

    const prompt = `Analizza questi gap nel knowledge base e genera 3-5 raccomandazioni prioritarie:

Gap nei Core Concepts: ${gaps.missingCoreConcepts.length}
Gap nelle Procedure: ${gaps.missingProcedural.length}
Gap nei Decision Patterns: ${gaps.missingDecisionPatterns.length}
Gap nel Vocabolario: ${gaps.missingVocabulary.length}

Esempi di gap: ${gaps.missingCoreConcepts.slice(0, 2).map((g: GapItem) => g.item).join(', ')}

Genera raccomandazioni concrete in italiano per colmare questi gap, ordinate per priorità.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Sei un esperto di knowledge management. Fornisci raccomandazioni pratiche e actionable.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800 // FIX: Increased from 500 to prevent truncation
      })
    });

    if (!response.ok) {
      console.error('AI API error:', await response.text());
      return ['Carica documenti per colmare i gap identificati.'];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Split into individual recommendations
    const recs = content.split('\n')
      .filter((line: string) => line.trim() && (line.match(/^\d+\./) || line.match(/^-/)))
      .map((line: string) => line.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
      .slice(0, 5);

    return recs.length > 0 ? recs : ['Carica documenti per colmare i gap identificati.'];
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return ['Carica documenti per colmare i gap identificati.'];
  }
}
