// Budget math — pure, dependency-free core of the Budget Alerts system.
//
// Split out of `budgetAlerts.ts` (which imports `./storage` → react-native and
// therefore can't be loaded by tsx/esbuild smoke tests). Everything here is
// money-adjacent math that MUST be right: budget caps gate spending and
// alert thresholds warn before a cap is blown. Keeping it pure lets
// `scripts/budget-alerts-smoketest.ts` pin the behavior.
//
// `budgetAlerts.ts` re-exports every symbol here, so existing imports keep
// working unchanged.

export interface BudgetConfig {
  daily?: number;   // Daily budget in USD
  weekly?: number;  // Weekly budget in USD
  monthly?: number; // Monthly budget in USD
  enabled: boolean;
  hardLimit?: boolean; // true = block invocations when exceeded, false = alert only
}

export type AlertLevel = 'none' | 'info' | 'warning' | 'danger' | 'critical';

export interface BudgetAlert {
  level: AlertLevel;
  period: 'daily' | 'weekly' | 'monthly';
  percentage: number;
  spent: number;
  budget: number;
  remaining: number;
  message: string;
}

const ALERT_THRESHOLDS = [
  { level: 'critical' as AlertLevel, threshold: 100, emoji: '🚨' },
  { level: 'danger' as AlertLevel, threshold: 90, emoji: '⚠️' },
  { level: 'warning' as AlertLevel, threshold: 75, emoji: '💰' },
  { level: 'info' as AlertLevel, threshold: 50, emoji: '💡' },
];

// ─── Alert Calculation ──────────────────────────────────

export function calculateBudgetAlerts(
  config: BudgetConfig,
  spendToday: number,
  spendWeek: number,
  spendMonth: number
): BudgetAlert[] {
  if (!config.enabled) return [];

  const alerts: BudgetAlert[] = [];

  // Check daily budget
  if (config.daily && config.daily > 0) {
    const percentage = (spendToday / config.daily) * 100;
    const alert = getAlertForPercentage(percentage);

    if (alert) {
      alerts.push({
        level: alert.level,
        period: 'daily',
        percentage,
        spent: spendToday,
        budget: config.daily,
        remaining: Math.max(0, config.daily - spendToday),
        message: formatAlertMessage(alert.emoji, 'daily', percentage, spendToday, config.daily),
      });
    }
  }

  // Check weekly budget
  if (config.weekly && config.weekly > 0) {
    const percentage = (spendWeek / config.weekly) * 100;
    const alert = getAlertForPercentage(percentage);

    if (alert) {
      alerts.push({
        level: alert.level,
        period: 'weekly',
        percentage,
        spent: spendWeek,
        budget: config.weekly,
        remaining: Math.max(0, config.weekly - spendWeek),
        message: formatAlertMessage(alert.emoji, 'weekly', percentage, spendWeek, config.weekly),
      });
    }
  }

  // Check monthly budget
  if (config.monthly && config.monthly > 0) {
    const percentage = (spendMonth / config.monthly) * 100;
    const alert = getAlertForPercentage(percentage);

    if (alert) {
      alerts.push({
        level: alert.level,
        period: 'monthly',
        percentage,
        spent: spendMonth,
        budget: config.monthly,
        remaining: Math.max(0, config.monthly - spendMonth),
        message: formatAlertMessage(alert.emoji, 'monthly', percentage, spendMonth, config.monthly),
      });
    }
  }

  // Sort by severity (highest first)
  return alerts.sort((a, b) => {
    const levelOrder = { critical: 4, danger: 3, warning: 2, info: 1, none: 0 };
    return levelOrder[b.level] - levelOrder[a.level];
  });
}

function getAlertForPercentage(percentage: number): { level: AlertLevel; threshold: number; emoji: string } | null {
  // Return the highest applicable alert threshold
  for (const alert of ALERT_THRESHOLDS) {
    if (percentage >= alert.threshold) {
      return alert;
    }
  }
  return null;
}

function formatAlertMessage(
  emoji: string,
  period: string,
  percentage: number,
  spent: number,
  budget: number
): string {
  const remaining = Math.max(0, budget - spent);
  const percentStr = percentage.toFixed(0);

  if (percentage >= 100) {
    const overage = spent - budget;
    return `${emoji} ${period.charAt(0).toUpperCase()}${period.slice(1)} budget exceeded! $${overage.toFixed(2)} over limit`;
  }

  if (percentage >= 90) {
    return `${emoji} ${percentStr}% of ${period} budget used • $${remaining.toFixed(2)} left`;
  }

  return `${emoji} ${percentStr}% of ${period} budget used`;
}

// ─── Hard Limit Check ──────────────────────────────────

/**
 * Check if spending exceeds hard limits.
 * Returns null if OK, or a message string if blocked.
 */
export function checkHardLimit(
  config: BudgetConfig,
  spendToday: number,
  spendWeek: number,
  spendMonth: number
): string | null {
  if (!config.enabled || !config.hardLimit) return null;

  if (config.daily && config.daily > 0 && spendToday >= config.daily) {
    return `Daily spending limit reached ($${spendToday.toFixed(2)} / $${config.daily.toFixed(2)}). Agent invocations paused until tomorrow.`;
  }
  if (config.weekly && config.weekly > 0 && spendWeek >= config.weekly) {
    return `Weekly spending limit reached ($${spendWeek.toFixed(2)} / $${config.weekly.toFixed(2)}). Agent invocations paused until next week.`;
  }
  if (config.monthly && config.monthly > 0 && spendMonth >= config.monthly) {
    return `Monthly spending limit reached ($${spendMonth.toFixed(2)} / $${config.monthly.toFixed(2)}). Agent invocations paused until next month.`;
  }
  return null;
}

// ─── Alert Styling ──────────────────────────────────────

export function getAlertColor(level: AlertLevel): string {
  switch (level) {
    case 'critical': return '#dc2626';
    case 'danger': return '#ef4444';
    case 'warning': return '#f59e0b';
    case 'info': return '#3b82f6';
    default: return '#6b7280';
  }
}

export function getAlertBackgroundColor(level: AlertLevel): string {
  switch (level) {
    case 'critical': return '#dc262620';
    case 'danger': return '#ef444420';
    case 'warning': return '#f59e0b20';
    case 'info': return '#3b82f620';
    default: return '#6b728020';
  }
}

// ─── Budget Recommendations ─────────────────────────────

export function generateBudgetRecommendations(
  spendToday: number,
  spendWeek: number,
  spendMonth: number
): string[] {
  const recommendations: string[] = [];

  // Project monthly spend based on current rate
  const daysInMonth = 30;
  const projectedMonthly = (spendToday / 1) * daysInMonth;

  if (projectedMonthly > 500) {
    recommendations.push('💡 At current rate, you\'ll spend $' + projectedMonthly.toFixed(0) + ' this month. Consider setting a monthly budget.');
  }

  // Weekly volatility
  const avgDailyThisWeek = spendWeek / 7;
  if (spendToday > avgDailyThisWeek * 2) {
    recommendations.push('📊 Today\'s spend is unusually high. Check which agents are active.');
  }

  // Suggest budget if none set
  if (projectedMonthly > 0 && projectedMonthly < 1000) {
    const suggestedMonthly = Math.ceil(projectedMonthly * 1.2 / 50) * 50; // Round up to nearest $50, add 20% buffer
    recommendations.push(`💰 Suggested monthly budget: $${suggestedMonthly} (based on your usage patterns)`);
  }

  return recommendations;
}
