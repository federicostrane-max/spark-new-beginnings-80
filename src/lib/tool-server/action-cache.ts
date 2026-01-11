// ============================================================
// ACTION CACHE - Caches successful action coordinates
// ============================================================

import { CachedCoordinate } from './orchestrator-types';

export class ActionCache {
  private cache: Map<string, CachedCoordinate> = new Map();
  private maxSize: number;
  private minSuccessCount: number;

  constructor(maxSize: number = 100, minSuccessCount: number = 2) {
    this.maxSize = maxSize;
    this.minSuccessCount = minSuccessCount;
  }

  /**
   * Generate cache key from URL and target description
   */
  private generateKey(url: string, targetDescription: string): string {
    // Normalize URL (remove query params for better matching)
    const normalizedUrl = new URL(url).origin + new URL(url).pathname;
    // Normalize target description
    const normalizedTarget = targetDescription.toLowerCase().trim();
    return `${normalizedUrl}::${normalizedTarget}`;
  }

  /**
   * Get cached coordinates if available and reliable
   */
  get(url: string, targetDescription: string): CachedCoordinate | null {
    const key = this.generateKey(url, targetDescription);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Only return if it's been successful enough times
    if (cached.success_count < this.minSuccessCount) return null;

    // Check if not too old (1 hour max)
    const maxAge = 60 * 60 * 1000; // 1 hour
    if (Date.now() - cached.last_used > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Record a successful action
   */
  recordSuccess(
    url: string,
    targetDescription: string,
    x: number,
    y: number,
    coordinateSystem: 'lux_sdk' | 'viewport'
  ): void {
    const key = this.generateKey(url, targetDescription);
    const existing = this.cache.get(key);

    if (existing) {
      // Update existing entry
      this.cache.set(key, {
        ...existing,
        x,
        y,
        coordinate_system: coordinateSystem,
        success_count: existing.success_count + 1,
        last_used: Date.now(),
      });
    } else {
      // Evict if at capacity
      if (this.cache.size >= this.maxSize) {
        this.evictOldest();
      }

      // Create new entry
      this.cache.set(key, {
        x,
        y,
        coordinate_system: coordinateSystem,
        success_count: 1,
        last_used: Date.now(),
        url,
      });
    }
  }

  /**
   * Record a failed action (reduces confidence)
   */
  recordFailure(url: string, targetDescription: string): void {
    const key = this.generateKey(url, targetDescription);
    const existing = this.cache.get(key);

    if (existing) {
      if (existing.success_count <= 1) {
        // Remove if no longer reliable
        this.cache.delete(key);
      } else {
        // Decrease success count
        this.cache.set(key, {
          ...existing,
          success_count: existing.success_count - 1,
        });
      }
    }
  }

  /**
   * Evict the oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    this.cache.forEach((value, key) => {
      if (value.last_used < oldestTime) {
        oldestTime = value.last_used;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; entries: Array<{ key: string; successCount: number }> } {
    const entries: Array<{ key: string; successCount: number }> = [];
    this.cache.forEach((value, key) => {
      entries.push({ key, successCount: value.success_count });
    });
    return { size: this.cache.size, entries };
  }
}
