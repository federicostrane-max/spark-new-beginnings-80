// ============================================================
// TOOL SERVER CONSTANTS - Centralized Configuration
// ============================================================
// Tool Server v8.4.1 - Viewport = Lux SDK (1:1 mapping)
// ============================================================

/**
 * Viewport dimensions for browser automation.
 * Aligned with Tool Server v8.4.1 and Lux SDK native resolution.
 * 
 * IMPORTANT: viewport = lux_sdk (1:1 mapping, no conversion needed)
 */
export const VIEWPORT = {
  WIDTH: 1260,
  HEIGHT: 700,
} as const;

/**
 * Lux SDK reference dimensions.
 * In v8.4.1, these are identical to viewport (1:1 mapping).
 */
export const LUX_SDK = {
  WIDTH: 1260,
  HEIGHT: 700,
} as const;

/**
 * Gemini Computer Use returns normalized coordinates in range 0-999.
 * These need to be converted to viewport coordinates.
 */
export const NORMALIZED_COORD_MAX = 999;

/**
 * Triple Verification thresholds (in pixels).
 * Used to determine confidence level when comparing coordinates from
 * DOM, Lux, and Gemini sources.
 */
export const TRIPLE_VERIFY = {
  /** Distance <= this = HIGH confidence (all agree) */
  MATCH_THRESHOLD: 50,
  /** Distance <= this = MEDIUM confidence (acceptable variance) */
  WARNING_THRESHOLD: 100,
  /** Distance <= this = LOW confidence (retry recommended) */
  MISMATCH_THRESHOLD: 150,
} as const;

/**
 * Confidence levels for Triple Verification results.
 */
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';

/**
 * Recommended actions based on verification results.
 */
export type RecommendedAction = 'PROCEED' | 'RETRY' | 'FALLBACK' | 'ABORT';
