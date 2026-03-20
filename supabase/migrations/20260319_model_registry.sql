-- Model Registry — auto-updated by model-registry edge function
-- Stores latest available models from OpenAI, Google, HuggingFace
-- Frontend reads from this table; edge function refreshes it daily

CREATE TABLE IF NOT EXISTS model_registry (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider       text NOT NULL,                -- 'openai', 'google', 'huggingface'
  model_id       text NOT NULL,                -- e.g. 'gpt-4.1', 'gemini-2.5-pro'
  label          text NOT NULL,                -- Human-readable name
  category       text NOT NULL DEFAULT 'chat', -- 'chat', 'reasoning', 'code', 'image', 'embedding', 'audio', 'other'
  tier           text NOT NULL DEFAULT 'mid',  -- 'frontier', 'mid', 'budget', 'free'
  input_cost_per_m  numeric DEFAULT 0,         -- Cost per 1M input tokens
  output_cost_per_m numeric DEFAULT 0,         -- Cost per 1M output tokens
  context_window    integer DEFAULT 128000,
  supports_vision   boolean DEFAULT false,
  supports_tools    boolean DEFAULT true,
  released_at       timestamptz,
  is_active         boolean DEFAULT true,
  api_compatible    text DEFAULT 'openai',     -- API format: 'openai', 'google', 'anthropic'
  last_verified_at  timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(provider, model_id)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry (is_active, provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry (tier, category);

-- RLS: Everyone can read, only service role can write
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read models"
  ON model_registry FOR SELECT
  USING (true);

-- Notify PostgREST to pick up the new table
NOTIFY pgrst, 'reload schema';
