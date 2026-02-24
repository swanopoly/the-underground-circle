# Supabase Database Setup

This guide walks you through fixing the missing database tables and columns for The Underground Circle.

## 🚨 Current Issues

The live app at https://app.chrisswanson.xyz/ is showing these errors:
- **404 Not Found**: `agents_bots`, `friends`, `integrations` tables don't exist
- **406 Not Acceptable**: `user_xp` table doesn't exist
- **400 Bad Request**: `profiles` table missing wallet columns

These errors break Profile tab features (Friends, Agents, Integrations, XP/Gamification, Wallet).

## ✅ Solution: Run the Migration Script

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase project: https://supabase.com/dashboard/project/rjkniqiqdtroeholxacg
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2: Copy & Paste the Migration Script

1. Open `docs/supabase-migration.sql` (in this repo)
2. Copy the entire contents
3. Paste into the Supabase SQL Editor

### Step 3: Run the Script

1. Click **Run** (or press `Cmd/Ctrl + Enter`)
2. Wait for completion (should take 1-2 seconds)
3. Check the output at the bottom — it should show:
   ```
   user_xp       | 0
   agents_bots   | 0
   friends       | 0
   integrations  | 0
   ```

### Step 4: Verify Tables Exist

Go to **Database → Tables** in Supabase sidebar and confirm:
- ✅ `user_xp`
- ✅ `agents_bots`
- ✅ `friends`
- ✅ `integrations`
- ✅ `profiles` (should now have wallet columns)

### Step 5: Test the Live App

1. Go to https://app.chrisswanson.xyz/
2. Log in
3. Navigate to Profile tab (inside a circle)
4. Check browser console — the 404/406 errors should be gone
5. Try connecting a wallet (Wallet tab)
6. Try viewing Friends, Agents, Integrations

---

## 📊 What the Migration Creates

### Tables

**`user_xp`** — XP and gamification data
- Tracks user level, title, grind karma, social karma
- One row per user (linked to auth.users)

**`agents_bots`** — AI agent management
- User-owned AI agents (chatbots, assistants, integrations)
- Stores API endpoints, keys (hashed), metadata
- Powers the Agents screen

**`friends`** — Friend connections
- Bidirectional friendships between users
- Powers the Friends screen

**`integrations`** — Third-party integrations
- Discord, Twitter, GitHub, Spotify, etc.
- Stores encrypted tokens for OAuth
- Powers the Integrations screen

### Columns Added to `profiles`

- `wallet_address_eth` — Ethereum wallet address
- `wallet_address_sol` — Solana wallet address
- `wallet_address` — Primary wallet address (legacy)
- `wallet_chain` — Chain type ('ethereum' or 'solana')
- `theme_color` — User theme color preference
- `banner_url` — Profile banner image
- `status_message` — Custom status text
- `linked_accounts` — JSON object of linked social accounts
- `pinned_achievements` — Array of pinned achievement IDs

### Security (RLS)

All tables have Row Level Security (RLS) enabled:
- Users can only view/edit their own data
- Friend tables allow mutual access
- Public read access where appropriate

---

## 🔧 Troubleshooting

### "relation already exists" error
If you see errors about tables already existing, that's fine — the script uses `IF NOT EXISTS` so it's safe to run multiple times.

### "column already exists" error
Same as above — `ADD COLUMN IF NOT EXISTS` is safe to run repeatedly.

### RLS Policy errors
If you see "policy already exists", you can safely ignore these. The script will skip creating duplicate policies.

### Still seeing 404/406 errors?
1. Hard refresh the live app (Ctrl+Shift+R)
2. Check Supabase SQL Editor output for any actual errors
3. Verify the tables exist in Database → Tables
4. Check RLS policies are enabled

---

## 📝 Notes

- **No data loss**: This migration only adds new tables/columns, never drops or modifies existing data
- **Idempotent**: Safe to run multiple times
- **Production-ready**: Includes proper indexes, constraints, and RLS policies
- **Reversible**: If you need to undo, you can drop the tables manually (but keep them — the app needs them!)

---

## 🚀 Next Steps After Migration

Once the migration is complete:
1. Users can connect Ethereum and Solana wallets
2. Profile customization works (theme color, banner, status)
3. Friends feature is functional
4. AI Agents screen works
5. Integrations (Discord, etc.) can be connected
6. XP/gamification fully operational

**The app will be fully functional!** 🎉
