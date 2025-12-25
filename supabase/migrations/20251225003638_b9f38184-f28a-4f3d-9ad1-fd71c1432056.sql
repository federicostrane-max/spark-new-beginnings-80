-- 1. Rinomina max_steps → max_steps_per_todo e cambia default da 60 a 24
ALTER TABLE lux_tasks RENAME COLUMN max_steps TO max_steps_per_todo;
ALTER TABLE lux_tasks ALTER COLUMN max_steps_per_todo SET DEFAULT 24;

-- 2. Cambia default temperature da 0.1 a 0.0 (come API Lux ufficiale)
ALTER TABLE lux_tasks ALTER COLUMN temperature SET DEFAULT 0.0;

-- 3. Trigger per forzare lux_model = 'lux-actor-1' quando lux_mode = 'tasker'
CREATE OR REPLACE FUNCTION public.enforce_tasker_model()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lux_mode = 'tasker' THEN
    NEW.lux_model := 'lux-actor-1';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER enforce_tasker_model_trigger
BEFORE INSERT OR UPDATE ON lux_tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tasker_model();