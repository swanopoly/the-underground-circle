export type TerminalAgentProvider = 'claude-code' | 'codex' | 'gemini';

export type TerminalAgentLaunchResult = {
  ok: boolean;
  launchId?: string;
  sessions: unknown[];
  launched: number;
  failed: Array<{ sessionId?: string; displayName?: string; error: string }>;
  projectDir?: string;
  error?: string;
};

const MAX_TERMINAL_AGENT_SESSIONS = 20;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const PROVIDER_META: Record<TerminalAgentProvider, { label: string; namePrefix: string; aliases: RegExp[] }> = {
  'claude-code': {
    label: 'Claude Code',
    namePrefix: 'Claude Code',
    aliases: [/\bclaude\s+code\b/i, /\bclaude-code\b/i, /\bclaude\b/i],
  },
  codex: {
    label: 'Codex',
    namePrefix: 'Codex',
    aliases: [/\bcodex\b/i],
  },
  gemini: {
    label: 'Gemini CLI',
    namePrefix: 'Gemini CLI',
    aliases: [/\bgemini\s+cli\b/i, /\bgemini\b/i],
  },
};

export interface TerminalAgentLaunchPlan {
  provider: TerminalAgentProvider;
  providerLabel: string;
  count: number;
  prompts: string[];
  names: string[];
  usedDefaultPrompts: boolean;
  basePrompt?: string;
  raw: string;
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_TERMINAL_AGENT_SESSIONS, Math.floor(value)));
}

function cleanPrompt(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/^\s*(?:\d+[\.)]|[-*])\s*/, '')
    .replace(/\s+$/g, '')
    .trim();
}

function detectProvider(message: string): TerminalAgentProvider | null {
  for (const [provider, meta] of Object.entries(PROVIDER_META) as Array<[TerminalAgentProvider, typeof PROVIDER_META[TerminalAgentProvider]]>) {
    if (meta.aliases.some((alias) => alias.test(message))) return provider;
  }
  return null;
}

function extractCount(message: string): number {
  const numericPatterns = [
    /\b(\d{1,2})\s+(?:separate|seperate|different|individual)?\s*(?:claude\s+code|codex|gemini\s+cli|gemini)?\s*(?:sessions?|agents?|terminals?|windows?)\b/i,
    /\b(?:sessions?|agents?|terminals?|windows?)\s*[x*]?\s*(\d{1,2})\b/i,
  ];
  for (const pattern of numericPatterns) {
    const match = message.match(pattern);
    if (match) return clampCount(Number(match[1]));
  }

  const words = Object.keys(NUMBER_WORDS).join('|');
  const wordPattern = new RegExp(`\\b(${words})\\s+(?:separate|seperate|different|individual)?\\s*(?:claude\\s+code|codex|gemini\\s+cli|gemini)?\\s*(?:sessions?|agents?|terminals?|windows?)\\b`, 'i');
  const wordMatch = message.match(wordPattern);
  if (wordMatch) return clampCount(NUMBER_WORDS[wordMatch[1].toLowerCase()]);

  return 1;
}

function extractPromptTail(message: string): string {
  const promptMatch = message.match(/\b(?:with\s+)?prompts?\s*:\s*([\s\S]+)$/i);
  return promptMatch ? promptMatch[1].trim() : '';
}

function splitPromptTail(tail: string): string[] {
  if (!tail) return [];
  const pipeParts = tail.split(/\s*\|\|\s*/).map(cleanPrompt).filter(Boolean);
  if (pipeParts.length > 1) return pipeParts;

  const inlineNumbered = tail
    .split(/\s+(?=\d+[\.)]\s+)/)
    .map(cleanPrompt)
    .filter(Boolean);
  if (inlineNumbered.length > 1) return inlineNumbered;

  const lines = tail.split(/\r?\n/).map(cleanPrompt).filter(Boolean);
  if (lines.length > 1) return lines;

  const semicolonParts = tail.split(/\s*;\s*/).map(cleanPrompt).filter(Boolean);
  if (semicolonParts.length > 1) return semicolonParts;

  return [cleanPrompt(tail)].filter(Boolean);
}

function extractBasePrompt(message: string): string {
  const explicit = message.match(/\b(?:with\s+)?prompt\s*:\s*([\s\S]+)$/i);
  if (explicit) return cleanPrompt(explicit[1]);

  const task = message.match(/\b(?:to|for)\s+([\s\S]+)$/i);
  if (!task) return '';
  const value = cleanPrompt(task[1])
    .replace(/\b(?:in|inside)\s+(?:my\s+)?terminal\s*$/i, '')
    .trim();
  if (/^(?:my\s+)?terminal$/i.test(value)) return '';
  return value;
}

function buildPrompts(providerLabel: string, count: number, promptList: string[], basePrompt: string): { prompts: string[]; usedDefaultPrompts: boolean } {
  if (promptList.length > 0) {
    return {
      prompts: Array.from({ length: count }, (_, i) => promptList[i] || promptList[promptList.length - 1]),
      usedDefaultPrompts: false,
    };
  }

  if (basePrompt) {
    return {
      prompts: Array.from({ length: count }, (_, i) => [
        basePrompt,
        '',
        `You are ${providerLabel} session ${i + 1}/${count}. Work independently and report concise findings or changes in your terminal.`,
      ].join('\n')),
      usedDefaultPrompts: false,
    };
  }

  return {
    prompts: Array.from({ length: count }, (_, i) => (
      `Stand by as ${providerLabel} session ${i + 1}/${count}. Wait for a delegated task from The Underground Circle.`
    )),
    usedDefaultPrompts: true,
  };
}

export function parseTerminalAgentLaunchRequest(message: string): TerminalAgentLaunchPlan | null {
  const raw = String(message || '').trim();
  if (!raw) return null;
  if (!/\b(start|launch|open|spawn|spin up|run|create)\b/i.test(raw)) return null;
  if (!/\b(sessions?|agents?|terminals?|windows?)\b/i.test(raw)) return null;

  const provider = detectProvider(raw);
  if (!provider) return null;

  const meta = PROVIDER_META[provider];
  const promptList = splitPromptTail(extractPromptTail(raw));
  const count = clampCount(Math.max(extractCount(raw), promptList.length || 0));
  const basePrompt = promptList.length > 0 ? '' : extractBasePrompt(raw);
  const built = buildPrompts(meta.label, count, promptList, basePrompt);

  return {
    provider,
    providerLabel: meta.label,
    count,
    prompts: built.prompts,
    names: Array.from({ length: count }, (_, i) => count === 1 ? meta.label : `${meta.namePrefix} #${i + 1}`),
    usedDefaultPrompts: built.usedDefaultPrompts,
    basePrompt: basePrompt || undefined,
    raw,
  };
}

export function formatTerminalAgentLaunchResponse(plan: TerminalAgentLaunchPlan, result: TerminalAgentLaunchResult): string {
  if (!result.ok && result.launched === 0) {
    const detail = result.error || result.failed[0]?.error || `${plan.providerLabel} launch failed.`;
    return [
      `I could not start the ${plan.providerLabel} terminal sessions: ${detail}`,
      '',
      'Make sure the matching local bridge is running:',
      plan.provider === 'claude-code' ? '`npm run bridge`' : plan.provider === 'codex' ? '`npm run bridge:codex`' : '`node scripts/gemini-bridge.js`',
    ].join('\n');
  }

  const sessionWord = result.launched === 1 ? 'session' : 'sessions';
  const lines = [
    `Started ${result.launched}/${plan.count} ${plan.providerLabel} terminal ${sessionWord}.`,
    `Registered in Office as ${plan.names.slice(0, result.launched).join(', ')}.`,
  ];

  if (result.projectDir) lines.push(`Project: ${result.projectDir}`);
  if (plan.usedDefaultPrompts) {
    lines.push('No individual prompts were included, so I sent standby prompts. Use `with prompts:` to give each session its own task.');
  } else {
    lines.push(`Sent ${plan.prompts.length} delegated prompt${plan.prompts.length === 1 ? '' : 's'} to the launched sessions.`);
  }
  if (result.failed.length > 0) {
    lines.push('');
    lines.push(`Failed: ${result.failed.map((f) => `${f.displayName || f.sessionId || 'session'} (${f.error})`).join('; ')}`);
  }
  return lines.join('\n');
}
