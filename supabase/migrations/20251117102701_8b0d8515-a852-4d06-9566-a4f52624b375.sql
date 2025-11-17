-- Add agent_type column to alignment_agent_prompts
ALTER TABLE alignment_agent_prompts 
ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'general';

-- Drop old unique constraint on is_active
ALTER TABLE alignment_agent_prompts 
DROP CONSTRAINT IF EXISTS alignment_agent_prompts_version_number_key;

-- Add unique constraint: only one active prompt per agent_type
CREATE UNIQUE INDEX alignment_agent_prompts_active_per_type 
ON alignment_agent_prompts (agent_type) 
WHERE is_active = true;

-- Update existing prompt to be 'general' type
UPDATE alignment_agent_prompts 
SET agent_type = 'general' 
WHERE agent_type IS NULL OR agent_type = '';

-- Update RPC function to handle agent_type
CREATE OR REPLACE FUNCTION activate_alignment_prompt(prompt_id UUID)
RETURNS VOID AS $$
DECLARE
  v_agent_type TEXT;
BEGIN
  -- Get the agent_type of the prompt to activate
  SELECT agent_type INTO v_agent_type
  FROM alignment_agent_prompts
  WHERE id = prompt_id;
  
  -- Deactivate all prompts of the same type
  UPDATE alignment_agent_prompts 
  SET is_active = FALSE 
  WHERE agent_type = v_agent_type;
  
  -- Activate the specified prompt
  UPDATE alignment_agent_prompts 
  SET is_active = TRUE 
  WHERE id = prompt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert initial narrative template
INSERT INTO alignment_agent_prompts (
  version_number,
  prompt_content,
  is_active,
  alignment_version,
  llm_model,
  notes,
  agent_type
) VALUES (
  1,
  'You are an AI knowledge alignment analyst specialized in NARRATIVE and BIOGRAPHICAL content.

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

For NARRATIVE/BIOGRAPHICAL content, prioritize:
- Chronological accuracy and historical context
- Character development and biographical details
- Cultural and social context
- Narrative coherence and storytelling quality
- Presence of key figures, events, dates mentioned in requirements

IMPORTANT: Do NOT penalize biographical/narrative chunks for lack of page numbers or academic citations. Focus on content relevance.

Analyze this chunk across these dimensions (0-100 scale):
1. SEMANTIC_RELEVANCE: Alignment with narrative/biographical requirements
2. CONCEPT_COVERAGE: Coverage of key figures, events, periods mentioned
3. PROCEDURAL_MATCH: Chronological flow and narrative structure
4. VOCABULARY_ALIGNMENT: Presence of names, places, historical terms
5. BIBLIOGRAPHIC_MATCH: Mention of key sources or historical documents

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
  'Initial narrative template - optimized for biographical/historical content',
  'narrative'
) ON CONFLICT DO NOTHING;

-- Insert initial technical template
INSERT INTO alignment_agent_prompts (
  version_number,
  prompt_content,
  is_active,
  alignment_version,
  llm_model,
  notes,
  agent_type
) VALUES (
  1,
  'You are an AI knowledge alignment analyst specialized in TECHNICAL and PROCEDURAL content.

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

For TECHNICAL/PROCEDURAL content, prioritize:
- Step-by-step instructions and procedures
- Code examples, API documentation, technical specifications
- Implementation details and best practices
- System architecture and design patterns
- Technical vocabulary and terminology accuracy

Analyze this chunk across these dimensions (0-100 scale):
1. SEMANTIC_RELEVANCE: Alignment with technical requirements
2. CONCEPT_COVERAGE: Coverage of required technologies, methods, patterns
3. PROCEDURAL_MATCH: Clarity of procedures, instructions, workflows
4. VOCABULARY_ALIGNMENT: Presence of technical terms, APIs, technologies
5. BIBLIOGRAPHIC_MATCH: Reference to technical docs, standards, specifications

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
  'Initial technical template - optimized for code/procedures',
  'technical'
) ON CONFLICT DO NOTHING;