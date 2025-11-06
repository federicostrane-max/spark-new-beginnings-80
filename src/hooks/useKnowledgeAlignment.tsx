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

  useEffect(() => {
    if (!enabled || !agentId) return;

    console.log('[useKnowledgeAlignment] Setting up listener for agent:', agentId);

    // Fetch last analysis timestamp
    const fetchLastAnalysis = async () => {
      const { data } = await supabase
        .from('alignment_analysis_log')
        .select('started_at')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setLastAnalysis(new Date(data.started_at));
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

  const handlePromptChange = async () => {
    // Check cooldown
    if (lastAnalysis) {
      const timeSinceLastAnalysis = Date.now() - lastAnalysis.getTime();
      const cooldownMs = KNOWLEDGE_ALIGNMENT_CONFIG.triggers.min_time_between_analyses;

      if (timeSinceLastAnalysis < cooldownMs) {
        console.log('[useKnowledgeAlignment] Cooldown active, skipping analysis');
        const minutesRemaining = Math.ceil((cooldownMs - timeSinceLastAnalysis) / 60000);
        toast.info(`Analisi in pausa. Prossima disponibile tra ${minutesRemaining} minuti.`);
        return;
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

  const triggerManualAnalysis = async () => {
    await handlePromptChange();
  };

  return {
    isAnalyzing,
    lastAnalysis,
    triggerManualAnalysis,
  };
};
