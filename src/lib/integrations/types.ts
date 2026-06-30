/**
 * Integration framework — types.
 *
 * The registry (registry.ts) is the single source of truth for every provider
 * Underground Circle can connect to. Per-provider connector files in
 * src/lib/integrations/connectors/ implement the ConnectorAdapter interface.
 *
 * Goals:
 *   - Adding a new provider is a 1-file add (define the entry, optionally a
 *     connector adapter for live wiring).
 *   - The IntegrationsTab UI is rendered from the registry — no per-provider
 *     hardcoding in the UI.
 *   - Schema is permissive (provider is text), validation happens in
 *     application code against the registry.
 */

// ── Categories ──────────────────────────────────────────────────────────────
// These bucket providers in the marketplace UI. Order matters — it's the
// display order on the Integrations screen.
export type IntegrationCategory =
  | 'communication'   // Slack, Teams, Discord, Telegram, Email, Twilio
  | 'code_dev'        // GitHub, GitLab, Bitbucket, Linear, Jira, Sentry
  | 'workflow_automation' // Custom APIs, webhooks, agent actions
  | 'ai_llm'          // OpenAI, Anthropic, Google AI, Replicate, etc.
  | 'cloud_infra'     // AWS, GCP, Azure, Cloudflare, Vercel, Netlify
  | 'productivity'    // Notion, Asana, Trello, Airtable, Figma
  | 'crm_sales'       // Salesforce, HubSpot, Pipedrive, Attio
  | 'marketing'       // Mailchimp, ConvertKit, Klaviyo, Brevo
  | 'analytics'       // Google Analytics, Mixpanel, Amplitude, Posthog
  | 'ads'             // Google Ads, Meta Ads, LinkedIn Ads, X Ads
  | 'commerce'        // Stripe, Shopify, Lemonsqueezy, Paddle
  | 'cms_site'        // WordPress, Webflow, Ghost, Sanity
  | 'storage'         // S3, Drive, Dropbox
  | 'auth'            // Auth0, Clerk, WorkOS
  | 'finance'         // QuickBooks, Plaid, Mercury
  | 'support'         // Zendesk, Intercom, Help Scout
  | 'observability'   // Datadog, Sentry, New Relic
  | 'search_db'       // Algolia, Pinecone, Meilisearch
  | 'crypto_web3'     // Helius, Coinbase, Phantom
  | 'social';         // X, LinkedIn, Instagram, YouTube, Reddit

// ── Auth model ──────────────────────────────────────────────────────────────
// How the integration authenticates. Drives which UI is shown to connect.
export type AuthModel =
  | 'oauth2'         // Standard OAuth 2.0 — most providers
  | 'api_key'        // Single API key (Stripe secret, Anthropic, OpenAI)
  | 'pat'            // Personal Access Token (GitHub PAT, GitLab PAT)
  | 'basic'          // Username + password / app password (WordPress)
  | 'bot_token'      // Bot token (Discord, Telegram bots)
  | 'iam_role'       // AWS-style cross-account role with external ID
  | 'service_account'// Google service account JSON (GCP, GA4)
  | 'webhook_only';  // Receives webhooks; no outbound auth (incoming only)

// ── Capabilities ────────────────────────────────────────────────────────────
// What this integration can DO. Drives feature filtering ("show me everything
// that can send a message") and what surface areas need it (automations,
// agent tools, webhooks, etc.).
export type Capability =
  | 'send_message'        // Post messages/chats
  | 'receive_webhook'     // Accept webhook events
  | 'read_data'           // Query/list resources
  | 'write_data'          // Create/update resources
  | 'automation_trigger'  // Triggers automations on events
  | 'automation_action'   // Used as an action step in automations
  | 'agent_tool'          // Agents can call this as a tool
  | 'analytics_source'    // Provides metrics for dashboards
  | 'storage'             // File/object storage
  | 'auth_provider'       // SSO / identity provider
  | 'ai_inference';       // LLM / embedding / image generation

// ── Status ──────────────────────────────────────────────────────────────────
// Drives the visible badge on the integration card and whether the Connect
// button is enabled.
export type IntegrationStatus =
  | 'live'           // Fully wired end-to-end
  | 'beta'           // Wired but rough edges; may break
  | 'planned'        // In active development
  | 'coming_soon';   // On roadmap, not started

// ── Pricing tier required ───────────────────────────────────────────────────
// Some integrations may be plan-gated (e.g., enterprise SSO).
export type RequiredPlan = 'free' | 'pro' | 'business' | 'enterprise';

// ── Provider definition ─────────────────────────────────────────────────────
// One entry per integrable service. The registry is `ProviderDefinition[]`.
export interface ProviderDefinition {
  /** Stable id used in DB (`circle_integrations.provider`). Must be snake_case. */
  id: string;

  /** Marketing-friendly display name ("AWS", "Google Analytics 4"). */
  label: string;

  /** Brand category for grouping. */
  category: IntegrationCategory;

  /** One-sentence description shown on the card. */
  description: string;

  /** Brand color (hex). Used for accents on the card. */
  color: string;

  /** Single-character or short-glyph icon. Replace with real logo PNGs later. */
  icon: string;

  /** Auth flow used to connect. Determines connect-button behavior. */
  authModel: AuthModel;

  /** What this integration can do. */
  capabilities: Capability[];

  /** Implementation status. */
  status: IntegrationStatus;

  /** Plan required to use (default: 'free'). */
  requiredPlan?: RequiredPlan;

  /** Optional homepage / docs URL. */
  homepage?: string;

  /** Optional setup-doc link inside the app. */
  setupDocsPath?: string;

  /** OAuth-specific: scope strings to request. */
  oauthScopes?: string[];

  /** Tag list for search ("crm", "email", "open-source"). */
  tags?: string[];

  /** True if this is recommended in the default "popular" view. */
  popular?: boolean;

  /** Marks legacy entries we want to discourage but not remove. */
  deprecated?: boolean;
}

// ── Connector adapter ───────────────────────────────────────────────────────
// Optional runtime contract — providers with `status: 'live'` should ship a
// connector implementing this interface. Drives the actual API calls.
export interface ConnectorAdapter {
  /** Provider id this adapter handles. */
  readonly providerId: string;

  /** Test that stored credentials still work (e.g., probe /me endpoint). */
  test(secrets: Record<string, string>): Promise<{ ok: boolean; error?: string }>;

  /** Optional: list available actions (drives automation builder UI). */
  listActions?(): Array<{ id: string; label: string; description: string }>;

  /** Optional: execute a named action with parameters. */
  executeAction?(
    actionId: string,
    params: Record<string, unknown>,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; result?: unknown; error?: string }>;
}
