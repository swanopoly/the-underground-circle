# Testing Guide - Farm Health Dashboard 🧪

## Quick Start Testing

### 1. Start the Dev Server
```bash
cd "C:\Users\chris\OneDrive\Desktop\Swan\Projects\the-underground-circle"
npm start
```

### 2. Open the App
- Press `w` for web
- Or scan QR code for mobile
- Navigate to **Circles → Office Tab**

### 3. Test the Farm Button
1. Look for the 🏥 button in the title bar (between 🏆 and 🔧)
2. Click it to switch to Farm Health Dashboard
3. You should see 5 tabs: Overview, Performance, Workload, Optimization, Health

---

## Test Cases

### Test 1: Empty State (No Agents)
**Expected:** 
- Overview shows "No Agent Data"
- Message: "Connect agents to see farm health metrics"
- Empty icon 🏢

**How to Test:**
- Open Office tab with no connections
- Click 🏥 button
- Verify empty state displays correctly

---

### Test 2: Single Agent
**Expected:**
- Overview shows farm status
- Performance tab shows 1 agent with grade (S/A/B/C/D/F)
- Workload shows load percentage
- Health check passes/fails based on status

**How to Test:**
1. Add one OpenClaw connection
2. Wait for agent to appear
3. Click 🏥 button
4. Check each tab:
   - ✅ Overview: Health status, stats grid, cost overview
   - ✅ Performance: Agent score card with grade badge
   - ✅ Workload: Load bar with status badge
   - ✅ Optimization: Should show recommendations if applicable
   - ✅ Health: Issue list or "Perfect Health" message

---

### Test 3: Multiple Agents
**Expected:**
- Farm metrics calculated across all agents
- Leaderboard sorted by performance
- Top performer highlighted
- Workload distribution visible
- Cost optimization suggestions appear

**How to Test:**
1. Add 3+ agent connections
2. Let them run for a few minutes
3. Click 🏥 button
4. Navigate through all tabs:
   - Overview: Check total cost, active count, top performer card
   - Performance: Verify leaderboard sorts correctly (highest score first)
   - Workload: Check for Overloaded/Optimal/Underutilized badges
   - Optimization: Look for model downgrade suggestions
   - Health: Check for any warnings or critical issues

---

### Test 4: Error State Agent
**Expected:**
- Health status shows "ISSUES DETECTED"
- Error count in stats grid
- Critical severity in health tab
- Bottleneck detection in overview

**How to Test:**
1. Simulate an agent error (disconnect one connection)
2. Click 🏥 button
3. Verify:
   - ✅ Red/critical health banner in Overview
   - ✅ Error count > 0 in stats grid
   - ✅ Bottleneck card shows the problematic agent
   - ✅ Health tab lists critical issue

---

### Test 5: High Cost Agent
**Expected:**
- Warning in health tab
- Cost optimization suggestions
- High cost highlighted in overview

**How to Test:**
1. Let an agent using Opus model run for a while
2. Check if cost > $10/day
3. Click 🏥 button
4. Verify:
   - ✅ Warning in health tab: "Agent X has high daily cost"
   - ✅ Optimization tab suggests model downgrade
   - ✅ Cost highlighted in red in overview

---

### Test 6: Tab Navigation
**Expected:**
- All 5 tabs render without errors
- Active tab highlighted with accent color
- Smooth transitions between tabs
- Data persists when switching back

**How to Test:**
1. Click 🏥 button
2. Click each tab: Overview → Performance → Workload → Optimization → Health
3. Verify:
   - ✅ Tab icon and label update correctly
   - ✅ Content loads without flashing
   - ✅ No console errors
   - ✅ Scroll position resets when switching tabs

---

### Test 7: Responsive Design
**Expected:**
- Dashboard looks good on all screen sizes
- Mobile layout adjusts appropriately
- Text remains readable
- Buttons are tappable (min 44x44)

**How to Test:**
1. Test on web: Resize browser window (1920px → 768px → 375px)
2. Test on mobile: Open on iOS/Android device
3. Verify:
   - ✅ Tabs don't overflow
   - ✅ Cards stack vertically on mobile
   - ✅ Text sizes are appropriate
   - ✅ No horizontal scroll (unless intended)

---

### Test 8: Real-time Updates
**Expected:**
- Metrics update when agents change
- New agents appear automatically
- Cost updates reflect real activity
- Scores recalculate periodically

**How to Test:**
1. Open Farm dashboard
2. In another window, send a message to an agent
3. Wait 30-60 seconds
4. Verify:
   - ✅ Message count increases
   - ✅ Cost updates
   - ✅ Performance score may change
   - ✅ Workload adjusts

---

### Test 9: Performance with Many Agents
**Expected:**
- Dashboard remains responsive with 10+ agents
- Scrolling is smooth
- No lag when switching tabs
- Calculations complete quickly

**How to Test:**
1. Add 10+ agent connections (if possible)
2. Open Farm dashboard
3. Verify:
   - ✅ Initial load < 2 seconds
   - ✅ Tab switches < 500ms
   - ✅ Scroll is smooth (60fps)
   - ✅ No memory leaks (check DevTools)

---

### Test 10: Edge Cases
**Expected:**
- Handles division by zero (no messages, zero cost)
- Handles missing data gracefully
- Null/undefined checks pass
- No crashes on unexpected values

**How to Test:**
1. Brand new agent with 0 messages, 0 cost
2. Verify:
   - ✅ Score calculates correctly (likely low but not NaN)
   - ✅ No "NaN" or "undefined" displayed
   - ✅ No console errors
   - ✅ Default values used appropriately

---

## Visual Regression Checklist

### Overview Tab
- [ ] Health status banner shows correct color
- [ ] Stats grid displays 4 cards (Active/Idle/Error/Offline)
- [ ] Cost overview section readable
- [ ] Top performer card renders with avatar
- [ ] Bottleneck alert (if applicable) is visible

### Performance Tab
- [ ] Grade badges show correct colors (S=gold, A=green, B=blue, C=orange)
- [ ] Progress bars fill correctly (0-100%)
- [ ] Leaderboard sorted descending by score
- [ ] Trend indicators (📈📉➡️) display
- [ ] Agent avatars render

### Workload Tab
- [ ] Load bars fill proportionally (0-100%)
- [ ] Status badges color-coded (🔥=red, ✓=green, 💤=blue)
- [ ] Percentage values match bar fill
- [ ] Cards sorted by load (highest first)

### Optimization Tab
- [ ] Recommendations display with priority badges
- [ ] Savings calculations show in green
- [ ] Empty state shows when no optimizations
- [ ] Priority colors: High=red, Medium=orange, Low=blue

### Health Tab
- [ ] Health status card shows correct color/icon
- [ ] Issue list sorted by severity (Critical → Warning → Info)
- [ ] Severity badges color-coded
- [ ] Empty state shows "Perfect Health" when no issues

---

## Known Issues to Watch For

### Potential Bugs
1. **Score Calculation:** If agent has 0 messages, score should still be valid (not NaN)
2. **Cost Efficiency:** If costToday is very high, costScore could go negative (should be clamped to 0)
3. **Empty Sessions:** If enrichedSessions is empty, some metrics may not calculate
4. **Null Agent Data:** Missing fields in OfficeAgent could cause undefined errors

### Workarounds
- Always check for null/undefined before accessing nested properties
- Use optional chaining: `agent?.property`
- Provide default values: `agent.cost ?? 0`
- Clamp scores: `Math.max(0, Math.min(100, score))`

---

## Console Checks

Open browser DevTools (F12) and monitor for:

### ✅ Good Signs
```
💾 Session snapshot saved (including tags)
✅ Enriched 5 agents with full identity restoration
✏️ Renamed agent session_123 → SwanBot
```

### ⚠️ Warning Signs
```
Failed to enrich agents: [error]
Missing sessionKey for agent [id]
Unable to calculate metrics: [error]
```

### 🚨 Critical Errors
```
TypeError: Cannot read property 'X' of undefined
Error: Maximum update depth exceeded
RangeError: Maximum call stack size exceeded
```

---

## Performance Benchmarks

### Target Metrics
- **Initial Load:** < 2 seconds
- **Tab Switch:** < 500ms
- **Score Calculation:** < 100ms per agent
- **UI Render:** 60fps (16.6ms per frame)

### How to Measure
1. Open DevTools → Performance tab
2. Start recording
3. Click 🏥 button
4. Switch between tabs
5. Stop recording
6. Check:
   - ✅ Total blocking time < 200ms
   - ✅ Main thread not blocked > 50ms
   - ✅ Frame rate stays 60fps during animations

---

## Debugging Tips

### Dashboard Not Showing?
1. Check console for import errors
2. Verify `viewMode === 'farm'` is set
3. Check that `enrichedAgents` and `enrichedSessions` have data
4. Look for TypeScript errors in terminal

### Scores Incorrect?
1. Console.log the inputs to `calculateAgentScore()`
2. Check that `agent.status`, `agent.messagesProcessed`, `agent.costToday` are defined
3. Verify calculation logic in `agentFarmMetrics.ts`
4. Test with known values (e.g., active agent, 10 messages, $1 cost = ~82 score)

### Layout Broken?
1. Check StyleSheet definitions
2. Verify flex properties
3. Test on different screen sizes
4. Check for missing imports (View, Text, ScrollView, etc.)

### Empty State Shows with Agents?
1. Verify `agents.length > 0`
2. Check that `enrichedAgents` is properly set
3. Look for filtering that removes all agents
4. Console.log the agent array

---

## Regression Testing After Changes

Before committing changes, run through:

1. [ ] All 10 test cases pass
2. [ ] No console errors or warnings
3. [ ] TypeScript compiles without errors
4. [ ] Performance benchmarks still met
5. [ ] Visual regressions checked (compare screenshots)
6. [ ] Mobile + Desktop tested
7. [ ] Edge cases handled
8. [ ] Documentation updated

---

## Success Criteria

### ✅ Dashboard Integration Successful When:
- 🏥 button appears in title bar
- Clicking it switches to Farm view
- All 5 tabs render without errors
- Metrics calculate correctly for 0, 1, and 10+ agents
- No performance degradation
- Mobile + Desktop layouts work
- Real-time updates reflect agent activity
- Empty states display appropriately

---

## Next Steps After Testing

Once basic integration is verified:
1. ✅ Implement Quick Win #1: Agent of the Day
2. ✅ Add Cost Alert Toasts
3. ✅ Implement Idle Detection
4. ✅ Add Export Data button
5. ✅ Start on Agent Knowledge Base

---

*Happy Testing! 🧪*
