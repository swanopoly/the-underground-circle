-- Multi-wallet support: store ETH and SOL addresses separately
-- Keeps backward compat with existing wallet_address/wallet_chain columns

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_eth TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_sol TEXT;

-- Migrate existing data
UPDATE profiles
SET wallet_address_eth = wallet_address
WHERE wallet_chain = 'ethereum' AND wallet_address IS NOT NULL AND wallet_address_eth IS NULL;

UPDATE profiles
SET wallet_address_sol = wallet_address
WHERE wallet_chain = 'solana' AND wallet_address IS NOT NULL AND wallet_address_sol IS NULL;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_eth ON profiles(wallet_address_eth) WHERE wallet_address_eth IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_sol ON profiles(wallet_address_sol) WHERE wallet_address_sol IS NOT NULL;
