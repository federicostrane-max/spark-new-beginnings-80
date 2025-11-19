-- Tabella per gestire cartelle come entità separate
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indice per ricerca veloce
CREATE INDEX idx_folders_name ON folders(name);

-- RLS policies
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read folders"
  ON folders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create folders"
  ON folders FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update folders"
  ON folders FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete folders"
  ON folders FOR DELETE
  TO authenticated
  USING (true);

-- Popola la tabella con le cartelle esistenti dai documenti
INSERT INTO folders (name)
SELECT DISTINCT folder
FROM knowledge_documents
WHERE folder IS NOT NULL
ON CONFLICT (name) DO NOTHING;