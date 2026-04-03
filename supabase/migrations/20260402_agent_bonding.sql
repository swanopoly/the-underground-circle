-- Agent Bonding & Session Persistence
-- Enables users to bond with custom Pixel Agents and maintain persistent AI sessions.
-- Custom agents are prioritized; assigned Claude/AI sessions stick with their agent.

-- ─── Agent Bonds (user <-> agent relationship) ──────────────────────────────

CREATE TABLE IF NOT EXISTS agent_bonds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL,
  agent_session_key TEXT NOT NULL,         -- stable agent identity key (e.g. "rapid-slug")
  agent_name TEXT NOT NULL,                -- display name at time of bonding

  -- Bonding metrics
  bond_level INT DEFAULT 1 CHECK (bond_level BETWEEN 1 AND 10),  -- 1=acquaintance, 10=legendary
  bond_xp INT DEFAULT 0,                  -- XP toward next bond level
  interaction_count INT DEFAULT 0,         -- total interactions
  total_tokens_together BIGINT DEFAULT 0,  -- tokens processed together
  total_sessions_together INT DEFAULT 0,   -- number of sessions shared

  -- SOUL personality evolution
  soul_traits JSONB DEFAULT '{}',          -- evolved personality traits from interactions
  favorite_topics TEXT[] DEFAULT '{}',     -- topics discussed most
  communication_style TEXT,                -- learned style preference (concise/detailed/casual/formal)
  strengths TEXT[] DEFAULT '{}',           -- what the agent is good at with this user

  -- Session binding
  bound_ai_provider TEXT,                  -- 'claude' | 'gemini' | 'blackswan' | null
  bound_model TEXT,                        -- specific model ID this agent uses
  is_primary BOOLEAN DEFAULT false,        -- user's primary/favorite agent

  -- Appearance snapshot (so bond card shows the agent as customized)
  appearance_snapshot JSONB,               -- full AgentAppearance at last interaction

  -- Timestamps
  first_bonded_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, circle_id, agent_session_key)
);

-- ─── Agent Conversation History (persistent across sessions) ─────────────────

CREATE TABLE IF NOT EXISTS agent_conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id UUID NOT NULL REFERENCES agent_bonds(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model_used TEXT,                         -- which AI model generated this
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast conversation retrieval
CREATE INDEX IF NOT EXISTS idx_agent_conv_bond_id ON agent_conversation_history(bond_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conv_circle ON agent_conversation_history(circle_id, created_at DESC);

-- ─── Agent Memory (long-term context for SOUL) ──────────────────────────────

CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id UUID NOT NULL REFERENCES agent_bonds(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('fact', 'preference', 'goal', 'skill', 'personality')),
  content TEXT NOT NULL,
  importance INT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),  -- 1=trivial, 10=core identity
  source TEXT,                             -- where this memory came from
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ                   -- null = permanent
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_bond ON agent_memory(bond_id, importance DESC);

-- ─── RLS Policies ────────────────────────────────────────────────────────────

ALTER TABLE agent_bonds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Users can only access their own bonds
CREATE POLICY agent_bonds_select ON agent_bonds FOR SELECT USING (user_id = auth.uid());
CREATE POLICY agent_bonds_insert ON agent_bonds FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY agent_bonds_update ON agent_bonds FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY agent_bonds_delete ON agent_bonds FOR DELETE USING (user_id = auth.uid());

-- Conversation history scoped to user's bonds
CREATE POLICY agent_conv_select ON agent_conversation_history FOR SELECT
  USING (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));
CREATE POLICY agent_conv_insert ON agent_conversation_history FOR INSERT
  WITH CHECK (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));

-- Memory scoped to user's bonds
CREATE POLICY agent_memory_select ON agent_memory FOR SELECT
  USING (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));
CREATE POLICY agent_memory_insert ON agent_memory FOR INSERT
  WITH CHECK (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));
CREATE POLICY agent_memory_update ON agent_memory FOR UPDATE
  USING (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));
CREATE POLICY agent_memory_delete ON agent_memory FOR DELETE
  USING (bond_id IN (SELECT id FROM agent_bonds WHERE user_id = auth.uid()));

-- ─── Bond Level Thresholds ───────────────────────────────────────────────────
-- Level 1: Acquaintance (0 XP)
-- Level 2: Familiar (100 XP)
-- Level 3: Trusted (300 XP)
-- Level 4: Companion (600 XP)
-- Level 5: Partner (1000 XP)
-- Level 6: Soulmate (1500 XP)
-- Level 7: Legendary (2500 XP)
-- Level 8: Mythic (4000 XP)
-- Level 9: Transcendent (6000 XP)
-- Level 10: Eternal (10000 XP)

COMMENT ON TABLE agent_bonds IS 'Tracks the relationship between a user and their custom Pixel Agent. Bond level increases through interaction, driving SOUL personality evolution.';
COMMENT ON TABLE agent_conversation_history IS 'Persistent conversation history per agent bond, surviving page refreshes and session reconnects.';
COMMENT ON TABLE agent_memory IS 'Long-term agent memory for SOUL personality. Stores facts, preferences, goals, and learned traits.';
