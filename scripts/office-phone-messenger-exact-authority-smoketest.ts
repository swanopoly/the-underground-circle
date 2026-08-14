import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';

const serviceSource = fs.readFileSync('src/lib/imessageService.ts', 'utf8');
const componentSource = fs.readFileSync('src/components/PhoneMessenger.tsx', 'utf8');
let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
  console.log(`  ok  ${message}`);
}

const metadata = new Map<string, string>();
const secrets = new Map<string, string>();
const tokenOwners = new Map([
  ['token-a', 'user-a'],
  ['token-b', 'user-b'],
]);
let authGate: Promise<void> | null = null;

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithPhoneAuthorityStubs(
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
) {
  const fromPhoneService = parent?.filename?.endsWith('/src/lib/imessageService.ts')
    || parent?.filename?.endsWith('/src/lib/imessageService.js');
  if (fromPhoneService && request === './storage') {
    return {
      storage: {
        getItem: async (key: string) => metadata.get(key) ?? null,
        setItem: async (key: string, value: string) => { metadata.set(key, value); },
        removeItem: async (key: string) => { metadata.delete(key); },
      },
    };
  }
  if (fromPhoneService && request === './localSecrets') {
    return {
      readVerifiedLocalSecret: async (namespace: string, id: string) => {
        const key = `${namespace}:${id}`;
        return secrets.has(key)
          ? { status: 'found', value: secrets.get(key) }
          : { status: 'missing' };
      },
      writeVerifiedLocalSecret: async (namespace: string, id: string, value: string) => {
        secrets.set(`${namespace}:${id}`, value);
        return secrets.get(`${namespace}:${id}`) === value;
      },
      deleteVerifiedLocalSecret: async (namespace: string, id: string) => {
        secrets.delete(`${namespace}:${id}`);
        return !secrets.has(`${namespace}:${id}`);
      },
    };
  }
  if (fromPhoneService && request === './authSession') {
    return {
      safeGetUserForAccessToken: async (token: string) => {
        if (authGate) await authGate;
        const id = tokenOwners.get(token);
        return id
          ? { value: { id }, error: null }
          : { value: null, error: new Error('invalid token') };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const authorityA = Object.freeze({
  userId: 'user-a',
  circleId: 'circle-a',
  accessToken: 'token-a',
  generation: 1,
});
const authorityB = Object.freeze({
  userId: 'user-b',
  circleId: 'circle-a',
  accessToken: 'token-b',
  generation: 2,
});
let currentAuthority = authorityA;
const isCurrent = (authority: typeof authorityA) => (
  authority.userId === currentAuthority.userId
  && authority.circleId === currentAuthority.circleId
  && authority.accessToken === currentAuthority.accessToken
  && authority.generation === currentAuthority.generation
);

async function main() {
  const service = await import('../src/lib/imessageService');

  console.log('Exact config and credential scope');
  const keyA = service.phoneMessengerConfigStorageKey(authorityA);
  const keyB = service.phoneMessengerConfigStorageKey(authorityB);
  check(keyA !== keyB, 'two users in one circle receive different config keys');
  check(keyA.includes('user-a') && keyA.includes('circle-a'), 'config key binds exact user and circle');
  check(!keyA.includes('token-a'), 'captured bearer never enters the durable config key');
  check(
    service.phoneMessengerSecretId(authorityA, 'telegramBotToken').includes('user-a:circle-a'),
    'credential id binds exact user and circle',
  );

  await service.saveConfig(
    { platform: 'telegram', telegramBotToken: 'secret-a', telegramChatId: 'chat-a' },
    authorityA,
    isCurrent,
  );
  const envelope = JSON.parse(metadata.get(keyA)!);
  check(envelope.schemaVersion === 2, 'saved config uses the exact-scope schema');
  check(envelope.userId === 'user-a' && envelope.circleId === 'circle-a', 'saved metadata repeats exact ownership');
  check(!metadata.get(keyA)?.includes('secret-a'), 'provider credential is absent from metadata storage');
  check(
    secrets.get('phone_messenger_v2:user-a:circle-a:telegramBotToken') === 'secret-a',
    'provider credential uses only the exact local-secret id',
  );

  const loaded = await service.loadConfig(authorityA, isCurrent);
  check(loaded?.telegramBotToken === 'secret-a' && loaded.telegramChatId === 'chat-a', 'exact owner reloads config and credential');
  currentAuthority = authorityB;
  const other = await service.loadConfig(authorityB, isCurrent as any);
  check(other === null, 'another account in the same circle cannot read the config');

  console.log('Ownerless legacy isolation');
  currentAuthority = authorityA;
  await service.clearConfig(authorityA, isCurrent);
  metadata.set('@phone_messenger_config', JSON.stringify({ platform: 'telegram', telegramChatId: 'legacy' }));
  secrets.set('phone_messenger:telegramBotToken', 'legacy-secret');
  const legacy = await service.loadConfig(authorityA, isCurrent);
  check(legacy === null, 'exact loader never imports ownerless legacy config');
  check(metadata.has('@phone_messenger_config'), 'exact clear never mutates ownerless legacy config');
  check(secrets.has('phone_messenger:telegramBotToken'), 'exact clear never mutates ownerless legacy credentials');

  console.log('Bearer verification and retirement fencing');
  let releaseAuth!: () => void;
  authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
  const delayed = service.loadConfig(authorityA, isCurrent);
  await Promise.resolve();
  currentAuthority = authorityB;
  releaseAuth();
  await assert.rejects(delayed, (error: any) => error?.code === 'authority_retired');
  assertions += 1;
  authGate = null;
  console.log('  ok  account switch during bearer verification drops the late result');

  currentAuthority = authorityA;
  await assert.rejects(
    service.loadConfig({ ...authorityA, accessToken: 'token-b' }, () => true),
    (error: any) => error?.code === 'authority_mismatch',
  );
  assertions += 1;
  console.log('  ok  mismatched bearer subject fails closed');

  console.log('Provider call cancellation and result fence');
  const originalFetch = globalThis.fetch;
  let seenSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenSignal = init?.signal || undefined;
    currentAuthority = authorityB;
    return new Response(JSON.stringify({ ok: true, result: { id: 'bot-a' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  const controller = new AbortController();
  await assert.rejects(
    service.testConnection(
      { platform: 'telegram', telegramBotToken: 'secret-a' },
      authorityA,
      isCurrent,
      controller.signal,
    ),
    (error: any) => error?.code === 'authority_retired',
  );
  assertions += 1;
  check(seenSignal === controller.signal, 'provider fetch receives the caller cancellation signal');
  globalThis.fetch = originalFetch;

  console.log('Component lifecycle boundary');
  check(componentSource.includes('exactAuthority: PhoneMessengerExactAuthority | null'), 'component requires captured exact authority');
  check(componentSource.includes('isExactAuthorityCurrent: PhoneMessengerAuthorityFence'), 'component requires a current-authority fence');
  check(componentSource.includes('<PhoneMessengerAuthoritySession'), 'authority-scoped child owns private UI state');
  check(componentSource.includes('if (!props.visible || !authority || !authorityIsCurrent) return null'), 'retirement synchronously unmounts private UI state');
  check(componentSource.includes('lifecycleController.abort()'), 'unmount cancels in-flight provider operations');
  check(componentSource.includes('setCompose(\'\')'), 'disconnect clears the message draft');
  check(componentSource.includes('userId: capturedAuthority.userId'), 'unread callback carries exact user metadata');
  check(componentSource.includes('circleId: capturedAuthority.circleId'), 'unread callback carries exact circle metadata');
  check(!serviceSource.includes("readLocalSecret('phone_messenger'"), 'service never reads ownerless legacy credentials');
  check(!serviceSource.includes("storage.getItem(STORAGE_KEY)"), 'service never reads the ownerless legacy config key');
  check((serviceSource.match(/signal: operation\.signal/g) || []).length >= 4, 'every provider transport family carries cancellation');
  check((serviceSource.match(/safeGetUserForAccessToken\(authority\.accessToken\)/g) || []).length === 1, 'all public operations pass through one captured-bearer verifier');

  console.log(`\n${assertions} assertions passed.`);
}

main().finally(() => {
  (Module as any)._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
