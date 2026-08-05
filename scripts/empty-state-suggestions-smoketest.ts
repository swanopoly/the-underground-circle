/**
 * empty-state-suggestions-smoketest — verifies src/lib/emptyStateSuggestions.ts.
 *
 * The empty-state cliff fix: every first-run non-chat surface must offer a
 * small, bounded, deterministic set of "next action" suggestions that each map
 * to a REAL capability (a slash command that exists in chatCommandRegistry, a
 * documented same-surface handler token, or a real tab to open).
 *
 * Invariants under test:
 *   1. Every real surface returns 3–4 suggestions.
 *   2. Labels ≤ 48 chars, hints ≤ 80 chars (bounded so a chip can't overflow).
 *   3. Every action is well-formed: seed_command has a non-empty value; open
 *      targets a real UPPERCASE tab key.
 *   4. Every `seed_command` value that looks like a slash command (`/…`)
 *      resolves to a real command in chatCommandRegistry. Non-slash values are
 *      documented same-surface handler tokens (namespaced `surface:action`).
 *   5. Deterministic — repeated calls are deep-equal.
 *   6. A degenerate / unknown surface returns [] and never throws.
 *   7. Returned objects are fresh copies (mutating one call's result does not
 *      leak into the next).
 *   8. describeSuggestionForAnalytics is compact, PII-free, and stable.
 *
 * Run: npx tsx scripts/empty-state-suggestions-smoketest.ts
 */

import assert from 'node:assert/strict';

import {
  getEmptyStateSuggestions,
  describeSuggestionForAnalytics,
  EMPTY_STATE_LABEL_MAX,
  EMPTY_STATE_HINT_MAX,
  EMPTY_STATE_MAX_SUGGESTIONS,
  type EmptyStateSurface,
} from '../src/lib/emptyStateSuggestions';
import { getChatCommandByCommand } from '../src/lib/chatCommandRegistry';

let passCount = 0;
function pass(label: string) {
  passCount += 1;
  console.log(`PASS ${passCount}: ${label}`);
}

const REAL_SURFACES: EmptyStateSurface[] = ['missions', 'feed', 'office', 'rooms'];

// Valid tab keys for `open` actions (mirror of CircleDetailScreen TAB_META).
const OPEN_TAB_KEYS = new Set([
  'CHAT', 'ROOMS', 'OFFICE', 'FEED', 'BACKPACK',
  'INTEGRATIONS', 'VAULT', 'MEMBERS', 'ANALYTICS', 'WALLET', 'PROFILE',
]);

// Same-surface handler tokens that are intentionally NOT slash commands.
// Each is wired to an existing handler in its host surface (documented in
// emptyStateSuggestions.ts). Keep this list in sync with those comments.
const KNOWN_HANDLER_TOKENS = new Set(['office:deploy-agent']);

function main() {
  // ── 1. Each real surface returns 3–4 suggestions ─────────────────────────
  {
    for (const surface of REAL_SURFACES) {
      const s = getEmptyStateSuggestions(surface);
      assert.ok(Array.isArray(s), `${surface} returns an array`);
      assert.ok(
        s.length >= 3 && s.length <= 4,
        `${surface} returns 3–4 suggestions (got ${s.length})`,
      );
      assert.ok(
        s.length <= EMPTY_STATE_MAX_SUGGESTIONS,
        `${surface} never exceeds the ceiling`,
      );
    }
    pass('each real surface returns 3–4 suggestions within the ceiling');
  }

  // ── 2. Labels/hints bounded ──────────────────────────────────────────────
  {
    for (const surface of REAL_SURFACES) {
      for (const s of getEmptyStateSuggestions(surface)) {
        assert.ok(s.label.length > 0, `${surface}: label non-empty`);
        assert.ok(
          s.label.length <= EMPTY_STATE_LABEL_MAX,
          `${surface}: label "${s.label}" ≤ ${EMPTY_STATE_LABEL_MAX} (${s.label.length})`,
        );
        assert.ok(
          s.hint.length <= EMPTY_STATE_HINT_MAX,
          `${surface}: hint "${s.hint}" ≤ ${EMPTY_STATE_HINT_MAX} (${s.hint.length})`,
        );
      }
    }
    pass('all labels ≤ 48 chars and hints ≤ 80 chars');
  }

  // ── 3. Actions well-formed ───────────────────────────────────────────────
  {
    for (const surface of REAL_SURFACES) {
      for (const s of getEmptyStateSuggestions(surface)) {
        assert.ok(s.action, `${surface}: has an action`);
        assert.ok(
          s.action.kind === 'seed_command' || s.action.kind === 'open',
          `${surface}: action kind is seed_command|open (got ${s.action.kind})`,
        );
        assert.equal(typeof s.action.value, 'string', `${surface}: action value is a string`);
        assert.ok(s.action.value.trim().length > 0, `${surface}: action value non-empty`);
        if (s.action.kind === 'open') {
          assert.ok(
            OPEN_TAB_KEYS.has(s.action.value),
            `${surface}: open target "${s.action.value}" is a real tab key`,
          );
          assert.equal(s.action.value, s.action.value.toUpperCase(), 'open value is UPPERCASE');
        }
      }
    }
    pass('every action is well-formed (seed_command non-empty / open→real tab)');
  }

  // ── 4. seed_command values are real commands or known handler tokens ─────
  {
    let slashChecked = 0;
    let tokenChecked = 0;
    for (const surface of REAL_SURFACES) {
      for (const s of getEmptyStateSuggestions(surface)) {
        if (s.action.kind !== 'seed_command') continue;
        const value = s.action.value.trim();
        if (value.startsWith('/')) {
          // Look up the first token (`/mission create` → resolve full, else base).
          const full = getChatCommandByCommand(value);
          const base = getChatCommandByCommand(value.split(/\s+/)[0]);
          assert.ok(
            full || base,
            `${surface}: "${value}" must resolve to a real chatCommandRegistry command`,
          );
          slashChecked += 1;
        } else {
          // Non-slash → documented same-surface handler token.
          assert.ok(
            /^[a-z]+:[a-z-]+$/.test(value),
            `${surface}: handler token "${value}" is namespaced surface:action`,
          );
          assert.ok(
            KNOWN_HANDLER_TOKENS.has(value),
            `${surface}: handler token "${value}" is a KNOWN same-surface handler`,
          );
          tokenChecked += 1;
        }
      }
    }
    assert.ok(slashChecked >= 6, `checked several real slash commands (got ${slashChecked})`);
    assert.ok(tokenChecked >= 1, `checked at least one handler token (got ${tokenChecked})`);
    pass(`seed_command values are real commands (${slashChecked}) or known handler tokens (${tokenChecked})`);
  }

  // ── 4b. Spot-check specific mandated commands exist ──────────────────────
  {
    // These were named in the spec — assert they are truly in the registry.
    for (const cmd of ['/create', '/watch', '/review', '/apps', '/mission create', '/room list']) {
      const hit = getChatCommandByCommand(cmd) || getChatCommandByCommand(cmd.split(/\s+/)[0]);
      assert.ok(hit, `mandated command "${cmd}" exists in chatCommandRegistry`);
    }
    pass('mandated commands (/create, /watch, /review, /apps, /mission create, /room list) exist');
  }

  // ── 5. Deterministic ─────────────────────────────────────────────────────
  {
    for (const surface of REAL_SURFACES) {
      const a = getEmptyStateSuggestions(surface);
      const b = getEmptyStateSuggestions(surface);
      assert.deepEqual(a, b, `${surface} is deterministic across calls`);
    }
    pass('suggestions are deterministic across repeated calls');
  }

  // ── 6. Degenerate / unknown surfaces → [] (no throw) ─────────────────────
  {
    const bogus = ['', 'MISSIONS', 'chat', 'wallet', 'unknown', '   ', 'feed '];
    for (const b of bogus) {
      const out = getEmptyStateSuggestions(b as EmptyStateSurface);
      assert.deepEqual(out, [], `unknown surface "${b}" → []`);
    }
    // null/undefined must also be safe.
    assert.deepEqual(getEmptyStateSuggestions(undefined as any), []);
    assert.deepEqual(getEmptyStateSuggestions(null as any), []);
    pass('degenerate / unknown surfaces return [] and never throw');
  }

  // ── 7. Fresh copies — mutation does not leak ─────────────────────────────
  {
    const first = getEmptyStateSuggestions('missions');
    const originalLabel = first[0].label;
    first[0].label = 'MUTATED';
    first.push({ label: 'x', hint: 'y', action: { kind: 'open', value: 'CHAT' } });
    const second = getEmptyStateSuggestions('missions');
    assert.equal(second[0].label, originalLabel, 'mutating a result does not change the source');
    assert.ok(second.length <= EMPTY_STATE_MAX_SUGGESTIONS, 'pushed entry did not leak');
    pass('returned suggestions are fresh copies (mutation-safe)');
  }

  // ── 8. describeSuggestionForAnalytics: compact, PII-free, stable ─────────
  {
    const s = getEmptyStateSuggestions('office')[0];
    const desc = describeSuggestionForAnalytics('office', s);
    assert.ok(desc.startsWith('empty_state:office'), 'analytics string is namespaced by surface');
    assert.ok(desc.includes(s.action.kind), 'analytics string names the action kind');
    assert.ok(desc.includes(s.action.value.trim()), 'analytics string names the action value');
    // Stable across calls.
    assert.equal(describeSuggestionForAnalytics('office', s), desc, 'analytics string is stable');
    // Bounded — no runaway content.
    assert.ok(desc.length <= 160, `analytics string bounded (${desc.length})`);
    // Invalid action degrades gracefully, never throws.
    const bad = describeSuggestionForAnalytics('feed', { label: 'x', action: undefined as any });
    assert.ok(bad.includes('invalid'), 'invalid action → "invalid" marker, no throw');
    pass('describeSuggestionForAnalytics is compact, stable, and fail-safe');
  }

  // ── 9. No duplicate actions within a surface ─────────────────────────────
  {
    for (const surface of REAL_SURFACES) {
      const keys = getEmptyStateSuggestions(surface).map(
        (s) => `${s.action.kind}:${s.action.value}`,
      );
      assert.equal(new Set(keys).size, keys.length, `${surface}: no duplicate actions`);
    }
    pass('no duplicate actions within any surface');
  }

  // ── 10. At least one navigable + one command per broad expectation ───────
  {
    // Missions offers a same-surface create AND a way to reach goals (open).
    const missions = getEmptyStateSuggestions('missions');
    assert.ok(
      missions.some((s) => s.action.kind === 'seed_command' && s.action.value.includes('/mission create')),
      'missions offers /mission create',
    );
    assert.ok(
      missions.some((s) => s.action.kind === 'open'),
      'missions offers a navigation chip (goals live in FEED)',
    );
    // Rooms offers an open (no /room create command exists) + a real /room cmd.
    const rooms = getEmptyStateSuggestions('rooms');
    assert.ok(
      rooms.some((s) => s.action.kind === 'open' && s.action.value === 'ROOMS'),
      'rooms offers an open→ROOMS chip (no fabricated /room create)',
    );
    assert.ok(
      rooms.some((s) => s.action.kind === 'seed_command' && s.action.value.startsWith('/room')),
      'rooms offers a real /room command',
    );
    pass('per-surface shape matches the intended mix (create/open/command)');
  }

  console.log(`All empty-state-suggestions smoke cases passed (${passCount} PASS).`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
