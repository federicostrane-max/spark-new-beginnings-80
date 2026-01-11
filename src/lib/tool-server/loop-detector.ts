// ============================================================
// LOOP DETECTOR - Detects repeated action patterns
// ============================================================

import { ActionRecord } from './orchestrator-types';

export interface LoopDetectionResult {
  isLoop: boolean;
  loopLength: number;
  repeatedActions: ActionRecord[];
  suggestion: string | null;
}

export class LoopDetector {
  private history: ActionRecord[] = [];
  private maxHistorySize: number;
  private threshold: number;

  constructor(threshold: number = 3, maxHistorySize: number = 50) {
    this.threshold = threshold;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Add an action to history
   */
  addAction(action: ActionRecord): void {
    this.history.push(action);
    
    // Keep history bounded
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Check if we're in a loop
   */
  detectLoop(): LoopDetectionResult {
    if (this.history.length < this.threshold) {
      return { isLoop: false, loopLength: 0, repeatedActions: [], suggestion: null };
    }

    // Check for exact repetition of last N actions
    for (let patternLength = 1; patternLength <= Math.floor(this.history.length / 2); patternLength++) {
      if (this.isPatternRepeating(patternLength)) {
        const repeatedActions = this.history.slice(-patternLength);
        return {
          isLoop: true,
          loopLength: patternLength,
          repeatedActions,
          suggestion: this.suggestRecovery(repeatedActions),
        };
      }
    }

    // Check for repeated failures on same target
    const recentFailures = this.getRecentFailuresOnSameTarget();
    if (recentFailures.length >= this.threshold) {
      return {
        isLoop: true,
        loopLength: recentFailures.length,
        repeatedActions: recentFailures,
        suggestion: this.suggestRecoveryForFailures(recentFailures),
      };
    }

    return { isLoop: false, loopLength: 0, repeatedActions: [], suggestion: null };
  }

  /**
   * Check if a pattern of given length is repeating
   */
  private isPatternRepeating(patternLength: number): boolean {
    const requiredLength = patternLength * this.threshold;
    if (this.history.length < requiredLength) return false;

    const recent = this.history.slice(-requiredLength);
    const pattern = recent.slice(0, patternLength);

    for (let i = 1; i < this.threshold; i++) {
      const comparison = recent.slice(i * patternLength, (i + 1) * patternLength);
      if (!this.patternsMatch(pattern, comparison)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Compare two action patterns
   */
  private patternsMatch(a: ActionRecord[], b: ActionRecord[]): boolean {
    if (a.length !== b.length) return false;
    
    return a.every((action, i) => 
      action.action_type === b[i].action_type &&
      action.target_description === b[i].target_description &&
      Math.abs((action.x || 0) - (b[i].x || 0)) < 10 &&
      Math.abs((action.y || 0) - (b[i].y || 0)) < 10
    );
  }

  /**
   * Get recent failures on the same target
   */
  private getRecentFailuresOnSameTarget(): ActionRecord[] {
    const recent = this.history.slice(-10);
    const failures = recent.filter(a => !a.success);
    
    if (failures.length < 2) return [];

    // Group by target
    const targetGroups = new Map<string, ActionRecord[]>();
    failures.forEach(f => {
      const key = f.target_description;
      if (!targetGroups.has(key)) {
        targetGroups.set(key, []);
      }
      targetGroups.get(key)!.push(f);
    });

    // Find largest group
    let maxGroup: ActionRecord[] = [];
    targetGroups.forEach(group => {
      if (group.length > maxGroup.length) {
        maxGroup = group;
      }
    });

    return maxGroup.length >= this.threshold ? maxGroup : [];
  }

  /**
   * Suggest recovery strategy for loop
   */
  private suggestRecovery(repeatedActions: ActionRecord[]): string {
    const actionTypes = repeatedActions.map(a => a.action_type);
    
    if (actionTypes.every(t => t === 'click')) {
      return 'Prova a usare fallback_description o scrollare per trovare elemento alternativo';
    }
    
    if (actionTypes.includes('scroll')) {
      return 'Lo scroll non sta trovando l\'elemento. Prova un\'azione diversa o verifica che l\'elemento esista';
    }

    return 'Il pattern di azioni si sta ripetendo. Considera di interrompere e rivalutare il piano';
  }

  /**
   * Suggest recovery for repeated failures
   */
  private suggestRecoveryForFailures(failures: ActionRecord[]): string {
    const target = failures[0]?.target_description;
    return `Fallimento ripetuto su "${target}". L'elemento potrebbe non esistere o essere cambiato. Prova fallback_description`;
  }

  /**
   * Reset history
   */
  reset(): void {
    this.history = [];
  }

  /**
   * Get current history
   */
  getHistory(): ActionRecord[] {
    return [...this.history];
  }
}
