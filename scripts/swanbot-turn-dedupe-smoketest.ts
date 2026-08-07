/**
 * swanbot-turn-dedupe-smoketest — locks down the client-side duplicate
 * turn guard that prevents repeated UI submits from launching duplicate
 * SwanBot runs while the first identical turn is in flight or has just
 * completed.
 *
 * Pure runner path: no Supabase calls, no model calls.
 * Run: npm run smoke:swanbot-turn-dedupe
 */

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem(key: string) { return store[key] ?? null; },
  setItem(key: string, value: string) { store[key] = String(value); },
  removeItem(key: string) { delete store[key]; },
  clear() { for (const key of Object.keys(store)) delete store[key]; },
};

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string) {
  if (condition) pass(message);
  else fail(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function main() {
  const {
    SWANBOT_TURN_DEDUPE_TTL_MS,
    buildSwanBotTurnDedupeKey,
    __getSwanBotCompletedTurnCountForTests,
    __getSwanBotInFlightTurnCountForTests,
    __resetSwanBotTurnDedupeForTests,
    runSwanBotTurnWithDuplicateGuard,
  } = await import('../src/lib/swanbotTurnDedupe');

  const baseContext = {
    userId: 'user_1',
    circleId: 'circle_1',
    model: 'claude-sonnet-4',
    conversationMessages: [
      { role: 'user' as const, content: 'previous ask' },
      { role: 'assistant' as const, content: 'previous answer' },
    ],
  };

  __resetSwanBotTurnDedupeForTests();

  assert(
    buildSwanBotTurnDedupeKey('text', '  open   Notes  ', baseContext)
      === buildSwanBotTurnDedupeKey('text', 'open Notes', baseContext),
    'key: normalizes message whitespace',
  );
  assert(
    buildSwanBotTurnDedupeKey('text', 'open Notes', baseContext)
      !== buildSwanBotTurnDedupeKey('structured', 'open Notes', baseContext),
    'key: separates text and structured response modes',
  );
  assert(
    buildSwanBotTurnDedupeKey('text', 'open Notes', baseContext)
      !== buildSwanBotTurnDedupeKey('text', 'open Notes', { ...baseContext, model: 'openai/gpt-4.1' }),
    'key: separates different model contexts',
  );
  assert(
    buildSwanBotTurnDedupeKey('text', 'open Notes', {
      ...baseContext,
      forceClientToolLoop: true,
      turnDedupeScope: 'agent-run:one',
    }) !== buildSwanBotTurnDedupeKey('text', 'open Notes', {
      ...baseContext,
      forceClientToolLoop: true,
      turnDedupeScope: 'agent-run:two',
    }),
    'key: receipt-bearing turns are isolated by immutable outer run scope',
  );
  assert(
    buildSwanBotTurnDedupeKey('text', 'open Notes', baseContext)
      !== buildSwanBotTurnDedupeKey('text', 'open Notes', {
        ...baseContext,
        forceClientToolLoop: true,
        executionSurfaceGuard: 'desktop_app_only',
      }),
    'key: execution mode and surface guard cannot alias ordinary text turns',
  );

  {
    const gate = deferred<string>();
    let calls = 0;
    const first = runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      return gate.promise;
    });
    const second = runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      return 'should not run';
    });

    assert(first === second, 'dedupe: same in-flight turn reuses the first promise');
    await Promise.resolve();
    assert(calls === 1, 'dedupe: duplicate runner is not executed');
    assert(__getSwanBotInFlightTurnCountForTests() === 1, 'dedupe: one in-flight entry while pending');

    gate.resolve('done');
    const [a, b] = await Promise.all([first, second]);
    assert(a === 'done' && b === 'done', 'dedupe: duplicate caller receives original result');

    await Promise.resolve();
    assert(__getSwanBotInFlightTurnCountForTests() === 0, 'dedupe: entry clears after completion');
    assert(__getSwanBotCompletedTurnCountForTests() === 1, 'dedupe: completed result is memoized briefly');

    const third = await runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      return 'fresh';
    });
    assert(third === 'done' && calls === 1, 'dedupe: same just-completed turn reuses cached result');

    const fourth = await runSwanBotTurnWithDuplicateGuard('text', 'open Calendar', baseContext, async () => {
      calls += 1;
      return 'fresh intent';
    });
    assert(fourth === 'fresh intent' && calls === 2, 'dedupe: different message after completion still runs');
  }

  {
    __resetSwanBotTurnDedupeForTests();
    const gate = deferred<string>();
    let calls = 0;
    const first = runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      return gate.promise;
    });
    const second = runSwanBotTurnWithDuplicateGuard('text', 'open Notes', { ...baseContext, model: 'openai/gpt-4.1' }, async () => {
      calls += 1;
      return 'other model';
    });

    assert(first !== second, 'dedupe: different model contexts do not share a promise');
    await Promise.resolve();
    assert(calls === 2, 'dedupe: different context runner executes independently');
    gate.resolve('base model');
    const [base, other] = await Promise.all([first, second]);
    assert(base === 'base model' && other === 'other model', 'dedupe: independent contexts keep their own result');
  }

  {
    __resetSwanBotTurnDedupeForTests();
    let calls = 0;
    await runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      throw new Error('temporary failure');
    }).catch(() => null);
    assert(__getSwanBotCompletedTurnCountForTests() === 0, 'dedupe: failed turns are not memoized');
    const retried = await runSwanBotTurnWithDuplicateGuard('text', 'open Notes', baseContext, async () => {
      calls += 1;
      return 'retry ok';
    });
    assert(retried === 'retry ok' && calls === 2, 'dedupe: failed turns can retry immediately');
  }

  {
    __resetSwanBotTurnDedupeForTests();
    const gate = deferred<string>();
    let calls = 0;
    const protectedBase = {
      ...baseContext,
      forceClientToolLoop: true,
      completionExpectation: 'verified_task',
      executionSurfaceGuard: 'desktop_app_only',
    };
    const first = runSwanBotTurnWithDuplicateGuard(
      'text',
      'open Notes',
      { ...protectedBase, turnDedupeScope: 'agent-run:one' },
      async () => {
        calls += 1;
        return gate.promise;
      },
    );
    const second = runSwanBotTurnWithDuplicateGuard(
      'text',
      'open Notes',
      { ...protectedBase, turnDedupeScope: 'agent-run:two' },
      async () => {
        calls += 1;
        return 'second run proof';
      },
    );
    await Promise.resolve();
    assert(first !== second && calls === 2, 'dedupe: concurrent computer runs never share a receipt-bearing promise');
    gate.resolve('first run proof');
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert(firstResult === 'first run proof' && secondResult === 'second run proof', 'dedupe: cross-run proof stays with its owning run');

    let sameScopeCalls = 0;
    const sameScopeContext = { ...protectedBase, turnDedupeScope: 'agent-run:same' };
    const sameScopeFirst = await runSwanBotTurnWithDuplicateGuard('text', 'open Calendar', sameScopeContext, async () => {
      sameScopeCalls += 1;
      return 'owned proof';
    });
    const sameScopeSecond = await runSwanBotTurnWithDuplicateGuard('text', 'open Calendar', sameScopeContext, async () => {
      sameScopeCalls += 1;
      return 'must not run';
    });
    assert(sameScopeFirst === 'owned proof' && sameScopeSecond === 'owned proof' && sameScopeCalls === 1, 'dedupe: retry inside the same outer run may reuse its own result');
  }

  {
    __resetSwanBotTurnDedupeForTests();
    const realNow = Date.now;
    let fakeNow = 10_000;
    Date.now = () => fakeNow;
    try {
      const gate = deferred<string>();
      let calls = 0;
      const context = {
        ...baseContext,
        forceClientToolLoop: true,
        completionExpectation: 'verified_task',
        executionSurfaceGuard: 'desktop_app_only',
        turnDedupeScope: 'agent-run:long-native-task',
      };
      const first = runSwanBotTurnWithDuplicateGuard('text', 'create Photoshop document', context, async () => {
        calls += 1;
        return gate.promise;
      });
      await Promise.resolve();
      fakeNow += SWANBOT_TURN_DEDUPE_TTL_MS + 1;
      const afterTtl = runSwanBotTurnWithDuplicateGuard('text', 'create Photoshop document', context, async () => {
        calls += 1;
        return 'duplicate dispatch';
      });
      assert(first === afterTtl && calls === 1, 'dedupe: a long-running protected turn keeps exclusive ownership beyond the UI TTL');
      gate.resolve('single dispatch proof');
      const [a, b] = await Promise.all([first, afterTtl]);
      assert(a === 'single dispatch proof' && b === 'single dispatch proof', 'dedupe: the late same-run caller receives the original long task result');
    } finally {
      Date.now = realNow;
    }
  }

  {
    __resetSwanBotTurnDedupeForTests();
    let calls = 0;
    const unscopedProtected = {
      ...baseContext,
      forceClientToolLoop: true,
      completionExpectation: 'verified_task',
    };
    const first = await runSwanBotTurnWithDuplicateGuard('text', 'open Notes', unscopedProtected, async () => {
      calls += 1;
      return 'first unscoped proof';
    });
    const second = await runSwanBotTurnWithDuplicateGuard('text', 'open Notes', unscopedProtected, async () => {
      calls += 1;
      return 'second unscoped proof';
    });
    assert(first !== second && calls === 2, 'dedupe: unscoped computer callers bypass the cache instead of replaying proof');
    assert(__getSwanBotCompletedTurnCountForTests() === 0, 'dedupe: unscoped computer proof is never memoized');
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot turn-dedupe smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot turn-dedupe smoke cases passed.');
}

main().catch((error) => {
  console.error('smoke crashed:', error);
  process.exit(1);
});
