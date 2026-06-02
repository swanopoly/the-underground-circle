import { fetchAllMcpTools, callMcpTool, type McpTool } from './mcpClient';
import { loadConnections } from './connectionManager';
import {
  getInstalledIntegrationProviders,
  getCircleIntegrationCapabilities,
  type CircleIntegrationProvider,
} from './circleIntegrations';
import {
  matchKnownApp,
  resolveMacLaunchName,
  renderAppShortcut,
  detectPlatform,
} from './knownAppShortcuts';
import {
  detectLocalComputerAwarenessIntent,
  detectLocalComputerAwarenessIntentSequence,
  renderLocalComputerAwarenessIntent,
  type LocalComputerAwarenessIntent,
} from './localComputerAwarenessIntent';
import {
  buildInDesignRecoveryCandidatesForIntent,
  isInDesignIntent,
} from './indesignRecovery';
import {
  isDesktopBridgeAvailable,
  launchApp as bridgeLaunchApp,
  focusApp as bridgeFocusApp,
  manageWindow as bridgeManageWindow,
  mouseMove as bridgeMouseMove,
  mouseClick as bridgeMouseClick,
  mouseDown as bridgeMouseDown,
  mouseUp as bridgeMouseUp,
  mouseDrag as bridgeMouseDrag,
  mouseScroll as bridgeMouseScroll,
  takeScreenshot as bridgeTakeScreenshot,
  getScreenSize as bridgeGetScreenSize,
  openUrl as bridgeOpenUrl,
  openPath as bridgeOpenPath,
  searchFiles as bridgeSearchFiles,
  statFile as bridgeStatFile,
  copyFile as bridgeCopyFile,
  writeClipboard as bridgeWriteClipboard,
  clearClipboard as bridgeClearClipboard,
  getWindowState as bridgeGetWindowState,
  readA11yTree as bridgeReadA11yTree,
  clickElement as bridgeClickElement,
  setElementValue as bridgeSetElementValue,
  typeText as bridgeTypeText,
  pasteText as bridgePasteText,
  pressKeys as bridgePressKeys,
  clickMenu as bridgeClickMenu,
  indesignFindChange as bridgeInDesignFindChange,
  indesignBatchFindChange as bridgeInDesignBatchFindChange,
  indesignDocumentStatus as bridgeInDesignDocumentStatus,
  indesignTextInventory as bridgeInDesignTextInventory,
  indesignSetLayerState as bridgeInDesignSetLayerState,
  indesignBatchUpdateTextLayers as bridgeInDesignBatchUpdateTextLayers,
  indesignUpdateTextLayer as bridgeInDesignUpdateTextLayer,
  indesignRelinkAsset as bridgeInDesignRelinkAsset,
  indesignPackageDocument as bridgeInDesignPackageDocument,
  indesignExportProof as bridgeInDesignExportProof,
  photoshopDocumentStatus as bridgePhotoshopDocumentStatus,
  photoshopLayerInventory as bridgePhotoshopLayerInventory,
  photoshopSetLayerState as bridgePhotoshopSetLayerState,
  photoshopUpdateTextLayer as bridgePhotoshopUpdateTextLayer,
  photoshopPlaceAsset as bridgePhotoshopPlaceAsset,
  photoshopExportProof as bridgePhotoshopExportProof,
  waitForApp as bridgeWaitForApp,
  ensureDesktopBridgePaired,
  type A11yNode,
} from './desktopBridge';
import {
  detectBlockingAppModalPlan,
  type BlockingAppModalPlan,
} from './desktopBlockingModals';
import {
  buildDesktopAIModalDecisionPrompt,
  decideDesktopAIModalAction,
  extractDesktopAIModalObservation,
  parseDesktopAIModalCandidate,
  validateDesktopAIModalCandidate,
  type DesktopAIModalDecision,
} from './desktopAIModalAdvisor';
import { callBlackSwan } from './blackswanLLM';
import {
  findPreferredSaveForWebFormatControl,
  findPreferredSaveForWebFormatOption,
  findPreferredSaveExtensionMismatchButton,
  findPreferredSaveReplaceExistingButton,
  isStatableLocalSavePath,
  normalizeFileExtension,
  normalizeSaveForWebTargetFormat,
  saveDialogVisibleText,
  treeShowsSaveForWebTargetFormat,
  treeLooksLikeSaveExtensionMismatchDialog,
  treeLooksLikeSaveReplaceExistingDialog,
  type SaveForWebTargetFormat,
} from './computerAppSaveDialogs';

export interface ComputerAppAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function toolMatches(tool: Pick<McpTool, 'name' | 'description'>, needles: string[]): boolean {
  const haystack = `${normalizeText(tool.name)} ${normalizeText(tool.description)}`;
  return needles.some((needle) => haystack.includes(needle));
}

function isDesktopOrAppTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'desktop',
    'application',
    'window',
    'slack',
    'figma',
    'notion',
    'github',
    'browser',
    'computer',
    'app',
    'mail',
    'calendar',
    'discord',
    'teams',
  ]);
}

function providerMentioned(task: string, provider: string): boolean {
  return new RegExp(`\\b${provider.replace(/[_-]/g, '[-_ ]?')}\\b`, 'i').test(task);
}

function inferTargetProviders(task: string): CircleIntegrationProvider[] {
  const providers: CircleIntegrationProvider[] = [
    'slack', 'github', 'notion', 'figma', 'discord', 'teams', 'wordpress', 'shopify',
    'stripe', 'salesforce', 'pipedrive', 'mailchimp', 'convertkit', 'posthog',
  ];
  return providers.filter((provider) => providerMentioned(task, provider));
}

function hasInputProp(tool: McpTool, key: string): boolean {
  const props = tool.inputSchema?.properties;
  return !!props && typeof props === 'object' && key in props;
}

function inferQuery(task: string): string {
  return String(task || '')
    .replace(/\b(check|open|inspect|review|look at|look up|search|find|show|use|in)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildArgs(tool: McpTool, task: string): Record<string, unknown> {
  const query = inferQuery(task);
  const args: Record<string, unknown> = {};
  if (hasInputProp(tool, 'query')) args.query = query;
  if (hasInputProp(tool, 'q')) args.q = query;
  if (hasInputProp(tool, 'search')) args.search = query;
  if (hasInputProp(tool, 'prompt')) args.prompt = query;
  if (hasInputProp(tool, 'task')) args.task = task;
  if (hasInputProp(tool, 'message')) args.message = query;
  if (hasInputProp(tool, 'limit')) args.limit = 10;
  return Object.keys(args).length > 0 ? args : { query };
}

function stringifyResult(result: any): string {
  if (result == null) return 'No result returned.';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.slice(0, 8).map((item) => JSON.stringify(item)).join('\n');
  if (typeof result === 'object') {
    if (Array.isArray(result.content)) {
      return result.content
        .slice(0, 8)
        .map((item: any) => typeof item?.text === 'string' ? item.text : JSON.stringify(item))
        .join('\n');
    }
    return JSON.stringify(result, null, 2).slice(0, 2000);
  }
  return String(result);
}

function flattenA11yNodes(node: A11yNode | null | undefined, out: A11yNode[] = []): A11yNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children || []) flattenA11yNodes(child, out);
  return out;
}

function scoreA11yNode(node: A11yNode, target: string): number {
  const normalizedTarget = normalizeText(target).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const label = normalizeText(`${node.label || ''} ${node.value || ''}`).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedTarget || !label) return 0;
  let score = 0;
  if (label === normalizedTarget) score += 120;
  else if (label.includes(normalizedTarget)) score += 90;
  else if (normalizedTarget.includes(label) && label.length >= 3) score += 70;
  const targetWords = normalizedTarget.split(' ').filter(Boolean);
  const labelWords = new Set(label.split(' ').filter(Boolean));
  const matchedWords = targetWords.filter((word) => labelWords.has(word)).length;
  if (targetWords.length > 0 && matchedWords === targetWords.length) score += 75;
  else score += matchedWords * 18;
  if (/button|menu|checkbox|radio|tab|link|textfield|text field|popup|cell|row/i.test(node.role)) score += 12;
  if (node.bbox) score += 8;
  return score;
}

function findBestA11yNode(root: A11yNode, targetLabel: string): A11yNode | null {
  const nodes = flattenA11yNodes(root).filter((node) => node.id && (node.label || node.value));
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    const score = scoreA11yNode(node, targetLabel);
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

function findBestTextEntryA11yNode(root: A11yNode, targetLabel: string): A11yNode | null {
  const nodes = flattenA11yNodes(root).filter((node) => node.id && (node.label || node.value));
  const textEntryRole = /textfield|text field|textarea|text area|combobox|combo box|search|editable/i;
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    let score = scoreA11yNode(node, targetLabel);
    if (textEntryRole.test(node.role)) score += 45;
    if (/statictext|image|button|checkbox|radio|tab/i.test(node.role)) score -= 25;
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || findBestA11yNode(root, targetLabel);
}

function looksLikeFilename(value: string): boolean {
  return /^[^/\\:*?"<>|\r\n]{1,180}\.[A-Za-z0-9]{2,8}$/.test(String(value || '').trim());
}

function isSaveDialogFilenameIntent(intent: { kind?: string | null; reason?: string; text?: string }): boolean {
  return intent.kind === 'paste_text' && intent.reason === 'local-save-dialog-filename' && looksLikeFilename(intent.text || '');
}

function isSaveDialogOutputPathIntent(intent: { kind?: string | null; reason?: string; text?: string }): boolean {
  return intent.kind === 'paste_text' && intent.reason === 'local-save-dialog-output-path' && Boolean(String(intent.text || '').trim());
}

function isSaveForWebSaveButtonIntent(intent: { kind?: string | null; reason?: string; targetLabel?: string }): boolean {
  return intent.kind === 'semantic_click' && intent.reason === 'local-save-for-web-save-button';
}

function isImageFilename(value: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|tiff?|bmp|heic)$/i.test(String(value || '').trim());
}

function findLikelySaveFilenameField(root: A11yNode): A11yNode | null {
  const textEntryRole = /textfield|text field|textarea|text area|combobox|combo box|editable/i;
  const nodes = flattenA11yNodes(root).filter((node) => node.id && textEntryRole.test(node.role || ''));
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    const haystack = normalizeText(`${node.role || ''} ${node.label || ''} ${node.value || ''}`);
    let score = 50;
    if (/\b(save|save as|filename|file name|name|untitled|copy)\b/i.test(haystack)) score += 60;
    if (looksLikeFilename(node.value || '')) score += 45;
    if (/\b(search|filter|tags?|where|format)\b/i.test(haystack)) score -= 20;
    if (node.bbox) score += 10;
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

function treeLooksLikeSaveDialog(root: A11yNode): boolean {
  const labels = flattenA11yNodes(root)
    .slice(0, 120)
    .map((node) => `${node.role || ''} ${node.label || ''} ${node.value || ''}`)
    .join(' ');
  return /\b(save|save as|save a copy|save for web|export|optimized|preset|file name|filename|where|format|options|quality|replace|jpeg|jpg|png|gif)\b/i.test(labels);
}

function compactA11yCandidates(root: A11yNode): string {
  return flattenA11yNodes(root)
    .filter((node) => node.id && (node.label || node.value || /textfield|button|menu|sheet|dialog/i.test(node.role || '')))
    .slice(0, 16)
    .map((node) => `[${node.id}] ${node.role}${node.label ? ` "${node.label}"` : ''}${node.value && node.value !== node.label ? ` = "${node.value}"` : ''}`)
    .join('\n');
}

async function decideBlockingModalWithAdvisor(args: {
  root: A11yNode;
  app?: string | null;
  task?: string | null;
}): Promise<DesktopAIModalDecision | null> {
  const localDecision = decideDesktopAIModalAction({
    root: args.root,
    app: args.app || null,
    task: args.task || '',
  });
  if (!localDecision) return null;
  if (localDecision.action === 'click_button' || localDecision.risk !== 'unknown') return localDecision;

  const observation = extractDesktopAIModalObservation(args.root, args.app || null);
  if (!observation) return localDecision;
  try {
    const prompt = buildDesktopAIModalDecisionPrompt({
      task: args.task || '',
      observation,
    });
    const response = await callBlackSwan([
      {
        role: 'system',
        content: 'You classify desktop app popups for a computer-control agent. Return only the requested JSON object.',
      },
      { role: 'user', content: prompt },
    ], {
      temperature: 0,
      maxTokens: 240,
      timeoutMs: 4500,
    });
    const candidate = parseDesktopAIModalCandidate(response.content);
    if (!candidate) return localDecision;
    return validateDesktopAIModalCandidate({
      candidate,
      observation,
      task: args.task || '',
    });
  } catch {
    return localDecision;
  }
}

async function handleBlockingAppModals(
  appQuery: string | undefined,
  options: { maxDialogs?: number; context?: string; task?: string } = {},
): Promise<ComputerAppAdapterResult | null> {
  const appName = appQuery || undefined;
  const handled: BlockingAppModalPlan[] = [];
  const maxDialogs = Math.max(1, Math.min(5, Math.trunc(options.maxDialogs || 3)));
  for (let attempt = 0; attempt < maxDialogs; attempt += 1) {
    if (appName) await bridgeFocusApp(appName).catch(() => null);
    await sleep(attempt === 0 ? 250 : 500);
    const tree = await bridgeReadA11yTree({ appName, maxDepth: 12, maxNodes: 900 });
    if (!tree.ok || !tree.data?.tree) {
      return handled.length > 0
        ? {
          ok: true,
          message: `Handled ${handled.length} blocking app dialog${handled.length === 1 ? '' : 's'}, then accessibility inspection became unavailable.`,
          warnings: [
            ...handled.map((item) => `handled ${item.policyLabel} via ${item.buttonLabel}`),
            `desktop_a11y_tree unavailable after modal handling: ${tree.errorCode || 'unknown_error'}`,
          ],
          data: { kind: 'desktop_blocking_modal_handled', handled, context: options.context || null },
        }
        : null;
    }
    const plan = detectBlockingAppModalPlan(tree.data.tree, tree.data.app || appName);
    const aiDecision: DesktopAIModalDecision | null = plan
      ? null
      : await decideBlockingModalWithAdvisor({
        root: tree.data.tree,
        app: tree.data.app || appName || null,
        task: options.task || options.context || '',
      });
    if (!plan && !aiDecision) break;
    if (!plan && aiDecision && aiDecision.action !== 'click_button') {
      return {
        ok: false,
        message: aiDecision.userMessage || `A ${tree.data.app || appName || 'desktop app'} popup needs a decision before I continue.`,
        warnings: [`desktop_ai_modal_advisor ${aiDecision.risk}`],
        data: {
          kind: 'desktop_ai_modal_decision_needed',
          decision: aiDecision,
          context: options.context || null,
        },
      };
    }
    const activePlan: BlockingAppModalPlan = plan || {
      policyId: `ai_modal_advisor:${aiDecision?.risk || 'unknown'}`,
      policyLabel: 'AI modal advisor',
      app: tree.data.app || appName || null,
      buttonLabel: aiDecision?.buttonLabel || 'selected button',
      buttonPath: aiDecision?.buttonId || '',
      summary: aiDecision?.reason || 'AI modal advisor selected a guarded popup action.',
    };
    if (!activePlan.buttonPath) break;
    const clicked = await bridgeClickElement({ pid: tree.data.pid, path: activePlan.buttonPath });
    if (!clicked.ok) {
      return {
        ok: false,
        message: `Detected a blocking **${activePlan.policyLabel}** dialog, but could not click **${activePlan.buttonLabel}**: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_blocking_modal_click failed with ${clicked.errorCode || 'unknown_error'}`],
        data: {
          kind: 'desktop_blocking_modal_failed',
          plan: activePlan,
          context: options.context || null,
          errorCode: clicked.errorCode,
        },
      };
    }
    handled.push(activePlan);
  }
  if (handled.length === 0) return null;
  return {
    ok: true,
    message: `Handled ${handled.length} blocking app dialog${handled.length === 1 ? '' : 's'}: ${handled.map((item) => `${item.policyLabel} → ${item.buttonLabel}`).join(', ')}.`,
    warnings: handled.map((item) => `handled ${item.policyLabel} via ${item.buttonLabel}`),
    data: {
      kind: 'desktop_blocking_modal_handled',
      handled,
      context: options.context || null,
    },
  };
}

function treeLooksLikeSaveForWebDialog(root: A11yNode): boolean {
  const labels = flattenA11yNodes(root)
    .slice(0, 180)
    .map((node) => `${node.role || ''} ${node.label || ''} ${node.value || ''}`)
    .join(' ');
  return /\b(save for web|optimized|preset|quality|metadata|color table|jpeg|jpg|png|gif|export)\b/i.test(labels);
}

function findLikelySaveForWebButton(root: A11yNode): A11yNode | null {
  const candidates = flattenA11yNodes(root).filter((node) => node.id && /\bsave\b/i.test(`${node.label || ''} ${node.value || ''}`));
  const exactButtons = candidates.filter((node) => /button/i.test(node.role || '') && /^\s*save(?:\.\.\.)?\s*$/i.test(`${node.label || ''} ${node.value || ''}`.trim()));
  if (exactButtons.length > 0) return exactButtons[0];
  const saveButtons = candidates.filter((node) => /button/i.test(node.role || ''));
  if (saveButtons.length > 0) return saveButtons[0];
  return null;
}

async function ensureSaveForWebFormat(
  appQuery: string | undefined,
  targetFormat: SaveForWebTargetFormat | null,
  currentTree?: { pid: number; app?: string | null; tree: A11yNode },
): Promise<ComputerAppAdapterResult | null> {
  if (!targetFormat) return null;
  const appLabel = appQuery || 'the frontmost app';
  const readCurrentTree = async () => {
    if (currentTree) return { ok: true as const, data: currentTree };
    return bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  };
  const initialTree = await readCurrentTree();
  if (!initialTree.ok || !initialTree.data?.tree) {
    const initialError = initialTree as { error?: string; errorCode?: string };
    return {
      ok: false,
      message: `I opened Save for Web in **${appLabel}**, but could not inspect the format picker before saving: ${initialError.error || initialError.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${initialError.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_format_unverified', app: appQuery || null, targetFormat, errorCode: initialError.errorCode },
    };
  }
  if (treeShowsSaveForWebTargetFormat(initialTree.data.tree, targetFormat)) {
    return {
      ok: true,
      message: `Verified Save for Web is already set to **${targetFormat.toUpperCase()}**.`,
      warnings: [],
      data: { kind: 'desktop_save_for_web_format_verified', app: initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const formatControl = findPreferredSaveForWebFormatControl(initialTree.data.tree, targetFormat);
  if (!formatControl) {
    return {
      ok: false,
      message:
        `I verified the Save for Web dialog in **${initialTree.data.app || appLabel}**, but could not find the preset/format picker needed to switch the export to **${targetFormat.toUpperCase()}** before saving.\n\n` +
        `Visible controls:\n${compactA11yCandidates(initialTree.data.tree) || '(no format controls returned)'}`,
      warnings: ['save for web format picker not found'],
      data: { kind: 'desktop_save_for_web_format_picker_missing', app: initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const opened = await bridgeClickElement({ pid: initialTree.data.pid, path: formatControl.id });
  if (!opened.ok) {
    return {
      ok: false,
      message: `I found the Save for Web format picker, but could not open it before saving: ${opened.error || opened.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${opened.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_for_web_format_picker_failed',
        app: initialTree.data.app || appQuery || null,
        targetFormat,
        targetPath: formatControl.id,
        errorCode: opened.errorCode,
      },
    };
  }
  await sleep(350);
  const menuTree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 14, maxNodes: 1200 });
  if (!menuTree.ok || !menuTree.data?.tree) {
    return {
      ok: false,
      message: `I opened the Save for Web format picker, but could not inspect the format options: ${menuTree.error || menuTree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${menuTree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_format_options_unverified', app: initialTree.data.app || appQuery || null, targetFormat, errorCode: menuTree.errorCode },
    };
  }
  const formatOption = findPreferredSaveForWebFormatOption(menuTree.data.tree, targetFormat);
  if (!formatOption) {
    return {
      ok: false,
      message:
        `I opened the Save for Web format picker in **${menuTree.data.app || initialTree.data.app || appLabel}**, but could not find a **${targetFormat.toUpperCase()}** option. ` +
        `I stopped before saving so Photoshop does not export the wrong file type.\n\n` +
        `Visible controls:\n${compactA11yCandidates(menuTree.data.tree) || '(no format options returned)'}`,
      warnings: ['save for web target format option not found'],
      data: { kind: 'desktop_save_for_web_format_option_missing', app: menuTree.data.app || initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const selected = await bridgeClickElement({ pid: menuTree.data.pid, path: formatOption.id });
  if (!selected.ok) {
    return {
      ok: false,
      message: `I found the Save for Web **${targetFormat.toUpperCase()}** option, but could not select it: ${selected.error || selected.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${selected.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_for_web_format_option_failed',
        app: menuTree.data.app || initialTree.data.app || appQuery || null,
        targetFormat,
        targetPath: formatOption.id,
        errorCode: selected.errorCode,
      },
    };
  }
  await sleep(500);
  const verifyTree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  if (verifyTree.ok && verifyTree.data?.tree && treeLooksLikeSaveForWebDialog(verifyTree.data.tree) && !treeShowsSaveForWebTargetFormat(verifyTree.data.tree, targetFormat)) {
    return {
      ok: false,
      message:
        `I selected the Save for Web **${targetFormat.toUpperCase()}** option, but Photoshop still did not report that format. ` +
        `I stopped before saving so the export does not use the wrong file type.`,
      warnings: ['save for web target format not verified after selection'],
      data: { kind: 'desktop_save_for_web_format_not_verified', app: verifyTree.data.app || appQuery || null, targetFormat },
    };
  }
  return {
    ok: true,
    message: `Set Save for Web format to **${targetFormat.toUpperCase()}** before saving.`,
    warnings: [],
    data: {
      kind: 'desktop_save_for_web_format_selected',
      app: menuTree.data.app || initialTree.data.app || appQuery || null,
      targetFormat,
      targetPath: formatOption.id,
      verified: Boolean(verifyTree.ok && verifyTree.data?.tree && treeShowsSaveForWebTargetFormat(verifyTree.data.tree, targetFormat)),
    },
  };
}

async function clickSaveForWebSaveButton(appQuery?: string, targetFormat?: SaveForWebTargetFormat | null): Promise<ComputerAppAdapterResult> {
  const appLabel = appQuery || 'the frontmost app';
  await sleep(250);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  if (!tree.ok || !tree.data?.tree) {
    return {
      ok: false,
      message: `I opened Save for Web in **${appLabel}**, but could not inspect the dialog before clicking Save: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_dialog_unverified', app: appQuery || null, errorCode: tree.errorCode },
    };
  }
  if (!treeLooksLikeSaveForWebDialog(tree.data.tree)) {
    return {
      ok: false,
      message:
        `I opened Save for Web in **${tree.data.app || appLabel}**, but I could not verify that the Save for Web export dialog appeared. ` +
        `Photoshop may have no active document, the shortcut may be disabled, or macOS may not be exposing the dialog.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no useful controls returned)'}`,
      warnings: ['save for web dialog not verified'],
      data: { kind: 'desktop_save_for_web_dialog_missing', app: tree.data.app || appQuery || null },
    };
  }
  const formatResult = await ensureSaveForWebFormat(appQuery, targetFormat || null, {
    pid: tree.data.pid,
    app: tree.data.app || appQuery || null,
    tree: tree.data.tree,
  });
  if (formatResult && !formatResult.ok) return formatResult;
  const saveTree = targetFormat
    ? await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 })
    : tree;
  if (!saveTree.ok || !saveTree.data?.tree) {
    return {
      ok: false,
      message: `I set the Save for Web format in **${appLabel}**, but could not re-inspect the dialog before clicking Save: ${saveTree.error || saveTree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${saveTree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_dialog_unverified', app: appQuery || null, targetFormat: targetFormat || null, errorCode: saveTree.errorCode },
    };
  }
  if (!treeLooksLikeSaveForWebDialog(saveTree.data.tree)) {
    return {
      ok: false,
      message: `I set the Save for Web format in **${appLabel}**, but the Save for Web dialog was no longer visible before saving.`,
      warnings: ['save for web dialog disappeared before save'],
      data: { kind: 'desktop_save_for_web_dialog_missing_after_format', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null },
    };
  }
  const saveButton = findLikelySaveForWebButton(saveTree.data.tree);
  if (!saveButton) {
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Verified the Save for Web dialog${targetFormat ? ` with **${targetFormat.toUpperCase()}** format` : ''} and pressed Return because the Save button was not exposed by accessibility.`,
        warnings: ['save for web save button not found; used Return fallback'],
        data: { kind: 'desktop_save_for_web_save_return', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, format: formatResult?.data || null },
      };
    }
    return {
      ok: false,
      message:
        `I verified the Save for Web dialog in **${saveTree.data.app || appLabel}**, but could not find the dialog's Save button.\n\n` +
        `Visible controls:\n${compactA11yCandidates(saveTree.data.tree) || '(no Save controls returned)'}`,
      warnings: ['save for web save button not found'],
      data: { kind: 'desktop_save_for_web_save_missing', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, format: formatResult?.data || null },
    };
  }
  const clicked = await bridgeClickElement({ pid: saveTree.data.pid, path: saveButton.id });
  if (!clicked.ok) {
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Found the Save for Web Save button, but clicking it failed; pressed Return as the dialog fallback.`,
        warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}; used Return fallback`],
        data: { kind: 'desktop_save_for_web_save_return', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, targetPath: saveButton.id, format: formatResult?.data || null },
      };
    }
    return {
      ok: false,
      message: `Found the Save for Web Save button, but clicking it failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: saveButton.id },
    };
  }
  return {
    ok: true,
    message: `Verified the Save for Web dialog${targetFormat ? ` with **${targetFormat.toUpperCase()}** format` : ''} and clicked Save.`,
    warnings: [],
    data: { kind: 'desktop_save_for_web_save_clicked', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, targetPath: saveButton.id, format: formatResult?.data || null },
  };
}

async function setSaveDialogFilename(filename: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const appLabel = appQuery || 'the frontmost app';
  await sleep(250);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 800 });
  if (tree.ok && tree.data?.tree) {
    const saveDialogSeen = treeLooksLikeSaveDialog(tree.data.tree);
    const field = findLikelySaveFilenameField(tree.data.tree);
    if (!saveDialogSeen) {
      return {
        ok: false,
        message:
          `I opened the save/export command for **${appLabel}**, but I could not verify that a filename dialog appeared. ` +
          `Photoshop may have no active document, the command may be disabled, or macOS did not give the bridge access to the export dialog.\n\n` +
          `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no useful controls returned)'}`,
        warnings: ['save/export dialog not verified'],
        data: { kind: 'desktop_save_dialog_missing', app: tree.data.app || appQuery || null },
      };
    }
    if (!field) {
      return {
        ok: false,
        message:
          `I found a Save dialog in **${tree.data.app || appLabel}**, but could not find the filename field to set **${filename}**.\n\n` +
          `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no filename controls returned)'}`,
        warnings: ['save filename field not found'],
        data: { kind: 'desktop_save_filename_field_missing', app: tree.data.app || appQuery || null },
      };
    }
    const set = await bridgeSetElementValue({ pid: tree.data.pid, path: field.id, text: filename });
    if (set.ok) {
      return {
        ok: true,
        message: `Verified the Save dialog and set the filename field to **${filename}** via accessibility.`,
        warnings: [],
        data: { kind: 'desktop_save_filename_set', app: tree.data.app || appQuery || null, targetPath: field.id, method: set.data?.method || 'ax_set_value', chars: set.data?.chars ?? filename.length },
      };
    }
    const clicked = await bridgeClickElement({ pid: tree.data.pid, path: field.id });
    if (!clicked.ok) {
      return {
        ok: false,
        message: `Found the Save dialog filename field, but could not focus it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: field.id },
      };
    }
    await bridgePressKeys('Cmd+A').catch(() => null);
    const pasted = await bridgePasteText(filename, { restoreClipboard: true, focusMode: 'skip' });
    if (!pasted.ok) {
      return {
        ok: false,
        message: `Focused the Save dialog filename field, but paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode, targetPath: field.id },
      };
    }
    return {
      ok: true,
      message: `Verified the Save dialog and pasted **${filename}** into the filename field.`,
      warnings: [`Direct AX set failed: ${set.error || set.errorCode || 'unknown error'}`],
      data: { kind: 'desktop_save_filename_pasted', app: tree.data.app || appQuery || null, targetPath: field.id, chars: pasted.data?.chars ?? filename.length },
    };
  }

  const win = await bridgeGetWindowState();
  const title = `${win.data?.frontmostApp || ''} ${win.data?.activeWindowTitle || ''} ${(win.data?.windows || []).join(' ')}`;
  if (win.ok && /\b(save|copy|export|options|replace)\b/i.test(title)) {
    const pasted = await bridgePasteText(filename, { restoreClipboard: true, focusMode: 'skip' });
    if (!pasted.ok) {
      return {
        ok: false,
        message: `A save-related window appears to be frontmost, but filename paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode },
      };
    }
    return {
      ok: true,
      message: `Could not read the Save dialog accessibility tree, but the active window looked save-related and I pasted **${filename}** into the focused field.`,
      warnings: [`desktop_a11y_tree unavailable: ${tree.error || tree.errorCode || 'unknown error'}`],
      data: { kind: 'desktop_save_filename_pasted_unverified', app: win.data?.frontmostApp || appQuery || null, chars: pasted.data?.chars ?? filename.length },
    };
  }

  return {
    ok: false,
    message:
      `I opened the save/export command for **${appLabel}**, but could not verify a filename dialog before entering **${filename}**. ` +
      `This usually means Photoshop has no active image/document, Save for Web/Save As is disabled, or the local bridge cannot inspect the dialog yet.`,
    warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
    data: { kind: 'desktop_save_dialog_unverified', app: appQuery || null, errorCode: tree.errorCode },
  };
}

function splitSaveDialogOutputPath(outputPath: string): { folderPath: string | null; filename: string } {
  const clean = String(outputPath || '').trim().replace(/[\\/]+$/, '');
  const slashIndex = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (slashIndex <= 0) return { folderPath: null, filename: clean };
  return {
    folderPath: clean.slice(0, slashIndex),
    filename: clean.slice(slashIndex + 1),
  };
}

async function setSaveDialogOutputPath(outputPath: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const target = splitSaveDialogOutputPath(outputPath);
  if (!looksLikeFilename(target.filename)) {
    return {
      ok: false,
      message: `The requested Photoshop export filename is not a safe image filename: ${target.filename || '(empty)'}.`,
      warnings: ['invalid save dialog filename'],
      data: { kind: 'desktop_invalid_input', outputPath },
    };
  }
  if (target.folderPath) {
    const goToFolder = await bridgePressKeys('Cmd+Shift+G');
    if (!goToFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not open Go to Folder for **${target.folderPath}**: ${goToFolder.error || goToFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_press_keys failed with ${goToFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: goToFolder.errorCode, outputPath },
      };
    }
    await sleep(250);
    const pastedFolder = await bridgePasteText(target.folderPath, { restoreClipboard: true, focusMode: 'skip' });
    if (!pastedFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not enter the destination folder **${target.folderPath}**: ${pastedFolder.error || pastedFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pastedFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pastedFolder.errorCode, outputPath },
      };
    }
    const confirmedFolder = await bridgePressKeys('Return');
    if (!confirmedFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not confirm the destination folder **${target.folderPath}**: ${confirmedFolder.error || confirmedFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_press_keys failed with ${confirmedFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: confirmedFolder.errorCode, outputPath },
      };
    }
    await sleep(600);
  }
  return setSaveDialogFilename(target.filename, appQuery);
}

async function maybeResolveSaveExtensionMismatch(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  const targetExtension = normalizeFileExtension(filename);
  if (!targetExtension || !isImageFilename(filename)) return null;
  await sleep(500);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 700 });
  if (!tree.ok || !tree.data?.tree) return null;
  if (!treeLooksLikeSaveExtensionMismatchDialog(tree.data.tree, filename)) return null;
  const keepExtensionButton = findPreferredSaveExtensionMismatchButton(tree.data.tree, filename);
  if (!keepExtensionButton?.id) {
    return {
      ok: false,
      message:
        `Photoshop asked whether to keep **.${targetExtension}** for **${splitSaveDialogOutputPath(filename).filename}**, ` +
        `but the local bridge could not find the **Use .${targetExtension}** button. I stopped before choosing the wrong format.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no extension controls returned)'}`,
      warnings: ['save extension mismatch unresolved'],
      data: {
        kind: 'desktop_save_extension_mismatch_unresolved',
        app: tree.data.app || appQuery || null,
        filename,
        targetExtension,
      },
    };
  }
  const clicked = await bridgeClickElement({ pid: tree.data.pid, path: keepExtensionButton.id });
  if (!clicked.ok) {
    return {
      ok: false,
      message: `Photoshop asked whether to keep **.${targetExtension}**, but clicking **${keepExtensionButton.label || keepExtensionButton.value || `Use .${targetExtension}`}** failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_extension_mismatch_click_failed',
        app: tree.data.app || appQuery || null,
        filename,
        targetExtension,
        targetPath: keepExtensionButton.id,
        errorCode: clicked.errorCode,
      },
    };
  }
  return {
    ok: true,
    message: `Confirmed the save extension warning by keeping **.${targetExtension}** for **${splitSaveDialogOutputPath(filename).filename}**.`,
    warnings: [],
    data: {
      kind: 'desktop_save_extension_mismatch_confirmed',
      app: tree.data.app || appQuery || null,
      filename,
      targetExtension,
      targetPath: keepExtensionButton.id,
      buttonLabel: keepExtensionButton.label || keepExtensionButton.value || null,
    },
  };
}

async function maybeResolveSaveReplaceExisting(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  if (!filename || !isImageFilename(filename)) return null;
  await sleep(500);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 700 });
  if (!tree.ok || !tree.data?.tree) return null;
  if (!treeLooksLikeSaveReplaceExistingDialog(tree.data.tree, filename)) return null;
  const replaceButton = findPreferredSaveReplaceExistingButton(tree.data.tree);
  if (!replaceButton?.id) {
    return {
      ok: false,
      message:
        `Photoshop said **${splitSaveDialogOutputPath(filename).filename}** already exists, but the local bridge could not find the **Replace** button. ` +
        `I stopped before choosing the wrong action.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no replace controls returned)'}`,
      warnings: ['save replace existing unresolved'],
      data: {
        kind: 'desktop_save_replace_existing_unresolved',
        app: tree.data.app || appQuery || null,
        filename,
      },
    };
  }
  const clicked = await bridgeClickElement({ pid: tree.data.pid, path: replaceButton.id });
  if (!clicked.ok) {
    return {
      ok: false,
      message: `Photoshop said **${splitSaveDialogOutputPath(filename).filename}** already exists, but clicking **${replaceButton.label || replaceButton.value || 'Replace'}** failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_replace_existing_click_failed',
        app: tree.data.app || appQuery || null,
        filename,
        targetPath: replaceButton.id,
        errorCode: clicked.errorCode,
      },
    };
  }
  return {
    ok: true,
    message: `Confirmed Photoshop can replace the existing **${splitSaveDialogOutputPath(filename).filename}** file.`,
    warnings: [],
    data: {
      kind: 'desktop_save_replace_existing_confirmed',
      app: tree.data.app || appQuery || null,
      filename,
      targetPath: replaceButton.id,
      buttonLabel: replaceButton.label || replaceButton.value || null,
    },
  };
}

async function runPhotoshopSaveForWebExportFallback(outputPath: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const appName = appQuery || 'Photoshop';
  const target = splitSaveDialogOutputPath(outputPath);
  const targetFormat = normalizeSaveForWebTargetFormat(target.filename);
  await bridgeFocusApp(appName).catch(() => null);
  const shortcut = await bridgePressKeys('Cmd+Opt+Shift+S');
  if (!shortcut.ok) {
    return {
      ok: false,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web shortcut failed: ${shortcut.error || shortcut.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_press_keys failed with ${shortcut.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: shortcut.errorCode, outputPath },
    };
  }
  await sleep(1500);
  const clickedSave = await clickSaveForWebSaveButton(appName, targetFormat);
  if (!clickedSave.ok) {
    return {
      ...clickedSave,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web fallback could not continue. ${clickedSave.message}`,
      warnings: ['photoshop_export_proof stale_bridge; save_for_web_fallback failed', ...clickedSave.warnings],
    };
  }
  await sleep(1000);
  const namedFile = await setSaveDialogOutputPath(outputPath, appName);
  if (!namedFile.ok) {
    return {
      ...namedFile,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web fallback could not set the output path. ${namedFile.message}`,
      warnings: ['photoshop_export_proof stale_bridge; save_for_web_fallback failed', ...namedFile.warnings],
    };
  }
  const confirmed = await bridgePressKeys('Return');
  if (!confirmed.ok) {
    return {
      ok: false,
      message: `Save for Web set **${target.filename}**, but confirming the Save dialog failed: ${confirmed.error || confirmed.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_press_keys failed with ${confirmed.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: confirmed.errorCode, outputPath },
    };
  }
  const postSave = await maybeHandlePostSaveImageDialogs(appName, target.filename);
  if (postSave && !postSave.ok) {
    return {
      ...postSave,
      message: `Photoshop Save for Web reached the final save dialog, but the export could not safely finish. ${postSave.message}`,
      warnings: ['photoshop_save_for_web_post_save_dialog failed', ...postSave.warnings],
    };
  }
  const outputVerification = await verifySaveDialogOutputFile(outputPath);
  if (outputVerification && !outputVerification.ok) {
    return {
      ...outputVerification,
      message: `Photoshop Save for Web reached the final save dialog, but the export could not be verified. ${outputVerification.message}`,
      warnings: ['photoshop_save_for_web_output_verification failed', ...outputVerification.warnings],
    };
  }
  const outputVerificationData = (outputVerification?.data || {}) as {
    sizeBytes?: unknown;
  };
  return {
    ok: true,
    message: `Photoshop proof export endpoint was unavailable, so I used Save for Web and saved **${target.filename}**${target.folderPath ? ` to **${target.folderPath}**` : ''}.`,
    warnings: [
      'photoshop_export_proof stale_bridge; used save_for_web_fallback',
      ...clickedSave.warnings,
      ...namedFile.warnings,
      ...(postSave?.warnings || []),
      ...(outputVerification?.warnings || []),
    ],
    data: {
      kind: 'desktop_photoshop_save_for_web_fallback',
      outputPath,
      filename: target.filename,
      folderPath: target.folderPath,
      fileExists: outputVerification ? true : null,
      sizeBytes: typeof outputVerificationData.sizeBytes === 'number' ? outputVerificationData.sizeBytes : null,
      saveForWeb: clickedSave.data || null,
      filenameEntry: namedFile.data || null,
      postSave: postSave?.data || null,
      outputVerification: outputVerification?.data || null,
    },
  };
}

async function maybeConfirmPostSaveOptions(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  if (!isImageFilename(filename)) return null;
  await sleep(700);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 600 });
  if (tree.ok && tree.data?.tree) {
    if (treeLooksLikeSaveExtensionMismatchDialog(tree.data.tree, filename)) return null;
    if (treeLooksLikeSaveReplaceExistingDialog(tree.data.tree, filename)) return null;
    const labels = saveDialogVisibleText(tree.data.tree, 120);
    if (!/\b(jpeg|jpg|png|tiff|image options|quality|format options|options)\b/i.test(labels)) return null;
    const okButton = findBestA11yNode(tree.data.tree, 'OK') || findBestA11yNode(tree.data.tree, 'Save');
    if (okButton) {
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: okButton.id });
      if (clicked.ok) {
        return {
          ok: true,
          message: `Confirmed the post-save image options dialog for **${filename}**.`,
          warnings: [],
          data: { kind: 'desktop_save_options_confirmed', app: tree.data.app || appQuery || null, targetPath: okButton.id },
        };
      }
    }
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Confirmed the post-save image options dialog with Return.`,
        warnings: [],
        data: { kind: 'desktop_save_options_confirmed', app: tree.data.app || appQuery || null, method: 'return_key' },
      };
    }
  }
  return null;
}

async function maybeHandlePostSaveImageDialogs(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  const handled: ComputerAppAdapterResult[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const extensionMismatch = await maybeResolveSaveExtensionMismatch(appQuery, filename);
    if (extensionMismatch) {
      if (!extensionMismatch.ok) return extensionMismatch;
      handled.push(extensionMismatch);
      continue;
    }
    const replaceExisting = await maybeResolveSaveReplaceExisting(appQuery, filename);
    if (replaceExisting) {
      if (!replaceExisting.ok) return replaceExisting;
      handled.push(replaceExisting);
      continue;
    }
    break;
  }
  const imageOptions = await maybeConfirmPostSaveOptions(appQuery, filename);
  if (imageOptions && !imageOptions.ok) return imageOptions;
  const allHandled = [...handled, ...(imageOptions ? [imageOptions] : [])];
  if (allHandled.length > 1) {
    return {
      ok: true,
      message: allHandled.map((result) => result.message).join(' '),
      warnings: allHandled.flatMap((result) => result.warnings),
      data: {
        kind: 'desktop_post_save_image_dialogs_confirmed',
        dialogs: allHandled.map((result) => result.data || null),
      },
    };
  }
  return allHandled[0] || null;
}

async function verifySaveDialogOutputFile(outputPath: string): Promise<ComputerAppAdapterResult | null> {
  const cleanPath = String(outputPath || '').trim();
  if (!cleanPath || !isImageFilename(cleanPath) || !isStatableLocalSavePath(cleanPath)) return null;
  const target = splitSaveDialogOutputPath(cleanPath);
  await sleep(800);
  const stat = await bridgeStatFile(cleanPath).catch(() => null);
  if (!stat) {
    return {
      ok: false,
      message: `The save dialog closed, but I could not verify that **${target.filename}** was written. I stopped before reporting the Photoshop export as complete.`,
      warnings: ['save output verification unavailable'],
      data: { kind: 'desktop_save_output_unverified', outputPath: cleanPath, filename: target.filename },
    };
  }
  if (!stat.ok) {
    return {
      ok: false,
      message: `The save dialog closed, but I could not verify **${target.filename}**: ${stat.error || stat.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_file_stat failed with ${stat.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_output_stat_failed', outputPath: cleanPath, filename: target.filename, errorCode: stat.errorCode },
    };
  }
  if (!stat.data?.exists || stat.data.kind !== 'file') {
    return {
      ok: false,
      message: `The save dialog closed, but **${target.filename}** was not found at **${cleanPath}**. I stopped before reporting the Photoshop export as complete.`,
      warnings: ['save output file missing after export'],
      data: {
        kind: 'desktop_save_output_missing',
        outputPath: cleanPath,
        filename: target.filename,
        exists: stat.data?.exists ?? false,
        fileKind: stat.data?.kind ?? null,
      },
    };
  }
  return {
    ok: true,
    message: `Verified **${target.filename}** exists${target.folderPath ? ` at **${target.folderPath}**` : ''}.`,
    warnings: [],
    data: {
      kind: 'desktop_save_output_verified',
      outputPath: cleanPath,
      filename: target.filename,
      filePath: stat.data.path,
      sizeBytes: stat.data.size,
      modifiedAt: stat.data.modifiedAt,
    },
  };
}

export const __computerAppAdapterTestables = {
  treeLooksLikeSaveExtensionMismatchDialog,
  findPreferredSaveExtensionMismatchButton,
  normalizeFileExtension,
};

async function observeBeforeCoordinateAction(points: Array<{ x: number; y: number }>): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  const screen = await bridgeGetScreenSize();
  if (!screen.ok || !screen.data) {
    return { ok: false, message: `Could not verify screen size before coordinate action: ${screen.error || screen.errorCode || 'unknown error'}.` };
  }
  const width = Number(screen.data.width || 0);
  const height = Number(screen.data.height || 0);
  const outOfBounds = points.find((point) => point.x < 0 || point.y < 0 || point.x >= width || point.y >= height);
  if (outOfBounds) {
    return { ok: false, message: `Coordinate (${outOfBounds.x}, ${outOfBounds.y}) is outside the primary screen bounds ${width}x${height}.` };
  }
  const screenshot = await bridgeTakeScreenshot();
  if (!screenshot.ok || !screenshot.data) {
    return { ok: false, message: `Could not capture a screenshot before coordinate action: ${screenshot.error || screenshot.errorCode || 'unknown error'}.` };
  }
  return {
    ok: true,
    note: `Preflight observed screen ${width}x${height} and captured a ${Math.round((screenshot.data.sizeBytes || 0) / 1024)} KB screenshot before the pointer action.`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(50, Math.min(30_000, Math.trunc(ms)))));
}

type DesktopSequenceContext = {
  expectedInDesignDocumentName?: string | null;
  expectedInDesignDocumentPath?: string | null;
  expectedPhotoshopDocumentName?: string | null;
  expectedPhotoshopDocumentPath?: string | null;
};

function basenameFromDesktopPath(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.split(/[\\/]/).filter(Boolean).pop() || null;
}

async function openFirstFileSearchMatch(intent: {
  query?: string;
  rootPath?: string;
  extensions?: string[];
  appQuery?: string;
}): Promise<ComputerAppAdapterResult> {
  const query = String(intent.query || '').trim();
  const rootPath = String(intent.rootPath || '~').trim() || '~';
  if (!query) {
    return {
      ok: false,
      message: 'File search open failed because no filename or search query was provided.',
      warnings: ['desktop_open_file_search_match missing query'],
      data: { kind: 'desktop_bridge_error', errorCode: 'invalid_input' },
    };
  }

  const isGoogleDriveSearch = isGoogleDriveRootPath(rootPath);
  const searchOptions: { maxResults: number; maxDepth: number; includeContent: boolean; extensions?: string[] } = {
    maxResults: isGoogleDriveSearch ? 12 : 8,
    maxDepth: isGoogleDriveSearch ? 12 : 8,
    includeContent: false,
  };
  if (Array.isArray(intent.extensions) && intent.extensions.length > 0) {
    searchOptions.extensions = intent.extensions;
  }

  const rootCandidates = buildFileSearchRootCandidates(rootPath);
  const attempts: Array<{ rootPath: string; ok: boolean; error?: string; errorCode?: string; matchCount?: number; truncated?: boolean }> = [];
  let lastSearch: Awaited<ReturnType<typeof bridgeSearchFiles>> | null = null;
  let sawSuccessfulSearch = false;
  for (const candidateRoot of rootCandidates) {
    const searched = await bridgeSearchFiles(candidateRoot, query, searchOptions);
    lastSearch = searched;
    attempts.push({
      rootPath: candidateRoot,
      ok: searched.ok,
      error: searched.error,
      errorCode: searched.errorCode,
      matchCount: searched.data?.matches?.length || 0,
      truncated: searched.data?.truncated,
    });
    if (!searched.ok) {
      if (searched.errorCode === 'file_access_not_granted' && sawSuccessfulSearch) continue;
      if (searched.errorCode && !/\bpath_not_found|not_found|invalid_input\b/i.test(searched.errorCode)) break;
      continue;
    }
    sawSuccessfulSearch = true;
    const matches = searched.data?.matches || [];
    if (matches.length === 0) continue;
    const queryLower = query.toLowerCase();
    const match = matches.find((item) => item.name.toLowerCase() === queryLower) || matches[0];
    const sourcePhrase = isGoogleDriveSearch
      ? (isLikelyGoogleDriveSearchRoot(candidateRoot) ? 'in Google Drive' : 'from the broadened local search')
      : '';
    let openPath = match.path;
    let savedDesktopPath: string | null = null;
    if (isGoogleDriveSearch) {
      const desktopPath = desktopCopyPathForDriveFile(match.name);
      const copied = await bridgeCopyFile(match.path, desktopPath, { overwrite: true });
      if (!copied.ok) {
        return {
          ok: false,
          message: `Found **${match.name}** ${sourcePhrase} at **${match.path}**, but could not save it to Desktop before opening: ${copied.error || copied.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_file_copy failed with ${copied.errorCode || 'unknown_error'}`],
          data: {
            kind: 'desktop_bridge_error',
            errorCode: copied.errorCode,
            originalPath: match.path,
            desktopPath,
            attempts,
          },
        };
      }
      savedDesktopPath = copied.data?.toPath || desktopPath;
      openPath = savedDesktopPath;
    }

    const opened = await bridgeOpenPath(openPath, intent.appQuery ? { appName: intent.appQuery } : undefined);
    if (!opened.ok) {
      return {
        ok: false,
        message: `Found **${match.name}**${savedDesktopPath ? ` and saved it to Desktop at **${savedDesktopPath}**` : ''}, but could not open it: ${opened.error || opened.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_open_path failed with ${opened.errorCode || 'unknown_error'}`],
        data: {
          kind: 'desktop_bridge_error',
          errorCode: opened.errorCode,
          originalPath: match.path,
          path: openPath,
          desktopPath: savedDesktopPath,
          attempts,
        },
      };
    }

    let modalResult: ComputerAppAdapterResult | null = null;
    if (intent.appQuery) {
      await bridgeWaitForApp(intent.appQuery, 12_000).catch(() => null);
      modalResult = await handleBlockingAppModals(intent.appQuery, {
        context: 'after_open_file_search_match',
        maxDialogs: 4,
      });
      if (modalResult && !modalResult.ok) return modalResult;
    }

    const recoveredRoot = candidateRoot !== rootCandidates[0];
    const googleDriveCopyMessage = savedDesktopPath
      ? `Found **${match.name}** ${sourcePhrase}, saved a Desktop copy at **${savedDesktopPath}**, and opened that copy.`
      : `Found and opened **${match.name}** from **${match.path}**.`;
    return {
      ok: true,
      message: `${recoveredRoot ? `The first search root had no match, so I broadened the search. ` : ''}${googleDriveCopyMessage}${modalResult ? ` ${modalResult.message}` : ''}`,
      warnings: [
        ...(searched.data?.truncated ? ['desktop_file_search truncated'] : []),
        ...(recoveredRoot ? [`desktop_file_search recovered via ${candidateRoot}`] : []),
        ...(savedDesktopPath ? ['desktop_google_drive_file_saved_to_desktop'] : []),
        ...(modalResult?.warnings || []),
      ],
      data: {
        kind: 'desktop_open_file_search_match',
        query,
        rootPath: searched.data?.rootPath || candidateRoot,
        path: opened.data?.path || openPath,
        originalPath: match.path,
        desktopPath: savedDesktopPath,
        savedToDesktop: Boolean(savedDesktopPath),
        matchCount: matches.length,
        app: intent.appQuery || null,
        attempts,
        recovery: recoveredRoot ? { strategy: 'broaden_file_search_root', rootPath: candidateRoot } : null,
        modalHandling: modalResult?.data || null,
      },
    };
  }

  const searched = lastSearch;
  if (searched && !searched.ok && !sawSuccessfulSearch) {
    return {
      ok: false,
      message: `Could not search **${rootPath}** for **${query}**: ${searched.error || searched.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_file_search failed with ${searched.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: searched.errorCode, rootPath, query, attempts },
    };
  }

  return {
    ok: false,
    message: `No local file matches for **${query}** under **${rootCandidates.join('**, **')}**.${isGoogleDriveSearch ? ' Make sure Google Drive for Desktop is running and the file is available offline or synced locally, then retry.' : ''}`,
    warnings: ['desktop_file_search no matches'],
    data: { kind: 'desktop_file_search', rootPath, query, matches: [], attempts },
  };
}

function isGoogleDriveRootPath(rootPath: string): boolean {
  return /^(?:google[_\s-]*drive|gdrive|my\s+drive)$/i.test(String(rootPath || '').trim());
}

function isLikelyGoogleDriveSearchRoot(rootPath: string): boolean {
  return /(?:CloudStorage|Google Drive|My Drive|~\/Drive|\/Drive\b)/i.test(String(rootPath || ''));
}

function desktopCopyPathForDriveFile(fileName: string): string {
  const safeName = String(fileName || 'Google Drive file')
    .replace(/[/:`$;|&><\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Google Drive file';
  return `~/Desktop/${safeName}`;
}

function buildFileSearchRootCandidates(rootPath: string): string[] {
  const normalized = String(rootPath || '~').trim() || '~';
  if (isGoogleDriveRootPath(normalized)) {
    return [
      '~/Library/CloudStorage',
      '~/Google Drive',
      '~/My Drive',
      '~/Drive',
      '~/Documents',
      '~',
    ];
  }
  const roots = normalized === '~'
    ? ['~/Desktop', '~/Documents', '~/Downloads', '~']
    : [normalized, '~/Desktop', '~/Documents', '~/Downloads', '~'];
  return Array.from(new Set(roots));
}

type DesktopSequenceStepRecord = {
  index: number;
  kind: string | null;
  command: string;
  ok: boolean;
  message: string;
  recovered?: boolean;
  recovery?: string;
};

function shouldCheckBlockingModalAfterStep(
  step: LocalComputerAwarenessIntent,
  nextStep?: LocalComputerAwarenessIntent,
): boolean {
  const appQuery = step.appQuery || nextStep?.appQuery;
  if (!appQuery) return false;
  const currentKind = step.kind || '';
  const nextKind = nextStep?.kind || '';
  return [
    'open_file_search_match',
    'open_path',
    'launch_app',
    'focus_app',
    'wait_for_app',
    'menu_click',
    'press_keys',
    'semantic_click',
    'indesign_find_change',
    'indesign_batch_find_change',
    'indesign_document_status',
    'indesign_text_inventory',
    'indesign_set_layer_state',
    'indesign_batch_update_text_layers',
    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
    'photoshop_layer_inventory',
    'photoshop_set_layer_state',
    'photoshop_update_text_layer',
    'photoshop_place_asset',
    'photoshop_export_proof',
  ].includes(currentKind) || [
    'menu_click',
    'semantic_click',
    'set_field_text',
    'type_text',
    'paste_text',
    'press_keys',
    'indesign_find_change',
    'indesign_batch_find_change',
    'indesign_document_status',
    'indesign_text_inventory',
    'indesign_set_layer_state',
    'indesign_batch_update_text_layers',
    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
    'photoshop_layer_inventory',
    'photoshop_set_layer_state',
    'photoshop_update_text_layer',
    'photoshop_place_asset',
    'photoshop_export_proof',
  ].includes(nextKind);
}

function formatInDesignStatusSummary(status: NonNullable<Awaited<ReturnType<typeof bridgeInDesignDocumentStatus>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!status.appRunning) {
    return {
      message: `${status.appName || 'InDesign'} is not currently running.`,
      warnings: ['indesign_document_status app not running'],
    };
  }
  if (status.documentCount < 1 || !status.activeDocumentName) {
    return {
      message: `${status.appName || 'InDesign'} is running, but there is no active document open.`,
      warnings: ['indesign_document_status no active document'],
    };
  }
  const issueCount = (status.missingLinks || 0) + (status.modifiedLinks || 0) + (status.missingFonts || 0);
  const lockNote = status.lockedLayers > 0 || status.hiddenLayers > 0
    ? ` ${status.lockedLayers} locked layer${status.lockedLayers === 1 ? '' : 's'} and ${status.hiddenLayers} hidden layer${status.hiddenLayers === 1 ? '' : 's'} detected.`
    : '';
  const issueNote = issueCount > 0
    ? ` Needs attention: ${status.missingLinks} missing link${status.missingLinks === 1 ? '' : 's'}, ${status.modifiedLinks} modified link${status.modifiedLinks === 1 ? '' : 's'}, ${status.missingFonts} missing font${status.missingFonts === 1 ? '' : 's'}.`
    : ' No missing fonts or link issues were detected.';
  const openDocs = status.documents.length > 1
    ? ` Open documents: ${status.documents.map((doc) => doc.name).join(', ')}.`
    : '';
  return {
    message: `InDesign status for **${status.activeDocumentName}**: ${status.pageCount} page${status.pageCount === 1 ? '' : 's'}, ${status.spreadCount} spread${status.spreadCount === 1 ? '' : 's'}, ${status.layerCount} layer${status.layerCount === 1 ? '' : 's'}, ${status.linkCount} link${status.linkCount === 1 ? '' : 's'}, ${status.fontCount} font${status.fontCount === 1 ? '' : 's'}. Document is ${status.activeDocumentModified ? 'modified' : 'not modified'} and ${status.activeDocumentSaved ? 'saved' : 'unsaved'}.${issueNote}${lockNote}${openDocs}`,
    warnings: [
      ...(issueCount > 0 ? ['indesign_document_status needs attention'] : []),
      ...(status.lockedLayers > 0 ? ['indesign_document_status locked layers'] : []),
      ...(status.hiddenLayers > 0 ? ['indesign_document_status hidden layers'] : []),
    ],
  };
}

function formatInDesignTextInventorySummary(inventory: NonNullable<Awaited<ReturnType<typeof bridgeInDesignTextInventory>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!inventory.appRunning) {
    return {
      message: `${inventory.appName || 'InDesign'} is not currently running.`,
      warnings: ['indesign_text_inventory app not running'],
    };
  }
  if (!inventory.documentName) {
    return {
      message: `${inventory.appName || 'InDesign'} is running, but there is no active document to inspect.`,
      warnings: ['indesign_text_inventory no active document'],
    };
  }
  const sampleFrames = inventory.frames.slice(0, 8).map((frame, index) => {
    const labelParts = [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || 'unnamed frame';
    const flags = [
      frame.overflows ? 'overset' : '',
      frame.locked ? 'locked' : '',
      frame.visible ? '' : 'hidden',
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const matchText = inventory.query && frame.matchCount > 0 ? ` [${frame.matchCount} match${frame.matchCount === 1 ? '' : 'es'}]` : '';
    const preview = frame.contentPreview ? `: ${frame.contentPreview}` : '';
    return `${index + 1}. ${labelParts}${suffix}${matchText}${preview}`;
  });
  const layerHint = inventory.layerNames.length > 0
    ? ` Layers include: ${inventory.layerNames.slice(0, 12).join(', ')}${inventory.layerNames.length > 12 ? ', ...' : ''}.`
    : '';
  const queryNote = inventory.query ? ` matching **${inventory.query}**` : '';
  const matchNote = inventory.query ? `, ${inventory.queryMatches} text occurrence${inventory.queryMatches === 1 ? '' : 's'}` : '';
  return {
    message: `InDesign text inventory for **${inventory.documentName}**${queryNote}: ${inventory.textFrameCount} text frame${inventory.textFrameCount === 1 ? '' : 's'}, ${inventory.matchedFrames} matching frame${inventory.matchedFrames === 1 ? '' : 's'}${matchNote}, ${inventory.oversetFrames} overset frame${inventory.oversetFrames === 1 ? '' : 's'}. ${sampleFrames.length > 0 ? `Top candidates:\n${sampleFrames.join('\n')}` : 'No text frame candidates were returned.'}${layerHint}`,
    warnings: [
      ...(inventory.oversetFrames > 0 ? ['indesign_text_inventory overset text'] : []),
      ...(inventory.lockedLayers > 0 ? ['indesign_text_inventory locked layers'] : []),
      ...(inventory.hiddenLayers > 0 ? ['indesign_text_inventory hidden layers'] : []),
      ...(inventory.error ? ['indesign_text_inventory reported error'] : []),
    ],
  };
}

function formatPhotoshopStatusSummary(status: NonNullable<Awaited<ReturnType<typeof bridgePhotoshopDocumentStatus>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!status.appRunning) {
    return {
      message: `${status.appName || 'Photoshop'} is not currently running.`,
      warnings: ['photoshop_document_status app not running'],
    };
  }
  if (status.documentCount < 1 || !status.activeDocumentName) {
    return {
      message: `${status.appName || 'Photoshop'} is running, but there is no active document open.`,
      warnings: ['photoshop_document_status no active document'],
    };
  }
  const issueNote = status.lockedLayers > 0 || status.hiddenLayers > 0
    ? ` ${status.lockedLayers} locked layer${status.lockedLayers === 1 ? '' : 's'} and ${status.hiddenLayers} hidden layer${status.hiddenLayers === 1 ? '' : 's'} detected.`
    : '';
  const selectionNote = status.selectionActive ? ' A selection is active.' : ' No active selection was detected.';
  const openDocs = status.documents.length > 1
    ? ` Open documents: ${status.documents.map((doc) => doc.name).join(', ')}.`
    : '';
  return {
    message: `Photoshop status for **${status.activeDocumentName}**: ${status.widthPx}x${status.heightPx}px at ${status.resolution || 0} ppi, ${status.layerCount} layer${status.layerCount === 1 ? '' : 's'}, ${status.textLayerCount} text layer${status.textLayerCount === 1 ? '' : 's'}, ${status.smartObjectCount} smart object${status.smartObjectCount === 1 ? '' : 's'}, ${status.adjustmentLayerCount} adjustment layer${status.adjustmentLayerCount === 1 ? '' : 's'}. Document is ${status.activeDocumentModified ? 'modified' : 'not modified'} and ${status.activeDocumentSaved ? 'saved' : 'unsaved'}.${selectionNote}${issueNote}${openDocs}`,
    warnings: [
      ...(status.lockedLayers > 0 ? ['photoshop_document_status locked layers'] : []),
      ...(status.hiddenLayers > 0 ? ['photoshop_document_status hidden layers'] : []),
    ],
  };
}

function formatPhotoshopLayerInventorySummary(inventory: NonNullable<Awaited<ReturnType<typeof bridgePhotoshopLayerInventory>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!inventory.appRunning) {
    return {
      message: `${inventory.appName || 'Photoshop'} is not currently running.`,
      warnings: ['photoshop_layer_inventory app not running'],
    };
  }
  if (!inventory.documentName) {
    return {
      message: `${inventory.appName || 'Photoshop'} is running, but there is no active document to inspect.`,
      warnings: ['photoshop_layer_inventory no active document'],
    };
  }
  const sampleLayers = inventory.layers.slice(0, 10).map((layer, index) => {
    const flags = [
      layer.visible ? '' : 'hidden',
      layer.locked ? 'locked' : '',
      layer.hasMask ? 'mask' : '',
      layer.kind || layer.type || '',
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const preview = layer.textPreview ? `: ${layer.textPreview}` : '';
    return `${index + 1}. ${layer.path || layer.name || 'unnamed layer'}${suffix}${preview}`;
  });
  const queryNote = inventory.query ? ` matching **${inventory.query}**` : '';
  return {
    message: `Photoshop layer inventory for **${inventory.documentName}**${queryNote}: ${inventory.layerCount} layer${inventory.layerCount === 1 ? '' : 's'}, ${inventory.matchedLayers} candidate${inventory.matchedLayers === 1 ? '' : 's'}, ${inventory.textLayerCount} text layer${inventory.textLayerCount === 1 ? '' : 's'}, ${inventory.smartObjectCount} smart object${inventory.smartObjectCount === 1 ? '' : 's'}, ${inventory.maskLayerCount} masked layer${inventory.maskLayerCount === 1 ? '' : 's'}. ${sampleLayers.length > 0 ? `Top layers:\n${sampleLayers.join('\n')}` : 'No layer candidates were returned.'}`,
    warnings: [
      ...(inventory.lockedLayers > 0 ? ['photoshop_layer_inventory locked layers'] : []),
      ...(inventory.hiddenLayers > 0 ? ['photoshop_layer_inventory hidden layers'] : []),
      ...(inventory.error ? ['photoshop_layer_inventory reported error'] : []),
    ],
  };
}

type InDesignRecoveryAttempt = {
  command: string;
  kind: string | null;
  ok: boolean;
  message: string;
};

type InDesignRecoveryOutcome = {
  result: ComputerAppAdapterResult;
  attempts: InDesignRecoveryAttempt[];
  strategy: string;
};

type InDesignRecoveryMemoryRow = {
  signature: string;
  recovery: string;
  at?: string;
};

const INDESIGN_RECOVERY_MEMORY_KEY = 'uc_indesign_recovery_memory_v1';

function rememberInDesignRecovery(signature: string, recovery: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = JSON.parse(localStorage.getItem(INDESIGN_RECOVERY_MEMORY_KEY) || '[]');
    const rows = Array.isArray(existing) ? existing : [];
    rows.unshift({ signature, recovery, at: new Date().toISOString() });
    localStorage.setItem(INDESIGN_RECOVERY_MEMORY_KEY, JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* best-effort local recovery memory */
  }
}

function readInDesignRecoveryMemory(signature: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const existing = JSON.parse(localStorage.getItem(INDESIGN_RECOVERY_MEMORY_KEY) || '[]');
    if (!Array.isArray(existing)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of existing as InDesignRecoveryMemoryRow[]) {
      if (row?.signature !== signature || !row.recovery || seen.has(row.recovery)) continue;
      seen.add(row.recovery);
      out.push(row.recovery);
    }
    return out.slice(0, 5);
  } catch {
    return [];
  }
}

function getInDesignRecoverySignature(step: LocalComputerAwarenessIntent): string {
  return `${step.kind}:${step.appQuery || 'InDesign'}:${step.targetLabel || step.menuPath?.join(' > ') || step.combo || step.reason}`;
}

function prioritizeInDesignRecoveryCandidates(
  signature: string,
  candidates: LocalComputerAwarenessIntent[],
): LocalComputerAwarenessIntent[] {
  const remembered = readInDesignRecoveryMemory(signature);
  if (remembered.length === 0) return candidates;
  return [...candidates].sort((a, b) => {
    const aStrategy = remembered.findIndex((strategy) => strategy === `fallback:${renderLocalComputerAwarenessIntent(a)}`);
    const bStrategy = remembered.findIndex((strategy) => strategy === `fallback:${renderLocalComputerAwarenessIntent(b)}`);
    const aRank = aStrategy === -1 ? Number.MAX_SAFE_INTEGER : aStrategy;
    const bRank = bStrategy === -1 ? Number.MAX_SAFE_INTEGER : bStrategy;
    return aRank - bRank;
  });
}

async function executeLocalDesktopSequenceStep(
  step: LocalComputerAwarenessIntent,
  command: string,
  context: DesktopSequenceContext = {},
): Promise<ComputerAppAdapterResult> {
  if (step.kind === 'wait') {
    await sleep(step.durationMs || 1000);
    return {
      ok: true,
      message: `Waited ${Math.round((step.durationMs || 1000) / 100) / 10} seconds.`,
      warnings: [],
      data: { kind: 'desktop_wait', durationMs: step.durationMs || 1000 },
    };
  }
  if (isSaveDialogFilenameIntent(step)) {
    return setSaveDialogFilename(step.text || '', step.appQuery);
  }
  if (isSaveDialogOutputPathIntent(step)) {
    return setSaveDialogOutputPath(step.text || '', step.appQuery);
  }
  if (isSaveForWebSaveButtonIntent(step)) {
    return clickSaveForWebSaveButton(step.appQuery, normalizeSaveForWebTargetFormat(step.format || step.outputPath || step.text || null));
  }
  if (step.kind === 'open_file_search_match') {
    return openFirstFileSearchMatch(step);
  }
  if (step.kind === 'photoshop_document_status') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_document_status',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const status = await bridgePhotoshopDocumentStatus({
      appName: step.appQuery || 'Photoshop',
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!status.ok || !status.data) {
      const staleHint = status.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop status endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect Photoshop document status: ${status.error || status.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_document_status failed with ${status.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: status.errorCode },
      };
    }
    const summary = formatPhotoshopStatusSummary(status.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_photoshop_document_status',
        ...status.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_layer_inventory') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_layer_inventory',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const inventory = await bridgePhotoshopLayerInventory({
      appName: step.appQuery || 'Photoshop',
      query: step.query || undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
      maxItems: 40,
    });
    if (!inventory.ok || !inventory.data) {
      const staleHint = inventory.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop layer inventory endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect Photoshop layers: ${inventory.error || inventory.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_layer_inventory failed with ${inventory.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: inventory.errorCode },
      };
    }
    const summary = formatPhotoshopLayerInventorySummary(inventory.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_photoshop_layer_inventory',
        ...inventory.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_set_layer_state') {
    const layerName = String(step.targetLabel || '').trim();
    const action = step.layerStateAction;
    if (!layerName || !action) {
      return {
        ok: false,
        message: 'No target Photoshop layer name or layer-state action was provided.',
        warnings: ['photoshop_set_layer_state missing layerName or action'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_set_layer_state',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgePhotoshopSetLayerState({
      appName: step.appQuery || 'Photoshop',
      layerName,
      action,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop layer-state endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop layer-state update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_set_layer_state failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName, action },
      };
    }
    if (!updated.data.appRunning) {
      return {
        ok: false,
        message: `${updated.data.appName || 'Photoshop'} is not currently running.`,
        warnings: ['photoshop_set_layer_state app not running'],
        data: {
          kind: 'desktop_photoshop_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    if (updated.data.error || updated.data.matchedLayers !== 1) {
      const matchHint = updated.data.matchedLayers > 1
        ? `${updated.data.matchedLayers} layers matched; provide an exact layer name or full group path.`
        : updated.data.error || 'No matching layer was changed.';
      return {
        ok: false,
        message: `Photoshop did not change layer **${layerName}**: ${matchHint}`,
        warnings: ['photoshop_set_layer_state not applied'],
        data: {
          kind: 'desktop_photoshop_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    const stateText = action === 'show' || action === 'hide'
      ? `visible=${updated.data.afterVisible}`
      : `locked=${updated.data.afterLocked}`;
    return {
      ok: true,
      message: `${updated.data.changedLayers > 0 ? 'Changed' : 'Confirmed'} Photoshop layer **${updated.data.layerName}** is ${action}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''} (${stateText}).`,
      warnings: updated.data.changedLayers > 0 ? [] : ['photoshop_set_layer_state already in requested state'],
      data: {
        kind: 'desktop_photoshop_set_layer_state',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_update_text_layer') {
    const layerName = String(step.targetLabel || '').trim();
    const replacementText = String(step.text || '');
    if (!layerName) {
      return {
        ok: false,
        message: 'No target Photoshop text layer was provided.',
        warnings: ['photoshop_update_text_layer missing layerName'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_update_text_layer',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgePhotoshopUpdateTextLayer({
      appName: step.appQuery || 'Photoshop',
      layerName,
      replacementText,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop text-layer update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_update_text_layer failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName },
      };
    }
    const layerList = updated.data.layerNames.length > 0 ? ` Matching layers: ${updated.data.layerNames.map((name) => `**${name}**`).join(', ')}.` : '';
    const alreadyApplied = updated.data.updatedLayers < 1 && updated.data.replacementMatches > 0;
    return {
      ok: updated.data.updatedLayers > 0 || alreadyApplied,
      message: updated.data.updatedLayers > 0
        ? `Updated ${updated.data.updatedLayers} Photoshop text layer${updated.data.updatedLayers === 1 ? '' : 's'} for **${layerName}**${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}.${layerList}`
        : alreadyApplied
          ? `No Photoshop text layer needed a change: **${layerName}** already contains the requested text.${layerList}`
          : `No editable Photoshop text layer matched **${layerName}**. Checked ${updated.data.matchedLayers} matching layer${updated.data.matchedLayers === 1 ? '' : 's'}.${layerList}`,
      warnings: [
        ...(updated.data.updatedLayers > 0 || alreadyApplied ? [] : ['photoshop_update_text_layer no layers updated']),
      ],
      data: {
        kind: 'desktop_photoshop_update_text_layer',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_place_asset') {
    const assetPath = String(step.assetPath || step.path || '').trim();
    if (!assetPath) {
      return {
        ok: false,
        message: 'No asset path was provided for the Photoshop placement.',
        warnings: ['photoshop_place_asset missing assetPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_place_asset',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const placed = await bridgePhotoshopPlaceAsset({
      appName: step.appQuery || 'Photoshop',
      assetPath,
      layerName: step.targetLabel || undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!placed.ok || !placed.data) {
      const staleHint = placed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop place-asset endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop asset placement failed: ${placed.error || placed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_place_asset failed with ${placed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: placed.errorCode, assetPath },
      };
    }
    return {
      ok: !placed.data.error,
      message: placed.data.error
        ? `Photoshop could not place **${assetPath}**: ${placed.data.error}`
        : `Placed **${assetPath}** in Photoshop${placed.data.documentName ? ` document **${placed.data.documentName}**` : ''}${placed.data.placedLayerName ? ` as layer **${placed.data.placedLayerName}**` : ''}.`,
      warnings: placed.data.error ? ['photoshop_place_asset reported error'] : [],
      data: {
        kind: 'desktop_photoshop_place_asset',
        ...placed.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_export_proof') {
    const outputPath = String(step.outputPath || step.path || '').trim();
    if (!outputPath) {
      return {
        ok: false,
        message: 'No output path was provided for the Photoshop proof export.',
        warnings: ['photoshop_export_proof missing outputPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_export_proof',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const exported = await bridgePhotoshopExportProof({
      appName: step.appQuery || 'Photoshop',
      outputPath,
      format: step.format === 'jpg' || step.format === 'jpeg' || step.format === 'png' ? step.format : undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!exported.ok || !exported.data) {
      if (exported.errorCode === 'stale_bridge') {
        const fallback = await runPhotoshopSaveForWebExportFallback(outputPath, step.appQuery || 'Photoshop');
        return {
          ...fallback,
          message: fallback.ok
            ? `${fallback.message} This avoided the stale /desktop/photoshop_export_proof bridge endpoint.`
            : `${fallback.message} Original proof export error: ${exported.error || exported.errorCode || 'unknown bridge error'}.`,
          warnings: [
            `desktop_photoshop_export_proof failed with ${exported.errorCode}`,
            ...fallback.warnings,
          ],
          data: {
            ...(fallback.data || {}),
            originalErrorCode: exported.errorCode,
            originalError: exported.error || null,
          },
        };
      }
      return {
        ok: false,
        message: `Photoshop proof export failed: ${exported.error || exported.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_photoshop_export_proof failed with ${exported.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: exported.errorCode, outputPath },
      };
    }
    return {
      ok: exported.data.fileExists && !exported.data.error,
      message: exported.data.fileExists
        ? `Exported Photoshop proof to **${exported.data.outputPath}** (${Math.round((exported.data.sizeBytes || 0) / 1024)} KB, ${exported.data.format}).`
        : `Photoshop proof export did not produce **${exported.data.outputPath}**.${exported.data.error ? ` ${exported.data.error}` : ''}`,
      warnings: [
        ...(exported.data.fileExists ? [] : ['photoshop_export_proof missing output file']),
        ...(exported.data.error ? ['photoshop_export_proof reported error'] : []),
      ],
      data: {
        kind: 'desktop_photoshop_export_proof',
        ...exported.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_export_proof') {
    const outputPath = String(step.outputPath || step.path || '').trim();
    if (!outputPath) {
      return {
        ok: false,
        message: 'No output path was provided for the InDesign proof export.',
        warnings: ['indesign_export_proof missing outputPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_export_proof',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const exported = await bridgeInDesignExportProof({
      appName: step.appQuery || 'InDesign',
      outputPath,
      format: 'pdf',
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!exported.ok || !exported.data) {
      const staleHint = exported.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign proof export endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign proof export failed: ${exported.error || exported.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_export_proof failed with ${exported.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: exported.errorCode, outputPath },
      };
    }
    return {
      ok: exported.data.fileExists && !exported.data.error,
      message: exported.data.fileExists
        ? `Exported InDesign proof PDF to **${exported.data.outputPath}** (${Math.round((exported.data.sizeBytes || 0) / 1024)} KB, ${exported.data.pageCount} page${exported.data.pageCount === 1 ? '' : 's'}).`
        : `InDesign proof export did not produce **${exported.data.outputPath}**.${exported.data.error ? ` ${exported.data.error}` : ''}`,
      warnings: [
        ...(exported.data.fileExists ? [] : ['indesign_export_proof missing output file']),
        ...(exported.data.error ? ['indesign_export_proof reported error'] : []),
      ],
      data: {
        kind: 'desktop_indesign_export_proof',
        ...exported.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_package_document') {
    const outputFolderPath = String(step.outputFolderPath || step.outputPath || step.path || '').trim();
    if (!outputFolderPath) {
      return {
        ok: false,
        message: 'No output folder was provided for the InDesign package.',
        warnings: ['indesign_package_document missing outputFolderPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_package_document',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const packaged = await bridgeInDesignPackageDocument({
      appName: step.appQuery || 'InDesign',
      outputFolderPath,
      includeIdml: step.includeIdml === true,
      includePdf: step.includePdf === true,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!packaged.ok || !packaged.data) {
      const staleHint = packaged.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign package endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign package failed: ${packaged.error || packaged.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_package_document failed with ${packaged.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: packaged.errorCode, outputFolderPath },
      };
    }
    return {
      ok: packaged.data.packageOk && !packaged.data.error,
      message: packaged.data.packageOk
        ? `Packaged InDesign document to **${packaged.data.outputFolderPath}** (${packaged.data.fileCount} files, ${Math.round((packaged.data.sizeBytes || 0) / 1024)} KB).`
        : `InDesign did not complete packaging to **${packaged.data.outputFolderPath}**.${packaged.data.error ? ` ${packaged.data.error}` : ''}`,
      warnings: [
        ...(packaged.data.packageOk ? [] : ['indesign_package_document packageForPrint failed']),
        ...(packaged.data.error ? ['indesign_package_document reported error'] : []),
        ...(packaged.data.missingLinksBefore > 0 ? ['indesign_package_document missing links before package'] : []),
        ...(packaged.data.modifiedLinksBefore > 0 ? ['indesign_package_document modified links before package'] : []),
        ...(packaged.data.missingFontsBefore > 0 ? ['indesign_package_document missing fonts before package'] : []),
      ],
      data: {
        kind: 'desktop_indesign_package_document',
        ...packaged.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_relink_asset') {
    const assetPath = String(step.assetPath || step.path || '').trim();
    if (!assetPath) {
      return {
        ok: false,
        message: 'No replacement asset path was provided for the InDesign relink.',
        warnings: ['indesign_relink_asset missing assetPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_relink_asset',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const relinked = await bridgeInDesignRelinkAsset({
      appName: step.appQuery || 'InDesign',
      assetPath,
      linkQuery: step.linkQuery || step.targetLabel || undefined,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!relinked.ok || !relinked.data) {
      const staleHint = relinked.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign relink endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign asset relink failed: ${relinked.error || relinked.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_relink_asset failed with ${relinked.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: relinked.errorCode, assetPath },
      };
    }
    const linkList = relinked.data.linkNames.length > 0 ? ` Links: ${relinked.data.linkNames.map((name) => `**${name}**`).join(', ')}.` : '';
    return {
      ok: relinked.data.relinkedLinks > 0 && !relinked.data.error,
      message: relinked.data.relinkedLinks > 0
        ? `Relinked ${relinked.data.relinkedLinks} InDesign asset${relinked.data.relinkedLinks === 1 ? '' : 's'} to **${relinked.data.assetPath}**${relinked.data.documentName ? ` in **${relinked.data.documentName}**` : ''}.${linkList}`
        : `InDesign did not relink an asset to **${relinked.data.assetPath}**.${relinked.data.error ? ` ${relinked.data.error}` : ''}`,
      warnings: [
        ...(relinked.data.relinkedLinks > 0 ? [] : ['indesign_relink_asset no links relinked']),
        ...(relinked.data.error ? ['indesign_relink_asset reported error'] : []),
        ...(relinked.data.missingAfter > 0 ? ['indesign_relink_asset remaining missing or modified links'] : []),
      ],
      data: {
        kind: 'desktop_indesign_relink_asset',
        ...relinked.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_document_status') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_document_status',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const status = await bridgeInDesignDocumentStatus({
      appName: step.appQuery || 'InDesign',
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!status.ok || !status.data) {
      const staleHint = status.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign status endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect InDesign document status: ${status.error || status.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_document_status failed with ${status.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: status.errorCode },
      };
    }
    const summary = formatInDesignStatusSummary(status.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_indesign_document_status',
        ...status.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_text_inventory') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_text_inventory',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const inventory = await bridgeInDesignTextInventory({
      appName: step.appQuery || 'InDesign',
      query: step.query || undefined,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
      maxItems: 30,
    });
    if (!inventory.ok || !inventory.data) {
      const staleHint = inventory.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign text inventory endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect InDesign text frames: ${inventory.error || inventory.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_text_inventory failed with ${inventory.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: inventory.errorCode },
      };
    }
    const summary = formatInDesignTextInventorySummary(inventory.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_indesign_text_inventory',
        ...inventory.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_set_layer_state') {
    const layerName = String(step.targetLabel || '').trim();
    const action = step.layerStateAction;
    if (!layerName || !action) {
      return {
        ok: false,
        message: 'No target InDesign layer name or layer-state action was provided.',
        warnings: ['indesign_set_layer_state missing layerName or action'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_set_layer_state',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignSetLayerState({
      appName: step.appQuery || 'InDesign',
      layerName,
      action,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign layer-state endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign layer-state update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_set_layer_state failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName, action },
      };
    }
    if (updated.data.error || updated.data.matchedLayers !== 1) {
      const matchHint = updated.data.matchedLayers > 1
        ? `${updated.data.matchedLayers} layers matched; provide an exact layer name.`
        : updated.data.error || 'No matching layer was changed.';
      return {
        ok: false,
        message: `InDesign did not change layer **${layerName}**: ${matchHint}`,
        warnings: ['indesign_set_layer_state not applied'],
        data: {
          kind: 'desktop_indesign_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    const stateText = action === 'show' || action === 'hide'
      ? `visible=${updated.data.afterVisible}`
      : `locked=${updated.data.afterLocked}`;
    return {
      ok: true,
      message: `${updated.data.changedLayers > 0 ? 'Changed' : 'Confirmed'} InDesign layer **${updated.data.layerName}** is ${action}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''} (${stateText}).`,
      warnings: updated.data.changedLayers > 0 ? [] : ['indesign_set_layer_state already in requested state'],
      data: {
        kind: 'desktop_indesign_set_layer_state',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_batch_update_text_layers') {
    const updates = Array.isArray(step.fieldUpdates)
      ? step.fieldUpdates.map((update) => ({
          fieldName: String(update.fieldName || '').trim(),
          replacementText: String(update.replacementText ?? ''),
        })).filter((update) => update.fieldName)
      : [];
    if (updates.length < 1) {
      return {
        ok: false,
        message: 'No InDesign text fields were provided for the batch update.',
        warnings: ['indesign_batch_update_text_layers missing updates'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_batch_update_text_layers',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignBatchUpdateTextLayers({
      appName: step.appQuery || 'InDesign',
      updates,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign batch text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign batch text-layer update failed: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_batch_update_text_layers failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, updates },
      };
    }
    const rows = updated.data.results.map((result, index) => {
      const layerText = result.layerNames.length > 0 ? ` on ${result.layerNames.join(', ')}` : '';
      const status = result.updatedFrames > 0
        ? `updated ${result.updatedFrames}${layerText}`
        : result.matchedFrames > 0 && result.replacementMatches > 0
          ? 'already applied'
          : result.matchedFrames > 0
            ? 'matched but not updated'
            : 'not found';
      return `${index + 1}. **${result.fieldName}**: ${status}`;
    });
    const failures = updated.data.results.filter((result) => result.matchedFrames < 1 || (result.updatedFrames < 1 && result.replacementMatches < 1));
    return {
      ok: failures.length === 0,
      message: `Batch InDesign text-layer update completed ${updated.data.results.length} field${updated.data.results.length === 1 ? '' : 's'}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}. Total updated frames: ${updated.data.updatedFrames}.\n${rows.join('\n')}`,
      warnings: [
        ...(failures.length > 0 ? ['indesign_batch_update_text_layers incomplete fields'] : []),
        ...(updated.data.unlockedCount > 0 ? ['indesign_batch_update_text_layers used lock-safe update'] : []),
      ],
      data: {
        kind: 'desktop_indesign_batch_update_text_layers',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_update_text_layer') {
    const fieldName = String(step.targetLabel || '').trim();
    const replacementText = String(step.text || '');
    if (!fieldName) {
      return {
        ok: false,
        message: 'No target InDesign text field or layer was provided.',
        warnings: ['indesign_update_text_layer missing fieldName'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_update_text_layer',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignUpdateTextLayer({
      appName: step.appQuery || 'InDesign',
      fieldName,
      replacementText,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign text-layer update failed for **${fieldName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_update_text_layer failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, fieldName },
      };
    }
    const count = updated.data.updatedFrames;
    const inventory = count < 1
      ? await bridgeInDesignTextInventory({
          appName: step.appQuery || 'InDesign',
          query: fieldName,
          expectedDocumentName: context.expectedInDesignDocumentName || undefined,
          sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
          maxItems: 10,
        }).catch(() => null)
      : null;
    const inventoryHint = inventory?.ok && inventory.data?.frames.length
      ? ` Candidate frames found: ${inventory.data.frames.slice(0, 5).map((frame) => [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || frame.contentPreview.slice(0, 60) || 'unnamed frame').join('; ')}.`
      : inventory?.ok && inventory.data
        ? ` I also inspected ${inventory.data.textFrameCount} text frame${inventory.data.textFrameCount === 1 ? '' : 's'} and found no candidates matching **${fieldName}**.`
        : '';
    const layerList = updated.data.layerNames.length > 0 ? ` on ${updated.data.layerNames.map((name) => `**${name}**`).join(', ')}` : '';
    return {
      ok: count > 0,
      message: count > 0
        ? `Updated ${count} InDesign text frame${count === 1 ? '' : 's'} for **${fieldName}**${layerList}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}.`
        : `No editable InDesign text frame matched **${fieldName}**. I checked ${updated.data.matchedLayers} matching layer${updated.data.matchedLayers === 1 ? '' : 's'} and ${updated.data.matchedFrames} text frame${updated.data.matchedFrames === 1 ? '' : 's'}.${inventoryHint}`,
      warnings: [
        ...(count > 0 ? [] : ['indesign_update_text_layer no frames updated']),
        ...(inventory?.ok && inventory.data ? ['indesign_update_text_layer inspected text inventory'] : []),
        ...(updated.data.unlockedCount > 0 ? ['indesign_update_text_layer used lock-safe update'] : []),
      ],
      data: {
        kind: 'desktop_indesign_update_text_layer',
        ...updated.data,
        inventory: inventory?.ok ? inventory.data : null,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_find_change') {
    const findText = String(step.query || '').trim();
    const changeText = String(step.text || '');
    if (!findText) {
      return {
        ok: false,
        message: 'No Find text was provided for the InDesign Find/Change operation.',
        warnings: ['indesign_find_change missing findText'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_find_change',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const changed = await bridgeInDesignFindChange({
      appName: step.appQuery || 'InDesign',
      findText,
      changeText,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!changed.ok) {
      const staleHint = changed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign Find/Change endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign Find/Change failed for **${findText} → ${changeText}**: ${changed.error || changed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_find_change failed with ${changed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: changed.errorCode, findText, changeText },
      };
    }
    const count = changed.data?.changed ?? 0;
    const matched = changed.data?.matched ?? 0;
    const remaining = changed.data?.remaining ?? 0;
    const replacementMatches = changed.data?.replacementMatches ?? 0;
    const unlockedCount = changed.data?.unlockedCount ?? 0;
    const usedUnlockRecovery = changed.data?.method === 'find-change-unlocked';
    const alreadyApplied = count < 1 && matched < 1 && remaining < 1 && replacementMatches > 0;
    const diagnosticInventory = count < 1 || remaining > 0
      ? await bridgeInDesignTextInventory({
          appName: step.appQuery || 'InDesign',
          query: findText,
          expectedDocumentName: context.expectedInDesignDocumentName || undefined,
          sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
          maxItems: 10,
        }).catch(() => null)
      : null;
    const diagnosticHint = diagnosticInventory?.ok && diagnosticInventory.data
      ? diagnosticInventory.data.queryMatches > 0
        ? ` Inventory still sees ${diagnosticInventory.data.queryMatches} occurrence${diagnosticInventory.data.queryMatches === 1 ? '' : 's'} of **${findText}** across ${diagnosticInventory.data.matchedFrames} text frame${diagnosticInventory.data.matchedFrames === 1 ? '' : 's'}. Candidate frames: ${diagnosticInventory.data.frames.slice(0, 5).map((frame) => [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || frame.contentPreview.slice(0, 60) || 'unnamed frame').join('; ')}.`
        : ` Inventory checked ${diagnosticInventory.data.textFrameCount} text frame${diagnosticInventory.data.textFrameCount === 1 ? '' : 's'} and found no remaining text occurrences of **${findText}**.`
      : '';
    const recoveryNote = usedUnlockRecovery
      ? ` Used lock-safe recovery and restored ${unlockedCount} locked object${unlockedCount === 1 ? '' : 's'}.`
      : '';
    const verificationNote = count > 0
      ? remaining > 0
        ? ` Verification found ${remaining} original match${remaining === 1 ? '' : 'es'} still present.${diagnosticHint}`
        : ' Verified no original matches remain.'
      : '';
    const warnings = count > 0
      ? [
          ...(usedUnlockRecovery ? ['indesign_find_change used lock-safe recovery'] : []),
          ...(remaining > 0 ? ['indesign_find_change partial verification'] : []),
          ...(diagnosticInventory?.ok && diagnosticInventory.data ? ['indesign_find_change inspected text inventory'] : []),
        ]
      : [
          alreadyApplied
            ? 'indesign_find_change already applied'
            : matched > 0
              ? 'indesign_find_change matches not changed'
              : 'indesign_find_change no matches changed',
          ...(diagnosticInventory?.ok && diagnosticInventory.data ? ['indesign_find_change inspected text inventory'] : []),
        ];
    return {
      ok: true,
      message: count > 0
        ? `Changed ${count} InDesign text occurrence${count === 1 ? '' : 's'} from **${findText}** to **${changeText}**${changed.data?.documentName ? ` in **${changed.data.documentName}**` : ''}.${recoveryNote}${verificationNote}`
        : alreadyApplied
          ? `No original **${findText}** text remains, and **${changeText}** already exists in the target InDesign document. The requested change appears to already be applied.`
          : matched > 0
            ? `InDesign found ${matched} match${matched === 1 ? '' : 'es'} for **${findText}**, but none were changed. The text may be on a protected master item, unavailable plugin object, or otherwise locked beyond local bridge recovery.${diagnosticHint}`
            : `Ran InDesign Find/Change for **${findText} → ${changeText}**, but no matching text was changed.${diagnosticHint}`,
      warnings,
      data: {
        kind: 'desktop_indesign_find_change',
        app: changed.data?.appName || step.appQuery || 'InDesign',
        documentName: changed.data?.documentName || null,
        expectedDocumentName: changed.data?.expectedDocumentName || null,
        sourceDocumentPath: changed.data?.sourceDocumentPath || null,
        findText,
        changeText,
        matched,
        changed: count,
        remaining,
        replacementMatches,
        method: changed.data?.method || null,
        unlockedCount,
        lockedLayers: changed.data?.lockedLayers ?? 0,
        hiddenLayers: changed.data?.hiddenLayers ?? 0,
        lockedPageItems: changed.data?.lockedPageItems ?? 0,
        docWasModified: changed.data?.docWasModified === true,
        docModified: changed.data?.docModified === true,
        docSaved: changed.data?.docSaved === true,
        fallbackReason: changed.data?.fallbackReason || null,
        inventory: diagnosticInventory?.ok ? diagnosticInventory.data : null,
      },
    };
  }
  if (step.kind === 'indesign_batch_find_change') {
    const pairs = Array.isArray(step.replacements)
      ? step.replacements.map((pair) => ({
          findText: String(pair.findText || '').trim(),
          changeText: String(pair.changeText ?? ''),
        })).filter((pair) => pair.findText)
      : [];
    if (pairs.length < 1) {
      return {
        ok: false,
        message: 'No Find/Change pairs were provided for the InDesign batch operation.',
        warnings: ['indesign_batch_find_change missing pairs'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_batch_find_change',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const changed = await bridgeInDesignBatchFindChange({
      appName: step.appQuery || 'InDesign',
      pairs,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!changed.ok || !changed.data) {
      const staleHint = changed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign batch Find/Change endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign batch Find/Change failed: ${changed.error || changed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_batch_find_change failed with ${changed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: changed.errorCode, pairs },
      };
    }
    const rows = changed.data.results.map((result, index) => {
      const status = result.changed > 0
        ? `changed ${result.changed}`
        : result.remaining < 1 && result.replacementMatches > 0
          ? 'already applied'
          : result.matched > 0
            ? 'matched but not changed'
            : 'not found';
      const remaining = result.remaining > 0 ? `, ${result.remaining} remaining` : '';
      return `${index + 1}. **${result.findText}** -> **${result.changeText}**: ${status}${remaining}`;
    });
    const failures = changed.data.results.filter((result) => result.changed < 1 && !(result.remaining < 1 && result.replacementMatches > 0));
    return {
      ok: failures.length === 0,
      message: `Batch InDesign Find/Change completed ${changed.data.results.length} replacement${changed.data.results.length === 1 ? '' : 's'}${changed.data.documentName ? ` in **${changed.data.documentName}**` : ''}. Total changed: ${changed.data.changed}.\n${rows.join('\n')}`,
      warnings: [
        ...(failures.length > 0 ? ['indesign_batch_find_change incomplete replacements'] : []),
        ...(changed.data.remaining > 0 ? ['indesign_batch_find_change remaining source matches'] : []),
        ...(changed.data.unlockedCount > 0 ? ['indesign_batch_find_change used lock-safe recovery'] : []),
      ],
      data: {
        kind: 'desktop_indesign_batch_find_change',
        ...changed.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  return await executeLocalDesktopIntent(command, { sequenceMode: true }) || {
    ok: false,
    message: `Could not execute parsed step: ${command}`,
    warnings: ['desktop sequence step not executable'],
    data: { kind: 'desktop_sequence_step_unhandled' },
  };
}

async function recoverLocalDesktopSequenceStep(
  step: LocalComputerAwarenessIntent,
  failedResult: ComputerAppAdapterResult,
): Promise<InDesignRecoveryOutcome | null> {
  if (!isInDesignIntent(step)) return null;
  if (step.kind === 'indesign_find_change' || step.kind === 'indesign_batch_find_change' || step.kind === 'indesign_document_status' || step.kind === 'indesign_text_inventory' || step.kind === 'indesign_set_layer_state' || step.kind === 'indesign_batch_update_text_layers' || step.kind === 'indesign_update_text_layer' || step.kind === 'indesign_relink_asset' || step.kind === 'indesign_package_document' || step.kind === 'indesign_export_proof' || step.kind === 'photoshop_set_layer_state') return null;
  const errorCode = String(failedResult.data?.errorCode || '');
  if (errorCode === 'stale_bridge' || failedResult.warnings.some((warning) => /\bstale_bridge\b/.test(warning))) {
    return null;
  }
  const signature = getInDesignRecoverySignature(step);
  const candidates = prioritizeInDesignRecoveryCandidates(
    signature,
    buildInDesignRecoveryCandidatesForIntent(step),
  );
  if (candidates.length === 0) return null;

  const attempts: InDesignRecoveryAttempt[] = [];
  await bridgeFocusApp(step.appQuery || 'InDesign').catch(() => null);
  await sleep(350);

  if (step.kind === 'semantic_click' && step.targetLabel && /\b(disclaimer|legal|fine print|terms|offer|apr|finance|lease|payment|price|sale price|msrp|vehicle|dealer|cta|headline)\b/i.test(step.targetLabel)) {
    await bridgeClickMenu({ appName: step.appQuery || 'InDesign', menuPath: ['Window', 'Layers'] }).catch(() => null);
    await sleep(450);
  }

  for (const candidate of candidates) {
    const command = renderLocalComputerAwarenessIntent(candidate);
    const result = await executeLocalDesktopSequenceStep(candidate, command);
    attempts.push({ command, kind: candidate.kind, ok: result.ok, message: result.message });
    if (!result.ok) continue;
    const sameMenuPath = JSON.stringify(candidate.menuPath || null) === JSON.stringify(step.menuPath || null);
    const strategy = candidate.kind === step.kind && candidate.targetLabel === step.targetLabel && sameMenuPath
      ? 'focus_and_retry'
      : `fallback:${command}`;
    rememberInDesignRecovery(signature, strategy);
    return {
      result: {
        ...result,
        warnings: [
          `Recovered after: ${failedResult.message}`,
          ...result.warnings,
          `InDesign recovery strategy: ${strategy}`,
        ],
        data: {
          ...(result.data || {}),
          recovery: {
            strategy,
            failedMessage: failedResult.message,
            attempts,
            learned: true,
          },
        },
      },
      attempts,
      strategy,
    };
  }

  if (attempts.length > 0) {
    const suggestions = [
      'Make sure the target InDesign document is the active frontmost document.',
      'Open Window > Layers and verify the target layer/text frame is visible and unlocked.',
      'If this is a Find/Change task, open Edit > Find/Change once, then retry the chat command.',
    ];
    return {
      result: {
        ...failedResult,
        message: `${failedResult.message}\n\nI tried ${attempts.length} InDesign recovery path${attempts.length === 1 ? '' : 's'} and still could not complete that step. Try: ${suggestions.join(' ')}`,
        warnings: [
          ...failedResult.warnings,
          'InDesign recovery attempted but did not complete',
        ],
        data: {
          ...(failedResult.data || {}),
          recovery: {
            strategy: 'failed_recovery',
            failedMessage: failedResult.message,
            attempts,
            suggestions,
          },
        },
      },
      attempts,
      strategy: 'failed_recovery',
    };
  }

  return null;
}

function shouldPasteForTextEntry(text: string): boolean {
  return text.length > 160 || /[\r\n\t]/.test(text);
}

interface AutoChainResult {
  ok: boolean;
  steps: string[];
  error?: string;
  elapsedMs?: number;
}

// Common utterance → sequence patterns. Pure bridge calls, no model
// turns. Add entries here only when the sequence is stable + universal
// across users (not personalised).
//
// Phase 1c replaced the old `sleep(1200)` race with `waitForApp` —
// polls the running-app list until the named app appears before
// issuing the follow-up keystrokes. Means we start typing into the
// RIGHT app, not whichever app happened to be focused when `open -a`
// returned.
async function runAutoChain(appId: string): Promise<AutoChainResult> {
  const started = Date.now();
  const steps: string[] = [];
  try {
    if (appId === 'terminal-claude') {
      const waited = await bridgeWaitForApp('Terminal', 5_000);
      steps.push(waited.ok ? `wait for Terminal (${waited.data?.elapsedMs}ms)` : 'wait for Terminal timed out');
      const focus = await bridgeFocusApp('Terminal');
      steps.push(focus.ok ? 'focus Terminal' : `focus Terminal failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const type = await bridgeTypeText('claude');
      steps.push(type.ok ? 'type "claude"' : `type failed: ${type.error}`);
      if (!type.ok) return { ok: false, steps, error: type.error };
      const enter = await bridgePressKeys('Return');
      steps.push(enter.ok ? 'press Return' : `press Return failed: ${enter.error}`);
      if (!enter.ok) return { ok: false, steps, error: enter.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    if (appId === 'zoom') {
      // macOS bundle display name is `zoom.us`, not `Zoom` — same
      // reason the launch call needs resolveMacLaunchName().
      const zoomName = 'zoom.us';
      const waited = await bridgeWaitForApp(zoomName, 8_000);
      steps.push(waited.ok ? `wait for Zoom (${waited.data?.elapsedMs}ms)` : 'wait for Zoom timed out');
      const focus = await bridgeFocusApp(zoomName);
      steps.push(focus.ok ? 'focus Zoom' : `focus failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const press = await bridgePressKeys('Cmd+N');
      steps.push(press.ok ? 'press Cmd+N' : `keys failed: ${press.error}`);
      if (!press.ok) return { ok: false, steps, error: press.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    // No auto-chain — callers rely on the model to invoke desktop.*
    // tools for additional actions.
    return { ok: true, steps: ['no auto-chain'], elapsedMs: Date.now() - started };
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || 'auto-chain threw' };
  }
}

async function executeLocalDesktopIntent(
  task: string,
  options: { sequenceMode?: boolean } = {},
): Promise<ComputerAppAdapterResult | null> {
  const sequence = detectLocalComputerAwarenessIntentSequence(task);
  if (sequence.length > 1) {
    const needsBridge = sequence.some((step) => step.kind !== 'wait');
    if (needsBridge) {
      const bridgeAvailable = await isDesktopBridgeAvailable();
      if (!bridgeAvailable) {
        return {
          ok: false,
          message: 'Desktop bridge offline. Start `node scripts/claude-bridge.js`, pair it once, then retry the app action.',
          warnings: ['desktop bridge unavailable'],
          data: { kind: 'desktop_bridge_error', errorCode: 'bridge_offline' },
        };
      }
      await ensureDesktopBridgePaired().catch(() => null);
    }

	    const sequenceContext: DesktopSequenceContext = {};
	    const steps: DesktopSequenceStepRecord[] = [];
	    for (let index = 0; index < sequence.length; index += 1) {
	      const step = sequence[index];
	      const command = renderLocalComputerAwarenessIntent(step);
	      let result = await executeLocalDesktopSequenceStep(step, command, sequenceContext);
      let successRecorded = false;
      if (!result.ok) {
        const recovery = await recoverLocalDesktopSequenceStep(step, result);
        if (recovery?.result.ok) {
          steps.push({
            index: steps.length + 1,
            kind: step.kind,
            command,
            ok: false,
            message: `Initial failure before recovery: ${result.message}`,
          });
          result = recovery.result;
          steps.push({
            index: steps.length + 1,
            kind: step.kind,
            command: recovery.attempts.find((attempt) => attempt.ok)?.command || command,
            ok: true,
            message: `Recovered with ${recovery.strategy}: ${result.message}`,
            recovered: true,
            recovery: recovery.strategy,
          });
          successRecorded = true;
        } else if (recovery) {
          result = recovery.result;
        }
      }
      if (!result.ok) {
        steps.push({ index: steps.length + 1, kind: step.kind, command, ok: result.ok, message: result.message });
        return {
          ok: false,
          message: `Stopped at step ${index + 1}/${sequence.length}: ${result.message}`,
          warnings: ['desktop sequence stopped', ...result.warnings],
          data: { kind: 'desktop_action_sequence', steps },
        };
      }
      if (!successRecorded) {
        steps.push({ index: steps.length + 1, kind: step.kind, command, ok: result.ok, message: result.message });
      }
      if (
        result.ok
        && result.data?.kind === 'desktop_open_file_search_match'
        && /\bindesign\b/i.test(String(step.appQuery || sequence[index + 1]?.appQuery || ''))
      ) {
        const openedPath = String(result.data.path || result.data.desktopPath || result.data.originalPath || '').trim();
        sequenceContext.expectedInDesignDocumentPath = openedPath || null;
        sequenceContext.expectedInDesignDocumentName = basenameFromDesktopPath(openedPath);
      }
      if (
        result.ok
        && result.data?.kind === 'desktop_open_file_search_match'
        && /\bphotoshop\b/i.test(String(step.appQuery || sequence[index + 1]?.appQuery || ''))
      ) {
        const openedPath = String(result.data.path || result.data.desktopPath || result.data.originalPath || '').trim();
        sequenceContext.expectedPhotoshopDocumentPath = openedPath || null;
        sequenceContext.expectedPhotoshopDocumentName = basenameFromDesktopPath(openedPath);
      }
      const postSaveDialog = result.ok && step.kind === 'press_keys' && step.combo === 'Return' && (isSaveDialogFilenameIntent(sequence[index - 1] || {}) || isSaveDialogOutputPathIntent(sequence[index - 1] || {}))
        ? await maybeHandlePostSaveImageDialogs(step.appQuery, sequence[index - 1]?.text || '')
        : null;
      if (postSaveDialog) {
        steps.push({ index: steps.length + 1, kind: 'post_save_confirm', command: `confirm save dialogs for ${sequence[index - 1]?.text || 'image'}`, ok: postSaveDialog.ok, message: postSaveDialog.message });
        if (!postSaveDialog.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${postSaveDialog.message}`,
            warnings: ['desktop sequence stopped', ...postSaveDialog.warnings],
            data: { kind: 'desktop_action_sequence', steps },
          };
        }
      }
      const outputVerification = result.ok && step.kind === 'press_keys' && step.combo === 'Return' && (isSaveDialogFilenameIntent(sequence[index - 1] || {}) || isSaveDialogOutputPathIntent(sequence[index - 1] || {}))
        ? await verifySaveDialogOutputFile(sequence[index - 1]?.text || '')
        : null;
      if (outputVerification) {
        steps.push({ index: steps.length + 1, kind: 'output_verification', command: `verify saved output ${sequence[index - 1]?.text || 'image'}`, ok: outputVerification.ok, message: outputVerification.message });
        if (!outputVerification.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${outputVerification.message}`,
            warnings: ['desktop sequence stopped', ...outputVerification.warnings],
            data: { kind: 'desktop_action_sequence', steps },
          };
        }
      }
      const modalAppQuery = step.appQuery || sequence[index + 1]?.appQuery;
      const modalResult = shouldCheckBlockingModalAfterStep(step, sequence[index + 1])
        ? await handleBlockingAppModals(modalAppQuery, {
          context: `after_sequence_step:${step.kind || 'unknown'}`,
          task: command,
          maxDialogs: 4,
        })
        : null;
      if (modalResult) {
        steps.push({
          index: steps.length + 1,
          kind: 'modal_interrupt',
          command: `handle blocking dialog in ${modalAppQuery || 'frontmost app'}`,
          ok: modalResult.ok,
          message: modalResult.message,
          recovered: modalResult.ok,
          recovery: modalResult.ok ? 'blocking_modal_handler' : 'blocking_modal_failed',
        });
        if (!modalResult.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${modalResult.message}`,
            warnings: ['desktop sequence stopped', ...modalResult.warnings],
            data: { kind: 'desktop_action_sequence', steps },
          };
        }
      }
    }
    return {
      ok: true,
      message: `Completed ${steps.length} desktop app steps:\n${steps.map((step) => `${step.index}. ${step.message}`).join('\n')}`,
      warnings: [],
      data: { kind: 'desktop_action_sequence', steps },
    };
  }

  const intent = detectLocalComputerAwarenessIntent(task);
  if (!intent.route || !intent.kind) return null;
  const executableKinds = new Set([
    'launch_app',
    'focus_app',
    'open_url',
    'open_path',
    'open_file_search_match',
    'clipboard_write',
    'clipboard_clear',
    'screen_state',
    'a11y_tree',
    'window_manage',
    'semantic_click',
    'menu_click',
    'type_text',
    'paste_text',
	    'set_field_text',
	    'indesign_find_change',
	    'indesign_batch_find_change',
	    'indesign_document_status',
	    'indesign_text_inventory',
	    'indesign_set_layer_state',
	    'indesign_batch_update_text_layers',
	    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
	    'photoshop_layer_inventory',
	    'photoshop_set_layer_state',
	    'photoshop_update_text_layer',
	    'photoshop_place_asset',
	    'photoshop_export_proof',
	    'press_keys',
    'wait',
    'wait_for_app',
    'mouse_move',
    'mouse_click',
    'mouse_down',
    'mouse_up',
    'mouse_drag',
    'mouse_scroll',
  ]);
  if (!executableKinds.has(intent.kind)) return null;

  try {
    const bridgeAvailable = await isDesktopBridgeAvailable();
    if (!bridgeAvailable) {
      return {
        ok: false,
        message: 'Desktop bridge offline. Start `node scripts/claude-bridge.js`, pair it once, then retry the app action.',
        warnings: ['desktop bridge unavailable'],
        data: { kind: 'desktop_bridge_error', errorCode: 'bridge_offline' },
      };
    }
    await ensureDesktopBridgePaired().catch(() => null);

    if (
      intent.kind === 'indesign_document_status' ||
	      intent.kind === 'indesign_text_inventory' ||
	      intent.kind === 'indesign_set_layer_state' ||
	      intent.kind === 'indesign_batch_update_text_layers' ||
      intent.kind === 'indesign_update_text_layer' ||
      intent.kind === 'indesign_find_change' ||
      intent.kind === 'indesign_batch_find_change' ||
      intent.kind === 'indesign_relink_asset' ||
      intent.kind === 'indesign_package_document' ||
      intent.kind === 'indesign_export_proof' ||
      intent.kind === 'photoshop_document_status' ||
      intent.kind === 'photoshop_layer_inventory' ||
      intent.kind === 'photoshop_set_layer_state' ||
      intent.kind === 'photoshop_update_text_layer' ||
      intent.kind === 'photoshop_place_asset' ||
      intent.kind === 'photoshop_export_proof'
    ) {
      return executeLocalDesktopSequenceStep(intent, renderLocalComputerAwarenessIntent(intent), {});
    }

    if ((intent.kind === 'launch_app' || intent.kind === 'focus_app') && intent.appQuery) {
      const r = intent.kind === 'focus_app'
        ? await bridgeFocusApp(intent.appQuery)
        : await bridgeLaunchApp(intent.appQuery);
      if (!r.ok) {
        return {
          ok: false,
          message: `I could not ${intent.kind === 'focus_app' ? 'focus' : 'launch'} **${intent.appQuery}** through the local bridge: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_action failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, displayName: intent.appQuery },
        };
      }
      const displayName = r.data?.appName || intent.appQuery;
      return {
        ok: true,
        message: `${intent.kind === 'focus_app' ? 'Focused' : 'Launched'} **${displayName}** via the local bridge.`,
        warnings: [],
        data: {
          kind: intent.kind === 'focus_app' ? 'desktop_bridge_focus' : 'desktop_bridge_launch',
          displayName,
          requestedName: intent.appQuery,
          capability: 'desktop_action',
        },
      };
    }

    if (intent.kind === 'wait_for_app' && intent.appQuery) {
      const waited = await bridgeWaitForApp(intent.appQuery, intent.durationMs || 8_000);
      if (!waited.ok) {
        return {
          ok: false,
          message: `Timed out waiting for **${intent.appQuery}** to open: ${waited.error || waited.errorCode || 'not detected'}.`,
          warnings: [`desktop_wait_for_app failed with ${waited.errorCode || 'timeout'}`],
          data: { kind: 'desktop_bridge_error', errorCode: waited.errorCode, app: intent.appQuery },
        };
      }
      return {
        ok: true,
        message: `Detected **${waited.data?.appName || intent.appQuery}** after ${waited.data?.elapsedMs ?? 0}ms.`,
        warnings: [],
        data: { kind: 'desktop_wait_for_app', app: waited.data?.appName || intent.appQuery, elapsedMs: waited.data?.elapsedMs ?? 0 },
      };
    }

    if (intent.kind === 'open_url' && intent.url) {
      const r = await bridgeOpenUrl(intent.url);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not open **${intent.url}** through the local bridge: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_open_url failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, url: intent.url },
        };
      }
      return {
        ok: true,
        message: `Opened **${r.data?.url || intent.url}** in the default browser.`,
        warnings: [],
        data: { kind: 'desktop_open_url', url: r.data?.url || intent.url, scheme: r.data?.scheme || null },
      };
    }

    if (intent.kind === 'open_file_search_match') {
      return openFirstFileSearchMatch(intent);
    }

    if (intent.kind === 'open_path' && intent.path) {
      const r = await bridgeOpenPath(intent.path);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not open **${intent.path}** through the local bridge: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_open_path failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, path: intent.path },
        };
      }
      return {
        ok: true,
        message: `Opened **${r.data?.path || intent.path}** locally.`,
        warnings: [],
        data: { kind: 'desktop_open_path', path: r.data?.path || intent.path },
      };
    }

    if (intent.kind === 'clipboard_write' && typeof intent.text === 'string') {
      const r = await bridgeWriteClipboard(intent.text);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not write to the clipboard: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_clipboard_write failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: `Copied ${r.data?.chars ?? intent.text.length} characters to the clipboard.`,
        warnings: [],
        data: { kind: 'desktop_clipboard_write', chars: r.data?.chars ?? intent.text.length },
      };
    }

    if (intent.kind === 'clipboard_clear') {
      const r = await bridgeClearClipboard();
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not clear the clipboard: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_clipboard_clear failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: 'Cleared the clipboard.',
        warnings: [],
        data: { kind: 'desktop_clipboard_clear' },
      };
    }

    if (intent.kind === 'screen_state') {
      const shot = await bridgeTakeScreenshot();
      if (!shot.ok || !shot.data) {
        return {
          ok: false,
          message: `Could not capture a screenshot: ${shot.error || shot.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_screenshot failed with ${shot.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: shot.errorCode },
        };
      }
      return {
        ok: true,
        message: `Captured a desktop screenshot (${Math.round((shot.data.sizeBytes || 0) / 1024)} KB).`,
        warnings: [],
        data: { kind: 'desktop_screenshot', sizeBytes: shot.data.sizeBytes, mimeType: shot.data.mimeType },
      };
    }

    if (intent.kind === 'a11y_tree') {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 8, maxNodes: 250 });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      const controls = flattenA11yNodes(tree.data.tree)
        .filter((node) => node.label || node.value)
        .slice(0, 12)
        .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`);
      return {
        ok: true,
        message: `Read **${tree.data.app || intent.appQuery || 'the frontmost app'}** accessibility tree (${tree.data.budget_used || 0} nodes).${controls.length ? `\nTop controls:\n${controls.join('\n')}` : ''}`,
        warnings: [],
        data: { kind: 'desktop_a11y_tree', app: tree.data.app, pid: tree.data.pid, nodeCount: tree.data.budget_used || 0 },
      };
    }

    if (intent.kind === 'window_manage' && intent.windowAction) {
      const r = await bridgeManageWindow({
        action: intent.windowAction,
        appName: intent.appQuery,
        width: intent.width,
        height: intent.height,
      });
      if (!r.ok) {
        return {
          ok: false,
          message: `Window action failed: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_window_manage failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: `Completed window action **${r.data?.action || intent.windowAction}**${r.data?.appName ? ` for **${r.data.appName}**` : ''}.`,
        warnings: [],
        data: { kind: 'desktop_window_action', ...r.data },
      };
    }

    if (intent.kind === 'semantic_click' && intent.targetLabel) {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500 });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message:
            `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ` +
            `${tree.error || tree.errorCode || 'unknown bridge error'}. Use a screenshot-grounded click with coordinates as a fallback.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      const match = findBestA11yNode(tree.data.tree, intent.targetLabel);
      if (!match) {
        const candidates = flattenA11yNodes(tree.data.tree)
          .filter((node) => node.label || node.value)
          .slice(0, 20)
          .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`)
          .join('\n');
        return {
          ok: false,
          message:
            `I read **${tree.data.app || intent.appQuery || 'the frontmost app'}** but could not find a control matching **${intent.targetLabel}**.\n\n` +
            `Visible controls I can target:\n${candidates || '(no labeled controls returned)'}`,
          warnings: ['semantic click target not found'],
          data: { kind: 'desktop_semantic_click_no_match', targetLabel: intent.targetLabel, app: tree.data.app },
        };
      }
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: match.id });
      if (!clicked.ok) {
        return {
          ok: false,
          message: `Found **${match.label || match.value || intent.targetLabel}** but could not click it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: match.id },
        };
      }
      return {
        ok: true,
        message: `Clicked **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** via accessibility (${clicked.data?.method || 'unknown'}).`,
        warnings: [],
        data: {
          kind: 'desktop_semantic_click',
          app: tree.data.app,
          pid: tree.data.pid,
          targetPath: match.id,
          targetRole: match.role,
          targetLabel: match.label || match.value || intent.targetLabel,
          method: clicked.data?.method || 'unknown',
        },
      };
    }

    if (intent.kind === 'menu_click' && intent.menuPath?.length) {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const r = await bridgeClickMenu({ appName: intent.appQuery, menuPath: intent.menuPath });
      if (!r.ok) {
        return {
          ok: false,
          message: `Menu action **${intent.menuPath.join(' > ')}** failed${intent.appQuery ? ` in **${intent.appQuery}**` : ''}: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_menu_click failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, menuPath: intent.menuPath },
        };
      }
      return {
        ok: true,
        message: `Clicked menu **${(r.data?.menuPath || intent.menuPath).join(' > ')}**${r.data?.appName ? ` in **${r.data.appName}**` : ''}.`,
        warnings: [],
        data: { kind: 'desktop_menu_click', app: r.data?.appName || intent.appQuery || null, menuPath: r.data?.menuPath || intent.menuPath },
      };
    }

    if (intent.kind === 'set_field_text' && intent.targetLabel && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to put into the field.', warnings: ['empty desktop field text'], data: { kind: 'desktop_invalid_input' } };
      }
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500 });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      const match = findBestTextEntryA11yNode(tree.data.tree, intent.targetLabel);
      if (!match) {
        const candidates = flattenA11yNodes(tree.data.tree)
          .filter((node) => node.label || node.value)
          .slice(0, 20)
          .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`)
          .join('\n');
        return {
          ok: false,
          message: `I read **${tree.data.app || intent.appQuery || 'the frontmost app'}** but could not find a field matching **${intent.targetLabel}**.\n\nVisible controls I can target:\n${candidates || '(no labeled controls returned)'}`,
          warnings: ['field target not found'],
          data: { kind: 'desktop_set_field_no_match', targetLabel: intent.targetLabel, app: tree.data.app },
        };
      }
      const set = await bridgeSetElementValue({ pid: tree.data.pid, path: match.id, text: intent.text });
      if (set.ok) {
        return {
          ok: true,
          message: `Set **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** to ${set.data?.chars ?? intent.text.length} characters via accessibility.`,
          warnings: [],
          data: { kind: 'desktop_set_field_text', app: tree.data.app, pid: tree.data.pid, targetPath: match.id, targetRole: match.role, targetLabel: match.label || match.value || intent.targetLabel, method: set.data?.method || 'ax_set_value', chars: set.data?.chars ?? intent.text.length },
        };
      }
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: match.id });
      if (!clicked.ok) {
        return {
          ok: false,
          message: `Found **${match.label || match.value || intent.targetLabel}** but could not focus it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_set_element_value failed with ${set.errorCode || 'unknown_error'}`, `desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: match.id },
        };
      }
      const pasted = await bridgePasteText(intent.text, {
        appName: options.sequenceMode ? undefined : intent.appQuery,
        restoreClipboard: true,
        focusMode: options.sequenceMode ? 'best_effort' : 'require',
      });
      if (!pasted.ok) {
        return {
          ok: false,
          message: `Found and focused **${match.label || match.value || intent.targetLabel}**, but fallback paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_set_element_value failed with ${set.errorCode || 'unknown_error'}`, `desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode, targetPath: match.id },
        };
      }
      return {
        ok: true,
        message: `Focused **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** and pasted ${pasted.data?.chars ?? intent.text.length} characters after direct accessibility set failed.`,
        warnings: [`Direct AX set failed: ${set.error || set.errorCode || 'unknown error'}`],
        data: { kind: 'desktop_set_field_text_fallback_paste', app: tree.data.app, pid: tree.data.pid, targetPath: match.id, targetRole: match.role, targetLabel: match.label || match.value || intent.targetLabel, chars: pasted.data?.chars ?? intent.text.length },
      };
    }

    if (intent.kind === 'type_text' && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to type.', warnings: ['empty desktop type text'], data: { kind: 'desktop_invalid_input' } };
      }
      const focusWarnings: string[] = [];
      if (intent.appQuery) {
        const focused = await bridgeFocusApp(intent.appQuery);
        if (!focused.ok) {
          if (options.sequenceMode) {
            focusWarnings.push(`desktop_focus_app warning before typing: ${focused.error || focused.errorCode || 'unknown bridge error'}`);
          } else {
            return {
              ok: false,
              message: `Could not focus **${intent.appQuery}** before typing: ${focused.error || focused.errorCode || 'unknown bridge error'}.`,
              warnings: [`desktop_focus_app failed with ${focused.errorCode || 'unknown_error'}`],
              data: { kind: 'desktop_bridge_error', errorCode: focused.errorCode },
            };
          }
        }
      }
      const usePaste = shouldPasteForTextEntry(intent.text);
      const r = usePaste
        ? await bridgePasteText(intent.text, {
            appName: options.sequenceMode ? undefined : intent.appQuery,
            restoreClipboard: true,
            focusMode: options.sequenceMode ? 'best_effort' : 'require',
          })
        : await bridgeTypeText(intent.text);
      if (!r.ok) {
        return {
          ok: false,
          message: `${usePaste ? 'Paste' : 'Typing'} failed: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_${usePaste ? 'paste_text' : 'type_text'} failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      const pasteFocusWarning = usePaste ? (r.data as any)?.focusWarning : null;
      return {
        ok: true,
        message: `${usePaste ? 'Pasted' : 'Typed'} ${r.data?.chars ?? intent.text.length} characters${intent.appQuery ? ` into **${intent.appQuery}**` : ' into the focused app'}${usePaste ? ' using a restored temporary clipboard.' : ''}.`,
        warnings: [...focusWarnings, ...(pasteFocusWarning ? [`desktop_paste_text focus warning: ${pasteFocusWarning}`] : [])],
        data: { kind: usePaste ? 'desktop_paste_text' : 'desktop_type_text', chars: r.data?.chars ?? intent.text.length, app: intent.appQuery || null },
      };
    }

    if (intent.kind === 'paste_text' && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to paste.', warnings: ['empty desktop paste text'], data: { kind: 'desktop_invalid_input' } };
      }
      const r = await bridgePasteText(intent.text, {
        appName: options.sequenceMode ? undefined : intent.appQuery,
        restoreClipboard: true,
        focusMode: options.sequenceMode ? 'best_effort' : 'require',
      });
      if (!r.ok) return { ok: false, message: `Paste failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_paste_text failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return {
        ok: true,
        message: `Pasted ${r.data?.chars ?? intent.text.length} characters${r.data?.appName || intent.appQuery ? ` into **${r.data?.appName || intent.appQuery}**` : ' into the focused app'} with clipboard restoration ${r.data?.restoredClipboard ? 'enabled' : 'skipped'}.`,
        warnings: r.data?.focusWarning ? [`desktop_paste_text focus warning: ${r.data.focusWarning}`] : [],
        data: { kind: 'desktop_paste_text', chars: r.data?.chars ?? intent.text.length, app: r.data?.appName || intent.appQuery || null, restoredClipboard: r.data?.restoredClipboard ?? false },
      };
    }

    if (intent.kind === 'press_keys' && intent.combo) {
      const focusWarnings: string[] = [];
      if (intent.appQuery) {
        const focused = await bridgeFocusApp(intent.appQuery);
        if (!focused.ok) {
          if (options.sequenceMode) {
            focusWarnings.push(`desktop_focus_app warning before key press: ${focused.error || focused.errorCode || 'unknown bridge error'}`);
          } else {
            return {
              ok: false,
              message: `Could not focus **${intent.appQuery}** before pressing keys: ${focused.error || focused.errorCode || 'unknown bridge error'}.`,
              warnings: [`desktop_focus_app failed with ${focused.errorCode || 'unknown_error'}`],
              data: { kind: 'desktop_bridge_error', errorCode: focused.errorCode },
            };
          }
        }
      }
      const r = await bridgePressKeys(intent.combo);
      if (!r.ok) return { ok: false, message: `Key press failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_press_keys failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return {
        ok: true,
        message: `Pressed **${r.data?.combo || intent.combo}**${intent.appQuery ? ` in **${intent.appQuery}**` : ' in the focused app'}.`,
        warnings: focusWarnings,
        data: { kind: 'desktop_press_keys', combo: r.data?.combo || intent.combo, app: intent.appQuery || null },
      };
    }

    if (intent.kind === 'mouse_move' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const r = await bridgeMouseMove(intent.x, intent.y);
      if (!r.ok) return { ok: false, message: `Mouse move failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_move failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Moved mouse to (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_move', ...r.data } };
    }

    if (intent.kind === 'mouse_click' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.x, y: intent.y }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseClick({ x: intent.x, y: intent.y, button: intent.mouseButton, count: intent.clickCount });
      if (!r.ok) return { ok: false, message: `Mouse click failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_click failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nClicked ${r.data?.button || 'left'} x${r.data?.count || 1} at (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_click', ...r.data } };
    }

    if (intent.kind === 'mouse_down' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.x, y: intent.y }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseDown({ x: intent.x, y: intent.y, button: intent.mouseButton });
      if (!r.ok) return { ok: false, message: `Mouse down failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_down failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nHeld ${r.data?.button || 'left'} mouse down at (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_down', ...r.data } };
    }

    if (intent.kind === 'mouse_up') {
      const hasCoords = typeof intent.x === 'number' && typeof intent.y === 'number';
      if (hasCoords) {
        const observed = await observeBeforeCoordinateAction([{ x: intent.x as number, y: intent.y as number }]);
        if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      }
      const r = await bridgeMouseUp({ x: intent.x, y: intent.y, button: intent.mouseButton });
      if (!r.ok) return { ok: false, message: `Mouse up failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_up failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Released ${r.data?.button || 'left'} mouse${r.data?.x != null && r.data?.y != null ? ` at (${r.data.x}, ${r.data.y})` : ''}.`, warnings: [], data: { kind: 'desktop_mouse_up', ...r.data } };
    }

    if (intent.kind === 'mouse_drag' && typeof intent.fromX === 'number' && typeof intent.fromY === 'number' && typeof intent.toX === 'number' && typeof intent.toY === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.fromX, y: intent.fromY }, { x: intent.toX, y: intent.toY }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseDrag({ fromX: intent.fromX, fromY: intent.fromY, toX: intent.toX, toY: intent.toY });
      if (!r.ok) return { ok: false, message: `Mouse drag failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_drag failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nDragged from (${r.data?.fromX}, ${r.data?.fromY}) to (${r.data?.toX}, ${r.data?.toY}).`, warnings: [], data: { kind: 'desktop_mouse_drag', ...r.data } };
    }

    if (intent.kind === 'mouse_scroll') {
      const points = typeof intent.x === 'number' && typeof intent.y === 'number' ? [{ x: intent.x, y: intent.y }] : [];
      if (points.length) {
        const observed = await observeBeforeCoordinateAction(points);
        if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      }
      const r = await bridgeMouseScroll({ deltaX: intent.deltaX, deltaY: intent.deltaY, x: intent.x, y: intent.y });
      if (!r.ok) return { ok: false, message: `Mouse scroll failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_scroll failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Scrolled mouse deltaX=${r.data?.deltaX ?? 0}, deltaY=${r.data?.deltaY ?? 0}.`, warnings: [], data: { kind: 'desktop_mouse_scroll', ...r.data } };
    }

    if (intent.kind === 'wait') {
      await sleep(intent.durationMs || 1000);
      return { ok: true, message: `Waited ${Math.round((intent.durationMs || 1000) / 100) / 10} seconds.`, warnings: [], data: { kind: 'desktop_wait', durationMs: intent.durationMs || 1000 } };
    }
  } catch (err: any) {
    return {
      ok: false,
      message: `Local desktop action failed: ${err?.message || 'Unknown error'}`,
      warnings: ['desktop_action threw'],
      data: { kind: 'desktop_bridge_error' },
    };
  }

  return null;
}

export async function executeComputerAppTask(args: {
  circleId: string;
  task: string;
}): Promise<ComputerAppAdapterResult> {
  const task = String(args.task || '').trim();
  if (!task) {
    return {
      ok: false,
      message: 'No app task was provided.',
      warnings: [],
    };
  }

  // Multi-step app instructions ("open Photoshop then click File > Save")
  // need to stay in the deterministic desktop pipeline. The single-app
  // shortcut below would otherwise stop after the launch step.
  if (detectLocalComputerAwarenessIntentSequence(task).length > 1) {
    const sequencedDesktopResult = await executeLocalDesktopIntent(task);
    if (sequencedDesktopResult) return sequencedDesktopResult;
  }

  // ─── Precedence step 1: Claude Code bridge (Phase 1b) ─────────────────
  // If the user has the local desktop bridge running + a known app is in
  // the utterance, launch natively — most reliable path, single HITL
  // gate, follow-up tool calls (type/keys) happen via the agent loop.
  //
  // We probe health first so we can distinguish "bridge offline" from
  // "bridge running but call errored" — the user's experience is very
  // different in those two states and silently falling through to the
  // URL-scheme shortcut (with a muddled warning) is the opposite of
  // what the user wants when they HAVE paired.
  const bridgeCandidate = matchKnownApp(task);
  if (bridgeCandidate) {
    try {
      const bridgeAvailable = await isDesktopBridgeAvailable();
      if (bridgeAvailable) {
        // Auto-pair if needed — ensureDesktopBridgePaired is idempotent
        // and silent when already paired.
        await ensureDesktopBridgePaired().catch(() => null);
        const r = await bridgeLaunchApp(resolveMacLaunchName(bridgeCandidate));
        if (r.ok) {
          // For utterances with a built-in follow-up pattern we know
          // from the alias match (e.g. "open Claude Code" → launch
          // Terminal + type `claude` + Return), auto-chain the
          // sequence here rather than relying on the model to call
          // desktop.* tools. Client-side only — same trust boundary
          // as the launch itself, and avoids needing the hardcoded
          // swanbot-ai edge fn to know about desktop tools.
          const autoChainSteps = await runAutoChain(bridgeCandidate.id);

          const followupMessages: Record<string, string> = {
            'terminal-claude': 'Ran `claude` in Terminal.',
            zoom: 'Sent Cmd+N to start a new meeting.',
          };
          const chainMsg = autoChainSteps.ok && followupMessages[bridgeCandidate.id]
            ? ` ${followupMessages[bridgeCandidate.id]}`
            : autoChainSteps.error
              ? ` Auto-chain hit an issue: ${autoChainSteps.error}.`
              : '';

          return {
            ok: true,
            message:
              `Launched **${bridgeCandidate.displayName}** via the local bridge.${chainMsg}` +
              (autoChainSteps.ok
                ? ''
                : ' Follow up with `desktop.type_text` / `desktop.press_keys` for further actions.'),
            warnings: [],
            data: {
              kind: 'desktop_bridge_launch',
              appId: bridgeCandidate.id,
              displayName: bridgeCandidate.displayName,
              capability: 'desktop_action',
              autoChain: autoChainSteps,
            },
          };
        }
        // Bridge reachable but launch failed — surface the specific
        // error state inline rather than silently returning the URL
        // shortcut. The user wants to know WHY the real path didn't
        // work so they can fix it.
        if (r.errorCode === 'permission_denied') {
          return {
            ok: false,
            message:
              `**macOS Accessibility permission required.**\n\n` +
              `The bridge tried to launch **${bridgeCandidate.displayName}** but was blocked. ` +
              `Open **System Settings → Privacy & Security → Accessibility** and enable it for ` +
              `whichever Terminal / iTerm is running \`node scripts/claude-bridge.js\`. ` +
              `Retry the same command afterwards — no re-pairing needed.`,
            warnings: ['desktop_action failed with permission_denied'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, displayName: bridgeCandidate.displayName },
          };
        }
        if (r.errorCode === 'app_not_found') {
          return {
            ok: false,
            message:
              `**${bridgeCandidate.displayName} isn't installed on this Mac.**\n\n` +
              `The bridge tried \`open -a "${bridgeCandidate.displayName}"\` and got "not found." ` +
              `Install the app or ask me for a browser fallback (${bridgeCandidate.webUrl}).`,
            warnings: ['desktop_action failed with app_not_found'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, displayName: bridgeCandidate.displayName, webFallback: bridgeCandidate.webUrl },
          };
        }
        if (r.errorCode === 'not_paired') {
          return {
            ok: false,
            message:
              `**Bridge running but not paired.** Tap **⎇ Pair Desktop Bridge** ` +
              `in the Chat Actions menu once, then retry.`,
            warnings: ['desktop_action failed with not_paired'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
          };
        }
        if (r.errorCode === 'origin_blocked') {
          // CORS preflight failed. Before 2026-04-23 the bridge didn't
          // include `X-UC-Desktop-Token` in Access-Control-Allow-Headers,
          // so every authed call died here even with a paired token.
          // Fixed in scripts/claude-bridge.js; users on older builds see
          // this path. Tell them to restart the bridge.
          return {
            ok: false,
            message:
              `**Bridge CORS rejected the token header.**\n\n` +
              `Stop your \`node scripts/claude-bridge.js\` process and start it again ` +
              `after running \`git pull\` — the CORS allow-list was widened to accept ` +
              `the desktop-token header. Then run \`/desktop diag\` to confirm.`,
            warnings: ['desktop_action failed with origin_blocked'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
          };
        }
        // Unknown error state — note it but fall through to URL-scheme
        // shortcut so the user still has SOME path.
      }
    } catch {
      // Bridge probe threw — continue with the non-bridge paths.
    }
  }

  // Generic native app/window/pointer path. This covers installed apps
  // not in KNOWN_APPS plus exact local desktop actions like click,
  // drag, scroll, and semantic accessibility clicks.
  const localDesktopResult = await executeLocalDesktopIntent(task);
  if (localDesktopResult) return localDesktopResult;

  const [tools, connections, providers, capabilities] = await Promise.all([
    fetchAllMcpTools(args.circleId).catch(() => [] as McpTool[]),
    loadConnections().catch(() => []),
    getInstalledIntegrationProviders(args.circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(args.circleId).catch(() => [] as string[]),
  ]);

  const appTools = tools.filter(isDesktopOrAppTool);
  const targetProviders = inferTargetProviders(task);
  const matchingTool = [...appTools].sort((a, b) => {
    const aScore = targetProviders.some((provider) => toolMatches(a, [provider])) ? 2 : 0;
    const bScore = targetProviders.some((provider) => toolMatches(b, [provider])) ? 2 : 0;
    return bScore - aScore;
  })[0];

  if (matchingTool) {
    const toolArgs = buildArgs(matchingTool, task);
    try {
      const result = await callMcpTool(matchingTool.serverId, matchingTool.name, toolArgs);
      return {
        ok: true,
        message: [
          `Executed app task with **${matchingTool.name}**.`,
          '',
          stringifyResult(result),
        ].join('\n'),
        warnings: [],
        data: {
          toolName: matchingTool.name,
          toolArgs,
          rawResult: result,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        message: `App tool execution failed: ${error?.message || 'Unknown error'}`,
        warnings: ['App MCP call failed.'],
        data: {
          toolName: matchingTool.name,
          toolArgs,
        },
      };
    }
  }

  const enabledConnections = connections.filter((connection) => connection.enabled);
  const lines: string[] = [];
  if (providers.length > 0) {
    lines.push(`Connected integrations: ${providers.join(', ')}`);
  }
  if (capabilities.length > 0) {
    lines.push(`Integration capabilities: ${capabilities.slice(0, 10).join(', ')}`);
  }
  if (enabledConnections.length > 0) {
    lines.push(`Enabled bridges: ${enabledConnections.map((connection) => connection.provider).join(', ')}`);
  }
  if (appTools.length > 0) {
    lines.push(`MCP app tools: ${appTools.slice(0, 6).map((tool) => tool.name).join(', ')}`);
  }

  // Before giving up, check whether the user asked for a well-known
  // desktop app (Zoom, Slack, Notion, …). If so, hand back a clickable
  // shortcut that uses the OS URL handler — native launch in one click
  // even without an app_tools bridge. This is the "Option A" fallback
  // documented in `docs/DESKTOP_APP_CAPABILITY_PATHS.md`.
  //
  // NOTE: by the time we reach this branch, the bridge-first step
  // above already failed (bridge offline, or bridge running but launch
  // errored with an unrecognised code). Include an inline prompt to
  // start the bridge for full automation — otherwise the user has no
  // signal that there's a stronger path available.
  const knownApp = matchKnownApp(task);
  if (knownApp) {
    const platform = detectPlatform();
    const shortcut = renderAppShortcut(knownApp, { platform });
    const bridgeHint = [
      '',
      '— — —',
      '**Want full automation?** Launch, type, and press keys without clicking anything:',
      '1. Run `node scripts/claude-bridge.js` in a terminal',
      '2. Tap **⎇ Pair Desktop Bridge** in the Chat Actions menu once',
      '3. Retry your request — the agent will drive the app directly.',
    ].join('\n');
    return {
      ok: true,
      message: shortcut.markdown + '\n' + bridgeHint,
      warnings: lines.length === 0
        ? ['Desktop bridge offline — served via known-app URL-scheme shortcut. Run the bridge for full automation.']
        : ['Missing app MCP tool match — offering known-app URL-scheme shortcut as fallback.'],
      data: {
        kind: 'known_app_shortcut',
        appId: knownApp.id,
        displayName: knownApp.displayName,
        osUrl: shortcut.osUrl,
        webUrl: shortcut.webUrl,
        keyboardHint: shortcut.keyboardHint,
        platform,
        bridgeHint: true,
      },
    };
  }

  if (lines.length === 0) {
    return {
      ok: false,
      message: 'No connected app surfaces are available for this circle yet — missing an app adapter or bridge tool to drive this app.',
      warnings: ['Missing app MCP / integration / bridge surface.'],
    };
  }

  return {
    ok: true,
    message: [
      'App-capable surfaces are available, but this task is missing an app adapter for the exact action requested.',
      '',
      ...lines.map((line) => `- ${line}`),
      '',
      'The next step is to build an app-specific action adapter for these surfaces (or provide explicit access guidance).',
    ].join('\n'),
    warnings: ['No direct app MCP tool match; returning surface inventory instead.'],
    data: {
      providers,
      capabilities,
      enabledBridgeProviders: enabledConnections.map((connection) => connection.provider),
      appToolNames: appTools.map((tool) => tool.name),
    },
  };
}
