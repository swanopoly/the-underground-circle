-- Repair live projects that missed the agent identity and Office usage
-- migrations. This migration is intentionally idempotent and safe to run
-- after the original migrations.

-- Agent identities: durable per-user customizations for local/terminal agents.
CREATE TABLE IF NOT EXISTS public.agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_identities
  ADD COLUMN IF NOT EXISTS custom_name text,
  ADD COLUMN IF NOT EXISTS custom_color text,
  ADD COLUMN IF NOT EXISTS spirit_id text,
  ADD COLUMN IF NOT EXISTS spirit_emoji text,
  ADD COLUMN IF NOT EXISTS soul_prompt text,
  ADD COLUMN IF NOT EXISTS custom_profile_id text,
  ADD COLUMN IF NOT EXISTS custom_profile_name text,
  ADD COLUMN IF NOT EXISTS appearance jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_floor_id text,
  ADD COLUMN IF NOT EXISTS desk_index int,
  ADD COLUMN IF NOT EXISTS bond_id uuid,
  ADD COLUMN IF NOT EXISTS bond_level int,
  ADD COLUMN IF NOT EXISTS bond_xp int,
  ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_customized boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bound_ai_provider text,
  ADD COLUMN IF NOT EXISTS bound_model text,
  ADD COLUMN IF NOT EXISTS terminal_config jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS total_messages int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_turns int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_all_time numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens_all_time bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sessions_all_time int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS most_used_model text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS first_seen timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now();

UPDATE public.agent_identities
SET appearance = COALESCE(appearance, '{}'),
    terminal_config = COALESCE(terminal_config, '{}'),
    tags = COALESCE(tags, '{}'),
    first_seen = COALESCE(first_seen, now()),
    last_seen = COALESCE(last_seen, now()),
    updated_at = COALESCE(updated_at, now()),
    created_at = COALESCE(created_at, now());

-- If a partially migrated live table has duplicates, keep the newest row so
-- the unique on_conflict target can be added.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY user_id, session_key
      ORDER BY updated_at DESC NULLS LAST, last_seen DESC NULLS LAST, created_at DESC NULLS LAST, ctid DESC
    ) AS rn
  FROM public.agent_identities
  WHERE user_id IS NOT NULL
    AND session_key IS NOT NULL
)
DELETE FROM public.agent_identities ai
USING ranked r
WHERE ai.ctid = r.ctid
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_identities'::regclass
      AND conname = 'agent_identities_user_id_session_key_key'
  ) THEN
    ALTER TABLE public.agent_identities
      ADD CONSTRAINT agent_identities_user_id_session_key_key UNIQUE (user_id, session_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_identities_user
  ON public.agent_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_identities_session_key
  ON public.agent_identities(session_key);
CREATE INDEX IF NOT EXISTS idx_agent_identities_bond
  ON public.agent_identities(bond_id) WHERE bond_id IS NOT NULL;

ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own agent identities" ON public.agent_identities;
CREATE POLICY "Users read own agent identities"
  ON public.agent_identities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own agent identities" ON public.agent_identities;
CREATE POLICY "Users insert own agent identities"
  ON public.agent_identities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own agent identities" ON public.agent_identities;
CREATE POLICY "Users update own agent identities"
  ON public.agent_identities FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own agent identities" ON public.agent_identities;
CREATE POLICY "Users delete own agent identities"
  ON public.agent_identities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_agent_identities_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_identities_touch_updated_at ON public.agent_identities;
CREATE TRIGGER agent_identities_touch_updated_at
  BEFORE UPDATE ON public.agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_agent_identities_updated_at();

-- Office usage columns required by sync_agent_token_snapshot.
ALTER TABLE public.circle_office_agents
  ADD COLUMN IF NOT EXISTS token_usage_today bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_usage_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_count_today int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_count_total int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens_today bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_today bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens_today bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_today numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_total numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_name text;

CREATE TABLE IF NOT EXISTS public.circle_office_agent_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  snapshot_key text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  message_count int NOT NULL DEFAULT 0,
  estimated_cost numeric(12,6) NOT NULL DEFAULT 0,
  model_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, owner_id, agent_name, snapshot_key)
);

CREATE INDEX IF NOT EXISTS idx_office_usage_snapshots_agent
  ON public.circle_office_agent_usage_snapshots (circle_id, owner_id, lower(agent_name), last_seen_at DESC);

ALTER TABLE public.circle_office_agent_usage_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_usage_snapshots_owner_select ON public.circle_office_agent_usage_snapshots;
CREATE POLICY office_usage_snapshots_owner_select
  ON public.circle_office_agent_usage_snapshots FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS office_usage_snapshots_owner_manage ON public.circle_office_agent_usage_snapshots;
CREATE POLICY office_usage_snapshots_owner_manage
  ON public.circle_office_agent_usage_snapshots FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP FUNCTION IF EXISTS public.sync_agent_token_snapshot(uuid, uuid, text, bigint, bigint, bigint, int, numeric, text);

CREATE OR REPLACE FUNCTION public.sync_agent_token_snapshot(
  p_circle_id        uuid,
  p_owner_id         uuid,
  p_agent_name       text,
  p_input_tokens     bigint,
  p_output_tokens    bigint,
  p_cached_tokens    bigint  DEFAULT 0,
  p_message_count    int     DEFAULT 0,
  p_estimated_cost   numeric DEFAULT 0,
  p_model            text    DEFAULT NULL,
  p_snapshot_key     text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_key text := COALESCE(NULLIF(trim(p_snapshot_key), ''), lower(p_agent_name));
  v_prev_input bigint;
  v_prev_output bigint;
  v_prev_cached bigint;
  v_prev_msgs int;
  v_prev_cost numeric;
  v_current_today_tokens bigint;
  v_current_total_tokens bigint;
  v_delta_input bigint := 0;
  v_delta_output bigint := 0;
  v_delta_cached bigint := 0;
  v_delta_msgs int := 0;
  v_delta_cost numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'Not allowed to sync token snapshots for another user'
      USING ERRCODE = '42501';
  END IF;

  SELECT token_usage_today, token_usage_total
  INTO v_current_today_tokens, v_current_total_tokens
  FROM public.circle_office_agents
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(name) = lower(p_agent_name);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT input_tokens, output_tokens, cached_tokens, message_count, estimated_cost
  INTO v_prev_input, v_prev_output, v_prev_cached, v_prev_msgs, v_prev_cost
  FROM public.circle_office_agent_usage_snapshots
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(agent_name) = lower(p_agent_name)
    AND snapshot_key = v_snapshot_key
  FOR UPDATE;

  IF FOUND THEN
    v_delta_input := CASE
      WHEN p_input_tokens >= COALESCE(v_prev_input, 0) THEN p_input_tokens - COALESCE(v_prev_input, 0)
      ELSE GREATEST(p_input_tokens, 0)
    END;
    v_delta_output := CASE
      WHEN p_output_tokens >= COALESCE(v_prev_output, 0) THEN p_output_tokens - COALESCE(v_prev_output, 0)
      ELSE GREATEST(p_output_tokens, 0)
    END;
    v_delta_cached := CASE
      WHEN p_cached_tokens >= COALESCE(v_prev_cached, 0) THEN p_cached_tokens - COALESCE(v_prev_cached, 0)
      ELSE GREATEST(p_cached_tokens, 0)
    END;
    v_delta_msgs := CASE
      WHEN p_message_count >= COALESCE(v_prev_msgs, 0) THEN p_message_count - COALESCE(v_prev_msgs, 0)
      ELSE GREATEST(p_message_count, 0)
    END;
    v_delta_cost := CASE
      WHEN p_estimated_cost >= COALESCE(v_prev_cost, 0) THEN p_estimated_cost - COALESCE(v_prev_cost, 0)
      ELSE GREATEST(p_estimated_cost, 0)
    END;

    UPDATE public.circle_office_agent_usage_snapshots
    SET input_tokens = GREATEST(p_input_tokens, 0),
        output_tokens = GREATEST(p_output_tokens, 0),
        cached_tokens = GREATEST(p_cached_tokens, 0),
        message_count = GREATEST(p_message_count, 0),
        estimated_cost = GREATEST(p_estimated_cost, 0),
        model_name = COALESCE(p_model, model_name),
        last_seen_at = now()
    WHERE circle_id = p_circle_id
      AND owner_id = p_owner_id
      AND lower(agent_name) = lower(p_agent_name)
      AND snapshot_key = v_snapshot_key;
  ELSE
    IF COALESCE(v_current_today_tokens, 0) = 0 AND COALESCE(v_current_total_tokens, 0) = 0 THEN
      v_delta_input := GREATEST(p_input_tokens, 0);
      v_delta_output := GREATEST(p_output_tokens, 0);
      v_delta_cached := GREATEST(p_cached_tokens, 0);
      v_delta_msgs := GREATEST(p_message_count, 0);
      v_delta_cost := GREATEST(p_estimated_cost, 0);
    END IF;

    INSERT INTO public.circle_office_agent_usage_snapshots (
      circle_id, owner_id, agent_name, snapshot_key,
      input_tokens, output_tokens, cached_tokens, message_count, estimated_cost, model_name
    ) VALUES (
      p_circle_id, p_owner_id, p_agent_name, v_snapshot_key,
      GREATEST(p_input_tokens, 0), GREATEST(p_output_tokens, 0), GREATEST(p_cached_tokens, 0),
      GREATEST(p_message_count, 0), GREATEST(p_estimated_cost, 0), p_model
    )
    ON CONFLICT (circle_id, owner_id, agent_name, snapshot_key) DO UPDATE
    SET input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cached_tokens = EXCLUDED.cached_tokens,
        message_count = EXCLUDED.message_count,
        estimated_cost = EXCLUDED.estimated_cost,
        model_name = COALESCE(EXCLUDED.model_name, circle_office_agent_usage_snapshots.model_name),
        last_seen_at = now();
  END IF;

  IF v_delta_input = 0
    AND v_delta_output = 0
    AND v_delta_cached = 0
    AND v_delta_msgs = 0
    AND v_delta_cost = 0 THEN
    UPDATE public.circle_office_agents
    SET model_name = COALESCE(p_model, model_name),
        updated_at = now()
    WHERE circle_id = p_circle_id
      AND owner_id = p_owner_id
      AND lower(name) = lower(p_agent_name);
    RETURN;
  END IF;

  UPDATE public.circle_office_agents
  SET token_usage_today = token_usage_today + v_delta_input + v_delta_output,
      input_tokens_today = input_tokens_today + v_delta_input,
      output_tokens_today = output_tokens_today + v_delta_output,
      cached_tokens_today = cached_tokens_today + v_delta_cached,
      message_count_today = message_count_today + v_delta_msgs,
      estimated_cost_today = estimated_cost_today + v_delta_cost,
      token_usage_total = token_usage_total + v_delta_input + v_delta_output,
      input_tokens_total = input_tokens_total + v_delta_input,
      output_tokens_total = output_tokens_total + v_delta_output,
      cached_tokens_total = cached_tokens_total + v_delta_cached,
      message_count_total = message_count_total + v_delta_msgs,
      estimated_cost_total = estimated_cost_total + v_delta_cost,
      model_name = COALESCE(p_model, model_name),
      updated_at = now()
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(name) = lower(p_agent_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_agent_token_snapshot(uuid, uuid, text, bigint, bigint, bigint, int, numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
