import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Folder } from "lucide-react";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFolders: string[];
  onFolderCreated: () => void;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  existingFolders,
  onFolderCreated,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    const trimmedName = folderName.trim();
    
    if (!trimmedName) {
      toast({
        title: "Nome obbligatorio",
        description: "Inserisci un nome per la cartella",
        variant: "destructive",
      });
      return;
    }

    // Validazione caratteri speciali
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
      toast({
        title: "Nome non valido",
        description: "Usa solo lettere, numeri, underscore e trattini",
        variant: "destructive",
      });
      return;
    }

    // Check duplicati
    if (existingFolders.includes(trimmedName)) {
      toast({
        title: "Cartella esistente",
        description: "Una cartella con questo nome esiste già",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    // La cartella verrà creata "virtualmente" - esisterà quando ci assegneremo documenti
    toast({
      title: "Cartella creata",
      description: `Cartella "${trimmedName}" pronta per l'uso`,
    });
    
    setFolderName("");
    onFolderCreated();
    onOpenChange(false);
    setIsLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Crea Nuova Cartella
          </DialogTitle>
          <DialogDescription>
            Inserisci un nome per la nuova cartella. Potrai assegnarci documenti successivamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Nome Cartella</Label>
            <Input
              id="folder-name"
              placeholder="es. Papers_Scientifici"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
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
          <Button onClick={handleCreate} disabled={isLoading}>
            Crea Cartella
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
