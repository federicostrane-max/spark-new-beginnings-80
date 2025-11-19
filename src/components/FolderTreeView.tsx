import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText, CheckCircle2, XCircle, Clock, AlertCircle, MoreVertical, Users, Trash2, FolderCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
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
  documentCount: number;
  documents: KnowledgeDocument[];
}

interface FolderTreeViewProps {
  folders: FolderData[];
  onDocumentSelect: (docId: string) => void;
  selectedDocuments: Set<string>;
  onDocumentClick: (doc: KnowledgeDocument) => void;
  onFolderAssign?: (folderDocs: KnowledgeDocument[]) => void;
  onFolderDelete?: (folderId: string, folderName: string) => void;
  onBulkDocumentSelect?: (docIds: string[], shouldSelect: boolean) => void;
}

export function FolderTreeView({ 
  folders, 
  onDocumentSelect, 
  selectedDocuments,
  onDocumentClick,
  onFolderAssign,
  onFolderDelete,
  onBulkDocumentSelect
}: FolderTreeViewProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const handleFolderCheckboxChange = (folderDocs: KnowledgeDocument[], selectedCount: number) => {
    const shouldSelectAll = selectedCount < folderDocs.length;
    const docIds = folderDocs.map(doc => doc.id);
    
    // Se esiste la funzione bulk, usala (molto più efficiente)
    if (onBulkDocumentSelect) {
      onBulkDocumentSelect(docIds, shouldSelectAll);
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
        folders.map((folder) => {
          const isExpanded = expandedFolders.has(folder.id);
          const folderDocs = folder.documents;
          const selectedInFolder = folderDocs.filter(doc => selectedDocuments.has(doc.id)).length;
          
          return (
            <Collapsible
              key={folder.id}
              open={isExpanded}
              onOpenChange={() => toggleFolder(folder.id)}
              className="border rounded-lg"
            >
              <div className="flex items-center justify-between p-3 bg-muted/50 hover:bg-muted transition-colors">
                <div className="flex items-center gap-2 flex-1">
                  <Checkbox
                    checked={selectedInFolder === folderDocs.length && folderDocs.length > 0}
                    ref={(el: any) => {
                      if (el && selectedInFolder > 0 && selectedInFolder < folderDocs.length) {
                        el.indeterminate = true;
                      }
                    }}
                    onCheckedChange={() => handleFolderCheckboxChange(folderDocs, selectedInFolder)}
                    onClick={(e) => e.stopPropagation()}
                    className="mr-1"
                  />
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  {isExpanded ? (
                    <FolderOpen className="h-5 w-5 text-blue-500" />
                  ) : (
                    <Folder className="h-5 w-5 text-blue-500" />
                  )}
                  <span className="font-medium">{folder.name}</span>
                  <Badge variant="secondary" className="ml-2">
                    {folder.documentCount} {folder.documentCount === 1 ? 'documento' : 'documenti'}
                  </Badge>
                  {selectedInFolder > 0 && (
                    <Badge variant="outline" className="ml-1">
                      {selectedInFolder} selezionati
                    </Badge>
                  )}
                </div>
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
                        handleFolderCheckboxChange(folderDocs, 0);
                      }}
                    >
                      <FolderCheck className="mr-2 h-4 w-4" />
                      Seleziona tutti ({folder.documentCount})
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onFolderAssign) {
                          const readyDocs = folderDocs.filter(d => d.processing_status === 'ready_for_assignment');
                          onFolderAssign(readyDocs);
                        }
                      }}
                      disabled={folderDocs.filter(d => d.processing_status === 'ready_for_assignment').length === 0}
                    >
                      <Users className="mr-2 h-4 w-4" />
                      Assegna cartella a agente
                    </DropdownMenuItem>
                    
                    <DropdownMenuSeparator />
                    
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
              </div>

              <CollapsibleContent className="border-t">
                {folderDocs.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    Nessun documento in questa cartella
                  </div>
                ) : (
                  <div className="divide-y">
                    {folderDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => onDocumentClick(doc)}
                      >
                        <Checkbox
                          checked={selectedDocuments.has(doc.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              onDocumentSelect(doc.id);
                            } else {
                              onDocumentSelect(doc.id);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        
                        <div className="flex items-center gap-2 min-w-0">
                          {getStatusIcon(doc.validation_status, doc.processing_status)}
                          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium truncate">{doc.file_name}</p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {formatDistanceToNow(new Date(doc.created_at), {
                                addSuffix: true,
                                locale: it,
                              })}
                            </span>
                            {doc.page_count && (
                              <>
                                <span>•</span>
                                <span>{doc.page_count} pagine</span>
                              </>
                            )}
                            {doc.text_length && (
                              <>
                                <span>•</span>
                                <span>{Math.round(doc.text_length / 1000)}k caratteri</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge 
                            variant={getStatusBadgeVariant(doc.validation_status, doc.processing_status)}
                            className="text-xs"
                          >
                            {doc.processing_status === "ready_for_assignment" ? "Pronto" : doc.processing_status}
                          </Badge>
                          
                          {doc.agent_names && doc.agent_names.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {doc.agent_names.length} {doc.agent_names.length === 1 ? 'agente' : 'agenti'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })
      )}
    </div>
  );
}
