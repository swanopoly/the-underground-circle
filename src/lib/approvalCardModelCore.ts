/**
 * approvalCardModelCore — shared card model for the two approval banners
 * (`RunApprovalBanner` over `agent_run_approvals`, `HitlApprovalBanner` over
 * `agent_approvals`) and their read services. One place decides:
 *
 *   1. risk vocabulary  — `mapPreviewRiskToTier` folds the approval-preview
 *      read/write/destructive triple into the four-tier UI vocabulary so
 *      `describeApprovalRiskChip` labels/tones both banners identically
 *      (destructive → IRREVERSIBLE/red, never a blue REVERSIBLE fallback);
 *   2. liveness         — `isApprovalRowLive` is THE pending-row filter
 *      (explicit timeout window when set, else the 30-min
 *      `classifyApprovalAge` staleness cap; unparsable timestamps are dead —
 *      fail-closed). Hiding a dead row only narrows what can be approved;
 *   3. remember-checkbox eligibility — `shouldOfferRememberAutoApprove`
 *      suppresses the "Remember: auto-approve …" affordance for always-ask
 *      floor actions (pay/delete/login/grant) and credential entry, so the
 *      UI can never persist an auto-approve the request-side gate
 *      (`unifiedApprovalPolicyCore` floor precedence) would refuse to honor;
 *   4. chip colors      — `RISK_TIER_CHIP_COLORS` (moved verbatim from
 *      HitlApprovalBanner) so both banners tint chips the same way.
 *
 * This module only shapes what the cards SHOW/OFFER — it never approves
 * anything and must not call `resolveApprovalDecision` (the request-side gate
 * in `openswanToolRuntime.maybeRequestToolApproval` owns execution decisions).
 *
 * PURITY (load-bearing): runtime imports only from verified dependency-light
 * modules (approvalPreviewCore, unifiedApprovalPolicyCore, chatAttentionQueue
 * — the latter is `import type`-only at its own module head), no
 * react-native/supabase, no Date.now()/Math.random() at module scope. Every
 * export is TOTAL: hostile input yields a safe, fail-closed value and never
 * throws. Smoke: scripts/approval-card-model-core-smoketest.ts.
 */

import { classifyApprovalAge } from './approvalPreviewCore';
import { matchesAlwaysAskFloor } from './unifiedApprovalPolicyCore';
import { resolveApprovalExpiresAt } from './chatAttentionQueue';
import type { ApprovalRiskTier, ApprovalRiskChipTone } from './approvalIntentPreview';

/**
 * Fold the approval-preview risk triple (`approvalPreviewCore.ApprovalPreview
 * ['risk']`: read/write/destructive) into the four-tier chip vocabulary
 * (`approvalIntentPreview.ApprovalRiskTier`). Unknown/hostile input maps to
 * 'reversible' — the safest VISIBLE chip (never silently 'read'). Callers
 * that need "no chip at all" for legacy rows must check the raw value first.
 */
export function mapPreviewRiskToTier(risk: unknown): ApprovalRiskTier {
  const r = typeof risk === 'string' ? risk.trim().toLowerCase() : '';
  if (r === 'read') return 'read';
  if (r === 'destructive') return 'irreversible';
  return 'reversible';
}

/**
 * THE pending-approval liveness predicate (reference implementation moved
 * from `runApprovalsService.getPendingRunApprovals`): a row is live while its
 * explicit timeout window is open (`timeout_seconds > 0`), else while it is
 * younger than the 30-min `classifyApprovalAge` staleness cap. Unparsable
 * `requestedAt` → NOT live (classifyApprovalAge fails closed to 'expired').
 * Total: never throws. Filtering with this only ever HIDES approve buttons —
 * it can never widen what executes.
 */
export function isApprovalRowLive(
  requestedAt: unknown,
  timeoutSeconds: unknown,
  nowMs: number,
): boolean {
  try {
    const requested = typeof requestedAt === 'string' ? requestedAt : '';
    const expiresAt = resolveApprovalExpiresAt(requested, Number(timeoutSeconds));
    if (expiresAt !== null) return expiresAt > nowMs;
    return classifyApprovalAge(nowMs - Date.parse(requested)) !== 'expired';
  } catch {
    return false; // fail-closed: an unverifiable row shows no live Approve
  }
}

/**
 * May the card offer the "Remember: auto-approve <category>" checkbox?
 * False when the category OR the tool sits on the always-ask floor
 * (pay/delete/login/grant — the floor beats every auto path, see
 * `unifiedApprovalPolicyCore.resolveApprovalDecision` precedence #2), and —
 * defense-in-depth — for credential/password entry, mirroring
 * `toolAutoApproveCategory`'s explicit null for
 * `browser.fill_credential_field` (login-floor territory even though the
 * tool name carries no literal floor marker). Suppressing the checkbox only
 * narrows: the user can still approve this one action, we just never persist
 * a standing auto-approve the gate would have to refuse. Total: hostile
 * input suppresses (returns false) rather than throwing.
 */
export function shouldOfferRememberAutoApprove(category: unknown, tool: unknown): boolean {
  try {
    if (matchesAlwaysAskFloor(category) || matchesAlwaysAskFloor(tool)) return false;
    const c = typeof category === 'string' ? category.toLowerCase() : '';
    const t = typeof tool === 'string' ? tool.toLowerCase() : '';
    if (c.includes('credential') || c.includes('password')) return false;
    if (t.includes('credential') || t.includes('password')) return false;
    return true;
  } catch {
    return false; // fail-closed: when in doubt, don't offer the checkbox
  }
}

/**
 * Risk-chip tone → {fg, bg, border} for the dark theme. Moved verbatim from
 * HitlApprovalBanner so both approval banners tint
 * `describeApprovalRiskChip` output identically.
 */
export const RISK_TIER_CHIP_COLORS: Record<
  ApprovalRiskChipTone,
  { fg: string; bg: string; border: string }
> = {
  green: { fg: '#22c55e', bg: '#22c55e18', border: '#22c55e55' },
  blue: { fg: '#60a5fa', bg: '#60a5fa18', border: '#60a5fa55' },
  amber: { fg: '#f59e0b', bg: '#f59e0b18', border: '#f59e0b55' },
  red: { fg: '#ef4444', bg: '#ef444418', border: '#ef444455' },
};
