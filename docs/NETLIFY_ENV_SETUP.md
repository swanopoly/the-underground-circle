# Netlify Environment Variables Setup

## Adding Environment Variables

1. Go to https://app.netlify.com/
2. Click on your site: **the-underground-circle**
3. Click **Site settings** → **Environment variables**
4. Add each variable below

### Required Variables

| Key | Where to find it |
|-----|-----------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon/public key |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Google AI Studio → API Keys |

**Never commit actual key values to this file or any source code.**
Copy them directly from the provider dashboards into Netlify's UI.

### After Adding Variables

1. Go to **Deploys** → **Trigger deploy** → **Deploy site**
2. Wait ~2-3 minutes for build
3. Hard refresh the live site: `Ctrl+Shift+R`

## Security Notes

- **Supabase Anon Key**: Client-side key, protected by Row Level Security (RLS)
- **Gemini API Key**: Limited-scope key for AI features
- All sensitive operations are protected by RLS policies server-side
- The `.env` file is in `.gitignore` — Netlify needs vars set in its dashboard

## Troubleshooting

1. **Hard refresh** after deploy: `Ctrl+Shift+R`
2. **Check browser console** (F12) for connection errors
3. **Verify vars** in Netlify: Site settings → Environment variables
4. **Check build log**: Deploys → Latest → Build log (no `undefined` errors for EXPO_PUBLIC_*)
