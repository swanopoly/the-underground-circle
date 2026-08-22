import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ExpoImageAssetGuardError,
  MAX_SIGNATURE_BYTES,
  scanImageAssetRoots,
} from './expo-image-asset-guard.mjs';

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uc-expo-image-guard-'));
const assetRoot = path.join(fixtureRoot, 'assets');
const privateRoot = path.join(fixtureRoot, 'private-user-data');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const secretTail = Buffer.from('PRIVATE_FIXTURE_CONTENT_MUST_NOT_APPEAR_IN_ERRORS');

const forbiddenFixtures = [
  {
    relativePath: 'misleading/apple-icon.png',
    expectedFormat: 'ICNS',
    bytes: Buffer.concat([Buffer.from('icns', 'ascii'), Buffer.alloc(8), secretTail]),
  },
  {
    relativePath: 'misleading/jxl-codestream.jpg',
    expectedFormat: 'JPEG XL codestream',
    bytes: Buffer.concat([Buffer.from([0xff, 0x0a, 0x01, 0x02]), secretTail]),
  },
  {
    relativePath: 'misleading/jxl-container.png',
    expectedFormat: 'JPEG XL container',
    bytes: Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
      secretTail,
    ]),
  },
  {
    relativePath: 'misleading/heif-photo.jpeg',
    expectedFormat: 'HEIF/HEIC',
    bytes: Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('mif1', 'ascii'),
      secretTail,
    ]),
  },
  {
    relativePath: 'misleading/heif-compatible-brand.png',
    expectedFormat: 'HEIF/HEIC',
    bytes: Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('mif1', 'ascii'),
      secretTail,
    ]),
  },
  {
    relativePath: 'misleading/heif-extended-size.jpg',
    expectedFormat: 'HEIF/HEIC',
    bytes: Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x01]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20]),
      Buffer.from('heix', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('mif1', 'ascii'),
      secretTail,
    ]),
  },
];

try {
  await fs.mkdir(path.join(assetRoot, 'themes'), { recursive: true });
  await fs.mkdir(privateRoot, { recursive: true });
  for (const ignoredName of ['.git', 'dist', 'node_modules']) {
    await fs.mkdir(path.join(assetRoot, ignoredName), { recursive: true });
    await fs.writeFile(path.join(assetRoot, ignoredName, 'ignored.png'), forbiddenFixtures[0].bytes);
  }

  await fs.writeFile(path.join(assetRoot, 'valid.png'), Buffer.concat([pngSignature, Buffer.alloc(120_000)]));
  await fs.writeFile(path.join(assetRoot, 'themes', 'valid-photo.jpg'), Buffer.concat([jpegSignature, Buffer.alloc(512)]));
  await fs.writeFile(path.join(privateRoot, 'not-an-expo-asset.png'), forbiddenFixtures[0].bytes);

  const validStats = await scanImageAssetRoots([assetRoot]);
  assert.equal(validStats.rootsScanned, 1);
  assert.equal(validStats.filesScanned, 2, 'only files inside the explicit Expo asset root are inspected');
  assert.equal(validStats.skippedDirectories, 3, 'node_modules, dist, and .git trees are excluded');
  assert.ok(
    validStats.prefixBytesRead <= validStats.filesScanned * MAX_SIGNATURE_BYTES,
    'the scanner reads at most the bounded signature prefix from each file',
  );

  for (const fixture of forbiddenFixtures) {
    const filePath = path.join(assetRoot, fixture.relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fixture.bytes);
  }

  await assert.rejects(
    scanImageAssetRoots([assetRoot]),
    (error) => {
      assert.ok(error instanceof ExpoImageAssetGuardError);
      assert.equal(error.issues.length, forbiddenFixtures.length);
      for (const fixture of forbiddenFixtures) {
        const issue = error.issues.find((candidate) => candidate.path.endsWith(fixture.relativePath));
        assert.ok(issue, `failure identifies ${fixture.relativePath}`);
        assert.match(issue.reason, new RegExp(fixture.expectedFormat.replace('/', '\\/')));
      }
      assert.ok(!error.message.includes(secretTail.toString('utf8')), 'failure output never includes file contents');
      return true;
    },
  );

  console.log('expo image asset guard smoke passed (bounded reads, valid PNG/JPEG, disguised ICNS/JXL/HEIF)');
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
