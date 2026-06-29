import assert from 'node:assert/strict';
import {
  executeDirectLocalFileRequest,
  planDirectLocalFileRequest,
  routeHasDirectLocalFileActionItems,
} from '../src/lib/directLocalFileRuntime';

async function main() {
  const openDesktopPlan = planDirectLocalFileRequest('open logo.png from the desktop');
  assert.equal(openDesktopPlan.mode, 'open_path', 'desktop open filename plans open_path');
  assert.equal(openDesktopPlan.path, '~/Desktop/logo.png', 'desktop open filename strips command verb from path');

  const openExcelPlan = planDirectLocalFileRequest('open budget.xlsx from the desktop in Excel');
  assert.equal(openExcelPlan.mode, 'open_path', 'Excel desktop open plans open_path');
  assert.equal(openExcelPlan.path, '~/Desktop/budget.xlsx', 'Excel desktop open preserves filename path');
  assert.equal(openExcelPlan.appName, 'Microsoft Excel', 'Excel desktop open preserves target app');

  const openWordPlan = planDirectLocalFileRequest('open letter.docx from the desktop in Word');
  assert.equal(openWordPlan.appName, 'Microsoft Word', 'Word desktop open preserves target app');

  const openAcrobatPlan = planDirectLocalFileRequest('open report.pdf from the desktop in Acrobat');
  assert.equal(openAcrobatPlan.appName, 'Adobe Acrobat', 'Acrobat desktop open preserves target app');

  const rename = await executeDirectLocalFileRequest(
    'Open Finder and rename landscaping-img.png on my desktop to landscaping-img-1.png',
    async () => ({
      ok: true,
      message: 'Renamed /Users/cswanson/Desktop/landscaping-img.png to /Users/cswanson/Desktop/landscaping-img-1.png.',
      warnings: [],
      data: {
        adapter: 'desktop_bridge',
        result: {
          fromPath: '/Users/cswanson/Desktop/landscaping-img.png',
          toPath: '/Users/cswanson/Desktop/landscaping-img-1.png',
        },
      },
    }),
  );

  assert.equal(rename.handled, true, 'rename request is handled');
  assert.equal(rename.status, 'completed', 'rename request completes with adapter proof');
  assert.equal(rename.data?.plan.mode, 'rename', 'rename request plans rename mode');
  assert(rename.data?.proofSignals?.includes('desktop.file_rename'), 'rename proof carries desktop.file_rename');

  const typoRename = await executeDirectLocalFileRequest(
    'can you change the file landscaping-img.png thats on the desktop to andscaping-img-1.png',
    async (_task, plan) => {
      assert.equal(plan.mode, 'rename');
      return {
        ok: true,
        message: 'Renamed /Users/cswanson/Desktop/landscaping-img.png to /Users/cswanson/Desktop/andscaping-img-1.png.',
        warnings: [],
        data: {
          adapter: 'desktop_bridge',
          result: {
            fromPath: '/Users/cswanson/Desktop/landscaping-img.png',
            toPath: '/Users/cswanson/Desktop/andscaping-img-1.png',
          },
        },
      };
    },
  );

  assert.equal(typoRename.handled, true, 'typo-heavy rename request is handled');
  assert.equal(typoRename.data?.plan.mode, 'rename', 'typo-heavy rename request plans rename mode');

  const copy = await executeDirectLocalFileRequest(
    'copy landscaping-img.png on my desktop to landscaping-img-copy.png',
    async () => ({
      ok: true,
      message: 'Copied /Users/cswanson/Desktop/landscaping-img.png to /Users/cswanson/Desktop/landscaping-img-copy.png.',
      warnings: [],
      data: {
        adapter: 'desktop_bridge',
        result: {
          fromPath: '/Users/cswanson/Desktop/landscaping-img.png',
          toPath: '/Users/cswanson/Desktop/landscaping-img-copy.png',
        },
      },
    }),
  );

  assert.equal(copy.handled, true, 'copy request is handled');
  assert.equal(copy.data?.plan.mode, 'copy', 'copy request plans copy mode');
  assert(copy.data?.proofSignals?.includes('desktop.file_copy'), 'copy proof carries desktop.file_copy');

  const openPath = await executeDirectLocalFileRequest(
    'Open Preview and show ~/Downloads/report.pdf',
    async (_task, plan) => {
      assert.equal(plan.mode, 'open_path');
      assert.equal(plan.path, '~/Downloads/report.pdf');
      assert.equal(plan.appName, 'Preview');
      return {
        ok: true,
        message: 'Opened /Users/cswanson/Downloads/report.pdf in Preview.',
        warnings: [],
        data: {
          adapter: 'desktop_bridge',
          result: {
            path: '/Users/cswanson/Downloads/report.pdf',
            appName: 'Preview',
          },
        },
      };
    },
  );

  assert.equal(openPath.handled, true, 'open path request is handled');
  assert.equal(openPath.status, 'completed', 'open path request completes with adapter proof');
  assert.equal(openPath.data?.plan.mode, 'open_path', 'open path request plans open_path mode');
  assert(openPath.data?.proofSignals?.includes('desktop.open_path'), 'open path proof carries desktop.open_path');

  const rawOpenPathFailure = await executeDirectLocalFileRequest(
    'Open Preview and show ~/Downloads/missing-report.pdf',
    async (_task, plan) => {
      assert.equal(plan.mode, 'open_path');
      return {
        ok: false,
        message: 'Desktop bridge open path failed: File or folder does not exist at that path.',
        warnings: ['Desktop bridge open path failed: File or folder does not exist at that path.'],
        data: { adapter: 'desktop_bridge', plan },
      };
    },
  );

  assert.equal(rawOpenPathFailure.handled, true, 'raw open_path adapter failure is handled');
  assert.equal(rawOpenPathFailure.status, 'failed', 'raw open_path adapter failure fails closed');
  assert.match(rawOpenPathFailure.message, /could not find that file or folder|exact path/i, 'raw open_path adapter failure gets safe user copy');
  assert.doesNotMatch(rawOpenPathFailure.message, /Desktop bridge .*failed|desktop\.file_|MCP|EACCES|File or folder does not exist/i, 'raw open_path adapter failure hides bridge details');
  assert(rawOpenPathFailure.warnings.some((warning) => /Desktop bridge open path failed/i.test(warning)), 'raw open_path adapter failure keeps diagnostic warning');

  const rawRenameFailure = await executeDirectLocalFileRequest(
    'Open Finder and rename landscaping-img.png on my desktop to landscaping-img-1.png',
    async (_task, plan) => ({
      ok: false,
      message: 'Desktop bridge file rename failed: EACCES: permission denied, rename /Users/cswanson/Desktop/landscaping-img.png.',
      warnings: ['Desktop bridge file rename failed: EACCES: permission denied.'],
      data: { adapter: 'desktop_bridge', plan },
    }),
  );

  assert.equal(rawRenameFailure.handled, true, 'raw rename adapter failure is handled');
  assert.equal(rawRenameFailure.status, 'failed', 'raw rename adapter failure fails closed');
  assert.match(rawRenameFailure.message, /desktop bridge connected|folder access approved|grant the folder/i, 'raw rename adapter failure gets access guidance');
  assert.doesNotMatch(rawRenameFailure.message, /Desktop bridge .*failed|desktop\.file_|MCP|EACCES|permission denied/i, 'raw rename adapter failure hides raw permission details');
  assert(rawRenameFailure.warnings.some((warning) => /Desktop bridge file rename failed/i.test(warning)), 'raw rename adapter failure keeps diagnostic warning');

  const rawWriteFailure = await executeDirectLocalFileRequest(
    'write a text file on my desktop called notes.txt with hello',
    async (_task, plan) => ({
      ok: false,
      message: 'Desktop bridge text file write failed: EEXIST: file already exists.',
      warnings: ['Desktop bridge text file write failed: EEXIST: file already exists.'],
      data: { adapter: 'desktop_bridge', plan },
    }),
  );

  assert.equal(rawWriteFailure.handled, true, 'raw write adapter failure is handled');
  assert.equal(rawWriteFailure.status, 'failed', 'raw write adapter failure fails closed');
  assert.match(rawWriteFailure.message, /already exists|different name|confirm/i, 'raw write adapter failure gets safe conflict copy');
  assert.doesNotMatch(rawWriteFailure.message, /Desktop bridge .*failed|desktop\.file_|MCP|EEXIST/i, 'raw write adapter failure hides raw conflict details');
  assert(rawWriteFailure.warnings.some((warning) => /Desktop bridge text file write failed/i.test(warning)), 'raw write adapter failure keeps diagnostic warning');

  const missingBridge = await executeDirectLocalFileRequest(
    'create a folder on my desktop called Project Assets',
    async () => null,
  );

  assert.equal(missingBridge.handled, true, 'bridge-offline direct file request is consumed');
  assert.equal(missingBridge.status, 'failed', 'bridge-offline direct file request fails closed');
  assert.match(missingBridge.message, /desktop bridge connected and folder access approved/i, 'bridge-offline message gives a plain next step');
  assert.doesNotMatch(missingBridge.message, /desktop\.file_|desktop\.open_path|npm run bridge/i, 'bridge-offline message hides tool details');

  const noProof = await executeDirectLocalFileRequest(
    'write a text file on my desktop called notes.txt with hello',
    async () => ({
      ok: true,
      message: 'Wrote 5 bytes to /Users/cswanson/Desktop/notes.txt.',
      warnings: [],
    }),
  );

  assert.equal(noProof.handled, true, 'missing-proof text write is consumed');
  assert.equal(noProof.status, 'failed', 'missing-proof text write fails closed');
  assert.match(noProof.message, /ran without proof/i, 'missing-proof message is customer-readable');
  assert.doesNotMatch(noProof.message, /desktop\.file_|result proof/i, 'missing-proof message hides tool contract detail');

  const readOnly = await executeDirectLocalFileRequest('Search files in Downloads for invoice', async () => {
    throw new Error('read-only search should not execute through direct mutation runtime');
  });

  assert.equal(readOnly.handled, false, 'read-only local file search is not handled by mutation runtime');

  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    actionItems: [{ id: 'perform-file-action', surface: 'local_file', tool: 'desktop.file_copy', label: 'Copy', proof: 'Path' }],
  }), true, 'route helper detects direct local file action item');
  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    sourceMessage: 'Open Preview and show ~/Downloads/report.pdf',
    actionItems: [{ id: 'perform-file-read', surface: 'local_file', tool: 'desktop.open_path', label: 'Open', proof: 'Path' }],
  }), true, 'route helper detects direct open path action item with a concrete path');
  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    sourceMessage: 'open the report',
    actionItems: [{ id: 'perform-file-read', surface: 'local_file', tool: 'desktop.open_path', label: 'Open', proof: 'Path' }],
  }), false, 'route helper rejects open_path action item without a concrete path');
  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    actionItems: [{ id: 'perform-file-read', surface: 'local_file', tool: 'desktop.file_search', label: 'Search', proof: 'Matches' }],
  }), false, 'route helper ignores read-only file action items');

  console.log('All direct local file runtime smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
