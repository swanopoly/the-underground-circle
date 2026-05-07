#!/usr/bin/env python3
"""
BlackSwan LLM v4 — Prepare final training dataset.

Same pipeline as v3 but reads public_curated_v4.jsonl (expanded dataset).
Merges: real + synthetic + multiturn + public_v4 → train_v4.jsonl + eval_v4.jsonl
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
PUBLIC_FILE = DATA_DIR / "public_curated_v4.jsonl"
APP_FILE = DATA_DIR / "app_data.jsonl"
TRAIN_FILE = DATA_DIR / "train_v4.jsonl"
EVAL_FILE = DATA_DIR / "eval_v4.jsonl"
STATS_FILE = DATA_DIR / "stats_v4.json"

# Oversample factor for app-derived examples. Last training run had
# the app at 0.34% of the mix (142 of 41,990), which is why the model
# barely showed any app personality beyond what the system prompt
# leaked at inference. Repeating each app example N times biases the
# loss toward the app voice + the killer-feature behaviors (mission
# planning, proof-of-work summaries, GitHub shipping recaps) without
# requiring 5K hand-written examples. Dedup runs after this so there's
# a ceiling on amplification — true near-duplicates still get pruned.
APP_OVERSAMPLE = 12

# ─── PII patterns ────────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
PHONE_RE = re.compile(r'\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b')
WALLET_RE = re.compile(r'\b0x[a-fA-F0-9]{40}\b')
SSN_RE = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
API_KEY_RE = re.compile(r'\b(?:sk-|pk_|rk_|whsec_|xox[bpas]-)[A-Za-z0-9_-]{20,}\b')


def load_jsonl(path):
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
    return " ".join(t.get("value", "") for t in conv_obj.get("conversations", []))


def clean_pii(text):
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub("[phone]", text)
    text = WALLET_RE.sub("[wallet]", text)
    text = SSN_RE.sub("[ssn]", text)
    text = API_KEY_RE.sub("[api_key]", text)
    return text


def apply_pii_cleaning(conv_obj):
    cleaned = dict(conv_obj)
    cleaned["conversations"] = []
    for turn in conv_obj.get("conversations", []):
        cleaned_turn = dict(turn)
        cleaned_turn["value"] = clean_pii(turn.get("value", ""))
        cleaned["conversations"].append(cleaned_turn)
    return cleaned


def passes_quality(conv_obj):
    convs = conv_obj.get("conversations", [])
    if len(convs) < 3:
        return False, "too_few_turns"
    roles = [c["from"] for c in convs]
    if "human" not in roles:
        return False, "no_human"
    if "gpt" not in roles:
        return False, "no_gpt"
    for turn in convs:
        if turn["from"] == "gpt" and len(turn.get("value", "").strip()) < 10:
            return False, "short_gpt_response"
    for turn in convs:
        if turn["from"] == "human" and len(turn.get("value", "").strip()) < 2:
            return False, "short_human_message"
    total_len = sum(len(t.get("value", "")) for t in convs)
    if total_len > 24000:  # Increased for code examples
        return False, "too_long"
    if total_len < 20:
        return False, "too_short"
    return True, "ok"


def text_fingerprint(text):
    normalized = re.sub(r'[^\w\s]', '', text.lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return hashlib.md5(normalized.encode()).hexdigest()


def deduplicate(conversations, threshold=0.9):
    seen_fingerprints = set()
    seen_texts = []
    unique = []
    for conv in conversations:
        text = extract_text(conv)
        fp = text_fingerprint(text)
        if fp in seen_fingerprints:
            continue
        is_dup = False
        check_against = seen_texts[-200:] if len(seen_texts) > 200 else seen_texts
        for prev_text in check_against:
            words_a = set(text.lower().split())
            words_b = set(prev_text.lower().split())
            if words_a and words_b:
                jaccard = len(words_a & words_b) / len(words_a | words_b)
                if jaccard > threshold:
                    is_dup = True
                    break
        if not is_dup:
            seen_fingerprints.add(fp)
            seen_texts.append(text)
            unique.append(conv)
    return unique


def split_dataset(conversations, eval_ratio=0.05):
    """Split into train/eval. Using 5% for eval (vs 10% in v3) since dataset is much larger."""
    import random
    random.seed(42)
    shuffled = list(conversations)
    random.shuffle(shuffled)
    eval_count = max(1, int(len(shuffled) * eval_ratio))
    return shuffled[eval_count:], shuffled[:eval_count]


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stats = {"sources": {}, "quality_filters": Counter(), "dedup": {}, "final": {}}

    real = load_jsonl(REAL_FILE)
    synthetic = load_jsonl(SYNTHETIC_FILE)
    multiturn = load_jsonl(MULTITURN_FILE)
    public = load_jsonl(PUBLIC_FILE)
    app = load_jsonl(APP_FILE)
    # Oversample app data so the loss gets a meaningful signal from
    # how Underground Circle actually talks. Dedup later prunes
    # exact duplicates so this isn't unbounded amplification.
    app_oversampled = app * APP_OVERSAMPLE if app else []
    print(
        f"Loaded: {len(real)} real, {len(synthetic)} synthetic, "
        f"{len(multiturn)} multiturn, {len(public)} public_v4, "
        f"{len(app)} app (oversampled {APP_OVERSAMPLE}x → {len(app_oversampled)})"
    )
    stats["sources"] = {
        "real": len(real), "synthetic": len(synthetic),
        "multiturn": len(multiturn), "public_v4": len(public),
        "app_unique": len(app), "app_oversample": APP_OVERSAMPLE,
        "app_after_oversample": len(app_oversampled),
    }

    all_convs = real + synthetic + multiturn + public + app_oversampled
    print(f"Total raw: {len(all_convs)}")

    # Step 1: PII cleaning
    print("\nStep 1: PII cleaning...")
    all_convs = [apply_pii_cleaning(c) for c in all_convs]

    # Step 2: Quality filtering
    print("Step 2: Quality filtering...")
    filtered = []
    filter_reasons = Counter()
    for conv in all_convs:
        passes, reason = passes_quality(conv)
        if passes:
            filtered.append(conv)
        else:
            filter_reasons[reason] += 1
    print(f"  Passed: {len(filtered)}, Removed: {len(all_convs) - len(filtered)}")
    for reason, count in filter_reasons.most_common():
        print(f"    {reason}: {count}")
    stats["quality_filters"] = dict(filter_reasons)

    # Step 3: Deduplication
    print("Step 3: Deduplication...")
    unique = deduplicate(filtered)
    print(f"  Unique: {len(unique)}, Duplicates removed: {len(filtered) - len(unique)}")
    stats["dedup"] = {"before": len(filtered), "after": len(unique), "removed": len(filtered) - len(unique)}

    # Step 4: Train/eval split
    print("Step 4: Train/eval split (95/5)...")
    train, eval_set = split_dataset(unique)
    print(f"  Train: {len(train)}, Eval: {len(eval_set)}")

    # Write outputs
    with open(TRAIN_FILE, "w") as f:
        for conv in train:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")
    with open(EVAL_FILE, "w") as f:
        for conv in eval_set:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    def avg_turns(dataset):
        return sum(len(c["conversations"]) for c in dataset) / len(dataset) if dataset else 0

    def avg_length(dataset):
        return sum(sum(len(t["value"]) for t in c["conversations"]) for c in dataset) / len(dataset) if dataset else 0

    stats["final"] = {
        "train_count": len(train), "eval_count": len(eval_set),
        "total": len(unique),
        "avg_turns_train": round(avg_turns(train), 1),
        "avg_chars_train": round(avg_length(train), 0),
    }
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"\nOutputs:")
    print(f"  {TRAIN_FILE} ({len(train)} examples)")
    print(f"  {EVAL_FILE} ({len(eval_set)} examples)")
    print(f"\nDone! {len(unique)} total examples ready for v4 training.")


if __name__ == "__main__":
    main()
