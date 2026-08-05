# Schools Education Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full education section teaching kids (ages 10-18) about AI technology, math for the AI era, and critical/empathetic thinking — with interactive lessons, quizzes, progress tracking, and XP integration.

**Architecture:** The Schools section becomes a multi-screen experience: Hub (3 tracks) -> Track (8 modules) -> Module (lessons list) -> Lesson (content sections with quizzes/challenges/reflections). All curriculum data lives in a single data file. Progress is tracked in AsyncStorage with XP awards flowing through the existing gamification system. No new Supabase tables required for v1.

**Tech Stack:** React Native + Expo, TypeScript, AsyncStorage for progress, existing gamification/XP system for rewards.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/schoolsData.ts` | All curriculum data: 3 tracks, 24 modules, lessons, quizzes, challenges |
| `src/lib/schoolsProgress.ts` | Progress tracking: lesson completion, XP awards, streak tracking (AsyncStorage) |
| `src/screens/schools/SchoolsScreen.tsx` | **REWRITE** — Hub with 3 track cards, progress overview, featured content |
| `src/screens/schools/SchoolsTrackScreen.tsx` | Track detail: module cards with progress bars, track description |
| `src/screens/schools/SchoolsModuleScreen.tsx` | Module detail: lesson list, module intro, completion status |
| `src/screens/schools/SchoolsLessonScreen.tsx` | Lesson viewer: content sections, embedded quizzes, reflection prompts |
| `src/navigation/MainNavigator.tsx` | **MODIFY** — Add 3 new routes (SchoolsTrack, SchoolsModule, SchoolsLesson) |

---

### Task 1: Curriculum Data (`schoolsData.ts`)

**Files:**
- Create: `src/lib/schoolsData.ts`

- [ ] **Step 1: Create the curriculum data types and track definitions**

Create `src/lib/schoolsData.ts` with all types and the 3 tracks (AI Technology, Math, Critical Thinking), each containing 8 modules with 3-5 lessons per module. Each lesson has content sections (learn, explore, challenge, reflect), quiz questions, and XP values.

```typescript
// src/lib/schoolsData.ts

// ─── Types ─────────────────────────────────────────────────────────────────

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type AgeRange = '10-12' | '12-14' | '13-16' | '14-18' | '15-18' | '16-18' | 'all';
export type SectionType = 'learn' | 'explore' | 'challenge' | 'reflect' | 'connect';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonSection {
  type: SectionType;
  title: string;
  content: string;       // markdown-like text
  bulletPoints?: string[];
}

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  xpReward: number;
  durationMinutes: number;
  sections: LessonSection[];
  quiz: QuizQuestion[];
}

export interface Module {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;          // monospace text icon
  color: string;
  difficulty: Difficulty;
  ageRange: AgeRange;
  lessons: Lesson[];
  badgeId: string;
  badgeName: string;
}

export interface Track {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  modules: Module[];
}

// ─── Curriculum ────────────────────────────────────────────────────────────

export const TRACKS: Track[] = [ ... ]; // Full data below
```

- [ ] **Step 2: Populate Track 1 — AI Technology & How to Leverage It**

8 modules with 3-4 lessons each:
1. What Is AI? (beginner)
2. How Machines Learn (beginner-intermediate)
3. Prompt Engineering (intermediate)
4. AI Image/Audio/Video (intermediate)
5. AI + Coding Fundamentals (intermediate-advanced)
6. AI Ethics & Society (all levels)
7. The AI-Native Workflow (advanced)
8. Emerging AI & Future (advanced)

Each lesson has: learn section, explore section, challenge section, reflect section, and 3-4 quiz questions.

- [ ] **Step 3: Populate Track 2 — Math for the AI Era**

8 modules:
1. Data Literacy & Statistics (beginner)
2. Probability & Prediction (beginner-intermediate)
3. Algebra Through Algorithms (intermediate)
4. Geometry & Computer Graphics (intermediate)
5. Linear Algebra Essentials (advanced)
6. Calculus & Optimization (advanced)
7. Discrete Math & Logic (intermediate-advanced)
8. Financial Math & Economics (all levels)

- [ ] **Step 4: Populate Track 3 — Critical & Empathetic Thinking**

8 modules:
1. Foundations of Critical Thinking (beginner)
2. Media Literacy & Info Evaluation (beginner-intermediate)
3. AI Bias & Algorithmic Fairness (intermediate)
4. Empathy & Perspective-Taking (all levels)
5. Argument Construction (intermediate)
6. Systems Thinking & Complexity (intermediate-advanced)
7. Ethical Reasoning & Moral Philosophy (advanced)
8. Creative Problem-Solving (all levels)

- [ ] **Step 5: Add helper functions**

```typescript
export function getTrack(trackId: string): Track | undefined {
  return TRACKS.find(t => t.id === trackId);
}

export function getModule(trackId: string, moduleId: string): Module | undefined {
  return getTrack(trackId)?.modules.find(m => m.id === moduleId);
}

export function getLesson(trackId: string, moduleId: string, lessonId: string): Lesson | undefined {
  return getModule(trackId, moduleId)?.lessons.find(l => l.id === lessonId);
}

export function getTotalLessons(track: Track): number {
  return track.modules.reduce((sum, m) => sum + m.lessons.length, 0);
}

export function getTotalXP(track: Track): number {
  return track.modules.reduce((sum, m) =>
    sum + m.lessons.reduce((ls, l) => ls + l.xpReward, 0), 0);
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep schoolsData || echo "No errors"`

---

### Task 2: Progress Tracking (`schoolsProgress.ts`)

**Files:**
- Create: `src/lib/schoolsProgress.ts`

- [ ] **Step 1: Create the progress tracking service**

```typescript
// src/lib/schoolsProgress.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = '@schools_progress';

export interface LessonProgress {
  completed: boolean;
  quizScore: number;        // 0-100
  quizAnswers: number[];    // indices of chosen answers
  completedAt?: string;     // ISO date
  xpAwarded: boolean;
}

export interface SchoolsProgress {
  lessons: Record<string, LessonProgress>;  // key: "trackId:moduleId:lessonId"
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

  // Update streak
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

export function isLessonCompleted(progress: SchoolsProgress, trackId: string, moduleId: string, lessonId: string): boolean {
  return progress.lessons[`${trackId}:${moduleId}:${lessonId}`]?.completed ?? false;
}

export function getModuleProgress(progress: SchoolsProgress, trackId: string, moduleId: string, lessonCount: number): number {
  let completed = 0;
  for (const key of Object.keys(progress.lessons)) {
    if (key.startsWith(`${trackId}:${moduleId}:`) && progress.lessons[key].completed) {
      completed++;
    }
  }
  return lessonCount > 0 ? completed / lessonCount : 0;
}

export function getTrackProgress(progress: SchoolsProgress, trackId: string, totalLessons: number): number {
  let completed = 0;
  for (const key of Object.keys(progress.lessons)) {
    if (key.startsWith(`${trackId}:`) && progress.lessons[key].completed) {
      completed++;
    }
  }
  return totalLessons > 0 ? completed / totalLessons : 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep schoolsProgress || echo "No errors"`

---

### Task 3: Schools Hub Screen (rewrite `SchoolsScreen.tsx`)

**Files:**
- Modify: `src/screens/schools/SchoolsScreen.tsx` (full rewrite)

- [ ] **Step 1: Rewrite SchoolsScreen as the education hub**

The hub shows:
- Header with back button and "Schools" title
- Progress overview card (lessons completed, XP earned, streak)
- 3 large track cards (AI Tech, Math, Critical Thinking) each showing: icon, title, subtitle, module count, lesson count, progress bar
- Tapping a track navigates to SchoolsTrack

Design tokens match the app's dark theme. Use the same animation patterns (fadeAnim + slideAnim) as OrgListScreen/CirclesScreen.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep SchoolsScreen || echo "No errors"`

---

### Task 4: Track Detail Screen (`SchoolsTrackScreen.tsx`)

**Files:**
- Create: `src/screens/schools/SchoolsTrackScreen.tsx`

- [ ] **Step 1: Create SchoolsTrackScreen**

Shows:
- Header with back button, track icon, track title
- Track description
- 8 module cards in a vertical list, each showing:
  - Module icon + color accent stripe
  - Title, subtitle, difficulty badge, age range
  - Lesson count and progress bar
  - Locked state for modules that require prior completion (modules 5-8 locked until 2+ earlier modules done)
- Tapping a module navigates to SchoolsModule

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep SchoolsTrackScreen || echo "No errors"`

---

### Task 5: Module Detail Screen (`SchoolsModuleScreen.tsx`)

**Files:**
- Create: `src/screens/schools/SchoolsModuleScreen.tsx`

- [ ] **Step 1: Create SchoolsModuleScreen**

Shows:
- Header with back button, module color accent, module title
- Module description and difficulty/age info
- Badge preview (what you earn by completing all lessons)
- Lesson list — each lesson card shows:
  - Lesson number, title, subtitle
  - Duration, XP reward
  - Completion checkmark if done
  - Quiz score if completed
- Tapping a lesson navigates to SchoolsLesson

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep SchoolsModuleScreen || echo "No errors"`

---

### Task 6: Lesson Viewer Screen (`SchoolsLessonScreen.tsx`)

**Files:**
- Create: `src/screens/schools/SchoolsLessonScreen.tsx`

- [ ] **Step 1: Create SchoolsLessonScreen**

The main learning screen. Shows:
- Header: lesson title, XP reward badge, duration
- Content sections rendered in order — each section has a type-specific style:
  - **learn**: Blue accent, main instructional content with bullet points
  - **explore**: Green accent, hands-on activity descriptions
  - **challenge**: Amber accent, challenge/exercise prompts
  - **reflect**: Purple accent, reflection questions and journaling prompts
  - **connect**: Cyan accent, "Connect to AI" bridging content
- After content: embedded quiz with multiple choice questions
  - Each question shows 4 options
  - On select: immediate feedback (correct/incorrect + explanation)
  - Quiz score shown at end
- "Complete Lesson" button at bottom — awards XP, marks complete, navigates back
- Progress bar at top showing scroll position through the lesson

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep SchoolsLessonScreen || echo "No errors"`

---

### Task 7: Navigation Routes

**Files:**
- Modify: `src/navigation/MainNavigator.tsx`

- [ ] **Step 1: Add new screen imports and routes**

Add imports for SchoolsTrackScreen, SchoolsModuleScreen, SchoolsLessonScreen.
Add 3 new Stack.Screen entries under the Schools comment.

```typescript
import SchoolsTrackScreen from '../screens/schools/SchoolsTrackScreen';
import SchoolsModuleScreen from '../screens/schools/SchoolsModuleScreen';
import SchoolsLessonScreen from '../screens/schools/SchoolsLessonScreen';

// Inside Stack.Navigator, after Schools screen:
<Stack.Screen name="SchoolsTrack" component={SchoolsTrackScreen} />
<Stack.Screen name="SchoolsModule" component={SchoolsModuleScreen} />
<Stack.Screen name="SchoolsLesson" component={SchoolsLessonScreen} />
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck 2>&1 | grep MainNavigator || echo "No errors"`

---

### Task 8: Final Integration & TypeScript Check

**Files:**
- All files from Tasks 1-7

- [ ] **Step 1: Run full TypeScript check**

Run: `cd /Users/cswanson/the-underground-circle && npx tsc --noEmit --skipLibCheck`
Expected: No new errors from schools files.

- [ ] **Step 2: Verify the app builds for web**

Run: `cd /Users/cswanson/the-underground-circle && npx expo export --platform web 2>&1 | tail -5`
Expected: Successful build.
