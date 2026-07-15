#!/usr/bin/env python3
"""
Generate tool-use training data for BlackSwan LLM.

Creates synthetic examples of BlackSwan using its tools correctly:
- create_task, update_task, list_tasks
- post_activity, search_web, fetch_url
- hf_generate_image, hf_summarize, hf_classify, hf_translate
- hf_code, hf_vision, hf_chat, hf_qa
- store_memory

Each example shows the user request, BlackSwan's reasoning (with <think>),
the tool call, and the response after getting the tool result.

Usage:
    python generate_tool_use.py [--count 500] [--batch 5]
"""

import json
import os
import re
import time
import random
import argparse
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"

# Live OpenSwan tool catalog (the actual tool names/labels/descriptions the
# model sees at runtime). TOOL_SCENARIOS below is a small, hand-maintained
# list that has drifted badly out of sync with this catalog (as of 2026-07,
# TOOL_SCENARIOS covers ~11 legacy tool names — create_task, hf_generate_image,
# search_web, etc. — none of which exist in the current ~199-tool catalog).
# load_tool_catalog() parses the real catalog straight out of
# openswanToolRuntime.ts (best-effort regex — no TS toolchain available here)
# so every real tool automatically gets at least baseline synthetic coverage
# instead of silently having zero, even as the catalog keeps growing.
REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_RUNTIME_PATH = REPO_ROOT / "src" / "lib" / "openswanToolRuntime.ts"


def load_tool_catalog():
    """Best-effort parse of TOOL_DEFINITIONS (+ the standalone
    TEAM_DEPLOY_AGENTS_TOOL_DEFINITION) out of openswanToolRuntime.ts.

    Returns a list of (name, label, description) tuples. Returns [] if the
    file is missing or its shape has changed enough that the regex no longer
    matches — callers should treat catalog-derived scenarios as additive and
    keep working with an empty catalog.
    """
    try:
        src = TOOL_RUNTIME_PATH.read_text()
    except OSError:
        return []

    catalog = []
    # Split the file on each object's `name: '...'` line so we don't need to
    # balance braces; each chunk runs from one `name:` to the next.
    name_positions = [m.start() for m in re.finditer(r"\n\s*name: '([^']+)',", src)]
    names = re.findall(r"\n\s*name: '([^']+)',", src)
    for i, (pos, name) in enumerate(zip(name_positions, names)):
        end = name_positions[i + 1] if i + 1 < len(name_positions) else len(src)
        chunk = src[pos:end]

        label_match = re.search(r"label: '([^']+)',", chunk)
        label = label_match.group(1) if label_match else name

        # description is either `description: '...'` / `description: "..."`
        # on one line, or `description:\n    '...'` wrapped to the next line.
        desc_match = re.search(
            r"description:\s*\n?\s*['\"]((?:[^'\"\\]|\\.)*)['\"]", chunk
        )
        description = desc_match.group(1) if desc_match else label

        catalog.append((name, label, description))

    return catalog

BLACKSWAN_SYSTEM = """You are BlackSwan — the AI agent for The Underground Circle. You help dev teams stay accountable, ship code, and build together. You have access to tools and use them proactively when they help the user."""

# Tool-use scenarios grouped by tool
TOOL_SCENARIOS = {
    "create_task": [
        "Create a task for fixing the login page bug",
        "Add a task to refactor the auth module",
        "I need to remember to update the README — make a task",
        "Can you add 'deploy to staging' to the board?",
        "Create a high priority task for the security audit",
        "Add a task for writing unit tests for the API",
        "Make a task: implement dark mode toggle",
        "Put 'fix flaky CI tests' on the backlog",
        "Create an urgent task — production is down",
        "Add a code review task for PR #42",
    ],
    "hf_generate_image": [
        "Generate a logo for our project — a black swan with code",
        "Create an image of a futuristic dev workspace",
        "Draw a mascot for our team — a robot programmer",
        "Generate a banner image for our weekly report",
        "Make an abstract visualization of our sprint progress",
        "Create a pixel art image of a swan coding",
        "Generate a motivational poster about shipping code",
        "Draw a diagram of our microservices architecture",
    ],
    "hf_summarize": [
        "Summarize this PR description: [long text about API changes]",
        "Give me a TLDR of today's check-ins",
        "Summarize the last 5 commits for the standup",
        "Can you summarize this article about React patterns?",
        "TLDR this error log from production",
        "Summarize what happened in the circle this week",
    ],
    "hf_classify": [
        "Is this message a bug report or feature request? 'The button doesn't work on mobile'",
        "What's the sentiment of this PR comment? 'This is completely wrong, please rewrite'",
        "Classify this: 'When will dark mode be available?' — is it a question, bug, or feature?",
        "Analyze the mood of our team chat from today",
        "Is this task urgent or can it wait? 'Memory leak in production causing 503s'",
    ],
    "hf_code": [
        "Write a React hook for infinite scroll",
        "Generate a Python script to parse our JSONL training data",
        "Write a TypeScript function to calculate streak days",
        "Create a SQL query for our leaderboard — top 10 by streak",
        "Write a bash script to deploy to staging",
        "Generate a Supabase RLS policy for circle_members",
    ],
    "hf_translate": [
        "Translate this commit message to Spanish: 'Fixed authentication bug in login flow'",
        "How do you say 'ship it!' in Japanese?",
        "Translate our README intro to French",
        "Convert this error message to Chinese for our Shanghai team",
    ],
    "search_web": [
        "What's the latest version of React Native?",
        "Search for best practices for Supabase RLS policies",
        "Find the Expo 54 migration guide",
        "Look up the current SOL price",
        "Search for how to fix 'EADDRINUSE' error on port 8081",
    ],
    "list_tasks": [
        "What tasks are in progress right now?",
        "Show me the backlog",
        "What's in peer review?",
        "How many tasks did we complete this week?",
        "Are there any stuck tasks?",
    ],
    "post_activity": [
        "Post a standup summary to the feed",
        "Announce that we shipped the new feature",
        "Alert the team about the CI failure",
        "Post a celebration — we hit our sprint goal!",
        "Share a weekly progress update",
    ],
    "hf_vision": [
        "What's in this screenshot? [image URL]",
        "Describe the UI in this mockup",
        "Can you read the text in this error screenshot?",
        "What does this architecture diagram show?",
    ],
    "hf_qa": [
        "Based on our docs, what's the API rate limit?",
        "From this README, how do I set up the dev environment?",
        "According to the PR description, what breaking changes are there?",
    ],
}

# Response templates that show tool usage patterns
def make_tool_use_example(tool, scenario, think=True):
    """Generate a single tool-use training example."""
    think_block = ""
    if think:
        think_block = f"<think>\nThe user wants me to {scenario.lower().split('—')[0].strip()}. I should use the {tool} tool for this.\n</think>\n\n"

    # Tool-specific response patterns
    responses = {
        "create_task": f"{think_block}I'll create that task for you.\n\n[Using create_task: Added to your board]\n\nDone! Task added to your todo column.",
        "hf_generate_image": f"{think_block}I'll generate that image for you using FLUX.\n\n[Using hf_generate_image: Generating...]\n\nHere's your image! Generated with FLUX.1-schnell.",
        "hf_summarize": f"{think_block}Let me summarize that for you.\n\n[Using hf_summarize: Processing...]\n\nHere's the summary:\n- Key point 1\n- Key point 2\n- Key point 3",
        "hf_classify": f"{think_block}Let me analyze that for you.\n\n[Using hf_classify: Analyzing sentiment/category...]\n\nResults: The text is classified as [category] with 92% confidence.",
        "hf_code": f"{think_block}I'll generate that code using Qwen3-Coder.\n\n[Using hf_code: Generating...]\n\n```typescript\n// Generated code here\n```\n\nHere's the code. Let me know if you need adjustments.",
        "hf_translate": f"{think_block}I'll translate that for you.\n\n[Using hf_translate: Translating...]\n\nTranslation: [translated text]",
        "search_web": f"{think_block}Let me search for that.\n\n[Using search_web: Searching...]\n\nFound relevant results:\n1. [Result title and summary]\n2. [Result title and summary]",
        "list_tasks": f"{think_block}Let me check the board.\n\n[Using list_tasks: Fetching...]\n\nHere's what's on the board:\n- Task 1 (in_progress)\n- Task 2 (todo)\n- Task 3 (peer_review)",
        "post_activity": f"{think_block}I'll post that to the activity feed.\n\n[Using post_activity: Posting...]\n\nPosted to the circle feed!",
        "hf_vision": f"{think_block}Let me analyze that image.\n\n[Using hf_vision: Analyzing...]\n\nI can see [description of what's in the image].",
        "hf_qa": f"{think_block}Let me find the answer from the context.\n\n[Using hf_qa: Searching...]\n\nBased on the document: [answer]",
    }

    return {
        "conversations": [
            {"from": "system", "value": BLACKSWAN_SYSTEM},
            {"from": "human", "value": scenario},
            {"from": "gpt", "value": responses.get(tool, f"{think_block}Let me handle that.\n\n[Using {tool}]\n\nDone!")},
        ]
    }


def build_catalog_scenarios(min_desc_len=20):
    """Derive baseline scenario prompts for every real tool in
    openswanToolRuntime.ts's TOOL_DEFINITIONS that TOOL_SCENARIOS doesn't
    already hand-cover.

    As of 2026-07, TOOL_SCENARIOS only covers ~11 legacy tool names
    (create_task, hf_generate_image, search_web, list_tasks, ...) — NONE of
    which exist in the current ~199-tool live catalog (tasks.create,
    browser.*, desktop.*, gmail.*, vault.*, rooms.*, missions.*, etc.). This
    function closes that gap programmatically: every tool the model can
    actually call gets at least two synthetic scenario prompts derived from
    its own label/description, so newly added tools automatically get
    baseline training coverage instead of silently having zero. Hand-written
    TOOL_SCENARIOS entries always take priority when a tool name is covered
    by both.
    """
    catalog = load_tool_catalog()
    scenarios = {}
    for name, label, description in catalog:
        if name in TOOL_SCENARIOS:
            continue
        first_sentence = description.split(". ")[0].strip().rstrip(".")
        if len(first_sentence) < min_desc_len:
            first_sentence = label
        lede = first_sentence[0].lower() + first_sentence[1:] if first_sentence else label.lower()
        scenarios[name] = [
            f"Can you {lede}?",
            f"I need help with this — {label.lower()}.",
        ]
    return scenarios


def generate_multi_turn_tool_example(scenarios_dict, think=True):
    """Generate a multi-turn example where BlackSwan uses multiple tools."""
    tools = random.sample(list(scenarios_dict.keys()), min(3, len(scenarios_dict)))
    think_prefix = "<think>\nThe user needs help with multiple things. Let me address each one.\n</think>\n\n" if think else ""

    conversations = [
        {"from": "system", "value": BLACKSWAN_SYSTEM},
    ]

    for i, tool in enumerate(tools):
        scenario = random.choice(scenarios_dict[tool])
        if i == 0:
            conversations.append({"from": "human", "value": scenario})
            conversations.append({"from": "gpt", "value": f"{think_prefix if i == 0 else ''}I'll handle that.\n\n[Using {tool}]\n\nDone! What else do you need?"})
        else:
            # Only decapitalize the first letter for the "Also, ..." clause —
            # lowercasing the whole scenario (the pre-existing behavior) also
            # mangled proper nouns/tool-specific terms later in the sentence.
            # The pronoun "I" stays capitalized regardless of position.
            if scenario.startswith("I "):
                lede = scenario
            else:
                lede = scenario[:1].lower() + scenario[1:] if scenario else scenario
            conversations.append({"from": "human", "value": f"Also, {lede}"})
            think_follow = f"<think>\nNow they need {tool}. Let me do that.\n</think>\n\n" if think else ""
            conversations.append({"from": "gpt", "value": f"{think_follow}On it.\n\n[Using {tool}]\n\nDone!"})

    return {"conversations": conversations}


def main():
    parser = argparse.ArgumentParser(description="Generate tool-use training data")
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--think-ratio", type=float, default=0.75,
                        help="Ratio of examples with <think> blocks (0.0-1.0)")
    args = parser.parse_args()

    output_path = DATA_DIR / "blackswan_tool_use.jsonl"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    catalog_scenarios = build_catalog_scenarios()
    all_scenarios = {**catalog_scenarios, **TOOL_SCENARIOS}
    print(f"Hand-written TOOL_SCENARIOS: {len(TOOL_SCENARIOS)} tools")
    print(f"Catalog-derived scenarios (openswanToolRuntime.ts): {len(catalog_scenarios)} tools")
    print(f"Combined scenario pool: {len(all_scenarios)} tools\n")

    examples = []

    # Single-tool examples (70%)
    single_count = int(args.count * 0.7)
    for i in range(single_count):
        tool = random.choice(list(all_scenarios.keys()))
        scenario = random.choice(all_scenarios[tool])
        think = random.random() < args.think_ratio
        examples.append(make_tool_use_example(tool, scenario, think=think))

    # Multi-turn tool examples (30%)
    multi_count = args.count - single_count
    for i in range(multi_count):
        think = random.random() < args.think_ratio
        examples.append(generate_multi_turn_tool_example(all_scenarios, think=think))

    random.shuffle(examples)

    with open(output_path, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    print(f"Generated {len(examples)} tool-use training examples")
    print(f"  Single-tool: {single_count}")
    print(f"  Multi-turn:  {multi_count}")
    print(f"  With <think>: ~{int(args.count * args.think_ratio)}")
    print(f"  Saved to: {output_path}")

    # Stats by tool
    tool_counts = {}
    for ex in examples:
        for turn in ex["conversations"]:
            if turn["from"] == "gpt":
                for tool in all_scenarios:
                    if tool in turn["value"]:
                        tool_counts[tool] = tool_counts.get(tool, 0) + 1
    print("\n  Tool distribution:")
    for tool, count in sorted(tool_counts.items(), key=lambda x: -x[1]):
        print(f"    {tool}: {count}")


if __name__ == "__main__":
    main()
