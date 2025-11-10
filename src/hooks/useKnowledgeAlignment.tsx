import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KNOWLEDGE_ALIGNMENT_CONFIG } from '@/config/knowledgeAlignmentConfig';

interface UseKnowledgeAlignmentProps {
  agentId: string;
  enabled?: boolean;
}

// Helper function to add timeout to edge function calls
const invokeWithTimeout = async (functionName: string, body: any, timeoutMs: number) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Client timeout exceeded')), timeoutMs)
  );
  
  const invokePromise = supabase.functions.invoke(functionName, { body });
  
  return Promise.race([invokePromise, timeoutPromise]) as Promise<any>;
};

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
        
        // Consider completed if completed_at is set, regardless of chunk counts
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
    
    // Show loading toast with progress
    const progressToastId = 'analysis-progress';
    toast.loading('Inizializzazione analisi...', { id: progressToastId, duration: Infinity });

    try {
      // Step 1: Extract new requirements
      console.log('[useKnowledgeAlignment] Extracting task requirements');
      toast.loading('Estrazione requisiti in corso...', { id: progressToastId, duration: Infinity });
      
      const { data: extractData, error: extractError } = await supabase.functions.invoke(
        'extract-task-requirements',
        { body: { agentId } }
      );

      if (extractError) throw extractError;

      console.log('[useKnowledgeAlignment] Requirements extracted:', extractData);

      // Step 2: Analyze alignment in batches with retry logic
      console.log('[useKnowledgeAlignment] Starting batch analysis');
      let moreBatchesNeeded = true;
      let totalAnalyzed = 0;
      let totalChunks = 0;
      let batchCount = 0;
      let lastAnalysisData = null;
      const MAX_RETRIES = 3;

      while (moreBatchesNeeded) {
        batchCount++;
        let retries = 0;
        let batchSuccess = false;
        
        console.log(`[useKnowledgeAlignment] Processing batch #${batchCount}`);
        toast.loading(`Analisi batch #${batchCount}...`, { id: progressToastId, duration: Infinity });

        // Retry loop for individual batches
        while (!batchSuccess && retries < MAX_RETRIES) {
          try {
            const { data: analysisData, error: analysisError } = await invokeWithTimeout(
              'analyze-knowledge-alignment',
              { agentId, forceReanalysis: true },
              180000 // 3 minutes client-side timeout
            );

            if (analysisError) throw analysisError;

            totalAnalyzed = analysisData.total_progress;
            totalChunks = analysisData.total_chunks;
            moreBatchesNeeded = analysisData.more_batches_needed;
            lastAnalysisData = analysisData;
            batchSuccess = true;

            const percentage = totalChunks > 0 ? ((totalAnalyzed / totalChunks) * 100).toFixed(1) : '0';
            console.log(`[useKnowledgeAlignment] Batch ${batchCount} completed: ${totalAnalyzed}/${totalChunks} chunks (${percentage}%)`);
            
            toast.loading(`Analisi in corso: ${totalAnalyzed}/${totalChunks} chunks (${percentage}%)`, { 
              id: progressToastId, 
              duration: Infinity 
            });

          } catch (error: any) {
            retries++;
            console.error(`[useKnowledgeAlignment] Batch ${batchCount} failed (attempt ${retries}/${MAX_RETRIES}):`, error);
            
            if (retries >= MAX_RETRIES) {
              throw new Error(`Batch ${batchCount} failed after ${MAX_RETRIES} attempts: ${error.message}`);
            }
            
            // Wait before retrying
            toast.loading(`Ritentativo ${retries}/${MAX_RETRIES}...`, { id: progressToastId, duration: Infinity });
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        // Brief pause between batches
        if (moreBatchesNeeded) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Dismiss loading toast
      toast.dismiss(progressToastId);

      console.log('[useKnowledgeAlignment] All batches completed!');
      
      setLastAnalysis(new Date());
      setCooldownActive(false);

      if (lastAnalysisData) {
        if (lastAnalysisData.safe_mode_active) {
          toast.success(
            `✅ Analisi completata! ${totalAnalyzed} chunk analizzati. ${lastAnalysisData.chunks_flagged_for_removal} chunk saranno rimossi automaticamente tra ${KNOWLEDGE_ALIGNMENT_CONFIG.safe_mode.duration_days} giorni.`,
            { duration: 6000 }
          );
        } else if (lastAnalysisData.chunks_auto_removed > 0) {
          toast.success(
            `✅ Analisi completata! ${totalAnalyzed} chunk analizzati, ${lastAnalysisData.chunks_auto_removed} rimossi automaticamente.`,
            { duration: 6000 }
          );
        } else {
          toast.success(`✅ Analisi completata! ${totalAnalyzed} chunk analizzati. Knowledge base ottimizzata.`, { duration: 5000 });
        }
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
