-- Repair the protected Chat approval validator for databases where the
-- 20260726 authority migration was already applied. Chat always emits the
-- bounded autoApproveCategory key (JSON null when no category applies), so the
-- database allowlist must accept that shape without accepting arbitrary labels.

CREATE OR REPLACE FUNCTION public.is_valid_chat_v2_approval_payload(
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'approvalIntentFingerprint'
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND p_payload->>'userId'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND p_payload->>'redacted' = 'true'
    AND length(COALESCE(p_payload->>'source', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'intentKind', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'executionKind', '')) BETWEEN 1 AND 120
    AND length(COALESCE(p_payload->>'risk', '')) BETWEEN 1 AND 40
    AND (
      NOT (p_payload ? 'roomId')
      OR p_payload->'roomId' = 'null'::jsonb
      OR p_payload->>'roomId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT (p_payload ? 'threadId')
      OR p_payload->'threadId' = 'null'::jsonb
      OR p_payload->>'threadId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT (p_payload ? 'autoApproveCategory')
      OR p_payload->'autoApproveCategory' = 'null'::jsonb
      OR (
        jsonb_typeof(p_payload->'autoApproveCategory') = 'string'
        AND p_payload->>'autoApproveCategory' IN (
          'memory_read',
          'memory_write',
          'skill_run',
          'skill_write',
          'automation_create',
          'automation_run',
          'browser_click',
          'external_publish',
          'desktop_action'
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_keys(payload_key)
      WHERE payload_key <> ALL (ARRAY[
        'approvalSchemaVersion',
        'approvalIntentFingerprint',
        'source',
        'intentKind',
        'executionKind',
        'risk',
        'userId',
        'roomId',
        'threadId',
        'autoApproveCategory',
        'redacted'
      ])
    )
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_valid_chat_v2_approval_payload(jsonb)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
