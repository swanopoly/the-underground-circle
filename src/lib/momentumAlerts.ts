// Circle Momentum Alerts - Engagement Hook System
// Real-time social triggers combined with peak hours multipliers

import React from 'react';
import { supabase } from './supabase';
import { getCurrentMultiplier, getNextMultiplier, PEAK_HOURS_SCHEDULE } from './peakHours';
import { getXPForAction } from './gamification';
import { indexSafeProfiles, loadSafeCircleProfiles } from './safeProfiles';

export interface CircleMomentum {
  circleId: string;
  circleName: string;
  activeMembers: string[]; // user IDs
  recentActivities: ActivityEvent[];
  currentStreak: number;
  peakHoursActive: boolean;
  momentumScore: number; // 0-100
}

export interface ActivityEvent {
  userId: string;
  userName: string;
  action: string;
  timestamp: Date;
  xpEarned: number;
  duringPeakHours: boolean;
}

export interface MomentumAlert {
  id: string;
  type: 'circle_activity' | 'peak_hours_ending' | 'streak_bonus' | 'competition';
  title: string;
  message: string;
  actionText: string;
  urgencyLevel: 'low' | 'medium' | 'high';
  expiresAt: Date;
  xpBonus?: number;
  circleId?: string;
}

class MomentumAlertsSystem {
  private activeSubscriptions: Map<string, any> = new Map();
  private alertCache: Map<string, MomentumAlert[]> = new Map();

  // Subscribe to circle activity for real-time momentum detection
  async subscribeToCircleMomentum(userId: string, circleIds: string[]): Promise<void> {
    for (const circleId of circleIds) {
      // Unsubscribe if already subscribed
      if (this.activeSubscriptions.has(circleId)) {
        this.activeSubscriptions.get(circleId)?.unsubscribe();
      }

      // Subscribe to check-ins from circle members
      const subscription = supabase
        .channel(`circle_momentum_${circleId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'check_ins',
          filter: `circle_id=eq.${circleId}`
        }, (payload) => {
          this.handleCircleActivity(userId, circleId, payload.new);
        })
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'xp_events',
          filter: `circle_id=eq.${circleId}`
        }, (payload) => {
          this.handleXPEvent(userId, circleId, payload.new);
        })
        .subscribe();

      this.activeSubscriptions.set(circleId, subscription);
    }

    // Also subscribe to peak hours transitions
    this.startPeakHoursAlerts(userId, circleIds);
  }

  private async handleCircleActivity(userId: string, circleId: string, checkInData: any): Promise<void> {
    // Don't alert for user's own activity
    if (checkInData.user_id === userId) return;

    const currentMultiplier = getCurrentMultiplier();
    const momentum = await this.calculateCircleMomentum(circleId);
    
    // Generate social trigger alert
    if (momentum.momentumScore > 60) { // High momentum threshold
      const alert: MomentumAlert = {
        id: `momentum_${circleId}_${Date.now()}`,
        type: 'circle_activity',
        title: currentMultiplier ? 
          `🔥 ${momentum.circleName} is grinding during ${currentMultiplier.emoji} ${currentMultiplier.name}!` :
          `⚡ Your circle is active - join the momentum!`,
        message: currentMultiplier ?
          `${momentum.activeMembers.length} members active. ${currentMultiplier.multiplier}x XP ends in ${this.getTimeUntilPeakEnds()} minutes!` :
          `${momentum.activeMembers.length} circle mates are checking in. Don't break the streak!`,
        actionText: 'Check In Now',
        urgencyLevel: currentMultiplier ? 'high' : 'medium',
        expiresAt: currentMultiplier ? this.getPeakHoursEndTime() : new Date(Date.now() + 30 * 60 * 1000), // 30 min
        xpBonus: currentMultiplier ? getXPForAction('check_in') * (currentMultiplier.multiplier - 1) : undefined,
        circleId
      };

      await this.sendAlert(userId, alert);
    }
  }

  private async handleXPEvent(userId: string, circleId: string, xpData: any): Promise<void> {
    if (xpData.user_id === userId) return;

    // Alert for major achievements by circle mates
    if (xpData.amount >= 100) { // Big XP gain
      const [userData] = await loadSafeCircleProfiles({ circleId, userIds: [xpData.user_id] });

      const userName = userData?.display_name || userData?.username || 'Circle mate';
      
      const alert: MomentumAlert = {
        id: `achievement_${circleId}_${Date.now()}`,
        type: 'competition',
        title: `🏆 ${userName} just earned ${xpData.amount} XP!`,
        message: `They're pulling ahead. Time to step up your grind!`,
        actionText: 'Catch Up',
        urgencyLevel: 'medium',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        circleId
      };

      await this.sendAlert(userId, alert);
    }
  }

  private async calculateCircleMomentum(circleId: string): Promise<CircleMomentum> {
    // Get circle info
    const { data: circle } = await supabase
      .from('circles')
      .select('name')
      .eq('id', circleId)
      .single();

    // Get recent activity (last 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const { data: recentCheckIns } = await supabase
      .from('check_ins')
      .select('user_id, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', twoHoursAgo.toISOString())
      .order('created_at', { ascending: false });

    const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
      circleId,
      userIds: (recentCheckIns || []).map(ci => ci.user_id),
    }));
    const activeMembers = [...new Set((recentCheckIns || []).map(ci => ci.user_id))];
    
    const recentActivities: ActivityEvent[] = (recentCheckIns || []).map((ci: any) => ({
      userId: ci.user_id,
      userName: profileById.get(ci.user_id)?.display_name || profileById.get(ci.user_id)?.username || 'Circle member',
      action: 'check_in',
      timestamp: new Date(ci.created_at),
      xpEarned: getXPForAction('check_in'),
      duringPeakHours: this.wasDuringPeakHours(new Date(ci.created_at))
    }));

    // Calculate momentum score based on recent activity and timing
    let momentumScore = Math.min(activeMembers.length * 20, 80); // Base score
    if (getCurrentMultiplier()) momentumScore += 20; // Bonus during peak hours
    
    return {
      circleId,
      circleName: circle?.name || 'Your Circle',
      activeMembers,
      recentActivities,
      currentStreak: recentActivities.length, // Simplified
      peakHoursActive: getCurrentMultiplier() !== null,
      momentumScore: Math.min(momentumScore, 100)
    };
  }

  private startPeakHoursAlerts(userId: string, circleIds: string[]): void {
    // Check every minute for peak hours transitions
    const interval = setInterval(async () => {
      const nextPeak = getNextMultiplier();
      
      // Alert 5 minutes before peak hours
      if (nextPeak && nextPeak.minutesUntil <= 5 && nextPeak.minutesUntil > 0) {
        const alert: MomentumAlert = {
          id: `peak_starting_${Date.now()}`,
          type: 'peak_hours_ending',
          title: `⏰ ${nextPeak.period.emoji} ${nextPeak.period.name} starts in ${nextPeak.minutesUntil} min`,
          message: `Get ready for ${nextPeak.period.multiplier}x XP! Perfect time to check in.`,
          actionText: 'Set Reminder',
          urgencyLevel: 'medium',
          expiresAt: new Date(Date.now() + nextPeak.minutesUntil * 60 * 1000),
          xpBonus: getXPForAction('check_in') * (nextPeak.period.multiplier - 1)
        };

        await this.sendAlert(userId, alert);
      }

      // Alert 15 minutes before peak hours end
      const currentPeak = getCurrentMultiplier();
      if (currentPeak) {
        const minutesLeft = this.getTimeUntilPeakEnds();
        if (minutesLeft <= 15 && minutesLeft > 0) {
          const alert: MomentumAlert = {
            id: `peak_ending_${Date.now()}`,
            type: 'peak_hours_ending',
            title: `⚡ Last chance for ${currentPeak.multiplier}x XP!`,
            message: `${currentPeak.emoji} ${currentPeak.name} ends in ${minutesLeft} minutes.`,
            actionText: 'Check In Now',
            urgencyLevel: 'high',
            expiresAt: this.getPeakHoursEndTime(),
            xpBonus: getXPForAction('check_in') * (currentPeak.multiplier - 1)
          };

          await this.sendAlert(userId, alert);
        }
      }
    }, 60000); // Check every minute

    // Store interval reference for cleanup
    this.activeSubscriptions.set(`peak_timer_${userId}`, { 
      unsubscribe: () => clearInterval(interval) 
    });
  }

  private async sendAlert(userId: string, alert: MomentumAlert): Promise<void> {
    // Cache the alert
    const userAlerts = this.alertCache.get(userId) || [];
    userAlerts.push(alert);
    this.alertCache.set(userId, userAlerts);

    // Store in database for persistence
    await supabase.from('momentum_alerts').insert({
      id: alert.id,
      user_id: userId,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      action_text: alert.actionText,
      urgency_level: alert.urgencyLevel,
      expires_at: alert.expiresAt.toISOString(),
      xp_bonus: alert.xpBonus,
      circle_id: alert.circleId,
      created_at: new Date().toISOString()
    });

    // TODO: Integrate with push notifications service
  }

  private wasDuringPeakHours(timestamp: Date): boolean {
    const timeStr = timestamp.toTimeString().substring(0, 5);
    return PEAK_HOURS_SCHEDULE.some(period => 
      timeStr >= period.start && timeStr <= period.end
    );
  }

  private getTimeUntilPeakEnds(): number {
    const currentPeak = getCurrentMultiplier();
    if (!currentPeak) return 0;

    const now = new Date();
    const [endHour, endMin] = currentPeak.end.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(endHour, endMin, 0, 0);

    return Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 60000));
  }

  private getPeakHoursEndTime(): Date {
    const currentPeak = getCurrentMultiplier();
    if (!currentPeak) return new Date();

    const now = new Date();
    const [endHour, endMin] = currentPeak.end.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(endHour, endMin, 0, 0);

    return endTime;
  }

  // Get pending alerts for user
  async getAlertsForUser(userId: string): Promise<MomentumAlert[]> {
    const cached = this.alertCache.get(userId) || [];
    const now = new Date();
    
    // Filter out expired alerts
    const active = cached.filter(alert => alert.expiresAt > now);
    this.alertCache.set(userId, active);

    return active;
  }

  // Mark alert as acted upon
  async dismissAlert(userId: string, alertId: string): Promise<void> {
    const userAlerts = this.alertCache.get(userId) || [];
    const filtered = userAlerts.filter(alert => alert.id !== alertId);
    this.alertCache.set(userId, filtered);

    // Mark as dismissed in database
    await supabase
      .from('momentum_alerts')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', alertId)
      .eq('user_id', userId);
  }

  // Cleanup subscriptions
  cleanup(): void {
    for (const [key, subscription] of this.activeSubscriptions) {
      subscription.unsubscribe();
    }
    this.activeSubscriptions.clear();
    this.alertCache.clear();
  }
}

// Export singleton instance
export const momentumAlerts = new MomentumAlertsSystem();

// Hook for React components
export function useMomentumAlerts(userId: string, circleIds: string[]) {
  const [alerts, setAlerts] = React.useState<MomentumAlert[]>([]);

  React.useEffect(() => {
    if (!userId || circleIds.length === 0) return;

    // Subscribe to momentum
    momentumAlerts.subscribeToCircleMomentum(userId, circleIds);

    // Poll for alerts every 30 seconds
    const interval = setInterval(async () => {
      const userAlerts = await momentumAlerts.getAlertsForUser(userId);
      setAlerts(userAlerts);
    }, 30000);

    // Initial load
    momentumAlerts.getAlertsForUser(userId).then(setAlerts);

    return () => {
      clearInterval(interval);
      momentumAlerts.cleanup();
    };
  }, [userId, circleIds.join(',')]);

  const dismissAlert = async (alertId: string) => {
    await momentumAlerts.dismissAlert(userId, alertId);
    const updatedAlerts = await momentumAlerts.getAlertsForUser(userId);
    setAlerts(updatedAlerts);
  };

  return { alerts, dismissAlert };
}

// Required database table (to be added to Supabase migration):
/*
CREATE TABLE momentum_alerts (
  id text PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  action_text text NOT NULL,
  urgency_level text NOT NULL CHECK (urgency_level IN ('low', 'medium', 'high')),
  expires_at timestamptz NOT NULL,
  xp_bonus integer,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW(),
  dismissed_at timestamptz,
  acted_at timestamptz
);

CREATE INDEX momentum_alerts_user_id_idx ON momentum_alerts(user_id);
CREATE INDEX momentum_alerts_expires_at_idx ON momentum_alerts(expires_at);
*/
