/**
 * detect.js — Auto-detect installed AI tools
 * Checks config directories and PATH for supported agents.
 * Zero npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function which(cmd) {
  try {
    const out = execSync(IS_WIN ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`, {
      encoding: 'utf-8', timeout: 5000,
    }).trim();
    return !!out;
  } catch { return false; }
}

function detectClaudeCode() {
  const configDir = path.join(HOME, '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  const hasCli = which('claude');
  const hasDir = exists(configDir);

  if (!hasCli && !hasDir) return null;

  let isConfigured = false;
  if (exists(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      isConfigured = !!(settings.hooks?.SessionStart || settings.hooks?.PostToolUse);
    } catch {}
  }

  return {
    type: 'claude-code',
    label: 'Claude Code',
    configDir,
    settingsPath,
    hasCli,
    isConfigured,
  };
}

function detectCodex() {
  const configDir = path.join(HOME, '.codex');
  const hasCli = which('codex');
  const hasDir = exists(configDir);

  if (!hasCli && !hasDir) return null;

  return {
    type: 'codex',
    label: 'Codex',
    configDir,
    settingsPath: path.join(configDir, 'config.json'),
    hasCli,
    isConfigured: false,
  };
}

function detectGeminiCli() {
  const configDir = path.join(HOME, '.gemini');
  const hasCli = which('gemini');
  const hasDir = exists(configDir);

  if (!hasCli && !hasDir) return null;

  return {
    type: 'gemini-cli',
    label: 'Gemini CLI',
    configDir,
    settingsPath: path.join(configDir, 'settings.json'),
    hasCli,
    isConfigured: false,
  };
}

function detectCursor() {
  const configDir = path.join(HOME, '.cursor');
  const hasDir = exists(configDir);

  // Check common install locations
  let hasCli = which('cursor');
  if (!hasCli && IS_WIN) {
    hasCli = exists(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe'));
  }
  if (!hasCli && process.platform === 'darwin') {
    hasCli = exists('/Applications/Cursor.app');
  }

  if (!hasCli && !hasDir) return null;

  let isConfigured = false;
  const mcpPath = path.join(configDir, 'mcp.json');
  if (exists(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      isConfigured = !!mcp.mcpServers?.['underground-circle'];
    } catch {}
  }

  return {
    type: 'cursor',
    label: 'Cursor',
    configDir,
    settingsPath: mcpPath,
    hasCli,
    isConfigured,
  };
}

function detectAll() {
  const tools = [];
  const detectors = [detectClaudeCode, detectCodex, detectGeminiCli, detectCursor];

  for (const detect of detectors) {
    const result = detect();
    if (result) tools.push(result);
  }

  return tools;
}

module.exports = { detectAll, detectClaudeCode, detectCodex, detectGeminiCli, detectCursor };
