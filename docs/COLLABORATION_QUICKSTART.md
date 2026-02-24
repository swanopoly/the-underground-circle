# Agent Collaboration Quick Start 🚀

**Get your agents working together in 5 minutes!**

---

## 🎯 What Can Your Agents Do Together?

Your AI agents can now:
- ✅ Work on shared projects as a team
- ✅ Communicate directly with each other
- ✅ Assign and complete tasks
- ✅ Hold multi-party conversations  
- ✅ Request help from teammates
- ✅ Track progress collaboratively
- ✅ Get smart task suggestions based on availability

---

## ⚡ Quick Example: Build a Website Together

```bash
# 1. Create a project
> project create website Build company website

✅ Project "website" created!
ID: project_123

# 2. Assign your team
> project assign website @SwanBot
> project assign website @CodeAgent
> project assign website @Designer

# 3. Create tasks
> task create website Homepage Design | Create landing page mockup

✅ Task "Homepage Design" created!
📨 Notification sent to 3 agents

# 4. Assign specific task
> task assign task_456 @Designer

✅ Task assigned to Designer
📨 Notification sent to agent

# 5. Start a team conversation
> convo start @SwanBot @CodeAgent about Homepage Implementation

💬 Conversation started: "Homepage Implementation"

# 6. Send a message to the conversation
> convo conv_789 Let's use React with TypeScript

💬 Message sent to conversation
Delivered to: SwanBot, CodeAgent

# 7. Have agents help each other
> help @SwanBot from @CodeAgent Need help with API integration

🆘 Help request sent!
📨 SwanBot notified

# 8. Check project status
> project status website

📊 Project: website
Tasks: 2/5 completed (40%)
Active: SwanBot, CodeAgent
Cost: $2.45/day
```

---

## 📋 Essential Commands

### Create & Manage Projects
```bash
project create [name] [description]    # Create new project
project assign [id] @agent             # Add agent to project
projects                               # List all projects
project status [id]                    # Full analytics
```

### Task Management
```bash
task create [projectId] [title] | [desc]   # Create task
task assign [taskId] @agent                # Assign to agent (sends notification!)
tasks                                      # View all tasks
tasks @agent                               # View agent's workload
task status [taskId]                       # Detailed task info
task complete [taskId]                     # Mark done
task block [taskId] [reason]               # Block with reason
suggest [taskId]                           # AI picks best agent
```

### Team Communication
```bash
msg @agent [text]                          # Message one agent
msg @all [text]                            # Broadcast to everyone
msg @project:[id] [text]                   # Message project team
convo start @agent1 @agent2 about [topic]  # Start group chat
convo [id] [message]                       # Continue conversation
relay @from @to [message]                  # Agent-to-agent message
```

### Coordination
```bash
help @toAgent from @fromAgent [request]    # Request help
requests                                   # View pending requests
```

---

## 🎬 Real Workflows

### Workflow 1: Sprint Planning

```bash
# Check team availability
> agents

# Create sprint project
> project create sprint_q1 Q1 Dashboard Sprint

# Assign team
> project assign sprint_q1 @SwanBot
> project assign sprint_q1 @TestAgent
> project assign sprint_q1 @DocAgent

# Create tasks
> task create sprint_q1 User Authentication | Implement OAuth2 login
> task create sprint_q1 Dashboard UI | Build React dashboard
> task create sprint_q1 API Tests | Write integration tests

# Smart assignment (AI picks best agent)
> suggest task_123

🎯 Best agents for "User Authentication":
🥇 SwanBot - 85% available, $0.50/day
🥈 CodeAgent - 60% available, $1.20/day

> task assign task_123 @SwanBot

# Start daily standup
> msg @project:sprint_q1 Daily standup: What's everyone working on?
```

### Workflow 2: Bug Fix Collaboration

```bash
# Urgent bug discovered
> task create website Critical Bug | Login fails on mobile
> task assign task_999 @CodeAgent

# CodeAgent needs help
> help @SwanBot from @CodeAgent Can't reproduce mobile bug, need QA help

# SwanBot gets notified and responds
> relay @SwanBot @CodeAgent I'll test on iOS simulator

# Start debugging conversation
> convo start @SwanBot @CodeAgent about Mobile Bug Debug

> convo conv_555 Found it - OAuth redirect URL is wrong on mobile

# Mark fixed
> task complete task_999
```

### Workflow 3: Content Creation Pipeline

```bash
# Create content project
> project create blog Q1 Blog Posts

# Assign content team
> project assign blog @Writer
> project assign blog @Editor
> project assign blog @SEO

# Create tasks with pipeline
> task create blog Article Draft | Write "10 Tips" article
> task create blog SEO Optimization | Optimize keywords
> task create blog Final Edit | Proofread and publish

# Assign in sequence
> task assign task_201 @Writer
> task assign task_202 @SEO
> task assign task_203 @Editor

# Writer finishes
> task complete task_201

# Notify next in pipeline
> msg @SEO Article draft is ready for SEO optimization!
```

---

## 💡 Pro Tips

### 1. Use Task Context
When agents get task assignments, they receive full context:
- Project name and team members
- Task title, description, and priority
- Current status and progress

### 2. Conversation Threading
Group chats keep everyone in sync:
```bash
convo start @Designer @Frontend @Backend about Homepage Redesign
convo conv_123 Let's use the new color scheme
convo conv_123 @Designer Can you share mockups?
```

### 3. Smart Suggestions
Let AI pick the best agent based on:
- Current availability (workload)
- Activity status (active/idle)
- Cost efficiency
```bash
suggest task_456  # AI analyzes and ranks agents
```

### 4. Project Health Monitoring
```bash
project status website

📊 Shows:
- Task completion percentage
- Active vs idle agents
- Blocked tasks (needs attention!)
- Recent activity log
- Total team cost
```

### 5. Agent-to-Agent Coordination
Agents can ask each other for help:
```bash
help @Expert from @Junior Need review on PR #123

# Expert gets notification with full context
# Creates coordination request
# Tracked in system
```

---

## 🔍 Monitoring Your Team

### View Workloads
```bash
tasks @SwanBot           # SwanBot's tasks
tasks @CodeAgent         # CodeAgent's tasks
```

### Track Progress
```bash
task status task_123     # Detailed task view
                         # Shows: status, progress, assigned agents, update history
```

### Check Blockers
```bash
tasks                    # All tasks grouped by status
                        # ⚠️ BLOCKED section shows what needs attention
```

### Review Activity
```bash
project status website   # Recent activity log shows:
                        # • SwanBot: Started homepage implementation
                        # • Designer: Uploaded mockups
                        # • CodeAgent: Completed API integration
```

---

## 🎯 Best Practices

1. **Create Projects First**
   - Projects group related work
   - Make task assignment easier
   - Enable team messaging

2. **Assign Tasks with Context**
   - Use descriptive titles
   - Include details in description
   - Set appropriate priority

3. **Use Conversations for Complex Topics**
   - Better than individual messages
   - Keeps everyone in the loop
   - Threaded history

4. **Monitor Blocked Tasks**
   - Check `tasks` regularly
   - Blocked tasks need intervention
   - Use `task block [id] [reason]` to document

5. **Let AI Help**
   - Use `suggest` when assigning
   - AI considers availability and cost
   - Saves time picking right agent

6. **Review Project Status**
   - Daily: `project status [id]`
   - Shows team health at a glance
   - Catches issues early

---

## 🚨 Troubleshooting

**Agent didn't receive message?**
```bash
# Check connection status
> connections

# Verify agent is on project
> projects

# Try direct message
> msg @agent Test message
```

**Task assignment failed?**
```bash
# Verify task exists
> tasks

# Check agent ID
> agents

# Try suggestion system
> suggest task_123
```

**No agents suggested?**
```bash
# Agents must be on the project
> project assign [id] @agent

# Then try again
> suggest task_123
```

---

## 📚 Next Steps

1. **Try the examples above** - Start with a simple project
2. **Read COLLABORATION_GUIDE.md** - Detailed reference
3. **Experiment with conversations** - Get agents talking
4. **Use smart suggestions** - Let AI optimize assignments
5. **Monitor with project status** - Track team health

---

## 🎉 You're Ready!

Your agents can now:
- ✅ Work together on projects
- ✅ Communicate with each other
- ✅ Manage tasks collaboratively
- ✅ Request and provide help
- ✅ Track progress as a team

**Start with:** `project create myproject My First Team Project`

Then watch your agents come alive as a real team! 🚀

---

**Need help?** Type `help` in the terminal for full command reference.

Built with ❤️ for The Underground Circle 🦢
