# AI History And Foundations

Date: 2026-04-07
Type: Evergreen reference

## Why this exists

The AI wiki cannot only cover what is new. If it does, it becomes trend reporting instead of a real knowledge base.

This document anchors the AI section in the durable concepts and historical eras that explain why modern AI products look the way they do.

## The major eras of AI

### 1. Symbolic AI

Core idea:

- intelligence built from explicit rules, logic, and symbolic representations

What it was good at:

- structured reasoning
- expert systems
- domains with clear rules

Why it mattered:

- it established the idea that machine intelligence could be operationalized
- it shaped many of the assumptions later challenged by machine learning

Main limitation:

- brittle outside narrow, hand-authored domains

### 2. Statistical machine learning

Core idea:

- learn patterns from data instead of writing all rules by hand

What changed:

- classification and prediction became data-driven
- feature engineering became central

Why it mattered:

- this era created the practical backbone for modern AI engineering workflows

### 3. Deep learning

Core idea:

- use large neural networks to learn hierarchical representations directly from data

What changed:

- major gains in vision, speech, and language
- less manual feature engineering

Why it mattered:

- deep learning created the scale and representation-learning foundation that modern LLMs depend on

### 4. Transformer era

Core idea:

- attention-first architectures allow models to process long sequences more effectively

Why it mattered:

- transformers became the dominant architecture for modern language models
- they enabled large-scale pretraining and emergent capabilities

### 5. Foundation model era

Core idea:

- train very large models on broad corpora, then adapt them to many downstream tasks

Why it mattered:

- one model could perform many tasks
- prompting became a serious interface layer
- post-training became strategically important

### 6. Agent era

Core idea:

- models stop being just responders and become actors that can use tools, remember context, and complete tasks over time

Why it matters now:

- this is the layer where AI becomes product infrastructure rather than just generation

## Foundational concepts that stay relevant

### Transformers

Why they matter:

- still the dominant architecture behind most modern frontier language models

### Pretraining

Why it matters:

- large-scale next-token or related learning builds general capability

### Post-training

Why it matters:

- alignment, instruction-following, preference shaping, and task specialization happen here

### Retrieval

Why it matters:

- it extends model usefulness with fresher and more grounded context

### Tool use

Why it matters:

- this is what lets models stop only talking and start doing

### Memory and context

Why they matter:

- agent usefulness depends heavily on what context is available and how it persists

### Evals

Why they matter:

- they are the difference between impressive anecdotes and reliable systems

## The enduring tensions in AI

These tensions keep reappearing and should stay central in the wiki:

- open vs closed
- generality vs specialization
- autonomy vs control
- capability vs reliability
- speed vs cost
- model quality vs runtime quality
- novelty vs grounded utility

## Why history matters for product builders

If you understand the history, you stop making shallow product mistakes.

Examples:

- you do not confuse “good chat output” with “good agent execution”
- you do not treat context as infinite or free
- you understand why evals matter
- you understand why tool access changes product design
- you understand why infrastructure matters as much as the model

## How this should shape future wiki writing

Every new AI report should answer two questions:

1. What is actually new here?
2. Which old foundation does it depend on?

That is how the AI wiki stays useful instead of becoming a pile of launch notes.
