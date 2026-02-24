# 🔧 Netlify Environment Variables Setup

## 🚨 Critical Issue: Chat Not Working on Live Site

**Problem**: The chat (and most features) aren't working on https://app.chrisswanson.xyz/ because Netlify doesn't have the environment variables configured.

**Root Cause**: The `.env` file is local only (in `.gitignore`). Netlify builds don't have access to Supabase credentials, so the app can't connect to the database.

## ✅ Fix: Add Environment Variables in Netlify

### Step 1: Open Netlify Environment Variables

1. Go to https://app.netlify.com/
2. Click on your site: **the-underground-circle**
3. Click **Site settings** (in the top menu)
4. Click **Environment variables** (in the left sidebar under "Build & deploy")
5. Click **Add a variable**

### Step 2: Add These 3 Variables

Add each of these one by one:

#### Variable 1: EXPO_PUBLIC_SUPABASE_URL
- **Key**: `EXPO_PUBLIC_SUPABASE_URL`
- **Value**: `https://rjkniqiqdtroeholxacg.supabase.co`
- **Scopes**: All (or just production)

#### Variable 2: EXPO_PUBLIC_SUPABASE_ANON_KEY
- **Key**: `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **Value**: `sb_publishable_P1towPg-vNOM8yAxB70lkg_t9_8Hf4v`
- **Scopes**: All (or just production)

#### Variable 3: EXPO_PUBLIC_GEMINI_API_KEY
- **Key**: `EXPO_PUBLIC_GEMINI_API_KEY`
- **Value**: `AIzaSyBDMkKrkuD7s-H3fT5krGm-OoWP5kfYR8o`
- **Scopes**: All (or just production)

### Step 3: Trigger a Rebuild

After adding all 3 variables:

1. Go to **Deploys** (in the top menu)
2. Click **Trigger deploy** → **Deploy site**
3. Wait ~2-3 minutes for the build to complete

### Step 4: Test

1. Visit https://app.chrisswanson.xyz/
2. Log in
3. Go to a circle
4. Try sending a message in chat
5. ✅ Should work now!

---

## 🔒 Security Note

These keys are **safe to expose**:

- **Supabase Anon Key**: Client-side key, protected by Row Level Security (RLS) in Supabase
- **Gemini API Key**: Limited-scope public key for AI summaries
- **Supabase URL**: Public project URL

All sensitive operations (user data, authentication) are protected by RLS policies on the Supabase side.

---

## 🐛 Troubleshooting

### Chat still not working after rebuild?

1. **Hard refresh** the live site: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. **Check browser console** (F12) for errors
3. **Verify env vars** in Netlify:
   - Site settings → Environment variables
   - All 3 should be listed
4. **Check build log** in Netlify:
   - Deploys → Latest deploy → Build log
   - Should not show any `undefined` errors for EXPO_PUBLIC_* variables

### How to verify env vars are working?

Add this temporarily to `src/lib/supabase.ts` at the top:

```typescript
console.log('Supabase URL:', supabaseUrl);
console.log('Has anon key:', !!supabaseAnonKey);
```

Rebuild, then check browser console on the live site. You should see:
```
Supabase URL: https://rjkniqiqdtroeholxacg.supabase.co
Has anon key: true
```

If you see:
```
Supabase URL: 
Has anon key: false
```

Then the env vars aren't being injected properly. Double-check they're set in Netlify.

---

## 📱 Why This Happened

- **Local dev**: Uses `.env` file (works fine)
- **Netlify build**: `.env` is in `.gitignore`, so Netlify never sees it
- **Solution**: Manually configure env vars in Netlify dashboard

This is the standard way to handle secrets in production deployments - never commit them to git, always set them in the hosting platform's UI.

---

## ✅ After This Fix

All features will work on the live site:
- ✅ Chat (send/receive messages)
- ✅ Authentication (login/signup)
- ✅ Circles (create/join)
- ✅ Profile (view/edit)
- ✅ Wallet (connect/view balances)
- ✅ All database operations

The app will be **fully functional** in production! 🎉
