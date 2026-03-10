#!/usr/bin/env python3
"""
BlackSwan LLM v4 — Download expanded training datasets.

Major upgrades from v3:
  - Coding: CodeAlpaca (8K) + Evol-Instruct-Code (7K) = 15K coding examples
  - Math/Reasoning: GSM8K (3K) + MathInstruct (2K) = 5K reasoning examples
  - General Knowledge: OpenHermes-2.5 (10K) — strongest open instruction set
  - Conversation: Capybara (5K) + SlimOrca (5K) + UltraChat (3K) = 13K (kept/expanded)

Total target: ~43K public examples (vs 12K in v3)

Output: training_data/public_curated_v4.jsonl
"""

import json
import random
import hashlib
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
OUTPUT_FILE = DATA_DIR / "public_curated_v4.jsonl"

# ─── Targets ──────────────────────────────────────────────────────────────────

CAPYBARA_TARGET = 5000
SLIMORCA_TARGET = 5000
ULTRACHAT_TARGET = 3000
OPENHERMES_TARGET = 10000
CODE_ALPACA_TARGET = 8000
EVOL_CODE_TARGET = 7000
GSM8K_TARGET = 3000
MATHINSTRUCT_TARGET = 2000

MIN_RESPONSE_CHARS = 50
MAX_RESPONSE_CHARS = 12000  # Increased for code examples
MIN_TURNS = 2

BLACKSWAN_SYSTEM = "You are BlackSwan, a knowledgeable AI assistant. Provide helpful, detailed, and thoughtful responses."
BLACKSWAN_CODE_SYSTEM = "You are BlackSwan, a knowledgeable AI coding assistant. Provide clear, correct, and well-explained code solutions."
BLACKSWAN_MATH_SYSTEM = "You are BlackSwan, a knowledgeable AI assistant. Solve problems step by step with clear reasoning."


# ─── Converters ───────────────────────────────────────────────────────────────

def convert_capybara(dataset, target: int) -> list[dict]:
    """Capybara: multi-turn with input/output fields."""
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)
    for idx in indices:
        if len(results) >= target:
            break
        row = dataset[idx]
        conv = row.get("conversation", [])
        if not conv:
            continue
        turns = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
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
        if valid and len(turns) >= MIN_TURNS + 1:
            results.append({"conversations": turns})
    return results


def convert_slimorca(dataset, target: int) -> list[dict]:
    """SlimOrca: ShareGPT-like format."""
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
                turns.append({"from": "system", "value": BLACKSWAN_SYSTEM})
            elif role == "human":
                turns.append({"from": "human", "value": content})
            elif role == "gpt":
                if len(content) < MIN_RESPONSE_CHARS or len(content) > MAX_RESPONSE_CHARS:
                    valid = False
                    break
                turns.append({"from": "gpt", "value": content})
        if not has_system:
            turns.insert(0, {"from": "system", "value": BLACKSWAN_SYSTEM})
        if valid and len([t for t in turns if t["from"] in ("human", "gpt")]) >= MIN_TURNS:
            results.append({"conversations": turns})
    return results


def convert_ultrachat(dataset, target: int) -> list[dict]:
    """UltraChat 200K: messages with role/content."""
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
        turns = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
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


def convert_openhermes(dataset, target: int) -> list[dict]:
    """OpenHermes 2.5: conversations field with from/value pairs."""
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
                # Keep original system prompt if substantive, otherwise use BlackSwan
                if len(content) > 20:
                    turns.append({"from": "system", "value": content})
                else:
                    turns.append({"from": "system", "value": BLACKSWAN_SYSTEM})
            elif role == "human":
                turns.append({"from": "human", "value": content})
            elif role == "gpt":
                if len(content) < MIN_RESPONSE_CHARS or len(content) > MAX_RESPONSE_CHARS:
                    valid = False
                    break
                turns.append({"from": "gpt", "value": content})
        if not has_system:
            turns.insert(0, {"from": "system", "value": BLACKSWAN_SYSTEM})
        if valid and len([t for t in turns if t["from"] in ("human", "gpt")]) >= MIN_TURNS:
            results.append({"conversations": turns})
    return results


def convert_code_alpaca(dataset, target: int) -> list[dict]:
    """CodeAlpaca: instruction/input/output format."""
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)
    for idx in indices:
        if len(results) >= target:
            break
        row = dataset[idx]
        instruction = (row.get("instruction", "") or "").strip()
        inp = (row.get("input", "") or "").strip()
        output = (row.get("output", "") or "").strip()
        if not instruction or not output:
            continue
        if len(output) < 20 or len(output) > MAX_RESPONSE_CHARS:
            continue
        # Combine instruction + input as the human message
        human_msg = instruction
        if inp:
            human_msg += f"\n\n{inp}"
        results.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_CODE_SYSTEM},
                {"from": "human", "value": human_msg},
                {"from": "gpt", "value": output},
            ]
        })
    return results


def convert_evol_instruct_code(dataset, target: int) -> list[dict]:
    """Evol-Instruct-Code: instruction/output pairs."""
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)
    for idx in indices:
        if len(results) >= target:
            break
        row = dataset[idx]
        instruction = (row.get("instruction", "") or "").strip()
        output = (row.get("output", "") or "").strip()
        if not instruction or not output:
            continue
        if len(output) < 30 or len(output) > MAX_RESPONSE_CHARS:
            continue
        results.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_CODE_SYSTEM},
                {"from": "human", "value": instruction},
                {"from": "gpt", "value": output},
            ]
        })
    return results


def convert_gsm8k(dataset, target: int) -> list[dict]:
    """GSM8K: question/answer math problems with chain-of-thought."""
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)
    for idx in indices:
        if len(results) >= target:
            break
        row = dataset[idx]
        question = (row.get("question", "") or "").strip()
        answer = (row.get("answer", "") or "").strip()
        if not question or not answer:
            continue
        if len(answer) < 20:
            continue
        results.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_MATH_SYSTEM},
                {"from": "human", "value": question},
                {"from": "gpt", "value": answer},
            ]
        })
    return results


def convert_mathinstruct(dataset, target: int) -> list[dict]:
    """MathInstruct: instruction/output with chain-of-thought reasoning."""
    results = []
    indices = list(range(len(dataset)))
    random.shuffle(indices)
    for idx in indices:
        if len(results) >= target:
            break
        row = dataset[idx]
        instruction = (row.get("instruction", "") or "").strip()
        output = (row.get("output", "") or "").strip()
        if not instruction or not output:
            continue
        if len(output) < 30 or len(output) > MAX_RESPONSE_CHARS:
            continue
        results.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_MATH_SYSTEM},
                {"from": "human", "value": instruction},
                {"from": "gpt", "value": output},
            ]
        })
    return results


# ─── Dedup ────────────────────────────────────────────────────────────────────

def dedup(examples: list[dict]) -> list[dict]:
    """Remove near-duplicates by hashing the human turns."""
    seen = set()
    unique = []
    for ex in examples:
        human_turns = [t["value"] for t in ex["conversations"] if t["from"] == "human"]
        key = hashlib.md5("".join(human_turns).encode()).hexdigest()
        if key not in seen:
            seen.add(key)
            unique.append(ex)
    return unique


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    from datasets import load_dataset

    random.seed(42)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    all_examples = []

    # ── 1. Capybara (multi-turn, reasoning) ──
    print("1/8  Downloading Capybara (LDJnr/Capybara)...")
    try:
        ds = load_dataset("LDJnr/Capybara", split="train")
        print(f"     Loaded {len(ds)} → target {CAPYBARA_TARGET}")
        convs = convert_capybara(ds, CAPYBARA_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 2. SlimOrca (instruction following) ──
    print("2/8  Downloading SlimOrca (Open-Orca/SlimOrca)...")
    try:
        ds = load_dataset("Open-Orca/SlimOrca", split="train")
        print(f"     Loaded {len(ds)} → target {SLIMORCA_TARGET}")
        convs = convert_slimorca(ds, SLIMORCA_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 3. UltraChat 200K (conversation fluency) ──
    print("3/8  Downloading UltraChat 200K (HuggingFaceH4/ultrachat_200k)...")
    try:
        ds = load_dataset("HuggingFaceH4/ultrachat_200k", split="train_sft")
        print(f"     Loaded {len(ds)} → target {ULTRACHAT_TARGET}")
        convs = convert_ultrachat(ds, ULTRACHAT_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 4. OpenHermes 2.5 (general knowledge + instruction) ──
    print("4/8  Downloading OpenHermes 2.5 (teknium/OpenHermes-2.5)...")
    try:
        ds = load_dataset("teknium/OpenHermes-2.5", split="train")
        print(f"     Loaded {len(ds)} → target {OPENHERMES_TARGET}")
        convs = convert_openhermes(ds, OPENHERMES_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 5. CodeAlpaca (code instructions) ──
    print("5/8  Downloading CodeAlpaca (sahil2801/CodeAlpaca-20k)...")
    try:
        ds = load_dataset("sahil2801/CodeAlpaca-20k", split="train")
        print(f"     Loaded {len(ds)} → target {CODE_ALPACA_TARGET}")
        convs = convert_code_alpaca(ds, CODE_ALPACA_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 6. Evol-Instruct-Code (evolved code, harder problems) ──
    print("6/8  Downloading Evol-Instruct-Code (nickrosh/Evol-Instruct-Code-80k-v1)...")
    try:
        ds = load_dataset("nickrosh/Evol-Instruct-Code-80k-v1", split="train")
        print(f"     Loaded {len(ds)} → target {EVOL_CODE_TARGET}")
        convs = convert_evol_instruct_code(ds, EVOL_CODE_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 7. GSM8K (math reasoning with chain-of-thought) ──
    print("7/8  Downloading GSM8K (openai/gsm8k)...")
    try:
        ds = load_dataset("openai/gsm8k", "main", split="train")
        print(f"     Loaded {len(ds)} → target {GSM8K_TARGET}")
        convs = convert_gsm8k(ds, GSM8K_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── 8. MathInstruct (diverse math with reasoning) ──
    print("8/8  Downloading MathInstruct (TIGER-Lab/MathInstruct)...")
    try:
        ds = load_dataset("TIGER-Lab/MathInstruct", split="train")
        print(f"     Loaded {len(ds)} → target {MATHINSTRUCT_TARGET}")
        convs = convert_mathinstruct(ds, MATHINSTRUCT_TARGET)
        print(f"     Converted: {len(convs)}")
        all_examples.extend(convs)
    except Exception as e:
        print(f"     ERROR: {e}")

    # ── Dedup and shuffle ──
    print(f"\nTotal before dedup: {len(all_examples)}")
    all_examples = dedup(all_examples)
    print(f"Total after dedup: {len(all_examples)}")
    random.shuffle(all_examples)

    # ── Write output ──
    with open(OUTPUT_FILE, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    print(f"\nSaved {len(all_examples)} examples to {OUTPUT_FILE}")

    # ── Stats breakdown ──
    code_count = sum(1 for ex in all_examples
                     if any("coding" in t["value"].lower() for t in ex["conversations"] if t["from"] == "system"))
    math_count = sum(1 for ex in all_examples
                     if any("reasoning" in t["value"].lower() or "step by step" in t["value"].lower()
                            for t in ex["conversations"] if t["from"] == "system"))
    total_turns = sum(len(ex["conversations"]) for ex in all_examples)
    avg_turns = total_turns / len(all_examples) if all_examples else 0
    print(f"\nBreakdown:")
    print(f"  Coding examples: ~{code_count}")
    print(f"  Math/reasoning: ~{math_count}")
    print(f"  General/other: ~{len(all_examples) - code_count - math_count}")
    print(f"  Average turns/conversation: {avg_turns:.1f}")


if __name__ == "__main__":
    main()
