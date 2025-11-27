import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Copy } from "lucide-react";
import { toast } from "sonner";

interface TestResult {
  success: boolean;
  log_id?: string;
  summary?: {
    total_elements: number;
    element_types: string[];
    has_native_reading_order: boolean;
    bbox_format: string;
    image_encoding: string;
    images_count: number;
  };
  sample_elements?: Record<string, any[]>;
  error?: string;
}

interface LlamaParseTestResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: TestResult | null;
}

export function LlamaParseTestResultDialog({
  open,
  onOpenChange,
  result,
}: LlamaParseTestResultDialogProps) {
  if (!result) return null;

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    toast.success("JSON copiato negli appunti");
  };

  if (!result.success) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-destructive" />
              Test Fallito
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">{result.error}</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { summary, sample_elements } = result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            🔬 Risultati Test LlamaParse Layout JSON
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <div className="text-sm font-medium mb-2">Elementi Totali</div>
              <div className="text-2xl font-bold">{summary?.total_elements || 0}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm font-medium mb-2">Immagini Trovate</div>
              <div className="text-2xl font-bold">{summary?.images_count || 0}</div>
            </div>
          </div>

          {/* Feature Detection */}
          <div className="space-y-3">
            <h3 className="font-semibold">Caratteristiche Rilevate</h3>
            
            <div className="flex items-center gap-2">
              {summary?.has_native_reading_order ? (
                <Badge variant="default" className="gap-1">
                  <Check className="h-3 w-3" />
                  Reading Order Nativo
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <X className="h-3 w-3" />
                  No Reading Order (serve algoritmo custom)
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Formato Bounding Box:</span>
                <Badge variant="outline">{summary?.bbox_format || 'unknown'}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Formato Immagini:</span>
                <Badge variant="outline">{summary?.image_encoding || 'unknown'}</Badge>
              </div>
            </div>
          </div>

          {/* Element Types */}
          <div className="space-y-3">
            <h3 className="font-semibold">Tipi di Elementi</h3>
            <div className="flex flex-wrap gap-2">
              {summary?.element_types.map((type) => (
                <Badge key={type} variant="secondary">
                  {type}
                </Badge>
              ))}
            </div>
          </div>

          {/* Sample Elements */}
          {sample_elements && Object.keys(sample_elements).length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold">Esempi di Elementi</h3>
              <div className="space-y-4">
                {Object.entries(sample_elements).map(([type, elements]) => (
                  <details key={type} className="border rounded-lg p-3">
                    <summary className="cursor-pointer font-medium">
                      {type} ({(elements as any[]).length} campioni)
                    </summary>
                    <pre className="mt-2 text-xs overflow-x-auto bg-muted p-2 rounded">
                      {JSON.stringify(elements, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleCopyJson} className="gap-2">
              <Copy className="h-4 w-4" />
              Copia JSON Completo
            </Button>
            <Button onClick={() => onOpenChange(false)}>
              Chiudi
            </Button>
          </div>

          {result.log_id && (
            <p className="text-xs text-muted-foreground text-center">
              Log salvato con ID: {result.log_id}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
