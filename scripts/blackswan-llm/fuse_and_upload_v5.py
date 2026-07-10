#!/usr/bin/env python3
"""
BlackSwan v5 — Fuse LoRA adapters, convert to HF format, upload to HuggingFace.

Steps:
1. Fuse LoRA adapters with base model using mlx_lm
2. Dequantize to bfloat16
3. Remap tensor names from MLX to HF convention
4. NO norm offset fix needed (scale=1.0 doesn't cause this)
5. Upload to HuggingFace Hub
"""

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

import torch
import safetensors.torch as st
from huggingface_hub import HfApi


SCRIPT_DIR = Path(__file__).parent
MODELS_DIR = SCRIPT_DIR / "models" / "v5"
LORA_DIR = MODELS_DIR / "lora_v2"
FUSED_DIR = MODELS_DIR / "fused"
UPLOAD_DIR = MODELS_DIR / "hf_upload_v2"
BASE_MODEL = "mlx-community/Qwen3.5-4B-4bit"
HF_REPO = "cswan801/BlackSwan-v5"


def fused_weight_files():
    """Return the current MLX fused safetensor shards, preferring the index."""
    index_path = FUSED_DIR / "model.safetensors.index.json"
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)
        shard_names = sorted(set(index.get("weight_map", {}).values()))
        files = [FUSED_DIR / name for name in shard_names]
        missing = [str(path) for path in files if not path.exists()]
        if missing:
            raise FileNotFoundError(f"Fused shard(s) missing: {', '.join(missing)}")
        return files

    single = FUSED_DIR / "model.safetensors"
    if single.exists():
        return [single]

    raise FileNotFoundError(f"No fused model weights found in {FUSED_DIR}")


def load_fused_tensors():
    """Load all fused MLX tensors from one file or the current shard index."""
    tensors = {}
    files = fused_weight_files()
    for sf_file in files:
        print(f"  Loading fused shard {sf_file.name}...")
        shard = st.load_file(str(sf_file))
        overlap = set(tensors).intersection(shard)
        if overlap:
            raise ValueError(f"Duplicate tensor(s) across fused shards: {sorted(overlap)[:5]}")
        tensors.update(shard)
    print(f"  Loaded {len(tensors)} fused tensors from {len(files)} file(s)")
    return tensors


def mlx_to_hf_name(mlx_name):
    """Map MLX fused tensor names back to the original HF Qwen3.5 layout."""
    if mlx_name.startswith("language_model.model."):
        return "model.language_model." + mlx_name[len("language_model.model."):]
    if mlx_name.startswith("language_model."):
        return "model." + mlx_name
    return mlx_name


def step1_fuse_lora():
    """Fuse LoRA adapters with base model using mlx_lm."""
    print("\n=== Step 1: Fuse LoRA with base model ===")
    
    if FUSED_DIR.exists():
        try:
            files = fused_weight_files()
        except FileNotFoundError:
            files = []
        if files:
            print(f"  Fused model already exists at {FUSED_DIR}, skipping...")
            return

    if FUSED_DIR.exists() and not any(FUSED_DIR.iterdir()):
        FUSED_DIR.rmdir()
    elif FUSED_DIR.exists():
        print(f"  Removing incomplete fused output at {FUSED_DIR}")
        shutil.rmtree(FUSED_DIR)

    if FUSED_DIR.exists() and fused_weight_files():
        print(f"  Fused model already exists at {FUSED_DIR}, skipping...")
        return
    
    import subprocess
    cmd = [
        sys.executable, "-m", "mlx_lm", "fuse",
        "--model", BASE_MODEL,
        "--adapter-path", str(LORA_DIR),
        "--save-path", str(FUSED_DIR),
        "--dequantize",
    ]
    print(f"  Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  STDERR: {result.stderr}")
        try:
            fused_weight_files()
        except FileNotFoundError:
            raise RuntimeError(f"Fusion failed with exit code {result.returncode}")
        print("  mlx_lm fuse reported a model-card error after writing weights; continuing.")
    print(f"  Fused model saved to {FUSED_DIR}")


def step2_convert_to_hf():
    """Convert MLX fused weights to HF format with proper tensor names."""
    print("\n=== Step 2: Convert to HF format ===")
    
    if UPLOAD_DIR.exists():
        shutil.rmtree(UPLOAD_DIR)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load fused MLX model
    print(f"  Loading fused model from {FUSED_DIR}...")
    mlx_tensors = load_fused_tensors()
    
    # Download original Qwen3.5-4B for reference (vision encoder + MTP head)
    from huggingface_hub import snapshot_download
    print("  Downloading original Qwen3.5-4B for vision weights...")
    orig_path = snapshot_download(
        "Qwen/Qwen3.5-4B",
        allow_patterns=["*.safetensors", "*.json"],
        ignore_patterns=["*.gguf"],
    )
    
    # Load original tensors
    orig_tensors = {}
    for sf_file in Path(orig_path).glob("*.safetensors"):
        orig_tensors.update(st.load_file(str(sf_file)))
    print(f"  Loaded {len(orig_tensors)} original tensors")
    
    # Build name mapping: MLX uses language_model.model.*, HF uses model.language_model.*
    # Also MLX drops the "model." prefix for the outer Qwen3_5ForConditionalGeneration
    hf_tensors = {}
    
    # First, add our fused text model weights with name remapping
    for mlx_name, tensor in mlx_tensors.items():
        # MLX: language_model.model.layers.0.self_attn.q_proj.weight
        # HF:  model.language_model.layers.0.self_attn.q_proj.weight
        hf_name = mlx_to_hf_name(mlx_name)
        
        # Convert to torch tensor (bfloat16)
        # MLX tensors loaded by safetensors.torch are already torch tensors
        if tensor.dtype != torch.bfloat16:
            tensor = tensor.to(torch.bfloat16)
        
        hf_tensors[hf_name] = tensor
    
    # Now add vision encoder + MTP head from original model
    # These are tensors NOT in our fused model
    vision_and_mtp = {}
    for name, tensor in orig_tensors.items():
        if name.startswith("model.visual.") or name.startswith("model.lm_head.") or name.startswith("model.multi_token_prediction_head."):
            if name not in hf_tensors:
                vision_and_mtp[name] = tensor
    
    # Also need the embed_tokens if not in fused
    for name, tensor in orig_tensors.items():
        if "embed_tokens" in name and name not in hf_tensors:
            hf_tensors[name] = tensor
    
    hf_tensors.update(vision_and_mtp)
    print(f"  Total HF tensors: {len(hf_tensors)} (fused: {len(mlx_tensors)}, vision/mtp: {len(vision_and_mtp)})")
    
    # Verify conv1d weights have correct shape
    # MLX may store as [C, kernel, 1] but HF expects [C, 1, kernel]
    conv_fixed = 0
    for name, tensor in hf_tensors.items():
        if "conv1d.weight" in name and tensor.dim() == 3:
            # Check if we need to transpose
            if tensor.shape[2] == 1 and tensor.shape[1] > 1:
                # MLX format [C, kernel, 1] -> HF format [C, 1, kernel]
                hf_tensors[name] = tensor.permute(0, 2, 1).contiguous()
                conv_fixed += 1
    if conv_fixed:
        print(f"  Fixed {conv_fixed} conv1d weight shapes (MLX→HF transpose)")
    
    # Check for norm offset (MLX stores 1+w for RMSNorm)
    # With scale=1.0, the fused model should have correct norms
    # But let's verify against original
    norm_issues = 0
    for name in hf_tensors:
        if "layernorm" in name or "input_layernorm" in name or "post_attention_layernorm" in name:
            if name in orig_tensors:
                diff = (hf_tensors[name].float() - orig_tensors[name].float()).abs().mean().item()
                if diff > 0.5:  # If mean diff > 0.5, likely has +1 offset
                    print(f"  WARNING: Norm offset detected in {name} (mean diff={diff:.3f})")
                    hf_tensors[name] = (hf_tensors[name].float() - 1.0).to(torch.bfloat16)
                    norm_issues += 1
    
    # Also check the final norm
    for name in hf_tensors:
        if name.endswith(".norm.weight") and "linear_attn.norm" not in name:
            if name in orig_tensors:
                diff = (hf_tensors[name].float() - orig_tensors[name].float()).abs().mean().item()
                if diff > 0.5:
                    print(f"  WARNING: Norm offset detected in {name} (mean diff={diff:.3f})")
                    hf_tensors[name] = (hf_tensors[name].float() - 1.0).to(torch.bfloat16)
                    norm_issues += 1
    
    if norm_issues:
        print(f"  Fixed {norm_issues} norm weight offsets")
    else:
        print("  No norm offset issues detected")
    
    # Split into shards (match original model structure)
    # Shard 1: layers 0-19 text model
    # Shard 2: layers 20-31 text model + embed/norm
    # Shard 3: vision + MTP
    shard1, shard2, shard3 = {}, {}, {}
    for name, tensor in sorted(hf_tensors.items()):
        if name.startswith("model.visual.") or name.startswith("model.multi_token_prediction_head."):
            shard3[name] = tensor
        elif "layers." in name:
            import re
            layer_match = re.search(r'layers\.(\d+)', name)
            if layer_match:
                layer_num = int(layer_match.group(1))
                if layer_num < 20:
                    shard1[name] = tensor
                else:
                    shard2[name] = tensor
            else:
                shard2[name] = tensor
        elif "embed_tokens" in name or "lm_head" in name:
            shard2[name] = tensor
        elif name.endswith(".norm.weight"):
            shard2[name] = tensor
        else:
            shard2[name] = tensor
    
    # Save shards
    shard_files = {
        "model-00001-of-00003.safetensors": shard1,
        "model-00002-of-00003.safetensors": shard2,
        "model-00003-of-00003.safetensors": shard3,
    }
    
    weight_map = {}
    for shard_name, shard_data in shard_files.items():
        if not shard_data:
            continue
        out_path = UPLOAD_DIR / shard_name
        print(f"  Saving {shard_name} ({len(shard_data)} tensors)...")
        st.save_file(shard_data, str(out_path))
        for tensor_name in shard_data:
            weight_map[tensor_name] = shard_name
    
    # Save index
    index = {
        "metadata": {"total_size": sum(t.numel() * t.element_size() for t in hf_tensors.values())},
        "weight_map": dict(sorted(weight_map.items()))
    }
    with open(UPLOAD_DIR / "model.safetensors.index.json", "w") as f:
        json.dump(index, f, indent=2)
    
    print(f"  Saved {len(shard_files)} shards to {UPLOAD_DIR}")
    
    # Copy config files from original + our modifications
    import shutil
    for fname in ["tokenizer.json", "tokenizer_config.json", "chat_template.jinja",
                  "preprocessor_config.json", "video_preprocessor_config.json"]:
        src = Path(orig_path) / fname
        if not src.exists():
            # Try from existing upload dir
            src = MODELS_DIR / "hf_upload" / fname
        if src.exists():
            shutil.copy2(str(src), str(UPLOAD_DIR / fname))
    
    # Copy and modify config.json
    with open(Path(orig_path) / "config.json") as f:
        config = json.load(f)
    # Set max_position_embeddings to 8192 for L4 GPU compatibility
    if "text_config" in config:
        config["text_config"]["max_position_embeddings"] = 8192
    with open(UPLOAD_DIR / "config.json", "w") as f:
        json.dump(config, f, indent=4)
    
    print("  Config and tokenizer files copied")


def step3_upload(hf_token):
    """Upload model to HuggingFace Hub."""
    print(f"\n=== Step 3: Upload to {HF_REPO} ===")
    
    api = HfApi(token=hf_token)
    
    # Upload all files in UPLOAD_DIR
    files = list(UPLOAD_DIR.iterdir())
    print(f"  Uploading {len(files)} files...")
    
    for f in sorted(files):
        if f.name.startswith("."):
            continue
        size_mb = f.stat().st_size / 1e6
        print(f"  Uploading {f.name} ({size_mb:.0f}MB)...")
        api.upload_file(
            path_or_fileobj=str(f),
            path_in_repo=f.name,
            repo_id=HF_REPO,
            repo_type="model",
        )
        print(f"    Done: {f.name}")
    
    print(f"\n  All files uploaded to https://huggingface.co/{HF_REPO}")


def main():
    parser = argparse.ArgumentParser(description="Fuse BlackSwan v5 LoRA and upload to HF")
    parser.add_argument("--skip-fuse", action="store_true", help="Skip fusion step")
    parser.add_argument("--skip-convert", action="store_true", help="Skip conversion step")
    parser.add_argument("--skip-upload", action="store_true", help="Skip upload step")
    parser.add_argument("--hf-token", type=str, default=os.environ.get("HF_TOKEN"), help="HuggingFace token")
    args = parser.parse_args()
    
    if not args.skip_fuse:
        step1_fuse_lora()
    
    if not args.skip_convert:
        step2_convert_to_hf()
    
    if not args.skip_upload:
        if not args.hf_token:
            print("ERROR: --hf-token or HF_TOKEN env var required for upload")
            sys.exit(1)
        step3_upload(args.hf_token)
    
    print("\nDone!")


if __name__ == "__main__":
    main()
