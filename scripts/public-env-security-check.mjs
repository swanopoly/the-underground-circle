#!/usr/bin/env node

/**
 * Fail the web build before Expo can inline a server credential into a public
 * JavaScript bundle. `EXPO_PUBLIC_*` values are downloadable by every visitor;
 * only identifiers and deliberately publishable keys belong there.
 */

import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_PREFIX = 'EXPO_PUBLIC_';
const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
];

const BLOCKED_EXACT_NAMES = new Set([
  'EXPO_PUBLIC_GEMINI_API_KEY',
  'EXPO_PUBLIC_HELIUS_API_KEY',
  'EXPO_PUBLIC_OPENAI_API_KEY',
  'EXPO_PUBLIC_ANTHROPIC_API_KEY',
  'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
  'EXPO_PUBLIC_STRIPE_SECRET_KEY',
]);

const BLOCKED_NAME_PARTS = [
  /(?:^|_)API_KEY(?:_|$)/,
  /(?:^|_)SECRET(?:_|$)/,
  /(?:^|_)PASSWORD(?:_|$)/,
  /(?:^|_)PRIVATE_KEY(?:_|$)/,
  /(?:^|_)SERVICE_ROLE(?:_|$)/,
  /(?:^|_)ACCESS_TOKEN(?:_|$)/,
  /(?:^|_)REFRESH_TOKEN(?:_|$)/,
  /(?:^|_)CLIENT_SECRET(?:_|$)/,
];

function parseEnvFile(filePath) {
  const values = new Map();
  if (!fs.existsSync(filePath)) return values;

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function collectPublicEnvironment() {
  const values = new Map();
  for (const file of ENV_FILES) {
    for (const [name, value] of parseEnvFile(path.resolve(process.cwd(), file))) {
      if (name.startsWith(PUBLIC_PREFIX)) values.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith(PUBLIC_PREFIX) && typeof value === 'string') {
      values.set(name, value);
    }
  }
  return values;
}

function isBlockedPublicName(name) {
  if (BLOCKED_EXACT_NAMES.has(name)) return true;
  return BLOCKED_NAME_PARTS.some((pattern) => pattern.test(name));
}

const publicEnvironment = collectPublicEnvironment();
const blockedNames = [...publicEnvironment.entries()]
  .filter(([name, value]) => value.trim().length > 0 && isBlockedPublicName(name))
  .map(([name]) => name)
  .sort();

if (publicEnvironment.get('EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS')?.trim().toLowerCase() === 'true') {
  blockedNames.push('EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS=true');
}

const uniqueBlockedNames = [...new Set(blockedNames)].sort();
if (uniqueBlockedNames.length > 0) {
  console.error('[public-env-security] Refusing to build with server credentials in the public Expo environment.');
  for (const name of uniqueBlockedNames) console.error(`[public-env-security] blocked: ${name}`);
  console.error('[public-env-security] Move provider credentials to an authenticated server/edge function.');
  process.exit(1);
}

console.log('[public-env-security] PASS: no blocked public credential variables are configured.');
