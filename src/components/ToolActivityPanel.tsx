import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Minimize2,
  Maximize2,
  X,
  CheckCircle2,
  Circle,
  XCircle,
  Wrench,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolActivity {
  id: string;
  timestamp: Date;
  type: 'navigate' | 'click' | 'type' | 'snapshot' | 'screenshot' | 'scroll' | 'wait' | 'error' | 'info';
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  message: string;
  details?: string;
  screenshot?: string; // base64
}

interface ToolActivityPanelProps {
  activities: ToolActivity[];
  isVisible: boolean;
  onClose: () => void;
  onClear: () => void;
  className?: string;
}

export function ToolActivityPanel({
  activities,
  isVisible,
  onClose,
  onClear,
  className
}: ToolActivityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (scrollRef.current && isExpanded && !isMinimized) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities, isExpanded, isMinimized]);

  // Auto-expand when activities start, auto-minimize after 5s of no activity
  useEffect(() => {
    if (activities.length > 0) {
      const lastActivity = activities[activities.length - 1];

      // Auto-expand if there's activity in progress
      if (lastActivity.status === 'in_progress' || lastActivity.status === 'pending') {
        setIsMinimized(false);
        setIsExpanded(true);
      }

      // Clear previous timeout
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current);
      }

      // Set auto-minimize timeout (5 seconds after last completed activity)
      if (lastActivity.status === 'completed' || lastActivity.status === 'error') {
        autoHideTimeoutRef.current = setTimeout(() => {
          setIsMinimized(true);
        }, 5000);
      }
    }

    return () => {
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current);
      }
    };
  }, [activities]);

  if (!isVisible || activities.length === 0) {
    return null;
  }

  const getStatusIcon = (status: ToolActivity['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case 'in_progress':
        return <Circle className="h-3.5 w-3.5 text-blue-500 animate-pulse" />;
      case 'pending':
        return <Circle className="h-3.5 w-3.5 text-gray-400" />;
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    }
  };

  const getTypeIcon = (type: ToolActivity['type']) => {
    switch (type) {
      case 'navigate':
        return <ExternalLink className="h-3 w-3" />;
      case 'screenshot':
        return <ImageIcon className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getTypeColor = (type: ToolActivity['type']) => {
    switch (type) {
      case 'navigate':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
      case 'click':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'type':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'snapshot':
        return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20';
      case 'screenshot':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'scroll':
        return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
      case 'wait':
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
      case 'error':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'info':
        return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
    }
  };

  const activeCount = activities.filter(a => a.status === 'in_progress').length;
  const completedCount = activities.filter(a => a.status === 'completed').length;
  const errorCount = activities.filter(a => a.status === 'error').length;

  // Minimized badge view
  if (isMinimized) {
    return (
      <div
        className={cn(
          "fixed bottom-20 right-4 z-50 cursor-pointer",
          "transition-all duration-200 hover:scale-105",
          className
        )}
        onClick={() => setIsMinimized(false)}
      >
        <Badge
          variant="outline"
          className={cn(
            "px-3 py-2 flex items-center gap-2 shadow-lg",
            "bg-background/95 backdrop-blur-sm border",
            activeCount > 0 ? "border-blue-500 animate-pulse" : "border-border"
          )}
        >
          <Wrench className="h-4 w-4" />
          <span className="font-medium">{activities.length}</span>
          {activeCount > 0 && (
            <span className="text-blue-500 text-xs">({activeCount} active)</span>
          )}
          {errorCount > 0 && (
            <span className="text-red-500 text-xs">({errorCount} errors)</span>
          )}
        </Badge>
      </div>
    );
  }

  return (
    <>
      {/* Screenshot Preview Modal */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedScreenshot(null)}
        >
          <img
            src={`data:image/png;base64,${selectedScreenshot}`}
            alt="Screenshot"
            className="max-w-full max-h-full rounded-lg shadow-2xl"
          />
        </div>
      )}

      {/* Main Panel */}
      <div
        className={cn(
          "fixed bottom-20 right-4 z-50",
          "bg-background/95 backdrop-blur-sm rounded-lg shadow-xl border",
          "transition-all duration-200",
          isExpanded ? "w-80" : "w-64",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Tool Activity</span>
            {activeCount > 0 && (
              <Badge variant="secondary" className="h-5 text-xs animate-pulse">
                {activeCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMinimized(true)}
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Activity List */}
        {isExpanded && (
          <ScrollArea
            className="h-48 px-2 py-2"
            ref={scrollRef as any}
          >
            <div className="space-y-1.5">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md text-xs",
                    "bg-muted/30 hover:bg-muted/50 transition-colors"
                  )}
                >
                  {getStatusIcon(activity.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge
                        variant="outline"
                        className={cn("h-4 text-[10px] px-1.5", getTypeColor(activity.type))}
                      >
                        {getTypeIcon(activity.type)}
                        <span className="ml-1">{activity.type}</span>
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {activity.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </span>
                    </div>
                    <p className="text-foreground truncate" title={activity.message}>
                      {activity.message}
                    </p>
                    {activity.details && (
                      <p className="text-muted-foreground truncate text-[10px]" title={activity.details}>
                        {activity.details}
                      </p>
                    )}
                    {activity.screenshot && (
                      <div
                        className="mt-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setSelectedScreenshot(activity.screenshot!)}
                      >
                        <img
                          src={`data:image/png;base64,${activity.screenshot}`}
                          alt="Screenshot preview"
                          className="w-full h-16 object-cover rounded border"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Footer */}
        {isExpanded && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/30 rounded-b-lg">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {completedCount}
              </span>
              {errorCount > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-500" />
                  {errorCount}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={onClear}
            >
              Clear
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// Helper function to parse Clawdbot messages into ToolActivity
export function parseClawdbotMessage(content: string): ToolActivity | null {
  const timestamp = new Date();
  const id = `activity-${timestamp.getTime()}-${Math.random().toString(36).substr(2, 9)}`;

  // Pattern: [Clawdbot] Action message...
  // Pattern: [Clawdbot OK] Success message...
  const clawdbotMatch = content.match(/^\[Clawdbot(?:\s+OK)?\]\s*(.+)$/i);
  if (!clawdbotMatch) return null;

  const message = clawdbotMatch[1].trim();
  const isOk = content.includes('[Clawdbot OK]');

  // Determine type and status based on message content
  let type: ToolActivity['type'] = 'info';
  let status: ToolActivity['status'] = isOk ? 'completed' : 'in_progress';

  if (message.toLowerCase().includes('navigat')) {
    type = 'navigate';
  } else if (message.toLowerCase().includes('click')) {
    type = 'click';
  } else if (message.toLowerCase().includes('type') || message.toLowerCase().includes('typing')) {
    type = 'type';
  } else if (message.toLowerCase().includes('snapshot') || message.toLowerCase().includes('dom')) {
    type = 'snapshot';
  } else if (message.toLowerCase().includes('screenshot')) {
    type = 'screenshot';
  } else if (message.toLowerCase().includes('scroll')) {
    type = 'scroll';
  } else if (message.toLowerCase().includes('wait')) {
    type = 'wait';
  } else if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
    type = 'error';
    status = 'error';
  }

  // Extract URL or details from message
  let details: string | undefined;
  const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    details = urlMatch[1];
  }

  return {
    id,
    timestamp,
    type,
    status,
    message: message.replace(urlMatch?.[0] || '', '').trim() || message,
    details
  };
}

// Helper to check if a message is a Clawdbot message
export function isClawdbotMessage(content: string): boolean {
  return /^\[Clawdbot/i.test(content.trim());
}
