import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Database, CheckCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProcessingLogs } from "./ProcessingLogs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OperationsDashboard } from "./OperationsDashboard";
import { FilterPromptEditor } from "./FilterPromptEditor";
import { AlignmentPromptEditor } from "./AlignmentPromptEditor";
import AlignmentMetricsMonitor from "./AlignmentMetricsMonitor";
import { AirtopBrowserAutomation } from "./AirtopBrowserAutomation";

interface ProcessingResult {
  id: string;
  file_name: string;
  status: string;
  text_length?: number;
  error?: string;
}

interface BatchSummary {
  processed: number;
  successful: number;
  errors: number;
  totalStuck: number;
  remainingStuck: number;
}

export const AdminPanel = () => {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult[] | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  // Legacy functions removed - now using Pipeline A/B/C only

  return (
    <Tabs defaultValue="metrics" className="w-full max-w-4xl mx-auto mt-8">
      <TabsList className="grid w-full grid-cols-8">
        <TabsTrigger value="metrics">Metriche</TabsTrigger>
        <TabsTrigger value="tools">Strumenti</TabsTrigger>
        <TabsTrigger value="logs">Log Processing</TabsTrigger>
        <TabsTrigger value="operations">Operazioni</TabsTrigger>
        <TabsTrigger value="filter-prompt">Filter Prompt</TabsTrigger>
        <TabsTrigger value="alignment-prompt">Alignment Prompt</TabsTrigger>
        <TabsTrigger value="airtop">Airtop.ai</TabsTrigger>
      </TabsList>

      <TabsContent value="metrics">
        <AlignmentMetricsMonitor />
      </TabsContent>

      <TabsContent value="tools">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Admin Panel - Manutenzione Database
            </CardTitle>
            <CardDescription>
              Strumenti per riparare e sincronizzare documenti
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center py-8 text-muted-foreground">
              <p>Pipeline legacy rimossa. Usa le Pipeline A, B, C per la gestione dei documenti.</p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="logs">
        <ProcessingLogs />
      </TabsContent>

      <TabsContent value="operations">
        <OperationsDashboard />
      </TabsContent>

      <TabsContent value="filter-prompt">
        <FilterPromptEditor />
      </TabsContent>

      <TabsContent value="alignment-prompt">
        <AlignmentPromptEditor />
      </TabsContent>

      <TabsContent value="airtop">
        <AirtopBrowserAutomation />
      </TabsContent>
    </Tabs>
  );
};
