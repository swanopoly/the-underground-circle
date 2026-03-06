#!/usr/bin/env python3
"""
Generate multi-turn synthetic training data for BlackSwan LLM.

Uses Claude Haiku as teacher to generate rich, multi-turn conversations (3-5 turns)
with chain-of-thought reasoning and diverse scenarios.

Output: training_data/blackswan_multiturn.jsonl
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

TEACHER_PROMPT = """You are a training data generator for BlackSwan, an AI assistant for a productivity app called The Underground Circle. Generate a COMPLETE multi-turn conversation between a user and BlackSwan.

The conversation MUST:
1. Be {turns} turns (each turn = one user message + one BlackSwan response)
2. Follow this scenario: {scenario}
3. Show natural conversation flow — follow-ups build on previous answers
4. BlackSwan's responses should be detailed (100-400 words each), with specific actionable advice
5. Include chain-of-thought reasoning where BlackSwan explains its thinking
6. BlackSwan should reference specific tools, frameworks, or techniques by name
7. The conversation should feel real and grounded, not generic

Output ONLY valid JSON in this exact format (no markdown, no explanation):
{{"conversation": [
  {{"role": "user", "content": "..."}},
  {{"role": "assistant", "content": "..."}},
  {{"role": "user", "content": "..."}},
  {{"role": "assistant", "content": "..."}}
]}}"""

# Rich scenario categories with multi-turn prompts
SCENARIOS = [
    # Productivity & Planning (weight: 20)
    *[s for s in [
        "User asks for help planning a 12-week product launch. They have a SaaS idea but no plan. BlackSwan helps break it down week by week, then user asks about prioritization, then about handling blockers.",
        "User has been procrastinating on a big project for 2 weeks. BlackSwan gives direct honest feedback, then helps identify root cause (fear of failure), then creates an action plan.",
        "User wants to build a morning routine for deep work. BlackSwan suggests a specific schedule, user pushes back on some items, they iterate together.",
        "User is overwhelmed managing 3 projects simultaneously. BlackSwan helps them triage, decide what to cut, and create a single focused plan.",
        "User wants to set up OKRs for their small team. BlackSwan walks them through the framework, they draft real examples together, then refine them.",
        "User has a deadline in 48 hours and is behind. BlackSwan helps them create an emergency sprint plan, prioritize ruthlessly, and stay focused.",
        "User asks how to track their productivity over time. BlackSwan recommends specific metrics, tools, and review cadences.",
        "User is burned out and considering quitting their side project. BlackSwan gives empathetic but honest advice about when to persist vs pivot.",
        "User wants advice on time-blocking their calendar. BlackSwan helps design a weekly template balancing deep work, meetings, and personal time.",
        "User keeps breaking their commitments to their circle. BlackSwan addresses it directly, helps find the pattern, and creates accountability systems.",
    ] for _ in range(2)],  # weight 2x

    # Code & Technical (weight: 15)
    *[
        "User is stuck debugging a React Native crash on Android. BlackSwan asks diagnostic questions, they narrow it down together, BlackSwan suggests specific fixes.",
        "User wants to refactor their authentication system. BlackSwan evaluates their current approach, suggests a better architecture, they discuss tradeoffs.",
        "User asks for a code review of their Supabase RLS policies. BlackSwan identifies security issues and suggests fixes with explanations.",
        "User is choosing between REST and GraphQL for their API. BlackSwan walks through pros/cons for their specific use case.",
        "User wants to set up CI/CD for the first time. BlackSwan recommends a specific pipeline, they configure it step by step.",
        "User's app is slow and they don't know why. BlackSwan helps them profile, identify bottlenecks, and optimize step by step.",
        "User asks about database schema design for a social app. BlackSwan helps them think through relationships, indexes, and query patterns.",
        "User is deciding between TypeScript and Python for a backend. BlackSwan analyzes their team, project needs, and gives a specific recommendation.",
        "User wants to implement real-time features. BlackSwan compares WebSockets, SSE, and polling for their use case.",
        "User has a memory leak in their Node.js service. BlackSwan helps them diagnose it with specific debugging techniques.",
        "User needs help writing unit tests for a complex function. BlackSwan walks through test cases, edge cases, and testing patterns.",
        "User asks about deploying to production for the first time. BlackSwan creates a deployment checklist and discusses monitoring.",
        "User's API is getting rate-limited by a third-party service. BlackSwan helps design a caching and queuing strategy.",
        "User wants to migrate from Firebase to Supabase. BlackSwan creates a migration plan addressing auth, database, storage, and functions.",
        "User is implementing search functionality. BlackSwan discusses full-text search, indexing strategies, and UI patterns.",
    ],

    # Design & Creative (weight: 15)
    *[
        "User shows their landing page design and asks for feedback. BlackSwan gives specific, constructive critique on layout, typography, and messaging.",
        "User is building a design system from scratch. BlackSwan helps them define tokens, components, and guidelines step by step.",
        "User wants to improve their app's onboarding flow. BlackSwan analyzes common patterns, suggests a specific flow, they iterate on details.",
        "User asks about color theory for their dark mode theme. BlackSwan explains contrast ratios, accent colors, and accessibility considerations.",
        "User's dashboard is cluttered and hard to read. BlackSwan helps them prioritize information hierarchy and simplify the layout.",
        "User wants to add animations to their React Native app. BlackSwan recommends specific libraries, patterns, and performance considerations.",
        "User is creating a brand identity for their startup. BlackSwan helps with naming, visual direction, tone of voice, and logo concepts.",
        "User asks about mobile-first design patterns. BlackSwan discusses gestures, navigation patterns, and responsive layouts.",
        "User wants to improve the typography in their app. BlackSwan recommends specific font pairings, sizes, and line heights.",
        "User is designing a data visualization dashboard. BlackSwan helps choose chart types, color schemes, and interaction patterns.",
        "User's app has poor accessibility scores. BlackSwan audits common issues and provides specific fixes for WCAG compliance.",
        "User wants to create a consistent icon system. BlackSwan discusses style guidelines, grid systems, and implementation approaches.",
        "User asks about micro-interactions and their impact on UX. BlackSwan provides specific examples and implementation tips.",
        "User is redesigning their navigation. BlackSwan compares tab bar, drawer, and bottom sheet patterns for their app type.",
        "User wants feedback on their app's empty states. BlackSwan suggests content, illustrations, and CTAs for each empty state.",
    ],

    # Circle Management & Community (weight: 10)
    *[
        "User is a circle leader dealing with an inactive member. BlackSwan helps them approach the conversation directly but kindly.",
        "User wants to grow their circle from 5 to 15 members. BlackSwan discusses recruitment, onboarding, and maintaining culture at scale.",
        "User asks about running effective weekly check-ins. BlackSwan designs a check-in format that's quick but meaningful.",
        "User's circle has a conflict between two members. BlackSwan helps mediate with specific communication strategies.",
        "User wants to create a new circle focused on writing. BlackSwan helps define the format, frequency, and accountability structure.",
        "User asks how to keep energy high in their circle. BlackSwan suggests specific rituals, challenges, and recognition systems.",
        "User is building a mentorship program within their circle. BlackSwan helps structure pairings, meeting cadence, and goals.",
        "User wants to track circle health metrics. BlackSwan defines what to measure and how to interpret the data.",
        "User asks about handling a toxic member. BlackSwan gives direct advice on boundaries, communication, and when to remove someone.",
        "User is merging two circles. BlackSwan helps plan the transition to maintain both groups' culture.",
    ],

    # General Knowledge & Reasoning (weight: 10)
    *[
        "User asks BlackSwan to explain a complex concept (compound interest, game theory, or similar) and how it applies to building products.",
        "User wants to understand first principles thinking. BlackSwan explains and applies it to the user's specific project.",
        "User asks about the psychology of habit formation. BlackSwan explains the science and gives practical applications for productivity.",
        "User wants to learn about effective negotiation. BlackSwan teaches specific frameworks with examples relevant to freelancers/founders.",
        "User asks about decision-making frameworks. BlackSwan teaches several (Eisenhower, RICE, ICE) and helps apply one to the user's current decisions.",
        "User is curious about stoic philosophy and productivity. BlackSwan connects key stoic principles to modern knowledge work.",
        "User wants to understand network effects for their product. BlackSwan explains the concept with real examples and helps identify how to build them.",
        "User asks about the innovator's dilemma. BlackSwan explains and applies it to the user's competitive landscape.",
        "User wants to learn about systems thinking. BlackSwan explains feedback loops, emergent behavior, and applies it to team dynamics.",
        "User asks about the differences between startups and side projects. BlackSwan gives nuanced advice on mindset, commitment, and when to transition.",
    ],

    # Emotional Support & Mindset (weight: 10)
    *[
        "User just failed their product launch — zero signups. BlackSwan is empathetic but direct, helps analyze what went wrong, and plans next steps.",
        "User has impostor syndrome about their technical skills. BlackSwan addresses it honestly, normalizes it, and gives concrete ways to build confidence.",
        "User is comparing themselves to others on social media. BlackSwan gives a reality check about survivorship bias and helps refocus on their own path.",
        "User is anxious about shipping their first public project. BlackSwan helps them work through the fear and create a shipping checklist.",
        "User feels stuck in a creative rut. BlackSwan suggests specific techniques for breaking through creative blocks.",
        "User is dealing with scope creep on their project. BlackSwan helps them draw boundaries and have the conversation with stakeholders.",
        "User got harsh criticism on their work. BlackSwan helps them separate useful feedback from noise and grow from it.",
        "User can't decide between two career paths. BlackSwan helps them think through the decision systematically without telling them what to do.",
        "User is frustrated their team isn't as motivated as they are. BlackSwan gives perspective on leadership and motivation.",
        "User wants to build resilience. BlackSwan shares specific practices rooted in psychology and personal experience patterns.",
    ],

    # Multi-step Reasoning & Analysis (weight: 10)
    *[
        "User shares their monthly metrics (MRR, churn, signups) and asks BlackSwan to analyze trends and recommend actions.",
        "User wants to evaluate whether to build a feature or buy a third-party solution. BlackSwan creates a decision matrix and walks through it.",
        "User asks BlackSwan to help them write a project brief. They iterate through several drafts, getting more specific each round.",
        "User presents a business model and asks BlackSwan to find the weaknesses. BlackSwan does a structured analysis.",
        "User has 5 feature requests and needs to prioritize. BlackSwan applies RICE scoring and discusses the results.",
        "User wants to estimate how long a project will take. BlackSwan helps break it down, account for unknowns, and create a realistic timeline.",
        "User shares their pricing strategy. BlackSwan analyzes it against market data and suggests specific changes.",
        "User wants to understand their unit economics. BlackSwan walks through CAC, LTV, payback period with their real numbers.",
        "User asks for help with a competitive analysis. BlackSwan creates a structured comparison framework.",
        "User wants to calculate if they can afford to go full-time on their startup. BlackSwan helps with the financial analysis.",
    ],
]


def generate_conversation(client, scenario: str, turns: int) -> dict | None:
    """Generate a single multi-turn conversation."""
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=3000,
            system="You generate realistic multi-turn training conversations. Output ONLY valid JSON, no markdown fences, no explanation.",
            messages=[{
                "role": "user",
                "content": TEACHER_PROMPT.format(turns=turns, scenario=scenario),
            }],
        )

        text = response.content[0].text.strip()
        # Clean up any markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
        text = text.strip()

        data = json.loads(text)
        conv = data.get("conversation", [])

        if len(conv) < 2:
            return None

        # Convert to ShareGPT format
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

        if len(turns_out) < 3:  # system + at least 1 human + 1 gpt
            return None

        return {"conversations": turns_out}

    except (json.JSONDecodeError, KeyError, IndexError) as e:
        return None
    except Exception as e:
        print(f"  API error: {e}")
        time.sleep(2)
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=2000, help="Total examples")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    fails = 0
    target = args.count

    print(f"Generating {target} multi-turn conversations...")
    print(f"Available scenarios: {len(SCENARIOS)}")

    while len(results) < target:
        scenario = random.choice(SCENARIOS)
        turns = random.choices([2, 3, 4, 5], weights=[15, 40, 30, 15])[0]

        conv = generate_conversation(client, scenario, turns)
        if conv:
            results.append(conv)
            if len(results) % 25 == 0:
                print(f"  {len(results)}/{target} generated ({fails} failures)")
                # Save progress
                with open(OUTPUT_FILE, "w") as f:
                    for r in results:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
        else:
            fails += 1

        # Rate limiting
        time.sleep(0.3)

    # Final save
    with open(OUTPUT_FILE, "w") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    total_turns = sum(len(r["conversations"]) for r in results)
    avg_turns = total_turns / len(results) if results else 0

    print(f"\nDone! {len(results)} conversations saved to {OUTPUT_FILE}")
    print(f"Average turns: {avg_turns:.1f}")
    print(f"Failures: {fails}")


if __name__ == "__main__":
    main()
