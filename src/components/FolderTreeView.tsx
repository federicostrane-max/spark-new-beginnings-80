import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText, CheckCircle2, XCircle, Clock, AlertCircle, MoreVertical, Users, Trash2, FolderCheck, Edit2, FolderInput } from "lucide-react";
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
        folders.map((folder) => {
          const isExpanded = expandedFolders.has(folder.id);
          const folderDocs = folder.documents;
          const allFolderDocs = getAllDocsIncludingChildren(folder);
          const selectedInFolder = allFolderDocs.filter(doc => selectedDocuments.has(doc.id)).length;
          
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
                    {folder.totalFiles 
                      ? `${folder.documentCount}/${folder.totalFiles}` 
                      : `${folder.documentCount}`} {!folder.totalFiles && (folder.documentCount === 1 ? 'documento' : 'documenti')}
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
              </div>

              <CollapsibleContent className="border-t">
                {/* Render children folders if they exist */}
                {folder.children && folder.children.length > 0 && (
                  <div className="border-l-2 border-border ml-12 my-2">
                    {folder.children.map((childFolder) => {
                      const isChildExpanded = expandedFolders.has(childFolder.id);
                      const childDocs = childFolder.documents;
                      const selectedInChild = childDocs.filter(doc => selectedDocuments.has(doc.id)).length;
                      
                      return (
                        <Collapsible
                          key={childFolder.id}
                          open={isChildExpanded}
                          onOpenChange={() => toggleFolder(childFolder.id)}
                          className="border rounded-lg mx-2 mb-2"
                        >
                          <div className="flex items-center justify-between p-2 bg-muted/30 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-2 flex-1">
                              <Checkbox
                                checked={selectedInChild === childDocs.length && childDocs.length > 0}
                                ref={(el: any) => {
                                  if (el && selectedInChild > 0 && selectedInChild < childDocs.length) {
                                    el.indeterminate = true;
                                  }
                                }}
                                onCheckedChange={() => handleFolderCheckboxChange(childDocs, selectedInChild, childFolder.fullName || childFolder.name)}
                                onClick={(e) => e.stopPropagation()}
                                className="mr-1"
                              />
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  {isChildExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </Button>
                              </CollapsibleTrigger>
                              {isChildExpanded ? (
                                <FolderOpen className="h-4 w-4 text-blue-400" />
                              ) : (
                                <Folder className="h-4 w-4 text-blue-400" />
                              )}
                              <span className="text-sm font-medium">{childFolder.name}</span>
                              <Badge variant="secondary" className="ml-1 text-xs">
                                {childFolder.totalFiles 
                                  ? `${childFolder.documentCount}/${childFolder.totalFiles}` 
                                  : childFolder.documentCount}
                              </Badge>
                              {selectedInChild > 0 && (
                                <Badge variant="outline" className="ml-1 text-xs">
                                  {selectedInChild} sel.
                                </Badge>
                              )}
                            </div>
                          </div>
                          
                          <CollapsibleContent className="border-t">
                            {childDocs.length === 0 ? (
                              <div className="p-4 text-center text-muted-foreground text-xs">
                                <FileText className="h-6 w-6 mx-auto mb-1 opacity-50" />
                                Nessun documento
                              </div>
                            ) : (
                              <div className="divide-y">
                                {childDocs.map((doc) => (
                                  <div
                                    key={doc.id}
                                    className="flex items-center gap-2 p-2 hover:bg-muted/20 transition-colors cursor-pointer text-sm"
                                    onClick={() => onDocumentClick(doc)}
                                  >
                                    <Checkbox
                                      checked={selectedDocuments.has(doc.id)}
                                      onCheckedChange={() => onDocumentSelect(doc.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="flex items-center gap-1 min-w-0">
                                      {getStatusIcon(doc.validation_status, doc.processing_status)}
                                      <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium truncate">{doc.file_name}</p>
                                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                        <span>{formatDistanceToNow(new Date(doc.created_at), { addSuffix: true, locale: it })}</span>
                                        {doc.page_count && (<><span>•</span><span>{doc.page_count}p</span></>)}
                                      </div>
                                    </div>
                                    <Badge variant={getStatusBadgeVariant(doc.validation_status, doc.processing_status)} className="text-[10px] flex-shrink-0">
                                      {doc.processing_status === "ready_for_assignment" ? "✓" : "⏳"}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                )}
                
                {/* Render direct documents if no children or if folder has both children and direct docs */}
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
