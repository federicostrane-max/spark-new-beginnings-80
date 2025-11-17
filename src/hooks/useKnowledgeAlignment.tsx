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
  const [isBlocked, setIsBlocked] = useState(false);
  const [missingCriticalSources, setMissingCriticalSources] = useState<any[]>([]);

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

  const handlePromptChange = async (freshStart = false) => {
    // ✅ RIMOSSO VINCOLO DI COOLDOWN - L'analisi può essere sempre eseguita
    console.log(`[useKnowledgeAlignment] 🚀 handlePromptChange called with freshStart=${freshStart}`);
    setIsAnalyzing(true);
    
    // Show loading toast with progress
    const progressToastId = 'analysis-progress';
    const initMessage = freshStart ? '🔄 Ripristino tutti i chunk...' : 'Inizializzazione analisi...';
    toast.loading(initMessage, { id: progressToastId, duration: Infinity });

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

      // Step 2: Multi-invocation analysis with auto-resume
      console.log('[useKnowledgeAlignment] Starting multi-invocation analysis');
      
      // ✅ Flag to send forceReanalysis: true only for the first batch
      let isFirstBatch = true;
      
      const processNextBatch = async (): Promise<void> => {
        const batchParams = { 
          agentId, 
          forceReanalysis: isFirstBatch, 
          freshStart: isFirstBatch ? freshStart : false 
        };
        console.log(`[useKnowledgeAlignment] 📤 Calling analyze-knowledge-alignment with params:`, batchParams);
        
        const { data: analysisData, error: analysisError } = await invokeWithTimeout(
          'analyze-knowledge-alignment',
          batchParams,
          180000 // 3 minutes client-side timeout
        );

        if (analysisError) {
          console.error('[useKnowledgeAlignment] ❌ Analysis error:', analysisError);
          throw analysisError;
        }

        console.log(`[useKnowledgeAlignment] 📥 Analysis response:`, analysisData);

        // ✅ After first call, subsequent calls will use forceReanalysis: false
        isFirstBatch = false;

        // Check if blocked
        if (analysisData.blocked) {
          toast.dismiss(progressToastId);
          setIsBlocked(true);
          setMissingCriticalSources(analysisData.missing_critical_sources || []);
          
          toast.error(
            <div>
              <p className="font-semibold">🚫 Analisi BLOCCATA</p>
              <p className="text-sm mt-1">{analysisData.message}</p>
            </div>,
            { duration: 10000 }
          );
          
          setIsAnalyzing(false);
          return;
        }

        const { status, batchCompleted, totalBatches, chunksProcessed, totalChunks, progressPercentage } = analysisData;

        // Update progress toast
        toast.loading(
          `Analisi in corso: Batch ${batchCompleted}/${totalBatches} (${progressPercentage}%)`,
          { id: progressToastId, duration: Infinity }
        );

        console.log(`[useKnowledgeAlignment] Batch ${batchCompleted}/${totalBatches} completed - ${chunksProcessed}/${totalChunks} chunks (${progressPercentage}%)`);

        // If not complete, continue after delay
        if (status === 'in_progress') {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
          await processNextBatch(); // Recursive call
        } else if (status === 'completed') {
          // Analysis complete
          toast.dismiss(progressToastId);
          toast.success(
            <div>
              <p className="font-semibold">✅ Analisi completata</p>
              <p className="text-sm">{chunksProcessed} chunk analizzati</p>
            </div>,
            { duration: 5000 }
          );

          setLastAnalysis(new Date());
          setLastAnalysisStatus('completed');
          setIsAnalyzing(false);
          setIsBlocked(false);
          setMissingCriticalSources([]);
        }
      };

      // Start the recursive batch processing
      await processNextBatch();

    } catch (error: any) {
      console.error('[useKnowledgeAlignment] Analysis failed:', error);
      toast.dismiss(progressToastId);
      toast.error(`Errore durante l'analisi: ${error.message}`, { duration: 5000 });
      setIsAnalyzing(false);
      setLastAnalysisStatus('incomplete');
    }
  };

  const pollAnalysisCompletion = async (analysisId: string) => {
    const maxPolls = 60; // 3 minutes max
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;

      const { data: log } = await supabase
        .from('alignment_analysis_log')
        .select('completed_at, total_chunks_analyzed')
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
    forceAnalysis: (freshStart = false) => handlePromptChange(freshStart),
    isBlocked,
    missingCriticalSources,
  };
};
