import {
  findPreferredSaveExtensionMismatchButton,
  type ComputerAppSaveDialogNode,
} from './computerAppSaveDialogs';

export type DesktopAIModalNode = {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bbox?: [number, number, number, number];
  children?: DesktopAIModalNode[];
};

export type DesktopAIModalButton = {
  id: string;
  label: string;
};

export type DesktopAIModalRisk =
  | 'safe_acknowledgement'
  | 'keep_requested_extension'
  | 'replace_requested_output'
  | 'destructive'
  | 'credential_or_identity'
  | 'payment_or_purchase'
  | 'external_send_or_publish'
  | 'unknown';

export type DesktopAIModalDecisionAction = 'click_button' | 'ask_user' | 'stop';

export type DesktopAIModalDecisionSource = 'local_policy' | 'llm_candidate' | 'guardrail';

export type DesktopAIModalObservation = {
  app: string | null;
  text: string;
  buttons: DesktopAIModalButton[];
};

export type DesktopAIModalDecision = {
  action: DesktopAIModalDecisionAction;
  source: DesktopAIModalDecisionSource;
  risk: DesktopAIModalRisk;
  confidence: number;
  buttonId: string | null;
  buttonLabel: string | null;
  reason: string;
  userMessage: string | null;
  observation: DesktopAIModalObservation;
};

export type DesktopAIModalCandidate = {
  action?: string | null;
  buttonId?: string | null;
  buttonLabel?: string | null;
  confidence?: number | null;
  reason?: string | null;
  risk?: string | null;
};

export function parseDesktopAIModalCandidate(value: string): DesktopAIModalCandidate | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as DesktopAIModalCandidate;
  } catch {
    return null;
  }
}

function flattenModalNodes(node: DesktopAIModalNode | null | undefined, out: DesktopAIModalNode[] = []): DesktopAIModalNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children || []) flattenModalNodes(child, out);
  return out;
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lowerText(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function normalizeRole(value: unknown): string {
  return String(value || '').replace(/^AX/i, '').toLowerCase();
}

function isButton(node: DesktopAIModalNode): boolean {
  return normalizeRole(node.role) === 'button';
}

function nodeText(node: DesktopAIModalNode): string {
  return cleanText(`${node.role || ''} ${node.label || ''} ${node.value || ''}`);
}

function looksLikeModal(root: DesktopAIModalNode): boolean {
  const nodes = flattenModalNodes(root).slice(0, 260);
  const hasModalRole = nodes.some((node) => /dialog|sheet|popover|window/.test(normalizeRole(node.role)));
  const buttonCount = nodes.filter((node) => isButton(node) && cleanText(node.label || node.value)).length;
  return hasModalRole && buttonCount > 0;
}

function visibleModalText(root: DesktopAIModalNode): string {
  return flattenModalNodes(root)
    .slice(0, 260)
    .map(nodeText)
    .filter(Boolean)
    .join(' ')
    .slice(0, 1200);
}

function modalButtons(root: DesktopAIModalNode): DesktopAIModalButton[] {
  const seen = new Set<string>();
  return flattenModalNodes(root)
    .filter((node) => node.id && isButton(node))
    .map((node) => ({ id: node.id, label: cleanText(node.label || node.value || '') }))
    .filter((button) => {
      if (!button.label || seen.has(button.id)) return false;
      seen.add(button.id);
      return true;
    })
    .slice(0, 8);
}

export function extractDesktopAIModalObservation(
  root: DesktopAIModalNode | null | undefined,
  app?: string | null,
): DesktopAIModalObservation | null {
  if (!root || !looksLikeModal(root)) return null;
  const buttons = modalButtons(root);
  if (buttons.length === 0) return null;
  return {
    app: cleanText(app || '') || null,
    text: visibleModalText(root),
    buttons,
  };
}

function modalFilename(text: string): string | null {
  const quoted = text.match(/[“"]([^“”"]+\.[A-Za-z0-9]{2,8})[”"]/);
  if (quoted?.[1]) return cleanText(quoted[1]);
  const bare = text.match(/\b([A-Za-z0-9][^\\/:*?"<>|\n\r]{0,120}\.(?:png|jpe?g|pdf|psd|indd|ai|svg|webp|tiff?))\b/i);
  return bare?.[1] ? cleanText(bare[1]) : null;
}

function modalUsedExtension(text: string): string | null {
  const normalized = lowerText(text).replace(/[“”"'`]/g, '');
  return normalized.match(/\bused the extension\s+\.?([a-z0-9]{2,8})\b/)?.[1]
    || normalized.match(/\bextension\s+\.?([a-z0-9]{2,8})\s+at the end\b/)?.[1]
    || null;
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
    : new RegExp(`\\b${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerTask);
  return lowerTask.includes(basename) && formatMentioned;
}

function taskMentionsExtension(task: string, extension: string | null): boolean {
  const normalizedExtension = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!normalizedExtension) return false;
  const lowerTask = lowerText(task);
  if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') return /\b(?:jpg|jpeg)\b/.test(lowerTask);
  return new RegExp(`\\b${normalizedExtension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerTask);
}

function preferredExtensionButtonFromObservation(
  observation: DesktopAIModalObservation,
  targetExtension: string | null,
): DesktopAIModalButton | null {
  if (!targetExtension) return null;
  const preferred = findPreferredSaveExtensionMismatchButton(
    {
      id: 'modal',
      role: 'AXDialog',
      label: observation.text,
      children: observation.buttons.map((button) => ({
        id: button.id,
        role: 'AXButton',
        label: button.label,
      })),
    },
    `output.${targetExtension}`,
  );
  if (!preferred?.id) return null;
  const visible = observation.buttons.find((button) => button.id === preferred.id) || null;
  return visible;
}

function findButton(buttons: DesktopAIModalButton[], patterns: RegExp[]): DesktopAIModalButton | null {
  for (const pattern of patterns) {
    const found = buttons.find((button) => pattern.test(button.label));
    if (found) return found;
  }
  return null;
}

function classifyModalRisk(text: string): DesktopAIModalRisk {
  const lower = lowerText(text);
  if (/\b(password|passcode|sign in|login|log in|mfa|2fa|two-factor|verification code|captcha|recovery phrase|seed phrase|keychain|permission to access)\b/.test(lower)) {
    return 'credential_or_identity';
  }
  if (/\b(payment|purchase|buy|subscribe|billing|credit card|charge|checkout)\b/.test(lower)) return 'payment_or_purchase';
  if (/\b(send|publish|post|share publicly|email now|submit order|place order)\b/.test(lower)) return 'external_send_or_publish';
  if (/\b(delete|erase|trash|remove permanently|discard changes|close without saving|unsaved changes|not be saved|revert|reset)\b/.test(lower)) return 'destructive';
  if (/\bused the extension\b/.test(lower) && /\bstandard extension\b/.test(lower)) return 'keep_requested_extension';
  if (/\balready exists\b/.test(lower) && /\b(replace|overwrite)\b/.test(lower)) return 'replace_requested_output';
  if (/\b(ok|continue|close|done|warning|alert|profile|missing|modified|unavailable|cannot|could not)\b/.test(lower)) return 'safe_acknowledgement';
  return 'unknown';
}

function buildAskUserDecision(observation: DesktopAIModalObservation, risk: DesktopAIModalRisk, reason: string): DesktopAIModalDecision {
  const options = observation.buttons.map((button) => button.label).join(', ');
  return {
    action: risk === 'unknown' ? 'ask_user' : 'stop',
    source: 'guardrail',
    risk,
    confidence: 0,
    buttonId: null,
    buttonLabel: null,
    reason,
    userMessage: `A ${observation.app || 'desktop app'} popup needs a decision before I continue. Popup: "${observation.text.slice(0, 300)}" Options: ${options || 'none'}.`,
    observation,
  };
}

function localPolicyDecision(observation: DesktopAIModalObservation, task: string): DesktopAIModalDecision | null {
  const risk = classifyModalRisk(observation.text);
  if (risk === 'credential_or_identity' || risk === 'payment_or_purchase' || risk === 'external_send_or_publish' || risk === 'destructive') {
    return buildAskUserDecision(observation, risk, `Blocked ${risk.replace(/_/g, ' ')} popup from automatic action.`);
  }

  if (risk === 'keep_requested_extension') {
    const targetExtension = modalUsedExtension(observation.text);
    const button = preferredExtensionButtonFromObservation(observation, targetExtension);
    if (button && taskMentionsExtension(task, targetExtension)) {
      return {
        action: 'click_button',
        source: 'local_policy',
        risk,
        confidence: 0.93,
        buttonId: button.id,
        buttonLabel: button.label,
        reason: `The popup is asking whether to keep the requested .${targetExtension} extension, and the task requested that output format.`,
        userMessage: null,
        observation,
      };
    }
    return buildAskUserDecision(observation, risk, 'The popup is an extension mismatch, but the requested output extension was not confirmed in the task or visible buttons.');
  }

  if (risk === 'replace_requested_output') {
    const filename = modalFilename(observation.text);
    const replace = findButton(observation.buttons, [/^replace$/i, /^overwrite$/i, /^yes$/i, /^ok$/i]);
    const cancelLike = replace && /\b(cancel|keep both|do not|dont|no)\b/i.test(replace.label);
    if (replace && !cancelLike && taskMentionsFilename(task, filename)) {
      return {
        action: 'click_button',
        source: 'local_policy',
        risk,
        confidence: 0.94,
        buttonId: replace.id,
        buttonLabel: replace.label,
        reason: `The popup is asking to replace the requested output file ${filename}. The task explicitly names that output file.`,
        userMessage: null,
        observation,
      };
    }
    return buildAskUserDecision(observation, risk, 'The popup is an overwrite request, but the requested output filename was not confirmed in the task.');
  }

  if (risk === 'safe_acknowledgement') {
    const button = findButton(observation.buttons, [/^ok$/i, /^continue$/i, /^done$/i, /^close$/i, /^open$/i, /^skip$/i]);
    if (button) {
      return {
        action: 'click_button',
        source: 'local_policy',
        risk,
        confidence: 0.82,
        buttonId: button.id,
        buttonLabel: button.label,
        reason: 'The popup is a non-destructive acknowledgement and the button continues or closes the blocker.',
        userMessage: null,
        observation,
      };
    }
  }

  return buildAskUserDecision(observation, risk, 'No safe automatic popup action matched the task and available buttons.');
}

function normalizeCandidateRisk(value: unknown, fallback: DesktopAIModalRisk): DesktopAIModalRisk {
  const raw = lowerText(value);
  return raw === 'safe_acknowledgement'
    || raw === 'keep_requested_extension'
    || raw === 'replace_requested_output'
    || raw === 'destructive'
    || raw === 'credential_or_identity'
    || raw === 'payment_or_purchase'
    || raw === 'external_send_or_publish'
    || raw === 'unknown'
    ? raw
    : fallback;
}

export function buildDesktopAIModalDecisionPrompt(args: {
  task: string;
  observation: DesktopAIModalObservation;
}): string {
  return [
    'You are deciding how to handle a desktop app popup for a computer-control task.',
    'Return JSON only with: action, buttonId, buttonLabel, confidence, risk, reason.',
    'Allowed actions: click_button, ask_user, stop.',
    'Only choose click_button for a visible button id listed below.',
    'Never auto-click credentials, MFA, CAPTCHA, payment, purchase, send, publish, delete, discard, close-without-saving, or broad destructive actions.',
    'Auto-click Replace/Overwrite only when the popup filename is the requested output file in the user task.',
    'Auto-click a file-extension mismatch only when the popup keeps the extension requested by the user task.',
    '',
    `Task: ${cleanText(args.task)}`,
    `App: ${args.observation.app || 'unknown'}`,
    `Popup text: ${args.observation.text}`,
    `Buttons: ${args.observation.buttons.map((button) => `${button.id}=${button.label}`).join(' | ')}`,
  ].join('\n');
}

export function validateDesktopAIModalCandidate(args: {
  candidate: DesktopAIModalCandidate;
  observation: DesktopAIModalObservation;
  task: string;
}): DesktopAIModalDecision {
  const risk = classifyModalRisk(args.observation.text);
  const candidateRisk = normalizeCandidateRisk(args.candidate.risk, risk);
  const action = lowerText(args.candidate.action) as DesktopAIModalDecisionAction;
  const confidence = Math.max(0, Math.min(1, Number(args.candidate.confidence || 0)));
  const button = args.observation.buttons.find((item) => {
    return (args.candidate.buttonId && item.id === args.candidate.buttonId)
      || (args.candidate.buttonLabel && lowerText(item.label) === lowerText(args.candidate.buttonLabel));
  }) || null;

  if (action !== 'click_button') {
    return buildAskUserDecision(args.observation, candidateRisk, cleanText(args.candidate.reason) || 'AI candidate did not choose an automatic click.');
  }
  if (!button) {
    return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate chose a button that is not visible in the popup.');
  }
  if (confidence < 0.8) {
    return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate confidence is below the automatic-action threshold.');
  }
  if (candidateRisk === 'credential_or_identity' || candidateRisk === 'payment_or_purchase' || candidateRisk === 'external_send_or_publish' || candidateRisk === 'destructive') {
    return buildAskUserDecision(args.observation, candidateRisk, `AI candidate was blocked by ${candidateRisk.replace(/_/g, ' ')} guardrails.`);
  }
  if (candidateRisk === 'keep_requested_extension') {
    const targetExtension = modalUsedExtension(args.observation.text);
    const visibleKeepButton = preferredExtensionButtonFromObservation(args.observation, targetExtension);
    if (!targetExtension || !taskMentionsExtension(args.task, targetExtension) || button.id !== visibleKeepButton?.id) {
      return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate extension choice was not tied to the requested output extension.');
    }
  }
  if (candidateRisk === 'replace_requested_output') {
    const filename = modalFilename(args.observation.text);
    if (!taskMentionsFilename(args.task, filename) || !/\b(replace|overwrite|yes|ok)\b/i.test(button.label)) {
      return buildAskUserDecision(args.observation, candidateRisk, 'AI candidate overwrite was not tied to the requested output filename.');
    }
  }
  return {
    action: 'click_button',
    source: 'llm_candidate',
    risk: candidateRisk,
    confidence,
    buttonId: button.id,
    buttonLabel: button.label,
    reason: cleanText(args.candidate.reason) || 'AI candidate selected a safe popup action.',
    userMessage: null,
    observation: args.observation,
  };
}

export function decideDesktopAIModalAction(args: {
  root: DesktopAIModalNode | null | undefined;
  app?: string | null;
  task?: string | null;
  candidate?: DesktopAIModalCandidate | null;
}): DesktopAIModalDecision | null {
  const observation = extractDesktopAIModalObservation(args.root, args.app);
  if (!observation) return null;
  if (args.candidate) {
    return validateDesktopAIModalCandidate({
      candidate: args.candidate,
      observation,
      task: cleanText(args.task || ''),
    });
  }
  return localPolicyDecision(observation, cleanText(args.task || ''));
}
