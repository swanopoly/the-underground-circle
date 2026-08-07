/**
 * Source-level regression coverage for the Circle workspace landing tab.
 *
 * CircleDetailScreen imports React Native UI modules, so the lightweight smoke
 * pins its navigation wiring without loading the component in Node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/screens/circles/CircleDetailScreen.tsx', 'utf8');

assert.match(
  source,
  /const DEFAULT_CIRCLE_TAB: Tab = 'OFFICE';/,
  'Office must remain the default Circle landing tab',
);
assert.match(
  source,
  /const normalizedRouteTab = normalizeTabKey\(routeTab\);\s*if \(normalizedRouteTab\) return normalizedRouteTab;\s*return loadInitialTab\(\);/,
  'explicit route tabs must continue to outrank the Office default',
);
assert.match(
  source,
  /const urlTab = normalizeTabKey\(parts\[3\]\);\s*if \(urlTab\) return urlTab;/,
  'clean path tab links must continue to resolve before the default',
);
assert.match(
  source,
  /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)[\s\S]*?if \(urlTab\) return urlTab;/,
  'legacy tab query links must continue to resolve before the default',
);
assert.doesNotMatch(
  source,
  /circle_missions[\s\S]{0,500}setActiveTab\('FEED'\)/,
  'mission loading must not override the Office landing tab',
);
assert.doesNotMatch(
  source,
  /AsyncStorage|TAB_STORAGE_KEY/,
  'stale per-circle tab persistence must not override a fresh Circle entry',
);

console.log('Circle Office default-tab smoke passed');
