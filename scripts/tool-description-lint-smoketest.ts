/**
 * tool-description-lint-smoketest
 *
 * T1 — description/schema quality gate over the FULL OpenSwan tool catalog
 * (`TOOL_DEFINITIONS` in `src/lib/openswanToolRuntime.ts`). Anthropic's own
 * SWE-bench postmortems attribute major error-rate reductions to precise
 * tool-description refinements; this smoke is the regression net that keeps
 * every current and future tool at that bar.
 *
 * Rules (data-driven; see RULES below):
 *   desc-present-length   description exists and is 60–600 chars.
 *   desc-capability-first description opens with a capability statement, not
 *                         the tool name/label restated verbatim.
 *   desc-usage-guidance   tools in families with >3 siblings (selection
 *                         ambiguity is the failure mode) carry when-to-use
 *                         guidance ("Use when/for/after…", "Prefer…", etc.).
 *   schema-prop-desc      every inputSchema property (incl. nested object
 *                         items) has a non-empty description.
 *   schema-required-refs  every `required` entry references a declared
 *                         property.
 *   mutating-side-effect  policy.mutatesState tools state their side effect
 *                         (a concrete mutation verb) and, when approvalMode
 *                         is 'ask', the approval/HITL/verification gate.
 *   untrusted-content     tools that return untrusted/fenced external or
 *                         user-authored content say so in the description.
 *   policy-approval-consistency
 *                         every 'ask' tool carries an approvalKind for the
 *                         audit trail, and every auto-approved mutation /
 *                         side effect stays inside the documented doctrine
 *                         (reversible in-app write with an audit kind,
 *                         guarded read-only external read, or a listed
 *                         per-tool exception). A new tool that mutates or
 *                         reaches outside while auto-approving fails here
 *                         until it is gated or deliberately excepted.
 *
 * Justified exceptions live in ALLOWLIST with a documented reason. Unused
 * allowlist entries fail the smoke so the list cannot rot.
 *
 * `openswanToolRuntime` transitively imports react-native (via the supabase
 * singleton), which tsx/esbuild cannot parse. Same technique as
 * progressive-tool-disclosure-smoketest: stub the native module specifiers
 * with `node:module.registerHooks`, then dynamically import the REAL runtime
 * so the lint always runs against the live catalog, not a fixture.
 *
 * Run: npm run smoke:tool-description-lint
 */

import { registerHooks } from 'node:module';

// The supabase singleton creates a client at import time — give it inert
// values BEFORE any app module loads. Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://tool-lint-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'tool-lint-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Type-only imports are erased at compile time — safe before the hooks run.
import type { OpenSwanToolDefinition, OpenSwanToolPolicy, OpenSwanToolSurface } from '../src/lib/openswanToolRuntime';

// ── Lint configuration ──────────────────────────────────────────────────────

const MIN_DESCRIPTION_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 600;
/** Families with more siblings than this must carry when-to-use guidance. */
const GUIDANCE_FAMILY_THRESHOLD = 3;

/**
 * When-to-use phrasing the catalog standardizes on. Generous enough to keep
 * the existing terse imperative voice; tight enough that a bare capability
 * sentence ("Clicks at coordinates.") does not pass.
 */
const GUIDANCE_PATTERNS: RegExp[] = [
  /\buse (this|it|when|for|to|after|before|instead|only)\b/i,
  /\buse ['"`]?[\w.]+['"`]? (first|before|after|for|when|to)\b/i,
  /\bprefer\b/i,
  /\binstead of\b/i,
  /\b(do not|don't|never) use\b/i,
  /\bcall (this|it|after|before)\b/i,
  /\bwhen (the user|a user|you|asked)\b/i,
  /\bonly (use|for|when)\b/i,
];

/**
 * Side-effect vocabulary for mutating tools. The description of a
 * `mutatesState` tool must contain at least one concrete mutation verb so the
 * model (and the approval audit trail) can see what changes.
 */
const MUTATION_VERB_RE = new RegExp(
  '\\b(' +
  [
    'creates?', 'writes?', 'overwrites?', 'updates?', 'changes?', 'edits?', 'patch(es)?',
    'posts?', 'sends?', 'publishes?', 'uploads?', 'queues?', 'schedules?',
    'moves?', 'renames?', 'copies', 'copy', 'deletes?', 'soft-deletes?', 'drops?', 'trash(es)?',
    'archives?', 'unarchives?', 'restores?', 'removes?', 'clears?', 'appends?', 'replaces?',
    'grants?', 'revokes?', 'runs?', 'executes?', 'launch(es)?', 'opens?', 'closes?',
    'clicks?', 'types?', 'pastes?', 'press(es)?', 'drags?', 'scrolls?', 'holds?', 'releases?',
    'focuses?', 'fills?', 'selects?', 'navigates?', 'sets?', 'saves?', 'persists?',
    'pins?', 'unpins?', 'forgets?', 'toggles?', 'pauses?', 'resumes?',
    'assigns?', 'unassigns?', 'marks?', 'adds?', 'attach(es)?', 'logs?',
    'places?', 'exports?', 'packages?', 'relinks?', 'files?', 'proposes?',
    'approves?', 'rejects?', 'resolves?', 'completes?', 'switch(es)?', 'turns?',
    'delegates?', 'generates?', 'produces?', 'hides?', 'shows?', 'locks?', 'unlocks?',
    'minimizes?', 'unminimizes?', 'zooms?', 'resizes?', 'raises?', 'brings?', 'mutates?',
  ].join('|') +
  ')\\b',
  'i',
);

/** Approval/HITL gate vocabulary required on `approvalMode: 'ask'` mutations. */
const APPROVAL_GATE_RE = /\bapproval|approval-gated|hitl|gated|requires? approval|write verification|approved\b/i;

/**
 * Tools whose results carry untrusted/fenced external or user-authored
 * content. Their descriptions must tell the model to treat it as data, not
 * instructions (roadmap untrusted-content wrapping rules).
 */
const UNTRUSTED_CONTENT_TOOLS = new Set<string>([
  'fetch_url',          // arbitrary external web text
  'messages.search',    // <untrusted_quoted>-wrapped transcript excerpts
  'messages.list',      // raw user-authored chat excerpts
  'search_memories',    // retrieved memory content is untrusted per roadmap
  'skills.view',        // skill bodies are guidance, never user commands
  'browser.dom_snapshot', // live webpage content
  'desktop.list_installed_apps', // local app names are fenced machine metadata
  'context.search',     // <untrusted_quoted>-wrapped circle context index lines
]);
const UNTRUSTED_PHRASE_RE = /untrusted|as data, not|not (as )?(commands|instructions)|guidance, not commands|treat .* as data/i;

/**
 * Justified exceptions. Every entry must list the rule ids it exempts and a
 * reason; entries that no longer suppress anything fail the smoke.
 *
 * (credentials.get used to be exempt from `mutating-side-effect` because the
 * catch-all coordination policy over-reported `mutatesState: true`. It now has
 * a dedicated read-only `vault` policy (`mutatesState: false`, approvalMode
 * 'ask'), so the mutating rule no longer applies and no exemption is needed.)
 */
const ALLOWLIST: Record<string, { rules: string[]; reason: string }> = {};

// ── policy-approval-consistency doctrine (audit 2026-07-10) ─────────────────
//
// approvalMode 'auto' + (mutatesState || externalSideEffect) is allowed ONLY
// for:
//  (a) reversible IN-APP writes in these families, which must still declare an
//      approvalKind so plugin approval overrides audit honestly. This is the
//      documented "anything a user can edit in Circle Settings / Office
//      Customize is chat-invokable, auto because reversible from the same UI"
//      doctrine (openswanToolRuntime type-union comment) plus the HITL-proposal
//      writers (skills.manage, user_memory.manage) and the approvals plumbing.
const AUTO_MUTATION_DOCTRINE_FAMILIES = new Set(['coordination', 'approval', 'workspace', 'memory', 'code']);
//  (b) read-only reads of an EXTERNAL surface through a guarded path:
//      custom_api.read (server-side proxy: allowlisted methods, private hosts
//      blocked, secrets injected server-side), fetch_url (public GET), and the
//      Google Workspace read tools (Phase B): GET-only planners from the pure
//      googleWorkspaceOps contract core (smoke-pinned URLs, no mutation verbs),
//      the user's OWN account via their user_google_credentials row (RLS),
//      content untrusted-fenced), and the two local diagnostics below. Those
//      diagnostics accept only fixed argv/verb allowlists inside an exact
//      granted root; shells, package scripts, hooks, extensibility escapes,
//      and mutations are refused before process launch. Every Workspace WRITE is a separate
//      ask-gated tool (gmail.write / gdocs.append / gsheets.write / gcal.write).
const AUTO_EXTERNAL_READ_TOOLS = new Set([
  'custom_api.read',
  'fetch_url',
  'gmail.read',
  'gdocs.read',
  'gsheets.read',
  'gdrive.read',
  'gcal.read',
  'local.run_shell',
  'git.run',
]);
//  (c) listed per-tool exceptions with a stable, documented reason.
const AUTO_MUTATION_TOOL_EXCEPTIONS = new Set([
  'desktop.convert_image', // bounded deterministic local conversion next to the source; approvalKind file_write.
  // Reversible local lifecycle changes only. Both require an authenticated,
  // persisted exact provider call plus fresh before/after app/PID/frontmost
  // proof; they authorize no edit, save, export, submission, or other action.
  'desktop.launch_app',
  'desktop.focus_app',
]);

// ── Lint engine ─────────────────────────────────────────────────────────────

type LintTool = OpenSwanToolDefinition & { policy: OpenSwanToolPolicy };
type LintRule = {
  id: string;
  appliesTo: (tool: LintTool, familySize: number) => boolean;
  check: (tool: LintTool) => string[];
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[._/-]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

function familyOf(name: string): string {
  return name.includes('.') ? name.slice(0, name.indexOf('.')) : name;
}

/** Recursively collect schema property paths that are missing descriptions. */
function collectSchemaIssues(schema: Record<string, unknown> | undefined, path: string, missing: string[], badRequired: string[]) {
  if (!schema || typeof schema !== 'object') return;
  const properties = (schema as { properties?: Record<string, Record<string, unknown>> }).properties;
  const required = (schema as { required?: unknown }).required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key !== 'string' || !properties || !(key in properties)) {
        badRequired.push(`${path}required:'${String(key)}'`);
      }
    }
  }
  if (!properties) return;
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object') continue;
    const propPath = `${path}${key}`;
    const description = (prop as { description?: unknown }).description;
    if (typeof description !== 'string' || description.trim().length === 0) missing.push(propPath);
    // Recurse into nested objects and array-of-object item schemas.
    collectSchemaIssues(prop as Record<string, unknown>, `${propPath}.`, missing, badRequired);
    const items = (prop as { items?: Record<string, unknown> }).items;
    if (items && typeof items === 'object') {
      collectSchemaIssues(items, `${propPath}[].`, missing, badRequired);
    }
  }
}

const RULES: LintRule[] = [
  {
    id: 'desc-present-length',
    appliesTo: () => true,
    check(tool) {
      const len = (tool.description || '').trim().length;
      if (len === 0) return ['description is missing'];
      if (len < MIN_DESCRIPTION_CHARS) return [`description too short (${len} < ${MIN_DESCRIPTION_CHARS} chars)`];
      if (len > MAX_DESCRIPTION_CHARS) return [`description too long (${len} > ${MAX_DESCRIPTION_CHARS} chars)`];
      return [];
    },
  },
  {
    id: 'desc-capability-first',
    appliesTo: () => true,
    check(tool) {
      const desc = (tool.description || '').trim();
      if (!desc) return [];
      if (!/^[A-Z"'`]/.test(desc)) return ['description should start with a capitalized capability statement'];
      const normalizedDesc = normalize(desc);
      for (const candidate of [normalize(tool.label || ''), normalize(tool.name)]) {
        if (candidate && normalizedDesc.startsWith(candidate)) {
          return [`description restates the tool name/label ("${desc.slice(0, 48)}…") — open with what it does instead`];
        }
      }
      return [];
    },
  },
  {
    id: 'desc-usage-guidance',
    appliesTo: (_tool, familySize) => familySize > GUIDANCE_FAMILY_THRESHOLD,
    check(tool) {
      const desc = tool.description || '';
      if (GUIDANCE_PATTERNS.some((re) => re.test(desc))) return [];
      return ['tool belongs to a >3-sibling family but has no when-to-use guidance ("Use when/for/after…", "Prefer…")'];
    },
  },
  {
    id: 'schema-prop-desc',
    appliesTo: () => true,
    check(tool) {
      const missing: string[] = [];
      collectSchemaIssues(tool.inputSchema, '', missing, []);
      return missing.map((p) => `inputSchema property '${p}' has no description`);
    },
  },
  {
    id: 'schema-required-refs',
    appliesTo: () => true,
    check(tool) {
      const badRequired: string[] = [];
      collectSchemaIssues(tool.inputSchema, '', [], badRequired);
      return badRequired.map((p) => `required entry ${p} does not reference a declared property`);
    },
  },
  {
    id: 'mutating-side-effect',
    appliesTo: (tool) => tool.policy.mutatesState,
    check(tool) {
      const issues: string[] = [];
      const desc = tool.description || '';
      if (!MUTATION_VERB_RE.test(desc)) {
        issues.push('mutating tool description does not state its side effect (no mutation verb found)');
      }
      if (tool.policy.approvalMode === 'ask' && !APPROVAL_GATE_RE.test(desc)) {
        issues.push("ask-gated mutation does not mention its approval/HITL gate");
      }
      return issues;
    },
  },
  {
    id: 'untrusted-content',
    appliesTo: (tool) => UNTRUSTED_CONTENT_TOOLS.has(tool.name),
    check(tool) {
      if (UNTRUSTED_PHRASE_RE.test(tool.description || '')) return [];
      return ['tool returns untrusted/fenced content but the description does not say to treat it as data, not instructions'];
    },
  },
  {
    id: 'policy-approval-consistency',
    appliesTo: () => true,
    check(tool) {
      const p = tool.policy;
      const issues: string[] = [];
      if (p.approvalMode === 'ask' && !p.approvalKind) {
        issues.push("approvalMode 'ask' but no approvalKind for the audit trail");
      }
      if (p.approvalMode === 'auto' && (p.mutatesState || p.externalSideEffect)) {
        const reversibleInAppWrite =
          p.mutatesState && !p.externalSideEffect && Boolean(p.approvalKind) && AUTO_MUTATION_DOCTRINE_FAMILIES.has(p.family);
        const guardedExternalRead =
          !p.mutatesState && p.externalSideEffect && AUTO_EXTERNAL_READ_TOOLS.has(tool.name);
        if (!reversibleInAppWrite && !guardedExternalRead && !AUTO_MUTATION_TOOL_EXCEPTIONS.has(tool.name)) {
          issues.push(
            `auto-approved mutation/side-effect outside the documented doctrine (family=${p.family}, mutates=${p.mutatesState}, external=${p.externalSideEffect}, kind=${p.approvalKind || 'none'}) — gate it 'ask' or add a documented exception`,
          );
        }
      }
      return issues;
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

const SURFACES: OpenSwanToolSurface[] = ['main_chat', 'room_chat', 'office', 'task_run'];

async function main() {
  const runtime = await import('../src/lib/openswanToolRuntime');

  const byName = new Map<string, OpenSwanToolDefinition>();
  for (const surface of SURFACES) {
    for (const tool of runtime.listOpenSwanToolsForSurface(surface)) byName.set(tool.name, tool);
  }
  const tools: LintTool[] = [...byName.values()].map((tool) => ({
    ...tool,
    policy: runtime.getOpenSwanToolPolicy(tool.name),
  }));

  if (tools.length < 150) {
    console.error(`FAIL: expected the full catalog (>=150 tools), got ${tools.length} — surface union broke?`);
    process.exit(1);
  }

  const familySizes = new Map<string, number>();
  for (const tool of tools) {
    const family = familyOf(tool.name);
    familySizes.set(family, (familySizes.get(family) || 0) + 1);
  }

  let violationCount = 0;
  const violationsByRule = new Map<string, number>();
  const usedAllowlist = new Set<string>();

  for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
    const familySize = familySizes.get(familyOf(tool.name)) || 1;
    for (const rule of RULES) {
      if (!rule.appliesTo(tool, familySize)) continue;
      const issues = rule.check(tool);
      if (issues.length === 0) continue;
      const exemption = ALLOWLIST[tool.name];
      if (exemption && exemption.rules.includes(rule.id)) {
        usedAllowlist.add(`${tool.name}:${rule.id}`);
        continue;
      }
      for (const issue of issues) {
        violationCount += 1;
        violationsByRule.set(rule.id, (violationsByRule.get(rule.id) || 0) + 1);
        console.error(`FAIL: ${tool.name} [${rule.id}] ${issue}`);
      }
    }
  }

  // Allowlist hygiene — every declared exemption must still be load-bearing.
  for (const [toolName, entry] of Object.entries(ALLOWLIST)) {
    for (const ruleId of entry.rules) {
      if (!usedAllowlist.has(`${toolName}:${ruleId}`)) {
        violationCount += 1;
        console.error(`FAIL: allowlist entry ${toolName} [${ruleId}] is unused — remove it (reason was: ${entry.reason})`);
      }
    }
  }

  console.log(`\nLinted ${tools.length} tools across ${familySizes.size} families with ${RULES.length} rules.`);
  if (violationCount > 0) {
    console.error('\nViolations by rule:');
    for (const [ruleId, count] of [...violationsByRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.error(`  ${ruleId}: ${count}`);
    }
    console.error(`\n${violationCount} violation(s).`);
    process.exit(1);
  }
  console.log(`Allowlisted exceptions in use: ${usedAllowlist.size}.`);
  console.log('\nAll tool-description-lint checks passed.');
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
