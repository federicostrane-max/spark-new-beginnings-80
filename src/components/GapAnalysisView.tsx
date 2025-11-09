import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle, AlertTriangle, Lightbulb, TrendingDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface GapItem {
  item: string;
  description?: string;
  current_coverage: number;
  required_coverage: number;
  gap_percentage: number;
  suggestion: string;
}

interface GapAnalysis {
  id: string;
  agent_id: string;
  analysis_date: string;
  missing_core_concepts: GapItem[];
  missing_procedural_knowledge: GapItem[];
  missing_decision_patterns: GapItem[];
  missing_domain_vocabulary: GapItem[];
  overall_gap_score: number;
  recommendations: string[];
}

interface GapAnalysisViewProps {
  agentId: string;
  refreshTrigger?: number;
}

export default function GapAnalysisView({ agentId, refreshTrigger }: GapAnalysisViewProps) {
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllConcepts, setShowAllConcepts] = useState(false);
  const [showAllProcedural, setShowAllProcedural] = useState(false);
  const [showAllDecision, setShowAllDecision] = useState(false);
  const [showAllVocabulary, setShowAllVocabulary] = useState(false);

  useEffect(() => {
    fetchGapAnalysis();
  }, [agentId, refreshTrigger]);

  const fetchGapAnalysis = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('knowledge_gap_analysis')
        .select('*')
        .eq('agent_id', agentId)
        .order('analysis_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        // Type cast the JSONB fields to proper types
        setGapAnalysis({
          ...data,
          missing_core_concepts: (data.missing_core_concepts as unknown as GapItem[]) || [],
          missing_procedural_knowledge: (data.missing_procedural_knowledge as unknown as GapItem[]) || [],
          missing_decision_patterns: (data.missing_decision_patterns as unknown as GapItem[]) || [],
          missing_domain_vocabulary: (data.missing_domain_vocabulary as unknown as GapItem[]) || [],
          recommendations: (data.recommendations as unknown as string[]) || [],
        } as GapAnalysis);
      }
    } catch (error) {
      console.error('Error fetching gap analysis:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getGapIcon = (gapPercentage: number) => {
    if (gapPercentage >= 70) return <AlertCircle className="h-4 w-4 text-destructive" />;
    if (gapPercentage >= 40) return <AlertTriangle className="h-4 w-4 text-warning" />;
    return <TrendingDown className="h-4 w-4 text-muted-foreground" />;
  };

  const getGapBadge = (gapPercentage: number) => {
    if (gapPercentage >= 70) return <Badge variant="destructive">Critico</Badge>;
    if (gapPercentage >= 40) return <Badge variant="outline" className="border-warning text-warning">Moderato</Badge>;
    return <Badge variant="secondary">Minore</Badge>;
  };

  const renderGapItems = (items: GapItem[], emptyMessage: string, showAll: boolean, setShowAll: (value: boolean) => void) => {
    if (!items || items.length === 0) {
      return (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{emptyMessage}</AlertDescription>
        </Alert>
      );
    }

    // Sort by gap_percentage descending (most critical first)
    const sortedItems = [...items].sort((a, b) => b.gap_percentage - a.gap_percentage);
    const criticalThreshold = 10;
    const displayItems = showAll ? sortedItems : sortedItems.slice(0, criticalThreshold);
    const hasMore = sortedItems.length > criticalThreshold;

    return (
      <div className="space-y-4">
        {displayItems.map((gap, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-start gap-3">
              {getGapIcon(gap.gap_percentage)}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-medium">{gap.item}</h4>
                  <div className="flex gap-2">
                    {gap.current_coverage === 0 && (
                      <Badge variant="destructive">Non presente nel KB</Badge>
                    )}
                    {getGapBadge(gap.gap_percentage)}
                  </div>
                </div>
                
                {gap.description && (
                  <p className="text-sm text-muted-foreground">{gap.description}</p>
                )}
                
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {gap.current_coverage === 0 
                        ? "Nessun chunk trovato" 
                        : `Copertura: ${Math.round(gap.current_coverage * 100)}% (minimo richiesto: ${Math.round(gap.required_coverage * 100)}%)`
                      }
                    </span>
                  </div>
                  <Progress value={gap.current_coverage * 100} className="h-2" />
                </div>

                <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-md">
                  <Lightbulb className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm whitespace-pre-wrap break-words">{gap.suggestion}</p>
                </div>
              </div>
            </div>
          </Card>
        ))}
        
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button 
              variant="outline" 
              onClick={() => setShowAll(!showAll)}
              className="w-full md:w-auto"
            >
              {showAll 
                ? `Mostra solo gap critici (top ${criticalThreshold})` 
                : `Mostra tutti i ${sortedItems.length} gap`
              }
            </Button>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Caricamento analisi gap...</p>
        </div>
      </div>
    );
  }

  if (!gapAnalysis) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Nessuna analisi dei gap disponibile. Esegui prima un'analisi di allineamento.
        </AlertDescription>
      </Alert>
    );
  }

  const totalGaps = 
    gapAnalysis.missing_core_concepts.length +
    gapAnalysis.missing_procedural_knowledge.length +
    gapAnalysis.missing_decision_patterns.length +
    gapAnalysis.missing_domain_vocabulary.length;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Panoramica Gap</h3>
            <Badge variant={totalGaps > 10 ? "destructive" : totalGaps > 5 ? "outline" : "secondary"}>
              {totalGaps} gap totali
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Core Concepts</p>
              <p className="text-2xl font-bold">{gapAnalysis.missing_core_concepts.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Procedure</p>
              <p className="text-2xl font-bold">{gapAnalysis.missing_procedural_knowledge.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Decision Patterns</p>
              <p className="text-2xl font-bold">{gapAnalysis.missing_decision_patterns.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Vocabolario</p>
              <p className="text-2xl font-bold">{gapAnalysis.missing_domain_vocabulary.length}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Gap Score Complessivo</span>
              <span className="font-medium">{Math.round(gapAnalysis.overall_gap_score * 100)}%</span>
            </div>
            <Progress value={gapAnalysis.overall_gap_score * 100} className="h-2" />
          </div>
        </div>
      </Card>

      {/* Recommendations */}
      {gapAnalysis.recommendations && gapAnalysis.recommendations.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Raccomandazioni AI</h3>
          <ul className="space-y-2">
            {gapAnalysis.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span className="text-sm">{rec}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Gap Details by Category */}
      <Tabs defaultValue="core_concepts" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="core_concepts" className="text-xs md:text-sm">
            Core Concepts
            {gapAnalysis.missing_core_concepts.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                {gapAnalysis.missing_core_concepts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="procedural" className="text-xs md:text-sm">
            Procedure
            {gapAnalysis.missing_procedural_knowledge.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                {gapAnalysis.missing_procedural_knowledge.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="decision" className="text-xs md:text-sm">
            Decisioni
            {gapAnalysis.missing_decision_patterns.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                {gapAnalysis.missing_decision_patterns.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="vocabulary" className="text-xs md:text-sm">
            Vocabolario
            {gapAnalysis.missing_domain_vocabulary.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                {gapAnalysis.missing_domain_vocabulary.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="core_concepts" className="mt-6">
          {renderGapItems(
            gapAnalysis.missing_core_concepts,
            "Tutti i core concepts sono ben coperti dal knowledge base!",
            showAllConcepts,
            setShowAllConcepts
          )}
        </TabsContent>

        <TabsContent value="procedural" className="mt-6">
          {renderGapItems(
            gapAnalysis.missing_procedural_knowledge,
            "Tutte le procedure sono ben documentate nel knowledge base!",
            showAllProcedural,
            setShowAllProcedural
          )}
        </TabsContent>

        <TabsContent value="decision" className="mt-6">
          {renderGapItems(
            gapAnalysis.missing_decision_patterns,
            "Tutti i decision patterns sono presenti nel knowledge base!",
            showAllDecision,
            setShowAllDecision
          )}
        </TabsContent>

        <TabsContent value="vocabulary" className="mt-6">
          {renderGapItems(
            gapAnalysis.missing_domain_vocabulary,
            "Tutto il vocabolario di dominio è coperto nel knowledge base!",
            showAllVocabulary,
            setShowAllVocabulary
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
