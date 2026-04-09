# Quick Win Example: Agent of the Day 🌟

Let's implement the first Quick Win feature: **Agent of the Day** on the Whiteboard!

This will take ~15 minutes and show immediate value.

---

## 📋 What It Does

Displays the top-performing agent on the main office whiteboard:
- Calculates daily performance score
- Shows agent name, score, and status
- Updates automatically as agents work
- Provides visual recognition for high performers

---

## 🛠️ Implementation

### Step 1: Update `officeAgents.ts` (Helper Function)

Add this function to calculate a simple daily score:

```typescript
// Add to src/lib/officeAgents.ts

/**
 * Calculate simple daily performance score for Agent of the Day
 */
export function calculateDailyScore(agent: OfficeAgent): number {
  let score = 0;
  
  // Points for being active
  if (agent.status === 'active') score += 40;
  else if (agent.status === 'idle') score += 20;
  
  // Points for messages processed (cap at 30 points)
  score += Math.min(30, agent.messagesProcessed * 2);
  
  // Points for cost efficiency (lower cost = higher score)
  // $0.50/day = 30 points, $5/day = 0 points
  const costScore = Math.max(0, 30 - (agent.costToday * 6));
  score += costScore;
  
  return Math.min(100, Math.round(score));
}
```

### Step 2: Update `Whiteboard.tsx`

Replace the existing whiteboard content with enhanced version:

```typescript
// In src/screens/circles/tabs/office/Whiteboard.tsx

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { OfficeAgent, calculateDailyScore } from '../../../../lib/officeAgents';
import { CronJob } from '../../../../lib/openswanService';

interface Props {
  agents: OfficeAgent[];
  statusHistory: Array<OfficeAgent[]>;
  cronJobs: CronJob[];
  editable?: boolean;
  notes: string[];
  onNotesChange?: (notes: string[]) => void;
}

export default function Whiteboard({ agents, statusHistory, cronJobs, editable, notes, onNotesChange }: Props) {
  // Find Agent of the Day
  const agentOfTheDay = useMemo(() => {
    if (agents.length === 0) return null;
    
    // Calculate scores for all agents
    const scores = agents.map(agent => ({
      agent,
      score: calculateDailyScore(agent),
    }));
    
    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    
    // Return top agent
    return scores[0];
  }, [agents]);

  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const errorCount = agents.filter(a => a.status === 'error').length;
  
  const totalCost = agents.reduce((sum, a) => sum + a.costToday, 0);
  const totalMessages = agents.reduce((sum, a) => sum + a.messagesProcessed, 0);

  return (
    <View style={styles.whiteboard}>
      <View style={styles.frame}>
        <ScrollView 
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Agent of the Day */}
          {agentOfTheDay && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🌟 AGENT OF THE DAY</Text>
              <View style={[styles.agentCard, { borderColor: agentOfTheDay.agent.color + '60' }]}>
                <View style={[styles.agentAvatar, { backgroundColor: agentOfTheDay.agent.color + '20' }]}>
                  <Text style={[styles.agentAvatarText, { color: agentOfTheDay.agent.color }]}>
                    {agentOfTheDay.agent.name.charAt(0)}
                  </Text>
                </View>
                <View style={styles.agentInfo}>
                  <Text style={styles.agentName}>{agentOfTheDay.agent.name}</Text>
                  <Text style={styles.agentRole}>{agentOfTheDay.agent.role}</Text>
                  <Text style={styles.agentStats}>
                    {agentOfTheDay.agent.messagesProcessed} msgs · ${agentOfTheDay.agent.costToday.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.agentScore}>
                  <Text style={[styles.scoreValue, { color: agentOfTheDay.agent.color }]}>
                    {agentOfTheDay.score}
                  </Text>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                </View>
              </View>
            </View>
          )}

          {/* Team Status */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TEAM STATUS</Text>
            <Text style={styles.statusLine}>🟢 Active: {activeCount}</Text>
            <Text style={styles.statusLine}>🟡 Idle: {idleCount}</Text>
            {errorCount > 0 && (
              <Text style={[styles.statusLine, { color: '#ef4444' }]}>🔴 Errors: {errorCount}</Text>
            )}
          </View>

          {/* Daily Metrics */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TODAY'S METRICS</Text>
            <Text style={styles.metricLine}>💰 Cost: ${totalCost.toFixed(2)}</Text>
            <Text style={styles.metricLine}>📨 Messages: {totalMessages}</Text>
            <Text style={styles.metricLine}>👥 Agents: {agents.length}</Text>
          </View>

          {/* Cron Jobs */}
          {cronJobs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⏰ SCHEDULED JOBS</Text>
              {cronJobs.slice(0, 3).map((job) => (
                <Text key={job.id} style={styles.cronLine} numberOfLines={1}>
                  • {job.name || job.id.slice(0, 20)}
                </Text>
              ))}
              {cronJobs.length > 3 && (
                <Text style={styles.cronMore}>+{cronJobs.length - 3} more</Text>
              )}
            </View>
          )}

          {/* Custom Notes */}
          {notes.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📝 NOTES</Text>
              {notes.map((note, i) => (
                <Text key={i} style={styles.noteLine}>• {note}</Text>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  whiteboard: {
    position: 'absolute',
    top: 60,
    right: 40,
    width: 240,
    height: 320,
    zIndex: 10,
  },
  frame: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f5f5f0',
    borderRadius: 8,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  content: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 12,
  },
  scrollContent: {
    gap: 12,
  },

  // Agent of the Day Card
  section: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#333',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    backgroundColor: '#f9f9f9',
    borderRadius: 6,
    borderWidth: 2,
  },
  agentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#333',
    fontFamily: 'monospace',
  },
  agentRole: {
    fontSize: 8,
    color: '#666',
    fontFamily: 'monospace',
  },
  agentStats: {
    fontSize: 7,
    color: '#999',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  agentScore: {
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  scoreLabel: {
    fontSize: 6,
    color: '#666',
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },

  // Status & Metrics
  statusLine: {
    fontSize: 9,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  metricLine: {
    fontSize: 9,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  cronLine: {
    fontSize: 8,
    color: '#666',
    fontFamily: 'monospace',
    lineHeight: 12,
  },
  cronMore: {
    fontSize: 7,
    color: '#999',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  noteLine: {
    fontSize: 8,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 13,
  },
});
```

---

## ✅ Testing

1. **Run the app:**
   ```bash
   npm start
   # or
   yarn start
   ```

2. **Navigate to Office tab**

3. **Check the whiteboard** (top-right of office view)

4. **Verify Agent of the Day displays:**
   - Agent avatar with their color
   - Agent name and role
   - Daily stats (messages, cost)
   - Performance score (0-100)

5. **Test edge cases:**
   - No agents connected (should skip Agent of the Day section)
   - All agents idle (should still pick best one)
   - Multiple agents with same score (should pick first)

---

## 🎨 What You'll See

Before:
```
╔════════════════════╗
║  WHITEBOARD        ║
║                    ║
║  TEAM STATUS       ║
║  🟢 Active: 3      ║
║  🟡 Idle: 1        ║
╚════════════════════╝
```

After:
```
╔════════════════════╗
║  WHITEBOARD        ║
║                    ║
║  🌟 AGENT OF DAY   ║
║  ┌──────────────┐  ║
║  │ [S] SwanBot  │  ║
║  │ Dev Agent    │  ║
║  │ 47 msgs·$1.23│  ║
║  │ Score: 94 🏆 │  ║
║  └──────────────┘  ║
║                    ║
║  TEAM STATUS       ║
║  🟢 Active: 3      ║
╚════════════════════╝
```

---

## 🚀 Enhancements (Optional)

### 1. Add Animation
Make the Agent of the Day card pulse:

```typescript
import { Animated } from 'react-native';

const pulseAnim = new Animated.Value(1);

useEffect(() => {
  Animated.loop(
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
    ])
  ).start();
}, []);

// In JSX:
<Animated.View style={[styles.agentCard, { transform: [{ scale: pulseAnim }] }]}>
```

### 2. Add Trophy Icon
Show different trophies based on score:

```typescript
const getTrophyIcon = (score: number) => {
  if (score >= 90) return '🏆'; // Gold
  if (score >= 80) return '🥇'; // Silver
  if (score >= 70) return '🥈'; // Bronze
  return '🎖️'; // Participation
};

// In JSX:
<Text style={styles.trophy}>{getTrophyIcon(agentOfTheDay.score)}</Text>
```

### 3. Show Yesterday's Winner
Compare today's winner to yesterday's:

```typescript
const [yesterdayWinner, setYesterdayWinner] = useState<string | null>(null);

useEffect(() => {
  // Load yesterday's winner from storage
  storage.getItem('@office_yesterday_winner').then(setYesterdayWinner);
  
  // Save today's winner for tomorrow
  if (agentOfTheDay) {
    storage.setItem('@office_yesterday_winner', agentOfTheDay.agent.id);
  }
}, [agentOfTheDay]);

// In JSX:
{yesterdayWinner === agentOfTheDay?.agent.id && (
  <Text style={styles.streak}>🔥 2-day streak!</Text>
)}
```

### 4. Add Leaderboard History
Track top 3 agents of the week:

```typescript
const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<Array<{
  agentId: string;
  name: string;
  daysWon: number;
}>>([]);

// Update leaderboard daily
// Show in separate section: "Week's Top Performers"
```

---

## 📊 Score Calculation Explained

```typescript
calculateDailyScore(agent) = 
  StatusPoints (0-40) +
  MessagePoints (0-30) +
  CostEfficiencyPoints (0-30)
```

**Status Points:**
- Active: 40 points
- Idle: 20 points
- Error/Offline: 0 points

**Message Points:**
- 1 message = 2 points
- Capped at 30 points (15 messages)

**Cost Efficiency Points:**
- $0.00/day = 30 points
- $0.50/day = 27 points
- $1.00/day = 24 points
- $5.00/day = 0 points
- Formula: `30 - (cost * 6)`

**Example:**
- Agent is **active** → 40 points
- Processed **20 messages** → 30 points (capped)
- Cost **$1.20/day** → 22.8 points
- **Total: 93 points** → 🏆 Gold Trophy

---

## 🎯 Next Quick Wins

After implementing this, try:
1. **Cost Alert Toasts** (15 min) - Pop-up when daily budget exceeded
2. **Idle Detection** (10 min) - Auto-mark agents idle after 10min
3. **Export Data Button** (20 min) - Download metrics as JSON
4. **Quick Stats Bar** (15 min) - Add agent count/cost to title bar

---

## 💡 Tips

1. **Keep score formula simple** - Complex formulas are hard to understand
2. **Visual feedback matters** - Use color, trophies, animations
3. **Update frequency** - Recalculate every 30s to show real-time changes
4. **Celebrate success** - Make winning Agent of the Day feel special
5. **Track trends** - Log daily winners for weekly/monthly analysis

---

## 🐛 Troubleshooting

**Problem:** Agent of the Day not showing  
**Solution:** Check that `agents` array has data. Add console.log to debug.

**Problem:** Score always 0  
**Solution:** Verify `agent.status`, `agent.messagesProcessed`, and `agent.costToday` have values.

**Problem:** Same agent always wins  
**Solution:** This is expected if one agent is most active. Consider adding variety bonuses.

**Problem:** Whiteboard too crowded  
**Solution:** Make Agent of the Day collapsible or use tabs.

---

## ✨ Success!

You now have:
- ✅ Visual recognition for top performers
- ✅ Gamification element in your office
- ✅ Real-time performance tracking
- ✅ Foundation for more advanced features

**Time taken:** ~15 minutes  
**Lines of code:** ~100  
**Impact:** High visibility, team morale boost

---

*Next Quick Win: Cost Alert Toasts →*
