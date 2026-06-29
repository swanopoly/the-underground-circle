/**
 * a11y-tree-smoketest — exercises the pure helpers that sit around the
 * Swift bridge: tree rendering + dispatcher transformation. Offline —
 * no bridge, no Swift. The real helper + endpoint are exercised
 * manually via `/desktop diag open zoom` once AX permission is
 * granted.
 *
 * Run: npm run smoke:a11y-tree
 */

import * as fs from 'node:fs';

type A11yNode = {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bbox?: [number, number, number, number];
  index?: number;
  children?: A11yNode[];
};

// Mirror of src/lib/desktopBridge.ts renderA11yTree (incl. the E2 [#N]
// SoM index prefix for bridge-numbered reads).
function renderA11yTree(node: A11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  const parts = typeof node.index === 'number' && node.index > 0
    ? [`${indent}[#${node.index}]`, `[${node.id}]`, node.role]
    : [`${indent}[${node.id}]`, node.role];
  if (node.label) parts.push(`"${node.label.replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.label) parts.push(`= "${node.value.replace(/"/g, '\\"').slice(0, 80)}"`);
  out.push(parts.join(' '));
  for (const child of node.children || []) {
    renderA11yTree(child, depth + 1, out);
  }
  return out;
}

// E2/E3 — extract the REAL pure functions from scripts/claude-bridge.js
// (delimited by UC_SMOKE_EXTRACT markers; they are self-contained by
// contract) so these smokes execute the shipped implementation instead
// of a drift-prone mirror.
function extractBridgeFunction<T>(name: string): T {
  const source = fs.readFileSync('scripts/claude-bridge.js', 'utf8');
  const startMarker = `/* UC_SMOKE_EXTRACT_START ${name} */`;
  const endMarker = `/* UC_SMOKE_EXTRACT_END ${name} */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error(`UC_SMOKE_EXTRACT markers for ${name} not found in scripts/claude-bridge.js`);
  const fnSource = source.slice(start + startMarker.length, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSource}; return ${name};`)() as T;
}

// Shape of what the client dispatcher returns after flattening a tree
// + truncating. Mirror of src/lib/swanbot.ts desktop.read_a11y_tree.
function dispatchReadA11yTree(fakeBridgeResult: { ok: boolean; data?: any; error?: string }) {
  if (!fakeBridgeResult.ok || !fakeBridgeResult.data) return fakeBridgeResult;
  const d = fakeBridgeResult.data;
  const rendered = renderA11yTree(d.tree).join('\n');
  return {
    ok: true,
    data: {
      app: d.app,
      pid: d.pid,
      nodeCount: d.budget_used,
      text: rendered.slice(0, 8192),
      truncated: rendered.length > 8192,
    },
  };
}

// Click-path validation mirror (dispatcher enforces dotted-int shape).
function validateClickPath(path: string): boolean {
  return /^[0-9]+(\.[0-9]+)*$/.test(path);
}

// ─── Test runner ────────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Tree rendering ─────────────────────────────────────────────
  {
    const tree: A11yNode = {
      id: '0',
      role: 'AXApplication',
      label: 'Safari',
      children: [
        {
          id: '0.0',
          role: 'AXWindow',
          label: 'Apple',
          children: [
            { id: '0.0.0', role: 'AXButton', label: 'Back' },
            { id: '0.0.1', role: 'AXTextField', label: 'Search', value: 'apple' },
            { id: '0.0.2', role: 'AXButton', label: 'Tabs' },
          ],
        },
      ],
    };
    const lines = renderA11yTree(tree);
    assert(lines.length === 5, 'render: 5 lines (root + window + 3 buttons)', `got ${lines.length}`);
    assert(lines[0] === '[0] AXApplication "Safari"', 'render: root line shape');
    assert(lines[1] === '  [0.0] AXWindow "Apple"', 'render: depth-1 indent');
    assert(lines[2] === '    [0.0.0] AXButton "Back"', 'render: depth-2 indent');
    assert(lines[3].includes('= "apple"'), 'render: value rendered when different from label');
    assert(!lines[2].includes('= '), 'render: no value shown when only label set');
  }

  // Label truncation
  {
    const longLabel = 'A'.repeat(500);
    const tree: A11yNode = { id: '0', role: 'AXButton', label: longLabel };
    const line = renderA11yTree(tree)[0];
    // Label capped at 120 chars inside quotes → line length ~ 130
    assert(line.length < 200, 'render: long label capped', `got ${line.length}`);
  }

  // Quote escaping
  {
    const tree: A11yNode = { id: '0', role: 'AXButton', label: 'He said "hi"' };
    const line = renderA11yTree(tree)[0];
    assert(line.includes('\\"hi\\"'), 'render: quotes escaped in label');
  }

  // ─── Dispatcher transform ───────────────────────────────────────
  {
    const fakeBridgeOk = {
      ok: true,
      data: {
        app: 'zoom.us',
        pid: 1234,
        budget_used: 3,
        tree: {
          id: '0',
          role: 'AXApplication',
          label: 'zoom.us',
          children: [
            { id: '0.0', role: 'AXWindow', label: 'Main', children: [
              { id: '0.0.0', role: 'AXButton', label: 'Start' },
            ]},
          ],
        } as A11yNode,
      },
    };
    const result = dispatchReadA11yTree(fakeBridgeOk);
    assert(result.ok, 'dispatch: happy path ok');
    assert((result as any).data.app === 'zoom.us', 'dispatch: app passthrough');
    assert((result as any).data.pid === 1234, 'dispatch: pid passthrough');
    assert((result as any).data.nodeCount === 3, 'dispatch: nodeCount from budget_used');
    assert((result as any).data.text.split('\n').length === 3, 'dispatch: rendered 3 lines');
    assert((result as any).data.truncated === false, 'dispatch: small tree not truncated');
  }

  // Huge tree — rendered text trimmed to 8KB
  {
    const kids: A11yNode[] = [];
    for (let i = 0; i < 500; i++) {
      kids.push({ id: `0.0.${i}`, role: 'AXButton', label: `Button number ${i} with a medium-length label` });
    }
    const fakeBridgeOk = {
      ok: true,
      data: {
        app: 'HugeApp',
        pid: 99,
        budget_used: 500,
        tree: { id: '0', role: 'AXApplication', children: [{ id: '0.0', role: 'AXList', children: kids }] } as A11yNode,
      },
    };
    const result = dispatchReadA11yTree(fakeBridgeOk);
    assert((result as any).data.text.length === 8192, 'dispatch: text capped at 8KB');
    assert((result as any).data.truncated === true, 'dispatch: truncated flag set');
  }

  // Error passthrough
  {
    const fakeBridgeErr = { ok: false, error: 'Accessibility permission not granted.' };
    const result = dispatchReadA11yTree(fakeBridgeErr);
    assert(!result.ok, 'dispatch: error path preserved');
    assert(result.error === 'Accessibility permission not granted.', 'dispatch: error message passthrough');
  }

  // ─── Empty-tree retry ladder ────────────────────────────────────
  //
  // Mirror of src/lib/desktopBridge.ts readA11yTree: an effectively
  // empty payload (no tree, or a bare root with no children and no
  // label/value) is retried ONCE after a short backoff; a second
  // empty read returns a structured `a11y_tree_empty` error whose
  // hint points at the existing screenshot + coordinate fallback.
  {
    const isEmptyA11yTreePayload = (payload: any): boolean => {
      const tree = payload?.tree;
      if (!tree) return true;
      const hasChildren = Array.isArray(tree.children) && tree.children.length > 0;
      const hasContent = !!(tree.label || tree.value);
      return !hasChildren && !hasContent;
    };

    assert(isEmptyA11yTreePayload(null), 'empty-tree: null payload is empty');
    assert(isEmptyA11yTreePayload({}), 'empty-tree: missing tree is empty');
    assert(isEmptyA11yTreePayload({ tree: { id: '0', role: 'AXApplication' } }), 'empty-tree: bare unlabeled root is empty');
    assert(!isEmptyA11yTreePayload({ tree: { id: '0', role: 'AXApplication', label: 'Notes' } }), 'empty-tree: labeled root is not empty');
    assert(!isEmptyA11yTreePayload({ tree: { id: '0', role: 'AXApplication', children: [{ id: '0.0', role: 'AXWindow' }] } }), 'empty-tree: root with children is not empty');

    // Bounded retry simulation: payload sequence per attempt.
    const readWithRetry = (payloads: any[]) => {
      let attempts = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        attempts += 1;
        const payload = payloads[attempt];
        if (!isEmptyA11yTreePayload(payload)) return { ok: true as const, attempts, data: payload };
      }
      return {
        ok: false as const,
        attempts,
        errorCode: 'a11y_tree_empty',
        recoveryHint: 'The a11y path returned nothing for this app. Use the screenshot + coordinate path as the fallback: take a desktop screenshot, locate the target visually, then click at its coordinates.',
      };
    };

    const good = { tree: { id: '0', role: 'AXApplication', label: 'Notes', children: [{ id: '0.0', role: 'AXWindow' }] } };
    const transient = readWithRetry([{}, good]);
    assert(transient.ok === true, 'retry: empty-then-populated succeeds');
    assert(transient.attempts === 2, 'retry: exactly one retry consumed', `got ${transient.attempts}`);

    const firstTry = readWithRetry([good, {}]);
    assert(firstTry.ok === true && firstTry.attempts === 1, 'retry: populated first read does not retry');

    const exhausted = readWithRetry([{}, {}]);
    assert(exhausted.ok === false, 'retry: still-empty fails closed');
    assert(exhausted.attempts === 2, 'retry: bounded to exactly 2 attempts');
    assert((exhausted as any).errorCode === 'a11y_tree_empty', 'retry: structured a11y_tree_empty code');
    assert(/screenshot \+ coordinate/.test((exhausted as any).recoveryHint || ''), 'retry: hint names the screenshot+coordinate fallback');
  }

  // ─── PID-staleness guard ────────────────────────────────────────
  //
  // Mirror of the claude-bridge.js click_element/set_element_value
  // guard: when the caller passes the app name from the tree read,
  // the bridge resolves the app's CURRENT pid; mismatch refuses with
  // `a11y_path_stale`. Lookup failure fails OPEN (never blocks a
  // working click on a name-resolution hiccup).
  {
    const decideStaleness = (args: { expectApp?: string; treePid: number; currentPid: number | null }) => {
      if (!args.expectApp || !args.expectApp.trim()) return { action: 'proceed' as const };
      if (args.currentPid === null) return { action: 'proceed' as const }; // fail-open lookup
      if (args.currentPid !== args.treePid) {
        return {
          action: 'refuse' as const,
          errorCode: 'a11y_path_stale',
          recoveryHint: 'Re-read the accessibility tree for this app, then act using the fresh element paths.',
        };
      }
      return { action: 'proceed' as const };
    };

    assert(decideStaleness({ expectApp: 'Notes', treePid: 500, currentPid: 500 }).action === 'proceed', 'pid guard: matching pid proceeds');
    const stale = decideStaleness({ expectApp: 'Notes', treePid: 500, currentPid: 612 });
    assert(stale.action === 'refuse', 'pid guard: pid mismatch refuses to click');
    assert((stale as any).errorCode === 'a11y_path_stale', 'pid guard: structured a11y_path_stale code');
    assert(/re-read the accessibility tree/i.test((stale as any).recoveryHint || ''), 'pid guard: hint says to re-read the tree');
    assert(decideStaleness({ treePid: 500, currentPid: 612 }).action === 'proceed', 'pid guard: no expectApp keeps old behavior');
    assert(decideStaleness({ expectApp: 'Notes', treePid: 500, currentPid: null }).action === 'proceed', 'pid guard: lookup failure fails open');
  }

  // ─── A11y observation cache ─────────────────────────────────────
  //
  // Mirror of noteA11yTreeObservation in computerAppAdapter.ts: cache
  // {pid, hash, at} per app (≤5 apps), and when a re-read within 10s
  // hashes identical, annotate "[unchanged since last observation Xs
  // ago]". The read still happens — this only stops the model from
  // re-describing an identical tree.
  {
    const WINDOW_MS = 10_000;
    const MAX_APPS = 5;
    const cache = new Map<string, { pid: number; hash: string; at: number }>();

    const hashTree = (serialized: string): string => {
      let hash = 5381;
      for (let i = 0; i < serialized.length; i += 1) {
        hash = ((hash << 5) + hash) ^ serialized.charCodeAt(i);
      }
      return (hash >>> 0).toString(36);
    };

    const note = (app: string, pid: number, serializedTree: string, now: number) => {
      const key = app.trim().toLowerCase();
      if (!key) return { unchanged: false, note: null as string | null };
      const hash = hashTree(serializedTree);
      const prev = cache.get(key) || null;
      cache.set(key, { pid, hash, at: now });
      if (cache.size > MAX_APPS) {
        let oldestKey: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        for (const [k, v] of cache) { if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; } }
        if (oldestKey && oldestKey !== key) cache.delete(oldestKey);
      }
      if (!prev) return { unchanged: false, note: null as string | null };
      const ageMs = now - prev.at;
      if (prev.pid !== pid) return { unchanged: false, note: null as string | null };
      if (ageMs < 0 || ageMs > WINDOW_MS) return { unchanged: false, note: null as string | null };
      if (prev.hash !== hash) return { unchanged: false, note: null as string | null };
      const seconds = Math.max(1, Math.round(ageMs / 1000));
      return { unchanged: true, note: `[unchanged since last observation ${seconds}s ago]` };
    };

    const t0 = 1_000_000;
    const treeA = JSON.stringify({ id: '0', role: 'AXApplication', label: 'Notes' });
    const treeB = JSON.stringify({ id: '0', role: 'AXApplication', label: 'Notes', children: [{ id: '0.0', role: 'AXButton', label: 'New' }] });

    assert(hashTree(treeA) === hashTree(treeA), 'cache hash: deterministic');
    assert(hashTree(treeA) !== hashTree(treeB), 'cache hash: differs on changed tree');

    assert(note('Notes', 500, treeA, t0).unchanged === false, 'cache: first observation has no note');
    const hit = note('Notes', 500, treeA, t0 + 2000);
    assert(hit.unchanged === true, 'cache: identical re-read within window is unchanged');
    assert(hit.note === '[unchanged since last observation 2s ago]', 'cache: note shape with age', String(hit.note));
    assert(note('Notes', 500, treeB, t0 + 4000).unchanged === false, 'cache: changed tree is a miss');
    // treeB is now cached; window expiry:
    assert(note('Notes', 500, treeB, t0 + 4000 + WINDOW_MS + 1).unchanged === false, 'cache: identical re-read past window expires');
    // PID restart invalidates:
    note('Notes', 500, treeA, t0 + 20_000);
    assert(note('Notes', 612, treeA, t0 + 21_000).unchanged === false, 'cache: pid change is a miss');

    // Bound: 6th app evicts the oldest entry.
    cache.clear();
    const apps = ['A', 'B', 'C', 'D', 'E'];
    apps.forEach((app, i) => note(app, 100 + i, treeA, t0 + i));
    note('F', 200, treeA, t0 + 100);
    assert(cache.size === 5, 'cache: bounded to 5 apps', `got ${cache.size}`);
    assert(!cache.has('a'), 'cache: oldest app evicted');
    assert(note('B', 101, treeA, t0 + 101).unchanged === true, 'cache: surviving app still hits');
  }

  // ─── Click path validation ───────────────────────────────────────
  assert(validateClickPath('0'), 'click path: root');
  assert(validateClickPath('0.2'), 'click path: one level');
  assert(validateClickPath('0.2.1.3.4'), 'click path: deep');
  assert(!validateClickPath(''), 'click path: empty rejected');
  assert(!validateClickPath('0.2.'), 'click path: trailing dot rejected');
  assert(!validateClickPath('.2.1'), 'click path: leading dot rejected');
  assert(!validateClickPath('0..2'), 'click path: double dot rejected');
  assert(!validateClickPath('0.a.1'), 'click path: non-digit rejected');
  assert(!validateClickPath('0.-1.2'), 'click path: negative rejected');
  assert(!validateClickPath('; rm -rf /'), 'click path: shell metachars rejected');

  // ─── E6: a11y observation text fenced as untrusted ──────────────
  //
  // Source-level check (this smoke stays offline; the runtime module
  // can't load under plain tsx): the openswanToolRuntime a11y case
  // must fence the rendered tree body in <untrusted_quoted> while the
  // header (app/pid/node count) and the hidden-nodes trailer stay
  // outside the fence, and the fence helper must neutralize embedded
  // fence tags so tree labels cannot break out. Behavior is exercised
  // end-to-end in tool-result-formatters-smoketest.
  {
    const fs = require('node:fs') as typeof import('node:fs');
    const runtimeSource = fs.readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
    assert(
      /export function fenceUntrustedObservationText\(/.test(runtimeSource),
      'E6: runtime exports the observation fence helper',
    );
    assert(
      runtimeSource.includes("replace(/<(\\/?)untrusted_quoted>/gi, '[$1untrusted_quoted-tag-removed]')"),
      'E6: fence helper neutralizes embedded fence tags (mcpToolBridge convention)',
    );
    const caseStart = runtimeSource.lastIndexOf("case 'desktop.read_a11y_tree': {");
    const caseEnd = runtimeSource.indexOf("case 'desktop.click_element':", caseStart);
    const a11yCase = caseStart >= 0 && caseEnd > caseStart ? runtimeSource.slice(caseStart, caseEnd) : '';
    assert(
      a11yCase.includes('fenceUntrustedObservationText(') &&
      a11yCase.includes('Accessibility tree for') &&
      a11yCase.includes('${body}${trailer}'),
      'E6: a11y case fences the tree body with header + trailer outside the fence',
    );
  }

  // ─── E2: pruned targeting slices (REAL bridge implementation) ───
  {
    type SliceResult = { tree: A11yNode; totalNodes: number; keptNodes: number; marker: string };
    const sliceA11yTreeForTarget = extractBridgeFunction<(tree: A11yNode, target: string, cap?: number) => SliceResult>('sliceA11yTreeForTarget');

    const flatten = (node: A11yNode, out: A11yNode[] = []): A11yNode[] => {
      out.push(node);
      for (const child of node.children || []) flatten(child, out);
      return out;
    };
    const ids = (result: SliceResult) => new Set(flatten(result.tree).map((node) => node.id));

    const tree: A11yNode = {
      id: '0', role: 'AXApplication', label: 'Notes',
      children: [
        {
          id: '0.0', role: 'AXWindow', label: 'Main',
          children: [
            {
              id: '0.0.0', role: 'AXGroup',
              children: [
                { id: '0.0.0.0', role: 'AXStaticText', label: 'two before' },
                { id: '0.0.0.1', role: 'AXStaticText', label: 'one before' },
                { id: '0.0.0.2', role: 'AXStaticText', label: 'Save your work' },
                { id: '0.0.0.3', role: 'AXStaticText', label: 'one after' },
                { id: '0.0.0.4', role: 'AXStaticText', label: 'two after' },
                { id: '0.0.0.5', role: 'AXStaticText', label: 'three after — beyond the sibling window' },
              ],
            },
            { id: '0.0.1', role: 'AXButton', label: 'OK' },
            { id: '0.0.2', role: 'AXStaticText', label: 'decorative paragraph' },
          ],
        },
      ],
    };

    const sliced = sliceA11yTreeForTarget(tree, 'Save');
    const kept = ids(sliced);
    assert(kept.has('0.0.0.2'), 'slice: target label match kept');
    assert(kept.has('0.0.0') && kept.has('0.0') && kept.has('0'), 'slice: ancestor chain of the match kept');
    assert(kept.has('0.0.0.0') && kept.has('0.0.0.1') && kept.has('0.0.0.3') && kept.has('0.0.0.4'), 'slice: ±2 siblings around the match kept');
    assert(!kept.has('0.0.0.5'), 'slice: sibling beyond ±2 dropped');
    assert(kept.has('0.0.1'), 'slice: actionable-role node (AXButton) kept without a label match');
    assert(!kept.has('0.0.2'), 'slice: unmatched non-interactive static text dropped');
    // 11 = app + window + group + 6 static texts + OK button + decorative text
    assert(sliced.totalNodes === 11, 'slice: totalNodes counts the original tree', `got ${sliced.totalNodes}`);
    assert(sliced.keptNodes === kept.size, 'slice: keptNodes matches the rebuilt tree', `kept ${sliced.keptNodes} vs ${kept.size}`);
    assert(
      sliced.marker === `[slice: ${sliced.keptNodes} of ${sliced.totalNodes} nodes — matching "Save" + interactive elements; request slice:"full" for everything]`,
      'slice: marker shape',
      sliced.marker,
    );

    // Cap: 300 interactive children collapse to ~120 kept nodes.
    const bigTree: A11yNode = {
      id: '0', role: 'AXApplication', label: 'Big',
      children: Array.from({ length: 300 }, (_, i) => ({ id: `0.${i}`, role: 'AXButton', label: `Button ${i}` })),
    };
    const capped = sliceA11yTreeForTarget(bigTree, 'nonexistent-target');
    assert(capped.totalNodes === 301, 'slice cap: total counts everything', `got ${capped.totalNodes}`);
    assert(capped.keptNodes <= 125, 'slice cap: kept nodes bounded near 120', `got ${capped.keptNodes}`);
    assert(capped.keptNodes >= 100, 'slice cap: cap not pathologically tight', `got ${capped.keptNodes}`);
    assert(/^\[slice: \d+ of 301 nodes — matching "nonexistent-target" \+ interactive elements; request slice:"full" for everything\]$/.test(capped.marker), 'slice cap: marker advertises slice:"full" escape hatch');

    // Empty target + interactive slice keeps interactive-only.
    const interactiveOnly = sliceA11yTreeForTarget(tree, '');
    const interactiveIds = ids(interactiveOnly);
    assert(interactiveIds.has('0.0.1') && !interactiveIds.has('0.0.0.2'), 'slice: empty target keeps interactive roles, drops static text');

    // No-target default unchanged — mirror of the endpoint's slice-mode
    // defaulting in scripts/claude-bridge.js /desktop/a11y_tree.
    const sliceModeFor = (sliceParamRaw: string, targetParam: string) =>
      sliceParamRaw === 'full' ? 'full' : sliceParamRaw === 'interactive' ? 'interactive' : (targetParam ? 'interactive' : 'full');
    assert(sliceModeFor('', '') === 'full', 'slice default: no target + no slice param → full (legacy unchanged)');
    assert(sliceModeFor('', 'Save') === 'interactive', 'slice default: target present → interactive');
    assert(sliceModeFor('full', 'Save') === 'full', 'slice default: explicit slice:"full" wins over target');
    assert(sliceModeFor('interactive', '') === 'interactive', 'slice default: explicit interactive without target honored');
  }

  // ─── E2: SoM node indexes + elementIndex resolution (REAL impl) ──
  {
    const assignA11yNodeIndexes = extractBridgeFunction<(tree: A11yNode) => { indexToPath: Record<number, string>; count: number }>('assignA11yNodeIndexes');
    type ResolveResult = { ok: true; path: string } | { ok: false; body: { ok: false; error: string; errorCode: string; recoveryHint: string } };
    const resolveA11yElementIndexFromEntry = extractBridgeFunction<(entry: { generation: number; indexToPath: Record<number, string> } | null, pid: number, elementIndex: number, indexGeneration?: number) => ResolveResult>('resolveA11yElementIndexFromEntry');

    const tree: A11yNode = {
      id: '0', role: 'AXApplication', label: 'Notes',
      children: [
        { id: '0.0', role: 'AXWindow', label: 'Main', children: [
          { id: '0.0.0', role: 'AXButton', label: 'New Note' },
          { id: '0.0.1', role: 'AXTextField', label: 'Search' },
        ]},
      ],
    };
    const indexed = assignA11yNodeIndexes(tree);
    assert(indexed.count === 4, 'index: every node numbered', `got ${indexed.count}`);
    assert(tree.index === 1 && tree.children![0].index === 2 && tree.children![0].children![0].index === 3, 'index: document order 1..N');
    assert(indexed.indexToPath[3] === '0.0.0' && indexed.indexToPath[4] === '0.0.1', 'index: index→path map matches node ids');

    // Round-trip: serialized [#N] line → elementIndex → dotted path → same node.
    const lines = renderA11yTree(tree);
    assert(lines[2].startsWith('    [#3] [0.0.0] AXButton'), 'index: [#N] prefix in serialized output', lines[2]);
    const entry = { app: 'Notes', generation: 7, indexToPath: indexed.indexToPath, at: Date.now() };
    const roundTrip = resolveA11yElementIndexFromEntry(entry, 500, 3, 7);
    assert(roundTrip.ok === true && (roundTrip as any).path === '0.0.0', 'index: round-trip resolves [#3] to its dotted path');
    const noGeneration = resolveA11yElementIndexFromEntry(entry, 500, 4);
    assert(noGeneration.ok === true && (noGeneration as any).path === '0.0.1', 'index: resolution works without a generation hint');

    // Structured failures.
    const neverRead = resolveA11yElementIndexFromEntry(null, 500, 3);
    assert(neverRead.ok === false && (neverRead as any).body.errorCode === 'no_indexed_tree', 'index: no tree ever read → no_indexed_tree');
    assert(/read .*tree first/i.test((neverRead as any).body.error), 'index: no_indexed_tree explains the fix');
    const staleGeneration = resolveA11yElementIndexFromEntry(entry, 500, 3, 5);
    assert(staleGeneration.ok === false && (staleGeneration as any).body.errorCode === 'index_stale', 'index: re-read since issuance → index_stale');
    assert(/re-read/i.test((staleGeneration as any).body.recoveryHint), 'index: index_stale hint says to re-read');
    const unknownIndex = resolveA11yElementIndexFromEntry(entry, 500, 99, 7);
    assert(unknownIndex.ok === false && (unknownIndex as any).body.errorCode === 'index_stale', 'index: index missing from latest map → index_stale');
  }

  // ─── E2: sliced-read observation-cache coherence ─────────────────
  //
  // Decision (documented in computerAppAdapter.ts): the observation
  // cache key includes slice mode + target, so sliced reads with
  // different targets are DIFFERENT observations and never mark each
  // other (or full reads) as "[unchanged]".
  {
    const adapterSource = fs.readFileSync('src/lib/computerAppAdapter.ts', 'utf8');
    assert(
      adapterSource.includes("`${appKey}::${String(args.slice || 'full').toLowerCase()}::${String(args.target || '').trim().toLowerCase()}`"),
      'slice cache: adapter cache key includes slice mode + target',
    );
    assert(
      /target: intent\.targetLabel/.test(adapterSource),
      'slice cache: adapter requests sliced trees with its target string',
    );

    // Behavior mirror of the key construction.
    const cacheKey = (app: string, slice?: string | null, target?: string | null) =>
      `${app.trim().toLowerCase()}::${String(slice || 'full').toLowerCase()}::${String(target || '').trim().toLowerCase()}`;
    assert(cacheKey('Notes') === 'notes::full::', 'slice cache: full read key is the legacy app key shape');
    assert(cacheKey('Notes', 'interactive', 'Save') !== cacheKey('Notes', 'interactive', 'Cancel'), 'slice cache: different targets are different observations');
    assert(cacheKey('Notes', 'interactive', 'Save') !== cacheKey('Notes'), 'slice cache: sliced read never collides with a full read');
    assert(cacheKey('Notes', 'interactive', 'Save') === cacheKey('notes', 'interactive', '  save '), 'slice cache: key normalization stable');
  }

  if (failures > 0) {
    console.error(`\n${failures} a11y-tree smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll a11y-tree smoke cases passed.');
}

main();
