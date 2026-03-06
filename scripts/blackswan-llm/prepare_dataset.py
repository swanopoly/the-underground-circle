#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 1D: Prepare final training dataset.

Merges real + synthetic data, applies quality filters, deduplicates,
removes PII, and splits into train/eval sets.

Usage:
  python prepare_dataset.py
"""

import json
import re
import hashlib
from pathlib import Path
from collections import Counter

DATA_DIR = Path(__file__).parent / "training_data"
REAL_FILE = DATA_DIR / "blackswan_real.jsonl"
SYNTHETIC_FILE = DATA_DIR / "blackswan_synthetic.jsonl"
MULTITURN_FILE = DATA_DIR / "blackswan_multiturn.jsonl"
PUBLIC_FILE = DATA_DIR / "public_curated.jsonl"
TRAIN_FILE = DATA_DIR / "train.jsonl"
EVAL_FILE = DATA_DIR / "eval.jsonl"
STATS_FILE = DATA_DIR / "stats.json"

# ─── PII patterns ────────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
PHONE_RE = re.compile(r'\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b')
WALLET_RE = re.compile(r'\b0x[a-fA-F0-9]{40}\b')
SSN_RE = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
IP_RE = re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
# Common API key patterns
API_KEY_RE = re.compile(r'\b(?:sk-|pk_|rk_|whsec_|xox[bpas]-)[A-Za-z0-9_-]{20,}\b')


def load_jsonl(path):
    """Load JSONL file, skip invalid lines."""
    if not path.exists():
        return []
    items = []
    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"  WARNING: Invalid JSON at {path.name}:{line_num}")
    return items


def extract_text(conv_obj):
    """Get all text content from a conversation object."""
    parts = []
    for turn in conv_obj.get("conversations", []):
        parts.append(turn.get("value", ""))
    return " ".join(parts)


def clean_pii(text):
    """Remove PII patterns from text."""
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub("[phone]", text)
    text = WALLET_RE.sub("[wallet]", text)
    text = SSN_RE.sub("[ssn]", text)
    text = IP_RE.sub("[ip]", text)
    text = API_KEY_RE.sub("[api_key]", text)
    return text


def apply_pii_cleaning(conv_obj):
    """Clean PII from all turns in a conversation."""
    cleaned = dict(conv_obj)
    cleaned["conversations"] = []
    for turn in conv_obj.get("conversations", []):
        cleaned_turn = dict(turn)
        cleaned_turn["value"] = clean_pii(turn.get("value", ""))
        cleaned["conversations"].append(cleaned_turn)
    return cleaned


# ─── Quality filters ────────────────────────────────────────────────────────

def passes_quality(conv_obj):
    """Check if a conversation passes quality filters."""
    convs = conv_obj.get("conversations", [])

    # Must have at least system + human + gpt (3 turns)
    if len(convs) < 3:
        return False, "too_few_turns"

    # Must have at least 1 human and 1 gpt turn
    roles = [c["from"] for c in convs]
    if "human" not in roles:
        return False, "no_human"
    if "gpt" not in roles:
        return False, "no_gpt"

    # GPT responses must be at least 10 chars
    for turn in convs:
        if turn["from"] == "gpt" and len(turn.get("value", "").strip()) < 10:
            return False, "short_gpt_response"

    # Human messages must be at least 2 chars
    for turn in convs:
        if turn["from"] == "human" and len(turn.get("value", "").strip()) < 2:
            return False, "short_human_message"

    # Total conversation shouldn't be absurdly long (>16k chars)
    total_len = sum(len(t.get("value", "")) for t in convs)
    if total_len > 16000:
        return False, "too_long"

    # No empty conversations
    if total_len < 20:
        return False, "too_short"

    return True, "ok"


# ─── Deduplication ───────────────────────────────────────────────────────────

def text_fingerprint(text):
    """Create a normalized fingerprint for dedup."""
    # Lowercase, remove extra whitespace, remove punctuation
    normalized = re.sub(r'[^\w\s]', '', text.lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return hashlib.md5(normalized.encode()).hexdigest()


def jaccard_words(a, b):
    """Compute Jaccard similarity between two sets of words."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


def deduplicate(conversations, threshold=0.9):
    """Remove near-duplicate conversations using Jaccard similarity."""
    seen_fingerprints = set()
    seen_texts = []
    unique = []

    for conv in conversations:
        text = extract_text(conv)
        fp = text_fingerprint(text)

        # Exact duplicate check (fast)
        if fp in seen_fingerprints:
            continue

        # Near-duplicate check (slower, sample-based for large datasets)
        is_dup = False
        # Only check last 200 entries to keep it fast
        check_against = seen_texts[-200:] if len(seen_texts) > 200 else seen_texts
        for prev_text in check_against:
            if jaccard_words(text, prev_text) > threshold:
                is_dup = True
                break

        if not is_dup:
            seen_fingerprints.add(fp)
            seen_texts.append(text)
            unique.append(conv)

    return unique


# ─── Train/eval split ───────────────────────────────────────────────────────

def split_dataset(conversations, eval_ratio=0.1):
    """Split into train and eval sets, stratified by conversation length."""
    import random
    random.seed(42)  # Reproducible split

    # Shuffle first
    shuffled = list(conversations)
    random.shuffle(shuffled)

    eval_count = max(1, int(len(shuffled) * eval_ratio))
    eval_set = shuffled[:eval_count]
    train_set = shuffled[eval_count:]

    return train_set, eval_set


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stats = {
        "sources": {},
        "quality_filters": Counter(),
        "dedup": {},
        "final": {},
    }

    # Load data
    real = load_jsonl(REAL_FILE)
    synthetic = load_jsonl(SYNTHETIC_FILE)
    multiturn = load_jsonl(MULTITURN_FILE)
    public = load_jsonl(PUBLIC_FILE)
    print(f"Loaded: {len(real)} real, {len(synthetic)} synthetic, {len(multiturn)} multiturn, {len(public)} public")
    stats["sources"] = {
        "real": len(real),
        "synthetic": len(synthetic),
        "multiturn": len(multiturn),
        "public": len(public),
    }

    all_convs = real + synthetic + multiturn + public
    print(f"Total raw: {len(all_convs)}")

    # Step 1: PII cleaning
    print("\nStep 1: PII cleaning...")
    all_convs = [apply_pii_cleaning(c) for c in all_convs]
    pii_count = 0
    for c in all_convs:
        text = extract_text(c)
        if "[email]" in text or "[phone]" in text or "[wallet]" in text:
            pii_count += 1
    print(f"  Conversations with PII redacted: {pii_count}")

    # Step 2: Quality filtering
    print("\nStep 2: Quality filtering...")
    filtered = []
    filter_reasons = Counter()
    for conv in all_convs:
        passes, reason = passes_quality(conv)
        if passes:
            filtered.append(conv)
        else:
            filter_reasons[reason] += 1

    removed = len(all_convs) - len(filtered)
    print(f"  Passed: {len(filtered)}, Removed: {removed}")
    for reason, count in filter_reasons.most_common():
        print(f"    {reason}: {count}")
    stats["quality_filters"] = dict(filter_reasons)

    # Step 3: Deduplication
    print("\nStep 3: Deduplication...")
    unique = deduplicate(filtered)
    dupes_removed = len(filtered) - len(unique)
    print(f"  Unique: {len(unique)}, Duplicates removed: {dupes_removed}")
    stats["dedup"] = {"before": len(filtered), "after": len(unique), "removed": dupes_removed}

    # Step 4: Train/eval split
    print("\nStep 4: Train/eval split (90/10)...")
    train, eval_set = split_dataset(unique)
    print(f"  Train: {len(train)}, Eval: {len(eval_set)}")

    # Write outputs
    with open(TRAIN_FILE, "w") as f:
        for conv in train:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    with open(EVAL_FILE, "w") as f:
        for conv in eval_set:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    # Compute final stats
    def avg_turns(dataset):
        if not dataset:
            return 0
        return sum(len(c["conversations"]) for c in dataset) / len(dataset)

    def avg_length(dataset):
        if not dataset:
            return 0
        return sum(sum(len(t["value"]) for t in c["conversations"]) for c in dataset) / len(dataset)

    stats["final"] = {
        "train_count": len(train),
        "eval_count": len(eval_set),
        "total": len(unique),
        "avg_turns_train": round(avg_turns(train), 1),
        "avg_turns_eval": round(avg_turns(eval_set), 1),
        "avg_chars_train": round(avg_length(train), 0),
        "avg_chars_eval": round(avg_length(eval_set), 0),
    }

    with open(STATS_FILE, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"\nOutputs:")
    print(f"  {TRAIN_FILE} ({len(train)} examples)")
    print(f"  {EVAL_FILE} ({len(eval_set)} examples)")
    print(f"  {STATS_FILE}")
    print(f"\nDone! {len(unique)} total examples ready for training.")


if __name__ == "__main__":
    main()
