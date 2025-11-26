import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit2 } from "lucide-react";
import { toast } from "sonner";

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
}: RenameFolderDialogProps) {
  React.useEffect(() => {
    if (open) {
      toast.error("Funzionalità cartelle temporaneamente disabilitata");
      onOpenChange(false);
    }
  }, [open]);

  return null;
}
