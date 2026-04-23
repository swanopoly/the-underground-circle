import { Platform } from 'react-native';

const LAST_PROFILE_CIRCLE_KEY = 'uc_last_profile_circle';

type CircleProfileContext = {
  circleId: string;
  circleName?: string | null;
};

let lastProfileCircleContext: CircleProfileContext | null = null;

export function rememberLastProfileCircle(circleId: string | null | undefined, circleName?: string | null): void {
  if (!circleId) return;
  lastProfileCircleContext = { circleId, circleName: circleName || null };
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(LAST_PROFILE_CIRCLE_KEY, JSON.stringify(lastProfileCircleContext));
  } catch {}
}

export function getLastProfileCircle(): CircleProfileContext | null {
  if (lastProfileCircleContext?.circleId) return lastProfileCircleContext;
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(LAST_PROFILE_CIRCLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.circleId) {
      lastProfileCircleContext = {
        circleId: String(parsed.circleId),
        circleName: parsed.circleName ? String(parsed.circleName) : null,
      };
      return lastProfileCircleContext;
    }
  } catch {}
  return null;
}

export function navigateToUnifiedProfile(
  navigation: any,
  opts?: { circleId?: string | null; circleName?: string | null; replace?: boolean },
): boolean {
  const current = opts?.circleId ? { circleId: opts.circleId, circleName: opts.circleName || null } : getLastProfileCircle();
  if (!current?.circleId) return false;
  rememberLastProfileCircle(current.circleId, current.circleName);
  const method = opts?.replace && typeof navigation?.replace === 'function' ? 'replace' : 'navigate';
  navigation?.[method]?.('CircleDetail', {
    circleId: current.circleId,
    circleName: current.circleName || undefined,
    tab: 'PROFILE',
    _tabTs: Date.now(),
  });
  return true;
}
