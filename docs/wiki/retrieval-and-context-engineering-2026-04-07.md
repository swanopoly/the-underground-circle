# Retrieval And Context Engineering

Date: 2026-04-07
Type: Evergreen reference

## Why this topic matters

Many AI product failures are not model failures first. They are context failures.

A system with the wrong context, missing sources, noisy prompts, or weak retrieval can perform badly even with a very strong model.

## Retrieval

Retrieval is the process of selecting relevant external information and bringing it into the model context at the moment it is needed.

Typical sources:

- documents
- code files
- wiki pages
- support history
- task state
- structured records

## Context engineering

Context engineering is the broader discipline of deciding:

- what context the model gets
- in what order
- in what format
- under what budget constraints
- with what policies and summaries

It includes retrieval, but is larger than retrieval.

## Why this matters for agents

Agents are especially sensitive to context quality because they often:

- operate over many steps
- use tools
- need memory of prior actions
- switch between planning and execution
- produce artifacts that should feed future work

## Core context design questions

- what is the minimum useful context
- what must always be present
- what should be retrieved dynamically
- what should be summarized
- what should be hidden unless needed

## Product patterns that usually help

### Pattern 1. Stable instruction layer

Examples:

- product policies
- team conventions
- role instructions

### Pattern 2. Dynamic task layer

Examples:

- latest task details
- active room files
- current run artifacts

### Pattern 3. Retrieved evidence layer

Examples:

- wiki articles
- repo files
- prior runs
- support cases

### Pattern 4. Output-aware continuation

The outputs of prior steps should become future context cleanly through:

- artifact references
- summaries
- check results

## Underground Circle relevance

This topic is central to:

- main chat context
- room-scoped tasking
- Feed task runs
- support/help agents
- research agents
- wiki-backed answers

## Sources

- Hugging Face embedding tasks: https://huggingface.co/docs/inference-providers/en/tasks/feature-extraction
- EmbeddingGemma release notes: https://ai.google.dev/gemma/docs/releases
- OpenAI retrieval guide: https://platform.openai.com/docs/guides/retrieval
