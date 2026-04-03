# Trading AI Bot & Wallet Security Audit
**Date:** 2026-04-02
**Auditors:** Claude Opus 4.6 + Codex deep research + Security scanning agents
**Scope:** All trading bot, wallet, and crypto-related code in the-underground-circle

---

## Executive Summary

**3 CRITICAL | 5 HIGH | 7 MEDIUM | 2 LOW** findings identified across the trading bot and wallet system.

The most urgent issues involve insecure seed phrase generation using `Math.random()`, seed phrases stored in unprotected React state (with `expo-secure-store` never used despite being a dependency), and wallet signature verification that is bypassed entirely on the client side.

---

## CRITICAL Findings

### C1: Insecure Seed Phrase Generation (Math.random + 32-word list)
- **File:** `src/screens/wallet/ConnectWalletScreen.tsx`, line 108
- **Issue:** `Math.random()` is not cryptographically secure. The word list is only 32 words (not BIP-39's 2048), yielding ~60 bits of entropy instead of ~128. Entire keyspace brute-forceable in minutes.
- **Fix:** Replace with `crypto.getRandomValues()` + full BIP-39 2048-word list. Use `@scure/bip39` or similar vetted library.

### C2: Seed Phrase Stored in Plain React State
- **File:** `src/screens/wallet/ConnectWalletScreen.tsx`, lines 44-46
- **Issue:** `useState('')` holds seed phrases in memory, visible via React DevTools, heap dumps, browser extensions. `expo-secure-store` is in `package.json` but never imported or used anywhere.
- **Fix:** Use `expo-secure-store` on native, Web Crypto API on web. Clear seed from state immediately after key derivation.

### C3: Wallet Signature Verification Bypassed
- **File:** `src/lib/crypto.ts`, lines 266-291
- **Issue:** `verifyWalletOwnership()` requests a signature but only checks if it's truthy — never actually verifies it cryptographically. Any modified client can fake wallet ownership.
- **Fix:** Implement actual signature verification using `ethers.verifyMessage()` for ETH and `tweetnacl.sign.detached.verify()` for SOL. Add nonce/timestamp for replay protection.

---

## HIGH Findings

### H1: No Circle Membership Check on Bot Wallet Operations
- **File:** `supabase/functions/trading-bot-wallet/index.ts`, line 1323
- **Issue:** The edge function authenticates the user via JWT but never verifies they're a member of the provided `circleId`. `createWallet` creates wallets for ANY circleId. `withdrawFromBotWallet` has no address whitelist or re-auth.
- **Fix:** Query `circle_members` table before any wallet operation. Add withdrawal address whitelisting and re-auth for large amounts.

### H2: Helius API Key Cached in Plaintext localStorage/AsyncStorage
- **File:** `src/lib/heliusTrading.ts`, lines 85-95
- **Issue:** `localStorage.setItem(key, apiKey)` stores the Helius RPC API key in plaintext, accessible to XSS payloads or any same-origin JS.
- **Fix:** Use `expo-secure-store` on native. On web, encrypt via Web Crypto API before storing, or use in-memory-only cache refreshed from server.

### H3: OAuth Implicit Flow Instead of PKCE
- **File:** `src/lib/supabase.ts`, line 40
- **Issue:** `flowType: 'implicit'` exposes access tokens in URL fragments — deprecated by OAuth 2.1 (RFC 9700). Vulnerable to browser history, referer header, and XSS token theft.
- **Fix:** Change to `flowType: 'pkce'`.

### H4: No RLS Policies on Trading Tables
- **Files:** `supabase-schema.sql` and migration files
- **Issue:** Tables `trading_bot_wallets`, `trading_bot_configs`, `trading_log`, `trading_pending_actions`, `featured_trades`, `user_api_keys`, `trading_bot_holdings` have NO Row Level Security. If any client-side code queries these via the anon key, all data is exposed.
- **Fix:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + user-scoped policies on all trading tables.

### H5: Agent Connection Tokens Stored Unhashed
- **File:** `src/lib/connectionManager.ts`, line 79
- **Issue:** Column named `api_key_hash` stores tokens verbatim, not hashed. False sense of security.
- **Fix:** Hash with SHA-256 before storage. Store prefix separately for display.

---

## MEDIUM Findings

### M1: Ethereum Checksum Validation Always Returns True
- **File:** `src/lib/crypto.ts`, lines 111-124
- **Issue:** `validateEthereumChecksum()` returns `true` for all mixed-case addresses without doing actual EIP-55 validation.
- **Fix:** Use `ethers.getAddress()` which implements proper EIP-55.

### M2: `skipPreflight: true` on Swap Transactions
- **Files:** `src/lib/heliusTrading.ts` line 589, `supabase/functions/trading-bot-wallet/index.ts` line 464
- **Issue:** Failed transactions still incur network fees. No opportunity to catch obvious failures.
- **Fix:** Use `skipPreflight: false` for user-initiated transactions.

### M3: Wildcard CORS on All 28 Edge Functions
- **Files:** All `supabase/functions/*/index.ts`
- **Issue:** `Access-Control-Allow-Origin: *` permits any website to make authenticated requests.
- **Fix:** Restrict to application domain(s).

### M4: Client-Side-Only Rate Limiting
- **File:** `src/lib/crypto.ts`, lines 86-88
- **Issue:** In-memory `Map` resets on page refresh. Trivially bypassable.
- **Fix:** Implement server-side rate limiting in edge functions.

### M5: Static Scam Address Blacklist (1 Example Address)
- **File:** `src/lib/crypto.ts`, lines 1165-1175
- **Issue:** Single example Bitcoin address provides zero protection.
- **Fix:** Integrate real-time scam API (GoPlus, ChainAbuse) or remove feature.

### M6: Console Logging of Transaction Data
- **File:** `src/lib/heliusTrading.ts`, lines 570-600
- **Issue:** Full RPC responses logged to console, visible in browser DevTools.
- **Fix:** Gate behind `__DEV__` flag or remove entirely.

### M7: Seed Import Has No BIP-39 Validation
- **File:** `src/screens/wallet/ConnectWalletScreen.tsx`, lines 180-196
- **Issue:** Only validates word count (12/24), not BIP-39 wordlist membership or checksum.
- **Fix:** Validate against BIP-39 wordlist and checksum.

---

## LOW Findings

### L1: Hardcoded Verification Word Indices
- **File:** `src/screens/wallet/ConnectWalletScreen.tsx`, line 113
- **Issue:** Always asks for words at positions 3, 6, 9 — predictable.
- **Fix:** Use `crypto.getRandomValues()` for random indices.

### L2: Excessive Default Slippage
- **File:** `src/lib/heliusTrading.ts`, line 513 (200bps default), line 2429 (500bps momentum scanner)
- **Issue:** 2% default and 5% for momentum scanner are generous, enabling MEV extraction.
- **Fix:** Reduce defaults to 100bps, cap momentum at 300bps.

---

## Positive Observations

- Bot wallet edge function authenticates users via JWT before any operation
- Transaction amounts validated against configurable maximums
- Bot wallet maintains SOL reserve (`MIN_SOL_RESERVE_LAMPORTS`) to prevent dust attacks
- Autopilot disabled by default with sensible limits (max 3 trades/day, high confidence minimum)
- Daily trade limits enforced server-side
- Extreme risk trades filtered from autopilot
- Timeout wrappers on all external API calls (3-15s)
- Fallback price feeds (CoinGecko -> Coinbase)
- Promise.allSettled() for multi-chain calls

---

## Remediation Priority

### Immediate (this session)
1. Fix seed phrase generation (C1)
2. Secure seed phrase handling (C2)
3. Fix wallet signature verification (C3)
4. Switch to PKCE auth (H3)
5. Fix Ethereum checksum (M1)
6. Reduce slippage defaults (L2)
7. Fix skipPreflight (M2)
8. Gate console.log behind __DEV__ (M6)

### Next session
9. Add circle membership checks to bot wallet (H1)
10. Add RLS to trading tables (H4)
11. Secure Helius API key storage (H2)
12. Hash agent connection tokens (H5)

### Future
13. Server-side rate limiting (M4)
14. Real scam address API integration (M5)
15. Restrict CORS origins (M3)
16. Full BIP-39 import validation (M7)
