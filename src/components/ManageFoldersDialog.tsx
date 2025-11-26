import React, { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Folder, Edit2, Trash2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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
  React.useEffect(() => {
    if (open) {
      toast.error("Funzionalità cartelle temporaneamente disabilitata");
      onOpenChange(false);
    }
  }, [open]);

  return null;
}
