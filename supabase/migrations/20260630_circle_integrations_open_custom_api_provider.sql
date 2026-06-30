-- Re-open circle integration providers to the app registry so Custom API and
-- future marketplace connectors do not require a SQL CHECK edit for every new
-- provider.
--
-- The canonical provider registry is application-side:
--   - src/lib/integrations/registry.ts
--   - src/lib/circleIntegrations.ts
--
-- Provider-specific validation, required metadata, secret handling, and prompt
-- redaction happen there. Database safety remains RLS + indexed lookups.

DO $$
BEGIN
  ALTER TABLE circle_integrations DROP CONSTRAINT IF EXISTS circle_integrations_provider_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_circle_integrations_provider_lookup
  ON circle_integrations(provider, is_active)
  WHERE is_active = true;

COMMENT ON COLUMN circle_integrations.provider IS
  'Marketplace provider id. Validated by application registries so Custom API and future providers can be added without SQL CHECK churn.';

NOTIFY pgrst, 'reload schema';
