/**
 * Notifications — local + push notification system
 *
 * Uses expo-notifications for local notifications on all platforms.
 * Push notifications require a push token from Expo's push service.
 *
 * Events that trigger notifications:
 * - Mission task completed by teammate
 * - Mission overdue
 * - Agent completed a dispatched task
 * - Streak milestone reached
 * - BlackSwan automation posted
 */
import { Platform } from 'react-native';

let Notifications: typeof import('expo-notifications') | null = null;

// Lazy-load expo-notifications (may not be available on all platforms)
async function getNotifications() {
  if (Notifications) return Notifications;
  try {
    Notifications = await import('expo-notifications');
    return Notifications;
  } catch {
    return null;
  }
}

// ─── Permission ──────────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  // Web: use browser Notification API
  if (Platform.OS === 'web') {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // Native: use expo-notifications
  const notif = await getNotifications();
  if (!notif) return false;

  const { status: existing } = await notif.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await notif.requestPermissionsAsync();
  return status === 'granted';
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }
  const notif = await getNotifications();
  if (!notif) return false;
  const { status } = await notif.getPermissionsAsync();
  return status === 'granted';
}

// ─── Send Local Notification ─────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export async function sendLocalNotification(payload: NotificationPayload): Promise<void> {
  const hasPermission = await hasNotificationPermission();
  if (!hasPermission) return;

  // Web: use browser Notification API
  if (Platform.OS === 'web') {
    try {
      new Notification(payload.title, {
        body: payload.body,
        icon: '/favicon.ico',
        tag: payload.data?.tag || 'uc-notification',
      });
    } catch {}
    return;
  }

  // Native: use expo-notifications
  const notif = await getNotifications();
  if (!notif) return;

  await notif.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      sound: true,
    },
    trigger: null, // immediate
  });
}

// ─── Mission Event Notifications ─────────────────────────────────────────────

export async function notifyTaskCompleted(taskTitle: string, completedBy: string) {
  await sendLocalNotification({
    title: 'Task Completed',
    body: `${completedBy} finished: ${taskTitle}`,
    data: { type: 'task_completed', tag: 'mission' },
  });
}

export async function notifyMissionComplete(missionTitle: string) {
  await sendLocalNotification({
    title: 'Mission Complete!',
    body: `${missionTitle} — all tasks done`,
    data: { type: 'mission_complete', tag: 'mission' },
  });
}

export async function notifyMissionOverdue(missionTitle: string, daysOverdue: number) {
  await sendLocalNotification({
    title: 'Mission Overdue',
    body: `${missionTitle} is ${daysOverdue}d past deadline`,
    data: { type: 'mission_overdue', tag: 'mission' },
  });
}

export async function notifyAgentCompleted(agentName: string, taskTitle: string) {
  await sendLocalNotification({
    title: `${agentName} Done`,
    body: `Completed: ${taskTitle}`,
    data: { type: 'agent_completed', tag: 'agent' },
  });
}

export async function notifyStreakMilestone(streakDays: number, milestoneName: string) {
  await sendLocalNotification({
    title: `Streak: ${milestoneName}!`,
    body: `${streakDays} days of shipping. Keep it up.`,
    data: { type: 'streak_milestone', tag: 'streak' },
  });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

/**
 * Configure notification channels (Android) and handlers.
 * Call once on app startup.
 */
export async function setupNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const notif = await getNotifications();
  if (!notif) return;

  // Handle notifications when app is foregrounded
  notif.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    } as any),
  });

  // Android notification channel
  if (Platform.OS === 'android') {
    await notif.setNotificationChannelAsync('missions', {
      name: 'Missions',
      importance: notif.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250],
    });
  }
}
