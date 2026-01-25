
# Piano: Fix "Cartella Esistente" per Cartelle Vuote

## Problema

Quando l'utente cerca di creare la cartella "GEO":
1. Il sistema dice "Una cartella con questo nome esiste già"
2. Ma nella vista Cartelle "GEO" non appare

**Causa**: La cartella "GEO" esiste nella tabella `folders` ma non ha documenti associati. La vista Cartelle mostra solo cartelle con documenti, mentre il controllo di validazione verifica la tabella `folders`.

## Situazione Attuale

```text
┌─────────────────┐     ┌──────────────────────────┐
│  Tabella folders │     │    Vista Cartelle        │
├─────────────────┤     ├──────────────────────────┤
│ GEO ✓           │     │ Lovable-Docs (19 doc) ✓  │
│ list ✓          │     │ list (52 doc) ✓          │
│ lux-desktop ✓   │     │ lux-desktop (65 doc) ✓   │
│ ...             │     │ ...                      │
└─────────────────┘     │ (GEO non appare - 0 doc) │
                        └──────────────────────────┘
```

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/AssignToFolderDialog.tsx` | Se la cartella esiste già, usala direttamente invece di fallire |
| `src/components/DocumentPoolTable.tsx` | Includere cartelle vuote dalla tabella `folders` nella vista Cartelle |

## Modifiche Tecniche

### 1. AssignToFolderDialog.tsx - Usare cartella esistente (righe 66-97)

Se il nome esiste già in `availableFolders`, invece di mostrare errore, riutilizzare quella cartella:

```typescript
// Se sta creando una nuova cartella
if (isCreatingNew) {
  const trimmedName = newFolderName.trim();
  
  if (!trimmedName) {
    toast.error("Nome obbligatorio", {
      description: "Inserisci un nome per la nuova cartella",
    });
    return;
  }

  if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
    toast.error("Nome non valido", {
      description: "Usa solo lettere, numeri, underscore e trattini",
    });
    return;
  }

  // Controllo case-insensitive
  const existingFolder = availableFolders.find(
    f => f.toLowerCase() === trimmedName.toLowerCase()
  );

  if (existingFolder) {
    // La cartella esiste già, usala direttamente
    folderToAssign = existingFolder;
    // Salta la creazione cartella (isCreatingNew verrà ignorato dopo)
  } else {
    folderToAssign = trimmedName;
  }
}

// Nella sezione creazione cartella:
if (isCreatingNew && !availableFolders.find(
  f => f.toLowerCase() === folderToAssign.toLowerCase()
)) {
  // Crea solo se NON esiste già
  const { error: folderError } = await supabase
    .from('folders')
    .insert({ name: folderToAssign });
  // ...
}
```

### 2. DocumentPoolTable.tsx - Mostrare cartelle vuote nella vista Cartelle

Nella funzione `loadFolders` (righe 608-676), dopo aver caricato le cartelle dai documenti, aggiungere quelle dalla tabella `folders` che non hanno documenti:

```typescript
const loadFolders = async () => {
  // ... codice esistente per caricare cartelle dai documenti ...
  
  // Aggiungi cartelle vuote dalla tabella folders
  const { data: allFolderRecords } = await supabase
    .from('folders')
    .select('name');
  
  const folderNamesFromDocs = new Set(allFolders.map(f => f.folderName));
  
  // Aggiungi cartelle vuote (esistono in folders ma non hanno documenti)
  for (const record of (allFolderRecords || [])) {
    if (!folderNamesFromDocs.has(record.name)) {
      allFolders.push({
        folderName: record.name,
        documents: [],
        totalDocs: 0,
        // ... altri campi con valori default
      });
    }
  }
  
  setFoldersData(allFolders);
};
```

## Comportamento Dopo la Modifica

1. **Utente digita "GEO"** → Il sistema trova che esiste già → Usa la cartella esistente
2. **Documenti assegnati** → I documenti vengono spostati nella cartella "GEO"
3. **Vista Cartelle** → "GEO" appare ora con i documenti assegnati
4. **Cartelle vuote** → Appaiono nella vista con "(0 documenti)"

## Risultato Atteso

- Nessun errore "Cartella esistente" quando la cartella esiste ma è vuota
- Le cartelle vuote sono visibili nella vista Cartelle
- L'assegnazione documenti funziona sempre
