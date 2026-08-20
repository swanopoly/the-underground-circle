// Budget Alerts System
// Monitor spending and alert when approaching limits
//
// The pure, money-adjacent math (alert thresholds, hard-limit enforcement,
// recommendations, styling) lives in `budgetMath.ts` so it can be smoke-tested
// without react-native. This file owns only the storage-coupled config
// load/save and re-exports the pure surface for existing callers.

import { storage } from './storage';

export type {
  BudgetConfig,
  AlertLevel,
  BudgetAlert,
} from './budgetMath';

export {
  calculateBudgetAlerts,
  checkHardLimit,
  getAlertColor,
  getAlertBackgroundColor,
  generateBudgetRecommendations,
} from './budgetMath';

import type { BudgetConfig } from './budgetMath';

const STORAGE_KEY_BUDGET = '@office_budget_config';
const STORAGE_KEY_BUDGET_SCOPED_PREFIX = '@office_budget_config_v2:';

export interface BudgetStorageScope {
  userId: string;
  circleId: string;
}

function scopedBudgetStorageKey(scope: BudgetStorageScope | undefined): string | null {
  if (!scope) return STORAGE_KEY_BUDGET;
  const userId = scope.userId.trim().toLowerCase();
  const circleId = scope.circleId.trim().toLowerCase();
  if (!userId || !circleId || userId.includes(':') || circleId.includes(':')) return null;
  return `${STORAGE_KEY_BUDGET_SCOPED_PREFIX}${userId}:${circleId}`;
}

// ─── Storage Functions ──────────────────────────────────

export async function loadBudgetConfig(scope?: BudgetStorageScope): Promise<BudgetConfig> {
  try {
    const key = scopedBudgetStorageKey(scope);
    if (!key) return { enabled: false };
    const raw = await storage.getItem(key);
    if (!raw) return { enabled: false };
    return JSON.parse(raw);
  } catch {
    return { enabled: false };
  }
}

export async function saveBudgetConfig(config: BudgetConfig, scope?: BudgetStorageScope): Promise<void> {
  try {
    const key = scopedBudgetStorageKey(scope);
    if (!key) throw new Error('Invalid budget storage scope');
    await storage.setItem(key, JSON.stringify(config));
  } catch {
    console.error('Failed to save budget config');
  }
}
