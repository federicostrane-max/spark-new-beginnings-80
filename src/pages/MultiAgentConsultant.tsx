import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTTS } from "@/contexts/TTSContext";
import { useMultipleAgentsHealth } from "@/hooks/useMultipleAgentsHealth";
import { toast } from "sonner";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { AgentsSidebar } from "@/components/AgentsSidebar";
import { GlobalAlerts } from "@/components/GlobalAlerts";
import ExportSelectedMessagesPDF from "@/components/ExportSelectedMessagesPDF";
import { CreateAgentModal } from "@/components/CreateAgentModal";
import { ForwardMessageDialog } from "@/components/ForwardMessageDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Menu, Forward, X, Edit, ChevronsDown, ChevronsUp, Trash2, Database, AlertCircle, Monitor } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
// Browser automation imports
import { toolServerClient, sessionManager, Orchestrator, Plan, TOOL_SERVER_URL_CHANGED_EVENT } from "@/lib/tool-server";
import { ToolServerSettings } from "@/components/ToolServerSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
}

interface VideoDocumentInfo {
  document_id: string;
  file_name: string;
  file_path: string;
  storage_bucket: string;
  processing_metadata?: {
    director_prompt_preview?: string;
    model_used?: string;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  llm_provider?: string;
}

interface Conversation {
  id: string;
  agent_id: string;
  title: string;
}

export default function MultiAgentConsultant() {
  const { session } = useAuth();
  const { preGenerateAudio } = useTTS();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // 🔄 Restore session from sessionStorage on mount
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(() => {
    const saved = sessionStorage.getItem('currentAgent');
    return saved ? JSON.parse(saved) : null;
  });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(() => {
    const saved = sessionStorage.getItem('currentConversation');
    return saved ? JSON.parse(saved) : null;
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false); // ✅ Guard anti-double-submit
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [allMessagesExpanded, setAllMessagesExpanded] = useState<boolean>(true); // Messaggi partono espansi per default
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [unsyncedDocsCount, setUnsyncedDocsCount] = useState(0);
  const [agentUpdateTrigger, setAgentUpdateTrigger] = useState(0);
  const [activeLongResponse, setActiveLongResponse] = useState<string | null>(null);
  const [videoDocumentsForAgent, setVideoDocumentsForAgent] = useState<VideoDocumentInfo[]>([]);
  const [backgroundProgress, setBackgroundProgress] = useState<{
    totalChars: number;
    chunks: number;
    status: string;
  } | null>(null);
  // Browser automation local execution state
  const [localExecutionStatus, setLocalExecutionStatus] = useState<{
    active: boolean;
    tool: string;
    status: string;
    stepInfo?: string;
  } | null>(null);
  // Tool Server connection status (ora include 'not_configured')
  const [toolServerStatus, setToolServerStatus] = useState<'connected' | 'disconnected' | 'not_configured' | 'checking'>('checking');
  const [showToolServerDialog, setShowToolServerDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const currentConversationRef = useRef<string | null>(null);
  
  // ✅ Refs per throttling degli update UI durante streaming
  const accumulatedTextRef = useRef<string>("");
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Monitora la salute di tutti gli agenti per mostrare gli alert globali
  const agentHealth = useMultipleAgentsHealth(agents.map(a => a.id));

  // 💾 Save current session to sessionStorage
  useEffect(() => {
    if (currentAgent) {
      sessionStorage.setItem('currentAgent', JSON.stringify(currentAgent));
    }
  }, [currentAgent]);

  useEffect(() => {
    if (currentConversation) {
      sessionStorage.setItem('currentConversation', JSON.stringify(currentConversation));
    }
  }, [currentConversation]);

  // 🔄 Restore conversation on reload if we have saved state
  useEffect(() => {
    const savedAgent = sessionStorage.getItem('currentAgent');
    const savedConversation = sessionStorage.getItem('currentConversation');
    
    if (savedAgent && savedConversation && !currentAgent && session?.user?.id) {
      const agent = JSON.parse(savedAgent);
      const conversation = JSON.parse(savedConversation);
      
      // Verify agent still exists
      supabase
        .from('agents')
        .select('*')
        .eq('id', agent.id)
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            setCurrentAgent(data);
            loadConversation(conversation.id);
          } else {
            // Clear invalid session
            sessionStorage.removeItem('currentAgent');
            sessionStorage.removeItem('currentConversation');
          }
        });
    }
  }, [session?.user?.id]);

  // 🔄 Load messages when conversation changes (e.g., after page reload or agent selection)
  useEffect(() => {
    if (currentConversation?.id && messages.length === 0 && !loadingMessages) {
      console.log('📬 Auto-loading messages for conversation:', currentConversation.id);
      loadConversation(currentConversation.id);
    }
  }, [currentConversation?.id]);

  // 🎬 Load video documents assigned to current agent
  useEffect(() => {
    if (!currentAgent?.id) {
      setVideoDocumentsForAgent([]);
      return;
    }

    const loadVideoDocuments = async () => {
      const { data, error } = await supabase
        .from('pipeline_a_agent_knowledge')
        .select(`
          chunk_id,
          pipeline_a_chunks_raw!inner(
            document_id,
            pipeline_a_documents!inner(
              id,
              file_name,
              file_path,
              storage_bucket,
              source_type,
              processing_metadata
            )
          )
        `)
        .eq('agent_id', currentAgent.id)
        .eq('is_active', true);

      if (error) {
        console.error('[VIDEO DOCS] Error loading video documents:', error);
        return;
      }

      // Extract unique video documents
      const videoDocsMap = new Map<string, VideoDocumentInfo>();
      data?.forEach((item: any) => {
        const doc = item.pipeline_a_chunks_raw?.pipeline_a_documents;
        if (doc?.source_type === 'video' && !videoDocsMap.has(doc.id)) {
          videoDocsMap.set(doc.id, {
            document_id: doc.id,
            file_name: doc.file_name,
            file_path: doc.file_path,
            storage_bucket: doc.storage_bucket,
            processing_metadata: doc.processing_metadata
          });
        }
      });

      setVideoDocumentsForAgent(Array.from(videoDocsMap.values()));
      console.log('[VIDEO DOCS] Loaded video documents for agent:', videoDocsMap.size);
    };

    loadVideoDocuments();
  }, [currentAgent?.id]);

  // Intelligent auto-scroll - solo quando l'utente è vicino al fondo
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Aggiorna lo stato solo in base alla posizione corrente dello scroll
    setIsUserAtBottom(distanceFromBottom < 50);
    
    // Cancella eventuali timeout precedenti
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
  };

  useEffect(() => {
    // Auto-scroll solo se l'utente è vicino al fondo E non sta attivamente scrollando
    if (isUserAtBottom && !streamingConversationId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserAtBottom, streamingConversationId]);

  // Pre-generate audio for assistant messages when streaming stops
  useEffect(() => {
    if (!streamingConversationId && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && lastMessage.content.trim()) {
        // Pre-generate audio in background
        preGenerateAudio(lastMessage.id, lastMessage.content);
      }
    }
  }, [streamingConversationId, messages, preGenerateAudio]);

  // Tool Server connection check (ogni 30s + event-driven)
  useEffect(() => {
    const checkToolServer = async () => {
      // Prima verifica: URL è configurato?
      if (!toolServerClient.isConfigured()) {
        setToolServerStatus('not_configured');
        return; // NON fare fetch a localhost se non configurato
      }
      
      // URL configurato → testa la connessione
      setToolServerStatus('checking');
      const result = await toolServerClient.testConnection();
      setToolServerStatus(result.connected ? 'connected' : 'disconnected');
    };
    
    // Check iniziale
    checkToolServer();
    
    // Polling ogni 30s come fallback
    const interval = setInterval(checkToolServer, 30000);
    
    // Event listener per aggiornamento immediato dopo Save
    const handleUrlChanged = () => {
      console.log('[TOOL SERVER] URL changed, checking connection...');
      checkToolServer();
    };
    window.addEventListener(TOOL_SERVER_URL_CHANGED_EVENT, handleUrlChanged);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener(TOOL_SERVER_URL_CHANGED_EVENT, handleUrlChanged);
    };
  }, []);

  // Realtime subscription for long responses AND message updates
  useEffect(() => {
    if (!currentConversation?.id) return;
    
    console.log('[REALTIME] Setting up subscriptions for conversation:', currentConversation.id);
    
    const channel = supabase
      .channel(`conversation-updates-${currentConversation.id}`)
      // Subscribe to agent_long_responses for background progress
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_long_responses',
          filter: `conversation_id=eq.${currentConversation.id}`
        },
        (payload) => {
          console.log('📡 [REALTIME] Long response update:', payload.eventType, payload.new);
          
          if (payload.eventType === 'INSERT') {
            setActiveLongResponse(payload.new.id);
            setBackgroundProgress({
              totalChars: payload.new.total_characters,
              chunks: payload.new.current_chunk_index,
              status: payload.new.status
            });
          } else if (payload.eventType === 'UPDATE') {
            const data = payload.new;
            setBackgroundProgress({
              totalChars: data.total_characters,
              chunks: data.current_chunk_index,
              status: data.status
            });
            
            // Update message in real-time
            if (data.status === 'generating' || data.status === 'completed') {
              const fullText = data.response_chunks
                .map((c: any) => c.chunk)
                .join('');
              
              setMessages(prev => prev.map(msg => 
                msg.id === data.message_id
                  ? { ...msg, content: fullText }
                  : msg
              ));
            }
            
            // Cleanup when completed
            if (data.status === 'completed' || data.status === 'failed') {
              setActiveLongResponse(null);
              setBackgroundProgress(null);
            }
          }
        }
      )
      // Subscribe to agent_messages for all message updates
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_messages',
          filter: `conversation_id=eq.${currentConversation.id}`
        },
        (payload) => {
          console.log('📡 [REALTIME] Message change:', payload.eventType, payload.new);
          const msg = payload.new as Message;
          
          if (payload.eventType === 'INSERT') {
            // 🔧 Check for consultation complete marker
            if (msg.role === 'system' && msg.content?.startsWith('__CONSULTATION_COMPLETE__')) {
              console.log('🔄 [REALTIME] Consultation completed, reloading messages...');
              loadConversation(currentConversation.id);
              return; // Don't add this system message to the UI
            }

            // 📄 Check for PDF system notifications
            if (msg.role === 'system' && msg.content?.startsWith('__PDF_')) {
              console.log('📬 [REALTIME] PDF notification received:', msg.content.slice(0, 30));
              
              try {
                // Handle all PDF notification types
                if (msg.content.startsWith('__PDF_DOWNLOADED__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_DOWNLOADED__', ''));
                  toast.info(`📥 PDF scaricato: ${data.title}`, {
                    description: "Validazione in corso...",
                    duration: 4000,
                  });
                } else if (msg.content.startsWith('__PDF_VALIDATED__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_VALIDATED__', ''));
                  toast.success(`✅ PDF validato: ${data.title}`, {
                    description: "Elaborazione in corso...",
                    duration: 4000,
                  });
                } else if (msg.content.startsWith('__PDF_READY__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_READY__', ''));
                  const shortSummary = data.summary?.slice(0, 100) + (data.summary?.length > 100 ? '...' : '');
                  toast.success(`🎉 PDF pronto: ${data.title}`, {
                    description: shortSummary || "Il documento è ora disponibile nel pool",
                    duration: 6000,
                  });
                } else if (msg.content.startsWith('__PDF_DOWNLOAD_FAILED__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_DOWNLOAD_FAILED__', ''));
                  toast.error(`❌ Download fallito: ${data.title}`, {
                    description: data.reason,
                    duration: 8000,
                  });
                } else if (msg.content.startsWith('__PDF_VALIDATION_FAILED__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_VALIDATION_FAILED__', ''));
                  toast.error(`❌ Validazione fallita: ${data.title}`, {
                    description: data.reason,
                    duration: 8000,
                  });
                } else if (msg.content.startsWith('__PDF_VALIDATION_ERROR__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_VALIDATION_ERROR__', ''));
                  toast.error(`⚠️ Errore di validazione: ${data.title}`, {
                    description: data.reason,
                    duration: 8000,
                  });
                } else if (msg.content.startsWith('__PDF_PROCESSING_FAILED__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_PROCESSING_FAILED__', ''));
                  toast.error(`❌ Elaborazione fallita: ${data.title}`, {
                    description: data.reason,
                    duration: 8000,
                  });
                } else if (msg.content.startsWith('__PDF_PROCESSING_SUMMARY__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_PROCESSING_SUMMARY__', ''));
                  if (data.status === 'all_failed') {
                    toast.error(`❌ Tutti i PDF sono falliti`, {
                      description: `${data.failed} su ${data.total} download non riusciti`,
                      duration: 10000,
                    });
                  } else {
                    toast.warning(`⚠️ Download completato con errori`, {
                      description: `✅ ${data.processed} riusciti, ❌ ${data.failed} falliti su ${data.total} totali`,
                      duration: 10000,
                    });
                  }
                } else if (msg.content.startsWith('__PDF_PROCESSING_COMPLETE__')) {
                  const data = JSON.parse(msg.content.replace('__PDF_PROCESSING_COMPLETE__', ''));
                  toast.success(`✅ Download completato`, {
                    description: `${data.processed} PDF scaricati su ${data.total}`,
                    duration: 6000,
                  });
                } else if (msg.content.startsWith('__QUERY_SUGGESTION__')) {
                  const data = JSON.parse(msg.content.replace('__QUERY_SUGGESTION__', ''));
                  const reasonText = data.reason === 'zero_results' 
                    ? '❌ Nessun PDF trovato. ' 
                    : '';
                  toast.info(`💡 ${reasonText}Provo un'altra ricerca?`, {
                    description: `Query ${data.variantIndex}/${data.totalVariants}: "${data.nextQuery}"`,
                    duration: 15000,
                    action: {
                      label: "Sì, prova!",
                      onClick: async () => {
                        try {
                          // Esegui la nuova ricerca
                          const { error } = await supabase.functions.invoke('search-and-acquire-pdfs', {
                            body: { 
                              topic: data.nextQuery,
                              maxBooks: 5 
                            }
                          });
                          
                          if (error) {
                            toast.error("Errore durante la ricerca", {
                              description: error.message
                            });
                          } else {
                            toast.success("Ricerca avviata", {
                              description: `Cerco PDF con: "${data.nextQuery}"`
                            });
                          }
                        } catch (e) {
                          console.error('Error executing suggested query:', e);
                        }
                      }
                    }
                  });
                } else if (msg.content.startsWith('__NO_MORE_QUERIES__')) {
                  const data = JSON.parse(msg.content.replace('__NO_MORE_QUERIES__', ''));
                  toast.warning(`🔚 Ho esaurito le query`, {
                    description: `Provate ${data.totalAttempts} varianti di ricerca per "${data.originalTopic}"`,
                    duration: 8000,
                  });
                }
              } catch (e) {
                console.error('Failed to parse PDF notification data:', e);
              }
              return; // Don't add this system message to the UI
            }
            
            // Add new message if it doesn't exist (prevents duplicates)
            setMessages(prev => {
              const exists = prev.some(m => m.id === msg.id);
              if (exists) {
                console.log('⚠️ [REALTIME] Message already exists, skipping:', msg.id);
                return prev;
              }
              console.log('✅ [REALTIME] Adding new message:', msg.id);
              return [...prev, msg];
            });
          } else if (payload.eventType === 'UPDATE') {
            // Update existing message
            setMessages(prev => prev.map(m => 
              m.id === msg.id ? { ...m, content: msg.content } : m
            ));
          }
        }
      )
      .subscribe((status) => {
        console.log(`[REALTIME] Subscription status:`, status);
      });
    
    return () => {
      console.log('[REALTIME] Cleaning up subscriptions');
      supabase.removeChannel(channel);
    };
  }, [currentConversation?.id]);

  // Reload messages when user returns to the app (e.g., from background)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentConversation?.id) {
        console.log('👁️ App visible again, reloading messages');
        loadConversation(currentConversation.id);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentConversation?.id]);

  useEffect(() => {
    const checkUnsynced = async () => {
      if (!currentAgent?.id) return;
      
      // Legacy unsynced check removed - Pipeline A/B/C have no sync_status
      setUnsyncedDocsCount(0);
    };
    
    checkUnsynced();
  }, [currentAgent?.id]);


  // Carica tutti gli agenti all'avvio per useAgentHealth
  useEffect(() => {
    if (session?.user?.id) {
      supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('active', true)
        .then(({ data, error }) => {
          if (!error && data) {
            setAgents(data);
          }
        });
    }
  }, [session?.user?.id, agentUpdateTrigger]);

  // NOTE: Realtime subscription for messages is handled in the unified subscription above (lines 122-214)
  // This section has been removed to prevent duplicate message handling

  // Auto-select agent from URL parameter when returning from presentation
  useEffect(() => {
    const urlAgentId = searchParams.get('agentId');
    if (urlAgentId && session?.user?.id && !currentAgent) {
      // Load the agent from the URL parameter
      supabase
        .from('agents')
        .select('*')
        .eq('id', urlAgentId)
        .eq('user_id', session.user.id)
        .single()
        .then(({ data: agent, error }) => {
          if (!error && agent) {
            handleSelectAgent(agent);
          }
        });
    }
  }, [searchParams, session?.user?.id, currentAgent]);


  const checkUnsyncedDocs = async (agentId: string) => {
    try {
      // Legacy function removed - check-and-sync-all no longer exists
      // Document syncing is now handled by Pipeline A/B/C architecture
      setUnsyncedDocsCount(0);
    } catch (error) {
      console.error('Error checking unsynced docs:', error);
    }
  };

  // ✅ Verifica agent con retry intelligente (fino a 3 tentativi)
  const verifyAgentWithRetry = useCallback(async (agentId: string, maxAttempts = 3) => {
    console.log('[MultiAgentConsultant] Starting agent verification:', { agentId, maxAttempts });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // 2s, 4s, 6s
      
      const { data, error } = await supabase
        .from('agents')
        .select('id, name')
        .eq('id', agentId)
        .eq('active', true)
        .maybeSingle();
      
      if (!error && data) {
        console.log(`[MultiAgentConsultant] ✅ Agent verified in DB (attempt ${attempt}):`, data.name);
        return true;
      }
      
      console.warn(`[MultiAgentConsultant] ⚠️ Agent not found (attempt ${attempt}/${maxAttempts})`);
    }
    
    // ✅ Dopo tutti i tentativi, ricarica solo la lista agenti
    console.warn('[MultiAgentConsultant] Agent verification failed after all attempts, refreshing agents list');
    console.log('[MultiAgentConsultant] State before refresh:', {
      currentAgentId: currentAgent?.id,
      currentAgentName: currentAgent?.name,
      conversationId: currentConversation?.id,
      messagesCount: messages.length,
      timestamp: new Date().toISOString()
    });
    
    setAgentUpdateTrigger(prev => prev + 1);
    toast.warning('Agent list updated');
    return false;
  }, [currentAgent, currentConversation, messages.length]);

  const handleSelectAgent = useCallback(async (agent: Agent) => {
    setCurrentAgent(agent);
    setMessages([]);
    setDrawerOpen(false);
    
    if (!session?.user?.id) return;
    
    // Get or create the unique conversation for this agent
    const { data: conversationId, error } = await supabase.rpc(
      'get_or_create_conversation',
      { 
        p_user_id: session.user.id,
        p_agent_id: agent.id 
      }
    );
    
    if (error) {
      console.error("Error getting conversation:", error);
      return;
    }
    
    if (conversationId) {
      // ✅ CRITICAL: Wait for conversation to load AND sync ref
      await loadConversation(conversationId);
      currentConversationRef.current = conversationId;
    }
  }, [session?.user?.id]);

  const handleAgentCreated = useCallback((newAgent: Agent) => {
    console.log('[MultiAgentConsultant] handleAgentCreated called:', {
      name: newAgent.name,
      id: newAgent.id,
      timestamp: new Date().toISOString()
    });
    
    // First trigger sidebar refresh
    setAgentUpdateTrigger(prev => {
      const newValue = prev + 1;
      console.log('[MultiAgentConsultant] agentUpdateTrigger incremented to:', newValue);
      return newValue;
    });
    
    // Then auto-select the newly created agent
    console.log('[MultiAgentConsultant] Setting currentAgent to:', newAgent.name);
    handleSelectAgent(newAgent);
    console.log(`[MultiAgentConsultant] ${newAgent.name} created/updated successfully`);
    setEditingAgent(null);
    
    // Recheck unsynced docs
    if (newAgent?.id) {
      checkUnsyncedDocs(newAgent.id);
    }
    
    // ✅ Verifica con retry invece di reload forzato
    verifyAgentWithRetry(newAgent.id);
  }, [handleSelectAgent, verifyAgentWithRetry]);

  const handleDeleteAgent = async (agentId: string) => {
    try {
      const { error } = await supabase
        .from("agents")
        .delete()
        .eq("id", agentId);

      if (error) throw error;

      console.log("Agent deleted successfully");
      
      // Reset current agent if it was deleted
      if (currentAgent?.id === agentId) {
        setCurrentAgent(null);
        setCurrentConversation(null);
        setMessages([]);
      }
      
      setEditingAgent(null);
    } catch (error: any) {
      console.error("Error deleting agent:", error);
    }
  };

  const loadConversation = async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const { data: conv, error: convError } = await supabase
        .from("agent_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError) throw convError;
      setCurrentConversation(conv);
      currentConversationRef.current = conv.id; // ✅ Sync ref

      // Load all messages with full content + metadata
      const { data: msgs, error: msgsError } = await supabase
        .from("agent_messages")
        .select("*, metadata")
        .eq("conversation_id", conversationId)
        .order("created_at");

      if (msgsError) throw msgsError;
      
      console.log('🔍 Loaded', msgs?.length, 'messages');
      
      if (!msgs || msgs.length === 0) {
        console.warn('⚠️ No messages loaded');
        setMessages([]);
        return;
      }
      
      const mappedMessages = msgs.map((m) => {
        if (!m.content) {
          console.error('❌ Message without content:', m.id, m);
        }
        return { 
          id: m.id, 
          role: m.role as "user" | "assistant", 
          content: m.content || '', // Fallback to empty string
          llm_provider: m.llm_provider,
          metadata: m.metadata 
        };
      });
      
      console.log('✅ Mapped', mappedMessages.length, 'messages');
      console.log('📋 First message content length:', mappedMessages[0]?.content?.length);
      
      setMessages(mappedMessages);
      
      // Scroll automatico solo se è la prima volta che si carica la conversazione
      // Altrimenti l'utente potrebbe essere nel mezzo della lettura
      if (mappedMessages.length > 0 && !messages.length) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        }, 100);
      }
    } catch (error: any) {
      console.error("Error loading conversation:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  /**
   * 🔍 Verifica se un messaggio esiste già nel database
   * Usato per distinguere tra failure reale e interruzione SSE
   */
  const checkMessageExists = async (messageId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from("agent_messages")
        .select("id, content")
        .eq("id", messageId)
        .single();
      
      if (error) {
        console.error("❌ Error checking message:", error);
        return false;
      }
      
      const exists = !!data?.content && data.content.length > 0;
      console.log(`🔍 Message ${messageId} exists in DB:`, exists, `(${data?.content?.length || 0} chars)`);
      return exists;
    } catch (e) {
      console.error("❌ Exception checking message:", e);
      return false;
    }
  };

  // ============================================================
  // LOCAL TOOL EXECUTION FUNCTIONS (Browser Automation)
  // ============================================================

  /**
   * Execute a single tool_server_action locally via ToolServer.exe
   * Called when SSE sends tool_execute_locally with tool: 'tool_server_action'
   */
  const executeLocalToolServerAction = async (command: {
    action: string;
    params: Record<string, unknown>;
  }): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    const { action, params } = command;
    const sessionId = sessionManager.sessionId;

    // 🔍 DEBUG: Log dettagliato per tracciare session_id
    console.log(`🔧 [LOCAL] Executing: ${action}`, params);
    console.log(`🔍 [LOCAL] params.session_id: ${params.session_id || 'not provided'}`);
    console.log(`🔍 [LOCAL] sessionManager.sessionId: ${sessionId || 'NONE ⚠️'}`);
    console.log(`🔍 [LOCAL] Using session_id: ${params.session_id || sessionId || 'NONE ⚠️'}`);
    
    try {
      switch (action) {
        case 'browser_start': {
          const startResult = await toolServerClient.browserStart(
            (params.start_url as string) || 'about:blank',
            { headless: params.headless as boolean }
          );
          if (startResult.session_id) {
            sessionManager.captureFromToolResult({ session_id: startResult.session_id });
          }
          return { success: startResult.success, data: startResult };
        }
        
        case 'browser_stop':
          return await toolServerClient.browserStop((params.session_id as string) || sessionId!);
        
        case 'screenshot': {
          const screenshotResult = await toolServerClient.screenshot({
            scope: (params.scope as 'browser' | 'desktop') || 'browser',
            session_id: (params.session_id as string) || sessionId || undefined,
            optimize_for: 'lux',
          });
          return { 
            success: screenshotResult.success, 
            data: {
              image_base64: screenshotResult.original?.image_base64,
              width: screenshotResult.original?.width,
              height: screenshotResult.original?.height,
            }
          };
        }
        
        case 'dom_tree': {
          const domResult = await toolServerClient.getDomTree((params.session_id as string) || sessionId!);
          return { success: domResult.success, data: { tree: domResult.tree } };
        }
        
        case 'click':
          return await toolServerClient.click({
            scope: (params.scope as 'browser' | 'desktop') || 'browser',
            session_id: (params.session_id as string) || sessionId || undefined,
            x: params.x as number,
            y: params.y as number,
            coordinate_origin: (params.coordinate_origin as 'viewport' | 'lux_sdk') || 'viewport',
            click_type: (params.click_type as 'single' | 'double' | 'right') || 'single',
          });

        case 'click_by_ref':
          // Click element by ref ID from dom_tree (e.g., "e3", "e9")
          if (!params.ref) {
            return { success: false, error: 'ref parameter required for click_by_ref' };
          }
          return await toolServerClient.clickByRef({
            session_id: (params.session_id as string) || sessionId!,
            ref: params.ref as string,
            click_type: (params.click_type as 'single' | 'double' | 'right') || 'single',
          });

        case 'type':
          return await toolServerClient.type({
            scope: (params.scope as 'browser' | 'desktop') || 'browser',
            session_id: (params.session_id as string) || sessionId || undefined,
            text: params.text as string,
            method: (params.method as 'keystrokes' | 'clipboard') || 'clipboard',
          });
        
        case 'scroll':
          return await toolServerClient.scroll({
            scope: (params.scope as 'browser' | 'desktop') || 'browser',
            session_id: (params.session_id as string) || sessionId || undefined,
            direction: (params.direction as 'up' | 'down') || 'down',
            amount: (params.amount as number) || 300,
          });
        
        case 'keypress':
          // Note: params uses 'key' but API uses 'keys'
          return await toolServerClient.keypress({
            scope: (params.scope as 'browser' | 'desktop') || 'browser',
            session_id: (params.session_id as string) || sessionId || undefined,
            keys: (params.key as string) || (params.keys as string) || 'Enter',
          });
        
        case 'navigate':
          return await toolServerClient.browserNavigate(
            (params.session_id as string) || sessionId!,
            params.url as string
          );

        // v10.4.0: Tracing actions
        case 'tracing_start':
          return await toolServerClient.tracingStart({
            session_id: (params.session_id as string) || sessionId!,
            screenshots: params.screenshots !== false,
            snapshots: params.snapshots !== false,
          });

        case 'tracing_stop':
          return await toolServerClient.tracingStop({
            session_id: (params.session_id as string) || sessionId!,
          });

        case 'console_messages':
          return await toolServerClient.getConsoleMessages({
            session_id: (params.session_id as string) || sessionId!,
            limit: (params.limit as number) || 100,
            clear: (params.clear as boolean) || false,
          });

        case 'network_requests':
          return await toolServerClient.getNetworkRequests({
            session_id: (params.session_id as string) || sessionId!,
            limit: (params.limit as number) || 100,
            clear: (params.clear as boolean) || false,
          });

        // v10.4.0: Assertion/verify actions
        case 'verify_visible':
          return await toolServerClient.verifyElementVisible({
            session_id: (params.session_id as string) || sessionId!,
            selector: params.selector as string,
            ref: params.ref as string,
            text: params.text as string,
            timeout: (params.timeout as number) || 5000,
          });

        case 'verify_text':
          return await toolServerClient.verifyTextVisible({
            session_id: (params.session_id as string) || sessionId!,
            text: params.text as string,
            exact: (params.exact as boolean) || false,
            timeout: (params.timeout as number) || 5000,
          });

        case 'verify_url':
          return await toolServerClient.verifyUrl({
            session_id: (params.session_id as string) || sessionId!,
            url: params.url as string,
            url_contains: params.url_contains as string,
          });

        case 'verify_title':
          return await toolServerClient.verifyTitle({
            session_id: (params.session_id as string) || sessionId!,
            title: params.title as string,
            title_contains: params.title_contains as string,
          });

        default:
          console.warn(`🔍 [LOCAL] Unknown action: ${action}`);
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [LOCAL] Action ${action} failed:`, errorMsg);
      console.error(`🔍 [LOCAL] Error details:`, error);
      return { success: false, error: errorMsg };
    }
  };

  /**
   * Execute a pre-generated plan locally via the Orchestrator.
   * Called when SSE sends tool_execute_locally with tool: 'browser_orchestrator'
   */
  const executeLocalOrchestratorPlan = async (command: {
    task?: string;
    navigation?: { action: string; params: Record<string, unknown> };
    plan: Plan;
    config?: Record<string, unknown>;
  }): Promise<{ success: boolean; state?: unknown; error?: string }> => {
    const { navigation, plan, config } = command;
    
    console.log(`🤖 [LOCAL] Executing orchestrator plan with ${plan?.steps?.length || 0} steps`);
    
    try {
      // Create orchestrator instance with callbacks for UI updates
      const orchestrator = new Orchestrator(config || {}, {
        onStateChange: (state) => {
          setLocalExecutionStatus({
            active: true,
            tool: 'browser_orchestrator',
            status: state.status,
            stepInfo: `Step ${state.current_step_index + 1}/${plan?.steps?.length || 0}`,
          });
        },
        onStepStart: (step, index) => {
          console.log(`📍 [Orchestrator] Starting step ${index + 1}: ${step.action_type}`);
          setLocalExecutionStatus({
            active: true,
            tool: 'browser_orchestrator',
            status: 'executing',
            stepInfo: `Step ${index + 1}: ${step.target_description.slice(0, 50)}`,
          });
        },
        onStepComplete: (execution, index) => {
          console.log(`${execution.success ? '✅' : '❌'} [Orchestrator] Step ${index + 1} completed`);
        },
        onLog: (entry) => {
          console.log(`[Orchestrator ${entry.level}] ${entry.message}`);
        },
      });

      // Execute the pre-generated plan
      const result = await orchestrator.executePlanFromCloud(plan, {
        sessionId: sessionManager.sessionId || undefined,
        navigation: navigation,
      });

      return { 
        success: result.status === 'completed', 
        state: result,
        error: result.error,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [LOCAL] Orchestrator failed:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  const handleSendMessage = async (
    text: string, 
    attachments?: Array<{ url: string; name: string; type: string }>, 
    forcedTool?: string, 
    luxMode?: string,
    computerUseProvider?: 'lux' | 'gemini',
    geminiOptions?: { headless?: boolean; highlightMouse?: boolean }
  ) => {
    // ✅ Guard anti-double-submit
    if (isSending) {
      console.warn("⚠️ Double submit prevented - already sending");
      return;
    }
    
    if (!session?.access_token) return;
    
    const agent = currentAgent;
    if (!agent) return;
    
    setIsSending(true); // ✅ Lock submissions

    // ✅ Use ref for immediate access, fallback to state
    const conversationId = currentConversationRef.current || currentConversation?.id;

    if (!conversationId) {
      console.error("❌ No active conversation - agent might still be loading");
      toast.error("Please wait for the conversation to load");
      setIsSending(false);
      return;
    }
    
    // ✅ Verify conversation belongs to current agent
    if (currentConversation && currentConversation.agent_id !== agent.id) {
      console.error("❌ Conversation mismatch detected!");
      console.error("  Current agent:", agent.id, agent.name);
      console.error("  Conversation agent:", currentConversation.agent_id);
      toast.error("Please try again - conversation is loading");
      setIsSending(false);
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    
    // Create placeholder for assistant message
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    
    setStreamingConversationId(conversationId);

    // Keep track of the real backend message id (can differ from our UI placeholder id)
    let backendMessageId: string | null = null;
    
    // 🔍 Dichiarazione variabili per cleanup (accessibili da catch/finally)
    let timeout: NodeJS.Timeout | undefined;
    let stallDetectionInterval: NodeJS.Timeout | undefined;

    try {
      // Increased timeout to 120 seconds (2 minutes) for long responses
      const controller = new AbortController();
      timeout = setTimeout(() => {
        controller.abort();
        console.error('Request timeout after 2 minutes');
      }, 120000);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            message: text,
            conversationId,
            agentSlug: agent.slug,
            attachments,
            forcedTool,
            luxMode,
            computerUseProvider,
            headless: geminiOptions?.headless,
            highlightMouse: geminiOptions?.highlightMouse,
          }),
          keepalive: true,
          signal: controller.signal
        }
      );
      
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      console.log("🌊 SSE stream started for assistant message:", assistantId);
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";
      let lastMessageId = "";
      
      // 🔍 Diagnostica SSE: tracking timestamp e stalli
      let lastChunkTime = Date.now();
      let chunkCount = 0;

      if (!reader) throw new Error("No reader");
      
      // 🔍 Avviare monitoraggio stalli
      stallDetectionInterval = setInterval(() => {
        const timeSinceLastChunk = Date.now() - lastChunkTime;
        if (timeSinceLastChunk > 10000) { // 10 secondi senza chunk
          console.warn(`⚠️ SSE stalled! No chunks for ${timeSinceLastChunk}ms`);
          console.warn(`   Last content length: ${accumulatedText.length}`);
          console.warn(`   Total chunks received: ${chunkCount}`);
        }
      }, 5000); // Check ogni 5 secondi

      let heartbeatCheckInterval: NodeJS.Timeout | null = null;
      let lastRealtimeContentLength = 0;
      
      const setupRealtimeSubscription = (messageId: string) => {
        console.log(`📡 [Realtime] Setting up subscription for message ${messageId.slice(0, 8)}`);
        
        // Heartbeat check ogni 10 secondi per monitorare la crescita del messaggio
        heartbeatCheckInterval = setInterval(async () => {
          const { data: currentMessage } = await supabase
            .from('agent_messages')
            .select('content')
            .eq('id', messageId)
            .single();
          
          if (currentMessage) {
            const currentLength = currentMessage.content.length;
            console.log(`💓 [Heartbeat] DB check: ${currentLength} chars (was ${lastRealtimeContentLength})`);
            
            // Se il DB ha più contenuto di quello visualizzato, aggiorna
            if (currentLength > accumulatedText.length + 500) {
              console.log(`🔄 [Heartbeat] DB has ${currentLength - accumulatedText.length} more chars, resyncing...`);
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId 
                    ? { ...m, content: currentMessage.content }
                    : m
                )
              );
              accumulatedText = currentMessage.content;
            }
            lastRealtimeContentLength = currentLength;
          }
        }, 10000);
        
        const channel = supabase
          .channel(`message-${messageId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'agent_messages',
              filter: `id=eq.${messageId}`
            },
            (payload: any) => {
              console.log('📨 [Realtime] Update received:', payload.new.id.slice(0, 8));
              console.log('   Content length:', payload.new.content.length);
              
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId 
                    ? { 
                        ...m, 
                        content: payload.new.content,
                        llm_provider: payload.new.llm_provider 
                      } 
                    : m
                )
              );
              
              if (payload.new.content) {
                preGenerateAudio(assistantId, payload.new.content);
              }
              
              // Log finale per conferma
              console.log(`✅ Message ${assistantId.slice(0,8)} updated to ${payload.new.content.length} chars`);
            }
          )
          .subscribe((status) => {
            console.log('📡 Realtime status:', status);
          });
        
        setTimeout(() => {
          console.log('🔌 [Realtime] Cleaning up subscription and heartbeat');
          if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
          supabase.removeChannel(channel);
        }, 600000);
      };

      let shouldStopStreaming = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          try {
            if (!line.trim() || 
                line.startsWith(":") || 
                !line.startsWith("data: ")) {
              continue;
            }

            const dataStr = line.slice(6).trim();

            if (dataStr === "[DONE]" || 
                dataStr === "keep-alive" || 
                dataStr === '"keep-alive"') {
              continue;
            }

            let parsed: any;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              // ✅ IMPORTANT: SSE JSON can be split across chunks.
              // If parsing fails, re-buffer this line and wait for more data.
              buffer = `${line}\n${buffer}`;
              break;
            }

            if (parsed.type === "message_start") {
              lastMessageId = parsed.messageId;
              backendMessageId = parsed.messageId;
              console.log("📨 Message started:", lastMessageId.slice(0, 8));
              
            } else if (parsed.type === "content" && parsed.text) {
              // ✅ THROTTLING: Accumula in ref invece di aggiornare subito React
              accumulatedText += parsed.text;
              accumulatedTextRef.current = accumulatedText; // Salva in ref per throttling
              chunkCount++; // 🔍 Incrementa contatore chunk
              lastChunkTime = Date.now(); // 🔍 Aggiorna timestamp ultimo chunk
              
              // ✅ Log first delta received
              if (chunkCount === 1) {
                console.log("✅ First delta received, stream is working");
              }
              
              // 🔍 Log più frequente per diagnosi (ogni 500 caratteri)
              if (accumulatedText.length % 500 === 0) {
                console.log(`📊 [${new Date().toISOString()}] Accumulated ${accumulatedText.length} chars (chunk #${chunkCount})`);
              }
              
              // ✅ Aggiorna UI ogni 100ms invece che ad ogni chunk (riduce da ~1365 a ~560 update)
              if (!throttleTimeoutRef.current) {
                throttleTimeoutRef.current = setTimeout(() => {
                  const currentText = accumulatedTextRef.current;
                  setMessages((prev) => 
                    prev.map((m) =>
                      m.id === assistantId 
                        ? { ...m, content: currentText } 
                        : m
                    )
                  );
                  throttleTimeoutRef.current = null;
                }, 100); // Update UI ogni 100ms
              }
              
            } else if (parsed.type === "switching_to_background") {
              console.log("⏰ Switching to background - accumulated:", accumulatedText.length, "chars");
              if (stallDetectionInterval) clearInterval(stallDetectionInterval);
              accumulatedText = parsed.message;
              
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId 
                    ? { ...m, content: accumulatedText } 
                    : m
                )
              );
              
              const messageId = backendMessageId || lastMessageId || assistantId;
              setupRealtimeSubscription(messageId);

              // ✅ IMPORTANT: Stop the SSE loop immediately.
              // Some providers keep the connection open; without this, the UI can stay "streaming" forever.
              shouldStopStreaming = true;
              await reader.cancel();
              break;
              
            } else if (parsed.type === "complete" || parsed.type === "done") {
              const isComplete = parsed.type === "complete";
              console.log(isComplete ? "✅ SSE stream completed successfully" : "✅ SSE stream done");
              if (stallDetectionInterval) clearInterval(stallDetectionInterval);
              
              // ✅ FLUSH FINALE: Cancella timeout pendente e forza update con testo completo
              if (throttleTimeoutRef.current) {
                clearTimeout(throttleTimeoutRef.current);
                throttleTimeoutRef.current = null;
              }
              
              // Forza update finale con tutto il testo accumulato
              const finalText = accumulatedTextRef.current;
              console.log(`🏁 Final flush: ${finalText.length} chars`);
              
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId 
                    ? { 
                        ...m, 
                        content: finalText, // ✅ Usa testo completo dalla ref
                        llm_provider: isComplete ? parsed.llmProvider : m.llm_provider,
                      } 
                    : m
                )
              );
              
              // Recovery mechanism: verify message was saved completely to DB
              setTimeout(async () => {
                const { data: dbMessage } = await supabase
                  .from('agent_messages')
                  .select('content')
                  .eq('id', assistantId)
                  .single();
                
                if (dbMessage && dbMessage.content.length > accumulatedTextRef.current.length) {
                  console.log(`🔄 [RECOVERY] Message in DB is longer (${dbMessage.content.length} vs ${accumulatedTextRef.current.length}), updating UI`);
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantId 
                      ? { ...msg, content: dbMessage.content }
                      : msg
                  ));
                }
              }, 1000);
              
              if (isComplete && parsed.conversationId && !currentConversation) {
                setCurrentConversation({
                  id: parsed.conversationId,
                  agent_id: currentAgent.id,
                  title: (text || accumulatedText || "Chat").slice(0, 50)
                });
              }
              
              // ✅ IMPORTANT: Stop the SSE loop immediately.
              // Some providers keep the connection open; without this, the UI can stay "streaming" forever.
              shouldStopStreaming = true;
              await reader.cancel();
              break;
              
            } else if (parsed.type === "error") {
              throw new Error(parsed.error || "Unknown error");
              
            } else if (parsed.type === "tool_execute_locally") {
              // ============================================================
              // BROWSER AUTOMATION: Execute tool locally via ToolServer.exe
              // ============================================================
              const command = parsed.data;
              console.log(`🔧 [LOCAL EXEC] Received command:`, command.tool, command.action || '');
              
              // Show execution status in UI
              setLocalExecutionStatus({
                active: true,
                tool: command.tool,
                status: `Executing ${command.tool}...`,
              });
              
              try {
                let result: { success: boolean; data?: unknown; error?: string };
                
                if (command.tool === 'tool_server_action') {
                  // Execute single action via toolServerClient
                  result = await executeLocalToolServerAction({
                    action: command.action,
                    params: command.params || {},
                  });
                  
                  // 🔍 DEBUG: Log risultato dell'esecuzione
                  console.log(`🔍 [LOCAL] Execution result for ${command.action}:`, {
                    success: result.success,
                    hasData: !!result.data,
                    error: result.error || 'none',
                  });

                  // Per azioni che richiedono risultato, invia al backend
                  // CRITICAL: browser_start DEVE essere incluso per comunicare session_id all'agent!
                  const actionsRequiringResult = ['browser_start', 'dom_tree', 'screenshot'];
                  if (actionsRequiringResult.includes(command.action) && result.success) {
                    console.log(`📤 [LOCAL] Sending ${command.action} result back to agent`);
                    console.log(`🔍 [LOCAL] Result data preview:`, JSON.stringify(result.data).slice(0, 200) + '...');

                    const toolServerResultPayload = {
                      action: command.action,
                      success: result.success,
                      data: result.data as Record<string, unknown>,
                      error: result.error,
                      session_id: (result.data as { session_id?: string })?.session_id || sessionManager.sessionId,
                      timestamp: Date.now()
                    };
                    
                    try {
                      const response = await fetch(
                        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session?.access_token}`,
                          },
                          body: JSON.stringify({
                            message: '', // Empty - content is in toolServerResult
                            conversationId: currentConversation?.id || streamingConversationId,
                            agentSlug: currentAgent?.slug,
                            toolServerResult: toolServerResultPayload,
                            silent: true
                          }),
                        }
                      );
                      
                      if (!response.ok) {
                        throw new Error(`Failed to send tool result: ${response.status}`);
                      }

                      const actionLabels: Record<string, string> = {
                        'browser_start': 'Browser started',
                        'screenshot': 'Screenshot captured',
                        'dom_tree': 'DOM structure analyzed',
                      };
                      const actionLabel = actionLabels[command.action] || command.action;
                      toast.success(`${actionLabel}, agent continuing...`);
                      
                    } catch (sendError) {
                      console.error(`❌ [LOCAL] Failed to send ${command.action} result:`, sendError);
                      toast.error(`Failed to send result to agent: ${sendError instanceof Error ? sendError.message : 'Unknown error'}`);
                    }
                  } else {
                    // 🔍 DEBUG: Log per azioni che NON inviano risultato al backend
                    console.log(`🔍 [LOCAL] Action ${command.action} completed (result NOT sent to agent - only browser_start/dom_tree/screenshot trigger callback)`);
                  }

                } else if (command.tool === 'browser_orchestrator') {
                  // Execute pre-generated plan via Orchestrator
                  result = await executeLocalOrchestratorPlan({
                    task: command.task,
                    navigation: command.navigation,
                    plan: command.plan,
                    config: command.config,
                  });
                  
                } else if (command.tool === 'desktop_lux_automation') {
                  // ============================================================
                  // DESKTOP LUX AUTOMATION: Execute via DesktopOrchestrator
                  // ============================================================
                  console.log('🖥️ [LOCAL] Executing desktop_lux_automation:', command.mode);
                  
                  setLocalExecutionStatus({
                    active: true,
                    tool: 'desktop_lux_automation',
                    status: `Desktop ${command.mode} mode starting...`,
                    stepInfo: command.task_description?.slice(0, 50)
                  });
                  
                  try {
                    // Dynamic import to avoid bundling if not used
                    const { createDesktopOrchestrator } = await import('@/lib/desktop-automation');
                    
                    const orchestrator = createDesktopOrchestrator({
                      onStep: (stepIndex, action) => {
                        setLocalExecutionStatus(prev => prev ? {
                          ...prev,
                          status: `Step ${stepIndex}: ${action.type}`,
                          stepInfo: action.text?.slice(0, 30) || `(${action.coordinate?.[0]}, ${action.coordinate?.[1]})`
                        } : null);
                      },
                      onTodoStart: (todoIndex, desc) => {
                        toast.info(`📌 Todo ${todoIndex + 1}: ${desc.slice(0, 50)}...`);
                      },
                      onTodoComplete: (todoIndex, desc, success) => {
                        if (success) {
                          toast.success(`✅ Todo ${todoIndex + 1} completato`);
                        } else {
                          toast.warning(`⚠️ Todo ${todoIndex + 1} non completato`);
                        }
                      },
                      onLog: (msg, level) => {
                        console.log(`[Desktop ${level}] ${msg}`);
                      },
                      onComplete: (taskResult) => {
                        console.log('🏁 Desktop automation completed:', taskResult);
                      }
                    });
                    
                    const taskResult = await orchestrator.execute({
                      mode: command.mode,
                      task_description: command.task_description,
                      todos: command.todos,
                      start_url: command.start_url,
                      config: command.config
                    });
                    
                    result = { 
                      success: taskResult.success, 
                      data: taskResult,
                      error: taskResult.error
                    };
                    
                    if (taskResult.success) {
                      toast.success(taskResult.message);
                    } else {
                      toast.error(taskResult.message);
                    }
                    
                  } catch (desktopError) {
                    console.error('❌ [LOCAL] desktop_lux_automation failed:', desktopError);
                    const errMsg = desktopError instanceof Error ? desktopError.message : 'Unknown error';
                    toast.error(`Desktop automation failed: ${errMsg}`);
                    result = { success: false, error: errMsg };
                  }
                  
                } else if (command.tool === 'browser_get_dom') {
                  // Execute DOM retrieval and send result back to agent
                  console.log('🌐 [LOCAL] Executing browser_get_dom:', command.url);
                  
                  setLocalExecutionStatus({
                    active: true,
                    tool: 'browser_get_dom',
                    status: 'Analyzing page structure...',
                  });
                  
                  try {
                    // Create orchestrator if needed
                    const orchestrator = new Orchestrator();
                    
                    // Timeout 30 seconds
                    const domResult = await Promise.race([
                      orchestrator.getDomForPlanning(command.url),
                      new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('DOM timeout (30s)')), 30000)
                      )
                    ]) as { dom_tree: string; session_id: string; current_url: string; element_count: number };
                    
                    console.log(`✅ [LOCAL] DOM retrieved: ${domResult.element_count} elements`);
                    
                    // Send DOM back to agent silently (auto-continuation)
                    const domPayload = {
                      dom_tree: domResult.dom_tree,
                      session_id: domResult.session_id,
                      url: domResult.current_url,
                      timestamp: Date.now()
                    };
                    
                    // Call agent-chat with domResult (silent message)
                    const response = await fetch(
                      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${session?.access_token}`,
                        },
                        body: JSON.stringify({
                          message: '', // Empty - content is in domResult
                          conversationId: currentConversation?.id || streamingConversationId,
                          agentSlug: currentAgent?.slug,
                          domResult: domPayload,
                          silent: true
                        }),
                      }
                    );
                    
                    if (!response.ok) {
                      throw new Error(`Failed to send DOM result: ${response.status}`);
                    }
                    
                    toast.success('Page structure analyzed, creating plan...');
                    
                    result = { success: true, data: { element_count: domResult.element_count } };
                    
                  } catch (domError) {
                    console.error('❌ [LOCAL] browser_get_dom failed:', domError);
                    toast.error(`Failed to analyze page: ${domError instanceof Error ? domError.message : 'Unknown error'}`);
                    result = { success: false, error: domError instanceof Error ? domError.message : 'Unknown error' };
                  }
                  
                } else {
                  result = { success: false, error: `Unknown local tool: ${command.tool}` };
                }
                
                // Log result
                if (result.success) {
                  console.log(`✅ [LOCAL EXEC] ${command.tool} completed successfully`);
                  if (command.tool !== 'browser_get_dom') {
                    toast.success(`Browser action completed: ${command.action || command.tool}`);
                  }
                } else {
                  console.error(`❌ [LOCAL EXEC] ${command.tool} failed:`, result.error);
                  toast.error(`Browser action failed: ${result.error}`);
                }
                
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`❌ [LOCAL EXEC] Error:`, errorMsg);
                toast.error(`Local execution error: ${errorMsg}`);
              } finally {
                setLocalExecutionStatus(null);
              }
            }
          } catch (e) {
            console.warn("⚠️ Error processing line:", e);
            continue;
          }
        }

        if (shouldStopStreaming) {
          break;
        }
      }
    } catch (error: any) {
      console.error("❌ SSE stream interrupted:", {
        error: error.message,
        assistantId,
        conversationId,
        backendMessageId
      });
      
      if (stallDetectionInterval) {
        clearInterval(stallDetectionInterval);
      }
      
      // 🔍 Verifica se il messaggio esiste già nel database (usa messageId del backend se disponibile)
      const idToCheck = backendMessageId || assistantId;
      console.log("🔍 Checking if assistant message was saved despite streaming error...", { idToCheck });
      const messageExists = await checkMessageExists(idToCheck);
      
      if (messageExists) {
        // ✅ SILENT RECOVERY: Il messaggio esiste, recuperalo dal DB
        console.log("✅ Message found in DB, performing silent recovery");
        
        toast.info("Recupero risposta in corso...", {
          description: "La risposta è stata generata correttamente"
        });
        
        if (conversationId) {
          await loadConversation(conversationId);
        }
      } else {
        // ❌ ERRORE REALE: Il messaggio NON esiste → mostra errore nel bubble invece di lasciare vuoto
        console.error("❌ Message NOT found in DB, real error occurred");

        const rawMsg = String(error?.message || "Riprova tra qualche secondo");
        const isBilling = /credit balance is too low|Plans & Billing/i.test(rawMsg);
        const friendly = isBilling
          ? "⚠️ Il provider AI per questo agente non ha più credito disponibile. Ricarica il credito o cambia modello/agente." 
          : `⚠️ Errore: ${rawMsg}`;

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: friendly } : m))
        );

        toast.error("Errore durante la generazione", {
          description: isBilling ? "Credito insufficiente sul provider AI." : rawMsg,
        });
      }
    } finally {
      if (stallDetectionInterval) {
        clearInterval(stallDetectionInterval); // 🔍 Cleanup garantito
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      // ✅ Cleanup throttle timeout
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      setStreamingConversationId(null);
      setIsSending(false); // ✅ Unlock submissions
    }
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
    setSelectionMode(false);
    setSelectedMessages([]);
  };

  const handleStartSelection = (messageId: string) => {
    setSelectionMode(true);
    setSelectedMessages([messageId]);
  };

  const handleToggleSelection = (messageId: string) => {
    setSelectedMessages(prev => {
      if (prev.includes(messageId)) {
        const newSelection = prev.filter(id => id !== messageId);
        // Exit selection mode if no messages left
        if (newSelection.length === 0) {
          setSelectionMode(false);
        }
        return newSelection;
      } else {
        return [...prev, messageId];
      }
    });
  };

  const handleSelectAll = () => {
    setSelectedMessages(messages.map(m => m.id));
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedMessages([]);
  };

  const handleDeleteMessages = async () => {
    if (selectedMessages.length === 0) return;
    
    try {
      const { error } = await supabase
        .from("agent_messages")
        .delete()
        .in("id", selectedMessages);
      
      if (error) throw error;
      
      setMessages(prev => prev.filter(m => !selectedMessages.includes(m.id)));
      setSelectionMode(false);
      setSelectedMessages([]);
    } catch (error: any) {
      console.error("Error deleting messages:", error);
    }
  };

  const handleForward = () => {
    setShowForwardDialog(true);
  };

  const handleForwardComplete = async (
    conversationId: string, 
    agentId: string, 
    messageContent: string
  ) => {
    setSelectionMode(false);
    setSelectedMessages([]);
    setShowForwardDialog(false);
    
    // Load the agent
    const { data: agentData } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();
    
    if (!agentData) return;
    
    // Set the agent and load the conversation
    setCurrentAgent(agentData);
    await loadConversation(conversationId);
    
    // Small delay to ensure UI has updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send the forwarded message, passing both conversationId and agent explicitly
    await handleSendMessage(messageContent);
  };

  const handleDeleteAllMessages = async () => {
    if (!currentConversation?.id) return;
    
    try {
      const { error } = await supabase
        .from("agent_messages")
        .delete()
        .eq("conversation_id", currentConversation.id);
      
      if (error) throw error;
      
      setMessages([]);
      setShowDeleteAllDialog(false);
    } catch (error: any) {
      console.error("Error deleting all messages:", error);
    }
  };


  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop Sidebar - Always show AgentsSidebar */}
      {!isMobile && (
        <div className="w-[280px] flex-shrink-0 flex flex-col border-r bg-sidebar">
          <AgentsSidebar
            currentAgentId={currentAgent?.id || null}
            onSelectAgent={handleSelectAgent}
            onCreateAgent={() => setShowCreateModal(true)}
            onEditAgent={(agent) => {
              setEditingAgent(agent);
              setShowCreateModal(true);
            }}
            agentUpdateTrigger={agentUpdateTrigger}
          />
        </div>
      )}


      {/* Mobile Drawer */}
      {isMobile && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <AgentsSidebar
              currentAgentId={currentAgent?.id || null}
              onSelectAgent={handleSelectAgent}
              onCreateAgent={() => {
                setShowCreateModal(true);
                setDrawerOpen(false);
              }}
              onEditAgent={(agent) => {
                setEditingAgent(agent);
                setShowCreateModal(true);
                setDrawerOpen(false);
              }}
              agentUpdateTrigger={agentUpdateTrigger}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Create Agent Modal */}
      <CreateAgentModal
        open={showCreateModal}
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setEditingAgent(null);
        }}
        onSuccess={handleAgentCreated}
        editingAgent={editingAgent}
        onDelete={handleDeleteAgent}
        onDocsUpdated={() => currentAgent?.id && checkUnsyncedDocs(currentAgent.id)}
      />

      {/* Forward Message Dialog */}
            <ForwardMessageDialog
              open={showForwardDialog}
              onOpenChange={setShowForwardDialog}
              message={messages.find(m => m.id === selectedMessages[0]) || null}
              currentAgentId={currentAgent?.id || ""}
              onForwardComplete={handleForwardComplete}
            />


      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-background to-muted/20">
        {currentAgent ? (
          <>
            {/* Global Alerts */}
            <GlobalAlerts hasAgentIssues={agentHealth.hasAnyIssues()} />

            {/* Header with Settings */}
            <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
              <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
                {!selectionMode ? (
                  <>
                     {isMobile && (
                      <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)}>
                        <Menu className="h-5 w-5" />
                      </Button>
                     )}
                     <div className="flex items-center gap-3 flex-1 min-w-0 mr-2">
                       <div className="min-w-0 flex-1">
                         <h1 className="font-semibold truncate">{currentAgent.name}</h1>
                       </div>
                        </div>
                         <div className="flex items-center gap-2 flex-shrink-0">
                           {messages.length > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAllMessagesExpanded(!allMessagesExpanded)}
                                className="gap-2"
                                title={allMessagesExpanded ? "Riduci tutti" : "Espandi tutti"}
                              >
                                {allMessagesExpanded ? <ChevronsDown className="h-4 w-4" /> : <ChevronsUp className="h-4 w-4" />}
                              </Button>
                            </>
                          )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingAgent(currentAgent);
                                    setShowCreateModal(true);
                                  }}
                                  className="relative"
                                >
                                  <Edit className="h-4 w-4" />
                                  {unsyncedDocsCount > 0 && (
                                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                                      {unsyncedDocsCount}
                                    </span>
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {unsyncedDocsCount > 0 
                                  ? `${unsyncedDocsCount} ${unsyncedDocsCount === 1 ? 'documento con problemi di sincronizzazione' : 'documenti con problemi di sincronizzazione'}`
                                  : 'Modifica agente'
                                }
                              </TooltipContent>
                            </Tooltip>
                            {/* Tool Server Status Indicator - CLICCABILE */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div 
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted cursor-pointer"
                                  onClick={() => setShowToolServerDialog(true)}
                                >
                                  <div className={`w-2 h-2 rounded-full ${
                                    toolServerStatus === 'connected' ? 'bg-green-500' :
                                    toolServerStatus === 'disconnected' ? 'bg-red-500' :
                                    toolServerStatus === 'not_configured' ? 'bg-yellow-500' :
                                    'bg-yellow-500 animate-pulse'
                                  }`} />
                                  <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  {toolServerStatus === 'connected' && '🟢 Tool Server connesso'}
                                  {toolServerStatus === 'disconnected' && '🔴 Tool Server non connesso'}
                                  {toolServerStatus === 'not_configured' && '🟡 Tool Server non configurato'}
                                  {toolServerStatus === 'checking' && '⏳ Verifica in corso...'}
                                  <div className="text-muted-foreground mt-1">Clicca per configurare</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                       </div>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={handleCancelSelection}>
                      <X className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-semibold">
                        {selectedMessages.length} {selectedMessages.length === 1 ? 'messaggio' : 'messaggi'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedMessages.length < messages.length && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAll}
                          className="gap-2"
                        >
                          <span className="hidden md:inline">Seleziona tutti</span>
                          <span className="md:hidden">Tutti</span>
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        onClick={handleDeleteMessages}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden md:inline">{selectedMessages.length === 1 ? 'Elimina' : 'Elimina tutti'}</span>
                        <span className="md:hidden">Elimina</span>
                      </Button>
                      
                      <ExportSelectedMessagesPDF
                        conversationId={currentConversation.id}
                        agentName={currentAgent.name}
                        selectedMessageIds={selectedMessages}
                        allMessages={messages}
                      />
                      {selectedMessages.length === 1 && (
                        <Button
                          onClick={handleForward}
                          className="gap-2"
                        >
                          <Forward className="h-4 w-4" />
                          <span className="hidden md:inline">Inoltra</span>
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Messages Container - CENTERED with max-width */}
            <ScrollArea className="flex-1" onScroll={handleScroll}>
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="max-w-4xl mx-auto px-3 md:px-6 py-6">
                  {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6 md:p-8 text-center">
                      <div>
                        <div className="text-3xl md:text-4xl mb-3 md:mb-4">{currentAgent.avatar || "🤖"}</div>
                        <h2 className="text-lg md:text-xl font-semibold mb-2">Start a conversation</h2>
                        <p className="text-sm md:text-base text-muted-foreground">
                          Ask {currentAgent.name} anything about {currentAgent.description.toLowerCase()}
                        </p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        id={msg.id}
                        role={msg.role}
                        content={msg.content}
                        isStreaming={streamingConversationId === currentConversation?.id && msg.id === messages[messages.length - 1]?.id}
                        selectionMode={selectionMode}
                        isSelected={selectedMessages.includes(msg.id)}
                        onToggleSelection={() => handleToggleSelection(msg.id)}
                        onLongPress={() => handleStartSelection(msg.id)}
                        forceExpanded={allMessagesExpanded}
                        agentId={currentAgent?.id}
                        llmProvider={(msg as any).llm_provider}
                        metadata={(msg as any).metadata}
                        videoDocumentsForAgent={videoDocumentsForAgent}
                      />
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Chat Input - FIXED BOTTOM with max-width */}
            <div className="border-t bg-background/95 backdrop-blur">
              <div className="max-w-4xl mx-auto px-4 md:px-6 py-4">
                <ChatInput
                  onSend={handleSendMessage}
                  disabled={loadingMessages}
                  sendDisabled={streamingConversationId === currentConversation?.id}
                  placeholder={`Message ${currentAgent.name}...`}
                />
              </div>
            </div>

            {/* Long Response Progress Indicator */}
            {backgroundProgress && activeLongResponse && (
              <div className="fixed bottom-20 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 max-w-xs">
                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">
                    {backgroundProgress.status === 'generating' 
                      ? 'Generating long response...' 
                      : 'Response completed!'}
                  </div>
                  <div className="text-xs opacity-80">
                    {backgroundProgress.totalChars.toLocaleString()} characters
                    {backgroundProgress.status === 'generating' && ' (updating in real-time)'}
                  </div>
                </div>
              </div>
            )}

            {/* Browser Automation Local Execution Indicator */}
            {localExecutionStatus && (
              <div className="fixed bottom-20 right-4 bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 max-w-sm z-50">
                <Monitor className="h-4 w-4 flex-shrink-0" />
                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">
                    {localExecutionStatus.tool === 'browser_orchestrator' 
                      ? 'Executing Browser Automation...' 
                      : `Executing: ${localExecutionStatus.tool}`}
                  </div>
                  <div className="text-xs opacity-80">
                    {localExecutionStatus.stepInfo || localExecutionStatus.status}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="text-center">
              {isMobile && (
                <Button variant="outline" size="lg" className="mb-4" onClick={() => setDrawerOpen(true)}>
                  <Menu className="h-5 w-5 mr-2" />
                  Open Menu
                </Button>
              )}
              <h2 className="text-xl md:text-2xl font-semibold mb-2">Select an AI Consultant</h2>
              <p className="text-sm md:text-base text-muted-foreground">
                Choose an expert from the {isMobile ? "menu" : "sidebar"} to start chatting
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Agent Modal */}
      <CreateAgentModal 
        open={showCreateModal} 
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setEditingAgent(null);
        }}
        onSuccess={(agent) => {
          if (editingAgent) {
            // Agent updated, refresh current agent if it's the one being edited
            if (currentAgent?.id === agent.id) {
              setCurrentAgent({ ...agent });
            }
          } else {
            // New agent created, select it
            handleSelectAgent({ ...agent });
          }
          setEditingAgent(null);
        }}
        editingAgent={editingAgent ? {
          ...editingAgent,
          system_prompt: editingAgent.system_prompt || ""
        } : null}
        onDelete={handleDeleteAgent}
      />
      
      {/* Forward Message Dialog */}
      <ForwardMessageDialog
        open={showForwardDialog}
        onOpenChange={setShowForwardDialog}
        message={messages.find(m => m.id === selectedMessages[0]) || null}
        currentAgentId={currentAgent?.id || ""}
        onForwardComplete={handleForwardComplete}
      />

      {/* Delete All Messages Confirmation */}
      <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancellare tutti i messaggi?</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione eliminerà tutti i {messages.length} messaggi della chat corrente. 
              Questa operazione non può essere annullata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllMessages}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina tutti
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Tool Server Settings Dialog */}
      <Dialog open={showToolServerDialog} onOpenChange={setShowToolServerDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tool Server Configuration</DialogTitle>
          </DialogHeader>
          <ToolServerSettings />
        </DialogContent>
      </Dialog>
    </div>
  );
}
