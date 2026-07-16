// chat-accuracy — a golden-case corpus module extending the deterministic eval
// net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe"). Like
// its siblings in this folder, it pins the exact OUTPUT of load-bearing PURE
// cores on FIXED inputs, so CI catches ANY behavioral drift with NO API keys, NO
// network, NO flakiness. If a consolidation changes what a core returns, a case
// here flips pass→fail and the smoke exits non-zero.
//
// Cores covered (each imported AT RUNTIME — that is the whole point, it exercises
// them — and each itself dependency-light + tsx-loadable, verified by probe):
//   • chatClarifyGateCore   — the high-precision "ask ONE question or just
//     proceed" gate that keeps SwanBot from either guessing wrong on an
//     under-specified action ("delete them") or interrogating the user.
//   • failureRecoveryCopyCore — raw-failure → friendly, SECRET-SAFE recovery copy
//     (title + message + next action + auto-retry decision) for the chat lane.
//
// Each case's `run()` calls the REAL core fn on a frozen input and returns true
// iff the output equals the GOLDEN value captured from that same core (never
// invented). Every golden here was probed from live core output on 2026-07-15.
// Pure-ASCII outputs (clarify questions/options/reasons, titles, manual actions,
// redactor output) are pinned by full `JSON.stringify` equality; outputs that
// carry typographic characters (em dash / curly quote / apostrophe in messages &
// auto-actions) are pinned by robust ASCII field + substring checks, so a
// copy-fidelity slip can never mask a real regression. Each `run()` is
// self-contained + total (throw-safe serializer / guarded field reads).

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import { decideChatClarify, isDestructiveActionPhrase } from '../../src/lib/chatClarifyGateCore';
import {
  buildFailureRecovery,
  classifyFailure,
  redactSecretsInError,
  AUTO_RETRY_MAX_ATTEMPT,
} from '../../src/lib/failureRecoveryCopyCore';

/** Throw-safe stable serializer for golden equality (cyclic → sentinel, never throws). */
const j = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return '__unstringifiable__';
  }
};

export const CASES: CoreGoldenCase[] = [
  // ── suite: chat-clarify-gate (chatClarifyGateCore.decideChatClarify) ─────────
  {
    id: 'chat-accuracy-clarify-delete-them-asks-destructive',
    suite: 'chat-clarify-gate',
    describe:
      'a contextless destructive coin-flip ("delete them") returns exactly ONE clarifying question with tappable options — never a silent guess',
    run: () =>
      j(decideChatClarify('delete them')) ===
      '{"shouldClarify":true,"question":"Which items do you want me to delete?","options":["Everything shown here","Only the ones I pick","Something else"],"reason":"destructive-target-missing"}',
  },
  {
    id: 'chat-accuracy-clarify-delete-them-thread-context-proceeds',
    suite: 'chat-clarify-gate',
    describe:
      'the SAME "delete them" inside an active thread does NOT clarify — prior context resolves the referent, so ongoing chats never stall',
    run: () =>
      j(decideChatClarify('delete them', { hasActiveThreadContext: true })) ===
      '{"shouldClarify":false,"question":"","options":[],"reason":"thread-context"}',
  },
  {
    id: 'chat-accuracy-clarify-attachment-proceeds',
    suite: 'chat-clarify-gate',
    describe: 'an attachment supplies the referent for "delete them" → proceed (attachment-context), no question',
    run: () =>
      j(decideChatClarify('delete them', { hasAttachment: true })) ===
      '{"shouldClarify":false,"question":"","options":[],"reason":"attachment-context"}',
  },
  {
    id: 'chat-accuracy-clarify-noninteractive-mode-proceeds',
    suite: 'chat-clarify-gate',
    describe: 'in a non-interactive mode (auto) there is no human to answer, so "delete them" proceeds instead of stalling',
    run: () =>
      j(decideChatClarify('delete them', { mode: 'auto' })) ===
      '{"shouldClarify":false,"question":"","options":[],"reason":"noninteractive-mode"}',
  },
  {
    id: 'chat-accuracy-clarify-specific-target-proceeds',
    suite: 'chat-clarify-gate',
    describe:
      'a destructive verb with a CONCRETE target ("delete the old_backup.zip file") is not a coin-flip → proceed (has-specifics), no question',
    run: () =>
      j(decideChatClarify('delete the old_backup.zip file')) ===
      '{"shouldClarify":false,"question":"","options":[],"reason":"has-specifics"}',
  },
  {
    id: 'chat-accuracy-clarify-deploy-bare-asks-env',
    suite: 'chat-clarify-gate',
    describe: 'a bare "deploy" with no environment asks WHICH environment, offering prod/staging/preview options',
    run: () =>
      j(decideChatClarify('deploy')) ===
      '{"shouldClarify":true,"question":"Which environment should I deploy to?","options":["Production","Staging","Preview","Something else"],"reason":"deploy-env-missing"}',
  },
  {
    id: 'chat-accuracy-clarify-build-bare-asks-subject',
    suite: 'chat-clarify-gate',
    describe: 'a bare build/create with no subject ("build it") asks WHAT to build rather than scaffolding a guess',
    run: () =>
      j(decideChatClarify('build it')) ===
      '{"shouldClarify":true,"question":"What would you like me to build?","options":["A web page or app","A script or automation","A document","Something else"],"reason":"build-subject-missing"}',
  },
  {
    id: 'chat-accuracy-clarify-update-the-post-asks-edit',
    suite: 'chat-clarify-gate',
    describe:
      'the canonical "update the post" shape (which one + what change both absent) asks the edit-target question with three options',
    run: () => {
      const d = decideChatClarify('update the post');
      return (
        d.shouldClarify === true &&
        d.reason === 'edit-target-or-change-missing' &&
        d.question === 'Which one should I update, and what change do you want?' &&
        Array.isArray(d.options) &&
        d.options.length === 3 &&
        d.options[1] === 'Let me name which one' &&
        d.options[2] === 'Something else'
      );
    },
  },
  {
    id: 'chat-accuracy-clarify-question-proceeds',
    suite: 'chat-clarify-gate',
    describe: 'an interrogative that merely mentions a destructive verb ("how do I delete a branch?") is a question → proceed, never treated as an action',
    run: () =>
      j(decideChatClarify('how do I delete a branch?')) ===
      '{"shouldClarify":false,"question":"","options":[],"reason":"question"}',
  },
  {
    id: 'chat-accuracy-clarify-destructive-phrase-helper',
    suite: 'chat-clarify-gate',
    describe:
      'isDestructiveActionPhrase flags a leading destructive action ("delete them") but NOT a how-to question or a safe/read verb',
    run: () =>
      isDestructiveActionPhrase('delete them') === true &&
      isDestructiveActionPhrase('how do I delete a branch') === false &&
      isDestructiveActionPhrase('summarize this') === false,
  },

  // ── suite: failure-recovery-copy (failureRecoveryCopyCore) ──────────────────
  {
    id: 'chat-accuracy-recovery-network-transient-autoretry',
    suite: 'failure-recovery-copy',
    describe:
      'a transient network failure ("Failed to fetch") on the first attempt yields friendly copy AND autoRetry=true (silently re-run, do not bother the user)',
    run: () => {
      const r = buildFailureRecovery(new Error('Failed to fetch'));
      return (
        r.class === 'network' &&
        r.autoRetry === true &&
        r.retryable === true &&
        r.title === 'Connection problem' &&
        typeof r.message === 'string' &&
        r.message.includes('reach the server') &&
        typeof r.action === 'string' &&
        r.action.includes('try again automatically')
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-autoretry-exhausted-manual',
    suite: 'failure-recovery-copy',
    describe:
      'auto-retry stops at AUTO_RETRY_MAX_ATTEMPT: attempt 0 auto-retries but attempt=max flips autoRetry off and surfaces the manual action',
    run: () => {
      const fresh = buildFailureRecovery(new Error('Failed to fetch'), { attempt: 0 });
      const exhausted = buildFailureRecovery(new Error('Failed to fetch'), { attempt: AUTO_RETRY_MAX_ATTEMPT });
      return (
        fresh.autoRetry === true &&
        exhausted.autoRetry === false &&
        exhausted.class === 'network' &&
        exhausted.retryable === true &&
        exhausted.action === 'Check your internet connection, then tap Retry.'
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-bridge-offline-not-transient',
    suite: 'failure-recovery-copy',
    describe:
      'a local-bridge-down failure is retryable but NOT transient → autoRetry=false with the concrete "start it with npm run bridge" action',
    run: () => {
      const r = buildFailureRecovery('Desktop bridge offline.');
      return (
        r.class === 'bridge_offline' &&
        r.autoRetry === false &&
        r.retryable === true &&
        r.title === 'Desktop bridge not connected' &&
        r.action === 'Start it with `npm run bridge`, then tap Retry.' &&
        typeof r.message === 'string' &&
        r.message.includes('local bridge')
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-model-config-not-retryable',
    suite: 'failure-recovery-copy',
    describe:
      'a model-config dead-end ("unsupported model") is NOT retryable and never auto-retries — the user must pick another model',
    run: () => {
      const r = buildFailureRecovery('unsupported model: foo-bar-9000');
      return (
        r.class === 'model_config' &&
        r.retryable === false &&
        r.autoRetry === false &&
        r.title === 'Model not available here' &&
        r.action === 'Pick a different model, then try again.'
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-secret-never-echoed',
    suite: 'failure-recovery-copy',
    describe:
      'SECRET-SAFE: a bearer/vendor token embedded in the raw error never survives into ANY field of the user-facing recovery copy',
    run: () => {
      const r = buildFailureRecovery(
        new Error('request failed with Authorization: Bearer sk-ant-abc123def456ghi789'),
      );
      const blob = j(r);
      return (
        typeof r.message === 'string' &&
        r.message.length > 0 &&
        !blob.includes('sk-ant') &&
        !blob.includes('abc123def456ghi789') &&
        !blob.includes('Bearer')
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-redact-bearer-masks',
    suite: 'failure-recovery-copy',
    describe:
      'redactSecretsInError masks a bearer/vendor-key value to [redacted] while preserving surrounding text — no secret substring survives',
    run: () => {
      const out = redactSecretsInError('request failed Authorization: Bearer sk-ant-abc123def456ghi789 done');
      return (
        out === 'request failed Authorization: [redacted] done' &&
        !out.includes('sk-ant') &&
        !out.includes('Bearer')
      );
    },
  },
  {
    id: 'chat-accuracy-recovery-classify-first-match',
    suite: 'failure-recovery-copy',
    describe:
      'classifyFailure is deterministic first-match across the load-bearing classes: network / rate_limit(429) / bridge_offline / model_config / edge_5xx(500)',
    run: () =>
      classifyFailure('Failed to fetch') === 'network' &&
      classifyFailure({ status: 429 }) === 'rate_limit' &&
      classifyFailure('Desktop bridge offline.') === 'bridge_offline' &&
      classifyFailure('unsupported model') === 'model_config' &&
      classifyFailure({ status: 500 }) === 'edge_5xx',
  },
];
