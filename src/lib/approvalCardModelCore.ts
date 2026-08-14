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
 *      HitlApprovalBanner) so both banners tint chips the same way;
 *   5. batch-card plan  — `planRunApprovalBatchCards` folds runtime-stamped,
 *      same-tool, same-risk pending rows into one itemized "Approve all N"
 *      card (via `openswanApprovalBatchCore.planApprovalBatch`), so the user
 *      taps once instead of clearing a queue — batching only changes how many
 *      taps consent takes, never what executes without consent.
 *
 * This module only shapes what the cards SHOW/OFFER — it never approves
 * anything and must not call `resolveApprovalDecision` (the request-side gate
 * in `openswanToolRuntime.maybeRequestToolApproval` owns execution decisions).
 *
 * PURITY (load-bearing): runtime imports only from verified dependency-light
 * modules (approvalPreviewCore, unifiedApprovalPolicyCore,
 * openswanApprovalBatchCore — itself zero-runtime-import — and
 * chatAttentionQueue, which is `import type`-only at its own module head), no
 * react-native/supabase, no Date.now()/Math.random() at module scope. Every
 * export is TOTAL: hostile input yields a safe, fail-closed value and never
 * throws. Smoke: scripts/approval-card-model-core-smoketest.ts.
 */

import { classifyApprovalAge } from './approvalPreviewCore';
import { matchesAlwaysAskFloor } from './unifiedApprovalPolicyCore';
import { resolveApprovalExpiresAt } from './chatAttentionQueue';
import { planApprovalBatch } from './openswanApprovalBatchCore';
import { readOpenSwanApprovalAuditToolName } from './openswanToolApprovals';
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
 * One rendered card position in the RunApprovalBanner strip: either a normal
 * single-row card, or one itemized batch card covering ≥2 rows of the SAME
 * tool at the SAME (low/medium) risk. `index`/`indices` are positions in the
 * caller's original pending array; every index in the (bounded) input appears
 * in exactly one entry, so the banner can render the full queue from the plan.
 */
export type RunApprovalCardPlanEntry =
  | { kind: 'single'; index: number }
  | {
      kind: 'batch';
      indices: number[];
      /** Normalized (lowercased) payload tool shared by one run/requester origin. */
      tool: string;
      /** Shared `openswanApprovalBatchCore` risk bucket: 'low' | 'medium'. */
      combinedRisk: string;
      /** Chip tier for the batch card ('read' for low, 'reversible' for medium). */
      tier: ApprovalRiskTier;
    };

/**
 * approval_kind values eligible for batching. Everything else is solo:
 * cost_threshold (floor — a spend gate must be read, not swept), publish /
 * external_send (external side effects stay per-item), plan_approval /
 * deliverable_review (review surfaces, not tool gates), and any unknown kind.
 */
const BATCHABLE_APPROVAL_KINDS: ReadonlySet<string> = new Set([
  'tool_use',
  'file_write',
  'browser_action',
  'privileged_action',
]);

/** Mirrors openswanApprovalBatchCore.MAX_ITEMS so coverage stays bounded. */
const MAX_PLAN_ROWS = 500;

/** Exact durable identity required before two approval rows may share one tap. */
const APPROVAL_ROW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Minimum original index an entry covers (its display position). */
function planEntryFirstIndex(entry: RunApprovalCardPlanEntry): number {
  if (entry.kind === 'single') return entry.index;
  return entry.indices.length > 0 ? entry.indices[0] : Number.MAX_SAFE_INTEGER;
}

/**
 * Plan the RunApprovalBanner card strip over pending `agent_run_approvals`
 * rows (structurally typed — any array works): fold same-tool, same-risk,
 * runtime-stamped rows into one itemized "Approve all N" card; everything
 * else stays a solo card. Batching NEVER widens what executes — the user
 * still explicitly consents, just once per compatible group — so every
 * narrowing rule below fails toward solo cards:
 *
 *   a. `payload.toolApprovalKey` must be a non-empty string. Only the trusted
 *      runtime gate stamps it (`maybeRequestToolApproval` /
 *      `maybeBlockToolByConstraint`); model-authored `approvals.request` rows
 *      carry a verbatim payload, and keyless rows can't be cross-run honored
 *      anyway, so a batch of them would "approve" nothing coherent.
 *   b. approval_kind must be batchable (see BATCHABLE_APPROVAL_KINDS);
 *      publish/external_send read as external side effects (solo),
 *      plan_approval/deliverable_review as unknown risk (solo),
 *      cost_threshold as floor (solo).
 *   c. `payload.externalSideEffect === true` → solo.
 *   d. risk comes ONLY from the runtime-stamped approval preview:
 *      raw 'read'/'write'/'destructive' → tier via `mapPreviewRiskToTier`
 *      ('read'→low, 'reversible'→medium, 'irreversible'→critical-solo in the
 *      batcher). Feeding the TIER (not the raw word) is load-bearing — raw
 *      'write' alone would normalize to 'unknown' in
 *      `normalizeApprovalBatchRisk`. Missing/other preview → unknown (solo).
 *   e. always-ask floor (`matchesAlwaysAskFloor` on tool or kind) or a
 *      credential/password marker in either → solo.
 *      `browser.fill_credential_field` carries NO literal floor marker, so
 *      the credential check here is load-bearing.
 *
 * Surviving rows group through `planApprovalBatch` (low and medium never
 * co-mingle), then each shared-risk group is subdivided by normalized
 * payload tool + exact run + requester — a batch card never merges different
 * tools or durable origins under one yes.
 * Partitions of ≥2 become batch entries; everything else is single. Entries
 * are ordered by first covered index (deterministic; same input → same plan).
 * Total: hostile rows (throwing getters, wrong shapes) become solo entries,
 * never a throw.
 */
export function planRunApprovalBatchCards(rows: unknown): RunApprovalCardPlanEntry[] {
  const soloFallback = (): RunApprovalCardPlanEntry[] => {
    try {
      if (!Array.isArray(rows)) return [];
      const out: RunApprovalCardPlanEntry[] = [];
      const n = Math.min(rows.length, MAX_PLAN_ROWS);
      for (let i = 0; i < n; i++) out.push({ kind: 'single', index: i });
      return out;
    } catch {
      return [];
    }
  };
  try {
    if (!Array.isArray(rows)) return [];
    const n = Math.min(rows.length, MAX_PLAN_ROWS);

    // Per-row facts for the batcher, plus the tool partition key. Any parse
    // failure marks the row solo (risk 'unknown' + floor) — fail-closed.
    const items: Array<{ risk: string; tool: string; category: string; floor: boolean }> = [];
    const batchAuthorityKeys: string[] = [];
    for (let i = 0; i < n; i++) {
      let item = { risk: 'unknown', tool: '', category: '', floor: true };
      let toolKey = '';
      try {
        const rowRaw = rows[i];
        const row = rowRaw && typeof rowRaw === 'object' ? (rowRaw as Record<string, unknown>) : {};
        const kind = typeof row.approval_kind === 'string'
          ? row.approval_kind.trim().toLowerCase().slice(0, 200)
          : '';
        const payload = row.payload && typeof row.payload === 'object'
          ? (row.payload as Record<string, unknown>)
          : null;
        const tool = (readOpenSwanApprovalAuditToolName(payload) || '')
          .toLowerCase()
          .slice(0, 200);
        const runId = typeof row.run_id === 'string' ? row.run_id.trim().toLowerCase() : '';
        const requestedBy = typeof row.requested_by === 'string'
          ? row.requested_by.trim().toLowerCase()
          : '';
        const hasExactOrigin =
          APPROVAL_ROW_UUID_RE.test(runId) && APPROVAL_ROW_UUID_RE.test(requestedBy);
        const approvalKey = payload ? payload.toolApprovalKey : null;
        const hasTrustedKey = typeof approvalKey === 'string' && approvalKey.length > 0;
        const externalSideEffect = payload ? payload.externalSideEffect === true : false;

        const genericEffectContainer = kind === 'tool_use' || kind === 'browser_action';
        const kindEffectSignal = genericEffectContainer ? '' : kind;
        // (e) floor: always-ask markers or credential/password on the exact
        // tool or a semantic kind. Generic transport kinds carry no effect.
        const floor =
          kind === 'cost_threshold' ||
          matchesAlwaysAskFloor(tool) ||
          (kindEffectSignal ? matchesAlwaysAskFloor(kindEffectSignal) : false) ||
          tool.includes('credential') ||
          tool.includes('password') ||
          kind.includes('credential') ||
          kind.includes('password');

        // (d) risk tier only from the runtime-stamped preview triple.
        const previewRaw = payload && payload.approvalPreview && typeof payload.approvalPreview === 'object'
          ? (payload.approvalPreview as Record<string, unknown>).risk
          : undefined;
        const tier = previewRaw === 'read' || previewRaw === 'write' || previewRaw === 'destructive'
          ? mapPreviewRiskToTier(previewRaw)
          : null;

        let risk: string;
        if (kind === 'publish' || kind === 'external_send') {
          risk = 'external_side_effect'; // normalizes 'high' → solo
        } else if (kind === 'plan_approval' || kind === 'deliverable_review') {
          risk = 'unknown';
        } else if (!BATCHABLE_APPROVAL_KINDS.has(kind)) {
          risk = 'unknown'; // includes cost_threshold (also floored above)
        } else if (!hasTrustedKey || externalSideEffect || !tool || tier === null || !hasExactOrigin) {
          risk = 'unknown'; // rules (a)/(c), toolless rows, previewless rows
        } else {
          risk = tier; // 'read' → low, 'reversible' → medium, 'irreversible' → critical (solo)
        }
        // `tool_use` / `browser_action` are transport containers, not effect
        // classifications. Feeding either generic label into the canonical
        // effect fold would make even an exact `browser.fill_field` or
        // `browser.set_toggle` look ambiguous and disable the deliberately
        // narrow reversible batch path. The exact tool remains authoritative;
        // file, privileged, external, unknown, and review kinds keep their
        // semantic category and therefore stay separate.
        const effectCategory = genericEffectContainer
          ? ''
          : kind;
        item = { risk, tool, category: effectCategory, floor };
        // One approval card is one immutable runtime origin. Matching tool and
        // risk are not enough: circle-wide approval reads can contain rows
        // from different runs/requesters, which must never become one click or
        // one synthetic continuation turn.
        toolKey = hasExactOrigin ? `${tool}\u0000${runId}\u0000${requestedBy}` : '';
      } catch {
        item = { risk: 'unknown', tool: '', category: '', floor: true };
        toolKey = '';
      }
      items.push(item);
      batchAuthorityKeys.push(toolKey);
    }

    const plan = planApprovalBatch(items);

    const entries: RunApprovalCardPlanEntry[] = [];
    const covered = new Set<number>();
    for (const group of plan.batches) {
      if (group.requiresSeparate || (group.combinedRisk !== 'low' && group.combinedRisk !== 'medium')) {
        for (const idx of group.indices) {
          entries.push({ kind: 'single', index: idx });
          covered.add(idx);
        }
        continue;
      }
      // Subdivide the shared-risk group by normalized approval tool plus exact
      // source run/requester. One tap never spans durable origins. Map
      // preserves ascending insertion order, so minima stay deterministic.
      const partitions = new Map<string, number[]>();
      for (const idx of group.indices) {
        const key = batchAuthorityKeys[idx] || '';
        if (!key) {
          // Defensive: toolless rows were already marked unknown above.
          entries.push({ kind: 'single', index: idx });
          covered.add(idx);
          continue;
        }
        const bucket = partitions.get(key);
        if (bucket) bucket.push(idx);
        else partitions.set(key, [idx]);
      }
      for (const [authorityKey, indices] of partitions) {
        const tool = authorityKey.split('\u0000', 1)[0] || '';
        if (indices.length >= 2) {
          entries.push({
            kind: 'batch',
            indices,
            tool,
            combinedRisk: group.combinedRisk,
            tier: group.combinedRisk === 'low' ? 'read' : 'reversible',
          });
        } else {
          entries.push({ kind: 'single', index: indices[0] });
        }
        for (const idx of indices) covered.add(idx);
      }
    }
    // Total coverage: any index the batcher omitted still gets a solo card.
    for (let i = 0; i < n; i++) {
      if (!covered.has(i)) entries.push({ kind: 'single', index: i });
    }
    // Deterministic display order: each index belongs to exactly one entry,
    // so first-covered-index minima are unique → a total order.
    entries.sort((a, b) => planEntryFirstIndex(a) - planEntryFirstIndex(b));
    return entries;
  } catch {
    return soloFallback(); // fail-closed: every row its own card
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
