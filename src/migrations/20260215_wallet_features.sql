-- Migration: Enhanced Wallet Features
-- Date: 2025-02-15
-- Description: Add tables for comprehensive wallet functionality

-- Token watchlist table
CREATE TABLE IF NOT EXISTS token_watchlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    chain TEXT NOT NULL CHECK (chain IN ('solana', 'ethereum', 'polygon', 'base')),
    token_symbol TEXT,
    token_name TEXT,
    is_active BOOLEAN DEFAULT true,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, token_address, chain)
);

-- NFT favorites table
CREATE TABLE IF NOT EXISTS nft_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    nft_mint TEXT NOT NULL,
    chain TEXT NOT NULL CHECK (chain IN ('solana', 'ethereum', 'polygon', 'base')),
    nft_name TEXT,
    collection_name TEXT,
    is_pinned BOOLEAN DEFAULT false,
    is_hidden BOOLEAN DEFAULT false,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, nft_mint, chain)
);

-- Portfolio snapshots for history tracking
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    total_value_usd DECIMAL(20, 8) NOT NULL DEFAULT 0,
    change_24h_percent DECIMAL(10, 4) DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    nft_count INTEGER DEFAULT 0,
    chains_data JSONB, -- Store per-chain breakdown
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wallet transactions cache (optional - for faster lookups)
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    chain TEXT NOT NULL CHECK (chain IN ('solana', 'ethereum', 'polygon', 'base')),
    transaction_hash TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('send', 'receive', 'swap', 'stake', 'unstake', 'mint', 'burn', 'approve')),
    amount DECIMAL(30, 18),
    token_symbol TEXT,
    token_address TEXT,
    from_address TEXT,
    to_address TEXT,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'failed')),
    block_number BIGINT,
    gas_used BIGINT,
    gas_price BIGINT,
    transaction_fee DECIMAL(30, 18),
    block_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(transaction_hash, chain)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_token_watchlist_user_id ON token_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_token_watchlist_chain ON token_watchlist(chain);
CREATE INDEX IF NOT EXISTS idx_token_watchlist_active ON token_watchlist(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_nft_favorites_user_id ON nft_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_nft_favorites_chain ON nft_favorites(chain);
CREATE INDEX IF NOT EXISTS idx_nft_favorites_pinned ON nft_favorites(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_nft_favorites_hidden ON nft_favorites(is_hidden);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_id ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created_at ON portfolio_snapshots(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_address, chain);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_timestamp ON wallet_transactions(block_timestamp DESC);

-- Add multi-wallet support columns to profiles table (if they don't exist)
DO $$ 
BEGIN
    -- Add wallet columns for multi-chain support
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wallet_address_eth') THEN
        ALTER TABLE profiles ADD COLUMN wallet_address_eth TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wallet_address_sol') THEN
        ALTER TABLE profiles ADD COLUMN wallet_address_sol TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wallet_address_polygon') THEN
        ALTER TABLE profiles ADD COLUMN wallet_address_polygon TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wallet_address_base') THEN
        ALTER TABLE profiles ADD COLUMN wallet_address_base TEXT;
    END IF;
    
    -- Add portfolio tracking columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'portfolio_value_usd') THEN
        ALTER TABLE profiles ADD COLUMN portfolio_value_usd DECIMAL(20, 8) DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'portfolio_updated_at') THEN
        ALTER TABLE profiles ADD COLUMN portfolio_updated_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- Add wallet preferences
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wallet_preferences') THEN
        ALTER TABLE profiles ADD COLUMN wallet_preferences JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Create function to automatically create portfolio snapshots
CREATE OR REPLACE FUNCTION create_daily_portfolio_snapshot()
RETURNS void AS $$
DECLARE
    user_record RECORD;
BEGIN
    -- This would be called by a cron job or scheduled function
    -- For each user with wallets, create a daily snapshot
    FOR user_record IN 
        SELECT id FROM profiles 
        WHERE wallet_address_eth IS NOT NULL 
           OR wallet_address_sol IS NOT NULL 
           OR wallet_address_polygon IS NOT NULL 
           OR wallet_address_base IS NOT NULL
    LOOP
        INSERT INTO portfolio_snapshots (user_id, total_value_usd, created_at)
        VALUES (user_record.id, 0, NOW()) -- Value would be calculated by application
        ON CONFLICT DO NOTHING; -- Avoid duplicates if run multiple times
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions (adjust based on your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON token_watchlist TO authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nft_favorites TO authenticated;
-- GRANT SELECT, INSERT ON portfolio_snapshots TO authenticated;
-- GRANT SELECT ON wallet_transactions TO authenticated;

-- Add RLS policies for security
ALTER TABLE token_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE nft_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Token watchlist policies
CREATE POLICY "Users can manage their own watchlist" ON token_watchlist
    FOR ALL USING (auth.uid() = user_id);

-- NFT favorites policies  
CREATE POLICY "Users can manage their own NFT favorites" ON nft_favorites
    FOR ALL USING (auth.uid() = user_id);

-- Portfolio snapshots policies (read-only for users, system can insert)
CREATE POLICY "Users can view their own portfolio history" ON portfolio_snapshots
    FOR SELECT USING (auth.uid() = user_id);

-- Allow system/service role to insert snapshots
-- CREATE POLICY "System can create portfolio snapshots" ON portfolio_snapshots
--     FOR INSERT WITH CHECK (true); -- Adjust based on your service role setup

-- Wallet transactions policies (read-only for users)
CREATE POLICY "Users can view their own transaction history" ON wallet_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Commit the transaction
COMMIT;