const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/gi;
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

export type BrowserTaskMode = 'read_only' | 'extract' | 'workflow' | 'transactional';
export type BrowserTaskRisk = 'low' | 'medium' | 'high';

export interface BrowserTaskIntent {
  objective: string;
  mode: BrowserTaskMode;
  risk: BrowserTaskRisk;
  requiresLogin: boolean;
  hasSideEffects: boolean;
  suggestedPermission: 'ask_every_time' | 'ask_for_new_sites' | 'trusted';
  allowedDomains: string[];
  startUrls: string[];
  expectedOutput?: string;
  completionCriteria: string[];
  safetyNotes: string[];
  entitySummary: string;
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().replace(/[.,;:]+$/, '');
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function summarizeEntities(startUrls: string[], domains: string[], requiresLogin: boolean, hasSideEffects: boolean): string {
  const parts: string[] = [];
  if (startUrls.length > 0) parts.push(`${startUrls.length} url${startUrls.length === 1 ? '' : 's'}`);
  if (domains.length > 0) parts.push(`${domains.length} domain${domains.length === 1 ? '' : 's'}`);
  if (requiresLogin) parts.push('login');
  if (hasSideEffects) parts.push('side effects');
  return parts.length > 0 ? parts.join(' + ') : 'generic browser workflow';
}

export function analyzeBrowserTask(task: string): BrowserTaskIntent {
  const normalizedTask = task.trim();
  const lower = normalizedTask.toLowerCase();
  const startUrls = unique((normalizedTask.match(URL_PATTERN) || []).map((value) => value.trim()));
  const domainMentions = unique((normalizedTask.match(DOMAIN_PATTERN) || []).map(normalizeDomain));
  const allowedDomains = unique([
    ...startUrls.map(normalizeDomain),
    ...domainMentions,
  ]);

  const loginPattern = /\b(log ?in|sign ?in|authenticate|password|otp|2fa|verification code|account)\b/i;
  const transactionalPattern = /\b(pay|purchase|buy|checkout|order|book|reserve|send|transfer|wire|submit|publish|post|delete|remove|cancel|update|change settings|invite|create account)\b/i;
  const extractPattern = /\b(extract|scrape|collect|capture|save|export|copy|summari[sz]e|list|report|find all|gather)\b/i;
  const readOnlyPattern = /\b(open|visit|check|look up|search|browse|show|read|inspect|compare|research)\b/i;

  const requiresLogin = loginPattern.test(lower);
  const hasSideEffects = transactionalPattern.test(lower);

  let mode: BrowserTaskMode = 'workflow';
  if (hasSideEffects) mode = 'transactional';
  else if (extractPattern.test(lower)) mode = 'extract';
  else if (readOnlyPattern.test(lower)) mode = 'read_only';

  let risk: BrowserTaskRisk = 'medium';
  if (mode === 'transactional' || requiresLogin) risk = 'high';
  else if (mode === 'read_only' || mode === 'extract') risk = allowedDomains.length <= 2 ? 'low' : 'medium';

  const completionCriteria: string[] = [];
  const safetyNotes: string[] = [];
  let expectedOutput: string | undefined;

  if (mode === 'read_only') {
    completionCriteria.push('Reach the requested page or result');
    completionCriteria.push('Return a concise answer in chat');
    expectedOutput = 'Answer or short summary';
  }
  if (mode === 'extract') {
    completionCriteria.push('Reach the source page');
    completionCriteria.push('Extract the requested facts or records');
    completionCriteria.push('Return the captured information in chat');
    expectedOutput = 'Structured findings or summary';
  }
  if (mode === 'workflow') {
    completionCriteria.push('Complete the requested browser workflow');
    completionCriteria.push('Pause before uncertain or destructive steps');
    expectedOutput = 'Completion confirmation with notes';
  }
  if (mode === 'transactional') {
    completionCriteria.push('Stop for explicit approval before final submission or purchase');
    completionCriteria.push('Return a confirmation summary after execution');
    expectedOutput = 'Completion confirmation with proof';
    safetyNotes.push('This task appears to change external state.');
  }

  if (requiresLogin) {
    safetyNotes.push('This task may require authentication or access to sensitive account data.');
  }
  if (allowedDomains.length > 0) {
    safetyNotes.push(`Keep browser execution scoped to ${allowedDomains.join(', ')} unless the user expands it.`);
  } else {
    safetyNotes.push('No explicit domain was given, so approval should stay strict until the destination is clear.');
  }

  const suggestedPermission =
    risk === 'high'
      ? 'ask_every_time'
      : risk === 'low'
        ? 'ask_for_new_sites'
        : 'ask_every_time';

  return {
    objective: normalizedTask,
    mode,
    risk,
    requiresLogin,
    hasSideEffects,
    suggestedPermission,
    allowedDomains,
    startUrls,
    expectedOutput,
    completionCriteria,
    safetyNotes,
    entitySummary: summarizeEntities(startUrls, allowedDomains, requiresLogin, hasSideEffects),
  };
}
