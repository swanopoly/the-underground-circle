export type ComputerAppSaveDialogNode = {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bbox?: [number, number, number, number];
  children?: ComputerAppSaveDialogNode[];
};

function flattenSaveDialogNodes(
  node: ComputerAppSaveDialogNode | null | undefined,
  out: ComputerAppSaveDialogNode[] = [],
): ComputerAppSaveDialogNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children || []) flattenSaveDialogNodes(child, out);
  return out;
}

export function normalizeFileExtension(filename: string | null | undefined): string | null {
  const basename = String(filename || '').trim().split(/[\\/]/).filter(Boolean).pop() || '';
  const match = basename.match(/\.([A-Za-z0-9]{2,8})$/);
  return match?.[1] ? match[1].toLowerCase() : null;
}

export function isStatableLocalSavePath(path: string | null | undefined): boolean {
  return /^(?:~\/|\/|\.\/|\.\.\/)/.test(String(path || '').trim());
}

export type SaveForWebTargetFormat = 'png' | 'jpg';

export function normalizeSaveForWebTargetFormat(value: string | null | undefined): SaveForWebTargetFormat | null {
  const extension = normalizeFileExtension(value) || String(value || '').trim().toLowerCase();
  if (extension === 'png') return 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpg';
  return null;
}

function normalizeExtensionDialogText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function saveDialogVisibleText(root: ComputerAppSaveDialogNode, maxNodes = 180): string {
  return flattenSaveDialogNodes(root)
    .slice(0, maxNodes)
    .map((node) => `${node.role || ''} ${node.label || ''} ${node.value || ''}`)
    .join(' ');
}

export function treeLooksLikeSaveExtensionMismatchDialog(root: ComputerAppSaveDialogNode, filename?: string): boolean {
  const text = normalizeExtensionDialogText(saveDialogVisibleText(root, 180));
  const extension = normalizeFileExtension(filename);
  const hasExtensionMismatchCopy = /\bused the extension\b/.test(text)
    && /\bstandard extension\b/.test(text)
    && /\b(extension|name|file name|filename)\b/.test(text);
  if (!hasExtensionMismatchCopy) return false;
  if (!extension) return true;
  const usedExtension = text.match(/\bused the extension\s+\.?([a-z0-9]{2,8})\b/)?.[1]
    || text.match(/\bextension\s+\.?([a-z0-9]{2,8})\s+at the end\b/)?.[1];
  return usedExtension ? usedExtension === extension : text.includes(`.${extension}`);
}

function scoreSaveExtensionMismatchButton(node: ComputerAppSaveDialogNode, targetExtension: string): number {
  if (!node.id || !/button/i.test(node.role || '')) return 0;
  const label = normalizeExtensionDialogText(`${node.label || ''} ${node.value || ''}`);
  if (!label) return 0;
  const extensionMentions = Array.from(label.matchAll(/\.([a-z0-9]{2,8})\b/g)).map((match) => match[1]);
  if (extensionMentions.some((extension) => extension !== targetExtension)) return 0;
  let score = 0;
  if (new RegExp(`\\buse\\s+\\.?${targetExtension}\\b`).test(label)) score += 160;
  if (new RegExp(`\\bkeep\\s+\\.?${targetExtension}\\b`).test(label)) score += 150;
  if (new RegExp(`\\bsave\\s+as\\s+\\.?${targetExtension}\\b`).test(label)) score += 125;
  if (new RegExp(`\\bcontinue\\s+(?:with|as)\\s+\\.?${targetExtension}\\b`).test(label)) score += 100;
  if (new RegExp(`\\b\\.?${targetExtension}\\b`).test(label)) score += 60;
  if (/\bcancel\b/.test(label)) score -= 200;
  if (/\bchange\b|\bstandard\b/.test(label) && !new RegExp(`\\.?${targetExtension}\\b`).test(label)) score -= 120;
  return score + (node.bbox ? 5 : 0);
}

export function findPreferredSaveExtensionMismatchButton(
  root: ComputerAppSaveDialogNode,
  filename: string,
): ComputerAppSaveDialogNode | null {
  const targetExtension = normalizeFileExtension(filename);
  if (!targetExtension) return null;
  const buttons = flattenSaveDialogNodes(root).filter((node) => node.id && /button/i.test(node.role || ''));
  let best: { node: ComputerAppSaveDialogNode; score: number } | null = null;
  for (const button of buttons) {
    const score = scoreSaveExtensionMismatchButton(button, targetExtension);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { node: button, score };
  }
  return best?.node || null;
}

function normalizedDialogBasename(filename: string | null | undefined): string | null {
  const basename = String(filename || '').trim().split(/[\\/]/).filter(Boolean).pop() || '';
  const normalized = normalizeExtensionDialogText(basename);
  return normalized || null;
}

export function treeLooksLikeSaveReplaceExistingDialog(root: ComputerAppSaveDialogNode, filename?: string): boolean {
  const text = normalizeExtensionDialogText(saveDialogVisibleText(root, 180));
  const hasReplaceCopy = /\balready exists\b/.test(text)
    && /\b(?:replace|overwrite)\b/.test(text)
    && /\b(?:want to|would you like to|do you want to|file|item|document)\b/.test(text);
  if (!hasReplaceCopy) return false;
  const basename = normalizedDialogBasename(filename);
  return !basename || text.includes(basename);
}

function scoreSaveReplaceExistingButton(node: ComputerAppSaveDialogNode): number {
  if (!node.id || !/button/i.test(node.role || '')) return 0;
  const label = normalizeExtensionDialogText(`${node.label || ''} ${node.value || ''}`);
  if (!label) return 0;
  if (/\b(?:cancel|stop|no|dont replace|do not replace|keep both)\b/.test(label)) return 0;
  let score = 0;
  if (/^\s*replace\s*$/.test(label)) score += 180;
  if (/\breplace\b/.test(label)) score += 150;
  if (/\boverwrite\b/.test(label)) score += 140;
  if (/\bcontinue\b/.test(label)) score += 85;
  if (/\bok\b|\byes\b/.test(label)) score += 55;
  if (node.bbox) score += 5;
  return score;
}

export function findPreferredSaveReplaceExistingButton(root: ComputerAppSaveDialogNode): ComputerAppSaveDialogNode | null {
  let best: { node: ComputerAppSaveDialogNode; score: number } | null = null;
  for (const button of flattenSaveDialogNodes(root).filter((node) => node.id && /button/i.test(node.role || ''))) {
    const score = scoreSaveReplaceExistingButton(button);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { node: button, score };
  }
  return best?.node || null;
}

function normalizeSaveForWebText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function saveForWebNodeText(node: ComputerAppSaveDialogNode): string {
  return normalizeSaveForWebText(`${node.role || ''} ${node.label || ''} ${node.value || ''}`);
}

function textMentionsSaveForWebFormat(text: string): boolean {
  return /\b(?:jpeg|jpg|png(?:-24|-8)?|gif|wbmp)\b/.test(text);
}

function textMatchesSaveForWebTargetFormat(text: string, targetFormat: SaveForWebTargetFormat): boolean {
  return targetFormat === 'png'
    ? /\bpng(?:-24|-8)?\b/.test(text)
    : /\b(?:jpeg|jpg)\b/.test(text);
}

function scoreSaveForWebFormatControl(node: ComputerAppSaveDialogNode, targetFormat: SaveForWebTargetFormat): number {
  if (!node.id) return 0;
  const role = normalizeSaveForWebText(node.role);
  const text = saveForWebNodeText(node);
  if (!text) return 0;
  if (/\b(?:save|cancel|done|preview|metadata|color table|quality)\b/.test(text) && !textMentionsSaveForWebFormat(text)) return 0;
  if (/menuitem|menu item|option/.test(role)) return 0;
  if (!/(?:popup|pop up|combo|button|menu|cell)/.test(role)) return 0;

  let score = 0;
  if (/(?:popup|pop up|combo)/.test(role)) score += 90;
  if (/button/.test(role)) score += 45;
  if (/\b(?:preset|format|file type|optimized)\b/.test(text)) score += 65;
  if (textMentionsSaveForWebFormat(text)) score += 75;
  if (textMatchesSaveForWebTargetFormat(text, targetFormat)) score += 45;
  if (/\b(?:save|cancel|done)\b/.test(text)) score -= 140;
  if (node.bbox) score += 8;
  return score;
}

export function treeShowsSaveForWebTargetFormat(
  root: ComputerAppSaveDialogNode,
  targetFormat: SaveForWebTargetFormat,
): boolean {
  return flattenSaveDialogNodes(root).some((node) => {
    if (!node.id) return false;
    const score = scoreSaveForWebFormatControl(node, targetFormat);
    if (score < 90) return false;
    return textMatchesSaveForWebTargetFormat(saveForWebNodeText(node), targetFormat);
  });
}

export function findPreferredSaveForWebFormatControl(
  root: ComputerAppSaveDialogNode,
  targetFormat: SaveForWebTargetFormat,
): ComputerAppSaveDialogNode | null {
  let best: { node: ComputerAppSaveDialogNode; score: number } | null = null;
  for (const node of flattenSaveDialogNodes(root)) {
    const score = scoreSaveForWebFormatControl(node, targetFormat);
    if (score < 90) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

function scoreSaveForWebFormatOption(node: ComputerAppSaveDialogNode, targetFormat: SaveForWebTargetFormat): number {
  if (!node.id) return 0;
  const role = normalizeSaveForWebText(node.role);
  const text = saveForWebNodeText(node);
  if (!textMatchesSaveForWebTargetFormat(text, targetFormat)) return 0;
  if (/\b(?:save|cancel|done|quality|metadata|preview|color table)\b/.test(text)) return 0;

  let score = 0;
  if (/(?:menuitem|menu item|option|cell|row|button)/.test(role)) score += 70;
  if (targetFormat === 'png') {
    if (/\bpng-24\b/.test(text)) score += 130;
    else if (/\bpng-8\b/.test(text)) score += 95;
    else if (/\bpng\b/.test(text)) score += 85;
    if (/\b(?:jpeg|jpg)\b/.test(text)) score -= 120;
  } else {
    if (/\bjpeg\b/.test(text)) score += 130;
    else if (/\bjpg\b/.test(text)) score += 100;
    if (/\bpng\b/.test(text)) score -= 120;
  }
  if (node.bbox) score += 8;
  return score;
}

export function findPreferredSaveForWebFormatOption(
  root: ComputerAppSaveDialogNode,
  targetFormat: SaveForWebTargetFormat,
): ComputerAppSaveDialogNode | null {
  let best: { node: ComputerAppSaveDialogNode; score: number } | null = null;
  for (const node of flattenSaveDialogNodes(root)) {
    const score = scoreSaveForWebFormatOption(node, targetFormat);
    if (score < 70) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}
