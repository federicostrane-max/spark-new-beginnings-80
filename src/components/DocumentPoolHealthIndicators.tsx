import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, PackageX, Clock, AlertTriangle } from "lucide-react";

interface HealthData {
  stuckProcessing: { count: number; files: string[] };
  noChunks: { count: number; files: string[] };
  stuckQueue: { count: number; files: string[] };
  pendingValidation: { count: number; files: string[] };
  notProcessed: { count: number; files: Array<{ name: string; status: string }> };
  loading: boolean;
}

export const DocumentPoolHealthIndicators = () => {
  const [healthData, setHealthData] = useState<HealthData>({
    stuckProcessing: { count: 0, files: [] },
    noChunks: { count: 0, files: [] },
    stuckQueue: { count: 0, files: [] },
    pendingValidation: { count: 0, files: [] },
    notProcessed: { count: 0, files: [] },
    loading: true
  });


  const loadHealthIndicators = async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    // Initialize with safe defaults
    let stuckProcessingData = { count: 0, files: [] };
    let noChunksData = { count: 0, files: [] };
    let stuckQueueData = { count: 0, files: [] };
    let pendingValidationData = { count: 0, files: [] };
    let notProcessedData = { count: 0, files: [] };

    // 1. Stuck processing documents - with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const { data: stuckDocs, count: stuckCount } = await supabase
        .from('knowledge_documents')
        .select('file_name', { count: 'exact' })
        .eq('processing_status', 'processing')
        .lt('created_at', tenMinutesAgo)
        .order('created_at', { ascending: true })
        .limit(10)
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      stuckProcessingData = { count: stuckCount || 0, files: stuckDocs?.map(d => d.file_name) || [] };
    } catch (error) {
      console.error('[HealthIndicators] stuckProcessing failed:', error);
    }

    // 2. Documents without chunks - with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const { data: noChunksTotal, error: rpcError } = await supabase
        .rpc('count_documents_without_chunks')
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      
      if (rpcError) throw rpcError;

      let docsWithoutChunks: string[] = [];
      if (noChunksTotal && noChunksTotal > 0) {
        const { data: allDocs } = await supabase
          .from('knowledge_documents')
          .select('id, file_name')
          .eq('processing_status', 'ready_for_assignment')
          .limit(100);

        if (allDocs) {
          for (const doc of allDocs) {
            const { count } = await supabase
              .from('agent_knowledge')
              .select('*', { count: 'exact', head: true })
              .eq('pool_document_id', doc.id);
            
            if (!count || count === 0) {
              docsWithoutChunks.push(doc.file_name);
              if (docsWithoutChunks.length >= 10) break;
            }
          }
        }
      }
      noChunksData = { count: noChunksTotal || 0, files: docsWithoutChunks };
    } catch (error) {
      console.error('[HealthIndicators] noChunks failed:', error);
    }

    // 3. Stuck queue jobs - with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const { data: queueDocs, count: queueStuckCount } = await supabase
        .from('document_processing_queue')
        .select('document_id, knowledge_documents!inner(file_name)', { count: 'exact' })
        .eq('status', 'processing')
        .lt('started_at', tenMinutesAgo)
        .limit(10)
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      stuckQueueData = { 
        count: queueStuckCount || 0, 
        files: queueDocs?.map(q => q.knowledge_documents?.file_name).filter(Boolean) || [] 
      };
    } catch (error) {
      console.error('[HealthIndicators] stuckQueue failed:', error);
    }

    // 4. Pending validation - with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const { data: pendingDocs, count: pendingCount } = await supabase
        .from('knowledge_documents')
        .select('file_name', { count: 'exact' })
        .eq('validation_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10)
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      pendingValidationData = { count: pendingCount || 0, files: pendingDocs?.map(d => d.file_name) || [] };
    } catch (error) {
      console.error('[HealthIndicators] pendingValidation failed:', error);
    }

    // 5. Not processed documents - with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const { data: notProcessedDocs, count: notProcessedCount } = await supabase
        .from('knowledge_documents')
        .select('file_name, processing_status', { count: 'exact' })
        .neq('processing_status', 'ready_for_assignment')
        .eq('validation_status', 'validated')
        .order('updated_at', { ascending: false })
        .limit(10)
        .abortSignal(controller.signal);

      clearTimeout(timeout);
      notProcessedData = { 
        count: notProcessedCount || 0, 
        files: notProcessedDocs?.map(d => ({ name: d.file_name, status: d.processing_status })) || [] 
      };
    } catch (error) {
      console.error('[HealthIndicators] notProcessed failed:', error);
    }

    // Set all data at once with safe defaults
    setHealthData({
      stuckProcessing: stuckProcessingData,
      noChunks: noChunksData,
      stuckQueue: stuckQueueData,
      pendingValidation: pendingValidationData,
      notProcessed: notProcessedData,
      loading: false,
    });
  };

  useEffect(() => {
    loadHealthIndicators();
    const interval = setInterval(loadHealthIndicators, 30000); // ogni 30 sec
    return () => clearInterval(interval);
  }, []);

  if (healthData.loading) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 ml-2">
      {/* Documenti bloccati in processing - SEMPRE VISIBILE */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={healthData.stuckProcessing.count === 0 ? "outline" : "destructive"}
              className={`text-xs cursor-help ${healthData.stuckProcessing.count === 0 ? "border-green-500 text-green-700 dark:text-green-500" : ""}`}
            >
              <AlertCircle className="h-3 w-3 mr-1" />
              Bloccati: {healthData.stuckProcessing.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {healthData.stuckProcessing.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Tutto OK - Nessun documento bloccato in processing</p>
            ) : (
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400">
                  ⚠️ {healthData.stuckProcessing.count} documenti bloccati in processing (&gt;10 min)
                </p>
                {healthData.stuckProcessing.files.length > 0 && (
                  <ul className="text-xs mt-2 space-y-1">
                    {healthData.stuckProcessing.files.map((file, idx) => (
                      <li key={idx} className="truncate">• {file}</li>
                    ))}
                    {healthData.stuckProcessing.count > 10 && (
                      <li className="italic text-muted-foreground">... e altri {healthData.stuckProcessing.count - 10}</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Documenti senza chunks - SEMPRE VISIBILE */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={healthData.noChunks.count === 0 ? "outline" : "destructive"}
              className={`text-xs cursor-help ${
                healthData.noChunks.count === 0 
                  ? "border-green-500 text-green-700 dark:text-green-500" 
                  : ""
              }`}
            >
              <PackageX className="h-3 w-3 mr-1" />
              Senza Chunks: {healthData.noChunks.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {healthData.noChunks.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Tutto OK - Tutti i documenti hanno chunks</p>
            ) : (
              <div>
                <p className="font-semibold text-orange-600 dark:text-orange-400">
                  ⚠️ {healthData.noChunks.count} documenti senza chunks generati
                </p>
                {healthData.noChunks.files.length > 0 && (
                  <ul className="text-xs mt-2 space-y-1">
                    {healthData.noChunks.files.map((file, idx) => (
                      <li key={idx} className="truncate">• {file}</li>
                    ))}
                    {healthData.noChunks.count > 10 && (
                      <li className="italic text-muted-foreground">... e altri {healthData.noChunks.count - 10}</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Documenti non processati - SEMPRE VISIBILE */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={healthData.notProcessed.count === 0 ? "outline" : "destructive"}
              className={`text-xs cursor-help ${
                healthData.notProcessed.count === 0 
                  ? "border-green-500 text-green-700 dark:text-green-500" 
                  : ""
              }`}
            >
              <AlertCircle className="h-3 w-3 mr-1" />
              Non Processati: {healthData.notProcessed.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {healthData.notProcessed.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Tutto OK - Tutti i documenti validati sono stati processati</p>
            ) : (
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400">
                  ⚠️ {healthData.notProcessed.count} documenti validati non processati
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Documenti validati ma con errori di processing
                </p>
                {healthData.notProcessed.files.length > 0 && (
                  <ul className="text-xs mt-2 space-y-1">
                    {healthData.notProcessed.files.map((file, idx) => (
                      <li key={idx} className="truncate">• {file.name} ({file.status})</li>
                    ))}
                    {healthData.notProcessed.count > 10 && (
                      <li className="italic text-muted-foreground">... e altri {healthData.notProcessed.count - 10}</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Job queue bloccati - SEMPRE VISIBILE */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge 
              variant={healthData.stuckQueue.count === 0 ? "outline" : "destructive"}
              className={`text-xs cursor-help ${healthData.stuckQueue.count === 0 ? "border-green-500 text-green-700 dark:text-green-500" : ""}`}
            >
              <Clock className="h-3 w-3 mr-1" />
              Queue: {healthData.stuckQueue.count}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            {healthData.stuckQueue.count === 0 ? (
              <p className="text-green-600 dark:text-green-400">✅ Tutto OK - Nessun job bloccato nella coda</p>
            ) : (
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400">
                  ⚠️ {healthData.stuckQueue.count} job bloccati nella coda (&gt;10 min)
                </p>
                {healthData.stuckQueue.files.length > 0 && (
                  <ul className="text-xs mt-2 space-y-1">
                    {healthData.stuckQueue.files.map((file, idx) => (
                      <li key={idx} className="truncate">• {file}</li>
                    ))}
                    {healthData.stuckQueue.count > 10 && (
                      <li className="italic text-muted-foreground">... e altri {healthData.stuckQueue.count - 10}</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Documenti pending validation */}
      {(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge 
                variant={healthData.pendingValidation.count === 0 ? "outline" : "destructive"}
                className={`text-xs cursor-help ${
                  healthData.pendingValidation.count === 0 
                    ? "border-green-500 text-green-700 dark:text-green-500" 
                    : ""
                }`}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Pending: {healthData.pendingValidation.count}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              {healthData.pendingValidation.count === 0 ? (
                <p className="text-green-600 dark:text-green-400">✅ Tutto OK - Nessun documento in attesa di validazione</p>
              ) : (
                <div>
                  <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                    ⚠️ {healthData.pendingValidation.count} documenti in attesa di validazione
                  </p>
                  {healthData.pendingValidation.files.length > 0 && (
                    <ul className="text-xs mt-2 space-y-1">
                      {healthData.pendingValidation.files.map((file, idx) => (
                        <li key={idx} className="truncate">• {file}</li>
                      ))}
                      {healthData.pendingValidation.count > 10 && (
                        <li className="italic text-muted-foreground">... e altri {healthData.pendingValidation.count - 10}</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
