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
  Github,
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
  source_url?: string;
  extracted_title?: string;
  extracted_authors?: string[];
  metadata_verified_online?: boolean;
  metadata_verified_source?: string;
  metadata_confidence?: string;
  folder?: string;
  pipeline?: 'a' | 'b' | 'c';
  error_message?: string;
}

interface DocumentPoolTableProps {
  // No props needed - shows all pool documents
}

export const DocumentPoolTable = () => {
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
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(100); // 100 documenti per pagina
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();
    
    loadDocuments(currentPage, abortController.signal);
    loadAvailableAgents();
    loadAvailableFolders();
    loadFolders();

    // TEMPORANEAMENTE DISABILITATA la subscription realtime per fermare il loop
    // Il loop è causato da continui aggiornamenti nel database durante le operazioni di sync
    // TODO: Implementare un debounce o un update incrementale più intelligente
    
    /* 
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
          // Solo reload documenti, non le cartelle (previene loop)
          loadDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    */

    return () => {
      abortController.abort();
      console.log('[DocumentPoolTable] Component unmounted, pending requests aborted');
    };
  }, []);

  // Reset alla pagina 1 quando cambiano i filtri
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, agentFilter]);

  const loadDocuments = async (page: number = currentPage, signal?: AbortSignal) => {
    console.log('[DocumentPoolTable] 📥 Loading documents from BOTH pipelines, page:', page);
    
    try {
      setLoading(true);
      setError(null);
      
      // Step 1: Count from BOTH tables
      console.log('[DocumentPoolTable] Step 1: Counting documents from both pipelines...');
      
      const [oldCount, pipelineACount, pipelineBCount, pipelineCCount] = await Promise.all([
        supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .abortSignal(signal),
        supabase
          .from("pipeline_a_documents")
          .select("id", { count: 'exact', head: true })
          .abortSignal(signal),
        supabase
          .from("pipeline_b_documents")
          .select("id", { count: 'exact', head: true })
          .abortSignal(signal),
        supabase
          .from("pipeline_c_documents")
          .select("id", { count: 'exact', head: true })
          .abortSignal(signal)
      ]);

      if (oldCount.error) {
        console.error('[DocumentPoolTable] Old pipeline count error:', oldCount.error);
        throw oldCount.error;
      }
      if (pipelineACount.error) {
        console.error('[DocumentPoolTable] Pipeline A count error:', pipelineACount.error);
        throw pipelineACount.error;
      }
      if (pipelineBCount.error) {
        console.error('[DocumentPoolTable] Pipeline B count error:', pipelineBCount.error);
        throw pipelineBCount.error;
      }
      if (pipelineCCount.error) {
        console.error('[DocumentPoolTable] Pipeline C count error:', pipelineCCount.error);
        throw pipelineCCount.error;
      }
      
      const total = (oldCount.count || 0) + (pipelineACount.count || 0) + (pipelineBCount.count || 0) + (pipelineCCount.count || 0);
      console.log('[DocumentPoolTable] Total:', total, '(old:', oldCount.count, '+ Pipeline A:', pipelineACount.count, '+ Pipeline B:', pipelineBCount.count, '+ Pipeline C:', pipelineCCount.count, ')');
      setTotalCount(total);
      setTotalPages(Math.ceil(total / pageSize));

      // Step 2: Load documents from BOTH pipelines
      console.log('[DocumentPoolTable] Step 2: Loading from both pipelines...');
      
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const [oldData, pipelineAData, pipelineBData, pipelineCData] = await Promise.all([
        supabase
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
          `)
          .order("created_at", { ascending: false })
          .range(from, to)
          .abortSignal(signal),
        supabase
          .from("pipeline_a_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to)
          .abortSignal(signal),
        supabase
          .from("pipeline_b_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to)
          .abortSignal(signal),
        supabase
          .from("pipeline_c_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to)
          .abortSignal(signal)
      ]);

      if (oldData.error) {
        console.error('[DocumentPoolTable] Old pipeline error:', oldData.error);
        throw oldData.error;
      }
      if (pipelineAData.error) {
        console.error('[DocumentPoolTable] Pipeline A error:', pipelineAData.error);
        throw pipelineAData.error;
      }
      if (pipelineBData.error) {
        console.error('[DocumentPoolTable] Pipeline B error:', pipelineBData.error);
        throw pipelineBData.error;
      }
      if (pipelineCData.error) {
        console.error('[DocumentPoolTable] Pipeline C error:', pipelineCData.error);
        throw pipelineCData.error;
      }

      console.log('[DocumentPoolTable] Loaded', oldData.data?.length || 0, 'old +', pipelineAData.data?.length || 0, 'Pipeline A +', pipelineBData.data?.length || 0, 'Pipeline B +', pipelineCData.data?.length || 0, 'Pipeline C docs');

      // Transform OLD pipeline documents
      const transformedOld = (oldData.data || []).map((doc: any) => {
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
          search_query: doc.search_query,
          source_url: doc.source_url,
          pipeline: 'a' as const,
        };
      });

      // Transform Pipeline A documents
      const transformedPipelineA = (pipelineAData.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || null,
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        folder: null,
        search_query: null,
        source_url: null,
        pipeline: 'a' as const,
        error_message: doc.error_message,
      }));

      // Transform Pipeline B documents
      const transformedPipelineB = (pipelineBData.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || null,
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        folder: null,
        search_query: null,
        source_url: null,
        pipeline: 'b' as const,
        error_message: doc.error_message,
      }));

      // Transform Pipeline C documents
      const transformedPipelineC = (pipelineCData.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || null,
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        folder: null,
        search_query: null,
        source_url: null,
        pipeline: 'c' as const,
        error_message: doc.error_message,
      }));

      // Merge and sort by created_at
      const transformedData = [...transformedOld, ...transformedPipelineA, ...transformedPipelineB, ...transformedPipelineC]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      console.log('[DocumentPoolTable] ✅ Documents loaded successfully');
      setDocuments(transformedData);
      setCurrentPage(page);
    } catch (error: any) {
      // Check for AbortError - both native JavaScript and Supabase variants
      const isAbortError = 
        error.name === 'AbortError' || 
        error.message?.includes('AbortError') ||
        error.code === '20'; // Supabase abort code
      
      if (isAbortError) {
        console.log('[DocumentPoolTable] Query aborted (component unmounted or cleanup)');
        return; // Exit silently without setting error state
      }
      
      console.error('[DocumentPoolTable] ❌ Load error:', error);
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
    console.log('[DocumentPoolTable] 📁 Loading folders...');
    
    try {
      setIsLoadingFolders(true);

      // Load with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const [githubFolders, pdfFolders] = await Promise.all([
        loadGitHubFolders().catch(err => {
          // Check for AbortError - don't log as error if it's just cleanup
          const isAbortError = 
            err.name === 'AbortError' || 
            err.message?.includes('AbortError') ||
            err.code === '20';
          
          if (isAbortError) {
            console.log('[DocumentPoolTable] GitHub folders query aborted (cleanup)');
          } else {
            console.error('[DocumentPoolTable] GitHub folders error:', err);
          }
          return [];
        }),
        loadPDFFolders().catch(err => {
          // Check for AbortError - don't log as error if it's just cleanup
          const isAbortError = 
            err.name === 'AbortError' || 
            err.message?.includes('AbortError') ||
            err.code === '20';
          
          if (isAbortError) {
            console.log('[DocumentPoolTable] PDF folders query aborted (cleanup)');
          } else {
            console.error('[DocumentPoolTable] PDF folders error:', err);
          }
          return [];
        })
      ]);

      clearTimeout(timeout);

      console.log('[DocumentPoolTable] GitHub folders loaded:', githubFolders?.length || 0);
      console.log('[DocumentPoolTable] PDF folders loaded:', pdfFolders?.length || 0);

      const allFolders = [...(githubFolders || []), ...(pdfFolders || [])];
      console.log('[DocumentPoolTable] ✅ Total folders:', allFolders.length);
      
      setFoldersData(allFolders);
    } catch (error: any) {
      // Check for AbortError - both native JavaScript and Supabase variants
      const isAbortError = 
        error.name === 'AbortError' || 
        error.message?.includes('AbortError') ||
        error.code === '20';
      
      if (isAbortError) {
        console.log('[DocumentPoolTable] Folders query aborted (component unmounted or cleanup)');
        return; // Exit silently without setting error state
      }
      
      console.error('[DocumentPoolTable] ❌ Folders load error:', error);
      toast.error('Errore nel caricamento delle cartelle');
      setFoldersData([]);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const loadGitHubFolders = async () => {
    // Load ONLY essential fields, no joins (faster)
    const { data: githubDocs, error } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, folder, validation_status, processing_status, created_at, ai_summary, text_length, page_count')
      .not('source_url', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log('[loadGitHubFolders] Loaded GitHub docs:', githubDocs?.length || 0);

    // Helper per trasformare un documento (simplified, no agent data)
    const transformDoc = (doc: any) => {
      return {
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.validation_status,
        processing_status: doc.processing_status,
        created_at: doc.created_at,
        folder: doc.folder,
        ai_summary: doc.ai_summary,
        text_length: doc.text_length,
        page_count: doc.page_count,
        agent_names: [], // No agent info in folder view for performance
      };
    };

    // Mappa documenti per folder path
    const docsByFolder = new Map<string, any[]>();
    (githubDocs || []).forEach(doc => {
      if (doc.folder) {
        if (!docsByFolder.has(doc.folder)) {
          docsByFolder.set(doc.folder, []);
        }
        docsByFolder.get(doc.folder)!.push(transformDoc(doc));
      }
    });

    console.log('[loadGitHubFolders] Docs by folder:', docsByFolder.size, 'unique folders');

    // Costruisci albero gerarchico ricorsivo
    const allFolderPaths = Array.from(docsByFolder.keys()).sort();
    
    // PRE-PROCESSAMENTO: Aggiungi tutti i path intermedi mancanti
    // Se abbiamo "A/B/C/D", dobbiamo assicurarci che esistano anche "A", "A/B", "A/B/C"
    const allPathsWithIntermediates = new Set<string>(allFolderPaths);
    allFolderPaths.forEach(path => {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const intermediatePath = parts.slice(0, i).join('/');
        if (!allPathsWithIntermediates.has(intermediatePath)) {
          allPathsWithIntermediates.add(intermediatePath);
          // Aggiungi anche alla mappa con array vuoto (nessun documento diretto)
          if (!docsByFolder.has(intermediatePath)) {
            docsByFolder.set(intermediatePath, []);
          }
        }
      }
    });
    
    const completePathList = Array.from(allPathsWithIntermediates).sort();
    
    // Trova tutte le root folders (quelle senza slash o il primo livello)
    const rootPaths = new Set<string>();
    completePathList.forEach(path => {
      const parts = path.split('/');
      rootPaths.add(parts[0]);
    });

    // Funzione ricorsiva per costruire gerarchia
    const buildFolderTree = (parentPath: string, depth: number = 0): any => {
      console.log(`[buildFolderTree] Building tree for: "${parentPath}" at depth ${depth}`);
      
      const children: any[] = [];
      const parentDocs = docsByFolder.get(parentPath) || [];
      
      console.log(`[buildFolderTree] "${parentPath}" has ${parentDocs.length} direct docs`);
      
      // Trova tutte le sottocartelle DIRETTE di parentPath (quelle senza ulteriori slash)
      const childPaths = completePathList.filter(path => {
        if (!path.startsWith(parentPath + '/')) return false;
        
        // Verifica che sia un figlio diretto, non un nipote
        const remainder = path.substring(parentPath.length + 1);
        return !remainder.includes('/');
      });

      // Costruisci ricorsivamente ogni sottocartella
      childPaths.forEach(childPath => {
        const childTree = buildFolderTree(childPath, depth + 1);
        if (childTree) {
          const childName = childPath.substring(parentPath.length + 1);
          children.push({
            ...childTree,
            name: childName,
            isChild: true,
          });
        }
      });

      // Conta tutti i documenti (diretti + in sottocartelle)
      const getAllDocs = (node: any): any[] => {
        let docs = [...(node.documents || [])];
        if (node.children) {
          node.children.forEach((child: any) => {
            docs = [...docs, ...getAllDocs(child)];
          });
        }
        return docs;
      };

      const totalDocs = parentDocs.length + children.reduce((sum, child) => {
        return sum + getAllDocs(child).length;
      }, 0);

      console.log(`[buildFolderTree] "${parentPath}" total: ${totalDocs} (direct: ${parentDocs.length}, children: ${children.length})`);

      return {
        id: `github-${parentPath}`,
        name: parentPath,
        fullName: parentPath,
        documentCount: parentDocs.length, // Solo documenti DIRETTI
        totalDocumentCount: totalDocs, // Totale RICORSIVO (include sottocartelle)
        documents: parentDocs,
        children: children.length > 0 ? children : undefined,
      };
    };

    // Costruisci la foresta di root folders
    const hierarchicalFolders = Array.from(rootPaths).map(rootPath => {
      return buildFolderTree(rootPath);
    }).filter(folder => folder && (folder.totalDocumentCount || folder.documentCount) > 0);

    console.log('[loadGitHubFolders] Built hierarchical folders:', hierarchicalFolders.length, hierarchicalFolders);

    return hierarchicalFolders;
  };

  const loadPDFFolders = async () => {

    // Get unique folder names from documents with 'folder' column
    const { data: docsWithFolders, error: docsError } = await supabase
      .from('knowledge_documents')
      .select('folder')
      .not('folder', 'is', null)
      .is('source_url', null);

    if (docsError) throw docsError;

    const uniqueFolderNames = new Set<string>();
    (docsWithFolders || []).forEach(doc => {
      if (doc.folder) uniqueFolderNames.add(doc.folder);
    });

    

    // Separate parent and child folders
    const parentFolders = new Map();
    const childFoldersByParent = new Map();
    
    Array.from(uniqueFolderNames).forEach(folderName => {
      const pathParts = folderName.split('/');
      if (pathParts.length > 1) {
        const parentPath = pathParts.slice(0, -1).join('/');
        if (!childFoldersByParent.has(parentPath)) {
          childFoldersByParent.set(parentPath, []);
        }
        childFoldersByParent.get(parentPath).push({
          id: `virtual-${folderName}`,
          name: folderName,
          parent_folder: parentPath,
        });
      } else {
        parentFolders.set(folderName, {
          id: `virtual-${folderName}`,
          name: folderName,
          parent_folder: null,
        });
      }
    });

    // OTTIMIZZAZIONE: Singola query per TUTTI i documenti con folder
    const { data: allFolderDocs, error: allDocsError } = await supabase
      .from('knowledge_documents')
      .select(`
        *,
        agent_document_links(
          agent_id,
          agents(id, name)
        )
      `)
      .not('folder', 'is', null)
      .is('source_url', null)
      .order('created_at', { ascending: false });

    if (allDocsError) throw allDocsError;

    // Trasforma tutti i documenti in un unico passaggio
    const allTransformedDocs = (allFolderDocs || []).map((doc: any) => {
      const links = doc.agent_document_links || [];
      const agentNames = links.map((link: any) => link.agents?.name).filter(Boolean);

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

    // Raggruppa i documenti per cartella in memoria (molto più veloce)
    const docsByFolder = new Map<string, any[]>();
    allTransformedDocs.forEach(doc => {
      if (!docsByFolder.has(doc.folder)) {
        docsByFolder.set(doc.folder, []);
      }
      docsByFolder.get(doc.folder)!.push(doc);
    });

    const hierarchicalFolders = [];
    const processedFolderNames = new Set<string>();
    
    for (const [parentName, parentFolder] of parentFolders) {
      const children = childFoldersByParent.get(parentName) || [];
      
      // Ottieni documenti parent dalla mappa
      const parentDocs = docsByFolder.get(parentName) || [];
      
      // Elabora children
      const childrenWithDocs = children.map(child => {
        const childDocs = docsByFolder.get(child.name) || [];
        const childShortName = child.name.replace(`${parentName}/`, '');

        return {
          id: child.id,
          name: childShortName,
          fullName: child.name,
          documentCount: childDocs.length,
          documents: childDocs,
          isChild: true
        };
      });
      
      const allChildDocs = childrenWithDocs.flatMap(child => child.documents);
      const allDocs = [...parentDocs, ...allChildDocs];
      
      if (allDocs.length > 0) {
        hierarchicalFolders.push({
          id: parentFolder.id,
          name: parentName,
          documentCount: parentDocs.length, // Solo documenti DIRETTI
          totalDocumentCount: parentDocs.length + allChildDocs.length, // Totale RICORSIVO
          documents: parentDocs,
          children: childrenWithDocs
        });
        
        processedFolderNames.add(parentName);
      }
    }
    
    // Aggiungi cartelle standalone (senza figli) dalla mappa in memoria
    const standaloneFolders = Array.from(parentFolders.values())
      .filter(folder => !childFoldersByParent.has(folder.name) && !processedFolderNames.has(folder.name))
      .map(folder => {
        const docs = docsByFolder.get(folder.name) || [];
        
        if (docs.length > 0) {
          return {
            id: folder.id,
            name: folder.name,
            documentCount: docs.length,
            documents: docs,
          };
        }
        return null;
      })
      .filter(f => f !== null);
    
    hierarchicalFolders.push(...standaloneFolders);

    // Add "Senza Cartella" for PDFs without folder - BOTH pipelines
    const [legacyNoFolder, pipelineBDocs, pipelineCDocs] = await Promise.all([
      supabase
        .from('knowledge_documents')
        .select(`
          *,
          agent_document_links(
            agent_id,
            agents(id, name)
          )
        `)
        .is('folder', null)
        .is('source_url', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('pipeline_b_documents')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('pipeline_c_documents')
        .select('*')
        .order('created_at', { ascending: false })
    ]);

    if (legacyNoFolder.error) throw legacyNoFolder.error;
    if (pipelineBDocs.error) throw pipelineBDocs.error;
    if (pipelineCDocs.error) throw pipelineCDocs.error;

    const allNoFolderDocs = [];

    // Transform legacy docs
    if (legacyNoFolder.data && legacyNoFolder.data.length > 0) {
      const transformedLegacy = legacyNoFolder.data.map((doc: any) => {
        const links = doc.agent_document_links || [];
        const agentNames = links.map((link: any) => link.agents?.name).filter(Boolean);

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
          folder: null,
          keywords: doc.keywords || [],
          topics: doc.topics || [],
          complexity_level: doc.complexity_level || "",
          agent_ids: links.map((link: any) => link.agents?.id).filter(Boolean),
          pipeline: 'a' as const,
        };
      });
      allNoFolderDocs.push(...transformedLegacy);
    }

    // Transform Pipeline B docs
    if (pipelineBDocs.data && pipelineBDocs.data.length > 0) {
      const transformedPipelineB = pipelineBDocs.data.map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || '',
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: null,
        keywords: [],
        topics: [],
        complexity_level: '',
        agent_ids: [],
        pipeline: 'b' as const,
        error_message: doc.error_message,
      }));
      allNoFolderDocs.push(...transformedPipelineB);
    }

    // Transform Pipeline C docs
    if (pipelineCDocs.data && pipelineCDocs.data.length > 0) {
      const transformedPipelineC = pipelineCDocs.data.map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || '',
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: null,
        keywords: [],
        topics: [],
        complexity_level: '',
        agent_ids: [],
        pipeline: 'c' as const,
        error_message: doc.error_message,
      }));
      allNoFolderDocs.push(...transformedPipelineC);
    }

    // Sort by created_at desc
    allNoFolderDocs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (allNoFolderDocs.length > 0) {
      hierarchicalFolders.push({
        id: 'no-folder',
        name: 'Senza Cartella',
        documentCount: allNoFolderDocs.length,
        documents: allNoFolderDocs,
      });
    }

    return hierarchicalFolders;
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
      console.log('[DELETE] Starting deletion for document:', {
        id: doc.id,
        file_name: doc.file_name,
        pipeline: doc.pipeline,
        processing_status: doc.processing_status
      });

      if (!doc.pipeline) {
        console.error('[DELETE] ERROR: doc.pipeline is undefined!', doc);
        toast.error("Errore: pipeline non definita per questo documento");
        return;
      }

      if (doc.pipeline === 'c') {
        // Pipeline C deletion
        console.log(`[DELETE] Pipeline C document: ${doc.id}`);
        
        // 1. Get chunk IDs first
        const { data: chunks } = await supabase
          .from("pipeline_c_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);

        // 2. Delete from pipeline_c_agent_knowledge (agent sync links)
        if (chunks && chunks.length > 0) {
          const chunkIds = chunks.map(c => c.id);
          const { error: agentKnowledgeError } = await supabase
            .from("pipeline_c_agent_knowledge")
            .delete()
            .in("chunk_id", chunkIds);

          if (agentKnowledgeError) console.warn("Pipeline C agent knowledge deletion warning:", agentKnowledgeError);
        }

        // 3. Delete from pipeline_c_chunks_raw
        const { error: chunksError } = await supabase
          .from("pipeline_c_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        if (chunksError) throw chunksError;

        // 4. Delete storage file
        const { data: docData, error: docDataError } = await supabase
          .from("pipeline_c_documents")
          .select("file_path, storage_bucket")
          .eq("id", doc.id)
          .single();

        if (docDataError) {
          console.warn('[DELETE] Could not fetch storage info (document may already be deleted):', docDataError);
        } else if (docData && docData.file_path && docData.storage_bucket) {
          console.log(`[DELETE] Deleting file from storage: ${docData.storage_bucket}/${docData.file_path}`);
          const { error: storageError } = await supabase.storage
            .from(docData.storage_bucket)
            .remove([docData.file_path]);

          if (storageError) {
            console.warn('[DELETE] Storage deletion warning (file may not exist):', storageError);
          } else {
            console.log('[DELETE] ✓ Storage file deleted successfully');
          }
        } else {
          console.warn('[DELETE] No storage info found for document');
        }

        // 5. Delete from pipeline_c_documents
        const { error: docError } = await supabase
          .from("pipeline_c_documents")
          .delete()
          .eq("id", doc.id);

        if (docError) {
          console.error('[DELETE] Error deleting Pipeline C document record:', docError);
          throw docError;
        }

        console.log('[DELETE] ✓ Pipeline C document deleted successfully');
        toast.success("Documento Pipeline C eliminato");
        loadDocuments();
        
      } else if (doc.pipeline === 'b') {
        // Pipeline B deletion
        console.log(`[DELETE] Pipeline B document: ${doc.id}`);
        
        // 1. Get chunk IDs first
        const { data: chunks } = await supabase
          .from("pipeline_b_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);

        // 2. Delete from pipeline_b_agent_knowledge (agent sync links)
        if (chunks && chunks.length > 0) {
          const chunkIds = chunks.map(c => c.id);
          const { error: agentKnowledgeError } = await supabase
            .from("pipeline_b_agent_knowledge")
            .delete()
            .in("chunk_id", chunkIds);

          if (agentKnowledgeError) console.warn("Pipeline B agent knowledge deletion warning:", agentKnowledgeError);
        }

        // 3. Delete from pipeline_b_chunks_raw
        const { error: chunksError } = await supabase
          .from("pipeline_b_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        if (chunksError) throw chunksError;

        // 4. Delete from agent_document_links
        const { error: linksError } = await supabase
          .from("agent_document_links")
          .delete()
          .eq("document_id", doc.id);

        if (linksError) throw linksError;

        // 5. Delete storage file (shared-pool-uploads bucket)
        const filePath = `${doc.id}/${doc.file_name}`;
        console.log(`[DELETE] Deleting file from storage: shared-pool-uploads/${filePath}`);
        const { error: storageError } = await supabase.storage
          .from("shared-pool-uploads")
          .remove([filePath]);

        if (storageError) {
          console.warn('[DELETE] Storage deletion warning (file may not exist):', storageError);
        } else {
          console.log('[DELETE] ✓ Storage file deleted successfully');
        }

        // 6. Delete from pipeline_b_documents
        const { error: docError } = await supabase
          .from("pipeline_b_documents")
          .delete()
          .eq("id", doc.id);

        if (docError) {
          console.error('[DELETE] Error deleting Pipeline B document record:', docError);
          throw docError;
        }

        console.log('[DELETE] ✓ Pipeline B document deleted successfully');
        toast.success("Documento eliminato con successo");
        loadDocuments();
      } else {
        // Legacy pipeline deletion
        console.log(`[DELETE] Legacy pipeline document: ${doc.id}`);
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
        console.log(`[DELETE] Deleting file from storage: knowledge-pdfs/${filePath}`);
        const { error: storageError } = await supabase.storage
          .from("knowledge-pdfs")
          .remove([filePath]);

        if (storageError) {
          console.warn('[DELETE] Storage deletion warning (file may not exist):', storageError);
        } else {
          console.log('[DELETE] ✓ Storage file deleted successfully');
        }

        const { error: docError } = await supabase
          .from("knowledge_documents")
          .delete()
          .eq("id", doc.id);

        if (docError) {
          console.error('[DELETE] Error deleting legacy document record:', docError);
          throw docError;
        }

        console.log('[DELETE] ✓ Legacy document deleted successfully');
        toast.success("Documento eliminato con successo");
        loadDocuments();
      }

    } catch (error: any) {
      console.error('[DELETE] ❌ Deletion failed:', error);
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
    const docIds = selectedDocs.map(d => d.id);
    
    if (docIds.length === 0) return;
    
    try {
      toast.loading(`Eliminazione di ${docIds.length} documenti...`, { id: 'bulk-delete' });
      
      // Call server-side edge function for reliable bulk deletion
      const { data, error } = await supabase.functions.invoke('delete-all-pool-documents', {
        body: { documentIds: docIds }
      });
      
      if (error) throw error;
      
      if (data?.success) {
        toast.success(
          `${data.deletedDocuments} documenti eliminati (${data.deletedFiles} file)`, 
          { id: 'bulk-delete' }
        );
        
        setSelectedDocIds(new Set());
        setBulkDeleteDialogOpen(false);
        loadDocuments();
        loadFolders();
      } else {
        throw new Error(data?.error || 'Errore sconosciuto');
      }
      
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast.error(`Errore eliminazione: ${error.message}`, { id: 'bulk-delete' });
    }
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
    // Questa funzione è usata per selezioni MANUALI con checkbox
    // NON deve impostare selectedFolderForAssignment - quello è riservato a "Assegna tutta la cartella"
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
    
    // selectedFolderForAssignment è gestito SOLO da handleFolderAssignByName
    // Non tracciamo la cartella per selezioni manuali
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
                Documenti ({totalCount})
              </span>
              <DocumentPoolHealthIndicators />
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
                          {/* Badge GitHub/PDF */}
                          {doc.search_query?.startsWith('GitHub:') || doc.source_url?.includes('github.com') ? (
                            <Badge variant="outline" className="gap-1 shrink-0">
                              <Github className="h-3 w-3" />
                              GitHub
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 shrink-0">
                              <FileText className="h-3 w-3" />
                              PDF
                            </Badge>
                          )}
                          <div className="font-medium truncate text-sm" title={doc.file_name}>
                            {doc.file_name}
                          </div>
                          {doc.pipeline === 'a' && (
                            <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 shrink-0">
                              Pipeline A
                            </Badge>
                          )}
                          {doc.pipeline === 'b' && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 shrink-0">
                              Pipeline B
                            </Badge>
                          )}
                          {doc.pipeline === 'c' && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 shrink-0">
                              Pipeline C
                            </Badge>
                          )}
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
                        ) : (doc.pipeline === 'b' || doc.pipeline === 'c') ? (
                          // Pipeline B/C: mostra status basato su processing_status
                          <>
                            {getStatusIcon(doc.processing_status)}
                            <span className="text-sm">
                              {getStatusLabel(doc.processing_status)}
                            </span>
                          </>
                        ) : (!doc.ai_summary || doc.ai_summary.trim() === "") ? (
                          // Legacy: Non elaborato se manca ai_summary
                          <>
                            <AlertCircle className="h-4 w-4 text-orange-500" />
                            <span className="text-sm text-orange-500 font-medium">
                              Non elaborato
                            </span>
                          </>
                        ) : (
                          // Legacy: status normale
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
                            {doc.pipeline === 'b' && (
                              <Badge variant="secondary" className="text-xs ml-2 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                                Pipeline B
                              </Badge>
                            )}
                            {doc.pipeline === 'c' && (
                              <Badge variant="secondary" className="text-xs ml-2 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                Pipeline C
                              </Badge>
                            )}
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
