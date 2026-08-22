#!/usr/bin/env node

/**
 * Guard Metro/Expo's repository-controlled image asset tree from image formats
 * that the currently pinned image metadata parser cannot safely inspect.
 *
 * Keep the production roots narrow. The current app.json and source imports
 * resolve raster assets only from `<repo>/assets`; public/ contains static ROM
 * payloads and is not an Expo image-parser input.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_SIGNATURE_BYTES = 64;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
export const DEFAULT_EXPO_IMAGE_ASSET_ROOTS = Object.freeze([
  path.join(REPOSITORY_ROOT, 'assets'),
]);

const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'dist', 'node_modules']);
const HEIF_BRANDS = new Set([
  'avif',
  'avis',
  'heic',
  'heif',
  'heim',
  'heis',
  'heix',
  'hevc',
  'hevm',
  'hevs',
  'hevx',
  'mif1',
  'msf1',
]);

const JXL_CONTAINER_SIGNATURE = Buffer.from([
  0x00, 0x00, 0x00, 0x0c,
  0x4a, 0x58, 0x4c, 0x20,
  0x0d, 0x0a, 0x87, 0x0a,
]);

function startsWithBytes(prefix, signature) {
  return prefix.length >= signature.length && prefix.subarray(0, signature.length).equals(signature);
}

function detectHeifSignature(prefix) {
  if (prefix.length < 12 || prefix.toString('ascii', 4, 8) !== 'ftyp') return false;

  // The first ISO-BMFF box contains a major brand at byte 8 and compatible
  // brands from byte 16 onward (or 16/24 with an extended-size header). Only
  // inspect complete four-byte brands inside the declared box and the bounded
  // prefix; bytes from a following box must not cause a false positive.
  const declaredSize = prefix.readUInt32BE(0);
  let majorBrandOffset = 8;
  let compatibleBrandOffset = 16;
  let boxEnd = declaredSize === 0 ? prefix.length : Math.min(declaredSize, prefix.length);

  if (declaredSize === 1) {
    if (prefix.length < 24) return false;
    const extendedSize = prefix.readBigUInt64BE(8);
    majorBrandOffset = 16;
    compatibleBrandOffset = 24;
    boxEnd = extendedSize > BigInt(prefix.length) ? prefix.length : Number(extendedSize);
  }
  if (boxEnd < majorBrandOffset + 4) return false;
  if (HEIF_BRANDS.has(prefix.toString('ascii', majorBrandOffset, majorBrandOffset + 4))) return true;

  for (let offset = compatibleBrandOffset; offset + 4 <= boxEnd; offset += 4) {
    if (HEIF_BRANDS.has(prefix.toString('ascii', offset, offset + 4))) return true;
  }
  return false;
}

export function detectForbiddenImageSignature(prefix) {
  if (!Buffer.isBuffer(prefix)) {
    throw new TypeError('Image signature input must be a Buffer.');
  }
  if (prefix.length >= 4 && prefix.toString('ascii', 0, 4) === 'icns') {
    return 'Apple Icon Image (ICNS)';
  }
  if (prefix.length >= 2 && prefix[0] === 0xff && prefix[1] === 0x0a) {
    return 'JPEG XL codestream';
  }
  if (startsWithBytes(prefix, JXL_CONTAINER_SIGNATURE)) {
    return 'JPEG XL container';
  }
  if (detectHeifSignature(prefix)) {
    return 'HEIF/HEIC image';
  }
  return null;
}

function displayPath(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath);
  return path.join(path.basename(rootPath), relativePath || '.');
}

export class ExpoImageAssetGuardError extends Error {
  constructor(issues, stats) {
    const lines = issues.map((issue) => `- ${issue.path}: ${issue.reason}`);
    super(`Unsafe Expo image asset input detected:\n${lines.join('\n')}`);
    this.name = 'ExpoImageAssetGuardError';
    this.issues = issues;
    this.stats = stats;
  }
}

async function readBoundedPrefix(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(MAX_SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(prefix, 0, MAX_SIGNATURE_BYTES, 0);
    return prefix.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Recursively inspect explicit asset roots without following symlinks. This
 * function is exported so the smoke test can use an isolated fixture; the CLI
 * always calls it with DEFAULT_EXPO_IMAGE_ASSET_ROOTS.
 */
export async function scanImageAssetRoots(rootPaths) {
  if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
    throw new TypeError('At least one explicit Expo image asset root is required.');
  }

  const roots = rootPaths.map((rootPath) => path.resolve(rootPath));
  const issues = [];
  const stats = {
    rootsScanned: 0,
    filesScanned: 0,
    prefixBytesRead: 0,
    skippedDirectories: 0,
  };

  async function walk(rootPath, currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const safePath = displayPath(rootPath, entryPath);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          stats.skippedDirectories += 1;
          continue;
        }
        await walk(rootPath, entryPath);
        continue;
      }

      // Never follow a link out of the reviewed repository asset tree. Failing
      // closed also prevents Metro from consuming an asset the guard did not
      // inspect.
      if (entry.isSymbolicLink()) {
        issues.push({ path: safePath, reason: 'symbolic links are not allowed in Expo image assets' });
        continue;
      }
      if (!entry.isFile()) continue;

      let prefix;
      try {
        prefix = await readBoundedPrefix(entryPath);
      } catch {
        issues.push({ path: safePath, reason: 'could not read the bounded signature prefix' });
        continue;
      }

      stats.filesScanned += 1;
      stats.prefixBytesRead += prefix.length;
      const forbiddenFormat = detectForbiddenImageSignature(prefix);
      if (forbiddenFormat) {
        issues.push({ path: safePath, reason: `forbidden ${forbiddenFormat} signature` });
      }
    }
  }

  for (const rootPath of roots) {
    if (EXCLUDED_DIRECTORY_NAMES.has(path.basename(rootPath))) {
      throw new Error(`Refusing excluded asset root: ${path.basename(rootPath)}`);
    }
    const rootStat = await fs.lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(`Expo image asset root must be a real directory: ${path.basename(rootPath)}`);
    }
    stats.rootsScanned += 1;
    await walk(rootPath, rootPath);
  }

  if (issues.length > 0) throw new ExpoImageAssetGuardError(issues, stats);
  return stats;
}

async function runCli() {
  try {
    const stats = await scanImageAssetRoots(DEFAULT_EXPO_IMAGE_ASSET_ROOTS);
    console.log(
      `[expo-image-asset-guard] PASS: inspected ${stats.filesScanned} file(s) across ${stats.rootsScanned} Expo asset root(s).`,
    );
  } catch (error) {
    if (error instanceof ExpoImageAssetGuardError) {
      console.error('[expo-image-asset-guard] BLOCKED: unsupported image signature(s) found.');
      for (const issue of error.issues) console.error(`[expo-image-asset-guard] ${issue.path}: ${issue.reason}`);
    } else {
      console.error(`[expo-image-asset-guard] BLOCKED: ${error instanceof Error ? error.message : 'asset scan failed'}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await runCli();
}
