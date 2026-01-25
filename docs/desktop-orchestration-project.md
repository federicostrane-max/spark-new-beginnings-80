# Desktop Orchestration Project

> Integrazione Web App (Orchestrator) ↔ Desktop App (Executor)
>
> Data: 2026-01-25

---

## 1. Vision e Obiettivi

### Il Concetto

La **Web App** funge da "cervello" intelligente con:
- Knowledge Base (RAG) con documenti, GitHub repos, video
- Agenti AI multi-specializzati
- Task decomposition e planning
- Orchestrazione centralizzata

La **Desktop App** funge da "executor" con:
- Multiple istanze Claude Code in parallelo
- Accesso al filesystem locale
- Esecuzione comandi, build, test
- Nessuna logica di business (è un tool)

### Modello Architetturale

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WEB APP (Orchestrator)                          │
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐  │
│  │   User      │     │   RAG KB    │     │  Orchestrator Agent     │  │
│  │   Request   │────►│   Query     │────►│                         │  │
│  │             │     │             │     │  • Decompone task       │  │
│  └─────────────┘     └─────────────┘     │  • Arricchisce con      │  │
│                                          │    contesto KB          │  │
│                                          │  • Genera prompt        │  │
│                                          │    completi             │  │
│                                          └───────────┬─────────────┘  │
│                                                      │                 │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       │
                                           Prompt completo (HTTP)
                                           Output streaming (SSE)
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       DESKTOP APP (Executor)                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    API Server (porta 3847)                      │  │
│  │                                                                 │  │
│  │  Riceve prompt ──► Passa a Claude Code ──► Streaming output    │  │
│  │                                                                 │  │
│  │  NON ha logica di business                                     │  │
│  │  NON accede alla KB                                            │  │
│  │  È solo un EXECUTOR                                            │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│       ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│       │ Claude Code  │  │ Claude Code  │  │ Claude Code  │            │
│       │ Instance #1  │  │ Instance #2  │  │ Instance #N  │            │
│       └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisioni Tecniche

### 2.1 Protocollo di Comunicazione: REST + SSE

**Scelta:** REST per comandi, SSE per streaming output

**Motivazioni:**
- Già implementato nella desktop app
- SSE è nativo HTTP, passa firewall
- Riconnessione semplice

**Gestione message gap con buffering:**

```
Desktop App mantiene buffer circolare:
┌────────────────────────────────────────┐
│  Output Buffer (ultimi 1000 messaggi)  │
│  Ogni messaggio ha sequence_id         │
└────────────────────────────────────────┘

SSE reconnect:
GET /api/sessions/:id/stream?last_seq=1234

Desktop invia tutti i messaggi da seq 1235 in poi
```

**Controindicazioni gestite:**
| Problema | Mitigazione |
|----------|-------------|
| SSE unidirezionale | POST separato per comandi urgenti |
| Timeout connessioni lunghe | Keep-alive ping ogni 30s |
| Nessun acknowledgment | Buffering con sequence_id |
| Reconnection gap | Buffer lato desktop |

### 2.2 Autenticazione: Token + Registration

**Flow:**
1. Web App genera `pairing_code` (6 caratteri, one-time)
2. User inserisce codice nella Desktop App
3. Desktop chiama `/api/pair` sulla Web App
4. Web App valida e ritorna `session_token`
5. Tutti i call successivi usano `session_token`

**Sicurezza aggiuntiva:**
- Token rotation periodica
- IP binding opzionale
- Rate limiting

### 2.3 Tunneling: Ngrok

**Per reti diverse:** Desktop genera URL `https://xxx.ngrok.io`

**Controindicazioni:**
| Problema | Gravità | Mitigazione |
|----------|---------|-------------|
| URL cambia ogni restart | Alta | Ngrok paid per URL fisso |
| Latenza +50-150ms | Media | Irrilevante per task lunghi |
| Dipendenza servizio terzo | Media | Alternativa: Cloudflare Tunnel |

**Alternative future:**
- Cloudflare Tunnel (gratuito con dominio)
- Tailscale Funnel
- Relay server proprio

### 2.4 Knowledge Base: Solo Web App

La KB **non viene esposta** alla desktop app.

**Flusso:**
1. Orchestrator Agent query la KB
2. Estrae contesto rilevante
3. Genera prompt **completo** con contesto incluso
4. Invia prompt alla desktop app

**Vantaggi:**
- Desktop app stupida = facile manutenzione
- KB mai esposta = sicurezza, IP protection
- Tutta la logica in un posto = debug centralizzato

### 2.5 Gestione Domande

**Default:** Auto-answer dall'orchestrator

**Human mode:** Solo su richiesta esplicita dell'orchestrator

```
Claude Code fa domanda
         │
         ▼
Desktop rileva e invia via SSE
         │
         ▼
┌─────────────────────────────────────┐
│  Web App Orchestrator Agent         │
│                                     │
│  1. Analizza domanda                │
│  2. Cerca risposta nella KB         │
│  3. Decide:                         │
│     ├─ Può rispondere → AUTO        │
│     └─ Serve umano → FORWARD        │
│                                     │
└─────────────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
  AUTO     FORWARD (solo se orchestrator decide)
    │         │
    └─────────┴─────────► POST /api/sessions/:id/answer
```

### 2.6 Task Decomposition: Automatica

L'orchestrator agent decompone automaticamente:

```
Input: "Crea un'app todo con React e Supabase"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  ORCHESTRATOR AGENT                             │
│                                                 │
│  1. Query KB per pattern simili                 │
│  2. Identifica componenti necessari             │
│  3. Genera piano con dipendenze                 │
│  4. Per ogni task, genera prompt completo       │
│                                                 │
└─────────────────────────────────────────────────┘
                    │
                    ▼
          Esecuzione sequenziale
          o parallela dove possibile
```

### 2.7 Recovery: Retry + Notifica

```
Task in esecuzione
        │
        ▼
Desktop si disconnette
        │
        ▼
Web App rileva timeout (60s)
        │
        ▼
┌───────────────────────────────────┐
│  Retry Logic                      │
│                                   │
│  attempt = 1                      │
│  while attempt <= 3:              │
│    wait(30s * attempt)            │
│    if desktop.reconnects():       │
│      resume_task()                │
│      break                        │
│    attempt++                      │
│                                   │
│  if attempt > 3:                  │
│    notify_user("Task failed")     │
│    status → 'failed'              │
└───────────────────────────────────┘
```

### 2.8 Multi-Desktop: No (v1)

Per semplicità, v1 supporta **un solo desktop per utente**.

---

## 3. Schema Database (Web App - Supabase)

### 3.1 Tabella: desktop_connections

```sql
CREATE TABLE desktop_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT DEFAULT 'My Desktop',
  endpoint_url TEXT NOT NULL,
  api_token TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' | 'connected' | 'disconnected'
  last_heartbeat TIMESTAMPTZ,
  capabilities JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id) -- v1: un solo desktop per utente
);
```

### 3.2 Tabella: orchestrated_tasks

```sql
CREATE TABLE orchestrated_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  desktop_connection_id UUID REFERENCES desktop_connections,
  project_id UUID REFERENCES projects,

  -- Request
  original_request TEXT NOT NULL,
  decomposed_tasks JSONB DEFAULT '[]',

  -- Execution state
  status TEXT DEFAULT 'pending', -- 'pending' | 'decomposing' | 'running' | 'paused' | 'completed' | 'failed'
  current_task_index INT DEFAULT 0,
  desktop_session_id TEXT,

  -- Recovery
  retry_count INT DEFAULT 0,
  last_error TEXT,

  -- Output
  accumulated_output TEXT DEFAULT '',
  final_summary TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### 3.3 Tabella: pending_questions

```sql
CREATE TABLE pending_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES orchestrated_tasks NOT NULL,
  question_data JSONB NOT NULL, -- { text, options, type }
  auto_answer TEXT,
  human_answer TEXT,
  requires_human BOOLEAN DEFAULT false,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 RLS Policies

```sql
ALTER TABLE desktop_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrated_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own connections" ON desktop_connections
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own tasks" ON orchestrated_tasks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own questions" ON pending_questions
  FOR ALL USING (
    task_id IN (SELECT id FROM orchestrated_tasks WHERE user_id = auth.uid())
  );
```

### 3.5 Indici

```sql
CREATE INDEX idx_desktop_connections_user ON desktop_connections(user_id);
CREATE INDEX idx_tasks_user_status ON orchestrated_tasks(user_id, status);
CREATE INDEX idx_questions_task ON pending_questions(task_id, answered_at);
```

---

## 4. Tipi TypeScript (Web App)

```typescript
// src/types/desktop-orchestration.ts

export interface DesktopConnection {
  id: string;
  user_id: string;
  name: string;
  endpoint_url: string;
  api_token: string;
  status: 'pending' | 'connected' | 'disconnected';
  last_heartbeat: string | null;
  capabilities: {
    max_instances?: number;
    supported_features?: string[];
  };
  created_at: string;
  updated_at: string;
}

export interface OrchestratedTask {
  id: string;
  user_id: string;
  desktop_connection_id: string | null;
  project_id: string | null;
  original_request: string;
  decomposed_tasks: DecomposedSubTask[];
  status: 'pending' | 'decomposing' | 'running' | 'paused' | 'completed' | 'failed';
  current_task_index: number;
  desktop_session_id: string | null;
  retry_count: number;
  last_error: string | null;
  accumulated_output: string;
  final_summary: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DecomposedSubTask {
  id: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependencies: string[];
  output: string | null;
}

export interface PendingQuestion {
  id: string;
  task_id: string;
  question_data: {
    text: string;
    options?: string[];
    type: 'text' | 'choice' | 'confirm';
  };
  auto_answer: string | null;
  human_answer: string | null;
  requires_human: boolean;
  answered_at: string | null;
  created_at: string;
}

// API Response types
export interface DesktopHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  active_sessions: number;
  capabilities: {
    max_instances: number;
    supported_features: string[];
  };
}

export interface CreateSessionResponse {
  session_id: string;
  stream_url: string;
}

export interface SSEMessage {
  seq: number;
  type: 'output' | 'tool_use' | 'tool_result' | 'question' | 'status' | 'error';
  content?: string;
  data?: any;
  timestamp: number;
}
```

---

## 5. API Endpoints (Desktop App)

### 5.1 POST /api/pair

Registrazione della desktop app con la web app.

**Request:**
```typescript
{
  pairing_code: string;      // "ABC123"
  web_app_endpoint: string;  // "https://your-app.lovable.app"
}
```

**Response 200:**
```typescript
{
  success: true;
  session_token: string;
  expires_at: string;
}
```

**Response 400:**
```typescript
{
  success: false;
  error: "Invalid pairing code" | "Code expired"
}
```

### 5.2 GET /api/health

Health check e capabilities.

**Response 200:**
```typescript
{
  status: "healthy";
  version: string;
  uptime: number;
  active_sessions: number;
  capabilities: {
    max_instances: number;
    supported_features: string[];
  }
}
```

### 5.3 POST /api/orchestrated

Crea nuova sessione con prompt dall'orchestrator.

**Request:**
```typescript
{
  task_id: string;           // ID dalla web app
  prompt: string;            // Prompt completo con contesto
  project_path: string;
  session_name?: string;
}
```

**Response 200:**
```typescript
{
  session_id: string;
  stream_url: string;        // "/api/sessions/{id}/stream"
}
```

### 5.4 GET /api/sessions/:id/stream

SSE streaming con buffering per recovery.

**Query params:**
```
?last_seq=number  // Per recovery, riprende da sequence
```

**SSE Events:**
```
data: {"seq": 1, "type": "output", "content": "...", "timestamp": 1234567890}
data: {"seq": 2, "type": "tool_use", "tool": "Read", "input": {...}}
data: {"seq": 3, "type": "question", "data": {"text": "...", "options": [...]}}
data: {"seq": 4, "type": "status", "status": "completed"}
data: {"seq": 5, "type": "error", "message": "..."}

: keepalive  // Ogni 30s
```

### 5.5 POST /api/sessions/:id/answer

Risponde a una domanda pendente.

**Request:**
```typescript
{
  answer: string;
  question_id?: string;
}
```

**Response 200:**
```typescript
{
  success: true;
}
```

### 5.6 DELETE /api/sessions/:id

Termina una sessione.

**Response 200:**
```typescript
{
  success: true;
  final_output: string;
}
```

---

## 6. Flusso Completo di Orchestrazione

```
UTENTE                    WEB APP                         DESKTOP APP
  │                          │                                 │
  │  "Crea un'app todo       │                                 │
  │   con React e Supabase"  │                                 │
  │─────────────────────────►│                                 │
  │                          │                                 │
  │                    ┌─────┴─────┐                           │
  │                    │ 1. QUERY  │                           │
  │                    │    RAG    │                           │
  │                    └─────┬─────┘                           │
  │                          │                                 │
  │                    Recupera da KB:                         │
  │                    • Pattern React                         │
  │                    • Schema Supabase                       │
  │                    • Best practices                        │
  │                          │                                 │
  │                    ┌─────┴─────┐                           │
  │                    │ 2. DECOMP │                           │
  │                    │    TASK   │                           │
  │                    └─────┬─────┘                           │
  │                          │                                 │
  │                    Sub-tasks:                              │
  │                    T1: Setup progetto                      │
  │                    T2: Crea schema DB                      │
  │                    T3: Implementa API                      │
  │                    T4: Crea UI components                  │
  │                    T5: Integra e testa                     │
  │                          │                                 │
  │                    ┌─────┴─────┐                           │
  │                    │ 3. SEND   │                           │
  │                    │  TO EXEC  │                           │
  │                    └─────┬─────┘                           │
  │                          │                                 │
  │                          │  POST /api/orchestrated         │
  │                          │  {                              │
  │                          │    task_id: "...",              │
  │                          │    prompt: "<full prompt>",     │
  │                          │    project_path: "..."          │
  │                          │  }                              │
  │                          │────────────────────────────────►│
  │                          │                                 │
  │                          │                           Spawn Claude
  │                          │                           Code session
  │                          │                                 │
  │                          │  SSE: streaming output          │
  │                          │◄────────────────────────────────│
  │                          │                                 │
  │  Progress update         │                                 │
  │◄─────────────────────────│                                 │
  │                          │                                 │
  │                          │  Question from Claude Code      │
  │                          │◄────────────────────────────────│
  │                          │                                 │
  │                    ┌─────┴─────┐                           │
  │                    │ 4. AUTO   │                           │
  │                    │  ANSWER   │                           │
  │                    └─────┬─────┘                           │
  │                          │                                 │
  │                          │  POST /api/sessions/:id/answer  │
  │                          │────────────────────────────────►│
  │                          │                                 │
  │                          │         ... continua ...        │
  │                          │                                 │
  │                    ┌─────┴─────┐                           │
  │                    │ 5. AGGR   │                           │
  │                    │  RESULTS  │                           │
  │                    └─────┬─────┘                           │
  │                          │                                 │
  │  "Progetto completato"   │                                 │
  │◄─────────────────────────│                                 │
```

---

## 7. Divisione in Blocchi per Sviluppo Parallelo

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BLOCCHI INDIPENDENTI                             │
│                    (Possono partire in parallelo)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  BLOCCO A   │  │  BLOCCO B   │  │  BLOCCO C   │  │  BLOCCO D   │   │
│  │             │  │             │  │             │  │             │   │
│  │  Database   │  │  Desktop    │  │  Web App    │  │  Orchestr.  │   │
│  │  Schema     │  │  API New    │  │  Connection │  │  Agent      │   │
│  │  Web App    │  │  Endpoints  │  │  UI         │  │  Logic      │   │
│  │             │  │             │  │             │  │             │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BLOCCO INTEGRAZIONE                              │
│                    (Richiede A, B, C, D completati)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  BLOCCO E: Integrazione e Testing End-to-End                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## BLOCCO A: Database Schema (Web App)

### Metadata

| Campo | Valore |
|-------|--------|
| **Cartella Target** | `D:\downloads\Lux\app lux 1\web-app` |
| **Dipendenze** | Nessuna |
| **Può iniziare** | ✅ Subito |

### File da Creare/Modificare

```
supabase/migrations/
└── XXXXXX_desktop_orchestration.sql

src/types/
└── desktop-orchestration.ts

src/integrations/supabase/types.ts  (aggiorna)
```

### Deliverable

1. Migration SQL con:
   - Tabella `desktop_connections`
   - Tabella `orchestrated_tasks`
   - Tabella `pending_questions`
   - RLS policies
   - Indici

2. Tipi TypeScript completi

3. Aggiornamento tipi Supabase generati

### Prompt per Claude Code

```
Progetto: web-app (Supabase + React)
Cartella: D:\downloads\Lux\app lux 1\web-app

Task: Implementa lo schema database per l'orchestrazione desktop.

## File da creare

### 1. supabase/migrations/XXXXXX_desktop_orchestration.sql

Crea le seguenti tabelle:

```sql
-- Tabella connessioni desktop
CREATE TABLE desktop_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT DEFAULT 'My Desktop',
  endpoint_url TEXT NOT NULL,
  api_token TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  last_heartbeat TIMESTAMPTZ,
  capabilities JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Tabella task orchestrate
CREATE TABLE orchestrated_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  desktop_connection_id UUID REFERENCES desktop_connections,
  project_id UUID REFERENCES projects,
  original_request TEXT NOT NULL,
  decomposed_tasks JSONB DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  current_task_index INT DEFAULT 0,
  desktop_session_id TEXT,
  retry_count INT DEFAULT 0,
  last_error TEXT,
  accumulated_output TEXT DEFAULT '',
  final_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Tabella domande pendenti
CREATE TABLE pending_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES orchestrated_tasks NOT NULL,
  question_data JSONB NOT NULL,
  auto_answer TEXT,
  human_answer TEXT,
  requires_human BOOLEAN DEFAULT false,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE desktop_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrated_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own connections" ON desktop_connections
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own tasks" ON orchestrated_tasks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own questions" ON pending_questions
  FOR ALL USING (task_id IN (SELECT id FROM orchestrated_tasks WHERE user_id = auth.uid()));

-- Indici
CREATE INDEX idx_desktop_connections_user ON desktop_connections(user_id);
CREATE INDEX idx_tasks_user_status ON orchestrated_tasks(user_id, status);
CREATE INDEX idx_questions_task ON pending_questions(task_id, answered_at);
```

### 2. src/types/desktop-orchestration.ts

Crea i tipi TypeScript come specificato nella sezione 4 del documento di progetto.

### 3. Aggiorna src/integrations/supabase/types.ts

Aggiungi i nuovi tipi per le tabelle create.

## Note

- Non modificare altri file
- Focus solo su database e tipi
- Usa convenzioni esistenti nel progetto
```

---

## BLOCCO B: Desktop App API Endpoints

### Metadata

| Campo | Valore |
|-------|--------|
| **Cartella Target** | `D:\downloads\Lux\claude-launcher-electron` |
| **Dipendenze** | Nessuna |
| **Può iniziare** | ✅ Subito |

### File da Creare/Modificare

```
src/main/
├── api-server.ts          (estendi)
├── pairing-service.ts     (nuovo)
├── heartbeat-service.ts   (nuovo)
├── sse-buffer.ts          (nuovo)
└── orchestration-types.ts (nuovo)
```

### Deliverable

1. Nuovi endpoint:
   - `POST /api/pair`
   - `GET /api/health`
   - `POST /api/orchestrated`
   - `GET /api/sessions/:id/stream` (con buffering)
   - `POST /api/sessions/:id/answer`

2. SSE Buffer per recovery

3. Pairing service

4. Heartbeat service

### Prompt per Claude Code

```
Progetto: claude-launcher-electron
Cartella: D:\downloads\Lux\claude-launcher-electron

Task: Aggiungi nuovi endpoint API per orchestrazione remota dalla web app.

## File da creare

### 1. src/main/orchestration-types.ts

```typescript
export interface PairRequest {
  pairing_code: string;
  web_app_endpoint: string;
}

export interface PairResponse {
  success: boolean;
  session_token?: string;
  expires_at?: string;
  error?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  active_sessions: number;
  capabilities: {
    max_instances: number;
    supported_features: string[];
  };
}

export interface OrchestratedRequest {
  task_id: string;
  prompt: string;
  project_path: string;
  session_name?: string;
}

export interface OrchestratedResponse {
  session_id: string;
  stream_url: string;
}

export interface SSEMessage {
  seq: number;
  type: 'output' | 'tool_use' | 'tool_result' | 'question' | 'status' | 'error';
  content?: string;
  data?: any;
  timestamp: number;
}

export interface AnswerRequest {
  answer: string;
  question_id?: string;
}
```

### 2. src/main/sse-buffer.ts

```typescript
interface BufferedMessage {
  seq: number;
  data: any;
  timestamp: number;
}

export class SSEBuffer {
  private buffer: Map<string, BufferedMessage[]> = new Map();
  private maxSize = 1000;
  private seqCounters: Map<string, number> = new Map();

  addMessage(sessionId: string, data: any): BufferedMessage {
    const seq = (this.seqCounters.get(sessionId) || 0) + 1;
    this.seqCounters.set(sessionId, seq);

    const message: BufferedMessage = {
      seq,
      data,
      timestamp: Date.now()
    };

    const sessionBuffer = this.buffer.get(sessionId) || [];
    sessionBuffer.push(message);

    if (sessionBuffer.length > this.maxSize) {
      sessionBuffer.shift();
    }

    this.buffer.set(sessionId, sessionBuffer);
    return message;
  }

  getMessagesSince(sessionId: string, lastSeq: number): BufferedMessage[] {
    const sessionBuffer = this.buffer.get(sessionId) || [];
    return sessionBuffer.filter(m => m.seq > lastSeq);
  }

  clearSession(sessionId: string): void {
    this.buffer.delete(sessionId);
    this.seqCounters.delete(sessionId);
  }
}
```

### 3. src/main/pairing-service.ts

Gestisce il pairing con la web app:
- Memorizza session token
- Valida richieste
- Gestisce expiration

### 4. src/main/heartbeat-service.ts

Invia heartbeat periodici alla web app:
- Ogni 30 secondi
- Include status e capabilities
- Gestisce reconnection

### 5. Estendi src/main/api-server.ts

Aggiungi i nuovi endpoint mantenendo retrocompatibilità.

Endpoint da implementare:
- POST /api/pair
- GET /api/health
- POST /api/orchestrated
- GET /api/sessions/:id/stream (con SSE buffer e ?last_seq param)
- POST /api/sessions/:id/answer

## Note

- Mantieni retrocompatibilità con endpoint esistenti
- Usa il ProcessManager esistente per gestire le sessioni
- SSE deve supportare recovery con last_seq
- Keep-alive ping ogni 30 secondi
```

---

## BLOCCO C: Web App Connection UI

### Metadata

| Campo | Valore |
|-------|--------|
| **Cartella Target** | `D:\downloads\Lux\app lux 1\web-app` |
| **Dipendenze** | Nessuna (usa mock data) |
| **Può iniziare** | ✅ Subito |

### File da Creare

```
src/components/desktop/
├── DesktopConnectionManager.tsx
├── PairingDialog.tsx
├── ConnectionStatus.tsx
└── index.ts

src/hooks/
└── useDesktopConnection.ts

src/mocks/
└── desktop-connection.ts
```

### Deliverable

1. Componenti UI:
   - DesktopConnectionManager
   - PairingDialog
   - ConnectionStatus

2. Hook useDesktopConnection

3. Mock data per sviluppo indipendente

### Prompt per Claude Code

```
Progetto: web-app (React + shadcn/ui)
Cartella: D:\downloads\Lux\app lux 1\web-app

Task: Crea UI per gestione connessione desktop app.

## File da creare

### 1. src/mocks/desktop-connection.ts

```typescript
import { DesktopConnection, DesktopHealthResponse } from '@/types/desktop-orchestration';

export const mockDesktopConnection: DesktopConnection = {
  id: 'mock-1',
  user_id: 'user-1',
  name: 'My Desktop',
  endpoint_url: 'http://localhost:3847',
  api_token: 'mock-token',
  status: 'connected',
  last_heartbeat: new Date().toISOString(),
  capabilities: { max_instances: 5, supported_features: ['sse', 'questions'] },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

export const mockHealthResponse: DesktopHealthResponse = {
  status: 'healthy',
  version: '1.0.0',
  uptime: 3600,
  active_sessions: 2,
  capabilities: { max_instances: 5, supported_features: ['sse', 'questions'] }
};

// Per simulare API calls durante sviluppo
export const mockDesktopApi = {
  health: () => Promise.resolve(mockHealthResponse),
  pair: (code: string) => Promise.resolve({
    success: true,
    session_token: 'mock-token'
  }),
};
```

### 2. src/hooks/useDesktopConnection.ts

```typescript
import { useState, useEffect, useCallback } from 'react';
import { DesktopConnection } from '@/types/desktop-orchestration';
import { supabase } from '@/integrations/supabase/client';

export function useDesktopConnection() {
  const [connection, setConnection] = useState<DesktopConnection | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carica connessione esistente
  useEffect(() => {
    loadConnection();
  }, []);

  // Polling heartbeat quando connesso
  useEffect(() => {
    if (status !== 'connected' || !connection) return;

    const interval = setInterval(checkHeartbeat, 30000);
    return () => clearInterval(interval);
  }, [status, connection]);

  const loadConnection = async () => {
    // Carica da Supabase
  };

  const generatePairingCode = async (): Promise<string> => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setPairingCode(code);
    setStatus('connecting');
    // Salva in DB con expiration
    return code;
  };

  const checkPairingStatus = async (): Promise<boolean> => {
    // Polling per verificare se desktop ha fatto pairing
    return false;
  };

  const checkHeartbeat = async () => {
    if (!connection) return;
    // Verifica se desktop è ancora online
  };

  const disconnect = async () => {
    // Rimuovi connessione
    setConnection(null);
    setStatus('disconnected');
  };

  const sendCommand = async <T>(endpoint: string, data?: any): Promise<T> => {
    if (!connection) throw new Error('Not connected');

    const response = await fetch(`${connection.endpoint_url}${endpoint}`, {
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': connection.api_token
      },
      body: data ? JSON.stringify(data) : undefined
    });

    return response.json();
  };

  return {
    connection,
    status,
    pairingCode,
    error,
    generatePairingCode,
    checkPairingStatus,
    disconnect,
    sendCommand
  };
}
```

### 3. src/components/desktop/ConnectionStatus.tsx

Componente che mostra:
- Indicatore stato: 🟢 Connected | 🟡 Connecting | 🔴 Disconnected
- Nome desktop
- Ultimo heartbeat
- Capabilities

### 4. src/components/desktop/PairingDialog.tsx

Dialog con flow:
1. Genera pairing code (6 caratteri)
2. Mostra codice grande e leggibile
3. Istruzioni per utente
4. Polling automatico per completamento
5. Conferma successo o errore

### 5. src/components/desktop/DesktopConnectionManager.tsx

Componente principale che:
- Se non connesso: mostra bottone "Connect Desktop"
- Se connesso: mostra ConnectionStatus + bottone Disconnect
- Gestisce apertura PairingDialog

### 6. src/components/desktop/index.ts

Export dei componenti.

## Stile

- Usa shadcn/ui components (Button, Dialog, Card, Badge)
- Segui pattern esistenti nel progetto
- Responsive design

## Note

- Usa mock data per sviluppo. Il backend verrà collegato dopo.
- Crea anche una sezione in Settings o pagina dedicata per mostrare questi componenti
```

---

## BLOCCO D: Orchestrator Agent Logic

### Metadata

| Campo | Valore |
|-------|--------|
| **Cartella Target** | `D:\downloads\Lux\app lux 1\web-app` |
| **Dipendenze** | Nessuna (logica pura) |
| **Può iniziare** | ✅ Subito |

### File da Creare

```
supabase/functions/
├── orchestrate-task/
│   └── index.ts
├── decompose-task/
│   └── index.ts
├── handle-question/
│   └── index.ts
└── _shared/
    ├── orchestrator-prompts.ts
    └── task-utils.ts
```

### Deliverable

1. Edge function `orchestrate-task`
2. Edge function `decompose-task`
3. Edge function `handle-question`
4. Prompt templates
5. Utility functions

### Prompt per Claude Code

```
Progetto: web-app (Supabase Edge Functions - Deno)
Cartella: D:\downloads\Lux\app lux 1\web-app

Task: Implementa logica orchestrazione come Edge Functions.

## File da creare

### 1. supabase/functions/_shared/orchestrator-prompts.ts

```typescript
export const DECOMPOSITION_SYSTEM_PROMPT = `
Sei un architetto software esperto. Il tuo compito è analizzare richieste utente
e decomporle in task atomiche eseguibili da un coding assistant.

Regole:
1. Ogni task deve essere completabile in una singola sessione di lavoro
2. Indica chiaramente le dipendenze tra task (quali devono finire prima)
3. Genera prompt dettagliati con tutto il contesto necessario
4. Considera l'ordine di esecuzione ottimale
5. Identifica task parallelizzabili

Output in JSON con questo schema:
{
  "tasks": [
    {
      "id": "T1",
      "description": "Breve descrizione",
      "prompt": "Prompt completo per Claude Code con tutto il contesto",
      "dependencies": [],
      "can_parallelize": true
    }
  ],
  "execution_strategy": "sequential" | "parallel" | "mixed"
}
`;

export const QUESTION_HANDLER_SYSTEM_PROMPT = `
Claude Code ha posto una domanda durante l'esecuzione di un task.
Devi decidere se rispondere automaticamente o chiedere all'utente.

Criteri per risposta automatica:
- La Knowledge Base contiene una preferenza chiara
- È una scelta stilistica minore (indentazione, naming convention)
- È una conferma di procedere con approccio standard

Criteri per chiedere all'utente:
- Riguarda sicurezza o scelte architetturali maggiori
- Ha impatto significativo sul progetto
- La KB non ha informazioni sufficienti
- È una preferenza personale importante

Output in JSON:
{
  "requires_human": boolean,
  "auto_answer": "risposta se automatica",
  "confidence": 0.0-1.0,
  "reasoning": "spiegazione della decisione"
}
`;

export function buildDecompositionPrompt(
  userRequest: string,
  kbContext: string,
  projectInfo?: { tech_stack: string[], existing_files: string[] }
): string {
  return `
## Contesto dalla Knowledge Base:
${kbContext}

## Informazioni Progetto:
${projectInfo ? `
- Tech Stack: ${projectInfo.tech_stack.join(', ')}
- File esistenti: ${projectInfo.existing_files.slice(0, 20).join(', ')}
` : 'Non disponibili'}

## Richiesta Utente:
${userRequest}

Analizza e decomponi in task eseguibili.
`;
}

export function buildQuestionHandlerPrompt(
  question: { text: string, options?: string[] },
  sessionContext: string,
  kbContext: string
): string {
  return `
## Domanda da Claude Code:
${question.text}
${question.options ? `Opzioni: ${question.options.join(', ')}` : ''}

## Contesto Sessione:
${sessionContext}

## Contesto Knowledge Base:
${kbContext}

Decidi come rispondere.
`;
}
```

### 2. supabase/functions/_shared/task-utils.ts

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface DecomposedTask {
  id: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependencies: string[];
  can_parallelize: boolean;
  output: string | null;
}

export function getNextExecutableTasks(
  tasks: DecomposedTask[]
): DecomposedTask[] {
  const completedIds = new Set(
    tasks.filter(t => t.status === 'completed').map(t => t.id)
  );

  return tasks.filter(task => {
    if (task.status !== 'pending') return false;
    return task.dependencies.every(dep => completedIds.has(dep));
  });
}

export function canParallelExecute(tasks: DecomposedTask[]): boolean {
  const executable = getNextExecutableTasks(tasks);
  return executable.length > 1 && executable.every(t => t.can_parallelize);
}

export async function queryKnowledgeBase(
  supabase: ReturnType<typeof createClient>,
  query: string,
  projectId?: string,
  limit: number = 5
): Promise<string> {
  // Implementa query RAG
  // Per ora placeholder
  return "Knowledge base context placeholder";
}
```

### 3. supabase/functions/decompose-task/index.ts

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DECOMPOSITION_SYSTEM_PROMPT,
  buildDecompositionPrompt
} from '../_shared/orchestrator-prompts.ts';
import { queryKnowledgeBase } from '../_shared/task-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_request, project_id } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Query KB per contesto
    const kbContext = await queryKnowledgeBase(supabase, user_request, project_id);

    // Chiama LLM per decomposizione
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
          { role: 'user', content: buildDecompositionPrompt(user_request, kbContext) }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const llmResult = await response.json();
    const decomposition = JSON.parse(llmResult.choices[0].message.content);

    return new Response(JSON.stringify(decomposition), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

### 4. supabase/functions/handle-question/index.ts

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  QUESTION_HANDLER_SYSTEM_PROMPT,
  buildQuestionHandlerPrompt
} from '../_shared/orchestrator-prompts.ts';
import { queryKnowledgeBase } from '../_shared/task-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, session_context, project_id } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Query KB per contesto decisionale
    const kbContext = await queryKnowledgeBase(
      supabase,
      `${question.text} ${question.options?.join(' ') || ''}`,
      project_id
    );

    // Chiama LLM per decisione
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Modello veloce per decisioni
        messages: [
          { role: 'system', content: QUESTION_HANDLER_SYSTEM_PROMPT },
          { role: 'user', content: buildQuestionHandlerPrompt(question, session_context, kbContext) }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const llmResult = await response.json();
    const decision = JSON.parse(llmResult.choices[0].message.content);

    return new Response(JSON.stringify(decision), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

### 5. supabase/functions/orchestrate-task/index.ts

Main orchestration function che:
1. Riceve richiesta utente
2. Chiama decompose-task
3. Salva task in DB
4. Placeholder per invio a desktop (sarà completato in integrazione)

## Note

- Questa è logica pura, testabile isolatamente
- Usa placeholder per chiamate alla desktop app
- Le chiamate reali verranno implementate nel BLOCCO E
- Focus su correttezza della logica di decomposizione e question handling
```

---

## BLOCCO E: Integrazione e Testing

### Metadata

| Campo | Valore |
|-------|--------|
| **Cartelle Target** | Entrambe |
| **Dipendenze** | BLOCCO A, B, C, D completati |
| **Può iniziare** | ⏳ Dopo completamento blocchi precedenti |

### File da Modificare

```
# Web App
supabase/functions/orchestrate-task/index.ts  (collegamento reale)
src/hooks/useDesktopConnection.ts             (SSE reale)
src/components/desktop/OrchestrationProgress.tsx (nuovo)

# Desktop App
src/main/api-server.ts                        (verifica integrazione)
```

### Deliverable

1. Orchestrate-task che chiama realmente la desktop app
2. SSE client nella web app
3. UI progresso orchestrazione
4. Test end-to-end completo

### Test Flow

```
1. User connette desktop app (pairing)
2. User invia richiesta "Crea component React"
3. Web app decompone task
4. Web app invia a desktop via POST /api/orchestrated
5. Desktop spawna Claude Code session
6. Web app riceve output via SSE
7. Se domanda → handle-question decide auto/human
8. Task completato → mostra summary
9. Verifica recovery: simula disconnect e reconnect
```

### Prompt per Claude Code

```
Task: Integrazione finale tra Web App e Desktop App per orchestrazione.

## Prerequisiti
- BLOCCO A completato: Database schema presente
- BLOCCO B completato: Desktop API endpoints funzionanti
- BLOCCO C completato: UI connessione funzionante
- BLOCCO D completato: Logic orchestrazione pronta

## Obiettivo
Collegare tutti i componenti e testare il flusso end-to-end.

## Step

### 1. Completa orchestrate-task/index.ts

Aggiungi la chiamata reale alla desktop app:

```typescript
// Dopo decomposizione, per ogni task:
const desktopResponse = await fetch(`${connection.endpoint_url}/api/orchestrated`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Token': connection.api_token
  },
  body: JSON.stringify({
    task_id: taskRecord.id,
    prompt: task.prompt,
    project_path: projectPath
  })
});
```

### 2. Implementa SSE client in useDesktopConnection

```typescript
const subscribeToSession = (sessionId: string, onMessage: (msg: SSEMessage) => void) => {
  const eventSource = new EventSource(
    `${connection.endpoint_url}/api/sessions/${sessionId}/stream`
  );

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    onMessage(message);
  };

  return () => eventSource.close();
};
```

### 3. Crea OrchestrationProgress.tsx

Componente che mostra:
- Lista task con stato (pending/running/completed)
- Output streaming per task corrente
- Domande pendenti (se human mode)
- Summary finale

### 4. Test manuale

1. Avvia desktop app
2. Avvia web app in dev mode
3. Connetti via pairing
4. Invia task di test
5. Verifica flusso completo
6. Testa recovery (kill desktop, riconnetti)

## Criteri di successo

- [ ] Pairing funziona
- [ ] Task viene decomposta
- [ ] Desktop riceve ed esegue
- [ ] SSE streaming funziona
- [ ] Domande vengono gestite
- [ ] Recovery funziona dopo disconnect
```

---

## 8. Tabella Riepilogativa Assegnazioni

| Blocco | Worker | Cartella | Dipendenze | Tempo Stimato |
|--------|--------|----------|------------|---------------|
| **A** | Claude Code #1 | `web-app/` | Nessuna | 2-3 ore |
| **B** | Claude Code #2 | `claude-launcher-electron/` | Nessuna | 4-6 ore |
| **C** | Claude Code #3 | `web-app/` | Nessuna (mock) | 3-4 ore |
| **D** | Claude Code #4 | `web-app/` | Nessuna | 4-5 ore |
| **E** | Qualsiasi | Entrambe | A, B, C, D | 3-4 ore |

**Tempo totale stimato:** 8-10 ore (con parallelismo) vs 16-22 ore (sequenziale)

---

## 9. Checklist Pre-Integrazione

Prima di iniziare BLOCCO E, verificare:

### BLOCCO A
- [ ] Migration SQL applicata
- [ ] Tabelle create in Supabase
- [ ] RLS policies attive
- [ ] Tipi TypeScript generati

### BLOCCO B
- [ ] Endpoint /api/pair funzionante
- [ ] Endpoint /api/health funzionante
- [ ] Endpoint /api/orchestrated funzionante
- [ ] SSE con buffering funzionante
- [ ] Heartbeat service attivo

### BLOCCO C
- [ ] DesktopConnectionManager renderizza
- [ ] PairingDialog mostra codice
- [ ] ConnectionStatus mostra stato
- [ ] Hook useDesktopConnection funziona con mock

### BLOCCO D
- [ ] decompose-task ritorna JSON valido
- [ ] handle-question decide correttamente
- [ ] orchestrate-task salva in DB

---

## 10. Note per lo Sviluppo

### Convenzioni

- **Web App:** Usa pattern esistenti (hooks, components, edge functions)
- **Desktop App:** Mantieni retrocompatibilità con API esistenti
- **Tipi:** Condividi interfacce dove possibile

### Testing

- **BLOCCO A:** Verifica con Supabase Studio
- **BLOCCO B:** Testa con curl/Postman
- **BLOCCO C:** Storybook o render isolato
- **BLOCCO D:** Test unitari su logica

### Comunicazione tra Worker

I blocchi sono indipendenti, ma se un worker trova problemi di interfaccia:
1. Documenta l'issue
2. Proponi soluzione
3. Non bloccare: usa placeholder

---

## 11. Contatti e Repository

| Repo | Path |
|------|------|
| Web App | `D:\downloads\Lux\app lux 1\web-app` |
| Desktop App | `D:\downloads\Lux\claude-launcher-electron` |

---

*Documento generato il 2026-01-25*
