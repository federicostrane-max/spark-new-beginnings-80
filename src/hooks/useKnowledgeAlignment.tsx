import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KNOWLEDGE_ALIGNMENT_CONFIG } from '@/config/knowledgeAlignmentConfig';

interface UseKnowledgeAlignmentProps {
  agentId: string;
  enabled?: boolean;
}

export const useKnowledgeAlignment = ({ agentId, enabled = true }: UseKnowledgeAlignmentProps) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<Date | null>(null);
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<'completed' | 'incomplete' | null>(null);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(0);

  useEffect(() => {
    if (!enabled || !agentId) return;

    console.log('[useKnowledgeAlignment] Setting up listener for agent:', agentId);

    // Fetch last analysis timestamp and status
    const fetchLastAnalysis = async () => {
      const { data } = await supabase
        .from('alignment_analysis_log')
        .select('started_at, completed_at')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setLastAnalysis(new Date(data.started_at));
        setLastAnalysisStatus(data.completed_at ? 'completed' : 'incomplete');
        
        // Check cooldown
        const timeSinceLastAnalysis = Date.now() - new Date(data.started_at).getTime();
        const cooldownMs = KNOWLEDGE_ALIGNMENT_CONFIG.triggers.min_time_between_analyses;
        const isInCooldown = timeSinceLastAnalysis < cooldownMs;
        
        setCooldownActive(isInCooldown);
        if (isInCooldown) {
          const minutesRemaining = Math.ceil((cooldownMs - timeSinceLastAnalysis) / 60000);
          setCooldownMinutes(minutesRemaining);
        }
      }
    };

    fetchLastAnalysis();

    // Listen for system_prompt changes
    const channel = supabase
      .channel(`agent-prompt-changes-${agentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agents',
          filter: `id=eq.${agentId}`,
        },
        async (payload) => {
          console.log('[useKnowledgeAlignment] Agent updated:', payload);

          // Check if system_prompt actually changed
          const oldPrompt = (payload.old as any)?.system_prompt;
          const newPrompt = (payload.new as any)?.system_prompt;

          if (oldPrompt && newPrompt && oldPrompt !== newPrompt) {
            console.log('[useKnowledgeAlignment] System prompt changed, triggering alignment');
            await handlePromptChange();
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[useKnowledgeAlignment] Cleaning up listener');
      supabase.removeChannel(channel);
    };
  }, [agentId, enabled]);

  const handlePromptChange = async (forceAnalysis = false) => {
    // Check cooldown (can bypass if last analysis is incomplete or forced)
    if (lastAnalysis && !forceAnalysis) {
      const timeSinceLastAnalysis = Date.now() - lastAnalysis.getTime();
      const cooldownMs = KNOWLEDGE_ALIGNMENT_CONFIG.triggers.min_time_between_analyses;

      if (timeSinceLastAnalysis < cooldownMs && lastAnalysisStatus === 'completed') {
        console.log('[useKnowledgeAlignment] Cooldown active, skipping analysis');
        const minutesRemaining = Math.ceil((cooldownMs - timeSinceLastAnalysis) / 60000);
        setCooldownActive(true);
        setCooldownMinutes(minutesRemaining);
        toast.info(`Analisi in pausa. Prossima disponibile tra ${minutesRemaining} minuti.`);
        return;
      }
      
      // Allow analysis if last one was incomplete
      if (lastAnalysisStatus === 'incomplete') {
        console.log('[useKnowledgeAlignment] Last analysis incomplete, allowing retry');
      }
    }

    setIsAnalyzing(true);
    toast.info('Aggiornamento knowledge base in corso...');

    try {
      // Step 1: Extract new requirements
      console.log('[useKnowledgeAlignment] Extracting task requirements');
      const { data: extractData, error: extractError } = await supabase.functions.invoke(
        'extract-task-requirements',
        { body: { agentId } }
      );

      if (extractError) throw extractError;

      console.log('[useKnowledgeAlignment] Requirements extracted:', extractData);

      // Step 2: Analyze alignment
      console.log('[useKnowledgeAlignment] Analyzing alignment');
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
        'analyze-knowledge-alignment',
        { body: { agentId, forceReanalysis: true } }
      );

      if (analysisError) throw analysisError;

      console.log('[useKnowledgeAlignment] Analysis complete:', analysisData);

      setLastAnalysis(new Date());
      setCooldownActive(false);

      // Start polling for completion if analysis is incomplete
      if (!analysisData.completed_at) {
        pollAnalysisCompletion(analysisData.analysis_id);
      }

      if (analysisData.safe_mode_active) {
        toast.success(
          `Analisi completata. ${analysisData.chunks_flagged_for_removal} chunk saranno rimossi automaticamente tra ${KNOWLEDGE_ALIGNMENT_CONFIG.safe_mode.duration_days} giorni.`,
          { duration: 5000 }
        );
      } else if (analysisData.chunks_auto_removed > 0) {
        toast.success(
          `Analisi completata. ${analysisData.chunks_auto_removed} chunk rimossi automaticamente.`,
          { duration: 5000 }
        );
      } else {
        toast.success('Analisi completata. Knowledge base ottimizzata.', { duration: 3000 });
      }

    } catch (error: any) {
      console.error('[useKnowledgeAlignment] Error:', error);
      toast.error('Errore durante l\'aggiornamento della knowledge base');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const pollAnalysisCompletion = async (analysisId: string) => {
    const maxPolls = 60; // 3 minutes max
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;

      const { data: log } = await supabase
        .from('alignment_analysis_log')
        .select('completed_at, progress_chunks_analyzed, total_chunks_analyzed')
        .eq('id', analysisId)
        .single();

      if (log?.completed_at || pollCount >= maxPolls) {
        clearInterval(pollInterval);
        setIsAnalyzing(false);
        
        if (log?.completed_at) {
          toast.success('Analisi completata con successo');
        } else {
          toast.warning('Analisi in corso. Completamento in background...');
        }
      }
    }, 3000); // Poll every 3 seconds
  };

  const triggerManualAnalysis = async () => {
    await handlePromptChange();
  };

  return {
    isAnalyzing,
    lastAnalysis,
    lastAnalysisStatus,
    cooldownActive,
    cooldownMinutes,
    canAnalyze: !cooldownActive || lastAnalysisStatus === 'incomplete',
    triggerManualAnalysis: () => handlePromptChange(false),
    forceAnalysis: () => handlePromptChange(true),
  };
};
