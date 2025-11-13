export const KNOWLEDGE_ALIGNMENT_CONFIG = {
  // Auto-removal settings
  auto_removal: {
    enabled: true,
    threshold: 0.3, // Remove chunks with final_relevance_score < 0.3
    max_removals_per_run: 50, // Safety: if more than 50, require manual approval
    cooldown_minutes: 60, // Minimum 1 hour between consecutive analyses
  },
  
  // Safe mode (7 days of monitoring only)
  safe_mode: {
    duration_days: 7,
    enabled: true,
  },
  
  // Trigger settings
  triggers: {
    on_prompt_change: true,
    min_time_between_analyses: 300000, // 5 minutes in ms (reduced for testing)
  },
  
  // Scoring weights (to calculate final_relevance_score)
  score_weights: {
    semantic_relevance: 0.30,
    concept_coverage: 0.25,
    procedural_match: 0.15,
    vocabulary_alignment: 0.10,
    bibliographic_match: 0.20,
  },
  
  // AI Models (using Lovable AI)
  models: {
    task_extraction: 'openai/gpt-5-mini', // Fast and economical
    relevance_analysis: 'openai/gpt-5-mini',
  },
  
  // Gap Analysis settings
  gap_analysis: {
    critical_threshold: 0.3, // Coverage < 30% = critical gap
    moderate_threshold: 0.5, // Coverage 30-50% = moderate gap
    min_chunks_for_coverage: 3, // At least 3 relevant chunks = 100% coverage
    auto_trigger: true, // Auto-trigger after alignment analysis
    ai_suggestions: true, // Generate AI suggestions for gaps
    max_ai_suggestions_per_category: 5, // Limit detailed AI suggestions to top 5 gaps per category
    use_fast_model_for_bulk: true, // Use faster AI model for non-critical suggestions
  },
  
  // Experimental features for gradual rollout
  experimental: {
    adaptive_weights: true,      // Enable adaptive scoring weights based on agent type
    adaptive_thresholds: true,   // Enable smart removal thresholds based on domain criticality
    fallback_to_fixed: true,     // Fallback to fixed weights if agent type detection fails
    show_config_in_dashboard: true // Display agent configuration in dashboard
  },
} as const;
