import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, Package, Clock, Link2, XCircle } from "lucide-react";

interface PipelineDocument {
  id: string;
  file_name: string;
  status: string;
  created_at?: string;
  error_message?: string;
}

interface HealthData {
  // In Elaborazione (Processing + Waiting)
  processing: {
    awaitingCron: { count: number; files: PipelineDocument[]; nextCronMin: number };
    activeProcessing: { count: number; files: PipelineDocument[] };
    stuck: { count: number; files: PipelineDocument[] };
  };
  
  // Chunks Pronti
  chunks: {
    ready: { count: number; byPipeline: { legacy: number; a: number; b: number; c: number } };
    missing: { count: number; files: string[] };
  };
  
  // Coda Automatica (Cron Jobs)
  cronQueue: {
    processQueue: { count: number; nextCronMin: number; files: PipelineDocument[] };
    embeddingQueue: { count: number; nextCronMin: number; files: PipelineDocument[] };
  };
  
  // Embeddings
  embeddings: {
    pending: { count: number; nextCronMin: number };
    stuck: { count: number };
  };
  
  // Falliti
  failed: {
    count: number;
    files: Array<{ name: string; pipeline: string; error: string }>;
  };
  
  loading: boolean;
}

// Helper: calcola minuti al prossimo cron
const getTimeToNextCron = (intervalMinutes: number): number => {
  const now = new Date();
  const minutes = now.getMinutes();
  return intervalMinutes - (minutes % intervalMinutes);
};

export const DocumentPoolHealthIndicators = () => {
  const [healthData, setHealthData] = useState<HealthData>({
    processing: {
      awaitingCron: { count: 0, files: [], nextCronMin: 0 },
      activeProcessing: { count: 0, files: [] },
      stuck: { count: 0, files: [] }
    },
    chunks: {
      ready: { count: 0, byPipeline: { legacy: 0, a: 0, b: 0, c: 0 } },
      missing: { count: 0, files: [] }
    },
    cronQueue: {
      processQueue: { count: 0, nextCronMin: 0, files: [] },
      embeddingQueue: { count: 0, nextCronMin: 0, files: [] }
    },
    embeddings: {
      pending: { count: 0, nextCronMin: 0 },
      stuck: { count: 0 }
    },
    failed: {
      count: 0,
      files: []
    },
    loading: true
  });

  const loadHealthIndicators = async () => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    try {
      // === 1. IN ELABORAZIONE ===
      // Pipeline A - awaiting cron (ingested < 10 min)
      const { data: pipelineAAwaitingCron } = await supabase
        .from('pipeline_a_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'ingested')
        .gte('created_at', tenMinutesAgo)
        .limit(10);

      const { data: pipelineAProcessing } = await supabase
        .from('pipeline_a_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .limit(10);

      const { data: pipelineAStuck } = await supabase
        .from('pipeline_a_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .lt('created_at', fifteenMinutesAgo)
        .limit(10);

      // Pipeline B - awaiting cron (ingested < 10 min)
      const { data: pipelineBAwaitingCron } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'ingested')
        .gte('created_at', tenMinutesAgo)
        .limit(10);

      // Pipeline B - active processing
      const { data: pipelineBProcessing } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .limit(10);

      // Pipeline B - stuck (processing > 15 min)
      const { data: pipelineBStuck } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .lt('created_at', fifteenMinutesAgo)
        .limit(10);

      // Pipeline C - same queries
      const { data: pipelineCAwaitingCron } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'ingested')
        .gte('created_at', tenMinutesAgo)
        .limit(10);

      const { data: pipelineCProcessing } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .limit(10);

      const { data: pipelineCStuck } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'processing')
        .lt('created_at', fifteenMinutesAgo)
        .limit(10);

      const processingData = {
        awaitingCron: {
          count: (pipelineAAwaitingCron?.length || 0) + (pipelineBAwaitingCron?.length || 0) + (pipelineCAwaitingCron?.length || 0),
          files: [...(pipelineAAwaitingCron || []), ...(pipelineBAwaitingCron || []), ...(pipelineCAwaitingCron || [])],
          nextCronMin: getTimeToNextCron(10)
        },
        activeProcessing: {
          count: (pipelineAProcessing?.length || 0) + (pipelineBProcessing?.length || 0) + (pipelineCProcessing?.length || 0),
          files: [...(pipelineAProcessing || []), ...(pipelineBProcessing || []), ...(pipelineCProcessing || [])]
        },
        stuck: {
          count: (pipelineAStuck?.length || 0) + (pipelineBStuck?.length || 0) + (pipelineCStuck?.length || 0),
          files: [...(pipelineAStuck || []), ...(pipelineBStuck || []), ...(pipelineCStuck || [])]
        }
      };

      // === 2. CHUNKS PRONTI ===
      // Count actual chunks, not documents
      const { count: legacyChunksCount } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .is('agent_id', null)
        .eq('is_active', true);

      const { count: pipelineAChunksCount } = await supabase
        .from('pipeline_a_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('embedding_status', 'ready');

      const { count: pipelineBChunksCount } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('embedding_status', 'ready');

      const { count: pipelineCChunksCount } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('embedding_status', 'ready');

      const chunksData = {
        ready: {
          count: (legacyChunksCount || 0) + (pipelineAChunksCount || 0) + (pipelineBChunksCount || 0) + (pipelineCChunksCount || 0),
          byPipeline: {
            legacy: legacyChunksCount || 0,
            a: pipelineAChunksCount || 0,
            b: pipelineBChunksCount || 0,
            c: pipelineCChunksCount || 0
          }
        },
        missing: { count: 0, files: [] } // Deprecated for new pipelines
      };

      // === 3. CODA AUTOMATICA (Cron Jobs) ===
      const { data: pipelineAChunked } = await supabase
        .from('pipeline_a_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'chunked')
        .limit(10);

      const { data: pipelineBChunked } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'chunked')
        .limit(10);

      const { data: pipelineCChunked } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status, created_at')
        .eq('status', 'chunked')
        .limit(10);

      const cronQueueData = {
        processQueue: {
          count: processingData.awaitingCron.count,
          nextCronMin: getTimeToNextCron(10),
          files: processingData.awaitingCron.files
        },
        embeddingQueue: {
          count: (pipelineAChunked?.length || 0) + (pipelineBChunked?.length || 0) + (pipelineCChunked?.length || 0),
          nextCronMin: getTimeToNextCron(5),
          files: [...(pipelineAChunked || []), ...(pipelineBChunked || []), ...(pipelineCChunked || [])]
        }
      };

      // === 4. EMBEDDINGS ===
      const { count: pipelineAPendingEmbeddings } = await supabase
        .from('pipeline_a_chunks_raw')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_status', 'pending');

      const { count: pipelineBPendingEmbeddings } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_status', 'pending');

      const { count: pipelineCPendingEmbeddings } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_status', 'pending');

      const embeddingsData = {
        pending: {
          count: (pipelineAPendingEmbeddings || 0) + (pipelineBPendingEmbeddings || 0) + (pipelineCPendingEmbeddings || 0),
          nextCronMin: getTimeToNextCron(5)
        },
        stuck: { count: 0 } // TODO: implement stuck embeddings detection
      };

      // === 5. FALLITI ===
      const { data: pipelineAFailed } = await supabase
        .from('pipeline_a_documents')
        .select('id, file_name, status, error_message')
        .eq('status', 'failed')
        .limit(10);

      const { data: pipelineBFailed } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status, error_message')
        .eq('status', 'failed')
        .limit(10);

      const { data: pipelineCFailed } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status, error_message')
        .eq('status', 'failed')
        .limit(10);

      const failedData = {
        count: (pipelineAFailed?.length || 0) + (pipelineBFailed?.length || 0) + (pipelineCFailed?.length || 0),
        files: [
          ...(pipelineAFailed || []).map(d => ({
            name: d.file_name,
            pipeline: 'Pipeline A',
            error: d.error_message || 'Errore sconosciuto'
          })),
          ...(pipelineBFailed || []).map(d => ({
            name: d.file_name,
            pipeline: 'Pipeline B',
            error: d.error_message || 'Errore sconosciuto'
          })),
          ...(pipelineCFailed || []).map(d => ({
            name: d.file_name,
            pipeline: 'Pipeline C',
            error: d.error_message || 'Errore sconosciuto'
          }))
        ]
      };

      setHealthData({
        processing: processingData,
        chunks: chunksData,
        cronQueue: cronQueueData,
        embeddings: embeddingsData,
        failed: failedData,
        loading: false
      });
    } catch (error) {
      console.error('[HealthIndicators] Load failed:', error);
      setHealthData(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    loadHealthIndicators();
    
    // Polling every 30 seconds as fallback
    const interval = setInterval(loadHealthIndicators, 30000);
    
    // Realtime subscription for Pipeline B documents
    const channelB = supabase
      .channel('pipeline-b-documents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_b_documents'
        },
        (payload) => {
          console.log('[HealthIndicators] 🔔 Pipeline B document changed:', payload.new);
          loadHealthIndicators();
        }
      )
      .subscribe((status) => {
        console.log('[HealthIndicators] 📡 Pipeline B channel status:', status);
      });
    
    // Realtime subscription for Pipeline B chunks
    const channelBChunks = supabase
      .channel('pipeline-b-chunks-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_b_chunks_raw'
        },
        (payload) => {
          console.log('[HealthIndicators] 🔔 Pipeline B chunk changed:', payload.new);
          loadHealthIndicators();
        }
      )
      .subscribe((status) => {
        console.log('[HealthIndicators] 📡 Pipeline B chunks channel status:', status);
      });
    
    // Realtime subscription for Pipeline C documents
    const channelC = supabase
      .channel('pipeline-c-documents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_c_documents'
        },
        (payload) => {
          console.log('[HealthIndicators] 🔔 Pipeline C document changed:', payload.new);
          loadHealthIndicators();
        }
      )
      .subscribe((status) => {
        console.log('[HealthIndicators] 📡 Pipeline C channel status:', status);
      });
    
    // Realtime subscription for Pipeline C chunks
    const channelCChunks = supabase
      .channel('pipeline-c-chunks-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_c_chunks_raw'
        },
        (payload) => {
          console.log('[HealthIndicators] 🔔 Pipeline C chunk changed:', payload.new);
          loadHealthIndicators();
        }
      )
      .subscribe((status) => {
        console.log('[HealthIndicators] 📡 Pipeline C chunks channel status:', status);
      });
    
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channelB);
      supabase.removeChannel(channelBChunks);
      supabase.removeChannel(channelC);
      supabase.removeChannel(channelCChunks);
    };
  }, []);

  if (healthData.loading) {
    return null;
  }

  const totalProcessing = healthData.processing.awaitingCron.count + 
                         healthData.processing.activeProcessing.count + 
                         healthData.processing.stuck.count;
  
  const hasProcessingIssues = healthData.processing.stuck.count > 0;
  const isProcessingNormal = !hasProcessingIssues && totalProcessing > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 ml-2">
      {/* 1. IN ELABORAZIONE */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={hasProcessingIssues ? "destructive" : "outline"}
              className={`text-xs cursor-help ${
                !hasProcessingIssues && totalProcessing === 0
                  ? "border-green-500 text-green-700 dark:text-green-500"
                  : isProcessingNormal
                  ? "border-yellow-500 text-yellow-700 dark:text-yellow-500"
                  : ""
              }`}
            >
              <Activity className="h-3 w-3 mr-1" />
              In Elaborazione: {totalProcessing}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-md">
            {totalProcessing === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Nessun documento in elaborazione</p>
            ) : (
              <div className="space-y-2">
                {healthData.processing.awaitingCron.count > 0 && (
                  <div>
                    <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                      ⏳ {healthData.processing.awaitingCron.count} in attesa prossimo cron (tra ~{healthData.processing.awaitingCron.nextCronMin} min)
                    </p>
                    {healthData.processing.awaitingCron.files.slice(0, 5).map((doc, idx) => (
                      <p key={idx} className="text-xs truncate ml-4">• {doc.file_name}</p>
                    ))}
                  </div>
                )}
                {healthData.processing.activeProcessing.count > 0 && (
                  <div>
                    <p className="font-semibold text-blue-600 dark:text-blue-400">
                      🔄 {healthData.processing.activeProcessing.count} in chunking attivo
                    </p>
                    {healthData.processing.activeProcessing.files.slice(0, 5).map((doc, idx) => (
                      <p key={idx} className="text-xs truncate ml-4">• {doc.file_name}</p>
                    ))}
                  </div>
                )}
                {healthData.processing.stuck.count > 0 && (
                  <div>
                    <p className="font-semibold text-red-600 dark:text-red-400">
                      ❌ {healthData.processing.stuck.count} bloccati (&gt;15 min)
                    </p>
                    {healthData.processing.stuck.files.slice(0, 5).map((doc, idx) => (
                      <p key={idx} className="text-xs truncate ml-4">• {doc.file_name}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 2. CHUNKS PRONTI */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant="outline"
              className="text-xs cursor-help border-green-500 text-green-700 dark:text-green-500"
            >
              <Package className="h-3 w-3 mr-1" />
              Chunks: {healthData.chunks.ready.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <div>
              <p className="font-semibold text-green-600 dark:text-green-400">
                ✅ {healthData.chunks.ready.count} documenti pronti con chunks
              </p>
              <ul className="text-xs mt-2 space-y-1">
                <li>Legacy: {healthData.chunks.ready.byPipeline.legacy}</li>
                <li>Pipeline A: {healthData.chunks.ready.byPipeline.a}</li>
                <li>Pipeline B: {healthData.chunks.ready.byPipeline.b}</li>
                <li>Pipeline C: {healthData.chunks.ready.byPipeline.c}</li>
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 3. CODA AUTOMATICA */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant="outline"
              className={`text-xs cursor-help ${
                healthData.cronQueue.processQueue.count === 0 && healthData.cronQueue.embeddingQueue.count === 0
                  ? "border-green-500 text-green-700 dark:text-green-500"
                  : "border-yellow-500 text-yellow-700 dark:text-yellow-500"
              }`}
            >
              <Clock className="h-3 w-3 mr-1" />
              Coda: {healthData.cronQueue.processQueue.count + healthData.cronQueue.embeddingQueue.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-md">
            {healthData.cronQueue.processQueue.count === 0 && healthData.cronQueue.embeddingQueue.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Nessun documento in coda</p>
            ) : (
              <div className="space-y-2">
                {healthData.cronQueue.processQueue.count > 0 && (
                  <div>
                    <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                      📋 {healthData.cronQueue.processQueue.count} in attesa chunking
                    </p>
                    <p className="text-xs text-muted-foreground">Prossimo cron tra ~{healthData.cronQueue.processQueue.nextCronMin} min (ogni 10 min)</p>
                  </div>
                )}
                {healthData.cronQueue.embeddingQueue.count > 0 && (
                  <div>
                    <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                      🔗 {healthData.cronQueue.embeddingQueue.count} in attesa embeddings
                    </p>
                    <p className="text-xs text-muted-foreground">Prossimo cron tra ~{healthData.cronQueue.embeddingQueue.nextCronMin} min (ogni 5 min)</p>
                  </div>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 4. EMBEDDINGS */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant="outline"
              className={`text-xs cursor-help ${
                healthData.embeddings.pending.count === 0
                  ? "border-green-500 text-green-700 dark:text-green-500"
                  : "border-yellow-500 text-yellow-700 dark:text-yellow-500"
              }`}
            >
              <Link2 className="h-3 w-3 mr-1" />
              Embeddings: {healthData.embeddings.pending.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {healthData.embeddings.pending.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Tutti gli embeddings generati</p>
            ) : (
              <div>
                <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                  ⏳ {healthData.embeddings.pending.count} chunks in attesa embedding
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Prossimo cron tra ~{healthData.embeddings.pending.nextCronMin} min (ogni 5 min)
                </p>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 5. FALLITI */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={healthData.failed.count === 0 ? "outline" : "destructive"}
              className={`text-xs cursor-help ${
                healthData.failed.count === 0
                  ? "border-green-500 text-green-700 dark:text-green-500"
                  : ""
              }`}
            >
              <XCircle className="h-3 w-3 mr-1" />
              Falliti: {healthData.failed.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-md">
            {healthData.failed.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Nessun documento fallito</p>
            ) : (
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400">
                  ❌ {healthData.failed.count} documenti falliti
                </p>
                <ul className="text-xs mt-2 space-y-2">
                  {healthData.failed.files.slice(0, 5).map((file, idx) => (
                    <li key={idx}>
                      <p className="font-semibold truncate">• {file.name}</p>
                      <p className="text-muted-foreground ml-4">{file.pipeline}</p>
                      <p className="text-red-600 dark:text-red-400 ml-4">{file.error}</p>
                      {file.error.includes('402') && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 ml-4">
                          💡 Verifica crediti Landing AI e usa "Riprocessa"
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
