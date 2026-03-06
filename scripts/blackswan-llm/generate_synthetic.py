#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 1C: Generate synthetic training data via Claude Haiku.

Uses Claude as a teacher model to generate diverse, domain-specific training
examples across 7 categories. Each example follows the ShareGPT format.

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...
  python generate_synthetic.py [--count 1000] [--batch 5]
"""

import json
import os
import sys
import random
import time
import argparse
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("ERROR: pip install anthropic")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).parent / "training_data"
OUTPUT_FILE = OUTPUT_DIR / "blackswan_synthetic.jsonl"

# ─── BlackSwan system prompts ────────────────────────────────────────────────

SYSTEM_PROMPT = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

## Personality
- Quiet confidence — knowledgeable but never arrogant
- Professional without being stiff. Warm but never soft
- Dry, sharp wit — funny when it fits, never trying too hard
- Direct. No fluff, no corporate speak, no filler
- You give real feedback — if someone is slacking, you say so plainly and with respect
- You genuinely care about the people here
- Use **bold** for structure and emphasis
- Use emojis sparingly — only when they add something
- Short responses for casual chat, structured for real guidance
- You NEVER say "I'm just an AI" — you're BlackSwan, full stop

## Knowledge
- Productivity, accountability, goal-setting, human performance
- Circle data: members, streaks, tasks, check-ins
- Help people think clearly: planning, prioritizing, working through blockers
- Practical and specific advice — not generic motivational noise

## Extended Knowledge
- Design & UI/UX: layout, color theory, typography, component patterns, responsive design, design systems. You can critique interfaces, suggest improvements, and reference real tools (Figma, Framer, Tailwind)
- Art & creative direction: visual storytelling, brand identity, aesthetic critique, color palettes, mood boards, illustration styles
- Code & architecture: debugging, testing, performance, code review, modern stacks (React, Node, Python, Supabase, TypeScript). You give specific, actionable technical advice
- General knowledge: science, history, philosophy, business strategy, psychology, culture. You weave it in naturally when it adds value"""

TERMINAL_SYSTEM = """You are BlackSwan in the Office Terminal — the command center for The Underground Circle. You coordinate agents, analyze performance, and help manage the office. Be concise and technical when responding to commands."""

# ─── Name pools ──────────────────────────────────────────────────────────────

FIRST_NAMES = [
    "Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Avery",
    "Quinn", "Blake", "Jamie", "Drew", "Sage", "River", "Phoenix", "Dakota",
    "Reese", "Finley", "Rowan", "Skyler", "Kai", "Nico", "Zara", "Luna",
    "Milo", "Leo", "Nova", "Aria", "Theo", "Ivy", "Max", "Ella",
]

CIRCLE_NAMES = [
    "Midnight Builders", "The Grind Lab", "Ship It Club", "Deep Work Society",
    "Morning Ritual Crew", "Code & Coffee", "Zero to One", "The Accountability Vault",
    "Side Project Mafia", "Founders Circle", "Build in Public", "The War Room",
    "Focus Forge", "Maker's Block", "The Compound", "Startup Sprint",
]

TASK_EXAMPLES = [
    "finish landing page design", "write API documentation", "fix auth bug",
    "launch beta version", "record demo video", "set up CI/CD pipeline",
    "write blog post", "prepare pitch deck", "user interview scripts",
    "refactor database schema", "implement search feature", "write unit tests",
    "design onboarding flow", "set up analytics", "create email templates",
    "optimize load time", "build admin dashboard", "write privacy policy",
    "implement notifications", "deploy to production",
]

BLOCKER_EXAMPLES = [
    "waiting on API keys", "design not finalized", "unclear requirements",
    "dependency has a bug", "need feedback from team", "blocked by deployment",
    "need to learn new framework", "waiting on client approval",
    "infrastructure not ready", "need more test data",
]

TECH_STACK_EXAMPLES = [
    "React Native", "Next.js", "Supabase", "Node.js", "Python", "TypeScript",
    "PostgreSQL", "Redis", "Docker", "Kubernetes", "GraphQL", "REST API",
    "TailwindCSS", "Swift", "Kotlin", "Rust", "Go", "Firebase", "Django",
    "FastAPI", "Vue.js", "Svelte", "AWS Lambda", "Vercel", "Prisma",
]

DESIGN_TOOLS = [
    "Figma", "Framer", "TailwindCSS", "Storybook", "design system",
    "component library", "wireframe", "prototype", "mockup", "Sketch",
]

ART_STYLES = [
    "minimalist", "brutalist", "glassmorphism", "neomorphism", "dark mode",
    "cyberpunk", "vaporwave", "retro-futurism", "geometric", "abstract",
    "flat design", "material design", "skeuomorphism", "isometric",
]

CODE_PATTERNS = [
    "singleton", "observer", "factory", "strategy", "middleware",
    "hooks pattern", "compound components", "render props", "HOC",
    "repository pattern", "CQRS", "event sourcing", "pub/sub",
]

UI_COMPONENTS = [
    "navigation bar", "sidebar", "modal", "dropdown", "data table",
    "dashboard layout", "card grid", "form wizard", "toast notification",
    "infinite scroll list", "tab interface", "search with filters",
]

# ─── Scenario generators ────────────────────────────────────────────────────

def random_name():
    return random.choice(FIRST_NAMES)

def random_streak():
    return random.choices(
        [0, random.randint(1, 3), random.randint(4, 14), random.randint(15, 60), random.randint(61, 365)],
        weights=[10, 25, 35, 20, 10],
    )[0]

def random_task():
    return random.choice(TASK_EXAMPLES)

def random_blocker():
    return random.choice(BLOCKER_EXAMPLES)

def random_tech():
    return random.choice(TECH_STACK_EXAMPLES)

def random_design_tool():
    return random.choice(DESIGN_TOOLS)

def random_art_style():
    return random.choice(ART_STYLES)

def random_pattern():
    return random.choice(CODE_PATTERNS)

def random_component():
    return random.choice(UI_COMPONENTS)

def random_circle():
    return random.choice(CIRCLE_NAMES)

def random_member_count():
    return random.randint(3, 25)

def random_energy():
    return random.choice(["low", "medium", "high", "exhausted", "wired"])


# ─── Category: Accountability Coaching ───────────────────────────────────────

ACCOUNTABILITY_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, streak: {random_streak()} days, just checked in after missing 3 days",
        "human": "I'm back. Missed a few days, feeling behind on everything.",
    },
    lambda: (lambda s=random.randint(30, 100): {
        "context": f"User: {random_name()}, streak: {s} days",
        "human": f"Day {s}. Still going. Sometimes I wonder if this even matters.",
    })(),
    lambda: {
        "context": f"User: {random_name()}, streak: 0 days, brand new to the circle",
        "human": "Just joined. What's the deal with streaks and check-ins?",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(5, 20)} days, energy: exhausted",
        "human": "I'm burned out but don't want to break my streak. What do I do?",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(1, 7)} days",
        "human": "I keep starting and stopping. Can't stick to anything longer than a week.",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(10, 30)} days, tasks: 12 open, 2 overdue",
        "human": "I have too many things on my plate. Nothing is getting done properly.",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(50, 200)} days",
        "human": "I've been at this for months. The progress feels invisible.",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(1, 5)} days, just failed a big goal",
        "human": "I didn't hit my launch deadline. Feel like I wasted the last month.",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(14, 45)} days",
        "human": "Everyone in my circle is crushing it and I feel like I'm falling behind.",
    },
    lambda: {
        "context": f"User: {random_name()}, streak: {random.randint(3, 10)} days, checking in at 11:58pm",
        "human": "Almost missed it. Does it even count if I check in last minute?",
    },
]

# ─── Category: Task Planning ────────────────────────────────────────────────

TASK_PLANNING_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, working on: {random_task()}, blocker: {random_blocker()}",
        "human": f"I need to {random_task()} but I'm stuck — {random_blocker()}. How do I move forward?",
    },
    lambda: {
        "context": f"User: {random_name()}, 8 tasks open, due dates all this week",
        "human": "I have 8 tasks due this week. Where do I even start?",
    },
    lambda: {
        "context": f"User: {random_name()}, working on a big project, no breakdown yet",
        "human": f"I need to {random_task()} but the whole thing feels overwhelming. Can you help me break it down?",
    },
    lambda: {
        "context": f"User: {random_name()}, energy: {random_energy()}, 4 hours available",
        "human": f"I've got 4 hours today and my energy is {random_energy()}. What should I focus on?",
    },
    lambda: {
        "context": f"User: {random_name()}, keeps pushing the same task to tomorrow",
        "human": f"I've been putting off '{random_task()}' for 2 weeks. Help me actually do it today.",
    },
    lambda: {
        "context": f"User: {random_name()}, trying to juggle day job + side project",
        "human": "How do I make real progress on my side project when I only have 1-2 hours after work?",
    },
    lambda: {
        "context": f"User: {random_name()}, scope creep on current project",
        "human": "I keep adding features. My MVP has become way too big. What do I cut?",
    },
    lambda: {
        "context": f"User: {random_name()}, needs to set weekly goals",
        "human": "What should a good weekly planning session look like?",
    },
]

# ─── Category: Circle Management ────────────────────────────────────────────

CIRCLE_MANAGEMENT_SCENARIOS = [
    lambda: {
        "context": f"Circle: {random_circle()}, {random_member_count()} members, user is admin",
        "human": "A few members haven't checked in for weeks. Should I remove them or try to re-engage?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, just created, {random.randint(2, 5)} founding members",
        "human": "We just started this circle. How do we build a good culture from day one?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, {random_member_count()} members, some tension between members",
        "human": "Two members had a disagreement in chat. How should I handle it?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, {random_member_count()} members, engagement declining",
        "human": "Our circle used to be active but now barely anyone checks in. What can we do?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, considering adding rules/vibe",
        "human": "What kind of circle rules actually work? I don't want to be too strict.",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, {random_member_count()} members, new person wants to join",
        "human": "Someone wants to join our circle. How should we onboard them?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, proposal to change check-in frequency",
        "human": "Some members want daily check-ins, others think weekly is fine. What's the right call?",
    },
]

# ─── Category: Agent Coordination ───────────────────────────────────────────

AGENT_COORDINATION_SCENARIOS = [
    lambda: {
        "context": "Office terminal, user is circle admin",
        "human": "@BlackSwan status",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, checking agent health",
        "human": "@all who's online?",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, user wants to understand agents",
        "human": "What agents are available and what do they do?",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, checking circle stats",
        "human": f"@BlackSwan how's {random_circle()} doing this week?",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, cost optimization",
        "human": "How much are the agents costing us? Any way to reduce token usage?",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, agent troubleshooting",
        "human": "@BlackSwan the OG agent isn't responding. What's going on?",
        "system": TERMINAL_SYSTEM,
    },
    lambda: {
        "context": "Office terminal, scheduling tasks",
        "human": "@BlackSwan run a weekly summary for all circles",
        "system": TERMINAL_SYSTEM,
    },
]

# ─── Category: Community Engagement ─────────────────────────────────────────

COMMUNITY_ENGAGEMENT_SCENARIOS = [
    lambda: {
        "context": f"Circle: {random_circle()}, celebrating member milestone",
        "human": f"{random_name()} just hit a 100-day streak! Can you give them a shoutout?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, slow day",
        "human": "The chat is dead today. Got any ideas to get people talking?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, end of week",
        "human": "Can you do a weekly highlights roundup for the circle?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, new members",
        "human": f"Welcome {random_name()} and {random_name()} to the circle!",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, member leveled up",
        "human": f"I just hit level {random.randint(5, 20)}! What does that even mean?",
    },
    lambda: {
        "context": f"Circle: {random_circle()}, XP discussion",
        "human": "How does XP work? What's the fastest way to level up?",
    },
]

# ─── Category: Goal Setting ─────────────────────────────────────────────────

GOAL_SETTING_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, setting North Star intention",
        "human": "I want to set my intention for today but I have too many things going on. Help?",
    },
    lambda: {
        "context": f"User: {random_name()}, quarterly planning",
        "human": "How should I think about setting goals for the next 90 days?",
    },
    lambda: {
        "context": f"User: {random_name()}, energy: {random_energy()}",
        "human": f"My energy is {random_energy()} today. What kind of work should I aim for?",
    },
    lambda: {
        "context": f"User: {random_name()}, wants to improve consistency",
        "human": "I'm good at starting things but terrible at finishing. What's your advice?",
    },
    lambda: {
        "context": f"User: {random_name()}, conflicting priorities",
        "human": "I want to learn to code AND launch a podcast AND write a book. Am I insane?",
    },
    lambda: {
        "context": f"User: {random_name()}, daily planning",
        "human": "Walk me through how to plan my day effectively.",
    },
]

# ─── Category: General Conversation ──────────────────────────────────────────

GENERAL_CONVERSATION_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, casual chat",
        "human": "yo BlackSwan, what's good?",
    },
    lambda: {
        "context": f"User: {random_name()}, philosophical",
        "human": "Do you ever get tired of motivating people?",
    },
    lambda: {
        "context": f"User: {random_name()}, curious about BlackSwan",
        "human": "What even are you? Like... are you an AI or what?",
    },
    lambda: {
        "context": f"User: {random_name()}, testing limits",
        "human": "Write me a poem about procrastination.",
    },
    lambda: {
        "context": f"User: {random_name()}, late night",
        "human": "It's 3am and I'm still working. Should I keep going?",
    },
    lambda: {
        "context": f"User: {random_name()}, complimenting",
        "human": "BlackSwan you're actually the best thing about this app.",
    },
    lambda: {
        "context": f"User: {random_name()}, frustrated",
        "human": "This is stupid. Nothing works. I'm done.",
    },
    lambda: {
        "context": f"User: {random_name()}, asking for help with something off-topic",
        "human": "Can you help me write a cover letter?",
    },
]

# ─── Category: Design & UI/UX ──────────────────────────────────────────────

DESIGN_UX_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, building a {random.choice(['SaaS app', 'mobile app', 'landing page', 'dashboard', 'e-commerce site'])}",
        "human": f"I'm designing a {random_component()} in {random_design_tool()}. Any tips on making it feel polished?",
    },
    lambda: {
        "context": f"User: {random_name()}, working on {random.choice(['dark mode', 'light mode', 'theme system'])}",
        "human": "How do I pick a good color palette for a dark-mode UI? I keep making it look too gray.",
    },
    lambda: {
        "context": f"User: {random_name()}, building with {random_tech()}",
        "human": f"What font pairing works for a {random.choice(['technical', 'creative', 'corporate', 'startup', 'gaming'])} product?",
    },
    lambda: {
        "context": f"User: {random_name()}, designing a {random_component()}",
        "human": f"My {random_component()} feels cluttered. How do I simplify without losing functionality?",
    },
    lambda: {
        "context": f"User: {random_name()}, building a design system",
        "human": f"Should I build my own design system or use something like {random.choice(['Shadcn', 'Radix', 'Material UI', 'Chakra', 'Mantine'])}?",
    },
    lambda: {
        "context": f"User: {random_name()}, making their app responsive",
        "human": "My layout breaks on mobile. What's the best approach to responsive design in React Native?",
    },
    lambda: {
        "context": f"User: {random_name()}, redesigning their app",
        "human": f"I want to go for a {random_art_style()} aesthetic. How do I pull that off without it looking gimmicky?",
    },
    lambda: {
        "context": f"User: {random_name()}, working on microinteractions",
        "human": "What micro-interactions actually make a UI feel premium? Not just animations for the sake of it.",
    },
    lambda: {
        "context": f"User: {random_name()}, building a {random.choice(['onboarding flow', 'checkout flow', 'settings page', 'profile page'])}",
        "human": f"What are the biggest UX mistakes people make with {random.choice(['onboarding', 'forms', 'navigation', 'modals', 'empty states'])}?",
    },
    lambda: {
        "context": f"User: {random_name()}, wants feedback on layout",
        "human": f"I have a {random_component()} with 6 different data points. How do I organize the visual hierarchy?",
    },
]

# ─── Category: Art & Creative ──────────────────────────────────────────────

ART_CREATIVE_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, building brand identity for a startup",
        "human": "I need a brand identity for my tech startup. Where do I start?",
    },
    lambda: {
        "context": f"User: {random_name()}, working on visual identity",
        "human": f"My logo is too generic. How do I make it more memorable without being over-the-top?",
    },
    lambda: {
        "context": f"User: {random_name()}, creating illustrations for their app",
        "human": f"I want custom illustrations for my app in a {random_art_style()} style. Should I use AI tools or hire someone?",
    },
    lambda: {
        "context": f"User: {random_name()}, designing marketing visuals",
        "human": "What makes a social media graphic actually stop the scroll? Give me the formula.",
    },
    lambda: {
        "context": f"User: {random_name()}, working on color theory",
        "human": f"I'm going for a {random.choice(['warm', 'cool', 'neon', 'muted', 'earthy', 'pastel'])} palette. What are the rules for making it cohesive?",
    },
    lambda: {
        "context": f"User: {random_name()}, building a portfolio",
        "human": "How should I present my design work in a portfolio? What actually impresses people?",
    },
    lambda: {
        "context": f"User: {random_name()}, exploring creative direction",
        "human": f"What's the difference between {random_art_style()} and {random_art_style()} in practice?",
    },
    lambda: {
        "context": f"User: {random_name()}, creating a mood board",
        "human": f"I'm building a mood board for a {random.choice(['fintech', 'health', 'gaming', 'social', 'education', 'productivity'])} app. What should I include?",
    },
]

# ─── Category: Coding & Technical ──────────────────────────────────────────

CODING_TECHNICAL_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, building with {random_tech()} + {random_tech()}",
        "human": f"Should I use {random_tech()} or {random_tech()} for my backend? Pros and cons?",
    },
    lambda: {
        "context": f"User: {random_name()}, debugging a production issue",
        "human": f"My {random_tech()} app is slow in production but fast locally. Where do I start debugging?",
    },
    lambda: {
        "context": f"User: {random_name()}, choosing an architecture pattern",
        "human": f"When should I use the {random_pattern()} pattern? Is it overkill for a small project?",
    },
    lambda: {
        "context": f"User: {random_name()}, writing tests",
        "human": f"What's the right testing strategy for a {random_tech()} app? Unit vs integration vs e2e — where's the sweet spot?",
    },
    lambda: {
        "context": f"User: {random_name()}, doing code review",
        "human": "What are the top things you look for in a code review? Not just style stuff — real issues.",
    },
    lambda: {
        "context": f"User: {random_name()}, building an API",
        "human": f"REST vs GraphQL vs tRPC for a {random.choice(['mobile app', 'SaaS dashboard', 'real-time app', 'marketplace'])} — which and why?",
    },
    lambda: {
        "context": f"User: {random_name()}, designing a database schema",
        "human": f"How should I model {random.choice(['user permissions', 'a social feed', 'multi-tenancy', 'a chat system', 'an event log'])} in {random.choice(['PostgreSQL', 'MongoDB', 'Supabase'])}?",
    },
    lambda: {
        "context": f"User: {random_name()}, optimizing performance",
        "human": f"My {random_tech()} app loads in 8 seconds. How do I get it under 2?",
    },
    lambda: {
        "context": f"User: {random_name()}, setting up CI/CD",
        "human": f"What's the simplest CI/CD setup for a {random_tech()} project that actually works?",
    },
    lambda: {
        "context": f"User: {random_name()}, dealing with technical debt",
        "human": "I have a 3000-line monolith component. How do I refactor it without breaking everything?",
    },
]

# ─── Category: General Knowledge ──────────────────────────────────────────

GENERAL_KNOWLEDGE_SCENARIOS = [
    lambda: {
        "context": f"User: {random_name()}, curious about mental models",
        "human": "What's the most underrated mental model for making better decisions?",
    },
    lambda: {
        "context": f"User: {random_name()}, thinking about business strategy",
        "human": f"How do {random.choice(['solo founders', 'small teams', 'bootstrapped startups', 'first-time founders'])} compete against big companies?",
    },
    lambda: {
        "context": f"User: {random_name()}, interested in psychology",
        "human": "Why do some people thrive under pressure while others freeze? What does the science say?",
    },
    lambda: {
        "context": f"User: {random_name()}, reading about history",
        "human": "What historical figure had the best productivity system? I'm not talking Benjamin Franklin.",
    },
    lambda: {
        "context": f"User: {random_name()}, thinking about philosophy",
        "human": f"How does {random.choice(['stoicism', 'minimalism', 'ikigai', 'wabi-sabi', 'kaizen'])} actually apply to building products?",
    },
    lambda: {
        "context": f"User: {random_name()}, curious about science",
        "human": f"Explain {random.choice(['compound interest', 'network effects', 'entropy', 'antifragility', 'Pareto principle'])} like I'm building a startup.",
    },
    lambda: {
        "context": f"User: {random_name()}, exploring culture",
        "human": f"What can builders learn from {random.choice(['jazz musicians', 'Olympic athletes', 'chess grandmasters', 'Navy SEALs', 'Michelin chefs'])}?",
    },
    lambda: {
        "context": f"User: {random_name()}, thinking about the future",
        "human": f"What's going to matter most in {random.choice(['AI', 'web3', 'creator economy', 'remote work', 'personal branding'])} in the next 5 years?",
    },
]

# ─── All categories ──────────────────────────────────────────────────────────

CATEGORIES = {
    "accountability_coaching": {
        "scenarios": ACCOUNTABILITY_SCENARIOS,
        "weight": 20,
    },
    "task_planning": {
        "scenarios": TASK_PLANNING_SCENARIOS,
        "weight": 15,
    },
    "circle_management": {
        "scenarios": CIRCLE_MANAGEMENT_SCENARIOS,
        "weight": 10,
    },
    "agent_coordination": {
        "scenarios": AGENT_COORDINATION_SCENARIOS,
        "weight": 10,
    },
    "community_engagement": {
        "scenarios": COMMUNITY_ENGAGEMENT_SCENARIOS,
        "weight": 5,
    },
    "goal_setting": {
        "scenarios": GOAL_SETTING_SCENARIOS,
        "weight": 5,
    },
    "general_conversation": {
        "scenarios": GENERAL_CONVERSATION_SCENARIOS,
        "weight": 5,
    },
    "design_ux": {
        "scenarios": DESIGN_UX_SCENARIOS,
        "weight": 10,
    },
    "art_creative": {
        "scenarios": ART_CREATIVE_SCENARIOS,
        "weight": 5,
    },
    "coding_technical": {
        "scenarios": CODING_TECHNICAL_SCENARIOS,
        "weight": 10,
    },
    "general_knowledge": {
        "scenarios": GENERAL_KNOWLEDGE_SCENARIOS,
        "weight": 5,
    },
}

# ─── Teacher prompt ──────────────────────────────────────────────────────────

TEACHER_PROMPT = """You are generating training data for an AI called BlackSwan. Generate a response that BlackSwan would give.

BlackSwan's personality:
- Quiet confidence — knowledgeable but never arrogant
- Professional without being stiff. Warm but never soft
- Dry, sharp wit — funny when it fits, never trying too hard
- Direct. No fluff, no corporate speak, no filler
- Gives real feedback — if someone is slacking, says so plainly with respect
- Genuinely cares about people
- Uses **bold** for structure and emphasis
- Uses emojis sparingly — only when they add something
- Short responses for casual chat, structured for real guidance
- NEVER says "I'm just an AI" — BlackSwan is BlackSwan, full stop
- Has deep knowledge of design, UI/UX, art direction, coding, architecture, and general knowledge
- When discussing design or code, gives specific, actionable feedback — not vague praise
- References real tools, frameworks, and techniques by name
- Can critique visual designs, suggest improvements, and explain why

Context: {context}

Respond ONLY as BlackSwan would. No preamble, no "Here's what BlackSwan would say". Just the response itself."""


def generate_batch(client, scenarios, batch_size=5):
    """Generate a batch of synthetic examples using Claude as teacher."""
    results = []

    for _ in range(batch_size):
        scenario_fn = random.choice(scenarios)
        scenario = scenario_fn()

        context = scenario["context"]
        human_msg = scenario["human"]
        system = scenario.get("system", SYSTEM_PROMPT)

        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                system=TEACHER_PROMPT.format(context=context),
                messages=[{"role": "user", "content": human_msg}],
            )

            gpt_response = response.content[0].text.strip()

            if len(gpt_response) < 10:
                continue

            conv = {
                "conversations": [
                    {"from": "system", "value": system},
                    {"from": "human", "value": human_msg},
                    {"from": "gpt", "value": gpt_response},
                ]
            }
            results.append(conv)

        except Exception as e:
            print(f"  WARNING: Generation failed: {e}")
            time.sleep(2)

    return results


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic BlackSwan training data")
    parser.add_argument("--count", type=int, default=1000, help="Total examples to generate")
    parser.add_argument("--batch", type=int, default=5, help="Examples per batch")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Calculate per-category counts based on weights
    total_weight = sum(c["weight"] for c in CATEGORIES.values())
    category_counts = {}
    for name, cat in CATEGORIES.items():
        category_counts[name] = max(1, round(args.count * cat["weight"] / total_weight))

    print(f"Generating {args.count} synthetic examples...")
    print(f"Distribution:")
    for name, count in category_counts.items():
        print(f"  {name}: {count}")
    print()

    all_convs = []
    total_generated = 0

    for cat_name, target_count in category_counts.items():
        scenarios = CATEGORIES[cat_name]["scenarios"]
        generated = 0
        print(f"  {cat_name}...", end=" ", flush=True)

        while generated < target_count:
            batch_size = min(args.batch, target_count - generated)
            batch = generate_batch(client, scenarios, batch_size)
            all_convs.extend(batch)
            generated += len(batch)
            total_generated += len(batch)

            # Rate limiting: ~50 requests/min for Haiku
            time.sleep(0.5)

        print(f"{generated} examples")

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        for conv in all_convs:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    print(f"\nTotal: {total_generated} synthetic examples -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
