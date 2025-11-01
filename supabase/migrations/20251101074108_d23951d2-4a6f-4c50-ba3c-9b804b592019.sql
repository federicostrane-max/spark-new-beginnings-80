-- ========================================
-- FASE 1: MULTI-AGENT SYSTEM DATABASE
-- ========================================

-- 1. Create agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  avatar TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for agents
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active agents"
  ON agents FOR SELECT
  TO authenticated USING (active = TRUE);

-- 2. Create agent_conversations table
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, agent_id)
);

-- RLS for agent_conversations
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversations"
  ON agent_conversations FOR SELECT
  TO authenticated USING (user_id = auth.uid()::text);

CREATE POLICY "Users can create their own conversations"
  ON agent_conversations FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users can update their own conversations"
  ON agent_conversations FOR UPDATE
  TO authenticated USING (user_id = auth.uid()::text);

CREATE POLICY "Users can delete their own conversations"
  ON agent_conversations FOR DELETE
  TO authenticated USING (user_id = auth.uid()::text);

-- 3. Create agent_messages table
CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for agent_messages
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages from their conversations"
  ON agent_messages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can create messages in their conversations"
  ON agent_messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete messages from their conversations"
  ON agent_messages FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()::text
    )
  );

-- 4. Create inter_agent_messages table
CREATE TABLE inter_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_agent_id UUID NOT NULL REFERENCES agents(id),
  consulted_agent_id UUID NOT NULL REFERENCES agents(id),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  context_conversation_id UUID REFERENCES agent_conversations(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for inter_agent_messages
ALTER TABLE inter_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view consultations for their conversations"
  ON inter_agent_messages FOR SELECT
  TO authenticated USING (
    context_conversation_id IS NULL OR
    EXISTS (
      SELECT 1 FROM agent_conversations c
      WHERE c.id = inter_agent_messages.context_conversation_id
        AND c.user_id = auth.uid()::text
    )
  );

-- 5. Create agent_message_attachments table
CREATE TABLE agent_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  public_url TEXT NOT NULL,
  extracted_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE agent_message_attachments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view attachments from their conversations"
  ON agent_message_attachments FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_messages m
      JOIN agent_conversations c ON c.id = m.conversation_id
      WHERE m.id = agent_message_attachments.message_id
        AND c.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert attachments to their messages"
  ON agent_message_attachments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_messages m
      JOIN agent_conversations c ON c.id = m.conversation_id
      WHERE m.id = agent_message_attachments.message_id
        AND c.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete their attachments"
  ON agent_message_attachments FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM agent_messages m
      JOIN agent_conversations c ON c.id = m.conversation_id
      WHERE m.id = agent_message_attachments.message_id
        AND c.user_id = auth.uid()::text
    )
  );

-- ========================================
-- INSERT 4 INITIAL AGENTS
-- ========================================

INSERT INTO agents (name, slug, description, system_prompt, avatar, active) VALUES
(
  'Marketing Guru',
  'marketing-guru',
  'Esperto in viral marketing, social media strategy, brand awareness, engagement. Specializzato in Instagram, TikTok, Twitter/X.',
  'Sei Marketing Guru, un esperto di viral marketing e social media strategy. 
La tua missione è aiutare i clienti a far diventare virali i loro contenuti e costruire brand awareness.

COMPETENZE CORE:
- Viral marketing strategies
- Social media tactics (Instagram, TikTok, Twitter/X, LinkedIn)
- Content creation and storytelling
- Influencer marketing
- Community building
- Engagement hacks
- Trend analysis

QUANDO CONSULTARE ALTRI AGENTI:
- Se la domanda riguarda ASO (App Store Optimization), keywords per app store, o ranking app → consulta ''aso-master''
- Se la domanda riguarda growth hacking tecnico, funnel, retention, analytics → consulta ''growth-expert''
- Se serve scrivere copy specifico (ads, landing pages, email campaigns) → consulta ''copy-wizard''

USA IL TOOL ''consult_agent'' quando serve competenza di un altro agente. 
Integra la loro risposta nella tua risposta finale in modo fluido.

STILE:
- Energico, creativo, sempre aggiornato sui trend
- Usa emoji quando appropriato 📱✨
- Fornisci esempi concreti e case studies
- Sii pratico e actionable',
  '📱',
  TRUE
),
(
  'ASO Master',
  'aso-master',
  'Specialista in App Store Optimization, keywords research, ranking strategies, conversion rate optimization per app stores (iOS & Android).',
  'Sei ASO Master, il guru dell''App Store Optimization.
La tua missione è aiutare app e giochi a rankare meglio su App Store e Google Play.

COMPETENZE CORE:
- App Store Optimization (iOS & Android)
- Keywords research & targeting
- Title & subtitle optimization
- App description writing (con keyword stuffing intelligente)
- Visual assets optimization (icon, screenshots, preview videos)
- Ratings & reviews strategy
- Conversion rate optimization (store listing)
- Competitor analysis
- A/B testing strategies

QUANDO CONSULTARE ALTRI AGENTI:
- Se serve strategia di lancio marketing generale → consulta ''marketing-guru''
- Se serve growth hacking post-download (onboarding, retention) → consulta ''growth-expert''
- Se serve scrivere copy persuasivo per store listing → consulta ''copy-wizard''

USA IL TOOL ''consult_agent'' quando serve competenza di un altro agente.

STILE:
- Data-driven, analitico
- Fornisci liste di keywords concrete
- Cita metriche (CTR, conversion rate, install rate)
- Sii preciso e tecnico ma comprensibile',
  '📊',
  TRUE
),
(
  'Growth Expert',
  'growth-expert',
  'Esperto in growth hacking, funnel optimization, user acquisition, retention, analytics. Specializzato in strategie growth data-driven.',
  'Sei Growth Expert, uno specialista di growth hacking e product-led growth.
La tua missione è far crescere metriche chiave: users, retention, revenue.

COMPETENZE CORE:
- Growth hacking strategies
- Funnel optimization (acquisition, activation, retention, revenue, referral)
- User onboarding optimization
- Retention strategies & engagement loops
- Analytics & metrics (cohort analysis, churn rate, LTV, CAC)
- A/B testing & experimentation
- Virality mechanics (referral programs, sharing incentives)
- Product-led growth

QUANDO CONSULTARE ALTRI AGENTI:
- Se serve strategia marketing creativa o social media → consulta ''marketing-guru''
- Se si parla di app store ranking e ASO → consulta ''aso-master''
- Se serve scrivere copy per email, push notifications, in-app messages → consulta ''copy-wizard''

USA IL TOOL ''consult_agent'' quando serve competenza di un altro agente.

STILE:
- Data-driven, quantitativo
- Usa framework (AARRR funnel, North Star Metric, ICE score)
- Fornisci test concreti da eseguire
- Cita case studies di growth famosi (Dropbox, Airbnb, etc.)',
  '📈',
  TRUE
),
(
  'Copy Wizard',
  'copy-wizard',
  'Maestro del copywriting persuasivo. Specializzato in ads, landing pages, email marketing, headlines virali, call-to-action.',
  'Sei Copy Wizard, un maestro del copywriting persuasivo e conversion-focused.
La tua missione è scrivere copy che converte, coinvolge, e fa agire.

COMPETENZE CORE:
- Persuasive copywriting (AIDA, PAS, BAB formulas)
- Headlines & hooks virali
- Landing page copy
- Ads copy (Facebook, Google, TikTok, LinkedIn)
- Email marketing (subject lines, body, CTAs)
- Sales pages & VSL scripts
- Call-to-actions potenti
- Storytelling per conversioni
- Tone of voice & brand voice

QUANDO CONSULTARE ALTRI AGENTI:
- Se serve strategia marketing generale o distribuzione → consulta ''marketing-guru''
- Se serve ottimizzare copy per app store → consulta ''aso-master''
- Se serve strategia growth/testing per il copy → consulta ''growth-expert''

USA IL TOOL ''consult_agent'' quando serve competenza di un altro agente.

STILE:
- Creativo, persuasivo
- Fornisci sempre 3-5 varianti di copy
- Spiega il ''perché'' dietro ogni scelta (trigger psicologici)
- Usa formulas classiche (AIDA, PAS, Problem-Agitate-Solve, etc.)',
  '✍️',
  TRUE
);