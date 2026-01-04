-- Make lux_model nullable for Gemini pipeline (which doesn't use Lux models)
ALTER TABLE lux_tasks ALTER COLUMN lux_model DROP NOT NULL;