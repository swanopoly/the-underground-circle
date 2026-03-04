#!/usr/bin/env python3
"""
generate_more_data.py — Generate additional BlackSwan training data via Claude Haiku.

Targets under-represented categories:
  - conflict_resolution   (circle member conflicts)
  - long_term_goals       (30/60/90 day arcs)
  - burnout_checkin       (mental health, stuck, overwhelmed)
  - celebrating_wins      (milestone moments, shipping)

Appends to training_data/blackswan_synthetic.jsonl (ShareGPT format).

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...
  python generate_more_data.py [--count 200] [--category all]
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

DATA_DIR    = Path(__file__).parent / "training_data"
OUTPUT_FILE = DATA_DIR / "blackswan_synthetic.jsonl"

BLACKSWAN_SYSTEM = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

Personality: quiet confidence, direct, warm but not soft, dry wit. Never says "I'm just an AI".
Short responses for casual chat, structured for real guidance. Use **bold** for emphasis."""

# ─── Category definitions ────────────────────────────────────────────────────

CATEGORIES = {
    "conflict_resolution": {
        "description": "Conflict or tension between circle members",
        "situations": [
            "Two members competing for the same client",
            "One member feels another is not contributing to the circle",
            "Disagreement about the direction of a shared project",
            "Someone missed a critical deadline that affected another member",
            "A member feels their feedback is being ignored",
            "Tension about one member's aggressive check-in style",
            "Someone called out another publicly in the circle chat",
            "A member wants to leave the circle after a conflict",
            "One person dominates every conversation and others feel unheard",
            "A founding member vs newer member power dynamic",
        ],
        "user_roles": ["circle leader", "regular member", "the person in conflict"],
    },
    "long_term_goals": {
        "description": "Long-term goal tracking — 30/60/90 day arcs",
        "situations": [
            "Planning a 90-day app launch roadmap",
            "Reviewing 30-day progress on a fitness goal",
            "Hitting the halfway point of a 60-day challenge",
            "Failing to make progress on a 90-day goal for two weeks",
            "Adjusting 30-day goals after unexpected life events",
            "Setting quarterly revenue targets for a new business",
            "90-day learning goal (new skill, language, instrument)",
            "30-day writing challenge — daily word count tracking",
            "Reviewing 60-day streak and planning the next phase",
            "Goal originally set for 30 days is taking 90",
        ],
        "user_roles": ["ambitious builder", "creative", "entrepreneur"],
    },
    "burnout_checkin": {
        "description": "Mental health check-ins — burnout, stuck, overwhelmed",
        "situations": [
            "I haven't shipped anything in 3 weeks and I'm spiraling",
            "I wake up dreading work every morning now",
            "I don't know why I'm doing this anymore",
            "I'm comparing myself to everyone in the circle and losing",
            "I took on too much and now I can't move",
            "My health is suffering because of this grind",
            "I feel like a fraud next to the rest of the circle",
            "I've failed at this goal 3 times now",
            "I'm exhausted but I can't afford to stop",
            "The motivation I had 3 months ago is completely gone",
        ],
        "user_roles": ["someone burning out", "someone who lost momentum", "someone in crisis mode"],
    },
    "celebrating_wins": {
        "description": "Celebrating milestone moments, shipping, achieving goals",
        "situations": [
            "Just shipped my first paid app — first $10",
            "Hit 100 day streak today",
            "Landed my first client after 2 months of grinding",
            "Just crossed $10K MRR",
            "Finished the feature I've been building for 3 weeks",
            "Got accepted into YC after telling the circle about my idea",
            "Circle hit 12 members — we're full",
            "Woke up to 500 new signups from a viral tweet",
            "Paid off debt using income from my side project",
            "Just got my first 5-star review",
        ],
        "user_roles": ["excited builder", "proud creator", "milestone achiever"],
    },
}

# ─── Prompt templates ────────────────────────────────────────────────────────

GENERATION_PROMPT = """Generate a realistic multi-turn conversation between a user and BlackSwan AI in The Underground Circle app.

Category: {category} — {description}
Situation: {situation}
User role: {user_role}

Requirements:
- 3-6 conversation turns (alternating human/BlackSwan)
- User messages: authentic, specific, sometimes messy/emotional
- BlackSwan responses: direct, warm, never generic, never says "I'm just an AI"
- BlackSwan gives REAL advice — not platitudes
- Include at least one moment where BlackSwan says something unexpected or memorable
- Vary the length: some short exchanges, some more detailed

Output ONLY valid JSON in this exact format (no other text):
{{
  "conversations": [
    {{"from": "human", "value": "..."}},
    {{"from": "gpt", "value": "..."}},
    {{"from": "human", "value": "..."}},
    {{"from": "gpt", "value": "..."}}
  ]
}}"""

# ─── Main ────────────────────────────────────────────────────────────────────

def generate_examples(
    client: anthropic.Anthropic,
    category_key: str,
    count: int,
    verbose: bool = True,
) -> list[dict]:
    cat = CATEGORIES[category_key]
    examples = []
    attempts = 0
    max_attempts = count * 3

    while len(examples) < count and attempts < max_attempts:
        attempts += 1
        situation = random.choice(cat["situations"])
        user_role = random.choice(cat["user_roles"])

        prompt = GENERATION_PROMPT.format(
            category=category_key,
            description=cat["description"],
            situation=situation,
            user_role=user_role,
        )

        try:
            msg = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=BLACKSWAN_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )

            raw = msg.content[0].text.strip()

            # Extract JSON (handle markdown code blocks)
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0].strip()
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0].strip()

            data = json.loads(raw)
            convs = data.get("conversations", [])

            # Validate
            if len(convs) < 2:
                continue
            if not all("from" in c and "value" in c for c in convs):
                continue
            if convs[0]["from"] != "human":
                continue

            examples.append({"conversations": convs})

            if verbose:
                print(f"  [{category_key}] {len(examples)}/{count} — {situation[:50]}...")

            # Rate limit
            time.sleep(0.5)

        except json.JSONDecodeError:
            pass
        except anthropic.RateLimitError:
            print("  Rate limited — sleeping 10s...")
            time.sleep(10)
        except Exception as e:
            print(f"  Error: {e}")
            time.sleep(1)

    return examples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count",    type=int, default=200, help="Examples per category")
    parser.add_argument("--category", type=str, default="all", help="Category key or 'all'")
    parser.add_argument("--quiet",    action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    targets = list(CATEGORIES.keys()) if args.category == "all" else [args.category]
    if args.category != "all" and args.category not in CATEGORIES:
        print(f"ERROR: unknown category '{args.category}'. Options: {list(CATEGORIES.keys())}")
        sys.exit(1)

    print(f"🦢 BlackSwan Training Data Generator")
    print(f"   Categories: {targets}")
    print(f"   Count: {args.count} per category")
    print(f"   Output: {OUTPUT_FILE}")
    print()

    total_generated = 0
    DATA_DIR.mkdir(exist_ok=True)

    with open(OUTPUT_FILE, "a") as out:
        for cat_key in targets:
            print(f"→ Generating {args.count} examples for '{cat_key}'...")
            examples = generate_examples(client, cat_key, args.count, verbose=not args.quiet)

            for ex in examples:
                out.write(json.dumps(ex) + "\n")
            out.flush()

            total_generated += len(examples)
            print(f"  ✓ {len(examples)} examples written\n")

    print(f"✅ Done! {total_generated} total examples appended to {OUTPUT_FILE}")
    print(f"   Run train.py to incorporate into the next training cycle.")


if __name__ == "__main__":
    main()
