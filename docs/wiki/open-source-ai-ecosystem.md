# The Open Source AI Ecosystem: A Comprehensive Reference

> Last updated: April 2026 | This document covers the full landscape of open source AI models, tools, frameworks, and infrastructure.

---

## Table of Contents

1. [Open Source AI Models](#section-1-open-source-ai-models)
   - [Text & Code Models](#textcode-models)
   - [Image Generation Models](#image-generation-models)
   - [Voice & Audio Models](#voiceaudio-models)
   - [Multimodal Models](#multimodal-models)
2. [AI Development Tools](#section-2-ai-development-tools)
   - [Training & Fine-tuning](#training--fine-tuning)
   - [Inference & Serving](#inference--serving)
   - [Vector Databases & RAG](#vector-databases--rag)
   - [AI Development Platforms](#ai-development-platforms)
3. [Agent & Automation Frameworks](#section-3-agent--automation-frameworks)
4. [AI Safety & Evaluation](#section-4-ai-safety--evaluation)
5. [The MCP Ecosystem](#section-5-the-mcp-ecosystem)
6. [Key Projects to Watch](#section-6-key-open-source-ai-projects-to-watch)

---

## Section 1: Open Source AI Models

### Text/Code Models

The gap between open source and proprietary LLMs has effectively closed in 2025-2026. Open models now match or beat GPT-5 on multiple benchmarks, with most leading families using Mixture-of-Experts (MoE) to keep inference costs manageable while scaling total parameters into the hundreds of billions.

#### Model Comparison Table

| Model | Creator | Total Params | Active Params | Context | License | Best For |
|-------|---------|-------------|---------------|---------|---------|----------|
| **Llama 4 Scout** | Meta | 109B | 17B (16 experts) | 10M tokens | Llama License | Long-context general tasks |
| **Llama 4 Maverick** | Meta | 400B | 17B (128 experts) | 1M tokens | Llama License | Quality-focused general use |
| **Qwen3.5-397B** | Alibaba | 397B | 17B MoE | 256K-1M tokens | Apache 2.0 | Multilingual, agentic coding |
| **Qwen3-235B** | Alibaba | 235B | 22B MoE | 128K tokens | Apache 2.0 | Reasoning, math |
| **DeepSeek V3.2** | DeepSeek | 685B | 37B MoE | 128K tokens | DeepSeek License | Reasoning, coding, tool use |
| **Mistral Large 3** | Mistral AI | 675B | 41B MoE | 256K tokens | Apache 2.0 | Reasoning, code, multilingual |
| **Mistral Small 4** | Mistral AI | ~24B | Dense | 128K tokens | Apache 2.0 | Lightweight all-in-one |
| **Gemma 4 31B** | Google | 31B | Dense | 256K tokens | Apache 2.0 | Agentic workflows, reasoning |
| **Gemma 4 26B** | Google | 26B | MoE | 256K tokens | Apache 2.0 | Efficiency-focused tasks |
| **Phi-4 Reasoning** | Microsoft | 14B | Dense | 32K tokens | MIT | Complex reasoning, math |
| **Phi-4 Mini** | Microsoft | 3.8B | Dense | 16K tokens | MIT | Edge, speed-constrained |
| **Command R+** | Cohere | 104B | Dense | 128K tokens | CC-BY-NC | RAG, multilingual enterprise |

#### Llama 4 (Meta)

Meta's Llama 4 family introduced the first open-weight natively multimodal MoE models. Both Scout and Maverick use Early Fusion, integrating text and visual tokens directly into the backbone from pre-training rather than bolting on vision as an afterthought.

- **Scout (109B):** Fits on a single H100 with INT4 quantization. Industry-leading 10M token context window. Outperforms Gemma 3, Gemini 2.0 Flash-Lite, and Mistral 3.1 on general benchmarks.
- **Maverick (402B):** 128 experts, competitive with DeepSeek V3.1 on coding and reasoning. Exceeds GPT-4o and Gemini 2.0 on coding, reasoning, multilingual, long-context, and image tasks.
- **Licensing:** Free for most developers and businesses. Companies exceeding 700M monthly active users must apply for a special license from Meta.
- **Get started:** `ollama run llama4` or download from [llama.com](https://www.llama.com/models/llama-4/)

#### Qwen 3 / 3.5 (Alibaba)

Alibaba's Qwen family has become the most versatile open LLM series, especially for multilingual and coding work. The lineup spans from 0.6B to 397B parameters.

- **Qwen3 (April 2025):** Dense models (0.6B, 1.7B, 4B, 8B, 14B, 32B) and MoE models (30B-A3B, 235B-A22B). Trained on 36 trillion tokens across 119 languages.
- **Qwen3.5 (February 2026):** The flagship 397B-A17B uses Gated Delta Networks with sparse MoE for 8.6-19x throughput improvements. Native multimodal with visual agent capabilities (desktop, mobile, browser). Supports 201 languages with 256K-1M context.
- **Qwen3-Coder-Next:** Outperforms DeepSeek V3.2 on coding tasks and matches Claude Sonnet 4.5 on SWE-Bench Pro.
- **License:** Apache 2.0 across the board -- fully permissive for commercial use.
- **Get started:** `ollama run qwen3.5` or from [Hugging Face](https://huggingface.co/Qwen)

#### DeepSeek V3 / R1 / V3.2 (DeepSeek)

DeepSeek triggered the "DeepSeek moment" in early 2025 when R1 demonstrated ChatGPT-level reasoning at a fraction of the training cost. Their models have continued to push the frontier.

- **DeepSeek V3 (Dec 2024):** 685B MoE with 37B active. Scored 88.5 on MMLU, 75.9 on MMLU-Pro. The V3-0324 update added stronger reasoning and tool use.
- **DeepSeek R1 (Jan 2025):** Reasoning-specialized model. R1-0528 approaches OpenAI o3 and Gemini 2.5 Pro on math and programming, using ~23K tokens per reasoning question.
- **DeepSeek V3.1 (Aug 2025):** Hybrid combining V3 + R1 into a single model with Deep Thinking Mode achieving 90-95% of R1's reasoning performance.
- **DeepSeek V3.2 (Dec 2025):** Unified architecture merging standard chat and complex reasoning. Introduces DeepSeek Sparse Attention (DSA) for long-context efficiency. First model to integrate thinking into tool use. Gold-medal performance on 2025 IMO and IOI. Competes with GPT-5; the V3.2-Speciale variant surpasses it.
- **License:** DeepSeek License (permissive, research and commercial use allowed with attribution).
- **Get started:** `ollama run deepseek-v3.2` or via [API](https://api-docs.deepseek.com/)

#### Mistral Family (Mistral AI)

The leading European AI lab has consistently shipped competitive open-weight models, now fully Apache 2.0 licensed.

- **Mistral Large 3 (Dec 2025):** 675B total / 41B active "granular MoE" with 256K context. Near-frontier performance without locking users into closed APIs.
- **Mistral Small 4 (Mar 2026):** Single model combining instruction following, deep reasoning, image understanding, and coding. Previously required four separate models.
- **Codestral 25.01:** Dedicated coding model supporting 80+ programming languages, optimized for code completion.
- **Mixtral Heritage:** Mixtral 8x7B (late 2023) pioneered the open MoE approach, outperforming Llama 2 70B.
- **License:** Apache 2.0 across all models.
- **Get started:** `pip install mistralai` or from [docs.mistral.ai](https://docs.mistral.ai/getting-started/models)

#### Phi-4 (Microsoft)

Microsoft's "small but mighty" family proves that careful data curation and training can punch far above weight class.

- **Phi-4-Reasoning (14B):** 82.5% on AIME 2025 (Reasoning-Plus variant). Outperforms DeepSeek-R1-Distill-Llama-70B (a 5x larger model) on most benchmarks. Approaches full DeepSeek R1 performance.
- **Phi-4-Multimodal:** Simultaneous speech, vision, and language processing via mixture-of-LoRAs. #1 on HuggingFace OpenASR leaderboard (6.14% WER).
- **Phi-4-Mini (3.8B):** Outperforms larger models on reasoning, math, coding, and function calling despite its compact size.
- **License:** MIT -- the most permissive license possible.
- **Get started:** `ollama run phi4` or from [Hugging Face](https://huggingface.co/microsoft/phi-4)

#### Google Gemma 2 / 3 / 4

Google's Gemma series has progressively improved, with Gemma 4 (April 2026) marking a major leap.

- **Gemma 2 (2024):** 9B and 27B dense models. Gemma 27B outperformed Llama 3 70B on Chatbot Arena.
- **Gemma 3 (2025):** 270M to 27B sizes. 128K context, 140+ languages, multimodal image+text input, function calling.
- **Gemma 4 (April 2026):** Four sizes -- E2B, E4B, 26B MoE, 31B Dense. Native video/image/audio input. Agentic workflows with function calling and JSON output. 31B ranks #3 open model on Arena AI. **Now Apache 2.0** (changed from custom Gemma license).
- **Get started:** `ollama run gemma4` or from [ai.google.dev/gemma](https://ai.google.dev/gemma)

#### Code-Specific Models

| Model | Creator | Params | Languages | Context | License | Notes |
|-------|---------|--------|-----------|---------|---------|-------|
| **StarCoder 2-15B** | BigCode | 15B | 600+ | 16K | OpenRAIL-M | Trained on The Stack v2. Fill-in-the-middle. Outperforms CodeLlama-34B. |
| **StarCoder 2-3B** | BigCode | 3B | 600+ | 16K | OpenRAIL-M | Outperforms StarCoderBase-15B despite 5x fewer params. |
| **CodeLlama 70B** | Meta | 70B | 15+ | 128K (v2) | Llama License | Python-specialized variant. Fill-in-the-middle (7B/13B). |
| **Codestral 25.01** | Mistral | ~22B | 80+ | 256K | Apache 2.0 | Optimized for completion, not just generation. |
| **Qwen3-Coder-Next** | Alibaba | 80B (3B active) | 100+ | 128K | Apache 2.0 | SWE-Bench Pro on par with Claude Sonnet 4.5. |

#### Command R+ (Cohere)

A RAG-specialized model with 104B parameters, 128K context, and industry-leading retrieval augmented generation with in-line citations to mitigate hallucinations. Supports 10 languages natively. Multi-step tool use allows combining tools across steps for complex tasks.

- **License:** CC-BY-NC (non-commercial; contact Cohere for commercial licensing).
- **Get started:** Via [Cohere API](https://docs.cohere.com/docs/command-r) or [Hugging Face](https://huggingface.co/CohereLabs/c4ai-command-r-plus)

---

### Image Generation Models

#### Model Comparison Table

| Model | Creator | Architecture | Resolution | Key Strength | License |
|-------|---------|-------------|------------|-------------|---------|
| **FLUX.2** | Black Forest Labs | Rectified Flow Transformer | Up to 2K | Text rendering, prompt adherence | Mixed (dev/pro/schnell) |
| **FLUX.1.1 Pro** | Black Forest Labs | Rectified Flow | Up to 2K | Highest quality, 4.5s gen time | Commercial |
| **Stable Diffusion 3.5** | Stability AI | Rectified Flow + DiT | Up to 2K | Ecosystem, LoRA/fine-tune | Stability Community |
| **SDXL** | Stability AI | Latent Diffusion | 1024x1024 | Massive fine-tune ecosystem | CreativeML Open |
| **PixArt-Sigma** | PixArt Team | Diffusion Transformer | Up to 4K | Tiny (0.6B), ultra-efficient | Apache 2.0 |
| **Playground v3** | Playground AI | LLM-integrated DiT | Up to 2K | Typography, logos | Research |

#### FLUX (Black Forest Labs)

FLUX is the current quality leader for open-weight image generation. Created by the original Stable Diffusion team after they left Stability AI.

- **FLUX.2 (Nov 2025):** Production-grade generation with state-of-the-art text rendering in images -- a longstanding weakness of diffusion models. Complex multi-element scenes with superior prompt adherence.
- **Tradeoff:** ~4x slower than SDXL on equivalent hardware (a 30-second SDXL generation takes ~2 minutes with FLUX).
- **When to use:** When text accuracy in images matters, when prompt following is critical, or for complex compositions. Use SDXL when speed matters more than peak quality or when leveraging specialized LoRAs.
- **Get started:** Via [ComfyUI](https://github.com/comfyanonymous/ComfyUI) or [diffusers](https://huggingface.co/docs/diffusers) -- `pip install diffusers`

#### Stable Diffusion 3.5 / SDXL (Stability AI)

The largest open ecosystem for image generation, with thousands of community fine-tunes, LoRAs, and ControlNet models.

- **SD 3.5:** Uses Rectified Flow architecture (like FLUX) while maintaining backward compatibility with the SDXL ecosystem. Competitive quality with deeper customization options.
- **SDXL:** The workhorse of the community. Faster generation, massive library of specialized models and LoRAs for every aesthetic. Best for specialized styles through fine-tuning.
- **When to use:** SDXL for speed and specialization through community fine-tunes. SD 3.5 for a quality upgrade while staying in the Stability ecosystem. FLUX when you need the absolute best base quality.
- **Get started:** Via [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or [ComfyUI](https://github.com/comfyanonymous/ComfyUI)

#### PixArt-Sigma

A remarkably efficient Diffusion Transformer (DiT) that generates up to 4K images with only 0.6B parameters (vs. SDXL's 2.6B). Uses "weak-to-strong training" to leverage PixArt-Alpha's foundation while adding compressed key-value attention for high-resolution efficiency.

- **License:** Apache 2.0
- **When to use:** When you need high-resolution generation on limited hardware, or as a research foundation.
- **Get started:** [GitHub](https://github.com/PixArt-alpha/PixArt-sigma)

#### Playground v3

Integrates large language models (Llama3-8B) directly into the image generation pipeline, enabling superior prompt understanding for complex scenes, typography, and logos. Currently in testing with free access.

- **When to use:** Typography-heavy designs, logos, complex prompt-following tasks.

---

### Voice/Audio Models

#### Model Comparison Table

| Model | Creator | Type | Languages | Voice Cloning | License | Key Strength |
|-------|---------|------|-----------|--------------|---------|-------------|
| **Whisper Large-v3** | OpenAI | STT | 99 | No | MIT | Gold standard for transcription |
| **Fish Speech S2** | Fish Audio | TTS | 80+ | Yes (10-30s sample) | Apache 2.0 | Emotional control, quality |
| **XTTS-v2** | Coqui AI | TTS | 17 | Yes (6s sample) | Coqui Public (non-commercial) | Best voice cloning quality |
| **Bark** | Suno AI | TTS/Audio | Multi | No | MIT | Non-speech sounds, music |
| **Parler TTS** | HF Community | TTS | English+ | Via description | Apache 2.0 | Natural language voice control |
| **Coqui TTS** | Coqui AI | TTS | 1100+ | Yes | MPL 2.0 | Broadest language coverage |

#### Whisper (OpenAI)

The gold standard for open source speech recognition, trained on 680,000 hours of multilingual data (Large-v3 on 1M+ hours).

- **Sizes:** Tiny (39M), Base (74M), Small (244M), Medium (769M), Large (1.5B).
- **Capabilities:** Transcription in 99 languages, speech translation, language identification. Robust to accents, background noise, and technical jargon.
- **Large-v3:** 10-20% error reduction over v2 across diverse languages.
- **Speed variant:** Whisper Large-v3 Turbo reduces decoder layers from 32 to 4, achieving 5.4x speedup with similar accuracy.
- **License:** MIT -- fully permissive.
- **Get started:** `pip install openai-whisper` then `whisper audio.mp3 --model large-v3`

#### Fish Speech (Fish Audio)

The current state-of-the-art open source TTS system, trained on over 10M hours of audio data.

- **S2 Pro:** Uses Dual-Autoregressive architecture with reinforcement learning alignment. Supports sub-word level fine-grained prosody and emotion control via natural language tags (`[whisper]`, `[excited]`, `[angry]`).
- **Voice Cloning:** 10-30 second reference samples, no fine-tuning needed.
- **Benchmark:** Scores 0.515 on Audio Turing Test, surpassing Seed-TTS (0.417) by 24%.
- **License:** Apache 2.0.
- **Get started:** [fish.audio](https://fish.audio/) or [GitHub](https://github.com/fishaudio/fish-speech)

#### Bark (Suno AI)

A transformer-based text-to-audio model that generates not just speech but also laughter, sighing, crying, background noise, and simple music.

- **License:** MIT -- fully permissive for commercial use.
- **When to use:** When you need expressive, non-speech audio generation alongside speech. Not the highest quality for pure TTS, but unmatched for audio diversity.
- **Get started:** `pip install git+https://github.com/suno-ai/bark.git`

#### XTTS-v2 (Coqui AI)

Leading voice cloning quality from just a 6-second audio clip across 17 languages.

- **License:** Coqui Public Model License (non-commercial only). Contact Coqui for commercial licensing.
- **When to use:** When voice cloning fidelity is the top priority and you have a commercial license path.
- **Get started:** `pip install TTS` then use the `tts` CLI

#### Parler TTS

Unique approach: describe the voice you want in natural language ("A female speaker with a warm tone, slight British accent, speaking at a moderate pace") and the model generates matching speech.

- **Voices:** 34 named speakers with distinct characteristics.
- **License:** Apache 2.0.
- **When to use:** When you need flexible voice control without reference audio samples.
- **Get started:** [Hugging Face](https://huggingface.co/parler-tts/parler-tts-mini-v1)

---

### Multimodal Models

#### Model Comparison Table

| Model | Creator | Vision | Audio | Video | Params | License |
|-------|---------|--------|-------|-------|--------|---------|
| **Qwen3-VL-235B** | Alibaba | Yes | No | Yes | 235B (22B active) | Apache 2.0 |
| **Qwen3.5** | Alibaba | Yes | Yes | Yes | 397B (17B active) | Apache 2.0 |
| **Gemma 4** | Google | Yes | Yes (E2B/E4B) | Yes | Up to 31B | Apache 2.0 |
| **Llama 4 Maverick** | Meta | Yes | No | No | 400B (17B active) | Llama License |
| **InternVL3** | Shanghai AI Lab | Yes | No | No | Various | Apache 2.0 |
| **Pixtral Large** | Mistral | Yes | No | No | 124B | Apache 2.0 |
| **Phi-4-Multimodal** | Microsoft | Yes | Yes | No | 14B | MIT |

#### Qwen-VL Series

The current open source leader for vision-language tasks. Qwen3-VL-235B-A22B rivals GPT-5 and Gemini 2.5 Pro across multimodal benchmarks. Acts as a visual agent capable of analyzing texts, charts, graphics, and layouts; can control computers and phones via screenshot interpretation.

#### InternVL3 (Shanghai AI Lab)

Excels at tool usage, GUI agents, industrial image analysis, and 3D vision perception. Strong upgrade from InternVL 2.5 with enhanced multimodal reasoning.

#### Pixtral (Mistral)

- **Pixtral 12B:** 12B decoder + 400M vision encoder. Significantly outperforms LLaVa-OneVision 7B and Phi-3.5 Vision on instruction following.
- **Pixtral Large:** 124B model with 1B visual encoder, paired with Mistral Large 2.

#### Key Trend

In 2025-2026, open source VLMs reduced inference costs by up to 60% vs. closed models while achieving competitive benchmark scores (MMBench >80%, MM-Vet >75% for top models).

---

## Section 2: AI Development Tools

### Training & Fine-tuning

#### Framework Comparison Table

| Tool | Focus | Training Methods | Hardware Req | License | Best For |
|------|-------|-----------------|-------------|---------|----------|
| **Unsloth** | Speed + memory efficiency | LoRA, QLoRA, full FT | Single 12GB+ GPU | Apache 2.0 | Fast fine-tuning on consumer hardware |
| **Axolotl** | Config-driven flexibility | SFT, DPO, GRPO, RM, QLoRA, RLHF | Single to multi-GPU | Apache 2.0 | Production fine-tuning pipelines |
| **TRL** | HuggingFace native | SFT, DPO, RLHF, PPO, GRPO | Varies | Apache 2.0 | Integration with HF ecosystem |
| **LLaMA-Factory** | Ease of use | 100+ methods, WebUI | Single GPU+ | Apache 2.0 | Beginners, rapid experimentation |
| **Torchtune** | PyTorch native | Full FT, LoRA, QLoRA | Single to multi-GPU | BSD | PyTorch-first workflows |

#### Unsloth

The most popular choice for efficient fine-tuning on consumer hardware. Reduces VRAM usage by ~70% vs. full fine-tuning and trains ~2x faster than standard LoRA pipelines.

- **Why it's popular:** Fine-tune 7B+ models on a single 24GB GPU with 4-bit NF4 quantization. The new Unsloth Studio provides a no-code web UI for training, running, and exporting models.
- **2026 updates:** Faster MoE training, embedding model support, ultra-long context for RL, multi-GPU support.
- **Get started:** `pip install unsloth` -- see [unsloth.ai](https://unsloth.ai/)

#### Axolotl

Config-driven fine-tuning that wraps HuggingFace Transformers, PEFT, TRL, and DeepSpeed into a single YAML interface. Define your model, dataset, training method, and hyperparameters in one config file, then launch with one command.

- **Supported methods:** Full fine-tuning, LoRA, QLoRA, GPTQ, QAT, DPO, IPO, KTO, ORPO, GRPO, GDPO, Reward Modelling, Process Reward Modelling.
- **2025-2026 updates:** SageAttention support, GDPO, LoRA memory optimizations, distributed vLLM server for RLHF data generation.
- **Get started:** `pip install axolotl` -- config examples at [github.com/axolotl-ai-cloud/axolotl](https://github.com/axolotl-ai-cloud/axolotl)

#### TRL (Transformers Reinforcement Learning)

HuggingFace's official library for post-training LLMs with reinforcement learning and alignment techniques.

- **Methods:** SFT (Supervised Fine-Tuning), DPO (Direct Preference Optimization), PPO, GRPO, Reward Modeling.
- **Integration:** First-class integration with the entire HuggingFace ecosystem (Transformers, PEFT, Datasets, Accelerate).
- **When to use:** When you want native HuggingFace integration without additional abstractions. Axolotl wraps TRL internally, so use TRL directly when you want maximum control.
- **Get started:** `pip install trl` -- [github.com/huggingface/trl](https://github.com/huggingface/trl)

#### GGUF Format

GGUF (GPT-Generated Unified Format) is the standard file format for quantized models used by llama.cpp, Ollama, LM Studio, and most local inference tools.

- **What it is:** A binary format designed for rapid loading and memory-mapped execution of quantized models.
- **Why it matters:** Enables running large models on consumer hardware by quantizing weights to 2-8 bit integers. Q4_K_M is the sweet spot: 92% quality retention with 75% size reduction from FP16.
- **Ecosystem:** Universal across CPU, GPU, and Apple Silicon. Supported by all major local inference tools.

---

### Inference & Serving

#### Tool Comparison Table

| Tool | Type | Best For | Key Feature | Speed | License |
|------|------|----------|-------------|-------|---------|
| **llama.cpp** | C++ engine | Local inference, any hardware | Pure C/C++, no dependencies | Moderate | MIT |
| **vLLM** | Python server | Production GPU serving | PagedAttention, continuous batching | Highest throughput | Apache 2.0 |
| **Ollama** | CLI/daemon | Easy local model management | `ollama run model-name` | Good single-user | MIT |
| **LM Studio** | Desktop GUI | Model discovery, evaluation | Visual model browser, side-by-side compare | Good | Proprietary (free) |

#### llama.cpp

Written in pure C/C++ with zero external dependencies. Runs on everything from phones to data center GPUs. The GGUF format originates here.

- **Key features:** CPU-first design, GPU offloading, Apple Silicon optimization, 2-8 bit quantization.
- **When to use:** Maximum hardware compatibility, edge devices, embedding inference in non-Python applications.
- **Get started:** `brew install llama.cpp` or build from [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)

#### vLLM

The production standard for GPU-based LLM serving. PagedAttention manages KV cache like virtual memory, continuous batching maximizes throughput, and speculative decoding reduces latency.

- **Performance:** At peak load, 35x the request throughput and 44x the total output tokens/second compared to llama.cpp.
- **v0.16.0 (Feb 2026):** Multi-GPU/multi-platform support for NVIDIA, AMD ROCm, Intel XPU, and TPU.
- **When to use:** Multi-user production serving on GPU infrastructure. Not ideal for single-user local use (Ollama is simpler).
- **Get started:** `pip install vllm` then `vllm serve model-name` -- [docs.vllm.ai](https://docs.vllm.ai/)

#### Ollama

The simplest path from zero to running a model locally. One-command download and run with automatic quantization and hardware detection.

- **Key features:** OpenAI-compatible API server, model library with one-command pulls, automatic hardware optimization.
- **When to use:** Local development, prototyping, personal use. Start here, graduate to vLLM for production serving.
- **Get started:** `curl -fsSL https://ollama.com/install.sh | sh` then `ollama run llama4`

#### LM Studio

Desktop GUI for discovering, downloading, comparing, and serving local models. Best for model evaluation before deployment.

- **2025-2026 features:** MultiGPU support, MCP integration, Flash Attention, LM Link (secure remote model access via Tailscale), headless daemon mode (`llmster`).
- **When to use:** Evaluating models side-by-side, non-technical users, quick OpenAI-compatible local API serving.
- **Get started:** Download from [lmstudio.ai](https://lmstudio.ai/)

---

### Vector Databases & RAG

#### Vector Database Comparison

| Database | Type | Hosting | Free Tier | Best For | License |
|----------|------|---------|-----------|----------|---------|
| **Pinecone** | Managed | Cloud only | Limited | Ease of use, zero ops | Proprietary |
| **Qdrant** | OSS + managed | Self-host or cloud | 1GB forever | Cost-sensitive, edge-leaning | Apache 2.0 |
| **Weaviate** | OSS + managed | Self-host or cloud | Limited | Hybrid search, modularity | BSD |
| **Milvus** | OSS | Self-host or Zilliz Cloud | Community edition | Billion-vector scale | Apache 2.0 |
| **Chroma** | OSS | Self-host | Unlimited (local) | Prototyping, small/medium | Apache 2.0 |
| **pgvector** | Extension | Self-host | N/A | PostgreSQL-native apps | PostgreSQL License |

**Decision Framework:**
- **Prototyping:** Start with Chroma (embed it directly in your Python app).
- **Production, minimal ops:** Pinecone (managed, no cluster to run).
- **Self-hosted, cost-conscious:** Qdrant (best free tier, compact footprint).
- **Enterprise billion-vector scale:** Milvus (industrial track record).
- **Already using PostgreSQL:** pgvector (no new infrastructure).

#### RAG Architectures & Best Practices

RAG has evolved from simple "chunk and retrieve" into sophisticated agentic retrieval systems in 2025-2026.

**Key Architecture Patterns:**

| Pattern | How It Works | When To Use |
|---------|-------------|-------------|
| **Naive RAG** | Chunk, embed, retrieve top-k, generate | Simple Q&A, getting started |
| **HyDE** | Generate hypothetical answer, search for similar docs | Abstract or conceptual queries |
| **Corrective RAG (CRAG)** | Evaluate relevance before generation, fallback to web search | High-accuracy requirements |
| **Self-RAG** | Model decides when to retrieve and self-evaluates | Adaptive retrieval needs |
| **Agentic RAG** | Multi-agent orchestration with planning/routing | Complex multi-step research |
| **Branched RAG** | Route queries to specialized data sources by intent | Multi-domain knowledge bases |

**Best Practices for 2026:**

1. **Use hybrid retrieval** (dense embeddings + BM25 sparse search) as the default. This outperforms either alone.
2. **Add reranking** -- this often improves answer relevance more than switching LLMs. Cohere Rerank 3.5 supports 100+ languages.
3. **Semantic chunking** over fixed-size chunking. Split on meaning boundaries, not character counts.
4. **Small-to-big retrieval** -- retrieve small chunks, but pass surrounding context to the LLM.
5. **Evaluate with RAGAS** -- the open source RAG evaluation framework measures retrieval quality, answer correctness, and faithfulness.

#### Embedding Models

| Model | Creator | Dimensions | MTEB Score | Languages | License | Cost |
|-------|---------|-----------|------------|-----------|---------|------|
| **Cohere embed-v4** | Cohere | 1024 | 65.2 | 100+ | Proprietary | $0.10/MTok |
| **text-embedding-3-large** | OpenAI | 3072 | 64.6 | Multi | Proprietary | $0.13/MTok |
| **text-embedding-3-small** | OpenAI | 1536 | 62.3 | Multi | Proprietary | $0.02/MTok |
| **BGE-M3** | BAAI | 1024 | 63.0 | 100+ | MIT | Free (self-host) |
| **GTE-multilingual-base** | Alibaba | 768 | ~62 | 70+ | Apache 2.0 | Free (self-host) |
| **Nomic Embed v2** | Nomic AI | 768 | ~62 | Multi | Apache 2.0 | Free (self-host) |

**Open source picks:** BGE-M3 for multilingual RAG (MIT license, supports dense + sparse + multi-vector retrieval in one model). GTE for Alibaba ecosystem integration. In 2025-2026, self-hosted models rival commercial APIs across most tasks.

#### RAG Frameworks

| Framework | Focus | Language | Key Feature | Stars |
|-----------|-------|----------|-------------|-------|
| **LangChain** | General-purpose LLM orchestration | Python, JS | Modular chains, 600+ integrations | 100K+ |
| **LlamaIndex** | Data indexing and retrieval | Python, TS | 90+ file type parsing, query engines | 40K+ |
| **Haystack** | Production NLP pipelines | Python | Pipeline-based, document stores | 18K+ |
| **RAGFlow** | Document-centric RAG | Python | Deep document parsing, knowledge graphs | 30K+ |

**LangChain** is the connective tissue -- use it for general orchestration, tool chains, and multi-agent systems. **LlamaIndex** excels at document-heavy applications with its superior parsing (LlamaParse handles 90+ file types including complex PDFs with embedded images, tables, and handwritten notes) and advanced retrieval strategies.

---

### AI Development Platforms

| Platform | Focus | Key Feature | Pricing Model |
|----------|-------|-------------|---------------|
| **Hugging Face** | Model hub + ecosystem | 2M+ models, Spaces, Inference Endpoints | Freemium |
| **Together AI** | Fast open model inference | 200+ models, sub-100ms latency | Per-token |
| **Groq** | Ultra-fast inference | Custom LPU chip, 18x GPU speed | Per-token |
| **Replicate** | API-first model serving | One-line model deployment | Per-second |
| **Modal** | Serverless GPU compute | Run any Python function on GPUs | Per-second |
| **Anyscale / Ray** | Distributed AI compute | Ray framework, scalable training + serving | Per-hour |

#### Hugging Face

The central hub of the open source AI ecosystem. By 2026: 2M+ models, 500K+ datasets, ~1M Spaces (demo apps). Key services include:

- **Hub:** Git-based model/dataset hosting with version control, model cards, and community discussion.
- **Spaces:** Free model demos with optional ZeroGPU (NVIDIA H200s allocated on-demand). Supports Gradio and Streamlit.
- **Inference Endpoints:** Scalable HTTPS APIs with autoscaling, private networking, and hardware choices.
- **TGI (Text Generation Inference):** Optimized inference server for text models.
- **Transformers v5 (late 2025):** PyTorch-only backend, first-class quantization, modular architecture.
- **Get started:** [huggingface.co](https://huggingface.co/) -- free account, `pip install transformers`

#### Groq

Custom silicon (Language Processing Units) designed specifically for AI inference. Up to 18x faster than GPUs for latency-critical applications.

- **When to use:** When latency is the top priority (real-time chat, voice agents, interactive applications).
- **Get started:** [groq.com](https://groq.com/) -- API compatible with OpenAI SDK

---

## Section 3: Agent & Automation Frameworks

### The Agent Framework Landscape (2026)

The field has shifted from "autonomous agents" to what Andrej Karpathy coined "agentic engineering" in February 2026 -- reliable, composable systems over fully autonomous operation. The market reached $7.84B in 2025, projected to hit $52.62B by 2030.

#### Framework Comparison Table

| Framework | Creator | GitHub Stars | License | Architecture | Best For |
|-----------|---------|-------------|---------|-------------|----------|
| **LangGraph** | LangChain | 38M+ PyPI/mo | MIT | State machine | Complex workflows with explicit control |
| **CrewAI** | CrewAI | 45K+ | MIT | Role-based teams | Multi-agent collaboration |
| **Microsoft Agent Framework** | Microsoft | Growing | MIT | Multi-protocol | Enterprise copilots (.NET + Python) |
| **AutoGen** | Microsoft | 38K+ | MIT | Conversation-based | Research, multi-agent chat |
| **LlamaIndex Workflows** | LlamaIndex | 40K+ | MIT | Event-driven | RAG-centric agent pipelines |
| **DSPy** | Databricks/Stanford | 22K+ | MIT | Programmatic | Optimized prompting pipelines |
| **Dify** | Dify | 131K+ | Apache 2.0 | Visual builder | No-code agent creation |
| **n8n** | n8n | 60K+ | Fair Code | Visual workflow | Automation with AI nodes |

#### LangGraph

Hit 1.0 GA in October 2025. LangGraph's core bet: agent systems are state machines, and developers should have explicit control over every transition. More code (~60+ lines to get started) but zero magic.

- **When to use:** Complex multi-step workflows, conditional branching, human-in-the-loop, production systems requiring auditability.
- **Get started:** `pip install langgraph` -- [langchain-ai.github.io/langgraph](https://langchain-ai.github.io/langgraph/)

#### CrewAI

The fastest-growing agent framework (45K+ stars, 450M+ monthly workflows). Core bet: most multi-agent problems map naturally to teams of specialists.

- **Speed:** Multi-agent workflows running in under an hour with ~20 lines of code.
- **Compatibility:** LangChain-compatible, so migration is gradual, not a rewrite.
- **When to use:** Multi-agent collaboration, role-based task decomposition, rapid prototyping.
- **Get started:** `pip install crewai` -- [crewai.com](https://crewai.com/)

#### Microsoft Agent Framework

Hit Release Candidate in February 2026, merging AutoGen's multi-agent patterns with Semantic Kernel's enterprise features. Supports A2A, MCP, and AG-UI protocols out of the box, works across .NET and Python.

- **When to use:** Enterprise environments, Microsoft ecosystem, .NET shops.
- **Get started:** Via [NuGet](https://www.nuget.org/) (.NET) or `pip install semantic-kernel` (Python)

#### DSPy (Databricks/Stanford)

"Programming -- not prompting -- LMs." DSPy shifts focus from handcrafting prompt strings to declaring input/output signatures that get automatically compiled into optimized prompts.

- **Key concept:** You declare what you want (signatures), DSPy figures out the best prompt (including few-shot examples) via optimization.
- **Components:** Language model + Signature (I/O declaration) + Module (prompting technique).
- **When to use:** When you want reproducible, optimizable LLM pipelines without manual prompt engineering. Especially valuable for pipelines where prompt quality directly affects business metrics.
- **Get started:** `pip install dspy` -- [dspy.ai](https://dspy.ai/)

#### Instructor

A lightweight library that patches LLM client SDKs (OpenAI, Anthropic, Google, etc.) to accept Pydantic models directly, ensuring structured JSON output every time.

- **When to use:** Any time you need reliable structured output from LLM API calls. Drop-in enhancement, not a framework replacement.
- **Get started:** `pip install instructor` -- [github.com/jxnl/instructor](https://github.com/jxnl/instructor)

#### Outlines

Pioneered the finite-state machine (FSM) approach to constrained decoding. Compiles JSON schemas and regex patterns into precomputed vocabulary indexes that guarantee valid output structure.

- **When to use:** Local model inference where you need guaranteed schema compliance. For API-based models, use Instructor instead.
- **Get started:** `pip install outlines` -- [github.com/outlines-dev/outlines](https://github.com/outlines-dev/outlines)

#### Dify

Open source LLMOps platform with a visual canvas for building AI workflows. 131K+ GitHub stars, used by 280+ enterprises including Maersk and Novartis.

- **Features:** Visual workflow builder, 50+ built-in tools, RAG pipeline, agent capabilities, model management, observability.
- **v1.0 (2025):** Plugin-first architecture with marketplace.
- **When to use:** When you want a visual, no-code approach to building AI applications. Strong for teams without deep ML engineering resources.
- **Get started:** `docker compose up -d` -- [dify.ai](https://dify.ai/)

#### Coding-Focused Agents

| Agent | Focus | Architecture | Notes |
|-------|-------|-------------|-------|
| **OpenDevin** | Autonomous software engineering | Sandbox (editor + terminal + browser) | High-autonomy workflows |
| **SWE-Agent** | GitHub issue resolution | LLM + shell access | Strong benchmarks |
| **MetaGPT** | Software company simulation | Product mgr / architect / engineer roles | One-line req to full codebase |
| **AutoGPT** | General autonomous tasking | Task queue + vector memory | Community project, can loop without guardrails |
| **BabyAGI** | Task-based planning | Task creation + prioritization + execution | Lightweight, archived (educational) |
| **Langroid** | Multi-agent collaboration | Conversation-based agents | Built-in tool/doc integration |

---

## Section 4: AI Safety & Evaluation

### Evaluation Frameworks

| Framework | Creator | Benchmarks | Key Feature | License |
|-----------|---------|-----------|-------------|---------|
| **lm-eval-harness** | EleutherAI | 60+ tasks, 100s of subtasks | Backend for HF Open LLM Leaderboard | MIT |
| **Inspect AI** | UK AI Safety Institute | 100+ evaluations | Web-based visualization, VS Code extension | MIT |
| **HELM** | Stanford | 16 core scenarios | 7 metrics per scenario (accuracy, fairness, toxicity, etc.) | Apache 2.0 |
| **RAGAS** | Community | RAG-specific | Retrieval quality, answer correctness, faithfulness | Apache 2.0 |

#### lm-eval-harness (EleutherAI)

The de facto standard for LLM evaluation. Used internally by NVIDIA, Cohere, BigScience, BigCode, and dozens of other organizations. Powers HuggingFace's Open LLM Leaderboard.

- **Capabilities:** 60+ standard academic benchmarks with hundreds of subtasks. Consistent evaluation across models.
- **Get started:** `pip install lm-eval` then `lm_eval --model hf --model_args pretrained=model-name --tasks task-name`
- **Repository:** [github.com/EleutherAI/lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)

#### Inspect AI (UK AISI)

Open source framework from the UK AI Security Institute for comprehensive LLM evaluations across coding, agentic tasks, reasoning, knowledge, behavior, and multimodal understanding.

- **Features:** 100+ pre-built evaluations, web-based Inspect View for monitoring, VS Code Extension, composable evaluation components.
- **Community:** 50+ contributors including frontier labs and safety research organizations.
- **Get started:** `pip install inspect-ai` -- [inspect.aisi.org.uk](https://inspect.aisi.org.uk/)

#### HELM (Stanford)

Holistic Evaluation of Language Models measures 7 metrics (accuracy, calibration, robustness, fairness, bias, toxicity, efficiency) for each of 16 core scenarios.

- **When to use:** When you need comprehensive multi-dimensional evaluation, especially for fairness and safety properties beyond pure accuracy.
- **Repository:** [github.com/stanford-crfm/helm](https://github.com/stanford-crfm/helm)

### Safety & Guardrails

| Tool | Creator | Focus | License |
|------|---------|-------|---------|
| **NeMo Guardrails** | NVIDIA | Programmable LLM guardrails | Apache 2.0 |
| **Guardrails AI** | Guardrails AI | Output validation and correction | Apache 2.0 |
| **Garak** | NVIDIA | LLM vulnerability scanning / red teaming | Apache 2.0 |
| **LLM Guard** | Protect AI | Input/output scanning | MIT |

#### NeMo Guardrails (NVIDIA)

Open source toolkit for adding programmable safety rails to LLM applications.

- **Guardrail types:** Input rails (user input), dialog rails (LLM prompting), retrieval rails (RAG chunks), output rails (response filtering).
- **Capabilities:** Topic control, PII detection, RAG grounding, jailbreak prevention, multilingual content safety.
- **Integrations:** LangChain, LangGraph, LlamaIndex. Supports multi-agent deployments with GPU acceleration.
- **Get started:** `pip install nemoguardrails` -- [github.com/NVIDIA-NeMo/Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)

#### Red Teaming with Garak

NVIDIA's Garak probes LLMs for prompt injection, data leakage, misinformation, and other adversarial vulnerabilities. Think of it as `nmap` for LLMs.

- **Get started:** `pip install garak` then `garak --model_type huggingface --model_name model-name`

---

## Section 5: The MCP Ecosystem

### Overview

The Model Context Protocol (MCP) is an open standard introduced by Anthropic in November 2024 that standardizes how AI systems integrate with external tools, data sources, and services. Think of it as "USB-C for AI" -- a universal connector between models and the world.

**Key milestones:**
- **Nov 2024:** MCP launched by Anthropic.
- **Mar 2025:** OpenAI officially adopted MCP across its products.
- **Dec 2025:** Anthropic donated MCP to the Agentic AI Foundation (AAIF) under the Linux Foundation, co-founded by Anthropic, Block, and OpenAI.
- **2026:** Multi-company open standard. MCP Registry approaching 2,000 entries with 407% growth. Tens of thousands of community servers available.

### Official MCP Servers

Reference implementations demonstrating core MCP features:

| Server | Function | Transport |
|--------|----------|-----------|
| **Filesystem** | Secure file operations with configurable access controls | stdio |
| **GitHub** | Repository management, PRs, issues, code search | stdio |
| **Git** | Local git operations | stdio |
| **Google Drive/Maps/Search** | Google service integration | stdio |
| **Slack** | Channel management and messaging | stdio |
| **Memory** | Persistent knowledge graph | stdio |
| **Sequential Thinking** | Step-by-step reasoning | stdio |
| **PostgreSQL / SQLite** | Database operations | stdio |
| **Puppeteer / Playwright** | Browser automation | stdio |
| **Fetch** | HTTP requests and web content extraction | stdio |

### Building MCP Servers

#### Python (FastMCP)

FastMCP powers ~70% of all MCP servers across all languages. FastMCP 1.0 was incorporated into the official MCP Python SDK.

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

if __name__ == "__main__":
    mcp.run()
```

- **Get started:** `pip install fastmcp` -- [github.com/jlowin/fastmcp](https://github.com/jlowin/fastmcp)

#### TypeScript

```typescript
import { FastMCP } from "fastmcp";
import { z } from "zod";

const server = new FastMCP("my-server");

server.addTool({
  name: "add",
  description: "Add two numbers",
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => String(a + b),
});

server.start({ transportType: "stdio" });
```

- **Get started:** `npm install fastmcp` -- [github.com/punkpeye/fastmcp](https://github.com/punkpeye/fastmcp)

### MCP Discovery

| Registry | Description | URL |
|----------|-------------|-----|
| **MCP Registry** | Official central index (~2,000 servers) | modelcontextprotocol.io |
| **MCP.so** | Community marketplace/directory | mcp.so |
| **SkillFlow** | Agent skill marketplace (500+ MCP servers) | skillflow.ai |
| **Awesome MCP Servers** | Curated GitHub list | github.com/wong2/awesome-mcp-servers |

### MCP in 2026

The 2026 roadmap focuses on enterprise deployments, transport scalability, governance (formal Spec Enhancement Proposals process), and authentication improvements. MCP support is becoming a dividing line between "production-ready" and "experimental" agent frameworks.

---

## Section 6: Key Open Source AI Projects to Watch

### Most-Starred & Fastest-Growing (2026)

| Project | Stars | Category | Why It Matters |
|---------|-------|----------|----------------|
| **OpenClaw** | 210K+ | Agentic automation | Fastest-growing OSS project in GitHub history (9K to 60K stars in days) |
| **Open WebUI** | 124K+ | Local AI interface | Self-hosted ChatGPT alternative, 282M+ downloads |
| **Dify** | 131K+ | AI agent builder | Visual LLMOps platform, 280+ enterprise users |
| **LangChain** | 100K+ | AI orchestration | Connective tissue of the AI agent ecosystem |
| **n8n** | 60K+ | Workflow automation | Visual no-code + custom code, 400+ integrations |
| **Ollama** | 120K+ | Local model serving | Backbone of the local AI movement |
| **Pathway** | 50K+ | Real-time AI data | Unified framework for live data and AI |
| **CrewAI** | 45K+ | Multi-agent framework | 450M+ monthly workflows |
| **Claude Code** | Tens of K | Coding agent | Open source CLI coding agent |
| **Moondream** | Growing | Tiny vision model | 6M+ downloads, healthcare to robotics |

### Broader Ecosystem Numbers

GitHub's Octoverse 2025 report: 4.3M+ AI-related repositories on GitHub, a 178% year-over-year jump in LLM-focused projects alone.

### Emerging Trends to Track

1. **Unified Model Architectures:** DeepSeek V3.2 and Qwen3.5 merge reasoning/chat/code/vision into single models instead of requiring separate specialized models. Expect this to become the norm.

2. **MoE Everywhere:** Nearly every frontier open model now uses Mixture-of-Experts. The key metric is "active parameters per token" not total parameters. A 400B MoE model with 17B active is cheaper to run than a 70B dense model.

3. **Apache 2.0 Convergence:** Google (Gemma 4), Mistral (Large 3), Alibaba (Qwen3.5), Microsoft (Phi-4) have all converged on Apache 2.0. This removes licensing friction for commercial deployment.

4. **Agentic Engineering > Autonomous Agents:** The industry has moved past "let the AI do everything autonomously" toward composable, reliable agent systems with human oversight and explicit state machines.

5. **MCP as Universal Standard:** With OpenAI, Anthropic, Microsoft, and the Linux Foundation behind it, MCP is becoming the standard integration layer between AI and external tools/data.

6. **Edge AI:** Phi-4-Mini (3.8B), Gemma 4 E2B, Qwen3.5-0.8B -- models are getting smaller and more capable, running on phones and laptops. The "small model running locally" use case is increasingly viable.

7. **Open Source TTS Quality Parity:** Fish Speech S2 and other open TTS models now produce output most listeners cannot distinguish from commercial services.

8. **Structured Generation:** Constrained decoding (Outlines, XGrammar, llguidance) is becoming a standard feature of inference engines (vLLM uses XGrammar by default). Reliable structured output is no longer optional.

---

## Quick Start Decision Trees

### "I want to run an LLM locally"

```
Start here: What hardware do you have?
|
+-- Laptop/Desktop (8-16GB RAM)
|   --> Ollama + Phi-4 Mini or Qwen3.5-0.8B/2B
|
+-- Gaming PC (24GB+ VRAM)
|   --> Ollama or LM Studio + Qwen3-32B or Gemma 4 31B (Q4 quant)
|
+-- Server (80GB+ VRAM)
|   --> vLLM + DeepSeek V3.2 or Qwen3.5-397B
|
+-- Apple Silicon Mac (32GB+ unified memory)
|   --> LM Studio or Ollama + Qwen3.5-35B-A3B or Llama 4 Scout
```

### "I want to build a RAG system"

```
Start here: What's your scale?
|
+-- Prototype / small dataset
|   --> Chroma + LlamaIndex + BGE-M3 embeddings
|
+-- Production / medium scale
|   --> Qdrant + LangChain + Cohere embed-v4 or BGE-M3
|
+-- Enterprise / billions of vectors
|   --> Milvus + LlamaIndex + hybrid retrieval + reranking
|
+-- Already using PostgreSQL
|   --> pgvector extension + your existing stack
```

### "I want to fine-tune a model"

```
Start here: What's your goal?
|
+-- Quick experiment, single consumer GPU
|   --> Unsloth + QLoRA
|
+-- Production pipeline, config-driven
|   --> Axolotl (wraps TRL, DeepSpeed, PEFT)
|
+-- Alignment / RLHF / DPO
|   --> TRL directly or Axolotl with RLHF config
|
+-- No code preferred
|   --> Unsloth Studio (web UI) or LLaMA-Factory (WebUI)
```

### "I want to build AI agents"

```
Start here: What's your complexity?
|
+-- Simple multi-agent teams
|   --> CrewAI (~20 lines of code)
|
+-- Complex stateful workflows
|   --> LangGraph (explicit state machine control)
|
+-- Visual / no-code
|   --> Dify or n8n with AI nodes
|
+-- Enterprise / .NET
|   --> Microsoft Agent Framework (Semantic Kernel)
|
+-- Optimized prompting pipelines
|   --> DSPy
```

---

## Sources & Further Reading

### Models
- [Hugging Face Open LLM Leaderboard](https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard)
- [Artificial Analysis LLM Leaderboard](https://artificialanalysis.ai/leaderboards/models)
- [llama.com](https://www.llama.com/models/llama-4/)
- [Qwen GitHub](https://github.com/QwenLM/Qwen3.5)
- [DeepSeek API Docs](https://api-docs.deepseek.com/)
- [Mistral AI Documentation](https://docs.mistral.ai/getting-started/models)
- [Google Gemma](https://ai.google.dev/gemma)
- [Microsoft Phi-4 Research](https://www.microsoft.com/en-us/research/publication/phi-4-reasoning-technical-report/)

### Tools & Frameworks
- [Unsloth](https://unsloth.ai/)
- [Axolotl](https://github.com/axolotl-ai-cloud/axolotl)
- [TRL](https://github.com/huggingface/trl)
- [vLLM](https://docs.vllm.ai/)
- [Ollama](https://ollama.com/)
- [LM Studio](https://lmstudio.ai/)
- [LangChain](https://python.langchain.com/)
- [LlamaIndex](https://www.llamaindex.ai/)
- [CrewAI](https://crewai.com/)
- [DSPy](https://dspy.ai/)
- [Dify](https://dify.ai/)

### Safety & Evaluation
- [lm-eval-harness](https://github.com/EleutherAI/lm-evaluation-harness)
- [Inspect AI](https://inspect.aisi.org.uk/)
- [NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)
- [HELM](https://crfm.stanford.edu/helm/)

### MCP
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [FastMCP (Python)](https://github.com/jlowin/fastmcp)
- [FastMCP (TypeScript)](https://github.com/punkpeye/fastmcp)
- [Awesome MCP Servers](https://github.com/wong2/awesome-mcp-servers)

### Industry Analysis
- [BentoML Open Source Model Guides](https://www.bentoml.com/blog)
- [Sebastian Raschka's Ahead of AI](https://magazine.sebastianraschka.com/)
- [GitHub Octoverse 2025](https://github.blog/open-source/maintainers/this-years-most-influential-open-source-projects/)
- [ByteByteGo Top AI Repositories](https://blog.bytebytego.com/p/top-ai-github-repositories-in-2026)
