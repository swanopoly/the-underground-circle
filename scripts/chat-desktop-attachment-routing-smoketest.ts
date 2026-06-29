import assert from 'node:assert/strict';
import {
  DESKTOP_ATTACHMENT_MANIFEST_FILENAME,
  DESKTOP_ATTACHMENT_TASK_MARKER,
  buildDesktopAttachmentComputerTask,
  buildDesktopAttachmentPackageManifest,
  buildDesktopAttachmentStageGroupName,
  inferDesktopAppForAttachment,
  parseDesktopAttachmentTaskFiles,
  requestLooksLikeDesktopAttachmentModification,
  selectDesktopAttachmentsToPreOpen,
  shouldRouteAttachedFilesToDesktop,
} from '../src/lib/chatDesktopAttachmentRouting';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';

const indesign = { name: 'dealer-banner.indd', mimeType: 'application/octet-stream', sizeBytes: 4_200_000 };
const photoshop = { name: 'hero.psd', mimeType: 'application/octet-stream', sizeBytes: 8_100_000 };
const image = { name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 900_000 };
const spreadsheet = { name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 32_000 };
const cadDrawing = { name: 'site-plan.dwg', mimeType: 'application/octet-stream', sizeBytes: 12_400_000 };
const solidPart = { name: 'mounting-bracket.sldprt', mimeType: 'application/octet-stream', sizeBytes: 22_000_000 };
const matlabScript = { name: 'controller.m', mimeType: 'text/x-matlab', sizeBytes: 18_000 };
const unknownProject = { name: 'machine-profile.customapp', mimeType: 'application/octet-stream', sizeBytes: 300_000 };
const archive = { name: 'assets.zip', mimeType: 'application/zip', sizeBytes: 2_000_000 };
const inddHash = 'a'.repeat(64);
const cadHash = 'b'.repeat(64);
const sidecarHash = 'c'.repeat(64);

assert.equal(
  buildDesktopAttachmentStageGroupName('Open this InDesign package and update the footer', new Date('2026-05-21T12:34:56Z')),
  '20260521123456000-open-this-indesign-package-and-update-the-footer',
);

assert.equal(inferDesktopAppForAttachment(indesign, 'change the disclaimer'), 'Adobe InDesign');
assert.equal(inferDesktopAppForAttachment(photoshop, 'retouch the image'), 'Adobe Photoshop');
assert.equal(inferDesktopAppForAttachment(image, 'crop this in photoshop'), 'Adobe Photoshop');
assert.equal(inferDesktopAppForAttachment(spreadsheet, 'update the totals in excel'), 'Microsoft Excel');
assert.equal(inferDesktopAppForAttachment(cadDrawing, 'open the site plan and verify the dimensions'), 'AutoCAD');
assert.equal(inferDesktopAppForAttachment({ name: 'panel.dxf', mimeType: 'application/octet-stream' }, 'open in Fusion 360 and inspect it'), 'Fusion 360');
assert.equal(inferDesktopAppForAttachment(matlabScript, 'open in MATLAB and run the tests'), 'MATLAB');
assert.equal(inferDesktopAppForAttachment({ name: 'plant.slx', mimeType: 'application/octet-stream' }, 'open the Simulink model'), 'MATLAB');
assert.equal(inferDesktopAppForAttachment({ name: 'bracket.fcstd', mimeType: 'application/octet-stream' }, 'open and measure it'), 'FreeCAD');
assert.equal(inferDesktopAppForAttachment({ name: 'plate.dxf', mimeType: 'application/octet-stream' }, 'open in QCAD'), 'QCAD');
assert.equal(inferDesktopAppForAttachment(solidPart, 'open the part and check the hole spacing'), 'SOLIDWORKS');
assert.equal(inferDesktopAppForAttachment({ name: 'render-scene.blend', mimeType: 'application/octet-stream' }, 'open it'), 'Blender');
assert.equal(inferDesktopAppForAttachment({ name: 'assembly.step', mimeType: 'application/octet-stream' }, 'open in FreeCAD'), 'FreeCAD');
assert.equal(inferDesktopAppForAttachment(archive, 'open the attachment'), 'Archive Utility');
assert.equal(inferDesktopAppForAttachment({ name: 'readme.txt', mimeType: 'text/plain' }, 'open it'), null);

assert.equal(shouldRouteAttachedFilesToDesktop('change the headline in this file', [indesign]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('crop this image', [image]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('Open the attached file.', [indesign]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('open this drawing and create a revision cloud', [cadDrawing]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('open the attached file', [unknownProject]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('extract this archive', [archive]), true);
assert.equal(shouldRouteAttachedFilesToDesktop('what is this file?', [indesign]), false);
assert.equal(shouldRouteAttachedFilesToDesktop('what is this file?', [unknownProject]), false);
assert.equal(shouldRouteAttachedFilesToDesktop('edit this', []), false);
assert.equal(requestLooksLikeDesktopAttachmentModification('Open the attached file.'), false);
assert.equal(requestLooksLikeDesktopAttachmentModification('change the headline'), true);

const task = buildDesktopAttachmentComputerTask('change "Old" to "New"', [{
  ...indesign,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/dealer-banner.indd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: inddHash,
  appName: 'Adobe InDesign',
}]);

assert(task.includes(DESKTOP_ATTACHMENT_TASK_MARKER));
assert(task.includes('/Users/chris/Downloads/Underground Circle Attachments/dealer-banner.indd'));
assert(task.includes('Open with Adobe InDesign'));
assert(task.includes(`SHA-256: ${inddHash}.`));
assert(task.includes('Requested operation: edit'));
assert(task.includes('Task staging folder: "/Users/chris/Downloads/Underground Circle Attachments"'));
assert(task.includes(`Package manifest: "/Users/chris/Downloads/Underground Circle Attachments/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}"`));
assert(task.includes('InDesign files'));
assert(task.includes('one uploaded package'));
assert(task.includes('CAD/engineering or 3D files'));
assert(task.includes('Use the staged local path'));
const parsedFiles = parseDesktopAttachmentTaskFiles(task);
assert.equal(parsedFiles.length, 1);
assert.equal(parsedFiles[0].localPath, '/Users/chris/Downloads/Underground Circle Attachments/dealer-banner.indd');
assert.equal(parsedFiles[0].appName, 'Adobe InDesign');
assert.equal(parsedFiles[0].manifestPath, `/Users/chris/Downloads/Underground Circle Attachments/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`);
assert.equal(parsedFiles[0].sha256, inddHash);

const preview = planComputerTaskPreview(task);
assert.equal(preview.kind, 'hybrid_task');
assert.equal(preview.label, 'Uploaded desktop file task');
assert(preview.requiredCapabilities.includes('file_write'));
assert(preview.requiredCapabilities.includes('app_tools'));

const openOnlyTask = buildDesktopAttachmentComputerTask('Open the attached file.', [{
  ...photoshop,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/hero.psd',
  appName: 'Adobe Photoshop',
}]);
const openOnlyPreview = planComputerTaskPreview(openOnlyTask);
assert.equal(openOnlyPreview.label, 'Uploaded desktop file task');
assert(!openOnlyPreview.requiredCapabilities.includes('file_write'));

const cadTask = buildDesktopAttachmentComputerTask('open this drawing and create a revision cloud after checking units', [{
  ...cadDrawing,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/cad-task/site-plan.dwg',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/cad-task',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/cad-task/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: cadHash,
  appName: inferDesktopAppForAttachment(cadDrawing, 'open this drawing and create a revision cloud after checking units'),
}, {
  name: 'xrefs.zip',
  mimeType: 'application/zip',
  sizeBytes: 120_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/cad-task/xrefs.zip',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/cad-task',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/cad-task/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: sidecarHash,
  appName: 'Archive Utility',
}]);
assert(cadTask.includes('Open with AutoCAD'));
assert(cadTask.includes('Task staging folder: "/Users/chris/Downloads/Underground Circle Attachments/cad-task"'));
assert(cadTask.includes('verify units/dimensions/layers'));
assert.equal(parseDesktopAttachmentTaskFiles(cadTask).length, 2);
const cadPreview = planComputerTaskPreview(cadTask);
assert.equal(cadPreview.kind, 'hybrid_task');
assert(cadPreview.requiredCapabilities.includes('file_write'));
assert(cadPreview.requiredCapabilities.includes('app_tools'));
const cadPreOpen = selectDesktopAttachmentsToPreOpen(parseDesktopAttachmentTaskFiles(cadTask), cadTask, 4);
assert.equal(cadPreOpen.length, 1);
assert.equal(cadPreOpen[0].name, 'site-plan.dwg');

const cadManifest = buildDesktopAttachmentPackageManifest('open this drawing and create a revision cloud after checking units', parseDesktopAttachmentTaskFiles(cadTask), new Date('2026-05-21T12:00:00Z'));
assert.equal(cadManifest.kind, 'underground_circle_desktop_attachment_package');
assert.equal(cadManifest.requestedOperation, 'edit');
assert.equal(cadManifest.stageDirectory, '/Users/chris/Downloads/Underground Circle Attachments/cad-task');
assert.equal(cadManifest.manifestPath, `/Users/chris/Downloads/Underground Circle Attachments/cad-task/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`);
assert.deepEqual(cadManifest.preOpenFiles, ['/Users/chris/Downloads/Underground Circle Attachments/cad-task/site-plan.dwg']);
assert.equal(cadManifest.files.find((file) => file.name === 'site-plan.dwg')?.role, 'primary');
assert.equal(cadManifest.files.find((file) => file.name === 'xrefs.zip')?.role, 'sidecar');
assert.equal(cadManifest.files.find((file) => file.name === 'site-plan.dwg')?.sha256, cadHash);
assert.equal(cadManifest.files.find((file) => file.name === 'xrefs.zip')?.sha256, sidecarHash);

const unknownTask = buildDesktopAttachmentComputerTask('open the attached file', [{
  ...unknownProject,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/machine-profile.customapp',
  appName: inferDesktopAppForAttachment(unknownProject, 'open the attached file'),
}]);
assert(unknownTask.includes('Open with the default desktop app'));
assert(unknownTask.includes('unfamiliar files'));
const unknownPreview = planComputerTaskPreview(unknownTask);
assert(!unknownPreview.requiredCapabilities.includes('file_write'));

const archiveTask = buildDesktopAttachmentComputerTask('extract this archive', [{
  ...archive,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/assets.zip',
  appName: 'Archive Utility',
}]);
const archivePreOpen = selectDesktopAttachmentsToPreOpen(parseDesktopAttachmentTaskFiles(archiveTask), archiveTask, 4);
assert.equal(archivePreOpen.length, 1);
assert.equal(archivePreOpen[0].name, 'assets.zip');

console.log('All chat desktop attachment routing smoke cases passed.');
