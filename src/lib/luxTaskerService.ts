/**
 * Lux Tasker Service
 * 
 * Deterministic code that maps the AI optimizer agent's output
 * to the lux_tasks and lux_todos database tables.
 * 
 * Agent Output Format (Lux API terminology):
 * {
 *   instruction: string,      -> maps to task_description
 *   platform: "browser" | "desktop",
 *   start_url: string,
 *   todos: string[],          -> maps to lux_todos rows
 *   model: string,            -> maps to lux_model (overridden by trigger for tasker)
 *   max_steps_per_todo: number
 * }
 */

import { supabase } from "@/integrations/supabase/client";

// Type for the AI optimizer agent's output
export interface LuxAgentOutput {
  instruction: string;
  platform: "browser" | "desktop";
  start_url?: string;
  todos: string[];
  model?: string;
  max_steps_per_todo?: number;
}

// Type for saving a Lux Tasker workflow
export interface SaveLuxTaskerWorkflowParams {
  agentOutput: LuxAgentOutput;
  userRequest: string;
  userId: string;
  agentId?: string;
  conversationId?: string;
}

export interface SaveLuxTaskerWorkflowResult {
  success: boolean;
  taskId?: string;
  todosCreated?: number;
  error?: string;
}

/**
 * Saves a Lux Tasker workflow to the database.
 * Maps the AI optimizer agent's output to lux_tasks and lux_todos tables.
 * 
 * @param params - The parameters for saving the workflow
 * @returns Result with taskId and number of todos created
 */
export async function saveLuxTaskerWorkflow(
  params: SaveLuxTaskerWorkflowParams
): Promise<SaveLuxTaskerWorkflowResult> {
  const { agentOutput, userRequest, userId, agentId, conversationId } = params;

  try {
    // 1. Insert into lux_tasks with field mapping
    const { data: task, error: taskError } = await supabase
      .from("lux_tasks")
      .insert({
        // Required fields
        user_id: userId,
        user_request: userRequest,
        lux_mode: "tasker", // Hardcoded for Tasker mode
        
        // Mapped from agent output
        task_description: agentOutput.instruction,
        platform: agentOutput.platform,
        start_url: agentOutput.start_url || null,
        
        // lux_model is set by trigger when lux_mode='tasker'
        // but we can still pass it (trigger will enforce 'lux-actor-1')
        lux_model: agentOutput.model || "lux-actor-1",
        
        // Optional overrides
        max_steps_per_todo: agentOutput.max_steps_per_todo ?? 24,
        
        // Optional references
        agent_id: agentId || null,
        conversation_id: conversationId || null,
        
        // Initial status
        status: "pending",
        progress: 0,
      })
      .select("id")
      .single();

    if (taskError) {
      console.error("[LuxTaskerService] Error creating task:", taskError);
      return {
        success: false,
        error: `Failed to create task: ${taskError.message}`,
      };
    }

    const taskId = task.id;

    // 2. Transform todos array into lux_todos rows
    const todosToInsert = agentOutput.todos.map((todoDescription, index) => ({
      task_id: taskId,
      todo_index: index,
      todo_description: todoDescription,
      status: "pending",
    }));

    // 3. Insert all todos
    const { error: todosError } = await supabase
      .from("lux_todos")
      .insert(todosToInsert);

    if (todosError) {
      console.error("[LuxTaskerService] Error creating todos:", todosError);
      
      // Cleanup: delete the task since todos failed
      await supabase.from("lux_tasks").delete().eq("id", taskId);
      
      return {
        success: false,
        error: `Failed to create todos: ${todosError.message}`,
      };
    }

    console.log(
      `[LuxTaskerService] Created task ${taskId} with ${todosToInsert.length} todos`
    );

    return {
      success: true,
      taskId,
      todosCreated: todosToInsert.length,
    };
  } catch (error) {
    console.error("[LuxTaskerService] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Parses the AI agent's JSON output safely.
 * Returns null if parsing fails or validation fails.
 */
export function parseAgentOutput(jsonString: string): LuxAgentOutput | null {
  try {
    const parsed = JSON.parse(jsonString);
    
    // Validate required fields
    if (typeof parsed.instruction !== "string" || !parsed.instruction.trim()) {
      console.error("[LuxTaskerService] Invalid instruction field");
      return null;
    }
    
    if (!["browser", "desktop"].includes(parsed.platform)) {
      console.error("[LuxTaskerService] Invalid platform field");
      return null;
    }
    
    if (!Array.isArray(parsed.todos) || parsed.todos.length === 0) {
      console.error("[LuxTaskerService] Invalid todos field");
      return null;
    }
    
    // Validate all todos are non-empty strings
    if (!parsed.todos.every((t: unknown) => typeof t === "string" && t.trim())) {
      console.error("[LuxTaskerService] Invalid todo items");
      return null;
    }
    
    return {
      instruction: parsed.instruction.trim(),
      platform: parsed.platform,
      start_url: parsed.start_url?.trim() || undefined,
      todos: parsed.todos.map((t: string) => t.trim()),
      model: parsed.model?.trim() || undefined,
      max_steps_per_todo: 
        typeof parsed.max_steps_per_todo === "number" 
          ? parsed.max_steps_per_todo 
          : undefined,
    };
  } catch (error) {
    console.error("[LuxTaskerService] Failed to parse agent output:", error);
    return null;
  }
}
