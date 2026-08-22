-- §37 — truthful Office dashboard state and complete per-floor presets.
--
-- 1. Replaces the global profiles.office_layout write target with one
--    user+circle row and an RPC-only monotonic exact-receipt version gate
--    (legacy blob remains readable; unsafe/far-future versions are rejected).
-- 2. Persists Office attention dismissals across remounts/devices, binds an
--    optional run to the same circle, and stamps acknowledgement expiry server-side.
-- 3. Saves private complete-floor presets (theme, agents, furniture/tools/state).

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_office_layout_document(p_layout jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  floor_row jsonb;
BEGIN
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RETURN false;
  END IF;
  IF octet_length(p_layout::text) > 512000 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_layout -> 'floors') <> 'array'
     OR jsonb_array_length(p_layout -> 'floors') < 1
     OR jsonb_array_length(p_layout -> 'floors') > 10 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_layout -> 'currentFloorId') <> 'string'
     OR length(p_layout ->> 'currentFloorId') > 200 THEN
    RETURN false;
  END IF;

  FOR floor_row IN SELECT value FROM jsonb_array_elements(p_layout -> 'floors')
  LOOP
    IF jsonb_typeof(floor_row) <> 'object' THEN RETURN false; END IF;
    IF jsonb_typeof(floor_row -> 'furniture') <> 'array'
       OR jsonb_array_length(floor_row -> 'furniture') > 100 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(floor_row -> 'agentIds') <> 'array'
       OR jsonb_array_length(floor_row -> 'agentIds') > 30 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_office_layout_document(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_office_layout_document(jsonb) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.office_layouts (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  layout jsonb NOT NULL,
  layout_version bigint NOT NULL CHECK (layout_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, circle_id),
  CONSTRAINT office_layouts_document_valid CHECK (public.validate_office_layout_document(layout)),
  CONSTRAINT office_layouts_version_matches_document CHECK (
    (layout ->> 'updatedAt') ~ '^[0-9]{1,18}$'
    AND (layout ->> 'updatedAt')::bigint = layout_version
  )
);

-- Older revisions allowed a client clock arbitrarily far in the future. Repair
-- those rows before raw mutation authority is removed, preserving the payload
-- while bringing its exact version field back to the migration's server clock.
LOCK TABLE public.office_layouts IN SHARE ROW EXCLUSIVE MODE;
WITH repair_clock AS (
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS repair_version
)
UPDATE public.office_layouts AS ol
SET layout = jsonb_set(ol.layout, '{updatedAt}', to_jsonb(repair_clock.repair_version), true),
    layout_version = repair_clock.repair_version,
    updated_at = clock_timestamp()
FROM repair_clock
WHERE ol.layout_version > 9007199254740991
   OR ol.layout_version > repair_clock.repair_version + 300000;
ALTER TABLE public.office_layouts
  DROP CONSTRAINT IF EXISTS office_layouts_version_javascript_safe;
ALTER TABLE public.office_layouts
  ADD CONSTRAINT office_layouts_version_javascript_safe
  CHECK (layout_version <= 9007199254740991);

ALTER TABLE public.office_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_layouts_select_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_insert_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_update_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_delete_own ON public.office_layouts;
CREATE POLICY office_layouts_select_own ON public.office_layouts FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_layouts.circle_id AND cm.user_id = auth.uid())
);
REVOKE ALL ON TABLE public.office_layouts FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.office_layouts FROM authenticated;
GRANT SELECT ON TABLE public.office_layouts TO authenticated;

CREATE OR REPLACE FUNCTION public.save_office_layout_v2(
  p_circle_id uuid,
  p_layout jsonb,
  p_layout_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  stored_version bigint;
  stored_layout jsonb;
  server_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF p_circle_id IS NULL
     OR p_layout_version IS NULL
     OR p_layout_version <= 0
     OR p_layout_version > 9007199254740991
     OR p_layout_version > server_now_ms + 300000 THEN
    RAISE EXCEPTION 'invalid_office_layout_version' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.user_id = actor_id
  ) THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.validate_office_layout_document(p_layout)
     OR (p_layout ->> 'updatedAt') !~ '^[0-9]{1,18}$'
     OR (p_layout ->> 'updatedAt')::bigint <> p_layout_version THEN
    RAISE EXCEPTION 'invalid_office_layout_document' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.office_layouts (user_id, circle_id, layout, layout_version)
  VALUES (actor_id, p_circle_id, p_layout, p_layout_version)
  ON CONFLICT (user_id, circle_id) DO UPDATE
    SET layout = EXCLUDED.layout,
        layout_version = EXCLUDED.layout_version,
        updated_at = clock_timestamp()
    WHERE public.office_layouts.layout_version < EXCLUDED.layout_version;

  SELECT layout_version, layout INTO stored_version, stored_layout
  FROM public.office_layouts
  WHERE user_id = actor_id AND circle_id = p_circle_id;

  IF stored_version IS NULL THEN
    RAISE EXCEPTION 'office_layout_not_saved' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'layoutVersion', stored_version,
    -- A same-version retry is successful only when it is idempotent. Without
    -- the payload check, two tabs could submit different layouts at the same
    -- millisecond and the losing tab would receive a false accepted receipt.
    'accepted', stored_version = p_layout_version AND stored_layout = p_layout
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) TO authenticated;

CREATE TABLE IF NOT EXISTS public.office_attention_acknowledgements (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  attention_id text NOT NULL CHECK (length(attention_id) BETWEEN 1 AND 240),
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  PRIMARY KEY (user_id, circle_id, attention_id),
  CONSTRAINT office_attention_expiry_after_ack CHECK (expires_at > acknowledged_at)
);
-- Lock parent before child so no concurrent run move or acknowledgement write
-- can race cleanup and composite-FK validation. Keep this order in follow-ups.
LOCK TABLE public.agent_runs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.office_attention_acknowledgements IN SHARE ROW EXCLUSIVE MODE;
-- Remove impossible legacy dismissals before replacing the run-only FK with a
-- durable run+circle relationship. Acknowledgements are ephemeral UI state;
-- retaining a cross-circle row would be less safe than surfacing the item again.
DELETE FROM public.office_attention_acknowledgements AS acknowledgement
WHERE acknowledgement.run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.agent_runs AS run
    WHERE run.id = acknowledgement.run_id
      AND run.circle_id = acknowledgement.circle_id
  );
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_id_circle_id_unique
  ON public.agent_runs (id, circle_id);
ALTER TABLE public.office_attention_acknowledgements
  DROP CONSTRAINT IF EXISTS office_attention_acknowledgements_run_id_fkey;
ALTER TABLE public.office_attention_acknowledgements
  DROP CONSTRAINT IF EXISTS office_attention_acknowledgements_run_circle_fkey;
ALTER TABLE public.office_attention_acknowledgements
  ADD CONSTRAINT office_attention_acknowledgements_run_circle_fkey
  FOREIGN KEY (run_id, circle_id)
  REFERENCES public.agent_runs (id, circle_id)
  ON UPDATE RESTRICT
  ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS office_attention_ack_expiry_idx
  ON public.office_attention_acknowledgements (user_id, circle_id, expires_at);
ALTER TABLE public.office_attention_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_attention_ack_select_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_insert_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_update_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_delete_own ON public.office_attention_acknowledgements;
CREATE POLICY office_attention_ack_select_own ON public.office_attention_acknowledgements FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY office_attention_ack_insert_own ON public.office_attention_acknowledgements FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_attention_acknowledgements.circle_id AND cm.user_id = auth.uid())
);
CREATE POLICY office_attention_ack_update_own ON public.office_attention_acknowledgements FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = office_attention_acknowledgements.circle_id
      AND cm.user_id = auth.uid()
  )
);
CREATE POLICY office_attention_ack_delete_own ON public.office_attention_acknowledgements FOR DELETE TO authenticated
USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.office_attention_acknowledgements FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.office_attention_acknowledgements TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_office_attention_ack_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  run_circle_id uuid;
BEGIN
  IF NEW.run_id IS NOT NULL THEN
    SELECT ar.circle_id INTO run_circle_id
    FROM public.agent_runs ar
    WHERE ar.id = NEW.run_id;
    IF run_circle_id IS NULL OR run_circle_id <> NEW.circle_id THEN
      RAISE EXCEPTION 'attention_run_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.acknowledged_at := clock_timestamp();
  NEW.expires_at := NEW.acknowledged_at + interval '30 days';
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_office_attention_ack_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS office_attention_ack_scope_guard ON public.office_attention_acknowledgements;
CREATE TRIGGER office_attention_ack_scope_guard
BEFORE INSERT OR UPDATE ON public.office_attention_acknowledgements
FOR EACH ROW EXECUTE FUNCTION public.enforce_office_attention_ack_scope();

CREATE OR REPLACE FUNCTION public.list_active_office_attention_acknowledgements(p_circle_id uuid)
RETURNS TABLE(attention_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT acknowledgement.attention_id
  FROM public.office_attention_acknowledgements AS acknowledgement
  WHERE auth.uid() IS NOT NULL
    AND acknowledgement.user_id = auth.uid()
    AND acknowledgement.circle_id = p_circle_id
    AND acknowledgement.expires_at > statement_timestamp()
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    )
  ORDER BY acknowledgement.attention_id
  LIMIT 500;
$function$;
REVOKE ALL ON FUNCTION public.list_active_office_attention_acknowledgements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_office_attention_acknowledgements(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_office_floor_preset_snapshot(p_snapshot jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT p_snapshot IS NOT NULL
    AND jsonb_typeof(p_snapshot) = 'object'
    AND p_snapshot ->> 'schemaVersion' = '1'
    AND jsonb_typeof(p_snapshot -> 'floor') = 'object'
    AND octet_length(p_snapshot::text) <= 256000
    AND jsonb_typeof(p_snapshot -> 'floor' -> 'furniture') = 'array'
    AND jsonb_array_length(p_snapshot -> 'floor' -> 'furniture') <= 100
    AND jsonb_typeof(p_snapshot -> 'floor' -> 'agentIds') = 'array'
    AND jsonb_array_length(p_snapshot -> 'floor' -> 'agentIds') <= 30;
$function$;
REVOKE ALL ON FUNCTION public.validate_office_floor_preset_snapshot(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_office_floor_preset_snapshot(jsonb) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.office_floor_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 240),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT office_floor_presets_owner_circle_name UNIQUE (user_id, circle_id, name),
  CONSTRAINT office_floor_presets_snapshot_valid CHECK (public.validate_office_floor_preset_snapshot(snapshot))
);

CREATE OR REPLACE FUNCTION public.touch_office_dashboard_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.touch_office_dashboard_updated_at() FROM PUBLIC;
DROP TRIGGER IF EXISTS office_floor_presets_touch_updated_at ON public.office_floor_presets;
CREATE TRIGGER office_floor_presets_touch_updated_at
BEFORE UPDATE ON public.office_floor_presets
FOR EACH ROW EXECUTE FUNCTION public.touch_office_dashboard_updated_at();

ALTER TABLE public.office_floor_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_floor_presets_select_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_insert_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_update_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_delete_own ON public.office_floor_presets;
CREATE POLICY office_floor_presets_select_own ON public.office_floor_presets FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY office_floor_presets_insert_own ON public.office_floor_presets FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_floor_presets.circle_id AND cm.user_id = auth.uid())
);
CREATE POLICY office_floor_presets_update_own ON public.office_floor_presets FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = office_floor_presets.circle_id
      AND cm.user_id = auth.uid()
  )
);
CREATE POLICY office_floor_presets_delete_own ON public.office_floor_presets FOR DELETE TO authenticated
USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.office_floor_presets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.office_floor_presets TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
