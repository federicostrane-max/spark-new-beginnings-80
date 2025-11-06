import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Database } from "lucide-react";
import { usePoolDocumentsHealth } from "@/hooks/useAgentHealth";

export const GlobalAlerts = () => {
  const navigate = useNavigate();
  const poolHealth = usePoolDocumentsHealth();

  if (!poolHealth.hasIssues) {
    return null;
  }

  const issueDetails = [
    poolHealth.stuckCount > 0 && `${poolHealth.stuckCount} bloccati`,
    poolHealth.errorCount > 0 && `${poolHealth.errorCount} con errori`,
    poolHealth.validatingCount > 0 && `${poolHealth.validatingCount} bloccati in validazione`,
    poolHealth.orphanedChunksCount > 0 && `${poolHealth.orphanedChunksCount} chunks orfani`,
    poolHealth.documentsWithoutChunksCount > 0 && `${poolHealth.documentsWithoutChunksCount} senza chunks`
  ].filter(Boolean).join(' • ');

  return (
    <Alert variant="destructive" className="mx-4 mt-4 border-2">
      <AlertTriangle className="h-5 w-5" />
      <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="font-semibold">
            {poolHealth.issueCount} {poolHealth.issueCount === 1 ? 'problema' : 'problemi'} nel pool documenti
          </span>
          <p className="text-sm mt-1 opacity-90">
            {issueDetails}
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate("/documents")}
          className="bg-background hover:bg-background/90 flex-shrink-0"
        >
          <Database className="h-4 w-4 mr-2" />
          Vai al Pool Documenti
        </Button>
      </AlertDescription>
    </Alert>
  );
};
