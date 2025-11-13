/**
 * Agent Classification and Adaptive Weights System
 * 
 * This system automatically classifies agents based on their system prompts
 * and assigns appropriate scoring weights for knowledge alignment analysis.
 */

export interface ScoringWeights {
  semantic_relevance: number;
  concept_coverage: number;
  procedural_match: number;
  vocabulary_alignment: number;
  bibliographic_match: number;
}

/**
 * Predefined weight profiles for different agent types.
 * Each profile emphasizes different dimensions based on the agent's purpose.
 */
export const AGENT_TYPE_WEIGHTS: Record<string, ScoringWeights> = {
  // CONCEPTUAL AGENTS - Research, Analysis, Content Creation
  // Emphasis: Concept coverage is critical for knowledge-based tasks
  conceptual: {
    semantic_relevance: 0.25,
    concept_coverage: 0.35,      // ↑ Most important for conceptual agents
    procedural_match: 0.10,      // ↓ Less important
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.15
  },
  
  // PROCEDURAL AGENTS - Support, Operations, Workflows
  // Emphasis: Step-by-step procedures and operational knowledge
  procedural: {
    semantic_relevance: 0.20,
    concept_coverage: 0.20,
    procedural_match: 0.35,      // ↑ Most important for operational agents
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.10
  },
  
  // TECHNICAL AGENTS - Engineering, Development, IT
  // Emphasis: Precise terminology and technical accuracy
  technical: {
    semantic_relevance: 0.25,
    concept_coverage: 0.25,
    procedural_match: 0.20,
    vocabulary_alignment: 0.20,  // ↑ Important for technical precision
    bibliographic_match: 0.10
  },
  
  // MEDICAL AGENTS - Diagnosis, Healthcare
  // Emphasis: Both concepts and procedures are critical for safety
  medical: {
    semantic_relevance: 0.20,
    concept_coverage: 0.30,
    procedural_match: 0.25,      // ↑ Medical procedures are critical
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.10
  },
  
  // LEGAL AGENTS - Compliance, Contracts, Law
  // Emphasis: Bibliographic sources and references are important
  legal: {
    semantic_relevance: 0.25,
    concept_coverage: 0.25,
    procedural_match: 0.20,
    vocabulary_alignment: 0.15,
    bibliographic_match: 0.15    // ↑ Legal references matter
  }
};

/**
 * Detects agent type from system prompt using keyword analysis.
 * 
 * @param systemPrompt - The agent's system prompt text
 * @returns Agent type identifier (conceptual, procedural, technical, medical, legal)
 */
export function detectAgentType(systemPrompt: string): string {
  const promptLower = systemPrompt.toLowerCase();
  
  // Medical/Healthcare domain
  if (
    promptLower.includes('diagnose') || 
    promptLower.includes('medical') || 
    promptLower.includes('health') || 
    promptLower.includes('patient') ||
    promptLower.includes('clinical') ||
    promptLower.includes('treatment')
  ) {
    return 'medical';
  }
  
  // Technical/Engineering domain
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
  
  // Procedural/Support domain
  if (
    promptLower.includes('support') || 
    promptLower.includes('help') || 
    promptLower.includes('guide') || 
    promptLower.includes('assist') ||
    promptLower.includes('workflow') ||
    promptLower.includes('procedure')
  ) {
    return 'procedural';
  }
  
  // Legal/Compliance domain
  if (
    promptLower.includes('legal') || 
    promptLower.includes('contract') || 
    promptLower.includes('compliance') || 
    promptLower.includes('law') ||
    promptLower.includes('regulation') ||
    promptLower.includes('policy')
  ) {
    return 'legal';
  }
  
  // Default: Conceptual agents (research, analysis, content)
  return 'conceptual';
}

/**
 * Gets appropriate weights for an agent based on its system prompt.
 * 
 * @param systemPrompt - The agent's system prompt text
 * @returns Scoring weights tailored to the agent type
 */
export function getWeightsForAgent(systemPrompt: string): ScoringWeights {
  const agentType = detectAgentType(systemPrompt);
  return AGENT_TYPE_WEIGHTS[agentType] || AGENT_TYPE_WEIGHTS.conceptual;
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
