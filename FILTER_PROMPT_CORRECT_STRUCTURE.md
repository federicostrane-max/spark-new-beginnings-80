# Filter Prompt Corretto per Extract Task Requirements

Il prompt attivo (v9) ha un JSON di esempio SBAGLIATO che confonde il modello.

## Struttura Output CORRETTA Richiesta

La funzione `extract-task-requirements` si aspetta questo formato:

```json
{
  "theoretical_concepts": [
    "concept 1",
    "concept 2"
  ],
  "operational_concepts": [
    "concept 1",
    "concept 2"
  ],
  "procedural_knowledge": [
    "procedure 1",
    "procedure 2"
  ],
  "explicit_rules": [
    "rule 1",
    "rule 2"
  ],
  "domain_vocabulary": [
    "term 1",
    "term 2"
  ],
  "bibliographic_references": [
    {
      "title": "Paper Title",
      "authors": "Authors",
      "year": "Year",
      "relevance": "Why relevant"
    }
  ]
}
```

## Prompt Corretto da Usare

```
You are an AI assistant analyzing an agent's system prompt to extract its TASK REQUIREMENTS in a structured JSON format.

AGENT SYSTEM PROMPT TO ANALYZE:
${agent.system_prompt}

Extract the following categories from the prompt above:

1. **theoretical_concepts**: Abstract concepts, theories, or principles mentioned
2. **operational_concepts**: Practical operational approaches or methodologies
3. **procedural_knowledge**: Step-by-step procedures, workflows, or processes
4. **explicit_rules**: Clear rules, constraints, or guidelines
5. **domain_vocabulary**: Specialized terms, jargon, or domain-specific language
6. **bibliographic_references**: Any references to papers, books, or external sources (with title, authors, year if mentioned)

CRITICAL: Return ONLY valid JSON in this EXACT structure:

{
  "theoretical_concepts": ["concept1", "concept2"],
  "operational_concepts": ["concept1", "concept2"],
  "procedural_knowledge": ["procedure1", "procedure2"],
  "explicit_rules": ["rule1", "rule2"],
  "domain_vocabulary": ["term1", "term2"],
  "bibliographic_references": [
    {"title": "Title", "authors": "Authors", "year": "Year", "relevance": "Why relevant"}
  ]
}

RULES:
- Each field MUST be an array
- If no items for a category, use empty array []
- Do NOT include any explanatory text before or after the JSON
- Do NOT wrap in markdown code blocks
- Return pure JSON only
```
