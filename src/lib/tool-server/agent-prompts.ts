// ============================================================
// AGENT PROMPTS - Configuration for Browser Orchestrator
// ============================================================

/**
 * PLANNER AGENT SYSTEM PROMPT - REMOVED
 * 
 * The Planner LLM has been removed from the browser_orchestrator architecture.
 * 
 * NEW ARCHITECTURE:
 * - The Agent (with its Knowledge Base) creates the plan directly
 * - browser_orchestrator is now a pure executor (validates + forwards plan)
 * - This reduces LLM calls from 2 to 1
 * - Plans are more accurate because the Agent has domain-specific KB
 * 
 * The Agent's system prompt should include instructions on how to create
 * browser automation plans. Example:
 * 
 * ```
 * ## QUANDO USI browser_orchestrator
 * 
 * Tu sei il Planner! Crea il piano usando la tua conoscenza del sito.
 * 
 * Struttura piano:
 * {
 *   "analysis": "Analisi della situazione",
 *   "goal": "Obiettivo finale",
 *   "steps": [
 *     {
 *       "step_number": 1,
 *       "action_type": "click|type|scroll|keypress|wait|navigate",
 *       "target_description": "Descrizione VISIVA dell'elemento",
 *       "input_value": "Per type/keypress: testo. Per navigate: URL",
 *       "fallback_description": "Alternativa",
 *       "expected_result": "Cosa succede dopo"
 *     }
 *   ],
 *   "success_criteria": "Come verificare completamento"
 * }
 * ```
 */

/**
 * Browser Orchestrator executor configuration
 * (No longer needs LLM config since it's now purely deterministic)
 */
export const BROWSER_ORCHESTRATOR_CONFIG = {
  maxSteps: 20,
  validActionTypes: ['click', 'type', 'scroll', 'keypress', 'wait', 'navigate'] as const,
  defaultConfig: {
    max_steps: 10,
    vision_fallback_enabled: true,
    confidence_threshold: 0.7,
    loop_detection_threshold: 3
  }
};

/**
 * Example system prompt section for agents that use browser_orchestrator
 * Include this in your agent's system_prompt to enable proper planning
 */
export const BROWSER_PLANNING_INSTRUCTIONS = `
## BROWSER AUTOMATION con browser_orchestrator

Quando devi automatizzare task nel browser, usa il tool \`browser_orchestrator\`.
TU sei il Planner: crea il piano usando la tua Knowledge Base del sito.

### Struttura del Piano

\`\`\`json
{
  "analysis": "Breve analisi della situazione attuale",
  "goal": "Obiettivo finale da raggiungere",
  "steps": [
    {
      "step_number": 1,
      "action_type": "click|type|scroll|keypress|wait|navigate",
      "target_description": "Descrizione VISIVA dell'elemento (colore, posizione, testo)",
      "input_value": "Per type: testo. Per keypress: tasto (Enter, Tab). Per navigate: URL",
      "fallback_description": "Descrizione alternativa se il primo tentativo fallisce",
      "expected_result": "Cosa dovrebbe succedere dopo questa azione"
    }
  ],
  "success_criteria": "Come verificare che il task sia completato"
}
\`\`\`

### Regole per target_description
- Usa descrizioni VISIVE che un sistema di visione può identificare
- Includi: colore, posizione nella pagina, testo visibile, icone
- Esempi:
  - "Bottone rosso con scritta 'Compose' in alto a sinistra"
  - "Campo di input con placeholder 'Search...'"
  - "Icona ingranaggio nel menu in alto a destra"

### Action Types
- \`click\`: Clicca su un elemento
- \`type\`: Digita testo (richiede input_value)
- \`scroll\`: Scrolla la pagina (target_description: "scroll down/up")
- \`navigate\`: Vai a URL (input_value: l'URL)
- \`wait\`: Attendi (input_value: millisecondi, es: "2000")
- \`keypress\`: Premi tasto (input_value: "Enter", "Tab", "Escape")

### Best Practices
1. Crea il MINIMO numero di step necessari
2. Ogni step deve essere atomico e verificabile
3. Usa la tua KB per descrizioni precise degli elementi
4. Fornisci sempre fallback_description alternative
`;
