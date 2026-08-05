import assert from 'node:assert/strict';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import { extractDirectLocalImageFormatConversionTask, planComputerTaskPreview } from '../src/lib/computerTaskPlanner';
import {
  detectLocalComputerAwarenessIntent,
  detectLocalComputerAwarenessIntentSequence,
} from '../src/lib/localComputerAwarenessIntent';

function toolsFor(message: string): string[] {
  return buildChatAutomationPlan({ message }).computerRequestRoute?.recommendedTools || [];
}

function actionToolsFor(message: string): string[] {
  return buildChatAutomationPlan({ message }).computerRequestRoute?.actionItems?.map((item) => item.tool) || [];
}

function assertComputerTask(message: string, expected: Partial<{
  risk: string;
  approvalRequired: boolean;
  strategyId: string;
}> = {}) {
  const plan = buildChatAutomationPlan({ message });
  assert.equal(plan.execution.kind, 'run_computer_task', `${message}: should use the computer-task runtime`);
  assert.equal(plan.execution.routeId, 'browser', `${message}: should enter the browser/computer route`);
  if (expected.risk !== undefined) assert.equal(plan.risk, expected.risk, `${message}: risk`);
  if (expected.approvalRequired !== undefined) {
    assert.equal(plan.approval.required, expected.approvalRequired, `${message}: approval requirement`);
  }
  if (expected.strategyId !== undefined) {
    assert.equal(plan.computerRequestRoute?.appStrategy?.id, expected.strategyId, `${message}: strategy`);
  }
  return plan;
}

const geminiPngToJpg = 'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg';
const geminiIntent = detectLocalComputerAwarenessIntent(geminiPngToJpg);
assert.equal(geminiIntent.kind, 'open_file_search_match', 'desktop PNG phrase resolves as a file target, not an app');
assert.equal(geminiIntent.query, 'Gemini_Generated_Image_lppqo8lppqo8lppq.png', 'desktop PNG phrase preserves exact basename');
assert.equal(geminiIntent.rootPath, '~/Desktop', 'desktop PNG phrase preserves Desktop scope');
const geminiConversion = extractDirectLocalImageFormatConversionTask(geminiPngToJpg);
assert.equal(geminiConversion?.source, 'Gemini_Generated_Image_lppqo8lppqo8lppq.png', 'direct conversion keeps the source filename');
assert.equal(geminiConversion?.format, 'jpg', 'direct conversion parses JPG target');
const directConversionPreview = planComputerTaskPreview('convert logo.png on my desktop to jpg');
assert(!directConversionPreview.requiredCapabilities.includes('app_tools'), 'direct conversion preview does not require app control');
const geminiPlan = assertComputerTask(geminiPngToJpg, {
  risk: 'safe',
  approvalRequired: false,
  strategyId: 'file_readonly',
});
assert(geminiPlan.computerRequestRoute?.recommendedTools.includes('desktop.convert_image'), 'desktop PNG conversion recommends desktop.convert_image');
assert.deepEqual(
  actionToolsFor(geminiPngToJpg).slice(0, 3),
  ['desktop.file_search', 'desktop.file_stat', 'desktop.convert_image'],
  'desktop PNG conversion resolves and stats the file before conversion',
);

const dotJpgConversion = extractDirectLocalImageFormatConversionTask('open foo.png from desktop and make it a .jpg');
assert.equal(dotJpgConversion?.source, 'foo.png', 'dot-JPG conversion keeps source filename');
assert.equal(dotJpgConversion?.format, 'jpg', 'dot-JPG conversion parses target format');

for (const conversionVariant of [
  {
    message: 'convert "~/Desktop/logo mark.png" to jpeg',
    source: '~/Desktop/logo mark.png',
    format: 'jpeg',
  },
  {
    message: 'save Desktop/logo mark.png as tiff',
    source: 'Desktop/logo mark.png',
    format: 'tiff',
  },
  {
    message: 'open logo.png from downloads and make it a jpeg',
    source: 'logo.png',
    format: 'jpeg',
  },
]) {
  const conversion = extractDirectLocalImageFormatConversionTask(conversionVariant.message);
  assert.equal(conversion?.source, conversionVariant.source, `${conversionVariant.message}: parses source`);
  assert.equal(conversion?.format, conversionVariant.format, `${conversionVariant.message}: parses format`);
  const plan = assertComputerTask(conversionVariant.message, {
    risk: 'safe',
    approvalRequired: false,
    strategyId: 'file_readonly',
  });
  const tools = plan.computerRequestRoute?.actionItems?.map((item) => item.tool) || [];
  assert.deepEqual(tools.slice(0, 3), ['desktop.file_search', 'desktop.file_stat', 'desktop.convert_image'], `${conversionVariant.message}: resolves, stats, then converts`);
  assert(!tools.includes('desktop.launch_app'), `${conversionVariant.message}: does not launch a desktop app`);
  assert(!plan.computerRequestRoute?.designExecutionPipeline, `${conversionVariant.message}: does not attach Photoshop design pipeline`);
}

const desktopOpenOnly = 'open logo.png from the desktop';
const openOnlyIntent = detectLocalComputerAwarenessIntent(desktopOpenOnly);
assert.equal(openOnlyIntent.kind, 'open_file_search_match', 'open local file from Desktop stays file-scoped');
assert.equal(openOnlyIntent.query, 'logo.png', 'open local file from Desktop preserves basename');
assert.equal(openOnlyIntent.rootPath, '~/Desktop', 'open local file from Desktop preserves Desktop scope');
const openOnlyPlan = assertComputerTask(desktopOpenOnly, {
  risk: 'review',
  approvalRequired: true,
  strategyId: 'file_readonly',
});
assert(openOnlyPlan.computerRequestRoute?.recommendedTools.includes('desktop.file_search'), 'open local file resolves source first');
assert(actionToolsFor(desktopOpenOnly).includes('desktop.open_path'), 'open local file uses desktop.open_path only after resolution');

const photoshopLaunch = 'open Photoshop';
const photoshopIntent = detectLocalComputerAwarenessIntent(photoshopLaunch);
assert.equal(photoshopIntent.kind, 'launch_app', 'open Photoshop stays an app launch');
assert.equal(photoshopIntent.appQuery, 'Photoshop', 'open Photoshop preserves app name');
const photoshopPlan = assertComputerTask(photoshopLaunch, {
  risk: 'review',
  approvalRequired: true,
});
assert(photoshopPlan.computerRequestRoute?.recommendedTools.includes('desktop.launch_app'), 'open Photoshop recommends launch_app');

const openDownloads = 'open ~/Downloads';
const openDownloadsIntent = detectLocalComputerAwarenessIntent(openDownloads);
assert.equal(openDownloadsIntent.kind, 'open_path', 'explicit folder path parses as open_path');
const openDownloadsPlan = assertComputerTask(openDownloads, {
  risk: 'review',
  approvalRequired: true,
  strategyId: 'file_readonly',
});
assert(openDownloadsPlan.computerRequestRoute?.recommendedTools.includes('desktop.open_path'), 'explicit folder path recommends desktop.open_path');

const explicitDesktopFile = 'open ~/Desktop/Gemini_Generated_Image_lppqo8lppqo8lppq.png';
const explicitDesktopFileIntent = detectLocalComputerAwarenessIntent(explicitDesktopFile);
assert.equal(explicitDesktopFileIntent.kind, 'open_path', 'explicit image path parses as open_path');
const explicitDesktopFilePlan = assertComputerTask(explicitDesktopFile, {
  risk: 'review',
  approvalRequired: true,
  strategyId: 'file_readonly',
});
assert(explicitDesktopFilePlan.computerRequestRoute?.recommendedTools.includes('desktop.open_path'), 'explicit image path recommends desktop.open_path');

const wordpressUpload = 'Open WordPress media library and upload logo.png from Desktop';
const wordpressPlan = assertComputerTask(wordpressUpload, {
  risk: 'external_side_effect',
  approvalRequired: true,
  strategyId: 'browser_file_transfer',
});
assert(wordpressPlan.computerRequestRoute?.recommendedTools.includes('wp.upload_media'), 'WordPress upload keeps the wp.upload_media path');
assert(!wordpressPlan.computerRequestRoute?.recommendedTools.includes('desktop.open_path'), 'WordPress upload does not misroute as local open_path');

const googleDriveSearch = 'find honda-banner.indd in Google Drive';
assertComputerTask(googleDriveSearch, {
  risk: 'safe',
  approvalRequired: false,
});
assert(toolsFor(googleDriveSearch).includes('desktop.file_search'), 'Google Drive file lookup recommends desktop.file_search');

const sequence = detectLocalComputerAwarenessIntentSequence('open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop then open Photoshop');
assert(sequence.some((step) => step.kind === 'open_file_search_match'), 'mixed file/app phrase keeps the file step');
assert(sequence.some((step) => step.kind === 'launch_app'), 'mixed file/app phrase keeps the app step');

const route = buildChatComputerRequestRoute(geminiPngToJpg);
assert.equal(route.kind, 'local_file', 'direct image conversion produces local_file route metadata');
assert.equal(route.approvalRequired, false, 'direct image conversion route does not request approval');
assert(route.actionItems.some((item) => item.tool === 'desktop.convert_image'), 'direct image conversion route carries executable action item');

const unsupportedRenameExport = 'open the file Screenshot 2026-05-21 at 4.44.42 PM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png';
assert.equal(
  extractDirectLocalImageFormatConversionTask(unsupportedRenameExport),
  null,
  'Photoshop rename/export phrase is not treated as a format-only direct conversion',
);
const unsupportedRenameExportPlan = assertComputerTask(unsupportedRenameExport, {
  risk: 'review',
  approvalRequired: true,
  strategyId: 'creative_layout_control',
});
assert(!unsupportedRenameExportPlan.computerRequestRoute?.actionItems.some((item) => item.tool === 'desktop.convert_image'), 'Photoshop rename/export phrase avoids desktop.convert_image action shortcut');

for (const namedOutputConversion of [
  'open foo.png from desktop and make it a jpg named lmao.jpg',
  'save foo.png from desktop as lmao.jpg',
]) {
  assert.equal(
    extractDirectLocalImageFormatConversionTask(namedOutputConversion),
    null,
    `${namedOutputConversion}: named output does not silently route to default-name conversion`,
  );
}

const shortPhotoshopRenameExport = 'open screenshot from desktop in Photoshop and call it lmao.png';
assert.equal(
  extractDirectLocalImageFormatConversionTask(shortPhotoshopRenameExport),
  null,
  'short Photoshop rename/export phrase is not treated as direct conversion',
);
const shortPhotoshopRenameExportPlan = assertComputerTask(shortPhotoshopRenameExport, {
  risk: 'review',
  approvalRequired: true,
  strategyId: 'creative_layout_control',
});
assert(!shortPhotoshopRenameExportPlan.computerRequestRoute?.actionItems.some((item) => item.tool === 'desktop.convert_image'), 'short Photoshop rename/export avoids desktop.convert_image action shortcut');

console.log('All simple chat task guardrail smoke cases passed.');
