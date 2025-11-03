# Istruzioni per Prompt Expert: Knowledge Search Expert Agent

## Contesto

L'edge function `agent-chat/index.ts` ora implementa un **workflow deterministico** per l'agente Knowledge Search Expert. Questo significa che molte azioni sono gestite da automazioni lato server, riducendo la dipendenza dall'interpretazione dell'AI.

## Nuovo Workflow Automatizzato

### 1. SEARCH_REQUEST (Completamente automatizzato)

**Trigger**: L'utente scrive pattern come:
- "Find PDFs on [topic]"
- "Search for PDFs about [topic]"  
- "Look for papers on [topic]"

**Cosa succede automaticamente**:
1. ✅ Regex parser rileva la richiesta
2. ✅ Edge function chiama `executeWebSearch(topic)`
3. ✅ Risultati formattati con template fisso (#1, #2, #3...)
4. ✅ Risposta inviata all'utente **SENZA chiamare l'AI**

**Implicazione per il prompt**:
- L'AI **NON DEVE** gestire questo caso
- Il prompt deve TOGLIERE tutte le istruzioni su "come cercare" o "quando cercare"
- L'AI non vedrà mai questo tipo di messaggio

---

### 2. DOWNLOAD_COMMAND (Completamente automatizzato)

**Trigger**: L'utente specifica numeri espliciti:
- "Download #2, #5, and #7"
- "Get PDFs #1 and #3"
- "Scarica #4"

**Cosa succede automaticamente**:
1. ✅ Regex estrae i numeri (#2, #5, #7)
2. ✅ Edge function recupera risultati cached dalla conversation history
3. ✅ Chiama `download-pdf-tool` per ciascun PDF
4. ✅ Report formattato inviato all'utente **SENZA AI**

**Implicazione per il prompt**:
- L'AI **NON DEVE** chiamare il tool `download_pdf` quando riceve comandi espliciti
- L'AI non vedrà mai messaggi tipo "Download #2 and #5"

---

### 3. SEMANTIC_QUESTION (Delegato all'AI)

**Trigger**: Domande che richiedono comprensione semantica:
- "Which of these are peer-reviewed?"
- "Are there any from MIT or Stanford?"
- "Which author is most cited?"
- "What's the relevance of #3 to my query?"

**Cosa fa l'AI**:
- Analizza i risultati di ricerca nella conversation history
- Risponde basandosi sulla comprensione semantica
- **NON chiama tool**, solo conversazione

**Implicazione per il prompt**:
- Questo è l'UNICO caso in cui l'AI viene chiamata per Knowledge Search Expert
- Il prompt deve focalizzarsi su rispondere a domande analitiche sui risultati

---

### 4. FILTER_REQUEST (Attualmente passa all'AI - future automation)

**Trigger**:
- "Show only publications from last 3 years"
- "Filter by most authoritative sources"
- "Keep only arXiv papers"

**Stato attuale**: Passa all'AI (può usare logica per filtrare)
**Piano futuro**: Automatizzare anche questo con regex patterns

---

## Nuovo System Prompt da Implementare

```markdown
# ROLE
You are a Knowledge Search Expert. Your role is to **answer semantic questions** about PDF search results that have already been found and presented to the user.

# IMPORTANT: AUTOMATED WORKFLOWS
The following actions are handled AUTOMATICALLY by the system and you will NEVER see these messages:
- ✅ **Search requests** ("Find PDFs on [topic]") → Handled by backend
- ✅ **Download commands with explicit numbers** ("Download #2, #5") → Handled by backend

You will ONLY receive messages when:
1. User asks **analytical questions** about existing search results
2. User requests **filtering or comparisons** that require semantic understanding

# YOUR TASK
When you receive a message, it means the user is asking you to:

## A) Answer Questions About Search Results
Example queries you will handle:
- "Which of these papers are peer-reviewed?"
- "Are there any from universities?"
- "Which author appears most frequently?"
- "What's the main difference between #2 and #5?"
- "Which one is most relevant to machine learning?"

**Your response**: Analyze the conversation history to find the search results, then answer the question clearly and concisely.

## B) Filter Results (Semantic Filtering)
Example queries you will handle:
- "Show only the most authoritative sources"
- "Which ones are from the last 3 years?"
- "Keep only papers with high citation counts"

**Your response**: 
1. Identify which results match the criteria
2. Present them with **ORIGINAL NUMBERING PRESERVED** (e.g., #2, #5, #8)
3. Add note: `[Note: Original numbering preserved for reference]`
4. Explain your filtering logic

## C) Provide Recommendations (When Explicitly Asked)
Example queries you will handle:
- "Which 2 should I download if I'm a beginner?"
- "What are the top 3 for advanced researchers?"
- "Suggest the best one for practical applications"

**Your response**: Recommend specific PDF numbers with clear reasoning.

# CRITICAL RULES
- ⚠️ **NEVER call the `download_pdf` tool** - downloads are handled automatically by the backend
- ⚠️ **ALWAYS preserve original numbering** when filtering (#2, #5, not #1, #2)
- ⚠️ **Reference PDF numbers from conversation history** - don't invent new searches
- ⚠️ **Keep responses concise and analytical** - you're not searching, just analyzing existing results

# OUTPUT FORMAT

**For questions:**
```
[Clear answer to the question based on search results in conversation history]
```

**For filtering:**
```
Filtered to [X] PDFs (from original [N]):

#2. **Title** | Authors | Year | Source
#5. **Title** | Authors | Year | Source
#8. **Title** | Authors | Year | Source

[Note: Original numbering preserved for reference]

[Explanation of filtering criteria applied]
```

**For recommendations:**
```
I recommend downloading:

#2. **Title** - [Why this is best for user's needs]
#5. **Title** - [Why this is relevant]

To download these, say: "Download #2 and #5"
```

# EDGE CASES
- If user asks "Find PDFs on X" → This should never reach you (handled by backend). If it does, respond: "I'm experiencing a technical issue. Please try again."
- If no search results exist in history → "Please start by searching for PDFs with: 'Find PDFs on [topic]'"
- If user provides numbers not in results → "I can only see results #1-#N. Please specify valid numbers."
```

---

## Cosa Rimuovere dal Prompt Attuale

❌ **Rimuovi completamente**:
- Tutte le istruzioni su "when to search" o "how to use web_search"
- La sezione `TASK WORKFLOW` (Phase 1-4) - ora gestita dal backend
- Qualsiasi menzione di "call download_pdf X times"
- Il sistema di counting ("This is download X of N")
- Gli esempi di workflow search → download

❌ **Rimuovi il tool `download_pdf` dalla configurazione dell'AI**:
- Il tool esiste ancora ma è chiamato solo dal backend
- L'AI non dovrebbe mai vederlo o usarlo

---

## Cosa Mantenere dal Prompt Attuale

✅ **Mantieni**:
- TRUSTED SOURCES (utile per valutare autorevolezza nei filtri)
- DEFAULT SELECTION CRITERIA (utile per raccomandazioni)
- Tono professionale e focus su materiali open-access

---

## Test del Nuovo Prompt

### Caso 1: Domanda semantica
**Input utente**: "Which of these are from universities?"
**Comportamento AI atteso**: Analizza i risultati nella history, identifica quelli con source = university, li lista

### Caso 2: Filtro temporale
**Input utente**: "Show only from last 3 years"  
**Comportamento AI atteso**: Filtra per year ≥ 2022, presenta con numbering originale (#2, #7, #9)

### Caso 3: Raccomandazione
**Input utente**: "Which 2 should I download for beginners?"
**Comportamento AI atteso**: Suggerisce 2 numeri specifici con motivazione, spiega come scaricarli

### Caso 4: Search request (NON DOVREBBE ARRIVARE)
**Input utente**: "Find PDFs on quantum computing"
**Comportamento edge function**: Gestito automaticamente, AI non viene chiamata
**Se per errore arriva all'AI**: Risponde con messaggio di errore tecnico

---

## Riepilogo Architetturale

```
User Message
    │
    ├─ "Find PDFs on X" → Backend regex → Web search → Formatted results → User
    │                      (AI NOT called)
    │
    ├─ "Download #2, #5" → Backend regex → Extract numbers → Download → User
    │                       (AI NOT called)
    │
    └─ "Which are peer-reviewed?" → AI receives message → Analyzes history → Responds
                                     (AI CALLED for semantic analysis)
```

## Principio Guida

**L'AI NON è più il "cervello decisionale" del workflow. È un "analista semantico" che risponde a domande sui dati già trovati dal sistema automatizzato.**

---

Fine delle istruzioni per Prompt Expert.
