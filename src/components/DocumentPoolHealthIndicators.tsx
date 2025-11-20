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
  stuckProcessing: number;
  noChunks: number;
  stuckQueue: number;
  pendingValidation: number;
  loading: boolean;
}

export const DocumentPoolHealthIndicators = () => {
  const [healthData, setHealthData] = useState<HealthData>({
    stuckProcessing: 0,
    noChunks: 0,
    stuckQueue: 0,
    pendingValidation: 0,
    loading: true,
  });

  const loadHealthIndicators = async () => {
    try {
      // 1. Documenti in processing > 10 min
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { count: stuckCount } = await supabase
        .from('knowledge_documents')
        .select('*', { count: 'exact', head: true })
        .eq('processing_status', 'processing')
        .lt('created_at', tenMinutesAgo);

      // 2. Documenti senza chunks
      const { data: noChunksData, error: rpcError } = await supabase
        .rpc('count_documents_without_chunks');

      if (rpcError) {
        console.error('[HealthIndicators] RPC Error:', rpcError);
      }

      // 3. Job queue in processing > 10 min
      const { count: queueStuckCount } = await supabase
        .from('document_processing_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'processing')
        .lt('started_at', tenMinutesAgo);

      // 4. Documenti pending validation
      const { count: pendingCount } = await supabase
        .from('knowledge_documents')
        .select('*', { count: 'exact', head: true })
        .eq('validation_status', 'pending');

      setHealthData({
        stuckProcessing: stuckCount || 0,
        noChunks: noChunksData || 0,
        stuckQueue: queueStuckCount || 0,
        pendingValidation: pendingCount || 0,
        loading: false,
      });
    } catch (error) {
      console.error('[HealthIndicators] Error:', error);
      setHealthData(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    loadHealthIndicators();
    const interval = setInterval(loadHealthIndicators, 30000); // ogni 30 sec
    return () => clearInterval(interval);
  }, []);

  if (healthData.loading) {
    return null;
  }

  const hasIssues = 
    healthData.stuckProcessing > 0 ||
    healthData.noChunks > 0 ||
    healthData.stuckQueue > 0 ||
    healthData.pendingValidation > 0;

  if (!hasIssues) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 ml-2">
      {/* Documenti bloccati in processing */}
      {healthData.stuckProcessing > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="text-xs cursor-help">
                <AlertCircle className="h-3 w-3 mr-1" />
                {healthData.stuckProcessing}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">Documenti bloccati in elaborazione</p>
              <p className="text-xs">{healthData.stuckProcessing} documento/i in processing da più di 10 minuti</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Documenti senza chunks */}
      {healthData.noChunks > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge className="text-xs cursor-help bg-orange-500 hover:bg-orange-600 text-white">
                <PackageX className="h-3 w-3 mr-1" />
                {healthData.noChunks}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">Documenti senza chunks</p>
              <p className="text-xs">{healthData.noChunks} documento/i pronti ma senza chunks generati</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Job queue bloccati */}
      {healthData.stuckQueue > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="text-xs cursor-help">
                <Clock className="h-3 w-3 mr-1" />
                {healthData.stuckQueue}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">Job bloccati nella coda</p>
              <p className="text-xs">{healthData.stuckQueue} job in elaborazione da più di 10 minuti</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Documenti pending validation */}
      {healthData.pendingValidation > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge className="text-xs cursor-help bg-yellow-500 hover:bg-yellow-600 text-white">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {healthData.pendingValidation}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">Documenti in attesa di validazione</p>
              <p className="text-xs">{healthData.pendingValidation} documento/i pending validation</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
