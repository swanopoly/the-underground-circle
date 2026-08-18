import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

type PanelMode = 'center' | 'side';

type ActiveSideResize = {
  onMove: (event: MouseEvent) => void;
  onUp: () => void;
  previousCursor: string;
  previousUserSelect: string;
};

const POPUP_PADDING = 24;
const CENTER_W_RATIO = 0.62;
const CENTER_H_RATIO = 0.68;
const CENTER_MIN_W = 560;
const CENTER_MAX_W = 1000;
const CENTER_MIN_H = 480;
const CENTER_MAX_H = 720;
const SIDE_MIN_W = 380;
const SIDE_MAX_W = 720;
const SIDE_DEFAULT_W = 480;
// App header is 48px + 1px bottom border and sticks at top:0 with
// zIndex 1000 (see `AppHeader.tsx`). The docked panel uses position:fixed
// at top:0, so without this offset the header overlays the panel's top
// strip (close button, tabs) and clips them. Matches the header's total
// footprint including its border.
const APP_HEADER_OFFSET = 49;
const MODE_KEY = 'uc_agent_panel_mode_v1';
const SIDE_W_KEY = 'uc_agent_panel_side_w_v1';

function getInitialMode(): PanelMode {
  if (Platform.OS !== 'web') return 'center';
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(MODE_KEY) : null;
    if (stored === 'side' || stored === 'center') return stored;
  } catch {}
  return 'center';
}

function getInitialSideWidth(): number {
  if (Platform.OS !== 'web') return SIDE_DEFAULT_W;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SIDE_W_KEY) : null;
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        return Math.max(SIDE_MIN_W, Math.min(SIDE_MAX_W, Math.round(parsed)));
      }
    }
  } catch {}
  return SIDE_DEFAULT_W;
}

export function useAgentPanelLayout() {
  const measuredViewport = useWindowDimensions();
  const [panelMode, setPanelMode] = useState<PanelMode>(getInitialMode);
  const [sideWidth, setSideWidth] = useState<number>(getInitialSideWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [backdropOn, setBackdropOn] = useState(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);
  const activeSideResizeRef = useRef<ActiveSideResize | null>(null);
  // Browser viewport globals are not a React Native viewport contract.
  // In particular, wide native tablets enter Office's desktop breakpoint and
  // therefore consume this geometry. Keep one platform-aware source of truth
  // so rotation and split-screen changes cannot leave a 1920x1080 panel sized
  // outside the native Modal window.
  const viewport = useMemo(() => ({
    w: Number.isFinite(measuredViewport.width) && measuredViewport.width > 0
      ? measuredViewport.width
      : 320,
    h: Number.isFinite(measuredViewport.height) && measuredViewport.height > 0
      ? measuredViewport.height
      : 480,
  }), [measuredViewport.height, measuredViewport.width]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(MODE_KEY, panelMode);
    } catch {}
  }, [panelMode]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SIDE_W_KEY, String(sideWidth));
    } catch {}
  }, [sideWidth]);

  useEffect(() => {
    // Clamp a saved dock width whenever RN reports a new browser width. Native
    // also reaches this effect on rotation, but remains centered and simply
    // keeps a safe preference for a future web session.
    const availableWidth = Math.max(SIDE_MIN_W, viewport.w - 80);
    setSideWidth(width => Math.min(
      Number.isFinite(width) ? width : SIDE_DEFAULT_W,
      Math.min(SIDE_MAX_W, availableWidth),
    ));
  }, [viewport.w]);

  const toggleMode = useCallback(() => {
    setPanelMode(mode => (mode === 'center' ? 'side' : 'center'));
  }, []);

  const stopSideResize = useCallback((updateState = true) => {
    const activeResize = activeSideResizeRef.current;
    if (!activeResize) return;
    activeSideResizeRef.current = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', activeResize.onMove);
      window.removeEventListener('mouseup', activeResize.onUp);
      window.removeEventListener('blur', activeResize.onUp);
    }
    if (typeof document !== 'undefined') {
      document.body.style.cursor = activeResize.previousCursor;
      document.body.style.userSelect = activeResize.previousUserSelect;
    }
    if (updateState) setIsResizing(false);
  }, []);

  useEffect(() => {
    if (panelMode !== 'side') stopSideResize();
  }, [panelMode, stopSideResize]);

  useEffect(() => () => {
    // Never update hook state during teardown, but always restore global DOM
    // listeners and the body styles captured when resizing began.
    stopSideResize(false);
  }, [stopSideResize]);

  const startSideResize = useCallback((startPageX: number) => {
    if (Platform.OS !== 'web' || panelMode !== 'side' || typeof window === 'undefined') return;
    stopSideResize();
    dragStartX.current = startPageX;
    dragStartW.current = sideWidth;
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.pageX;
      setSideWidth(Math.max(SIDE_MIN_W, Math.min(SIDE_MAX_W, dragStartW.current + delta)));
    };

    const onUp = () => stopSideResize();

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    activeSideResizeRef.current = { onMove, onUp, previousCursor, previousUserSelect };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelMode, sideWidth, stopSideResize]);

  const resizeSideBy = useCallback((delta: number) => {
    if (panelMode !== 'side' || !Number.isFinite(delta)) return;
    setSideWidth(width => Math.max(SIDE_MIN_W, Math.min(SIDE_MAX_W, width + delta)));
  }, [panelMode]);

  const panelGeometry = useMemo(() => {
    const maxCenteredWidth = Math.max(1, viewport.w - (POPUP_PADDING * 2));
    const minCenteredWidth = Math.min(CENTER_MIN_W, maxCenteredWidth);
    const maxCenteredHeight = Math.max(1, viewport.h - (POPUP_PADDING * 2));
    const minCenteredHeight = Math.min(CENTER_MIN_H, maxCenteredHeight);
    const maxSideWidth = Math.max(1, viewport.w);
    const minSideWidth = Math.min(SIDE_MIN_W, maxSideWidth);
    const requestedSideWidth = Number.isFinite(sideWidth) ? sideWidth : SIDE_DEFAULT_W;
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

    const width = Math.min(CENTER_MAX_W, maxCenteredWidth, Math.max(minCenteredWidth, Math.round(viewport.w * CENTER_W_RATIO)));
    const height = Math.min(CENTER_MAX_H, maxCenteredHeight, Math.max(minCenteredHeight, Math.round(viewport.h * CENTER_H_RATIO)));
    return {
      width,
      height,
      left: Math.max(0, Math.round((viewport.w - width) / 2)),
      top: Math.max(0, Math.round((viewport.h - height) / 2)),
    };
  }, [panelMode, sideWidth, viewport.h, viewport.w]);

  const panelTransition = useMemo(() => {
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const duration = '280ms';
    return isResizing
      ? 'none'
      : `width ${duration} ${ease}, height ${duration} ${ease}, left ${duration} ${ease}, top ${duration} ${ease}, border-top-left-radius ${duration} ${ease}, border-bottom-left-radius ${duration} ${ease}, border-top-right-radius ${duration} ${ease}, border-bottom-right-radius ${duration} ${ease}, box-shadow ${duration} ${ease}`;
  }, [isResizing]);

  return {
    panelMode,
    panelGeometry,
    panelTransition,
    // AgentPanel owns the responsive effective mode. A saved desktop `side`
    // preference may be temporarily centered on compact web/native, so the raw
    // preference must not make that modal's blocking backdrop transparent.
    backdropOpacity: backdropOn ? 1 : 0,
    setBackdropOn,
    toggleMode,
    startSideResize,
    resizeSideBy,
  };
}
