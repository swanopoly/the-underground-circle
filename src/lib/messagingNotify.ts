// messagingNotify — pure, dependency-light payload builders + validation for
// outbound team-channel messaging (Slack / Discord / Microsoft Teams) through
// INCOMING WEBHOOKS.
//
// This module is intentionally free of runtime imports (only `import type`) so
// it can be loaded by tsx/esbuild smoke tests AND reused verbatim by the
// `messaging-notify` Deno edge function. It contains ZERO network, secret, or
// Supabase access — it only shapes and bounds the provider-correct JSON body.
//
// Security posture (mirrors the custom_api.request → custom-api-proxy pattern):
//   - The builders never emit a secret value. Any token/key-shaped substring in
//     caller-supplied title/body/fields is scrubbed defensively before it can
//     reach a provider payload, so a leaked credential in the model's prose
//     cannot be posted into a team channel.
//   - Everything is bounded (title ≤200, body ≤3000, ≤6 fields, field key ≤80,
//     field value ≤500) so an oversized/hostile input cannot blow the webhook
//     request budget.
//   - Degenerate inputs never throw — callers get a safe minimal payload or a
//     typed `{ error }`.

export type MessagingProvider = 'slack' | 'discord' | 'teams';

export const MESSAGING_PROVIDERS: readonly MessagingProvider[] = ['slack', 'discord', 'teams'] as const;

/** Human-facing provider labels for approval previews and notices. */
export const MESSAGING_PROVIDER_LABELS: Record<MessagingProvider, string> = {
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Microsoft Teams',
};

/** The channel word each provider uses, for one-line summaries. */
const MESSAGING_PROVIDER_CHANNEL_NOUN: Record<MessagingProvider, string> = {
  slack: 'channel',
  discord: 'channel',
  teams: 'channel',
};

export interface MessagingField {
  label: string;
  value: string;
}

export interface MessagingNotifyInput {
  title?: string;
  body: string;
  linkUrl?: string;
  fields?: MessagingField[];
}

export interface MessagingNotifyArgs extends MessagingNotifyInput {
  provider: MessagingProvider;
}

// ── Bounds (kept small; a channel notice is not a document) ──────────────────
export const MESSAGING_LIMITS = {
  title: 200,
  body: 3000,
  fields: 6,
  fieldLabel: 80,
  fieldValue: 500,
  linkUrl: 1000,
} as const;

// Secret-shaped values we must NEVER post into a team channel. Mirrors the
// custom-api-proxy SECRETISH_KEY_RE intent but applied to VALUE content, since
// the model's prose (not a header name) is the leak vector here. We scrub:
//   - obvious provider tokens by prefix (sk-, xoxb-/xoxp-, ghp_, AKIA…, Bearer …)
//   - long high-entropy-looking opaque strings that look like keys/JWTs.
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  // Bearer / Authorization inline
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /\bAuthorization\s*[:=]\s*[A-Za-z0-9._\-]{8,}/gi,
  // Common vendor key prefixes
  /\bsk-[A-Za-z0-9]{16,}/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9._\-]{16,}/g, // Anthropic-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi, // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{12,}/g, // AWS access key id
  /\bAIza[0-9A-Za-z._\-]{20,}/g, // Google API key
  /\bhf_[A-Za-z0-9]{16,}/g, // Hugging Face token
  // JWT (header.payload.signature)
  /\beyJ[A-Za-z0-9._\-]{16,}\.[A-Za-z0-9._\-]{8,}\.[A-Za-z0-9._\-]{8,}/g,
  // key=VALUE / secret: VALUE where the key name is secret-shaped
  /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{6,}["']?/gi,
];

const SECRET_REDACTION = '[redacted]';

/**
 * Defensive value scrub. Removes secret-looking substrings from ANY
 * caller-supplied text before it can land in a provider payload. This is a
 * belt-and-suspenders guard: chat/prompt policy already forbids raw secrets,
 * but this module refuses to be the surface that posts one to a team channel.
 */
export function scrubSecrets(value: unknown): string {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value);
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, SECRET_REDACTION);
  }
  return text;
}

function clip(value: unknown, max: number): string {
  const scrubbed = scrubSecrets(value).replace(/\r\n/g, '\n');
  const trimmed = scrubbed.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve room for an ellipsis so we never emit a hard-cut token mid-secret.
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function isHttpUrl(value: unknown): value is string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MESSAGING_LIMITS.linkUrl) return false;
  return /^https?:\/\/[^\s]+$/i.test(text) && !/\s/.test(text);
}

/** Normalize + bound the caller fields into a safe, scrubbed, capped list. */
function normalizeFields(fields: unknown): MessagingField[] {
  if (!Array.isArray(fields)) return [];
  const out: MessagingField[] = [];
  for (const raw of fields) {
    if (out.length >= MESSAGING_LIMITS.fields) break;
    if (!raw || typeof raw !== 'object') continue;
    const label = clip((raw as Record<string, unknown>).label, MESSAGING_LIMITS.fieldLabel);
    const value = clip((raw as Record<string, unknown>).value, MESSAGING_LIMITS.fieldValue);
    if (!label && !value) continue;
    out.push({ label: label || '—', value: value || '—' });
  }
  return out;
}

/** Bound + scrub the raw input into the canonical shape the builders consume. */
function normalizeInput(input: MessagingNotifyInput): {
  title: string;
  body: string;
  linkUrl: string;
  fields: MessagingField[];
} {
  const title = clip(input?.title, MESSAGING_LIMITS.title);
  const body = clip(input?.body, MESSAGING_LIMITS.body) || '(no message body)';
  const linkUrl = isHttpUrl(input?.linkUrl) ? (input!.linkUrl as string).trim() : '';
  const fields = normalizeFields(input?.fields);
  return { title, body, linkUrl, fields };
}

// ── Provider payload builders ────────────────────────────────────────────────

function buildSlackPayload(input: MessagingNotifyInput): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);

  // `text` is the required fallback (notifications, screen readers, old
  // clients). Keep it plain and scrubbed.
  const textParts = [title, body].filter(Boolean);
  const text = textParts.join('\n') || body;

  const blocks: Array<Record<string, unknown>> = [];
  if (title) {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: title.slice(0, 150), emoji: true },
    });
  }
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: body },
  });
  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: fields.map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })),
    });
  }
  if (linkUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open link', emoji: true },
          url: linkUrl,
        },
      ],
    });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Posted by an Underground Circle agent' }],
  });

  return { text, blocks };
}

function buildDiscordPayload(input: MessagingNotifyInput): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);

  // Discord `content` is a plain (markdown) message, hard-capped at 2000 chars.
  const contentParts: string[] = [];
  if (title) contentParts.push(`**${title}**`);
  contentParts.push(body);
  if (linkUrl) contentParts.push(linkUrl);
  const content = contentParts.join('\n').slice(0, 2000);

  const payload: Record<string, unknown> = { content };

  // A structured embed carries the fields cleanly when present.
  if (title || fields.length > 0) {
    const embed: Record<string, unknown> = {};
    if (title) embed.title = title.slice(0, 256);
    // Embed description is redundant with content but keeps the embed useful on
    // its own; keep it short.
    embed.description = body.slice(0, 2048);
    if (linkUrl) embed.url = linkUrl;
    if (fields.length > 0) {
      embed.fields = fields.map((f) => ({
        name: f.label.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.value.length <= 40,
      }));
    }
    payload.embeds = [embed];
  }

  return payload;
}

function buildTeamsPayload(input: MessagingNotifyInput): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);

  // Microsoft Teams incoming webhooks accept the legacy MessageCard (Office 365
  // connector card) schema, which is the broadly-supported shape for a simple
  // notification with facts + an optional open-link action.
  const card: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: (title || body).slice(0, 200) || 'Notification',
    themeColor: '0F62FE',
    title: title || undefined,
    text: body,
  };

  const sections: Array<Record<string, unknown>> = [];
  if (fields.length > 0) {
    sections.push({
      facts: fields.map((f) => ({ name: f.label, value: f.value })),
    });
  }
  if (sections.length > 0) card.sections = sections;

  if (linkUrl) {
    card.potentialAction = [
      {
        '@type': 'OpenUri',
        name: 'Open link',
        targets: [{ os: 'default', uri: linkUrl }],
      },
    ];
  }

  return card;
}

/**
 * Build the provider-correct INCOMING WEBHOOK JSON body. Always returns a
 * bounded, scrubbed, markdown-safe object. Never throws and never contains a
 * secret-looking value.
 */
export function buildMessagingPayload(
  provider: MessagingProvider,
  input: MessagingNotifyInput,
): Record<string, unknown> {
  const safeInput: MessagingNotifyInput = input && typeof input === 'object' ? input : ({ body: '' } as MessagingNotifyInput);
  switch (provider) {
    case 'slack':
      return buildSlackPayload(safeInput);
    case 'discord':
      return buildDiscordPayload(safeInput);
    case 'teams':
      return buildTeamsPayload(safeInput);
    default:
      // Fail closed to Slack-shaped text rather than throwing; validation
      // (`validateMessagingNotifyArgs`) is the real gate on provider.
      return buildSlackPayload(safeInput);
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export type MessagingNotifyValidation =
  | { ok: true; value: MessagingNotifyArgs }
  | { ok: false; error: string };

export function isMessagingProvider(value: unknown): value is MessagingProvider {
  return typeof value === 'string' && (MESSAGING_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Validate + normalize raw tool args into a typed, bounded, scrubbed
 * `MessagingNotifyArgs`, or a typed `{ error }`. The returned value carries the
 * SAME args the tool/edge layers should use — bounds and scrubbing are applied
 * once here so the approval preview, the persisted approval key, and the actual
 * send all agree.
 */
export function validateMessagingNotifyArgs(args: unknown): MessagingNotifyValidation {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'messaging.notify requires an args object with a provider and body.' };
  }
  const raw = args as Record<string, unknown>;

  const provider = raw.provider;
  if (!isMessagingProvider(provider)) {
    return {
      ok: false,
      error: `messaging.notify provider must be one of ${MESSAGING_PROVIDERS.join(', ')}.`,
    };
  }

  const bodyText = clip(raw.body, MESSAGING_LIMITS.body);
  if (!bodyText) {
    return { ok: false, error: 'messaging.notify requires a non-empty body.' };
  }

  const title = clip(raw.title, MESSAGING_LIMITS.title);
  const linkUrl = isHttpUrl(raw.linkUrl) ? (raw.linkUrl as string).trim() : undefined;
  const fields = normalizeFields(raw.fields);

  const value: MessagingNotifyArgs = {
    provider,
    body: bodyText,
    ...(title ? { title } : {}),
    ...(linkUrl ? { linkUrl } : {}),
    ...(fields.length > 0 ? { fields } : {}),
  };
  return { ok: true, value };
}

/**
 * One-line human summary for the approval preview / notice, e.g.
 * "Post a message to your Slack channel". Never throws; falls back safely for
 * unknown providers so callers can always render something.
 */
export function describeMessagingNotify(args: unknown): string {
  const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const provider = raw.provider;
  const label = isMessagingProvider(provider) ? MESSAGING_PROVIDER_LABELS[provider] : 'a team';
  const noun = isMessagingProvider(provider) ? MESSAGING_PROVIDER_CHANNEL_NOUN[provider] : 'channel';
  const title = clip(raw.title, 80);
  const suffix = title ? `: "${title}"` : '';
  return `Post a message to your ${label} ${noun}${suffix}`;
}
