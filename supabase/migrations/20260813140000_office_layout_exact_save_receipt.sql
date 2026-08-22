-- Exact Office layout save receipts and mutation authority hardening.
--
-- The original v2 RPC correctly rejected older revisions, but an equal client
-- timestamp with different JSON could be mistaken for an accepted idempotent
-- retry. Preserve the public signature and make acceptance prove both version
-- and payload equality so already-migrated projects receive the hardening.
-- This follow-up also makes the RPC the sole authenticated layout mutation
-- surface, rejects unsafe/far-future client versions, and binds every optional
-- attention run to the acknowledgement's circle with server-owned timestamps.

BEGIN;

-- A prior client could have saved a version arbitrarily far in the future.
-- Repair that legacy poison while preserving the layout payload, then make the
-- JavaScript-safe ceiling durable before authenticated raw DML is revoked.
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
    'accepted', stored_version = p_layout_version AND stored_layout = p_layout
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) TO authenticated;

-- The RPC is the sole authenticated mutation surface. RLS alone cannot make a
-- raw UPDATE monotonic, and DELETE followed by INSERT could otherwise reset a
-- user's version history.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.office_layouts FROM authenticated;
GRANT SELECT ON TABLE public.office_layouts TO authenticated;
DROP POLICY IF EXISTS office_layouts_insert_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_update_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_delete_own ON public.office_layouts;

-- Clean any legacy cross-circle acknowledgement before replacing the run-only
-- FK with a durable run+circle relationship. These rows only suppress UI, so
-- deleting an invalid dismissal safely causes the item to surface again.
-- Lock parent before child so concurrent run/acknowledgement mutation cannot
-- enter between cleanup and constraint validation.
LOCK TABLE public.agent_runs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.office_attention_acknowledgements IN SHARE ROW EXCLUSIVE MODE;
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

COMMIT;

NOTIFY pgrst, 'reload schema';
