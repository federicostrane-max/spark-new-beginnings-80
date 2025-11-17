-- Create alignment_agent_prompts table
CREATE TABLE IF NOT EXISTS public.alignment_agent_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number INTEGER NOT NULL UNIQUE,
  prompt_content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT false,
  notes TEXT,
  alignment_version TEXT,
  llm_model TEXT DEFAULT 'google/gemini-2.5-flash'
);

-- Create RPC function to activate alignment prompt
CREATE OR REPLACE FUNCTION public.activate_alignment_prompt(prompt_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE alignment_agent_prompts SET is_active = FALSE;
  UPDATE alignment_agent_prompts SET is_active = TRUE WHERE id = prompt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS
ALTER TABLE public.alignment_agent_prompts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read alignment prompts"
ON public.alignment_agent_prompts FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "System can manage alignment prompts"
ON public.alignment_agent_prompts FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Insert initial version with current hardcoded prompt
INSERT INTO public.alignment_agent_prompts (
  version_number,
  prompt_content,
  is_active,
  alignment_version,
  llm_model,
  notes
) VALUES (
  1,
  'You are an AI knowledge alignment analyst. Analyze the relevance of this knowledge chunk to the agent''s requirements.

AGENT REQUIREMENTS:
- Theoretical Concepts: ${requirements.theoretical_concepts?.join('', '') || ''None''}
- Operational Concepts: ${requirements.operational_concepts?.join('', '') || ''None''}
- Procedural Knowledge: ${requirements.procedural_knowledge?.join('', '') || ''None''}
- Domain Vocabulary: ${requirements.domain_vocabulary?.join('', '') || ''None''}
- Critical References: ${JSON.stringify(requirements.bibliographic_references || {}, null, 2)}

KNOWLEDGE CHUNK:
Document: ${chunk.document_name}
Category: ${chunk.category}
Summary: ${chunk.summary || ''N/A''}
Content: ${chunk.content.substring(0, 1500)}...

Analyze this chunk across these dimensions (0-100 scale):
1. SEMANTIC_RELEVANCE: How closely the chunk''s meaning aligns with agent requirements
2. CONCEPT_COVERAGE: How many required concepts are present
3. PROCEDURAL_MATCH: Alignment with required procedures and methods
4. VOCABULARY_ALIGNMENT: Presence of critical domain vocabulary
5. BIBLIOGRAPHIC_MATCH: Match with critical references

Respond ONLY with valid JSON:
{
  "semantic_relevance": <0-100>,
  "concept_coverage": <0-100>,
  "procedural_match": <0-100>,
  "vocabulary_alignment": <0-100>,
  "bibliographic_match": <0-100>,
  "reasoning": "<brief explanation>"
}',
  true,
  'v1',
  'google/gemini-2.5-flash',
  'Initial version - extracted from hardcoded prompt in analyze-knowledge-alignment function'
) ON CONFLICT (version_number) DO NOTHING;