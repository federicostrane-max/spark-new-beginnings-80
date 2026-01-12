// ============================================================
// BROWSER TOOLS TEST PAGE
// Dedicated page for testing the 4 browser automation tools
// ============================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  toolServerClient, 
  sessionManager, 
  Orchestrator,
  Plan 
} from "@/lib/tool-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  Camera, 
  Eye, 
  Sparkles, 
  Bot, 
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Play,
  Square,
  Globe,
  MousePointer,
  Type,
  ArrowDown
} from "lucide-react";

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

export default function BrowserToolsTest() {
  const navigate = useNavigate();
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Screenshot state
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  
  // Vision state
  const [luxTarget, setLuxTarget] = useState("");
  const [luxLoading, setLuxLoading] = useState(false);
  const [luxResult, setLuxResult] = useState<{x?: number; y?: number; confidence?: number; error?: string} | null>(null);
  
  const [geminiTarget, setGeminiTarget] = useState("");
  const [geminiContext, setGeminiContext] = useState("");
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiResult, setGeminiResult] = useState<{x?: number; y?: number; confidence?: number; reasoning?: string; error?: string} | null>(null);
  
  // Orchestrator state
  const [orchestratorTask, setOrchestratorTask] = useState("");
  const [orchestratorUrl, setOrchestratorUrl] = useState("https://www.google.com");
  const [orchestratorLoading, setOrchestratorLoading] = useState(false);
  const [orchestratorLogs, setOrchestratorLogs] = useState<LogEntry[]>([]);
  
  // Action state
  const [clickX, setClickX] = useState("");
  const [clickY, setClickY] = useState("");
  const [typeText, setTypeText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  
  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, { timestamp: new Date(), level, message }]);
  };

  // Check connection on mount
  useEffect(() => {
    checkConnection();
    const storedSession = sessionManager.sessionId;
    if (storedSession) {
      setSessionId(storedSession);
    }
  }, []);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const healthy = await toolServerClient.checkHealth();
      setIsConnected(healthy);
      addLog(healthy ? 'success' : 'error', 
        healthy ? 'ToolServer connected at 127.0.0.1:8766' : 'ToolServer not reachable');
    } catch (error) {
      setIsConnected(false);
      addLog('error', `Connection failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setIsChecking(false);
    }
  };

  // Browser session management
  const startBrowser = async () => {
    try {
      addLog('info', 'Starting browser session...');
      const result = await toolServerClient.browserStart(orchestratorUrl || 'about:blank');
      if (result.success && result.session_id) {
        setSessionId(result.session_id);
        sessionManager.captureFromToolResult({ session_id: result.session_id });
        addLog('success', `Browser started: ${result.session_id.slice(0, 8)}...`);
        toast.success('Browser started');
      } else {
        addLog('error', 'Failed to start browser');
      }
    } catch (error) {
      addLog('error', `Browser start error: ${error instanceof Error ? error.message : 'Unknown'}`);
      toast.error('Failed to start browser');
    }
  };

  const stopBrowser = async () => {
    if (!sessionId) return;
    try {
      addLog('info', 'Stopping browser...');
      await toolServerClient.browserStop(sessionId);
      setSessionId(null);
      addLog('success', 'Browser stopped');
      toast.success('Browser stopped');
    } catch (error) {
      addLog('error', `Browser stop error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  };

  // Screenshot
  const captureScreenshot = async () => {
    if (!sessionId) {
      toast.error('Start a browser session first');
      return;
    }
    
    setScreenshotLoading(true);
    try {
      addLog('info', 'Capturing screenshot...');
      const result = await toolServerClient.screenshot({
        scope: 'browser',
        session_id: sessionId,
        optimize_for: 'lux',
      });
      
      if (result.success && result.original) {
        const base64 = result.original.image_base64;
        setScreenshotBase64(base64);
        setScreenshotPreview(`data:image/png;base64,${base64}`);
        addLog('success', `Screenshot captured: ${result.original.width}x${result.original.height}`);
        toast.success('Screenshot captured');
      } else {
        addLog('error', 'Screenshot failed');
        toast.error('Screenshot failed');
      }
    } catch (error) {
      addLog('error', `Screenshot error: ${error instanceof Error ? error.message : 'Unknown'}`);
      toast.error('Screenshot failed');
    } finally {
      setScreenshotLoading(false);
    }
  };

  // Lux Vision
  const testLuxVision = async () => {
    if (!screenshotBase64) {
      toast.error('Capture a screenshot first');
      return;
    }
    if (!luxTarget.trim()) {
      toast.error('Enter a target description');
      return;
    }
    
    setLuxLoading(true);
    setLuxResult(null);
    try {
      addLog('info', `Lux Vision: finding "${luxTarget}"...`);
      
      const { data, error } = await supabase.functions.invoke('tool-server-vision', {
        body: {
          provider: 'lux',
          image: screenshotBase64,
          task: `Find and locate: ${luxTarget}`,
        },
      });
      
      if (error) throw error;
      
      setLuxResult({
        x: data.x,
        y: data.y,
        confidence: data.confidence,
      });
      
      addLog(data.success ? 'success' : 'warn', 
        data.success 
          ? `Lux found target at (${data.x}, ${data.y}) with ${Math.round((data.confidence || 0) * 100)}% confidence`
          : 'Lux did not find target'
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setLuxResult({ error: msg });
      addLog('error', `Lux Vision error: ${msg}`);
    } finally {
      setLuxLoading(false);
    }
  };

  // Gemini Vision
  const testGeminiVision = async () => {
    if (!screenshotBase64) {
      toast.error('Capture a screenshot first');
      return;
    }
    if (!geminiTarget.trim()) {
      toast.error('Enter a target description');
      return;
    }
    
    setGeminiLoading(true);
    setGeminiResult(null);
    try {
      addLog('info', `Gemini Vision: finding "${geminiTarget}"...`);
      
      const prompt = `Trova l'elemento "${geminiTarget}" nello screenshot.
${geminiContext ? `Contesto: ${geminiContext}` : ''}
Rispondi SOLO con JSON: {"x": numero, "y": numero, "confidence": 0.0-1.0, "reasoning": "..."}`;
      
      const { data, error } = await supabase.functions.invoke('tool-server-vision', {
        body: {
          provider: 'gemini',
          image: screenshotBase64,
          prompt,
        },
      });
      
      if (error) throw error;
      
      setGeminiResult({
        x: data.x,
        y: data.y,
        confidence: data.confidence,
        reasoning: data.reasoning,
      });
      
      addLog(data.success ? 'success' : 'warn', 
        data.success 
          ? `Gemini found target at (${data.x}, ${data.y}) - ${data.reasoning?.slice(0, 50)}...`
          : 'Gemini did not find target'
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setGeminiResult({ error: msg });
      addLog('error', `Gemini Vision error: ${msg}`);
    } finally {
      setGeminiLoading(false);
    }
  };

  // Actions
  const executeClick = async () => {
    if (!sessionId) {
      toast.error('Start a browser session first');
      return;
    }
    const x = parseInt(clickX);
    const y = parseInt(clickY);
    if (isNaN(x) || isNaN(y)) {
      toast.error('Enter valid coordinates');
      return;
    }
    
    setActionLoading(true);
    try {
      addLog('info', `Clicking at (${x}, ${y})...`);
      const result = await toolServerClient.click({
        scope: 'browser',
        session_id: sessionId,
        x, y,
        coordinate_origin: 'viewport',
      });
      addLog(result.success ? 'success' : 'error', 
        result.success ? 'Click executed' : `Click failed: ${result.error}`);
      if (result.success) toast.success('Click executed');
    } catch (error) {
      addLog('error', `Click error: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const executeType = async () => {
    if (!sessionId) {
      toast.error('Start a browser session first');
      return;
    }
    if (!typeText.trim()) {
      toast.error('Enter text to type');
      return;
    }
    
    setActionLoading(true);
    try {
      addLog('info', `Typing "${typeText.slice(0, 20)}${typeText.length > 20 ? '...' : ''}"...`);
      const result = await toolServerClient.type({
        scope: 'browser',
        session_id: sessionId,
        text: typeText,
      });
      addLog(result.success ? 'success' : 'error', 
        result.success ? 'Text typed' : `Type failed: ${result.error}`);
      if (result.success) toast.success('Text typed');
    } catch (error) {
      addLog('error', `Type error: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const executeScroll = async (direction: 'up' | 'down') => {
    if (!sessionId) {
      toast.error('Start a browser session first');
      return;
    }
    
    setActionLoading(true);
    try {
      addLog('info', `Scrolling ${direction}...`);
      const result = await toolServerClient.scroll({
        scope: 'browser',
        session_id: sessionId,
        direction,
        amount: 300,
      });
      addLog(result.success ? 'success' : 'error', 
        result.success ? `Scrolled ${direction}` : `Scroll failed: ${result.error}`);
    } catch (error) {
      addLog('error', `Scroll error: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Orchestrator
  const runOrchestrator = async () => {
    if (!orchestratorTask.trim()) {
      toast.error('Enter a task description');
      return;
    }
    
    setOrchestratorLoading(true);
    setOrchestratorLogs([]);
    
    const addOrchestratorLog = (level: LogEntry['level'], message: string) => {
      setOrchestratorLogs(prev => [...prev, { timestamp: new Date(), level, message }]);
    };
    
    try {
      addLog('info', `Starting orchestrator: "${orchestratorTask}"`);
      addOrchestratorLog('info', 'Initializing orchestrator...');
      
      const orchestrator = new Orchestrator({}, {
        onStateChange: (state) => {
          addOrchestratorLog('info', `Status: ${state.status}`);
        },
        onPlanCreated: (plan) => {
          addOrchestratorLog('success', `Plan created: ${plan.steps.length} steps`);
          plan.steps.forEach((step, i) => {
            addOrchestratorLog('info', `  ${i + 1}. ${step.action_type}: ${step.target_description}`);
          });
        },
        onStepStart: (step, index) => {
          addOrchestratorLog('info', `Executing step ${index + 1}: ${step.action_type}`);
        },
        onStepComplete: (execution, index) => {
          addOrchestratorLog(
            execution.success ? 'success' : 'error',
            `Step ${index + 1} ${execution.success ? 'completed' : 'failed'}`
          );
        },
        onLog: (entry) => {
          addOrchestratorLog(entry.level as LogEntry['level'], entry.message);
        },
      });
      
      const result = await orchestrator.executeTask(orchestratorTask, orchestratorUrl);
      
      addLog(result.status === 'completed' ? 'success' : 'error', 
        `Orchestrator ${result.status}: ${result.error || 'Task completed'}`);
      
      // Update session ID if browser was started
      if (result.session_id) {
        setSessionId(result.session_id);
      }
      
    } catch (error) {
      addLog('error', `Orchestrator error: ${error instanceof Error ? error.message : 'Unknown'}`);
      addOrchestratorLog('error', `Fatal error: ${error instanceof Error ? error.message : 'Unknown'}`);
    } finally {
      setOrchestratorLoading(false);
    }
  };

  const getLogIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'success': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'error': return <XCircle className="h-3 w-3 text-red-500" />;
      case 'warn': return <XCircle className="h-3 w-3 text-yellow-500" />;
      default: return <div className="h-3 w-3 rounded-full bg-blue-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">🧪 Browser Automation Tools Test</h1>
              <p className="text-sm text-muted-foreground">Debug & test the 4 browser automation tools</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "default" : "destructive"}>
                {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
              </Badge>
              <Button variant="outline" size="sm" onClick={checkConnection} disabled={isChecking}>
                {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            
            {sessionId ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline">Session: {sessionId.slice(0, 8)}...</Badge>
                <Button variant="destructive" size="sm" onClick={stopBrowser}>
                  <Square className="h-4 w-4 mr-1" /> Stop
                </Button>
              </div>
            ) : (
              <Button onClick={startBrowser} disabled={!isConnected}>
                <Play className="h-4 w-4 mr-1" /> Start Browser
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Tools */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="screenshot" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="screenshot"><Camera className="h-4 w-4 mr-1" /> Screenshot</TabsTrigger>
                <TabsTrigger value="lux"><Eye className="h-4 w-4 mr-1" /> Lux Vision</TabsTrigger>
                <TabsTrigger value="gemini"><Sparkles className="h-4 w-4 mr-1" /> Gemini</TabsTrigger>
                <TabsTrigger value="orchestrator"><Bot className="h-4 w-4 mr-1" /> Orchestrator</TabsTrigger>
              </TabsList>
              
              {/* Screenshot Tab */}
              <TabsContent value="screenshot">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Camera className="h-5 w-5" /> Screenshot Tool
                    </CardTitle>
                    <CardDescription>Capture browser screenshots for vision tools</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button onClick={captureScreenshot} disabled={screenshotLoading || !sessionId}>
                      {screenshotLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                      Capture Screenshot
                    </Button>
                    
                    {screenshotPreview && (
                      <div className="border rounded-lg overflow-hidden">
                        <img src={screenshotPreview} alt="Screenshot" className="max-w-full h-auto" />
                      </div>
                    )}
                    
                    {screenshotBase64 && (
                      <div className="text-xs text-muted-foreground">
                        Base64 length: {screenshotBase64.length.toLocaleString()} chars
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Lux Vision Tab */}
              <TabsContent value="lux">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Eye className="h-5 w-5" /> Lux Actor Vision
                    </CardTitle>
                    <CardDescription>Fast element detection (~1s) - returns lux_sdk coordinates</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Target Description</label>
                      <Input 
                        placeholder="e.g., the blue 'Submit' button"
                        value={luxTarget}
                        onChange={(e) => setLuxTarget(e.target.value)}
                      />
                    </div>
                    
                    <Button onClick={testLuxVision} disabled={luxLoading || !screenshotBase64}>
                      {luxLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                      Find Element
                    </Button>
                    
                    {luxResult && (
                      <div className={`p-4 rounded-lg ${luxResult.error ? 'bg-red-50' : 'bg-green-50'}`}>
                        {luxResult.error ? (
                          <p className="text-red-700">{luxResult.error}</p>
                        ) : (
                          <div className="space-y-1">
                            <p><strong>X:</strong> {luxResult.x}</p>
                            <p><strong>Y:</strong> {luxResult.y}</p>
                            <p><strong>Confidence:</strong> {Math.round((luxResult.confidence || 0) * 100)}%</p>
                            <p className="text-xs text-muted-foreground">Coordinate system: lux_sdk</p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Gemini Vision Tab */}
              <TabsContent value="gemini">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5" /> Gemini Computer Use
                    </CardTitle>
                    <CardDescription>Detailed element detection (~3s) - returns viewport coordinates</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Target Description</label>
                      <Input 
                        placeholder="e.g., the search input field"
                        value={geminiTarget}
                        onChange={(e) => setGeminiTarget(e.target.value)}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Context (optional)</label>
                      <Input 
                        placeholder="e.g., it's in the header navigation"
                        value={geminiContext}
                        onChange={(e) => setGeminiContext(e.target.value)}
                      />
                    </div>
                    
                    <Button onClick={testGeminiVision} disabled={geminiLoading || !screenshotBase64}>
                      {geminiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Find Element
                    </Button>
                    
                    {geminiResult && (
                      <div className={`p-4 rounded-lg ${geminiResult.error ? 'bg-red-50' : 'bg-green-50'}`}>
                        {geminiResult.error ? (
                          <p className="text-red-700">{geminiResult.error}</p>
                        ) : (
                          <div className="space-y-1">
                            <p><strong>X:</strong> {geminiResult.x}</p>
                            <p><strong>Y:</strong> {geminiResult.y}</p>
                            <p><strong>Confidence:</strong> {Math.round((geminiResult.confidence || 0) * 100)}%</p>
                            <p><strong>Reasoning:</strong> {geminiResult.reasoning}</p>
                            <p className="text-xs text-muted-foreground">Coordinate system: viewport</p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Orchestrator Tab */}
              <TabsContent value="orchestrator">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5" /> Browser Orchestrator
                    </CardTitle>
                    <CardDescription>Execute multi-step browser automation tasks</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Start URL</label>
                      <Input 
                        placeholder="https://www.google.com"
                        value={orchestratorUrl}
                        onChange={(e) => setOrchestratorUrl(e.target.value)}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Task Description</label>
                      <Textarea 
                        placeholder="e.g., Search for 'OpenAI GPT-5' and click the first result"
                        value={orchestratorTask}
                        onChange={(e) => setOrchestratorTask(e.target.value)}
                        rows={3}
                      />
                    </div>
                    
                    <Button onClick={runOrchestrator} disabled={orchestratorLoading}>
                      {orchestratorLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                      Execute Task
                    </Button>
                    
                    {orchestratorLogs.length > 0 && (
                      <ScrollArea className="h-64 border rounded-lg p-2">
                        <div className="space-y-1">
                          {orchestratorLogs.map((log, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              {getLogIcon(log.level)}
                              <span className="text-muted-foreground">
                                {log.timestamp.toLocaleTimeString()}
                              </span>
                              <span className={
                                log.level === 'error' ? 'text-red-600' :
                                log.level === 'success' ? 'text-green-600' :
                                log.level === 'warn' ? 'text-yellow-600' :
                                ''
                              }>
                                {log.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            
            {/* Actions Card */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Execute browser actions directly</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Click */}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input 
                        placeholder="X"
                        type="number"
                        value={clickX}
                        onChange={(e) => setClickX(e.target.value)}
                        className="w-20"
                      />
                      <Input 
                        placeholder="Y"
                        type="number"
                        value={clickY}
                        onChange={(e) => setClickY(e.target.value)}
                        className="w-20"
                      />
                      <Button onClick={executeClick} disabled={actionLoading || !sessionId} size="sm">
                        <MousePointer className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Type */}
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Text to type"
                      value={typeText}
                      onChange={(e) => setTypeText(e.target.value)}
                    />
                    <Button onClick={executeType} disabled={actionLoading || !sessionId} size="sm">
                      <Type className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* Scroll */}
                  <div className="flex gap-2">
                    <Button onClick={() => executeScroll('up')} disabled={actionLoading || !sessionId} size="sm" variant="outline">
                      ↑ Up
                    </Button>
                    <Button onClick={() => executeScroll('down')} disabled={actionLoading || !sessionId} size="sm" variant="outline">
                      ↓ Down
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Right Column - Logs */}
          <div className="lg:col-span-1">
            <Card className="h-[600px]">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Logs
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
                    Clear
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {logs.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No logs yet
                      </p>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          {getLogIcon(log.level)}
                          <div>
                            <span className="text-muted-foreground">
                              {log.timestamp.toLocaleTimeString()}
                            </span>
                            <p className={
                              log.level === 'error' ? 'text-red-600' :
                              log.level === 'success' ? 'text-green-600' :
                              log.level === 'warn' ? 'text-yellow-600' :
                              ''
                            }>
                              {log.message}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
