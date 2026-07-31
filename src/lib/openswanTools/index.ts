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
  getOpenSwanToolPolicy,
  listOpenSwanAnthropicToolsForSurface,
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
  runId?: string;
  activePluginIds?: string[];
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
): { mutatesState: boolean; externalSideEffect: boolean; approvalMode: string } {
  const p = getOpenSwanToolPolicy(name as OpenSwanRuntimeToolName, activePluginIds);
  return { mutatesState: p.mutatesState, externalSideEffect: p.externalSideEffect, approvalMode: p.approvalMode };
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
    const result = await executeOpenSwanRuntimeTool(
      name as OpenSwanRuntimeToolName,
      input as any,
      ctx as OpenSwanRuntimeToolContext,
    );
    const text = formatOpenSwanRuntimeToolResult(name as OpenSwanRuntimeToolName, result as any);
    const policy = getOpenSwanToolPolicy(name as OpenSwanRuntimeToolName, ctx.activePluginIds);
    const approvalRequest = (result as any).approvalRequest || null;
    const capture = buildDesignAppRuntimeToolCaptureMetadata(name, result, input);
    const engineeringCapture = buildEngineeringToolCaptureMetadata(name, result, input);
    const metadata = {
      ...withDesignAppRuntimeCaptureMetadata({
        ...(name === 'browser.plan_task' ? { browserPlan: (result as any).plan || null } : {}),
        toolPolicy: policy,
        approvalRequest,
      }, capture),
      ...(engineeringCapture || {}),
    };
    const status: OpenSwanExecutionStatus = approvalRequest
      ? 'manual_required'
      : name.startsWith('verification.') && (result as any).executed === false
        ? 'blocked'
        : (result as any).ok === false
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
