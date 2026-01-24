import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText, CheckCircle2, XCircle, Clock, AlertCircle, MoreVertical, Users, Trash2, FolderCheck, Edit2, FolderInput, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface KnowledgeDocument {
  id: string;
  file_name: string;
  validation_status: string;
  processing_status: string;
  created_at: string;
  agent_names: string[];
  folder?: string;
  ai_summary?: string;
  text_length?: number;
  page_count?: number;
}

interface FolderData {
  id: string;
  name: string;
  documentCount: number; // Documenti DIRETTI nella cartella (non include sottocartelle)
  totalDocumentCount?: number; // Totale RICORSIVO (include sottocartelle) - usato quando collassata
  totalFiles?: number;
  documents: KnowledgeDocument[];
  children?: FolderData[];
  isChild?: boolean;
  fullName?: string;
}

interface FolderTreeViewProps {
  folders: FolderData[];
  onDocumentSelect: (docId: string) => void;
  selectedDocuments: Set<string>;
  onDocumentClick: (doc: KnowledgeDocument) => void;
  onFolderAssign?: (folderName: string) => void;
  onFolderDelete?: (folderId: string, folderName: string) => void;
  onFolderRename?: (folderId: string, currentName: string) => void;
  onFolderMove?: (folderName: string) => void;
  onBulkDocumentSelect?: (docIds: string[], shouldSelect: boolean, folderName?: string) => void;
}

// Componente ricorsivo per renderizzare una singola cartella con tutti i suoi livelli
function FolderNode({ 
  folder, 
  depth = 0,
  expandedFolders,
  toggleFolder,
  selectedDocuments,
  onDocumentSelect,
  onDocumentClick,
  onFolderAssign,
  onFolderDelete,
  onFolderRename,
  onFolderMove,
  onBulkDocumentSelect,
  getAllDocsIncludingChildren,
  handleFolderCheckboxChange,
  getStatusIcon,
  getStatusBadgeVariant,
}: {
  folder: FolderData;
  depth?: number;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  selectedDocuments: Set<string>;
  onDocumentSelect: (docId: string) => void;
  onDocumentClick: (doc: KnowledgeDocument) => void;
  onFolderAssign?: (folderName: string) => void;
  onFolderDelete?: (folderId: string, folderName: string) => void;
  onFolderRename?: (folderId: string, currentName: string) => void;
  onFolderMove?: (folderName: string) => void;
  onBulkDocumentSelect?: (docIds: string[], shouldSelect: boolean, folderName?: string) => void;
  getAllDocsIncludingChildren: (folder: FolderData) => KnowledgeDocument[];
  handleFolderCheckboxChange: (folderDocs: KnowledgeDocument[], selectedCount: number, folderName: string) => void;
  getStatusIcon: (validation: string, processing: string) => JSX.Element;
  getStatusBadgeVariant: (validation: string, processing: string) => "default" | "secondary" | "destructive" | "outline";
}) {
  const isExpanded = expandedFolders.has(folder.id);
  const folderDocs = folder.documents;
  const allFolderDocs = getAllDocsIncludingChildren(folder);
  const selectedInFolder = allFolderDocs.filter(doc => selectedDocuments.has(doc.id)).length;

  const isRootLevel = depth === 0;

  return (
    <Collapsible
      key={folder.id}
      open={isExpanded}
      onOpenChange={() => toggleFolder(folder.id)}
      className={cn(
        "border rounded-lg",
        depth > 0 && "mx-2 mb-2"
      )}
    >
      <div className={cn(
        "flex items-center justify-between p-3 transition-colors",
        isRootLevel ? "bg-muted/50 hover:bg-muted" : "bg-muted/30 hover:bg-muted/50"
      )}>
        <div className="flex items-center gap-2 flex-1">
          <Checkbox
            checked={selectedInFolder === allFolderDocs.length && allFolderDocs.length > 0}
            ref={(el: any) => {
              if (el && selectedInFolder > 0 && selectedInFolder < allFolderDocs.length) {
                el.indeterminate = true;
              }
            }}
            onCheckedChange={() => handleFolderCheckboxChange(allFolderDocs, selectedInFolder, folder.fullName || folder.name)}
            onClick={(e) => e.stopPropagation()}
            className="mr-1"
          />
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(
              "p-0",
              isRootLevel ? "h-8 w-8" : "h-6 w-6"
            )}>
              {isExpanded ? (
                <ChevronDown className={isRootLevel ? "h-4 w-4" : "h-3 w-3"} />
              ) : (
                <ChevronRight className={isRootLevel ? "h-4 w-4" : "h-3 w-3"} />
              )}
            </Button>
          </CollapsibleTrigger>
          {isExpanded ? (
            <FolderOpen className={cn(
              isRootLevel ? "h-5 w-5 text-blue-500" : "h-4 w-4 text-blue-400"
            )} />
          ) : (
            <Folder className={cn(
              isRootLevel ? "h-5 w-5 text-blue-500" : "h-4 w-4 text-blue-400"
            )} />
          )}
          <span className={cn(
            "font-medium",
            isRootLevel ? "text-base" : "text-sm"
          )}>
            {folder.name}
          </span>
          <Badge variant="secondary" className={cn(
            isRootLevel ? "ml-2" : "ml-1 text-xs"
          )}>
            {isExpanded 
              ? `${folder.documentCount}` 
              : `${folder.totalDocumentCount || folder.documentCount}`}
            {' '}{(isExpanded ? folder.documentCount : (folder.totalDocumentCount || folder.documentCount)) === 1 ? 'documento' : 'documenti'}
          </Badge>
          {selectedInFolder > 0 && (
            <Badge variant="outline" className="ml-1 text-xs">
              {selectedInFolder} selezionati
            </Badge>
          )}
        </div>
        {isRootLevel && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleFolderCheckboxChange(allFolderDocs, 0, folder.fullName || folder.name);
                }}
              >
                <FolderCheck className="mr-2 h-4 w-4" />
                Seleziona tutti ({allFolderDocs.length})
              </DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  if (onFolderAssign) {
                    onFolderAssign(folder.fullName || folder.name);
                  }
                }}
                disabled={allFolderDocs.filter(d => d.processing_status === 'ready_for_assignment').length === 0}
              >
                <Users className="mr-2 h-4 w-4" />
                Assegna cartella a agente
              </DropdownMenuItem>

              {selectedInFolder > 0 && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onFolderMove) {
                      onFolderMove(folder.fullName || folder.name);
                    }
                  }}
                >
                  <FolderInput className="mr-2 h-4 w-4" />
                  Sposta documenti selezionati
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  if (onFolderRename) {
                    onFolderRename(folder.id, folder.name);
                  }
                }}
              >
                <Edit2 className="mr-2 h-4 w-4" />
                Rinomina cartella
              </DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  if (onFolderDelete) {
                    onFolderDelete(folder.id, folder.name);
                  }
                }}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Elimina cartella
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <CollapsibleContent className="border-t">
        {/* Render sottocartelle ricorsivamente */}
        {folder.children && folder.children.length > 0 && (
          <div className="border-l-2 border-border ml-12 my-2">
            {folder.children.map((childFolder) => (
              <FolderNode
                key={childFolder.id}
                folder={childFolder}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                selectedDocuments={selectedDocuments}
                onDocumentSelect={onDocumentSelect}
                onDocumentClick={onDocumentClick}
                onFolderAssign={onFolderAssign}
                onFolderDelete={onFolderDelete}
                onFolderRename={onFolderRename}
                onFolderMove={onFolderMove}
                onBulkDocumentSelect={onBulkDocumentSelect}
                getAllDocsIncludingChildren={getAllDocsIncludingChildren}
                handleFolderCheckboxChange={handleFolderCheckboxChange}
                getStatusIcon={getStatusIcon}
                getStatusBadgeVariant={getStatusBadgeVariant}
              />
            ))}
          </div>
        )}
        
        {/* Render documenti diretti */}
        {folderDocs.length === 0 && (!folder.children || folder.children.length === 0) ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nessun documento in questa cartella
          </div>
        ) : folderDocs.length > 0 ? (
          <div className="divide-y">
            {folderDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => onDocumentClick(doc)}
              >
                <Checkbox
                  checked={selectedDocuments.has(doc.id)}
                  onCheckedChange={() => onDocumentSelect(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex items-center gap-2 min-w-0">
                  {getStatusIcon(doc.validation_status, doc.processing_status)}
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDistanceToNow(new Date(doc.created_at), { addSuffix: true, locale: it })}</span>
                    {doc.page_count && (<><span>•</span><span>{doc.page_count} pagine</span></>)}
                    {doc.agent_names && doc.agent_names.length > 0 && (
                      <><span>•</span><span>{doc.agent_names.length} agenti</span></>
                    )}
                  </div>
                </div>
                <Badge variant={getStatusBadgeVariant(doc.validation_status, doc.processing_status)} className="text-xs flex-shrink-0">
                  {doc.processing_status === "ready_for_assignment" ? "✓" : "⏳"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDocumentClick(doc);
                  }}
                  title="Vedi dettagli completi"
                >
                  <Info className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FolderTreeView({ 
  folders, 
  onDocumentSelect, 
  selectedDocuments,
  onDocumentClick,
  onFolderAssign,
  onFolderDelete,
  onFolderRename,
  onFolderMove,
  onBulkDocumentSelect
}: FolderTreeViewProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Raccoglie ricorsivamente TUTTI i documenti (parent + children)
  const getAllDocsIncludingChildren = (folder: FolderData): KnowledgeDocument[] => {
    let allDocs = [...folder.documents];
    
    if (folder.children && folder.children.length > 0) {
      folder.children.forEach(child => {
        allDocs = [...allDocs, ...getAllDocsIncludingChildren(child)];
      });
    }
    
    return allDocs;
  };

  const handleFolderCheckboxChange = (folderDocs: KnowledgeDocument[], selectedCount: number, folderName: string) => {
    const shouldSelectAll = selectedCount < folderDocs.length;
    const docIds = folderDocs.map(doc => doc.id);
    
    // Se esiste la funzione bulk, usala (molto più efficiente)
    if (onBulkDocumentSelect) {
      onBulkDocumentSelect(docIds, shouldSelectAll, folderName);
    } else {
      // Fallback al metodo uno-per-uno (più lento)
      folderDocs.forEach(doc => {
        const isSelected = selectedDocuments.has(doc.id);
        if (shouldSelectAll && !isSelected) {
          onDocumentSelect(doc.id);
        } else if (!shouldSelectAll && isSelected) {
          onDocumentSelect(doc.id);
        }
      });
    }
  };

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const getStatusIcon = (validation: string, processing: string) => {
    if (validation === "validated" && processing === "ready_for_assignment") {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    } else if (validation === "rejected") {
      return <XCircle className="h-4 w-4 text-red-500" />;
    } else if (processing === "processing" || processing === "validating") {
      return <Clock className="h-4 w-4 text-yellow-500" />;
    } else {
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (validation: string, processing: string): "default" | "secondary" | "destructive" | "outline" => {
    if (validation === "validated" && processing === "ready_for_assignment") {
      return "default";
    } else if (validation === "rejected") {
      return "destructive";
    } else {
      return "secondary";
    }
  };

  return (
    <div className="space-y-2">
      {folders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nessuna cartella trovata</p>
          <p className="text-sm">Crea una cartella per organizzare i documenti</p>
        </div>
      ) : (
        folders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            depth={0}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
            selectedDocuments={selectedDocuments}
            onDocumentSelect={onDocumentSelect}
            onDocumentClick={onDocumentClick}
            onFolderAssign={onFolderAssign}
            onFolderDelete={onFolderDelete}
            onFolderRename={onFolderRename}
            onFolderMove={onFolderMove}
            onBulkDocumentSelect={onBulkDocumentSelect}
            getAllDocsIncludingChildren={getAllDocsIncludingChildren}
            handleFolderCheckboxChange={handleFolderCheckboxChange}
            getStatusIcon={getStatusIcon}
            getStatusBadgeVariant={getStatusBadgeVariant}
          />
        ))
      )}
    </div>
  );
}
