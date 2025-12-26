-- 1. Nuova funzione consolidata set_lux_defaults()
CREATE OR REPLACE FUNCTION public.set_lux_defaults()
RETURNS TRIGGER AS $$
BEGIN
  -- Tasker mode: forza actor model
  IF NEW.lux_mode = 'tasker' THEN
    NEW.lux_model := 'lux-actor-1';
  END IF;
  
  -- Default max_steps se NULL
  IF NEW.max_steps_per_todo IS NULL THEN
    NEW.max_steps_per_todo := 24;
  END IF;
  
  -- Default temperature se NULL  
  IF NEW.temperature IS NULL THEN
    NEW.temperature := 0.0;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Rimuovi vecchio trigger
DROP TRIGGER IF EXISTS enforce_tasker_model_trigger ON lux_tasks;

-- 3. Crea nuovo trigger consolidato
CREATE TRIGGER trg_set_lux_defaults
BEFORE INSERT OR UPDATE ON lux_tasks
FOR EACH ROW EXECUTE FUNCTION set_lux_defaults();

-- 4. Aggiungi CHECK constraints per validazione range
ALTER TABLE lux_tasks 
ADD CONSTRAINT chk_max_steps_per_todo 
CHECK (max_steps_per_todo >= 1 AND max_steps_per_todo <= 100);

ALTER TABLE lux_tasks 
ADD CONSTRAINT chk_temperature 
CHECK (temperature >= 0.0 AND temperature <= 1.0);