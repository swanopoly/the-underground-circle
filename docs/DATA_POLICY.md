# Data Policy — The Underground Circle

_Last updated: 2026-04-19_

This document explains what happens to your code, chat messages, and other data when you use The Underground Circle, and what controls exist to limit third-party processing.

---

## Summary

**None of your code, chat, or circle data is sent to any third party for model training.**

When you use BlackSwan, the chat streamer, or any feature that uses Anthropic or OpenAI, your content goes to that provider's API only to produce your response. The provider holds it briefly for abuse monitoring, then deletes it. It is **not used to train models**. This is the default contractual behavior — not a setting we toggle.

If you bring your own API key for a third-party provider (Groq, OpenRouter, etc.), you are using them under _their_ terms. See the provider table below.

---

## Where Your Data Goes

The app calls third-party APIs in three categories:

### 1. First-party LLM providers (built-in to the app)

These are called by our Supabase Edge Functions using project-level API keys:

| Endpoint | Called by | What we send | Their policy |
|---|---|---|---|
| `https://api.anthropic.com` | `swanbot-ai`, `chat-stream`, `automation-executor`, `llm-proxy` (if user picks Anthropic), `boss-agent`, `build-stream`, `heartbeat-agent`, `distil-soul-wisdom`, `featured-trades-generator` | System prompt + messages for the current turn + lightweight circle context (members, streaks, recent task/check-in counts) | **API inputs/outputs are not used to train Anthropic models** (per [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)). Content is retained up to 30 days for abuse detection, then deleted. Zero Data Retention (ZDR) is available to enterprise customers on request. |
| `https://api.openai.com` | `llm-proxy` (only if user picks OpenAI), some media features | Same as above when you explicitly choose OpenAI | **API data is not used to train OpenAI models by default** (per [OpenAI API data policy](https://openai.com/policies/api-data-usage-policies), effective March 2023). Retained up to 30 days for abuse monitoring. |

### 2. User-supplied BYO LLM providers (only when you add your own API key)

`llm-proxy` can route to additional providers _only if you provide an API key for them_. You are then bound by that provider's terms, not ours:

| Provider | Endpoint | Default data policy |
|---|---|---|
| OpenRouter | `openrouter.ai` | **Varies by downstream model.** OpenRouter passes requests to whichever underlying model you select — check that model's provider policy. |
| Groq | `api.groq.com` | Does not train on API data by default (commercial tier). |
| Hugging Face Router | `router.huggingface.co` | **Varies by hosted model**; some community models on HF may log or retain. Read the model card. |
| z.ai (Zhipu) | `api.z.ai` | Chinese jurisdiction. Review their terms carefully before use. |
| MiniMax | `api.minimax.io` | Chinese jurisdiction. Review their terms carefully before use. |
| GitHub Models (Azure) | `models.inference.ai.azure.com` | Governed by Azure AI terms. |
| Ollama | `http://localhost:*` | **Runs on your own machine. Nothing leaves your network.** |

If data privacy matters, stick to Anthropic/OpenAI/Ollama and avoid the community routers.

### 3. Non-LLM integrations

These are called only when you explicitly connect an integration or use a feature that uses them:

| Host | Purpose |
|---|---|
| `api.github.com`, `github.com` | GitHub OAuth, webhooks, repo file browsing |
| `slack.com` | Slack integration |
| `gmail.googleapis.com` | Gmail integration |
| `graph.microsoft.com`, `login.microsoftonline.com` | Microsoft 365 / Teams integration |
| `api.figma.com` | Figma integration |
| `api.gitbook.com` | GitBook integration |
| `api.linkedin.com`, `api.twitter.com`, `bsky.social` | Social connectors |
| `api.replicate.com` | Replicate image/media generation (only when invoked) |
| `api.resend.com` | Transactional email |
| `api.dexscreener.com` | Public market data (crypto — no PII sent) |

These calls carry only what the feature requires (OAuth tokens, a message, a specific payload). None of these receive your full chat history or codebase.

---

## What Is NOT Sent

- **We do not ship your repo code to any LLM provider.** The RoomsTab file browser and BlackSwan do not attach source files by default. If you paste code into chat or drag a file into a room, that specific content goes with the request — but the model never sees your codebase wholesale.
- **We do not train models on your data.** We do not operate any training pipeline that uses user content. The BlackSwan local LLM pipeline (`scripts/blackswan-llm/`) is trained exclusively on public HuggingFace datasets — no user content feeds it.
- **We do not sell or share your data with advertisers, brokers, or unrelated third parties.**

---

## Zero Data Retention (ZDR)

Anthropic offers Zero Data Retention for enterprise customers — API inputs/outputs are processed and discarded without any retention window, not even for abuse monitoring.

This is **not a per-request header** you can set; it requires a business agreement with Anthropic. If you need ZDR for your circle (e.g., regulated industry, sensitive code), contact Anthropic sales and request a ZDR amendment to your commercial terms. Once in place, all requests from their API key inherit ZDR automatically.

OpenAI offers an equivalent "Zero Retention" option on their Enterprise / API Scale-tier.

---

## Local / Offline Options

If you want LLM features to run entirely on your own hardware with zero data leaving your machine:

1. **Run BlackSwan Mini or Full locally** via Ollama. See `CLAUDE.md` → _BlackSwan LLM Training Pipeline_. Fine-tuned Qwen2.5-7B or Qwen3.5-27B, GGUF Q4_K_M, served at `http://localhost:11434`.
2. **Point `llm-proxy` at Ollama.** When you pick the `ollama` provider, requests never leave `localhost`.
3. **Disable cloud-BlackSwan features** (GitHub digests, webhook summaries, nudges) in IntegrationsTab and Automations.

---

## Developer Tooling: Claude Code (CLI)

When you work on this repo with Claude Code:

- **API calls** (code generation, file edits) go to Anthropic under the same no-training terms as the app.
- **Optional telemetry** (Statsig metrics, Sentry error reports, feedback commands) is disabled in this machine's Claude Code config via:

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY": "1"
  }
}
```

This turns off:
- `DISABLE_TELEMETRY` (Statsig metrics + session-quality surveys)
- `DISABLE_ERROR_REPORTING` (Sentry)
- `DISABLE_FEEDBACK_COMMAND` (`/feedback` transcript uploads)
- `DISABLE_AUTOUPDATER`
- The "How is Claude doing?" quality survey

---

## Auditing Outbound Traffic

You can verify what's actually being sent at any time:

```bash
# All external hosts our edge functions call:
grep -rn "fetch.*http" supabase/functions --include="*.ts" \
  | grep -oE "https://[a-zA-Z0-9.-]+" | sort -u

# All LLM endpoints referenced in the codebase:
grep -rn "/v1/messages\|/v1/chat/completions\|anthropic.com\|openai.com" \
  supabase/functions src --include="*.ts"
```

If you spot a new host you don't recognize, open an issue or check the commit that introduced it.

---

## Reporting Concerns

If you believe data is being handled in a way that contradicts this document, file an issue in the repo or email the owner (see README). This is a single-operator project — the fastest path to a fix is a direct report.
