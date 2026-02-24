-- Verification Query for The Underground Circle Database
-- Run this in Supabase SQL Editor to check what's already set up

-- Check which tables exist
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE columns.table_name = tables.table_name) as column_count
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('user_xp', 'agents_bots', 'friends', 'integrations', 'messages', 'profiles')
ORDER BY table_name;

-- Check profiles table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles' 
  AND column_name IN ('wallet_address_eth', 'wallet_address_sol', 'theme_color', 'banner_url', 'status_message')
ORDER BY column_name;

-- Check RLS policies
SELECT 
  tablename,
  policyname,
  cmd as policy_type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_xp', 'agents_bots', 'friends', 'integrations', 'messages')
ORDER BY tablename, policyname;

-- Check row counts
SELECT 'user_xp' AS table_name, COUNT(*) AS row_count FROM user_xp
UNION ALL
SELECT 'agents_bots', COUNT(*) FROM agents_bots
UNION ALL
SELECT 'friends', COUNT(*) FROM friends
UNION ALL
SELECT 'integrations', COUNT(*) FROM integrations
UNION ALL
SELECT 'messages', COUNT(*) FROM messages;
