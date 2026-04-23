# Browser / Computer-Use UX Improvement Plan

## Current State

The browser feature is **fully built and functional**. All core components work:
- Task input modal with planning
- AI-powered action planning (intent analysis, risk assessment, domain detection)
- Permission dialog with 3 levels (ask every/ask new sites/trusted)
- Dual backend (Playwright Bridge + Browserbase Stagehand)
- Live execution panel with per-action approval, screenshots, pause/resume/cancel
- Session replay drawer with before/after screenshots
- RunExecutionCard integration showing plans, events, sessions in chat
- Smart routing detects `browser` intent and auto-routes

**The feature works. The UX has friction.**

---

## UX Issues Identified

### P0 -- Friction that blocks adoption

1. **Entry is hidden behind a modal**
   - User must click ">_ Use Browser" quick action, then type in a separate modal, then click "PLAN BROWSER TASK"
   - Should: just type "go to stripe.com and check webhook docs" in the normal chat input and OpenSwan auto-detects it as a browser task

2. **No inline chat trigger**
   - If OpenSwan decides to use `browser.plan_task` tool mid-conversation, the plan renders in the RunExecutionCard but the user has to find and click "LAUNCH PLAN"
   - Should: show a clear, prominent action card inline in the chat bubble

3. **Permission dialog is full-screen overlay**
   - Covers the entire chat, feels heavy for a read-only task like "check the docs"
   - Should: inline permission card for low-risk tasks, full overlay only for high-risk

### P1 -- Friction that slows usage

4. **No task templates / suggestions**
   - Empty text input with only a placeholder. No sense of what's possible
   - Should: show 4-6 quick-pick templates (Research docs, Extract data, Fill form, Monitor page, Compare sites, Screenshot)

5. **Action plan is read-only**
   - Once planned, user can only approve or reject each action. Can't edit, reorder, or add actions
   - Should: allow editing action descriptions and adding manual steps before launch

6. **No retry on failed steps**
   - If action 3/7 fails, session stops. User must relaunch the entire plan
   - Should: offer "Retry this step" / "Skip and continue" / "Edit and retry"

7. **Screenshots are ephemeral**
   - Before/after screenshots exist in memory but aren't persisted. Lost on refresh
   - Should: persist to Supabase storage, reference in session record

### P2 -- Polish and delight

8. **No progress indicator during planning**
   - After clicking "PLAN BROWSER TASK", the button says "PLANNING..." but there's no animated feedback
   - Should: show a step-by-step planning progress (analyzing intent... detecting domains... planning actions... selecting backend...)

9. **Permission level explanation is thin**
   - "Ask only for new websites" -- what counts as "new"? What about subdomains?
   - Should: tooltip or expandable explanation for each level

10. **No history of past browser sessions**
    - Sessions only persist on the message they were launched from. No global session list
    - Should: "Browser History" section accessible from settings or a quick action

11. **Backend indicator is not actionable**
    - Shows "PLAYWRIGHT BRIDGE" or "BROWSERBASE" but user can't switch or understand why
    - Should: explain why that backend was chosen and allow override

12. **No live preview during execution**
    - Screenshots show after each action completes, but no live video/stream of the browser
    - Should: Browserbase supports live session URLs -- surface a "Watch Live" button prominently

---

## Recommended Build Order

### Phase 1: Inline chat trigger (biggest impact)
Make the normal chat input detect browser intent and show an inline action card instead of requiring the modal.

**Changes:**
- In ChatTab.tsx `sendMessage()`, when smart routing detects `intent === 'browser'`, don't send to the AI immediately. Instead, show a compact inline card: "Browser task detected. [PLAN & LAUNCH] [JUST ASK]"
- If user clicks PLAN & LAUNCH, run `describeComputerUsePlan()` and show the permission flow inline
- If user clicks JUST ASK, send the message normally (OpenSwan may still call browser.plan_task tool)
- Remove the separate "Use Browser" modal -- merge it into the chat flow

### Phase 2: Task templates
Add quick-pick templates to the browser task input.

**Changes:**
- Add template chips above the text input: Research, Extract, Fill Form, Monitor, Compare, Screenshot
- Each template pre-fills the input with a prompt pattern and sets sensible defaults
- Templates also set the recommended permission level (Research = trusted, Fill Form = ask every)

### Phase 3: Inline permission for low-risk tasks
Replace the full-screen overlay with a compact inline card for low-risk (read_only) tasks.

**Changes:**
- If `intent.risk === 'low'` and `intent.mode === 'read_only'`, show a compact card in the chat:
  "OpenSwan wants to browse [domain]. [ALLOW] [DENY] [MORE OPTIONS]"
- "MORE OPTIONS" expands to the full permission dialog
- High-risk tasks still get the full overlay

### Phase 4: Step retry and skip
Add recovery options when an action fails.

**Changes:**
- In ComputerUsePanel, when an action fails, show 3 buttons: "RETRY" / "SKIP" / "EDIT & RETRY"
- RETRY re-executes the same action
- SKIP marks it as skipped and continues to the next action
- EDIT & RETRY opens a text field to modify the action description, then re-plans and retries

### Phase 5: Planning progress animation
Show step-by-step feedback during the planning phase.

**Changes:**
- Replace "PLANNING..." with animated steps:
  1. "Analyzing intent..." (0.5s)
  2. "Detecting domains..." (0.5s)  
  3. "Planning actions..." (1-2s, AI call)
  4. "Selecting backend..." (0.3s)
  5. "Ready" (done)
- Each step shows a small check mark when complete

### Phase 6: Live session "Watch" button
Surface Browserbase's live session URL prominently.

**Changes:**
- When backend is Browserbase, show a pulsing "WATCH LIVE" button at the top of ComputerUsePanel
- Opens browserbase.com/sessions/{sessionId} in a new tab
- For Playwright Bridge (local), show a note: "Local browser -- not streamable"

---

## Files to Modify

| File | Change |
|------|--------|
| `ChatTab.tsx` | Inline browser intent detection + action card |
| `ComputerUsePermissionDialog.tsx` | Add compact inline mode for low-risk tasks |
| `ComputerUsePanel.tsx` | Step retry/skip buttons, live watch button |
| `ComputerUseButton.tsx` | Add task templates, planning progress animation |
| `RunExecutionCard.tsx` | Improve browser plan card prominence |
| `chatActions.ts` | Update browser quick action to use inline flow |

---

## Success Metrics

- Users can trigger browser tasks from normal chat without touching the modal
- Low-risk tasks (research, docs) go from message to execution in 2 clicks
- Failed steps don't kill the entire session
- Planning phase shows clear progress instead of a frozen "PLANNING..." button
