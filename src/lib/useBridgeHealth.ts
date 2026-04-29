/**
 * useBridgeHealth — polls the local claude-bridge for liveness so the
 * chat UI can show whether /run will actually work.
 *
 * Fast path: probe immediately on mount, then every 30 s. Drops to
 * 5 s while the bridge is unhealthy so recovery is felt quickly.
 *
 * The probe is the same `/health` endpoint `detectClaudeCodeBridge`
 * uses — cheap, idempotent, abortable.
 */
import { useEffect, useRef, useState } from 'react';
import { detectClaudeCodeBridge } from './claudeCodeDetector';

export type BridgeHealth = 'unknown' | 'online' | 'offline';

export function useBridgeHealth(): { status: BridgeHealth; lastChecked: number | null; refresh: () => void } {
  const [status, setStatus] = useState<BridgeHealth>('unknown');
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  const probe = async () => {
    try {
      const ok = await detectClaudeCodeBridge();
      if (cancelledRef.current) return;
      setStatus(ok ? 'online' : 'offline');
      setLastChecked(Date.now());
    } catch {
      if (cancelledRef.current) return;
      setStatus('offline');
      setLastChecked(Date.now());
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    void probe();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const delay = status === 'online' ? 30_000 : 5_000;
      timer = setTimeout(async () => {
        await probe();
        if (!cancelledRef.current) schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return { status, lastChecked, refresh: () => { void probe(); } };
}
