// ============================================================
// LUX API CLIENT - Calls OpenAGI Lux API via Edge Function proxy
// ============================================================

import { supabase } from '@/integrations/supabase/client';
import { LuxApiResponse, LuxAction } from './types';

export class LuxApiClient {
  private lastCallTime: number = 0;
  private minCallInterval: number = 500; // Min 500ms between calls to avoid rate limiting

  /**
   * Call the Lux API to determine next actions based on screenshot and task.
   * Uses lux-api-proxy Edge Function to avoid CORS issues.
   */
  async act(
    imageBase64: string,
    taskDescription: string,
    model: string = 'lux-actor-1',
    temperature: number = 0.1
  ): Promise<LuxApiResponse> {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    if (timeSinceLastCall < this.minCallInterval) {
      await this.sleep(this.minCallInterval - timeSinceLastCall);
    }
    this.lastCallTime = Date.now();

    try {
      console.log(`🔮 [LuxAPI] Calling ${model} with task: "${taskDescription.slice(0, 50)}..."`);
      
      const { data, error } = await supabase.functions.invoke('lux-api-proxy', {
        body: {
          image: imageBase64,
          task: taskDescription,
          model,
          temperature
        }
      });

      if (error) {
        console.error('❌ [LuxAPI] Edge function error:', error);
        return {
          actions: [],
          is_done: false,
          error: `Edge function error: ${error.message}`
        };
      }

      if (!data.success) {
        console.error('❌ [LuxAPI] API error:', data.error);
        return {
          actions: [],
          is_done: false,
          error: data.error || 'Unknown API error'
        };
      }

      // Parse and validate actions
      const actions = this.validateActions(data.actions || []);
      
      console.log(`✅ [LuxAPI] Received ${actions.length} actions, is_done: ${data.is_done}`);
      
      return {
        actions,
        is_done: data.is_done || false,
        reasoning: data.reasoning
      };

    } catch (err) {
      console.error('❌ [LuxAPI] Exception:', err);
      return {
        actions: [],
        is_done: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Validate and normalize actions from API response.
   */
  private validateActions(rawActions: unknown[]): LuxAction[] {
    if (!Array.isArray(rawActions)) return [];
    
    return rawActions
      .filter((action): action is Record<string, unknown> => 
        typeof action === 'object' && action !== null
      )
      .map(action => {
        const type = String(action.type || 'unknown');
        
        const normalized: LuxAction = {
          type: type as LuxAction['type']
        };

        // Handle coordinate (can be array or object)
        if (action.coordinate) {
          if (Array.isArray(action.coordinate) && action.coordinate.length >= 2) {
            normalized.coordinate = [
              Math.round(Number(action.coordinate[0])),
              Math.round(Number(action.coordinate[1]))
            ];
          } else if (typeof action.coordinate === 'object') {
            const coord = action.coordinate as Record<string, number>;
            normalized.coordinate = [
              Math.round(coord.x || coord[0] || 0),
              Math.round(coord.y || coord[1] || 0)
            ];
          }
        }

        // Handle text for 'type' action
        if (action.text) {
          normalized.text = String(action.text);
        }

        // Handle key for 'press' action
        if (action.key) {
          normalized.key = String(action.key);
        }

        // Handle scroll
        if (action.direction) {
          normalized.direction = action.direction as 'up' | 'down';
        }
        if (action.scroll_amount) {
          normalized.scroll_amount = Number(action.scroll_amount);
        }

        // Handle wait duration
        if (action.duration_ms) {
          normalized.duration_ms = Number(action.duration_ms);
        }

        // Handle done/fail reason
        if (action.reason) {
          normalized.reason = String(action.reason);
        }

        return normalized;
      })
      .filter(action => 
        ['click', 'type', 'scroll', 'press', 'wait', 'done', 'fail'].includes(action.type)
      );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const luxApiClient = new LuxApiClient();
