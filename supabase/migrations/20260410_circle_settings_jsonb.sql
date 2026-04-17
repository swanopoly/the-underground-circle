-- Add circle settings JSON for runtime configuration such as session memory sharing.

ALTER TABLE circles
ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE circles
SET settings = COALESCE(settings, '{}'::jsonb)
WHERE settings IS NULL;
