import React, { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Folder, Edit2, Trash2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FolderInfo {
  name: string;
  count: number;
}

interface ManageFoldersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderInfo[];
  onFoldersChanged: () => void;
}

export function ManageFoldersDialog({
  open,
  onOpenChange,
  folders: propFolders,
  onFoldersChanged,
}: ManageFoldersDialogProps) {
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<FolderInfo | null>(null);
  const [deleteAction, setDeleteAction] = useState<"unassign" | "move">("unassign");
  const [moveToFolder, setMoveToFolder] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const { toast } = useToast();

  // Load folders from database when dialog opens
  React.useEffect(() => {
    if (open) {
      loadFolders();
    }
  }, [open]);

  const loadFolders = async () => {
    try {
      const { data: foldersData, error } = await supabase
        .from('folders')
        .select('id, name')
        .order('name');

      if (error) throw error;

      // Get document count for each folder
      const foldersWithCounts = await Promise.all(
        (foldersData || []).map(async (folder) => {
          const { count, error: countError } = await supabase
            .from('knowledge_documents')
            .select('*', { count: 'exact', head: true })
            .eq('folder', folder.name);

          if (countError) throw countError;

          return {
            name: folder.name,
            count: count || 0,
          };
        })
      );

      setFolders(foldersWithCounts);
    } catch (error) {
      console.error("Error loading folders:", error);
      toast({
        title: "Errore",
        description: "Impossibile caricare le cartelle",
        variant: "destructive",
      });
    }
  };

  const handleRename = async (oldName: string) => {
    const trimmedName = newName.trim();
    
    if (!trimmedName) {
      toast({
        title: "Nome obbligatorio",
        description: "Inserisci un nuovo nome per la cartella",
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

    if (folders.some(f => f.name === trimmedName)) {
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
        .eq('name', oldName);

      if (folderError) throw folderError;

      // Update folder name in documents
      const { error: docsError } = await supabase
        .from('knowledge_documents')
        .update({ folder: trimmedName })
        .eq('folder', oldName);

      if (docsError) throw docsError;

      toast({
        title: "Cartella rinominata",
        description: `"${oldName}" → "${trimmedName}"`,
      });

      setRenamingFolder(null);
      setNewName("");
      loadFolders();
      onFoldersChanged();
    } catch (error) {
      console.error("Errore nella rinomina:", error);
      toast({
        title: "Errore",
        description: "Impossibile rinominare la cartella",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingFolder) return;

    setIsLoading(true);

    try {
      let updateValue: string | null = null;

      if (deleteAction === "move") {
        if (!moveToFolder) {
          toast({
            title: "Seleziona destinazione",
            description: "Scegli una cartella di destinazione per i documenti",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
        updateValue = moveToFolder;
      }

      // Update documents first
      const { error: docsError } = await supabase
        .from('knowledge_documents')
        .update({ folder: updateValue })
        .eq('folder', deletingFolder.name);

      if (docsError) throw docsError;

      // Delete folder from folders table
      const { error: folderError } = await supabase
        .from('folders')
        .delete()
        .eq('name', deletingFolder.name);

      if (folderError) throw folderError;

      toast({
        title: "Cartella eliminata",
        description: deleteAction === "move"
          ? `${deletingFolder.count} documento/i spostato/i in "${moveToFolder}"`
          : `${deletingFolder.count} documento/i ora senza cartella`,
      });

      setDeletingFolder(null);
      setDeleteAction("unassign");
      setMoveToFolder("");
      loadFolders();
      onFoldersChanged();
    } catch (error) {
      console.error("Errore nell'eliminazione:", error);
      toast({
        title: "Errore",
        description: "Impossibile eliminare la cartella",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5" />
              Gestisci Cartelle
            </DialogTitle>
            <DialogDescription>
              Rinomina o elimina cartelle. Le modifiche si applicano a tutti i documenti.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            {folders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nessuna cartella presente</p>
              </div>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder.name}
                  className="flex items-center justify-between p-4 border rounded-lg bg-card"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <Folder className="h-5 w-5 text-muted-foreground" />
                    
                    {renamingFolder === folder.name ? (
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(folder.name);
                          if (e.key === "Escape") {
                            setRenamingFolder(null);
                            setNewName("");
                          }
                        }}
                        className="max-w-xs"
                        autoFocus
                      />
                    ) : (
                      <>
                        <span className="font-medium">{folder.name}</span>
                        <Badge variant="secondary">{folder.count} doc</Badge>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {renamingFolder === folder.name ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleRename(folder.name)}
                          disabled={isLoading}
                        >
                          Salva
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRenamingFolder(null);
                            setNewName("");
                          }}
                        >
                          Annulla
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRenamingFolder(folder.name);
                            setNewName(folder.name);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeletingFolder(folder)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Alert Dialog per conferma eliminazione */}
      <AlertDialog open={!!deletingFolder} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Elimina Cartella
            </AlertDialogTitle>
            <AlertDialogDescription>
              Stai per eliminare la cartella <strong>"{deletingFolder?.name}"</strong> che contiene{" "}
              <strong>{deletingFolder?.count} documento/i</strong>.
              <br /><br />
              Cosa vuoi fare con i documenti?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3">
              <input
                type="radio"
                id="unassign"
                checked={deleteAction === "unassign"}
                onChange={() => setDeleteAction("unassign")}
                className="mt-1"
              />
              <label htmlFor="unassign" className="flex-1 cursor-pointer">
                <div className="font-medium">Rimuovi cartella</div>
                <div className="text-sm text-muted-foreground">
                  I documenti rimarranno nel pool senza cartella
                </div>
              </label>
            </div>

            <div className="flex items-start gap-3">
              <input
                type="radio"
                id="move"
                checked={deleteAction === "move"}
                onChange={() => setDeleteAction("move")}
                className="mt-1"
              />
              <label htmlFor="move" className="flex-1 cursor-pointer">
                <div className="font-medium">Sposta in altra cartella</div>
                <div className="text-sm text-muted-foreground">
                  I documenti verranno spostati nella cartella selezionata
                </div>
              </label>
            </div>

            {deleteAction === "move" && (
              <Select value={moveToFolder} onValueChange={setMoveToFolder}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona cartella di destinazione" />
                </SelectTrigger>
                <SelectContent>
                  {folders
                    .filter(f => f.name !== deletingFolder?.name)
                    .map((folder) => (
                      <SelectItem key={folder.name} value={folder.name}>
                        {folder.name} ({folder.count} doc)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading || (deleteAction === "move" && !moveToFolder)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? "Eliminazione..." : "Elimina Cartella"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
