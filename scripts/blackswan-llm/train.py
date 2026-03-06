#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 2: Fine-tune Qwen2.5-7B-Instruct with QLoRA via Unsloth.

Designed to run on Google Colab free tier (T4 16GB).
Reads training_data/train.jsonl (ShareGPT format) and produces:
  - models/v1.0/lora/       (LoRA adapters)
  - models/v1.0/gguf/       (Q4_K_M quantized for Ollama)
  - models/v1.0/merged/     (full merged 16-bit for vLLM)

Usage (Colab):
  !pip install unsloth[colab-new]
  !python train.py

Usage (local with GPU):
  python train.py [--epochs 3] [--lr 2e-4] [--batch 2]
"""

import json
import argparse
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

BASE_MODEL = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"
MAX_SEQ_LENGTH = 4096
LORA_RANK = 32
LORA_ALPHA = 64
LORA_DROPOUT = 0
NEFTUNE_ALPHA = 5  # Free 10-35% instruction-following improvement

DATA_DIR = Path(__file__).parent / "training_data"
TRAIN_FILE = DATA_DIR / "train.jsonl"
EVAL_FILE = DATA_DIR / "eval.jsonl"
OUTPUT_DIR = Path(__file__).parent / "models" / "v1.0"


def main():
    parser = argparse.ArgumentParser(description="Fine-tune BlackSwan LLM")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--batch", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--warmup-ratio", type=float, default=0.03)
    parser.add_argument("--neftune", type=float, default=NEFTUNE_ALPHA, help="NEFTune noise alpha (0 to disable)")
    parser.add_argument("--skip-merge", action="store_true", help="Skip full merge (saves time/VRAM)")
    parser.add_argument("--skip-gguf", action="store_true", help="Skip GGUF export")
    args = parser.parse_args()

    # ─── Imports (heavy, so inside main) ─────────────────────────────────────
    print("Loading libraries...")
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    # ─── Load model ──────────────────────────────────────────────────────────
    print(f"\nLoading {BASE_MODEL}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,  # auto-detect
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    # Apply Qwen2.5 chat template
    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

    # ─── Load dataset ────────────────────────────────────────────────────────
    print("\nLoading training data...")

    def load_sharegpt(path):
        """Load ShareGPT JSONL and convert to dataset format."""
        conversations = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                convs = obj.get("conversations", [])
                # Convert ShareGPT format to messages format
                messages = []
                for turn in convs:
                    role_map = {"system": "system", "human": "user", "gpt": "assistant"}
                    role = role_map.get(turn["from"], turn["from"])
                    messages.append({"role": role, "content": turn["value"]})
                conversations.append({"messages": messages})
        return conversations

    train_data = load_sharegpt(TRAIN_FILE)
    print(f"  Train examples: {len(train_data)}")

    eval_data = []
    if EVAL_FILE.exists():
        eval_data = load_sharegpt(EVAL_FILE)
        print(f"  Eval examples: {len(eval_data)}")

    # Pre-apply chat template to create "text" column
    def apply_template(item):
        text = tokenizer.apply_chat_template(
            item["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    train_texts = [apply_template(d) for d in train_data]
    eval_texts = [apply_template(d) for d in eval_data] if eval_data else []

    train_dataset = Dataset.from_list(train_texts)
    eval_dataset = Dataset.from_list(eval_texts) if eval_texts else None

    print(f"  Sample text length: {len(train_texts[0]['text'])} chars")

    # ─── Training ────────────────────────────────────────────────────────────
    print(f"\nTraining config:")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch size: {args.batch} (x {args.grad_accum} grad accum = {args.batch * args.grad_accum} effective)")
    print(f"  Learning rate: {args.lr}")
    print(f"  LoRA rank: {LORA_RANK}, alpha: {LORA_ALPHA}")
    print(f"  Max seq length: {MAX_SEQ_LENGTH}")
    print(f"  NEFTune alpha: {args.neftune}")

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
        logging_steps=10,
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

    print("\nStarting training...")
    train_result = trainer.train()

    print(f"\nTraining complete!")
    print(f"  Loss: {train_result.training_loss:.4f}")
    print(f"  Runtime: {train_result.metrics.get('train_runtime', 0):.0f}s")
    print(f"  Samples/sec: {train_result.metrics.get('train_samples_per_second', 0):.1f}")

    # Save LoRA adapters
    model.save_pretrained(str(lora_dir))
    tokenizer.save_pretrained(str(lora_dir))
    print(f"\nLoRA adapters saved to {lora_dir}")

    # ─── Export GGUF ─────────────────────────────────────────────────────────
    if not args.skip_gguf:
        print("\nExporting GGUF (Q4_K_M)...")
        gguf_dir = OUTPUT_DIR / "gguf"
        gguf_dir.mkdir(parents=True, exist_ok=True)

        model.save_pretrained_gguf(
            str(gguf_dir),
            tokenizer,
            quantization_method="q4_k_m",
        )
        print(f"GGUF saved to {gguf_dir}")

    # ─── Export merged 16-bit ────────────────────────────────────────────────
    if not args.skip_merge:
        print("\nExporting merged 16-bit model...")
        merged_dir = OUTPUT_DIR / "merged"
        merged_dir.mkdir(parents=True, exist_ok=True)

        model.save_pretrained_merged(
            str(merged_dir),
            tokenizer,
            save_method="merged_16bit",
        )
        print(f"Merged model saved to {merged_dir}")

    print("\n✅ All exports complete!")
    print(f"  LoRA:   {lora_dir}")
    if not args.skip_gguf:
        print(f"  GGUF:   {OUTPUT_DIR / 'gguf'}")
    if not args.skip_merge:
        print(f"  Merged: {OUTPUT_DIR / 'merged'}")


if __name__ == "__main__":
    main()
