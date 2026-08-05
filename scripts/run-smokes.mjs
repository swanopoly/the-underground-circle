#!/usr/bin/env node
/**
 * run-smokes.mjs — additive smoke-suite runner for The Underground Circle.
 *
 * Why this exists:
 *   `npm run smoke:all` is a single `&&` chain of every `smoke:*` script. The
 *   first failing suite aborts the chain, so every suite after it silently
 *   never runs, and nothing reports that fact. That masking has hidden real
 *   bugs and a large registration hole.
 *
 * What this does instead:
 *   - Discovers suites by parsing package.json `scripts` (never a hardcoded
 *     list — a hardcoded list is how the registration hole grew).
 *   - Runs every suite, bounded-concurrently, never stopping at first failure.
 *   - Enforces a per-suite timeout in Node (macOS has no GNU `timeout`).
 *   - Reports total / passed / failed / timed-out, failing output tails, and
 *     the slowest suites.
 *   - Reports registration drift: `scripts/*-smoketest.*` files with no
 *     `smoke:*` entry, entries pointing at missing files, and entries missing
 *     from the `smoke:all` chain.
 *   - Exits non-zero if ANY suite failed or timed out (same gate strength).
 *
 * This file is plain Node ESM on purpose: it must not depend on tsx, and it
 * lives outside tsconfig so it needs no typecheck.
 *
 * `smoke:all` semantics are NOT changed by this file.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const SELF_BASENAME = path.basename(SELF_PATH);

const SUITE_FILE_RE = /-smoketest\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const SCRIPT_PATH_RE = /scripts\/[A-Za-z0-9._@/-]+/g;

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TAIL_LINES = 20;
const DEFAULT_SLOWEST = 10;
/** Hard cap on retained output per suite. Older bytes are dropped, not stored. */
const MAX_CAPTURE_BYTES = 64 * 1024;
/** Hard cap on a single printed line in the failure report. */
const MAX_LINE_CHARS = 500;
/** Grace period between SIGTERM and SIGKILL when a suite is killed. */
const KILL_GRACE_MS = 3_000;

const EXIT_OK = 0;
const EXIT_SUITE_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_DRIFT = 3;
const EXIT_INTERRUPTED = 130;

const USAGE = `
run-smokes.mjs — run every smoke suite, report the whole picture.

  node scripts/run-smokes.mjs [options]

Options:
  --filter <substring>   Only suites whose name or file contains <substring>
                         (case-insensitive). Repeatable; matches are OR'ed.
  --list                 List the selected suites (plus drift) and exit 0.
  --concurrency <n>      Parallel suites. Default: min(4, cpus-1) = ${defaultConcurrency()}.
  --timeout <ms|30s|2m>  Per-suite timeout. Default: ${DEFAULT_TIMEOUT_MS}ms.
  --tail <n>             Output lines shown per failing suite. Default: ${DEFAULT_TAIL_LINES}.
  --slowest <n>          Slowest suites listed. Default: ${DEFAULT_SLOWEST}.
  --json <path>          Also write a machine-readable report to <path>.
  --fail-on-drift        Treat registration drift as a failure (exit ${EXIT_DRIFT}).
  --no-drift             Skip the registration-drift scan.
  -h, --help             This message.

Env: SMOKE_CONCURRENCY, SMOKE_TIMEOUT_MS (flags win).

Exit codes: ${EXIT_OK} clean · ${EXIT_SUITE_FAILURE} suite failed/timed out · ${EXIT_USAGE} bad usage · ${EXIT_DRIFT} drift (with --fail-on-drift)
`.trimStart();

function defaultConcurrency() {
  let cpus = 1;
  try {
    cpus = os.availableParallelism?.() ?? os.cpus().length ?? 1;
  } catch {
    cpus = 1;
  }
  return Math.max(1, Math.min(4, cpus - 1));
}

function fail(message) {
  process.stderr.write(`run-smokes: ${message}\n`);
  process.exit(EXIT_USAGE);
}

function parsePositiveInt(raw, flag) {
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) fail(`${flag} expects a positive integer, got "${raw}"`);
  return n;
}

/** Accepts `90000`, `90s`, `2m`. */
function parseDuration(raw, flag) {
  const text = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(text);
  if (!match) fail(`${flag} expects a duration like 90000, 90s or 2m, got "${raw}"`);
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const ms = unit === 'm' ? value * 60_000 : unit === 's' ? value * 1_000 : value;
  if (!Number.isFinite(ms) || ms <= 0) fail(`${flag} expects a positive duration, got "${raw}"`);
  return Math.round(ms);
}

function parseArgv(argv) {
  const options = {
    filters: [],
    list: false,
    concurrency: process.env.SMOKE_CONCURRENCY
      ? parsePositiveInt(process.env.SMOKE_CONCURRENCY, 'SMOKE_CONCURRENCY')
      : defaultConcurrency(),
    timeoutMs: process.env.SMOKE_TIMEOUT_MS
      ? parseDuration(process.env.SMOKE_TIMEOUT_MS, 'SMOKE_TIMEOUT_MS')
      : DEFAULT_TIMEOUT_MS,
    tail: DEFAULT_TAIL_LINES,
    slowest: DEFAULT_SLOWEST,
    jsonPath: null,
    failOnDrift: false,
    drift: true,
  };

  const needsValue = (flag, value) => {
    if (value === undefined) fail(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // Support both `--flag value` and `--flag=value`.
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > -1 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq > -1 ? arg.slice(eq + 1) : undefined;
    const take = () => (inline !== undefined ? inline : needsValue(flag, argv[++i]));

    switch (flag) {
      case '-h':
      case '--help':
        process.stdout.write(USAGE);
        process.exit(EXIT_OK);
        break;
      case '--filter':
      case '-f':
        options.filters.push(String(take()).toLowerCase());
        break;
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--concurrency':
      case '-c':
        options.concurrency = parsePositiveInt(take(), '--concurrency');
        break;
      case '--timeout':
      case '-t':
        options.timeoutMs = parseDuration(take(), '--timeout');
        break;
      case '--tail':
        options.tail = parsePositiveInt(take(), '--tail');
        break;
      case '--slowest':
        options.slowest = parsePositiveInt(take(), '--slowest');
        break;
      case '--json':
        options.jsonPath = path.resolve(REPO_ROOT, String(take()));
        break;
      case '--fail-on-drift':
        options.failOnDrift = true;
        break;
      case '--no-drift':
        options.drift = false;
        break;
      default:
        fail(`unknown argument "${arg}"\n\n${USAGE}`);
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Discovery — always derived from package.json, never hardcoded.
// ---------------------------------------------------------------------------

async function readPackageScripts() {
  let raw;
  try {
    raw = await fs.readFile(PKG_PATH, 'utf8');
  } catch (error) {
    fail(`cannot read ${PKG_PATH}: ${error.message}`);
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (error) {
    fail(`cannot parse ${PKG_PATH}: ${error.message}`);
  }
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  return scripts;
}

/** Files under scripts/ that a package script command points at. */
function referencedScriptFiles(command) {
  const found = String(command).match(SCRIPT_PATH_RE) || [];
  return [...new Set(found.map((p) => p.replace(/^scripts\//, '')))];
}

/**
 * An aggregate re-runs other smoke scripts (`smoke:all`) or re-runs this
 * runner (e.g. a future `smoke:report`). Detecting them by shape rather than
 * by name means new aggregates never get executed recursively by accident.
 */
function isAggregate(name, command) {
  if (name === 'smoke:all') return true;
  const text = String(command);
  if (/\bnpm\s+run\s+smoke:/.test(text)) return true;
  if (text.includes(SELF_BASENAME)) return true;
  return false;
}

function discoverSuites(scripts) {
  const suites = [];
  const aggregates = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('smoke:')) continue;
    if (typeof command !== 'string' || command.trim() === '') continue;
    const files = referencedScriptFiles(command);
    const record = { name, command: command.trim(), files, file: files[0] ?? null };
    if (isAggregate(name, command)) aggregates.push(record);
    else suites.push(record);
  }
  suites.sort((a, b) => a.name.localeCompare(b.name));
  return { suites, aggregates };
}

function selectSuites(suites, filters) {
  if (filters.length === 0) return suites;
  return suites.filter((suite) => {
    const haystack = `${suite.name} ${suite.files.join(' ')} ${suite.command}`.toLowerCase();
    return filters.some((needle) => haystack.includes(needle));
  });
}

// ---------------------------------------------------------------------------
// Registration drift — the failure mode that hid 127 suites.
// ---------------------------------------------------------------------------

async function detectDrift(scripts, suites, aggregates) {
  const referenced = new Set();
  for (const record of [...suites, ...aggregates]) {
    for (const file of record.files) referenced.add(file);
  }

  let onDisk = [];
  try {
    const entries = await fs.readdir(SCRIPTS_DIR, { withFileTypes: true });
    onDisk = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && SUITE_FILE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return { error: `could not scan ${SCRIPTS_DIR}: ${error.message}` };
  }

  const unregistered = onDisk.filter((file) => !referenced.has(file));

  const missingFiles = [];
  for (const suite of suites) {
    for (const file of suite.files) {
      if (!SUITE_FILE_RE.test(file)) continue;
      const exists = await fs
        .access(path.join(SCRIPTS_DIR, file))
        .then(() => true)
        .catch(() => false);
      if (!exists) missingFiles.push({ suite: suite.name, file });
    }
  }

  // Registered but absent from the `smoke:all` chain: real, and invisible
  // today because the chain aborts long before anyone counts it.
  const chain = typeof scripts['smoke:all'] === 'string' ? scripts['smoke:all'] : '';
  const chained = new Set((chain.match(/npm\s+run\s+(smoke:[A-Za-z0-9:._-]+)/g) || []).map((m) => m.replace(/npm\s+run\s+/, '')));
  const notInSmokeAll = chain ? suites.filter((s) => !chained.has(s.name)).map((s) => s.name) : [];
  const inSmokeAllUndefined = chain ? [...chained].filter((name) => !(name in scripts)) : [];

  return {
    onDiskCount: onDisk.length,
    registeredFileCount: referenced.size,
    unregistered,
    missingFiles,
    notInSmokeAll,
    inSmokeAllUndefined,
    chainLength: chained.size,
  };
}

function driftCount(drift) {
  if (!drift || drift.error) return 0;
  return (
    drift.unregistered.length +
    drift.missingFiles.length +
    drift.notInSmokeAll.length +
    drift.inSmokeAllUndefined.length
  );
}

// ---------------------------------------------------------------------------
// Bounded output capture — a suite that prints megabytes must not grow memory.
// ---------------------------------------------------------------------------

function createCapture(limitBytes = MAX_CAPTURE_BYTES) {
  /** @type {Buffer[]} */
  let chunks = [];
  let retained = 0;
  let total = 0;

  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      // Keep only the tail: that is what a failure report needs.
      if (buf.length >= limitBytes) {
        chunks = [buf.subarray(buf.length - limitBytes)];
        retained = limitBytes;
        return;
      }
      chunks.push(buf);
      retained += buf.length;
      while (retained > limitBytes && chunks.length > 1) {
        retained -= chunks.shift().length;
      }
      if (retained > limitBytes && chunks.length === 1) {
        const only = chunks[0];
        chunks = [only.subarray(only.length - limitBytes)];
        retained = limitBytes;
      }
    },
    get totalBytes() {
      return total;
    },
    get truncated() {
      return total > retained;
    },
    text() {
      return Buffer.concat(chunks, retained).toString('utf8');
    },
  };
}

/** One runaway line (minified bundle, base64 blob) should not flood the report. */
function clampLine(line, max = MAX_LINE_CHARS) {
  if (line.length <= max) return line;
  return `${line.slice(0, max)}… (+${line.length - max} chars)`;
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const tail = lines.length <= count ? lines : lines.slice(lines.length - count);
  return tail.map((line) => clampLine(line));
}

// ---------------------------------------------------------------------------
// Execution — one child per suite, Node-side timeout, process-group kill.
// macOS has no GNU `timeout`; shelling out to it silently fails every suite.
// ---------------------------------------------------------------------------

const childEnv = {
  ...process.env,
  // Mirror what `npm run` does so `npx`/local bins resolve identically.
  PATH: `${path.join(REPO_ROOT, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  // Suites are non-interactive here; keep output plain and parseable.
  npm_config_yes: 'true',
};

/** Suites currently running, so SIGINT can tear the whole tree down. */
const liveChildren = new Set();
let interrupted = false;

function killTree(child, signal) {
  if (!child.pid) return;
  try {
    // Negative pid = the detached process group (npx -> tsx -> node).
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function runSuite(suite, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const capture = createCapture();
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    let graceTimer = null;

    const child = spawn(suite.command, {
      cwd: REPO_ROOT,
      env: childEnv,
      shell: '/bin/sh',
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    liveChildren.add(child);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
      liveChildren.delete(child);
      const output = capture.text();
      resolve({
        name: suite.name,
        command: suite.command,
        file: suite.file,
        durationMs: Date.now() - startedAt,
        outputBytes: capture.totalBytes,
        outputTruncated: capture.truncated,
        output,
        ...result,
      });
    };

    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      stream.on('data', (chunk) => capture.push(chunk));
      stream.on('error', () => {
        /* broken pipe on kill is expected */
      });
    }

    child.on('error', (error) => {
      capture.push(`\n[run-smokes] spawn error: ${error.message}\n`);
      finish({ status: 'failed', exitCode: null, signal: null, reason: `spawn error: ${error.message}` });
    });

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish({ status: 'timeout', exitCode: code, signal, reason: `timed out after ${timeoutMs}ms` });
        return;
      }
      if (interrupted && code !== 0) {
        finish({ status: 'interrupted', exitCode: code, signal, reason: 'interrupted' });
        return;
      }
      if (signal) {
        finish({ status: 'failed', exitCode: code, signal, reason: `killed by signal ${signal}` });
        return;
      }
      if (code === 0) {
        finish({ status: 'passed', exitCode: 0, signal: null, reason: null });
        return;
      }
      finish({ status: 'failed', exitCode: code, signal: null, reason: `exit code ${code}` });
    });

    killTimer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      graceTimer = setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
  });
}

async function runPool(suites, options, onResult) {
  const results = [];
  let cursor = 0;
  const workers = Math.max(1, Math.min(options.concurrency, suites.length));

  async function worker() {
    while (!interrupted) {
      const index = cursor;
      cursor += 1;
      if (index >= suites.length) return;
      const result = await runSuite(suites[index], options.timeoutMs);
      results.push(result);
      onResult(result, results.length, suites.length);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const out = (line = '') => process.stdout.write(`${line}\n`);

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

const STATUS_LABEL = {
  passed: () => green('PASS'),
  failed: () => red('FAIL'),
  timeout: () => yellow('TIME'),
  interrupted: () => yellow('INTR'),
};

function reportDrift(drift) {
  if (!drift) return;
  out();
  out(bold('Registration drift'));
  if (drift.error) {
    out(`  ${yellow('!')} ${drift.error}`);
    return;
  }
  const total = driftCount(drift);
  out(
    dim(
      `  ${drift.onDiskCount} smoketest files on disk · ${drift.registeredFileCount} referenced by smoke:* entries · ${drift.chainLength} in the smoke:all chain`,
    ),
  );
  if (total === 0) {
    out(`  ${green('none')} — every suite file is registered and chained`);
    return;
  }
  if (drift.unregistered.length > 0) {
    out(`  ${red(`${drift.unregistered.length} file(s) on disk with no smoke:* entry`)} (they never run):`);
    for (const file of drift.unregistered) out(`      scripts/${file}`);
  }
  if (drift.missingFiles.length > 0) {
    out(`  ${red(`${drift.missingFiles.length} smoke:* entry(ies) pointing at a missing file`)}:`);
    for (const entry of drift.missingFiles) out(`      ${entry.suite} -> scripts/${entry.file}`);
  }
  if (drift.notInSmokeAll.length > 0) {
    out(`  ${yellow(`${drift.notInSmokeAll.length} registered suite(s) missing from the smoke:all chain`)}:`);
    for (const name of drift.notInSmokeAll) out(`      ${name}`);
  }
  if (drift.inSmokeAllUndefined.length > 0) {
    out(`  ${red(`${drift.inSmokeAllUndefined.length} name(s) in smoke:all with no script definition`)}:`);
    for (const name of drift.inSmokeAllUndefined) out(`      ${name}`);
  }
}

function reportSummary(results, selected, options, wallMs) {
  const passed = results.filter((r) => r.status === 'passed');
  const failed = results.filter((r) => r.status === 'failed');
  const timedOut = results.filter((r) => r.status === 'timeout');
  const interruptedRuns = results.filter((r) => r.status === 'interrupted');
  const notRun = selected.length - results.length;

  const bad = [...failed, ...timedOut];
  if (bad.length > 0) {
    out();
    out(bold(`Failures (${bad.length})`));
    for (const result of bad) {
      out();
      const label = result.status === 'timeout' ? yellow('TIMEOUT') : red('FAILED');
      out(`${label} ${bold(result.name)} ${dim(`(${formatDuration(result.durationMs)} · ${result.reason})`)}`);
      out(dim(`  $ ${result.command}`));
      const lines = tailLines(result.output, options.tail);
      if (lines.length === 0) {
        out(dim('  (no output)'));
      } else {
        if (result.outputTruncated) out(dim(`  ... output truncated, showing last ${lines.length} line(s) of ${result.outputBytes} bytes`));
        for (const line of lines) out(`  ${line}`);
      }
    }
  }

  const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, options.slowest);
  if (slowest.length > 0) {
    out();
    out(bold(`Slowest ${slowest.length}`));
    for (const result of slowest) {
      out(`  ${formatDuration(result.durationMs).padStart(7)}  ${result.name}${result.status === 'passed' ? '' : dim(` [${result.status}]`)}`);
    }
  }

  const totalSuiteMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  out();
  out(bold('Summary'));
  out(`  total     ${selected.length}`);
  out(`  passed    ${passed.length > 0 ? green(String(passed.length)) : '0'}`);
  out(`  failed    ${failed.length > 0 ? red(String(failed.length)) : '0'}`);
  out(`  timed out ${timedOut.length > 0 ? yellow(String(timedOut.length)) : '0'}`);
  if (interruptedRuns.length > 0) out(`  interrupted ${yellow(String(interruptedRuns.length))}`);
  if (notRun > 0) out(`  not run   ${yellow(String(notRun))} ${dim('(interrupted before start)')}`);
  out(
    dim(
      `  wall ${formatDuration(wallMs)} · suite time ${formatDuration(totalSuiteMs)} · concurrency ${options.concurrency} · timeout ${formatDuration(options.timeoutMs)}`,
    ),
  );

  if (bad.length > 0) {
    out();
    out(bold('Rerun just the failures:'));
    const names = bad.map((r) => r.name.replace(/^smoke:/, ''));
    out(dim(`  node scripts/run-smokes.mjs ${names.map((n) => `--filter ${n}`).join(' ')}`));
  }

  return { passed, failed, timedOut, interruptedRuns, notRun };
}

async function writeJsonReport(jsonPath, payload) {
  try {
    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    out(dim(`  json report -> ${jsonPath}`));
  } catch (error) {
    process.stderr.write(`run-smokes: could not write ${jsonPath}: ${error.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgv(process.argv.slice(2));
  const scripts = await readPackageScripts();
  const { suites, aggregates } = discoverSuites(scripts);

  if (suites.length === 0) {
    process.stderr.write('run-smokes: no smoke:* scripts found in package.json\n');
    process.exit(EXIT_USAGE);
  }

  const selected = selectSuites(suites, options.filters);
  const drift = options.drift ? await detectDrift(scripts, suites, aggregates) : null;

  if (options.list) {
    out(bold(`${selected.length} suite(s)${options.filters.length > 0 ? ` matching ${options.filters.map((f) => `"${f}"`).join(' | ')}` : ''} of ${suites.length} registered`));
    for (const suite of selected) out(`  ${suite.name}${suite.file ? dim(`  scripts/${suite.file}`) : ''}`);
    if (aggregates.length > 0) out(dim(`  (skipped ${aggregates.length} aggregate script(s): ${aggregates.map((a) => a.name).join(', ')})`));
    reportDrift(drift);
    process.exit(driftCount(drift) > 0 && options.failOnDrift ? EXIT_DRIFT : EXIT_OK);
  }

  if (selected.length === 0) {
    process.stderr.write(
      `run-smokes: no suites matched ${options.filters.map((f) => `"${f}"`).join(' | ')} (of ${suites.length} registered)\n`,
    );
    process.exit(EXIT_USAGE);
  }

  out(
    bold(
      `Running ${selected.length} suite(s) · concurrency ${options.concurrency} · per-suite timeout ${formatDuration(options.timeoutMs)}`,
    ),
  );

  const onSigint = () => {
    if (interrupted) return;
    interrupted = true;
    out(`\n${yellow('interrupted')} — stopping ${liveChildren.size} running suite(s)`);
    for (const child of liveChildren) killTree(child, 'SIGTERM');
    setTimeout(() => {
      for (const child of liveChildren) killTree(child, 'SIGKILL');
    }, KILL_GRACE_MS).unref();
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);

  const startedAt = Date.now();
  const width = String(selected.length).length;
  const results = await runPool(selected, options, (result, done, total) => {
    const label = (STATUS_LABEL[result.status] ?? (() => result.status.toUpperCase()))();
    const suffix = result.status === 'passed' ? '' : dim(` ${result.reason ?? ''}`);
    out(
      `[${String(done).padStart(width)}/${total}] ${label} ${result.name} ${dim(formatDuration(result.durationMs))}${suffix}`,
    );
  });
  const wallMs = Date.now() - startedAt;

  const tally = reportSummary(results, selected, options, wallMs);
  reportDrift(drift);

  if (options.jsonPath) {
    await writeJsonReport(options.jsonPath, {
      generatedAt: new Date().toISOString(),
      wallMs,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      filters: options.filters,
      totals: {
        selected: selected.length,
        registered: suites.length,
        passed: tally.passed.length,
        failed: tally.failed.length,
        timedOut: tally.timedOut.length,
        interrupted: tally.interruptedRuns.length,
        notRun: tally.notRun,
      },
      suites: results.map((r) => ({
        name: r.name,
        status: r.status,
        durationMs: r.durationMs,
        exitCode: r.exitCode,
        signal: r.signal,
        reason: r.reason,
        outputBytes: r.outputBytes,
        outputTail: r.status === 'passed' ? undefined : tailLines(r.output, options.tail).join('\n'),
      })),
      drift,
    });
  }

  const hadFailures = tally.failed.length + tally.timedOut.length > 0;
  if (interrupted) process.exit(EXIT_INTERRUPTED);
  if (hadFailures) process.exit(EXIT_SUITE_FAILURE);
  if (options.failOnDrift && driftCount(drift) > 0) process.exit(EXIT_DRIFT);
  process.exit(EXIT_OK);
}

main().catch((error) => {
  process.stderr.write(`run-smokes: unexpected error: ${error?.stack ?? error}\n`);
  process.exit(EXIT_USAGE);
});
