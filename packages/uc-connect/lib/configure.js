/**
 * configure.js — Write hook configs for each AI tool
 * Configures tools to POST heartbeats to the Supabase agent-connect edge function.
 * Zero npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { AGENT_CONNECT_URL } = require('./validate');

const HOME = os.homedir();

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ── Claude Code: native HTTP hooks ──────────────────────────────────────────

function configureClaudeCode(token) {
  const settingsPath = path.join(HOME, '.claude', 'settings.json');
  const existing = readJson(settingsPath) || {};
  const results = [];

  const hookEntry = {
    type: 'http',
    url: AGENT_CONNECT_URL,
    timeout: 3,
    headers: { 'Authorization': 'Bearer $UC_CONNECT_TOKEN' },
    allowedEnvVars: ['UC_CONNECT_TOKEN'],
  };
  const matcherWrap = [{ matcher: '', hooks: [hookEntry] }];

  if (!existing.hooks) existing.hooks = {};

  for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
    const existingHooks = existing.hooks[event] || [];
    const alreadyConfigured = existingHooks.some(m =>
      m.hooks && m.hooks.some(h => h.url && h.url.includes('agent-connect'))
    );
    if (!alreadyConfigured) {
      existing.hooks[event] = [...existingHooks, ...matcherWrap];
      results.push(`  Added ${event} hook`);
    } else {
      results.push(`  ${event} hook already configured`);
    }
  }

  writeJson(settingsPath, existing);
  results.unshift(`Wrote ${settingsPath}`);

  const envResult = setEnvVar('UC_CONNECT_TOKEN', token);
  results.push(...envResult);

  return results;
}

// ── Codex: config file hooks ────────────────────────────────────────────────

function configureCodex(token) {
  const configPath = path.join(HOME, '.codex', 'config.json');
  const existing = readJson(configPath) || {};
  const results = [];

  const curlCmd = buildCurlCmd(token, 'codex');

  if (!existing.hooks) existing.hooks = {};

  const existingHooks = existing.hooks.PostToolUse || [];
  const alreadyConfigured = existingHooks.some(h =>
    h.command && h.command.includes('agent-connect')
  );

  if (!alreadyConfigured) {
    existing.hooks.PostToolUse = [
      ...existingHooks,
      { type: 'command', command: curlCmd },
    ];
    results.push('  Added PostToolUse hook');
  } else {
    results.push('  PostToolUse hook already configured');
  }

  writeJson(configPath, existing);
  results.unshift(`Wrote ${configPath}`);

  return results;
}

// ── Gemini CLI: settings file hooks ─────────────────────────────────────────

function configureGeminiCli(token) {
  const settingsPath = path.join(HOME, '.gemini', 'settings.json');
  const existing = readJson(settingsPath) || {};
  const results = [];

  const curlCmd = buildCurlCmd(token, 'gemini-cli');

  if (!existing.hooks) existing.hooks = {};

  const existingHooks = existing.hooks.PostToolUse || [];
  const alreadyConfigured = existingHooks.some(h =>
    h.command && h.command.includes('agent-connect')
  );

  if (!alreadyConfigured) {
    existing.hooks.PostToolUse = [
      ...existingHooks,
      { type: 'command', command: curlCmd },
    ];
    results.push('  Added PostToolUse hook');
  } else {
    results.push('  PostToolUse hook already configured');
  }

  writeJson(settingsPath, existing);
  results.unshift(`Wrote ${settingsPath}`);

  return results;
}

// ── Cursor: MCP server config ───────────────────────────────────────────────

function configureCursor(token) {
  const mcpPath = path.join(HOME, '.cursor', 'mcp.json');
  const existing = readJson(mcpPath) || {};
  const results = [];

  if (!existing.mcpServers) existing.mcpServers = {};

  if (existing.mcpServers['underground-circle']) {
    results.push('  MCP server already configured');
    existing.mcpServers['underground-circle'].env.UC_CONNECT_TOKEN = token;
  } else {
    existing.mcpServers['underground-circle'] = {
      type: 'stdio',
      command: 'npx',
      args: ['@underground-circle/connect', '--mcp'],
      env: {
        UC_CONNECT_TOKEN: token,
        UC_AGENT_TYPE: 'cursor',
      },
    };
    results.push('  Added underground-circle MCP server');
  }

  writeJson(mcpPath, existing);
  results.unshift(`Wrote ${mcpPath}`);

  return results;
}

// ── Set environment variable ────────────────────────────────────────────────

function setEnvVar(name, value) {
  const results = [];

  if (process.platform === 'win32') {
    try {
      require('child_process').execSync(`setx ${name} "${value}"`, { stdio: 'ignore' });
      results.push(`Set ${name} via setx (Windows)`);
    } catch {
      results.push(`Could not set ${name} via setx -- add manually:`);
      results.push(`  set ${name}=${value}`);
    }
    return results;
  }

  // Unix: append to shell rc files
  const marker = '# underground-circle agent connect';
  const exportLine = `export ${name}="${value}"  ${marker}`;

  for (const rcFile of ['.bashrc', '.zshrc']) {
    const rcPath = path.join(HOME, rcFile);
    if (!fs.existsSync(rcPath)) continue;

    const content = fs.readFileSync(rcPath, 'utf-8');
    if (content.includes(marker)) {
      const escapedMarker = marker.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^export ${name}=.*${escapedMarker}.*$`, 'm');
      const updated = content.replace(regex, exportLine);
      fs.writeFileSync(rcPath, updated);
      results.push(`Updated ${name} in ~/${rcFile}`);
    } else {
      fs.appendFileSync(rcPath, `\n${exportLine}\n`);
      results.push(`Added ${name} to ~/${rcFile}`);
    }
  }

  process.env[name] = value;

  if (results.length === 0) {
    results.push(`Add to your shell profile:`);
    results.push(`  export ${name}="${value}"`);
  }

  return results;
}

// ── Shared curl builder ─────────────────────────────────────────────────────

function buildCurlCmd(token, agentType) {
  return `curl -sX POST '${AGENT_CONNECT_URL}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"event":"heartbeat","agent_type":"${agentType}"}' &>/dev/null &`;
}

// ── Configure a tool by type ────────────────────────────────────────────────

function configure(toolType, token) {
  switch (toolType) {
    case 'claude-code': return configureClaudeCode(token);
    case 'codex':       return configureCodex(token);
    case 'gemini-cli':  return configureGeminiCli(token);
    case 'cursor':      return configureCursor(token);
    default:            return [`Unknown tool type: ${toolType}`];
  }
}

// ── Remove UC hooks (for --uninstall) ───────────────────────────────────────

function unconfigure(toolType) {
  const results = [];

  switch (toolType) {
    case 'claude-code': {
      const settingsPath = path.join(HOME, '.claude', 'settings.json');
      const settings = readJson(settingsPath);
      if (settings && settings.hooks) {
        for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
          if (settings.hooks[event]) {
            settings.hooks[event] = settings.hooks[event].filter(m =>
              !(m.hooks && m.hooks.some(h => h.url && h.url.includes('agent-connect')))
            );
            if (settings.hooks[event].length === 0) delete settings.hooks[event];
          }
        }
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
        writeJson(settingsPath, settings);
        results.push(`Removed UC hooks from ${settingsPath}`);
      }
      break;
    }
    case 'cursor': {
      const mcpPath = path.join(HOME, '.cursor', 'mcp.json');
      const mcp = readJson(mcpPath);
      if (mcp && mcp.mcpServers && mcp.mcpServers['underground-circle']) {
        delete mcp.mcpServers['underground-circle'];
        writeJson(mcpPath, mcp);
        results.push(`Removed UC MCP server from ${mcpPath}`);
      }
      break;
    }
    case 'codex': {
      const configPath = path.join(HOME, '.codex', 'config.json');
      const config = readJson(configPath);
      if (config && config.hooks && config.hooks.PostToolUse) {
        config.hooks.PostToolUse = config.hooks.PostToolUse.filter(h =>
          !(h.command && h.command.includes('agent-connect'))
        );
        writeJson(configPath, config);
        results.push(`Removed UC hooks from ${configPath}`);
      }
      break;
    }
    case 'gemini-cli': {
      const settingsPath = path.join(HOME, '.gemini', 'settings.json');
      const settings = readJson(settingsPath);
      if (settings && settings.hooks && settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
          !(h.command && h.command.includes('agent-connect'))
        );
        writeJson(settingsPath, settings);
        results.push(`Removed UC hooks from ${settingsPath}`);
      }
      break;
    }
  }

  // Remove env var from shell rc files
  const marker = '# underground-circle agent connect';
  for (const rcFile of ['.bashrc', '.zshrc']) {
    const rcPath = path.join(HOME, rcFile);
    if (!fs.existsSync(rcPath)) continue;
    const content = fs.readFileSync(rcPath, 'utf-8');
    if (content.includes(marker)) {
      const escapedMarker = marker.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\n?export UC_CONNECT_TOKEN=.*${escapedMarker}.*`, 'g');
      const updated = content.replace(regex, '');
      fs.writeFileSync(rcPath, updated);
      results.push(`Removed UC_CONNECT_TOKEN from ~/${rcFile}`);
    }
  }

  return results;
}

module.exports = { configure, unconfigure };
