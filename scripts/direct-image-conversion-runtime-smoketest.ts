import assert from 'node:assert/strict';
import { executeDirectImageConversionRequest } from '../src/lib/directImageConversionRuntime';

async function main() {
  const success = await executeDirectImageConversionRequest(
    'on the desktop open pearsoncdjr-img in photoshop and save it as a png',
    async (request) => {
      assert.equal(request.source, 'pearsoncdjr-img');
      assert.equal(request.format, 'png');
      return {
        ok: true,
        data: {
          sourcePath: '/Users/cswanson/Desktop/pearsoncdjr-img.jpg',
          outputPath: '/Users/cswanson/Desktop/pearsoncdjr-img.png',
          format: 'png',
          bytes: 12345,
        },
      };
    },
  );

  assert.equal(success.handled, true, 'direct image conversion request is handled');
  assert.equal(success.status, 'completed', 'direct image conversion completes with proof');
  assert.match(success.message, /Saved \/Users\/cswanson\/Desktop\/pearsoncdjr-img\.png \(png, 12345 bytes\)\./, 'success message carries output proof');
  assert(success.data?.proofSignals?.some((signal) => signal.includes('desktop.convert_image')), 'success data carries convert_image proof signal');

  const desktopPronounJpg = await executeDirectImageConversionRequest(
    'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg',
    async (request) => {
      assert.equal(request.source, 'Gemini_Generated_Image_lppqo8lppqo8lppq.png');
      assert.equal(request.format, 'jpg');
      return {
        ok: true,
        data: {
          sourcePath: '/Users/cswanson/Desktop/Gemini_Generated_Image_lppqo8lppqo8lppq.png',
          outputPath: '/Users/cswanson/Desktop/Gemini_Generated_Image_lppqo8lppqo8lppq.jpg',
          format: 'jpg',
          bytes: 67890,
        },
      };
    },
  );

  assert.equal(desktopPronounJpg.handled, true, 'desktop filename pronoun conversion is handled');
  assert.equal(desktopPronounJpg.status, 'completed', 'desktop filename pronoun conversion completes');
  assert.match(desktopPronounJpg.message, /Gemini_Generated_Image_lppqo8lppqo8lppq\.jpg/, 'desktop filename pronoun conversion reports JPG output');

  const quotedJpeg = await executeDirectImageConversionRequest(
    'convert "~/Desktop/logo mark.png" to jpeg',
    async (request) => {
      assert.equal(request.source, '~/Desktop/logo mark.png');
      assert.equal(request.format, 'jpeg');
      return {
        ok: true,
        data: {
          sourcePath: '/Users/cswanson/Desktop/logo mark.png',
          outputPath: '/Users/cswanson/Desktop/logo mark.jpeg',
          format: 'jpeg',
          bytes: 23456,
        },
      };
    },
  );

  assert.equal(quotedJpeg.handled, true, 'quoted JPEG conversion is handled');
  assert.equal(quotedJpeg.status, 'completed', 'quoted JPEG conversion completes');
  assert.match(quotedJpeg.message, /logo mark\.jpeg \(jpeg, 23456 bytes\)/, 'quoted JPEG conversion reports proof');

  const unsupportedRenameExport = await executeDirectImageConversionRequest(
    'open the file Screenshot 2026-05-21 at 4.44.42 PM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png',
    async () => {
      throw new Error('format-only converter should not run for renamed export requests');
    },
  );

  assert.equal(unsupportedRenameExport.handled, false, 'renamed Photoshop export is not handled by format-only converter');

  const missingProof = await executeDirectImageConversionRequest(
    'on the desktop open pearsoncdjr-img in photoshop and save it as a png',
    async () => ({
      ok: true,
      data: {
        sourcePath: '/Users/cswanson/Desktop/pearsoncdjr-img.jpg',
        outputPath: '/Users/cswanson/Desktop/pearsoncdjr-img.png',
        format: 'png',
        bytes: 0,
      },
    }),
  );

  assert.equal(missingProof.handled, true, 'missing-proof direct conversion still consumes the task');
  assert.equal(missingProof.status, 'failed', 'missing output proof fails closed');
  assert.match(missingProof.message, /output proof/i, 'missing proof message is customer-readable');
  assert.doesNotMatch(missingProof.message, /desktop\.convert_image|byte-size/i, 'missing proof message hides tool contract detail');

  const notFound = await executeDirectImageConversionRequest(
    'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg',
    async () => ({
      ok: false,
      error: 'File or folder does not exist at that path.',
      errorCode: 'file_not_found',
    }),
  );

  assert.equal(notFound.handled, true, 'not-found direct conversion still consumes the task');
  assert.equal(notFound.status, 'failed', 'not-found direct conversion fails closed');
  assert.match(notFound.message, /could not find that image/i, 'not-found message tells the user the simple blocker');
  assert.doesNotMatch(notFound.message, /desktop\.convert_image|File or folder does not exist/i, 'not-found message hides bridge internals');
  assert(notFound.warnings.some((warning) => /desktop\.convert_image failed \(file_not_found\)/i.test(warning)), 'not-found warning keeps technical support detail');

  for (const failureCase of [
    {
      label: 'ambiguous file match',
      errorCode: 'ambiguous_file_match' as const,
      error: 'multiple images matched "logo.png"; provide the full path before converting.',
      userPattern: /more than one matching image|exact file path/i,
      rawPattern: /multiple images matched|errorCode|File or folder does not exist|ECONNREFUSED|EACCES/i,
    },
    {
      label: 'output conflict',
      errorCode: 'output_conflict' as const,
      error: 'could not choose a non-conflicting output path for "logo.png".',
      userPattern: /already exists|overwriting/i,
      rawPattern: /non-conflicting|errorCode|File or folder does not exist|ECONNREFUSED|EACCES/i,
    },
    {
      label: 'permission denied',
      errorCode: 'permission_denied' as const,
      error: 'EACCES: permission denied, open /Users/cswanson/Desktop/logo.jpg',
      userPattern: /desktop bridge|approve the requested folder|try again/i,
      rawPattern: /EACCES|permission denied|desktop\.convert_image|errorCode/i,
    },
    {
      label: 'bridge unavailable',
      errorCode: 'bridge_offline' as const,
      error: 'ECONNREFUSED 127.0.0.1:7778',
      userPattern: /desktop bridge|approve the requested folder|try again/i,
      rawPattern: /ECONNREFUSED|127\.0\.0\.1|desktop\.convert_image|errorCode/i,
    },
  ]) {
    const failed = await executeDirectImageConversionRequest(
      'open logo.png from the desktop and make it a jpg',
      async () => ({
        ok: false,
        error: failureCase.error,
        errorCode: failureCase.errorCode,
      }),
    );
    assert.equal(failed.handled, true, `${failureCase.label}: task is handled`);
    assert.equal(failed.status, 'failed', `${failureCase.label}: task fails closed`);
    assert.match(failed.message, failureCase.userPattern, `${failureCase.label}: message is actionable`);
    assert.doesNotMatch(failed.message, failureCase.rawPattern, `${failureCase.label}: message hides raw diagnostics`);
    assert(failed.warnings.some((warning) => warning.includes(`desktop.convert_image failed (${failureCase.errorCode})`)), `${failureCase.label}: warning keeps diagnostic code`);
  }

  const thrownBridge = await executeDirectImageConversionRequest(
    'open logo.png from the desktop and make it a jpg',
    async () => {
      throw new TypeError('fetch failed ECONNREFUSED 127.0.0.1:7778');
    },
  );

  assert.equal(thrownBridge.handled, true, 'thrown bridge conversion is handled');
  assert.equal(thrownBridge.status, 'failed', 'thrown bridge conversion fails closed');
  assert.match(thrownBridge.message, /desktop bridge|approve the requested folder|try again/i, 'thrown bridge conversion uses safe user copy');
  assert.doesNotMatch(thrownBridge.message, /fetch failed|ECONNREFUSED|127\.0\.0\.1|desktop\.convert_image/i, 'thrown bridge conversion hides raw thrown detail');
  assert(thrownBridge.warnings.some((warning) => /desktop\.convert_image failed \(bridge_offline\): fetch failed ECONNREFUSED/i.test(warning)), 'thrown bridge conversion keeps diagnostic warning');

  const notDirect = await executeDirectImageConversionRequest('open Notes and create a note', async () => {
    throw new Error('converter should not be called');
  });

  assert.equal(notDirect.handled, false, 'non-image task is not handled by direct conversion runtime');

  console.log('All direct image conversion runtime smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
