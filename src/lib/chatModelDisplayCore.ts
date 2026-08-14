// chatModelDisplayCore — pure model-name normalization + section accents for the
// chat model picker. Extracted verbatim from ChatTab.tsx (decomposition unit U4,
// docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md): the model display / label
// logic that has no React/Platform coupling.
//
// PURITY: zero runtime imports (tsx-loadable). No Date.now()/Math.random(). Every
// export is total — hostile input (null/undefined/wrong-type/huge/cyclic) returns
// a safe neutral instead of throwing. The added leading type-guards only fire for
// inputs OUTSIDE each function's declared TypeScript type, so behavior is
// byte-identical to the original for every in-contract (string / string[]) input.
//
// NOTE: the two Platform-coupled style helpers (`modelSectionHoverStyle`,
// `modelSectionTransitionStyle`) are intentionally LEFT BEHIND in ChatTab.tsx —
// they import `react-native`'s Platform and would break tsx smoke purity.

export function colorForOpenRouterAuthor(author?: string): string {
  if (typeof author !== 'string') return '#a78bfa';
  const colors: Record<string, string> = {
    anthropic: '#a855f7',
    deepseek: '#ef4444',
    google: '#3b82f6',
    inclusionai: '#10b981',
    minimax: '#fb7185',
    moonshotai: '#f59e0b',
    nvidia: '#84cc16',
    openai: '#10b981',
    stepfun: '#22c55e',
    tencent: '#f59e0b',
    'x-ai': '#6366f1',
    'z-ai': '#6366f1',
  };
  return colors[author || ''] || '#a78bfa';
}

export const MODEL_SECTION_ACCENTS: Record<string, string> = {
  'action:auto': '#22c55e',
  'base:popular': '#f59e0b',
  'base:code': '#8b5cf6',
  'base:reason': '#ef4444',
  'base:speed': '#06b6d4',
  'base:creative': '#10b981',
  'base:open': '#84cc16',
  'provider:anthropic': '#d97706',
  'provider:openai': '#10a37f',
  'provider:openai_compatible': '#14b8a6',
  'provider:openrouter': '#a78bfa',
  'provider:blackswan': '#f8fafc',
  'provider:hugging_face': '#ffbd45',
  'provider:huggingface': '#ffbd45',
  'provider:replicate': '#38bdf8',
  'provider:groq': '#f97316',
  'provider:google_ai': '#4285f4',
  'provider:mistral_ai': '#fa520f',
  'provider:cohere': '#2dd4bf',
  'provider:perplexity': '#1fb8cd',
  'provider:together_ai': '#0f6fff',
  'provider:fireworks_ai': '#5b36bd',
  'provider:deepseek': '#1a6fe0',
  'provider:z_ai': '#0ea5e9',
  'provider:minimax': '#ec4899',
  'provider:ollama': '#5b21b6',
  'custom:hf-hub': '#fb923c',
  'action:add-hf-hub': '#f97316',
};

export const MODEL_SECTION_FALLBACK_COLORS = [
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#10b981',
  '#84cc16',
  '#d97706',
  '#14b8a6',
  '#38bdf8',
  '#f97316',
  '#a78bfa',
  '#ec4899',
  '#0ea5e9',
];

export function modelSectionAccent(sectionKey: string, fallback = '#6366f1'): string {
  if (typeof sectionKey !== 'string') {
    return typeof fallback === 'string' ? fallback : '#6366f1';
  }
  const explicit = MODEL_SECTION_ACCENTS[sectionKey];
  if (explicit) return explicit;
  let hash = 0;
  for (let i = 0; i < sectionKey.length; i += 1) {
    hash = (hash * 31 + sectionKey.charCodeAt(i)) >>> 0;
  }
  return MODEL_SECTION_FALLBACK_COLORS[hash % MODEL_SECTION_FALLBACK_COLORS.length] || fallback;
}

export const MODEL_ROUTE_PREFIXES = new Set([
  'anthropic',
  'openai',
  'openai_compatible',
  'openrouter',
  'google',
  'google_ai',
  'groq',
  'mistral_ai',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'deepseek',
  'z_ai',
  'zai',
  'minimax',
  'huggingface',
  'hugging_face',
  'huggingface_endpoint',
  'ollama',
  'replicate',
  'accounts',
  'models',
]);

export const MODEL_AUTHOR_SEGMENTS = new Set([
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'moonshotai',
  'tencent',
  'minimax',
  'x-ai',
  'nvidia',
  'inclusionai',
  'stepfun',
  'z-ai',
  'qwen',
  'meta-llama',
  'mistralai',
  'fireworks',
  'cswan801',
]);

export function modelDisplayToken(token: string): string {
  if (typeof token !== 'string') return '';
  const lower = token.toLowerCase();
  const brandMap: Record<string, string> = {
    ai: 'AI',
    api: 'API',
    bm: 'BM',
    claude: 'Claude',
    codex: 'Codex',
    deepseek: 'DeepSeek',
    flash: 'Flash',
    gemini: 'Gemini',
    glm: 'GLM',
    gpt: 'GPT',
    grok: 'Grok',
    haiku: 'Haiku',
    kimi: 'Kimi',
    llama: 'Llama',
    minimax: 'MiniMax',
    mistral: 'Mistral',
    nemotron: 'Nemotron',
    opus: 'Opus',
    oss: 'OSS',
    qwen: 'Qwen',
    sonar: 'Sonar',
    sonnet: 'Sonnet',
    v: 'V',
  };
  if (brandMap[lower]) return brandMap[lower];
  if (/^gpt$/i.test(token)) return 'GPT';
  if (/^o\d+$/i.test(token)) return token.toUpperCase();
  if (/^\d+[a-z]+$/i.test(token)) return token.toUpperCase();
  if (/^[a-z]+[0-9.]+[a-z0-9.]*$/i.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function compactVersionTokens(tokens: string[]): string[] {
  if (!Array.isArray(tokens)) return [];
  const compacted: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (/^\d+$/.test(current) && /^\d+$/.test(tokens[i + 1] || '')) {
      compacted.push(`${current}.${tokens[i + 1]}`);
      i += 1;
    } else {
      compacted.push(current);
    }
  }
  return compacted;
}

export function autoModelDisplayName(modelId?: string | null): string | null {
  if (!modelId || typeof modelId !== 'string') return null;
  const withoutQuery = modelId.split(/[?#]/, 1)[0];
  const parts = withoutQuery
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  let modelPart = parts[parts.length - 1] || withoutQuery;
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      const normalized = part.toLowerCase();
      if (!MODEL_ROUTE_PREFIXES.has(normalized) && !MODEL_AUTHOR_SEGMENTS.has(normalized)) {
        modelPart = part;
        break;
      }
    }
  }
  const cleaned = modelPart
    .replace(/:[a-z0-9_-]+$/i, '')
    .replace(/\b(20\d{6}|20\d{4})\b/g, '')
    .replace(/[_:.]+/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .trim();
  const rawTokens = cleaned
    .split(/[-\s]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !MODEL_ROUTE_PREFIXES.has(token.toLowerCase()) && !MODEL_AUTHOR_SEGMENTS.has(token.toLowerCase()));
  const tokens = compactVersionTokens(rawTokens);
  const label = tokens.map(modelDisplayToken).join(' ').replace(/\s+/g, ' ').trim();
  return label || modelDisplayToken(cleaned || modelId);
}
