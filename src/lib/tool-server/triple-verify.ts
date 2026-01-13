// ============================================================
// TRIPLE VERIFICATION - DOM + Lux + Gemini Coordinate Validation
// ============================================================
// Tool Server v8.4.1 - Web App handles all verification logic
// ============================================================

import { 
  TRIPLE_VERIFY, 
  Confidence, 
  RecommendedAction 
} from './constants';
import { 
  Coordinates, 
  normalizedToViewport, 
  distance, 
  averageCoordinates 
} from './coordinates';

/**
 * Coordinate sources for Triple Verification.
 * Provide at least 2 sources for meaningful verification.
 */
export interface CoordinateSources {
  /** DOM coordinates (already in viewport space) */
  dom?: Coordinates | null;
  /** Lux coordinates (already in viewport space in v8.4.1) */
  lux?: Coordinates | null;
  /** Gemini normalized coordinates (0-999, will be converted) */
  geminiNormalized?: Coordinates | null;
}

/**
 * Result of Triple Verification.
 */
export interface TripleVerifyResult {
  /** Confidence level based on source agreement */
  confidence: Confidence;
  /** Recommended action to take */
  action: RecommendedAction;
  /** Best coordinates to use for the action */
  bestCoords: Coordinates;
  /** Distance measurements between sources (in pixels) */
  distances: {
    dom_lux?: number;
    dom_gemini?: number;
    lux_gemini?: number;
  };
  /** Which sources were provided and valid */
  sources: ('dom' | 'lux' | 'gemini')[];
  /** Maximum distance between any two sources */
  maxDistance: number;
  /** Optional warning message */
  warning?: string;
}

/**
 * Internal structure for processed coordinates.
 */
interface ProcessedCoord {
  source: 'dom' | 'lux' | 'gemini';
  coords: Coordinates;
}

/**
 * Perform Triple Verification by comparing coordinates from multiple sources.
 * 
 * This function:
 * 1. Converts all coordinates to viewport space
 * 2. Calculates distances between all pairs
 * 3. Determines confidence based on agreement
 * 4. Recommends an action (PROCEED/RETRY/FALLBACK/ABORT)
 * 5. Selects the best coordinates to use
 * 
 * @param sources - Coordinate sources (at least 1 required)
 * @returns Verification result with confidence, action, and best coordinates
 */
export function tripleVerify(sources: CoordinateSources): TripleVerifyResult {
  const viewportCoords: ProcessedCoord[] = [];
  
  // Collect and convert all provided coordinates to viewport space
  if (sources.dom && sources.dom.x !== null && sources.dom.y !== null) {
    viewportCoords.push({ source: 'dom', coords: sources.dom });
  }
  
  if (sources.lux && sources.lux.x !== null && sources.lux.y !== null) {
    // Lux = viewport in v8.4.1 (1:1 mapping)
    viewportCoords.push({ source: 'lux', coords: sources.lux });
  }
  
  if (sources.geminiNormalized && 
      sources.geminiNormalized.x !== null && 
      sources.geminiNormalized.y !== null) {
    // Convert Gemini normalized (0-999) to viewport pixels
    const converted = normalizedToViewport(
      sources.geminiNormalized.x,
      sources.geminiNormalized.y
    );
    viewportCoords.push({ source: 'gemini', coords: converted });
  }
  
  // Handle case with no valid sources
  if (viewportCoords.length === 0) {
    return {
      confidence: 'FAILED',
      action: 'ABORT',
      bestCoords: { x: 0, y: 0 },
      distances: {},
      sources: [],
      maxDistance: -1,
      warning: 'No valid coordinate sources provided',
    };
  }
  
  // Handle single source case
  if (viewportCoords.length === 1) {
    const single = viewportCoords[0];
    return {
      confidence: 'LOW',
      action: 'PROCEED',
      bestCoords: single.coords,
      distances: {},
      sources: [single.source],
      maxDistance: 0,
      warning: `Only ${single.source} source available - cannot verify`,
    };
  }
  
  // Calculate distances between all pairs
  const distances: Record<string, number> = {};
  let maxDistance = 0;
  
  for (let i = 0; i < viewportCoords.length; i++) {
    for (let j = i + 1; j < viewportCoords.length; j++) {
      const d = distance(viewportCoords[i].coords, viewportCoords[j].coords);
      const key = `${viewportCoords[i].source}_${viewportCoords[j].source}`;
      distances[key] = Math.round(d * 100) / 100;
      maxDistance = Math.max(maxDistance, d);
    }
  }
  
  // Determine confidence and action based on max distance
  let confidence: Confidence;
  let action: RecommendedAction;
  let warning: string | undefined;
  
  if (maxDistance <= TRIPLE_VERIFY.MATCH_THRESHOLD) {
    confidence = 'HIGH';
    action = 'PROCEED';
  } else if (maxDistance <= TRIPLE_VERIFY.WARNING_THRESHOLD) {
    confidence = 'MEDIUM';
    action = 'PROCEED';
    warning = `Moderate variance detected (${Math.round(maxDistance)}px)`;
  } else if (maxDistance <= TRIPLE_VERIFY.MISMATCH_THRESHOLD) {
    confidence = 'LOW';
    action = 'RETRY';
    warning = `High variance detected (${Math.round(maxDistance)}px) - retry recommended`;
  } else {
    confidence = 'FAILED';
    action = 'FALLBACK';
    warning = `Sources diverge significantly (${Math.round(maxDistance)}px) - use fallback`;
  }
  
  // Determine best coordinates
  const bestCoords = selectBestCoordinates(
    viewportCoords, 
    confidence, 
    sources.dom
  );
  
  return {
    confidence,
    action,
    bestCoords,
    distances,
    sources: viewportCoords.map(v => v.source),
    maxDistance: Math.round(maxDistance * 100) / 100,
    warning,
  };
}

/**
 * Select the best coordinates based on confidence and available sources.
 * 
 * Strategy:
 * - HIGH/MEDIUM confidence: Use average of all sources
 * - LOW confidence with DOM: Prefer DOM (most reliable for layout)
 * - FAILED: Use DOM if available, otherwise average
 */
function selectBestCoordinates(
  coords: ProcessedCoord[],
  confidence: Confidence,
  domCoords?: Coordinates | null
): Coordinates {
  // For high/medium confidence, use average
  if (confidence === 'HIGH' || confidence === 'MEDIUM') {
    return averageCoordinates(coords.map(c => c.coords));
  }
  
  // For low confidence, prefer DOM if available
  if (confidence === 'LOW' && domCoords && domCoords.x !== null && domCoords.y !== null) {
    return domCoords;
  }
  
  // For failed, use DOM if available
  if (confidence === 'FAILED' && domCoords && domCoords.x !== null && domCoords.y !== null) {
    return domCoords;
  }
  
  // Fallback to average
  return averageCoordinates(coords.map(c => c.coords));
}

/**
 * Quick check if two coordinates are within threshold distance.
 * 
 * @param c1 - First coordinate
 * @param c2 - Second coordinate
 * @param threshold - Maximum allowed distance (default: MATCH_THRESHOLD)
 * @returns True if coordinates are close enough
 */
export function coordinatesMatch(
  c1: Coordinates,
  c2: Coordinates,
  threshold: number = TRIPLE_VERIFY.MATCH_THRESHOLD
): boolean {
  return distance(c1, c2) <= threshold;
}

/**
 * Analyze the verification pattern for detailed logging.
 * 
 * @param result - Triple verification result
 * @returns Human-readable pattern description
 */
export function describePattern(result: TripleVerifyResult): string {
  const { sources, maxDistance, confidence } = result;
  
  if (sources.length === 3) {
    if (confidence === 'HIGH') {
      return 'all_agree: DOM + Lux + Gemini within threshold';
    } else if (confidence === 'MEDIUM') {
      return 'partial_agree: Sources have moderate variance';
    } else {
      return 'disagree: Sources diverge significantly';
    }
  } else if (sources.length === 2) {
    return `dual_source: ${sources.join(' + ')} (distance: ${Math.round(maxDistance)}px)`;
  } else {
    return `single_source: ${sources[0]} only`;
  }
}
