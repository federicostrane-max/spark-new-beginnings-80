
# Piano: Completare Backfill Metadata + Pulsante Generazione Manuale

## Diagnosi Confermata

| Componente | Stato Attuale |
|------------|---------------|
| Documenti `ready` con metadata | 18 |
| Documenti `ready` senza metadata | **1355** |
| Documento `2311.09735v3.pdf` | Nessun metadata (tutti `null`) |
| Batch size corrente | 10 documenti per chiamata |

Il documento nello screenshot non ha metadata perché il backfill iniziale ha processato solo 18 documenti. Servono **~136 chiamate manuali** per completare con batch di 10, oppure ~27 chiamate con batch di 50.

## Modifiche da Implementare

### 1. Aumentare Batch Size (Edge Function)

**File:** `supabase/functions/pipeline-a-hybrid-analyze-document/index.ts`

Modificare linea 42:
```typescript
// Da:
.limit(10); // Process in batches

// A:
.limit(50); // Process 50 documents per batch
```

### 2. Aggiungere Pulsante "Genera Metadata AI"

**File:** `src/components/DocumentDetailsDialog.tsx`

Aggiungere stato e handler per generazione metadata:
```typescript
const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);

const handleGenerateMetadata = async () => {
  if (!document.id) return;
  setIsGeneratingMetadata(true);
  try {
    toast.info("Generazione metadata AI in corso...");
    const { error } = await supabase.functions.invoke(
      "pipeline-a-hybrid-analyze-document",
      { body: { documentId: document.id } }
    );
    if (error) throw error;
    toast.success("Metadata AI generati con successo!");
    onOpenChange(false);
    if (onRefresh) onRefresh();
  } catch (error) {
    toast.error("Errore nella generazione metadata");
  } finally {
    setIsGeneratingMetadata(false);
  }
};
```

Aggiungere pulsante nel header (accanto a "Riprocessa") per documenti A-Hybrid senza metadata:
```typescript
{document.pipeline === 'a-hybrid' && !document.ai_summary && (
  <Button
    size="sm"
    variant="default"
    onClick={handleGenerateMetadata}
    disabled={isGeneratingMetadata}
  >
    <Hash className={`h-4 w-4 mr-2 ${isGeneratingMetadata ? 'animate-spin' : ''}`} />
    Genera Metadata AI
  </Button>
)}
```

### 3. Fix Complexity Level Labels

Le funzioni `getComplexityColor` e `getComplexityLabel` usano `low/medium/high`, ma Claude genera `basic/intermediate/advanced`. Aggiornare per supportare entrambi:

```typescript
const getComplexityColor = (level?: string) => {
  switch (level?.toLowerCase()) {
    case "basic":
    case "low":
      return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
    case "intermediate":
    case "medium":
      return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
    case "advanced":
    case "high":
      return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getComplexityLabel = (level?: string) => {
  switch (level?.toLowerCase()) {
    case "basic":
    case "low":
      return "Base";
    case "intermediate":
    case "medium":
      return "Intermedio";
    case "advanced":
    case "high":
      return "Avanzato";
    default:
      return "Non specificato";
  }
};
```

### 4. Aggiungere Config per Edge Function

**File:** `supabase/config.toml`

```toml
[functions.pipeline-a-hybrid-analyze-document]
verify_jwt = false
timeout = 300
```

## File da Modificare

| File | Modifica |
|------|----------|
| `supabase/functions/pipeline-a-hybrid-analyze-document/index.ts` | `.limit(10)` → `.limit(50)` |
| `src/components/DocumentDetailsDialog.tsx` | Pulsante "Genera Metadata AI" + fix labels complessità |
| `supabase/config.toml` | Aggiungere configurazione funzione |

## Sequenza di Esecuzione

```text
1. Modifiche codice
   ↓
2. Deploy automatico edge functions
   ↓
3. Eseguire backfill completo
   POST /functions/v1/pipeline-a-hybrid-analyze-document
   Body: {"backfill": true}
   (ripetere ~27 volte con batch di 50)
   ↓
4. Tutti i 1355 documenti hanno metadata
```

## Risultato Atteso

1. Il documento `2311.09735v3.pdf` mostrerà summary, keywords, topics e complessità
2. Pulsante dedicato permette di generare metadata per singoli documenti on-demand
3. I livelli di complessità (`basic`/`intermediate`/`advanced`) vengono visualizzati correttamente come "Base"/"Intermedio"/"Avanzato"
4. Backfill completabile in ~27 chiamate invece di 136
