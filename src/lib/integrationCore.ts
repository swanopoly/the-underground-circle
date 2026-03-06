/**
 * Integration Core — Shared adapter interface for Slack, Teams, etc.
 */

export interface IntegrationAdapter {
  type: 'slack' | 'teams';
  sendNotification(connectionId: string, channelId: string, message: string): Promise<{ error?: string }>;
  formatCheckIn(username: string, content: string, circleName: string): string;
  formatStreakUpdate(username: string, streak: number, circleName: string): string;
  formatMemberJoined(username: string, circleName: string): string;
  formatTaskCompleted(username: string, taskTitle: string, circleName: string): string;
}

export function formatCheckInDefault(username: string, content: string, circleName: string): string {
  return `✅ *${username}* checked in to *${circleName}*:\n> ${content}`;
}

export function formatStreakDefault(username: string, streak: number, circleName: string): string {
  return `🔥 *${username}* hit a *${streak}-day streak* in *${circleName}*!`;
}

export function formatMemberJoinedDefault(username: string, circleName: string): string {
  return `👋 *${username}* just joined *${circleName}*!`;
}

export function formatTaskCompletedDefault(username: string, taskTitle: string, circleName: string): string {
  return `📋 *${username}* completed "*${taskTitle}*" in *${circleName}*`;
}
