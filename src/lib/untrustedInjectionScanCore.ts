// untrustedInjectionScanCore — the PURE, advisory DETECTION half of untrusted-
// content defense-in-depth. The codebase already MITIGATES untrusted content
// (`wrapUntrusted` fences it, `sanitizeUntrustedForModel` strips invisible Tag
// chars + defangs markdown auto-load, `secretRedactionCore`/`errorSanitizer`
// scrub OUTBOUND secrets), but nothing SCANS a retrieved/quoted body (web page,
// file, tool/observation output, email, memory) for EMBEDDED natural-language
// instructions aimed at the agent — "ignore previous instructions", "you are
// now…", "email your api key to…", a forged `## SYSTEM:` / `<|im_start|>` /
// `[INST]` block, "do not tell the user / bypass approval", or a literal
// `</untrusted_quoted>` breakout — and none returns a RISK SIGNAL.
//
// This module fills that gap. It is a SIGNAL, never a mutation: it does not
// wrap, edit, block, or persist. Callers run `scanForInjection(rawBody)` BEFORE
// `wrapUntrusted(rawBody, …)` and, when `result.flagged`, escalate the fence
// heading, emit a secret-safe activity/telemetry event, and/or feed `flagged`
// into the HITL/approval decision for destructive-automation routes.
//
// PURITY: the only runtime import is `redactSecrets` from the committed,
// zero-dependency `./secretRedactionCore` (tsx-loadable) — used ONLY to keep
// surfaced excerpts secret-safe, not to detect injection. No react-native, no
// network, no persistence.
// TOTAL / NEVER-THROWS: every regex is compiled fresh per call and applied
// inside try/catch; a failing pattern is skipped, never fatal; null/undefined/
// wrong-type/cyclic/proxy/huge/bigint input yields the neutral 'none' result.
// BOUNDED: MAX_SCAN_CHARS bounds the scanned prefix, MAX_SPANS bounds returned
// spans, MAX_EXCERPT bounds each excerpt, MAX_SCORE bounds the score.
// DETERMINISTIC: no Date/Math.random; frozen pattern list; identical input ⇒
// deep-equal output. Errs toward NOT flagging (advisory; a nagging false 'high'
// is worse than a miss), matching the conservative posture of the other cores.

import { redactSecrets } from './secretRedactionCore';

// ── Bounds (exported so callers/smoke can assert against the same caps) ──────
/** Only the first MAX_SCAN_CHARS characters of input are scanned. */
export const MAX_SCAN_CHARS = 20000;
/** At most MAX_SPANS spans are returned (extras set `truncated`). */
export const MAX_SPANS = 40;
/** Each excerpt is clamped to at most MAX_EXCERPT characters. */
export const MAX_EXCERPT = 80;
/** The score is clamped to 0..MAX_SCORE. */
export const MAX_SCORE = 100;

// Internal collection cap PER pattern so one spammy pattern cannot starve the
// others of the collected budget (each kind may contribute up to this many
// matches; all seven kinds therefore stay represented for scoring).
const PER_PATTERN_CAP = MAX_SPANS;

export type InjectionSignalKind =
  | 'instruction_override'
  | 'role_reassignment'
  | 'system_impersonation'
  | 'exfiltration'
  | 'tool_directive'
  | 'guardrail_evasion'
  | 'fence_breakout';

export type InjectionRiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface InjectionSpan {
  kind: InjectionSignalKind;
  /** Char offset into the ORIGINAL input, inclusive. */
  start: number;
  /** Char offset into the ORIGINAL input, exclusive. */
  end: number;
  /** Bounded (≤MAX_EXCERPT), whitespace-collapsed, control-stripped, secret-redacted. */
  excerpt: string;
  /** Kind weight that contributed to the score. */
  weight: number;
}

export interface InjectionScanResult {
  level: InjectionRiskLevel;
  /** Integer 0..MAX_SCORE. */
  score: number;
  /** Distinct kinds detected, in first-occurrence (by position) order. */
  kinds: InjectionSignalKind[];
  /** ≤MAX_SPANS spans, sorted by start. */
  spans: InjectionSpan[];
  /** True when level is 'medium' or 'high'. */
  flagged: boolean;
  /** True when input exceeded the scan window OR spans were capped. */
  truncated: boolean;
}

export interface ScanOptions {
  maxChars?: number;
  maxExcerpt?: number;
}

interface InjectionPattern {
  kind: InjectionSignalKind;
  weight: number;
  /** Regex SOURCE string; compiled fresh with /gi each call (no shared state). */
  source: string;
}

// Conservative, source-string patterns. Cross-token gaps use BOUNDED lazy
// quantifiers ({0,N}?) so matching stays linear (no catastrophic backtracking).
// Leading verbs are \b-anchored so substrings ("uses"→"use", "running"→"run",
// "systematic"→"system") do not false-trigger — this only makes the detector
// MORE conservative, which the advisory posture wants. Double-quoted so the
// apostrophe class and the fullwidth colon can appear literally; every regex
// metacharacter is backslash-escaped (no raw control chars in this file).
const PATTERNS: readonly InjectionPattern[] = Object.freeze([
  // ── instruction_override (w=35) ──────────────────────────────────────────
  {
    kind: 'instruction_override',
    weight: 35,
    source:
      "\\b(?:ignore|disregard|forget|override|discard)\\b[\\s\\S]{0,40}?\\b(?:previous|prior|earlier|above|preceding|all|the)\\b[\\s\\S]{0,20}?\\b(?:instruction|prompt|rule|context|message|direction|command|guidance)s?\\b",
  },
  {
    kind: 'instruction_override',
    weight: 35,
    source:
      "\\b(?:here are|follow these)\\b[\\s\\S]{0,40}?\\bnew\\b[\\s\\S]{0,20}?\\b(?:instruction|rule)s?\\b",
  },
  // ── role_reassignment (w=20) ─────────────────────────────────────────────
  { kind: 'role_reassignment', weight: 20, source: "\\byou are now\\b" },
  {
    kind: 'role_reassignment',
    weight: 20,
    source: "\\bfrom now on\\b[\\s\\S]{0,40}?\\byou\\b[\\s\\S]{0,10}?\\b(?:are|will|must|should)\\b",
  },
  {
    kind: 'role_reassignment',
    weight: 20,
    source: "\\b(?:act|behave|respond|roleplay)\\b[\\s\\S]{0,6}?\\bas\\b[\\s\\S]{0,6}?\\b(?:a|an|the)\\b",
  },
  {
    kind: 'role_reassignment',
    weight: 20,
    source: "\\bpretend\\b[\\s\\S]{0,6}?(?:to be|that you)\\b",
  },
  {
    kind: 'role_reassignment',
    weight: 20,
    source: "\\byour new\\b[\\s\\S]{0,6}?\\b(?:role|persona|identity|task|objective|goal)\\b[\\s\\S]{0,4}?(?:is\\b|:)",
  },
  // ── system_impersonation (w=35) ──────────────────────────────────────────
  {
    kind: 'system_impersonation',
    weight: 35,
    source: "(?:^|\\n)\\s{0,8}#{0,6}\\s*(?:system|assistant|developer|tool|function)\\b\\s*(?:prompt|message)?\\s*[:：]",
  },
  {
    kind: 'system_impersonation',
    weight: 35,
    source: "<\\s*/?\\s*(?:system|assistant|tool|function|instructions?|im_start|im_end)\\b[^>]{0,40}>",
  },
  {
    kind: 'system_impersonation',
    weight: 35,
    source: "\\[/?INST\\]|<\\|(?:system|im_start|im_end|assistant|user|end)\\|>|<<SYS>>|<\\|end_of_text\\|>",
  },
  // ── exfiltration (w=40) ──────────────────────────────────────────────────
  {
    kind: 'exfiltration',
    weight: 40,
    source:
      "\\b(?:send|email|post|upload|share|forward|exfiltrate|leak|transmit|dm)\\b[\\s\\S]{0,40}?\\b(?:secret|password|api[ _-]?key|token|credential|private key|ssh key|environment variable|system prompt)s?\\b",
  },
  {
    kind: 'exfiltration',
    weight: 40,
    source:
      "\\b(?:send|email|post|upload|share|forward|exfiltrate|leak|transmit|dm)\\b[\\s\\S]{0,40}?\\.env\\b",
  },
  {
    kind: 'exfiltration',
    weight: 40,
    source:
      "\\b(?:reveal|show|print|repeat|expose|disclose|dump)\\b[\\s\\S]{0,30}?(?:your |the )?(?:system prompt|initial prompt|hidden (?:prompt|instructions)|instructions|secret|api[ _-]?key|credentials?)\\b",
  },
  {
    kind: 'exfiltration',
    weight: 40,
    source: "\\b(?:send|post|upload|forward)\\b[\\s\\S]{0,40}?\\bto\\b[\\s\\S]{0,20}?https?://",
  },
  // ── tool_directive (w=15) ────────────────────────────────────────────────
  {
    kind: 'tool_directive',
    weight: 15,
    source:
      "\\b(?:call|invoke|execute|run|use|trigger)\\b[\\s\\S]{0,20}?(?:the )?\\b(?:tool|function|command|shell|api|endpoint|browser|desktop)\\b",
  },
  {
    kind: 'tool_directive',
    weight: 15,
    source: "\\brun\\b[\\s\\S]{0,4}?(?:the following|this)[\\s\\S]{0,4}?\\b(?:command|code|script|shell)\\b",
  },
  // ── guardrail_evasion (w=30) ─────────────────────────────────────────────
  {
    kind: 'guardrail_evasion',
    weight: 30,
    source:
      "\\b(?:do not|don['’]?t|never)\\b[\\s\\S]{0,20}?\\b(?:tell|inform|notify|alert|warn|ask)\\b[\\s\\S]{0,20}?(?:the )?\\b(?:user|human|owner|operator)\\b",
  },
  {
    kind: 'guardrail_evasion',
    weight: 30,
    source: "\\bwithout\\b[\\s\\S]{0,4}?\\b(?:asking|telling|informing|approval|confirmation|permission|user (?:consent|approval))\\b",
  },
  {
    kind: 'guardrail_evasion',
    weight: 30,
    source:
      "\\b(?:bypass|skip|disable|turn off|ignore)\\b[\\s\\S]{0,20}?\\b(?:approval|safety|guardrail|confirmation|security|filter|restriction|policy)(?:s|ies)?\\b",
  },
  // ── fence_breakout (w=45) — the app's OWN closing markers in the body ─────
  { kind: 'fence_breakout', weight: 45, source: "<\\s*/\\s*untrusted_quoted\\s*>" },
  { kind: 'fence_breakout', weight: 45, source: "<\\s*/\\s*skill_body\\s*>" },
]);

// kind → weight. A Map is immune to prototype pollution (no "constructor"/
// "__proto__" hazard), satisfying the deterministic-map-lookup guarantee.
const KIND_WEIGHT: ReadonlyMap<InjectionSignalKind, number> = (() => {
  const m = new Map<InjectionSignalKind, number>();
  for (const p of PATTERNS) if (!m.has(p.kind)) m.set(p.kind, p.weight);
  return m;
})();

interface RawSpan extends InjectionSpan {
  _ord: number;
}

/** Fresh neutral result object (never a shared/frozen singleton). */
function neutral(): InjectionScanResult {
  return { level: 'none', score: 0, kinds: [], spans: [], flagged: false, truncated: false };
}

/**
 * Coerce arbitrary input to a string WITHOUT ever throwing. null/undefined and
 * a value whose String() throws (throwing Proxy / hostile Symbol.toPrimitive)
 * both yield null so the caller returns the neutral result.
 */
function coerceContent(content: unknown): string | null {
  if (content == null) return null;
  if (typeof content === 'string') return content;
  try {
    const s = String(content);
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  const n = Math.floor(v);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// Control / invisible-format character classes, built via new RegExp from
// ASCII-only source strings using doubled-backslash \u escapes so that NO raw
// control or invisible characters ever appear in this file.
//   CONTROL_CHARS: the C0 block minus U+0009/U+000A/U+000D (tab/newline/return,
//   which the whitespace pass collapses to a space), plus U+007F (DEL) and the
//   C1 block U+0080-U+009F.
//   INVISIBLE_CHARS: line/paragraph separators U+2028/U+2029, the zero-width
//   chars U+200B-U+200D, the word-joiner U+2060, and the BOM U+FEFF.
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);
const INVISIBLE_CHARS = new RegExp('[\\u2028\\u2029\\u200B-\\u200D\\u2060\\uFEFF]', 'g');
// Invisible Unicode Tag block (tag-smuggling), built from a code-point source
// string with the 'u' flag. Compiled once inside a guard for older engines.
const TAG_CHARS: RegExp | null = (() => {
  try {
    return new RegExp('[\\u{E0000}-\\u{E007F}]', 'gu');
  } catch {
    return null;
  }
})();
const WHITESPACE_RUN = /\s+/g;

/**
 * Strip control / line-separator / invisible-format chars and collapse
 * whitespace so a surfaced excerpt cannot smuggle instructions or forge fence
 * structure when re-embedded. Runs AFTER redaction so the `[REDACTED]` mask
 * (which contains only safe visible chars) is preserved intact.
 */
function normalizeExcerpt(input: string): string {
  let out = input;
  try {
    out = out.replace(CONTROL_CHARS, '');
    out = out.replace(INVISIBLE_CHARS, '');
    if (TAG_CHARS) {
      try {
        out = out.replace(TAG_CHARS, '');
      } catch {
        /* pathological input under the 'u' flag — skip, never fatal */
      }
    }
    // Collapse every remaining whitespace run (incl. tabs/newlines) to one space.
    out = out.replace(WHITESPACE_RUN, ' ').trim();
  } catch {
    return '';
  }
  return out;
}

/**
 * Build a secret-safe, bounded excerpt from a matched substring: redact first
 * (so a live secret is MASKED, never echoed), normalize control/whitespace,
 * then clamp to maxExcerpt. Never throws.
 */
function buildExcerpt(matched: string, maxExcerpt: number): string {
  let s = matched;
  try {
    const red = redactSecrets(matched);
    if (red && typeof red.text === 'string') s = red.text;
  } catch {
    s = matched;
  }
  if (typeof s !== 'string') s = '';
  s = normalizeExcerpt(s);
  if (s.length > maxExcerpt) s = s.slice(0, maxExcerpt);
  return s;
}

/**
 * Run one pattern over the scan window, returning its spans (bounded to
 * PER_PATTERN_CAP) and whether more matches existed beyond the cap. A malformed
 * or pathological pattern is skipped, never fatal.
 */
function collectMatches(
  scan: string,
  pat: InjectionPattern,
  maxExcerpt: number,
): { spans: RawSpan[]; hitCap: boolean } {
  const spans: RawSpan[] = [];
  let hitCap = false;
  let re: RegExp;
  try {
    re = new RegExp(pat.source, 'gi');
  } catch {
    return { spans, hitCap };
  }
  try {
    // Absolute upper bound on iterations as a final belt-and-suspenders guard
    // against any zero-width pathology (patterns require literals, so this is
    // effectively unreachable, but keeps the loop provably terminating).
    let guard = 0;
    const guardMax = scan.length + PER_PATTERN_CAP + 8;
    while (guard++ < guardMax) {
      let m: RegExpExecArray | null;
      try {
        m = re.exec(scan);
      } catch {
        break;
      }
      if (m === null) break;
      if (spans.length >= PER_PATTERN_CAP) {
        hitCap = true;
        break;
      }
      const matched = typeof m[0] === 'string' ? m[0] : '';
      const start = m.index;
      const end = start + matched.length;
      spans.push({
        kind: pat.kind,
        start,
        end,
        excerpt: buildExcerpt(matched, maxExcerpt),
        weight: pat.weight,
        _ord: 0,
      });
      // Zero-width guard: force progress so exec cannot loop forever.
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    /* one pattern failing must never break the whole scan */
  }
  return { spans, hitCap };
}

function levelFor(score: number): InjectionRiskLevel {
  if (score <= 0) return 'none';
  if (score < 25) return 'low'; // 1..24
  if (score < 55) return 'medium'; // 25..54
  return 'high'; // >=55
}

/**
 * Scan untrusted/quoted content for embedded natural-language instructions
 * aimed at the agent. Pure, total, deterministic, bounded, secret-safe. It is
 * an advisory SIGNAL only — it never wraps, edits, blocks, or persists.
 */
export function scanForInjection(
  content: string | null | undefined,
  opts?: ScanOptions,
): InjectionScanResult {
  try {
    const raw = coerceContent(content);
    if (raw == null || raw.length === 0) return neutral();

    let maxChars = MAX_SCAN_CHARS;
    let maxExcerpt = MAX_EXCERPT;
    try {
      if (opts && typeof opts === 'object') {
        maxChars = clampInt((opts as ScanOptions).maxChars, 0, MAX_SCAN_CHARS, MAX_SCAN_CHARS);
        maxExcerpt = clampInt((opts as ScanOptions).maxExcerpt, 1, MAX_EXCERPT, MAX_EXCERPT);
      }
    } catch {
      // Hostile opts (throwing getter / proxy) → fall back to defaults.
      maxChars = MAX_SCAN_CHARS;
      maxExcerpt = MAX_EXCERPT;
    }

    const scan = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
    let truncated = raw.length > scan.length;
    if (scan.length === 0) {
      // Empty scan window (e.g. maxChars 0) — nothing to detect, but preserve
      // the truncated signal if the original had content.
      const empty = neutral();
      empty.truncated = truncated;
      return empty;
    }

    const collected: RawSpan[] = [];
    let ord = 0;
    for (const pat of PATTERNS) {
      const res = collectMatches(scan, pat, maxExcerpt);
      if (res.hitCap) truncated = true;
      for (const s of res.spans) {
        s._ord = ord++;
        collected.push(s);
      }
    }

    // Stable sort by start, with the collection ordinal as a deterministic
    // tiebreaker so equal-start spans never reorder across engines.
    collected.sort((a, b) => a.start - b.start || a._ord - b._ord);

    // Distinct kinds in first-occurrence (by position) order, over the FULL
    // detected set so a high-signal kind is never dropped from the score just
    // because it first appears past the returned-span cap.
    const kinds: InjectionSignalKind[] = [];
    for (const s of collected) {
      if (!kinds.includes(s.kind)) kinds.push(s.kind);
    }

    // Distinct-kind-primary, spam-resistant scoring.
    let weightSum = 0;
    for (const k of kinds) weightSum += KIND_WEIGHT.get(k) ?? 0;
    const spamBonus = Math.min(20, Math.max(0, 2 * (collected.length - kinds.length)));
    const score = Math.min(MAX_SCORE, weightSum + spamBonus);

    let returned = collected;
    if (returned.length > MAX_SPANS) {
      returned = returned.slice(0, MAX_SPANS);
      truncated = true;
    }
    const spans: InjectionSpan[] = returned.map((s) => ({
      kind: s.kind,
      start: s.start,
      end: s.end,
      excerpt: s.excerpt,
      weight: s.weight,
    }));

    const level = levelFor(score);
    return {
      level,
      score,
      kinds,
      spans,
      flagged: level === 'medium' || level === 'high',
      truncated,
    };
  } catch {
    // Any unexpected failure → neutral, never throw.
    return neutral();
  }
}

/**
 * True when `content` carries a medium/high injection-risk signal. Delegates to
 * `scanForInjection().flagged` so detection and the boolean can never diverge.
 * Never throws.
 */
export function hasInjectionRisk(content: string | null | undefined): boolean {
  try {
    return scanForInjection(content).flagged;
  } catch {
    return false;
  }
}
