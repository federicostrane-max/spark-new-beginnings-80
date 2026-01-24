
# Piano: Fix Assegnazione Documenti a Nuove Cartelle per Pipeline A-Hybrid

## Problema Identificato

Il pulsante "Assegna" non funziona perché il codice in `AssignToFolderDialog.tsx` controlla solo le tabelle:
- `pipeline_a_documents` ✅
- `pipeline_b_documents` ✅
- `pipeline_c_documents` ✅
- `pipeline_a_hybrid_documents` ❌ **MANCANTE**

I documenti selezionati (come "2311.09735v3.pdf") sono nella pipeline A-Hybrid, quindi non vengono trovati in nessuna delle tre tabelle controllate e l'assegnazione fallisce silenziosamente.

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/AssignToFolderDialog.tsx` | Aggiungere controllo per `pipeline_a_hybrid_documents` |
| `src/components/RenameFolderDialog.tsx` | Aggiungere update per `pipeline_a_hybrid_documents` |

## Modifiche Tecniche

### 1. AssignToFolderDialog.tsx (righe 102-122)

Aggiungere il controllo per Pipeline A-Hybrid nel loop:

```typescript
for (const docId of documentIds) {
  // Prova Pipeline A-Hybrid (nuova pipeline principale)
  const { data: docAHybrid } = await supabase
    .from('pipeline_a_hybrid_documents')
    .select('id')
    .eq('id', docId)
    .maybeSingle();
  if (docAHybrid) {
    updatePromises.push(
      supabase
        .from('pipeline_a_hybrid_documents')
        .update({ folder: folderToAssign })
        .eq('id', docId)
    );
    continue;
  }
  
  // Prova Pipeline A (legacy)
  // ... codice esistente per pipeline A, B, C
}
```

### 2. RenameFolderDialog.tsx (righe 82-95)

Aggiungere l'update per Pipeline A-Hybrid nel Promise.all:

```typescript
await Promise.all([
  // Pipeline A-Hybrid (nuova pipeline principale)
  supabase
    .from('pipeline_a_hybrid_documents')
    .update({ folder: trimmedName })
    .eq('folder', currentName),
  // Pipeline A, B, C (legacy)
  supabase
    .from('pipeline_a_documents')
    .update({ folder: trimmedName })
    .eq('folder', currentName),
  // ... altre pipeline
]);
```

## Risultato Atteso

1. Il pulsante "Assegna" funzionerà per i documenti della pipeline A-Hybrid
2. I 7 documenti selezionati verranno assegnati correttamente alla cartella "GEO"
3. Il rename delle cartelle aggiornerà anche i documenti A-Hybrid
