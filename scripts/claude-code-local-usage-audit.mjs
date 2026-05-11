#!/usr/bin/env node
/**
 * Estimate local Claude Code usage from ~/.claude JSONL transcripts.
 *
 * This is not an Anthropic invoice. It applies published API token prices to
 * local transcript usage blocks so you can spot model/day spikes when the
 * Admin Usage API is unavailable. It never prints prompt or response content.
 *
 * Args:
 *   --days=14
 *   --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  }),
);

const days = Math.max(1, Math.min(90, Number(args.get('days') || 14) || 14));
const asJson = args.has('json');
const root = path.join(os.homedir(), '.claude');
const sinceMs = Date.now() - days * 86400000;

const RATES = [
  [/claude-opus-4-[67]/i, { in: 5, out: 25, cacheCreate: 6.25, cacheRead: 0.5 }],
  [/claude-sonnet-4-[56]/i, { in: 3, out: 15, cacheCreate: 3.75, cacheRead: 0.3 }],
  [/claude-haiku-4-5/i, { in: 1, out: 5, cacheCreate: 1.25, cacheRead: 0.1 }],
  [/claude-3-5-haiku/i, { in: 0.8, out: 4, cacheCreate: 1, cacheRead: 0.08 }],
  [/claude-3-5-sonnet|claude-3-7-sonnet/i, { in: 3, out: 15, cacheCreate: 3.75, cacheRead: 0.3 }],
];

function rateFor(model = '') {
  return RATES.find(([regex]) => regex.test(model))?.[1] || { in: 3, out: 15, cacheCreate: 3.75, cacheRead: 0.3 };
}

function n(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function cacheCreateTokens(usage) {
  if (typeof usage.cache_creation_input_tokens === 'number') return usage.cache_creation_input_tokens;
  return Object.values(usage.cache_creation || {}).reduce((sum, value) => sum + n(value), 0);
}

function estimateCost(model, usage) {
  const rate = rateFor(model);
  const input = n(usage.input_tokens);
  const output = n(usage.output_tokens);
  const cacheCreate = cacheCreateTokens(usage);
  const cacheRead = n(usage.cache_read_input_tokens);
  return (
    input * rate.in +
    output * rate.out +
    cacheCreate * rate.cacheCreate +
    cacheRead * rate.cacheRead
  ) / 1_000_000;
}

async function listJsonlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonlFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
  }
  return files;
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

const seen = new Set();
const daily = new Map();
const byModel = new Map();
let calls = 0;
let filesRead = 0;

for (const file of await listJsonlFiles(root)) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text) continue;
  filesRead++;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const usage = row.message?.usage;
    if (row.type !== 'assistant' || !usage) continue;
    const ts = Date.parse(row.timestamp || '');
    if (!Number.isFinite(ts) || ts < sinceMs) continue;

    const model = row.message?.model || 'unknown';
    const dedupKey = [
      row.message?.id || row.requestId || row.uuid,
      n(usage.input_tokens),
      cacheCreateTokens(usage),
      n(usage.cache_read_input_tokens),
      n(usage.output_tokens),
    ].join(':');
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    calls++;

    const day = dayKey(ts);
    const cost = estimateCost(model, usage);
    const input = n(usage.input_tokens);
    const output = n(usage.output_tokens);
    const cacheCreate = cacheCreateTokens(usage);
    const cacheRead = n(usage.cache_read_input_tokens);

    const curr = daily.get(day) || { day, calls: 0, cost: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
    curr.calls++;
    curr.cost += cost;
    curr.input += input;
    curr.output += output;
    curr.cacheCreate += cacheCreate;
    curr.cacheRead += cacheRead;
    daily.set(day, curr);

    const modelKey = `${day}\t${model}`;
    const modelRow = byModel.get(modelKey) || { day, model, calls: 0, cost: 0 };
    modelRow.calls++;
    modelRow.cost += cost;
    byModel.set(modelKey, modelRow);
  }
}

const dailyRows = [...daily.values()].sort((a, b) => a.day.localeCompare(b.day));
const modelRows = [...byModel.values()].sort((a, b) => b.cost - a.cost);
const payload = {
  days,
  filesRead,
  calls,
  totalCostEstimate: Number(dailyRows.reduce((sum, row) => sum + row.cost, 0).toFixed(4)),
  daily: dailyRows.map((row) => {
    const inputSide = row.input + row.cacheCreate + row.cacheRead;
    return {
      ...row,
      cost: Number(row.cost.toFixed(4)),
      cacheHitPct: Number((row.cacheRead / Math.max(1, inputSide) * 100).toFixed(1)),
    };
  }),
  topModelDays: modelRows.slice(0, 25).map((row) => ({ ...row, cost: Number(row.cost.toFixed(4)) })),
  note: 'Estimate only: applies published API token rates to local Claude Code usage logs; reconcile against Anthropic Admin API for invoices.',
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`Claude Code local usage estimate: last ${days} day(s)`);
  console.log(`Files read: ${filesRead}, deduped assistant calls: ${calls}, estimated total: $${payload.totalCostEstimate.toFixed(4)}`);
  console.log('\nday        est cost    calls  cache%  tokens');
  for (const row of payload.daily) {
    const tokens = row.input + row.output + row.cacheCreate + row.cacheRead;
    console.log(`${row.day}  $${row.cost.toFixed(4).padStart(9)}  ${String(row.calls).padStart(5)}  ${String(row.cacheHitPct).padStart(5)}%  ${tokens.toLocaleString()}`);
  }
  console.log('\nTop model/day spikes');
  for (const row of payload.topModelDays.slice(0, 12)) {
    console.log(`${row.day}  $${row.cost.toFixed(4).padStart(9)}  ${String(row.calls).padStart(5)}  ${row.model}`);
  }
}
