/**
 * a11y-tree-smoketest — exercises the pure helpers that sit around the
 * Swift bridge: tree rendering + dispatcher transformation. Offline —
 * no bridge, no Swift. The real helper + endpoint are exercised
 * manually via `/desktop diag open zoom` once AX permission is
 * granted.
 *
 * Run: npm run smoke:a11y-tree
 */

type A11yNode = {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bbox?: [number, number, number, number];
  children?: A11yNode[];
};

function renderA11yTree(node: A11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  const parts = [`${indent}[${node.id}]`, node.role];
  if (node.label) parts.push(`"${node.label.replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.label) parts.push(`= "${node.value.replace(/"/g, '\\"').slice(0, 80)}"`);
  out.push(parts.join(' '));
  for (const child of node.children || []) {
    renderA11yTree(child, depth + 1, out);
  }
  return out;
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

  if (failures > 0) {
    console.error(`\n${failures} a11y-tree smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll a11y-tree smoke cases passed.');
}

main();
