// evals/corpus/approval-attach — a golden-case corpus module extending the
// deterministic, model-free tier-1 regression net (see ../coreGoldenCorpus and
// docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe").
//
// This module pins the highest-signal invariants of two PURE, tsx-loadable
// cores that guard the approval + attachment safety surfaces:
//   • src/lib/approvalPreviewCore  — pending-approval staleness classification
//     (fresh < 5 min ≤ stale < 30 min ≤ expired, fail-closed on unreadable age)
//     and the approval-card risk badge (read / write / destructive); and
//   • src/lib/attachmentPreflightCore — the pre-send attachment gate, whose
//     load-bearing SECURITY invariant is that a dangerous executable is still
//     blocked even when its name is long enough to be truncated for display
//     (the extension-preserving truncation fixed this session).
//
// Each case runs the REAL core fn on a FROZEN input and returns true iff the
// output equals the value captured from the real core (never invented). Ids are
// globally-unique CI anchors, all prefixed `approval-attach-`. This module is
// itself dependency-light: it imports only the two pure cores at runtime plus
// the `CoreGoldenCase` type, so it loads under tsx with no react-native /
// supabase / deno in the graph. No Date.now()/Math.random() at module scope.
//
// PURITY EXCEPTION (spec-sanctioned, same as the parent corpus): this module
// IMPORTS the cores at runtime — that is the whole point, it exercises them.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { classifyApprovalAge, buildApprovalPreview } from '../../src/lib/approvalPreviewCore';
import { preflightAttachments } from '../../src/lib/attachmentPreflightCore';

// ─── tiny local, dependency-free equality helper ──────────────────────────────
// The parent corpus keeps its `goldenEq` internal, and the contract for this
// module is to import ONLY the `CoreGoldenCase` type from it. So whole-object
// goldens are pinned by exact JSON string (key order matches the real core
// output, captured from a probe) — a total, self-contained boolean check.
function jsonEq(actual: unknown, goldenJson: string): boolean {
  try {
    return JSON.stringify(actual) === goldenJson;
  } catch {
    return false;
  }
}

/** The neutral empty/hostile-input result shared by several preflight cases. */
const NEUTRAL_PREFLIGHT_JSON = '{"ok":false,"acceptedCount":0,"rejected":[],"warning":null}';

// ─── The corpus ───────────────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ── suite: approval-preview (approvalPreviewCore) ────────────────────────────
  {
    id: 'approval-attach-age-fresh-under-5min',
    suite: 'approval-preview',
    describe: 'a pending approval younger than the 5-minute stale window classifies as fresh',
    run: () => classifyApprovalAge(60_000) === 'fresh',
  },
  {
    id: 'approval-attach-age-boundary-fresh-to-stale-at-5min',
    suite: 'approval-preview',
    describe: 'the fresh→stale cut is exactly APPROVAL_STALE_MS: 299_999ms is fresh, 300_000ms is stale',
    run: () => classifyApprovalAge(299_999) === 'fresh' && classifyApprovalAge(300_000) === 'stale',
  },
  {
    id: 'approval-attach-age-stale-mid-window',
    suite: 'approval-preview',
    describe: 'a 10-minute-old approval (inside the 5–30 min window) classifies as stale',
    run: () => classifyApprovalAge(600_000) === 'stale',
  },
  {
    id: 'approval-attach-age-boundary-stale-to-expired-at-30min',
    suite: 'approval-preview',
    describe: 'the stale→expired cut is exactly APPROVAL_EXPIRED_MS: 1_799_999ms is stale, 1_800_000ms is expired',
    run: () => classifyApprovalAge(1_799_999) === 'stale' && classifyApprovalAge(1_800_000) === 'expired',
  },
  {
    id: 'approval-attach-age-nonnumeric-fails-closed-expired',
    suite: 'approval-preview',
    describe: 'an unreadable / non-numeric age (null, undefined, garbage string, NaN) fails closed to expired so it is never silently reused',
    run: () =>
      classifyApprovalAge(null) === 'expired' &&
      classifyApprovalAge(undefined) === 'expired' &&
      classifyApprovalAge('not-a-number') === 'expired' &&
      classifyApprovalAge(Number.NaN) === 'expired',
  },
  {
    id: 'approval-attach-age-negative-clock-skew-fresh',
    suite: 'approval-preview',
    describe: 'a negative age (clock skew, approval appears to be in the future) is treated as fresh, not expired',
    run: () => classifyApprovalAge(-5_000) === 'fresh',
  },
  {
    id: 'approval-attach-risk-shell-destructive-vs-write',
    suite: 'approval-preview',
    describe: 'a shell command with a destructive word (rm -rf) is risk=destructive while a plain read command (ls -la) is risk=write',
    run: () =>
      buildApprovalPreview('local.run_shell', { argv: ['rm', '-rf', '/tmp/x'] }).risk === 'destructive' &&
      buildApprovalPreview('local.run_shell', { argv: ['ls', '-la'] }).risk === 'write',
  },
  {
    id: 'approval-attach-risk-name-and-send-mapping',
    suite: 'approval-preview',
    describe: 'the risk badge maps a read-verb tool name to read, an external-send tool/email-send to destructive, and an email draft to write',
    run: () =>
      buildApprovalPreview('memory.read', {}).risk === 'read' &&
      buildApprovalPreview('slack.send_message', { to: '#gen', text: 'hi' }).risk === 'destructive' &&
      buildApprovalPreview('gmail.write', { action: 'send', to: 'x@y.com', subject: 'Hi' }).risk === 'destructive' &&
      buildApprovalPreview('gmail.write', { action: 'draft', to: 'x@y.com' }).risk === 'write',
  },

  // ── suite: attachment-preflight (attachmentPreflightCore) ────────────────────
  {
    // THE headline security invariant (regression guard for the latent bug fixed
    // this session): a name long enough to be truncated for display must still
    // carry its extension so the executable stays blocked. A naive head-slice
    // would drop `.exe`, the danger check would miss it, and the file would be
    // ACCEPTED — flipping ok:false→true here.
    id: 'approval-attach-preflight-long-exe-name-still-dangerous',
    suite: 'attachment-preflight',
    describe: 'a 200+ char .exe filename (truncated for display) is STILL flagged dangerous and rejected — extension survives truncation',
    run: () => {
      const r = preflightAttachments([{ name: `${'z'.repeat(200)}.exe`, sizeBytes: 1000, mimeType: '' }]);
      const first = r.rejected[0];
      return (
        r.ok === false &&
        r.acceptedCount === 0 &&
        r.rejected.length === 1 &&
        !!first &&
        first.reason === ".exe files can't be attached for security"
      );
    },
  },
  {
    id: 'approval-attach-preflight-safe-png-allowed',
    suite: 'attachment-preflight',
    describe: 'a normal, in-size image (photo.png, image/png, 1 KB) is accepted with no rejections',
    run: () => {
      const r = preflightAttachments([{ name: 'photo.png', sizeBytes: 1000, mimeType: 'image/png' }]);
      return jsonEq(r, '{"ok":true,"acceptedCount":1,"rejected":[],"warning":null}');
    },
  },
  {
    id: 'approval-attach-preflight-short-exe-dangerous',
    suite: 'attachment-preflight',
    describe: 'a plainly-named executable (virus.exe) is rejected by the dangerous-extension gate',
    run: () => {
      const r = preflightAttachments([{ name: 'virus.exe', sizeBytes: 500, mimeType: '' }]);
      const first = r.rejected[0];
      return r.ok === false && r.acceptedCount === 0 && !!first && first.reason === ".exe files can't be attached for security";
    },
  },
  {
    id: 'approval-attach-preflight-dangerous-mime-backstop',
    suite: 'attachment-preflight',
    describe: 'an executable with an innocuous (extension-less) name but a dangerous MIME (application/x-msdownload) is caught by the MIME backstop',
    run: () => {
      const r = preflightAttachments([{ name: 'installer', sizeBytes: 500, mimeType: 'application/x-msdownload' }]);
      const first = r.rejected[0];
      return r.ok === false && r.acceptedCount === 0 && !!first && first.reason === "that file type can't be attached for security";
    },
  },
  {
    id: 'approval-attach-preflight-oversize-human-size-reason',
    suite: 'attachment-preflight',
    describe: 'an oversize 41 MB PDF is rejected with the human size copy "that PDF is 41 MB — max is 25 MB"',
    run: () => {
      const r = preflightAttachments([{ name: 'big.pdf', sizeBytes: 41 * 1024 * 1024, mimeType: 'application/pdf' }]);
      const first = r.rejected[0];
      return r.ok === false && r.acceptedCount === 0 && !!first && first.reason === 'that PDF is 41 MB — max is 25 MB';
    },
  },
  {
    id: 'approval-attach-preflight-empty-and-nonarray-neutral',
    suite: 'attachment-preflight',
    describe: 'an empty batch and a non-array (null) input both degrade to the neutral {ok:false, acceptedCount:0, rejected:[], warning:null}',
    run: () => jsonEq(preflightAttachments([]), NEUTRAL_PREFLIGHT_JSON) && jsonEq(preflightAttachments(null), NEUTRAL_PREFLIGHT_JSON),
  },
  {
    id: 'approval-attach-preflight-mixed-batch-partial-accept',
    suite: 'attachment-preflight',
    describe: 'a mixed batch (safe png + blocked exe) accepts only the safe file, rejects the exe, and summarizes the skip in a warning',
    run: () => {
      const r = preflightAttachments([
        { name: 'ok.png', sizeBytes: 1000, mimeType: 'image/png' },
        { name: 'bad.exe', sizeBytes: 1000, mimeType: '' },
      ]);
      const first = r.rejected[0];
      return (
        r.ok === true &&
        r.acceptedCount === 1 &&
        r.rejected.length === 1 &&
        !!first &&
        first.name === 'bad.exe' &&
        first.reason === ".exe files can't be attached for security" &&
        r.warning === 'Sending 1 file; skipped 1.'
      );
    },
  },
];
