#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const functionsRoot = path.join(repoRoot, 'supabase', 'functions');
const defaultConfig = path.join(functionsRoot, 'deno.json');

function findFunctionEntrypoints(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const entrypoints = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const functionDir = path.join(rootDir, entry.name);
    const indexPath = path.join(functionDir, 'index.ts');
    if (!fs.existsSync(indexPath)) continue;

    const localConfig = path.join(functionDir, 'deno.json');
    entrypoints.push({
      name: entry.name,
      indexPath,
      configPath: fs.existsSync(localConfig) ? localConfig : defaultConfig,
    });
  }

  return entrypoints.sort((a, b) => a.name.localeCompare(b.name));
}

function ensureDenoAvailable() {
  const result = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error('[typecheck:functions] Deno is not installed or not available on PATH.');
    console.error('[typecheck:functions] Install Deno, then rerun `npm run typecheck:functions`.');
    process.exit(1);
  }
}

function runDenoCheck(entrypoint) {
  const args = ['check', '--config', entrypoint.configPath, entrypoint.indexPath];
  console.log(`[typecheck:functions] Checking ${entrypoint.name}`);

  const result = spawnSync('deno', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(functionsRoot)) {
  console.error('[typecheck:functions] supabase/functions directory not found.');
  process.exit(1);
}

const entrypoints = findFunctionEntrypoints(functionsRoot);
if (entrypoints.length === 0) {
  console.error('[typecheck:functions] No Supabase function entrypoints were found.');
  process.exit(1);
}

ensureDenoAvailable();

for (const entrypoint of entrypoints) {
  runDenoCheck(entrypoint);
}

console.log(`[typecheck:functions] Completed ${entrypoints.length} function checks.`);
