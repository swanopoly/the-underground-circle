/**
 * Compatibility shim for the older Anthropic-style OpenSwan tool loop.
 *
 * The authoritative manifest now lives in `openswanToolRuntime.ts`.
 * This file stays as a thin adapter so existing imports do not break
 * while the rest of the runtime converges on the typed tool runtime.
 */

import {
  executeOpenSwanRuntimeTool,
  formatOpenSwanRuntimeToolResult,
  getOpenSwanToolParallelPolicy,
  getOpenSwanToolPolicy,
  listOpenSwanAnthropicToolsForSurface,
  splitOpenSwanRuntimeToolResultMetadata,
  type OpenSwanRuntimeToolContext,
  type OpenSwanRuntimeToolName,
  type OpenSwanToolSurface,
} from '../openswanToolRuntime';
import type { OpenSwanExecutionStatus } from '../openswanExecution';
import {
  buildDesignAppRuntimeToolCaptureMetadata,
  withDesignAppRuntimeCaptureMetadata,
} from '../designAppRuntimeManifest';
import { buildEngineeringToolCaptureMetadata } from '../engineeringRuntimeCaptureCore';
import type { OpenSwanAttachmentTurnSources } from '../openSwanAttachmentTurnSources';
import type { OpenSwanApprovalResumeBindingV1 } from '../openswanToolApprovals';

export const MAX_TOOL_ROUNDS = 5;

export interface OpenSwanToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** X4 (P47): curated, schema-validated example inputs (Anthropic
   *  `input_examples`, GA) — attached at the catalog chokepoint for the
   *  gnarliest schemas; absent for most tools. */
  input_examples?: Array<Record<string, unknown>>;
}

export interface ToolContext {
  circleId: string;
  userId: string;
  threadId?: string;
  activeSoulKey?: string;
  surface?: OpenSwanToolSurface;
  mode?: string | null;
  runId?: string;
  activePluginIds?: string[];
  /** Exact runtime-private attachment sources for this turn only. */
  attachmentTurnSources?: OpenSwanAttachmentTurnSources | null;
  /** Exact persisted attachment message; transient and never model metadata. */
  desktopAttachmentMessageId?: string | null;
  /** Exact process-private A-ledger reference for approval continuation. */
  multiActionLedgerReference?: unknown;
  /** Process-private exact approval binding; never model-visible metadata. */
  approvalResumeBinding?: OpenSwanApprovalResumeBindingV1 | null;
  /** Exact persisted source user-message UUID for sealed approval lineage. */
  approvalResumeSourceMessageId?: string | null;
  /** Process-private STOP signal for a bound approval continuation. */
  approvalResumeAbortSignal?: AbortSignal | null;
  /** Exact user-authored task captured before any prompt augmentation. */
  originalUserTaskText?: string | null;
  /** Exact call identity. Model calls use provider values unchanged; internal
   * reads receive an explicitly namespaced runtime identity. */
  toolName?: string;
  toolUseId?: string;
  iteration?: number;
  /** 1-indexed position in the provider's original tool-use block array. */
  sourceCallOrdinal?: number;
}

type DesktopAttachmentToolContextSidecar = Readonly<{
  token: object;
  desktopAttachmentMessageId?: string;
  multiActionLedgerReference?: object;
  mode?: string;
}>;

const desktopAttachmentToolContextBySources = new WeakMap<
  object,
  DesktopAttachmentToolContextSidecar
>();
const DESKTOP_ATTACHMENT_TOOL_CONTEXT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Process-private compatibility sidecar for the legacy loop, whose public
 * serializer predates the opaque desktop attachment fields. Object identity
 * is the key and cleanup is token-aware, so neither clone nor a later turn can
 * inherit the retained message/ledger authority.
 */
export function registerOpenSwanDesktopAttachmentToolContext(
  sources: OpenSwanAttachmentTurnSources,
  values: Readonly<{
    desktopAttachmentMessageId?: string | null;
    multiActionLedgerReference?: unknown;
    mode?: string | null;
  }>,
): () => void {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return () => {};
  const messageId = typeof values.desktopAttachmentMessageId === 'string'
    && DESKTOP_ATTACHMENT_TOOL_CONTEXT_UUID_RE.test(values.desktopAttachmentMessageId)
    ? values.desktopAttachmentMessageId
    : undefined;
  const ledgerReference = values.multiActionLedgerReference
    && typeof values.multiActionLedgerReference === 'object'
    && !Array.isArray(values.multiActionLedgerReference)
    ? values.multiActionLedgerReference as object
    : undefined;
  const mode = typeof values.mode === 'string' && values.mode.trim()
    ? values.mode.trim()
    : undefined;
  if (!messageId && !ledgerReference && !mode) return () => {};
  const token = Object.freeze({});
  const sidecar = Object.freeze({
    token,
    ...(messageId ? { desktopAttachmentMessageId: messageId } : {}),
    ...(ledgerReference ? { multiActionLedgerReference: ledgerReference } : {}),
    ...(mode ? { mode } : {}),
  });
  desktopAttachmentToolContextBySources.set(sources, sidecar);
  return () => {
    if (desktopAttachmentToolContextBySources.get(sources)?.token === token) {
      desktopAttachmentToolContextBySources.delete(sources);
    }
  };
}

export type OpenSwanToolCallIdentity = Readonly<{
  toolName: string;
  toolUseId: string;
  iteration: number;
  sourceCallOrdinal: number;
}>;

/**
 * Bind one dispatch to its exact call identity without mutating the turn-wide
 * context. Identity fields intentionally follow the base spread so stale or
 * caller-supplied placeholders can never override the current provider call.
 */
export function bindOpenSwanToolCallContext(
  context: ToolContext,
  identity: OpenSwanToolCallIdentity,
): ToolContext & OpenSwanToolCallIdentity {
  return {
    ...context,
    toolName: identity.toolName,
    toolUseId: identity.toolUseId,
    iteration: identity.iteration,
    sourceCallOrdinal: identity.sourceCallOrdinal,
  };
}

/** Exact, bounded identity for a deterministic runtime-owned re-observation. */
export function buildOpenSwanAutoObservationToolUseId(
  parentToolUseId: string | null | undefined,
  iteration: number,
  ordinal = 1,
): string {
  const normalizedParent = typeof parentToolUseId === 'string'
    ? parentToolUseId.replace(/[^A-Za-z0-9._:-]/g, '_')
    : '';
  const safeParent = normalizedParent && /^[A-Za-z0-9]/.test(normalizedParent)
    ? normalizedParent
    : normalizedParent ? `runtime.${normalizedParent}` : '';
  const safeIteration = Number.isInteger(iteration) && iteration > 0 ? iteration : 1;
  const safeOrdinal = Number.isInteger(ordinal) && ordinal > 0 ? ordinal : 1;
  const suffix = `.auto_reobserve.${safeIteration}.${safeOrdinal}`;
  const fallback = `runtime${suffix}`;
  if (!safeParent) return fallback;
  return `${safeParent.slice(0, Math.max(1, 180 - suffix.length))}${suffix}`;
}

export type OpenSwanDispatchedToolResult = {
  text: string;
  status: OpenSwanExecutionStatus;
  metadata?: Record<string, unknown>;
};

export function getToolDefinitions(
  allowedToolNames?: string[],
  surface: OpenSwanToolSurface = 'main_chat',
  mode?: string | null,
): OpenSwanToolDef[] {
  return listOpenSwanAnthropicToolsForSurface(
    surface,
    allowedToolNames as OpenSwanRuntimeToolName[] | undefined,
    mode,
  );
}

/** Minimal read/mutation policy for a tool — used to decide if a round of
 *  tools can be dispatched concurrently (see toolBatchParallelism). */
export function getToolParallelPolicy(
  name: string,
  activePluginIds?: string[],
): ReturnType<typeof getOpenSwanToolParallelPolicy> {
  // Keep the legacy loop on the same dependency-aware policy as the typed
  // core. In particular, run.report_action_outcomes is a singleton ordering
  // barrier: it may reference only tool calls that already finished.
  return getOpenSwanToolParallelPolicy(name, activePluginIds);
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const detailed = await dispatchToolDetailed(name, input, ctx);
  return detailed.text;
}

export async function dispatchToolDetailed(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<OpenSwanDispatchedToolResult> {
  try {
    const sidecar = ctx.attachmentTurnSources
      ? desktopAttachmentToolContextBySources.get(ctx.attachmentTurnSources)
      : undefined;
    const runtimeContext: ToolContext = {
      ...ctx,
      ...(ctx.desktopAttachmentMessageId !== undefined
        ? { desktopAttachmentMessageId: ctx.desktopAttachmentMessageId }
        : sidecar?.desktopAttachmentMessageId
          ? { desktopAttachmentMessageId: sidecar.desktopAttachmentMessageId }
          : {}),
      ...(ctx.multiActionLedgerReference !== undefined
        ? { multiActionLedgerReference: ctx.multiActionLedgerReference }
        : sidecar?.multiActionLedgerReference
          ? { multiActionLedgerReference: sidecar.multiActionLedgerReference }
          : {}),
      ...(ctx.mode !== undefined
        ? { mode: ctx.mode }
        : sidecar?.mode
          ? { mode: sidecar.mode }
          : {}),
    };
    const result = await executeOpenSwanRuntimeTool(
      name as OpenSwanRuntimeToolName,
      input as any,
      runtimeContext as OpenSwanRuntimeToolContext,
    );
    const { raw: visibleResult, metadata: trustedRuntimeMetadata } =
      splitOpenSwanRuntimeToolResultMetadata(result);
    const text = formatOpenSwanRuntimeToolResult(
      name as OpenSwanRuntimeToolName,
      visibleResult as any,
    );
    const policy = getOpenSwanToolPolicy(name as OpenSwanRuntimeToolName, ctx.activePluginIds);
    const approvalRequest = (visibleResult as any).approvalRequest || null;
    const capture = buildDesignAppRuntimeToolCaptureMetadata(name, visibleResult, input);
    const engineeringCapture = buildEngineeringToolCaptureMetadata(name, visibleResult, input);
    const metadata = {
      ...withDesignAppRuntimeCaptureMetadata({
        ...(trustedRuntimeMetadata || {}),
        ...(name === 'browser.plan_task' ? { browserPlan: (visibleResult as any).plan || null } : {}),
        toolPolicy: policy,
        approvalRequest,
      }, capture),
      ...(engineeringCapture || {}),
    };
    const status: OpenSwanExecutionStatus = approvalRequest
      ? 'manual_required'
      : name.startsWith('verification.') && (result as any).executed === false
        ? 'blocked'
        : (visibleResult as any).ok === false
          ? 'failed'
          : 'passed';
    return { text, status, metadata };
  } catch (err) {
    return {
      text: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
      status: 'failed',
      metadata: {
        toolPolicy: getOpenSwanToolPolicy(name as OpenSwanRuntimeToolName, ctx.activePluginIds),
      },
    };
  }
}
