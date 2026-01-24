

# Esecuzione Piano: Aggiunta Colonne Metadata Pipeline A-Hybrid

## Stato Attuale

| Componente | Stato |
|------------|-------|
| Frontend mapping | ✅ Già aggiornato (commit `1b93469`) |
| Colonne DB | ❌ Non esistono ancora |
| Edge function | ✅ Codice presente, da deployare |

## Azioni da Eseguire

### 1. Migrazione Database

Aggiungere le colonne metadata alla tabella `pipeline_a_hybrid_documents`:

```sql
ALTER TABLE pipeline_a_hybrid_documents
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS keywords TEXT[],
  ADD COLUMN IF NOT EXISTS topics TEXT[],
  ADD COLUMN IF NOT EXISTS complexity_level TEXT;
```

### 2. Deploy Edge Functions

Le seguenti edge functions verranno deployate automaticamente:
- `pipeline-a-hybrid-analyze-document` (nuova)
- `pipeline-a-hybrid-generate-embeddings` (modificata con trigger)

### 3. Backfill Documenti Esistenti

Dopo il deploy, eseguire il backfill per generare metadata AI:

```text
POST /functions/v1/pipeline-a-hybrid-analyze-document
Body: {"backfill": true}
```

## Sequenza

```text
Migrazione SQL --> Deploy Functions --> Backfill --> UI mostra metadata
```

## Risultato

I documenti A-Hybrid mostreranno nel dialog:
- Riassunto AI generato da Claude Haiku
- Keywords come badge
- Topics come badge
- Livello di complessità con colore

