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
   - Usa heading ## per sezioni/argomenti principali
   - Usa paragrafi per il flusso naturale del discorso

2. ELEMENTI VISUALI (CRITICO!)
   Quando nel video appare un supporto visivo:

   a) TABELLE → Converti in tabella Markdown:
      | Colonna 1 | Colonna 2 |
      |-----------|-----------|
      | dato 1    | dato 2    |

   b) GRAFICI → Descrivi dettagliatamente:
      **[GRAFICO - MM:SS]**
      - Tipo: (barre, linee, torta, etc.)
      - Assi: X = ..., Y = ...
      - Trend: descrivilo
      - Valori chiave: elencali

   c) SLIDE/DIAGRAMMI → Estrai tutti i testi e la struttura

   d) CODICE → Formatta come code block con linguaggio

3. FORMATO OUTPUT
   Genera Markdown valido e ben strutturato.
   Includi sempre il timestamp quando cambia sezione o appare contenuto visivo.

Inizia l'analisi:
`;

// Director Prompt per analisi preliminare del dominio
const DIRECTOR_PROMPT = `
Sei un analista esperto che prepara istruzioni per un'altra IA.

COMPITO: Analizza rapidamente questo video per capire:

1. DOMINIO: L'argomento preciso (trading, programmazione, cucina, fitness, etc.)

2. ELEMENTI VISIVI CRITICI: Quali dettagli visivi sono essenziali per la comprensione?
   - Se ci sono grafici: quali metriche/indicatori mostrano?
   - Se c'è codice: quale linguaggio/framework?
   - Se ci sono tabelle: cosa rappresentano i dati?
   - Se ci sono dimostrazioni fisiche: quali movimenti/posture sono importanti?

3. CALIBRAZIONE VERBOSITÀ:
   - Se identifichi un video TECNICO (es. trading, coding, analisi dati): 
     sii ESTREMAMENTE pedante sui dettagli (valori numerici esatti, sintassi precisa, timestamp di ogni variazione)
   - Se identifichi un video DISCORSIVO/VLOG (es. interviste, presentazioni, tutorial generici):
     focalizzati sui concetti chiave e salta i dettagli minori

OUTPUT RICHIESTO:
Genera un System Prompt ottimizzato (max 500 parole) che istruisca un'altra IA 
a estrarre i dettagli specifici di QUESTO video. Il prompt deve:
- Specificare il ruolo esperto appropriato (es. "Agisci come trader professionista...")
- Elencare esattamente quali dati numerici/visivi estrarre
- Indicare come formattare tabelle/grafici specifici del dominio
- Includere terminologia tecnica del settore
- Specificare il livello di dettaglio appropriato (pedante vs concettuale)

Rispondi SOLO con il System Prompt, senza preamboli o spiegazioni.
`;

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

      if (customPrompt) {
        console.log(`[Video Ingest] Director generated ${customPrompt.length} char custom prompt`);
        console.log(`[Video Ingest] Custom Prompt Preview: ${customPrompt.substring(0, 300)}...`);
      } else {
        console.warn('[Video Ingest] Director returned empty response, using fallback');
      }
    } catch (directorError) {
      console.warn('[Video Ingest] Director failed, using fallback prompt:', directorError);
    }

    // === FASE 4b: THE ANALYST - Estrazione Dati ===
    console.log('[Video Ingest] FASE 4b: Analyst - Extracting with optimized prompt...');

    // Combina prompt custom con istruzioni di output standard
    const analystPrompt = customPrompt 
      ? `${customPrompt}

FORMATO OUTPUT OBBLIGATORIO:
- Genera Markdown valido e ben strutturato
- Usa timestamp [MM:SS] per ogni sezione/evento importante
- Tabelle in formato Markdown standard (|...|)
- Code blocks con linguaggio specificato (\`\`\`lang)
- Grafici descritti con: tipo, assi, trend, valori chiave

IMPORTANTE: NON wrappare l'output in code blocks (\`\`\`markdown o \`\`\`md).
Genera Markdown puro direttamente, senza delimitatori di blocco codice.
Le tabelle vanno scritte direttamente con sintassi |...|, non dentro \`\`\`markdown.

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
          processing_version: '2.0-director-analyst',
          director_prompt_generated: !!customPrompt,
          director_prompt_length: customPrompt?.length || 0,
          director_prompt_preview: customPrompt?.substring(0, 500) || null,
          analyst_prompt_type: customPrompt ? 'dynamic' : 'static_fallback',
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
