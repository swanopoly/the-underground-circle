import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import {
  AGENT_PANEL_SIDE_DEFAULT_W,
  AGENT_PANEL_SIDE_MAX_W,
  AGENT_PANEL_SIDE_MIN_W,
  clampAgentPanelSideWidthForViewport,
  computeAgentPanelGeometry,
  parseAgentPanelStoredSideWidth,
  resolveAgentPanelViewport,
  type AgentPanelMode,
} from './agentPanelLayoutCore';

type ActiveSideResize = {
  onMove: (event: MouseEvent) => void;
  onUp: () => void;
  previousCursor: string;
  previousUserSelect: string;
};

const MODE_KEY = 'uc_agent_panel_mode_v1';
const SIDE_W_KEY = 'uc_agent_panel_side_w_v1';

function getInitialMode(): AgentPanelMode {
  if (Platform.OS !== 'web') return 'center';
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(MODE_KEY) : null;
    if (stored === 'side' || stored === 'center') return stored;
  } catch {}
  return 'center';
}

function getInitialSideWidth(): number {
  if (Platform.OS !== 'web') return AGENT_PANEL_SIDE_DEFAULT_W;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SIDE_W_KEY) : null;
    return parseAgentPanelStoredSideWidth(stored);
  } catch {}
  return AGENT_PANEL_SIDE_DEFAULT_W;
}

export function useAgentPanelLayout(allowSideMode = true) {
  const measuredViewport = useWindowDimensions();
  const [panelMode, setPanelMode] = useState<AgentPanelMode>(getInitialMode);
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
  const viewport = useMemo(
    () => resolveAgentPanelViewport(measuredViewport.width, measuredViewport.height),
    [measuredViewport.height, measuredViewport.width],
  );

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
    setSideWidth(width => clampAgentPanelSideWidthForViewport(width, viewport.w));
  }, [viewport.w]);

  const effectivePanelMode: AgentPanelMode = allowSideMode ? panelMode : 'center';

  const toggleMode = useCallback(() => {
    if (!allowSideMode) return;
    setPanelMode(mode => (mode === 'center' ? 'side' : 'center'));
  }, [allowSideMode]);

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
    if (effectivePanelMode !== 'side') stopSideResize();
  }, [effectivePanelMode, stopSideResize]);

  useEffect(() => () => {
    // Never update hook state during teardown, but always restore global DOM
    // listeners and the body styles captured when resizing began.
    stopSideResize(false);
  }, [stopSideResize]);

  const startSideResize = useCallback((startPageX: number) => {
    if (Platform.OS !== 'web' || effectivePanelMode !== 'side' || typeof window === 'undefined') return;
    stopSideResize();
    dragStartX.current = startPageX;
    dragStartW.current = sideWidth;
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.pageX;
      setSideWidth(Math.max(
        AGENT_PANEL_SIDE_MIN_W,
        Math.min(AGENT_PANEL_SIDE_MAX_W, dragStartW.current + delta),
      ));
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
  }, [effectivePanelMode, sideWidth, stopSideResize]);

  const resizeSideBy = useCallback((delta: number) => {
    if (effectivePanelMode !== 'side' || !Number.isFinite(delta)) return;
    setSideWidth(width => Math.max(
      AGENT_PANEL_SIDE_MIN_W,
      Math.min(AGENT_PANEL_SIDE_MAX_W, width + delta),
    ));
  }, [effectivePanelMode]);

  const panelGeometry = useMemo(
    () => computeAgentPanelGeometry(effectivePanelMode, sideWidth, viewport),
    [effectivePanelMode, sideWidth, viewport],
  );

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
