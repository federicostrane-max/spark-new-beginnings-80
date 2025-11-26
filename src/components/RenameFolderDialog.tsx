import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Edit2 } from "lucide-react";

interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  currentName: string;
  existingFolders: string[];
  onRenamed: () => void;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folderId,
  currentName,
  existingFolders,
  onRenamed,
}: RenameFolderDialogProps) {
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRename = async () => {
    const trimmedName = newName.trim();

    if (!trimmedName) {
      toast({
        title: "Nome obbligatorio",
        description: "Inserisci un nuovo nome per la cartella",
        variant: "destructive",
      });
      return;
    }

    if (trimmedName === currentName) {
      toast({
        title: "Nome identico",
        description: "Il nuovo nome è uguale a quello attuale",
        variant: "destructive",
      });
      return;
    }

    if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
      toast({
        title: "Nome non valido",
        description: "Usa solo lettere, numeri, underscore e trattini",
        variant: "destructive",
      });
      return;
    }

    if (existingFolders.includes(trimmedName)) {
      toast({
        title: "Cartella esistente",
        description: "Una cartella con questo nome esiste già",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Update folder name in folders table
      const { error: folderError } = await supabase
        .from('folders')
        .update({ name: trimmedName })
        .eq('id', folderId);

      if (folderError) throw folderError;

      // Update folder field in documents across all pipelines
      await Promise.all([
        supabase
          .from('pipeline_a_documents')
          .update({ folder: trimmedName })
          .eq('folder', currentName),
        supabase
          .from('pipeline_b_documents')
          .update({ folder: trimmedName })
          .eq('folder', currentName),
        supabase
          .from('pipeline_c_documents')
          .update({ folder: trimmedName })
          .eq('folder', currentName)
      ]);

      toast({
        title: "Cartella rinominata",
        description: `"${currentName}" è stata rinominata in "${trimmedName}"`,
      });

      setNewName("");
      onRenamed();
      onOpenChange(false);
    } catch (error) {
      console.error("Errore nel rinominare la cartella:", error);
      toast({
        title: "Errore",
        description: "Impossibile rinominare la cartella",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5" />
            Rinomina Cartella
          </DialogTitle>
          <DialogDescription>
            Rinomina la cartella "{currentName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="new-folder-name">Nuovo Nome</Label>
            <Input
              id="new-folder-name"
              placeholder={currentName}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <p className="text-xs text-muted-foreground">
              Usa lettere, numeri, underscore e trattini
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleRename} disabled={isLoading}>
            {isLoading ? "Rinominando..." : "Rinomina"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
