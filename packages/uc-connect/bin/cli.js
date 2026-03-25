#!/usr/bin/env node
/**
 * uc-connect — Auto-connect your AI agents to The Underground Circle
 *
 * Usage:
 *   npx @underground-circle/connect --token=TOKEN
 *   npx @underground-circle/connect --token=TOKEN --agent=claude-code
 *   npx @underground-circle/connect --status
 *   npx @underground-circle/connect --uninstall
 *
 * Zero npm dependencies (Node.js built-ins only).
 */

const { detectAll } = require('../lib/detect');
const { configure, unconfigure } = require('../lib/configure');
const { validateToken } = require('../lib/validate');

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { token: null, agent: null, status: false, uninstall: false, help: false };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--token=')) args.token = arg.slice(8);
    else if (arg.startsWith('--agent=')) args.agent = arg.slice(8);
    else if (arg === '--status') args.status = true;
    else if (arg === '--uninstall') args.uninstall = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!arg.startsWith('--')) args.token = args.token || arg;
  }

  // Check env var fallback
  if (!args.token) args.token = process.env.UC_CONNECT_TOKEN || null;

  return args;
}

// ── Terminal colors ─────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg) { console.log(msg); }
function success(msg) { log(`${c.green}OK${c.reset} ${msg}`); }
function warn(msg) { log(`${c.yellow}!!${c.reset} ${msg}`); }
function info(msg) { log(`${c.blue}>>${c.reset} ${msg}`); }
function fail(msg) { log(`${c.red}ERR${c.reset} ${msg}`); }

// ── Commands ────────────────────────────────────────────────────────────────

function showHelp() {
  log(`
${c.bold}uc-connect${c.reset} — Auto-connect AI agents to The Underground Circle

${c.bold}Usage:${c.reset}
  npx @underground-circle/connect --token=TOKEN   Configure all detected tools
  npx @underground-circle/connect --status         Show what's configured
  npx @underground-circle/connect --uninstall      Remove all UC hooks

${c.bold}Options:${c.reset}
  --token=TOKEN   Your connect token (from the app's Office tab)
  --agent=TYPE    Only configure a specific agent (claude-code, codex, gemini-cli, cursor)
  --status        Show detected tools and their configuration status
  --uninstall     Remove all Underground Circle hooks from your tools
  -h, --help      Show this help

${c.bold}Supported agents:${c.reset}
  claude-code     Claude Code (native HTTP hooks — best experience)
  codex           OpenAI Codex CLI
  gemini-cli      Google Gemini CLI
  cursor          Cursor AI Editor (MCP server)

${c.bold}How it works:${c.reset}
  This tool configures your AI agents to automatically report their
  activity to your Underground Circle. Once configured, your agents
  appear in the Office whenever you use them — no bridge scripts needed.

${c.bold}Get your token:${c.reset}
  Open The Underground Circle app > Office tab > "Connect Your Agent"
`);
}

function showStatus() {
  log(`\n${c.bold}Detected AI Tools${c.reset}\n`);
  const tools = detectAll();

  if (tools.length === 0) {
    warn('No supported AI tools detected on this machine.');
    log(`  Supported: Claude Code, Codex, Gemini CLI, Cursor`);
    log(`  Make sure the tool is installed and its config directory exists.\n`);
    return;
  }

  for (const tool of tools) {
    const statusIcon = tool.isConfigured ? `${c.green}connected` : `${c.dim}not connected`;
    const cliIcon = tool.hasCli ? `${c.green}installed` : `${c.dim}dir only`;
    log(`  ${c.bold}${tool.label}${c.reset}`);
    log(`    Status: ${statusIcon}${c.reset}`);
    log(`    CLI:    ${cliIcon}${c.reset}`);
    log(`    Config: ${tool.configDir}`);
    log('');
  }
}

async function runSetup(token, agentFilter) {
  log(`\n${c.bold}Underground Circle — Agent Connect${c.reset}\n`);

  // Step 1: Validate token
  info('Validating connect token...');
  const validation = await validateToken(token);

  if (!validation.ok) {
    fail(`Token validation failed: ${validation.error}`);
    log(`  Make sure your token is correct. Get it from the app's Office tab.\n`);
    process.exit(1);
  }

  success(`Token valid${validation.displayName ? ` (${validation.displayName})` : ''}`);
  if (validation.circleId) {
    info(`Circle: ${validation.circleId}`);
  }
  log('');

  // Step 2: Detect tools
  info('Scanning for AI tools...');
  let tools = detectAll();

  if (agentFilter) {
    tools = tools.filter(t => t.type === agentFilter);
    if (tools.length === 0) {
      fail(`Agent "${agentFilter}" not found on this machine.`);
      process.exit(1);
    }
  }

  if (tools.length === 0) {
    warn('No supported AI tools detected.');
    log(`  Install Claude Code, Codex, Gemini CLI, or Cursor first.\n`);
    process.exit(0);
  }

  log(`  Found: ${tools.map(t => t.label).join(', ')}\n`);

  // Step 3: Configure each tool
  for (const tool of tools) {
    info(`Configuring ${c.bold}${tool.label}${c.reset}...`);
    try {
      const results = configure(tool.type, token);
      for (const line of results) {
        log(`  ${c.dim}${line}${c.reset}`);
      }
      success(`${tool.label} configured\n`);
    } catch (err) {
      fail(`Failed to configure ${tool.label}: ${err.message}\n`);
    }
  }

  // Step 4: Summary
  log(`${c.green}${c.bold}Done!${c.reset} Your agents will now auto-connect to The Underground Circle.`);
  log(`${c.dim}Next time you start ${tools.map(t => t.label).join(' or ')}, it will appear in the Office.${c.reset}\n`);

  if (tools.some(t => t.type === 'claude-code')) {
    log(`${c.dim}Note: Restart any running Claude Code sessions for hooks to take effect.${c.reset}\n`);
  }
}

async function runUninstall() {
  log(`\n${c.bold}Underground Circle — Uninstall Agent Hooks${c.reset}\n`);

  const tools = detectAll();

  if (tools.length === 0) {
    info('No AI tools found — nothing to uninstall.\n');
    return;
  }

  for (const tool of tools) {
    info(`Removing UC hooks from ${tool.label}...`);
    const results = unconfigure(tool.type);
    if (results.length === 0) {
      log(`  ${c.dim}No UC hooks found${c.reset}`);
    } else {
      for (const line of results) {
        log(`  ${c.dim}${line}${c.reset}`);
      }
    }
    log('');
  }

  success('All Underground Circle hooks removed.\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) return showHelp();
  if (args.status) return showStatus();
  if (args.uninstall) return runUninstall();

  if (!args.token) {
    fail('Missing connect token.\n');
    log(`  Usage: npx @underground-circle/connect --token=YOUR_TOKEN`);
    log(`  Get your token from the app's Office tab.\n`);
    process.exit(1);
  }

  await runSetup(args.token, args.agent);
}

main().catch(err => {
  fail(err.message);
  process.exit(1);
});
