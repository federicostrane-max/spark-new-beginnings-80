import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface AlignmentMetrics {
  scoringConsistency: { status: 'good' | 'warning' | 'error'; stdDev: number };
  cheGuevaraAlignment: { status: 'good' | 'warning' | 'error'; percentage: number };
  jsonValidationRate: { status: 'good' | 'warning' | 'error'; rate: number };
  reasoningQuality: { status: 'good' | 'warning' | 'error'; issues: number };
}

export default function AlignmentMetricsMonitor() {
  const [metrics, setMetrics] = useState<AlignmentMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  async function loadMetrics() {
    try {
      // Phase 3: Success Metrics Monitoring
      const { data: scores } = await supabase
        .from('knowledge_relevance_scores')
        .select('final_relevance_score, agent_id, analysis_reasoning')
        .order('analyzed_at', { ascending: false })
        .limit(100);

      if (!scores) return;

      // 1. Scoring Consistency: Standard deviation < 0.2
      const scoresByAgent: Record<string, number[]> = {};
      scores.forEach(s => {
        if (!scoresByAgent[s.agent_id]) scoresByAgent[s.agent_id] = [];
        scoresByAgent[s.agent_id].push(s.final_relevance_score);
      });
      
      const avgStdDev = Object.values(scoresByAgent)
        .map(agentScores => {
          const avg = agentScores.reduce((a, b) => a + b, 0) / agentScores.length;
          const variance = agentScores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / agentScores.length;
          return Math.sqrt(variance);
        })
        .reduce((a, b) => a + b, 0) / Object.keys(scoresByAgent).length;

      // 2. Che Guevara Alignment: Check narrative agent with biographical content
      const { data: narrativeScores } = await supabase
        .from('knowledge_relevance_scores')
        .select('final_relevance_score, agent_id')
        .gte('final_relevance_score', 0.85)
        .limit(50);
      
      const cheGuevaraPercentage = narrativeScores ? (narrativeScores.length / 50) * 100 : 0;

      // 3. JSON Validation: Check reasoning field completeness
      const validReasoningCount = scores.filter(s => 
        s.analysis_reasoning && 
        !s.analysis_reasoning.toLowerCase().includes('page numbers') &&
        !s.analysis_reasoning.toLowerCase().includes('formatting')
      ).length;
      const jsonValidationRate = (validReasoningCount / scores.length) * 100;

      // 4. Reasoning Quality: Check for formatting penalization
      const formattingIssues = scores.filter(s => 
        s.analysis_reasoning?.toLowerCase().includes('formatting') ||
        s.analysis_reasoning?.toLowerCase().includes('page numbers')
      ).length;

      setMetrics({
        scoringConsistency: {
          status: avgStdDev < 0.2 ? 'good' : avgStdDev < 0.3 ? 'warning' : 'error',
          stdDev: avgStdDev
        },
        cheGuevaraAlignment: {
          status: cheGuevaraPercentage >= 85 ? 'good' : cheGuevaraPercentage >= 70 ? 'warning' : 'error',
          percentage: cheGuevaraPercentage
        },
        jsonValidationRate: {
          status: jsonValidationRate >= 95 ? 'good' : jsonValidationRate >= 85 ? 'warning' : 'error',
          rate: jsonValidationRate
        },
        reasoningQuality: {
          status: formattingIssues === 0 ? 'good' : formattingIssues < 5 ? 'warning' : 'error',
          issues: formattingIssues
        }
      });
    } catch (error) {
      console.error('Failed to load alignment metrics:', error);
    } finally {
      setLoading(false);
    }
  }

  const StatusIcon = ({ status }: { status: 'good' | 'warning' | 'error' }) => {
    if (status === 'good') return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (status === 'warning') return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    return <XCircle className="h-5 w-5 text-red-500" />;
  };

  if (loading) return <Card><CardContent className="p-6">Loading metrics...</CardContent></Card>;
  if (!metrics) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>🎯 Alignment System Health (Phase 3)</CardTitle>
        <CardDescription>Real-time monitoring of prompt v4 performance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Metric 1: Scoring Consistency */}
          <Alert>
            <StatusIcon status={metrics.scoringConsistency.status} />
            <AlertDescription>
              <div className="font-semibold">Scoring Consistency</div>
              <div className="text-sm">Std Dev: {metrics.scoringConsistency.stdDev.toFixed(3)}</div>
              <Badge variant={metrics.scoringConsistency.status === 'good' ? 'default' : 'destructive'}>
                Target: &lt; 0.2
              </Badge>
            </AlertDescription>
          </Alert>

          {/* Metric 2: Che Guevara Fix */}
          <Alert>
            <StatusIcon status={metrics.cheGuevaraAlignment.status} />
            <AlertDescription>
              <div className="font-semibold">Che Guevara Alignment</div>
              <div className="text-sm">{metrics.cheGuevaraAlignment.percentage.toFixed(1)}% high scores</div>
              <Badge variant={metrics.cheGuevaraAlignment.status === 'good' ? 'default' : 'destructive'}>
                Target: ≥ 85%
              </Badge>
            </AlertDescription>
          </Alert>

          {/* Metric 3: JSON Validation */}
          <Alert>
            <StatusIcon status={metrics.jsonValidationRate.status} />
            <AlertDescription>
              <div className="font-semibold">JSON Validation Rate</div>
              <div className="text-sm">{metrics.jsonValidationRate.rate.toFixed(1)}% valid</div>
              <Badge variant={metrics.jsonValidationRate.status === 'good' ? 'default' : 'destructive'}>
                Target: ≥ 95%
              </Badge>
            </AlertDescription>
          </Alert>

          {/* Metric 4: Reasoning Quality */}
          <Alert>
            <StatusIcon status={metrics.reasoningQuality.status} />
            <AlertDescription>
              <div className="font-semibold">Reasoning Quality</div>
              <div className="text-sm">{metrics.reasoningQuality.issues} formatting penalties</div>
              <Badge variant={metrics.reasoningQuality.status === 'good' ? 'default' : 'destructive'}>
                Target: 0 issues
              </Badge>
            </AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>
  );
}
