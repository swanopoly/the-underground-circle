import { buildAppAutomationControlSurfacePlan } from './appAutomationControlSurfaces';
import {
  buildDesignAppCreativeAiPlan,
  type DesignAppCreativeAiCapabilityId,
} from './designAppCreativeAi';

export type DesignAppAutomationAppId = 'adobe_indesign' | 'adobe_photoshop';

export type DesignAppAutomationOperation =
  | 'inspect_layers'
  | 'update_text_layers'
  | 'replace_linked_asset'
  | 'resize_layout'
  | 'toggle_layer_visibility'
  | 'export_proof'
  | 'package_handoff'
  | 'inspect_image_document'
  | 'edit_adjustment_layers'
  | 'apply_selection_or_mask'
  | 'generative_fill_or_remove'
  | 'generate_ai_asset'
  | 'generative_expand_asset'
  | 'create_creative_variants'
  | 'export_raster_proof'
  | 'apply_layer_effects'
  | 'manage_layers'
  | 'apply_text_style'
  | 'manage_pages'
  | 'transform_layer'
  | 'convert_color_mode'
  | 'manage_tables'
  | 'resolve_fonts'
  | 'manage_artboards'
  | 'manage_hyperlinks'
  | 'build_toc'
  | 'manage_text_flow'
  | 'manage_smart_objects'
  | 'manage_swatches';

export interface DesignAppAutomationPlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: 'marketing_banner_layout' | 'layout_document_edit' | 'marketing_image_composite' | 'raster_image_edit';
  documentSignals: string[];
  operations: DesignAppAutomationOperation[];
  controlOrder: string[];
  requiredInventory: string[];
  approvalGates: string[];
  verificationSignals: string[];
  recoveryRules: string[];
  recommendedTools: string[];
  controlSurfaceOrder: string[];
  controlSurfaceSourceRefs: string[];
  failSafeRules: string[];
  creativeAiCapabilities?: DesignAppCreativeAiCapabilityId[];
}

const INDESIGN_RE = /\b(indesign|in\s*design|\.indd\b|\.idml\b|\.indt\b|idml|indd)\b/i;
const PHOTOSHOP_RE = /\b(photoshop|photo\s*shop|\.psd\b|\.psb\b|psd|psb|generative\s+fill|content-aware|firefly)\b/i;
const LAYOUT_RE = /\b(layout|banner|ad\b|advert|display ad|marketing|campaign|flyer|brochure|poster|print|spread|page|template|data merge|proof|preflight|package)\b/i;
const LAYER_RE = /\b(layer|layers|text frame|frame|headline|subhead|cta|button|disclaimer|legal|fine print|offer|price|apr|dealer|link|asset|image|logo|swatch|bleed|margin)\b/i;
const IMAGE_EDIT_RE = /\b(image|photo|picture|psd|psb|composite|retouch|remove background|replace background|generative fill|content-aware|mask|selection|select subject|adjustment layer|curves|levels|crop|resize|export|save for web)\b/i;
const PHOTOSHOP_TASK_RE = /\b(open|launch|focus|edit|change|update|replace|remove|erase|delete|clean up|retouch|crop|resize|convert|rotate|flip|transform|warp|create|artboard|export|save|place|insert|add|generate|generative|content-aware|firefly|select|mask|background|proof|preview|\.psd\b|\.psb\b)\b/i;

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function planningTextForTask(task: string): string {
  const value = String(task || '');
  const requestedChanges = value.match(/^User requested changes:\s*(.+)$/m);
  if (requestedChanges?.[1]) {
    const appHints = Array.from(value.matchAll(/Open with (Adobe InDesign|Adobe Photoshop)\./g))
      .map((match) => match[1]);
    return unique([requestedChanges[1], ...appHints]).join(' ');
  }
  return value.split(/\nExecution rules:/i)[0] || value;
}

function hasExplicitInDesignTarget(text: string): boolean {
  return /\.(indd|idml|indt)\b/i.test(text)
    || /\bopen\s+with\s+adobe\s+indesign\b/i.test(text)
    || /^User requested changes:[\s\S]{0,500}\b(indesign|in\s+design)\b/im.test(text);
}

function hasExplicitPhotoshopTarget(text: string): boolean {
  return /\.(psd|psb)\b/i.test(text)
    || /\bopen\s+with\s+adobe\s+photoshop\b/i.test(text)
    || /^User requested changes:[\s\S]{0,500}\b(photoshop|photo\s*shop|generative\s+fill|content-aware|firefly)\b/im.test(text);
}

function detectInDesignOperations(text: string): DesignAppAutomationOperation[] {
  const operations: DesignAppAutomationOperation[] = ['inspect_layers'];
  if (/\b(change|update|replace|edit|write|set)\b[\s\S]{0,120}\b(text|copy|headline|subhead|cta|disclaimer|legal|price|apr|offer|dealer|phone|url)\b/i.test(text)) {
    operations.push('update_text_layers');
  }
  if (/\b(replace|swap|relink|place|update)\b[\s\S]{0,120}\b(image|photo|logo|asset|link|links?|graphic)\b/i.test(text)) {
    operations.push('replace_linked_asset');
  }
  if (/\b(resize|size|dimension|dimensions|bleed|margin|scale|format|story|post|leaderboard|skyscraper|square|wide|vertical)\b/i.test(text)) {
    operations.push('resize_layout');
  }
  if (/\b(show|hide|lock|unlock|toggle)\b[\s\S]{0,80}\blayers?\b/i.test(text)) {
    operations.push('toggle_layer_visibility');
  }
  if (/\b(export|pdf|png|jpg|jpeg|proof|preview)\b/i.test(text)) {
    operations.push('export_proof');
  }
  if (/\b(package|handoff|collect|links and fonts|preflight)\b/i.test(text)) {
    operations.push('package_handoff');
  }
  if (/\b(text[-\s]?to[-\s]?image|generate (?:an? )?(?:image|background|hero|scene|asset)|firefly|ai image|prompt(?:ed)? image)\b/i.test(text)) {
    operations.push('generate_ai_asset');
  }
  if (/\b(generative expand|expand (?:the )?(?:image|photo|asset|background)|extend (?:the )?(?:image|photo|asset|background)|outpaint|fill (?:the )?(?:frame|banner|spread))\b/i.test(text)) {
    operations.push('generative_expand_asset');
  }
  if (/\b(data merge|csv|spreadsheet|personalized|localized|localised|versions?|variants?|campaign variations?|variable data|batch)\b/i.test(text)) {
    operations.push('create_creative_variants');
  }
  if (/\b(paragraph style|character style|object style|cell style|table style|apply (?:the )?style|text style|style sheet|stylesheet|typograph)\b/i.test(text)) {
    operations.push('apply_text_style');
  }
  if (/\b(add|insert|delete|remove|duplicate|move|reorder|rearrange)\b[\s\S]{0,40}\b(pages?|spreads?)\b|\b(master page|parent page|apply (?:the )?master|apply (?:the )?parent)\b/i.test(text)) {
    operations.push('manage_pages');
  }
  if (/\b(create|insert|add|build|edit|populate|fill|format|delete|remove|merge|split|convert)\b[\s\S]{0,40}\b(tables?|cells?|rows?|columns?)\b|\btable from data\b|\bconvert (?:the )?(?:text )?to (?:a )?table\b/i.test(text)) {
    operations.push('manage_tables');
  }
  if (/\b(missing fonts?|activate (?:the |missing )?fonts?|font activation|adobe fonts|typekit|sync (?:the )?fonts?|substitute (?:the )?fonts?|font substitution|replace (?:the )?fonts?|missing glyphs?|font conflict|swap (?:the )?fonts?|install (?:the )?fonts?)\b/i.test(text)) {
    operations.push('resolve_fonts');
  }
  if (/\b(hyperlinks?|hyper ?links?|cross[\s-]?references?|cross[\s-]?refs?|xrefs?|bookmarks?|interactive pdf|button actions?|add (?:a )?link to)\b/i.test(text)) {
    operations.push('manage_hyperlinks');
  }
  if (/\b(table of contents|\btoc\b|generate (?:an? )?index|build (?:an? )?index|create (?:an? )?index|running header|running footer|section marker)\b/i.test(text)) {
    operations.push('build_toc');
  }
  if (/\b(thread|unthread|autoflow|auto[\s-]?flow|overset|text flow|flow (?:the )?text|link (?:the )?(?:text )?frames?|connect (?:the )?(?:text )?frames?|reflow)\b/i.test(text)) {
    operations.push('manage_text_flow');
  }
  if (/\b(swatch|swatches|spot colou?rs?|process colou?rs?|pantone|ink manager|colou?r group|tint swatch|gradient swatch|mixed ink)\b/i.test(text)) {
    operations.push('manage_swatches');
  }
  if (operations.length === 1 && /\b(make|create|build|finish|fix|revise)\b/i.test(text)) {
    operations.push('update_text_layers', 'export_proof');
  }
  return unique(operations);
}

function detectPhotoshopOperations(text: string): DesignAppAutomationOperation[] {
  const operations: DesignAppAutomationOperation[] = ['inspect_image_document', 'inspect_layers'];
  if (/\b(change|update|replace|edit|write|set)\b[\s\S]{0,120}\b(text|copy|headline|subhead|cta|disclaimer|legal|price|apr|offer|dealer|phone|url)\b/i.test(text)) {
    operations.push('update_text_layers');
  }
  if (/\b(place|insert|add|replace|swap|relink|import)\b[\s\S]{0,120}\b(image|photo|logo|asset|link|graphic|background|smart object)\b/i.test(text)) {
    operations.push('replace_linked_asset');
  }
  if (/\b(resize|size|dimension|dimensions|resolution|dpi|ppi|crop|canvas|scale|instagram|story|post|thumbnail|hero|banner)\b/i.test(text)) {
    operations.push('resize_layout');
  }
  if (/\b(show|hide|lock|unlock|toggle)\b[\s\S]{0,80}\blayers?\b/i.test(text)) {
    operations.push('toggle_layer_visibility');
  }
  if (/\b(mask|selection|select subject|select and mask|background|clipping mask|marquee|lasso|highlight|selected area)\b/i.test(text)) {
    operations.push('apply_selection_or_mask');
  }
  if (/\b(generative fill|content-aware|remove|erase|delete|clean up|replace background|ai edit|inpaint)\b/i.test(text)) {
    operations.push('generative_fill_or_remove');
  }
  if (/\b(text[-\s]?to[-\s]?image|generate (?:an? )?(?:image|background|hero|scene|asset|texture)|ai image|prompt(?:ed)? image|firefly)\b/i.test(text)) {
    operations.push('generate_ai_asset');
  }
  if (/\b(generative expand|expand (?:the )?(?:canvas|image|photo|background)|extend (?:the )?(?:canvas|image|photo|background)|outpaint|wider|taller)\b/i.test(text)) {
    operations.push('generative_expand_asset');
  }
  if (/\b(variations?|options?|versions?|colorways?|style variations?|brand variations?|localized|personalized|batch)\b/i.test(text)) {
    operations.push('create_creative_variants');
  }
  if (/\b(adjust|retouch|curves|levels|color|tone|contrast|brightness|exposure|filter|blur|sharpen|neural filter|camera raw|harmonize)\b/i.test(text)) {
    operations.push('edit_adjustment_layers');
  }
  if (/\b(drop shadow|layer style|layer effect|layer fx|stroke|bevel|emboss|inner shadow|outer glow|inner glow|gradient overlay|color overlay|pattern overlay|satin|blend mode|blending mode|opacity)\b/i.test(text)) {
    operations.push('apply_layer_effects');
  }
  if (/\b(create|add|new|duplicate|copy|delete|remove|merge|flatten|group|ungroup|rasterize|rename)\b[\s\S]{0,40}\b(layers?|groups?)\b/i.test(text)) {
    operations.push('manage_layers');
  }
  if (/\b(rotate|flip|mirror|free transform|free-transform|skew|distort|warp|perspective|straighten|transform the layer|transform layer)\b/i.test(text)) {
    operations.push('transform_layer');
  }
  if (/\b(cmyk|grayscale|greyscale|duotone|bitmap mode|lab color|color mode|colour mode|color space|colour space|color profile|colour profile|icc profile|bit depth|8[\s-]?bit|16[\s-]?bit|32[\s-]?bit|convert to profile|assign profile|color settings|to rgb\b|rgb mode|srgb|adobe rgb)\b/i.test(text)) {
    operations.push('convert_color_mode');
  }
  if (/\b(artboards?|art ?boards?|new (?:photoshop )?document|create (?:a )?(?:new )?(?:document|psd|file))\b/i.test(text)) {
    operations.push('manage_artboards');
  }
  if (/\bconvert\b[\s\S]{0,30}?\bto (?:a )?smart object\b|\b(smart object contents|edit (?:the )?smart object|rasterize (?:the )?smart object|replace (?:the )?(?:smart object )?contents|smart filters?)\b/i.test(text)) {
    operations.push('manage_smart_objects');
  }
  if (/\b(export|save for web|png|jpg|jpeg|webp|proof|preview|layers to files)\b/i.test(text)) {
    operations.push('export_raster_proof');
  }
  if (operations.length === 2 && /\b(make|create|build|finish|fix|revise|edit)\b/i.test(text)) {
    operations.push('edit_adjustment_layers', 'export_raster_proof');
  }
  return unique(operations);
}

function detectInDesignDocumentSignals(text: string): string[] {
  const signals: string[] = [];
  if (/\bmarketing|campaign|ad\b|advert|dealer|offer|promo|promotion\b/i.test(text)) signals.push('marketing/campaign deliverable');
  if (/\bbanner|display ad|leaderboard|social|story|post|hero\b/i.test(text)) signals.push('banner or social layout');
  if (/\blayers?|text frame|headline|cta|disclaimer|legal|offer|price|apr\b/i.test(text)) signals.push('named layers/text frames');
  if (/\b\.indd\b|\.idml\b|\.indt\b|package|links?|fonts?\b/i.test(text)) signals.push('InDesign document/package assets');
  if (/\bexport|pdf|png|jpg|proof|preflight\b/i.test(text)) signals.push('production proof/export');
  return signals.length ? signals : ['InDesign layout edit'];
}

function detectPhotoshopDocumentSignals(text: string): string[] {
  const signals: string[] = [];
  if (/\bmarketing|campaign|ad\b|advert|dealer|offer|promo|promotion|banner|social|story|post|hero|thumbnail\b/i.test(text)) signals.push('marketing creative image');
  if (/\b\.psd\b|\.psb\b|smart object|linked|embedded|layer comps?|layers?\b/i.test(text)) signals.push('Photoshop layered document');
  if (/\bphoto|image|picture|retouch|remove background|replace background|mask|selection|select subject\b/i.test(text)) signals.push('raster image edit');
  if (/\bgenerative fill|firefly|content-aware|ai edit|inpaint|outpaint|generative expand\b/i.test(text)) signals.push('generative or content-aware edit');
  if (/\bexport|save for web|png|jpg|jpeg|webp|proof|preview\b/i.test(text)) signals.push('raster proof/export');
  return signals.length ? signals : ['Photoshop image edit'];
}

export function shouldUseDesignAppAutomation(task: string): boolean {
  const text = planningTextForTask(task);
  const explicitInDesign = INDESIGN_RE.test(text);
  const explicitPhotoshop = PHOTOSHOP_RE.test(text) && PHOTOSHOP_TASK_RE.test(text);
  if (explicitInDesign || explicitPhotoshop) return true;
  if (
    /\b(shopify|wordpress|wp admin|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|website|webpage|browser|product page|media library)\b/i.test(text) &&
    /\b(upload|attach|choose file|select file|import|download|product|page)\b/i.test(text)
  ) {
    return false;
  }
  return (LAYOUT_RE.test(text) && LAYER_RE.test(text))
    || (IMAGE_EDIT_RE.test(text) && LAYER_RE.test(text) && LAYOUT_RE.test(text));
}

function buildInDesignPlan(text: string): DesignAppAutomationPlan {
  const operations = detectInDesignOperations(text);
  const wantsBanner = /\bbanner|display ad|leaderboard|social|story|post|hero|marketing|campaign|dealer|offer|promo\b/i.test(text);
  const surfacePlan = buildAppAutomationControlSurfacePlan(text, {
    targetId: 'adobe_indesign',
    targetName: 'Adobe InDesign',
  });
  const creativeAiPlan = buildDesignAppCreativeAiPlan(text);
  return {
    appId: 'adobe_indesign',
    appName: 'Adobe InDesign',
    taskKind: wantsBanner ? 'marketing_banner_layout' : 'layout_document_edit',
    documentSignals: detectInDesignDocumentSignals(text),
    operations,
    controlOrder: [
      'Resolve the exact .indd/.idml/.indt file or staged package folder and verify source/destination paths.',
      'Open or focus Adobe InDesign, then run script-backed document status before any mutation.',
      'Build a layer/text/link inventory with InDesign DOM-backed bridge tools.',
      'Use named text-layer or exact find/change tools for copy changes; use link/place/package workflows only after file checks.',
      'Use accessibility/menu actions only for gaps the script-backed bridge does not cover.',
      'Use screenshots for proof and visual alignment checks, not as the first control surface.',
    ],
    requiredInventory: [
      'active document name/path and saved/modified state',
      'layer count plus locked/hidden layers',
      'text frame inventory with names, labels, layers, overset state, and matching copy',
      'links/assets status, missing/modified links, and package sidecars',
      'fonts/preflight issues before export or package',
      ...(creativeAiPlan ? ['creative AI prompt, target frame/link/layer, generated asset receipt, and output proof destination'] : []),
    ],
    approvalGates: [
      'editing text frames or object/layer state',
      'relinking/replacing placed assets',
      ...(creativeAiPlan ? ['AI image generation, generative expand, data-merge variant generation, or cloud asset processing'] : []),
      'saving over the source InDesign file',
      'exporting or packaging deliverables',
      'running new scripts/adapters outside existing bridge tools',
    ],
    verificationSignals: [
      'post-change InDesign text inventory shows requested layer/copy updates',
      'document status reports no unexpected missing fonts or links',
      'fresh screenshot or proof export shows the visible banner/layout state',
      'file_stat confirms exported proof/package output path when requested',
      ...(creativeAiPlan ? ['generated assets, expanded images, or data-merge variants have receipts plus proof/file evidence'] : []),
    ],
    recoveryRules: [
      'If the expected document is not active/open, stop and open the exact staged file instead of editing another document.',
      'If layers are locked or hidden, report the affected layers and request approval before temporary unlock/show.',
      'If text is overset after copy changes, stop with the affected frame/layer and ask for layout adjustment or approval to resize.',
      'If links or fonts are missing, resolve package sidecars before visual edits or exports.',
      'If script-backed tools cannot express the requested operation, delegate a bounded app-capability buildout before using blind coordinates.',
      ...(creativeAiPlan ? creativeAiPlan.failClosedRules : []),
      ...surfacePlan.failSafeRules,
    ],
    recommendedTools: [
      'desktop.file_search',
      'desktop.file_stat',
      'desktop.open_path',
      'desktop.launch_app',
      'desktop.focus_app',
      'desktop.indesign_document_status',
      'desktop.indesign_text_inventory',
      'desktop.indesign_set_layer_state',
      'desktop.indesign_batch_update_text_layers',
      'desktop.indesign_batch_find_change',
      'desktop.indesign_update_text_layer',
      'desktop.indesign_relink_asset',
      'desktop.indesign_package_document',
      'desktop.indesign_export_proof',
      ...(creativeAiPlan ? ['research.search', 'agent.build_app_capability'] : []),
      'desktop.read_a11y_tree',
      'desktop.menu_click',
      'desktop.screenshot',
      'approvals.request',
    ],
    controlSurfaceOrder: surfacePlan.candidates.map((surface) => surface.label),
    controlSurfaceSourceRefs: [
      ...surfacePlan.sourceRefs.map((ref) => `${ref.label}: ${ref.url}`),
      ...(creativeAiPlan?.sourceRefs.map((ref) => `${ref.label}: ${ref.url}`) || []),
    ],
    failSafeRules: surfacePlan.failSafeRules,
    creativeAiCapabilities: creativeAiPlan?.capabilities.map((capability) => capability.id),
  };
}

function buildPhotoshopPlan(text: string): DesignAppAutomationPlan {
  const operations = detectPhotoshopOperations(text);
  const wantsMarketingCreative = /\bbanner|display ad|leaderboard|social|story|post|hero|marketing|campaign|dealer|offer|promo|thumbnail|flyer|poster\b/i.test(text);
  const surfacePlan = buildAppAutomationControlSurfacePlan(text, {
    targetId: 'adobe_photoshop',
    targetName: 'Adobe Photoshop',
  });
  const creativeAiPlan = buildDesignAppCreativeAiPlan(text);
  return {
    appId: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    taskKind: wantsMarketingCreative ? 'marketing_image_composite' : 'raster_image_edit',
    documentSignals: detectPhotoshopDocumentSignals(text),
    operations,
    controlOrder: [
      'Resolve the exact .psd/.psb/image file or staged package folder and verify source/destination paths.',
      'Open or focus Adobe Photoshop, then run document status and layer inventory before any mutation.',
      'Capture dimensions, color mode/profile, active selection, layer names, visibility/locks, text layers, smart objects, and linked assets.',
      'Prefer script-backed Photoshop DOM/action tools for layer, text, export, and document-state changes.',
      'Use semantic menu/accessibility actions for known Photoshop commands only after document evidence is fresh.',
      'Use screenshots and exported raster proofs to verify the visible image state before save/export handoff.',
    ],
    requiredInventory: [
      'active document name/path, saved/modified state, dimensions, resolution, and color mode/profile',
      'layer count plus names, visibility, lock state, text layers, masks, smart objects, and adjustment layers',
      'active selection or mask state before generative/content-aware edits',
      'linked/embedded asset status and source sidecars for placed graphics',
      'history snapshot or duplicate/non-destructive layer plan before destructive pixel edits',
      ...(creativeAiPlan ? ['creative AI prompt, brand/style constraints, target layer/selection/canvas, generated asset receipts, and output proof destination'] : []),
    ],
    approvalGates: [
      'destructive pixel edits, flattening, rasterizing, or deleting layers',
      'generative fill, content-aware fill, AI image generation, or background replacement',
      ...(creativeAiPlan ? ['Firefly/Photoshop API generation, generative expand, batch variants, cloud uploads, or generated asset placement'] : []),
      'editing text layers or replacing placed/smart-object assets',
      'saving over the source Photoshop/image file',
      'exporting final raster deliverables',
    ],
    verificationSignals: [
      'post-change Photoshop layer inventory shows requested layer/text/asset updates',
      'document status reports expected dimensions, color mode, and no unexpected missing linked assets',
      'fresh screenshot or raster proof export shows the visible image/composite state',
      'file_stat confirms exported proof or deliverable output path when requested',
      ...(creativeAiPlan ? ['AI generation, expansion, or variation outputs have receipts plus before/after layer/proof evidence'] : []),
    ],
    recoveryRules: [
      'If the expected document is not active/open, open the exact staged file instead of editing another image.',
      'If NO document is open at all, create one with desktop.photoshop_create_document (use the requested pixel dimensions; a blank document is the expected starting state for from-scratch work) instead of stopping.',
      'If no selection/mask exists for a localized edit, ask for target-area clarification before using generative/content-aware fill.',
      'If the requested change is destructive, duplicate the layer or create a history snapshot before mutation.',
      'If linked assets or fonts are missing, resolve package sidecars before visual edits or exports.',
      'If script-backed tools cannot express the requested Photoshop operation, delegate a bounded app-capability buildout before using blind coordinates.',
      ...(creativeAiPlan ? creativeAiPlan.failClosedRules : []),
      ...surfacePlan.failSafeRules,
    ],
    recommendedTools: [
      'desktop.file_search',
      'desktop.file_stat',
      'desktop.open_path',
      'desktop.launch_app',
      'desktop.focus_app',
      'desktop.photoshop_create_document',
      'desktop.photoshop_document_status',
      'desktop.photoshop_layer_inventory',
      'desktop.photoshop_set_layer_state',
      'desktop.photoshop_update_text_layer',
      'desktop.photoshop_place_asset',
      'desktop.photoshop_export_proof',
      ...(creativeAiPlan ? ['research.search', 'agent.build_app_capability'] : []),
      'desktop.read_a11y_tree',
      'desktop.menu_click',
      'desktop.screenshot',
      'approvals.request',
    ],
    controlSurfaceOrder: surfacePlan.candidates.map((surface) => surface.label),
    controlSurfaceSourceRefs: [
      ...surfacePlan.sourceRefs.map((ref) => `${ref.label}: ${ref.url}`),
      ...(creativeAiPlan?.sourceRefs.map((ref) => `${ref.label}: ${ref.url}`) || []),
    ],
    failSafeRules: surfacePlan.failSafeRules,
    creativeAiCapabilities: creativeAiPlan?.capabilities.map((capability) => capability.id),
  };
}

export function buildDesignAppAutomationPlan(task: string): DesignAppAutomationPlan | null {
  const text = planningTextForTask(task);
  if (!shouldUseDesignAppAutomation(text)) return null;
  const explicitPhotoshop = hasExplicitPhotoshopTarget(text);
  const explicitInDesign = hasExplicitInDesignTarget(text);
  if (explicitPhotoshop && !explicitInDesign) return buildPhotoshopPlan(text);
  if (PHOTOSHOP_RE.test(text) && !INDESIGN_RE.test(text)) return buildPhotoshopPlan(text);
  return buildInDesignPlan(text);
}

export function buildDesignAppAutomationPromptBlock(task: string): string | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;
  return [
    '## Design App Automation Plan',
    `Target app: ${plan.appName} (${plan.appId})`,
    `Task kind: ${plan.taskKind}`,
    `Document signals: ${plan.documentSignals.join(' | ')}`,
    `Detected operations: ${plan.operations.join(' | ')}`,
    plan.creativeAiCapabilities?.length ? `Creative AI capabilities: ${plan.creativeAiCapabilities.join(' | ')}` : null,
    `Control order: ${plan.controlOrder.join(' | ')}`,
    `Required inventory: ${plan.requiredInventory.join(' | ')}`,
    `Approval gates: ${plan.approvalGates.join(' | ')}`,
    `Verification signals: ${plan.verificationSignals.join(' | ')}`,
    `Recovery rules: ${plan.recoveryRules.join(' | ')}`,
    `Control surface order: ${plan.controlSurfaceOrder.join(' | ')}`,
    `Fail-safe rules: ${plan.failSafeRules.join(' | ')}`,
    `Research/source refs: ${plan.controlSurfaceSourceRefs.join(' | ')}`,
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
  ].filter(Boolean).join('\n');
}
