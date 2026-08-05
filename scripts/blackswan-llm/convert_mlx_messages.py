#!/usr/bin/env python3
"""
Convert BlackSwan ShareGPT JSONL shards into the OpenAI-style `messages`
format expected by current mlx-lm LoRA training.

Input:
  training_data/train_v4.jsonl
  training_data/eval_v4.jsonl

Output:
  training_data/mlx_messages/train.jsonl
  training_data/mlx_messages/valid.jsonl
"""

import json
from pathlib import Path


DATA_DIR = Path(__file__).parent / "training_data"
OUTPUT_DIR = DATA_DIR / "mlx_messages"
ROLE_MAP = {
    "system": "system",
    "human": "user",
    "gpt": "assistant",
    "user": "user",
    "assistant": "assistant",
}


def convert_file(source_name: str, output_name: str) -> int:
    source = DATA_DIR / source_name
    output = OUTPUT_DIR / output_name
    count = 0

    if not source.exists():
        raise FileNotFoundError(f"Missing source shard: {source}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with source.open() as fin, output.open("w") as fout:
        for line_num, line in enumerate(fin, 1):
            if not line.strip():
                continue
            obj = json.loads(line)
            messages = []
            for turn in obj.get("conversations", []):
                role = ROLE_MAP.get(turn.get("from"), turn.get("from"))
                content = turn.get("value", "")
                if role and content:
                    messages.append({"role": role, "content": content})
            if not messages:
                raise ValueError(f"No messages produced for {source}:{line_num}")
            fout.write(json.dumps({"messages": messages}, ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> None:
    train_count = convert_file("train_v4.jsonl", "train.jsonl")
    valid_count = convert_file("eval_v4.jsonl", "valid.jsonl")
    print(f"Wrote {OUTPUT_DIR / 'train.jsonl'} ({train_count} examples)")
    print(f"Wrote {OUTPUT_DIR / 'valid.jsonl'} ({valid_count} examples)")


if __name__ == "__main__":
    main()
