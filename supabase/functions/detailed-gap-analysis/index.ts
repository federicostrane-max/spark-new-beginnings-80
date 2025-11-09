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

    // STEP 1: Fetch agent info for context (Opzione A)
    const { data: agentInfo, error: agentError } = await supabase
      .from('agents')
      .select('id, name, description')
      .eq('id', agentId)
      .single();

    if (agentError) {
      console.error('Error fetching agent info:', agentError);
    }

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

    // STEP 2: Calculate existing documents list (Opzione A)
    const existingDocs = chunks 
      ? Array.from(new Set(chunks.map(c => c.document_name)))
          .filter(Boolean)
          .slice(0, 10) // Top 10 documents
      : [];

    console.log(`[Gap Analysis] Agent: "${agentInfo?.name || 'Unknown'}", Documents: ${existingDocs.length}`);

    // 4. Analyze gaps for each category
    console.log(`[Gap Analysis] Starting category analysis...`);
    
    // Check for timeout before each category
    if (Date.now() - executionStartTime > MAX_EXECUTION_TIME) {
      console.warn('[Gap Analysis] ⚠️ Approaching timeout, saving partial results');
      throw new Error('Analysis timeout - partial results saved');
    }
    
    // STEP 3: Pass agentInfo and existingDocs to analyzeCategory
    const missingCoreConcepts = await analyzeCategory(
      requirements.core_concepts,
      scores || [],
      chunks || [],
      'core_concepts',
      lovableApiKey,
      supabase,
      agentInfo,
      existingDocs
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
      lovableApiKey,
      supabase,
      agentInfo,
      existingDocs
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
      lovableApiKey,
      supabase,
      agentInfo,
      existingDocs
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
      lovableApiKey,
      supabase,
      agentInfo,
      existingDocs
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

// STEP 4: Update analyzeCategory signature
async function analyzeCategory(
  items: any[] | null,
  scores: any[],
  chunks: any[],
  categoryName: string,
  lovableApiKey: string,
  supabase: any,
  agentInfo: any,
  existingDocs: string[]
): Promise<GapItem[]> {
  if (!items || items.length === 0) return [];

  console.log(`[Gap Analysis] Processing ${categoryName}: ${items.length} items`);
  const startTime = Date.now();
  const gaps: GapItem[] = [];

  // PASS 1: Identify ALL gaps without AI suggestions
  for (const item of items) {
    // Extract text based on category structure
    let itemText = '';
    
    if (typeof item === 'string') {
      // domain_vocabulary are simple strings
      itemText = item;
    } else if (typeof item === 'object') {
      // Extract based on known structure for each category
      if (categoryName === 'core_concepts') {
        itemText = item.concept || '';
      } else if (categoryName === 'procedural_knowledge') {
        itemText = item.process || '';
      } else if (categoryName === 'decision_patterns') {
        itemText = item.pattern || '';
      } else {
        // Fallback to generic fields
        itemText = item.name || item.term || item.title || item.concept || item.process || item.pattern || '';
      }
    }
    
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
    const coverageRatio = currentCoverage / requiredCoverage;
    const gapPercentage = Math.max(0, Math.min(100, (1 - coverageRatio) * 100));

    // If gap is significant, add to gaps list (without AI suggestion yet)
    if (currentCoverage < requiredCoverage) {
      gaps.push({
        item: itemText,
        description: typeof item === 'object' 
          ? (item.description || item.definition || item.importance || JSON.stringify(item.steps?.slice(0,2)) || JSON.stringify(item.criteria?.slice(0,2)) || undefined)
          : undefined,
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

  // STEP 5: Generate AI suggestions ONLY for critical gaps (≥50%)
  const criticalGaps = gaps.filter(g => g.gap_percentage >= 50);
  console.log(`[Gap Analysis] ${categoryName}: ${criticalGaps.length} critical gaps (≥50%)`);

  if (criticalGaps.length > 0) {
    const topCritical = criticalGaps; // ALL critical gaps
    console.log(`[Gap Analysis] Generating AI suggestions for ${topCritical.length} critical gaps`);
    
    // Process AI suggestions in batches of 5 (parallel)
    const BATCH_SIZE = 5;
    for (let i = 0; i < topCritical.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(topCritical.length / BATCH_SIZE);
      console.log(`[Gap Analysis] ${categoryName}: Processing AI batch ${batchNumber}/${totalBatches}`);
      
      const batch = topCritical.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async gap => {
          gap.suggestion = await generateGapSuggestion(
            gap.item, 
            categoryName, 
            chunks, 
            lovableApiKey, 
            'high',
            supabase,
            agentInfo,
            existingDocs
          );
        })
      );
      
      console.log(`[Gap Analysis] ${categoryName}: Completed AI batch ${batchNumber}/${totalBatches}`);
    }
  }

  // Non-critical gaps (<50%) keep empty suggestion
  const elapsedTime = Date.now() - startTime;
  console.log(`[Gap Analysis] ${categoryName}: Completed in ${elapsedTime}ms`);

  return gaps;
}

// STEP 6 & 7: Semantic search + enriched AI context
async function generateGapSuggestion(
  itemText: string,
  categoryName: string,
  chunks: any[],
  lovableApiKey: string,
  priority: 'high' | 'normal' = 'high',
  supabase: any,
  agentInfo: any,
  existingDocs: string[]
): Promise<string> {
  try {
    const model = priority === 'high' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash-lite';
    const maxTokens = priority === 'high' ? 500 : 250;

    // === SEMANTIC SEARCH (Opzione B) ===
    // Generate embedding for gap item
    const { data: embeddingData, error: embError } = await supabase.functions.invoke('generate-embedding', {
      body: { text: itemText }
    });

    let contextSummary: string;

    if (embError || !embeddingData?.embedding) {
      console.error(`Failed to generate embedding for "${itemText}":`, embError);
      // Fallback to exact match
      const relevantChunks = chunks
        .filter(c => c.content?.toLowerCase().includes(itemText.toLowerCase()))
        .slice(0, 5);
      
      contextSummary = relevantChunks.length > 0
        ? relevantChunks.map(c => `${c.document_name}: "${c.content.substring(0, 150)}..."`).join('\n')
        : `Nessun chunk esistente tratta direttamente "${itemText}"`;
    } else {
      // Use semantic search to find relevant chunks
      const { data: matches, error: matchError } = await supabase.rpc('match_documents', {
        query_embedding: embeddingData.embedding,
        filter_agent_id: agentInfo?.id || null,
        match_threshold: 0.3, // Lower threshold for broader matches
        match_count: 5
      });

      if (matchError) {
        console.error('Semantic search error:', matchError);
      }

      // Build context from semantic matches
      contextSummary = matches && matches.length > 0
        ? matches.map((m: any) => `${m.document_name}: "${m.content.substring(0, 150)}..." (relevance: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')
        : `Nessun documento esistente tratta argomenti correlati a "${itemText}"`;
    }

    return await generateAIPrompt(itemText, categoryName, contextSummary, agentInfo, existingDocs, model, maxTokens, lovableApiKey);

  } catch (error: any) {
    console.error('Error generating gap suggestion:', error);
    return ''; // Return empty for failed suggestions
  }
}

// New function to generate AI prompt with agent context (Opzione A)
async function generateAIPrompt(
  itemText: string,
  categoryName: string,
  contextSummary: string,
  agentInfo: any,
  existingDocs: string[],
  model: string,
  maxTokens: number,
  lovableApiKey: string
): Promise<string> {
  
  // === CONTEXT ENRICHMENT (Opzione A) ===
  const agentContext = agentInfo 
    ? `\n**Agente:** "${agentInfo.name}"\n**Dominio:** ${agentInfo.description || 'Non specificato'}`
    : '';
  
  const docsContext = existingDocs.length > 0
    ? `\n**Documenti già nel KB:** ${existingDocs.slice(0, 5).join(', ')}`
    : '\n**KB attualmente vuoto**';

  const prompt = `Analizza il gap nel knowledge base dell'agente.

**Gap identificato:** "${itemText}" (categoria: ${categoryName})${agentContext}${docsContext}

**Contesto esistente:**
${contextSummary}

**TASK:** Identifica 2-3 aspetti specifici MANCANTI su "${itemText}".

**Formato richiesto (CONCISO - max 30 parole per punto):**
• Manca [cosa] - rilevante perché [motivo breve]
• Manca [cosa] - rilevante perché [motivo breve]

**Esempio di output corretto:**
• Manca descrizione protocolli comunicazione (message passing, blackboard) nel contesto multi-agente
• Manca spiegazione pattern coordinamento per task distribuiti tra agenti
• Manca documentazione strategie risoluzione conflitti quando agenti competono per risorse`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Sei un analista di knowledge base. Identifica gap specifici nelle conoscenze di un agente AI. Rispondi SOLO con liste puntate che iniziano con "Manca..." seguita da UNA FRASE BREVE (max 30 parole). Sii conciso, specifico e actionable. No libri, no risorse generiche.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    console.error('AI API error:', await response.text());
    return '';
  }

  const data = await response.json();
  let suggestion = data.choices?.[0]?.message?.content || '';
  
  // Remove conversational intros
  suggestion = suggestion
    .replace(/^(Assolutamente!?|Certamente!?|Ecco|Certo|Perfetto)[^\n]*/i, '')
    .replace(/^[^•\-\*1-9]+(?=[•\-\*1-9])/m, '')
    .trim();
  
  return suggestion || '';
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
