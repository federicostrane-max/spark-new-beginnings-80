import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Il Prompt Magico per Video-to-Markdown
const VIDEO_TO_MARKDOWN_PROMPT = `
Sei un assistente esperto nell'analisi di video tutorial educativi.

COMPITO:
Analizza questo video e genera un documento Markdown strutturato che contenga:

1. TRASCRIZIONE TEMPORALE
   - Trascrivi tutto il parlato con timestamp [MM:SS]
   - Usa heading Markdown standard (## per sezioni principali, ### per sotto-sezioni)
   - NON usare mai testo in grassetto (**...**) per i titoli - usa SOLO heading ## o ###
   - Usa paragrafi per il flusso naturale del discorso

2. ELEMENTI VISUALI (CRITICO!)
   Quando nel video appare un supporto visivo:

   a) TABELLE → Converti in tabella Markdown:
      | Colonna 1 | Colonna 2 |
      |-----------|-----------|
      | dato 1    | dato 2    |

   b) GRAFICI → Descrivi dettagliatamente con heading:
      ## [MM:SS] Grafico - Titolo
      - Tipo: (barre, linee, torta, etc.)
      - Assi: X = ..., Y = ...
      - Trend: descrivilo
      - Valori chiave: elencali

   c) SLIDE/DIAGRAMMI → Estrai tutti i testi e la struttura

   d) CODICE → Formatta come code block con linguaggio

3. FORMATO OUTPUT
   Genera Markdown valido e ben strutturato.
   Usa SOLO heading standard (## e ###) per tutti i titoli di sezione.
   VIETATO usare testo in grassetto (**...**) per i titoli.
   Includi sempre il timestamp nei heading quando cambia sezione o appare contenuto visivo.
   
   Esempio corretto:
   ## [00:04] Introduzione
   ## [02:15] Livelli di Supporto
   ### [02:30] Dettaglio SMA 50

Inizia l'analisi:
`;

// Director Prompt per analisi preliminare del dominio (AGGIORNATO - Domain-Aware)
const DIRECTOR_PROMPT = `
Sei un analista esperto che prepara istruzioni per un'altra IA.

COMPITO: Analizza rapidamente questo video per capire:

1. DOMINIO: Classifica il video in UNA delle seguenti categorie:
   - **trading**: Grafici finanziari, candlestick, indicatori tecnici (SMA, EMA, RSI, MACD)
   - **architecture**: Video immobiliari, home tour, cantieri, planimetrie, rendering 3D
   - **medical**: Tutorial chirurgici, anatomia, valori diagnostici, procedure cliniche
   - **legal**: Deposizioni video, analisi contratti, documenti legali, firme
   - **finance**: Report finanziari animati, bilanci, presentazioni earnings, dati aziendali
   - **coding**: Programmazione, tutorial IDE, debugging, spiegazioni algoritmi
   - **diy**: Tutorial fai-da-te, ricette, fitness, hobby
   - **general**: Contenuto generico non specializzato

2. ELEMENTI VISIVI CRITICI: Quali dettagli visivi sono essenziali per la comprensione?
   - Se ci sono grafici: quali metriche/indicatori mostrano?
   - Se c'è codice: quale linguaggio/framework?
   - Se ci sono tabelle: cosa rappresentano i dati?
   - Se ci sono dimostrazioni fisiche: quali movimenti/posture sono importanti?

3. CALIBRAZIONE VERBOSITÀ:
   - Se identifichi un video TECNICO (es. trading, coding, analisi dati, medical, legal): 
     sii ESTREMAMENTE pedante sui dettagli (valori numerici esatti, sintassi precisa, timestamp di ogni variazione)
   - Se identifichi un video DISCORSIVO/VLOG (es. interviste, presentazioni, tutorial generici):
     focalizzati sui concetti chiave e salta i dettagli minori

OUTPUT RICHIESTO:
Inizia SEMPRE la risposta con:
DETECTED_DOMAIN: [nome_dominio]

Poi genera un System Prompt ottimizzato (max 500 parole) che istruisca un'altra IA 
a estrarre i dettagli specifici di QUESTO video. Il prompt deve:
- Specificare il ruolo esperto appropriato (es. "Agisci come trader professionista...", "Agisci come architetto...")
- Elencare esattamente quali dati numerici/visivi estrarre
- Indicare come formattare tabelle/grafici specifici del dominio
- Includere terminologia tecnica del settore
- Specificare il livello di dettaglio appropriato (pedante vs concettuale)

Rispondi con DETECTED_DOMAIN seguito dal System Prompt personalizzato.
`;

// Domain-specific enhancements per video (ispirato a visionEnhancer.ts)
const VIDEO_DOMAIN_ENHANCEMENTS: Record<string, string> = {
  'trading': `

=== ISTRUZIONI CRITICHE PER GRAFICI DI TRADING/FINANZIARI ===

**Usa lo stesso rigore della suite TradingView Pro.**

**SE IL VIDEO CONTIENE GRAFICI DI PREZZI CON INDICATORI TECNICI (SMA, EMA, Bande di Bollinger, RSI, MACD):**

DEVI ESTRARRE **OGNI SINGOLO PUNTO** in cui il prezzo tocca o incrocia un indicatore tecnico.

IMPORTANTE: Usa SOLO heading Markdown (## o ###) per organizzare i dati, MAI testo in grassetto (**...**) per i titoli.

Per OGNI touch point, specifica:
1. **Timestamp esatto**: [MM:SS]
2. **Prezzo esatto** al momento del tocco (es. €1.2345, $50.75, etc.)
3. **Indicatore coinvolto** (es. "SMA 20", "EMA 50", "Banda di Bollinger superiore")
4. **Direzione del tocco**: "from above" / "from below"
5. **Tipo di evento**: "Bounce" / "Breakout" / "Cross"

**FORMATO RICHIESTO:**
## [MM:SS] Touch Point Analysis
- [MM:SS] Price €X.XXXX touching [INDICATORE] from [above/below] → [Bounce/Breakout/Cross]

**Descrivi anche pattern di prezzo visibili** (Head & Shoulders, Double Top, Support/Resistance levels).

=== FINE ISTRUZIONI TRADING ===
`,

  'architecture': `

=== ISTRUZIONI CRITICHE PER VIDEO IMMOBILIARI/ARCHITETTONICI ===

**Descrivi il video come un Architetto o Agente Immobiliare esperto.**

STRUTTURA OBBLIGATORIA:
1. **Elenco Stanze Sequenziale**: Per ogni stanza mostrata, crea una sezione:
   ## [MM:SS] Nome Stanza (es. Salone, Cucina, Bagno Principale)
   - Dimensioni stimate (se visibili/menzionate)
   - Materiali: pavimenti (parquet, piastrelle, marmo), infissi (legno, PVC, alluminio)
   - Luminosità: naturale/artificiale, esposizione (Nord/Sud/Est/Ovest se deducibile)
   - Condizioni: stato di manutenzione, eventuali lavori necessari
   - Layout: disposizione mobili, aperture, collegamenti con altre stanze

2. **Planimetrie/Rendering**: Se mostrate nel video:
   - Trascrivi tutte le misure visibili
   - Nota la disposizione delle stanze
   - Identifica metratura totale se indicata

3. **Esterni**: Giardino, terrazzo, garage, posto auto

OUTPUT: Markdown strutturato per ogni ambiente, come un capitolato tecnico.

=== FINE ISTRUZIONI ARCHITECTURE ===
`,

  'medical': `

=== ISTRUZIONI CRITICHE PER VIDEO MEDICI/CLINICI ===

**Descrivi il video con rigore clinico da professionista sanitario.**

ESTRAI CON PRECISIONE:
1. **Procedure**: Nome della procedura, fasi sequenziali, strumentario utilizzato
2. **Anatomia**: Strutture anatomiche mostrate, con terminologia medica corretta
3. **Valori Diagnostici**: 
   - TUTTI i numeri mostrati (pressione, frequenza, saturazione, etc.)
   - Range di riferimento se indicati
   - Anomalie rispetto ai valori normali
4. **Farmaci/Dosaggi**: Se menzionati, trascrivi esattamente
5. **Immagini Diagnostiche**: Descrivi TAC, risonanze, ecografie con precisione

VERBOSITÀ: MASSIMA - ogni valore numerico è potenzialmente critico.

=== FINE ISTRUZIONI MEDICAL ===
`,

  'legal': `

=== ISTRUZIONI CRITICHE PER VIDEO LEGALI ===

**Analizza come un Avvocato o Consulente Legale.**

ESTRAI CON PRECISIONE:
1. **Identificazione Parti**: Nomi completi, ruoli, rappresentanti legali
2. **Riferimenti Documentali**: 
   - Numeri di protocollo, date, riferimenti a leggi/articoli
   - Citazioni testuali di clausole importanti
3. **Timeline**: Cronologia esatta degli eventi discussi
4. **Deposizioni**: Se video di deposizione:
   - Domande e risposte chiave
   - Timestamp di affermazioni rilevanti
5. **Documenti Mostrati**: Trascrivi titoli, date, firme visibili

FORMATO: Struttura adatta a uso forense con timestamp precisi.

=== FINE ISTRUZIONI LEGAL ===
`,

  'finance': `

=== ISTRUZIONI CRITICHE PER VIDEO FINANZIARI ===

**Analizza come un Analista Finanziario senior.**

ESTRAI CON PRECISIONE:
1. **Metriche Chiave**:
   - Revenue, EBITDA, Net Income, EPS
   - Variazioni YoY, QoQ
   - Margini (lordo, operativo, netto)
2. **Tabelle Finanziarie**: Converti SEMPRE in Markdown:
   | Metrica | Q1 2024 | Q1 2023 | Variazione |
   |---------|---------|---------|------------|
3. **Grafici**: Descrivi trend, punti di flesso, proiezioni
4. **Guidance**: Previsioni future, target, range indicati
5. **Rischi/Opportunità**: Note del management

VERBOSITÀ: MASSIMA per numeri, MEDIA per commenti qualitativi.

=== FINE ISTRUZIONI FINANCE ===
`,

  'coding': `

=== ISTRUZIONI PER VIDEO DI PROGRAMMAZIONE ===
- Identifica linguaggio/framework
- Estrai TUTTO il codice mostrato in code blocks con sintassi corretta
- Nota errori, warning, output console
- Documenta shortcuts/comandi usati

=== FINE ISTRUZIONI CODING ===
`,

  'diy': `

=== ISTRUZIONI PER VIDEO TUTORIAL/DIY ===
- Lista materiali/ingredienti con quantità
- Passi sequenziali numerati
- Note su tempi e temperature (se cucina)
- Consigli e trucchi menzionati

=== FINE ISTRUZIONI DIY ===
`,
};

// Funzione che INIETTA direttamente istruzioni specifiche nel prompt dell'Analyst
// AGGIORNATA per supportare TUTTI i domini rilevati dal Director
function enhanceAnalystPrompt(basePrompt: string, detectedDomain?: string): string {
  // Se il Director ha specificato un dominio, usalo
  // Altrimenti, cerca di dedurlo dal prompt stesso
  let domain = detectedDomain?.toLowerCase() || 'general';
  
  // Fallback: cerca keywords nel prompt se dominio non specificato
  if (!detectedDomain) {
    const promptLower = basePrompt.toLowerCase();
    if (promptLower.includes('trading') || promptLower.includes('candlestick') || promptLower.includes('sma')) {
      domain = 'trading';
    } else if (promptLower.includes('immobile') || promptLower.includes('stanza') || promptLower.includes('planimetria')) {
      domain = 'architecture';
    } else if (promptLower.includes('medic') || promptLower.includes('chirurg') || promptLower.includes('anatomia')) {
      domain = 'medical';
    } else if (promptLower.includes('legal') || promptLower.includes('contratto') || promptLower.includes('deposizione')) {
      domain = 'legal';
    } else if (promptLower.includes('revenue') || promptLower.includes('ebitda') || promptLower.includes('bilancio')) {
      domain = 'finance';
    } else if (promptLower.includes('codice') || promptLower.includes('programming') || promptLower.includes('debug')) {
      domain = 'coding';
    }
  }
  
  console.log(`[enhanceAnalystPrompt] Detected domain: ${domain}`);
  
  const enhancement = VIDEO_DOMAIN_ENHANCEMENTS[domain] || '';
  
  if (!enhancement) {
    console.log(`[enhanceAnalystPrompt] No specific enhancement for domain: ${domain}`);
    return basePrompt;
  }
  
  return basePrompt + '\n\n' + enhancement;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, fileUrl, fileSize, filePath } = await req.json();

    if (!fileName || !fileUrl || !filePath) {
      return new Response(
        JSON.stringify({ error: 'Missing fileName, fileUrl, or filePath' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Video Ingest] Processing: ${fileName} (${(fileSize / (1024*1024)).toFixed(1)} MB)`);
    console.log(`[Video Ingest] Storage path: ${filePath}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleApiKey = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');

    if (!googleApiKey) {
      throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // === FASE 1: Download video from Storage URL ===
    console.log('[Video Ingest] Downloading from Storage...');
    
    const videoResponse = await fetch(fileUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video from Storage: ${videoResponse.statusText}`);
    }
    
    const videoData = new Uint8Array(await videoResponse.arrayBuffer());
    console.log(`[Video Ingest] Downloaded ${videoData.length} bytes`);

    // === FASE 2: Upload to Gemini File API ===
    console.log('[Video Ingest] Uploading to Gemini File API...');

    // Step 2a: Initiate resumable upload
    const initResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(videoData.length),
          'X-Goog-Upload-Header-Content-Type': 'video/mp4',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file: { display_name: fileName }
        }),
      }
    );

    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error('Failed to get Gemini upload URL');
    }

    // Step 2b: Upload video data
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(videoData.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: videoData,
    });

    const fileInfo = await uploadResponse.json();
    const fileUri = fileInfo.file?.uri;
    const fileName_gemini = fileInfo.file?.name;

    if (!fileUri) {
      throw new Error('Failed to upload video to Gemini');
    }

    console.log(`[Video Ingest] Gemini file URI: ${fileUri}`);

    // === FASE 3: Poll until video is ACTIVE ===
    console.log('[Video Ingest] Waiting for video processing...');

    let fileState = 'PROCESSING';
    let attempts = 0;
    const maxAttempts = 60; // Max 5 minutes (5s * 60)

    while (fileState === 'PROCESSING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s

      const statusResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName_gemini}?key=${googleApiKey}`
      );
      const statusData = await statusResponse.json();
      fileState = statusData.state;
      attempts++;

      console.log(`[Video Ingest] File state: ${fileState} (attempt ${attempts})`);
    }

    if (fileState !== 'ACTIVE') {
      throw new Error(`Video processing failed. State: ${fileState}`);
    }

    // === FASE 4a: THE DIRECTOR - Analisi Dominio ===
    console.log('[Video Ingest] FASE 4a: Director - Analyzing domain...');

    let customPrompt: string | null = null;
    let detectedDomain: string | undefined; // NUOVO: scope esterno per uso globale

    try {
      const directorResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { file_data: { mime_type: 'video/mp4', file_uri: fileUri } },
                { text: DIRECTOR_PROMPT }
              ]
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2048,
            }
          }),
        }
      );

      const directorData = await directorResponse.json();
      customPrompt = directorData.candidates?.[0]?.content?.parts?.[0]?.text;

      // NUOVO: Estrai il dominio dal response del Director
      if (customPrompt) {
        const domainMatch = customPrompt.match(/DETECTED_DOMAIN:\s*(\w+)/i);
        if (domainMatch) {
          detectedDomain = domainMatch[1].toLowerCase();
          console.log(`[Video Ingest] Director detected domain: ${detectedDomain}`);
        }
        console.log(`[Video Ingest] Director generated ${customPrompt.length} char custom prompt`);
        console.log(`[Video Ingest] Custom Prompt Preview: ${customPrompt.substring(0, 300)}...`);
      } else {
        console.warn('[Video Ingest] Director returned empty response, using fallback');
      }
    } catch (directorError) {
      console.warn('[Video Ingest] Director failed, using fallback prompt:', directorError);
    }

    // === ENHANCEMENT: Inietta istruzioni specifiche nel prompt ===
    // Questa fase modifica il prompt DOPO il Director ma PRIMA dell'Analyst
    // AGGIORNATO: passa il dominio rilevato a enhanceAnalystPrompt
    const basePrompt = customPrompt || VIDEO_TO_MARKDOWN_PROMPT;
    const enhancedPrompt = enhanceAnalystPrompt(basePrompt, detectedDomain);
    
    console.log(`[Video Ingest] Prompt enhanced: ${basePrompt.length} → ${enhancedPrompt.length} chars`);
    if (detectedDomain) {
      console.log(`[Video Ingest] Domain-specific enhancement applied for: ${detectedDomain}`);
    }

    // === FASE 4b: THE ANALYST - Estrazione Dati ===
    console.log('[Video Ingest] FASE 4b: Analyst - Extracting with enhanced prompt...');

    // Combina prompt enhanced con istruzioni di output standard
    const analystPrompt = enhancedPrompt
      ? `${enhancedPrompt}

FORMATO OUTPUT OBBLIGATORIO:
- Genera Markdown valido e ben strutturato
- Usa heading Markdown standard (## per sezioni principali, ### per sotto-sezioni)
- VIETATO usare testo in grassetto (**...**) per titoli di sezione - usa SOLO ## o ###
- Usa timestamp [MM:SS] nei heading quando inizi nuove sezioni
- Tabelle in formato Markdown standard (|...|)
- Code blocks con linguaggio specificato (\`\`\`lang)
- Grafici descritti con heading ## [MM:SS] seguiti da lista puntata di dettagli

IMPORTANTE: NON wrappare l'output in code blocks (\`\`\`markdown o \`\`\`md).
Genera Markdown puro direttamente, senza delimitatori di blocco codice.
Le tabelle vanno scritte direttamente con sintassi |...|, non dentro \`\`\`markdown.

Esempio formato corretto per sezioni:
## [00:04] Introduzione al Trading
## [02:15] Analisi SMA 50
### [02:30] Touch Points Identificati

Inizia l'analisi dettagliata:`
      : VIDEO_TO_MARKDOWN_PROMPT; // Fallback al prompt statico

    const generateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { file_data: { mime_type: 'video/mp4', file_uri: fileUri } },
              { text: analystPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 65536,
          }
        }),
      }
    );

    const generateData = await generateResponse.json();
    const markdownContent = generateData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!markdownContent) {
      console.error('[Video Ingest] Gemini response:', JSON.stringify(generateData));
      throw new Error('Failed to generate Markdown from video');
    }

    console.log(`[Video Ingest] Generated ${markdownContent.length} characters of Markdown`);

    // === FASE 5: Save to pipeline_a_documents with metadata ===
    const { data: document, error: dbError } = await supabase
      .from('pipeline_a_documents')
      .insert({
        file_name: fileName.replace('.mp4', '.md'),
        file_path: filePath,
        storage_bucket: 'pipeline-a-uploads',
        file_size_bytes: fileSize,
        source_type: 'video',
        full_text: markdownContent,
        status: 'ingested',
        processing_metadata: {
          processing_version: '2.1-domain-aware',
          detected_domain: detectedDomain || 'general', // NUOVO: tracciabilità dominio
          director_prompt_generated: !!customPrompt,
          director_prompt_length: customPrompt?.length || 0,
          director_prompt_preview: customPrompt?.substring(0, 500) || null,
          analyst_prompt_type: customPrompt ? 'dynamic' : 'static_fallback',
          domain_enhancement_applied: !!VIDEO_DOMAIN_ENHANCEMENTS[detectedDomain || ''],
          model_used: 'gemini-2.0-flash',
          phases_completed: ['director', 'analyst'],
        }
      })
      .select()
      .single();

    if (dbError) {
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    console.log(`[Video Ingest] Document created: ${document.id}`);

    // === FASE 6: Trigger Pipeline A processing ===
    try {
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('pipeline-a-process-chunks', {
          body: { documentId: document.id },
        })
      );
      console.log(`[Video Ingest] Triggered Pipeline A for document ${document.id}`);
    } catch (triggerError) {
      console.warn('[Video Ingest] Failed to trigger processing:', triggerError);
    }

    // Cleanup: Delete file from Gemini (optional, saves quota)
    try {
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName_gemini}?key=${googleApiKey}`,
        { method: 'DELETE' }
      );
    } catch (e) {
      console.warn('[Video Ingest] Failed to cleanup Gemini file:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: fileName,
        markdownLength: markdownContent.length,
        status: 'ingested',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Video Ingest] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
