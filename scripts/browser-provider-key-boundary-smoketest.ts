/**
 * Browser provider-key boundary regression.
 *
 * Provider secrets must stay behind authenticated edge/RPC or user-BYOK
 * boundaries. Expo public variables are compiled into the downloadable web
 * bundle, so even a disabled fallback is a leak waiting for one build flag.
 *
 * Run: npx tsx scripts/browser-provider-key-boundary-smoketest.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');

function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const sourceFiles = collectSourceFiles(srcRoot);
const sourceByRelativePath = new Map(
  sourceFiles.map((absolute) => [path.relative(root, absolute), fs.readFileSync(absolute, 'utf8')]),
);

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`browser provider-key boundary smoke failed: ${message}`);
}

function source(relativePath: string): string {
  const value = sourceByRelativePath.get(relativePath);
  check(typeof value === 'string', `${relativePath} exists`);
  return value;
}

const completeClientSource = [...sourceByRelativePath.values()].join('\n');
for (const forbidden of [
  'EXPO_PUBLIC_GEMINI_API_KEY',
  'EXPO_PUBLIC_HELIUS_API_KEY',
  'process.env.HELIUS_API_KEY',
  'process.env?.HELIUS_API_KEY',
]) {
  check(!completeClientSource.includes(forbidden), `client source excludes ${forbidden}`);
}
check(
  !completeClientSource.includes('generativelanguage.googleapis.com'),
  'client source never calls the Google Generative Language API directly',
);

const agentMemory = source('src/lib/agentMemory.ts');
check(agentMemory.includes("supabase.functions.invoke('llm-proxy'"), 'agent memory uses llm-proxy');
check(!agentMemory.includes('callPlatformGemini'), 'agent memory has no platform-key fast path');

const compaction = source('src/lib/conversationCompaction.ts');
check(compaction.includes("supabase.functions.invoke('llm-proxy'"), 'conversation compaction uses llm-proxy');
check(compaction.includes('Connect or verify a Google AI key in Marketplace'), 'conversation compaction failure is actionable');

const memoryService = source('src/lib/memoryService.ts');
check(memoryService.includes("supabase.functions.invoke('llm-proxy'"), 'memory service compaction uses llm-proxy');
check(memoryService.includes('Connect or verify a Google AI key in Marketplace'), 'memory service failure is actionable');

const capabilities = source('src/lib/modelCapabilities.ts');
check(capabilities.includes("supabase.functions.invoke('llm-proxy'"), 'webpage capability uses llm-proxy');
check(!capabilities.includes('generateImageGemini'), 'image capability has no direct Gemini fallback');
check(capabilities.includes("OpenSwan's image-generation tool"), 'image capability names a safe recovery path');

const trending = source('src/lib/trendingContent.ts');
check(trending.includes("await import('./llmProviders')"), 'trend enrichment lazy-loads the canonical provider client');
check(trending.includes('webSearchViaOpenRouter'), 'trend enrichment uses server-side OpenRouter search');
check(trending.includes('Connect or verify an OpenRouter key in Marketplace'), 'trend enrichment failure is actionable');

const wordpress = source('src/lib/wordpressChatCommands.ts');
check(!wordpress.includes('responseModalities'), 'WordPress has no in-browser model image generation');
check(wordpress.includes('accepts an explicit URL'), 'WordPress documents the explicit image URL boundary');

const helius = source('src/lib/heliusTrading.ts');
check(helius.includes("p_provider: 'helius'"), 'Helius retains authenticated BYOK lookup/storage');
check(helius.includes('no browser environment fallback'), 'Helius documents the no-public-env boundary');
const tradingPanel = source('src/components/TradingBotPanel.tsx');
check(tradingPanel.includes('Add your Helius API key in Integrations'), 'Helius UI recovery directs the user to Integrations');

console.log(`browser provider-key boundary smoke passed (${assertions} assertions)`);
