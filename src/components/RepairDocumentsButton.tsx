import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Wrench, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export function RepairDocumentsButton() {
  const [isRepairing, setIsRepairing] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<any>(null);
  const { toast } = useToast();

  const handleRepair = async () => {
    setIsRepairing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "repair-and-assign-documents"
      );

      if (error) throw error;

      setReport(data);
      setShowReport(true);

      toast({
        title: "✅ Riparazione Completata",
        description: `${data.summary.documentsProcessed} documenti processati, ${data.summary.chunksCreated} chunks creati, ${data.summary.documentsSynced} assegnazioni ripristinate`,
      });
    } catch (error: any) {
      console.error("Repair error:", error);
      toast({
        title: "❌ Errore",
        description: error.message || "Errore durante la riparazione dei documenti",
        variant: "destructive",
      });
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleRepair}
        disabled={isRepairing}
        variant="outline"
        size="sm"
      >
        {isRepairing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Riparazione in corso...
          </>
        ) : (
          <>
            <Wrench className="mr-2 h-4 w-4" />
            Ripara e Assegna Documenti
          </>
        )}
      </Button>

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>📊 Report Riparazione Documenti</DialogTitle>
            <DialogDescription>
              Risultati dettagliati del processo di riparazione e assegnazione
            </DialogDescription>
          </DialogHeader>

          {report && (
            <ScrollArea className="max-h-[600px] pr-4">
              <div className="space-y-6">
                {/* Summary */}
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <h3 className="font-semibold text-lg">Riepilogo</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Documenti Processati:</span>
                      <span className="ml-2 font-medium">{report.summary.documentsProcessed}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Chunks Creati:</span>
                      <span className="ml-2 font-medium">{report.summary.chunksCreated}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Assegnazioni Ripristinate:</span>
                      <span className="ml-2 font-medium">{report.summary.assignmentsRestored}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Documenti Sincronizzati:</span>
                      <span className="ml-2 font-medium">{report.summary.documentsSynced}</span>
                    </div>
                  </div>
                </div>

                {/* Processing Details */}
                {report.processing.details.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">Dettagli Processamento</h3>
                    <div className="space-y-2">
                      {report.processing.details.map((doc: any, index: number) => (
                        <div
                          key={index}
                          className={`p-3 rounded-lg border ${
                            doc.status === "success"
                              ? "bg-green-500/10 border-green-500/20"
                              : "bg-red-500/10 border-red-500/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{doc.fileName}</span>
                            <span className="text-xs text-muted-foreground">
                              {doc.status === "success"
                                ? `✅ ${doc.chunksCreated} chunks`
                                : `❌ ${doc.error}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assignment Details */}
                {report.assignments.backupUsed && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">Backup Utilizzato</h3>
                    <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/20 space-y-1 text-sm">
                      <div><span className="text-muted-foreground">Nome:</span> <span className="ml-2 font-medium">{report.assignments.backupUsed.name}</span></div>
                      <div><span className="text-muted-foreground">Documenti:</span> <span className="ml-2 font-medium">{report.assignments.backupUsed.documentsCount}</span></div>
                      <div><span className="text-muted-foreground">Data:</span> <span className="ml-2 font-medium">{new Date(report.assignments.backupUsed.createdAt).toLocaleString('it-IT')}</span></div>
                    </div>
                  </div>
                )}

                {/* Timestamp */}
                <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                  Completato il {new Date(report.timestamp).toLocaleString('it-IT')}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
