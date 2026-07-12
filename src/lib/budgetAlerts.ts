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

// ─── Storage Functions ──────────────────────────────────

export async function loadBudgetConfig(): Promise<BudgetConfig> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_BUDGET);
    if (!raw) return { enabled: false };
    return JSON.parse(raw);
  } catch {
    return { enabled: false };
  }
}

export async function saveBudgetConfig(config: BudgetConfig): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_BUDGET, JSON.stringify(config));
  } catch {
    console.error('Failed to save budget config');
  }
}
