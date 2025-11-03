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
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AssignDocumentDialog } from "./AssignDocumentDialog";

interface KnowledgeDocument {
  id: string;
  file_name: string;
  search_query: string;
  validation_status: string;
  validation_reason: string;
  processing_status: string;
  ai_summary: string;
  keywords: string[];
  topics: string[];
  complexity_level: string;
  text_length: number;
  created_at: string;
}

export const DocumentPoolTable = () => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [complexityFilter, setComplexityFilter] = useState<string>("all");
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error: any) {
      console.error("Error loading documents:", error);
      toast.error("Errore nel caricamento dei documenti");
    } finally {
      setLoading(false);
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

  const getComplexityColor = (level: string) => {
    const colors: Record<string, string> = {
      basic: "bg-green-500/10 text-green-500",
      intermediate: "bg-yellow-500/10 text-yellow-500",
      advanced: "bg-red-500/10 text-red-500",
    };
    return colors[level] || "bg-muted text-muted-foreground";
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      searchQuery === "" ||
      doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.search_query?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.ai_summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.keywords?.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "all" || doc.validation_status === statusFilter;

    const matchesComplexity =
      complexityFilter === "all" || doc.complexity_level === complexityFilter;

    return matchesSearch && matchesStatus && matchesComplexity;
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
                  placeholder="Nome file, keywords, summary..."
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
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="validated">Validato</SelectItem>
                  <SelectItem value="validation_failed">Non Valido</SelectItem>
                  <SelectItem value="ready_for_assignment">Pronto</SelectItem>
                  <SelectItem value="processing">In Elaborazione</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Complessità</label>
              <Select
                value={complexityFilter}
                onValueChange={setComplexityFilter}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutte</SelectItem>
                  <SelectItem value="basic">Base</SelectItem>
                  <SelectItem value="intermediate">Intermedio</SelectItem>
                  <SelectItem value="advanced">Avanzato</SelectItem>
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
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nessun documento trovato
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Complessità</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>Creato</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <div className="font-medium truncate" title={doc.file_name}>
                          {doc.file_name}
                        </div>
                        {doc.ai_summary && (
                          <div className="text-xs text-muted-foreground truncate">
                            {doc.ai_summary}
                          </div>
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
                      <div className="max-w-[150px] truncate text-sm text-muted-foreground">
                        {doc.search_query || "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {doc.complexity_level && (
                        <Badge
                          variant="secondary"
                          className={getComplexityColor(doc.complexity_level)}
                        >
                          {doc.complexity_level}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {doc.keywords?.slice(0, 3).map((keyword, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {keyword}
                          </Badge>
                        ))}
                        {doc.keywords?.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{doc.keywords.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.created_at), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedDoc(doc);
                          setAssignDialogOpen(true);
                        }}
                        disabled={doc.validation_status !== "validated"}
                      >
                        <LinkIcon className="h-4 w-4 mr-1" />
                        Assegna
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Assign Dialog */}
      {selectedDoc && (
        <AssignDocumentDialog
          document={selectedDoc}
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          onAssigned={loadDocuments}
        />
      )}
    </div>
  );
};
