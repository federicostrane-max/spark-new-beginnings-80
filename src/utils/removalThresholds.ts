/**
 * Smart Removal Thresholds System
 * 
 * This system adapts removal thresholds and approval requirements based on
 * agent type and domain criticality to ensure safe and effective knowledge pruning.
 */

export interface RemovalConfig {
  threshold: number;
  maxRemovalsPerRun: number;
  requiresApproval: boolean;
}

/**
 * Predefined removal configurations for different agent types.
 * Critical domains have higher thresholds and stricter approval requirements.
 */
export const AGENT_REMOVAL_THRESHOLDS: Record<string, RemovalConfig> = {
  // CONCEPTUAL AGENTS - More permissive (creativity matters)
  conceptual: {
    threshold: 0.25,
    maxRemovalsPerRun: 20,
    requiresApproval: false
  },
  
  // PROCEDURAL AGENTS - Moderate thresholds
  procedural: {
    threshold: 0.35,
    maxRemovalsPerRun: 15,
    requiresApproval: false
  },
  
  // TECHNICAL AGENTS - Restrictive (precision matters)
  technical: {
    threshold: 0.40,
    maxRemovalsPerRun: 10,
    requiresApproval: true  // ↑ Requires manual approval
  },
  
  // MEDICAL AGENTS - Very restrictive (safety critical)
  medical: {
    threshold: 0.45,
    maxRemovalsPerRun: 5,
    requiresApproval: true   // ↑ Always requires approval
  },
  
  // FINANCIAL AGENTS - Restrictive (compliance critical)
  financial: {
    threshold: 0.40,
    maxRemovalsPerRun: 8,
    requiresApproval: true
  },
  
  // LEGAL AGENTS - Restrictive (regulatory compliance)
  legal: {
    threshold: 0.40,
    maxRemovalsPerRun: 8,
    requiresApproval: true
  }
};

/**
 * Detects domain criticality from system prompt.
 * Higher criticality means stricter removal thresholds.
 * 
 * @param systemPrompt - The agent's system prompt text
 * @returns Criticality level: 'high', 'medium', or 'low'
 */
export function detectDomainCriticality(systemPrompt: string): 'high' | 'medium' | 'low' {
  const promptLower = systemPrompt.toLowerCase();
  
  const highCriticalityKeywords = [
    'medical', 'health', 'patient', 'diagnose', 'treatment',
    'financial', 'investment', 'money', 'compliance', 'legal',
    'safety', 'security', 'emergency', 'critical', 'regulation'
  ];
  
  const mediumCriticalityKeywords = [
    'technical', 'engineering', 'code', 'development',
    'contract', 'agreement', 'business', 'operational'
  ];
  
  if (highCriticalityKeywords.some(keyword => promptLower.includes(keyword))) {
    return 'high';
  }
  
  if (mediumCriticalityKeywords.some(keyword => promptLower.includes(keyword))) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Gets removal configuration for an agent, adjusted by domain criticality.
 * 
 * @param agentType - Type of agent (conceptual, procedural, etc.)
 * @param domainCriticality - Domain criticality level
 * @returns Removal configuration with adjusted threshold
 */
export function getRemovalConfig(
  agentType: string, 
  domainCriticality: 'high' | 'medium' | 'low' = 'medium'
): RemovalConfig {
  const baseConfig = AGENT_REMOVAL_THRESHOLDS[agentType] || AGENT_REMOVAL_THRESHOLDS.conceptual;
  
  // Criticality multipliers adjust the threshold
  const criticalityMultipliers = {
    high: 1.1,   // ↑ Increase threshold by 10% for critical domains
    medium: 1.0, // No adjustment
    low: 0.9     // ↓ Decrease threshold by 10% for non-critical domains
  };
  
  const adjustedThreshold = baseConfig.threshold * criticalityMultipliers[domainCriticality];
  
  return {
    ...baseConfig,
    threshold: Math.min(adjustedThreshold, 0.6) // Safety cap at 0.6
  };
}
