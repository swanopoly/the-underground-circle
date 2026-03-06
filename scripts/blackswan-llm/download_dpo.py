#!/usr/bin/env python3
"""
Download and prepare DPO preference data from argilla/dpo-mix-7k.

Converts to simple prompt/chosen/rejected format for DPO training.
Output: training_data/dpo_train.jsonl, training_data/dpo_eval.jsonl
"""

import json
import random
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
DPO_TRAIN_FILE = DATA_DIR / "dpo_train.jsonl"
DPO_EVAL_FILE = DATA_DIR / "dpo_eval.jsonl"

TARGET = 7000  # Use all ~7K from dpo-mix-7k
EVAL_RATIO = 0.1


def main():
    from datasets import load_dataset

    random.seed(42)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Downloading argilla/dpo-mix-7k...")
    ds = load_dataset("argilla/dpo-mix-7k", split="train")
    print(f"  Loaded {len(ds)} examples")

    results = []
    for row in ds:
        chosen = row.get("chosen", [])
        rejected = row.get("rejected", [])

        if not chosen or not rejected:
            continue

        # Extract prompt from chosen conversation (all turns before last assistant)
        prompt_parts = []
        chosen_response = ""
        for msg in chosen:
            if msg["role"] == "assistant" and msg == chosen[-1]:
                chosen_response = msg["content"]
            else:
                prompt_parts.append(msg)

        rejected_response = ""
        for msg in rejected:
            if msg["role"] == "assistant" and msg == rejected[-1]:
                rejected_response = msg["content"]

        if not chosen_response or not rejected_response or not prompt_parts:
            continue

        # Format prompt as the conversation history
        prompt = ""
        for msg in prompt_parts:
            if msg["role"] == "user":
                prompt += f"User: {msg['content']}\n"
            elif msg["role"] == "system":
                prompt += f"System: {msg['content']}\n"
            elif msg["role"] == "assistant":
                prompt += f"Assistant: {msg['content']}\n"
        prompt = prompt.strip()

        if len(prompt) < 10 or len(chosen_response) < 10:
            continue

        results.append({
            "prompt": prompt,
            "chosen": chosen_response,
            "rejected": rejected_response,
        })

    print(f"  Converted {len(results)} preference pairs")

    # Shuffle and split
    random.shuffle(results)
    eval_count = max(10, int(len(results) * EVAL_RATIO))
    eval_set = results[:eval_count]
    train_set = results[eval_count:]

    # Write
    with open(DPO_TRAIN_FILE, "w") as f:
        for item in train_set:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(DPO_EVAL_FILE, "w") as f:
        for item in eval_set:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    print(f"\nSaved:")
    print(f"  {DPO_TRAIN_FILE} ({len(train_set)} pairs)")
    print(f"  {DPO_EVAL_FILE} ({len(eval_set)} pairs)")


if __name__ == "__main__":
    main()
