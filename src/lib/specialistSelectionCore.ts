/**
 * specialistSelectionCore — pure, deterministic, signal-based specialist selection.
 *
 * Problem this solves (delegation expansion): dormant Security / DevOps / Designer
 * (and other) sub-agents are never auto-delegated because
 * `subagentRegistry.planSubagentDelegation`'s task-kind switch only wires a fixed
 * roster (architect / coder / tester / reviewer / planner / researcher / debugger).
 * A "build a login form with secure password hashing" request never wakes the
 * Security specialist; "ship this via the docker pipeline" never wakes DevOps.
 *
 * This core scans the user message + task plan text for CLEAR domain keyword
 * signals and proposes the extra specialists that were NOT already selected, each
 * tagged with a match-strength priority. The impure caller (subagentRegistry)
 * feeds `listSubagentCapabilities()` + the roles it already added, addSubagentSpec
 * each returned signal, then ranks + slices.
 *
 * PURITY (load-bearing): zero runtime imports (nothing is imported at all), so
 * this loads cleanly under tsx/esbuild for smoke testing (which cannot load
 * react-native / supabase). No `Date.now()` / `Math.random()` at module scope —
 * output is a pure function of inputs. Every export is TOTAL: it never throws on
 * null / undefined / wrong-type / huge / hostile input, returning a safe neutral
 * value instead. All output is bounded.
 *
 * CONSERVATIVE by design: keyword sets are curated to specific domain terms and
 * deliberately EXCLUDE ultra-generic words (fix / build / test / plan / help),
 * which the task-kind switch already covers. Matching is whole-token (never
 * substring), so "author" never trips "auth" and "decision" never trips "ci".
 */

export interface CapabilitySignal {
  role: string;
  matched: string[];
  priority: 'high' | 'medium' | 'low';
}

// ── Bounds (keep every output small and predictable) ─────────────────────────
const MAX_MATCHED = 12;
const MAX_SIGNALS = 24;
const MAX_CAPABILITIES = 60;
const MAX_SELECTED = 500;
const MAX_TRIGGER_LITERALS = 24;

/**
 * Curated whole-token keyword sets per known role. These are the authoritative
 * signal source for the standard roster. Terms are chosen to be domain-specific
 * (a single match is a real signal) while avoiding generic verbs the task-kind
 * switch already routes on. The three dormant specialists (security / devops /
 * designer) get the richest sets — they are the whole point of this core.
 */
const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
  security: [
    'security', 'secure', 'vulnerability', 'vulnerabilities', 'vulnerable', 'vuln',
    'vulns', 'injection', 'inject', 'sqli', 'xss', 'csrf', 'ssrf', 'exploit',
    'exploits', 'cve', 'cves', 'owasp', 'threat', 'threats', 'secret', 'secrets',
    'credential', 'credentials', 'auth', 'authentication', 'authorization', 'oauth',
    'sanitize', 'sanitization', 'pentest', 'malware', 'phishing', 'encryption',
  ],
  devops: [
    'deploy', 'deploys', 'deployed', 'deploying', 'deployment', 'deployments',
    'ci', 'cd', 'pipeline', 'pipelines', 'docker', 'dockerfile', 'kubernetes',
    'k8s', 'infra', 'infrastructure', 'release', 'releases', 'rollback', 'rollout',
    'provision', 'provisioning', 'terraform', 'ansible', 'helm', 'container',
    'containers', 'netlify', 'vercel', 'staging', 'production', 'prod', 'devops',
    'observability', 'sre',
  ],
  designer: [
    'ui', 'ux', 'design', 'designs', 'designer', 'designed', 'designing', 'layout',
    'layouts', 'color', 'colors', 'colour', 'colours', 'figma', 'wireframe',
    'wireframes', 'mockup', 'mockups', 'prototype', 'prototypes', 'typography',
    'spacing', 'palette', 'visual', 'visuals', 'theme', 'themes', 'responsive',
    'usability',
  ],
  planner: [
    'roadmap', 'milestone', 'milestones', 'phase', 'phases', 'sequencing',
    'rollout', 'backlog', 'sprint', 'prioritize', 'prioritization', 'timeline',
    'scope',
  ],
  researcher: [
    'research', 'investigate', 'compare', 'comparison', 'benchmark', 'benchmarks',
    'landscape', 'tradeoff', 'tradeoffs', 'evaluate', 'survey',
  ],
  writer: [
    'documentation', 'readme', 'changelog', 'blog', 'article', 'copywriting',
    'tutorial', 'docs',
  ],
  coder: [
    'refactor', 'refactoring', 'implement', 'implementation', 'endpoint',
    'endpoints', 'typescript', 'javascript', 'codebase', 'backend', 'frontend',
    'component', 'components',
  ],
  reviewer: [
    'critique', 'findings', 'codereview', 'nitpick', 'maintainability', 'readability',
  ],
  architect: [
    'architecture', 'architectural', 'decoupling', 'coupling', 'abstraction',
    'scalability', 'modularity', 'microservice', 'microservices', 'monolith',
  ],
  debugger: [
    'stacktrace', 'traceback', 'regression', 'repro', 'reproduce', 'crash',
    'crashes', 'segfault', 'heisenbug',
  ],
  tester: [
    'coverage', 'vitest', 'jest', 'playwright', 'cypress', 'e2e', 'flaky',
    'fixture', 'fixtures',
  ],
  support: [
    'troubleshoot', 'onboarding', 'faq', 'ticket', 'helpdesk',
  ],
};

// ── Text harvesting (total, bounded, cycle-safe) ─────────────────────────────

/**
 * Collect display text out of an arbitrary value (message or task plan). Handles
 * strings, numbers, booleans, arrays, and plain objects. Bounded by node count,
 * char budget, and recursion depth, so cyclic or enormous inputs are safe. Never
 * throws — getter explosions and exotic shapes are swallowed.
 */
function harvestText(value: unknown): string {
  const out: string[] = [];
  let nodes = 0;
  let chars = 0;
  const NODE_BUDGET = 2000;
  const CHAR_BUDGET = 20000;

  const visit = (v: unknown, depth: number): void => {
    if (nodes >= NODE_BUDGET || chars >= CHAR_BUDGET || depth > 6) return;
    nodes += 1;
    const t = typeof v;
    if (t === 'string') {
      const s = (v as string).length > 4000 ? (v as string).slice(0, 4000) : (v as string);
      out.push(s);
      chars += s.length;
      return;
    }
    if (t === 'number' || t === 'boolean' || t === 'bigint') {
      const s = String(v);
      out.push(s);
      chars += s.length;
      return;
    }
    if (!v || t !== 'object') return;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 500; i += 1) {
        if (nodes >= NODE_BUDGET || chars >= CHAR_BUDGET) break;
        visit(v[i], depth + 1);
      }
      return;
    }
    let keys: string[];
    try {
      keys = Object.keys(v as Record<string, unknown>);
    } catch {
      return;
    }
    for (let i = 0; i < keys.length && i < 200; i += 1) {
      if (nodes >= NODE_BUDGET || chars >= CHAR_BUDGET) break;
      try {
        visit((v as Record<string, unknown>)[keys[i]], depth + 1);
      } catch {
        /* hostile getter — skip this key */
      }
    }
  };

  try {
    visit(value, 0);
  } catch {
    /* fully defensive: return whatever we collected */
  }
  return out.join(' ');
}

/** Lowercase + split into a bounded set of alphanumeric word tokens. */
function tokenize(text: string): Set<string> {
  const set = new Set<string>();
  if (typeof text !== 'string' || text.length === 0) return set;
  const clipped = text.length > 40000 ? text.slice(0, 40000) : text;
  const parts = clipped.toLowerCase().split(/[^a-z0-9]+/);
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p && p.length <= 40) {
      set.add(p);
      if (set.size >= 5000) break;
    }
  }
  return set;
}

// ── Capability / role normalization (total) ──────────────────────────────────

/** Coerce an arbitrary value into a bounded array (arrays + iterables only). */
function toArray(input: unknown, limit: number): unknown[] {
  if (Array.isArray(input)) return input.length > limit ? input.slice(0, limit) : input;
  if (input && typeof input === 'object') {
    const iter = (input as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    if (typeof iter === 'function') {
      const out: unknown[] = [];
      try {
        for (const x of input as Iterable<unknown>) {
          out.push(x);
          if (out.length >= limit) break;
        }
      } catch {
        return [];
      }
      return out;
    }
  }
  return [];
}

/** Pull a role name out of a capability / spec / plain string. Null if absent. */
function extractRole(el: unknown): string | null {
  if (typeof el === 'string') {
    const trimmed = el.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (el && typeof el === 'object') {
    const obj = el as Record<string, unknown>;
    if (typeof obj.role === 'string' && obj.role.trim().length > 0) return obj.role.trim();
    const sub = obj.subagent;
    if (sub && typeof sub === 'object') {
      const subRole = (sub as Record<string, unknown>).role;
      if (typeof subRole === 'string' && subRole.trim().length > 0) return subRole.trim();
    }
  }
  return null;
}

/** Build the set of role names to exclude (the parent already selected them). */
function normalizeSelectedRoles(input: unknown): Set<string> {
  const set = new Set<string>();
  const arr = toArray(input, MAX_SELECTED);
  for (let i = 0; i < arr.length; i += 1) {
    const role = extractRole(arr[i]);
    if (role) set.add(role);
  }
  return set;
}

/** Extract alternation literals from a capability's triggerPatterns (plugin roles). */
function extractTriggerLiterals(patterns: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(patterns)) return out;
  const seen = new Set<string>();
  for (let i = 0; i < patterns.length && i < 20; i += 1) {
    let source = '';
    try {
      const p = patterns[i];
      if (p instanceof RegExp) source = p.source;
      else if (typeof p === 'string') source = p;
    } catch {
      source = '';
    }
    if (!source) continue;
    const literals = source.toLowerCase().match(/[a-z][a-z0-9]+/g);
    if (!literals) continue;
    for (let j = 0; j < literals.length; j += 1) {
      const lit = literals[j];
      if (lit.length >= 2 && !seen.has(lit)) {
        seen.add(lit);
        out.push(lit);
        if (out.length >= MAX_TRIGGER_LITERALS) return out;
      }
    }
  }
  return out;
}

type NormalizedCapability = { role: string; patterns: unknown };

/** Coerce the capabilities input into a bounded list of { role, patterns }. */
function normalizeCapabilities(input: unknown): NormalizedCapability[] {
  const arr = toArray(input, 4000);
  const out: NormalizedCapability[] = [];
  for (let i = 0; i < arr.length && out.length < MAX_CAPABILITIES; i += 1) {
    const el = arr[i];
    const role = extractRole(el);
    if (!role) continue;
    const patterns = el && typeof el === 'object'
      ? (el as Record<string, unknown>).triggerPatterns
      : undefined;
    out.push({ role, patterns });
  }
  return out;
}

/** Resolve the keyword set for a role: curated map for known roles, else the
 *  capability's own trigger literals (so arbitrary plugin roles still work). */
function keywordsForCapability(cap: NormalizedCapability): readonly string[] {
  if (Object.prototype.hasOwnProperty.call(DOMAIN_KEYWORDS, cap.role)) {
    return DOMAIN_KEYWORDS[cap.role];
  }
  return extractTriggerLiterals(cap.patterns);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan the message + task plan for clear domain signals and return the
 * capabilities whose keywords matched and that were NOT already selected. Each
 * signal carries the matched keywords and a match-strength priority
 * (>=3 → high, 2 → medium, 1 → low). Deterministic (capability input order),
 * bounded, conservative, and total.
 */
export function selectSignaledSpecialists(input: {
  message: unknown;
  taskPlan?: unknown;
  capabilities: unknown;
  alreadySelected?: unknown;
}): CapabilitySignal[] {
  try {
    if (!input || typeof input !== 'object') return [];
    const text = `${harvestText(input.message)} ${harvestText(input.taskPlan)}`;
    const tokens = tokenize(text);
    if (tokens.size === 0) return [];

    const selected = normalizeSelectedRoles(input.alreadySelected);
    const caps = normalizeCapabilities(input.capabilities);
    const seenRole = new Set<string>();
    const results: CapabilitySignal[] = [];

    for (let c = 0; c < caps.length; c += 1) {
      const cap = caps[c];
      const role = cap.role;
      if (seenRole.has(role)) continue;
      seenRole.add(role);
      if (selected.has(role)) continue;

      const keywords = keywordsForCapability(cap);
      if (!keywords || keywords.length === 0) continue;

      const matched: string[] = [];
      const matchedSeen = new Set<string>();
      for (let k = 0; k < keywords.length; k += 1) {
        const kw = keywords[k];
        if (tokens.has(kw) && !matchedSeen.has(kw)) {
          matchedSeen.add(kw);
          matched.push(kw);
          if (matched.length >= MAX_MATCHED) break;
        }
      }
      if (matched.length === 0) continue;

      const priority: CapabilitySignal['priority'] =
        matched.length >= 3 ? 'high' : matched.length === 2 ? 'medium' : 'low';
      results.push({ role, matched, priority });
      if (results.length >= MAX_SIGNALS) break;
    }

    return results;
  } catch {
    return [];
  }
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Stable-rank items high → medium → low (unknown priorities sort last). Stable
 * within each bucket (original relative order preserved). Total: non-array input
 * yields []. Never mutates the input array.
 */
export function rankSpecialistsByPriority<T extends { priority: 'high' | 'medium' | 'low' }>(
  items: T[],
): T[] {
  try {
    if (!Array.isArray(items)) return [];
    const high: T[] = [];
    const medium: T[] = [];
    const low: T[] = [];
    const other: T[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const p = it && typeof it === 'object' ? (it as { priority?: unknown }).priority : undefined;
      const bucket = typeof p === 'string' ? PRIORITY_ORDER[p] : undefined;
      if (bucket === 0) high.push(it);
      else if (bucket === 1) medium.push(it);
      else if (bucket === 2) low.push(it);
      else other.push(it);
    }
    return [...high, ...medium, ...low, ...other];
  } catch {
    return Array.isArray(items) ? items.slice() : [];
  }
}
