import { buildAppAutomationControlSurfacePlan } from './appAutomationControlSurfaces';

export type AdobeCreativeCloudAppCategory =
  | 'layout'
  | 'raster_image'
  | 'vector_design'
  | 'photo'
  | 'video'
  | 'motion'
  | 'audio'
  | 'animation'
  | 'pdf'
  | 'web'
  | 'asset_manager'
  | 'document_collaboration'
  | 'generative_ai'
  | 'mobile_capture'
  | 'review_collaboration'
  | '3d';

export type AdobeCreativeCloudControlSurface =
  | 'script_dom'
  | 'actions'
  | 'plugin_sdk'
  | 'command_line'
  | 'dynamic_link'
  | 'batch_processor'
  | 'semantic_desktop'
  | 'agent_buildout';

export interface AdobeCreativeCloudAppProfile {
  id: string;
  appName: string;
  category: AdobeCreativeCloudAppCategory;
  aliases: string[];
  fileExtensions: string[];
  taskSignals: string[];
  controlSurfaces: AdobeCreativeCloudControlSurface[];
  firstObservations: string[];
  safeActionOrder: string[];
  verificationSignals: string[];
  approvalGates: string[];
}

export interface AdobeCreativeCloudAutomationPlan {
  profile: AdobeCreativeCloudAppProfile;
  recommendedTools: string[];
  observeFirst: string[];
  actionOrder: string[];
  verificationOrder: string[];
  recoveryPolicy: string[];
  approvalCheckpoints: string[];
  bridgeRequirements: string[];
  controlSurfaceOrder: string[];
  researchSourceRefs: string[];
}

const COMMON_TOOLS = [
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.open_path',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.window_state',
  'desktop.read_a11y_tree',
  'desktop.screenshot',
  'desktop.menu_click',
  'desktop.press_keys',
  'approvals.request',
];

export const ADOBE_CREATIVE_CLOUD_APP_PROFILES: AdobeCreativeCloudAppProfile[] = [
  {
    id: 'adobe_indesign',
    appName: 'Adobe InDesign',
    category: 'layout',
    aliases: ['indesign', 'in design', 'indd', 'idml'],
    fileExtensions: ['indd', 'idml', 'indt', 'icml'],
    taskSignals: ['layout', 'print', 'preflight', 'package', 'data merge', 'text frames'],
    controlSurfaces: ['script_dom', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.file_stat'],
    safeActionOrder: ['Use InDesign DOM bridge tools for text, links, proof export, and package handoff before menu control.'],
    verificationSignals: ['refreshed document status', 'text inventory', 'proof or package file_stat'],
    approvalGates: ['text/link mutation', 'save', 'export', 'package', 'new scripts'],
  },
  {
    id: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    category: 'raster_image',
    aliases: ['photoshop', 'photo shop', 'psd', 'psb'],
    fileExtensions: ['psd', 'psb', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp'],
    taskSignals: ['layers', 'mask', 'selection', 'retouch', 'generative fill', 'content-aware'],
    controlSurfaces: ['script_dom', 'actions', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.file_stat'],
    safeActionOrder: ['Use Photoshop document/layer bridge tools and actions before visual menu control.'],
    verificationSignals: ['refreshed layer inventory', 'document status', 'raster proof export or screenshot'],
    approvalGates: ['destructive pixel edit', 'generative edit', 'save over source', 'export'],
  },
  {
    id: 'adobe_photoshop_express',
    appName: 'Adobe Photoshop Express',
    category: 'raster_image',
    aliases: ['photoshop express', 'adobe photoshop express'],
    fileExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    taskSignals: ['quick edit', 'resize', 'collage', 'filter', 'remove background'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.window_state', 'desktop.screenshot', 'desktop.file_stat'],
    safeActionOrder: ['Confirm the source image and quick-action target, use semantic controls where available, then verify exported output.'],
    verificationSignals: ['before/after screenshot', 'exported image file_stat'],
    approvalGates: ['destructive image edit', 'save over source', 'export/share'],
  },
  {
    id: 'adobe_illustrator',
    appName: 'Adobe Illustrator',
    category: 'vector_design',
    aliases: ['illustrator', 'adobe illustrator', 'ai file', 'vector art'],
    fileExtensions: ['ai', 'ait', 'eps', 'svg', 'pdf'],
    taskSignals: ['logo', 'vector', 'artboard', 'path', 'anchor', 'swatch', 'outline', 'svg export'],
    controlSurfaces: ['script_dom', 'actions', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Resolve the exact AI/SVG/EPS file, inspect artboards/layers via a script capability when available, then mutate one vector object or export at a time.'],
    verificationSignals: ['artboard/layer inventory', 'exported SVG/PDF/PNG file_stat', 'before/after screenshot'],
    approvalGates: ['editing vector paths/layers', 'outline/expand/rasterize', 'save over source', 'export deliverable'],
  },
  {
    id: 'adobe_premiere_pro',
    appName: 'Adobe Premiere Pro',
    category: 'video',
    aliases: ['premiere', 'premiere pro', 'adobe premiere', 'prproj'],
    fileExtensions: ['prproj', 'prfpset', 'mogrt', 'mp4', 'mov'],
    taskSignals: ['timeline', 'sequence', 'clip', 'caption', 'audio sync', 'color grade', 'export video'],
    controlSurfaces: ['script_dom', 'plugin_sdk', 'dynamic_link', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Confirm project/sequence, collect timeline state, stage edits through scripting or stable menus, then export only after approval.'],
    verificationSignals: ['active project/sequence name', 'timeline screenshot', 'exported media file_stat'],
    approvalGates: ['timeline edits', 'media relink', 'render/export', 'overwrite project/media'],
  },
  {
    id: 'adobe_after_effects',
    appName: 'Adobe After Effects',
    category: 'motion',
    aliases: ['after effects', 'ae', 'adobe ae', 'aep', 'motion graphics'],
    fileExtensions: ['aep', 'aepx', 'jsx', 'ffx', 'mogrt'],
    taskSignals: ['composition', 'comp', 'layer', 'keyframe', 'expression', 'render queue', 'motion graphics'],
    controlSurfaces: ['script_dom', 'plugin_sdk', 'dynamic_link', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Confirm project and active composition, inspect layer/keyframe targets through scripting when available, then render through a verified queue path.'],
    verificationSignals: ['active comp/layer inventory', 'render queue state', 'exported render file_stat'],
    approvalGates: ['composition edits', 'expression/script changes', 'render/export', 'overwrite project/media'],
  },
  {
    id: 'adobe_acrobat',
    appName: 'Adobe Acrobat',
    category: 'pdf',
    aliases: ['acrobat', 'acrobat pro', 'adobe acrobat', 'pdf'],
    fileExtensions: ['pdf', 'fdf', 'xfdf'],
    taskSignals: ['pdf', 'form fields', 'redaction', 'ocr', 'combine', 'sign', 'accessibility'],
    controlSurfaces: ['script_dom', 'actions', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Inspect the PDF/page/form state, prefer Acrobat JavaScript/actions for field/OCR/export work, and gate signatures/redactions.'],
    verificationSignals: ['page count or form-field inventory', 'exported/optimized PDF file_stat', 'visible page screenshot'],
    approvalGates: ['redaction', 'signature', 'form submission', 'save over source', 'combine/split output'],
  },
  {
    id: 'adobe_acrobat_reader',
    appName: 'Adobe Acrobat Reader',
    category: 'pdf',
    aliases: ['acrobat reader', 'adobe reader', 'adobe acrobat reader'],
    fileExtensions: ['pdf', 'fdf', 'xfdf'],
    taskSignals: ['view pdf', 'comment', 'fill form', 'print pdf', 'signature'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Inspect the PDF/viewer state, fill or annotate only explicit fields/comments, and avoid destructive Acrobat Pro operations.'],
    verificationSignals: ['visible page screenshot', 'filled/commented state', 'saved/exported PDF file_stat'],
    approvalGates: ['signature', 'form submission', 'save over source', 'print/share'],
  },
  {
    id: 'adobe_lightroom_classic',
    appName: 'Adobe Lightroom Classic',
    category: 'photo',
    aliases: ['lightroom classic', 'lightroom catalog', 'lrcat'],
    fileExtensions: ['lrcat', 'dng', 'xmp', 'cr2', 'nef', 'arw', 'raf', 'orf', 'rw2'],
    taskSignals: ['catalog', 'develop preset', 'photo batch', 'raw edit', 'export photos'],
    controlSurfaces: ['plugin_sdk', 'batch_processor', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.screenshot'],
    safeActionOrder: ['Confirm catalog and selected photos, prefer preset/batch/plugin workflows, then export to a verified output folder.'],
    verificationSignals: ['selected photo count', 'catalog/output folder file_stat', 'exported image samples'],
    approvalGates: ['batch metadata edits', 'delete/reject photos', 'export/overwrite photos', 'catalog mutation'],
  },
  {
    id: 'adobe_lightroom',
    appName: 'Adobe Lightroom',
    category: 'photo',
    aliases: ['lightroom', 'adobe lightroom'],
    fileExtensions: ['dng', 'xmp', 'jpg', 'jpeg', 'png', 'tif', 'tiff'],
    taskSignals: ['photo edit', 'preset', 'album', 'raw', 'export photos'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Confirm album/photo selection, make one reversible edit or preset application, then verify before export.'],
    verificationSignals: ['selected photo/album state', 'before/after screenshot', 'exported file_stat'],
    approvalGates: ['batch edits', 'delete/reject photos', 'cloud sync changes', 'export/overwrite'],
  },
  {
    id: 'adobe_audition',
    appName: 'Adobe Audition',
    category: 'audio',
    aliases: ['audition', 'adobe audition', 'sesx'],
    fileExtensions: ['sesx', 'wav', 'aif', 'aiff', 'mp3', 'flac'],
    taskSignals: ['audio cleanup', 'noise reduction', 'multitrack', 'podcast', 'export audio'],
    controlSurfaces: ['batch_processor', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Confirm session/audio file, inspect duration/tracks where possible, apply one effect chain, then export a verified audio proof.'],
    verificationSignals: ['session/file path', 'exported audio file_stat', 'visible waveform/multitrack screenshot'],
    approvalGates: ['destructive audio processing', 'overwrite source', 'export/master deliverable'],
  },
  {
    id: 'adobe_animate',
    appName: 'Adobe Animate',
    category: 'animation',
    aliases: ['animate', 'adobe animate', 'flash animate', 'fla'],
    fileExtensions: ['fla', 'xfl', 'swf', 'html'],
    taskSignals: ['timeline', 'symbol', 'keyframe', 'animation', 'html5 canvas export'],
    controlSurfaces: ['script_dom', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Confirm document/timeline, inspect symbols/layers through scripting when available, edit one animation element, then export a proof.'],
    verificationSignals: ['timeline/layer state', 'published HTML/SWF/video file_stat', 'preview screenshot'],
    approvalGates: ['timeline edits', 'symbol edits', 'publish/export', 'overwrite source'],
  },
  {
    id: 'adobe_media_encoder',
    appName: 'Adobe Media Encoder',
    category: 'video',
    aliases: ['media encoder', 'adobe media encoder', 'ame'],
    fileExtensions: ['epr', 'mp4', 'mov', 'mxf', 'wav'],
    taskSignals: ['queue', 'transcode', 'encode', 'preset', 'render'],
    controlSurfaces: ['command_line', 'batch_processor', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.file_stat'],
    safeActionOrder: ['Confirm source media and output preset, add to queue with verified paths, start queue only after approval.'],
    verificationSignals: ['queue state', 'output folder file_stat', 'encoded media sample'],
    approvalGates: ['start queue', 'overwrite encoded output', 'delete source/intermediate media'],
  },
  {
    id: 'adobe_bridge',
    appName: 'Adobe Bridge',
    category: 'asset_manager',
    aliases: ['bridge', 'adobe bridge', 'asset browser'],
    fileExtensions: ['xmp', 'jpg', 'jpeg', 'png', 'psd', 'ai', 'indd', 'pdf'],
    taskSignals: ['metadata', 'batch rename', 'asset review', 'contact sheet', 'collection'],
    controlSurfaces: ['script_dom', 'batch_processor', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_search', 'desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Resolve the asset folder, inspect selection/count, stage metadata or batch operations, then verify files afterward.'],
    verificationSignals: ['asset count', 'metadata/file_stat sample', 'selection screenshot'],
    approvalGates: ['batch rename', 'metadata write', 'delete/move assets', 'export contact sheet'],
  },
  {
    id: 'adobe_capture',
    appName: 'Adobe Capture',
    category: 'mobile_capture',
    aliases: ['adobe capture', 'capture app'],
    fileExtensions: ['svg', 'ase', 'aco', 'png', 'jpg', 'jpeg'],
    taskSignals: ['capture color', 'palette', 'pattern', 'brush', 'shape', 'asset library'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['browser.verification_state', 'browser.dom_snapshot', 'desktop.screenshot'],
    safeActionOrder: ['Confirm source image/library target, prefer exported Creative Cloud library artifacts, and verify downloaded or synced assets.'],
    verificationSignals: ['library/asset state', 'exported palette/vector/image file_stat', 'screenshot proof'],
    approvalGates: ['library publish/share', 'paid/synced actions', 'download/export'],
  },
  {
    id: 'adobe_dreamweaver',
    appName: 'Adobe Dreamweaver',
    category: 'web',
    aliases: ['dreamweaver', 'adobe dreamweaver'],
    fileExtensions: ['html', 'htm', 'css', 'js', 'php'],
    taskSignals: ['site files', 'html', 'css', 'template', 'preview', 'publish'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_search', 'desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Prefer direct file edits and preview tests, use Dreamweaver only for site/project-specific visual workflows.'],
    verificationSignals: ['file diff or preview', 'browser screenshot', 'saved file_stat'],
    approvalGates: ['publish/upload', 'overwrite site files', 'credentialed FTP/server changes'],
  },
  {
    id: 'adobe_incopy',
    appName: 'Adobe InCopy',
    category: 'document_collaboration',
    aliases: ['incopy', 'adobe incopy', 'icml'],
    fileExtensions: ['icml', 'incx', 'indd', 'idml'],
    taskSignals: ['copyfit', 'story', 'editorial', 'tracked changes', 'assignment'],
    controlSurfaces: ['script_dom', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Confirm assignment/story, inspect overset/copyfit state, update copy with tracking policy, then verify story status.'],
    verificationSignals: ['story/copyfit state', 'tracked change status', 'saved file_stat'],
    approvalGates: ['story edits', 'accept/reject changes', 'save over assignment/source'],
  },
  {
    id: 'adobe_character_animator',
    appName: 'Adobe Character Animator',
    category: 'animation',
    aliases: ['character animator', 'adobe character animator', 'chproj'],
    fileExtensions: ['chproj', 'puppet', 'psd', 'ai'],
    taskSignals: ['puppet', 'rig', 'scene', 'performance', 'lip sync', 'export animation'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.screenshot'],
    safeActionOrder: ['Confirm project/puppet/scene, inspect visible rig or timeline state, make one puppet/scene change, then export proof media.'],
    verificationSignals: ['scene/puppet screenshot', 'exported media file_stat'],
    approvalGates: ['rig edits', 'record/performance changes', 'export/overwrite'],
  },
  {
    id: 'frame_io',
    appName: 'Frame.io',
    category: 'review_collaboration',
    aliases: ['frame.io', 'frame io', 'adobe frame.io', 'adobe frame io'],
    fileExtensions: ['mp4', 'mov', 'mxf', 'wav', 'pdf'],
    taskSignals: ['review link', 'video review', 'comments', 'approval', 'upload cut'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['browser.verification_state', 'browser.dom_snapshot', 'desktop.file_stat'],
    safeActionOrder: ['Resolve project/link and source media, use browser/API-style semantic actions, draft comments or uploads before approval.'],
    verificationSignals: ['project/link state', 'uploaded media file_stat', 'comment/review status screenshot'],
    approvalGates: ['upload/share', 'public review link', 'approval status changes', 'external comments'],
  },
  {
    id: 'adobe_express',
    appName: 'Adobe Express',
    category: 'generative_ai',
    aliases: ['adobe express', 'express'],
    fileExtensions: ['png', 'jpg', 'jpeg', 'mp4', 'pdf'],
    taskSignals: ['social post', 'template', 'brand kit', 'quick action', 'resize'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['browser.verification_state', 'browser.dom_snapshot', 'desktop.screenshot'],
    safeActionOrder: ['Use browser/app semantic state for template selection, keep brand/output choices explicit, and verify downloaded/exported artifacts.'],
    verificationSignals: ['template/design state', 'downloaded/exported file_stat', 'screenshot proof'],
    approvalGates: ['publish/share', 'brand kit changes', 'paid/generative actions', 'download/export'],
  },
  {
    id: 'adobe_firefly',
    appName: 'Adobe Firefly',
    category: 'generative_ai',
    aliases: ['firefly', 'adobe firefly'],
    fileExtensions: ['png', 'jpg', 'jpeg', 'svg'],
    taskSignals: ['text to image', 'generative fill', 'generative expand', 'style reference'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['browser.verification_state', 'browser.dom_snapshot', 'desktop.screenshot'],
    safeActionOrder: ['Confirm prompt, references, content policy constraints, and output count before generation; verify selected download.'],
    verificationSignals: ['prompt/settings snapshot', 'chosen output screenshot', 'downloaded file_stat'],
    approvalGates: ['paid/generative action', 'using sensitive reference images', 'publish/share/download final'],
  },
  {
    id: 'adobe_fresco',
    appName: 'Adobe Fresco',
    category: 'raster_image',
    aliases: ['fresco', 'adobe fresco'],
    fileExtensions: ['psd', 'png', 'jpg', 'jpeg'],
    taskSignals: ['brush', 'drawing', 'illustration', 'live brushes', 'sketch'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.window_state', 'desktop.screenshot', 'desktop.file_stat'],
    safeActionOrder: ['Confirm canvas/file, use visual state for brush/layer tasks, and export a proof before overwriting source art.'],
    verificationSignals: ['canvas screenshot', 'exported image file_stat'],
    approvalGates: ['destructive drawing edits', 'layer merge/delete', 'export/overwrite'],
  },
  {
    id: 'adobe_scan',
    appName: 'Adobe Scan',
    category: 'mobile_capture',
    aliases: ['adobe scan', 'scan app'],
    fileExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
    taskSignals: ['scan document', 'ocr', 'receipt scan', 'mobile scan'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['browser.verification_state', 'browser.dom_snapshot', 'desktop.file_stat'],
    safeActionOrder: ['Confirm scanned document/source, use OCR/export workflows, and verify saved PDF/image output.'],
    verificationSignals: ['OCR/export state', 'saved PDF/image file_stat'],
    approvalGates: ['upload/share', 'save over source', 'OCR/export sensitive documents'],
  },
  {
    id: 'adobe_fill_sign',
    appName: 'Adobe Fill & Sign',
    category: 'pdf',
    aliases: ['adobe fill sign', 'fill sign', 'fill and sign', 'fill & sign'],
    fileExtensions: ['pdf', 'fdf', 'xfdf'],
    taskSignals: ['fill form', 'signature', 'initials', 'send signed', 'signed pdf'],
    controlSurfaces: ['semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot'],
    safeActionOrder: ['Inspect the PDF form, fill explicit non-secret fields, stop before signing or sending unless approved.'],
    verificationSignals: ['filled field screenshot', 'saved signed PDF file_stat'],
    approvalGates: ['signature/initials', 'send/share signed document', 'save over source'],
  },
  {
    id: 'adobe_substance_3d',
    appName: 'Adobe Substance 3D',
    category: '3d',
    aliases: ['substance 3d', 'substance painter', 'substance designer', 'substance sampler', 'substance stager'],
    fileExtensions: ['spp', 'sbs', 'sbsar', 'obj', 'fbx', 'glb', 'gltf', 'usd', 'usdz'],
    taskSignals: ['material', 'texture', '3d model', 'bake', 'render', 'stage'],
    controlSurfaces: ['plugin_sdk', 'command_line', 'semantic_desktop', 'agent_buildout'],
    firstObservations: ['desktop.file_stat', 'desktop.window_state', 'desktop.screenshot', 'desktop.read_a11y_tree'],
    safeActionOrder: ['Confirm project/model/material, inspect viewport/output settings, make one material or scene change, then render/export proof.'],
    verificationSignals: ['viewport screenshot', 'exported texture/model/render file_stat'],
    approvalGates: ['destructive material/model edits', 'bake/export', 'overwrite project/assets'],
  },
];

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const GENERIC_ADOBE_ALIASES = new Set([
  'ae',
  'ame',
  'animate',
  'bridge',
  'capture app',
  'express',
  'fill sign',
  'fill and sign',
  'pdf',
  'scan app',
]);

const GENERIC_ADOBE_EXTENSIONS = new Set([
  'html',
  'jpg',
  'jpeg',
  'mov',
  'mp3',
  'mp4',
  'obj',
  'pdf',
  'png',
  'svg',
  'wav',
  'webp',
]);

function profileScore(profile: AdobeCreativeCloudAppProfile, task: string): number {
  const text = normalizeText(task);
  const raw = String(task || '').toLowerCase();
  const hasAdobeContext = /\badobe\b|\bcreative\s+cloud\b/.test(raw);
  let score = 0;
  let strongMatch = false;
  for (const alias of profile.aliases) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) continue;
    if (new RegExp(`\\b${normalizedAlias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
      const genericAlias = GENERIC_ADOBE_ALIASES.has(normalizedAlias);
      if (!genericAlias || hasAdobeContext || normalizedAlias.includes('adobe')) {
        score += genericAlias ? 4 : 5;
        strongMatch = true;
      } else {
        score += 1;
      }
    }
  }
  for (const ext of profile.fileExtensions) {
    if (new RegExp(`\\.${ext}\\b`, 'i').test(raw)) {
      const genericExtension = GENERIC_ADOBE_EXTENSIONS.has(ext);
      if (!genericExtension || hasAdobeContext) {
        score += genericExtension ? 4 : 6;
        strongMatch = true;
      } else {
        score += 1;
      }
    }
  }
  for (const signal of profile.taskSignals) {
    const normalizedSignal = normalizeText(signal);
    if (normalizedSignal && new RegExp(`\\b${normalizedSignal.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
      score += hasAdobeContext ? 2 : 1;
      if (hasAdobeContext) strongMatch = true;
    }
  }
  if (/\badobe\b|\bcreative\s+cloud\b/.test(raw) && score > 0) score += 2;
  if (!strongMatch) return 0;
  return score;
}

export function getAdobeCreativeCloudAppProfiles(): AdobeCreativeCloudAppProfile[] {
  return ADOBE_CREATIVE_CLOUD_APP_PROFILES.slice();
}

export function findAdobeCreativeCloudAppProfile(task: string): AdobeCreativeCloudAppProfile | null {
  const ranked = ADOBE_CREATIVE_CLOUD_APP_PROFILES
    .map((profile) => ({ profile, score: profileScore(profile, task) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.profile.appName.localeCompare(b.profile.appName));
  return ranked[0]?.profile || null;
}

export function isAdobeCreativeCloudTask(task: string): boolean {
  if (findAdobeCreativeCloudAppProfile(task)) return true;
  const text = String(task || '');
  return /\badobe\b|\bcreative\s+cloud\b/i.test(text) &&
    /\b(open|launch|edit|change|update|create|make|export|render|encode|retouch|animate|vector|photo|video|audio|pdf|layout|design|asset|proof|package)\b/i.test(text);
}

export function buildAdobeCreativeCloudAutomationPlan(task: string): AdobeCreativeCloudAutomationPlan | null {
  const profile = findAdobeCreativeCloudAppProfile(task);
  if (!profile) return null;
  const surfacePlan = buildAppAutomationControlSurfacePlan(task, {
    targetId: profile.id === 'adobe_indesign'
      ? 'adobe_indesign'
      : profile.id === 'adobe_photoshop'
        ? 'adobe_photoshop'
        : 'adobe_creative_cloud',
    targetName: profile.appName,
  });
  return {
    profile,
    recommendedTools: uniqueStrings([
      ...COMMON_TOOLS,
      ...(profile.id === 'adobe_indesign'
        ? ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_package_document', 'desktop.indesign_export_proof']
        : []),
      ...(profile.id === 'adobe_photoshop'
        ? ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_export_proof']
        : []),
      'office.list_agents',
      'research.search',
      'agent.build_app_capability',
    ]),
    observeFirst: uniqueStrings([
      `Identify target app as ${profile.appName}.`,
      'Resolve the exact source file/package and output folder before opening or editing.',
      ...surfacePlan.observeFirst,
      ...profile.firstObservations,
      'Search existing app recipes and official Adobe/OS automation docs before adding a new bridge tool.',
    ]),
    actionOrder: uniqueStrings([
      ...profile.safeActionOrder,
      `Use this researched control-surface order: ${surfacePlan.candidates.map((candidate) => candidate.label).join(' -> ')}.`,
      'Use app-native scripting, actions, command queues, or documented plugin surfaces before accessibility/menu control.',
      'Perform one reversible action at a time and verify state before continuing.',
      'If this app lacks a script-backed adapter for the requested operation, call agent.build_app_capability with the app profile, file type, desired action, and required smoke.',
    ]),
    verificationOrder: uniqueStrings([
      ...profile.verificationSignals,
      'fresh app/window evidence after every mutation',
      'file_stat for exported, rendered, saved, or packaged artifacts',
      'clear blocked state when app install, license, permissions, source assets, or credentials are missing',
    ]),
    recoveryPolicy: [
      'If the active app/document is mismatched, stop and reopen the exact staged file instead of editing the visible document.',
      'If a semantic target is missing twice, re-observe app state and delegate a bounded capability buildout rather than using blind coordinates.',
      'If the task requires an app-native API we do not have yet, build the smallest reusable adapter and smoke it before retrying.',
      ...surfacePlan.failSafeRules,
    ],
    approvalCheckpoints: uniqueStrings([
      ...profile.approvalGates,
      'desktop mutation',
      'running new scripts/actions/plugins',
      'overwriting source files',
    ]),
    bridgeRequirements: [
      'local desktop bridge with Accessibility permission',
      'Screen Recording permission for visual verification',
      'local file read/write grant for source packages and output folders',
      'connected Codex or compatible agent for missing Adobe app capability buildout',
    ],
    controlSurfaceOrder: surfacePlan.candidates.map((candidate) => candidate.label),
    researchSourceRefs: surfacePlan.sourceRefs.map((ref) => `${ref.label}: ${ref.url}`),
  };
}
