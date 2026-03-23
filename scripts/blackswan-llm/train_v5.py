#!/usr/bin/env python3
"""
BlackSwan LLM v5 — Qwen3-32B with thinking mode + tool calling
Fine-tune on 50K+ examples (43K v4 + new tool-use + core domain data).

Why Qwen3-32B instead of Qwen3.5-27B:
  - Standard transformer arch → QLoRA works reliably (3.5's hybrid DeltaNet doesn't)
  - Same 151K vocab as v3/v4 → no tokenizer breaking changes
  - /think and /no_think soft switching → fast answers AND deep reasoning
  - 32K context native → plenty for circle activity
  - Community-proven fine-tuning results

Architecture:
  - Base: Qwen3-32B (dense, Apache 2.0)
  - QLoRA: rank 96, alpha 192, 4-bit quantization
  - Target: all-linear (covers all projection layers)
  - Training: 1 epoch, batch 1, grad_accum 16 (effective 16)
  - Thinking mode: 75% examples with <think> blocks
  - Export: GGUF Q4_K_M for Ollama deployment

Requirements:
  - 24GB+ VRAM for QLoRA (RTX 3090/4090, A100)
  - Unsloth >= 2025.6 with Qwen3 support
  - transformers >= 4.52

Usage:
  python train_v5.py [--epochs 1] [--lr 5e-5] [--batch 1]
  python train_v5.py --base-model unsloth/Qwen3-8B-bnb-4bit  # smaller fallback
"""

import json
import argparse
import platform
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

BASE_MODEL = "unsloth/Qwen3-32B-bnb-4bit"
MAX_SEQ_LENGTH = 4096
LORA_RANK = 96       # Higher rank for 32B model — more capacity
LORA_ALPHA = 192     # 2:1 ratio (alpha = rank * 2)
LORA_DROPOUT = 0
NEFTUNE_ALPHA = 5

DATA_DIR = Path(__file__).parent / "training_data"
TRAIN_FILE = DATA_DIR / "train_v5.jsonl"    # Combined: v4 + tool-use + core domain
TRAIN_FILE_FALLBACK = DATA_DIR / "train_v4.jsonl"  # Fall back to v4 if v5 not ready
EVAL_FILE = DATA_DIR / "eval_v4.jsonl"
OUTPUT_DIR = Path(__file__).parent / "models" / "v5"


def main():
    parser = argparse.ArgumentParser(description="Fine-tune BlackSwan LLM v5 (Qwen3-32B)")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--batch", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--warmup-ratio", type=float, default=0.05)
    parser.add_argument("--neftune", type=float, default=NEFTUNE_ALPHA)
    parser.add_argument("--skip-merge", action="store_true")
    parser.add_argument("--skip-gguf", action="store_true")
    parser.add_argument("--base-model", type=str, default=BASE_MODEL,
                        help="Override base model (e.g. unsloth/Qwen3-8B-bnb-4bit for smaller)")
    parser.add_argument("--no-think", action="store_true",
                        help="Disable thinking mode in training data")
    args = parser.parse_args()

    is_mac = platform.system() == "Darwin"
    if is_mac:
        print("Detected Apple Silicon Mac — using MPS backend")
        print("  Requires 48GB+ unified memory for 32B QLoRA")

    print("Loading libraries...")
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    base_model = args.base_model
    print(f"\nLoading {base_model}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules="all-linear",  # Covers all projection layers in Qwen3
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    # Qwen3 chat template (supports thinking mode with <think> blocks)
    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

    # Verify EOS token is correct for Qwen3
    print(f"  EOS token: {tokenizer.eos_token} (id: {tokenizer.eos_token_id})")
    print(f"  Vocab size: {len(tokenizer)}")

    # ─── Load dataset ────────────────────────────────────────────────────────
    print("\nLoading training data...")

    train_file = TRAIN_FILE if TRAIN_FILE.exists() else TRAIN_FILE_FALLBACK
    if not train_file.exists():
        print(f"ERROR: No training data found at {TRAIN_FILE} or {TRAIN_FILE_FALLBACK}")
        return

    print(f"  Using: {train_file.name}")

    def load_sharegpt(path):
        conversations = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                convs = obj.get("conversations", [])
                messages = []
                for turn in convs:
                    role_map = {"system": "system", "human": "user", "gpt": "assistant"}
                    role = role_map.get(turn["from"], turn["from"])
                    content = turn["value"]

                    # For Qwen3: strip thinking blocks if --no-think
                    if args.no_think and role == "assistant":
                        import re
                        content = re.sub(r'<think>.*?</think>\s*', '', content, flags=re.DOTALL)

                    messages.append({"role": role, "content": content})
                conversations.append({"messages": messages})
        return conversations

    train_data = load_sharegpt(train_file)
    print(f"  Train examples: {len(train_data)}")

    # Count thinking examples
    think_count = sum(1 for d in train_data
                      if any(m.get("content", "").startswith("<think>") for m in d["messages"]
                             if m["role"] == "assistant"))
    print(f"  Examples with <think> blocks: {think_count} ({think_count/max(len(train_data),1)*100:.1f}%)")

    eval_data = []
    if EVAL_FILE.exists():
        eval_data = load_sharegpt(EVAL_FILE)
        print(f"  Eval examples: {len(eval_data)}")

    def apply_template(item):
        text = tokenizer.apply_chat_template(
            item["messages"], tokenize=False, add_generation_prompt=False,
        )
        return {"text": text}

    train_texts = [apply_template(d) for d in train_data]
    eval_texts = [apply_template(d) for d in eval_data] if eval_data else []

    train_dataset = Dataset.from_list(train_texts)
    eval_dataset = Dataset.from_list(eval_texts) if eval_texts else None

    print(f"  Sample text length: {len(train_texts[0]['text'])} chars")

    # ─── Training ────────────────────────────────────────────────────────────
    effective_batch = args.batch * args.grad_accum
    total_steps = (len(train_data) // effective_batch) * args.epochs
    print(f"\nTraining config (v5 — BlackSwan Full, Qwen3-32B):")
    print(f"  Base model: {base_model}")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch: {args.batch} x {args.grad_accum} grad accum = {effective_batch} effective")
    print(f"  Learning rate: {args.lr}")
    print(f"  LoRA rank: {LORA_RANK}, alpha: {LORA_ALPHA}")
    print(f"  Target modules: all-linear")
    print(f"  Max seq length: {MAX_SEQ_LENGTH}")
    print(f"  NEFTune alpha: {args.neftune}")
    print(f"  Thinking mode: {'disabled' if args.no_think else 'enabled (~75% examples)'}")
    print(f"  Estimated steps: {total_steps}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lora_dir = OUTPUT_DIR / "lora"

    training_args = TrainingArguments(
        output_dir=str(lora_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=args.warmup_ratio,
        weight_decay=0.01,
        bf16=True,
        logging_steps=25,
        save_strategy="epoch",
        eval_strategy="epoch" if eval_dataset else "no",
        save_total_limit=2,
        seed=42,
        report_to="none",
    )

    trainer_kwargs = dict(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        args=training_args,
        max_seq_length=MAX_SEQ_LENGTH,
        packing=True,
        dataset_text_field="text",
    )
    if args.neftune > 0:
        trainer_kwargs["neftune_noise_alpha"] = args.neftune

    trainer = SFTTrainer(**trainer_kwargs)

    print("\nStarting v5 training (BlackSwan Full — Qwen3-32B)...")
    print("  Estimated time: 12-24h on A100-40GB, 6-10h on A100-80GB\n")
    train_result = trainer.train()

    print(f"\nTraining complete!")
    print(f"  Loss: {train_result.training_loss:.4f}")
    print(f"  Runtime: {train_result.metrics.get('train_runtime', 0):.0f}s")
    print(f"  Samples/sec: {train_result.metrics.get('train_samples_per_second', 0):.1f}")

    model.save_pretrained(str(lora_dir))
    tokenizer.save_pretrained(str(lora_dir))
    print(f"\nLoRA adapters saved to {lora_dir}")

    # ─── Export GGUF ─────────────────────────────────────────────────────────
    if not args.skip_gguf:
        print("\nExporting GGUF (Q4_K_M)...")
        gguf_dir = OUTPUT_DIR / "gguf"
        gguf_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained_gguf(str(gguf_dir), tokenizer, quantization_method="q4_k_m")
        print(f"GGUF saved to {gguf_dir}")

    if not args.skip_merge:
        print("\nExporting merged 16-bit model...")
        merged_dir = OUTPUT_DIR / "merged"
        merged_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained_merged(str(merged_dir), tokenizer, save_method="merged_16bit")
        print(f"Merged model saved to {merged_dir}")

    # ─── Save training metadata ──────────────────────────────────────────────
    meta = {
        "version": "v5",
        "base_model": base_model,
        "lora_rank": LORA_RANK,
        "lora_alpha": LORA_ALPHA,
        "target_modules": "all-linear",
        "max_seq_length": MAX_SEQ_LENGTH,
        "epochs": args.epochs,
        "lr": args.lr,
        "batch_size": args.batch,
        "grad_accum": args.grad_accum,
        "effective_batch": effective_batch,
        "neftune_alpha": args.neftune,
        "thinking_mode": not args.no_think,
        "train_examples": len(train_data),
        "train_file": str(train_file.name),
        "final_loss": train_result.training_loss,
        "runtime_seconds": train_result.metrics.get("train_runtime", 0),
    }
    meta_path = OUTPUT_DIR / "training_meta.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  Metadata saved to {meta_path}")

    print("\nAll v5 exports complete!")
    print(f"  LoRA:   {lora_dir}")
    if not args.skip_gguf:
        print(f"  GGUF:   {OUTPUT_DIR / 'gguf'}")
    if not args.skip_merge:
        print(f"  Merged: {OUTPUT_DIR / 'merged'}")


if __name__ == "__main__":
    main()
