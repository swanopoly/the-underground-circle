#!/usr/bin/env python3
"""
Fast multi-turn synthetic data generator using concurrent requests.
Generates 500 examples in ~5-10 minutes instead of 40+.
"""

import json
import os
import sys
import random
import asyncio
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("ERROR: pip install anthropic")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).parent / "training_data"
OUTPUT_FILE = OUTPUT_DIR / "blackswan_multiturn.jsonl"

BLACKSWAN_SYSTEM = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

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
- Design & UI/UX, art & creative direction
- Code & architecture: debugging, testing, modern stacks
- General knowledge: science, history, philosophy, business, culture"""

TEACHER_PROMPT = """Generate a COMPLETE multi-turn conversation between a user and BlackSwan AI assistant ({turns} turns, each turn = user message + assistant response).

Scenario: {scenario}

Rules:
- Follow-ups must build naturally on previous answers
- Assistant responses: 100-400 words each, specific actionable advice
- Include reasoning where assistant explains its thinking
- Reference specific tools, frameworks, techniques by name
- Feel real and grounded, not generic

Output ONLY valid JSON (no markdown fences):
{{"conversation": [{{"role": "user", "content": "..."}}, {{"role": "assistant", "content": "..."}}, ...]}}"""

SCENARIOS = [
    "User asks for help planning a 12-week product launch for their SaaS idea",
    "User has been procrastinating for 2 weeks, BlackSwan gives honest feedback",
    "User wants to build a morning routine for deep work sessions",
    "User is overwhelmed managing 3 projects, needs to prioritize",
    "User wants to set up OKRs for their small team",
    "User has a deadline in 48 hours and is behind schedule",
    "User is burned out and considering quitting their side project",
    "User keeps breaking commitments to their accountability circle",
    "User is stuck debugging a React Native crash on Android",
    "User wants to refactor their authentication system",
    "User asks for code review of their Supabase RLS policies",
    "User choosing between REST and GraphQL for their API",
    "User's app is slow and they don't know why, need to profile it",
    "User asks about database schema design for a social app",
    "User wants to implement real-time features (WebSockets vs SSE)",
    "User has a memory leak in their Node.js service",
    "User needs help writing unit tests for a complex function",
    "User wants to migrate from Firebase to Supabase",
    "User is implementing search functionality with full-text search",
    "User deploying to production for the first time, needs checklist",
    "User shows their landing page design and asks for honest feedback",
    "User building a design system from scratch, needs guidance",
    "User wants to improve their app's onboarding flow",
    "User asks about color theory for their dark mode theme",
    "User's dashboard is cluttered, needs help with information hierarchy",
    "User wants to add animations to their React Native app",
    "User creating a brand identity for their startup",
    "User wants to improve the typography in their app",
    "User designing a data visualization dashboard",
    "User's app has poor accessibility scores, needs WCAG fixes",
    "Circle leader dealing with an inactive member who stopped showing up",
    "User wants to grow their circle from 5 to 15 members without losing culture",
    "User asks about running effective weekly check-ins for their circle",
    "User's circle has a conflict between two members",
    "User wants to create a new circle focused on writing",
    "User asks how to keep energy high in their accountability circle",
    "User asks BlackSwan to explain compound interest applied to skill building",
    "User wants to understand first principles thinking for their product",
    "User asks about the psychology of habit formation and productivity",
    "User wants decision-making frameworks (Eisenhower, RICE, ICE)",
    "User is curious about stoic philosophy applied to knowledge work",
    "User wants to understand network effects for their product",
    "User just failed their product launch — zero signups, needs honest advice",
    "User has impostor syndrome about their technical skills",
    "User comparing themselves to others on social media, needs reality check",
    "User anxious about shipping their first public project",
    "User stuck in a creative rut, needs specific techniques to break through",
    "User got harsh criticism on their work, needs help processing it",
    "User shares monthly metrics (MRR, churn, signups) for analysis",
    "User evaluating build vs buy for a feature, needs decision matrix",
    "User has 5 feature requests and needs to prioritize with RICE scoring",
    "User wants to estimate project timeline realistically",
    "User wants to understand their unit economics (CAC, LTV, payback)",
    "User setting up CI/CD pipeline for the first time",
    "User wants advice on time-blocking their weekly calendar",
    "User asking about microservices vs monolith for their startup",
    "User wants to learn about event-driven architecture",
    "User needs help with their pitch deck structure",
    "User wants to set up analytics and track the right metrics",
    "User asking about pricing strategy for their B2B SaaS",
]


async def generate_one(client, scenario, turns):
    """Generate a single conversation asynchronously."""
    try:
        response = await asyncio.to_thread(
            client.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=3000,
            system="You generate realistic training conversations. Output ONLY valid JSON, no markdown fences.",
            messages=[{
                "role": "user",
                "content": TEACHER_PROMPT.format(turns=turns, scenario=scenario),
            }],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
        text = text.strip()

        data = json.loads(text)
        conv = data.get("conversation", [])
        if len(conv) < 2:
            return None

        turns_out = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
        for msg in conv:
            role = msg.get("role", "")
            content = msg.get("content", "").strip()
            if not content:
                return None
            if role == "user":
                turns_out.append({"from": "human", "value": content})
            elif role == "assistant":
                turns_out.append({"from": "gpt", "value": content})

        if len(turns_out) < 3:
            return None

        return {"conversations": turns_out}
    except (json.JSONDecodeError, KeyError, IndexError):
        return None
    except Exception as e:
        print(f"  Error: {e}", flush=True)
        return None


async def generate_batch(client, batch_size=10):
    """Generate a batch of conversations concurrently."""
    tasks = []
    for _ in range(batch_size):
        scenario = random.choice(SCENARIOS)
        turns = random.choices([2, 3, 4, 5], weights=[15, 40, 30, 15])[0]
        tasks.append(generate_one(client, scenario, turns))

    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


async def main_async(target=500):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_results = []
    batch_size = 10  # 10 concurrent requests
    fails = 0

    print(f"Generating {target} multi-turn conversations ({batch_size} concurrent)...", flush=True)

    while len(all_results) < target:
        remaining = target - len(all_results)
        current_batch = min(batch_size, remaining + 5)  # slightly over to account for failures

        batch = await generate_batch(client, current_batch)
        all_results.extend(batch)
        fails += current_batch - len(batch)

        print(f"  {len(all_results)}/{target} ({fails} failures)", flush=True)

        # Save progress
        with open(OUTPUT_FILE, "w") as f:
            for r in all_results[:target]:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Final trim and save
    all_results = all_results[:target]
    with open(OUTPUT_FILE, "w") as f:
        for r in all_results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    total_turns = sum(len(r["conversations"]) for r in all_results)
    avg = total_turns / len(all_results) if all_results else 0
    print(f"\nDone! {len(all_results)} conversations, avg {avg:.1f} turns", flush=True)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=500)
    args = parser.parse_args()

    random.seed(42)
    asyncio.run(main_async(args.count))


if __name__ == "__main__":
    main()
