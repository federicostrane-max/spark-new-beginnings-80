// ============================================================
// COORDINATE UTILITIES - Conversion Functions
// ============================================================
// Tool Server v8.4.1 - All coordinates normalized to viewport space
// ============================================================

import { VIEWPORT, LUX_SDK, NORMALIZED_COORD_MAX } from './constants';

/**
 * Coordinate pair in any space.
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Convert Gemini normalized coordinates (0-999) to viewport pixels.
 * Gemini 2.5 Computer Use outputs coords in 0-999 range.
 * 
 * @param normX - Normalized X coordinate (0-999)
 * @param normY - Normalized Y coordinate (0-999)
 * @returns Viewport coordinates (pixels)
 */
export function normalizedToViewport(normX: number, normY: number): Coordinates {
  return {
    x: Math.floor((normX / 1000) * VIEWPORT.WIDTH),
    y: Math.floor((normY / 1000) * VIEWPORT.HEIGHT),
  };
}

/**
 * Convert Lux SDK coordinates to viewport coordinates.
 * 
 * In Tool Server v8.4.1, viewport = lux_sdk (1:1 mapping).
 * This function is kept for API consistency but performs no conversion.
 * 
 * @param luxX - Lux X coordinate
 * @param luxY - Lux Y coordinate
 * @returns Viewport coordinates (same as input in v8.4.1)
 */
export function luxToViewport(luxX: number, luxY: number): Coordinates {
  // v8.4.1: viewport = lux_sdk, no conversion needed (1:1 mapping)
  // If future versions have different dimensions, update this formula:
  // return {
  //   x: Math.round(luxX * VIEWPORT.WIDTH / LUX_SDK.WIDTH),
  //   y: Math.round(luxY * VIEWPORT.HEIGHT / LUX_SDK.HEIGHT),
  // };
  return { x: luxX, y: luxY };
}

/**
 * Convert viewport coordinates to normalized (0-999) space.
 * Useful for comparing with Gemini raw output.
 * 
 * @param viewportX - Viewport X coordinate (pixels)
 * @param viewportY - Viewport Y coordinate (pixels)
 * @returns Normalized coordinates (0-999)
 */
export function viewportToNormalized(viewportX: number, viewportY: number): Coordinates {
  return {
    x: Math.round((viewportX / VIEWPORT.WIDTH) * 1000),
    y: Math.round((viewportY / VIEWPORT.HEIGHT) * 1000),
  };
}

/**
 * Calculate Euclidean distance between two coordinate points.
 * 
 * @param p1 - First point
 * @param p2 - Second point
 * @returns Distance in pixels
 */
export function distance(p1: Coordinates, p2: Coordinates): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Check if coordinates are within viewport bounds.
 * 
 * @param coords - Coordinates to check
 * @returns True if within bounds
 */
export function isWithinViewport(coords: Coordinates): boolean {
  return coords.x >= 0 && coords.x < VIEWPORT.WIDTH &&
         coords.y >= 0 && coords.y < VIEWPORT.HEIGHT;
}

/**
 * Clamp coordinates to viewport bounds.
 * 
 * @param coords - Coordinates to clamp
 * @returns Coordinates clamped to viewport
 */
export function clampToViewport(coords: Coordinates): Coordinates {
  return {
    x: Math.max(0, Math.min(VIEWPORT.WIDTH - 1, coords.x)),
    y: Math.max(0, Math.min(VIEWPORT.HEIGHT - 1, coords.y)),
  };
}

/**
 * Calculate the center point of a bounding box.
 * 
 * @param box - Bounding box with x, y, width, height
 * @returns Center coordinates
 */
export function getCenterOfBox(box: { x: number; y: number; width: number; height: number }): Coordinates {
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

/**
 * Calculate average of multiple coordinate points.
 * 
 * @param points - Array of coordinate points
 * @returns Average coordinate
 */
export function averageCoordinates(points: Coordinates[]): Coordinates {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return {
    x: Math.round(sum.x / points.length),
    y: Math.round(sum.y / points.length),
  };
}
