# Evals And AI Reliability

Date: 2026-04-07
Type: Evergreen reference

## Why this topic matters

Without evaluation, AI products become collections of anecdotes.

The difference between a flashy demo and a dependable system is usually not the model alone. It is whether the product measures the right things, checks regressions, and makes failures visible.

## What evals are for

Evals help answer:

- did the system do the task correctly
- did it do it safely
- did it use tools correctly
- did it regress after a change
- is it good enough for this domain

## Important eval layers

### Model evals

These compare model capabilities on broad benchmark tasks.

Useful for:

- rough capability comparisons
- understanding frontier movement

Limit:

- they do not tell you whether your product workflow is reliable

### Workflow evals

These test the actual product flow.

Examples:

- can the coding agent fix a scoped bug
- can the research agent produce a cited summary
- can the browser-use agent complete a form safely

This is where real product quality becomes visible.

### Safety evals

These measure:

- harmful outputs
- prompt injection susceptibility
- policy violations
- unsafe tool behavior

### Regression evals

These answer:

- did the system get worse after a model or prompt change

## What to measure for agent systems

For agents, the most useful measurements often include:

- task success rate
- tool success rate
- approval frequency
- retry rate
- artifact quality
- failure type distribution
- human rework needed after completion

## Why benchmarks are only part of the picture

Public benchmarks matter, but they do not replace domain-specific evaluation.

A system can score well on a benchmark and still fail badly in your product because:

- the tool loop is weak
- the prompts are weak
- the context is poor
- the approval model is wrong
- the artifact model is missing

## Underground Circle relevance

This product should eventually evaluate:

- Feed task completion quality
- Chat answer usefulness by mode
- Room execution success
- artifact usefulness
- approval and check performance
- provider/runtime comparisons

## Sources

- OpenAI Evals design guide: https://platform.openai.com/docs/guides/evals
- OpenAI Evals API overview: https://platform.openai.com/docs/guides/evals-overview
- SWE-bench: https://www.swebench.com/
- EVMbench: https://openai.com/index/introducing-evmbench/
