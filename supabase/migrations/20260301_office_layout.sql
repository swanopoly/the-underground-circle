-- Add office layout storage to profiles
-- Stores { floors: OfficeFloor[], currentFloorId: string } as JSONB
-- RLS already allows users to update their own profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS office_layout jsonb DEFAULT '{}';
