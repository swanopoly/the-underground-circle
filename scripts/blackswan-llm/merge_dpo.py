#!/usr/bin/env python3
"""Merge DPO LoRA adapters into base model for GGUF export."""
import sys
from pathlib import Path

DPO_DIR = Path(__file__).parent / "models" / "v1.0" / "dpo"
MERGED_DIR = Path(__file__).parent / "models" / "v1.0" / "merged"

print("Loading libraries...")
from unsloth import FastLanguageModel

print(f"Loading DPO model from {DPO_DIR}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=str(DPO_DIR),
    max_seq_length=4096,
    dtype=None,
    load_in_4bit=True,
)

print(f"Merging and saving to {MERGED_DIR}...")
MERGED_DIR.mkdir(parents=True, exist_ok=True)
model.save_pretrained_merged(
    str(MERGED_DIR),
    tokenizer,
    save_method="merged_16bit",
)
print("Merge complete!")
