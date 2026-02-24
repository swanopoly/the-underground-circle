# Quick Action Buttons Guide 🎮

**One-click team coordination with pixel-art style!**

---

## 🎯 What Are Action Buttons?

Instead of typing commands, just **click a button** to instantly coordinate your agents!

The action bar appears in the Office right above the terminal with 7 powerful buttons.

---

## 🎮 The Buttons

### 🌅 **STANDUP** (Purple)
**One-click daily standup meeting**

**What it does:**
- Creates a team conversation
- Sends standup template to all active agents
- Includes all agents in the conversation

**The message agents receive:**
```
🌅 Daily Standup!

Quick check-in:
1. What did you work on?
2. What are you working on today?
3. Any blockers?

Team: SwanBot, CodeAgent, Designer
```

**Perfect for:** Morning check-ins, daily sync-ups

---

### 📊 **SYNC** (Blue)
**Sync the team on project status**

**What it does:**
1. Shows modal with list of projects (color-coded)
2. Select a project
3. Broadcasts comprehensive status to project team

**The message agents receive:**
```
📊 Project Sync: website

Tasks: 3/7 complete
In Progress: 2
Blocked: 1
Active Team: SwanBot, CodeAgent
Cost: $4.25/day

Let's sync up on priorities and next steps!
```

**Perfect for:** Project updates, weekly syncs, status reports

---

### 🎯 **ASSIGN** (Green)
**AI auto-assigns pending tasks**

**What it does:**
- Finds up to 5 unassigned tasks
- AI picks best agent for each (availability + cost)
- Assigns tasks automatically
- Sends notification to each agent

**What agents receive:**
```
New task assigned: "Homepage Design"

Build the landing page with React

Priority: medium
```

**Perfect for:** Sprint planning, quick task distribution

---

### 💬 **CHAT** (Pink)
**Start a team conversation**

**What it does:**
1. Shows modal to enter conversation subject
2. Creates group conversation
3. Includes all active agents
4. Returns conversation ID for follow-up

**Result:**
```
💬 Team Chat Started: "Homepage Redesign"
ID: conv_789
Participants: SwanBot, CodeAgent, Designer

Use "convo conv_789 [message]" to chat
```

**Perfect for:** Planning sessions, brainstorming, coordination

---

### 📢 **BROADCAST** (Orange)
**Send message to everyone instantly**

**What it does:**
1. Shows modal with text input
2. Type your message
3. Sends to ALL active agents instantly
4. Shows delivery confirmation

**Result:**
```
📢 Broadcast sent to 5 agents!

"Team meeting in 10 minutes!"
```

**Perfect for:** Announcements, urgent messages, all-hands

---

### 🆘 **HELP** (Red)
**Coordinate help for blocked tasks**

**What it does:**
- Finds all blocked tasks
- Broadcasts list to team asking for help
- Shows blocked reasons
- Badge displays blocked task count

**The message agents receive:**
```
🆘 Help Coordination

We have 2 blocked tasks that need attention:

• Homepage Design
  Reason: Waiting on API endpoint

• User Authentication
  Reason: Design mockups needed

Who can help unblock these?
```

**Badge:** Shows number of blocked tasks (e.g., "3")

**Perfect for:** Removing blockers, asking for help

---

### 📈 **STATUS** (Teal)
**Instant team status check**

**What it does:**
- Instantly shows all active agents
- Lists status (active/idle)
- Shows cost per agent
- Calculates total team cost
- No modal, instant result

**Result:**
```
📊 Team Status Check

🟢 SwanBot: active | $0.50/day
🟡 CodeAgent: idle | $1.20/day
🟢 Designer: active | $0.30/day

Total: 3 agents active
Cost: $2.00/day
```

**Perfect for:** Quick health checks, cost monitoring

---

## 🎨 Visual Design

### Pixel-Art Style
- Retro 8-bit aesthetic
- Press animations (button moves down when clicked)
- Color-coded by function
- Disabled state when no agents connected

### Button States
- **Normal:** Solid color with shadow
- **Pressed:** Darker, translates down 2px
- **Disabled:** Gray, 50% opacity
- **Badge:** Red notification bubble (e.g., blocked count)

### Layout
- Horizontal scroll bar
- Appears above terminal
- Only visible when agents connected
- Hidden in edit mode

---

## 🔔 Toast Notifications

When you click a button, results appear in a **floating toast**:

**Toast Features:**
- Appears above the terminal
- Purple glowing border
- Shows action results
- Close button (×)
- Auto-dismisses after 5 seconds

**Example Toast:**
```
📊 Project synced to team!
Delivered to: SwanBot, CodeAgent, Designer
```

---

## 🎯 When to Use Each Button

| Situation | Button | Why |
|-----------|--------|-----|
| Start of day | 🌅 Standup | Daily sync |
| Project update | 📊 Sync | Share status |
| New sprint | 🎯 Assign | Distribute tasks |
| Planning session | 💬 Chat | Group discussion |
| Urgent announcement | 📢 Broadcast | Quick message |
| Tasks stuck | 🆘 Help | Remove blockers |
| Quick check | 📈 Status | Team health |

---

## 🔄 Workflows

### Morning Routine
```
1. Click 📈 STATUS - Check team health
2. Click 🌅 STANDUP - Start daily meeting
3. Click 🎯 ASSIGN - Distribute today's tasks
```

### Sprint Planning
```
1. Click 📊 SYNC - Share project status
2. Click 💬 CHAT - Start "Sprint Planning" conversation
3. Click 🎯 ASSIGN - Auto-assign sprint tasks
```

### Unblocking Work
```
1. Click 🆘 HELP - Check blocked tasks (badge shows count)
2. Agents respond with who can help
3. Click 📊 SYNC - Update team on progress
```

### Emergency Coordination
```
1. Click 📢 BROADCAST - "Production issue! All hands on deck"
2. Click 💬 CHAT - Start "Incident Response" conversation
3. Click 🎯 ASSIGN - Assign fix tasks quickly
```

---

## 💡 Pro Tips

### 1. **Badges Are Signals**
The 🆘 HELP button shows a badge with blocked task count:
- No badge = All tasks flowing!
- Badge "2" = 2 tasks need attention
- Click immediately to coordinate help

### 2. **Combine Buttons**
Use buttons in sequence for powerful workflows:
```
📊 Sync → 💬 Chat → 🎯 Assign
```

### 3. **Status Before Action**
Always check 📈 STATUS first to see who's available before:
- Starting conversations
- Broadcasting messages
- Assigning tasks

### 4. **Save Conversation IDs**
When you click 💬 CHAT, save the conversation ID:
```
💬 Team Chat Started: "Homepage Redesign"
ID: conv_789
```
Then use: `convo conv_789 [message]` in terminal

### 5. **Quick vs. Detailed**
- **Quick actions** → Use buttons
- **Detailed control** → Use terminal commands
- **Best of both** → Buttons to start, terminal to continue

---

## 🎮 Button Behavior

### Enabled State
- Solid color
- Clickable
- Press animation
- Tooltip on hover (web)

### Disabled State
- Gray color
- 50% opacity
- Not clickable
- Shows when no agents connected

### Loading State
- Button text changes to "⏳ EXECUTING..."
- Prevents double-clicks
- Shown during API calls

---

## 🚀 Getting Started

1. **Connect your agents** (⚙️ → Connections)

2. **Action bar appears** above the terminal

3. **Click any button** to try it out!

4. **Watch the toast** for results

5. **Check terminal** for conversation IDs or detailed info

---

## 🎨 Customization

The buttons are:
- **Color-coded** by function type
- **Sized** uniformly (medium)
- **Styled** with pixel-art aesthetic
- **Positioned** above terminal for easy access

**Colors:**
- Purple: Meetings/sync (🌅 Standup)
- Blue: Information (📊 Sync, 📈 Status)
- Green: Actions (🎯 Assign)
- Pink: Communication (💬 Chat)
- Orange: Broadcasting (📢 Broadcast)
- Red: Urgent (🆘 Help)

---

## 📊 Statistics

**What happens when you click:**

| Button | API Calls | Agents Notified | Creates |
|--------|-----------|-----------------|---------|
| 🌅 Standup | N (agents) | All active | Conversation |
| 📊 Sync | 1 + N | Project team | Nothing |
| 🎯 Assign | 5 + 5N | Assigned agents | Tasks |
| 💬 Chat | 0 | None (ID only) | Conversation |
| 📢 Broadcast | N | All active | Nothing |
| 🆘 Help | N | All active | Nothing |
| 📈 Status | 0 | None | Nothing |

N = number of active agents

---

## ⚡ Speed Comparison

**Without buttons:**
```
Type: project status website
Type: msg @project:website [long message]
Wait for confirmation
```
**Time:** ~45 seconds

**With buttons:**
```
Click: 📊 SYNC
Select: website
Click: EXECUTE
```
**Time:** ~5 seconds

**9x faster!** 🚀

---

## 🎯 Summary

### The Power of One Click
- ✅ **Daily Standup** → Instant team sync
- ✅ **Project Sync** → Everyone on same page
- ✅ **Smart Assignment** → AI distributes work
- ✅ **Team Chats** → Quick conversations
- ✅ **Broadcasts** → Urgent announcements
- ✅ **Help Coordination** → Remove blockers
- ✅ **Status Checks** → Team health

### Why Use Buttons?
- **Faster** than typing commands
- **Visual** and intuitive
- **No typos** or syntax errors
- **Perfect for common actions**
- **Beautiful pixel-art design**
- **Instant feedback** via toasts

---

**Start using action buttons today and watch your team coordination become effortless!** 🎮🚀

---

Built with ❤️ for The Underground Circle 🦢
