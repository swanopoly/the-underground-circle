import type {
  AgentEvent,
  AgentRoundToolResult,
  AgentToolConstraintGuard,
  AgentToolResultStopGuard,
} from './agentExecutionCore';
import { isReadOnlyClientTool } from './clientToolBatchCore';
import {
  constraintBlocksToolCall,
  type ChatComputerConstraintCategory,
  type ChatComputerUserConstraints,
} from './chatComputerRequestRouter';

export type SwanbotV2BatchToolPolicyContext = {
  userConstraints: ChatComputerUserConstraints | null;
  alwaysConfirmFloor: ChatComputerConstraintCategory[];
  hasApprovalGate: boolean;
  /**
   * Canonical catalog tools whose handler owns a durable, exact-argument
   * approval boundary. This lets the pre-dispatch constraint guard defer to
   * that boundary without pretending a surface callback exists.
   */
  runtimeApprovalToolNames?: ReadonlySet<string>;
};

export type SwanbotV2EdgeClientApprovalGate = (
  call: { name: string; input: unknown },
) => Promise<'approve' | 'reject'>;

export type SwanbotV2EdgeClientToolApprovalMode =
  | 'auto'
  | 'ask'
  | 'blocked'
  | 'unknown';

export type SwanbotV2EdgeClientPreDispatchResult =
  | { allowed: true }
  | {
      allowed: false;
      kind: 'constraint' | 'approval_required' | 'rejected' | 'policy_error';
      reason: string;
    };

export type SwanbotV2BatchStopConditionMatch = {
  condition: string;
  toolName: string;
  toolUseId: string;
};

/**
 * Browser/desktop tools whose names are not part of the edge partitioner's
 * smaller read-only catalog but are still observations/planning operations.
 * Unknown browser/desktop names fail closed as mutations: a newly added
 * opaque action cannot silently bypass an already-detected turn floor.
 */
const SWANBOT_V2_ADDITIONAL_READ_ONLY_APP_TOOLS = new Set([
  'browser.plan_task',
  'browser.wp_admin_source_intelligence',
  // Both are non-mutating base-policy tools. They stay out of the edge
  // client's parallel-read allowlist so each remains a sequential barrier.
  'browser.wait_for',
  'browser.scroll',
  'desktop.cad_inspect_file',
  'desktop.illustrator_document_status',
  'desktop.illustrator_text_inventory',
  'desktop.menu_inventory',
  'desktop.indesign_document_status',
  'desktop.indesign_text_inventory',
  'desktop.photoshop_document_status',
  'desktop.photoshop_layer_inventory',
  'desktop.shortcuts_list',
]);

/**
 * A route-level floor can be detected from the user's task while the eventual
 * UI call remains semantically opaque (`press_key Enter`, a coordinate click,
 * generic AppleScript, and so on). Treat every non-read browser/desktop call as
 * a deferred candidate for that floor. This is intentionally name/policy based
 * rather than argument based, because bland arguments are the bypass this
 * backstop exists to close.
 */
function isSwanbotV2DeferredFloorClientMutation(toolName: string): boolean {
  if (!toolName.startsWith('browser.') && !toolName.startsWith('desktop.')) {
    return false;
  }
  return !isReadOnlyClientTool(toolName)
    && !SWANBOT_V2_ADDITIONAL_READ_ONLY_APP_TOOLS.has(toolName);
}

/**
 * Fallback suppression is justified only once a registered handler was
 * entered. `tool_call_start` precedes registration/policy/approval checks, and
 * legacy events may omit `dispatched`, so only literal `true` is authoritative.
 */
export function didSwanbotV2BatchEnterToolHandler(event: AgentEvent): boolean {
  return event.kind === 'tool_call_result' && event.dispatched === true;
}

/**
 * Union turn-derived constraints with richer upstream route context. A caller
 * may add policy, but it cannot erase a prohibition visible in the raw turn.
 */
export function mergeSwanbotV2BatchUserConstraints(
  parsed: ChatComputerUserConstraints | null,
  supplied: ChatComputerUserConstraints | null | undefined,
): ChatComputerUserConstraints | null {
  if (!parsed && !supplied) return null;
  const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));
  return {
    forbidden: unique([...(parsed?.forbidden || []), ...(supplied?.forbidden || [])]),
    approvalBefore: unique([...(parsed?.approvalBefore || []), ...(supplied?.approvalBefore || [])]),
    stopConditions: unique([...(parsed?.stopConditions || []), ...(supplied?.stopConditions || [])]),
    sourcePhrases: unique([...(parsed?.sourcePhrases || []), ...(supplied?.sourcePhrases || [])]).slice(0, 12),
  };
}

function compactStopText(value: unknown, limit: number): string {
  return String(value || '')
    .slice(0, limit)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stopConditionPattern(condition: string): RegExp | null {
  const normalized = compactStopText(condition, 80);
  if (!normalized) return null;
  if (/^(?:mfa|2fa|two[- ]factor)$/.test(normalized)) {
    return /\b(?:mfa|2fa|two[- ]factor(?: authentication)?)\b/gi;
  }
  if (/^captcha$/.test(normalized)) return /\bcaptcha\b/gi;
  if (/^log ?in$/.test(normalized)) return /\b(?:log ?in|sign[ -]?in|authentication required)\b/gi;
  if (/^password$/.test(normalized)) return /\bpassword\b/gi;
  if (/^credentials?$/.test(normalized)) return /\bcredentials?\b/gi;
  if (/^error$/.test(normalized)) return /\b(?:error|failed|failure)\b/gi;
  if (/^looks wrong$/.test(normalized)) return /\blooks? wrong\b/gi;
  if (/^unexpected$/.test(normalized)) return /\bunexpected\b/gi;

  // Richer upstream constraints may add a literal condition outside the raw
  // turn parser's small vocabulary. Match the exact bounded phrase, never
  // interpret caller text as a regular expression.
  if (normalized.length < 3) return null;
  return new RegExp(`\\b${escapeRegex(normalized).replace(/ +/g, '\\s+')}\\b`, 'gi');
}

function matchIsExplicitlyNegative(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(end, Math.min(text.length, end + 48));
  // Avoid stopping on ordinary negative evidence such as `no captcha`,
  // `"has_captcha": false`, or `error: null`. Keep this deliberately narrow:
  // "could not solve captcha" still proves that a captcha exists and MUST stop.
  if (/\b(?:no|without|nothing)\s+(?:an?\s+)?$/.test(before)) return true;
  return /^(?:[_\s"'=,:-]){0,12}(?:(?:required|detected|present)[_\s"'=,:-]{0,8})?(?:false|null|none|absent|cleared|passed|resolved|not (?:found|present|required|detected))\b/.test(after);
}

function toolResultMatchesStopCondition(
  condition: string,
  result: AgentRoundToolResult,
): boolean {
  const text = compactStopText(result.enforcementText ?? result.resultText, 1_000_000);
  if (!text) return false;
  const pattern = stopConditionPattern(condition);
  if (!pattern) return false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (!matchIsExplicitlyNegative(text, match.index, match.index + match[0].length)) {
      return true;
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return false;
}

/**
 * Evaluate merged user stop conditions against the latest tool results. The
 * typed core supplies a metadata-stripped, base64-scrubbed pre-summary envelope
 * so a signal in the omitted middle of a large result cannot bypass policy; it
 * falls back to model-visible result text for synthetic/legacy results.
 */
export function detectSwanbotV2BatchStopCondition(
  stopConditions: readonly string[],
  toolResults: readonly AgentRoundToolResult[],
): SwanbotV2BatchStopConditionMatch | null {
  for (const condition of stopConditions) {
    const boundedCondition = compactStopText(condition, 80);
    if (!boundedCondition) continue;
    for (const result of toolResults) {
      if (toolResultMatchesStopCondition(boundedCondition, result)) {
        return {
          condition: boundedCondition,
          toolName: result.toolName,
          toolUseId: result.toolUseId,
        };
      }
    }
  }
  return null;
}

/**
 * Build the typed-core per-result enforcement adapter. No stop conditions
 * means no hook, preserving old loop behavior. The core invokes this after
 * each result and before the next same-turn handler can enter.
 */
export function createSwanbotV2BatchToolResultStopGuard(
  stopConditions: readonly string[] | null | undefined,
): AgentToolResultStopGuard | undefined {
  const conditions = Array.from(new Set(
    (stopConditions || []).map((condition) => compactStopText(condition, 80)).filter(Boolean),
  ));
  if (conditions.length === 0) return undefined;

  return ({ latestToolResult }) => {
    const match = detectSwanbotV2BatchStopCondition(conditions, [latestToolResult]);
    if (!match) return undefined;
    return {
      stop: true,
      reason: `user stop condition matched: ${match.condition} (${match.toolName})`,
      responseText: `Stopped because the latest ${match.toolName} result matched your "${match.condition}" stop condition. I did not continue. Clear the blocker or tell me how you want to proceed.`,
    };
  };
}

/**
 * Universal pre-dispatch policy for the typed SwanBot batch canary.
 *
 * Explicit prohibitions always block. Ask-before and always-confirm matches
 * proceed only when the live surface supplied a genuine exact-call approval
 * gate or the named canonical tool handler owns the durable exact-call
 * approval boundary; otherwise the core receives a fail-closed
 * `requireApproval` verdict. The core invokes a surface gate after this guard;
 * canonical handlers file and consume their own bound approval rows.
 */
export function createSwanbotV2BatchToolConstraintGuard(
  context: SwanbotV2BatchToolPolicyContext,
): AgentToolConstraintGuard {
  const askBeforeConstraints: ChatComputerUserConstraints | null =
    context.userConstraints?.approvalBefore.length
      ? {
          ...context.userConstraints,
          forbidden: context.userConstraints.approvalBefore,
          approvalBefore: [],
        }
      : null;
  const turnFloor = new Set(context.alwaysConfirmFloor);
  const hasExactApprovalBoundary = (toolName: string): boolean =>
    context.hasApprovalGate || context.runtimeApprovalToolNames?.has(toolName) === true;

  return ({ toolName, input }) => {
    const verdict = constraintBlocksToolCall(context.userConstraints, toolName, input);
    if (verdict.blocked) {
      return {
        block: true,
        reason: verdict.reason || `The user forbade this tool action (${toolName}).`,
      };
    }

    const askBeforeVerdict = askBeforeConstraints
      ? constraintBlocksToolCall(askBeforeConstraints, toolName, input)
      : null;
    if (askBeforeVerdict?.blocked && !hasExactApprovalBoundary(toolName)) {
      return {
        requireApproval: true,
        reason: `The user asked for confirmation before "${askBeforeVerdict.category || 'sensitive'}" actions, but this turn has no approval gate.`,
      };
    }

    if (verdict.floorConfirmRequired && !hasExactApprovalBoundary(toolName)) {
      const category = verdict.floorCategory;
      const categoryLabel = category || 'sensitive';
      const detectedInTurn = category && turnFloor.has(category)
        ? ' This category was also detected in the original user turn.'
        : '';
      return {
        requireApproval: true,
        reason: `${verdict.reason || `Always-confirm floor: "${categoryLabel}".`}${detectedInTurn}`,
      };
    }

    if (
      turnFloor.size > 0
      && isSwanbotV2DeferredFloorClientMutation(toolName)
      && !hasExactApprovalBoundary(toolName)
    ) {
      const categories = Array.from(turnFloor).join(', ');
      return {
        requireApproval: true,
        reason: `Always-confirm floor: the original task includes "${categories}", and this opaque ${toolName} mutation could perform that deferred step. Exact confirmation is required before it runs.`,
      };
    }

    // A supplied exact-call gate runs next inside AgentExecutionCore.
    return undefined;
  };
}

/**
 * Executable pre-dispatch seam for the default edge-continuation client loop.
 * It preserves the typed loop's ordering: hard constraints first, then the
 * exact-call review callback. Exceptions fail closed and a rejected/blocked
 * call never reaches a browser or desktop handler.
 */
export async function authorizeSwanbotV2EdgeClientToolCall(
  context: Omit<SwanbotV2BatchToolPolicyContext, 'hasApprovalGate'> & {
    toolApprovalGate?: SwanbotV2EdgeClientApprovalGate;
    /** Current canonical catalog policy for this exact tool name. Missing or
     * unclassified policy fails closed before any handler can enter. */
    toolApprovalMode?: SwanbotV2EdgeClientToolApprovalMode;
  },
  call: {
    toolName: string;
    toolUseId: string;
    input: unknown;
    iteration: number;
  },
): Promise<SwanbotV2EdgeClientPreDispatchResult> {
  const guard = createSwanbotV2BatchToolConstraintGuard({
    userConstraints: context.userConstraints,
    alwaysConfirmFloor: context.alwaysConfirmFloor,
    // Ask the guard to report direct-surface confirmation requirements. A
    // named canonical runtime owner remains allowed to enforce its own
    // durable exact-call boundary; the mere existence of a UI callback must
    // not make every read look reviewed or suppress the requirement signal.
    hasApprovalGate: false,
    runtimeApprovalToolNames: context.runtimeApprovalToolNames,
  });

  let verdict: Awaited<ReturnType<AgentToolConstraintGuard>>;
  try {
    verdict = await guard(call);
  } catch {
    return {
      allowed: false,
      kind: 'policy_error',
      reason: 'This tool call was not performed because the pre-dispatch policy check failed closed.',
    };
  }

  const blocked = Boolean(verdict && 'block' in verdict && verdict.block);
  const approvalRequired = Boolean(
    verdict
    && 'requireApproval' in verdict
    && verdict.requireApproval,
  );
  if (blocked || approvalRequired) {
    const reason = verdict && 'reason' in verdict ? verdict.reason : undefined;
    if (blocked) {
      return {
        allowed: false,
        kind: 'constraint',
        reason: reason || 'This tool call was blocked by the user constraint policy.',
      };
    }
  }

  const approvalMode = context.toolApprovalMode || 'unknown';
  if (approvalMode === 'unknown' || approvalMode === 'blocked') {
    return {
      allowed: false,
      kind: 'policy_error',
      reason: approvalMode === 'blocked'
        ? 'This tool is disabled for model-side execution and was not performed.'
        : 'This tool call was not performed because it has no current canonical approval policy.',
    };
  }

  const runtimeOwnsExactApproval = context.runtimeApprovalToolNames?.has(call.toolName) === true;
  const needsSurfaceApproval = approvalRequired
    || (approvalMode === 'ask' && !runtimeOwnsExactApproval);
  if (needsSurfaceApproval && !context.toolApprovalGate) {
    const reason = verdict && 'reason' in verdict ? verdict.reason : undefined;
    return {
      allowed: false,
      kind: 'approval_required',
      reason: reason || 'This exact tool call requires explicit confirmation and was not performed.',
    };
  }

  if (needsSurfaceApproval && context.toolApprovalGate) {
    let decision: 'approve' | 'reject' = 'reject';
    try {
      decision = await context.toolApprovalGate({
        name: call.toolName,
        input: call.input,
      });
    } catch {
      decision = 'reject';
    }
    if (decision !== 'approve') {
      return {
        allowed: false,
        kind: 'rejected',
        reason: 'User declined this exact tool call. It was not performed. Try a different approach or ask how to proceed.',
      };
    }
  }

  return { allowed: true };
}
