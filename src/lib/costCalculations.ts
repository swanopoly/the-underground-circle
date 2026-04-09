// Cost calculation utilities - shared between CostDashboard and Budget Alerts
import { OpenSwanSession } from './openswanService';

export interface PeriodCosts {
  today: number;
  week: number;
  month: number;
}

/**
 * Calculate period-specific costs from sessions
 * Uses session.lastActivity to determine which period the cost belongs to
 * Note: totalCost is cumulative per session, so we attribute it to the last activity date
 */
export function calculatePeriodCosts(sessions: OpenSwanSession[]): PeriodCosts {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  let todayCost = 0;
  let thisWeekCost = 0;
  let thisMonthCost = 0;

  sessions.forEach(s => {
    const cost = s.totalCost || 0;
    const sessionDate = s.lastActivity ? new Date(s.lastActivity) : new Date();

    // Attribute cost to periods based on last activity
    if (sessionDate >= today) {
      todayCost += cost;
    }
    if (sessionDate >= weekAgo) {
      thisWeekCost += cost;
    }
    if (sessionDate >= monthAgo) {
      thisMonthCost += cost;
    }
  });

  return {
    today: todayCost,
    week: thisWeekCost,
    month: thisMonthCost,
  };
}
