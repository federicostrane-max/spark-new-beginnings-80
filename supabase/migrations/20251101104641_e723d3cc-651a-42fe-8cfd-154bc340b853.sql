-- Enable vector extension for RAG
CREATE EXTENSION IF NOT EXISTS vector;

-- Create app_role enum for user roles
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Table: agent_knowledge (Knowledge Base with RAG)
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_knowledge_embedding_idx 
  ON agent_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE agent_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read knowledge" ON agent_knowledge;
CREATE POLICY "Authenticated users can read knowledge"
  ON agent_knowledge FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert knowledge" ON agent_knowledge;
CREATE POLICY "Authenticated users can insert knowledge"
  ON agent_knowledge FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update knowledge" ON agent_knowledge;
CREATE POLICY "Authenticated users can update knowledge"
  ON agent_knowledge FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete knowledge" ON agent_knowledge;
CREATE POLICY "Authenticated users can delete knowledge"
  ON agent_knowledge FOR DELETE TO authenticated USING (true);

-- Function: match_documents() for semantic search
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding VECTOR(1536),
  filter_agent_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  document_name TEXT,
  content TEXT,
  category TEXT,
  summary TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    document_name,
    content,
    category,
    summary,
    1 - (embedding <=> query_embedding) AS similarity
  FROM agent_knowledge
  WHERE embedding IS NOT NULL
    AND (filter_agent_id IS NULL OR agent_id = filter_agent_id)
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Table: agent_config (Custom system prompts)
CREATE TABLE IF NOT EXISTS agent_config (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  custom_system_prompt TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read config" ON agent_config;
CREATE POLICY "Authenticated users can read config"
  ON agent_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can upsert config" ON agent_config;
CREATE POLICY "Authenticated users can upsert config"
  ON agent_config FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update config" ON agent_config;
CREATE POLICY "Authenticated users can update config"
  ON agent_config FOR UPDATE TO authenticated USING (true);

-- Table: pdf_exports (Export PDF history)
CREATE TABLE IF NOT EXISTS pdf_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_size_bytes INT,
  conversations_count INT DEFAULT 0,
  messages_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pdf_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view all exports" ON pdf_exports;
CREATE POLICY "Authenticated users can view all exports"
  ON pdf_exports FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert exports" ON pdf_exports;
CREATE POLICY "Users can insert exports"
  ON pdf_exports FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can update exports" ON pdf_exports;
CREATE POLICY "Users can update exports"
  ON pdf_exports FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can delete their own exports" ON pdf_exports;
CREATE POLICY "Users can delete their own exports"
  ON pdf_exports FOR DELETE TO authenticated USING (user_id = auth.uid()::text);

-- Table: user_roles (Admin/User system)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
CREATE POLICY "Users can view their own roles"
  ON user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Function: has_role() for role checking
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('agent-attachments', 'agent-attachments', true),
  ('pdf-exports', 'pdf-exports', true),
  ('knowledge-pdfs', 'knowledge-pdfs', true),
  ('knowledge-images', 'knowledge-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for agent-attachments
DROP POLICY IF EXISTS "Authenticated users can upload attachments" ON storage.objects;
CREATE POLICY "Authenticated users can upload attachments"
  ON storage.objects FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'agent-attachments');

DROP POLICY IF EXISTS "Anyone can view attachments" ON storage.objects;
CREATE POLICY "Anyone can view attachments"
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'agent-attachments');

DROP POLICY IF EXISTS "Users can delete their attachments" ON storage.objects;
CREATE POLICY "Users can delete their attachments"
  ON storage.objects FOR DELETE TO authenticated 
  USING (bucket_id = 'agent-attachments');

-- Storage policies for pdf-exports
DROP POLICY IF EXISTS "Authenticated users can upload exports" ON storage.objects;
CREATE POLICY "Authenticated users can upload exports"
  ON storage.objects FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'pdf-exports');

DROP POLICY IF EXISTS "Anyone can view exports" ON storage.objects;
CREATE POLICY "Anyone can view exports"
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'pdf-exports');

DROP POLICY IF EXISTS "Users can delete exports" ON storage.objects;
CREATE POLICY "Users can delete exports"
  ON storage.objects FOR DELETE TO authenticated 
  USING (bucket_id = 'pdf-exports');

-- Storage policies for knowledge-pdfs
DROP POLICY IF EXISTS "Authenticated users can upload knowledge PDFs" ON storage.objects;
CREATE POLICY "Authenticated users can upload knowledge PDFs"
  ON storage.objects FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'knowledge-pdfs');

DROP POLICY IF EXISTS "Anyone can view knowledge PDFs" ON storage.objects;
CREATE POLICY "Anyone can view knowledge PDFs"
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'knowledge-pdfs');

DROP POLICY IF EXISTS "Authenticated users can delete knowledge PDFs" ON storage.objects;
CREATE POLICY "Authenticated users can delete knowledge PDFs"
  ON storage.objects FOR DELETE TO authenticated 
  USING (bucket_id = 'knowledge-pdfs');

-- Storage policies for knowledge-images
DROP POLICY IF EXISTS "Authenticated users can upload knowledge images" ON storage.objects;
CREATE POLICY "Authenticated users can upload knowledge images"
  ON storage.objects FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'knowledge-images');

DROP POLICY IF EXISTS "Anyone can view knowledge images" ON storage.objects;
CREATE POLICY "Anyone can view knowledge images"
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'knowledge-images');

DROP POLICY IF EXISTS "Authenticated users can delete knowledge images" ON storage.objects;
CREATE POLICY "Authenticated users can delete knowledge images"
  ON storage.objects FOR DELETE TO authenticated 
  USING (bucket_id = 'knowledge-images');