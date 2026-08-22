# Integrations Developer Guide

How Underground Circle's integration framework works and how to add a new connector.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   src/lib/integrations/                                                 │
│   │                                                                     │
│   ├── types.ts          Type system: ProviderDefinition, AuthModel,    │
│   │                     Capability, ConnectorAdapter                    │
│   │                                                                     │
│   ├── registry.ts       80+ provider definitions across 19 categories. │
│   │                     SINGLE SOURCE OF TRUTH for what's available.    │
│   │                                                                     │
│   └── connectors/                                                       │
│       ├── index.ts      Adapter registry — id → ConnectorAdapter        │
│       ├── aws.ts        AWS (IAM Role + External ID) ← canonical        │
│       └── …             One file per actively wired provider            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

DB:
   circle_integrations               One row per (circle, provider, label)
   circle_integration_secrets        Encrypted at rest; one row per secret key
   {provider}_oauth_states           OAuth state tokens (per-provider, optional)

Edge functions (one set per provider):
   {provider}-oauth                  OAuth authorize + callback handler
   {provider}-webhook                Inbound webhook receiver
   {provider}-action                 Outbound action invoker (optional)
```

The **registry** is the catalog. The **adapter** is the runtime contract. The **edge functions** are where real network calls happen.

---

## Auth models cheat sheet

The right auth model depends on what the provider supports — pick from the registry's `AuthModel` union:

| Model | When to use | Examples | Storage |
|---|---|---|---|
| `oauth2` | The provider has a standard OAuth 2.0 server | Slack, GitHub, Linear, Notion, Google* | Refresh token in `circle_integration_secrets` |
| `api_key` | Single bearer token / API key, set once | Stripe, Anthropic, OpenAI, SendGrid | Encrypted in secrets table |
| `pat` | Personal Access Token (user-issued) | GitHub PAT fallback, GitLab PAT | Same as `api_key` |
| `basic` | Username + password / app password | WordPress | App password in secrets |
| `bot_token` | Bot-style identity (no user OAuth) | Discord, Telegram | Token in secrets |
| `iam_role` | AWS-style cross-account role with external ID | AWS | Role ARN in metadata, External ID in secrets |
| `service_account` | Long-lived JSON credentials | GCP, GA4 | JSON blob in secrets |
| `webhook_only` | Inbound only — no outbound auth needed | (rare; webhook-only providers) | Webhook secret in secrets |

---

## Adding a new provider — minimum steps

### Step 1 — Add it to the registry

Open `src/lib/integrations/registry.ts` and add an entry to the `INTEGRATIONS` array under the right category section:

```ts
{
  id: 'linear', label: 'Linear', category: 'code_dev',
  description: 'Issues, projects, and cycles. Sync missions to/from Linear.',
  color: '#5e6ad2', icon: '📐',
  authModel: 'oauth2',
  capabilities: ['receive_webhook', 'read_data', 'write_data', 'automation_trigger', 'automation_action'],
  status: 'planned',          // ← bump to 'beta' or 'live' when wired
  homepage: 'https://linear.app',
  oauthScopes: ['read', 'write'],
  tags: ['issues', 'project-management'],
}
```

That's enough to:
- Show the card in any registry-driven UI ("Linear · planned")
- Pass `isValidProvider('linear')` so DB inserts won't be rejected
- Be discoverable via `getIntegrationsByCategory('code_dev')`

For **purely catalog-level adds** (you just want it in the marketplace as "coming soon"), you're done.

### Step 2 — (Optional) Write the connector adapter

If you're going to actively call the provider's API, implement the `ConnectorAdapter` interface in `src/lib/integrations/connectors/{id}.ts`:

```ts
import type { ConnectorAdapter } from '../types';
import { supabase } from '../../supabase';

export const linearConnector: ConnectorAdapter = {
  providerId: 'linear',

  async test(secrets) {
    if (!secrets.access_token) return { ok: false, error: 'Not connected' };
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': secrets.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ viewer { id email } }' }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  },

  listActions() {
    return [
      { id: 'create_issue', label: 'Create issue', description: 'Create a new Linear issue' },
      { id: 'comment_on_issue', label: 'Comment on issue', description: 'Add a comment to an existing issue' },
    ];
  },

  async executeAction(actionId, params, secrets) {
    // Either call Linear directly, or invoke an edge function that does.
    const { data, error } = await supabase.functions.invoke('linear-action', {
      body: { actionId, params, accessToken: secrets.access_token },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: data };
  },
};
```

Then register it in `src/lib/integrations/connectors/index.ts`:

```ts
import { linearConnector } from './linear';

const ADAPTERS: ConnectorAdapter[] = [
  awsConnector,
  linearConnector,        // ← add
];
```

### Step 3 — (Optional) Write the OAuth + webhook edge functions

For OAuth providers, copy the `github-oauth` edge function as the template:

```bash
cp -r supabase/functions/github-oauth supabase/functions/linear-oauth
# Edit URL + scopes for Linear
npx supabase functions deploy linear-oauth
```

Required env vars (set via `npx supabase secrets set`):
- `LINEAR_CLIENT_ID`
- `LINEAR_CLIENT_SECRET`

For webhooks, copy `github-webhook`:

```bash
cp -r supabase/functions/github-webhook supabase/functions/linear-webhook
# Adjust signature verification + payload parsing
npx supabase functions deploy linear-webhook
```

### Step 4 — Bump status to `live` or `beta`

Once end-to-end works, edit the registry entry:

```ts
status: 'live',     // was 'planned'
```

---

## The AWS pattern (canonical for `iam_role`)

AWS doesn't fit OAuth. The recommended SaaS pattern is documented in `src/lib/integrations/connectors/aws.ts`:

1. **Generate a per-circle external ID** (`generateExternalId()`) — random base64url, ~43 chars of entropy.
2. **Show the customer a CloudFormation template** (`buildCloudFormationTemplate(ucAwsAccountId, externalId)`) they paste into their AWS console.
3. **Customer pastes the role ARN back** into Underground Circle.
4. **Save it** with `saveAwsConnection({ circleId, roleArn, externalId, region })` — writes to `circle_integrations` + `circle_integration_secrets`.
5. **Every API call** goes through an edge function that calls `sts:AssumeRole` with the external ID, gets short-lived credentials, makes the AWS call. **No long-lived AWS keys ever touch our database.**

Why external ID? Without it, anyone who learns our AWS account number could craft a malicious assume-role request against your account. The external ID is your "second factor" — only you and we know it. This is the **confused-deputy** mitigation Amazon explicitly recommends for SaaS providers.

The `aws-validate` and `aws-action` edge functions are listed as planned in the connector's `test()` method — they're soft-fail until written, so the connection can be configured even before the runtime is in place. When you write them, AWS becomes the first `iam_role` connector live in production.

---

## Where to add new entries

| Provider type | Where it goes in the registry |
|---|---|
| Code/dev tool (GitHub, Linear, Sentry, Vercel) | `category: 'code_dev'` |
| AI/LLM provider (OpenAI, Anthropic, Mistral) | `category: 'ai_llm'` |
| Cloud (AWS, GCP, Azure, Cloudflare) | `category: 'cloud_infra'` |
| Productivity (Notion, Asana, Airtable, Figma) | `category: 'productivity'` |
| CRM (Salesforce, HubSpot, Pipedrive) | `category: 'crm_sales'` |
| Marketing email / SMS | `category: 'marketing'` |
| Web/product analytics | `category: 'analytics'` |
| Paid ads | `category: 'ads'` |
| Payments / e-commerce | `category: 'commerce'` |
| Storage (S3, Drive, Dropbox) | `category: 'storage'` |
| Auth/SSO (Auth0, Clerk, WorkOS) | `category: 'auth'` |
| Banking / accounting | `category: 'finance'` |
| Helpdesk / support | `category: 'support'` |
| Monitoring (Datadog, Sentry, Grafana) | `category: 'observability'` |
| Search / vector DB (Algolia, Pinecone) | `category: 'search_db'` |
| Crypto / Web3 (Helius, Coinbase) | `category: 'crypto_web3'` |
| Social (X, LinkedIn, YouTube) | `category: 'social'` |

Add new categories sparingly — only when ≥3 providers fit and it's a real semantic group.

---

## Status discipline

The `status` field controls what users see. Keep it honest:

| Status | What it means | UI shows |
|---|---|---|
| `live` | OAuth/connect + at least one read AND one write action work end-to-end on prod | Green "Live" badge, Connect button enabled |
| `beta` | Connect works, some actions wired, may have rough edges | Yellow "Beta" badge, "Some features in development" caveat |
| `planned` | In active development this quarter — schema in place, partial code | Blue "Planned" badge, Connect button shows "Coming soon" |
| `coming_soon` | On the roadmap, no code yet | Gray "Coming soon" badge, Connect button disabled |

If a connector breaks in production for >24h, drop the status from `live` to `beta`. Honesty over marketing.

---

## Schema notes

The `circle_integrations` and `circle_site_credentials` tables originally had `CHECK` constraints listing every supported provider. Migration `20260414_integrations_registry.sql` dropped those constraints — the registry is now the validation layer.

If you bypass the registry and insert an unknown provider directly into the DB, nothing will crash, but the UI won't render it (no metadata), and connector lookup will return `undefined`. **Always go through `isValidProvider(id)` before insert.**

Encryption: circle integration secrets are stored in the private
`integration_secrets_private.circle_integration_secret_ciphertexts` table as a
versioned pgcrypto envelope. Browser callers receive only bounded metadata and
manager RPC results; plaintext and ciphertext are not directly selectable.
The envelope currently resolves `app_encryption_key()`, so any future Vault-key
rotation must inventory, rewrap, and verify this domain before replacing the
old key. New work should move it onto a dedicated versioned domain key.

---

## File map

| Concern | File |
|---|---|
| Registry of all providers | `src/lib/integrations/registry.ts` |
| Type system | `src/lib/integrations/types.ts` |
| Adapter registry | `src/lib/integrations/connectors/index.ts` |
| AWS connector (canonical IAM-role) | `src/lib/integrations/connectors/aws.ts` |
| Schema migration (drop CHECK) | `supabase/migrations/20260414_integrations_registry.sql` |
| Existing legacy catalog (Codex's territory) | `src/lib/circleIntegrationCatalog.ts` |
| Existing IntegrationsTab UI | `src/screens/circles/tabs/IntegrationsTab.tsx` |
| GitHub canonical wired example | `src/lib/github.ts` + `supabase/functions/github-oauth/`, `github-webhook/` |
| Stripe canonical webhook example | `supabase/functions/stripe-webhook/` |

---

## Roadmap (priority order)

Based on the marketplace research (Zapier popularity + dev-team essentials), the order to bring connectors from `planned` → `live`:

**Q2 2026 (P0)** — these unlock 80% of user value:
1. **Linear** (issues sync with missions)
2. **Sentry** (error tracking → feed events)
3. **AWS** (canonical iam_role pattern, broad enterprise unlock)
4. **Notion** (docs/wiki sync)
5. **Vercel + Netlify** (deploy events → feed)

**Q3 2026 (P1)** — productivity / team essentials:
6. **OpenAI + Anthropic + Google AI** (BYOA agent providers)
7. **Google Sheets** (data-exchange universal)
8. **Airtable** (structured data)
9. **HubSpot** (CRM)
10. **PostHog** (product analytics)

**Q4 2026 (P2)** — commerce + marketing:
11. **Shopify** (orders → feed)
12. **Mailchimp** (email campaigns)
13. **Google Analytics 4** (web metrics)
14. **Stripe** advanced (already partial — finish subscription + portal flows)

**2027 (P3)** — niche / enterprise:
15. SAML SSO via WorkOS
16. Salesforce
17. Datadog
18. Auth0
19. Compliance: SOC2 / Audit log integrations

Don't ship more than 3 `live` connectors per release — each one needs its own end-to-end smoke test.
