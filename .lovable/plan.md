
# Piano: Fix Errori TypeScript Clawdbot Library

## Problema

Gli errori di build sono causati da incompatibilità di tipi TypeScript. Le interfacce come `WaitParams`, `NavigateParams`, ecc. non possono essere passate a `createTask()` che richiede `Record<string, unknown>`.

```
error TS2345: Argument of type 'WaitParams' is not assignable to 
parameter of type 'Record<string, unknown>'.
Index signature for type 'string' is missing in type 'WaitParams'.
```

## Causa Tecnica

TypeScript interfaces non hanno un index signature implicito, quindi non sono compatibili con `Record<string, unknown>`. Per esempio:

```typescript
interface WaitParams {
  timeMs?: number;
  text?: string;
}

// Errore: WaitParams non ha [key: string]: unknown
const params: Record<string, unknown> = waitParams; // ❌
```

## Soluzione

Aggiungere un index signature a tutte le interfacce dei parametri nel file `types.ts`:

```typescript
export interface WaitParams {
  timeMs?: number;
  text?: string;
  selector?: string;
  url?: string;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
  [key: string]: unknown;  // ← Aggiungere questo
}
```

## Modifiche

### File: `src/lib/clawdbot/types.ts`

Aggiungere `[key: string]: unknown;` a queste interfacce (9 totali):

| Interfaccia | Riga | Modifica |
|-------------|------|----------|
| `NavigateParams` | 63-66 | Aggiungere index signature |
| `ClickParams` | 68-73 | Aggiungere index signature |
| `TypeParams` | 75-81 | Aggiungere index signature |
| `HoverParams` | 83-86 | Aggiungere index signature |
| `ScrollParams` | 88-91 | Aggiungere index signature |
| `SelectParams` | 93-97 | Aggiungere index signature |
| `ScreenshotParams` | 99-103 | Aggiungere index signature |
| `WaitParams` | 117-123 | Aggiungere index signature |
| `PressParams` | 125-129 | Aggiungere index signature |
| `DragParams` | 131-135 | Aggiungere index signature |
| `StorageParams` | 137-141 | Aggiungere index signature |
| `UploadParams` | 143-147 | Aggiungere index signature |
| `EvaluateParams` | 149-153 | Aggiungere index signature |
| `SnapshotParams` | 105-115 | Aggiungere index signature |

## Esempio Modifica Completa

```typescript
// PRIMA:
export interface WaitParams {
  timeMs?: number;
  text?: string;
  selector?: string;
  url?: string;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
}

// DOPO:
export interface WaitParams {
  timeMs?: number;
  text?: string;
  selector?: string;
  url?: string;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
  [key: string]: unknown;
}
```

## Riepilogo

| File | Azione |
|------|--------|
| `src/lib/clawdbot/types.ts` | Aggiungere `[key: string]: unknown;` a 14 interfacce parametri |

## Risultato

Dopo questa modifica, tutte le interfacce saranno compatibili con `Record<string, unknown>` e gli errori TypeScript saranno risolti.
