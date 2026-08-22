import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  abortRecording,
  appendStep,
  buildStep,
  deleteRecording,
  getActiveSession,
  getRecording,
  listRecordings,
  startRecording,
  stopRecording,
} from '../src/lib/chatRecording';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

(globalThis as { localStorage?: MemoryStorage }).localStorage = new MemoryStorage();

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const connectedResources = source('src/lib/connectedResourcesRuntime.ts');
const swanbot = source('src/lib/swanbot.ts');
const toolRuntime = source('src/lib/openswanToolRuntime.ts');
const customModels = source('src/lib/customModels.ts');
const userTemplates = source('src/lib/computerUseUserTemplates.ts');
const searchModal = source('src/components/SearchModal.tsx');
const authLogout = source('src/lib/authLogout.ts');

assert.match(connectedResources, /userId\?: string \| null/);
assert.match(connectedResources, /if \(!userId\) return null/);
assert.match(connectedResources, /encodeURIComponent\(userId\).*encodeURIComponent\(circleId\)/s);
assert.match(swanbot, /buildConnectedResourcesContextBlock\(\{[\s\S]*?userId: context\.userId/);
assert.equal(
  (toolRuntime.match(/const snapshotKey = `\$\{String\(context\.userId/g) || []).length,
  2,
  'both desktop accessibility snapshot lanes include the authenticated user',
);

assert.match(customModels, /@custom_hf_models_v2:/);
assert.match(customModels, /removeItem\(LEGACY_OWNERLESS_STORAGE_KEY\)/);
assert.doesNotMatch(customModels, /apiKey\?: string/);
assert.match(userTemplates, /uc_saved_cu_templates_v2:/);
assert.match(userTemplates, /storageKeyForUser\(userId/);
assert.match(searchModal, /uc_omnibar_query_v2:/);
assert.match(searchModal, /removeItem\(legacyQueryStorageKey\)/);
assert.match(authLogout, /clearAgentCollaborationSessionState/);
assert.match(authLogout, /uc_compacted_context_/);
assert.match(authLogout, /uc_build_convo_v1:/);

const ownerA = { userId: 'user-a', circleId: 'circle-a' } as const;
const ownerB = { userId: 'user-b', circleId: 'circle-a' } as const;
assert.equal(startRecording({ ...ownerA, name: 'private workflow' }).ok, true);
appendStep(buildStep({
  tool: 'desktop.type_text',
  input: { text: 'private account text' },
  result: { ok: true },
}), ownerA);

assert.equal(getActiveSession(ownerB), null, 'another account cannot read the active recording');
appendStep(buildStep({
  tool: 'desktop.type_text',
  input: { text: 'foreign append' },
  result: { ok: true },
}), ownerB);
assert.equal(getActiveSession(ownerA)?.steps.length, 1, 'another account cannot append to the recording');
assert.equal(stopRecording(ownerB).ok, false, 'another account cannot stop and persist it');
assert.deepEqual(abortRecording(ownerB), { ok: true, discardedSteps: 0 });

assert.equal(stopRecording({ ...ownerA, description: 'private' }).ok, true);
assert.equal(listRecordings(ownerB).length, 0, 'another account cannot list saved recordings');
assert.equal(getRecording('private workflow', ownerB), null, 'another account cannot fetch by known slug');
assert.equal(deleteRecording('private workflow', ownerB), false, 'another account cannot delete it');
assert.equal(listRecordings(ownerA).length, 1, 'the exact owner retains the recording');

console.log('local-device-account-isolation smoke: 25 assertions passed');
