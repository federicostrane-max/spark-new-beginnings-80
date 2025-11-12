-- Create table for filter agent prompts with version history
CREATE TABLE IF NOT EXISTS filter_agent_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number INTEGER NOT NULL DEFAULT 1,
  prompt_content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  is_active BOOLEAN DEFAULT FALSE,
  notes TEXT,
  filter_version TEXT
);

CREATE INDEX idx_filter_prompts_active ON filter_agent_prompts(is_active);
CREATE INDEX idx_filter_prompts_version ON filter_agent_prompts(version_number DESC);

COMMENT ON TABLE filter_agent_prompts IS 
'Storico dei prompt utilizzati dal filter agent (extract-task-requirements) per estrarre requisiti dai prompt degli agenti';

COMMENT ON COLUMN filter_agent_prompts.prompt_content IS 
'Contenuto editabile del prompt (solo la parte dopo "PROMPT COMPLETO")';

COMMENT ON COLUMN filter_agent_prompts.is_active IS 
'Solo un prompt può essere attivo alla volta';

-- Function to activate a specific prompt version
CREATE OR REPLACE FUNCTION activate_filter_prompt(prompt_id UUID)
RETURNS void AS $$
BEGIN
  -- Deactivate all prompts
  UPDATE filter_agent_prompts SET is_active = FALSE;
  
  -- Activate the specified prompt
  UPDATE filter_agent_prompts 
  SET is_active = TRUE 
  WHERE id = prompt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies
ALTER TABLE filter_agent_prompts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read filter prompts
CREATE POLICY "Allow authenticated read filter prompts"
ON filter_agent_prompts
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert/update filter prompts
CREATE POLICY "Allow authenticated manage filter prompts"
ON filter_agent_prompts
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Insert initial prompt (current hardcoded version)
INSERT INTO filter_agent_prompts (
  version_number,
  prompt_content,
  is_active,
  filter_version,
  notes
) VALUES (
  1,
  'Analyze this AI agent''s system prompt and extract its task requirements into a structured format.

System Prompt:
${agent.system_prompt}

Extract and categorize the following:

1. **Core Concepts**: Key domain concepts, entities, business rules, fundamental knowledge areas
   - Return as array of objects: {concept: string, importance: ''high''|''medium''|''low''}
   - Focus on fundamental knowledge topics, not examples or conversation structure
   - Do NOT include concepts from dialogue examples or user conversations

2. **Procedural Knowledge**: Step-by-step processes, workflows, methodologies, algorithms
   - Return as array of objects: {procedure: string, steps: string[], criticality: ''required''|''recommended''|''optional''}
   - Ignore example dialogues - focus only on actual procedures described in the prompt

3. **Decision Patterns**: Rules, decision trees, conditional logic, evaluation criteria
   - Return as array of objects: {pattern: string, conditions: string[], outcomes: string[]}
   - Must be actual decision-making rules, not examples of conversations

4. **Domain Vocabulary**: Specific terms, acronyms, jargon critical to the domain
   - Return as array of objects: {term: string, definition: string, aliases: string[]}
   - **STRICT FILTER**: Only include terms that are:
     * Domain-specific technical terms (NOT generic words like "analysis", "context", "quality")
     * Acronyms with explicit definitions in the prompt
     * Specialized jargon unique to this field
   - **EXCLUDE AGGRESSIVELY**:
     * Generic conversational terms (risposta, domanda, utente, agente, contesto)
     * Common academic/business words (analisi, sintesi, valutazione, documento)
     * Basic process words (ricerca, verifica, controllo)
     * Standard AI/tech terms (prompt, embedding, relevance, semantic)
   - Example VALID: "PNRR" (Piano Nazionale di Ripresa e Resilienza), "CAD" (Codice Amministrazione Digitale)
   - Example INVALID: "documento", "knowledge base", "analisi semantica"

5. **Bibliographic References** (CRITICAL - PREREQUISITE CHECK):
   - Return as array of objects: {title: string, author: string, year: string, type: ''critical''|''recommended''|''supplementary''}
   - **EXTRACT ONLY EXPLICIT BIBLIOGRAPHIC REFERENCES**:
     * Academic papers with authors/years (e.g., "Smith et al. (2020)")
     * Books with titles and authors (e.g., "The Art of Systems Thinking by Peter Senge")
     * Official documents with titles (e.g., "ISO 9001:2015 Standard")
     * Reports with identifiable sources (e.g., "World Bank Report 2021")
   - **DO NOT EXTRACT**:
     * Generic mentions of "literature" or "research" without specific citations
     * Vague references like "studies show" or "experts suggest"
     * Internal documentation or procedures without formal publication details
     * Website URLs or online resources without clear authorship
   - **CLASSIFICATION**:
     * type: ''critical'' = Explicitly stated as required/mandatory reading
     * type: ''recommended'' = Mentioned as useful reference material
     * type: ''supplementary'' = Optional or contextual references
   - **EXAMPLES**:
     * VALID: {"title": "Thinking, Fast and Slow", "author": "Daniel Kahneman", "year": "2011", "type": "recommended"}
     * VALID: {"title": "ISO 27001 Standard", "author": "ISO/IEC", "year": "2013", "type": "critical"}
     * INVALID: "relevant scientific literature" (too vague)
     * INVALID: "company best practices documentation" (not a formal publication)

**CRITICAL RULES**:
- **IGNORE ALL DIALOGUE EXAMPLES**: Do not extract concepts/vocabulary from example conversations between user/assistant
- **IGNORE CONVERSATIONAL INSTRUCTIONS**: Skip phrases like "rispondere educatamente", "utilizzare un tono professionale"
- **IGNORE META-INSTRUCTIONS**: Skip instructions about how to format responses or interact with users
- **AGGRESSIVE VOCABULARY FILTERING**: Only extract highly specialized domain terms, not common words
- **BIBLIOGRAPHIC PREREQUISITE**: If the prompt explicitly requires specific documents/papers, they MUST be marked as type: ''critical''

Return ONLY a valid JSON object with this exact structure:
{
  "core_concepts": [...],
  "procedural_knowledge": [...],
  "decision_patterns": [...],
  "domain_vocabulary": [...],
  "bibliographic_references": [...]
}',
  true,
  'v6',
  'Versione iniziale migrata da codice hardcoded. Include bibliographic_references e filtri domain_vocabulary aggressivi per evitare false positive.'
);