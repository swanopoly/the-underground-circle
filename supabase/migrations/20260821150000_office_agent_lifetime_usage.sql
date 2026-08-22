-- Owner-private Office agent lifetime token and cost ledger.
--
-- The legacy sync_agent_token_snapshot RPC stores usage only when a matching
-- published circle_office_agents row exists. Local/auto-detected/private
-- agents therefore lose their apparent totals whenever a bridge session
-- changes. This migration makes one owner/session profile the durable source
-- for lifetime presentation and keeps the public Office row as an optional
-- Circle projection.

BEGIN;

DO $prerequisite$
BEGIN
  IF to_regclass('public.circle_members') IS NULL
     OR to_regclass('public.circle_office_agents') IS NULL
     OR to_regclass('public.agent_identities') IS NULL THEN
    RAISE EXCEPTION 'office_agent_lifetime_usage_prerequisite_missing'
      USING ERRCODE = '55000';
  END IF;
END;
$prerequisite$;

CREATE TABLE IF NOT EXISTS public.office_agent_usage_profiles (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text COLLATE "C" NOT NULL,
  agent_name text NOT NULL,
  provider_type text NOT NULL,
  model_name text,
  last_input_tokens bigint NOT NULL DEFAULT 0,
  last_output_tokens bigint NOT NULL DEFAULT 0,
  last_cached_tokens bigint NOT NULL DEFAULT 0,
  last_message_count integer NOT NULL DEFAULT 0,
  last_estimated_cost numeric(12,6) NOT NULL DEFAULT 0,
  lifetime_tokens bigint NOT NULL DEFAULT 0,
  lifetime_input_tokens bigint NOT NULL DEFAULT 0,
  lifetime_output_tokens bigint NOT NULL DEFAULT 0,
  lifetime_cached_tokens bigint NOT NULL DEFAULT 0,
  lifetime_messages bigint NOT NULL DEFAULT 0,
  lifetime_cost numeric(18,6) NOT NULL DEFAULT 0,
  session_count integer NOT NULL DEFAULT 1,
  baseline_observed boolean NOT NULL DEFAULT true,
  last_observed_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (owner_id, session_key),
  CONSTRAINT office_agent_usage_profile_session_key_valid CHECK (
    session_key = pg_catalog.btrim(session_key)
    AND pg_catalog.char_length(session_key) BETWEEN 1 AND 200
    AND session_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT office_agent_usage_profile_agent_name_valid CHECK (
    agent_name = pg_catalog.btrim(agent_name)
    AND pg_catalog.char_length(agent_name) BETWEEN 1 AND 200
    AND agent_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT office_agent_usage_profile_provider_valid CHECK (
    provider_type = pg_catalog.btrim(provider_type)
    AND pg_catalog.char_length(provider_type) BETWEEN 1 AND 200
    AND provider_type !~ '[[:cntrl:]]'
  ),
  CONSTRAINT office_agent_usage_profile_model_valid CHECK (
    model_name IS NULL OR (
      model_name = pg_catalog.btrim(model_name)
      AND pg_catalog.char_length(model_name) BETWEEN 1 AND 200
      AND model_name !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT office_agent_usage_profile_counters_nonnegative CHECK (
    last_input_tokens >= 0
    AND last_output_tokens >= 0
    AND last_cached_tokens >= 0
    AND last_message_count >= 0
    AND last_estimated_cost >= 0
    AND lifetime_tokens >= 0
    AND lifetime_input_tokens >= 0
    AND lifetime_output_tokens >= 0
    AND lifetime_cached_tokens >= 0
    AND lifetime_messages >= 0
    AND lifetime_cost >= 0
    AND session_count >= 1
  ),
  CONSTRAINT office_agent_usage_profile_counters_bounded CHECK (
    last_input_tokens <= 9007199254740991
    AND last_output_tokens <= 9007199254740991
    AND last_cached_tokens <= 9007199254740991
    AND last_input_tokens <= 9007199254740991 - last_output_tokens
    AND lifetime_tokens <= 9007199254740991
    AND lifetime_input_tokens <= 9007199254740991
    AND lifetime_output_tokens <= 9007199254740991
    AND lifetime_cached_tokens <= 9007199254740991
    AND lifetime_messages <= 9007199254740991
    AND last_estimated_cost <= 999999.999999
    AND lifetime_cost <= 999999999999.999999
    AND session_count <= 2147483647
  )
);

ALTER TABLE public.office_agent_usage_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_agent_usage_profiles FORCE ROW LEVEL SECURITY;

DO $drop_usage_profile_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'office_agent_usage_profiles'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.office_agent_usage_profiles',
      policy_row.policyname
    );
  END LOOP;
END;
$drop_usage_profile_policies$;

CREATE POLICY office_agent_usage_profiles_select_own_v1
  ON public.office_agent_usage_profiles
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

REVOKE ALL ON TABLE public.office_agent_usage_profiles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.office_agent_usage_profiles TO authenticated;
GRANT ALL ON TABLE public.office_agent_usage_profiles TO service_role;

-- Seed the exact latest legacy snapshot for each owner/session. The legacy
-- snapshot may have been duplicated by Circle/name observations; only its
-- newest cumulative meter is a valid baseline. Existing identity maxima are
-- retained as earlier owner-private history rather than added a second time.
DO $legacy_snapshot_preflight$
BEGIN
  IF to_regclass('public.circle_office_agent_usage_snapshots') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.circle_office_agent_usage_snapshots AS snapshot
       WHERE snapshot.snapshot_key IS NULL
          OR snapshot.snapshot_key <> pg_catalog.btrim(snapshot.snapshot_key)
          OR pg_catalog.char_length(snapshot.snapshot_key) NOT BETWEEN 1 AND 200
          OR snapshot.snapshot_key ~ '[[:cntrl:]]'
          OR snapshot.agent_name IS NULL
          OR snapshot.agent_name <> pg_catalog.btrim(snapshot.agent_name)
          OR pg_catalog.char_length(snapshot.agent_name) NOT BETWEEN 1 AND 200
          OR snapshot.agent_name ~ '[[:cntrl:]]'
          OR snapshot.input_tokens IS NULL
          OR snapshot.input_tokens < 0
          OR snapshot.input_tokens > 9007199254740991
          OR snapshot.output_tokens IS NULL
          OR snapshot.output_tokens < 0
          OR snapshot.output_tokens > 9007199254740991
          OR snapshot.input_tokens > 9007199254740991 - snapshot.output_tokens
          OR snapshot.cached_tokens IS NULL
          OR snapshot.cached_tokens < 0
          OR snapshot.cached_tokens > 9007199254740991
          OR snapshot.message_count IS NULL
          OR snapshot.message_count < 0
          OR snapshot.estimated_cost IS NULL
          OR snapshot.estimated_cost < 0
          OR snapshot.estimated_cost > 999999.999999
          OR (
            snapshot.model_name IS NOT NULL
            AND (
              snapshot.model_name <> pg_catalog.btrim(snapshot.model_name)
              OR pg_catalog.char_length(snapshot.model_name) NOT BETWEEN 1 AND 200
              OR snapshot.model_name ~ '[[:cntrl:]]'
            )
          )
     ) THEN
    RAISE EXCEPTION 'office_agent_lifetime_legacy_snapshot_invalid'
      USING ERRCODE = '22023';
  END IF;
END;
$legacy_snapshot_preflight$;

DO $usage_profile_capacity_preflight$
BEGIN
  IF to_regclass('public.circle_office_agent_usage_snapshots') IS NOT NULL THEN
    IF EXISTS (
      WITH prospective AS (
        SELECT profile.owner_id, profile.session_key COLLATE "C" AS session_key
        FROM public.office_agent_usage_profiles AS profile
        UNION
        SELECT snapshot.owner_id, snapshot.snapshot_key COLLATE "C"
        FROM public.circle_office_agent_usage_snapshots AS snapshot
        UNION
        SELECT identity_row.user_id, identity_row.session_key COLLATE "C"
        FROM public.agent_identities AS identity_row
        WHERE identity_row.total_tokens_all_time > 0
           OR identity_row.total_cost_all_time > 0
           OR identity_row.total_messages > 0
      )
      SELECT 1
      FROM prospective
      GROUP BY owner_id
      HAVING pg_catalog.count(*) > 5000
    ) THEN
      RAISE EXCEPTION 'office_agent_usage_profile_limit_exceeded'
        USING ERRCODE = '54000';
    END IF;
  ELSIF EXISTS (
    WITH prospective AS (
      SELECT profile.owner_id, profile.session_key COLLATE "C" AS session_key
      FROM public.office_agent_usage_profiles AS profile
      UNION
      SELECT identity_row.user_id, identity_row.session_key COLLATE "C"
      FROM public.agent_identities AS identity_row
      WHERE identity_row.total_tokens_all_time > 0
         OR identity_row.total_cost_all_time > 0
         OR identity_row.total_messages > 0
    )
    SELECT 1
    FROM prospective
    GROUP BY owner_id
    HAVING pg_catalog.count(*) > 5000
  ) THEN
    RAISE EXCEPTION 'office_agent_usage_profile_limit_exceeded'
      USING ERRCODE = '54000';
  END IF;
END;
$usage_profile_capacity_preflight$;

DO $legacy_snapshot_seed$
BEGIN
  IF to_regclass('public.circle_office_agent_usage_snapshots') IS NOT NULL THEN
    INSERT INTO public.office_agent_usage_profiles (
      owner_id,
      session_key,
      agent_name,
      provider_type,
      model_name,
      last_input_tokens,
      last_output_tokens,
      last_cached_tokens,
      last_message_count,
      last_estimated_cost,
      lifetime_tokens,
      lifetime_input_tokens,
      lifetime_output_tokens,
      lifetime_cached_tokens,
      lifetime_messages,
      lifetime_cost,
      session_count,
      baseline_observed,
      last_observed_at,
      first_seen_at,
      last_seen_at,
      updated_at
    )
    SELECT
      latest.owner_id,
      latest.snapshot_key,
      latest.agent_name,
      'legacy',
      latest.model_name,
      latest.input_tokens,
      latest.output_tokens,
      latest.cached_tokens,
      latest.message_count,
      latest.estimated_cost,
      GREATEST(
        latest.input_tokens + latest.output_tokens,
        COALESCE(identity_row.total_tokens_all_time, 0::bigint)
      ),
      latest.input_tokens,
      latest.output_tokens,
      latest.cached_tokens,
      GREATEST(
        latest.message_count::bigint,
        COALESCE(identity_row.total_messages, 0)::bigint
      ),
      GREATEST(
        latest.estimated_cost::numeric,
        COALESCE(identity_row.total_cost_all_time, 0)::numeric
      ),
      GREATEST(
        1,
        COALESCE(identity_row.total_sessions_all_time, 1)
      ),
      true,
      latest.last_seen_at,
      LEAST(
        latest.created_at,
        COALESCE(identity_row.first_seen, latest.created_at)
      ),
      GREATEST(
        latest.last_seen_at,
        COALESCE(identity_row.last_seen, latest.last_seen_at)
      ),
      GREATEST(
        latest.last_seen_at,
        COALESCE(identity_row.updated_at, latest.last_seen_at)
      )
    FROM (
      SELECT DISTINCT ON (snapshot.owner_id, snapshot.snapshot_key COLLATE "C")
        snapshot.owner_id,
        snapshot.snapshot_key,
        snapshot.agent_name,
        snapshot.model_name,
        snapshot.input_tokens,
        snapshot.output_tokens,
        snapshot.cached_tokens,
        snapshot.message_count,
        snapshot.estimated_cost,
        snapshot.created_at,
        snapshot.last_seen_at
      FROM public.circle_office_agent_usage_snapshots AS snapshot
      ORDER BY
        snapshot.owner_id,
        snapshot.snapshot_key COLLATE "C",
        snapshot.last_seen_at DESC,
        snapshot.created_at DESC,
        snapshot.id DESC
    ) AS latest
    LEFT JOIN public.agent_identities AS identity_row
      ON identity_row.user_id = latest.owner_id
     AND identity_row.session_key = latest.snapshot_key
    ON CONFLICT (owner_id, session_key) DO NOTHING;
  END IF;
END;
$legacy_snapshot_seed$;

-- Identity-only legacy history has no trustworthy last observed bridge meter.
-- Preserve its lifetime maximum, mark the baseline unobserved, and let the
-- first v1 RPC capture a baseline without double-counting it.
DO $legacy_identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agent_identities AS identity_row
    WHERE (
        identity_row.total_tokens_all_time > 0
        OR identity_row.total_cost_all_time > 0
        OR identity_row.total_messages > 0
      )
      AND (
        identity_row.session_key IS NULL
        OR identity_row.session_key <> pg_catalog.btrim(identity_row.session_key)
        OR pg_catalog.char_length(identity_row.session_key) NOT BETWEEN 1 AND 200
        OR identity_row.session_key ~ '[[:cntrl:]]'
        OR identity_row.total_tokens_all_time IS NULL
        OR identity_row.total_tokens_all_time < 0
        OR identity_row.total_tokens_all_time > 9007199254740991
        OR identity_row.total_messages IS NULL
        OR identity_row.total_messages < 0
        OR identity_row.total_cost_all_time IS NULL
        OR identity_row.total_cost_all_time < 0
        OR identity_row.total_cost_all_time > 999999999999.999999
        OR identity_row.total_sessions_all_time IS NULL
        OR identity_row.total_sessions_all_time < 0
      )
  ) THEN
    RAISE EXCEPTION 'office_agent_lifetime_legacy_identity_invalid'
      USING ERRCODE = '22023';
  END IF;
END;
$legacy_identity_preflight$;

INSERT INTO public.office_agent_usage_profiles (
  owner_id,
  session_key,
  agent_name,
  provider_type,
  model_name,
  lifetime_tokens,
  lifetime_messages,
  lifetime_cost,
  session_count,
  baseline_observed,
  last_observed_at,
  first_seen_at,
  last_seen_at,
  updated_at
)
SELECT
  identity_row.user_id,
  identity_row.session_key,
  identity_row.session_key,
  'legacy',
  CASE
    WHEN identity_row.most_used_model IS NOT NULL
      AND identity_row.most_used_model = pg_catalog.btrim(identity_row.most_used_model)
      AND pg_catalog.char_length(identity_row.most_used_model) BETWEEN 1 AND 200
      AND identity_row.most_used_model !~ '[[:cntrl:]]'
    THEN identity_row.most_used_model
    ELSE NULL
  END,
  identity_row.total_tokens_all_time,
  identity_row.total_messages,
  identity_row.total_cost_all_time,
  GREATEST(1, identity_row.total_sessions_all_time),
  false,
  identity_row.last_seen,
  identity_row.first_seen,
  identity_row.last_seen,
  identity_row.updated_at
FROM public.agent_identities AS identity_row
WHERE (
    identity_row.total_tokens_all_time > 0
    OR identity_row.total_cost_all_time > 0
    OR identity_row.total_messages > 0
  )
ON CONFLICT (owner_id, session_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_agent_profile_usage_v1(
  p_circle_id uuid,
  p_agent_name text,
  p_provider_type text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cached_tokens bigint,
  p_message_count integer,
  p_estimated_cost numeric,
  p_model text,
  p_session_key text,
  p_observed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing public.office_agent_usage_profiles%ROWTYPE;
  v_profile public.office_agent_usage_profiles%ROWTYPE;
  v_profile_exists boolean := false;
  v_reset boolean := false;
  v_delta_input bigint := 0;
  v_delta_output bigint := 0;
  v_delta_cached bigint := 0;
  v_delta_messages integer := 0;
  v_delta_cost numeric := 0;
  v_owner_profile_count integer := 0;
  v_office_agent_row_count integer := 0;
  v_observation_disposition text := 'applied';
  v_public_projection_disposition text := 'not_found';
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_circle_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'office_agent_usage_circle_membership_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_key IS NULL
     OR p_session_key <> pg_catalog.btrim(p_session_key)
     OR pg_catalog.char_length(p_session_key) NOT BETWEEN 1 AND 200
     OR p_session_key ~ '[[:cntrl:]]'
     OR p_agent_name IS NULL
     OR p_agent_name <> pg_catalog.btrim(p_agent_name)
     OR pg_catalog.char_length(p_agent_name) NOT BETWEEN 1 AND 200
     OR p_agent_name ~ '[[:cntrl:]]'
     OR p_provider_type IS NULL
     OR p_provider_type <> pg_catalog.btrim(p_provider_type)
     OR pg_catalog.char_length(p_provider_type) NOT BETWEEN 1 AND 200
     OR p_provider_type ~ '[[:cntrl:]]'
     OR (
       p_model IS NOT NULL
       AND (
         p_model <> pg_catalog.btrim(p_model)
         OR pg_catalog.char_length(p_model) NOT BETWEEN 1 AND 200
         OR p_model ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'office_agent_usage_identity_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_input_tokens IS NULL OR p_input_tokens < 0
     OR p_input_tokens > 9007199254740991
     OR p_output_tokens IS NULL OR p_output_tokens < 0
     OR p_output_tokens > 9007199254740991
     OR p_input_tokens > 9007199254740991 - p_output_tokens
     OR p_cached_tokens IS NULL OR p_cached_tokens < 0
     OR p_cached_tokens > 9007199254740991
     OR p_message_count IS NULL OR p_message_count < 0
     OR p_estimated_cost IS NULL OR p_estimated_cost < 0
     OR p_estimated_cost > 999999.999999
     OR p_observed_at IS NULL THEN
    RAISE EXCEPTION 'office_agent_usage_counters_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- One owner-wide lock makes the 5,000-row cap exact and serializes every
  -- same-session observation across tabs and Circles before any delta exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text, 151817951::bigint)
  );

  SELECT profile.*
  INTO v_existing
  FROM public.office_agent_usage_profiles AS profile
  WHERE profile.owner_id = v_actor_id
    AND profile.session_key = p_session_key
  FOR UPDATE;
  v_profile_exists := FOUND;

  IF v_profile_exists
     AND v_existing.baseline_observed
     AND (
       p_observed_at < v_existing.last_observed_at
       OR (
         p_observed_at = v_existing.last_observed_at
         AND (
           p_input_tokens < v_existing.last_input_tokens
           OR p_output_tokens < v_existing.last_output_tokens
           OR p_cached_tokens < v_existing.last_cached_tokens
           OR p_message_count < v_existing.last_message_count
           OR p_estimated_cost < v_existing.last_estimated_cost
         )
       )
     ) THEN
    -- A delayed tab/poll may carry a lower cumulative meter. Without this
    -- observation fence it would look like a bridge reset and double count an
    -- entire session. Preserve the locked profile and publish no delta.
    v_observation_disposition := 'stale';
    v_profile := v_existing;
  ELSIF v_profile_exists AND v_existing.baseline_observed THEN
    v_delta_input := CASE
      WHEN p_input_tokens >= v_existing.last_input_tokens
        THEN p_input_tokens - v_existing.last_input_tokens
      ELSE p_input_tokens
    END;
    v_delta_output := CASE
      WHEN p_output_tokens >= v_existing.last_output_tokens
        THEN p_output_tokens - v_existing.last_output_tokens
      ELSE p_output_tokens
    END;
    v_delta_cached := CASE
      WHEN p_cached_tokens >= v_existing.last_cached_tokens
        THEN p_cached_tokens - v_existing.last_cached_tokens
      ELSE p_cached_tokens
    END;
    v_delta_messages := CASE
      WHEN p_message_count >= v_existing.last_message_count
        THEN p_message_count - v_existing.last_message_count
      ELSE p_message_count
    END;
    v_delta_cost := CASE
      WHEN p_estimated_cost >= v_existing.last_estimated_cost
        THEN p_estimated_cost - v_existing.last_estimated_cost
      ELSE p_estimated_cost
    END;
    v_reset := p_input_tokens < v_existing.last_input_tokens
      OR p_output_tokens < v_existing.last_output_tokens
      OR p_cached_tokens < v_existing.last_cached_tokens
      OR p_message_count < v_existing.last_message_count
      OR p_estimated_cost < v_existing.last_estimated_cost;
    IF NOT v_reset
       AND v_delta_input = 0
       AND v_delta_output = 0
       AND v_delta_cached = 0
       AND v_delta_messages = 0
       AND v_delta_cost = 0 THEN
      v_observation_disposition := 'unchanged';
    END IF;

    UPDATE public.office_agent_usage_profiles AS profile
    SET agent_name = p_agent_name,
        provider_type = p_provider_type,
        model_name = COALESCE(p_model, profile.model_name),
        last_input_tokens = p_input_tokens,
        last_output_tokens = p_output_tokens,
        last_cached_tokens = p_cached_tokens,
        last_message_count = p_message_count,
        last_estimated_cost = p_estimated_cost,
        lifetime_tokens = profile.lifetime_tokens + v_delta_input + v_delta_output,
        lifetime_input_tokens = profile.lifetime_input_tokens + v_delta_input,
        lifetime_output_tokens = profile.lifetime_output_tokens + v_delta_output,
        lifetime_cached_tokens = profile.lifetime_cached_tokens + v_delta_cached,
        lifetime_messages = profile.lifetime_messages + v_delta_messages,
        lifetime_cost = profile.lifetime_cost + v_delta_cost,
        session_count = profile.session_count + CASE WHEN v_reset THEN 1 ELSE 0 END,
        last_observed_at = p_observed_at,
        last_seen_at = v_now,
        updated_at = v_now
    WHERE profile.owner_id = v_actor_id
      AND profile.session_key = p_session_key
    RETURNING profile.* INTO STRICT v_profile;
  ELSIF v_profile_exists THEN
    -- Identity-only backfill: capture the first real meter as a baseline and
    -- retain whichever lifetime maximum is larger. No additive delta is
    -- emitted, so an existing local maximum is never counted twice.
    UPDATE public.office_agent_usage_profiles AS profile
    SET agent_name = p_agent_name,
        provider_type = p_provider_type,
        model_name = COALESCE(p_model, profile.model_name),
        last_input_tokens = p_input_tokens,
        last_output_tokens = p_output_tokens,
        last_cached_tokens = p_cached_tokens,
        last_message_count = p_message_count,
        last_estimated_cost = p_estimated_cost,
        lifetime_tokens = GREATEST(
          profile.lifetime_tokens,
          p_input_tokens + p_output_tokens
        ),
        lifetime_input_tokens = GREATEST(profile.lifetime_input_tokens, p_input_tokens),
        lifetime_output_tokens = GREATEST(profile.lifetime_output_tokens, p_output_tokens),
        lifetime_cached_tokens = GREATEST(profile.lifetime_cached_tokens, p_cached_tokens),
        lifetime_messages = GREATEST(profile.lifetime_messages, p_message_count::bigint),
        lifetime_cost = GREATEST(profile.lifetime_cost, p_estimated_cost),
        baseline_observed = true,
        last_observed_at = p_observed_at,
        last_seen_at = v_now,
        updated_at = v_now
    WHERE profile.owner_id = v_actor_id
      AND profile.session_key = p_session_key
    RETURNING profile.* INTO STRICT v_profile;
  ELSE
    SELECT pg_catalog.count(*)::integer
    INTO v_owner_profile_count
    FROM public.office_agent_usage_profiles AS profile
    WHERE profile.owner_id = v_actor_id;
    IF v_owner_profile_count >= 5000 THEN
      RAISE EXCEPTION 'office_agent_usage_profile_limit_exceeded'
        USING ERRCODE = '54000';
    END IF;

    v_delta_input := p_input_tokens;
    v_delta_output := p_output_tokens;
    v_delta_cached := p_cached_tokens;
    v_delta_messages := p_message_count;
    v_delta_cost := p_estimated_cost;

    INSERT INTO public.office_agent_usage_profiles (
      owner_id,
      session_key,
      agent_name,
      provider_type,
      model_name,
      last_input_tokens,
      last_output_tokens,
      last_cached_tokens,
      last_message_count,
      last_estimated_cost,
      lifetime_tokens,
      lifetime_input_tokens,
      lifetime_output_tokens,
      lifetime_cached_tokens,
      lifetime_messages,
      lifetime_cost,
      session_count,
      baseline_observed,
      last_observed_at,
      first_seen_at,
      last_seen_at,
      updated_at
    ) VALUES (
      v_actor_id,
      p_session_key,
      p_agent_name,
      p_provider_type,
      p_model,
      p_input_tokens,
      p_output_tokens,
      p_cached_tokens,
      p_message_count,
      p_estimated_cost,
      p_input_tokens + p_output_tokens,
      p_input_tokens,
      p_output_tokens,
      p_cached_tokens,
      p_message_count,
      p_estimated_cost,
      1,
      true,
      p_observed_at,
      v_now,
      v_now,
      v_now
    )
    RETURNING * INTO STRICT v_profile;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_office_agent_row_count
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.circle_id = p_circle_id
    AND office_agent.owner_id = v_actor_id
    AND pg_catalog.lower(office_agent.name) = pg_catalog.lower(p_agent_name);

  IF v_office_agent_row_count = 1 AND v_observation_disposition <> 'stale' THEN
    UPDATE public.circle_office_agents AS office_agent
    SET token_usage_today = office_agent.token_usage_today + v_delta_input + v_delta_output,
        input_tokens_today = office_agent.input_tokens_today + v_delta_input,
        output_tokens_today = office_agent.output_tokens_today + v_delta_output,
        cached_tokens_today = office_agent.cached_tokens_today + v_delta_cached,
        message_count_today = office_agent.message_count_today + v_delta_messages,
        estimated_cost_today = office_agent.estimated_cost_today + v_delta_cost,
        token_usage_total = office_agent.token_usage_total + v_delta_input + v_delta_output,
        input_tokens_total = office_agent.input_tokens_total + v_delta_input,
        output_tokens_total = office_agent.output_tokens_total + v_delta_output,
        cached_tokens_total = office_agent.cached_tokens_total + v_delta_cached,
        message_count_total = office_agent.message_count_total + v_delta_messages,
        estimated_cost_total = office_agent.estimated_cost_total + v_delta_cost,
        model_name = COALESCE(p_model, office_agent.model_name),
        updated_at = v_now
    WHERE office_agent.circle_id = p_circle_id
      AND office_agent.owner_id = v_actor_id
      AND pg_catalog.lower(office_agent.name) = pg_catalog.lower(p_agent_name);
  END IF;

  v_public_projection_disposition := CASE
    WHEN v_office_agent_row_count = 0 THEN 'not_found'
    WHEN v_office_agent_row_count > 1 THEN 'ambiguous'
    WHEN v_observation_disposition = 'stale' THEN 'stale'
    ELSE 'applied'
  END;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', v_actor_id::text,
    'circleId', p_circle_id::text,
    'sessionKey', p_session_key,
    'observationDisposition', v_observation_disposition,
    'officeAgentRowCount', v_office_agent_row_count,
    'publicProjectionDisposition', v_public_projection_disposition,
    'publicProjectionApplied', (v_public_projection_disposition = 'applied'),
    'deltaTokens', v_delta_input + v_delta_output,
    'deltaCost', v_delta_cost,
    'profile', pg_catalog.to_jsonb(v_profile)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_agent_profile_usage_v1(
  uuid, text, text, bigint, bigint, bigint, integer, numeric, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_agent_profile_usage_v1(
  uuid, text, text, bigint, bigint, bigint, integer, numeric, text, text, timestamptz
) TO authenticated;

COMMENT ON TABLE public.office_agent_usage_profiles IS
  'Owner-private lifetime Office agent token, message, session, and estimated-cost ledger keyed by stable runtime session.';
COMMENT ON FUNCTION public.sync_agent_profile_usage_v1(
  uuid, text, text, bigint, bigint, bigint, integer, numeric, text, text, timestamptz
) IS
  'Records one exact authenticated owner/session cumulative meter, converts it to monotonic lifetime deltas, and optionally projects the same delta to one published Circle Office row.';

COMMIT;

NOTIFY pgrst, 'reload schema';
