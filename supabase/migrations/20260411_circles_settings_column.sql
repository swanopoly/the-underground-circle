-- Add settings jsonb column to circles table
-- This enables per-circle configuration like sessionMemoryMode

ALTER TABLE circles ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
