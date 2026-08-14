/**
 * Site-wide modal motion contract.
 *
 * Product dialogs should enter without directional movement. React Native's
 * Modal primitive is the source scanned here so new feature modals do not
 * quietly restore side or bottom slide transitions.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

let passes = 0;
let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passes += 1;
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function modalPrimitiveOccurrences(source: string): number {
  // Count JSX Modal elements only. Type names such as `ModalResult` and
  // generic annotations such as `useState<ModalResult>` are not product
  // dialogs and must not create false transition regressions.
  return source.match(/<Modal(?:\s|>)/g)?.length || 0;
}

const repoRoot = process.cwd();
const files = [join(repoRoot, 'App.tsx'), ...sourceFiles(join(repoRoot, 'src'))];
const sources = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
const modalFiles = sources.filter(({ source }) => modalPrimitiveOccurrences(source) > 0);
const modalCount = modalFiles.reduce((total, { source }) => total + modalPrimitiveOccurrences(source), 0);
const fadeCount = modalFiles.reduce((total, { source }) => total + occurrences(source, 'animationType="fade"'), 0);
const nonFadeFiles = modalFiles
  .filter(({ source }) => modalPrimitiveOccurrences(source) !== occurrences(source, 'animationType="fade"'))
  .map(({ path }) => path.replace(`${repoRoot}/`, ''));
const directionalMotionFiles = modalFiles
  .filter(({ source }) => /animationType\s*=\s*["'](?:slide|none)["']/.test(source))
  .map(({ path }) => path.replace(`${repoRoot}/`, ''));

assert(modalCount > 0, 'the source inventory finds product Modal primitives');
assert(
  fadeCount === modalCount,
  `all ${modalCount} product Modal primitives explicitly use fade${nonFadeFiles.length ? `; mismatches: ${nonFadeFiles.join(', ')}` : ''}`,
);
assert(
  directionalMotionFiles.length === 0,
  `no product Modal requests slide/none entrance motion${directionalMotionFiles.length ? `: ${directionalMotionFiles.join(', ')}` : ''}`,
);

const serviceMenu = readFileSync(
  join(repoRoot, 'src/screens/circles/tabs/chat/OpenSwanServiceMenu.tsx'),
  'utf8',
);
assert(
  serviceMenu.includes('animationType="fade"')
    && serviceMenu.includes("justifyContent: 'center'")
    && serviceMenu.includes('paddingVertical: 16')
    && serviceMenu.includes('borderRadius: 16'),
  'OpenSwan Service is a centered, padded, rounded fade dialog',
);
assert(
  !serviceMenu.includes('<View style={styles.grabber}')
    && !serviceMenu.includes('grabber: {')
    && !serviceMenu.includes("justifyContent: 'flex-end'"),
  'the centered OpenSwan Service no longer retains bottom-sheet positioning chrome',
);

console.log(`\nModal fade transition smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
