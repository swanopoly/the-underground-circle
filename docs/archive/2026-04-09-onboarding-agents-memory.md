# Onboarding + Agent Panel + Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix onboarding flow (approach C), revert BlackSwan to first pixel agent, add "Set as Main" pixel agent selector, fix C3PO naming, wire model switching through to BlackSwan, add per-agent memory/skills editing in Agent Panel, and debug memory not populating.

**Architecture:** Simplify OnboardingFlow to 2-step welcome + create/join CTA introducing BlackSwan. Route create/join into CircleDetail. Add main-agent designation via agentIdentity isPrimary field with UI in AgentPanel. Add per-agent memory tab with shared vs private toggle. Fix memory save path by adding console logging and ensuring userId flows correctly.

**Tech Stack:** React Native, TypeScript, Supabase, AsyncStorage, existing agent identity system

---

### Task 1: Simplify OnboardingFlow to 2-Step Welcome

**Files:**
- Modify: `src/components/OnboardingFlow.tsx` (full rewrite — currently 4 steps, reduce to 2)

- [ ] **Step 1: Rewrite OnboardingFlow to 2 steps**

Replace the entire component body. Step 0 = Welcome introducing BlackSwan. Step 1 = Create or Join CTA.

```tsx
// In OnboardingFlow.tsx — replace the component and step logic

export default function OnboardingFlow({ userId, circleId, onComplete }: Props) {
  const [step, setStep] = useState(0);

  const handleFinish = useCallback(() => {
    markOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const totalSteps = 2;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Step indicator */}
          <View style={styles.stepRow}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}
              />
            ))}
          </View>

          {/* Step 1: Welcome — introduce BlackSwan */}
          {step === 0 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Meet BlackSwan{'\n'}Your AI Agent</Text>
              <Text style={styles.sub}>
                BlackSwan is built into the app — no downloads, no setup.{'\n\n'}
                It watches your GitHub, tracks who's shipping, and keeps your team honest. Connect your own coding agents (Claude Code, Codex, Gemini CLI) later from the Office tab.
              </Text>
              <Pressable onPress={() => setStep(1)} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>Let's go</Text>
              </Pressable>
            </View>
          )}

          {/* Step 2: Create or Join a Circle */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Create or Join a Circle</Text>
              <Text style={styles.sub}>
                A circle is your team workspace. BlackSwan lives there and watches your code.{'\n\n'}
                You can create your own or join an existing one with an invite code.
              </Text>
              <Pressable onPress={handleFinish} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>Open the app</Text>
              </Pressable>
            </View>
          )}

        </View>
      </View>
    </Modal>
  );
}
```

Remove the unused imports: `connectViaOAuth`, `createLinkInvite`, `generateInviteUrl`, `ensureConnectToken`, `Clipboard`, `ActivityIndicator`. Remove `handleGitHubConnect`, `handleGenerateInvite`, `handleCopyInvite` callbacks and all state for `loading`, `inviteUrl`, `copied`, `error`, `connectToken`, `cmdCopied`.

- [ ] **Step 2: Verify onboarding still persists to Supabase**

The `markOnboardingComplete()` sets `localStorage` key `uc_onboarding_complete`. The in-circle TutorialController separately persists to Supabase via `saveRemoteTutorialSeen()`. These are independent — both still work.

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep OnboardingFlow`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add src/components/OnboardingFlow.tsx
git commit -m "feat: simplify onboarding to 2-step welcome introducing BlackSwan"
```

---

### Task 2: Route Create/Join into CircleDetail

**Files:**
- Modify: `src/screens/circles/CreateCircleScreen.tsx:293`
- Modify: `src/screens/circles/JoinCircleScreen.tsx:87`

- [ ] **Step 1: Fix CreateCircleScreen navigation**

At line 293, replace `navigation.goBack()` with navigation into the new circle:

```tsx
// Replace: navigation.goBack();
// With:
navigation.replace('CircleDetail', { circleId: circle.id, circleName: name });
```

- [ ] **Step 2: Fix JoinCircleScreen navigation**

At line 87, replace `navigation.goBack()` with navigation into the joined circle:

```tsx
// Replace: navigation.goBack();
// With:
navigation.replace('CircleDetail', { circleId: circle.id, circleName: circle.name });
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/circles/CreateCircleScreen.tsx src/screens/circles/JoinCircleScreen.tsx
git commit -m "feat: route create/join directly into CircleDetail for seamless onboarding"
```

---

### Task 3: Revert BlackSwan to First Pixel Agent

**Files:**
- Modify: `src/screens/circles/tabs/OfficeTab.tsx` (two locations from earlier C3PO-first change)

- [ ] **Step 1: Revert displayAgents sort**

Find the comment `// C3PO (Claude Code) first, then BlackSwan` and change back to:

```tsx
  // BlackSwan first, then Claude Code, then active sessions
  // ...
  return [DEFAULT_AGENT, ...claudeCodeAgents, ...sorted];
```

- [ ] **Step 2: Revert floor-filtered sort**

Find the comment `// Ensure C3PO (Claude Code) first, then BlackSwan` and change back to:

```tsx
    // Ensure BlackSwan first, then Claude Code, then sort remaining
    // ...
    return [...(blackSwan ? [blackSwan] : []), ...claudeCode, ...rest];
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/circles/tabs/OfficeTab.tsx
git commit -m "fix: revert BlackSwan to first pixel agent position"
```

---

### Task 4: Add "Set as Main" Button + Agent Rename in Agent Panel

**Files:**
- Modify: `src/screens/circles/tabs/office/AgentPanel.tsx`
- Modify: `src/lib/agentIdentity.ts` (add `setMainAgentForProvider`)

- [ ] **Step 1: Add helper to agentIdentity.ts**

```typescript
/**
 * Set one agent as the main pixel agent for its provider type.
 * Clears isPrimary from all other agents of the same provider.
 */
export async function setMainAgentForProvider(
  sessionKey: string,
  providerType: string,
): Promise<void> {
  const identities = await loadAgentIdentities();
  
  // Clear isPrimary from all agents of same provider
  for (const [key, identity] of identities) {
    if (identity.boundAiProvider === providerType && identity.isPrimary) {
      identities.set(key, { ...identity, isPrimary: false });
    }
  }
  
  // Set this agent as primary
  const existing = identities.get(sessionKey);
  if (existing) {
    identities.set(sessionKey, { ...existing, isPrimary: true, boundAiProvider: providerType });
  } else {
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: 0, totalTokensAllTime: 0, totalSessionsAllTime: 0,
      firstSeen: Date.now(), lastSeen: Date.now(), totalMessages: 0, totalTurns: 0,
      isPrimary: true, boundAiProvider: providerType,
    });
  }
  
  await saveAgentIdentities(identities);
}
```

- [ ] **Step 2: Add rename + set-as-main UI to AgentPanel.tsx**

In the overview tab section (after the MEMORY SYNC STATUS indicator), add:

```tsx
{/* ── AGENT IDENTITY — rename + set as main ── */}
{['claude-code', 'cursor', 'codex', 'gemini'].includes(agent.providerType) && (
  <View style={{ gap: 6 }}>
    {/* Rename agent */}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ color: '#606075', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>AGENT NAME</Text>
      {renamingAgent ? (
        <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
          <TextInput
            value={agentNameDraft}
            onChangeText={setAgentNameDraft}
            placeholder={agent.name}
            placeholderTextColor="#3a3a4e"
            autoFocus
            style={{ flex: 1, color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 6, paddingVertical: 3, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            onSubmitEditing={async () => {
              if (agentNameDraft.trim()) {
                const { renameAgent } = await import('../../../../lib/agentIdentity');
                await renameAgent(agent.sessionKey || agent.id, agentNameDraft.trim());
                if (onRenameAgent) onRenameAgent(agent.id, agentNameDraft.trim());
              }
              setRenamingAgent(false);
            }}
          />
          <Pressable onPress={() => setRenamingAgent(false)} style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
            <Text style={{ color: '#606075', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => { setAgentNameDraft(agent.name); setRenamingAgent(true); }} style={[{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={{ color: '#a0a0b0', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>Rename to C3PO, etc.</Text>
        </Pressable>
      )}
    </View>

    {/* Set as main pixel agent for this provider */}
    <Pressable
      onPress={async () => {
        const { setMainAgentForProvider } = await import('../../../../lib/agentIdentity');
        await setMainAgentForProvider(agent.sessionKey || agent.id, agent.providerType);
        setIsMainAgent(true);
      }}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: isMainAgent ? agent.color + '20' : '#0a0a10',
        borderWidth: 1, borderColor: isMainAgent ? agent.color + '60' : '#1a1a28',
        borderRadius: 2, padding: 6,
      }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
    >
      <Text style={{ fontSize: 10 }}>{isMainAgent ? '★' : '☆'}</Text>
      <Text style={{ color: isMainAgent ? agent.color : '#606075', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>
        {isMainAgent ? 'MAIN PIXEL AGENT' : 'SET AS MAIN PIXEL AGENT'}
      </Text>
    </Pressable>
  </View>
)}
```

Add state variables near the top of the component:
```tsx
const [renamingAgent, setRenamingAgent] = useState(false);
const [agentNameDraft, setAgentNameDraft] = useState('');
const [isMainAgent, setIsMainAgent] = useState(false);
```

Add useEffect to load isPrimary status:
```tsx
useEffect(() => {
  if (!agent) return;
  import('../../../../lib/agentIdentity').then(({ loadAgentIdentities }) => {
    loadAgentIdentities().then(ids => {
      const identity = ids.get(agent.sessionKey || agent.id);
      setIsMainAgent(identity?.isPrimary === true);
    });
  });
}, [agent?.id]);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agentIdentity.ts src/screens/circles/tabs/office/AgentPanel.tsx
git commit -m "feat: add rename + set-as-main-pixel-agent in Agent Panel"
```

---

### Task 5: Per-Agent Memory + Skills Editor in Agent Panel

**Files:**
- Modify: `src/screens/circles/tabs/office/AgentPanel.tsx` (enhance Memory tab)

- [ ] **Step 1: Enhance AgentMemoryPanel with shared vs private toggle and per-agent filtering**

Replace the existing `AgentMemoryPanel` component with an enhanced version that:
1. Shows memories filtered by this agent's `source_surface` (e.g., `claude_code_bridge`, `cursor_bridge`)
2. Has a toggle for shared (circle) vs private (user) memories
3. Shows "skills" (instruction-type memories) as a separate section
4. Allows adding agent-specific skills (instruction memories scoped to this agent)

```tsx
function AgentMemoryPanel({ circleId, userId, agentName, accentColor, providerType }: {
  circleId: string; userId?: string; agentName: string; accentColor: string; providerType?: string;
}) {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'shared' | 'private' | 'skills'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../../../lib/agentMemory');
      const data = await getUserMemories(circleId, userId);
      const all = [...data.circle, ...data.user, ...data.session];
      setMemories(all);
    } catch {}
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  // Filter memories by view mode and optionally by agent provider
  const filtered = memories.filter(mem => {
    if (viewMode === 'shared') return mem.scope === 'circle';
    if (viewMode === 'private') return mem.scope === 'user' || mem.scope === 'session';
    if (viewMode === 'skills') return mem.memory_kind === 'instruction';
    return true; // 'all'
  });

  // ... rest of component uses `filtered` instead of `memories`
  // Add viewMode toggle buttons at top
  // Add "Add Skill" input that creates instruction-type memories
  // Add providerType prop to the component call in the memory tab section
```

The key addition is the `viewMode` toggle and the "Add Skill" input that creates `instruction`-type memories scoped to the agent.

- [ ] **Step 2: Add "Add Skill" handler**

```tsx
const handleAddSkill = async () => {
  if (!newSkill.trim()) return;
  try {
    const { rememberFromChat } = await import('../../../../lib/memoryService');
    await rememberFromChat(circleId, userId || '', newSkill.trim(), 'instruction');
    setNewSkill('');
    load();
  } catch {}
};
```

- [ ] **Step 3: Pass providerType to AgentMemoryPanel in memory tab**

In the memory tab section:
```tsx
{panelTab === 'memory' && circleId && (
  <View nativeID="section-agent-memory" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
    <AgentMemoryPanel
      circleId={circleId}
      userId={userId || undefined}
      agentName={agent.name}
      accentColor={agent.color || '#6366f1'}
      providerType={agent.providerType}
    />
  </View>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/circles/tabs/office/AgentPanel.tsx
git commit -m "feat: per-agent memory with shared/private/skills views in Agent Panel"
```

---

### Task 6: Debug Memory Not Populating

**Files:**
- Modify: `src/lib/agentSessionMemory.ts` (add console logging)
- Modify: `src/lib/agentAutoConnect.ts` (verify userId flow)

- [ ] **Step 1: Add logging to saveAgentSessionsToMemory**

At the top of `saveAgentSessionsToMemory()` in `agentSessionMemory.ts`, add:

```typescript
console.log(`[agentSessionMemory] Saving ${sessions.length} sessions for ${provider} in circle ${circleId} (user: ${userId})`);
```

After each save/skip, log:
```typescript
console.log(`[agentSessionMemory] ${provider} project ${projectKey}: saved=${saved}, skipped=${skipped}`);
```

- [ ] **Step 2: Add logging to _getUserId in agentAutoConnect.ts**

```typescript
async function _getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id || null;
    if (!uid) console.warn('[agentAutoConnect] _getUserId: no user authenticated');
    return uid;
  } catch (err) {
    console.warn('[agentAutoConnect] _getUserId failed:', err);
    return null;
  }
}
```

- [ ] **Step 3: Verify memory_entries table exists and has correct RLS**

The `saveMemory()` function in `agentRunSystem.ts` inserts to `memory_entries`. If this table doesn't exist or RLS blocks the insert, it silently returns null. Check the browser console for `[agentSessionMemory]` logs when the app is running.

Key things to verify:
- The 3 migrations referenced in `.remember/remember.md` have been run: `20260408_unified_agent_runs.sql`, `20260408_memory_privacy_fix.sql`, `20260408_memory_v2_retrieval_privacy.sql`
- RLS policy allows authenticated users to insert their own memories
- The `session_id` column exists (added in the v2 migration)

- [ ] **Step 4: Commit**

```bash
git add src/lib/agentSessionMemory.ts src/lib/agentAutoConnect.ts
git commit -m "fix: add debug logging to memory save pipeline"
```

---

### Task 7: Wire Model Switching Through to BlackSwan

**Files:**
- No code changes needed (already works!)

- [ ] **Step 1: Verify model flow**

The model selector in ChatTab sets `selectedModel` state (line 374). When a message is sent, the context is built at line 1328-1333 with `model: selectedModel !== 'auto' ? selectedModel : undefined`. This flows to `getSwanBotStructuredResponse()` → `callSwanBotAIStructured()` → edge function body `model: model || 'claude-haiku'`. The edge function uses `CLAUDE_MODEL_MAP` to route the model.

This already works. No changes needed.

- [ ] **Step 2: Document in commit that model switching was verified**

Already functional — the ChatTab model selector dropdown works for BlackSwan. When user selects a model, it overrides the default `claude-haiku`.

---

### Task 8: Final Compile Check + Integration Test

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "OnboardingFlow|CreateCircle|JoinCircle|AgentPanel|agentIdentity|agentSessionMemory|agentAutoConnect|OfficeTab|memoryService|swanbot" | head -20`
Expected: no new errors in our files

- [ ] **Step 2: Verify the app starts**

Run: `npm run web` and check:
1. New user sees 2-step onboarding (Welcome BlackSwan → Create/Join)
2. After creating circle, lands directly in CircleDetail
3. BlackSwan is first pixel agent in Office
4. Agent Panel shows rename + "Set as Main" for coding agents
5. Memory tab has shared/private/skills views
6. Console shows `[agentSessionMemory]` logs when bridge is connected

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: onboarding revamp, agent panel memory/skills, main pixel agent selector"
```
