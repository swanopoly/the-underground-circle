/**
 * agentConnect.ts — Client-side library for the cloud agent connect system
 *
 * Manages connect tokens, generates hook configs for each agent type,
 * and polls for cloud-connected agents.
 *
 * Supports native HTTP hooks for Claude Code (auto-sends session metadata)
 * and curl-based hooks for other agents.
 */

import { supabase } from './supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectToken = {
  id: string;
  userId: string;
  token: string;
  label: string;
  circleId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type AgentType =
  | 'claude-code' | 'codex' | 'gemini-cli'
  | 'cursor' | 'windsurf' | 'copilot'
  | 'aider' | 'cline';

export type HookConfig = {
  agentType: AgentType;
  label: string;
  description: string;
  configSnippet: string;
  configPath: string;
  instructions: string[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://rjkniqiqdtroeholxacg.supabase.co';

const AGENT_CONNECT_URL = `${SUPABASE_URL}/functions/v1/agent-connect`;

// ── Token management ─────────────────────────────────────────────────────────

export async function listConnectTokens(): Promise<ConnectToken[]> {
  const { data, error } = await supabase
    .from('agent_connect_tokens')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map(row => ({
    id: row.id,
    userId: row.user_id,
    token: row.token,
    label: row.label || 'default',
    circleId: row.circle_id,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));
}

export async function createConnectToken(
  circleId?: string,
  label?: string,
): Promise<ConnectToken> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('agent_connect_tokens')
    .insert({
      user_id: auth.user.id,
      circle_id: circleId || null,
      label: label || 'default',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    userId: data.user_id,
    token: data.token,
    label: data.label,
    circleId: data.circle_id,
    lastUsedAt: data.last_used_at,
    createdAt: data.created_at,
  };
}

export async function deleteConnectToken(tokenId: string): Promise<void> {
  const { error } = await supabase
    .from('agent_connect_tokens')
    .delete()
    .eq('id', tokenId);

  if (error) throw new Error(error.message);
}

// ── Hook config generators ───────────────────────────────────────────────────

export function generateHookConfig(
  agentType: AgentType,
  token: string,
): HookConfig {
  switch (agentType) {
    case 'claude-code': return generateClaudeCodeHook(token);
    case 'codex':       return generateCodexHook(token);
    case 'gemini-cli':  return generateGeminiHook(token);
    case 'cursor':      return generateCursorHook(token);
    case 'windsurf':    return generateWindsurfHook(token);
    case 'copilot':     return generateCopilotHook(token);
    case 'aider':       return generateAiderHook(token);
    case 'cline':       return generateClineHook(token);
    default:            return generateClaudeCodeHook(token);
  }
}

// ── Claude Code: native HTTP hooks (best experience) ─────────────────────────
// type:"http" hooks auto-send session_id, model, cwd, hook_event_name as JSON
// Our edge function detects this format and extracts the data automatically.

function generateClaudeCodeHook(token: string): HookConfig {
  // Build the hook object that uses $UC_CONNECT_TOKEN env var
  const hookEntry = {
    type: "http",
    url: AGENT_CONNECT_URL,
    timeout: 3,
    headers: { "Authorization": "Bearer $UC_CONNECT_TOKEN" },
    allowedEnvVars: ["UC_CONNECT_TOKEN"],
  };
  const matcherWrap = [{ matcher: "", hooks: [hookEntry] }];

  const configSnippet =
`# Step 1: Set your connect token as an env var
# Add to ~/.bashrc or ~/.zshrc:
export UC_CONNECT_TOKEN="${token}"

# Step 2: Add this to ~/.claude/settings.json:
${JSON.stringify({ hooks: {
  SessionStart: matcherWrap,
  PostToolUse: matcherWrap,
  SessionEnd: matcherWrap,
} }, null, 2)}

# --- OR use the MCP server (alternative) ---
# claude mcp add --transport stdio uc-connect \\
#   --env UC_CONNECT_TOKEN=${token} \\
#   -- node scripts/mcp-agent-connect.js`;

  return {
    agentType: 'claude-code',
    label: 'Claude Code',
    description: 'Native HTTP hooks — auto-sends session ID, model, and working directory',
    configPath: '~/.claude/settings.json',
    configSnippet,
    instructions: [
      'Set your connect token as an env var in ~/.bashrc:',
      `  export UC_CONNECT_TOKEN="${token}"`,
      'Then add the hooks to ~/.claude/settings.json.',
      'If you already have hooks, merge the arrays.',
      'Claude Code auto-sends session data on every event.',
    ],
  };
}

/** Generate a project-level .claude/settings.json for team repos */
export function generateTeamConfig(): string {
  // Uses env var so each developer uses their own token
  const hookEntry = {
    type: "http",
    url: AGENT_CONNECT_URL,
    timeout: 3,
    headers: { "Authorization": "Bearer $UC_CONNECT_TOKEN" },
    allowedEnvVars: ["UC_CONNECT_TOKEN"],
  };
  const matcherWrap = [{ matcher: "", hooks: [hookEntry] }];

  return JSON.stringify({
    hooks: {
      SessionStart: matcherWrap,
      PostToolUse: matcherWrap,
      SessionEnd: matcherWrap,
    },
  }, null, 2);
}

/** Generate MCP server add command */
export function generateMcpCommand(token: string): string {
  return `claude mcp add --transport stdio uc-connect \\
  --env UC_CONNECT_TOKEN=${token} \\
  -- node scripts/mcp-agent-connect.js`;
}

// ── Codex: curl-based hooks ──────────────────────────────────────────────────

function generateCodexHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'codex');

  const configSnippet = JSON.stringify({
    hooks: {
      PostToolUse: [
        { type: "command", command: curlCmd },
      ],
    },
  }, null, 2);

  return {
    agentType: 'codex',
    label: 'OpenAI Codex',
    description: 'Hooks into Codex CLI sessions',
    configPath: '~/.codex/config.json',
    configSnippet,
    instructions: [
      'Open your Codex config file:',
      '  ~/.codex/config.json',
      'Add the hooks section from the config below.',
      'Codex will now report activity to your circle automatically.',
    ],
  };
}

// ── Gemini CLI: curl-based hooks ─────────────────────────────────────────────

function generateGeminiHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'gemini-cli');

  const configSnippet = JSON.stringify({
    hooks: {
      PostToolUse: [
        { type: "command", command: curlCmd },
      ],
    },
  }, null, 2);

  return {
    agentType: 'gemini-cli',
    label: 'Gemini CLI',
    description: 'Hooks into Gemini CLI sessions',
    configPath: '~/.gemini/settings.json',
    configSnippet,
    instructions: [
      'Open your Gemini CLI settings:',
      '  ~/.gemini/settings.json',
      'Add the hooks section from the config below.',
      'Gemini CLI will report activity to your circle.',
    ],
  };
}

// ── Cursor: cron/task based ──────────────────────────────────────────────────

function generateCursorHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'cursor');

  const configSnippet = `# Cursor doesn't have a native hooks system yet.
# Use one of these options:

# Option A: Shell alias (fires on every launch)
alias cursor='${curlCmd} && command cursor'

# Option B: Cron job (heartbeat every 5 min while Cursor runs)
# Add to crontab -e:
*/5 * * * * pgrep -x cursor > /dev/null && ${curlCmd}`;

  return {
    agentType: 'cursor',
    label: 'Cursor',
    description: 'Connect Cursor via shell alias or cron',
    configPath: '~/.bashrc or crontab',
    configSnippet,
    instructions: [
      'Cursor doesn\'t have native hooks yet.',
      'Option A: Add the shell alias to ~/.bashrc or ~/.zshrc',
      'Option B: Add the cron job to fire while Cursor is running',
    ],
  };
}

// ── Windsurf: similar to Cursor ──────────────────────────────────────────────

function generateWindsurfHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'windsurf');

  const configSnippet = `# Windsurf doesn't have a native hooks system yet.
# Use one of these options:

# Option A: Shell alias (fires on every launch)
alias windsurf='${curlCmd} && command windsurf'

# Option B: Cron job (heartbeat every 5 min while Windsurf runs)
# Add to crontab -e:
*/5 * * * * pgrep -f windsurf > /dev/null && ${curlCmd}`;

  return {
    agentType: 'windsurf',
    label: 'Windsurf',
    description: 'Connect Windsurf via shell alias or cron',
    configPath: '~/.bashrc or crontab',
    configSnippet,
    instructions: [
      'Windsurf doesn\'t have native hooks yet.',
      'Option A: Add the shell alias to ~/.bashrc or ~/.zshrc',
      'Option B: Add the cron job to fire while Windsurf is running',
    ],
  };
}

// ── Copilot: VS Code extension based ─────────────────────────────────────────

function generateCopilotHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'copilot');

  const configSnippet = `# GitHub Copilot runs inside VS Code — no native hook system.
# Use a cron job to detect when VS Code (with Copilot) is running:

# Add to crontab -e:
*/5 * * * * pgrep -f "code" > /dev/null && ${curlCmd}

# Or add a VS Code task in .vscode/tasks.json:
{
  "version": "2.0.0",
  "tasks": [{
    "label": "UC Heartbeat",
    "type": "shell",
    "command": "${curlCmd}",
    "runOptions": { "runOn": "folderOpen" }
  }]
}`;

  return {
    agentType: 'copilot',
    label: 'GitHub Copilot',
    description: 'Connect Copilot via VS Code task or cron',
    configPath: '.vscode/tasks.json or crontab',
    configSnippet,
    instructions: [
      'Copilot runs inside VS Code with no hook system.',
      'Option A: Add the VS Code task (auto-fires on folder open)',
      'Option B: Add the cron job to fire while VS Code runs',
    ],
  };
}

// ── Aider: wrapper script ────────────────────────────────────────────────────

function generateAiderHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'aider');

  const configSnippet = `# Aider doesn't have native hooks.
# Use a shell alias to fire a heartbeat on every launch:

# Add to ~/.bashrc or ~/.zshrc:
alias aider='${curlCmd} && command aider'

# Or create a wrapper script at ~/bin/aider-uc:
#!/bin/bash
${curlCmd}
exec aider "$@"`;

  return {
    agentType: 'aider',
    label: 'Aider',
    description: 'Connect Aider via shell alias',
    configPath: '~/.bashrc or ~/bin/aider-uc',
    configSnippet,
    instructions: [
      'Aider doesn\'t have native hooks.',
      'Add the shell alias to ~/.bashrc or ~/.zshrc.',
      'Your agent will appear in the circle when you run aider.',
    ],
  };
}

// ── Cline: VS Code extension based ──────────────────────────────────────────

function generateClineHook(token: string): HookConfig {
  const curlCmd = buildCurlCmd(token, 'cline');

  const configSnippet = `# Cline runs as a VS Code extension — no native hook system.
# Use a cron job or VS Code task:

# Add to crontab -e:
*/5 * * * * pgrep -f "code" > /dev/null && ${curlCmd}

# Or add a VS Code task in .vscode/tasks.json:
{
  "version": "2.0.0",
  "tasks": [{
    "label": "UC Heartbeat",
    "type": "shell",
    "command": "${curlCmd}",
    "runOptions": { "runOn": "folderOpen" }
  }]
}`;

  return {
    agentType: 'cline',
    label: 'Cline',
    description: 'Connect Cline via VS Code task or cron',
    configPath: '.vscode/tasks.json or crontab',
    configSnippet,
    instructions: [
      'Cline runs inside VS Code with no hook system.',
      'Option A: Add the VS Code task (auto-fires on folder open)',
      'Option B: Add the cron job to fire while VS Code runs',
    ],
  };
}

// ── Shared curl builder ──────────────────────────────────────────────────────

function buildCurlCmd(token: string, agentType: string): string {
  return `curl -sX POST '${AGENT_CONNECT_URL}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"event":"heartbeat","agent_type":"${agentType}"}' &>/dev/null &`;
}

// ── Cloud agent polling ──────────────────────────────────────────────────────

export async function pollCloudAgents(circleId: string): Promise<{
  agents: Array<{
    id: string;
    name: string;
    provider: string;
    status: string;
    currentTask: string | null;
    lastActiveAt: string | null;
    ownerDisplayName: string;
    isCloudConnected: boolean;
  }>;
}> {
  const { data, error } = await supabase
    .from('circle_office_agents')
    .select('id, name, provider, status, current_task, last_active_at, owner_display_name, gateway_url')
    .eq('circle_id', circleId)
    .eq('is_published', true)
    .is('gateway_url', null);

  if (error) return { agents: [] };

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  return {
    agents: (data || [])
      .filter(r => r.last_active_at && new Date(r.last_active_at).getTime() > fiveMinAgo)
      .map(r => ({
        id: r.id,
        name: r.name,
        provider: r.provider,
        status: r.status,
        currentTask: r.current_task,
        lastActiveAt: r.last_active_at,
        ownerDisplayName: r.owner_display_name,
        isCloudConnected: true,
      })),
  };
}
