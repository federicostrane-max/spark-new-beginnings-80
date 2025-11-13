import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface GapAnalysisViewProps {
  agentId: string;
  refreshTrigger?: number;
}

export default function GapAnalysisView({ agentId }: GapAnalysisViewProps) {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        🚧 La Gap Analysis è in fase di aggiornamento per il sistema v6. 
        Disponibile a breve con il nuovo sistema di analisi basato su 5 dimensioni.
      </AlertDescription>
    </Alert>
  );
}
