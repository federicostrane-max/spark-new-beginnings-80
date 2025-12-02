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
You are an expert analyst preparing instructions for visual document analysis.

TASK: Analyze this text excerpt to determine:

1. DOMAIN: The precise document subject matter
   IMPORTANT - You MUST return one of these EXACT English values:
   - "finance" (for 10-K reports, annual reports, balance sheets, income statements, financial statements)
   - "trading" (for trading charts, candlestick analysis, technical indicators)
   - "architecture" (for building plans, floor plans, architectural drawings)
   - "medical" (for medical reports, diagnostics, lab results)
   - "legal" (for contracts, legal documents, agreements)
   - "science" (for scientific papers, research documents)
   - "general" (if none of the above clearly applies)

2. VISUAL ELEMENTS: If the document contains charts/tables/figures,
   which visual details will be essential?
   - Finance: financial tables, revenue figures, balance sheet items, year-over-year comparisons
   - Trading: candlestick patterns, technical indicators (SMA, EMA, RSI), price levels
   - Architecture: room dimensions, orientation, materials, scale
   - Medical: diagnostic values, reports, anatomy
   - Engineering: technical measurements, tolerances, specifications

3. TERMINOLOGY: Which technical terms are used in the document?

4. VERBOSITY CALIBRATION:
   - PEDANTIC: For technical documents where every number/value matters
   - CONCEPTUAL: For discursive documents where concepts matter

OUTPUT (JSON):
{
  "domain": "one_of_the_exact_values_listed_above",
  "focusElements": ["element1", "element2", ...],
  "terminology": ["term1", "term2", ...],
  "verbosity": "pedantic" | "conceptual"
}

Respond ONLY with the JSON, no preamble.
`;

/**
 * Rilevamento rapido dominio 'trading_view_pro' basato su keyword
 * Bypassa l'analisi LLM se keywords specifiche sono presenti
 */
function detectTradingViewPro(textSample: string, fileName?: string): boolean {
  const tradingKeywords = [
    'tradingview', 'btc', 'usd', 'candlestick', 'ema', 'sma', 
    'rsi', 'obv', 'macd', 'bollinger', 'support', 'resistance',
    'breakout', 'divergence', 'golden cross', 'death cross',
    'bullish', 'bearish', 'chart', 'indicator', 'oscillator'
  ];
  
  const textLower = textSample.toLowerCase();
  const fileNameLower = (fileName || '').toLowerCase();
  
  // Check filename for trading indicators
  if (fileNameLower.includes('tv_') || fileNameLower.includes('trading')) {
    return true;
  }
  
  // Count keyword matches
  const matchCount = tradingKeywords.filter(kw => 
    textLower.includes(kw) || fileNameLower.includes(kw)
  ).length;
  
  return matchCount >= 2; // At least 2 keywords = trading context
}

/**
 * Analizza il contesto del documento per calibrare l'analisi visiva
 * @param textSample Primi 2000 caratteri del documento
 * @param anthropicKey Anthropic API key
 * @param fileName Nome del file (opzionale) per early detection
 * @returns Contesto del documento (dominio, elementi focus, terminologia, verbosità)
 */
export async function analyzeDocumentContext(
  textSample: string,
  anthropicKey: string,
  fileName?: string
): Promise<DocumentContext> {
  console.log('[Context Analyzer] Analyzing document domain...');
  console.log(`[Context Analyzer] Text sample: ${textSample.length} chars`);

  // EARLY DETECTION: TradingView Pro
  if (detectTradingViewPro(textSample, fileName)) {
    console.log('[Context Analyzer] TradingView Pro detected via keywords!');
    return {
      domain: 'trading_view_pro',
      focusElements: [
        'candlestick patterns', 'moving averages', 'support/resistance levels',
        'indicator values', 'oscillator readings', 'price action', 'volume'
      ],
      terminology: [
        'EMA', 'SMA', 'RSI', 'MACD', 'OBV', 'Bollinger Bands',
        'Golden Cross', 'Death Cross', 'Breakout', 'Divergence',
        'Support', 'Resistance', 'Neckline', 'Head and Shoulders'
      ],
      verbosity: 'pedantic'
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Fast model for quick analysis - Claude 4.5 family
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
    
    // NORMALIZE DOMAIN: Map variants to standard English keys
    const domainNormalization: Record<string, string> = {
      'finanza': 'finance',
      'financial': 'finance',
      'finanziario': 'finance',
      'contabilità': 'finance',
      'accounting': 'finance',
      'trading_view_pro': 'trading_view_pro',
      'trading': 'trading',
      'architettura': 'architecture',
      'architectural': 'architecture',
      'medicina': 'medical',
      'medico': 'medical',
      'healthcare': 'medical',
      'legale': 'legal',
      'contracts': 'legal',
      'scientifico': 'science',
      'scientific': 'science',
      'research': 'science',
      'scienza': 'science',
    };
    
    const rawDomain = (context.domain || 'general').toLowerCase().trim();
    context.domain = domainNormalization[rawDomain] || rawDomain;
    
    console.log(`[Context Analyzer] Domain detected: ${context.domain} (raw: ${rawDomain})`);
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
