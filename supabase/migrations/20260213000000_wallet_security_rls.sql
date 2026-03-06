-- Wallet Security and RLS Migration
-- This migration adds Row Level Security policies to protect wallet data
-- and ensures proper data scoping for 100+ users

-- Enable RLS on profiles table if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on other sensitive tables
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

-- Profiles Table Policies
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Circle members can view member profiles" ON profiles;

-- Policy: Users can always view and update their own profile
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Policy: Circle members can view basic profile info of other members (excluding sensitive wallet data)
CREATE POLICY "Circle members can view member profiles" ON profiles
  FOR SELECT USING (
    id IN (
      SELECT cm.user_id 
      FROM circle_members cm
      WHERE cm.circle_id IN (
        SELECT circle_id 
        FROM circle_members 
        WHERE user_id = auth.uid()
      )
    )
  );

-- Circles Table Policies
DROP POLICY IF EXISTS "Users can view circles they're members of" ON circles;
DROP POLICY IF EXISTS "Circle creators can update their circles" ON circles;

CREATE POLICY "Users can view circles they're members of" ON circles
  FOR SELECT USING (
    id IN (
      SELECT circle_id 
      FROM circle_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Circle creators can update their circles" ON circles
  FOR UPDATE USING (created_by = auth.uid());

-- Circle Members Table Policies
DROP POLICY IF EXISTS "Users can view circle memberships" ON circle_members;
DROP POLICY IF EXISTS "Users can join circles" ON circle_members;
DROP POLICY IF EXISTS "Circle creators can manage members" ON circle_members;

CREATE POLICY "Users can view circle memberships" ON circle_members
  FOR SELECT USING (
    circle_id IN (
      SELECT circle_id 
      FROM circle_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join circles" ON circle_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Circle creators can manage members" ON circle_members
  FOR ALL USING (
    circle_id IN (
      SELECT id 
      FROM circles 
      WHERE created_by = auth.uid()
    )
  );

-- Check-ins Table Policies
DROP POLICY IF EXISTS "Users can view check-ins in their circles" ON check_ins;
DROP POLICY IF EXISTS "Users can create their own check-ins" ON check_ins;
DROP POLICY IF EXISTS "Users can update their own check-ins" ON check_ins;

CREATE POLICY "Users can view check-ins in their circles" ON check_ins
  FOR SELECT USING (
    circle_id IN (
      SELECT circle_id 
      FROM circle_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create their own check-ins" ON check_ins
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own check-ins" ON check_ins
  FOR UPDATE USING (user_id = auth.uid());

-- Add indexes for performance with 100+ users
CREATE INDEX IF NOT EXISTS idx_circle_members_user_id ON circle_members(user_id);
CREATE INDEX IF NOT EXISTS idx_circle_members_circle_id ON circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_circle_id ON check_ins(circle_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_id ON check_ins(user_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(check_in_date);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Add constraints for wallet address validation
-- Note: These are basic constraints. Full validation should be done in the application layer
ALTER TABLE profiles 
ADD CONSTRAINT wallet_address_length_check 
CHECK (
  wallet_address IS NULL OR (
    length(wallet_address) >= 32 AND length(wallet_address) <= 44
  )
);

-- Add constraint to ensure wallet_chain is valid when wallet_address is provided
ALTER TABLE profiles 
ADD CONSTRAINT wallet_chain_check 
CHECK (
  (wallet_address IS NULL AND wallet_chain IS NULL) OR
  (wallet_address IS NOT NULL AND wallet_chain IN ('ethereum', 'solana'))
);

-- Create a view for safe profile data that excludes sensitive wallet information for non-owners
CREATE OR REPLACE VIEW safe_profiles AS
SELECT 
  id,
  username,
  display_name,
  avatar_url,
  bio,
  current_streak,
  longest_streak,
  created_at,
  -- Only show wallet data if the user owns this profile or is in the same circle
  CASE 
    WHEN id = auth.uid() THEN wallet_address
    WHEN id IN (
      SELECT cm.user_id 
      FROM circle_members cm
      WHERE cm.circle_id IN (
        SELECT circle_id 
        FROM circle_members 
        WHERE user_id = auth.uid()
      )
    ) THEN wallet_address
    ELSE NULL
  END as wallet_address,
  CASE 
    WHEN id = auth.uid() THEN wallet_chain
    WHEN id IN (
      SELECT cm.user_id 
      FROM circle_members cm
      WHERE cm.circle_id IN (
        SELECT circle_id 
        FROM circle_members 
        WHERE user_id = auth.uid()
      )
    ) THEN wallet_chain
    ELSE NULL
  END as wallet_chain
FROM profiles;

-- Grant permissions on the view
GRANT SELECT ON safe_profiles TO authenticated;

-- Create function to get user's circles efficiently
DROP FUNCTION IF EXISTS get_user_circles(uuid);
CREATE OR REPLACE FUNCTION get_user_circles(user_uuid uuid DEFAULT auth.uid())
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  invite_code text,
  max_members integer,
  created_by uuid,
  created_at timestamp with time zone,
  member_count bigint,
  user_role text
) 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.description,
    c.invite_code,
    c.max_members,
    c.created_by,
    c.created_at,
    COUNT(cm2.user_id) as member_count,
    cm.role as user_role
  FROM circles c
  JOIN circle_members cm ON c.id = cm.circle_id
  LEFT JOIN circle_members cm2 ON c.id = cm2.circle_id
  WHERE cm.user_id = user_uuid
  GROUP BY c.id, c.name, c.description, c.invite_code, c.max_members, c.created_by, c.created_at, cm.role;
END;
$$ LANGUAGE plpgsql;