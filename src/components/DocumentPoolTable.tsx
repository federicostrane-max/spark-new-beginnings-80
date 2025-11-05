import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Search,
  Filter,
  Link as LinkIcon,
  Trash2,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AssignDocumentDialog } from "./AssignDocumentDialog";
import { DocumentDetailsDialog } from "./DocumentDetailsDialog";
import { BulkAssignDocumentDialog } from "./BulkAssignDocumentDialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface KnowledgeDocument {
  id: string;
  file_name: string;
  validation_status: string;
  validation_reason: string;
  processing_status: string;
  ai_summary: string;
  text_length: number;
  created_at: string;
  agent_names: string[];
  agents_count: number;
  keywords?: string[];
  topics?: string[];
  complexity_level?: string;
  agent_ids?: string[];
}

export const DocumentPoolTable = () => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<KnowledgeDocument | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [docToView, setDocToView] = useState<KnowledgeDocument | null>(null);
  
  // Bulk actions state
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  useEffect(() => {
    loadDocuments();
    loadAvailableAgents();
  }, []);

  useEffect(() => {
    console.log('[DocumentPoolTable] Component mounted');
    console.log('[DocumentPoolTable] Documents loaded:', documents.length);
  }, [documents]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select(`
          *,
          agent_document_links(
            agent_id,
            agents(id, name)
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Transform data to include agent info
      const transformedData = (data || []).map((doc: any) => {
        const links = doc.agent_document_links || [];
        const agentNames = links
          .map((link: any) => link.agents?.name)
          .filter(Boolean);
        
        return {
          id: doc.id,
          file_name: doc.file_name,
          validation_status: doc.validation_status,
          validation_reason: doc.validation_reason,
          processing_status: doc.processing_status,
          ai_summary: doc.ai_summary,
          text_length: doc.text_length,
          created_at: doc.created_at,
          agent_names: agentNames,
          agents_count: agentNames.length,
          keywords: doc.keywords || [],
          topics: doc.topics || [],
          complexity_level: doc.complexity_level || "",
          agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
        };
      });

      setDocuments(transformedData);
    } catch (error: any) {
      console.error('[DocumentPoolTable] Load error:', error);
      setError(error.message || "Errore sconosciuto");
      toast.error("Errore nel caricamento dei documenti");
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableAgents = async () => {
    try {
      // Query per ottenere solo gli agenti che hanno almeno un documento assegnato
      const { data, error } = await supabase
        .from("agent_document_links")
        .select(`
          agents(id, name)
        `);

      if (error) throw error;

      // Estrarre agenti unici
      const uniqueAgents = new Map<string, { id: string; name: string }>();
      data?.forEach((link: any) => {
        if (link.agents) {
          uniqueAgents.set(link.agents.id, {
            id: link.agents.id,
            name: link.agents.name,
          });
        }
      });

      setAvailableAgents(Array.from(uniqueAgents.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error: any) {
      console.error('[DocumentPoolTable] Error loading agents:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "validated":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "validation_failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "validating":
      case "processing":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      validated: "Validato",
      validation_failed: "Non Valido",
      validating: "In Validazione",
      processing: "In Elaborazione",
      ready_for_assignment: "Pronto",
      downloaded: "Scaricato",
    };
    return labels[status] || status;
  };

  const handleDelete = async (doc: KnowledgeDocument) => {
    try {
      const { error: linksError } = await supabase
        .from("agent_document_links")
        .delete()
        .eq("document_id", doc.id);

      if (linksError) throw linksError;

      const { error: knowledgeError } = await supabase
        .from("agent_knowledge")
        .delete()
        .eq("pool_document_id", doc.id);

      if (knowledgeError) throw knowledgeError;

      const { error: cacheError } = await supabase
        .from("document_processing_cache")
        .delete()
        .eq("document_id", doc.id);

      if (cacheError) throw cacheError;

      const filePath = `${doc.id}/${doc.file_name}`;
      const { error: storageError } = await supabase.storage
        .from("knowledge-pdfs")
        .remove([filePath]);

      if (storageError) console.warn("Storage deletion warning:", storageError);

      const { error: docError } = await supabase
        .from("knowledge_documents")
        .delete()
        .eq("id", doc.id);

      if (docError) throw docError;

      toast.success("Documento eliminato con successo");
      loadDocuments();
    } catch (error: any) {
      console.error("Error deleting document:", error);
      toast.error("Errore nell'eliminazione del documento");
    } finally {
      setDeleteDialogOpen(false);
      setDocToDelete(null);
    }
  };

  const handleToggleSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(docId)) {
        newSet.delete(docId);
      } else {
        newSet.add(docId);
      }
      return newSet;
    });
  };

  const handleToggleAll = () => {
    if (selectedDocIds.size === filteredDocuments.length && filteredDocuments.length > 0) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(filteredDocuments.map((d) => d.id)));
    }
  };

  const handleBulkDelete = async () => {
    const selectedDocs = documents.filter((d) => selectedDocIds.has(d.id));
    
    const results = await Promise.allSettled(
      selectedDocs.map((doc) => handleDelete(doc))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (failed > 0) {
      toast.error(`${succeeded} eliminati, ${failed} errori`);
    } else {
      toast.success(`${succeeded} documenti eliminati`);
    }

    setSelectedDocIds(new Set());
    setBulkDeleteDialogOpen(false);
    loadDocuments();
  };

  const selectedDocuments = documents.filter((d) => selectedDocIds.has(d.id));
  const validatedSelectedDocs = selectedDocuments.filter((d) => d.validation_status === "validated");

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      searchQuery === "" ||
      doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.ai_summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.agent_names?.some((name) => name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "all" || doc.validation_status === statusFilter;

    const matchesAgent =
      agentFilter === "all" ||
      (agentFilter === "none" && doc.agents_count === 0) ||
      ((doc as any).agent_ids?.includes(agentFilter));

    return matchesSearch && matchesStatus && matchesAgent;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtri
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cerca</label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nome file, summary, agenti..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="validated">Validato</SelectItem>
                  <SelectItem value="validation_failed">Non Valido</SelectItem>
                  <SelectItem value="ready_for_assignment">Pronto</SelectItem>
                  <SelectItem value="processing">In Elaborazione</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Agente</label>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="none">Nessuno</SelectItem>
                  {availableAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documenti ({filteredDocuments.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Caricamento...
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <XCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
              <p className="text-lg font-medium mb-2">Errore nel caricamento</p>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={loadDocuments} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Riprova
              </Button>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>Nessun documento trovato</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block rounded-md border overflow-x-auto">
              <Table key={`table-${documents.length}-${Date.now()}`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={selectedDocIds.size === filteredDocuments.length && filteredDocuments.length > 0}
                      onCheckedChange={handleToggleAll}
                      aria-label="Seleziona tutti"
                    />
                  </TableHead>
                  <TableHead className="w-[30%]">File</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[20%]">Agenti Assegnati</TableHead>
                  <TableHead className="w-[15%]">Creato</TableHead>
                  <TableHead className="w-[15%] text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc) => (
                  <TableRow 
                    key={doc.id}
                    className={selectedDocIds.has(doc.id) ? "bg-muted/50" : ""}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedDocIds.has(doc.id)}
                        onCheckedChange={() => handleToggleSelection(doc.id)}
                        aria-label={`Seleziona ${doc.file_name}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-0">
                      <div className="space-y-1">
                        <div className="font-medium truncate text-sm" title={doc.file_name}>
                          {doc.file_name}
                        </div>
                        {doc.ai_summary && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                            <div className="text-xs text-muted-foreground line-clamp-1 cursor-help hover:text-foreground transition-colors">
                              {doc.ai_summary}
                            </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md">
                                <p className="text-sm">{doc.ai_summary}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(doc.validation_status)}
                        <span className="text-sm">
                          {getStatusLabel(doc.validation_status)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {doc.agents_count === 0 ? (
                          <Badge variant="secondary" className="text-xs whitespace-nowrap">
                            Non assegnato
                          </Badge>
                        ) : doc.agent_names.length <= 1 ? (
                          doc.agent_names.map((name, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs truncate max-w-[120px]" title={name}>
                              {name}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-xs whitespace-nowrap" title={doc.agent_names.join(", ")}>
                            {doc.agents_count} agenti
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(doc.created_at), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDocToView(doc);
                          setDetailsDialogOpen(true);
                        }}
                        className="text-blue-600 h-8 w-8 p-0"
                        title="Vedi dettagli completi"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedDoc(doc);
                            setAssignDialogOpen(true);
                          }}
                          disabled={doc.validation_status !== "validated"}
                          className="h-8 w-8 p-0"
                          title="Assegna agenti"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setDocToDelete(doc);
                            setDeleteDialogOpen(true);
                          }}
                          className="h-8 w-8 p-0"
                          title="Elimina"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-4">
                {filteredDocuments.map((doc) => (
                  <Card key={doc.id} className={selectedDocIds.has(doc.id) ? "ring-2 ring-primary" : ""}>
                    <CardContent className="pt-6 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <Checkbox
                          checked={selectedDocIds.has(doc.id)}
                          onCheckedChange={() => handleToggleSelection(doc.id)}
                          aria-label={`Seleziona ${doc.file_name}`}
                        />
                      <div className="flex-1">
                          <div className="font-medium break-words text-sm mb-1">
                            {doc.file_name}
                          </div>
                          {doc.ai_summary && (
                            <div className="text-xs text-muted-foreground line-clamp-2">
                              {doc.ai_summary}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        {getStatusIcon(doc.validation_status)}
                        <span>{getStatusLabel(doc.validation_status)}</span>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {doc.agents_count === 0 ? (
                          <Badge variant="secondary" className="text-xs">
                            Non assegnato
                          </Badge>
                        ) : doc.agent_names.length <= 2 ? (
                          doc.agent_names.map((name, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {name}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {doc.agents_count} agenti
                          </Badge>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(doc.created_at), {
                          addSuffix: true,
                        })}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDocToView(doc);
                            setDetailsDialogOpen(true);
                          }}
                          className="flex-1"
                        >
                          <Info className="h-4 w-4 mr-1" />
                          Info
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedDoc(doc);
                            setAssignDialogOpen(true);
                          }}
                          disabled={doc.validation_status !== "validated"}
                          className="flex-1"
                        >
                          <LinkIcon className="h-4 w-4 mr-1" />
                          Assegna
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setDocToDelete(doc);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Floating Action Bar */}
      {selectedDocIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  {selectedDocIds.size} {selectedDocIds.size === 1 ? 'selezionato' : 'selezionati'}
                </Badge>
                {validatedSelectedDocs.length < selectedDocIds.size && (
                  <span className="text-xs text-muted-foreground">
                    ({selectedDocIds.size - validatedSelectedDocs.length} non validati)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkAssignDialogOpen(true)}
                  disabled={validatedSelectedDocs.length === 0}
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Assegna
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Elimina
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDocIds(new Set())}
                >
                  <X className="h-4 w-4 mr-2" />
                  Deseleziona
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Details Dialog */}
      <DocumentDetailsDialog
        document={docToView}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
      />

      {/* Assign Dialog */}
      {selectedDoc && (
        <AssignDocumentDialog
          document={selectedDoc}
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          onAssigned={loadDocuments}
        />
      )}

      {/* Bulk Assign Dialog */}
      <BulkAssignDocumentDialog
        documents={validatedSelectedDocs}
        open={bulkAssignDialogOpen}
        onOpenChange={setBulkAssignDialogOpen}
        onAssigned={() => {
          setSelectedDocIds(new Set());
          loadDocuments();
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Eliminazione</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler eliminare il documento "{docToDelete?.file_name}"?
              <br />
              <br />
              Questa azione eliminerà:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Il documento dal pool condiviso</li>
                <li>Tutte le assegnazioni agli agenti ({docToDelete?.agents_count || 0})</li>
                <li>Tutti i chunks e embeddings associati</li>
                <li>Il file PDF dallo storage</li>
              </ul>
              <br />
              <strong>Questa azione non può essere annullata.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => docToDelete && handleDelete(docToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Eliminazione Multipla</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler eliminare <strong>{selectedDocIds.size}</strong> {selectedDocIds.size === 1 ? 'documento' : 'documenti'}?
              <br />
              <br />
              {selectedDocuments.length <= 5 ? (
                <div className="space-y-1">
                  <div className="font-medium">Documenti da eliminare:</div>
                  <ul className="list-disc list-inside text-sm">
                    {selectedDocuments.map((doc) => (
                      <li key={doc.id}>{doc.file_name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="font-medium">Documenti da eliminare:</div>
                  <ul className="list-disc list-inside text-sm">
                    {selectedDocuments.slice(0, 5).map((doc) => (
                      <li key={doc.id}>{doc.file_name}</li>
                    ))}
                    <li>... e altri {selectedDocuments.length - 5}</li>
                  </ul>
                </div>
              )}
              <br />
              <div className="space-y-1">
                <div className="font-medium">Questa azione eliminerà:</div>
                <ul className="list-disc list-inside text-sm">
                  <li>I documenti dal pool condiviso</li>
                  <li>Tutte le assegnazioni agli agenti</li>
                  <li>Tutti i chunks e embeddings associati</li>
                  <li>I file PDF dallo storage</li>
                </ul>
              </div>
              <br />
              <strong>Questa azione non può essere annullata.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina Tutto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
