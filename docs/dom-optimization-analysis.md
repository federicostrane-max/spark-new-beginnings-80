# Analisi DOM Navigation per Tool Server - HekaBrain Web App

**Data:** 2026-01-29
**Stato:** 📋 Pianificato

## Contesto

Il Tool Server utilizza Playwright per automazione browser DOM-based. Questa analisi identifica ottimizzazioni per migliorare la navigabilità della web app tramite selettori DOM affidabili.

---

## 1. STATO ATTUALE - ACCESSIBILITÀ DOM

### ✅ Punti di Forza

1. **Struttura HTML Semantica**
   - Uso corretto di elementi semantici (`<button>`, `<form>`, `<input>`)
   - Gerarchia DOM ben strutturata e prevedibile
   - Layout responsive con classi CSS consistenti

2. **ID Univoci su Messaggi**
   - Ogni messaggio ha `id={msg.id}` univoco
   - Facilita la selezione puntuale tramite `#message-id`

3. **Componenti shadcn/ui con Radix**
   - `data-state="open|closed"` automatici sui Dialog
   - `role` e `aria-*` attributes inclusi nativamente
   - Focus management integrato

4. **Pattern CSS Consistenti**
   - Classi Tailwind prevedibili (`flex h-screen`, `w-[280px]`, `sticky top-0`)
   - Pattern ripetuti (`group relative`, `mb-4`, `border-r`)
   - Selettori CSS affidabili per componenti core

### ❌ Criticità per Navigazione DOM

1. **Mancanza di `data-testid` / `data-*` Attributes**
   - Nessun identificatore esplicito per elementi critici
   - Relying solo su classi CSS → fragili a refactoring
   - Impossibile distinguere bottoni simili senza context

2. **Selettori Basati su Testo**
   - Bottoni identificabili solo via testo ("Crea agente", "Elimina")
   - Problematico per i18n e modifiche UI
   - Icone senza `aria-label` descrittivo

3. **Componenti Dinamici Opachi**
   - Menu dropdown: no ID sul trigger/content
   - Agent list items: no `data-agent-id` attribute
   - Modals: no identificatore univoco per tipo

4. **Input/Textarea Generici**
   - Nessun `name` o `id` sugli input form
   - Difficile distinguere campi simili (es. search vs message input)
   - `placeholder` come unico identificatore (fragile)

5. **Stato UI Non Visibile nel DOM**
   - Selection mode: classe CSS condizionale ma no `data-selection-active`
   - Tool Server status: solo colore dot (no `data-status="connected"`)
   - Loading/sending states: spinner senza `aria-busy`

---

## 2. RACCOMANDAZIONI - OTTIMIZZAZIONI DOM

### 🎯 Priorità Alta (Impatto Immediato)

#### A) Aggiungere `data-testid` su Elementi Critici

**Componenti da annotare:**

```tsx
// Sidebar
<div data-testid="agents-sidebar">
  <Input data-testid="agent-search-input" placeholder="Search..." />
  <Button data-testid="create-agent-button" onClick={...}>
    <Plus /> Crea agente
  </Button>
  {agents.map(agent => (
    <div
      data-testid="agent-item"
      data-agent-id={agent.id}
      data-agent-name={agent.name}
      className={...}
    >
      {/* Agent item content */}
    </div>
  ))}
</div>

// Header
<div data-testid="chat-header">
  <Button data-testid="mobile-menu-button" variant="ghost">
    <Menu />
  </Button>
  <h1 data-testid="current-agent-name">{currentAgent.name}</h1>
  <Button data-testid="expand-all-messages-button" onClick={...}>
    <ChevronsDown />
  </Button>
  <Button data-testid="edit-agent-button" onClick={...}>
    <Edit />
  </Button>
  <div
    data-testid="tool-server-indicator"
    data-status={toolServerStatus}
    onClick={...}
  >
    <div className={statusColor} />
    <Monitor />
  </div>
</div>

// Chat Input
<form data-testid="chat-input-form">
  <Textarea
    data-testid="message-input"
    ref={textareaRef}
    value={input}
    onChange={...}
  />
  <Button
    data-testid="send-message-button"
    data-disabled={sendDisabled}
    onClick={handleSubmit}
  >
    <Send />
  </Button>
  <DropdownMenu>
    <DropdownMenuTrigger data-testid="tool-mode-selector">
      {/* Tool selector */}
    </DropdownMenuTrigger>
  </DropdownMenu>
</form>

// Messages
{messages.map(msg => (
  <div
    id={msg.id}
    data-testid="chat-message"
    data-message-id={msg.id}
    data-message-role={msg.role}
    data-is-selected={isSelected}
  >
    <Button
      data-testid="toggle-message-expansion"
      onClick={() => setIsManuallyExpanded(!isManuallyExpanded)}
    >
      {isExpanded ? <ChevronUp /> : <ChevronDown />}
    </Button>
    <Button data-testid="copy-message-button" onClick={...}>
      <Copy />
    </Button>
    <Button data-testid="delete-message-button" onClick={...}>
      <Trash2 />
    </Button>
  </div>
))}

// Modals
<Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
  <DialogContent data-testid="create-agent-modal">
    <form data-testid="agent-form" onSubmit={handleSubmit}>
      <Input
        data-testid="agent-name-input"
        name="name"
        placeholder="Nome agente"
      />
      <Textarea
        data-testid="agent-description-input"
        name="description"
      />
      <Select data-testid="llm-provider-select" value={llmProvider}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
      </Select>
      <Select data-testid="ai-model-select" value={aiModel}>
        {/* ... */}
      </Select>
      <Textarea
        data-testid="system-prompt-input"
        name="systemPrompt"
      />
      <Button data-testid="save-agent-button" type="submit">
        Salva
      </Button>
      {editingAgent && (
        <Button
          data-testid="delete-agent-button"
          variant="destructive"
          onClick={handleDelete}
        >
          Elimina
        </Button>
      )}
    </form>
  </DialogContent>
</Dialog>

// Forward Dialog
<Dialog open={showForwardDialog}>
  <DialogContent data-testid="forward-message-dialog">
    <Input data-testid="forward-agent-search" placeholder="Filter..." />
    <ScrollArea>
      {filteredAgents.map(agent => (
        <div
          data-testid="forward-agent-item"
          data-agent-id={agent.id}
        >
          <Checkbox data-testid="forward-agent-checkbox" />
          {/* ... */}
        </div>
      ))}
    </ScrollArea>
    <Button data-testid="forward-submit-button" onClick={handleForward}>
      Inoltra
    </Button>
  </DialogContent>
</Dialog>

// Tool Server Settings Dialog
<Dialog open={showToolServerDialog}>
  <DialogContent data-testid="tool-server-settings-dialog">
    <Input
      data-testid="tool-server-url-input"
      value={toolServerUrl}
      onChange={...}
    />
    <Button data-testid="test-connection-button" onClick={testConnection}>
      Test Connection
    </Button>
  </DialogContent>
</Dialog>

// AlertDialog (Delete confirmation)
<AlertDialog open={showDeleteAllDialog}>
  <AlertDialogContent data-testid="delete-confirmation-dialog">
    <AlertDialogAction data-testid="confirm-delete-button">
      Elimina
    </AlertDialogAction>
    <AlertDialogCancel data-testid="cancel-delete-button">
      Annulla
    </AlertDialogCancel>
  </AlertDialogContent>
</AlertDialog>
```

**Impatto:**
- Selettori stabili anche dopo refactoring CSS
- Test automation più robusto
- Tool Server può identificare elementi senza ambiguità

---

#### B) Aggiungere `aria-label` su Bottoni Icon-Only

**Esempio:**

```tsx
<Button
  data-testid="mobile-menu-button"
  aria-label="Open navigation menu"
  variant="ghost"
>
  <Menu />
</Button>

<Button
  data-testid="expand-all-messages-button"
  aria-label={allMessagesExpanded ? "Collapse all messages" : "Expand all messages"}
  onClick={...}
>
  {allMessagesExpanded ? <ChevronsUp /> : <ChevronsDown />}
</Button>

<Button
  data-testid="copy-message-button"
  aria-label="Copy message content"
  onClick={handleCopy}
>
  {copied ? <Check /> : <Copy />}
</Button>

<Button
  data-testid="delete-message-button"
  aria-label="Delete message"
  onClick={handleDelete}
>
  <Trash2 />
</Button>

<Button
  data-testid="tool-server-indicator"
  aria-label={`Tool Server: ${toolServerStatus}`}
  onClick={...}
>
  <Monitor />
</Button>
```

**Impatto:**
- Screen reader compatibility
- Tool Server può query elementi via accessible name
- Migliore UX per keyboard navigation

---

#### C) Esporre Stati UI nel DOM

**Stati da rendere visibili:**

```tsx
// Selection mode
<div
  data-testid="chat-header"
  data-selection-mode={selectionMode ? "active" : "inactive"}
>
  {/* ... */}
</div>

// Tool Server status
<div
  data-testid="tool-server-indicator"
  data-status={toolServerStatus}
  aria-label={`Tool Server: ${toolServerStatus}`}
>
  {/* ... */}
</div>

// Loading states
<Button
  data-testid="send-message-button"
  data-loading={isSending}
  disabled={isSending || sendDisabled}
  aria-busy={isSending}
>
  {isSending ? <Loader2 className="animate-spin" /> : <Send />}
</Button>

// Message expansion
<div
  data-testid="chat-message"
  data-message-id={msg.id}
  data-expanded={isExpanded}
>
  {/* ... */}
</div>

// Agent sync status
<div
  data-testid="agent-item"
  data-agent-id={agent.id}
  data-sync-status={syncingAgents.has(agent.id) ? "syncing" : "idle"}
>
  {/* ... */}
</div>
```

**Impatto:**
- Tool Server può attendere stati specifici (es. `data-loading="false"`)
- Debugging più semplice (inspect DOM vede stato reale)
- Test E2E più robusti

---

### 🎯 Priorità Media (Migliora Robustezza)

#### D) Aggiungere `name` e `id` su Form Inputs

```tsx
<form data-testid="agent-form" onSubmit={handleSubmit}>
  <Label htmlFor="agent-name">Nome agente</Label>
  <Input
    id="agent-name"
    name="name"
    data-testid="agent-name-input"
    value={name}
    onChange={...}
  />

  <Label htmlFor="agent-description">Descrizione</Label>
  <Textarea
    id="agent-description"
    name="description"
    data-testid="agent-description-input"
    value={description}
    onChange={...}
  />

  <Label htmlFor="llm-provider">LLM Provider</Label>
  <Select
    name="llmProvider"
    data-testid="llm-provider-select"
    value={llmProvider}
    onValueChange={setLlmProvider}
  >
    {/* ... */}
  </Select>

  <Label htmlFor="system-prompt">System Prompt</Label>
  <Textarea
    id="system-prompt"
    name="systemPrompt"
    data-testid="system-prompt-input"
    value={systemPrompt}
    onChange={...}
  />
</form>
```

**Impatto:**
- Semantica HTML corretta
- Tool Server può usare `label[for="..."]` + `#id` per identificare campi
- Accessibilità migliorata

---

#### E) Strutturare Agent List con Semantic HTML

**Attuale:** Lista di `<div>` generici
**Raccomandato:** `<nav>` con `<ul><li>` + ARIA

```tsx
<nav data-testid="agents-sidebar" aria-label="Agent list">
  <Input data-testid="agent-search-input" placeholder="Search agents..." />

  <ul role="list" className="space-y-2">
    {filteredAgents.map(agent => (
      <li
        key={agent.id}
        data-testid="agent-item"
        data-agent-id={agent.id}
      >
        <button
          onClick={() => selectAgent(agent.id)}
          className={cn(...)}
          aria-current={currentAgentId === agent.id ? "page" : undefined}
        >
          <span className="text-2xl">{agent.avatar || "🤖"}</span>
          <span className="font-medium">{agent.name}</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="agent-menu-trigger"
            aria-label={`Options for ${agent.name}`}
          >
            <MoreVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="agent-menu-content">
            <DropdownMenuItem data-testid="edit-agent-menu-item">
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="delete-agent-menu-item">
              Delete
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="knowledge-base-menu-item">
              Knowledge Base
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    ))}
  </ul>
</nav>
```

**Impatto:**
- Navigazione keyboard migliorata
- Tool Server può query `nav[aria-label="Agent list"] li[data-agent-id="..."]`
- Screen reader announce correttamente la lista

---

### 🎯 Priorità Bassa (Nice-to-Have)

#### F) Aggiungere Landmark Regions

```tsx
<div className="flex h-screen w-full overflow-hidden">
  <aside
    data-testid="agents-sidebar"
    aria-label="Agents navigation"
  >
    <AgentsSidebar />
  </aside>

  <main
    className="flex-1 flex flex-col min-w-0"
    aria-label="Chat conversation"
  >
    <header
      data-testid="chat-header"
      className="border-b bg-background/95 backdrop-blur sticky top-0 z-10"
    >
      {/* Header content */}
    </header>

    <section
      data-testid="messages-area"
      aria-label="Messages"
      className="flex-1 overflow-auto"
    >
      <ScrollArea>
        {/* Messages */}
      </ScrollArea>
    </section>

    <footer
      data-testid="chat-input-container"
      className="border-t bg-background"
    >
      <ChatInput />
    </footer>
  </main>
</div>
```

**Impatto:**
- Navigazione via landmark (`main`, `aside`, `nav`, `header`, `footer`)
- Tool Server può usare selettori come `main section[aria-label="Messages"]`

---

#### G) Migliorare Feedback Visivo per Automazione

**Evidenziare azioni in corso per debugging:**

```tsx
// Quando Tool Server interagisce con un elemento, aggiungi classe temporanea
<Button
  data-testid="send-message-button"
  className={cn(
    "...",
    isBeingAutomated && "ring-2 ring-blue-500 ring-offset-2"
  )}
>
  <Send />
</Button>
```

**Implementazione:**
- Listener su `data-automation-active` attribute
- CSS animation quando Tool Server fa focus su elemento
- Aiuta debugging visivo durante sviluppo

---

## 3. SELETTORI PLAYWRIGHT RACCOMANDATI

### Query Strategies per Tool Server

**Priorità di selezione (dal più robusto al più fragile):**

1. **`data-testid` (RACCOMANDATO)**
   ```python
   # Playwright
   await page.locator('[data-testid="send-message-button"]').click()
   await page.locator('[data-testid="message-input"]').fill("Hello!")
   await page.locator('[data-agent-id="agent-123"]').click()
   ```

2. **`aria-label` per bottoni icon-only**
   ```python
   await page.get_by_role("button", name="Copy message content").click()
   await page.get_by_role("button", name="Delete message").click()
   ```

3. **`role` + nome accessibile**
   ```python
   await page.get_by_role("textbox", name="Nome agente").fill("My Agent")
   await page.get_by_role("button", name="Salva").click()
   ```

4. **ID univoci (per messaggi)**
   ```python
   await page.locator('#message-abc123').scroll_into_view_if_needed()
   ```

5. **Classi CSS (EVITARE se possibile - fragili)**
   ```python
   # Solo come fallback
   await page.locator('.mb-4.group.relative').first.click()
   ```

---

### Esempi di Task Comuni

#### Task 1: Creare un nuovo agente
```python
# 1. Click bottone "Crea agente"
await page.locator('[data-testid="create-agent-button"]').click()

# 2. Attendi modal aperto
await page.locator('[data-testid="create-agent-modal"]').wait_for()

# 3. Compila form
await page.locator('[data-testid="agent-name-input"]').fill("Test Agent")
await page.locator('[data-testid="agent-description-input"]').fill("A test agent")

# 4. Seleziona provider
await page.locator('[data-testid="llm-provider-select"]').click()
await page.get_by_role("option", name="anthropic").click()

# 5. Seleziona modello
await page.locator('[data-testid="ai-model-select"]').click()
await page.get_by_role("option", name="claude-sonnet-4").click()

# 6. System prompt
await page.locator('[data-testid="system-prompt-input"]').fill("You are a helpful assistant.")

# 7. Salva
await page.locator('[data-testid="save-agent-button"]').click()

# 8. Attendi chiusura modal
await page.locator('[data-testid="create-agent-modal"]').wait_for(state="hidden")
```

#### Task 2: Inviare un messaggio
```python
# 1. Seleziona agente
await page.locator('[data-agent-id="agent-123"]').click()

# 2. Scrivi messaggio
message_input = page.locator('[data-testid="message-input"]')
await message_input.fill("What is the weather today?")

# 3. Invia
await page.locator('[data-testid="send-message-button"]').click()

# 4. Attendi risposta (loading finito)
await page.locator('[data-testid="send-message-button"][data-loading="false"]').wait_for()
```

#### Task 3: Cancellare un messaggio
```python
# 1. Trova messaggio specifico
message = page.locator(f'[data-message-id="{message_id}"]')

# 2. Hover per mostrare azioni
await message.hover()

# 3. Click delete button
await message.locator('[data-testid="delete-message-button"]').click()

# 4. Conferma nel dialog
await page.locator('[data-testid="confirm-delete-button"]').click()
```

#### Task 4: Aprire Tool Server settings
```python
# 1. Click indicator
await page.locator('[data-testid="tool-server-indicator"]').click()

# 2. Attendi dialog
await page.locator('[data-testid="tool-server-settings-dialog"]').wait_for()

# 3. Leggi URL attuale
current_url = await page.locator('[data-testid="tool-server-url-input"]').input_value()

# 4. Modifica se necessario
await page.locator('[data-testid="tool-server-url-input"]').fill("http://localhost:8766")

# 5. Test connection
await page.locator('[data-testid="test-connection-button"]').click()
```

---

## 4. IMPLEMENTAZIONE - PIANO DI ROLLOUT

### Fase 1: Componenti Core (1-2 giorni)
- [ ] `MultiAgentConsultant.tsx` - Header, Sidebar, ChatInput
- [ ] `ChatMessage.tsx` - Message container e actions
- [ ] `AgentsSidebar.tsx` - Agent list items

**Output:** 80% dei task comuni diventano automatabili

---

### Fase 2: Modals e Dialogs (1 giorno)
- [ ] `CreateAgentModal.tsx` - Form agent
- [ ] `ForwardMessageDialog.tsx` - Forward flow
- [ ] `AlertDialog` wrappers - Delete confirmations

**Output:** Task complessi (create/edit/delete agent) automatabili

---

### Fase 3: Componenti Secondari (1 giorno)
- [ ] `DocumentPool` page - Upload, table
- [ ] `Admin` page - Tabs e settings
- [ ] `VoiceInput`, `AttachmentUpload` - Inputs avanzati

**Output:** 100% coverage per tutti i flussi utente

---

### Fase 4: Testing e Validazione (1 giorno)
- [ ] Creare Playwright test suite
- [ ] Validare selettori su scenari reali
- [ ] Documentare pattern e best practices

---

## 5. CHECKLIST PRE-MERGE

Ogni PR deve verificare:

- [ ] Tutti i bottoni hanno `data-testid`
- [ ] Icon-only buttons hanno `aria-label`
- [ ] Form inputs hanno `id` e `name`
- [ ] Modals/Dialogs hanno `data-testid` root
- [ ] Stati UI critici hanno `data-*` attributes (loading, selected, expanded)
- [ ] Agent items hanno `data-agent-id`
- [ ] Message items hanno `data-message-id`

---

## 6. BEST PRACTICES PER SVILUPPATORI

### ✅ DO

```tsx
// ✅ Identificatore esplicito
<Button data-testid="create-agent-button" onClick={...}>
  <Plus /> Crea agente
</Button>

// ✅ Stato visibile nel DOM
<div data-testid="message" data-expanded={isExpanded}>
  {/* ... */}
</div>

// ✅ Aria-label per icone
<Button aria-label="Delete message" data-testid="delete-button">
  <Trash2 />
</Button>

// ✅ Form semantico
<Label htmlFor="agent-name">Nome</Label>
<Input id="agent-name" name="name" data-testid="agent-name-input" />
```

### ❌ DON'T

```tsx
// ❌ Nessun identificatore
<Button onClick={...}>
  <Plus /> Crea
</Button>

// ❌ Stato solo in JS (invisibile nel DOM)
const [isExpanded, setIsExpanded] = useState(false);
<div className={isExpanded ? 'expanded' : ''}>

// ❌ Bottone icona senza label
<Button>
  <Trash2 />
</Button>

// ❌ Input senza ID
<Input placeholder="Nome agente" />
```

---

## 7. METRICHE DI SUCCESSO

**Obiettivi:**
- [ ] 100% componenti core hanno `data-testid`
- [ ] 100% icon buttons hanno `aria-label`
- [ ] 90% form inputs hanno `id` + `name`
- [ ] 0 test Playwright con selettori CSS fragili (es. `.mb-4.group`)
- [ ] Tool Server navigation success rate > 95%

**Misurazione:**
- Playwright test suite coverage report
- Tool Server log analysis (errori "element not found")
- Manual testing con screen reader

---

## CONCLUSIONE

La web app ha una base solida ma manca di **identificatori espliciti** per automazione DOM-based.

**Impatto stimato implementazione completa:**
- **Tempo sviluppo:** 4-5 giorni
- **Righe codice modificate:** ~500-800 (principalmente aggiunte `data-testid`)
- **Rischio regressione:** Basso (solo aggiunte attributes, no logica)
- **Benefici:**
  - ✅ Tool Server navigation affidabile (95%+ success rate)
  - ✅ Test E2E robusti a refactoring
  - ✅ Migliore accessibilità (screen reader, keyboard)
  - ✅ Debugging più semplice (inspect DOM mostra stato)

**Raccomandazione:** Implementare Fase 1-2 come priorità alta (3 giorni), poi iterare su Fase 3-4.
