# Development Guide

## Quick Start

**Recommended: Use the supervisor (auto-restarts on crash)**
```bash
npm run dev
```

This starts both services with automatic crash recovery:
- CORS Proxy on http://localhost:18790
- Expo Dev Server on http://localhost:8081

Press `Ctrl+C` to stop all services.

---

## Manual Start (if needed)

**Option 1: Start separately**
```bash
# Terminal 1: CORS Proxy
npm run proxy

# Terminal 2: Dev Server
npm start
```

**Option 2: Start individually**
```bash
node openswan-proxy.js  # CORS proxy
npm start               # Expo dev server
```

---

## Why Services Crash

**Common causes:**
1. **Unhandled exceptions** - Fixed: Added error handlers
2. **Memory pressure** - Fixed: Auto-restart with rate limiting
3. **Port conflicts** - Fixed: Better error messages
4. **OpenSwan gateway disconnects** - Fixed: Graceful error handling

**The supervisor (`start-dev.js`) solves this by:**
- Auto-restarting crashed services (2s delay)
- Rate limiting restarts (max 10 in 60s)
- Graceful shutdown on Ctrl+C
- Better error logging

---

## Troubleshooting

**Port already in use:**
```bash
# Find and kill the process
netstat -ano | findstr :18790
taskkill /PID <PID> /F
```

**Services keep crashing:**
- Check if OpenSwan gateway is running (`openswan status`)
- Check available memory (Task Manager)
- Review error logs above the restart message

**Dev server won't bundle:**
- Clear Metro cache: `npm start -- --clear`
- Delete node_modules and reinstall: `rm -rf node_modules && npm install`

---

## Architecture

```
Browser → CORS Proxy (18790) → OpenSwan Gateway (18789)
                ↓
        Expo Dev Server (8081)
```

**Why the CORS proxy?**
Browsers block cross-origin requests. The proxy adds CORS headers so the web app can talk to OpenSwan.

**Services:**
- `openswan-proxy.js` - Simple HTTP proxy with CORS headers
- `start-dev.js` - Supervisor that keeps both services running
- Expo Metro - Bundles the React Native app for web/mobile

---

## Production

For production deployment, you don't need the CORS proxy. Options:

1. **Public tunnel** (for remote access):
   ```bash
   npx localtunnel --port 18789
   ```

2. **Configure CORS on gateway** (if supported)

3. **Reverse proxy** (nginx, caddy) with CORS headers

The app is designed to work with any OpenSwan-compatible endpoint.
