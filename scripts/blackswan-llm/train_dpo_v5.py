#!/usr/bin/env python3
"""
BlackSwan LLM v5 — DPO alignment for the 27B model.

Loads from v5 SFT checkpoint and applies DPO preference alignment.
Uses all ~7K DPO samples with max_length 2048.

Usage:
  python train_dpo_v5.py [--epochs 1] [--lr 5e-5]
"""

import json
import argparse
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
DPO_TRAIN_FILE = DATA_DIR / "dpo_train.jsonl"
DPO_EVAL_FILE = DATA_DIR / "dpo_eval.jsonl"
OUTPUT_DIR = Path(__file__).parent / "models" / "v5"
SFT_LORA_DIR = OUTPUT_DIR / "lora"

MAX_SEQ_LENGTH = 2048
LORA_RANK = 64
LORA_ALPHA = 128


def main():
    parser = argparse.ArgumentParser(description="DPO alignment for BlackSwan LLM v5 (27B)")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--batch", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--max-samples", type=int, default=0, help="Max training samples (0=all)")
    args = parser.parse_args()

    print("Loading libraries...")
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import Dataset
    from trl import DPOTrainer, DPOConfig

    print(f"\nLoading SFT model from {SFT_LORA_DIR}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(SFT_LORA_DIR),
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=0,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    print("\nLoading DPO data...")

    def load_dpo(path):
        items = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                items.append({
                    "prompt": obj["prompt"],
                    "chosen": obj["chosen"],
                    "rejected": obj["rejected"],
                })
        return items

    train_data = load_dpo(DPO_TRAIN_FILE)
    if args.max_samples > 0 and len(train_data) > args.max_samples:
        import random
        random.seed(42)
        random.shuffle(train_data)
        train_data = train_data[:args.max_samples]
    print(f"  DPO train: {len(train_data)}")
    train_dataset = Dataset.from_list(train_data)

    eval_dataset = None
    if DPO_EVAL_FILE.exists():
        eval_data = load_dpo(DPO_EVAL_FILE)
        eval_dataset = Dataset.from_list(eval_data)
        print(f"  DPO eval: {len(eval_data)}")

    dpo_dir = OUTPUT_DIR / "dpo"
    dpo_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nDPO config (v5 — BlackSwan Full 27B):")
    print(f"  Epochs: {args.epochs}")
    print(f"  LR: {args.lr}, Beta: {args.beta}")
    print(f"  Effective batch: {args.batch * args.grad_accum}")
    print(f"  Max seq length: {MAX_SEQ_LENGTH}")
    print(f"  LoRA rank: {LORA_RANK}")

    dpo_config = DPOConfig(
        output_dir=str(dpo_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        weight_decay=0.01,
        bf16=True,
        logging_steps=10,
        save_strategy="epoch",
        eval_strategy="epoch" if eval_dataset else "no",
        save_total_limit=1,
        seed=42,
        report_to="none",
        beta=args.beta,
        max_length=MAX_SEQ_LENGTH,
        max_prompt_length=MAX_SEQ_LENGTH // 2,
    )

    trainer = DPOTrainer(
        model=model,
        ref_model=None,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        args=dpo_config,
    )

    print("\nStarting DPO training (v5 — 27B)...")
    result = trainer.train()

    print(f"\nDPO complete!")
    print(f"  Loss: {result.training_loss:.4f}")
    print(f"  Runtime: {result.metrics.get('train_runtime', 0):.0f}s")

    model.save_pretrained(str(dpo_dir))
    tokenizer.save_pretrained(str(dpo_dir))
    print(f"\nDPO model saved to {dpo_dir}")

    # Export final GGUF for Ollama
    print("\nExporting final GGUF (Q4_K_M) with DPO alignment...")
    gguf_dir = OUTPUT_DIR / "gguf_dpo"
    gguf_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained_gguf(str(gguf_dir), tokenizer, quantization_method="q4_k_m")
    print(f"Final GGUF saved to {gguf_dir}")


if __name__ == "__main__":
    main()
