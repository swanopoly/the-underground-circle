import type { OpenSwanDesktopAttachmentLinkedCandidate } from './openSwanDesktopAttachmentAuthority';

export const DESKTOP_ATTACHMENT_TASK_MARKER = 'ATTACHED_DESKTOP_FILE_TASK';
export const DESKTOP_ATTACHMENT_MANIFEST_FILENAME = '_underground-circle-upload-manifest.json';

export interface ChatDesktopAttachmentCandidate {
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /** Present only after the exact persisted-message linkage barrier succeeds. */
  durableLink?: OpenSwanDesktopAttachmentLinkedCandidate | null;
}

export type DesktopAttachmentRequestIntent =
  | 'content_read'
  | 'desktop_open'
  | 'desktop_edit'
  | 'ambiguous';

export type DesktopAttachmentRequestClassification =
  | Readonly<{ intent: 'content_read'; supported: true }>
  | Readonly<{
      intent: 'desktop_open';
      supported: true;
      attachmentId: string;
      messageId: string;
    }>
  | Readonly<{
      intent: 'desktop_edit';
      supported: false;
      code: 'desktop_attachment_edit_not_supported';
    }>
  | Readonly<{
      intent: 'ambiguous';
      supported: false;
      code:
        | 'desktop_attachment_request_ambiguous'
        | 'desktop_attachment_linkage_required'
        | 'desktop_attachment_count_unsupported'
        | 'desktop_attachment_type_unsupported';
    }>;

export interface StagedDesktopAttachment extends ChatDesktopAttachmentCandidate {
  localPath: string;
  stageDirectory?: string | null;
  manifestPath?: string | null;
  sha256?: string | null;
  appName?: string | null;
}

export interface DesktopAttachmentPackageManifestFile {
  name: string;
  localPath: string;
  stageDirectory?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  appName?: string | null;
  role: 'primary' | 'sidecar';
}

export interface DesktopAttachmentPackageManifest {
  schemaVersion: 1;
  kind: 'underground_circle_desktop_attachment_package';
  createdAt: string;
  requestText: string;
  requestedOperation: 'open' | 'edit';
  stageDirectory?: string | null;
  manifestPath?: string | null;
  files: DesktopAttachmentPackageManifestFile[];
  preOpenFiles: string[];
  executionNotes: string[];
}

function extensionFor(name: string): string {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] || '';
}

function requestMentions(request: string, pattern: RegExp): boolean {
  return pattern.test(request);
}

/**
 * Closed-world app-name parser for the narrow desktop attachment open lane.
 * Keep this list aligned with DESKTOP_OPEN_ONLY_REQUEST_RE: it deliberately
 * recognizes only complete, reviewed product names and never fuzzy-matches an
 * arbitrary installed application name.
 */
const EXPLICIT_DESKTOP_ATTACHMENT_APPS = Object.freeze([
  { pattern: /\b(?:adobe\s+)?after\s+effects\b/i, appName: 'Adobe After Effects' },
  { pattern: /\b(?:adobe\s+)?premiere(?:\s+pro)?\b/i, appName: 'Adobe Premiere Pro' },
  { pattern: /\b(?:adobe\s+)?photoshop\b/i, appName: 'Adobe Photoshop' },
  { pattern: /\b(?:adobe\s+)?illustrator\b/i, appName: 'Adobe Illustrator' },
  { pattern: /\b(?:adobe\s+)?indesign\b|\badobe\s+in\s*design\b/i, appName: 'Adobe InDesign' },
  { pattern: /\b(?:adobe\s+)?acrobat\b/i, appName: 'Adobe Acrobat' },
  { pattern: /\b(?:microsoft\s+)?powerpoint\b/i, appName: 'Microsoft PowerPoint' },
  { pattern: /\b(?:microsoft\s+)?excel\b/i, appName: 'Microsoft Excel' },
  { pattern: /\b(?:microsoft\s+)?word\b/i, appName: 'Microsoft Word' },
  { pattern: /\bautodesk\s+inventor\b|\binventor\b/i, appName: 'Autodesk Inventor' },
  { pattern: /\bautodesk\s+maya\b|\bmaya\b/i, appName: 'Autodesk Maya' },
  { pattern: /\bfusion\s*360\b/i, appName: 'Fusion 360' },
  { pattern: /\bcinema\s*4d\b/i, appName: 'Cinema 4D' },
  { pattern: /\b3ds\s*max\b/i, appName: 'Autodesk 3ds Max' },
  { pattern: /\bsolid\s*works\b|\bsolidworks\b/i, appName: 'SOLIDWORKS' },
  { pattern: /\brhino(?:ceros)?\b/i, appName: 'Rhinoceros' },
  { pattern: /\bsketch\s*up\b|\bsketchup\b/i, appName: 'SketchUp' },
  { pattern: /\bauto\s*cad\b|\bautocad\b/i, appName: 'AutoCAD' },
  { pattern: /\blibre\s*cad\b|\blibrecad\b/i, appName: 'LibreCAD' },
  { pattern: /\bfreecad\b/i, appName: 'FreeCAD' },
  { pattern: /\bqcad\b/i, appName: 'QCAD' },
  { pattern: /\bmatlab\b/i, appName: 'MATLAB' },
  { pattern: /\bblender\b/i, appName: 'Blender' },
  { pattern: /\bfigma\b/i, appName: 'Figma' },
  { pattern: /\badobe\s+xd\b/i, appName: 'Adobe XD' },
  { pattern: /\bpreview\b/i, appName: 'Preview' },
  { pattern: /\bpages\b/i, appName: 'Pages' },
  { pattern: /\bnumbers\b/i, appName: 'Numbers' },
  { pattern: /\bkeynote\b/i, appName: 'Keynote' },
  { pattern: /\bsketch\b/i, appName: 'Sketch' },
  { pattern: /\brevit\b/i, appName: 'Revit' },
] as const);

export function resolveExplicitDesktopAttachmentApp(requestText: string): string | null {
  const request = String(requestText || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const appClause = request.match(
    /\b(?:in|into|with|using)\s+(?:the\s+)?(.+?)(?:,?\s+please)?[.!?]*$/i,
  )?.[1]?.trim();
  if (!appClause || /^default\s+(?:app|application)$/i.test(appClause)) return null;
  const matches = EXPLICIT_DESKTOP_ATTACHMENT_APPS
    .filter(({ pattern }) => {
      const match = appClause.match(pattern);
      return match?.index === 0 && match[0].length === appClause.length;
    })
    .map(({ appName }) => appName);
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0]! : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESKTOP_OPEN_REQUEST_RE = /\b(open|load|preview|show)\b/i;
const CONTENT_READ_REQUEST_RE = /\b(read|summari[sz]e|analy[sz]e|inspect|review|describe|transcribe|contents?|what(?:'s|\s+is)\s+in|answer\s+questions?)\b|\bextract\s+(?:the\s+)?text\b/i;
const DESKTOP_EDIT_REQUEST_RE = /\b(edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|convert|fix|modify|overwrite|delete|rename|apply|layout|typeset|place|fill|set|unzip|compress)\b|\bextract\s+(?:the\s+)?archive\b/i;
const DESKTOP_OPEN_ONLY_REQUEST_RE = new RegExp([
  '^',
  '(?:(?:please\\s+)|(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?))?',
  '(?:open|load|preview|show(?:\\s+me)?)\\s+',
  '(?:(?:the\\s+)?(?:attached|uploaded)\\s+(?:file|files|attachment|attachments|document|documents|image|images|photo|photos|picture|pictures|drawing|drawings|design|designs|project|projects|spreadsheet|spreadsheets|presentation|presentations|pdf|pdfs)',
  '|(?:the\\s+)?attachment',
  '|this(?:\\s+(?:file|attachment|document|image|photo|picture|drawing|design|project|spreadsheet|presentation|pdf))?',
  '|it)',
  '(?:\\s+(?:in|into|with|using)\\s+(?:the\\s+)?(?:',
  [
    'default\\s+(?:app|application)',
    '(?:adobe\\s+)?photoshop',
    '(?:adobe\\s+)?indesign',
    '(?:adobe\\s+)?illustrator',
    '(?:adobe\\s+)?premiere(?:\\s+pro)?',
    '(?:adobe\\s+)?after\\s+effects',
    '(?:adobe\\s+)?acrobat',
    'preview',
    '(?:microsoft\\s+)?word',
    '(?:microsoft\\s+)?excel',
    '(?:microsoft\\s+)?powerpoint',
    'pages',
    'numbers',
    'keynote',
    'figma',
    'sketch',
    'adobe\\s+xd',
    'freecad',
    'librecad',
    'qcad',
    'autocad',
    'fusion\\s+360',
    'matlab',
    'solidworks',
    'revit',
    'sketchup',
    'rhino(?:ceros)?',
    '(?:autodesk\\s+)?inventor',
    'blender',
    '(?:autodesk\\s+)?maya',
    'cinema\\s+4d',
    '3ds\\s+max',
  ].join('|'),
  '))?',
  '(?:,?\\s+please)?',
  '[.!?]*$',
].join(''), 'i');
const SAFE_ATTACHMENT_BASENAME_RE = /^[^\\/?#<>`\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]{1,120}$/u;
const SAFE_MIME_ESSENCE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const UNSAFE_DESKTOP_OPEN_EXTENSIONS = new Set([
  'app', 'dmg', 'pkg', 'mpkg', 'iso', 'img',
  'exe', 'msi', 'com', 'scr', 'bat', 'cmd', 'ps1', 'vbs', 'vbscript',
  'sh', 'bash', 'zsh', 'fish', 'command', 'workflow', 'scpt', 'applescript',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw', 'rb', 'pl', 'php', 'lua',
  'jar', 'class', 'war', 'wasm', 'dll', 'dylib', 'so', 'deb', 'rpm',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst',
]);
const SAFE_DESKTOP_OPEN_EXTENSIONS = new Set([
  // Plain documents and presentations (macro-enabled variants excluded).
  'pdf', 'txt', 'md', 'rtf', 'csv',
  'doc', 'docx', 'odt', 'pages',
  'xls', 'xlsx', 'ods', 'numbers',
  'ppt', 'pptx', 'odp', 'key',
  // Raster images and established design-document formats.
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff',
  'psd', 'psb', 'ai', 'eps', 'indd', 'idml', 'indt', 'fig', 'sketch', 'xd',
  // CAD/engineering/3D documents. These are opened only; edits remain barred.
  'dwg', 'dwt', 'dws', 'dxf', 'f3d', 'f3z', 'fcstd',
  'sldprt', 'sldasm', 'slddrw', 'rvt', 'rfa', 'rte', 'skp', '3dm', 'ipt', 'iam', 'idw',
  'blend', 'ma', 'mb', 'c4d', 'max', 'stl', 'step', 'stp', 'iges', 'igs',
  'obj', 'fbx', 'glb', 'gltf', 'usd', 'usdz',
]);
const UNSAFE_DESKTOP_OPEN_MIME_TYPES = new Set([
  'application/x-apple-diskimage',
  'application/x-iso9660-image',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-sh',
  'application/x-shellscript',
  'application/javascript',
  'text/javascript',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
  'application/java-archive',
  'application/vnd.android.package-archive',
]);

function classifyDesktopAttachmentLexicalIntent(requestText: string): DesktopAttachmentRequestIntent {
  const request = String(requestText || '').replace(/\s+/g, ' ').trim();
  // Mutation intent always wins; an "open, edit, and save" request cannot be
  // downgraded to the narrow reversible open lane.
  if (DESKTOP_EDIT_REQUEST_RE.test(request)) return 'desktop_edit';
  const wantsDesktopOpen = DESKTOP_OPEN_REQUEST_RE.test(request);
  const wantsContentRead = CONTENT_READ_REQUEST_RE.test(request);
  if (wantsDesktopOpen && wantsContentRead) return 'ambiguous';
  if (wantsContentRead) return 'content_read';
  if (DESKTOP_OPEN_ONLY_REQUEST_RE.test(request)) return 'desktop_open';
  // A lifecycle verb outside the closed grammar may carry another imperative,
  // target, source, or clause. It is never safe open authority.
  if (wantsDesktopOpen) return 'ambiguous';
  return 'ambiguous';
}

function exactDurableLink(
  candidate: ChatDesktopAttachmentCandidate | undefined,
): OpenSwanDesktopAttachmentLinkedCandidate | null {
  const link = candidate?.durableLink;
  if (
    !link
    || link.linkState !== 'durable_linked'
    || !UUID_RE.test(link.attachmentId)
    || !UUID_RE.test(link.messageId)
    || !UUID_RE.test(link.circleId)
    || !UUID_RE.test(link.threadId)
  ) return null;
  return link;
}

function isSafeDesktopOpenCandidate(candidate: ChatDesktopAttachmentCandidate | undefined): boolean {
  if (!candidate) return false;
  const name = String(candidate.name || '');
  const mimeType = String(candidate.mimeType || '').toLowerCase();
  if (
    name !== name.trim()
    || !SAFE_ATTACHMENT_BASENAME_RE.test(name)
    || name === '.'
    || name === '..'
    || !SAFE_MIME_ESSENCE_RE.test(mimeType)
  ) return false;
  const extension = extensionFor(name);
  return Boolean(extension)
    && SAFE_DESKTOP_OPEN_EXTENSIONS.has(extension)
    && !UNSAFE_DESKTOP_OPEN_EXTENSIONS.has(extension)
    && !UNSAFE_DESKTOP_OPEN_MIME_TYPES.has(mimeType);
}

/**
 * Closed-world request classifier for attachment routing. Content inspection
 * remains on `attachments.read_source`; desktop edits are deliberately
 * unsupported. Only one exact durably linked attachment and one explicit
 * open/load/preview/show request may enter `desktop.open_attachment`.
 */
export function classifyDesktopAttachmentRequest(input: Readonly<{
  requestText: string;
  attachments: ReadonlyArray<ChatDesktopAttachmentCandidate>;
}>): DesktopAttachmentRequestClassification {
  const intent = classifyDesktopAttachmentLexicalIntent(input.requestText);
  if (intent === 'desktop_edit') {
    return Object.freeze({
      intent,
      supported: false as const,
      code: 'desktop_attachment_edit_not_supported' as const,
    });
  }
  if (intent === 'content_read') {
    return Object.freeze({ intent, supported: true as const });
  }
  if (intent === 'ambiguous') {
    return Object.freeze({
      intent,
      supported: false as const,
      code: 'desktop_attachment_request_ambiguous' as const,
    });
  }
  if (!Array.isArray(input.attachments) || input.attachments.length !== 1) {
    return Object.freeze({
      intent: 'ambiguous' as const,
      supported: false as const,
      code: 'desktop_attachment_count_unsupported' as const,
    });
  }
  const link = exactDurableLink(input.attachments[0]);
  if (!link) {
    return Object.freeze({
      intent: 'ambiguous' as const,
      supported: false as const,
      code: 'desktop_attachment_linkage_required' as const,
    });
  }
  if (!isSafeDesktopOpenCandidate(input.attachments[0])) {
    return Object.freeze({
      intent: 'ambiguous' as const,
      supported: false as const,
      code: 'desktop_attachment_type_unsupported' as const,
    });
  }
  return Object.freeze({
    intent: 'desktop_open' as const,
    supported: true as const,
    attachmentId: link.attachmentId,
    messageId: link.messageId,
  });
}

export function buildDesktopAttachmentStageGroupName(requestText: string, date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const slug = String(requestText || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'desktop-file-task';
  return `${stamp}-${slug}`;
}

export function resolveDefaultDesktopAttachmentApp(
  attachment: ChatDesktopAttachmentCandidate,
): string | null {
  const ext = extensionFor(attachment.name);
  const mime = String(attachment.mimeType || '').toLowerCase();
  if (['psd', 'psb'].includes(ext)) return 'Adobe Photoshop';
  if (['ai', 'eps'].includes(ext)) return 'Adobe Illustrator';
  if (['indd', 'idml', 'indt'].includes(ext)) return 'Adobe InDesign';
  if (ext === 'pdf' || mime.startsWith('image/') || [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'usdz',
  ].includes(ext)) return 'Preview';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'Microsoft Word';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'Microsoft Excel';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'Microsoft PowerPoint';
  if (ext === 'pages') return 'Pages';
  if (ext === 'numbers') return 'Numbers';
  if (ext === 'key') return 'Keynote';
  if (ext === 'fig') return 'Figma';
  if (ext === 'sketch') return 'Sketch';
  if (ext === 'xd') return 'Adobe XD';
  if (['dwg', 'dwt', 'dws', 'dxf'].includes(ext)) return 'AutoCAD';
  if (['f3d', 'f3z', 'stl', 'step', 'stp', 'iges', 'igs'].includes(ext)) return 'Fusion 360';
  if (ext === 'fcstd') return 'FreeCAD';
  if (['sldprt', 'sldasm', 'slddrw'].includes(ext)) return 'SOLIDWORKS';
  if (['rvt', 'rfa', 'rte'].includes(ext)) return 'Revit';
  if (ext === 'skp') return 'SketchUp';
  if (ext === '3dm') return 'Rhinoceros';
  if (['ipt', 'iam', 'idw'].includes(ext)) return 'Autodesk Inventor';
  if (ext === 'blend') return 'Blender';
  if (['ma', 'mb'].includes(ext)) return 'Autodesk Maya';
  if (ext === 'c4d') return 'Cinema 4D';
  if (ext === 'max') return 'Autodesk 3ds Max';
  if (['obj', 'fbx', 'glb', 'gltf', 'usd'].includes(ext)) return 'Blender';
  return null;
}

export function inferDesktopAppForAttachment(
  attachment: ChatDesktopAttachmentCandidate,
  requestText = '',
): string | null {
  const ext = extensionFor(attachment.name);
  const mime = String(attachment.mimeType || '').toLowerCase();
  const request = String(requestText || '').toLowerCase();

  // An explicitly named, allowlisted app is the user's exact target. It must
  // win over extension defaults (for example PDF in Preview, PNG in Preview,
  // DOCX in Pages, XLSX in Numbers). Multiple app names fail closed.
  const explicitApp = resolveExplicitDesktopAttachmentApp(requestText);
  if (explicitApp) return explicitApp;
  if (DESKTOP_OPEN_ONLY_REQUEST_RE.test(String(requestText || '').replace(/\s+/g, ' ').trim())) {
    return resolveDefaultDesktopAttachmentApp(attachment);
  }

  if (['indd', 'idml', 'indt'].includes(ext) || requestMentions(request, /\bindesign|in\s*design\b/)) {
    return 'Adobe InDesign';
  }

  const isImage = mime.startsWith('image/')
    || ['psd', 'psb', 'tif', 'tiff', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext);
  const wantsPhotoshop = requestMentions(request, /\bphotoshop\b/)
    || (isImage && /\b(edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|filter|generative|fill|image|photo|picture)\b/.test(request));
  if (['psd', 'psb'].includes(ext) || wantsPhotoshop) return 'Adobe Photoshop';

  if (ext === 'pdf' || isImage) return 'Preview';

  if (['ai', 'eps'].includes(ext) || requestMentions(request, /\billustrator\b/)) return 'Adobe Illustrator';
  if (['prproj'].includes(ext) || requestMentions(request, /\bpremiere\b/)) return 'Adobe Premiere Pro';
  if (['aep', 'aepx'].includes(ext) || requestMentions(request, /\bafter effects\b/)) return 'Adobe After Effects';
  if (['pdf'].includes(ext) && requestMentions(request, /\bacrobat\b/)) return 'Adobe Acrobat';
  if (['doc', 'docx', 'rtf'].includes(ext) || requestMentions(request, /\bword\b/)) return 'Microsoft Word';
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(ext) || requestMentions(request, /\bexcel\b/)) return 'Microsoft Excel';
  if (['ppt', 'pptx'].includes(ext) || requestMentions(request, /\bpowerpoint\b/)) return 'Microsoft PowerPoint';
  if (['pages'].includes(ext)) return 'Pages';
  if (['numbers'].includes(ext)) return 'Numbers';
  if (['key'].includes(ext) || requestMentions(request, /\bkeynote\b/)) return 'Keynote';
  if (['fig'].includes(ext) || requestMentions(request, /\bfigma\b/)) return 'Figma';
  if (['sketch'].includes(ext) || requestMentions(request, /\bsketch\b/)) return 'Sketch';
  if (['xd'].includes(ext) || requestMentions(request, /\badobe xd\b|\bxd\b/)) return 'Adobe XD';
  if (requestMentions(request, /\bfreecad\b/)) return 'FreeCAD';
  if (requestMentions(request, /\blibre\s*cad\b|\blibrecad\b/)) return 'LibreCAD';
  if (requestMentions(request, /\bqcad\b/)) return 'QCAD';
  if (['dwg', 'dwt', 'dws'].includes(ext) || requestMentions(request, /\bauto\s*cad\b|\bautocad\b|\bcivil\s*3d\b/)) return 'AutoCAD';
  if (['dxf'].includes(ext)) {
    if (requestMentions(request, /\bfusion\s*360\b|\bfusion\b/)) return 'Fusion 360';
    if (requestMentions(request, /\bfreecad\b/)) return 'FreeCAD';
    if (requestMentions(request, /\blibre\s*cad\b|\blibrecad\b/)) return 'LibreCAD';
    if (requestMentions(request, /\bqcad\b/)) return 'QCAD';
    return 'AutoCAD';
  }
  if (['f3d', 'f3z'].includes(ext) || requestMentions(request, /\bfusion\s*360\b/)) return 'Fusion 360';
  if (['m', 'mlx', 'slx', 'mdl'].includes(ext) || requestMentions(request, /\bmatlab\b|\bsimulink\b|\bsimscape\b/)) return 'MATLAB';
  if (['fcstd'].includes(ext)) return 'FreeCAD';
  if (['sldprt', 'sldasm', 'slddrw'].includes(ext) || requestMentions(request, /\bsolid\s*works\b|\bsolidworks\b/)) return 'SOLIDWORKS';
  if (['rvt', 'rfa', 'rte'].includes(ext) || requestMentions(request, /\brevit\b/)) return 'Revit';
  if (['skp'].includes(ext) || requestMentions(request, /\bsketch\s*up\b|\bsketchup\b/)) return 'SketchUp';
  if (['3dm'].includes(ext) || requestMentions(request, /\brhino(?:ceros)?\b/)) return 'Rhinoceros';
  if (['ipt', 'iam', 'idw'].includes(ext) || requestMentions(request, /\binventor\b/)) return 'Autodesk Inventor';
  if (['blend'].includes(ext) || requestMentions(request, /\bblender\b/)) return 'Blender';
  if (['ma', 'mb'].includes(ext) || requestMentions(request, /\bmaya\b/)) return 'Autodesk Maya';
  if (['c4d'].includes(ext) || requestMentions(request, /\bcinema\s*4d\b/)) return 'Cinema 4D';
  if (['max'].includes(ext) || requestMentions(request, /\b3ds\s*max\b/)) return 'Autodesk 3ds Max';
  if (['stl', 'step', 'stp', 'iges', 'igs'].includes(ext)) {
    if (requestMentions(request, /\bsolid\s*works\b|\bsolidworks\b/)) return 'SOLIDWORKS';
    if (requestMentions(request, /\bfreecad\b/)) return 'FreeCAD';
    return 'Fusion 360';
  }
  if (['obj', 'fbx', 'glb', 'gltf', 'usd', 'usdz'].includes(ext)) {
    if (requestMentions(request, /\bfusion\s*360\b/)) return 'Fusion 360';
    return 'Blender';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archive Utility';

  return null;
}

export function isDesktopOpenableAttachment(attachment: ChatDesktopAttachmentCandidate): boolean {
  if (!String(attachment.name || '').trim()) return false;
  return true;
}

function isArchiveExtension(ext: string): boolean {
  return ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
}

function isSidecarAssetExtension(ext: string): boolean {
  return [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff',
    'otf', 'ttf', 'woff', 'woff2',
    'txt', 'md', 'json', 'xml', 'csv',
  ].includes(ext);
}

function isPrimaryDocumentExtension(ext: string): boolean {
  return [
    'indd', 'idml', 'indt',
    'psd', 'psb', 'ai', 'eps', 'pdf',
    'doc', 'docx', 'rtf', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'key', 'pages', 'numbers',
    'fig', 'sketch', 'xd',
    'dwg', 'dwt', 'dws', 'dxf', 'f3d', 'f3z', 'fcstd', 'sldprt', 'sldasm', 'slddrw',
    'rvt', 'rfa', 'rte', 'skp', '3dm', 'ipt', 'iam', 'idw',
    'blend', 'ma', 'mb', 'c4d', 'max', 'stl', 'step', 'stp', 'iges', 'igs', 'obj', 'fbx', 'glb', 'gltf', 'usd', 'usdz',
  ].includes(ext);
}

function userRequestTextFromDesktopAttachmentTask(taskOrRequest: string): string {
  const value = String(taskOrRequest || '');
  const match = value.match(/^User requested changes:\s*(.+)$/m);
  return match?.[1] || value;
}

export function selectDesktopAttachmentsToPreOpen(
  attachments: StagedDesktopAttachment[],
  requestText = '',
  maxCount = 4,
): StagedDesktopAttachment[] {
  const files = attachments.filter((attachment) => String(attachment.localPath || '').trim());
  if (files.length <= 1) return files.slice(0, maxCount);

  const request = userRequestTextFromDesktopAttachmentTask(requestText).toLowerCase();
  const wantsArchive = /\b(extract|unzip|archive|compress|open\s+(?:the\s+)?archive)\b/.test(request);
  const hasPrimaryDocument = files.some((file) => isPrimaryDocumentExtension(extensionFor(file.name)));
  const selected = files.filter((file) => {
    const ext = extensionFor(file.name);
    if (isArchiveExtension(ext)) return wantsArchive || !hasPrimaryDocument;
    if (hasPrimaryDocument && isSidecarAssetExtension(ext)) return false;
    return true;
  });

  return (selected.length > 0 ? selected : files).slice(0, maxCount);
}

export function isDesktopEditableAttachment(attachment: ChatDesktopAttachmentCandidate): boolean {
  const ext = extensionFor(attachment.name);
  const mime = String(attachment.mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return true;
  return [
    'indd', 'idml', 'indt',
    'psd', 'psb', 'ai', 'eps',
    'pdf',
    'doc', 'docx', 'rtf',
    'xls', 'xlsx', 'xlsm', 'csv',
    'ppt', 'pptx', 'key', 'pages', 'numbers',
    'fig', 'sketch', 'xd',
    'dwg', 'dwt', 'dws', 'dxf',
    'f3d', 'f3z', 'fcstd',
    'sldprt', 'sldasm', 'slddrw',
    'rvt', 'rfa', 'rte',
    'skp', '3dm', 'ipt', 'iam', 'idw',
    'blend', 'ma', 'mb', 'c4d', 'max',
    'stl', 'step', 'stp', 'iges', 'igs', 'obj', 'fbx', 'glb', 'gltf', 'usd', 'usdz',
    'txt', 'md', 'json', 'html', 'css', 'svg',
  ].includes(ext);
}

export function shouldRouteAttachedFilesToDesktop(
  requestText: string,
  attachments: ChatDesktopAttachmentCandidate[],
): boolean {
  const decision = classifyDesktopAttachmentRequest({ requestText, attachments });
  return decision.intent === 'desktop_open' && decision.supported;
}

export function requestLooksLikeDesktopAttachmentModification(requestText: string): boolean {
  const request = String(requestText || '').toLowerCase();
  return /\b(edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|convert|fix|make|create|apply|layout|typeset|proof|place|fill|set|rename|extract|unzip|compress|archive)\b/.test(request);
}

function directoryForLocalPath(localPath: string): string | null {
  const normalized = String(localPath || '').trim();
  const match = normalized.match(/^(.*)[/\\][^/\\]+$/);
  return match?.[1] || null;
}

function commonStageDirectory(attachments: StagedDesktopAttachment[]): string | null {
  const directories = attachments
    .map((attachment) => attachment.stageDirectory || directoryForLocalPath(attachment.localPath))
    .filter((directory): directory is string => Boolean(directory));
  const unique = Array.from(new Set(directories));
  return unique.length === 1 ? unique[0] : null;
}

function manifestPathForStageDirectory(stageDirectory: string | null): string | null {
  return stageDirectory ? `${stageDirectory.replace(/[\\/]+$/, '')}/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}` : null;
}

export function buildDesktopAttachmentPackageManifest(
  requestText: string,
  attachments: StagedDesktopAttachment[],
  date = new Date(),
): DesktopAttachmentPackageManifest {
  const operation = requestLooksLikeDesktopAttachmentModification(requestText) ? 'edit' : 'open';
  const stageDirectory = commonStageDirectory(attachments);
  const manifestPath = manifestPathForStageDirectory(stageDirectory);
  const preOpenFiles = selectDesktopAttachmentsToPreOpen(attachments, requestText, 4).map((attachment) => attachment.localPath);
  const preOpenSet = new Set(preOpenFiles);
  return {
    schemaVersion: 1,
    kind: 'underground_circle_desktop_attachment_package',
    createdAt: date.toISOString(),
    requestText: String(requestText || '').trim(),
    requestedOperation: operation,
    stageDirectory,
    manifestPath,
    files: attachments.map((attachment) => ({
      name: attachment.name,
      localPath: attachment.localPath,
      stageDirectory: attachment.stageDirectory || stageDirectory,
      mimeType: attachment.mimeType || null,
      sizeBytes: attachment.sizeBytes || null,
      sha256: attachment.sha256 || null,
      appName: attachment.appName || inferDesktopAppForAttachment(attachment, requestText),
      role: preOpenSet.has(attachment.localPath) ? 'primary' : 'sidecar',
    })),
    preOpenFiles,
    executionNotes: [
      'Use localPath values exactly; do not search for similarly named source files.',
      'Files in this folder came from one chat upload task and may reference each other.',
      'If editing is destructive or ambiguous, save a copy next to the staged file or ask for confirmation.',
    ],
  };
}

export function buildDesktopAttachmentComputerTask(
  requestText: string,
  attachments: StagedDesktopAttachment[],
): string {
  const requestClass = classifyDesktopAttachmentLexicalIntent(requestText);
  // Compatibility-only public projection. Real local paths live exclusively
  // in the runtime-private desktop capability; this string may be persisted,
  // logged, or sent to a provider. It therefore carries no request body,
  // filename, application hint, content, digest, or executable identity. It is
  // deliberately non-executable on its own.
  const lines = [
    DESKTOP_ATTACHMENT_TASK_MARKER,
    'Value-free compatibility descriptor. It carries no desktop attachment authority.',
    `Requested class: ${requestClass}`,
    `Attachment count: ${Math.min(Math.max(0, attachments.length), 100)}`,
    '',
  ];
  lines.push(
    'Execution rules:',
    '1. Do not infer, request, search for, or reconstruct a filename, local path, URL, storage key, signed URL, manifest path, or capability id.',
    '2. Dispatch nothing unless the authenticated runtime resolves an in-process desktop.open_attachment authority for the exact turn.',
    '3. Desktop edit requests are unsupported and must fail closed.',
    '4. This descriptor is neither approval nor completion proof.',
  );

  return lines.join('\n');
}

export function parseDesktopAttachmentTaskFiles(task: string): StagedDesktopAttachment[] {
  // Legacy prompt strings are untrusted and can never recreate local-file
  // authority. Kept as a typed compatibility seam for existing callers; the
  // only executable path is the process-private WeakMap authority.
  void task;
  return [];
}
