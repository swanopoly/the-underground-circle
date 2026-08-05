export type BrowserAIModalDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'unknown';

export type BrowserAIModalButton = {
  id: 'accept' | 'dismiss';
  label: string;
};

export type BrowserAIModalRisk =
  | 'safe_acknowledgement'
  | 'replace_requested_output'
  | 'destructive'
  | 'credential_or_identity'
  | 'payment_or_purchase'
  | 'external_send_or_publish'
  | 'prompt_input'
  | 'unknown';

export type BrowserAIModalDecisionAction = 'accept_dialog' | 'dismiss_dialog' | 'ask_user' | 'stop';

export type BrowserAIModalDecisionSource = 'local_policy' | 'llm_candidate' | 'guardrail';

export type BrowserAIModalObservation = {
  dialogType: BrowserAIModalDialogType;
  message: string;
  defaultValue?: string | null;
  url?: string | null;
  title?: string | null;
  buttons: BrowserAIModalButton[];
};

export type BrowserAIModalDecision = {
  action: BrowserAIModalDecisionAction;
  source: BrowserAIModalDecisionSource;
  risk: BrowserAIModalRisk;
  confidence: number;
  buttonId: BrowserAIModalButton['id'] | null;
  buttonLabel: string | null;
  reason: string;
  userMessage: string | null;
  observation: BrowserAIModalObservation;
};

export type BrowserAIModalCandidate = {
  action?: string | null;
  buttonId?: string | null;
  buttonLabel?: string | null;
  confidence?: number | null;
  reason?: string | null;
  risk?: string | null;
};

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lowerText(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseBrowserAIModalCandidate(value: string): BrowserAIModalCandidate | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as BrowserAIModalCandidate;
  } catch {
    return null;
  }
}

export function buttonsForBrowserDialog(type: BrowserAIModalDialogType): BrowserAIModalButton[] {
  switch (type) {
    case 'alert':
      return [{ id: 'accept', label: 'OK' }];
    case 'confirm':
      return [
        { id: 'accept', label: 'OK' },
        { id: 'dismiss', label: 'Cancel' },
      ];
    case 'prompt':
      return [
        { id: 'accept', label: 'OK' },
        { id: 'dismiss', label: 'Cancel' },
      ];
    case 'beforeunload':
      return [
        { id: 'dismiss', label: 'Stay on page' },
        { id: 'accept', label: 'Leave page' },
      ];
    default:
      return [
        { id: 'accept', label: 'OK' },
        { id: 'dismiss', label: 'Cancel' },
      ];
  }
}

export function buildBrowserAIModalObservation(args: {
  dialogType?: string | null;
  message?: string | null;
  defaultValue?: string | null;
  url?: string | null;
  title?: string | null;
}): BrowserAIModalObservation {
  const rawType = lowerText(args.dialogType);
  const dialogType: BrowserAIModalDialogType =
    rawType === 'alert' || rawType === 'confirm' || rawType === 'prompt' || rawType === 'beforeunload'
      ? rawType
      : 'unknown';
  return {
    dialogType,
    message: cleanText(args.message).slice(0, 1200),
    defaultValue: args.defaultValue == null ? null : cleanText(args.defaultValue).slice(0, 300),
    url: args.url == null ? null : cleanText(args.url).slice(0, 300),
    title: args.title == null ? null : cleanText(args.title).slice(0, 180),
    buttons: buttonsForBrowserDialog(dialogType),
  };
}

function dialogFilename(text: string): string | null {
  const quoted = text.match(/[“"]([^“”"]+\.[A-Za-z0-9]{2,8})[”"]/);
  if (quoted?.[1]) return cleanText(quoted[1]);
  const bare = text.match(/\b([A-Za-z0-9][^\\/:*?"<>|\n\r]{0,120}\.(?:png|jpe?g|pdf|psd|indd|ai|svg|webp|tiff?|zip|csv|xlsx?|docx?))\b/i);
  return bare?.[1] ? cleanText(bare[1]) : null;
}

function taskMentionsFilename(task: string, filename: string | null): boolean {
  if (!filename) return false;
  const lowerTask = lowerText(task);
  const lowerFilename = lowerText(filename);
  if (lowerTask.includes(lowerFilename)) return true;
  const extension = lowerFilename.match(/\.([a-z0-9]{2,8})$/)?.[1] || '';
  const basename = lowerFilename.replace(/\.[a-z0-9]{2,8}$/i, '').trim();
  if (!basename || !extension) return false;
  const formatMentioned = extension === 'jpg' || extension === 'jpeg'
    ? /\b(?:jpg|jpeg)\b/.test(lowerTask)
    : new RegExp(`\\b${escapeRegex(extension)}\\b`).test(lowerTask);
  return lowerTask.includes(basename) && formatMentioned;
}

export function classifyBrowserAIModalRisk(observation: BrowserAIModalObservation): BrowserAIModalRisk {
  const text = lowerText(`${observation.dialogType} ${observation.message} ${observation.defaultValue || ''}`);
  if (/\b(password|passcode|sign in|login|log in|mfa|2fa|two-factor|verification code|captcha|recovery phrase|seed phrase|authenticator|confirm identity)\b/.test(text)) {
    return 'credential_or_identity';
  }
  if (/\b(payment|purchase|buy|subscribe|billing|credit card|charge|checkout|place order)\b/.test(text)) return 'payment_or_purchase';
  if (/\b(send|publish|post|share publicly|email now|submit order)\b/.test(text)) return 'external_send_or_publish';
  if (/\b(delete|erase|trash|remove permanently|discard changes|close without saving|leave page|unsaved changes|not be saved|revert|reset)\b/.test(text)) return 'destructive';
  if (/\balready exists\b/.test(text) && /\b(replace|overwrite)\b/.test(text)) return 'replace_requested_output';
  if (observation.dialogType === 'prompt') return 'prompt_input';
  if (observation.dialogType === 'alert' && /\b(ok|continue|close|done|warning|alert|profile|missing|modified|unavailable|cannot|could not|complete|saved)\b/.test(text)) {
    return 'safe_acknowledgement';
  }
  return 'unknown';
}

function buildAskUserDecision(observation: BrowserAIModalObservation, risk: BrowserAIModalRisk, reason: string): BrowserAIModalDecision {
  const options = observation.buttons.map((button) => button.label).join(', ');
  return {
    action: risk === 'unknown' || risk === 'prompt_input' ? 'ask_user' : 'stop',
    source: 'guardrail',
    risk,
    confidence: 0,
    buttonId: null,
    buttonLabel: null,
    reason,
    userMessage: `A browser popup needs a decision before I continue. Popup: "${observation.message.slice(0, 300)}" Options: ${options || 'none'}.`,
    observation,
  };
}

function localPolicyDecision(observation: BrowserAIModalObservation, task: string): BrowserAIModalDecision {
  const risk = classifyBrowserAIModalRisk(observation);
  if (risk === 'credential_or_identity' || risk === 'payment_or_purchase' || risk === 'external_send_or_publish' || risk === 'destructive' || risk === 'prompt_input') {
    return buildAskUserDecision(observation, risk, `Blocked ${risk.replace(/_/g, ' ')} browser popup from automatic acceptance.`);
  }

  if (risk === 'replace_requested_output') {
    const filename = dialogFilename(observation.message);
    if (taskMentionsFilename(task, filename)) {
      const accept = observation.buttons.find((button) => button.id === 'accept') || null;
      if (accept) {
        return {
          action: 'accept_dialog',
          source: 'local_policy',
          risk,
          confidence: 0.94,
          buttonId: accept.id,
          buttonLabel: accept.label,
          reason: `The browser popup is asking to replace the requested output file ${filename}.`,
          userMessage: null,
          observation,
        };
      }
    }
    return buildAskUserDecision(observation, risk, 'The popup is an overwrite request, but the requested output filename was not confirmed in the task.');
  }

  if (risk === 'safe_acknowledgement') {
    const accept = observation.buttons.find((button) => button.id === 'accept') || null;
    if (accept) {
      return {
        action: 'accept_dialog',
        source: 'local_policy',
        risk,
        confidence: 0.84,
        buttonId: accept.id,
        buttonLabel: accept.label,
        reason: 'The browser popup is a non-destructive acknowledgement.',
        userMessage: null,
        observation,
      };
    }
  }

  return buildAskUserDecision(observation, risk, 'No safe automatic browser popup action matched the task and available buttons.');
}

function normalizeCandidateRisk(value: unknown, fallback: BrowserAIModalRisk): BrowserAIModalRisk {
  const raw = lowerText(value);
  return raw === 'safe_acknowledgement'
    || raw === 'replace_requested_output'
    || raw === 'destructive'
    || raw === 'credential_or_identity'
    || raw === 'payment_or_purchase'
    || raw === 'external_send_or_publish'
    || raw === 'prompt_input'
    || raw === 'unknown'
    ? raw
    : fallback;
}

function normalizeAction(value: unknown): BrowserAIModalDecisionAction {
  const raw = lowerText(value);
  if (raw === 'accept' || raw === 'accept_dialog' || raw === 'click_button') return 'accept_dialog';
  if (raw === 'dismiss' || raw === 'dismiss_dialog' || raw === 'cancel') return 'dismiss_dialog';
  if (raw === 'ask_user') return 'ask_user';
  if (raw === 'stop') return 'stop';
  return 'ask_user';
}

export function buildBrowserAIModalDecisionPrompt(args: {
  task: string;
  observation: BrowserAIModalObservation;
}): string {
  return [
    'You are deciding how to handle a browser native popup for a computer-control task.',
    'Return JSON only with: action, buttonId, buttonLabel, confidence, risk, reason.',
    'Allowed actions: accept_dialog, dismiss_dialog, ask_user, stop.',
    'Only choose accept_dialog for the visible accept button listed below.',
    'Never accept credentials, MFA, CAPTCHA, payment, purchase, send, publish, delete, discard, leave-with-unsaved-changes, or broad destructive actions.',
    'Accept Replace/Overwrite only when the popup filename is the requested output file in the user task.',
    'Ask the user for prompt/input dialogs unless the app has a separate explicit value and approval path.',
    '',
    `Task: ${cleanText(args.task)}`,
    `Dialog type: ${args.observation.dialogType}`,
    `URL: ${args.observation.url || 'unknown'}`,
    `Title: ${args.observation.title || 'unknown'}`,
    `Popup message: ${args.observation.message}`,
    `Default value: ${args.observation.defaultValue || ''}`,
    `Buttons: ${args.observation.buttons.map((button) => `${button.id}=${button.label}`).join(' | ')}`,
  ].join('\n');
}

export function validateBrowserAIModalCandidate(args: {
  candidate: BrowserAIModalCandidate;
  observation: BrowserAIModalObservation;
  task: string;
}): BrowserAIModalDecision {
  const risk = classifyBrowserAIModalRisk(args.observation);
  const candidateRisk = normalizeCandidateRisk(args.candidate.risk, risk);
  const action = normalizeAction(args.candidate.action);
  const confidence = Math.max(0, Math.min(1, Number(args.candidate.confidence || 0)));
  const button = args.observation.buttons.find((item) => {
    return (args.candidate.buttonId && item.id === args.candidate.buttonId)
      || (args.candidate.buttonLabel && lowerText(item.label) === lowerText(args.candidate.buttonLabel));
  }) || null;

  if (action === 'ask_user' || action === 'stop') {
    return buildAskUserDecision(args.observation, candidateRisk, cleanText(args.candidate.reason) || 'AI candidate did not choose an automatic popup action.');
  }
  if (!button) {
    return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate chose a browser popup button that is not visible.');
  }
  if (confidence < 0.8) {
    return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate confidence is below the automatic-action threshold.');
  }
  if (action === 'accept_dialog') {
    if (candidateRisk === 'credential_or_identity' || candidateRisk === 'payment_or_purchase' || candidateRisk === 'external_send_or_publish' || candidateRisk === 'destructive' || candidateRisk === 'prompt_input') {
      return buildAskUserDecision(args.observation, candidateRisk, `AI candidate was blocked by ${candidateRisk.replace(/_/g, ' ')} guardrails.`);
    }
    if (candidateRisk === 'replace_requested_output') {
      const filename = dialogFilename(args.observation.message);
      if (!taskMentionsFilename(args.task, filename) || button.id !== 'accept') {
        return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate overwrite was not tied to the requested output filename.');
      }
    }
  }

  return {
    action,
    source: 'llm_candidate',
    risk: candidateRisk,
    confidence,
    buttonId: button.id,
    buttonLabel: button.label,
    reason: cleanText(args.candidate.reason) || 'AI candidate selected a safe browser popup action.',
    userMessage: null,
    observation: args.observation,
  };
}

export function decideBrowserAIModalAction(args: {
  observation: BrowserAIModalObservation;
  task?: string | null;
  candidate?: BrowserAIModalCandidate | null;
}): BrowserAIModalDecision {
  if (args.candidate) {
    return validateBrowserAIModalCandidate({
      candidate: args.candidate,
      observation: args.observation,
      task: cleanText(args.task || ''),
    });
  }
  return localPolicyDecision(args.observation, cleanText(args.task || ''));
}
