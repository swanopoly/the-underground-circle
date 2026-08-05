export const DESKTOP_ATTACHMENT_TASK_MARKER = 'ATTACHED_DESKTOP_FILE_TASK';
export const DESKTOP_ATTACHMENT_MANIFEST_FILENAME = '_underground-circle-upload-manifest.json';

export interface ChatDesktopAttachmentCandidate {
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

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

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function requestMentions(request: string, pattern: RegExp): boolean {
  return pattern.test(request);
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

export function inferDesktopAppForAttachment(
  attachment: ChatDesktopAttachmentCandidate,
  requestText = '',
): string | null {
  const ext = extensionFor(attachment.name);
  const mime = String(attachment.mimeType || '').toLowerCase();
  const request = String(requestText || '').toLowerCase();

  if (['indd', 'idml', 'indt'].includes(ext) || requestMentions(request, /\bindesign|in\s*design\b/)) {
    return 'Adobe InDesign';
  }

  const isImage = mime.startsWith('image/')
    || ['psd', 'psb', 'tif', 'tiff', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext);
  const wantsPhotoshop = requestMentions(request, /\bphotoshop\b/)
    || (isImage && /\b(edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|filter|generative|fill|image|photo|picture)\b/.test(request));
  if (['psd', 'psb'].includes(ext) || wantsPhotoshop) return 'Adobe Photoshop';

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
  if (attachments.length === 0) return false;
  const request = String(requestText || '').toLowerCase();
  if (!attachments.some(isDesktopOpenableAttachment)) return false;
  if (includesAny(request, [
    'indesign', 'in design', 'photoshop', 'illustrator', 'premiere', 'after effects', 'acrobat',
    'autocad', 'auto cad', 'fusion 360', 'solidworks', 'solid works', 'matlab', 'simulink', 'simscape', 'revit', 'sketchup', 'sketch up',
    'rhino', 'rhinoceros', 'inventor', 'blender', 'freecad', 'librecad', 'qcad', 'maya', 'cinema 4d', 'figma',
  ])) {
    return true;
  }
  return /\b(open|load|use|edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|convert|fix|make|create|apply|layout|typeset|proof|place|extract|unzip|compress|archive)\b/.test(request);
}

export function requestLooksLikeDesktopAttachmentModification(requestText: string): boolean {
  const request = String(requestText || '').toLowerCase();
  return /\b(edit|change|update|replace|resize|crop|retouch|remove|add|adjust|export|save|convert|fix|make|create|apply|layout|typeset|proof|place|fill|set|rename|extract|unzip|compress|archive)\b/.test(request);
}

function formatSize(sizeBytes?: number | null): string {
  const bytes = Number(sizeBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function commonManifestPath(attachments: StagedDesktopAttachment[]): string | null {
  const manifests = attachments
    .map((attachment) => attachment.manifestPath)
    .filter((manifest): manifest is string => Boolean(manifest));
  const unique = Array.from(new Set(manifests));
  return unique.length === 1 ? unique[0] : null;
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
  const operation = requestLooksLikeDesktopAttachmentModification(requestText) ? 'edit' : 'open';
  const stageDirectory = commonStageDirectory(attachments);
  const manifestPath = commonManifestPath(attachments) || manifestPathForStageDirectory(stageDirectory);
  const lines = [
    DESKTOP_ATTACHMENT_TASK_MARKER,
    'The user uploaded file(s) to chat. They have been staged on this Mac and must be used as the source files for this task.',
    `Requested operation: ${operation}`,
    '',
  ];

  if (stageDirectory) {
    lines.push(`Task staging folder: "${stageDirectory}"`, '');
  }

  if (manifestPath) {
    lines.push(`Package manifest: "${manifestPath}"`, '');
  }

  lines.push('Staged files:');

  for (const attachment of attachments) {
    const appName = attachment.appName || inferDesktopAppForAttachment(attachment, requestText);
    const hashSuffix = attachment.sha256 ? ` SHA-256: ${attachment.sha256}.` : '';
    lines.push(`- "${attachment.name}" at "${attachment.localPath}" (${attachment.mimeType || 'application/octet-stream'}, ${formatSize(attachment.sizeBytes)}). Open with ${appName || 'the default desktop app'}.${hashSuffix}`);
  }

  lines.push(
    '',
    `User requested changes: ${String(requestText || '').trim()}`,
    '',
    'Execution rules:',
    '1. Use the staged local path above, not a similarly named file from search results.',
    '2. Treat files in the same task staging folder as one uploaded package; linked assets, references, fonts, or sidecars may be needed by the primary document.',
    '3. If a SHA-256 hash is listed, use it as the source-file identity when comparing retries or recovery state.',
    '4. Open the file in the inferred desktop app before making changes.',
    '5. For InDesign files, prefer the InDesign document/status/text/layer/find-change tools when they fit the requested edit.',
    '6. For Photoshop or image files, observe the app after opening and use Photoshop menus, accessibility controls, keyboard shortcuts, and screenshots as needed.',
    '7. For CAD/engineering or 3D files, observe the document state first, verify units/dimensions/layers before edits, and use app commands or menus instead of guessing coordinates whenever possible.',
    '8. For other or unfamiliar files, open the staged path in the default or inferred app, inspect the app state, and build a narrow app-control plan from visible menus/accessibility/screenshot context.',
    '9. If the requested edit is destructive or ambiguous, save a copy next to the staged file or ask for confirmation instead of overwriting silently.',
    '10. Report the final file path and any blockers.',
  );

  return lines.join('\n');
}

export function parseDesktopAttachmentTaskFiles(task: string): StagedDesktopAttachment[] {
  if (!String(task || '').includes(DESKTOP_ATTACHMENT_TASK_MARKER)) return [];
  const files: StagedDesktopAttachment[] = [];
  const stageDirectory = String(task || '').match(/^Task staging folder:\s*"([^"\n]+)"/m)?.[1] || null;
  const manifestPath = String(task || '').match(/^Package manifest:\s*"([^"\n]+)"/m)?.[1] || null;
  const pattern = /^- "([^"\n]+)" at "([^"\n]+)" \(([^,\n)]+)(?:,\s*([^)]+))?\)\. Open with (.+?)\.(?: SHA-256: ([a-fA-F0-9]{64})\.)?$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(task || '')))) {
    const appName = match[5] && match[5] !== 'the default desktop app' ? match[5] : null;
    files.push({
      name: match[1],
      localPath: match[2],
      stageDirectory,
      manifestPath,
      mimeType: match[3] || null,
      sizeBytes: null,
      appName,
      sha256: match[6] ? match[6].toLowerCase() : null,
    });
  }
  return files;
}
