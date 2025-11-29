/**
 * CONTEXT ANALYZER - Il "Director" per documenti PDF
 * Analizza il testo estratto per determinare dominio e focus
 * Replica il pattern Director-Analyst utilizzato per i video
 */

export interface DocumentContext {
  domain: string;           // "trading", "finance", "architecture", "legal", "medical", etc.
  focusElements: string[];  // Elementi specifici da cercare nelle immagini
  terminology: string[];    // Terminologia tecnica del settore
  verbosity: 'pedantic' | 'conceptual';  // Livello di dettaglio richiesto
}

const CONTEXT_ANALYZER_PROMPT = `
Sei un analista esperto che prepara istruzioni per l'analisi visiva di documenti.

COMPITO: Analizza questo estratto di testo per determinare:

1. DOMINIO: L'argomento preciso del documento
   Esempi: trading, finanza, architettura, ingegneria, medicina, legale, scientifico, etc.

2. ELEMENTI VISIVI CRITICI: Se il documento contiene grafici/tabelle/figure, 
   quali dettagli visivi saranno essenziali?
   - Trading/Finanza: candlestick patterns, indicatori tecnici (SMA, EMA, RSI), livelli di prezzo
   - Architettura: dimensioni stanze, orientamento, materiali, scale
   - Medicina: valori diagnostici, referti, anatomia
   - Ingegneria: misure tecniche, tolleranze, specifiche

3. TERMINOLOGIA: Quali termini tecnici sono usati nel documento?

4. CALIBRAZIONE VERBOSITÀ:
   - PEDANTIC: Per documenti tecnici dove ogni numero/valore conta
   - CONCEPTUAL: Per documenti discorsivi dove contano i concetti

OUTPUT (JSON):
{
  "domain": "nome_dominio",
  "focusElements": ["elemento1", "elemento2", ...],
  "terminology": ["termine1", "termine2", ...],
  "verbosity": "pedantic" | "conceptual"
}

Rispondi SOLO con il JSON, senza preamboli.
`;

/**
 * Analizza il contesto del documento per calibrare l'analisi visiva
 * @param textSample Primi 2000 caratteri del documento
 * @param anthropicKey Anthropic API key
 * @returns Contesto del documento (dominio, elementi focus, terminologia, verbosità)
 */
export async function analyzeDocumentContext(
  textSample: string,
  anthropicKey: string
): Promise<DocumentContext> {
  console.log('[Context Analyzer] Analyzing document domain...');
  console.log(`[Context Analyzer] Text sample: ${textSample.length} chars`);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // Fast model for quick analysis
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `${CONTEXT_ANALYZER_PROMPT}\n\n--- TESTO DOCUMENTO ---\n${textSample}`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const jsonText = result.content?.[0]?.text || '{}';
    
    // Clean JSON from markdown code blocks
    const cleanJson = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const context = JSON.parse(cleanJson);
    
    console.log(`[Context Analyzer] Domain detected: ${context.domain}`);
    console.log(`[Context Analyzer] Focus elements: ${context.focusElements?.join(', ') || 'none'}`);
    console.log(`[Context Analyzer] Verbosity: ${context.verbosity || 'conceptual'}`);
    
    return context;

  } catch (error) {
    console.warn('[Context Analyzer] Failed to analyze context, using generic fallback:', error);
    
    // Fallback generico
    return {
      domain: 'general',
      focusElements: ['text', 'numbers', 'structure'],
      terminology: [],
      verbosity: 'conceptual'
    };
  }
}
