#!/usr/bin/env python3
"""
Download and curate high-quality public datasets for BlackSwan LLM training.

Downloads:
  - Capybara (16K multi-turn conversations) — best quality-to-size ratio
  - SlimOrca subset (5K filtered) — high-quality instruction following
  - UltraChat 200K subset (2K) — multi-turn conversation fluency

Converts everything to ShareGPT JSONL format compatible with our training pipeline.
Filters for quality: min length, max length, dedup.

Output: training_data/public_curated.jsonl
"""

import json
import random
import hashlib
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
OUTPUT_FILE = DATA_DIR / "public_curated.jsonl"

# Targets
CAPYBARA_TARGET = 5000
SLIMORCA_TARGET = 5000
ULTRACHAT_TARGET = 2000
TOTAL_TARGET = CAPYBARA_TARGET + SLIMORCA_TARGET + ULTRACHAT_TARGET

MIN_RESPONSE_CHARS = 80
MAX_RESPONSE_CHARS = 8000
MIN_TURNS = 2  # at least human + gpt


def convert_capybara(dataset, target: int) -> list[dict]:
    """Convert Capybara dataset to ShareGPT format.
    Capybara uses input/output fields in each conversation turn.
    """
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)

    for idx in indices:
        if len(results) >= target:
            break

        row = dataset[idx]
        conv = row.get("conversation", [])
        if not conv or len(conv) < 1:
            continue

        turns = []
        turns.append({
            "from": "system",
            "value": "You are BlackSwan, a knowledgeable AI assistant. Provide helpful, detailed, and thoughtful responses."
        })

        valid = True
        for turn in conv:
            human = turn.get("input", "").strip()
            gpt = turn.get("output", "").strip()
            if not human or not gpt:
                valid = False
                break
            if len(gpt) < MIN_RESPONSE_CHARS or len(gpt) > MAX_RESPONSE_CHARS:
                valid = False
                break
            turns.append({"from": "human", "value": human})
            turns.append({"from": "gpt", "value": gpt})

        if valid and len(turns) >= MIN_TURNS + 1:  # +1 for system
            results.append({"conversations": turns})

    return results


def convert_slimorca(dataset, target: int) -> list[dict]:
    """Convert SlimOrca to ShareGPT format.
    SlimOrca has 'conversations' field in ShareGPT-like format.
    """
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)

    for idx in indices:
        if len(results) >= target:
            break

        row = dataset[idx]
        conversations = row.get("conversations", [])
        if not conversations or len(conversations) < 2:
            continue

        turns = []
        valid = True
        has_system = False

        for turn in conversations:
            role = turn.get("from", "")
            content = turn.get("value", "").strip()
            if not content:
                valid = False
                break

            if role == "system":
                has_system = True
                # Replace with BlackSwan system prompt
                turns.append({
                    "from": "system",
                    "value": "You are BlackSwan, a knowledgeable AI assistant. Provide helpful, detailed, and thoughtful responses."
                })
            elif role == "human":
                turns.append({"from": "human", "value": content})
            elif role == "gpt":
                if len(content) < MIN_RESPONSE_CHARS or len(content) > MAX_RESPONSE_CHARS:
                    valid = False
                    break
                turns.append({"from": "gpt", "value": content})

        if not has_system:
            turns.insert(0, {
                "from": "system",
                "value": "You are BlackSwan, a knowledgeable AI assistant. Provide helpful, detailed, and thoughtful responses."
            })

        if valid and len([t for t in turns if t["from"] in ("human", "gpt")]) >= MIN_TURNS:
            results.append({"conversations": turns})

    return results


def convert_ultrachat(dataset, target: int) -> list[dict]:
    """Convert UltraChat 200K to ShareGPT format.
    UltraChat has 'messages' field with role/content pairs.
    """
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)

    for idx in indices:
        if len(results) >= target:
            break

        row = dataset[idx]
        messages = row.get("messages", [])
        if not messages or len(messages) < 2:
            continue

        turns = [{
            "from": "system",
            "value": "You are BlackSwan, a knowledgeable AI assistant. Provide helpful, detailed, and thoughtful responses."
        }]
        valid = True

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "").strip()
            if not content:
                valid = False
                break

            if role == "user":
                turns.append({"from": "human", "value": content})
            elif role == "assistant":
                if len(content) < MIN_RESPONSE_CHARS or len(content) > MAX_RESPONSE_CHARS:
                    valid = False
                    break
                turns.append({"from": "gpt", "value": content})

        if valid and len([t for t in turns if t["from"] in ("human", "gpt")]) >= MIN_TURNS:
            results.append({"conversations": turns})

    return results


def dedup(examples: list[dict]) -> list[dict]:
    """Remove near-duplicates by hashing the human turn."""
    seen = set()
    unique = []
    for ex in examples:
        human_turns = [t["value"] for t in ex["conversations"] if t["from"] == "human"]
        key = hashlib.md5("".join(human_turns).encode()).hexdigest()
        if key not in seen:
            seen.add(key)
            unique.append(ex)
    return unique


def main():
    from datasets import load_dataset

    random.seed(42)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    all_examples = []

    # 1. Capybara — multi-turn, reasoning-heavy
    print("Downloading Capybara (LDJnr/Capybara)...")
    try:
        capybara_ds = load_dataset("LDJnr/Capybara", split="train")
        print(f"  Loaded {len(capybara_ds)} examples")
        capybara_convs = convert_capybara(capybara_ds, CAPYBARA_TARGET)
        print(f"  Converted {len(capybara_convs)} (target: {CAPYBARA_TARGET})")
        all_examples.extend(capybara_convs)
    except Exception as e:
        print(f"  ERROR downloading Capybara: {e}")

    # 2. SlimOrca — high-quality instruction following
    print("\nDownloading SlimOrca (Open-Orca/SlimOrca)...")
    try:
        slimorca_ds = load_dataset("Open-Orca/SlimOrca", split="train")
        print(f"  Loaded {len(slimorca_ds)} examples")
        slimorca_convs = convert_slimorca(slimorca_ds, SLIMORCA_TARGET)
        print(f"  Converted {len(slimorca_convs)} (target: {SLIMORCA_TARGET})")
        all_examples.extend(slimorca_convs)
    except Exception as e:
        print(f"  ERROR downloading SlimOrca: {e}")

    # 3. UltraChat 200K — multi-turn conversation
    print("\nDownloading UltraChat 200K (HuggingFaceH4/ultrachat_200k)...")
    try:
        ultrachat_ds = load_dataset("HuggingFaceH4/ultrachat_200k", split="train_sft")
        print(f"  Loaded {len(ultrachat_ds)} examples")
        ultrachat_convs = convert_ultrachat(ultrachat_ds, ULTRACHAT_TARGET)
        print(f"  Converted {len(ultrachat_convs)} (target: {ULTRACHAT_TARGET})")
        all_examples.extend(ultrachat_convs)
    except Exception as e:
        print(f"  ERROR downloading UltraChat: {e}")

    # Dedup and shuffle
    print(f"\nTotal before dedup: {len(all_examples)}")
    all_examples = dedup(all_examples)
    print(f"Total after dedup: {len(all_examples)}")
    random.shuffle(all_examples)

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    print(f"\nSaved {len(all_examples)} examples to {OUTPUT_FILE}")

    # Stats
    total_turns = sum(len(ex["conversations"]) for ex in all_examples)
    avg_turns = total_turns / len(all_examples) if all_examples else 0
    print(f"Average turns per conversation: {avg_turns:.1f}")


if __name__ == "__main__":
    main()
