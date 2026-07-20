/**
 * skillPortabilityHeuristic — best-effort, NOT authoritative classification
 * of a library skill's cross-agent portability and risk level.
 *
 * Honest scope note (Skills Library And Evaluator, roadmap section 9):
 * `circle_skills` rows (see `skillLibrary.ts`) store `name`, `description`,
 * `tags`, and a `content` markdown body, but there is no stored field for
 * "which agent product(s) this was written for" or "what this skill does
 * at execution time" — `parseSkillFrontmatter` deliberately does not surface
 * a `platform` field yet (see its doc comment), and nothing tags a skill
 * with a risk tier. So this module does NOT read real classification data —
 * it infers a rough signal from keyword matches against the metadata that's
 * already cheaply available in the list view (`name` + `description` +
 * `tags` — the same fields `listLibrarySkills` fetches; deliberately not
 * `content`, to avoid an N+1 fetch against the progressive-disclosure
 * design documented in `skillLibrary.ts`).
 *
 * Treat the output as a hint to a human, never as ground truth: false
 * negatives are expected (a skill can reference credentials in its body
 * without ever saying "credential" in its one-line description), and the
 * UI must label this as a heuristic.
 */

export type SkillPortabilitySignal = {
  name: string;
  description: string;
  tags: string[];
};

export type PortabilityPlatform = 'codex' | 'claude' | 'cursor';

export type SkillRiskLevel = 'instruction-only' | 'scripts' | 'credentials' | 'external-writes';

export type SkillPortabilityClassification = {
  /** Platforms whose naming/paths were explicitly mentioned. Empty = no platform-specific signal found. */
  platforms: PortabilityPlatform[];
  /** 'generic' when no platform-specific mention was found — i.e. presumed portable to any agent. */
  portabilityLabel: PortabilityPlatform | 'generic';
  /** Highest-severity risk keyword bucket matched; 'instruction-only' when nothing matched. */
  risk: SkillRiskLevel;
  /** Which keyword(s) drove the risk call, for a tooltip/detail line. */
  riskMatchedKeywords: string[];
};

const PLATFORM_PATTERNS: Record<PortabilityPlatform, RegExp[]> = {
  claude: [/\bclaude\b/i, /\.claude\//, /claude[\s-]?code/i, /\banthropic\b/i],
  codex: [/\bcodex\b/i, /\.codex\//, /apply_patch/i],
  cursor: [/\bcursor\b/i, /\.cursor\//, /cursorrules/i],
};

// Ordered highest severity first — the first bucket with a match wins.
const RISK_PATTERNS: Array<{ risk: SkillRiskLevel; patterns: RegExp[] }> = [
  {
    risk: 'credentials',
    patterns: [/\bcredential/i, /\bpassword/i, /\bapi[\s_-]?key/i, /\bsecret\b/i, /\btoken\b/i, /\bvault\b/i, /\blogin\b/i, /\boauth\b/i],
  },
  {
    risk: 'external-writes',
    patterns: [/\bsend\b/i, /\bpost\b/i, /\bpublish\b/i, /\bdeploy\b/i, /\bemail\b/i, /\bcommit\b/i, /\bpush\b/i, /\bupload\b/i, /\bpull request\b/i, /\bmerge\b/i, /\bwrite to\b/i],
  },
  {
    risk: 'scripts',
    patterns: [/```(bash|sh|zsh|python|py|js|javascript|ts|typescript)/i, /\brun[\s_-]?shell\b/i, /\bexec[\s_-]?file\b/i, /\bscript\b/i, /\bcommand[\s-]?line\b/i, /\bshell command\b/i],
  },
];

function combinedText(signal: SkillPortabilitySignal): string {
  return [signal.name, signal.description, ...(signal.tags || [])].join(' \n ');
}

/**
 * Classify a single skill's metadata. Pure, synchronous, no I/O.
 */
export function classifySkillPortability(signal: SkillPortabilitySignal): SkillPortabilityClassification {
  const text = combinedText(signal);

  const platforms: PortabilityPlatform[] = [];
  for (const platform of Object.keys(PLATFORM_PATTERNS) as PortabilityPlatform[]) {
    if (PLATFORM_PATTERNS[platform].some(re => re.test(text))) platforms.push(platform);
  }

  let risk: SkillRiskLevel = 'instruction-only';
  let riskMatchedKeywords: string[] = [];
  for (const bucket of RISK_PATTERNS) {
    const matched = bucket.patterns.filter(re => re.test(text));
    if (matched.length > 0) {
      risk = bucket.risk;
      riskMatchedKeywords = matched.map(re => re.source);
      break;
    }
  }

  return {
    platforms,
    portabilityLabel: platforms.length > 0 ? platforms[0] : 'generic',
    risk,
    riskMatchedKeywords,
  };
}

export const PORTABILITY_LABELS: Record<PortabilityPlatform | 'generic', string> = {
  codex: 'CODEX',
  claude: 'CLAUDE',
  cursor: 'CURSOR',
  generic: 'GENERIC',
};

export const RISK_LABELS: Record<SkillRiskLevel, string> = {
  'instruction-only': 'INSTRUCTION-ONLY',
  scripts: 'SCRIPTS',
  credentials: 'CREDENTIALS',
  'external-writes': 'EXTERNAL WRITES',
};

/** Rough color hint the UI can use for the risk badge — read-only fallback if a caller doesn't have its own palette. */
export const RISK_COLORS: Record<SkillRiskLevel, string> = {
  'instruction-only': '#22c55e',
  scripts: '#94a3b8',
  'external-writes': '#f59e0b',
  credentials: '#ef4444',
};
