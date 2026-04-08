#!/usr/bin/env python3
"""
Upload BlackSwan GGUF to HuggingFace Hub.

Uploads all GGUF files from the v5 training output directory to a
HuggingFace model repository. Optionally generates a model card.

Usage:
  python upload_to_hf.py --repo swanopoly/BlackSwan-v5-GGUF --token hf_...
  python upload_to_hf.py --repo swanopoly/BlackSwan-v5-GGUF  # uses HF_TOKEN env
  python upload_to_hf.py --repo swanopoly/BlackSwan-v5-GGUF --readme  # include model card
"""

import argparse
import os
from pathlib import Path

from huggingface_hub import HfApi

GGUF_DIRS = [
    Path(__file__).parent / "models" / "v5" / "gguf_dpo",
    Path(__file__).parent / "models" / "v5" / "gguf",
]

MODEL_CARD = """---
tags:
- blackswan
- qwen3.5
- gguf
- fine-tuned
- lora
- accountability
license: apache-2.0
base_model: Qwen/Qwen3.5-9B
pipeline_tag: text-generation
language:
- en
---

# BlackSwan LLM v5 (GGUF)

Fine-tuned **Qwen3.5-9B** with bf16 LoRA using [Unsloth](https://unsloth.ai).

- **Training:** 43K examples (SFT) + 6.3K preference pairs (DPO alignment)
- **Method:** bf16 LoRA (rank 16, alpha 16) — NOT QLoRA (per Unsloth guidance for Qwen3.5)
- **Export:** GGUF Q4_K_M quantization

## What is BlackSwan?

BlackSwan is the AI accountability partner for [The Underground Circle](https://app.chrisswanson.xyz) — a shared AI agent platform for dev teams. It watches your GitHub repo, tracks who's shipping, and keeps your team honest.

## Usage

### HuggingFace Inference Endpoints
Deploy this GGUF on a T4 GPU ($0.50/hr) with scale-to-zero. The llama.cpp backend is auto-selected, providing an OpenAI-compatible `/v1/chat/completions` API.

### Ollama
```bash
ollama run hf.co/{repo_id}
```

### llama.cpp
```bash
llama-cli -hf {repo_id}
```

## Training Data
| Dataset | Count | Purpose |
|---------|-------|---------|
| CodeAlpaca | 8K | Code instructions |
| Evol-Instruct-Code | 7K | Evolved code problems |
| OpenHermes 2.5 | 10K | General knowledge |
| Capybara | 5K | Multi-turn conversation |
| SlimOrca | 5K | Instruction following |
| UltraChat | 3K | Conversation fluency |
| GSM8K | 3K | Math reasoning |
| MathInstruct | 2K | Math problems |
| BlackSwan synthetic | ~1K | Domain-specific |
"""


def main():
    parser = argparse.ArgumentParser(description="Upload BlackSwan GGUF to HuggingFace Hub")
    parser.add_argument("--repo", required=True, help="HF repo ID (e.g. swanopoly/BlackSwan-v5-GGUF)")
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN", ""),
                        help="HuggingFace API token (or set HF_TOKEN env var)")
    parser.add_argument("--readme", action="store_true", help="Also upload a model card README.md")
    args = parser.parse_args()

    if not args.token:
        print("ERROR: No HF token provided. Use --token or set HF_TOKEN env var.")
        print("  Get a token at: https://huggingface.co/settings/tokens")
        return

    api = HfApi(token=args.token)

    print(f"Creating/verifying repo: {args.repo}")
    api.create_repo(args.repo, exist_ok=True, repo_type="model")

    uploaded = 0
    for d in GGUF_DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.gguf")):
            size_gb = f.stat().st_size / 1e9
            print(f"Uploading {f.name} ({size_gb:.1f} GB)...")
            api.upload_file(
                path_or_fileobj=str(f),
                path_in_repo=f.name,
                repo_id=args.repo,
            )
            uploaded += 1

    if uploaded == 0:
        print("No GGUF files found in:")
        for d in GGUF_DIRS:
            print(f"  {d}")
        print("Run training first: bash run_v5_pipeline.sh")
        return

    if args.readme:
        print("Uploading model card...")
        card = MODEL_CARD.replace("{repo_id}", args.repo)
        api.upload_file(
            path_or_fileobj=card.encode("utf-8"),
            path_in_repo="README.md",
            repo_id=args.repo,
        )

    print(f"\nDone! {uploaded} file(s) uploaded.")
    print(f"  https://huggingface.co/{args.repo}")


if __name__ == "__main__":
    main()
