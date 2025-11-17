/**
 * Agent Classification and Adaptive Weights System
 * 
 * Universal categorization system that covers all possible agent types.
 * This is the SINGLE SOURCE OF TRUTH for agent classification and scoring weights.
 * 
 * SHARED MODULE: Used by both frontend and edge functions.
 */

export interface ScoringWeights {
  semantic_relevance: number;
  concept_coverage: number;
  procedural_match: number;
  vocabulary_alignment: number;
  bibliographic_match: number;
}

/**
 * Universal Agent Categories (6 types cover all cases)
 * 
 * These categories are designed to be:
 * - Scalable: Cover all common use cases
 * - Maintainable: Single source of truth
 * - Extendible: Easy to add new categories if needed
 * - Self-documenting: Clear purpose for each category
 */
export const AGENT_TYPE_WEIGHTS: Record<string, ScoringWeights> = {
  // PROCEDURAL - Support, Operations, Workflows, How-to guides
  // Emphasis: Step-by-step procedures and operational knowledge
  // Use for: Customer support, operational guides, process documentation
  procedural: {
    semantic_relevance: 0.20,
    concept_coverage: 0.20,
    procedural_match: 0.35,      // ↑ Highest - procedures are critical
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.10
  },
  
  // TECHNICAL - Engineering, Development, IT, Code
  // Emphasis: Precise terminology and technical procedures
  // Use for: Software development, engineering, technical documentation
  technical: {
    semantic_relevance: 0.20,
    concept_coverage: 0.20,
    procedural_match: 0.30,      // ↑ High - technical steps matter
    vocabulary_alignment: 0.25,  // ↑ High - precision is critical
    bibliographic_match: 0.05
  },
  
  // RESEARCH - Academic, Scientific, Analysis, Papers
  // Emphasis: Theoretical concepts and bibliographic references
  // Use for: Academic research, scientific analysis, literature review
  research: {
    semantic_relevance: 0.15,
    concept_coverage: 0.30,      // ↑ High - abstract concepts matter
    procedural_match: 0.10,
    vocabulary_alignment: 0.20,
    bibliographic_match: 0.25    // ↑ High - citations are important
  },
  
  // NARRATIVE - Biographies, Stories, Historical accounts, Creative writing
  // Emphasis: Semantic context and bibliographic sources
  // Use for: Biographical agents, storytelling, historical documentation
  narrative: {
    semantic_relevance: 0.35,    // ↑ Highest - context is everything
    concept_coverage: 0.15,      // ↓ Lower - concrete events vs abstract concepts
    procedural_match: 0.05,      // ↓ Very low - no procedures in narratives
    vocabulary_alignment: 0.20,
    bibliographic_match: 0.25    // ↑ High - source attribution matters
  },
  
  // DOMAIN-EXPERT - Medical, Legal, Compliance, Specialized domains
  // Emphasis: Domain vocabulary and theoretical concepts
  // Use for: Healthcare, law, compliance, specialized professional fields
  'domain-expert': {
    semantic_relevance: 0.20,
    concept_coverage: 0.30,      // ↑ High - domain concepts are critical
    procedural_match: 0.20,
    vocabulary_alignment: 0.20,  // ↑ High - precise terminology matters
    bibliographic_match: 0.10
  },
  
  // GENERAL - Default for unclassified or mixed-purpose agents
  // Emphasis: Balanced across all dimensions
  // Use for: General assistants, multi-purpose chatbots
  general: {
    semantic_relevance: 0.25,
    concept_coverage: 0.25,
    procedural_match: 0.20,
    vocabulary_alignment: 0.20,
    bibliographic_match: 0.10
  }
};

/**
 * Detects agent type from system prompt using keyword analysis.
 * 
 * Detection order matters: More specific types are checked first.
 * 
 * @param systemPrompt - The agent's system prompt text
 * @returns Agent type identifier from AGENT_TYPE_WEIGHTS
 */
export function detectAgentType(systemPrompt: string): string {
  const promptLower = systemPrompt.toLowerCase();
  
  // NARRATIVE - Biographies, stories, historical accounts (check FIRST - very specific)
  if (
    promptLower.includes('biography') || 
    promptLower.includes('biographical') || 
    promptLower.includes('vita') || 
    promptLower.includes('life of') ||
    promptLower.includes('story') ||
    promptLower.includes('narrative') ||
    promptLower.includes('creative writing')
  ) {
    return 'narrative';
  }
  
  // DOMAIN-EXPERT - Medical, Legal, Compliance (check before general categories)
  if (
    promptLower.includes('diagnose') || 
    promptLower.includes('medical') || 
    promptLower.includes('health') || 
    promptLower.includes('patient') ||
    promptLower.includes('clinical') ||
    promptLower.includes('treatment') ||
    promptLower.includes('legal') || 
    promptLower.includes('contract') || 
    promptLower.includes('compliance') || 
    promptLower.includes('law') ||
    promptLower.includes('regulation')
  ) {
    return 'domain-expert';
  }
  
  // RESEARCH - Academic, scientific, analysis
  if (
    promptLower.includes('research') || 
    promptLower.includes('academic') || 
    promptLower.includes('paper') || 
    promptLower.includes('scholar') ||
    promptLower.includes('scientific') ||
    promptLower.includes('analysis')
  ) {
    return 'research';
  }
  
  // TECHNICAL - Engineering, development, IT
  if (
    promptLower.includes('code') || 
    promptLower.includes('technical') || 
    promptLower.includes('engineer') || 
    promptLower.includes('develop') ||
    promptLower.includes('programming') ||
    promptLower.includes('software')
  ) {
    return 'technical';
  }
  
  // PROCEDURAL - Support, operations, workflows
  if (
    promptLower.includes('support') || 
    promptLower.includes('help') || 
    promptLower.includes('guide') || 
    promptLower.includes('assist') ||
    promptLower.includes('workflow') ||
    promptLower.includes('procedure') ||
    promptLower.includes('how-to') ||
    promptLower.includes('operations')
  ) {
    return 'procedural';
  }
  
  // DEFAULT - General purpose agents
  return 'general';
}

/**
 * Gets appropriate weights for an agent based on its system prompt.
 * 
 * @param systemPrompt - The agent's system prompt text
 * @returns Scoring weights tailored to the agent type
 */
export function getWeightsForAgent(systemPrompt: string): ScoringWeights {
  const agentType = detectAgentType(systemPrompt);
  return AGENT_TYPE_WEIGHTS[agentType] || AGENT_TYPE_WEIGHTS.general;
}

/**
 * Validates that weights sum to 1.0 (with floating point tolerance).
 * 
 * @param weights - Scoring weights to validate
 * @returns True if weights are valid
 */
export function validateWeights(weights: ScoringWeights): boolean {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1.0) < 0.001; // Tolerance for floating point errors
}
