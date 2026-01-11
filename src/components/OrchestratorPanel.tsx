// ============================================================
// OrchestratorPanel - UI for Multi-Agent Orchestrator
// ============================================================

import React, { useState } from 'react';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, 
  Square, 
  RotateCcw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Loader2,
  Bot,
  Eye,
  Target
} from 'lucide-react';

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  idle: { color: 'bg-muted', icon: <Clock className="h-4 w-4" />, label: 'Pronto' },
  initializing: { color: 'bg-blue-500', icon: <Loader2 className="h-4 w-4 animate-spin" />, label: 'Inizializzazione' },
  planning: { color: 'bg-purple-500', icon: <Bot className="h-4 w-4 animate-pulse" />, label: 'Pianificazione' },
  executing: { color: 'bg-yellow-500', icon: <Target className="h-4 w-4 animate-pulse" />, label: 'Esecuzione' },
  completed: { color: 'bg-green-500', icon: <CheckCircle className="h-4 w-4" />, label: 'Completato' },
  failed: { color: 'bg-red-500', icon: <XCircle className="h-4 w-4" />, label: 'Fallito' },
  aborted: { color: 'bg-orange-500', icon: <Square className="h-4 w-4" />, label: 'Interrotto' },
  loop_detected: { color: 'bg-red-600', icon: <AlertTriangle className="h-4 w-4" />, label: 'Loop Rilevato' },
};

const logLevelColors: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-gray-400',
  success: 'text-green-400',
};

export function OrchestratorPanel() {
  const [task, setTask] = useState('');
  const [startUrl, setStartUrl] = useState('https://google.com');
  
  const {
    state,
    logs,
    isRunning,
    executeTask,
    abort,
    reset,
    progress,
    currentStep,
    completedSteps,
    totalSteps,
  } = useOrchestrator();

  const handleStart = () => {
    if (task.trim()) {
      executeTask(task, startUrl || undefined);
    }
  };

  const statusInfo = statusConfig[state.status] || statusConfig.idle;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto">
      {/* Header */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Multi-Agent Orchestrator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Badge variant="outline" className={`${statusInfo.color} text-white`}>
              <span className="flex items-center gap-1">
                {statusInfo.icon}
                {statusInfo.label}
              </span>
            </Badge>
          </div>

          {/* Input Fields */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">URL di partenza</label>
              <Input
                placeholder="https://example.com"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Task da eseguire</label>
              <Textarea
                placeholder="Descrivi cosa vuoi che l'orchestrator faccia..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={isRunning}
                rows={3}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button 
              onClick={handleStart} 
              disabled={isRunning || !task.trim()}
              className="flex-1"
            >
              <Play className="h-4 w-4 mr-2" />
              Avvia
            </Button>
            <Button 
              onClick={abort} 
              disabled={!isRunning}
              variant="destructive"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
            <Button 
              onClick={reset}
              variant="outline"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress and Plan */}
      {state.plan && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Piano di Esecuzione
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso</span>
                <span>{completedSteps}/{totalSteps} step</span>
              </div>
              <Progress value={progress} />
            </div>

            {/* Goal */}
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">Obiettivo:</p>
              <p className="text-sm text-muted-foreground">{state.plan.goal}</p>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {state.plan.steps.map((step, index) => {
                const executed = state.executed_steps[index];
                const isCurrent = index === state.current_step_index;
                const isCompleted = executed?.success;
                const isFailed = executed && !executed.success;

                return (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border ${
                      isCurrent 
                        ? 'border-primary bg-primary/10' 
                        : isCompleted 
                          ? 'border-green-500/50 bg-green-500/10'
                          : isFailed
                            ? 'border-red-500/50 bg-red-500/10'
                            : 'border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">
                        {isCompleted ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : isFailed ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : isCurrent ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          step.step_number
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">
                            {step.action_type}
                          </Badge>
                          {executed?.used_fallback && (
                            <Badge variant="outline" className="text-xs text-yellow-500">
                              Fallback
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {step.target_description}
                        </p>
                        {executed && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {executed.duration_ms}ms
                            {executed.retries > 0 && ` • ${executed.retries} retry`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Log di Esecuzione</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64 rounded-md border bg-black/90 p-3">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                I log appariranno qui durante l'esecuzione
              </p>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, index) => (
                  <div key={index} className="flex gap-2">
                    <span className="text-gray-500 flex-shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`${logLevelColors[log.level]} flex-shrink-0 uppercase w-12`}>
                      [{log.level}]
                    </span>
                    <span className="text-gray-200">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Error Display */}
      {state.error && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-500">Errore</p>
                <p className="text-sm text-muted-foreground">{state.error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
