// src/lib/schoolsProgress.ts
// Progress tracking for Schools education section — AsyncStorage-based

import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = '@schools_progress';

export interface LessonProgress {
  completed: boolean;
  quizScore: number;
  quizAnswers: number[];
  completedAt?: string;
  xpAwarded: boolean;
}

export interface SchoolsProgress {
  lessons: Record<string, LessonProgress>;
  totalXpEarned: number;
  lessonsCompleted: number;
  currentStreak: number;
  lastActivityDate?: string;
}

const DEFAULT_PROGRESS: SchoolsProgress = {
  lessons: {},
  totalXpEarned: 0,
  lessonsCompleted: 0,
  currentStreak: 0,
};

export async function getProgress(): Promise<SchoolsProgress> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : { ...DEFAULT_PROGRESS };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export async function saveProgress(progress: SchoolsProgress): Promise<void> {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export async function completeLesson(
  trackId: string,
  moduleId: string,
  lessonId: string,
  quizScore: number,
  quizAnswers: number[],
  xpReward: number,
): Promise<SchoolsProgress> {
  const progress = await getProgress();
  const key = `${trackId}:${moduleId}:${lessonId}`;
  const alreadyCompleted = progress.lessons[key]?.completed;

  progress.lessons[key] = {
    completed: true,
    quizScore,
    quizAnswers,
    completedAt: new Date().toISOString(),
    xpAwarded: true,
  };

  if (!alreadyCompleted) {
    progress.lessonsCompleted += 1;
    progress.totalXpEarned += xpReward;
  }

  const today = new Date().toISOString().split('T')[0];
  if (progress.lastActivityDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    progress.currentStreak = progress.lastActivityDate === yesterday
      ? progress.currentStreak + 1
      : 1;
    progress.lastActivityDate = today;
  }

  await saveProgress(progress);
  return progress;
}

export function isLessonCompleted(
  progress: SchoolsProgress,
  trackId: string,
  moduleId: string,
  lessonId: string,
): boolean {
  return progress.lessons[`${trackId}:${moduleId}:${lessonId}`]?.completed ?? false;
}

export function getLessonProgress(
  progress: SchoolsProgress,
  trackId: string,
  moduleId: string,
  lessonId: string,
): LessonProgress | undefined {
  return progress.lessons[`${trackId}:${moduleId}:${lessonId}`];
}

export function getModuleProgress(
  progress: SchoolsProgress,
  trackId: string,
  moduleId: string,
  lessonCount: number,
): number {
  let completed = 0;
  for (const key of Object.keys(progress.lessons)) {
    if (key.startsWith(`${trackId}:${moduleId}:`) && progress.lessons[key].completed) {
      completed++;
    }
  }
  return lessonCount > 0 ? completed / lessonCount : 0;
}

export function getTrackProgress(
  progress: SchoolsProgress,
  trackId: string,
  totalLessons: number,
): number {
  let completed = 0;
  for (const key of Object.keys(progress.lessons)) {
    if (key.startsWith(`${trackId}:`) && progress.lessons[key].completed) {
      completed++;
    }
  }
  return totalLessons > 0 ? completed / totalLessons : 0;
}

export function getModuleCompletedCount(
  progress: SchoolsProgress,
  trackId: string,
  moduleId: string,
): number {
  let completed = 0;
  for (const key of Object.keys(progress.lessons)) {
    if (key.startsWith(`${trackId}:${moduleId}:`) && progress.lessons[key].completed) {
      completed++;
    }
  }
  return completed;
}
