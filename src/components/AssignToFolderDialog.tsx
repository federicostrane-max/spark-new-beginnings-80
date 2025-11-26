import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Folder, FolderPlus } from "lucide-react";

interface AssignToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentIds: string[];
  documentNames: string[];
  availableFolders: string[];
  onAssigned: () => void;
}

export function AssignToFolderDialog({
  open,
  onOpenChange,
  documentIds,
  documentNames,
  availableFolders,
  onAssigned,
}: AssignToFolderDialogProps) {
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleAssign = async () => {
    let folderToAssign = selectedFolder;

    // Se sta creando una nuova cartella
    if (isCreatingNew) {
      const trimmedName = newFolderName.trim();
      
      if (!trimmedName) {
        toast({
          title: "Nome obbligatorio",
          description: "Inserisci un nome per la nuova cartella",
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

      if (availableFolders.includes(trimmedName)) {
        toast({
          title: "Cartella esistente",
          description: "Una cartella con questo nome esiste già",
          variant: "destructive",
        });
        return;
      }

      folderToAssign = trimmedName;
    } else if (!selectedFolder) {
      toast({
        title: "Seleziona una cartella",
        description: "Scegli una cartella di destinazione",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Se sta creando una nuova cartella, crearla prima nella tabella folders
      if (isCreatingNew) {
        const { error: folderError } = await supabase
          .from('folders')
          .insert({ name: folderToAssign });

        if (folderError) {
          console.error('[AssignToFolderDialog] Error creating folder:', folderError);
          toast({
            title: "Errore creazione cartella",
            description: folderError.message,
            variant: "destructive",
          });
          return;
        }
      }

      // Sistema legacy rimosso - funzionalità folder non più supportata per ora
      toast.error('Funzionalità cartelle temporaneamente disabilitata durante migrazione');
      return;

      setSelectedFolder("");
      setNewFolderName("");
      setIsCreatingNew(false);
      onAssigned();
      onOpenChange(false);
    } catch (error) {
      console.error("Errore nell'assegnazione:", error);
      toast({
        title: "Errore",
        description: "Impossibile assegnare i documenti alla cartella",
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
            <Folder className="h-5 w-5" />
            Assegna a Cartella
          </DialogTitle>
          <DialogDescription>
            {documentIds.length === 1
              ? "Assegna questo documento a una cartella"
              : `Assegna ${documentIds.length} documenti a una cartella`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Mostra nomi documenti se pochi */}
          {documentNames.length <= 3 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Documenti selezionati:</Label>
              {documentNames.map((name, idx) => (
                <p key={idx} className="text-sm truncate">{name}</p>
              ))}
            </div>
          )}

          {/* Toggle tra seleziona esistente e crea nuova */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={!isCreatingNew ? "default" : "outline"}
              size="sm"
              onClick={() => setIsCreatingNew(false)}
              className="flex-1"
            >
              <Folder className="h-4 w-4 mr-2" />
              Cartella Esistente
            </Button>
            <Button
              type="button"
              variant={isCreatingNew ? "default" : "outline"}
              size="sm"
              onClick={() => setIsCreatingNew(true)}
              className="flex-1"
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              Nuova Cartella
            </Button>
          </div>

          {/* Select cartella esistente */}
          {!isCreatingNew && (
            <div className="space-y-2">
              <Label>Cartella di destinazione</Label>
              <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona una cartella" />
                </SelectTrigger>
                <SelectContent>
                  {availableFolders.map((folder) => (
                    <SelectItem key={folder} value={folder}>
                      {folder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Input nuova cartella */}
          {isCreatingNew && (
            <div className="space-y-2">
              <Label htmlFor="new-folder">Nome Nuova Cartella</Label>
              <Input
                id="new-folder"
                placeholder="es. Papers_Scientifici"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAssign()}
              />
              <p className="text-xs text-muted-foreground">
                Usa lettere, numeri, underscore e trattini
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleAssign} disabled={isLoading}>
            {isLoading ? "Assegnazione..." : "Assegna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
