#!/usr/bin/env node
/**
 * Anthropic usage audit for The Underground Circle.
 *
 * Reports two views when credentials are available:
 *   1. Anthropic Admin Cost/Usage API: authoritative organization billing.
 *   2. Supabase ledgers: app-attributed source/model rows.
 *
 * It never prints API keys.
 *
 * Optional env:
 *   ANTHROPIC_ADMIN_KEY or ANTHROPIC_ADMIN_API_KEY
 *   SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Args:
 *   --days=14
 *   --circle=<circle uuid>
 *   --json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const ENV_FILES = ['.env', '.env.local', '.env.production', 'supabase/.env'];
const ANTHROPIC_VERSION = '2023-06-01';
const ADMIN_API_BASE = 'https://api.anthropic.com/v1/organizations';

function loadEnvFile(file) {
  const abs = path.resolve(ROOT, file);
  if (!fs.existsSync(abs)) return;
  const raw = fs.readFileSync(abs, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

for (const file of ENV_FILES) loadEnvFile(file);

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  }),
);

const days = Math.max(1, Math.min(31, Number(args.get('days') || 14) || 14));
const circleId = args.get('circle') || null;
const asJson = args.has('json');
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminKey = process.env.ANTHROPIC_ADMIN_KEY || process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ADMIN_API_KEY;
const hasSupabase = !!(supabaseUrl && serviceKey);
const hasAnthropicAdmin = !!adminKey;

if (!hasSupabase && !hasAnthropicAdmin) {
  console.error('Missing credentials for both audit sources.');
  console.error('Set ANTHROPIC_ADMIN_KEY for authoritative billing and/or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for app attribution.');
  process.exit(2);
}

const supabase = hasSupabase
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function isoWindow() {
  const endingAt = new Date();
  const startingAt = new Date(endingAt.getTime() - days * 86400000);
  return { startingAt: startingAt.toISOString(), endingAt: endingAt.toISOString() };
}

function centsToUsd(amount) {
  // Anthropic cost_report returns decimal strings in the lowest unit: cents.
  return num(amount) / 100;
}

function sumObjectValues(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((sum, value) => sum + num(value), 0);
}

async function fetchAnthropicAdmin(pathname, params) {
  if (!adminKey) return { rows: [], missing: true };
  const rows = [];
  let page = null;
  do {
    const url = new URL(`${ADMIN_API_BASE}${pathname}`);
    for (const [key, value] of params) url.searchParams.append(key, value);
    if (page) url.searchParams.set('page', page);

    const res = await fetch(url, {
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': adminKey,
        'user-agent': 'TheUndergroundCircle/anthropic-usage-audit',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic Admin API ${pathname} ${res.status}: ${text}`);
    }
    const data = await res.json();
    rows.push(...(data.data || []));
    page = data.has_more ? data.next_page : null;
  } while (page);
  return { rows, missing: false };
}

async function fetchAdminCostReport() {
  if (!adminKey) return { rows: [], dailyTotals: [], missing: true };
  const { startingAt, endingAt } = isoWindow();
  const report = await fetchAnthropicAdmin('/cost_report', [
    ['starting_at', startingAt],
    ['ending_at', endingAt],
    ['group_by[]', 'workspace_id'],
    ['group_by[]', 'description'],
    ['limit', String(days)],
  ]);
  const rows = [];
  for (const bucket of report.rows) {
    for (const result of bucket.results || []) {
      rows.push({
        day: dayKey(bucket.starting_at),
        workspaceId: result.workspace_id || 'default',
        description: result.description || result.cost_type || 'unknown',
        currency: result.currency || 'USD',
        cost: centsToUsd(result.amount),
        listCost: centsToUsd(result.list_amount ?? result.amount),
      });
    }
  }
  const daily = new Map();
  for (const r of rows) {
    const curr = daily.get(r.day) || { day: r.day, cost: 0, listCost: 0, rows: 0 };
    curr.cost += r.cost;
    curr.listCost += r.listCost;
    curr.rows += 1;
    daily.set(r.day, curr);
  }
  return {
    rows: rows.sort((a, b) => (a.day === b.day ? b.cost - a.cost : a.day < b.day ? 1 : -1)),
    dailyTotals: [...daily.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    missing: false,
  };
}

async function fetchAdminUsageReport() {
  if (!adminKey) return { rows: [], dailyTotals: [], missing: true };
  const { startingAt, endingAt } = isoWindow();
  const report = await fetchAnthropicAdmin('/usage_report/messages', [
    ['starting_at', startingAt],
    ['ending_at', endingAt],
    ['bucket_width', '1d'],
    ['group_by[]', 'model'],
    ['group_by[]', 'service_tier'],
    ['limit', String(days)],
  ]);
  const rows = [];
  for (const bucket of report.rows) {
    for (const result of bucket.results || []) {
      const cacheCreate = sumObjectValues(result.cache_creation);
      rows.push({
        day: dayKey(bucket.starting_at),
        model: result.model || 'unknown',
        serviceTier: result.service_tier || 'unknown',
        input: num(result.uncached_input_tokens),
        output: num(result.output_tokens),
        cacheCreate,
        cacheRead: num(result.cache_read_input_tokens),
        webSearch: num(result.server_tool_use?.web_search_requests),
      });
    }
  }
  const daily = new Map();
  for (const r of rows) {
    const curr = daily.get(r.day) || { day: r.day, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, webSearch: 0 };
    curr.input += r.input;
    curr.output += r.output;
    curr.cacheCreate += r.cacheCreate;
    curr.cacheRead += r.cacheRead;
    curr.webSearch += r.webSearch;
    daily.set(r.day, curr);
  }
  return {
    rows: rows.sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      return (b.input + b.output + b.cacheCreate + b.cacheRead) - (a.input + a.output + a.cacheCreate + a.cacheRead);
    }),
    dailyTotals: [...daily.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    missing: false,
  };
}

async function fetchRows(table, select, configure) {
  if (!supabase) return { rows: [], missing: true };
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from(table)
      .select(select)
      .gte('created_at', new Date(Date.now() - days * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    query = configure ? configure(query) : query;
    const { data, error } = await query;
    if (error) {
      if (/does not exist|schema cache|relation/i.test(error.message || '')) return { rows, missing: true };
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { rows, missing: false };
}

function aggregateAppRows(rows, sourcePrefix = '') {
  const buckets = new Map();
  for (const r of rows) {
    const day = dayKey(r.created_at);
    const source = `${sourcePrefix}${r.source || 'unknown'}`;
    const model = r.model || 'unknown';
    const key = `${day}\t${source}\t${model}`;
    const curr = buckets.get(key) || {
      day,
      source,
      model,
      requests: 0,
      cost: 0,
      input: 0,
      output: 0,
      cacheCreate: 0,
      cacheRead: 0,
    };
    curr.requests += 1;
    curr.cost += num(r.estimated_cost);
    curr.input += num(r.input_tokens);
    curr.output += num(r.output_tokens);
    curr.cacheCreate += num(r.cache_creation_tokens);
    curr.cacheRead += num(r.cache_read_tokens);
    buckets.set(key, curr);
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    return b.cost - a.cost;
  });
}

function appDailyTotals(rows) {
  const daysMap = new Map();
  for (const r of rows) {
    const curr = daysMap.get(r.day) || { day: r.day, requests: 0, cost: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
    curr.requests += r.requests;
    curr.cost += r.cost;
    curr.input += r.input;
    curr.output += r.output;
    curr.cacheCreate += r.cacheCreate;
    curr.cacheRead += r.cacheRead;
    daysMap.set(r.day, curr);
  }
  return [...daysMap.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

function printCostTable(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  no rows');
    return;
  }
  console.log('day        cost       list       group');
  for (const r of rows) {
    const label = r.description ? `${r.workspaceId || 'default'} / ${r.description}` : '';
    console.log(`${r.day}  $${r.cost.toFixed(4).padStart(8)}  $${r.listCost.toFixed(4).padStart(8)}  ${label}`);
  }
}

function printUsageTable(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  no rows');
    return;
  }
  console.log('day        tokens      cache%  web  model/tier');
  for (const r of rows) {
    const inputSide = r.input + r.cacheCreate + r.cacheRead;
    const total = inputSide + r.output;
    const cachePct = inputSide > 0 ? Math.round((r.cacheRead / inputSide) * 100) : 0;
    const label = `${r.model || 'unknown'} / ${r.serviceTier || 'unknown'}`;
    console.log(`${r.day}  ${String(total).padStart(10)}  ${String(cachePct).padStart(5)}%  ${String(r.webSearch || 0).padStart(3)}  ${label}`);
  }
}

function printAppTable(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  no rows');
    return;
  }
  console.log('day        cost       reqs  cache%  source/model');
  for (const r of rows) {
    const inputSide = r.input + r.cacheCreate + r.cacheRead;
    const cachePct = inputSide > 0 ? Math.round((r.cacheRead / inputSide) * 100) : 0;
    const label = r.source && r.model ? `${r.source} / ${r.model}` : '';
    console.log(`${r.day}  $${r.cost.toFixed(4).padStart(8)}  ${String(r.requests).padStart(4)}  ${String(cachePct).padStart(5)}%  ${label}`);
  }
}

const [adminCost, adminUsage, canonical, userAi] = await Promise.all([
  fetchAdminCostReport(),
  fetchAdminUsageReport(),
  fetchRows(
    'claude_api_usage',
    'created_at,source,model,estimated_cost,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,circle_id',
    (q) => (circleId ? q.eq('circle_id', circleId) : q),
  ),
  fetchRows(
    'user_ai_usage',
    'created_at,source,model,provider,estimated_cost,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,circle_id',
    (q) => {
      q = q.eq('provider', 'anthropic');
      return circleId ? q.eq('circle_id', circleId) : q;
    },
  ),
]);

const canonicalRows = aggregateAppRows(canonical.rows);
const supplementalRows = aggregateAppRows(userAi.rows, 'user_ai_usage:');

const payload = {
  days,
  circleId,
  authoritativeAnthropic: {
    missing: adminCost.missing,
    cost: adminCost,
    usage: adminUsage,
    note: 'Requires an Anthropic Admin API key. Cost amount is converted from cents to USD.',
  },
  appLedgers: {
    missing: canonical.missing,
    canonical: {
      rows: canonicalRows,
      dailyTotals: appDailyTotals(canonicalRows),
    },
    supplementalUserAiUsage: {
      missing: userAi.missing,
      note: 'Supplemental Anthropic rows from user_ai_usage. Historical chat-stream rows may appear here before chat-stream wrote to claude_api_usage.',
      rows: supplementalRows,
      dailyTotals: appDailyTotals(supplementalRows),
    },
  },
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`Anthropic usage audit: last ${days} day(s)${circleId ? `, circle ${circleId}` : ''}`);
  if (adminCost.missing) {
    console.log('\nAuthoritative Anthropic Admin API skipped: ANTHROPIC_ADMIN_KEY not set.');
  } else {
    printCostTable('Authoritative Anthropic daily cost totals', adminCost.dailyTotals);
    printCostTable('Authoritative Anthropic cost breakdown', adminCost.rows.slice(0, 40));
    printUsageTable('Authoritative Anthropic usage by model/tier', adminUsage.rows.slice(0, 40));
  }
  if (canonical.missing) {
    console.log('\nApp ledgers skipped: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY not set, or claude_api_usage missing.');
  } else {
    printAppTable('App canonical daily totals from claude_api_usage', payload.appLedgers.canonical.dailyTotals);
    printAppTable('App canonical breakdown by source/model', canonicalRows.slice(0, 40));
  }
  if (userAi.missing) {
    console.log('\nSupplemental user_ai_usage table is missing or skipped.');
  } else {
    printAppTable('Supplemental user_ai_usage Anthropic totals', payload.appLedgers.supplementalUserAiUsage.dailyTotals);
  }
}
