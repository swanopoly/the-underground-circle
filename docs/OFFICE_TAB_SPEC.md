# Office Tab - Pixel Office for AI Agents

> **Historical bootstrap specification.** This file describes the original MVP
> and is not the current implementation contract. For current ownership and
> truth requirements, use `docs/AGENTS_ROADMAP.md`, `CLAUDE.md`, and
> `docs/UC_APP_STACK_REFERENCE.md`. The live Office now uses the canonical
> 81-item addon registry, real roster/run sources, truthful addon states,
> searchable filters, five room kits, bounded undo/redo, and mobile/keyboard
> editing described in the 2026-08-12 roadmap entry. Do not reintroduce the mock
> agents, fixed layout, or status assumptions below.

## Overview
Add an "OFFICE" tab to the Circle detail view (CircleDetailScreen.tsx) that shows a pixel art virtual office where AI agents live and work. Inspired by office.xyz, claude-office whiteboard system, and Braintrust observability.

## Architecture

### 1. New Tab: OFFICE
- Add 'OFFICE' to the TABS array in `CircleDetailScreen.tsx` (position it after CHAT)
- Import and render `OfficeTab` component
- File: `src/screens/circles/tabs/OfficeTab.tsx`

### 2. Pixel Office Layout (OfficeTab.tsx)
A top-down 2D pixel art office scene rendered with React Native Views (no canvas/WebGL needed). Dark theme matching the app.

**Office Elements:**
- Floor: Dark grid pattern (#0a0a0a with subtle grid lines)
- Desks: Pixel art desk clusters (4-6 desks arranged in the office)
- Plants: Decorative pixel plants scattered around
- Whiteboard: Interactive element on the wall (shows metrics)
- Coffee machine: Decorative element in corner
- Server rack: Glowing LEDs in a corner

**Agent Characters:**
- Each agent is a small pixel art character (~32x32px) rendered with nested Views and background colors
- Characters sit at desks or walk between locations
- Each has: colored shirt, simple face, name label below
- Status indicator: green dot = active, yellow = idle, red = error, gray = offline
- Subtle idle animation (bobbing up/down using Animated API)

### 3. Agent Data
For MVP, use hardcoded mock agents that represent the Circle's AI workforce:

```typescript
const OFFICE_AGENTS = [
  { id: '1', name: 'SwanBot', role: 'Lead Engineer', status: 'active', color: '#6366f1', desk: 0, activity: 'Building features' },
  { id: '2', name: 'CoachAI', role: 'Accountability Coach', status: 'active', color: '#10b981', desk: 1, activity: 'Reviewing check-ins' },
  { id: '3', name: 'DataBot', role: 'Analytics', status: 'idle', color: '#f59e0b', desk: 2, activity: 'Processing daily digest' },
  { id: '4', name: 'ModBot', role: 'Moderator', status: 'active', color: '#ef4444', desk: 3, activity: 'Monitoring chat' },
  { id: '5', name: 'ResearchAI', role: 'Research Agent', status: 'offline', color: '#8b5cf6', desk: 4, activity: 'Sleeping...' },
  { id: '6', name: 'ContentBot', role: 'Content Creator', status: 'active', color: '#ec4899', desk: 5, activity: 'Writing posts' },
];
```

### 4. Bottom Panel - Agent Details + Metrics
When you tap an agent, a bottom sheet slides up showing:
- Agent name, role, status
- Current activity description
- Session stats (messages processed, uptime, last active)
- Mini activity log (last 5 actions)

### 5. Whiteboard Widget
A clickable whiteboard on the office wall that cycles through modes (inspired by claude-office):
- **Mode 0: Team Status** - All agents listed with status dots
- **Mode 1: Activity Feed** - Recent agent actions scrolling
- **Mode 2: Metrics** - Token usage, messages/hr, uptime %
- **Mode 3: Task Board** - Current tasks assigned to agents

### 6. Visual Style
- Background: Very dark (#050505 to #0a0a0a)
- Accent colors per agent
- Pixel art aesthetic - use sharp edges, no border-radius on office furniture
- Subtle glow effects on active agents (shadowColor with opacity)
- Status LEDs on the server rack that pulse
- Overall underground/hacker aesthetic matching the app

## File Structure
```
src/screens/circles/tabs/OfficeTab.tsx          # Main office view
src/screens/circles/tabs/office/PixelAgent.tsx   # Agent character component
src/screens/circles/tabs/office/OfficeFloor.tsx  # Office background/furniture
src/screens/circles/tabs/office/Whiteboard.tsx   # Interactive whiteboard
src/screens/circles/tabs/office/AgentPanel.tsx   # Bottom detail panel
src/screens/circles/tabs/office/ServerRack.tsx   # Decorative server rack
src/lib/officeAgents.ts                          # Agent data types and mock data
```

## Integration Points in CircleDetailScreen.tsx

1. Add to imports: `import OfficeTab from './tabs/OfficeTab';`
2. Update TABS: `const TABS = ['CHAT', 'OFFICE', 'FEED', 'CHALLENGES', 'MEMBERS', 'DIGEST', 'DISCORD'] as const;`
3. Add tab content view:
```tsx
<View style={[styles.tabContent, activeTab !== 'OFFICE' && styles.hiddenTab]}>
  <OfficeTab circleId={circleId} accentColor={accentColor} />
</View>
```

## Technical Notes
- Use React Native `Animated` API for agent idle animations (no external deps)
- Pure View-based pixel art (no images/sprites needed)
- ScrollView for the office floor (can pan around)
- All React Native compatible (web + mobile)
- Match existing app dark theme and typography
- No new npm dependencies needed

## DO NOT
- Do not modify any existing tab files
- Do not add npm dependencies
- Do not use HTML canvas or WebGL
- Do not break existing tab navigation
