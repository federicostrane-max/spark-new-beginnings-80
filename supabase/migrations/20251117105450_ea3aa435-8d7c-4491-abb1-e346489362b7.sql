-- Add procedural template and fix domain-expert naming
INSERT INTO alignment_agent_prompts (
  agent_type,
  prompt_content,
  version_number,
  alignment_version,
  llm_model,
  notes,
  is_active
) VALUES 
-- Procedural template (new)
(
  'procedural',
  'Analyze this knowledge chunk against the agent''s procedural requirements.

Agent Requirements:
- Procedural Knowledge: ${requirements.procedural_knowledge.join(", ")}
- Operational Concepts: ${requirements.operational_concepts.join(", ")}
- Domain Vocabulary: ${requirements.domain_vocabulary.join(", ")}
- Theoretical Concepts: ${requirements.theoretical_concepts.join(", ")}
- Explicit Rules: ${requirements.explicit_rules.join(", ")}
- Bibliographic References: ${JSON.stringify(requirements.bibliographic_references)}

Knowledge Chunk to Analyze:
${chunk.content}

Document: ${chunk.document_name}
Category: ${chunk.category}

Evaluate this chunk on these dimensions (0.0-1.0):
1. **procedural_match**: How well does it align with the required procedural knowledge and operational concepts?
2. **concept_coverage**: Coverage of required theoretical and operational concepts
3. **vocabulary_alignment**: Use of domain-specific terminology
4. **semantic_relevance**: Overall relevance to the agent''s procedural domain
5. **bibliographic_match**: Quality and relevance of sources

Return ONLY valid JSON:
{
  "procedural_match": 0.0-1.0,
  "concept_coverage": 0.0-1.0,
  "vocabulary_alignment": 0.0-1.0,
  "semantic_relevance": 0.0-1.0,
  "bibliographic_match": 0.0-1.0,
  "reasoning": "Brief explanation focusing on procedural alignment"
}',
  1,
  '1.0',
  'google/gemini-2.5-flash',
  'Initial procedural template for step-by-step and instruction-based agents',
  true
),
-- Domain expert template (fix naming from domain_expert to domain-expert)
(
  'domain-expert',
  'Analyze this knowledge chunk against the agent''s specialized domain requirements.

Agent Requirements:
- Theoretical Concepts: ${requirements.theoretical_concepts.join(", ")}
- Domain Vocabulary: ${requirements.domain_vocabulary.join(", ")}
- Operational Concepts: ${requirements.operational_concepts.join(", ")}
- Procedural Knowledge: ${requirements.procedural_knowledge.join(", ")}
- Explicit Rules: ${requirements.explicit_rules.join(", ")}
- Bibliographic References: ${JSON.stringify(requirements.bibliographic_references)}

Knowledge Chunk to Analyze:
${chunk.content}

Document: ${chunk.document_name}
Category: ${chunk.category}

Evaluate this chunk on these dimensions (0.0-1.0):
1. **semantic_relevance**: Relevance to the specialized domain
2. **concept_coverage**: Coverage of domain-specific theoretical and operational concepts
3. **vocabulary_alignment**: Use of specialized terminology
4. **procedural_match**: Alignment with domain procedures and practices
5. **bibliographic_match**: Authority and quality of sources

Return ONLY valid JSON:
{
  "semantic_relevance": 0.0-1.0,
  "concept_coverage": 0.0-1.0,
  "vocabulary_alignment": 0.0-1.0,
  "procedural_match": 0.0-1.0,
  "bibliographic_match": 0.0-1.0,
  "reasoning": "Brief explanation focusing on domain expertise alignment"
}',
  1,
  '1.0',
  'google/gemini-2.5-flash',
  'Initial domain-expert template for specialized knowledge agents',
  true
);