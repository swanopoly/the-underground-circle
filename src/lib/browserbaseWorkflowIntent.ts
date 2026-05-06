export type BrowserbaseWorkflowKind =
  | 'web_data_retrieval'
  | 'stagehand_browser_agent'
  | 'form_submission'
  | 'general_browser';

export interface BrowserbaseWorkflowIntent {
  kind: BrowserbaseWorkflowKind;
  label: string;
  summary: string;
  recommendedBackend: 'browserbase_stagehand' | 'browserbase_computer_use' | 'playwright_or_stagehand';
  requiresStagehand: boolean;
  requiresPersistentContext: boolean;
  expectsStructuredOutput: boolean;
  requiresSubmissionVerification: boolean;
  completionCriteria: string[];
  safetyNotes: string[];
  promptGuidance: string[];
}

const DATA_RETRIEVAL_RE = /\b(web\s*data\s*retrieval|data\s*retrieval|extract|scrape|crawl|collect|gather|capture|export|pull)\b.*\b(data|records?|rows?|items?|products?|prices?|catalog|table|listings?|results?|fields?|schema|structured|json|csv)\b/i;
const DATA_RETRIEVAL_REVERSE_RE = /\b(data|records?|rows?|items?|products?|prices?|catalog|table|listings?|results?|fields?|schema|structured|json|csv)\b.*\b(extract|scrape|crawl|collect|gather|capture|export|pull)\b/i;
const STAGEHAND_RE = /\b(stagehand|browserbase\s+stagehand|ai\s+browser\s+agent|browser\s+agent|natural[-\s]*language\s+browser|self[-\s]*healing\s+browser|act\(|extract\(|observe\()\b/i;
const FORM_RE = /\b(form|forms|survey|application|registration|signup|sign\s*up|checkout|data\s*entry|lead\s*capture|intake)\b/i;
const FORM_ACTION_RE = /\b(fill|fill\s*out|complete|submit|send|enter|populate|select|check|choose|upload|apply|register|checkout)\b/i;
const LOGIN_CONTEXT_RE = /\b(log\s*in|login|sign\s*in|authenticate|saved\s+login|vault|credential|password|account)\b/i;

function hasDataRetrievalIntent(text: string): boolean {
  return DATA_RETRIEVAL_RE.test(text)
    || DATA_RETRIEVAL_REVERSE_RE.test(text)
    || /\bextract\b.*\bfrom\b.*\b(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})/i.test(text)
    || /\bscrape\b.*\b(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})/i.test(text);
}

function hasFormIntent(text: string): boolean {
  return (FORM_RE.test(text) && FORM_ACTION_RE.test(text))
    || /\bsubmit\b.*\b(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})/i.test(text)
    || /\bfill\s*out\b/i.test(text)
    || /\bcomplete\b.*\b(application|survey|checkout|registration)\b/i.test(text);
}

export function classifyBrowserbaseWorkflow(task: string): BrowserbaseWorkflowIntent {
  const text = String(task || '').trim();
  const lower = text.toLowerCase();
  const stagehandMentioned = STAGEHAND_RE.test(text);
  const dataRetrieval = hasDataRetrievalIntent(text);
  const formSubmission = hasFormIntent(text);
  const loginContext = LOGIN_CONTEXT_RE.test(text);

  if (formSubmission) {
    return {
      kind: 'form_submission',
      label: 'Browserbase form automation',
      summary: 'Fill form fields, handle dynamic/multi-step forms, then verify the submission result.',
      recommendedBackend: stagehandMentioned ? 'browserbase_stagehand' : 'browserbase_computer_use',
      requiresStagehand: stagehandMentioned,
      requiresPersistentContext: loginContext,
      expectsStructuredOutput: false,
      requiresSubmissionVerification: true,
      completionCriteria: [
        'Open the target form and wait for fields to load',
        'Fill requested text inputs, selects, radios, checkboxes, and uploads in sequence',
        'Ask before credential entry, personal information, payment, or final submission',
        'Verify success using a visible confirmation message, URL change, or submitted-state proof',
      ],
      safetyNotes: [
        'Treat the final submit/send/checkout/apply action as a side effect that needs approval.',
        'Use saved vault credentials only when the site origin matches the credential policy.',
        'For dynamic forms, wait for newly revealed fields before continuing.',
      ],
      promptGuidance: [
        'If login is needed, use a persisted browser context or vault runbook rather than asking for secrets in chat.',
        'Do not rely on arbitrary sleeps when a field or success message selector/visible text can be checked.',
        'After submission, report the visible confirmation text or exact validation error.',
      ],
    };
  }

  if (dataRetrieval) {
    return {
      kind: 'web_data_retrieval',
      label: 'Browserbase data retrieval',
      summary: 'Extract structured data from rendered web pages, protected pages, or dynamic catalogs.',
      recommendedBackend: stagehandMentioned ? 'browserbase_stagehand' : 'playwright_or_stagehand',
      requiresStagehand: stagehandMentioned,
      requiresPersistentContext: loginContext,
      expectsStructuredOutput: true,
      requiresSubmissionVerification: false,
      completionCriteria: [
        'Open the source page and wait for dynamic content to render',
        'Extract only the requested fields or records',
        'Return structured data with source URLs when available',
        'Close or stop promptly after the needed data is captured',
      ],
      safetyNotes: [
        'Respect site terms, robots guidance, and rate limits for crawl-like work.',
        'Keep extraction narrow; avoid broad scraping when the user asked for a small answer.',
        'If the site blocks automation, report the blocker instead of looping.',
      ],
      promptGuidance: [
        'Prefer structured output for records: title/name, URL, price/rating/status, and a short note when relevant.',
        'Use screenshots/checkpoints to verify the page actually contains the extracted fields.',
        'For multi-page retrieval, batch conservatively and summarize what was skipped or capped.',
      ],
    };
  }

  if (stagehandMentioned) {
    return {
      kind: 'stagehand_browser_agent',
      label: 'Browserbase Stagehand workflow',
      summary: 'Use natural-language browser actions for pages that are easier to drive semantically than by fixed selectors.',
      recommendedBackend: 'browserbase_stagehand',
      requiresStagehand: true,
      requiresPersistentContext: loginContext,
      expectsStructuredOutput: /\b(extract|data|json|list|table|fields?)\b/i.test(lower),
      requiresSubmissionVerification: /\b(submit|send|publish|checkout|save|delete)\b/i.test(lower),
      completionCriteria: [
        'Navigate to the requested page',
        'Use semantic browser actions for clicks, fills, or extraction',
        'Interleave deterministic checks or screenshots after important steps',
        'Return the final state and any extracted data in chat',
      ],
      safetyNotes: [
        'Use Stagehand-style natural-language actions for ambiguous UIs, but keep approval gates for side effects.',
        'Fallback to deterministic page interactions when the target is obvious and repeatable.',
      ],
      promptGuidance: [
        'Break complex browser work into small act/extract-sized steps.',
        'Verify each major state change before moving to the next step.',
      ],
    };
  }

  return {
    kind: 'general_browser',
    label: 'General browser automation',
    summary: 'Open, inspect, navigate, and complete browser tasks with approval gates.',
    recommendedBackend: 'browserbase_computer_use',
    requiresStagehand: false,
    requiresPersistentContext: loginContext,
    expectsStructuredOutput: false,
    requiresSubmissionVerification: /\b(submit|send|publish|checkout|save|delete)\b/i.test(lower),
    completionCriteria: [
      'Reach the requested page or workflow state',
      'Use screenshots/checkpoints when the visible result matters',
      'Ask before side effects or sensitive data entry',
      'Summarize the outcome clearly in chat',
    ],
    safetyNotes: [
      'Keep execution scoped to the requested site or approved domains.',
      'Stop for login, CAPTCHA, 2FA, payment, or destructive actions unless the user approves.',
    ],
    promptGuidance: [
      'Choose the least destructive browser action that can complete the next step.',
      'Report blockers rather than guessing credentials or bypassing site controls.',
    ],
  };
}

export function buildBrowserbaseWorkflowPromptBlock(workflow: BrowserbaseWorkflowIntent): string {
  return [
    `Browserbase workflow: ${workflow.label}`,
    `Summary: ${workflow.summary}`,
    `Recommended backend: ${workflow.recommendedBackend}`,
    `Structured output expected: ${workflow.expectsStructuredOutput ? 'yes' : 'no'}`,
    `Submission verification required: ${workflow.requiresSubmissionVerification ? 'yes' : 'no'}`,
    `Persistent context/login state needed: ${workflow.requiresPersistentContext ? 'likely' : 'not detected'}`,
    `Completion criteria: ${workflow.completionCriteria.join(' | ')}`,
    `Safety notes: ${workflow.safetyNotes.join(' | ')}`,
    `Guidance: ${workflow.promptGuidance.join(' | ')}`,
  ].join('\n');
}
