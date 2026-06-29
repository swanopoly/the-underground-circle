/**
 * circleSnapshotContextInjection — turn-start injection of the Circle Context
 * Snapshot index (`circleContextSnapshot.ts`) into agent prompt surfaces.
 *
 * Why a separate module: the injection seams live in `openswanSessionRuntime`
 * and `swanbot`, which are NOT loadable under tsx/esbuild (they import the
 * Supabase client → react-native). Per the smoke-tests-need-pure-modules
 * house pattern, the block-assembly decision is extracted here so the
 * core-adapter smoke can exercise it with stubbed deps.
 *
 * Contract (R15/O7 prompt-cache discipline + R17 untrusted content):
 *   - The snapshot is volatile (60s TTL) — it must NEVER enter the frozen /
 *     cache_control'd system-prompt prefix. Mirror of `skillPromptInjection`'s
 *     `buildSkillsContextMessage`: the typed-core OpenSwan path injects this
 *     block as a USER-ROLE context message ahead of the user's message; the
 *     SwanBot v1 path appends it to the per-turn dynamic tail below the
 *     CACHE_BOUNDARY.
 *   - `renderCircleContextSnapshot` already fences member-authored content in
 *     `<untrusted_quoted>` with structural headers outside — its output is
 *     injected VERBATIM, never unwrapped or re-fenced.
 *   - Compact by design: `budgetChars` ≈ 2500 (counts + top items). The
 *     pinned `context.search` tool covers the long tail; the header line
 *     states that division of labor for the model.
 *   - Fail-safe: builder error or timeout (~1.5s race) ⇒ `null` ⇒ no block
 *     injected and the turn proceeds exactly as before. Never blocks a turn.
 */

import {
  getCircleContextSnapshot,
  renderCircleContextSnapshot,
  type CircleContextSnapshot,
} from './circleContextSnapshot';

/** Compact render budget — counts + top items, not the full 6k index. */
export const CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS = 2500;

/** Hard cap on how long a turn waits for the snapshot before skipping it. */
export const CIRCLE_SNAPSHOT_CONTEXT_TIMEOUT_MS = 1500;

/**
 * Header line of the injected block — states the compact-index /
 * `context.search`-for-depth division so the model knows where the
 * long tail lives (the tool description steers the rest).
 */
export const CIRCLE_SNAPSHOT_CONTEXT_HEADER =
  'Circle context index (compact — use context.search for more)';

/**
 * PURE: header line + the verbatim `renderCircleContextSnapshot` output.
 * Structural header stays outside the snapshot's `<untrusted_quoted>` fence.
 */
export function renderCircleSnapshotContextBlock(
  snapshot: CircleContextSnapshot,
  opts?: { budgetChars?: number },
): string {
  const rendered = renderCircleContextSnapshot(snapshot, {
    budgetChars: opts?.budgetChars ?? CIRCLE_SNAPSHOT_CONTEXT_BUDGET_CHARS,
  });
  return `${CIRCLE_SNAPSHOT_CONTEXT_HEADER}\n${rendered}`;
}

export type BuildCircleSnapshotContextMessageOptions = {
  /** Test seam / override — defaults to the cached `getCircleContextSnapshot`. */
  getSnapshot?: (circleId: string) => Promise<CircleContextSnapshot>;
  timeoutMs?: number;
  budgetChars?: number;
};

/**
 * Builds the compact snapshot context block for a circle, or `null` when it
 * cannot be built quickly (missing circleId, builder error, or timeout).
 * NEVER throws and never takes longer than ~`timeoutMs` — the caller injects
 * the block when present and proceeds unchanged when `null`.
 */
export async function buildCircleSnapshotContextMessage(
  circleId: string | null | undefined,
  opts?: BuildCircleSnapshotContextMessageOptions,
): Promise<string | null> {
  const id = String(circleId || '').trim();
  if (!id) return null;
  const timeoutMs = Math.max(1, opts?.timeoutMs ?? CIRCLE_SNAPSHOT_CONTEXT_TIMEOUT_MS);
  const getSnapshot = opts?.getSnapshot ?? getCircleContextSnapshot;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      // Wrap so a synchronous throw from the builder also resolves null.
      (async () => getSnapshot(id))().catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!snapshot) return null;
    return renderCircleSnapshotContextBlock(snapshot, {
      ...(opts?.budgetChars !== undefined ? { budgetChars: opts.budgetChars } : {}),
    });
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * PURE: assembles the typed-core tool loop's initial message array. The
 * snapshot block (when present) rides as its own user-role context message
 * BEFORE the user's actual message — same shape as
 * `skillPromptInjection.buildSkillsContextMessage` — keeping the frozen
 * system prompt cache-hot. With no block, the array is exactly what the
 * loop sent before this feature existed.
 */
export function buildSnapshotAwareInitialMessages(args: {
  userMessage: string;
  snapshotContextMessage?: string | null;
}): Array<{ role: 'user'; content: string }> {
  const messages: Array<{ role: 'user'; content: string }> = [];
  if (args.snapshotContextMessage) {
    messages.push({ role: 'user', content: args.snapshotContextMessage });
  }
  messages.push({ role: 'user', content: args.userMessage });
  return messages;
}
