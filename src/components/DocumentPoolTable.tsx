import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
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
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentPoolHealthIndicators } from "./DocumentPoolHealthIndicators";
import { FolderTreeView } from "./FolderTreeView";
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

// Lazy load heavy dialog components
const AssignDocumentDialog = lazy(() => import("./AssignDocumentDialog").then(m => ({ default: m.AssignDocumentDialog })));
const DocumentDetailsDialog = lazy(() => import("./DocumentDetailsDialog").then(m => ({ default: m.DocumentDetailsDialog })));
const BulkAssignDocumentDialog = lazy(() => import("./BulkAssignDocumentDialog").then(m => ({ default: m.BulkAssignDocumentDialog })));
const CreateFolderDialog = lazy(() => import("./CreateFolderDialog").then(m => ({ default: m.CreateFolderDialog })));
const AssignToFolderDialog = lazy(() => import("./AssignToFolderDialog").then(m => ({ default: m.AssignToFolderDialog })));
const ManageFoldersDialog = lazy(() => import("./ManageFoldersDialog").then(m => ({ default: m.ManageFoldersDialog })));
const RenameFolderDialog = lazy(() => import("./RenameFolderDialog").then(m => ({ default: m.RenameFolderDialog })));
const LlamaParseTestResultDialog = lazy(() => import("./LlamaParseTestResultDialog").then(m => ({ default: m.LlamaParseTestResultDialog })));

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
  pipeline?: 'a' | 'b' | 'c' | 'a-hybrid';
  error_message?: string;
}

interface DocumentPoolTableProps {
  // No props needed - shows all pool documents
}

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T & { cancel: () => void } {
  let timeoutId: NodeJS.Timeout | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
  return debounced as T & { cancel: () => void };
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

  // Test LlamaParse Layout state
  const [testingDocumentId, setTestingDocumentId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [showTestDialog, setShowTestDialog] = useState(false);

  // === REALTIME ERROR LOOP FIX ===
  // Refs for throttling, debouncing, and error state management
  const lastErrorToastRef = useRef<number>(0);
  const isInErrorStateRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPageRef = useRef<number>(1);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep currentPageRef in sync
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Debounced load function (2 second delay)
  const debouncedLoadRef = useRef(
    debounce(() => {
      // Don't process if in error state
      if (isInErrorStateRef.current) {
        console.log('[DocumentPoolTable] Skipping realtime refresh - in error state');
        return;
      }
      
      // Abort previous request if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      loadDocuments(currentPageRef.current, abortControllerRef.current.signal);
      loadFolders();
    }, 2000)
  );

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    
    // Initial load
    loadDocuments(currentPage, abortControllerRef.current.signal);
    loadAvailableAgents();
    loadAvailableFolders();
    loadFolders();

    // Realtime handler that uses debounce
    const handleRealtimeChange = () => {
      debouncedLoadRef.current();
    };

    // Realtime subscriptions for all pipelines - using debounced handler
    const channelKnowledge = supabase
      .channel('knowledge_documents_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'knowledge_documents' },
        handleRealtimeChange
      )
      .subscribe();

    const channelPipelineA = supabase
      .channel('pipeline_a_documents_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_a_documents' },
        handleRealtimeChange
      )
      .subscribe();

    const channelPipelineB = supabase
      .channel('pipeline_b_documents_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_b_documents' },
        handleRealtimeChange
      )
      .subscribe();

    const channelPipelineC = supabase
      .channel('pipeline_c_documents_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_c_documents' },
        handleRealtimeChange
      )
      .subscribe();

    const channelPipelineAHybrid = supabase
      .channel('pipeline_a_hybrid_documents_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_a_hybrid_documents' },
        handleRealtimeChange
      )
      .subscribe();

    return () => {
      // Cancel debounced calls and abort pending requests
      debouncedLoadRef.current.cancel();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      supabase.removeChannel(channelKnowledge);
      supabase.removeChannel(channelPipelineA);
      supabase.removeChannel(channelPipelineB);
      supabase.removeChannel(channelPipelineC);
      supabase.removeChannel(channelPipelineAHybrid);
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
      
      const [pipelineACount, pipelineBCount, pipelineCCount, pipelineAHybridCount] = await Promise.all([
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
          .abortSignal(signal),
        supabase
          .from("pipeline_a_hybrid_documents")
          .select("id", { count: 'exact', head: true })
          .abortSignal(signal)
      ]);

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
      if (pipelineAHybridCount.error) {
        console.error('[DocumentPoolTable] Pipeline A-Hybrid count error:', pipelineAHybridCount.error);
        throw pipelineAHybridCount.error;
      }
      
      const total = (pipelineACount.count || 0) + (pipelineBCount.count || 0) + (pipelineCCount.count || 0) + (pipelineAHybridCount.count || 0);
      console.log('[DocumentPoolTable] Total:', total, '(Pipeline A:', pipelineACount.count, '+ Pipeline B:', pipelineBCount.count, '+ Pipeline C:', pipelineCCount.count, '+ Pipeline A-Hybrid:', pipelineAHybridCount.count, ')');
      setTotalCount(total);
      setTotalPages(Math.ceil(total / pageSize));

      // Step 2: Load documents from BOTH pipelines
      console.log('[DocumentPoolTable] Step 2: Loading from both pipelines...');
      
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const [pipelineAData, pipelineBData, pipelineCData, pipelineAHybridData] = await Promise.all([
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
          .abortSignal(signal),
        supabase
          .from("pipeline_a_hybrid_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to)
          .abortSignal(signal)
      ]);

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
      if (pipelineAHybridData.error) {
        console.error('[DocumentPoolTable] Pipeline A-Hybrid error:', pipelineAHybridData.error);
        throw pipelineAHybridData.error;
      }

      console.log('[DocumentPoolTable] Loaded', pipelineAData.data?.length || 0, 'Pipeline A +', pipelineBData.data?.length || 0, 'Pipeline B +', pipelineCData.data?.length || 0, 'Pipeline C +', pipelineAHybridData.data?.length || 0, 'Pipeline A-Hybrid docs');

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

      // Transform Pipeline A-Hybrid documents
      const transformedPipelineAHybrid = (pipelineAHybridData.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || null,
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: doc.ai_summary || null,
        text_length: doc.text_length || null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        keywords: doc.keywords || [],
        topics: doc.topics || [],
        complexity_level: doc.complexity_level || "",
        agent_ids: [],
        folder: doc.folder || null,
        search_query: null,
        source_url: null,
        pipeline: 'a-hybrid' as const,
        status: doc.status,
        error_message: doc.error_message,
      }));

      // Merge and sort by created_at
      const transformedData = [...transformedPipelineA, ...transformedPipelineB, ...transformedPipelineC, ...transformedPipelineAHybrid]
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
      
      // === ERROR HANDLING WITH THROTTLED TOAST AND EXPONENTIAL BACKOFF ===
      isInErrorStateRef.current = true;
      setError(error.message || "Errore sconosciuto");
      
      // Throttle error toasts - max 1 every 10 seconds
      const now = Date.now();
      if (now - lastErrorToastRef.current > 10000) {
        toast.error("Errore nel caricamento documenti. Riprovo automaticamente...");
        lastErrorToastRef.current = now;
      }
      
      // Exponential backoff retry - max 3 attempts
      if (retryCountRef.current < 3) {
        const delay = Math.pow(2, retryCountRef.current) * 1000; // 1s, 2s, 4s
        console.log(`[DocumentPoolTable] Scheduling retry ${retryCountRef.current + 1}/3 in ${delay}ms`);
        
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        
        retryTimeoutRef.current = setTimeout(() => {
          retryCountRef.current++;
          isInErrorStateRef.current = false; // Allow retry
          
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
          abortControllerRef.current = new AbortController();
          
          loadDocuments(page, abortControllerRef.current.signal);
        }, delay);
      } else {
        console.log('[DocumentPoolTable] Max retries reached, stopping auto-retry');
        // Reset retry count after a longer delay to allow future manual retries
        setTimeout(() => {
          retryCountRef.current = 0;
          isInErrorStateRef.current = false;
        }, 30000); // Reset after 30 seconds
      }
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
            console.error('[DocumentPoolTable] ❌ PDF folders error:', err);
          }
          return [];
        })
      ]);

      console.log('[DocumentPoolTable] 📊 Folders loaded:', {
        githubFolders: githubFolders?.length || 0,
        githubFolderNames: githubFolders?.map(f => f.name) || [],
        pdfFolders: pdfFolders?.length || 0,
        pdfFolderNames: pdfFolders?.map(f => f.name) || [],
      });

      clearTimeout(timeout);

      console.log('[DocumentPoolTable] GitHub folders loaded:', githubFolders?.length || 0);
      console.log('[DocumentPoolTable] PDF folders loaded:', pdfFolders?.length || 0);

      const allFolders = [...(githubFolders || []), ...(pdfFolders || [])];

      // Integra cartelle vuote dalla tabella folders nella struttura gerarchica
      try {
        const { data: allFolderRecords } = await supabase
          .from('folders')
          .select('name');

        // Raccogli tutti i fullName esistenti (inclusi i children)
        const getAllFullNames = (folders: any[]): Set<string> => {
          const names = new Set<string>();
          folders.forEach(f => {
            if (f.fullName) names.add(f.fullName);
            if (f.name) names.add(f.name);
            if (f.children) {
              f.children.forEach((child: any) => {
                if (child.fullName) names.add(child.fullName);
                // Ricorsivamente per children nested
                const childNames = getAllFullNames([child]);
                childNames.forEach(n => names.add(n));
              });
            }
          });
          return names;
        };

        const existingFolderNames = getAllFullNames(allFolders);

        // Per ogni cartella vuota, integrala nella gerarchia
        for (const record of (allFolderRecords || [])) {
          if (record.name && !existingFolderNames.has(record.name)) {
            console.log('[DocumentPoolTable] Integrating empty folder:', record.name);

            const parts = record.name.split('/');

            if (parts.length === 1) {
              // È una root - aggiungi come root
              allFolders.push({
                id: `empty-${record.name}`,
                name: record.name,
                fullName: record.name,
                documentCount: 0,
                totalDocumentCount: 0,
                documents: [],
                children: undefined,
              });
            } else {
              // È gerarchica - trova o crea il parent
              const parentPath = parts.slice(0, -1).join('/');
              const folderName = parts[parts.length - 1];

              // Funzione per trovare e aggiungere al parent
              const addToParent = (folders: any[], parentPath: string, newChild: any): boolean => {
                for (const folder of folders) {
                  const folderFullName = folder.fullName || folder.name;
                  if (folderFullName === parentPath) {
                    if (!folder.children) folder.children = [];
                    folder.children.push(newChild);
                    // Aggiorna totalDocumentCount del parent
                    folder.totalDocumentCount = (folder.totalDocumentCount || 0) + (newChild.totalDocumentCount || 0);
                    return true;
                  }
                  if (folder.children && folder.children.length > 0) {
                    if (addToParent(folder.children, parentPath, newChild)) {
                      return true;
                    }
                  }
                }
                return false;
              };

              const newEmptyFolder = {
                id: `empty-${record.name}`,
                name: folderName,
                fullName: record.name,
                documentCount: 0,
                totalDocumentCount: 0,
                documents: [],
                children: undefined,
                isChild: true,
              };

              // Prova ad aggiungerla al parent
              if (!addToParent(allFolders, parentPath, newEmptyFolder)) {
                // Se il parent non esiste, aggiungi come root con nome completo
                console.log('[DocumentPoolTable] Parent not found, adding as root:', record.name);
                allFolders.push({
                  ...newEmptyFolder,
                  name: record.name, // Usa il path completo come nome
                  isChild: false,
                });
              }
            }
          }
        }
      } catch (emptyFolderError) {
        console.warn('[DocumentPoolTable] Could not load empty folders:', emptyFolderError);
      }

      console.log('[DocumentPoolTable] ✅ Total folders (including empty):', allFolders.length);
      
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
    // Query GitHub docs from Pipeline B (source_type='github')
    const { data: githubDocsB, error: errorB } = await supabase
      .from('pipeline_b_documents')
      .select('id, file_name, folder, status, created_at, page_count, error_message')
      .eq('source_type', 'github')
      .order('created_at', { ascending: false });

    // Query GitHub docs from Pipeline A-Hybrid (source_type='markdown' or 'code')
    const { data: githubDocsAHybrid, error: errorAHybrid } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, file_name, folder, status, created_at, page_count, error_message, ai_summary, keywords, topics, complexity_level')
      .in('source_type', ['markdown', 'code'])
      .not('folder', 'is', null)
      .order('created_at', { ascending: false });

    if (errorB) throw errorB;
    if (errorAHybrid) throw errorAHybrid;

    // Combina documenti da entrambe le pipeline
    const allGitHubDocs = [
      ...(githubDocsB || []),
      ...(githubDocsAHybrid || [])
    ];

    console.log('[loadGitHubFolders] Loaded GitHub docs:', allGitHubDocs.length, 
      '(Pipeline B:', githubDocsB?.length || 0, ', A-Hybrid:', githubDocsAHybrid?.length || 0, ')');

    // Helper per trasformare un documento
    const transformDoc = (doc: any) => {
      return {
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        created_at: doc.created_at,
        folder: doc.folder,
        ai_summary: doc.ai_summary || null,
        text_length: doc.text_length || null,
        page_count: doc.page_count,
        keywords: doc.keywords || [],
        topics: doc.topics || [],
        complexity_level: doc.complexity_level || "",
        status: doc.status,
        agent_names: [], // No agent info in folder view for performance
      };
    };

    // Mappa documenti per folder path
    const docsByFolder = new Map<string, any[]>();
    allGitHubDocs.forEach(doc => {
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
    // Non filtrare le cartelle vuote - mostra sempre tutte le cartelle
    const hierarchicalFolders = Array.from(rootPaths).map(rootPath => {
      return buildFolderTree(rootPath);
    }).filter(folder => folder !== null && folder !== undefined);

    console.log('[loadGitHubFolders] Built hierarchical folders:', hierarchicalFolders.length, hierarchicalFolders);

    return hierarchicalFolders;
  };

  const loadPDFFolders = async () => {
    console.log('[loadPDFFolders] Starting...');

    // Get unique folder names from ALL pipelines with 'folder' column
    const [pipelineAFolders, pipelineBFolders, pipelineCFolders, pipelineAHybridFolders] = await Promise.all([
      supabase.from('pipeline_a_documents').select('folder').not('folder', 'is', null),
      supabase.from('pipeline_b_documents').select('folder').not('folder', 'is', null).neq('source_type', 'github'),
      supabase.from('pipeline_c_documents').select('folder').not('folder', 'is', null),
      supabase.from('pipeline_a_hybrid_documents').select('folder').not('folder', 'is', null).not('source_type', 'eq', 'markdown').not('source_type', 'eq', 'code')
    ]);

    console.log('[loadPDFFolders] Folder queries completed:', {
      pipelineA: pipelineAFolders.data?.length || 0,
      pipelineB: pipelineBFolders.data?.length || 0,
      pipelineC: pipelineCFolders.data?.length || 0,
      pipelineAHybrid: pipelineAHybridFolders.data?.length || 0,
      pipelineAHybridError: pipelineAHybridFolders.error,
    });

    if (pipelineAFolders.error) throw pipelineAFolders.error;
    if (pipelineBFolders.error) throw pipelineBFolders.error;
    if (pipelineCFolders.error) throw pipelineCFolders.error;
    if (pipelineAHybridFolders.error) throw pipelineAHybridFolders.error;

    const uniqueFolderNames = new Set<string>();
    [...(pipelineAFolders.data || []), ...(pipelineBFolders.data || []), ...(pipelineCFolders.data || []), ...(pipelineAHybridFolders.data || [])].forEach(doc => {
      if (doc.folder) uniqueFolderNames.add(doc.folder);
    });

    console.log('[loadPDFFolders] Unique folder names:', Array.from(uniqueFolderNames));

    // Query ALL pipelines for documents with folder
    const [pipelineAWithFolder, pipelineBWithFolder, pipelineCWithFolder, pipelineAHybridWithFolder] = await Promise.all([
      supabase.from('pipeline_a_documents').select('*').not('folder', 'is', null).order('created_at', { ascending: false }),
      supabase.from('pipeline_b_documents').select('*').not('folder', 'is', null).neq('source_type', 'github').order('created_at', { ascending: false }),
      supabase.from('pipeline_c_documents').select('*').not('folder', 'is', null).order('created_at', { ascending: false }),
      supabase.from('pipeline_a_hybrid_documents').select('*').not('folder', 'is', null).not('source_type', 'eq', 'markdown').not('source_type', 'eq', 'code').order('created_at', { ascending: false })
    ]);

    console.log('[loadPDFFolders] Document queries completed:', {
      pipelineA: pipelineAWithFolder.data?.length || 0,
      pipelineB: pipelineBWithFolder.data?.length || 0,
      pipelineC: pipelineCWithFolder.data?.length || 0,
      pipelineAHybrid: pipelineAHybridWithFolder.data?.length || 0,
      pipelineAHybridError: pipelineAHybridWithFolder.error,
      pipelineAHybridSample: pipelineAHybridWithFolder.data?.slice(0, 3).map(d => ({ folder: d.folder, source_type: d.source_type })),
    });

    if (pipelineAWithFolder.error) throw pipelineAWithFolder.error;
    if (pipelineBWithFolder.error) throw pipelineBWithFolder.error;
    if (pipelineCWithFolder.error) throw pipelineCWithFolder.error;
    if (pipelineAHybridWithFolder.error) throw pipelineAHybridWithFolder.error;

    // Transform all pipeline documents
    const allTransformedDocs = [
      ...(pipelineAWithFolder.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || "",
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: doc.folder,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        pipeline: 'a' as const,
      })),
      ...(pipelineBWithFolder.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || "",
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: doc.folder,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        pipeline: 'b' as const,
      })),
      ...(pipelineCWithFolder.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || "",
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: null,
        text_length: null,
        page_count: doc.page_count,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: doc.folder,
        keywords: [],
        topics: [],
        complexity_level: "",
        agent_ids: [],
        pipeline: 'c' as const,
      })),
      ...(pipelineAHybridWithFolder.data || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || "",
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: doc.ai_summary || null,
        text_length: doc.text_length || null,
        page_count: doc.page_count,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: doc.folder,
        keywords: doc.keywords || [],
        topics: doc.topics || [],
        complexity_level: doc.complexity_level || "",
        agent_ids: [],
        pipeline: 'a-hybrid' as const,
        status: doc.status,
      }))
    ];

    // Raggruppa i documenti per cartella
    const docsByFolder = new Map<string, any[]>();
    allTransformedDocs.forEach(doc => {
      if (!docsByFolder.has(doc.folder)) {
        docsByFolder.set(doc.folder, []);
      }
      docsByFolder.get(doc.folder)!.push(doc);
    });

    console.log('[loadPDFFolders] Docs by folder:', docsByFolder.size, 'unique folders');

    // Costruisci albero gerarchico ricorsivo (come loadGitHubFolders)
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
      const children: any[] = [];
      const parentDocs = docsByFolder.get(parentPath) || [];

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

      return {
        id: `virtual-${parentPath}`,
        name: parentPath,
        fullName: parentPath,
        documentCount: parentDocs.length, // Solo documenti DIRETTI
        totalDocumentCount: totalDocs, // Totale RICORSIVO (include sottocartelle)
        documents: parentDocs,
        children: children.length > 0 ? children : undefined,
      };
    };

    // Costruisci la foresta di root folders
    // Non filtrare le cartelle vuote - mostra sempre tutte le cartelle
    const hierarchicalFolders = Array.from(rootPaths).map(rootPath => {
      return buildFolderTree(rootPath);
    }).filter(folder => folder !== null && folder !== undefined);

    // Add "Senza Cartella" for ALL pipelines (no folder OR folder IS NULL)
    const [pipelineADocs, pipelineBDocs, pipelineCDocs, pipelineAHybridDocs] = await Promise.all([
      supabase
        .from('pipeline_a_documents')
        .select('*')
        .is('folder', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('pipeline_b_documents')
        .select('*')
        .is('folder', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('pipeline_c_documents')
        .select('*')
        .is('folder', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('pipeline_a_hybrid_documents')
        .select('*')
        .is('folder', null)
        .order('created_at', { ascending: false })
    ]);

    if (pipelineADocs.error) throw pipelineADocs.error;
    if (pipelineBDocs.error) throw pipelineBDocs.error;
    if (pipelineCDocs.error) throw pipelineCDocs.error;
    if (pipelineAHybridDocs.error) throw pipelineAHybridDocs.error;

    const allNoFolderDocs = [];

    // Transform Pipeline A docs
    if (pipelineADocs.data && pipelineADocs.data.length > 0) {
      const transformedPipelineA = pipelineADocs.data.map((doc: any) => ({
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
        pipeline: 'a' as const,
        error_message: doc.error_message,
      }));
      allNoFolderDocs.push(...transformedPipelineA);
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

    // Transform Pipeline A-Hybrid docs
    if (pipelineAHybridDocs.data && pipelineAHybridDocs.data.length > 0) {
      const transformedPipelineAHybrid = pipelineAHybridDocs.data.map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        validation_status: doc.status === 'ready' ? 'validated' : 'pending',
        validation_reason: doc.error_message || '',
        processing_status: doc.status === 'ready' ? 'ready_for_assignment' : doc.status,
        ai_summary: doc.ai_summary || null,
        text_length: doc.text_length || null,
        page_count: doc.page_count || null,
        created_at: doc.created_at,
        agent_names: [],
        agents_count: 0,
        folder: doc.folder || null,
        keywords: doc.keywords || [],
        topics: doc.topics || [],
        complexity_level: doc.complexity_level || '',
        agent_ids: [],
        pipeline: 'a-hybrid' as const,
        status: doc.status,
        error_message: doc.error_message,
      }));
      allNoFolderDocs.push(...transformedPipelineAHybrid);
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

        // No agent_document_links for Pipeline B (CASCADE handled by FK)

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
      } else if (doc.pipeline === 'a-hybrid') {
        // Pipeline A-Hybrid deletion
        console.log(`[DELETE] Pipeline A-Hybrid document: ${doc.id}`);
        
        // 1. Delete from pipeline_a_hybrid_agent_knowledge
        const { data: chunks } = await supabase
          .from("pipeline_a_hybrid_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);
        
        if (chunks && chunks.length > 0) {
          const { error: agentLinksError } = await supabase
            .from("pipeline_a_hybrid_agent_knowledge")
            .delete()
            .in("chunk_id", chunks.map(c => c.id));

          if (agentLinksError) throw agentLinksError;
        }

        // 2. Delete from pipeline_a_hybrid_chunks_raw
        const { error: chunksError } = await supabase
          .from("pipeline_a_hybrid_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        if (chunksError) throw chunksError;

        // 3. Delete storage file (Pipeline A-Hybrid uses pipeline-a-uploads bucket)
        console.log(`[DELETE] Deleting file from storage: pipeline-a-uploads/${doc.id}/${doc.file_name}`);
        const { error: storageError } = await supabase.storage
          .from('pipeline-a-uploads')
          .remove([`${doc.id}/${doc.file_name}`]);

        if (storageError) {
          console.warn('[DELETE] Storage deletion warning (file may not exist):', storageError);
        }

        // 4. Delete from pipeline_a_hybrid_documents
        const { error: docError } = await supabase
          .from("pipeline_a_hybrid_documents")
          .delete()
          .eq("id", doc.id);

        if (docError) {
          console.error('[DELETE] Error deleting Pipeline A-Hybrid document record:', docError);
          throw docError;
        }

        console.log('[DELETE] ✓ Pipeline A-Hybrid document deleted successfully');
        toast.success("Documento eliminato con successo");
        loadDocuments();
      } else if (doc.pipeline === 'a') {
        // Pipeline A deletion
        console.log(`[DELETE] Pipeline A document: ${doc.id}`);
        
        // 1. Delete from pipeline_a_agent_knowledge
        const { data: chunks } = await supabase
          .from("pipeline_a_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);
        
        if (chunks && chunks.length > 0) {
          const { error: agentLinksError } = await supabase
            .from("pipeline_a_agent_knowledge")
            .delete()
            .in("chunk_id", chunks.map(c => c.id));

          if (agentLinksError) throw agentLinksError;
        }

        // 2. Delete from pipeline_a_chunks_raw
        const { error: chunksError } = await supabase
          .from("pipeline_a_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        if (chunksError) throw chunksError;

        // 3. Delete storage file (Pipeline A uses specific bucket)
        console.log(`[DELETE] Deleting file from storage: pipeline-a-uploads/${doc.id}/${doc.file_name}`);
        const { error: storageError } = await supabase.storage
          .from('pipeline-a-uploads')
          .remove([`${doc.id}/${doc.file_name}`]);

        if (storageError) {
          console.warn('[DELETE] Storage deletion warning (file may not exist):', storageError);
        }

        // 4. Delete from pipeline_a_documents
        const { error: docError } = await supabase
          .from("pipeline_a_documents")
          .delete()
          .eq("id", doc.id);

        if (docError) {
          console.error('[DELETE] Error deleting Pipeline A-Hybrid document record:', docError);
          throw docError;
        }

        console.log('[DELETE] ✓ Pipeline A document deleted successfully');
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
      // Update folder field across all pipelines
      await Promise.all([
        supabase
          .from('pipeline_a_documents')
          .update({ folder: null })
          .in('id', documentIds),
        supabase
          .from('pipeline_b_documents')
          .update({ folder: null })
          .in('id', documentIds),
        supabase
          .from('pipeline_c_documents')
          .update({ folder: null })
          .in('id', documentIds)
      ]);

      toast.success(`${documentIds.length} documento/i rimosso/i dalla cartella`);
      loadDocuments();
      loadAvailableFolders();
      setSelectedDocIds(new Set());
    } catch (error) {
      console.error("Errore rimozione cartella:", error);
      toast.error("Impossibile rimuovere documenti dalla cartella");
    }
  };

  const handleTestLayout = async (documentId: string) => {
    try {
      setTestingDocumentId(documentId);
      toast.loading('Avvio test LlamaParse Layout JSON...', { id: 'test-layout' });

      const { data, error } = await supabase.functions.invoke('test-llamaparse-layout', {
        body: { documentId }
      });

      toast.dismiss('test-layout');

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Test fallito');
      }

      setTestResult(data);
      setShowTestDialog(true);
      toast.success('Test completato con successo');
    } catch (error: any) {
      console.error('[DocumentPoolTable] Test error:', error);
      toast.error(`Errore nel test: ${error.message}`);
      setTestResult({
        success: false,
        error: error.message
      });
      setShowTestDialog(true);
    } finally {
      setTestingDocumentId(null);
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
      
      // Note: Bulk folder deletion removed - legacy tables deleted
      console.warn('[DELETE_FOLDER] Bulk folder deletion not available - legacy tables removed');
      
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

  // Helper: estrai TUTTI i documenti da foldersData (ricorsivo)
  const getAllDocsFromFolders = (folders: any[]): any[] => {
    const allDocs: any[] = [];
    const extractDocs = (folder: any) => {
      if (folder.documents) {
        allDocs.push(...folder.documents);
      }
      if (folder.children) {
        folder.children.forEach(extractDocs);
      }
    };
    folders.forEach(extractDocs);
    return allDocs;
  };

  // Combina documenti da entrambe le fonti: documents array E foldersData
  const allAvailableDocs = [...documents, ...getAllDocsFromFolders(foldersData)];
  // Deduplica per ID
  const uniqueDocsMap = new Map(allAvailableDocs.map(d => [d.id, d]));
  
  const selectedDocuments = Array.from(uniqueDocsMap.values()).filter((d) => selectedDocIds.has(d.id));
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
                          {doc.pipeline === 'a-hybrid' && (
                            <Badge variant="secondary" className="text-xs bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 shrink-0">
                              Pipeline A-Hybrid
                            </Badge>
                          )}
                          {doc.pipeline === 'b' && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 shrink-0">
                              Pipeline B
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
                        ) : doc.pipeline ? (
                          // Pipeline moderne (A, A-Hybrid, B, C): usa processing_status
                          <>
                            {getStatusIcon(doc.processing_status)}
                            <span className="text-sm">
                              {getStatusLabel(doc.processing_status)}
                            </span>
                          </>
                        ) : (!doc.ai_summary || doc.ai_summary.trim() === "") ? (
                          // Solo documenti legacy senza pipeline: fallback a ai_summary
                          <>
                            <AlertCircle className="h-4 w-4 text-orange-500" />
                            <span className="text-sm text-orange-500 font-medium">
                              Non elaborato
                            </span>
                          </>
                        ) : (
                          // Legacy con ai_summary: status normale
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
                      {doc.pipeline === 'a' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestLayout(doc.id)}
                          disabled={testingDocumentId === doc.id}
                          className="text-purple-600 h-8 w-8 p-0"
                          title="Test Layout JSON - Analizza struttura LlamaParse"
                        >
                          {testingDocumentId === doc.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FlaskConical className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
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
                            {doc.pipeline === 'a' && (
                              <Badge variant="secondary" className="text-xs ml-2 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                                Pipeline A
                              </Badge>
                            )}
                            {doc.pipeline === 'a-hybrid' && (
                              <Badge variant="secondary" className="text-xs ml-2 bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                                Pipeline A-Hybrid
                              </Badge>
                            )}
                            {doc.pipeline === 'b' && (
                              <Badge variant="secondary" className="text-xs ml-2 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                                Pipeline B
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
      <Suspense fallback={null}>
        <DocumentDetailsDialog
          document={docToView}
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          onRefresh={() => loadDocuments()}
        />
      </Suspense>

      {/* Assign Dialog */}
      {selectedDoc && (
        <Suspense fallback={null}>
          <AssignDocumentDialog
            document={selectedDoc}
            open={assignDialogOpen}
            onOpenChange={setAssignDialogOpen}
            onAssigned={loadDocuments}
          />
        </Suspense>
      )}

      {/* Bulk Assign Dialog */}
      <Suspense fallback={null}>
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
      </Suspense>

      {/* Folder Management Dialogs */}
      <Suspense fallback={null}>
        <CreateFolderDialog
          open={createFolderDialogOpen}
          onOpenChange={setCreateFolderDialogOpen}
          existingFolders={availableFolders}
          onFolderCreated={() => {
            loadAvailableFolders();
            loadFolders();
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
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
      </Suspense>

      <Suspense fallback={null}>
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
      </Suspense>

      <Suspense fallback={null}>
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
      </Suspense>

      {/* LlamaParse Test Result Dialog */}
      <Suspense fallback={null}>
        <LlamaParseTestResultDialog
          open={showTestDialog}
          onOpenChange={setShowTestDialog}
          result={testResult}
        />
      </Suspense>

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
