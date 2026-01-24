
# Piano: Aggiungere Icona "i" per Dettagli Documento nella Vista Cartelle

## Situazione Attuale

| Vista | Icona Info | Come aprire dettagli |
|-------|------------|---------------------|
| Tabella | ✅ Presente | Click su icona "i" |
| Cartelle | ❌ Mancante | Click su tutta la riga |

Nella vista cartelle, l'utente deve cliccare sull'intera riga del documento per aprire i dettagli. Nella vista tabella invece c'è un'icona "ⓘ" dedicata a fine riga.

## Modifica da Implementare

**File:** `src/components/FolderTreeView.tsx`

### 1. Importare l'icona Info

Aggiungere `Info` agli import di lucide-react (riga 6).

### 2. Aggiungere Pulsante Info per ogni documento

Nella sezione render dei documenti (righe 277-305), aggiungere un pulsante con icona "Info" a fine riga, accanto al Badge di stato:

```typescript
// Dopo il Badge (riga 302-304), aggiungere:
<Button
  variant="ghost"
  size="sm"
  className="h-7 w-7 p-0 flex-shrink-0"
  onClick={(e) => {
    e.stopPropagation();
    onDocumentClick(doc);
  }}
  title="Vedi dettagli completi"
>
  <Info className="h-4 w-4 text-muted-foreground hover:text-foreground" />
</Button>
```

## Layout Risultante per ogni Documento

```text
[☐] [✓] [📄] Nome documento.pdf        [Badge] [ⓘ]
              5 giorni fa • 10 pagine
```

## Comportamento

- **Click sull'icona "i"**: Apre il dialog `DocumentDetailsDialog` con tutti i dettagli (summary, keywords, topics, complessita)
- **Click sulla riga**: Continua a funzionare come prima (stesso comportamento)
- L'icona ha tooltip "Vedi dettagli completi"

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/FolderTreeView.tsx` | Aggiungere import `Info` e pulsante info per ogni documento |

## Risultato Atteso

L'utente vedra l'icona "ⓘ" su ogni documento nella vista Cartelle, identica a quella della vista Tabella, per aprire rapidamente i dettagli del documento.
