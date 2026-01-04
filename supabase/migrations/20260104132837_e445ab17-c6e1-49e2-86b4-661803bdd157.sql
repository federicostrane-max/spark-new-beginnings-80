-- Gemini Computer Use Integration
-- Provider: 'lux' (default) o 'gemini'
ALTER TABLE lux_tasks ADD COLUMN IF NOT EXISTS computer_use_provider TEXT DEFAULT 'lux';

-- Opzioni Gemini-specific
ALTER TABLE lux_tasks ADD COLUMN IF NOT EXISTS headless BOOLEAN DEFAULT false;
ALTER TABLE lux_tasks ADD COLUMN IF NOT EXISTS highlight_mouse BOOLEAN DEFAULT false;

-- Persistent context (profilo browser custom) - opzionale
ALTER TABLE lux_tasks ADD COLUMN IF NOT EXISTS user_data_dir TEXT DEFAULT NULL;

-- Rendere lux_mode nullable (Gemini non lo usa)
ALTER TABLE lux_tasks ALTER COLUMN lux_mode DROP NOT NULL;