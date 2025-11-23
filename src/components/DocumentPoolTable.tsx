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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Search,
  Filter,
  Link as LinkIcon,
  AlertCircle,
  Trash2,
  Info,
  RefreshCw,
  X,
  Folder,
  Plus,
  Settings,
  Check,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { AssignDocumentDialog } from "./AssignDocumentDialog";
import { DocumentDetailsDialog } from "./DocumentDetailsDialog";
import { BulkAssignDocumentDialog } from "./BulkAssignDocumentDialog";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { AssignToFolderDialog } from "./AssignToFolderDialog";
import { ManageFoldersDialog } from "./ManageFoldersDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { FolderTreeView } from "./FolderTreeView";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentPoolHealthIndicators } from "./DocumentPoolHealthIndicators";
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
  page_count?: number;
  created_at: string;
  agent_names: string[];
  agents_count: number;
  keywords?: string[];
  topics?: string[];
  complexity_level?: string;
  agent_ids?: string[];
  search_query?: string;
  extracted_title?: string;
  extracted_authors?: string[];
  metadata_verified_online?: boolean;
  metadata_verified_source?: string;
  metadata_confidence?: string;
  folder?: string;
}

interface DocumentPoolTableProps {
  sourceType?: 'pdf' | 'github';
}

export const DocumentPoolTable = ({ sourceType }: DocumentPoolTableProps = {}) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<KnowledgeDocument | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [docToView, setDocToView] = useState<KnowledgeDocument | null>(null);
  const [agentsListDialogOpen, setAgentsListDialogOpen] = useState(false);
  const [agentsListDoc, setAgentsListDoc] = useState<KnowledgeDocument | null>(null);
  
  // Bulk actions state
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [bulkAssignFolderName, setBulkAssignFolderName] = useState<string | undefined>(undefined);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [selectedFolderForAssignment, setSelectedFolderForAssignment] = useState<string | undefined>(undefined);
  
  // Folder management state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [assignToFolderDialogOpen, setAssignToFolderDialogOpen] = useState(false);
  const [manageFoldersDialogOpen, setManageFoldersDialogOpen] = useState(false);
  const [renameFolderDialogOpen, setRenameFolderDialogOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<{ id: string; name: string } | null>(null);
  const [docsToAssignToFolder, setDocsToAssignToFolder] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });
  
  // View mode state
  const [viewMode, setViewMode] = useState<'table' | 'folders'>('folders');
  const [foldersData, setFoldersData] = useState<Array<{
    id: string;
    name: string;
    documentCount: number;
    documents: KnowledgeDocument[];
  }>>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(100); // 100 documenti per pagina
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    loadDocuments();
    loadAvailableAgents();
    loadAvailableFolders();
    loadFolders();

    // Setup realtime subscription for knowledge_documents
    const channel = supabase
      .channel('knowledge-documents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'knowledge_documents'
        },
        (payload) => {
          console.log('[DocumentPoolTable] Realtime update:', payload);
          // Reload documents on any change
          loadDocuments();
          loadFolders();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'folders'
        },
        (payload) => {
          console.log('[DocumentPoolTable] Folders update:', payload);
          loadFolders();
          loadAvailableFolders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    console.log('[DocumentPoolTable] Component mounted');
    console.log('[DocumentPoolTable] Documents loaded:', documents.length);
  }, [documents]);

  // Reset alla pagina 1 quando cambiano i filtri
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, agentFilter]);

  const loadDocuments = async (page: number = currentPage) => {
    try {
      setLoading(true);
      setError(null);
      
      // Step 1: Build base count query
      let countQuery = supabase
        .from("knowledge_documents")
        .select("id", { count: 'exact', head: true });

      // Step 2: Build data query
      let dataQuery = supabase
        .from("knowledge_documents")
        .select(`
          *,
          extracted_title,
          extracted_authors,
          metadata_verified_online,
          metadata_verified_source,
          metadata_confidence,
          agent_document_links(
            agent_id,
            agents(id, name)
          )
        `);

      // Step 3: Apply SAME filters to both queries
      if (sourceType === 'github') {
        // GitHub docs have source_url pointing to github.com and folder starts with repo names
        countQuery = countQuery.not('source_url', 'is', null);
        dataQuery = dataQuery.not('source_url', 'is', null);
      } else if (sourceType === 'pdf') {
        // PDF docs don't have source_url (uploaded files)
        countQuery = countQuery.is('source_url', null);
        dataQuery = dataQuery.is('source_url', null);
      }

      // Step 4: Get TOTAL count from database
      const { count, error: countError } = await countQuery;
      if (countError) throw countError;
      
      const total = count || 0;
      setTotalCount(total);
      setTotalPages(Math.ceil(total / pageSize));

      // Step 5: Calculate range for current page
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      // Step 6: Get ONLY current page data
      const { data, error } = await dataQuery
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      // Step 7: Transform data
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
          page_count: doc.page_count,
          created_at: doc.created_at,
          agent_names: agentNames,
          agents_count: agentNames.length,
          keywords: doc.keywords || [],
          topics: doc.topics || [],
          complexity_level: doc.complexity_level || "",
          agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
          folder: doc.folder,
        };
      });

      setDocuments(transformedData);
      setCurrentPage(page);
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
      // Query per ottenere TUTTI gli agenti attivi del sistema
      const { data, error } = await supabase
        .from("agents")
        .select("id, name")
        .eq("active", true)
        .order("name");

      if (error) throw error;

      setAvailableAgents(data || []);
    } catch (error: any) {
      console.error('[DocumentPoolTable] Error loading agents:', error);
    }
  };

  const loadAvailableFolders = async () => {
    try {
      const { data, error } = await supabase
        .from("folders")
        .select("name")
        .order("name");

      if (error) throw error;

      const folders = (data || []).map((f: any) => f.name);
      setAvailableFolders(folders);
    } catch (error: any) {
      console.error('[DocumentPoolTable] Error loading folders:', error);
    }
  };

  const loadFolders = async () => {
    try {
      console.log('[DocumentPoolTable] loadFolders called with sourceType:', sourceType);
      
      // Get unique folder names from documents based on sourceType
      let folderQuery = supabase
        .from('knowledge_documents')
        .select('folder')
        .not('folder', 'is', null);

      // Filter by sourceType based on actual GitHub markers
      if (sourceType === 'github') {
        folderQuery = folderQuery.or('source_url.like.%github.com%,search_query.like.GitHub:%');
      } else if (sourceType === 'pdf') {
        folderQuery = folderQuery
          .or('source_url.is.null,and(source_url.not.like.%github.com%,search_query.is.null),and(source_url.not.like.%github.com%,search_query.not.like.GitHub:%)')
      }

      const { data: docsWithFolders, error: docsError } = await folderQuery;
      if (docsError) throw docsError;

      // Extract unique folder names
      const uniqueFolderNames = new Set<string>();
      (docsWithFolders || []).forEach(doc => {
        if (doc.folder) uniqueFolderNames.add(doc.folder);
      });

      console.log('[DocumentPoolTable] Unique folders from documents:', Array.from(uniqueFolderNames));

      // Load github import progress data ONLY for GitHub sourceType
      const folderTotalsMap = new Map();
      if (sourceType === 'github') {
        const { data: progressData } = await supabase
          .from('github_import_progress')
          .select('folder, total_files, repo')
          .order('started_at', { ascending: false });

        if (progressData) {
          progressData.forEach(progress => {
            if (!folderTotalsMap.has(progress.folder)) {
              folderTotalsMap.set(progress.folder, progress.total_files);
            }
          });
        }
      }

      // Separate parent and child folders based on what exists in documents
      const parentFolders = new Map();
      const childFoldersByParent = new Map();
      
      Array.from(uniqueFolderNames).forEach(folderName => {
        // Check if this is a child folder (has a parent path)
        const pathParts = folderName.split('/');
        if (pathParts.length > 1) {
          // It's a child folder - find its parent
          const parentPath = pathParts.slice(0, -1).join('/');
          if (!childFoldersByParent.has(parentPath)) {
            childFoldersByParent.set(parentPath, []);
          }
          childFoldersByParent.get(parentPath).push({
            id: `virtual-${folderName}`,
            name: folderName,
            parent_folder: parentPath,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            description: null,
            icon: null,
            color: null
          });
        } else {
          // It's a parent folder
          parentFolders.set(folderName, {
            id: `virtual-${folderName}`,
            name: folderName,
            parent_folder: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            description: null,
            icon: null,
            color: null
          });
        }
      });

      // Build hierarchical structure
      const hierarchicalFolders = [];
      const processedFolderNames = new Set<string>();
      
      // Process parent folders with their children
      for (const [parentName, parentFolder] of parentFolders) {
        const children = childFoldersByParent.get(parentName) || [];
        
        // Load documents for parent folder directly (not in subfolders) with sourceType filter
        let parentDocsQuery = supabase
          .from('knowledge_documents')
          .select(`
            *,
            agent_document_links(
              agent_id,
              agents(id, name)
            )
          `)
          .eq('folder', parentName);

        // Apply sourceType filter
        if (sourceType === 'github') {
          parentDocsQuery = parentDocsQuery.not('source_url', 'is', null);
        } else if (sourceType === 'pdf') {
          parentDocsQuery = parentDocsQuery.is('source_url', null);
        }

        const { data: parentDocs, error: parentDocsError } = await parentDocsQuery
          .order('created_at', { ascending: false });

        if (parentDocsError) throw parentDocsError;

        const transformedParentDocs = (parentDocs || []).map((doc: any) => {
          const links = doc.agent_document_links || [];
          const agentNames = links
            .map((link: any) => link.agents?.name)
            .filter(Boolean);

          return {
            id: doc.id,
            file_name: doc.file_name,
            validation_status: doc.validation_status,
            validation_reason: doc.validation_reason || "",
            processing_status: doc.processing_status,
            ai_summary: doc.ai_summary,
            text_length: doc.text_length,
            page_count: doc.page_count,
            created_at: doc.created_at,
            agent_names: agentNames,
            agents_count: agentNames.length,
            folder: doc.folder,
            keywords: doc.keywords || [],
            topics: doc.topics || [],
            complexity_level: doc.complexity_level || "",
            agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
          };
        });
        
        // Load documents for children
        const childrenWithDocs = await Promise.all(
          children.map(async (child) => {
            let childDocsQuery = supabase
              .from('knowledge_documents')
              .select(`
                *,
                agent_document_links(
                  agent_id,
                  agents(id, name)
                )
              `)
              .or(`folder.eq.${child.name},folder.like.${child.name}/%`);

            // Apply sourceType filter
            if (sourceType === 'github') {
              childDocsQuery = childDocsQuery.not('source_url', 'is', null);
            } else if (sourceType === 'pdf') {
              childDocsQuery = childDocsQuery.is('source_url', null);
            }

            const { data: docs, error: docsError } = await childDocsQuery
              .order('created_at', { ascending: false });

            if (docsError) throw docsError;

            const transformedDocs = (docs || []).map((doc: any) => {
              const links = doc.agent_document_links || [];
              const agentNames = links
                .map((link: any) => link.agents?.name)
                .filter(Boolean);

              return {
                id: doc.id,
                file_name: doc.file_name,
                validation_status: doc.validation_status,
                validation_reason: doc.validation_reason || "",
                processing_status: doc.processing_status,
                ai_summary: doc.ai_summary,
                text_length: doc.text_length,
                page_count: doc.page_count,
                created_at: doc.created_at,
                agent_names: agentNames,
                agents_count: agentNames.length,
                folder: doc.folder,
                keywords: doc.keywords || [],
                topics: doc.topics || [],
                complexity_level: doc.complexity_level || "",
                agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
              };
            });

            // Get total files for this child folder using full path
            const childShortName = child.name.replace(`${parentName}/`, '');
            const totalFiles = folderTotalsMap.get(child.name);

            return {
              id: child.id,
              name: childShortName, // Remove parent prefix for display
              fullName: child.name, // Keep full name for reference
              documentCount: transformedDocs.length, // Includes all documents recursively from subfolders
              totalFiles: totalFiles,
              documents: transformedDocs,
              isChild: true
            };
          })
        );
        
        // Aggregate all documents: parent docs + all children docs
        const allChildDocs = childrenWithDocs.flatMap(child => child.documents);
        const allDocs = [...transformedParentDocs, ...allChildDocs];
        
        // ONLY add folder if it has documents of the current sourceType
        if (allDocs.length > 0) {
          // Calculate total files for parent: check parent's own totalFiles first, then sum children
          const parentOwnTotal = folderTotalsMap.get(parentName) || 0;
          const childrenTotal = childrenWithDocs.reduce((sum, child) => {
            return sum + (child.totalFiles || 0);
          }, 0);
          const parentTotalFiles = parentOwnTotal + childrenTotal;
          
          hierarchicalFolders.push({
            id: parentFolder.id,
            name: parentName,
            documentCount: transformedParentDocs.length + allChildDocs.length,
            totalFiles: parentTotalFiles > 0 ? parentTotalFiles : undefined,
            documents: transformedParentDocs,
            children: childrenWithDocs
          });
          
          // Mark this folder as processed
          processedFolderNames.add(parentName);
        }
      }
      
      // Add standalone folders (no parent, no children, and NOT already processed)
      const standaloneFolders = await Promise.all(
        Array.from(parentFolders.values())
          .filter(folder => !childFoldersByParent.has(folder.name) && !processedFolderNames.has(folder.name))
          .map(async (folder) => {
            let standaloneDocsQuery = supabase
              .from('knowledge_documents')
              .select(`
                *,
                agent_document_links(
                  agent_id,
                  agents(id, name)
                )
              `)
              .eq('folder', folder.name);

            // Apply sourceType filter
            if (sourceType === 'github') {
              standaloneDocsQuery = standaloneDocsQuery.not('source_url', 'is', null);
            } else if (sourceType === 'pdf') {
              standaloneDocsQuery = standaloneDocsQuery.is('source_url', null);
            }

            const { data: docs, error: docsError } = await standaloneDocsQuery
              .order('created_at', { ascending: false });

            if (docsError) throw docsError;

            const transformedDocs = (docs || []).map((doc: any) => {
              const links = doc.agent_document_links || [];
              const agentNames = links
                .map((link: any) => link.agents?.name)
                .filter(Boolean);

              return {
                id: doc.id,
                file_name: doc.file_name,
                validation_status: doc.validation_status,
                validation_reason: doc.validation_reason || "",
                processing_status: doc.processing_status,
                ai_summary: doc.ai_summary,
                text_length: doc.text_length,
                page_count: doc.page_count,
                created_at: doc.created_at,
                agent_names: agentNames,
                agents_count: agentNames.length,
                folder: doc.folder,
                keywords: doc.keywords || [],
                topics: doc.topics || [],
                complexity_level: doc.complexity_level || "",
                agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
              };
            });

            // Get total files for standalone folder
            const totalFiles = folderTotalsMap.get(folder.name);
            
            // ONLY return folder if it has documents of the current sourceType
            if (transformedDocs.length > 0) {
              return {
                id: folder.id,
                name: folder.name,
                documentCount: transformedDocs.length,
                totalFiles: totalFiles,
                documents: transformedDocs,
              };
            }
            return null;
          })
      );
      
      // Filter out null values (folders with no documents)
      hierarchicalFolders.push(...standaloneFolders.filter(f => f !== null));

      // Add "Senza Cartella" folder for documents without a folder
      let noFolderQuery = supabase
        .from('knowledge_documents')
        .select(`
          *,
          agent_document_links(
            agent_id,
            agents(id, name)
          )
        `)
        .is('folder', null);

      // Apply sourceType filter for no-folder documents
      if (sourceType === 'github') {
        noFolderQuery = noFolderQuery.not('source_url', 'is', null);
      } else if (sourceType === 'pdf') {
        noFolderQuery = noFolderQuery.is('source_url', null);
      }

      const { data: noFolderDocs, error: noFolderError } = await noFolderQuery
        .order('created_at', { ascending: false });

      if (noFolderError) throw noFolderError;

      if (noFolderDocs && noFolderDocs.length > 0) {
        const transformedNoFolderDocs = noFolderDocs.map((doc: any) => {
          const links = doc.agent_document_links || [];
          const agentNames = links
            .map((link: any) => link.agents?.name)
            .filter(Boolean);

          return {
            id: doc.id,
            file_name: doc.file_name,
            validation_status: doc.validation_status,
            validation_reason: doc.validation_reason || "",
            processing_status: doc.processing_status,
            ai_summary: doc.ai_summary,
            text_length: doc.text_length,
            page_count: doc.page_count,
            created_at: doc.created_at,
            agent_names: agentNames,
            agents_count: agentNames.length,
            folder: doc.folder,
            keywords: doc.keywords || [],
            topics: doc.topics || [],
            complexity_level: doc.complexity_level || "",
            agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
          };
        });

        hierarchicalFolders.push({
          id: 'no-folder',
          name: 'Senza Cartella',
          documentCount: transformedNoFolderDocs.length,
          documents: transformedNoFolderDocs,
        });
      }

      // Filter out empty folders based on sourceType after applying document filters
      const nonEmptyFolders = hierarchicalFolders.filter(folder => {
        // Count total documents including children
        const totalDocs = folder.documents.length + 
          (folder.children?.reduce((sum, child) => sum + child.documents.length, 0) || 0);
        return totalDocs > 0;
      });

      setFoldersData(nonEmptyFolders);
    } catch (error: any) {
      console.error('[DocumentPoolTable] Error loading folders data:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "validated":
      case "ready_for_assignment":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "validation_failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "validating":
      case "processing":
      case "pending_processing":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "pending":
      case "downloaded":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
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
      pending: "In Attesa",
      pending_processing: "In Coda",
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

  const handleRetryValidation = async (doc: KnowledgeDocument) => {
    try {
      toast.info(`Validazione di ${doc.file_name} in corso...`);
      
      const { error } = await supabase.functions.invoke('validate-document', {
        body: {
          documentId: doc.id,
          searchQuery: doc.search_query || '',
          fullText: ''
        }
      });

      if (error) {
        toast.error(`Errore nella validazione: ${error.message}`);
      } else {
        toast.success('Validazione avviata con successo');
        // Reload after 2 seconds to see the result
        setTimeout(() => loadDocuments(), 2000);
      }
    } catch (error: any) {
      toast.error(`Errore: ${error.message}`);
    }
  };


  const handleRemoveFromFolder = async (documentIds: string[]) => {
    try {
      const { error } = await supabase
        .from('knowledge_documents')
        .update({ folder: null })
        .in('id', documentIds);

      if (error) throw error;

      toast.success(`${documentIds.length} documento/i rimosso/i dalla cartella`);
      loadDocuments();
      loadAvailableFolders();
      setSelectedDocIds(new Set());
    } catch (error) {
      console.error("Errore rimozione cartella:", error);
      toast.error("Impossibile rimuovere documenti dalla cartella");
    }
  };

  const handleBulkDocumentSelect = (docIds: string[], shouldSelect: boolean, folderName?: string) => {
    setSelectedDocIds((prevSelected) => {
      const newSelected = new Set(prevSelected);
      
      if (shouldSelect) {
        // Aggiungi tutti i documenti
        docIds.forEach(id => newSelected.add(id));
      } else {
        // Rimuovi tutti i documenti
        docIds.forEach(id => newSelected.delete(id));
      }
      
      return newSelected;
    });
    
    // Gestisci il tracking della cartella separatamente
    if (shouldSelect && folderName) {
      setSelectedFolderForAssignment(folderName);
    } else if (!shouldSelect && folderName && selectedFolderForAssignment === folderName) {
      setSelectedFolderForAssignment(undefined);
    }
  };

  const getFolderInfo = () => {
    const folderCounts = new Map<string, number>();
    documents.forEach(doc => {
      if (doc.folder) {
        folderCounts.set(doc.folder, (folderCounts.get(doc.folder) || 0) + 1);
      }
    });
    return Array.from(folderCounts.entries()).map(([name, count]) => ({ name, count }));
  };


  // Handler for folder bulk assignment by folder name
  const handleFolderAssignByName = async (folderName: string) => {
    try {
      console.log('📋 [DocumentPoolTable] handleFolderAssignByName:', folderName);
      
      // Don't fetch IDs - just pass folder name to dialog
      setBulkAssignFolderName(folderName);
      setSelectedDocIds(new Set()); // Clear manual selections
      setBulkAssignDialogOpen(true);
    } catch (error) {
      console.error("Error opening folder assignment:", error);
      toast.error("Errore nell'apertura del dialogo");
    }
  };

  const handleFolderDelete = async (folderId: string, folderName: string) => {
    // Conferma eliminazione
    const confirmed = confirm(
      `Sei sicuro di voler eliminare la cartella "${folderName}" con tutti i suoi documenti?\n\n` +
      `Questa azione è irreversibile.`
    );
    
    if (!confirmed) return;
    
    try {
      toast.loading('Eliminazione cartella in corso...', { id: 'folder-delete' });
      
      // Trova tutti i documenti nella cartella
      const folderData = foldersData.find(f => f.id === folderId);
      if (!folderData) {
        toast.error('Cartella non trovata', { id: 'folder-delete' });
        return;
      }
      
      const docIds = folderData.documents.map(d => d.id);
      
      // Elimina prima i link agenti-documenti
      if (docIds.length > 0) {
        const { error: linksError } = await supabase
          .from('agent_document_links')
          .delete()
          .in('document_id', docIds);
        
        if (linksError) throw linksError;
        
        // Elimina i chunks
        const { error: chunksError } = await supabase
          .from('agent_knowledge')
          .delete()
          .in('pool_document_id', docIds);
        
        if (chunksError) throw chunksError;
        
        // Elimina i documenti
        const { error: docsError } = await supabase
          .from('knowledge_documents')
          .delete()
          .in('id', docIds);
        
        if (docsError) throw docsError;
      }
      
      // Elimina la cartella
      const { error: folderError } = await supabase
        .from('folders')
        .delete()
        .eq('id', folderId);
      
      if (folderError) throw folderError;
      
      toast.success(`Cartella "${folderName}" e ${docIds.length} documenti eliminati`, { id: 'folder-delete' });
      
      // Reload
      loadDocuments();
      loadFolders();
      loadAvailableFolders();
    } catch (error: any) {
      console.error('Error deleting folder:', error);
      toast.error(`Errore nell'eliminazione: ${error.message}`, { id: 'folder-delete' });
    }
  };

  const selectedDocuments = documents.filter((d) => selectedDocIds.has(d.id));
  const validatedSelectedDocs = selectedDocuments.filter((d) => d.processing_status === "ready_for_assignment");
  
  // Se c'è una cartella selezionata, considera quella invece del conteggio documenti
  const hasValidSelection = selectedFolderForAssignment ? true : validatedSelectedDocs.length > 0;

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      searchQuery === "" ||
      doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.ai_summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.agent_names?.some((name) => name.toLowerCase().includes(searchQuery.toLowerCase()));

    // Aggiorna matchesStatus per supportare i nuovi filtri
    let matchesStatus = true;
    if (statusFilter !== "all") {
      switch (statusFilter) {
        case "blocked":
          // Documenti bloccati in processing > 10 min
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          matchesStatus = doc.processing_status === 'processing' && 
                         new Date(doc.created_at) < tenMinutesAgo;
          break;
        case "no_chunks":
          // Documenti senza chunks (handled in query, always false in filter)
          matchesStatus = false; // This would require additional query
          break;
        case "in_queue":
          // Documenti in coda (handled in query, always false in filter)
          matchesStatus = false; // This would require additional query
          break;
        case "not_processed":
          // Documenti non processati (processing_status != ready_for_assignment e validati)
          matchesStatus = doc.processing_status !== 'ready_for_assignment' && 
                         doc.validation_status === 'validated';
          break;
        case "ready":
          matchesStatus = doc.processing_status === 'ready_for_assignment';
          break;
        case "failed":
          matchesStatus = doc.processing_status === 'processing_failed';
          break;
        default:
          matchesStatus = doc.validation_status === statusFilter || 
                         doc.processing_status === statusFilter;
      }
    }

    const matchesAgent =
      agentFilter === "all" ||
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
              <label className="text-sm font-medium">Cerca per nome</label>
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
                  <SelectItem value="blocked">Bloccati</SelectItem>
                  <SelectItem value="no_chunks">Senza Chunks</SelectItem>
                  <SelectItem value="in_queue">In Queue</SelectItem>
                  <SelectItem value="not_processed">Non Processati</SelectItem>
                  <SelectItem value="ready">Pronti</SelectItem>
                  <SelectItem value="failed">Falliti</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cerca per agente</label>
              <Popover open={agentPopoverOpen} onOpenChange={setAgentPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={agentPopoverOpen}
                    className="w-full justify-between"
                  >
                    {agentFilter === "all"
                      ? "Tutti"
                      : availableAgents.find((agent) => agent.id === agentFilter)?.name || "Seleziona agente..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0 bg-background" align="start">
                  <Command>
                    <CommandInput placeholder="Cerca agente..." />
                    <CommandList>
                      <CommandEmpty>Nessun agente trovato.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all"
                          onSelect={() => {
                            setAgentFilter("all");
                            setAgentPopoverOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              agentFilter === "all" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          Tutti
                        </CommandItem>
                        {availableAgents.map((agent) => (
                          <CommandItem
                            key={agent.id}
                            value={agent.name}
                            onSelect={() => {
                              setAgentFilter(agent.id);
                              setAgentPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                agentFilter === agent.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {agent.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-3">
            <span className="flex items-center gap-3">
              <FileText className="h-5 w-5" />
              <span className="font-semibold">
                Documenti ({filteredDocuments.length})
                {filteredDocuments.length < documents.length && (
                  <span className="text-muted-foreground text-sm font-normal ml-2">
                    di {documents.length} totali
                  </span>
                )}
              </span>
              <DocumentPoolHealthIndicators sourceType={sourceType} />
            </span>
            <div className="flex items-center gap-2">
              {/* Toggle Vista: Cartelle/Tabella - Sempre Visibile */}
              <div className="inline-flex border rounded-md overflow-hidden">
                <Button
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                  className="rounded-none h-8"
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Tabella
                </Button>
                <Button
                  variant={viewMode === 'folders' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('folders')}
                  className="rounded-none h-8"
                >
                  <Folder className="h-4 w-4 mr-1.5" />
                  Cartelle
                </Button>
              </div>

              <div className="h-6 w-px bg-border" />

              {/* Crea Cartella - Pulsante + */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => setCreateFolderDialogOpen(true)}
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Crea nuova cartella</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Gestisci Cartelle - Icona Gear */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => setManageFoldersDialogOpen(true)}
                      variant="outline"
                      size="sm"
                      disabled={availableFolders.length === 0}
                      className="h-8 w-8 p-0"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {availableFolders.length === 0 
                      ? 'Nessuna cartella da gestire' 
                      : 'Gestisci cartelle'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
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
              <Button onClick={() => loadDocuments()} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Riprova
              </Button>
            </div>
          ) : viewMode === 'folders' ? (
            <FolderTreeView
              folders={foldersData}
              onDocumentSelect={(docId) => {
                const newSelected = new Set(selectedDocIds);
                if (newSelected.has(docId)) {
                  newSelected.delete(docId);
                } else {
                  newSelected.add(docId);
                }
                setSelectedDocIds(newSelected);
              }}
              onBulkDocumentSelect={handleBulkDocumentSelect}
              selectedDocuments={selectedDocIds}
              onDocumentClick={(doc) => {
                // Find full document data
                const fullDoc = documents.find(d => d.id === doc.id);
                if (fullDoc) {
                  setDocToView(fullDoc);
                  setDetailsDialogOpen(true);
                }
              }}
              onFolderAssign={handleFolderAssignByName}
              onFolderDelete={handleFolderDelete}
              onFolderRename={(folderId, currentName) => {
                setFolderToRename({ id: folderId, name: currentName });
                setRenameFolderDialogOpen(true);
              }}
              onFolderMove={(folderName) => {
                // Get selected documents from this folder
                const folderDocs = documents.filter(
                  d => d.folder === folderName && selectedDocIds.has(d.id)
                );
                if (folderDocs.length > 0) {
                  setDocsToAssignToFolder({
                    ids: folderDocs.map(d => d.id),
                    names: folderDocs.map(d => d.file_name)
                  });
                  setAssignToFolderDialogOpen(true);
                }
              }}
            />
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
                  <TableHead className="w-[22%]">File</TableHead>
                  <TableHead className="w-[10%]">Status</TableHead>
                  <TableHead className="w-[10%]">Cartella</TableHead>
                  <TableHead className="w-[8%]">Pagine</TableHead>
                  <TableHead className="w-[16%]">Agenti Assegnati</TableHead>
                  <TableHead className="w-[10%]">Creato</TableHead>
                  <TableHead className="w-[12%] text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  // Client-side pagination
                  const from = (currentPage - 1) * pageSize;
                  const to = currentPage * pageSize;
                  const paginatedDocs = filteredDocuments.slice(from, to);
                  
                  return paginatedDocs.map((doc) => (
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
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate text-sm" title={doc.file_name}>
                            {doc.file_name}
                          </div>
                          {doc.extracted_title && (
                            doc.metadata_verified_online ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700 shrink-0">
                                      ✓ Verificato
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">Metadata verificati online</p>
                                    {doc.metadata_verified_source && (
                                      <p className="text-xs text-muted-foreground mt-1">{doc.metadata_verified_source}</p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="text-xs text-gray-500 shrink-0">
                                      ? Non verificato
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">Metadata non verificati online</p>
                                    {doc.metadata_confidence && (
                                      <p className="text-xs text-muted-foreground mt-1">Confidence: {doc.metadata_confidence}</p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )
                          )}
                        </div>
                        {doc.ai_summary && doc.ai_summary.trim() !== "" && (
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
                        {doc.validation_status === 'validation_failed' ? (
                          <>
                            <XCircle className="h-4 w-4 text-red-500" />
                            <Badge variant="destructive" className="text-xs">
                              Non Disponibile
                            </Badge>
                          </>
                        ) : (!doc.ai_summary || doc.ai_summary.trim() === "") ? (
                          <>
                            <AlertCircle className="h-4 w-4 text-orange-500" />
                            <span className="text-sm text-orange-500 font-medium">
                              Non elaborato
                            </span>
                          </>
                        ) : (
                          <>
                            {getStatusIcon(doc.processing_status)}
                            <span className="text-sm">
                              {getStatusLabel(doc.processing_status)}
                            </span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {doc.folder ? (
                        <Badge variant="outline" className="text-xs">
                          {doc.folder}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {doc.page_count ? (
                        <span className="font-medium">{doc.page_count}</span>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {doc.agents_count === 0 ? (
                          <Badge variant="secondary" className="text-xs whitespace-nowrap">
                            Non assegnato
                          </Badge>
                        ) : doc.agent_names.length === 1 ? (
                          <Badge variant="outline" className="text-xs truncate max-w-[120px]" title={doc.agent_names[0]}>
                            {doc.agent_names[0]}
                          </Badge>
                        ) : doc.agent_names.length === 2 ? (
                          <>
                            {doc.agent_names.map((name, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs truncate max-w-[120px]" title={name}>
                                {name}
                              </Badge>
                            ))}
                          </>
                        ) : (
                          <>
                            {doc.agent_names.slice(0, 2).map((name, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs truncate max-w-[120px]" title={name}>
                                {name}
                              </Badge>
                            ))}
                            <Badge 
                              variant="outline" 
                              className="text-xs whitespace-nowrap cursor-pointer hover:bg-muted" 
                              onClick={() => {
                                setAgentsListDoc(doc);
                                setAgentsListDialogOpen(true);
                              }}
                              title="Clicca per vedere tutti gli agenti"
                            >
                              e altri {doc.agents_count - 2}
                            </Badge>
                          </>
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
                      {doc.validation_status === "validating" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetryValidation(doc)}
                          className="text-yellow-600 h-8 w-8 p-0"
                          title="Riprova validazione"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedDoc(doc);
                            setAssignDialogOpen(true);
                          }}
                          disabled={doc.validation_status !== "validated" || doc.processing_status !== "ready_for_assignment"}
                          className="h-8 w-8 p-0"
                          title={
                            doc.validation_status !== "validated" 
                              ? "Documento non validato - non disponibile per assegnazione" 
                              : doc.processing_status !== "ready_for_assignment"
                              ? "Documento non pronto per assegnazione"
                              : "Assegna agenti"
                          }
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
                ));
                })()}
              </TableBody>
            </Table>
            </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-4">
                {(() => {
                  // Client-side pagination
                  const from = (currentPage - 1) * pageSize;
                  const to = currentPage * pageSize;
                  const paginatedDocs = filteredDocuments.slice(from, to);
                  
                  return paginatedDocs.map((doc) => (
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
                          disabled={doc.validation_status !== "validated" || doc.processing_status !== "ready_for_assignment"}
                          className="flex-1"
                        >
                          <LinkIcon className="h-4 w-4 mr-1" />
                          {doc.validation_status !== "validated" ? "Non Disponibile" : "Assegna"}
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
                ));
                })()}
              </div>
            </>
          )}

          {/* Pagination Controls - Client Side */}
          {viewMode === 'table' && (() => {
            const totalFiltered = filteredDocuments.length;
            const totalPagesCalc = Math.ceil(totalFiltered / pageSize);
            
            if (totalPagesCalc <= 1) return null;
            
            const from = (currentPage - 1) * pageSize;
            const to = Math.min(currentPage * pageSize, totalFiltered);
            
            return (
              <div className="flex items-center justify-between px-2 py-4 border-t mt-4">
                <div className="text-sm text-muted-foreground">
                  Mostra {from + 1}-{to} di {totalFiltered} documenti
                </div>
                
                <div className="flex items-center gap-2">
                  {/* Previous Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Precedente
                  </Button>
                  
                  {/* Page Numbers */}
                  <div className="flex items-center gap-1">
                    {/* First page */}
                    {currentPage > 2 && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(1)}
                        >
                          1
                        </Button>
                        {currentPage > 3 && <span className="px-2">...</span>}
                      </>
                    )}
                    
                    {/* Current - 1 */}
                    {currentPage > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => p - 1)}
                      >
                        {currentPage - 1}
                      </Button>
                    )}
                    
                    {/* Current page */}
                    <Button variant="default" size="sm" disabled>
                      {currentPage}
                    </Button>
                    
                    {/* Current + 1 */}
                    {currentPage < totalPagesCalc && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => p + 1)}
                      >
                        {currentPage + 1}
                      </Button>
                    )}
                    
                    {/* Last page */}
                    {currentPage < totalPagesCalc - 1 && (
                      <>
                        {currentPage < totalPagesCalc - 2 && <span className="px-2">...</span>}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(totalPagesCalc)}
                        >
                          {totalPagesCalc}
                        </Button>
                      </>
                    )}
                  </div>
                  
                  {/* Next Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPagesCalc, p + 1))}
                    disabled={currentPage === totalPagesCalc}
                  >
                    Successivo
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })()}
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
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    const selectedDocs = documents.filter(d => selectedDocIds.has(d.id));
                    setDocsToAssignToFolder({
                      ids: Array.from(selectedDocIds),
                      names: selectedDocs.map(d => d.file_name)
                    });
                    setAssignToFolderDialogOpen(true);
                  }}
                >
                  <Folder className="h-4 w-4 mr-2" />
                  Cartella
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemoveFromFolder(Array.from(selectedDocIds))}
                >
                  Rimuovi Cartella
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectedFolderForAssignment) {
                      // Se c'è una cartella selezionata, passa il nome della cartella
                      setBulkAssignFolderName(selectedFolderForAssignment);
                    }
                    setBulkAssignDialogOpen(true);
                  }}
                  disabled={!hasValidSelection}
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Assegna Agenti
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
                  onClick={() => {
                    setSelectedDocIds(new Set());
                    setSelectedFolderForAssignment(undefined);
                  }}
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
        onRefresh={() => loadDocuments()}
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
        documentIds={bulkAssignFolderName ? undefined : Array.from(selectedDocIds)}
        folderName={bulkAssignFolderName}
        open={bulkAssignDialogOpen}
        onOpenChange={(open) => {
          setBulkAssignDialogOpen(open);
          if (!open) {
            setBulkAssignFolderName(undefined); // Reset on close
          }
        }}
        onAssigned={() => {
          setSelectedDocIds(new Set());
          setBulkAssignFolderName(undefined);
          setSelectedFolderForAssignment(undefined);
          loadDocuments();
        }}
      />

      {/* Folder Management Dialogs */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        existingFolders={availableFolders}
        onFolderCreated={() => {
          loadAvailableFolders();
          loadFolders();
        }}
      />

      <AssignToFolderDialog
        open={assignToFolderDialogOpen}
        onOpenChange={setAssignToFolderDialogOpen}
        documentIds={docsToAssignToFolder.ids}
        documentNames={docsToAssignToFolder.names}
        availableFolders={availableFolders}
        onAssigned={() => {
          loadDocuments();
          loadAvailableFolders();
          loadFolders();
          setSelectedDocIds(new Set());
          setDocsToAssignToFolder({ ids: [], names: [] });
        }}
      />

      <ManageFoldersDialog
        open={manageFoldersDialogOpen}
        onOpenChange={setManageFoldersDialogOpen}
        folders={getFolderInfo()}
        onFoldersChanged={() => {
          loadDocuments();
          loadAvailableFolders();
          loadFolders();
        }}
      />

      <RenameFolderDialog
        open={renameFolderDialogOpen}
        onOpenChange={setRenameFolderDialogOpen}
        folderId={folderToRename?.id || ""}
        currentName={folderToRename?.name || ""}
        existingFolders={availableFolders}
        onRenamed={() => {
          loadDocuments();
          loadAvailableFolders();
          loadFolders();
          setFolderToRename(null);
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

      {/* Agents List Dialog */}
      <AlertDialog open={agentsListDialogOpen} onOpenChange={setAgentsListDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agenti Assegnati</AlertDialogTitle>
            <AlertDialogDescription>
              {agentsListDoc?.file_name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {agentsListDoc?.agent_names.map((name, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <span className="text-sm font-medium">{name}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogAction>Chiudi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
