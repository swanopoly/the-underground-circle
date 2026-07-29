#!/usr/bin/env node
/**
 * auto-test-cycle — scheduled health check for the whole system.
 *
 * WHY THIS EXISTS
 * The gate answers "does everything pass right now". It does not answer the
 * question that actually matters between sessions: **what changed since last
 * time.** A suite that has failed for months reads identically to one that
 * broke an hour ago, and that is precisely how this repo ended up with 127
 * unchained suites and a `smoke:all` chain silently halting at suite 148.
 *
 * So this stores a baseline and reports DELTAS:
 *   - newly failing suites            → a real regression, exit non-zero
 *   - newly passing suites            → someone fixed something, worth knowing
 *   - production invariants that flipped PASS→WARN/FAIL
 *   - typecheck error-count movement, attributed per file
 *
 * A suite that was already failing is reported as "known" and does NOT fail the
 * cycle — otherwise a single long-standing failure makes the alarm useless and
 * everyone learns to ignore it.
 *
 * Usage:
 *   node scripts/auto-test-cycle.mjs                 # full cycle
 *   node scripts/auto-test-cycle.mjs --no-prod       # skip live DB checks
 *   node scripts/auto-test-cycle.mjs --update-baseline
 *
 * Exit: 0 = no regression, 1 = regression, 2 = harness error.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = join(ROOT, 'ops-records', 'auto-test');
const BASELINE = join(REPORT_DIR, 'baseline.json');

const argv = process.argv.slice(2);
const skipProd = argv.includes('--no-prod');
const updateBaseline = argv.includes('--update-baseline');

const stamp = new Date().toISOString();
const log = (...a) => console.log(...a);

async function sh(cmd, args, opts = {}) {
  try {
    const { stdout } = await run(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 1_800_000 });
    return { ok: true, stdout };
  } catch (e) {
    // Non-zero exit is expected (a failing gate); keep the output either way.
    return { ok: false, stdout: (e?.stdout ?? '') + (e?.stderr ?? ''), error: e?.message };
  }
}

/** tsc emits `path(line,col): error TSxxxx: msg` — count per file. */
function typecheckByFile(out) {
  const byFile = {};
  for (const m of out.matchAll(/^(.+?)\(\d+,\d+\):\s+error TS/gm)) {
    const f = m[1].trim();
    byFile[f] = (byFile[f] ?? 0) + 1;
  }
  return byFile;
}

async function collect() {
  const result = { stamp, typecheck: null, suites: null, invariants: null };

  log('· typecheck…');
  const tc = await sh('npm', ['run', 'typecheck']);
  const byFile = typecheckByFile(tc.stdout);
  result.typecheck = {
    total: Object.values(byFile).reduce((a, b) => a + b, 0),
    byFile,
  };
  log(`  ${result.typecheck.total} errors across ${Object.keys(byFile).length} files`);

  log('· smoke suites…');
  const jsonPath = join(REPORT_DIR, 'last-smoke.json');
  await sh('node', ['scripts/run-smokes.mjs', '--timeout', '180s', '--json', jsonPath]);
  try {
    const d = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const list = d.suites ?? d.results ?? [];
    const failing = list
      .filter((s) => !['pass', 'passed', 'ok'].includes(String(s.status ?? '').toLowerCase()))
      .map((s) => s.name)
      .sort();
    result.suites = { total: list.length, failing };
    log(`  ${list.length} suites, ${failing.length} failing`);
  } catch (e) {
    result.suites = { total: 0, failing: [], error: String(e?.message ?? e) };
    log('  ! could not read smoke report');
  }

  if (!skipProd) {
    log('· production invariants…');
    const invPath = join(REPORT_DIR, 'last-invariants.json');
    await sh('node', ['scripts/memory-prod-invariants.mjs', '--json', invPath]);
    try {
      const d = JSON.parse(readFileSync(invPath, 'utf8'));
      result.invariants = Object.fromEntries((d.results ?? []).map((r) => [r.name, r.level]));
      const bad = Object.values(result.invariants).filter((l) => l !== 'PASS').length;
      log(`  ${Object.keys(result.invariants).length} invariants, ${bad} not-PASS`);
    } catch (e) {
      result.invariants = { __error: String(e?.message ?? e) };
      log('  ! could not read invariant report');
    }
  }
  return result;
}

/**
 * Re-run newly-failing suites ONE AT A TIME before calling them regressions.
 *
 * The concurrent runner spawns many `npx tsx` processes, and under load tsx's
 * module loader can return `undefined` from its `load` hook
 * (ERR_INVALID_RETURN_PROPERTY_VALUE) — the suite "fails" without its code ever
 * running. The very first scheduled cycle hit exactly this and reported
 * `smoke:tool-result-formatters` as a regression; it passed 3/3 in isolation.
 *
 * A detector that cries wolf gets ignored, which is the same outcome as having
 * no detector. So a newly-failing suite is only a regression if it fails again
 * on a serial re-run; otherwise it is recorded as flaky — visible, but it does
 * not trip the alarm.
 */
async function confirmFailures(names) {
  const confirmed = [];
  const flaky = [];
  for (const name of names) {
    const r = await sh('npm', ['run', name], { timeout: 300_000 });
    (r.ok ? flaky : confirmed).push(name);
  }
  return { confirmed, flaky };
}

function diff(base, now) {
  const out = { regressions: [], improvements: [], known: [] };
  if (!base) return out;

  const wasFailing = new Set(base.suites?.failing ?? []);
  const isFailing = new Set(now.suites?.failing ?? []);
  for (const s of isFailing) (wasFailing.has(s) ? out.known : out.regressions).push(`suite newly failing: ${s}`);
  for (const s of wasFailing) if (!isFailing.has(s)) out.improvements.push(`suite now passing: ${s}`);

  // Typecheck: attribute movement per file so another session's churn in their
  // own files is never reported as this work regressing.
  const bf = base.typecheck?.byFile ?? {};
  const nf = now.typecheck?.byFile ?? {};
  for (const [f, n] of Object.entries(nf)) {
    const was = bf[f] ?? 0;
    if (n > was) out.regressions.push(`typecheck: ${f} ${was} → ${n} errors`);
  }
  for (const [f, was] of Object.entries(bf)) {
    const n = nf[f] ?? 0;
    if (n < was) out.improvements.push(`typecheck: ${f} ${was} → ${n} errors`);
  }

  const bi = base.invariants ?? {};
  const ni = now.invariants ?? {};
  const rank = { PASS: 0, WARN: 1, FAIL: 2 };
  for (const [name, level] of Object.entries(ni)) {
    const was = bi[name];
    if (was && (rank[level] ?? 0) > (rank[was] ?? 0)) out.regressions.push(`invariant ${was}→${level}: ${name}`);
    if (was && (rank[level] ?? 0) < (rank[was] ?? 0)) out.improvements.push(`invariant ${was}→${level}: ${name}`);
  }
  return out;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  log(`auto-test-cycle  ${stamp}\n`);

  const now = await collect();
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const d = diff(base, now);

  // Confirm-before-alarm (see confirmFailures).
  const newlyFailing = d.regressions
    .filter((r) => r.startsWith('suite newly failing: '))
    .map((r) => r.replace('suite newly failing: ', ''));
  if (newlyFailing.length) {
    log(`\n· re-verifying ${newlyFailing.length} newly-failing suite(s) serially…`);
    const { confirmed, flaky } = await confirmFailures(newlyFailing);
    d.flaky = flaky;
    for (const f of flaky) log(`  ~ flaky (passed on re-run): ${f}`);
    // Drop unconfirmed ones from the regression list, and from the recorded
    // failing set so the baseline does not memorialise a flake as "known".
    d.regressions = d.regressions.filter(
      (r) => !r.startsWith('suite newly failing: ') || confirmed.includes(r.replace('suite newly failing: ', '')),
    );
    if (now.suites?.failing) {
      now.suites.failing = now.suites.failing.filter((n) => !flaky.includes(n));
    }
  }

  writeFileSync(join(REPORT_DIR, 'latest.json'), JSON.stringify({ ...now, diff: d }, null, 2));

  log('\n─── delta vs baseline ───');
  if (!base) {
    log('  no baseline yet — writing one. Next run reports deltas.');
  } else {
    for (const r of d.regressions) log(`  ✗ REGRESSION  ${r}`);
    for (const i of d.improvements) log(`  ✓ improved    ${i}`);
    if (d.known.length) log(`  · ${d.known.length} known failure(s) carried over (not a regression)`);
    if (!d.regressions.length && !d.improvements.length) log('  no change');
  }

  if (!base || updateBaseline || d.regressions.length === 0) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2));
    log(`\nbaseline updated → ${BASELINE.replace(ROOT + '/', '')}`);
  } else {
    log('\nbaseline NOT updated (regressions present) — fix, or re-run with --update-baseline to accept.');
  }

  process.exit(d.regressions.length ? 1 : 0);
}

main().catch((e) => { console.error('harness error:', e?.message ?? e); process.exit(2); });
