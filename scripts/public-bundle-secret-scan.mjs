#!/usr/bin/env node

/**
 * Scan the exported web bundle for credentials that would be downloadable by
 * every visitor. This complements the environment-name guard: it catches a
 * credential introduced as a literal or through a non-EXPO_PUBLIC build path.
 *
 * Deliberately publishable Supabase anon/publishable keys are permitted. A JWT
 * whose payload declares the service_role is not.
 */

import fs from 'node:fs';
import path from 'node:path';

const bundleRoot = path.resolve(process.cwd(), process.argv[2] || 'dist');

const tokenPatterns = [
  ['OpenAI/compatible secret', /(?<![A-Za-z0-9])sk-(?:proj-|org-|ant-api\d+-|or-v\d+-)?[A-Za-z0-9_-]{20,}/g],
  ['GitHub token', /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['Slack token', /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ['Google API key', /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/g],
  ['AWS access key', /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g],
  ['Hugging Face token', /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{20,}/g],
  ['Groq token', /(?<![A-Za-z0-9])gsk_[A-Za-z0-9]{20,}/g],
  ['Perplexity token', /(?<![A-Za-z0-9])pplx-[A-Za-z0-9_-]{20,}/g],
  ['Stripe secret', /(?<![A-Za-z0-9])(?:sk|rk)_live_[A-Za-z0-9]{16,}/g],
];

const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const jwtPattern = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function isPlaceholder(token) {
  const normalized = token
    .replace(/^(?:sk-(?:proj-|org-|ant-api\d+-|or-v\d+-)?|gh[pousr]_|xox[baprs]-|AIza|AKIA|hf_|gsk_|pplx-|(?:sk|rk)_live_)/, '')
    .replace(/[-_]/g, '')
    .toLowerCase();
  if (!normalized) return true;
  if (/^(?:x+|0+|1+|a+|\*+|example|placeholder|redacted|yourkey|yourtoken)$/.test(normalized)) return true;
  return new Set(normalized).size <= 3;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
  console.error(`[public-bundle-security] Missing exported bundle directory: ${bundleRoot}`);
  process.exit(1);
}

const findings = [];
let scannedFiles = 0;

for (const filePath of walkFiles(bundleRoot)) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }
  scannedFiles += 1;
  const relativePath = path.relative(process.cwd(), filePath);

  for (const [kind, pattern] of tokenPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (!isPlaceholder(match[0])) findings.push({ kind, relativePath });
    }
  }

  if (privateKeyPattern.test(source)) {
    findings.push({ kind: 'private key material', relativePath });
  }
  privateKeyPattern.lastIndex = 0;

  for (const match of source.matchAll(jwtPattern)) {
    const payload = decodeJwtPayload(match[0]);
    if (payload?.role === 'service_role') {
      findings.push({ kind: 'Supabase service-role JWT', relativePath });
    }
  }
}

const uniqueFindings = [
  ...new Map(findings.map((finding) => [`${finding.kind}\0${finding.relativePath}`, finding])).values(),
];

if (uniqueFindings.length > 0) {
  console.error('[public-bundle-security] Refusing to publish a bundle containing likely server credentials.');
  for (const finding of uniqueFindings) {
    console.error(`[public-bundle-security] ${finding.kind}: ${finding.relativePath}`);
  }
  console.error('[public-bundle-security] Credential values are intentionally not printed.');
  process.exit(1);
}

console.log(`[public-bundle-security] PASS: ${scannedFiles} exported files contain no likely server credentials.`);
