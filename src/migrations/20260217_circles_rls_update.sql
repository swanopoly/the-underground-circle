-- Migration: Fix circles update RLS policy
-- Date: 2026-02-17
-- Description: Allow circle creators to update their circles

-- Drop existing update policy if any (won't error if doesn't exist)
DROP POLICY IF EXISTS "Circle creators can update their circles" ON circles;

-- Create update policy: only the creator can update
CREATE POLICY "Circle creators can update their circles" ON circles
    FOR UPDATE USING (auth.uid() = created_by)
    WITH CHECK (auth.uid() = created_by);
