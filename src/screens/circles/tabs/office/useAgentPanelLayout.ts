import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

type PanelMode = 'center' | 'side';

const POPUP_PADDING = 24;
const CENTER_W_RATIO = 0.62;
const CENTER_H_RATIO = 0.8;
const CENTER_MIN_W = 560;
const CENTER_MAX_W = 1000;
const CENTER_MIN_H = 480;
const SIDE_MIN_W = 380;
const SIDE_MAX_W = 720;
const SIDE_DEFAULT_W = 480;
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
    if (stored) return Math.max(SIDE_MIN_W, Math.min(SIDE_MAX_W, parseInt(stored, 10)));
  } catch {}
  return SIDE_DEFAULT_W;
}

export function useAgentPanelLayout() {
  const [panelMode, setPanelMode] = useState<PanelMode>(getInitialMode);
  const [sideWidth, setSideWidth] = useState<number>(getInitialSideWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [backdropOn, setBackdropOn] = useState(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));

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
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setSideWidth(width => Math.min(width, Math.min(SIDE_MAX_W, window.innerWidth - 80)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleMode = useCallback(() => {
    setPanelMode(mode => (mode === 'center' ? 'side' : 'center'));
  }, []);

  const startSideResize = useCallback((startPageX: number) => {
    if (Platform.OS !== 'web' || panelMode !== 'side' || typeof window === 'undefined') return;
    dragStartX.current = startPageX;
    dragStartW.current = sideWidth;
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.pageX;
      setSideWidth(Math.max(SIDE_MIN_W, Math.min(SIDE_MAX_W, dragStartW.current + delta)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelMode, sideWidth]);

  const panelGeometry = useMemo(() => {
    const maxCenteredWidth = Math.max(CENTER_MIN_W, viewport.w - (POPUP_PADDING * 2));
    const maxCenteredHeight = Math.max(CENTER_MIN_H, viewport.h - (POPUP_PADDING * 2));
    const clampedSideWidth = Math.max(
      Math.min(sideWidth, Math.max(320, viewport.w - 24)),
      Math.min(SIDE_MIN_W, Math.max(280, viewport.w - 24)),
    );

    if (panelMode === 'side') {
      return {
        width: clampedSideWidth,
        height: viewport.h,
        left: viewport.w - clampedSideWidth,
        top: 0,
      };
    }

    const width = Math.min(CENTER_MAX_W, maxCenteredWidth, Math.max(CENTER_MIN_W, Math.round(viewport.w * CENTER_W_RATIO)));
    const height = Math.min(maxCenteredHeight, Math.max(CENTER_MIN_H, Math.round(viewport.h * CENTER_H_RATIO)));
    return {
      width,
      height,
      left: Math.max(POPUP_PADDING, Math.round((viewport.w - width) / 2)),
      top: Math.max(POPUP_PADDING, Math.round((viewport.h - height) / 2)),
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
    backdropOpacity: backdropOn && panelMode === 'center' ? 1 : 0,
    setBackdropOn,
    toggleMode,
    startSideResize,
  };
}
