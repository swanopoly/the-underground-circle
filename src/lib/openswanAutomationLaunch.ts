export const OPENSWAN_AUTOMATION_INTENT_SEED = 'Turn this into a repeatable automation: ';

const OPENSWAN_AUTOMATION_INTENT_PATTERN =
  /^turn\s+this\s+into\s+a\s+repeatable\s+automation\s*:\s*/i;

function normalizeAutomationDraft(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function buildOpenSwanAutomationInitialTask(draft: string | null | undefined): string {
  const normalized = normalizeAutomationDraft(draft);
  if (!normalized) return OPENSWAN_AUTOMATION_INTENT_SEED;

  const unframed = normalized.replace(OPENSWAN_AUTOMATION_INTENT_PATTERN, '').trim();
  if (unframed !== normalized || OPENSWAN_AUTOMATION_INTENT_PATTERN.test(normalized)) {
    return unframed
      ? `${OPENSWAN_AUTOMATION_INTENT_SEED}${unframed}`
      : OPENSWAN_AUTOMATION_INTENT_SEED;
  }

  return `${OPENSWAN_AUTOMATION_INTENT_SEED}${normalized}`;
}
