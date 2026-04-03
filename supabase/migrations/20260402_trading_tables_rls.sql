-- -----------------------------------------------------------------------------
-- RLS Hardening for All Trading-Related Tables
-- Migration: 20260402_trading_tables_rls
--
-- Ensures every trading table has:
--   1. RLS enabled
--   2. Granular SELECT / INSERT / UPDATE / DELETE policies scoped to auth.uid()
--   3. Idempotent execution (safe to re-run)
--
-- Tables covered:
--   trading_bot_wallets, trading_bot_configs, trading_log,
--   trading_pending_actions, featured_trades, user_api_keys,
--   trading_bot_holdings
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 1. trading_bot_wallets
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_bot_wallets') THEN
    ALTER TABLE trading_bot_wallets ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users manage own trading bot wallets" ON trading_bot_wallets;

    DROP POLICY IF EXISTS "trading_bot_wallets_select_own" ON trading_bot_wallets;
    CREATE POLICY "trading_bot_wallets_select_own"
      ON trading_bot_wallets FOR SELECT
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_wallets_insert_own" ON trading_bot_wallets;
    CREATE POLICY "trading_bot_wallets_insert_own"
      ON trading_bot_wallets FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_wallets_update_own" ON trading_bot_wallets;
    CREATE POLICY "trading_bot_wallets_update_own"
      ON trading_bot_wallets FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_wallets_delete_own" ON trading_bot_wallets;
    CREATE POLICY "trading_bot_wallets_delete_own"
      ON trading_bot_wallets FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to trading_bot_wallets';
  ELSE
    RAISE NOTICE 'Table trading_bot_wallets does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 2. trading_bot_configs
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_bot_configs') THEN
    ALTER TABLE trading_bot_configs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users manage own trading bot configs" ON trading_bot_configs;

    DROP POLICY IF EXISTS "trading_bot_configs_select_own" ON trading_bot_configs;
    CREATE POLICY "trading_bot_configs_select_own"
      ON trading_bot_configs FOR SELECT
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_configs_insert_own" ON trading_bot_configs;
    CREATE POLICY "trading_bot_configs_insert_own"
      ON trading_bot_configs FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_configs_update_own" ON trading_bot_configs;
    CREATE POLICY "trading_bot_configs_update_own"
      ON trading_bot_configs FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_configs_delete_own" ON trading_bot_configs;
    CREATE POLICY "trading_bot_configs_delete_own"
      ON trading_bot_configs FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to trading_bot_configs';
  ELSE
    RAISE NOTICE 'Table trading_bot_configs does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 3. trading_log
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_log') THEN
    ALTER TABLE trading_log ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users view own trade log" ON trading_log;
    DROP POLICY IF EXISTS "Users insert own trades" ON trading_log;

    DROP POLICY IF EXISTS "trading_log_select_own" ON trading_log;
    CREATE POLICY "trading_log_select_own"
      ON trading_log FOR SELECT
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_log_insert_own" ON trading_log;
    CREATE POLICY "trading_log_insert_own"
      ON trading_log FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_log_update_own" ON trading_log;
    CREATE POLICY "trading_log_update_own"
      ON trading_log FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_log_delete_own" ON trading_log;
    CREATE POLICY "trading_log_delete_own"
      ON trading_log FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to trading_log';
  ELSE
    RAISE NOTICE 'Table trading_log does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 4. trading_pending_actions
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_pending_actions') THEN
    ALTER TABLE trading_pending_actions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users manage own pending actions" ON trading_pending_actions;

    DROP POLICY IF EXISTS "trading_pending_actions_select_own" ON trading_pending_actions;
    CREATE POLICY "trading_pending_actions_select_own"
      ON trading_pending_actions FOR SELECT
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_pending_actions_insert_own" ON trading_pending_actions;
    CREATE POLICY "trading_pending_actions_insert_own"
      ON trading_pending_actions FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_pending_actions_update_own" ON trading_pending_actions;
    CREATE POLICY "trading_pending_actions_update_own"
      ON trading_pending_actions FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_pending_actions_delete_own" ON trading_pending_actions;
    CREATE POLICY "trading_pending_actions_delete_own"
      ON trading_pending_actions FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to trading_pending_actions';
  ELSE
    RAISE NOTICE 'Table trading_pending_actions does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 5. featured_trades
--    All authenticated users can SELECT (shared trade ideas).
--    Only service_role (backend) can INSERT / UPDATE / DELETE.
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'featured_trades') THEN
    ALTER TABLE featured_trades ENABLE ROW LEVEL SECURITY;

    -- Drop legacy policies
    DROP POLICY IF EXISTS "Users see own featured trades" ON featured_trades;
    DROP POLICY IF EXISTS "Service role inserts featured trades" ON featured_trades;
    DROP POLICY IF EXISTS "Users update own featured trades" ON featured_trades;

    -- SELECT: all authenticated users can read featured trades
    DROP POLICY IF EXISTS "featured_trades_select_authenticated" ON featured_trades;
    CREATE POLICY "featured_trades_select_authenticated"
      ON featured_trades FOR SELECT
      USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

    -- INSERT: only service_role can create featured trades
    DROP POLICY IF EXISTS "featured_trades_insert_service_role" ON featured_trades;
    CREATE POLICY "featured_trades_insert_service_role"
      ON featured_trades FOR INSERT
      WITH CHECK (auth.role() = 'service_role');

    -- UPDATE: only service_role can update featured trades
    DROP POLICY IF EXISTS "featured_trades_update_service_role" ON featured_trades;
    CREATE POLICY "featured_trades_update_service_role"
      ON featured_trades FOR UPDATE
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');

    -- DELETE: only service_role can remove featured trades
    DROP POLICY IF EXISTS "featured_trades_delete_service_role" ON featured_trades;
    CREATE POLICY "featured_trades_delete_service_role"
      ON featured_trades FOR DELETE
      USING (auth.role() = 'service_role');

    RAISE NOTICE 'RLS policies applied to featured_trades';
  ELSE
    RAISE NOTICE 'Table featured_trades does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 6. user_api_keys
--    Highly sensitive -- encrypted API keys.
--    Users manage only their own rows.
--    Service role retains SELECT for edge-function decryption.
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_api_keys') THEN
    ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

    -- Drop legacy policies
    DROP POLICY IF EXISTS "users_manage_own_keys" ON user_api_keys;
    DROP POLICY IF EXISTS "service_role_access_keys" ON user_api_keys;

    -- SELECT: users read their own keys; service_role reads any (for edge functions)
    DROP POLICY IF EXISTS "user_api_keys_select_own" ON user_api_keys;
    CREATE POLICY "user_api_keys_select_own"
      ON user_api_keys FOR SELECT
      USING (auth.uid() = user_id OR auth.role() = 'service_role');

    -- INSERT: users can only insert keys for themselves
    DROP POLICY IF EXISTS "user_api_keys_insert_own" ON user_api_keys;
    CREATE POLICY "user_api_keys_insert_own"
      ON user_api_keys FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    -- UPDATE: users can only update their own keys
    DROP POLICY IF EXISTS "user_api_keys_update_own" ON user_api_keys;
    CREATE POLICY "user_api_keys_update_own"
      ON user_api_keys FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    -- DELETE: users can only delete their own keys
    DROP POLICY IF EXISTS "user_api_keys_delete_own" ON user_api_keys;
    CREATE POLICY "user_api_keys_delete_own"
      ON user_api_keys FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to user_api_keys';
  ELSE
    RAISE NOTICE 'Table user_api_keys does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- 7. trading_bot_holdings
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_bot_holdings') THEN
    ALTER TABLE trading_bot_holdings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users manage own trading bot holdings" ON trading_bot_holdings;

    DROP POLICY IF EXISTS "trading_bot_holdings_select_own" ON trading_bot_holdings;
    CREATE POLICY "trading_bot_holdings_select_own"
      ON trading_bot_holdings FOR SELECT
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_holdings_insert_own" ON trading_bot_holdings;
    CREATE POLICY "trading_bot_holdings_insert_own"
      ON trading_bot_holdings FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_holdings_update_own" ON trading_bot_holdings;
    CREATE POLICY "trading_bot_holdings_update_own"
      ON trading_bot_holdings FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "trading_bot_holdings_delete_own" ON trading_bot_holdings;
    CREATE POLICY "trading_bot_holdings_delete_own"
      ON trading_bot_holdings FOR DELETE
      USING (auth.uid() = user_id);

    RAISE NOTICE 'RLS policies applied to trading_bot_holdings';
  ELSE
    RAISE NOTICE 'Table trading_bot_holdings does not exist -- skipping';
  END IF;
END $$;


-- =============================================================================
-- Performance indexes for RLS filter columns
-- (IF NOT EXISTS keeps this idempotent)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_trading_log_user_id ON trading_log(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_pending_actions_user_id ON trading_pending_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_featured_trades_user_id ON featured_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
