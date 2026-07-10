/**
 * computer-task-autostart-smoketest — WI-1 zero-tap browser auto-start.
 *
 * Verifies the pure `decideBrowserAutoStart` decision that ChatTab reads at
 * the `browser_runtime` branch of `executeSharedComputerTask` to skip (or
 * keep) the permission dialog.
 *
 * Invariants under test:
 *   1. Hotel/browser route + empty floor + no constraint → autoStart true.
 *   2. Desktop route → autoStart false (keep dialog).
 *   3. Browser route with a pay floor stamped → autoStart TRUE (the floor is
 *      a MID-RUN gate at the pay step, NOT the start tap — documented below).
 *   4. WordPress / website-admin credentialed route → autoStart false.
 *   5. User "ask me before" (approvalBefore) constraint → autoStart false.
 *   6. Fail-closed extras: agent_runtime entrypoint, forbidden category, and
 *      stop-condition all keep the dialog; local_file / hybrid keep it.
 *
 * Run: npx tsx scripts/computer-task-autostart-smoketest.ts
 */

import assert from 'node:assert/strict';
import type {
  ChatComputerConstraintCategory,
  ChatComputerUserConstraints,
} from '../src/lib/chatComputerRequestRouter';
import {
  decideBrowserAutoStart,
  type BrowserAutoStartInput,
} from '../src/lib/computerTaskAutoStart';

function constraints(
  partial: Partial<ChatComputerUserConstraints>,
): ChatComputerUserConstraints {
  return {
    forbidden: [],
    approvalBefore: [],
    stopConditions: [],
    sourcePhrases: [],
    ...partial,
  };
}

// ── 1. Hotel/browser route + empty floor + no constraint → auto-start. ─────
{
  const input: BrowserAutoStartInput = {
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: [],
    userConstraints: null,
    websitePlatformAdmin: false,
  };
  const d = decideBrowserAutoStart(input);
  assert.equal(d.autoStart, true, '1: clean browser run should auto-start');
  assert.match(d.reason, /^auto_start:browser_runtime$/, `1: reason ${d.reason}`);
}

// ── 2. Desktop route → keep the dialog. ────────────────────────────────────
{
  const d = decideBrowserAutoStart({
    routeKind: 'desktop_app',
    entrypoint: 'agent_runtime',
    alwaysConfirmFloor: [],
    userConstraints: null,
  });
  assert.equal(d.autoStart, false, '2: desktop route must keep dialog');
  assert.match(d.reason, /route_kind_desktop_app/, `2: reason ${d.reason}`);
}

// ── 3. Browser route WITH a pay floor stamped → STILL auto-starts. ─────────
// DOC: auto-start decides ONLY the START tap. A "buy X" / "book" phrasing may
// stamp the always-confirm floor, but that floor is enforced MID-RUN at the
// payment submission by the edge loop (WI-3/WI-7), not at launch. Auto-start
// being true here does NOT weaken the pay floor.
{
  const floor: ChatComputerConstraintCategory[] = ['pay'];
  const d = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: floor,
    userConstraints: null,
    websitePlatformAdmin: false,
  });
  assert.equal(d.autoStart, true, '3: pay floor does not block the START tap');
  assert.match(d.reason, /floor_deferred_pay/, `3: reason ${d.reason}`);
}

// ── 4. WordPress / website-admin credentialed route → keep the dialog. ─────
{
  const d = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: [],
    userConstraints: null,
    websitePlatformAdmin: true,
  });
  assert.equal(d.autoStart, false, '4: website-admin credentialed route keeps dialog');
  assert.match(d.reason, /website_platform_admin/, `4: reason ${d.reason}`);
}

// ── 5. User "ask me before" (approvalBefore) constraint → keep the dialog. ─
{
  const d = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: [],
    userConstraints: constraints({
      approvalBefore: ['submit'],
      sourcePhrases: ['ask me first before submitting'],
    }),
    websitePlatformAdmin: false,
  });
  assert.equal(d.autoStart, false, '5: approvalBefore constraint keeps dialog');
  assert.match(d.reason, /user_approval_before_submit/, `5: reason ${d.reason}`);
}

// ── 6. Fail-closed extras. ─────────────────────────────────────────────────
{
  // 6a. Browser route but agent_runtime entrypoint → keep dialog.
  const a = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'agent_runtime',
    alwaysConfirmFloor: [],
    userConstraints: null,
  });
  assert.equal(a.autoStart, false, '6a: agent_runtime entrypoint keeps dialog');
  assert.match(a.reason, /entrypoint_agent_runtime/, `6a: reason ${a.reason}`);

  // 6b. Forbidden category → keep dialog.
  const b = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: [],
    userConstraints: constraints({ forbidden: ['delete'] }),
  });
  assert.equal(b.autoStart, false, '6b: forbidden category keeps dialog');
  assert.match(b.reason, /user_forbidden_delete/, `6b: reason ${b.reason}`);

  // 6c. Stop-condition → keep dialog.
  const c = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
    alwaysConfirmFloor: [],
    userConstraints: constraints({ stopConditions: ['stop if it needs my password'] }),
  });
  assert.equal(c.autoStart, false, '6c: stop-condition keeps dialog');
  assert.match(c.reason, /user_stop_condition/, `6c: reason ${c.reason}`);

  // 6d. local_file and hybrid routes keep the dialog.
  for (const kind of ['local_file', 'hybrid', 'agent_buildout'] as const) {
    const d = decideBrowserAutoStart({
      routeKind: kind,
      entrypoint: 'agent_runtime',
      alwaysConfirmFloor: [],
      userConstraints: null,
    });
    assert.equal(d.autoStart, false, `6d: ${kind} keeps dialog`);
  }

  // 6e. Undefined floor + undefined constraints on a clean browser run → auto-start.
  const e = decideBrowserAutoStart({
    routeKind: 'browser',
    entrypoint: 'browser_runtime',
  });
  assert.equal(e.autoStart, true, '6e: omitted floor/constraints still auto-starts');
}

console.log('computer-task-autostart-smoketest: all assertions passed');
