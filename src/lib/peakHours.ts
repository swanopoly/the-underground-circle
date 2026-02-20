// Peak Hours Multiplier System
// Engagement hook to drive users back throughout the day

export interface PeakHours {
  name: string;
  start: string; // HH:MM format
  end: string;   // HH:MM format
  multiplier: number;
  emoji: string;
}

export const PEAK_HOURS_SCHEDULE: PeakHours[] = [
  {
    name: 'Morning Boost',
    start: '07:00',
    end: '09:00',
    multiplier: 2.0,
    emoji: '🌅'
  },
  {
    name: 'Lunch Break Boost', 
    start: '12:00',
    end: '13:00',
    multiplier: 1.5,
    emoji: '🍽️'
  },
  {
    name: 'Evening Grind',
    start: '19:00',
    end: '21:00', 
    multiplier: 2.0,
    emoji: '🌃'
  }
];

export function getCurrentMultiplier(): PeakHours | null {
  const now = new Date();
  const currentTime = now.toTimeString().substring(0, 5); // HH:MM format
  
  return PEAK_HOURS_SCHEDULE.find(period => {
    return currentTime >= period.start && currentTime <= period.end;
  }) || null;
}

export function getNextMultiplier(): { period: PeakHours; minutesUntil: number } | null {
  const now = new Date();
  const currentTime = now.toTimeString().substring(0, 5);
  
  // Find next upcoming period today
  for (const period of PEAK_HOURS_SCHEDULE) {
    if (currentTime < period.start) {
      const [startHour, startMin] = period.start.split(':').map(Number);
      const nextStart = new Date(now);
      nextStart.setHours(startHour, startMin, 0, 0);
      
      const minutesUntil = Math.floor((nextStart.getTime() - now.getTime()) / 60000);
      return { period, minutesUntil };
    }
  }
  
  // If no more periods today, return tomorrow's first period
  const tomorrowFirst = PEAK_HOURS_SCHEDULE[0];
  const [startHour, startMin] = tomorrowFirst.start.split(':').map(Number);
  const nextStart = new Date(now);
  nextStart.setDate(nextStart.getDate() + 1);
  nextStart.setHours(startHour, startMin, 0, 0);
  
  const minutesUntil = Math.floor((nextStart.getTime() - now.getTime()) / 60000);
  return { period: tomorrowFirst, minutesUntil };
}

export function applyMultiplier(baseXp: number, eventType: string): number {
  // Only apply multiplier to specific event types
  const multiplierEvents = ['check_in', 'task_complete', 'challenge_progress'];
  if (!multiplierEvents.includes(eventType)) {
    return baseXp;
  }
  
  const currentPeriod = getCurrentMultiplier();
  if (!currentPeriod) {
    return baseXp;
  }
  
  return Math.floor(baseXp * currentPeriod.multiplier);
}

export function formatTimeUntil(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}