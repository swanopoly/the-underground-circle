# Open Source Model Serving Stack

Date: 2026-04-07
Type: Dated research report

## Why this matters

A lot of AI discussion focuses on model releases, but product builders eventually hit a more practical question:

how do you actually run and serve models in a usable way?

This is where the model serving stack matters.

The serving layer determines:

- throughput
- latency
- hardware efficiency
- API compatibility
- deployment shape
- observability

## The main serving paths

### 1. Managed inference providers

This path prioritizes convenience.

Benefits:

- fast start
- low infra burden
- broad model access

Tradeoff:

- less control
- platform dependency

### 2. Self-hosted inference engines

This path prioritizes control and custom deployment.

Benefits:

- infrastructure control
- model flexibility
- potentially lower cost at scale
- stronger privacy posture

Tradeoff:

- operational complexity

## vLLM

Official source:

- https://docs.vllm.ai/en/stable/getting_started/quickstart/

What the official docs emphasize:

- offline batched inference
- online serving
- OpenAI-compatible server mode
- multiple optimized attention backends

Why it matters:

- vLLM has become one of the most important open serving layers for serious LLM inference
- OpenAI-compatible serving matters because it reduces integration friction

## Hugging Face Text Generation Inference

Official source:

- https://huggingface.co/docs/text-generation-inference/index

What the official docs emphasize:

- high-performance serving
- streaming
- batching
- quantization
- guidance / structured outputs / tool use
- observability

Important current note from the official docs:

- TGI is now in maintenance mode
- Hugging Face explicitly recommends downstream engines such as `vllm`, `SGLang`, and local engines like `llama.cpp` or `MLX`

This is strategically important because it shows where the open serving ecosystem is consolidating.

## What a builder should care about

The key questions are:

- can it serve the models you need
- does it support your hardware
- how easy is it to operate
- does it expose a compatible API
- how strong is monitoring and scaling support
- what are the ecosystem signals about its future

## Why API compatibility matters

OpenAI-compatible serving has become strategically useful because it lets one app architecture switch between:

- hosted providers
- self-hosted providers
- different inference engines

with less application change than older inference stacks required.

## Underground Circle relevance

This matters for:

- future self-hosted agent backends
- open-model task execution
- room or office local-model integrations
- cost control for specialized workloads

## Sources

- vLLM quickstart: https://docs.vllm.ai/en/stable/getting_started/quickstart/
- TGI docs: https://huggingface.co/docs/text-generation-inference/index
- TGI consuming guide: https://huggingface.co/docs/text-generation-inference/basic_tutorials/consuming_tgi
- Hugging Face Inference Providers: https://huggingface.co/docs/inference-providers/en/index
