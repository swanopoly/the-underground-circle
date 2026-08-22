export type AgentPanelMode = 'center' | 'side';

export type AgentPanelViewport = {
  w: number;
  h: number;
};

export type AgentPanelGeometry = {
  width: number;
  height: number;
  left: number;
  top: number;
};

const POPUP_PADDING = 24;
const CENTER_W_RATIO = 0.62;
const CENTER_H_RATIO = 0.68;
const CENTER_MIN_W = 560;
const CENTER_MAX_W = 1000;
const CENTER_MIN_H = 480;
const CENTER_MAX_H = 720;
export const AGENT_PANEL_SIDE_MIN_W = 380;
export const AGENT_PANEL_SIDE_MAX_W = 720;
export const AGENT_PANEL_SIDE_DEFAULT_W = 480;
// App header is 48px plus its 1px bottom border. A docked panel begins below
// that footprint while a centered panel remains independently centered.
const APP_HEADER_OFFSET = 49;

export function resolveAgentPanelViewport(width: number, height: number): AgentPanelViewport {
  return {
    w: Number.isFinite(width) && width > 0 ? width : 320,
    h: Number.isFinite(height) && height > 0 ? height : 480,
  };
}

export function parseAgentPanelStoredSideWidth(stored: string | null): number {
  if (stored) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      return Math.max(
        AGENT_PANEL_SIDE_MIN_W,
        Math.min(AGENT_PANEL_SIDE_MAX_W, Math.round(parsed)),
      );
    }
  }
  return AGENT_PANEL_SIDE_DEFAULT_W;
}

export function clampAgentPanelSideWidthForViewport(width: number, viewportWidth: number): number {
  const resolvedViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : 320;
  const availableWidth = Math.max(AGENT_PANEL_SIDE_MIN_W, resolvedViewportWidth - 80);
  return Math.min(
    Number.isFinite(width) ? width : AGENT_PANEL_SIDE_DEFAULT_W,
    Math.min(AGENT_PANEL_SIDE_MAX_W, availableWidth),
  );
}

export function computeAgentPanelGeometry(
  panelMode: AgentPanelMode,
  sideWidth: number,
  measuredViewport: AgentPanelViewport,
): AgentPanelGeometry {
  const viewport = resolveAgentPanelViewport(measuredViewport.w, measuredViewport.h);
  const maxCenteredWidth = Math.max(1, viewport.w - (POPUP_PADDING * 2));
  const minCenteredWidth = Math.min(CENTER_MIN_W, maxCenteredWidth);
  const maxCenteredHeight = Math.max(1, viewport.h - (POPUP_PADDING * 2));
  const minCenteredHeight = Math.min(CENTER_MIN_H, maxCenteredHeight);
  const maxSideWidth = Math.max(1, viewport.w);
  const minSideWidth = Math.min(AGENT_PANEL_SIDE_MIN_W, maxSideWidth);
  const requestedSideWidth = Number.isFinite(sideWidth) ? sideWidth : AGENT_PANEL_SIDE_DEFAULT_W;
  const clampedSideWidth = Math.min(maxSideWidth, Math.max(minSideWidth, requestedSideWidth));

  if (panelMode === 'side') {
    const top = Math.min(APP_HEADER_OFFSET, Math.max(0, viewport.h - 1));
    return {
      width: clampedSideWidth,
      height: Math.max(1, viewport.h - top),
      left: viewport.w - clampedSideWidth,
      top,
    };
  }

  const width = Math.min(
    CENTER_MAX_W,
    maxCenteredWidth,
    Math.max(minCenteredWidth, Math.round(viewport.w * CENTER_W_RATIO)),
  );
  const height = Math.min(
    CENTER_MAX_H,
    maxCenteredHeight,
    Math.max(minCenteredHeight, Math.round(viewport.h * CENTER_H_RATIO)),
  );
  return {
    width,
    height,
    left: Math.max(0, Math.round((viewport.w - width) / 2)),
    top: Math.max(0, Math.round((viewport.h - height) / 2)),
  };
}
