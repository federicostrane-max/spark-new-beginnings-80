-- Fix overly permissive RLS policies on agent_knowledge and agent_config tables

-- ============================================
-- Fix agent_knowledge table policies
-- ============================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read knowledge" ON agent_knowledge;
DROP POLICY IF EXISTS "Authenticated users can insert knowledge" ON agent_knowledge;
DROP POLICY IF EXISTS "Authenticated users can update knowledge" ON agent_knowledge;
DROP POLICY IF EXISTS "Authenticated users can delete knowledge" ON agent_knowledge;

-- Create ownership-based policies
CREATE POLICY "Users can read their own agent knowledge"
  ON agent_knowledge FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_knowledge.agent_id
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

CREATE POLICY "Users can insert knowledge for their agents"
  ON agent_knowledge FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_knowledge.agent_id
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

CREATE POLICY "Users can update their own agent knowledge"
  ON agent_knowledge FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_knowledge.agent_id
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

CREATE POLICY "Users can delete their own agent knowledge"
  ON agent_knowledge FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_knowledge.agent_id
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

-- ============================================
-- Fix agent_config table policies
-- ============================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read config" ON agent_config;
DROP POLICY IF EXISTS "Authenticated users can update config" ON agent_config;
DROP POLICY IF EXISTS "Authenticated users can upsert config" ON agent_config;

-- Create ownership-based policies
CREATE POLICY "Users can read their own agent config"
  ON agent_config FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_config.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert config for their agents"
  ON agent_config FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_config.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own agent config"
  ON agent_config FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_config.agent_id
      AND agents.user_id = auth.uid()
    )
  );