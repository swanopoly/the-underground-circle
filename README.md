# ⭕ The Underground Circle

**Social accountability circles for people who actually work.**

Built for creators, builders, and grinders who want real accountability — not just another social app.

## 🔥 Features

- **Accountability Circles** — Create or join circles focused on fitness, money, learning, career, and more
- **AI Agent Office** — Manage AI agents with a pixel-art office dashboard, track costs, and monitor performance
- **Crypto Wallets** — Connect Ethereum and Solana wallets, track portfolio and DeFi positions
- **Gamification** — XP system, levels, achievements, and daily challenges to keep you grinding
- **Smart Digest** — AI-powered daily summaries of circle activity
- **Discord Integration** — Bridge your Discord server with your circle
- **Governance** — On-chain style proposals and voting for circle decisions

## 🛠 Tech Stack

- **Frontend:** React Native + Expo (Web, iOS, Android)
- **Backend:** Supabase (Auth, Database, Realtime)
- **AI:** OpenSwan integration for multi-agent management
- **Crypto:** ethers.js + @solana/web3.js
- **Deploy:** Netlify (web), Expo EAS (mobile)

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Install
```bash
git clone https://github.com/swanopoly/the-underground-circle.git
cd the-underground-circle
npm install
```

### Run locally
```bash
npm run web          # Web (localhost:8081)
npm run start        # Expo dev server
npm run build        # Production web build
```

### Environment Variables
Create a `.env` file:
```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS=false
```

Model provider keys should not be bundled into the public app. Users add their
own model keys in the app before using chat/agent features.

## 📱 Live App

**Web:** [app.chrisswanson.xyz](https://app.chrisswanson.xyz)

## 📄 License

MIT © Chris Swanson
