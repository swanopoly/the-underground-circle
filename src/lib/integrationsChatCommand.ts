/**
 * integrationsChatCommand — the `/integrations` chat surface for connected
 * custom-API + provider integrations.
 *
 *   /integrations                     → list connected + notable available
 *   /integrations connect <name>      → plain connect guide (key/webhook, in Marketplace)
 *   /integrations act <goal>          → compose + run an API action (alias: `do`)
 *
 * This module CLASSIFIES the command into a directive and formats the
 * list/connect replies. It executes nothing — no supabase, no react, no model
 * call. The `act` path is handed to the orchestrator, which builds the composer
 * prompt (integrationActionComposer), calls the model, parses the proposal, and
 * routes it through the EXISTING approval-gated `custom_api.request` tool.
 *
 * Pure module — its only runtime import is the pure `integrationPresets`
 * catalog (data + string builders, no react/supabase) — so it still loads
 * under tsx for scripts/integrations-chat-command-smoketest.ts.
 */

import type { CircleIntegrationRecord } from './circleIntegrations';
import type { IntegrationDefinition } from './circleIntegrations';
import { resolveIntegrationPreset, buildPresetConnectGuide } from './integrationPresets';

// ── Public shapes ─────────────────────────────────────────────────────────

export type IntegrationsCommand =
  | { ok: true; kind: 'list' }
  | { ok: true; kind: 'connect'; query: string }
  | { ok: true; kind: 'act'; goal: string; integrationHint?: string }
  | { ok: false; error: string };

// ── Bounds ──────────────────────────────────────────────────────────────────

/** Act goals stay short — long source material belongs in a follow-up message. */
export const MAX_INTEGRATIONS_GOAL_LENGTH = 1200;
/** Connect queries are just a provider name / few words. */
export const MAX_INTEGRATIONS_CONNECT_QUERY_LENGTH = 120;
/** List reply stays a bounded overview, not a full catalog dump. */
export const MAX_INTEGRATIONS_LIST_REPLY_LENGTH = 2000;
/** Connect guide stays a short set of plain steps. */
export const MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH = 1400;

const MAX_LIST_CONNECTED = 20;
const MAX_LIST_AVAILABLE = 12;

// ── (a) parseIntegrationsCommand ─────────────────────────────────────────────

/**
 * `/integrations` (alias `/integration`) — whole-token only, so
 * `/integrationsx` or `/integrationz` fall through (`null`) to the next handler.
 *
 * Grammar:
 *   /integrations                    → { kind:'list' }
 *   /integrations list               → { kind:'list' }
 *   /integrations connect <name>     → { kind:'connect', query }
 *   /integrations act <goal>         → { kind:'act', goal }
 *   /integrations do <goal>          → { kind:'act', goal }   (alias)
 *
 * An `act`/`do` with an optional `on <hint>` / `using <hint>` / `with <hint>`
 * tail names the target integration; the hint is separated from the goal.
 */
export function parseIntegrationsCommand(raw: string): IntegrationsCommand | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const head = trimmed.match(/^\/(integrations|integration)(?:\s+([\s\S]*))?$/i);
  if (!head) return null;

  const rest = (head[2] || '').trim();

  // Bare `/integrations` → list.
  if (!rest) return { ok: true, kind: 'list' };

  const sub = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const verb = (sub?.[1] || '').toLowerCase();
  const arg = (sub?.[2] || '').trim();

  if (verb === 'list' || verb === 'ls') {
    return { ok: true, kind: 'list' };
  }

  if (verb === 'connect' || verb === 'add' || verb === 'setup') {
    if (!arg) {
      return {
        ok: false,
        error: 'Which integration? Try `/integrations connect linear` (or any provider / API name).',
      };
    }
    if (arg.length > MAX_INTEGRATIONS_CONNECT_QUERY_LENGTH) {
      return {
        ok: false,
        error: `That name is too long (max ${MAX_INTEGRATIONS_CONNECT_QUERY_LENGTH} chars). Just name the integration, e.g. \`/integrations connect stripe\`.`,
      };
    }
    return { ok: true, kind: 'connect', query: arg.replace(/\s+/g, ' ') };
  }

  if (verb === 'act' || verb === 'do' || verb === 'run') {
    if (!arg) {
      return {
        ok: false,
        error: 'What should I do? Try `/integrations act create a Linear issue titled "Fix login"`.',
      };
    }
    const { goal, integrationHint } = splitActGoal(arg);
    if (goal.length > MAX_INTEGRATIONS_GOAL_LENGTH) {
      return {
        ok: false,
        error:
          `That goal is too long (${goal.length} chars — max ${MAX_INTEGRATIONS_GOAL_LENGTH}). ` +
          'Describe the action here; paste long details in a follow-up message.',
      };
    }
    return integrationHint
      ? { ok: true, kind: 'act', goal, integrationHint }
      : { ok: true, kind: 'act', goal };
  }

  // Unknown subcommand — fail closed with the grammar, don't guess.
  return {
    ok: false,
    error:
      `I don't recognize \`/integrations ${verb}\`. Use \`/integrations\` (list), ` +
      '`/integrations connect <name>`, or `/integrations act <goal>`.',
  };
}

/**
 * Split "create an issue on Linear" → goal "create an issue", hint "Linear".
 * Only a trailing `on|using|via <hint>` where the hint LOOKS LIKE A NAME (short,
 * no leading article, not a common English tail clause) is treated as an
 * integration target — otherwise the whole thing stays the goal. We deliberately
 * drop `for`/`with`/`in` as connectors: they appear too often inside normal
 * goals ("a report … for last quarter"), which would mis-split the goal.
 */
function splitActGoal(text: string): { goal: string; integrationHint?: string } {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^(.*\S)\s+(?:on|using|via)\s+([A-Za-z0-9][\w .\-]{0,48})$/i);
  if (m) {
    const goal = m[1].trim();
    const hint = m[2].trim();
    const looksLikeName =
      // not an article-led clause ("the sales pipeline"), ≤ 3 tokens, and
      // either capitalized or a single bare token (a provider/api name).
      !/^(the|a|an|my|our|this|that|these|those|last|next|all)\b/i.test(hint) &&
      hint.split(/\s+/).length <= 3 &&
      (/^[A-Z0-9]/.test(hint) || hint.split(/\s+/).length === 1);
    if (goal.length >= 3 && looksLikeName) {
      return { goal, integrationHint: hint };
    }
  }
  return { goal: cleaned };
}

// ── (b) buildIntegrationsListReply ───────────────────────────────────────────

function clip(value: unknown, max = 60): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function bound(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 12).trimEnd()}\n…[truncated]`;
}

function recordDisplayName(record: Pick<CircleIntegrationRecord, 'display_name' | 'label' | 'provider'>): string {
  return clip(record.display_name || record.label || record.provider, 50) || 'integration';
}

/**
 * A bounded overview of the circle's integrations, grouped by connected vs the
 * rest (degraded / disabled / planned). Honest counts, no invented providers —
 * only what's in `records`.
 */
export function buildIntegrationsListReply(
  records: Array<
    Pick<CircleIntegrationRecord, 'provider' | 'display_name' | 'label' | 'status' | 'capability_flags'>
  >,
): string {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    return [
      '**Integrations** — none connected yet.',
      '',
      'Connect one in Marketplace, then run `/integrations act <what you want>`.',
      'Guide for a specific one: `/integrations connect <name>` (e.g. `stripe`, `linear`).',
    ].join('\n');
  }

  const connected = list.filter((r) => r.status === 'connected');
  const other = list.filter((r) => r.status !== 'connected');

  const lines: string[] = [
    `**Integrations** — ${connected.length} connected of ${list.length}.`,
  ];

  if (connected.length > 0) {
    lines.push('', '**Connected**');
    for (const r of connected.slice(0, MAX_LIST_CONNECTED)) {
      const caps = (r.capability_flags || []).slice(0, 3).map((c) => clip(c, 24)).filter(Boolean).join(', ');
      lines.push(`• ${recordDisplayName(r)} [${clip(r.provider, 24)}]${caps ? ` — ${caps}` : ''}`);
    }
    if (connected.length > MAX_LIST_CONNECTED) {
      lines.push(`• …and ${connected.length - MAX_LIST_CONNECTED} more connected`);
    }
  }

  if (other.length > 0) {
    lines.push('', '**Not ready** (needs setup / disabled)');
    for (const r of other.slice(0, MAX_LIST_AVAILABLE)) {
      lines.push(`• ${recordDisplayName(r)} [${clip(r.provider, 24)}] — ${clip(r.status, 16)}`);
    }
    if (other.length > MAX_LIST_AVAILABLE) {
      lines.push(`• …and ${other.length - MAX_LIST_AVAILABLE} more`);
    }
  }

  lines.push(
    '',
    'Do something: `/integrations act <goal>` (e.g. `act create a Linear issue titled "Fix login"`).',
    'Connect help: `/integrations connect <name>`. Keys/secrets go in Marketplace, never in chat.',
  );

  return bound(lines.join('\n'), MAX_INTEGRATIONS_LIST_REPLY_LENGTH);
}

// ── (c) buildIntegrationsConnectGuide ────────────────────────────────────────

/**
 * Plain connect steps for one provider. `providerMeta` is the matched
 * IntegrationDefinition (injected by the caller from INTEGRATION_DEFINITIONS —
 * kept out of this pure module so it stays dependency-light). When no
 * definition matches, we still give honest generic steps and never invent a
 * provider's specifics.
 */
export function buildIntegrationsConnectGuide(
  query: string,
  providerMeta?: Pick<
    IntegrationDefinition,
    'provider' | 'label' | 'description' | 'requiredSecretKeys' | 'optionalSecretKeys' | 'validationHints'
  > | null,
): string {
  const q = clip(query, 60) || 'that integration';

  if (!providerMeta) {
    // No first-class app definition — a known popular API (GitHub, Jira,
    // Sentry, …) still gets accurate one-step setup (real base URL, auth
    // scheme, exact secret keys, example endpoints) before the generic flow.
    const preset = resolveIntegrationPreset(query);
    if (preset) return buildPresetConnectGuide(preset);

    return bound(
      [
        `**Connect ${q}**`,
        '',
        "I don't have a built-in guide for that exact name, so here's the general flow:",
        '1. Open **Marketplace → Integrations** in the app.',
        `2. Search for "${q}" (or the closest provider). If it's a REST API with no preset, use **Custom API**.`,
        '3. Paste the API key / token / webhook secret in the **secret field there** — never in chat.',
        '4. For **Custom API**, also fill base URL, allowed methods, and (optionally) the docs URL.',
        '5. Save. Then run `/integrations act <what you want>` and I compose the request for approval.',
        '',
        'Secrets stay in Marketplace and are injected server-side — chat only ever sees non-secret metadata.',
      ].join('\n'),
      MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH,
    );
  }

  const label = clip(providerMeta.label || providerMeta.provider, 50) || q;
  const required = (providerMeta.requiredSecretKeys || []).map((k) => clip(k, 40)).filter(Boolean);
  const optional = (providerMeta.optionalSecretKeys || []).map((k) => clip(k, 40)).filter(Boolean);

  const lines: string[] = [`**Connect ${label}**`];
  const desc = clip(providerMeta.description, 200);
  if (desc) lines.push('', desc);

  lines.push('', 'Steps:', '1. Open **Marketplace → Integrations** and pick this provider.');

  if (required.length > 0) {
    lines.push(
      `2. You'll need: ${required.join(', ')}. Paste ${required.length > 1 ? 'these' : 'it'} into the **secret fields there** — never in chat.`,
    );
  } else {
    lines.push(
      '2. No required secret for this one — fill the connection fields shown (e.g. base URL / endpoint).',
    );
  }

  if (optional.length > 0) {
    lines.push(`3. Optional: ${optional.join(', ')} (add if your workflow needs it).`);
  }

  // Honest, non-invented hints straight from the definition.
  const hints = (providerMeta.validationHints || []).map((h) => clip(h, 160)).filter(Boolean).slice(0, 3);
  for (const hint of hints) {
    lines.push(`• ${hint}`);
  }

  lines.push(
    '',
    'Save it, then run `/integrations act <what you want>` — I compose the API call and pause for your approval before it runs.',
    'Secrets live in Marketplace and are injected server-side; chat never sees the key.',
  );

  return bound(lines.join('\n'), MAX_INTEGRATIONS_CONNECT_GUIDE_LENGTH);
}
