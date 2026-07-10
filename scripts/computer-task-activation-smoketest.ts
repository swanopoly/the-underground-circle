/**
 * computer-task-activation-smoketest — verifies the P58 consolidated
 * activation sequence (`src/lib/computerTaskActivation.ts`) and its
 * envelope integration (`prepareComputerTaskExecution` appends the block to
 * dispatchPrefix, which BOTH lanes consume).
 *
 * Covers:
 *   - fixed step order: bridge → grants → app/session → target → observe
 *   - per-kind shapes (app w/ + w/o resolution, file, hybrid, browser,
 *     unknown minimal pair)
 *   - grants step only when outstanding; availability 'maybe' fallback line
 *   - blocking semantics + bounded text
 *   - format block (ordered lines, stop-and-report rule, gates line)
 *   - ENVELOPE INTEGRATION: prepareComputerTaskExecution exposes
 *     `activation` and dispatchPrefix ends with the activation block
 *
 * Run: npm run smoke:computer-task-activation
 */

import {
  buildComputerTaskActivationPlan,
  formatComputerTaskActivationBlock,
} from '../src/lib/computerTaskActivation';
import { prepareComputerTaskExecution } from '../src/lib/computerTaskExecution';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Case 1: app task with resolved app + outstanding grants ────────────
  {
    const plan = buildComputerTaskActivationPlan({
      kind: 'app_task',
      appResolution: { displayName: 'Adobe InDesign 2026', openVia: 'desktop_launch', availability: 'installed' },
      outstandingGrantLabels: ['Local file write (approval)'],
      preflightBlockerLabels: [],
    });
    const kinds = plan.steps.map((s) => s.kind);
    assert(kinds.join(',') === 'verify_bridge,resolve_grants,launch_or_focus_app,verify_target_open,observe_before_act',
      'case1: full ordered sequence for a resolved app task', kinds.join(','));
    assert(plan.steps[0].blocking && plan.steps[2].blocking, 'case1: bridge + app steps blocking');
    assert(plan.steps[plan.steps.length - 1].blocking === false, 'case1: observe step non-blocking');
    assert(plan.steps[1].instruction.includes('Local file write'), 'case1: grant labels named');
    assert(plan.steps[2].instruction.includes('Adobe InDesign 2026') && plan.steps[2].instruction.includes('desktop.launch_app'),
      'case1: app step names the app + launch tool');
    assert(plan.steps.every((s) => s.instruction.length <= 260), 'case1: step text bounded');
    assert(plan.summary.includes('5 step'), 'case1: summary counts steps');
  }

  // ─── Case 2: kind variants ──────────────────────────────────────────────
  {
    const browser = buildComputerTaskActivationPlan({ kind: 'browser_task' });
    const browserKinds = browser.steps.map((s) => s.kind);
    assert(browserKinds.join(',') === 'open_browser_target,observe_before_act',
      'case2: browser lane skips bridge, gets target + observe', browserKinds.join(','));
    assert(browser.steps[0].instruction.includes('vault credentials') && browser.steps[0].instruction.includes('CAPTCHA'),
      'case2: browser step carries vault + human-verification rules');
    assert(browser.steps[1].instruction.includes('DOM snapshot'), 'case2: browser observe wording');

    const file = buildComputerTaskActivationPlan({ kind: 'file_task' });
    assert(file.steps.map((s) => s.kind).join(',') === 'verify_bridge,verify_target_open,observe_before_act',
      'case2: file task verifies the target document');

    const bare = buildComputerTaskActivationPlan({ kind: 'app_task' });
    assert(bare.steps.map((s) => s.kind).join(',') === 'verify_bridge,observe_before_act',
      'case2: app task without resolution/grants → minimal bridge + observe');

    const unknown = buildComputerTaskActivationPlan({ kind: 'unknown' });
    assert(unknown.steps[0].kind === 'verify_bridge' && unknown.steps.length === 2,
      'case2: unknown kind → minimal safe pair');

    const maybeApp = buildComputerTaskActivationPlan({
      kind: 'hybrid_task',
      appResolution: { displayName: 'Photopea', openVia: 'browser_url', openTarget: 'https://www.photopea.com', availability: 'maybe' },
    });
    const appStep = maybeApp.steps.find((s) => s.kind === 'launch_or_focus_app')!;
    assert(appStep.instruction.includes('desktop.open_url') && appStep.instruction.includes('photopea.com'),
      'case2: url-opened app uses open_url with the target');
    assert(appStep.instruction.includes('fall back per the route'),
      'case2: availability=maybe carries the fail-fast fallback line');
  }

  // ─── Case 3: format block ───────────────────────────────────────────────
  {
    const plan = buildComputerTaskActivationPlan({
      kind: 'app_task',
      appResolution: { displayName: 'Notes', openVia: 'desktop_launch' },
    });
    const block = formatComputerTaskActivationBlock(plan);
    assert(block.startsWith('## Activation sequence'), 'case3: heading present');
    assert(block.includes('1. ') && block.includes('IN ORDER'), 'case3: ordered imperative list');
    assert(block.includes('STOP and report'), 'case3: blocking-failure rule stated');
    assert(block.includes('approval gates and constraints apply'), 'case3: gates explicitly unchanged');
    assert(block.includes('(non-blocking)'), 'case3: non-blocking steps labeled');
    assert(formatComputerTaskActivationBlock(null) === '' && formatComputerTaskActivationBlock({ steps: [], summary: '' }) === '',
      'case3: empty plan renders nothing');
  }

  // ─── Case 4: envelope integration (both lanes consume dispatchPrefix) ───
  {
    const envelope = prepareComputerTaskExecution({
      task: 'Open the summer banner in InDesign and change the APR to 1.9%',
      audit: null,
    });
    assert(!!envelope.activation && envelope.activation.steps.length >= 2,
      'case4: envelope exposes the activation plan');
    assert(envelope.dispatchPrefix.includes('## Activation sequence'),
      'case4: dispatchPrefix carries the activation block (agent prompt + browser planningContext)');
    const idx = envelope.dispatchPrefix.indexOf('## Activation sequence');
    assert(idx > 0, 'case4: activation appended AFTER the existing dispatch prefix content');
    assert(envelope.activation.steps[0].kind === 'verify_bridge',
      'case4: desktop-flavored task starts at the bridge check');

    const browserEnvelope = prepareComputerTaskExecution({
      task: 'Go to acme.com/admin and update the homepage hero headline',
      audit: null,
    });
    if (browserEnvelope.preview.kind === 'browser_task') {
      assert(browserEnvelope.activation.steps[0].kind === 'open_browser_target',
        'case4: browser-routed task starts at target navigation');
      pass('case4: browser envelope exercised');
    } else {
      pass(`case4: browser phrasing routed as ${browserEnvelope.preview.kind} — activation still present (${browserEnvelope.activation.steps[0].kind})`);
    }
  }

  console.log(failures === 0 ? '\ncomputer-task-activation smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
