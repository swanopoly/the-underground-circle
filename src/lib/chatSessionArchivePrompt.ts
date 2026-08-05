export type ChatSessionArchivePromptRecommendation = {
  kind: string;
  title: string;
  summary: string;
  content: string;
  confidence: 'medium' | 'high' | string;
};

const DETAIL_PRIORITIES = [
  /^Evidence tools:/i,
  /^Readiness:/i,
  /^Failure area:/i,
  /^Pattern key:/i,
  /^Tool\/check:/i,
  /^Failure:/i,
];

function compactLine(value: string, maxChars = 220): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? compact.slice(0, maxChars).trimEnd() : compact;
}

export function selectChatSessionArchiveRecommendationDetailLines(
  content: string,
  limit = 2,
): string[] {
  const lines = String(content || '')
    .split('\n')
    .map((line) => compactLine(line))
    .filter(Boolean);
  const selected: string[] = [];
  for (const pattern of DETAIL_PRIORITIES) {
    const match = lines.find((line) => pattern.test(line));
    if (match && !selected.includes(match)) selected.push(match);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function formatChatSessionArchiveRecommendationPromptLines(
  recommendations: ChatSessionArchivePromptRecommendation[],
  limit = 3,
): string[] {
  const bounded = (recommendations || []).slice(0, Math.max(0, limit));
  if (bounded.length === 0) return [];
  const lines: string[] = ['', 'Reusable archive patterns:'];
  for (const recommendation of bounded) {
    lines.push(`- [${recommendation.kind}/${recommendation.confidence}] ${compactLine(recommendation.title, 96)}: ${compactLine(recommendation.summary, 140)}`);
    for (const detailLine of selectChatSessionArchiveRecommendationDetailLines(recommendation.content, 2)) {
      lines.push(`  ${detailLine}`);
    }
  }
  return lines;
}
