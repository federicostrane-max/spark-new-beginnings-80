-- Remove redundant 'instruction' column from lux_todos
-- This field duplicates 'todo_description' and is not used by Lux API

ALTER TABLE public.lux_todos DROP COLUMN IF EXISTS instruction;

-- Add comment to clarify action_* fields are for POST-EXECUTION tracking only
COMMENT ON COLUMN public.lux_todos.action_type IS 'POST-EXECUTION tracking only. Populated AFTER Lux executes, NOT used as input to Lux API.';
COMMENT ON COLUMN public.lux_todos.action_target IS 'POST-EXECUTION tracking only. Populated AFTER Lux executes, NOT used as input to Lux API.';
COMMENT ON COLUMN public.lux_todos.action_value IS 'POST-EXECUTION tracking only. Populated AFTER Lux executes, NOT used as input to Lux API.';
COMMENT ON COLUMN public.lux_todos.todo_description IS 'High-level goal in English. Maps directly to Lux API todos[i] array element.';
COMMENT ON COLUMN public.lux_tasks.task_description IS 'Instruction in English. Maps to Lux API instruction (Actor/Thinker) or task (Tasker) parameter.';