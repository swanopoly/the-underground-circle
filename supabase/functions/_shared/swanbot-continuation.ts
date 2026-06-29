export type SwanBotResumeToolResult = {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export const SWANBOT_MAX_CLIENT_TOOL_RESULTS = 40;
export const SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS = 16_000;

function capClientToolResultContent(value: string): string {
  if (value.length <= SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS) return value;
  const suffix = `\n[client tool result truncated from ${value.length} chars]`;
  return `${value.slice(0, Math.max(0, SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS - suffix.length))}${suffix}`;
}

function normalizeClientToolResultContent(value: unknown): string {
  if (typeof value === "string") return capClientToolResultContent(value);
  try {
    return capClientToolResultContent(JSON.stringify(value ?? {}));
  } catch {
    return capClientToolResultContent(String(value ?? ""));
  }
}

export function validateSwanBotResumeToolResults(
  rawResults: unknown,
  pendingToolUseIds: string[],
): { ok: true; results: SwanBotResumeToolResult[] } | { ok: false; error: string } {
  if (!Array.isArray(rawResults)) {
    return { ok: false, error: "toolResults must be an array" };
  }
  if (pendingToolUseIds.length === 0) {
    return { ok: false, error: "continuation has no pending tool ids" };
  }
  if (pendingToolUseIds.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many pending client tool calls (${pendingToolUseIds.length})` };
  }
  const expected = new Set(pendingToolUseIds);
  if (expected.size !== pendingToolUseIds.length) {
    return { ok: false, error: "continuation contains duplicate pending tool ids" };
  }
  if (rawResults.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many toolResults (${rawResults.length})` };
  }

  const byId = new Map<string, SwanBotResumeToolResult>();
  for (const item of rawResults) {
    const row = (item || {}) as Record<string, unknown>;
    const toolUseId = String(row.tool_use_id || row.id || "").trim();
    if (!toolUseId) return { ok: false, error: "toolResults entries must include tool_use_id" };
    if (!expected.has(toolUseId)) {
      return { ok: false, error: `unexpected tool_result id: ${toolUseId}` };
    }
    if (byId.has(toolUseId)) {
      return { ok: false, error: `duplicate tool_result id: ${toolUseId}` };
    }
    byId.set(toolUseId, {
      tool_use_id: toolUseId,
      content: normalizeClientToolResultContent(Object.prototype.hasOwnProperty.call(row, "content") ? row.content : {}),
      is_error: !!row.is_error,
    });
  }

  const missing = pendingToolUseIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, error: `missing tool_result id(s): ${missing.join(", ")}` };
  }

  return { ok: true, results: pendingToolUseIds.map((id) => byId.get(id)!) };
}
