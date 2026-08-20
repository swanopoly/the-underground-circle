/**
 * Focused source contract for the Office PixelAgent lifecycle.
 *
 * React Native Web's Animated.Value mutations dispatch animated-props updates.
 * A full Office floor performing those writes from passive-effect setup or
 * cleanup can therefore re-enter React until it reaches the nested-update
 * limit. Web PixelAgents stay static; native effects retain their explicit
 * animation owners and cleanup owns cancellation only.
 *
 * Run: npx tsx scripts/office-pixel-agent-lifecycle-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { animLoop } from '../src/lib/animationHelpers';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pixelAgent = read('src/screens/circles/tabs/office/PixelAgent.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const canary = read('scripts/office-authenticated-local-e2e.mjs');
const animationHelpers = read('src/lib/animationHelpers.ts');

type AnimationCompletion = (result: { finished: boolean }) => void;
type FakeAnimation = {
  start: (completion?: AnimationCompletion) => void;
  stop: () => void;
  completion: AnimationCompletion | null;
  starts: number;
  stops: number;
};

const fakeAnimations: FakeAnimation[] = [];
const loop = animLoop(() => {
  const animation: FakeAnimation = {
    completion: null,
    starts: 0,
    stops: 0,
    start(completion) {
      this.starts += 1;
      this.completion = completion || null;
    },
    stop() {
      this.stops += 1;
    },
  };
  fakeAnimations.push(animation);
  return animation as unknown as Parameters<typeof animLoop>[0] extends () => infer T ? T : never;
});

loop.start();
assert.equal(fakeAnimations.length, 1, 'animLoop creates its first active animation');
const firstAnimation = fakeAnimations[0];
loop.start();
assert.equal(firstAnimation.stops, 1, 'restarting animLoop cancels the previously active animation');
assert.equal(fakeAnimations.length, 2, 'restarting animLoop owns one replacement animation');
firstAnimation.completion?.({ finished: true });
assert.equal(fakeAnimations.length, 2, 'a stale completion cannot restart an older loop generation');

const secondAnimation = fakeAnimations[1];
secondAnimation.completion?.({ finished: true });
assert.equal(fakeAnimations.length, 3, 'the current completed animation advances the loop');
const thirdAnimation = fakeAnimations[2];
loop.stop();
assert.equal(thirdAnimation.stops, 1, 'stopping animLoop cancels its active CompositeAnimation');
thirdAnimation.completion?.({ finished: true });
assert.equal(fakeAnimations.length, 3, 'a completion delivered after stop cannot resurrect the loop');

assert(
  animationHelpers.includes('let generation = 0;')
    && animationHelpers.includes('activeGeneration !== generation')
    && animationHelpers.includes('let activeAnimation: Animated.CompositeAnimation | null = null;')
    && animationHelpers.includes('animation?.stop();'),
  'animLoop retains an explicit active-animation owner and generation fence',
);

const sourceFile = ts.createSourceFile(
  'PixelAgent.tsx',
  pixelAgent,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const stateSetters = new Set<string>();
const cleanupFunctions: ts.FunctionLikeDeclaration[] = [];
const webUnguardedEffectWrites: string[] = [];

function visitForStateSetters(node: ts.Node): void {
  if (
    ts.isVariableDeclaration(node)
    && ts.isArrayBindingPattern(node.name)
    && node.initializer
    && ts.isCallExpression(node.initializer)
    && ts.isIdentifier(node.initializer.expression)
    && node.initializer.expression.text === 'useState'
  ) {
    const setter = node.name.elements[1]?.name;
    if (setter && ts.isIdentifier(setter)) stateSetters.add(setter.text);
  }
  ts.forEachChild(node, visitForStateSetters);
}

function visitForEffectCleanups(node: ts.Node): void {
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'useEffect'
  ) {
    const effect = node.arguments[0];
    if (effect && (ts.isArrowFunction(effect) || ts.isFunctionExpression(effect)) && ts.isBlock(effect.body)) {
      let hasAnimatedValueWrite = false;
      const findAnimatedValueWrites = (candidate: ts.Node): void => {
        if (
          ts.isCallExpression(candidate)
          && ts.isPropertyAccessExpression(candidate.expression)
          && candidate.expression.name.text === 'setValue'
        ) hasAnimatedValueWrite = true;
        ts.forEachChild(candidate, findAnimatedValueWrites);
      };
      findAnimatedValueWrites(effect.body);
      if (hasAnimatedValueWrite) {
        const firstStatement = effect.body.statements[0];
        const guard = firstStatement?.getText(sourceFile) || '';
        if (
          guard !== 'if (webAnimationEffectsDisabled) return;'
          && guard !== "if (Platform.OS === 'web') return;"
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(effect.getStart(sourceFile)).line + 1;
          webUnguardedEffectWrites.push(`PixelAgent.tsx:${line}`);
        }
      }
      for (const statement of effect.body.statements) {
        if (
          ts.isReturnStatement(statement)
          && statement.expression
          && (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression))
        ) {
          cleanupFunctions.push(statement.expression);
        }
      }
    }
  }
  ts.forEachChild(node, visitForEffectCleanups);
}

visitForStateSetters(sourceFile);
visitForEffectCleanups(sourceFile);

assert(cleanupFunctions.length >= 10, 'PixelAgent lifecycle cleanups were discovered from the TSX source');

const forbiddenCleanupCalls: string[] = [];
for (const cleanup of cleanupFunctions) {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'setValue') {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        forbiddenCleanupCalls.push(`Animated.Value.setValue at PixelAgent.tsx:${line}`);
      }
      if (ts.isIdentifier(callee) && stateSetters.has(callee.text)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        forbiddenCleanupCalls.push(`${callee.text} at PixelAgent.tsx:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cleanup);
}

assert.deepEqual(
  forbiddenCleanupCalls,
  [],
  'passive effect cleanup cancels animation/timer owners without dispatching Animated.Value or React state updates',
);
assert.deepEqual(
  webUnguardedEffectWrites,
  [],
  'every passive effect that writes an Animated.Value exits before doing so on React Native Web',
);
assert(
  pixelAgent.includes("const webAnimationEffectsDisabled = Platform.OS === 'web';")
    && pixelAgent.includes('const motionDisabled = reduceMotionPreference === true || webAnimationEffectsDisabled;'),
  'web PixelAgents use their rest-value construction state instead of RN Animated effect resets',
);

const idleLifeStart = pixelAgent.indexOf('// Idle life — bob / breathe / sway / look.');
const idleLifeEnd = pixelAgent.indexOf('// Limb fidget', idleLifeStart);
assert(idleLifeStart >= 0 && idleLifeEnd > idleLifeStart, 'the PixelAgent idle-life effect remains source-addressable');
const idleLife = pixelAgent.slice(idleLifeStart, idleLifeEnd);
assert(
  idleLife.includes('loops.forEach((loop) => loop.start());')
    && idleLife.includes('loops.forEach((loop) => loop.stop());'),
  'idle-life loop startup has paired teardown',
);
const idleCleanup = idleLife.slice(idleLife.indexOf('return () =>'));
assert(!idleCleanup.includes('.setValue('), 'idle-life teardown never resets animated values during passive cleanup');

const memoStart = pixelAgent.indexOf('const PixelAgent = memo(PixelAgentInner');
const memoEnd = pixelAgent.indexOf('export default PixelAgent;', memoStart);
assert(memoStart >= 0 && memoEnd > memoStart, 'the PixelAgent memo comparator remains source-addressable');
const memoComparator = pixelAgent.slice(memoStart, memoEnd);
for (const prop of ['scale', 'xpNext', 'onAutomate', 'onPress', 'reduceMotion']) {
  assert(
    memoComparator.includes(`prev.${prop} === next.${prop}`),
    `PixelAgent memoization refreshes the used ${prop} prop`,
  );
}

assert(
  office.includes('const handleAgentPress = useCallback((agentId: string) => {')
    && office.includes('key={agent.id}')
    && office.includes('onPress={handleAgentPress}'),
  'Office keeps one stable, exact-id PixelAgent popup opener across floor rerenders',
);

assert(
  canary.includes("page.on('console', (message) => {")
    && canary.includes("if (message.type() !== 'error') return;")
    && canary.includes('record.popupConsoleCaptureActive')
    && canary.includes('else record.popupConsoleErrors.push(evidence);')
    && canary.includes('if (popupConsoleErrors.length > 0) {'),
  'the authenticated popup canary fails React console errors while the popup is mounted',
);
assert(
  canary.includes("id: 'missing-favicon'")
    && canary.includes('function assertNoReactUpdateLoopErrors(record, label)')
    && canary.includes('/Maximum update depth exceeded|Too many re-renders/i')
    && !canary.includes('maximum-update-depth')
    && !canary.includes('Maximum update depth exceeded.*allow'),
  'the live canary never allowlists the PixelAgent update-depth failure',
);

console.log(`office PixelAgent lifecycle smoke passed (${cleanupFunctions.length} cleanup owners checked)`);
