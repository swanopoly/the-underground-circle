/**
 * Executable geometry contract for the Office Agent popup.
 *
 * Unlike the legacy source-marker checks, this imports the RN-free production
 * core used by the hook and exercises its persisted-width, resize, rotation,
 * compact-window, and invalid-measurement behavior directly.
 */

import assert from 'node:assert/strict';
import {
  AGENT_PANEL_SIDE_DEFAULT_W,
  AGENT_PANEL_SIDE_MAX_W,
  AGENT_PANEL_SIDE_MIN_W,
  clampAgentPanelSideWidthForViewport,
  computeAgentPanelGeometry,
  parseAgentPanelStoredSideWidth,
  resolveAgentPanelViewport,
  type AgentPanelMode,
} from '../src/screens/circles/tabs/office/agentPanelLayoutCore';

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  assert.ok(condition, message);
};

assert.deepEqual(
  resolveAgentPanelViewport(Number.NaN, Number.POSITIVE_INFINITY),
  { w: 320, h: 480 },
  'non-finite measurements use the bounded compact fallback',
);
assertions += 1;
assert.deepEqual(
  resolveAgentPanelViewport(0, -1),
  { w: 320, h: 480 },
  'zero and negative measurements use the bounded compact fallback',
);
assertions += 1;
assert.deepEqual(
  resolveAgentPanelViewport(375.5, 812.25),
  { w: 375.5, h: 812.25 },
  'positive fractional live measurements remain exact',
);
assertions += 1;

for (const [stored, expected] of [
  [null, AGENT_PANEL_SIDE_DEFAULT_W],
  ['', AGENT_PANEL_SIDE_DEFAULT_W],
  ['NaN', AGENT_PANEL_SIDE_DEFAULT_W],
  ['Infinity', AGENT_PANEL_SIDE_DEFAULT_W],
  ['-Infinity', AGENT_PANEL_SIDE_DEFAULT_W],
  ['480junk', AGENT_PANEL_SIDE_DEFAULT_W],
  ['-50', AGENT_PANEL_SIDE_MIN_W],
  [' ', AGENT_PANEL_SIDE_MIN_W],
  ['379.4', AGENT_PANEL_SIDE_MIN_W],
  ['380.6', 381],
  ['480', AGENT_PANEL_SIDE_DEFAULT_W],
  ['9999', AGENT_PANEL_SIDE_MAX_W],
] as const) {
  assert.equal(
    parseAgentPanelStoredSideWidth(stored),
    expected,
    `stored side width ${JSON.stringify(stored)} resolves safely`,
  );
  assertions += 1;
}

for (const [width, viewportWidth, expected] of [
  [Number.NaN, 1180, AGENT_PANEL_SIDE_DEFAULT_W],
  [AGENT_PANEL_SIDE_MAX_W, 1180, AGENT_PANEL_SIDE_MAX_W],
  [AGENT_PANEL_SIDE_MAX_W, 600, 520],
  [AGENT_PANEL_SIDE_MAX_W, 320, AGENT_PANEL_SIDE_MIN_W],
  [AGENT_PANEL_SIDE_DEFAULT_W, Number.NaN, AGENT_PANEL_SIDE_MIN_W],
] as const) {
  assert.equal(
    clampAgentPanelSideWidthForViewport(width, viewportWidth),
    expected,
    `side preference ${String(width)} is clamped for viewport ${String(viewportWidth)}`,
  );
  assertions += 1;
}

assert.deepEqual(
  computeAgentPanelGeometry('center', 480, { w: 1180, h: 820 }),
  { width: 732, height: 558, left: 224, top: 131 },
  'landscape desktop centered geometry remains exact',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('center', 480, { w: 320, h: 480 }),
  { width: 272, height: 432, left: 24, top: 24 },
  'compact centered geometry preserves the intended padding',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('center', 480, { w: 20, h: 20 }),
  { width: 1, height: 1, left: 10, top: 10 },
  'degenerate positive viewports still receive finite contained geometry',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('side', 480, { w: 1180, h: 820 }),
  { width: 480, height: 771, left: 700, top: 49 },
  'desktop dock geometry begins below the exact app-header footprint',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('side', 720, { w: 240, h: 30 }),
  { width: 240, height: 1, left: 0, top: 29 },
  'a narrow and very short dock remains inside the viewport',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('side', Number.NaN, { w: 820, h: 1180 }),
  { width: 480, height: 1131, left: 340, top: 49 },
  'non-finite live side state recovers to the default width',
);
assertions += 1;
assert.deepEqual(
  computeAgentPanelGeometry('center', 480, { w: 3840, h: 2160 }),
  { width: 1000, height: 720, left: 1420, top: 720 },
  'wide displays retain the bounded centered maximum',
);
assertions += 1;

const rawViewports = [
  { w: Number.NaN, h: Number.NaN },
  { w: Number.POSITIVE_INFINITY, h: Number.NEGATIVE_INFINITY },
  { w: -10, h: 0 },
  { w: 1, h: 1 },
  { w: 20, h: 20 },
  { w: 240, h: 320 },
  { w: 320, h: 480 },
  { w: 600, h: 360 },
  { w: 820, h: 1180 },
  { w: 1180, h: 30 },
  { w: 1180, h: 500 },
  { w: 1180, h: 820 },
  { w: 3840, h: 2160 },
];
const modes: readonly AgentPanelMode[] = ['center', 'side'];
const sideWidths = [
  Number.NEGATIVE_INFINITY,
  -100,
  0,
  379,
  AGENT_PANEL_SIDE_MIN_W,
  AGENT_PANEL_SIDE_DEFAULT_W,
  AGENT_PANEL_SIDE_MAX_W,
  10_000,
  Number.POSITIVE_INFINITY,
  Number.NaN,
];

for (const rawViewport of rawViewports) {
  const viewport = resolveAgentPanelViewport(rawViewport.w, rawViewport.h);
  for (const mode of modes) {
    for (const sideWidth of sideWidths) {
      const geometry = computeAgentPanelGeometry(mode, sideWidth, rawViewport);
      check(
        Object.values(geometry).every(Number.isFinite),
        `${mode} geometry stays finite for ${String(rawViewport.w)}x${String(rawViewport.h)} and ${String(sideWidth)}`,
      );
      check(
        geometry.width >= 1
          && geometry.height >= 1
          && geometry.left >= 0
          && geometry.top >= 0
          && geometry.left + geometry.width <= viewport.w
          && geometry.top + geometry.height <= viewport.h,
        `${mode} geometry stays contained for ${String(rawViewport.w)}x${String(rawViewport.h)} and ${String(sideWidth)}`,
      );
    }
  }
}

let rotatingPreference = AGENT_PANEL_SIDE_MAX_W;
rotatingPreference = clampAgentPanelSideWidthForViewport(rotatingPreference, 1180);
assert.equal(rotatingPreference, 720, 'landscape retains the maximum dock preference');
assertions += 1;
rotatingPreference = clampAgentPanelSideWidthForViewport(rotatingPreference, 600);
assert.equal(rotatingPreference, 520, 'shorter split-screen width clamps the live dock preference');
assertions += 1;
rotatingPreference = clampAgentPanelSideWidthForViewport(rotatingPreference, 320);
assert.equal(rotatingPreference, 380, 'compact rotation leaves a bounded future dock preference');
assertions += 1;
const compactDock = computeAgentPanelGeometry('side', rotatingPreference, { w: 320, h: 480 });
assert.equal(compactDock.width, 320, 'geometry still clamps the preference to the actual compact viewport');
assertions += 1;

console.log(`office agent panel layout core smoke passed (${assertions} assertions)`);
