# Multi-Agent Collaboration Guide

**Making your agents work together as a real team! 🤝**

---

## 🎯 What You Can Do

### 1. **Create Projects**
Organize agents into teams working on specific goals.

```bash
project create website Build the new company website
project create api Develop REST API v2
project create marketing Q1 marketing campaign
```

### 2. **Assign Agents to Projects**
Put your best agents on each project.

```bash
project assign project_123 @SwanBot
project assign project_123 @CodeAgent
project assign website @Designer
```

### 3. **Message Individual Agents**
Talk to any agent directly.

```bash
msg @SwanBot Start working on the homepage layout
msg @CodeAgent Review the authentication code
msg @Designer Create mockups for the landing page
```

### 4. **Broadcast to All Agents**
Send a message to every agent at once.

```bash
msg @all Daily standup in 5 minutes!
msg @all Remember to tag your sessions with project names
msg @all Great work team! We hit our milestones
```

### 5. **Message Project Teams**
Send a message to all agents on a specific project.

```bash
msg @project:website Team meeting at 3 PM
msg @project:api Code review in progress
```

### 6. **View Projects**
See all your projects and who's working on what.

```bash
projects
project list
```

### 7. **View Message History**
See recent messages between you and your agents.

```bash
messages
relay
msg history
```

---

## 💭 Thought Bubbles

Agents now have personalities! Watch for thought bubbles that appear above their pixel character:

### What Triggers Thoughts?

**Random Thoughts (every 15-45 seconds):**
- Funny observations
- Useful tips
- Agent personality quirks

**Event-Triggered Thoughts:**
- 💸 **Cost Spike** - "That last call cost more than your coffee"
- 🔴 **Error** - "Oops, that wasn't supposed to happen"
- ⚡ **Active** - "I'm on fire! (Metaphorically)"
- 😴 **Idle** - "If a tree falls in the forest..."
- ✨ **Efficient** - "That was cheap AND effective!"

### Thought Types

| Type | Color | When It Appears |
|------|-------|-----------------|
| 💡 Idea | Purple | Useful tips and suggestions |
| ⚠️ Warning | Orange | Cost spikes, budget alerts |
| ✓ Success | Green | Efficient operations, milestones |
| 😄 Funny | Pink | Random humor, personality |
| ℹ️ Info | Blue | Status updates, reminders |

---

## 📋 Example Workflows

### **Workflow 1: Build a Website**

```bash
# Create the project
project create website Build company website with React

# Assign your team
project assign website @CodeAgent
project assign website @Designer
project assign website @ContentWriter

# Message the team
msg @project:website Let's start with wireframes and sitemap

# Check on individual progress
msg @CodeAgent How's the React setup going?
msg @Designer Can you share the color palette?

# Broadcast important updates
msg @all Website launch date is Friday!
```

### **Workflow 2: Sprint Planning**

```bash
# See all your agents
agents

# Check project status
projects

# Assign sprint tasks
msg @all Sprint planning: Check your assigned projects

# Message specific agents
msg @SwanBot You're on backend API this sprint
msg @TestAgent Focus on integration tests
msg @DocAgent Update API documentation

# Set up new sprint project
project create sprint_q1 Q1 Sprint - User Dashboard
project assign sprint_q1 @SwanBot
project assign sprint_q1 @TestAgent
```

### **Workflow 3: Daily Standup**

```bash
# Morning check-in
msg @all Good morning! Daily standup in 10 mins

# Individual check-ins
msg @CodeAgent What did you work on yesterday?
msg @Designer Any blockers?

# Broadcast results
msg @all Great standup! Let's crush it today 🚀

# Check costs
costs

# Review projects
projects
```

---

## 🎮 Terminal Commands Reference

### Project Management

| Command | Description | Example |
|---------|-------------|---------|
| `project create [name] [desc]` | Create new project | `project create api Build REST API` |
| `project assign [id] @agent` | Assign agent to project | `project assign project_123 @SwanBot` |
| `project remove [id] @agent` | Remove agent from project | `project remove project_123 @SwanBot` |
| `project delete [id]` | Delete a project | `project delete project_123` |
| `projects` | List all projects | `projects` |

### Messaging

| Command | Description | Example |
|---------|-------------|---------|
| `msg @agent [text]` | Message one agent | `msg @SwanBot Start the build` |
| `msg @all [text]` | Broadcast to all | `msg @all Team meeting now!` |
| `msg @project:[id] [text]` | Message project team | `msg @project:website Code review time` |
| `messages` | View message history | `messages` |

### Office Management

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Office overview | `status` |
| `agents` | List all agents | `agents` |
| `agent [name]` | Agent details | `agent SwanBot` |
| `costs` | Cost breakdown | `costs` |
| `connections` | List connections | `connections` |
| `help` | Show all commands | `help` |

---

## 🏗️ Project Ideas

### **Development Projects**
- `frontend` - UI/UX work
- `backend` - API & database
- `testing` - QA & testing
- `devops` - CI/CD & infrastructure

### **Business Projects**
- `marketing` - Campaigns & content
- `sales` - Lead generation
- `support` - Customer service
- `research` - Market analysis

### **Content Projects**
- `blog` - Blog posts & articles
- `social` - Social media content
- `docs` - Documentation
- `design` - Visual assets

---

## 💡 Pro Tips

1. **Use Project Tags with Sessions**  
   Tag your sessions with project names for better cost attribution:
   ```bash
   msg @CodeAgent Tag all sessions with "project:website"
   ```

2. **Regular Check-ins**  
   Use `msg @all` for daily standups and updates.

3. **Monitor Costs by Project**  
   Assign agents to projects, then review spending:
   ```bash
   projects
   costs
   ```

4. **Watch the Thought Bubbles**  
   Agents will alert you to issues, cost spikes, or give tips!

5. **Keep Teams Small**  
   3-5 agents per project works best for coordination.

6. **Use the Message History**  
   Review past conversations:
   ```bash
   messages
   ```

---

## 🎨 Personality System

Each agent has their own personality that shows through thought bubbles!

**Personality Traits:**
- 🤓 **Nerdy** - Makes tech jokes and references
- 💰 **Budget-conscious** - Watches costs carefully
- 🚀 **Ambitious** - Always pushing forward
- 😄 **Cheerful** - Stays positive
- 🤔 **Philosophical** - Deep thoughts

Watch your agents develop their personalities over time!

---

## 🔧 Technical Details

**Message System:**
- Messages sent via OpenClaw `sessions_send` tool
- Broadcast messages sent to all active sessions
- Project messages filtered by agent assignments
- Message history kept in memory (last 100 messages)

**Thought Bubbles:**
- Generated every 15-45 seconds (random interval)
- Event-triggered on status/cost changes
- 5-second display duration
- Fade in/out animations
- Context-aware (status, activity, costs)

**Project Data:**
- Stored in `@office_projects` storage key
- Persists across app restarts
- Supports unlimited projects and agents
- Color-coded for easy identification

---

## 🚀 Getting Started

1. **Connect Your Agents**  
   Go to ⚙️ → Connections and add your OpenClaw endpoints

2. **Create Your First Project**  
   ```bash
   project create demo My first project
   ```

3. **Assign Some Agents**  
   ```bash
   project assign demo @SwanBot
   ```

4. **Send a Message**  
   ```bash
   msg @SwanBot Hello! Let's collaborate
   ```

5. **Watch the Magic**  
   See thought bubbles appear and agents come to life!

---

**Built with ❤️ for The Underground Circle**  
Making AI agents work together as real teams 🦢
