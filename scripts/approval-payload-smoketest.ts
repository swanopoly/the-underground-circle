/**
 * approval-payload-smoketest — UC-1b. Verifies the approval-payload
 * renderer produces readable one-liners for every common v2 tool,
 * with sane fallbacks when payload fields are missing.
 *
 * Run: npm run smoke:approval-payload
 */

import { renderApprovalAction } from '../src/lib/approvalPayloadRenderer';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── No payload → fallback title ────────────────────────────────
  {
    const r = renderApprovalAction(null, 'Privileged action requested');
    assert(r.headline === 'Privileged action requested', 'no payload: falls back to title');
    assert(r.detail === undefined, 'no payload: no detail');
  }
  {
    const r = renderApprovalAction({}, 'Title only');
    assert(r.headline === 'Title only', 'empty payload: falls back');
  }
  {
    const r = renderApprovalAction({ random: 'field' } as any, 'Fallback');
    assert(r.headline === 'Fallback', 'no tool: falls back');
  }

  // ─── desktop.click_element with label ───────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.click_element',
      app: 'zoom.us',
      role: 'AXMenuItem',
      label: 'Join meeting',
    }, 'fallback');
    assert(r.headline.includes('Click'), 'click_element: verb "Click"');
    assert(r.headline.includes('**Join meeting**'), 'click_element: label bolded');
    assert(r.detail?.includes('zoom.us'), 'click_element: app in detail');
    assert(r.detail?.toLowerCase().includes('menuitem'), 'click_element: role hint in detail');
  }

  // Long label gets truncated
  {
    const r = renderApprovalAction({
      tool: 'desktop.click_element',
      label: 'a'.repeat(200),
      app: 'X',
    }, 'x');
    assert(r.headline.length < 150, 'click_element: long label capped');
    assert(r.headline.endsWith('…**'), 'click_element: truncation ellipsis inside bold');
  }

  // ─── desktop.type_text → text shown, not path ───────────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.type_text',
      app: 'Terminal',
      text: 'claude',
    }, 'x');
    assert(r.headline.includes('Type into'), 'type_text: "Type into" verb');
    assert(r.headline.includes('"claude"'), 'type_text: text shown');
    assert(r.detail?.includes('Terminal'), 'type_text: app in detail');
  }

  // ─── desktop.set_element_value → named native field ─────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.set_element_value',
      app: 'TextEdit',
      role: 'AXTextField',
      label: 'Email',
      text: 'foo@example.com',
    }, 'x');
    assert(r.headline.includes('Set field in'), 'set_element_value: verb');
    assert(r.headline.includes('**Email**'), 'set_element_value: label shown');
    assert(r.detail?.includes('TextEdit'), 'set_element_value: app in detail');
  }

  // ─── desktop.press_keys → combo shown ───────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.press_keys',
      app: 'Zoom',
      combo: 'Cmd+N',
    }, 'x');
    assert(r.headline.includes('Cmd+N'), 'press_keys: combo shown');
  }

  // ─── desktop.launch_app ─────────────────────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.launch_app',
      app: 'zoom.us',
      label: 'zoom.us',
    }, 'x');
    assert(r.headline.includes('Launch'), 'launch_app: "Launch" verb');
    assert(r.headline.includes('zoom.us'), 'launch_app: target');
  }

  // ─── desktop.click_at (coords fallback) ─────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'desktop.click_at',
      app: 'Safari',
      x: 734,
      y: 412,
    }, 'x');
    assert(r.headline.includes('(734, 412)'), 'click_at: coords shown');
    assert(r.detail?.includes('Safari'), 'click_at: app in detail');
  }

  // ─── browser.open_url — hostname shown ──────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'browser.open_url',
      url: 'https://github.com/anthropics/claude-code',
    }, 'x');
    assert(r.headline.includes('Navigate'), 'open_url: "Navigate to" verb');
    assert(r.headline.includes('github.com'), 'open_url: host shown');
    assert(r.headline.includes('/anthropics/claude-code'), 'open_url: path shown');
    assert(r.detail === undefined, 'open_url: no redundant "on host" detail');
  }

  {
    const r = renderApprovalAction({
      tool: 'browser.open_url',
      url: 'https://example.com/?q=1&x=2',
    }, 'x');
    assert(r.detail?.includes('query params'), 'open_url: query params flagged');
  }

  // ─── browser.click_role — adds "on host" detail ─────────────────
  {
    const r = renderApprovalAction({
      tool: 'browser.click_role',
      role: 'button',
      label: 'Merge pull request',
      url: 'https://github.com/owner/repo/pull/5',
    }, 'x');
    assert(r.headline.includes('**Merge pull request**'), 'click_role: label bolded');
    assert(r.detail?.includes('on github.com'), 'click_role: host in detail');
  }

  // ─── browser.fill_field — text clipped ──────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'browser.fill_field',
      role: 'textbox',
      label: 'Email',
      text: 'foo@example.com',
    }, 'x');
    assert(r.headline.startsWith('Fill'), 'fill_field: "Fill" verb');
    assert(r.headline.includes('Email'), 'fill_field: field name shown');
    // Text isn't the priority here — label wins. That matches UX
    // expectations: "Fill Email" is more informative than "Fill foo@...".
  }

  // ─── Malformed URL doesn't crash ────────────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'browser.open_url',
      url: 'not a url',
    }, 'x');
    assert(r.headline.includes('not a url'), 'open_url: bad URL handled gracefully');
    assert(!r.headline.includes('undefined'), 'open_url: no undefined leaked');
  }

  // ─── Unknown tool → verb from identifier ────────────────────────
  {
    const r = renderApprovalAction({
      tool: 'future.do_thing',
      app: 'X',
      label: 'Target',
    }, 'x');
    assert(r.headline.toLowerCase().includes('future'), 'unknown tool: id-derived verb');
    assert(r.headline.includes('**Target**'), 'unknown tool: label still bolded');
  }

  if (failures > 0) {
    console.error(`\n${failures} approval-payload smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll approval-payload smoke cases passed.');
}

main();
