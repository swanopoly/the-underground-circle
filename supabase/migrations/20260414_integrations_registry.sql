-- Integrations registry — drop the rigid provider CHECK constraint and let
-- the application-side registry (src/lib/integrations/registry.ts) be the
-- single source of truth for valid providers.
--
-- Why drop the CHECK?
--   - Adding a new provider previously required a SQL migration.
--   - The registry now has 80+ providers across 19 categories. Maintaining
--     a SQL list in lockstep with the TS list is bug-bait.
--   - Application code validates `provider` against `isValidProvider(id)`
--     before any insert, so the constraint isn't load-bearing for safety.
--
-- Lightweight DB safety net: keep `provider` text-typed and indexed, validate
-- in the API layer + via RLS-checked insert policies.

DO $$
BEGIN
  ALTER TABLE circle_integrations DROP CONSTRAINT IF EXISTS circle_integrations_provider_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- Provider lookups are common — index them. (Was implicit in the CHECK.)
CREATE INDEX IF NOT EXISTS idx_circle_integrations_provider_lookup
  ON circle_integrations(provider, is_active)
  WHERE is_active = true;

-- Same treatment for circle_site_credentials.platform — the registry covers
-- both connector concerns (integration + site credential), so the platform
-- list shouldn't be hard-coded in SQL either.
DO $$
BEGIN
  ALTER TABLE circle_site_credentials DROP CONSTRAINT IF EXISTS circle_site_credentials_platform_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_platform_lookup
  ON circle_site_credentials(platform, is_active)
  WHERE is_active = true;

NOTIFY pgrst, 'reload schema';
