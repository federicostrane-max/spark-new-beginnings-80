/**
 * PROCESSING TRACE REPORT - Audit Trail System
 * Tracks all processing steps for PDF documents in Pipeline A-Hybrid
 * Provides both machine-readable JSON and human-readable Markdown outputs
 */

export interface ProcessingTraceReport {
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  
  context_analysis: {
    domain: string;
    focus_elements: string[];
    terminology: string[];
    verbosity: string;
    analysis_model: string;
    skipped_reason?: string;
  };
  
  visual_enrichment: {
    elements_found: number;
    elements_processed: number;
    elements_failed: number;
    details: Array<{
      name: string;
      type: string;
      page: number;
      chars_generated: number;
      prompt_domain: string;
      success: boolean;
      error?: string;
    }>;
  };
  
  ocr_corrections: {
    issues_detected: number;
    corrections_applied: number;
    engine_used: 'claude' | 'google' | null;
    details: Array<{
      type: string;
      pattern: string;
      fixed: boolean;
      page?: number;
    }>;
  };
  
  chunking_stats: {
    total_chunks: number;
    avg_chunk_size: number;
    min_chunk_size: number;
    max_chunk_size: number;
    strategy: string;
    type_distribution: Record<string, number>;
    atomic_elements: number;
  };
  
  summary_markdown: string;
}

/**
 * Create a new trace report with initialized values
 */
export function createTraceReport(): ProcessingTraceReport {
  return {
    started_at: new Date().toISOString(),
    context_analysis: {
      domain: 'general',
      focus_elements: [],
      terminology: [],
      verbosity: 'conceptual',
      analysis_model: 'claude-3-5-haiku-20241022'
    },
    visual_enrichment: {
      elements_found: 0,
      elements_processed: 0,
      elements_failed: 0,
      details: []
    },
    ocr_corrections: {
      issues_detected: 0,
      corrections_applied: 0,
      engine_used: null,
      details: []
    },
    chunking_stats: {
      total_chunks: 0,
      avg_chunk_size: 0,
      min_chunk_size: 0,
      max_chunk_size: 0,
      strategy: 'small-to-big',
      type_distribution: {},
      atomic_elements: 0
    },
    summary_markdown: ''
  };
}

/**
 * Generate human-readable Markdown summary from trace report
 */
export function generateSummaryMarkdown(report: ProcessingTraceReport): string {
  const lines: string[] = [];
  
  lines.push(`## 📋 Processing Report`);
  lines.push(``);
  
  // Context Analysis
  if (report.context_analysis.domain !== 'general') {
    lines.push(`**Dominio rilevato:** ${report.context_analysis.domain.toUpperCase()}`);
    if (report.context_analysis.focus_elements.length > 0) {
      lines.push(`**Focus:** ${report.context_analysis.focus_elements.join(', ')}`);
    }
    if (report.context_analysis.terminology.length > 0) {
      lines.push(`**Terminologia:** ${report.context_analysis.terminology.slice(0, 5).join(', ')}${report.context_analysis.terminology.length > 5 ? '...' : ''}`);
    }
  } else {
    lines.push(`**Dominio:** Generale`);
    if (report.context_analysis.skipped_reason) {
      lines.push(`  _(${report.context_analysis.skipped_reason})_`);
    }
  }
  lines.push(``);
  
  // Visual Enrichment
  if (report.visual_enrichment.elements_found > 0) {
    lines.push(`**Elementi visivi:** Rilevati ${report.visual_enrichment.elements_found}, processati ${report.visual_enrichment.elements_processed}`);
    if (report.visual_enrichment.elements_failed > 0) {
      lines.push(`  - ⚠️ Falliti: ${report.visual_enrichment.elements_failed}`);
    }
    if (report.visual_enrichment.details.length > 0) {
      const successTypes = report.visual_enrichment.details
        .filter(d => d.success)
        .map(d => d.type)
        .filter((t, i, arr) => arr.indexOf(t) === i); // unique
      lines.push(`  - Tipi: ${successTypes.join(', ')}`);
      
      const totalChars = report.visual_enrichment.details
        .filter(d => d.success)
        .reduce((sum, d) => sum + d.chars_generated, 0);
      lines.push(`  - Descrizioni generate: ${totalChars} caratteri totali`);
    }
  } else {
    lines.push(`**Elementi visivi:** Nessuno rilevato`);
  }
  lines.push(``);
  
  // OCR Corrections
  if (report.ocr_corrections.issues_detected > 0) {
    lines.push(`**Correzioni OCR:** ${report.ocr_corrections.corrections_applied}/${report.ocr_corrections.issues_detected} corrette`);
    if (report.ocr_corrections.engine_used) {
      lines.push(`  - Engine: ${report.ocr_corrections.engine_used}`);
    }
    if (report.ocr_corrections.details.length > 0) {
      const issueTypes = report.ocr_corrections.details
        .map(d => d.type)
        .filter((t, i, arr) => arr.indexOf(t) === i); // unique
      lines.push(`  - Tipi di errori: ${issueTypes.join(', ')}`);
    }
  } else {
    lines.push(`**Correzioni OCR:** Nessuna necessaria`);
  }
  lines.push(``);
  
  // Chunking Stats
  lines.push(`**Chunking:** ${report.chunking_stats.total_chunks} chunk generati`);
  lines.push(`  - Strategia: ${report.chunking_stats.strategy}`);
  lines.push(`  - Size medio: ${report.chunking_stats.avg_chunk_size} caratteri`);
  lines.push(`  - Range: ${report.chunking_stats.min_chunk_size}-${report.chunking_stats.max_chunk_size} caratteri`);
  lines.push(`  - Elementi atomici preservati: ${report.chunking_stats.atomic_elements}`);
  
  // Type distribution
  const types = Object.entries(report.chunking_stats.type_distribution);
  if (types.length > 0) {
    lines.push(`  - Distribuzione: ${types.map(([t, n]) => `${t}(${n})`).join(', ')}`);
  }
  lines.push(``);
  
  // Duration
  if (report.duration_ms) {
    const seconds = (report.duration_ms / 1000).toFixed(1);
    lines.push(`**Tempo elaborazione:** ${seconds}s`);
  }
  
  if (report.completed_at) {
    lines.push(`**Completato:** ${new Date(report.completed_at).toLocaleString('it-IT')}`);
  }
  
  return lines.join('\n');
}

/**
 * Finalize the trace report (set completion time, duration, generate summary)
 */
export function finalizeTraceReport(report: ProcessingTraceReport, startTime: number): ProcessingTraceReport {
  report.completed_at = new Date().toISOString();
  report.duration_ms = Date.now() - startTime;
  report.summary_markdown = generateSummaryMarkdown(report);
  return report;
}
