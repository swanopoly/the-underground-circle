# Design-To-Code And Figma MCP

Date: 2026-04-07
Type: Dated research report

## Why this matters

One of the most important product shifts in current AI tooling is that design and implementation are getting pulled into the same loop.

The old pattern was:

- designer makes mock
- developer manually interprets it
- code drifts from design system over time

The new pattern is increasingly:

- agent reads structured design context
- agent generates or updates implementation
- agent validates against visual intent
- agent can also push work back into design tools

## Why Figma MCP matters

Figma’s MCP work is one of the clearest official examples of this shift.

Official sources:

- https://help.figma.com/hc/en-us/articles/35280968300439-Figma-MCP-collection-What-is-the-Figma-MCP-server
- https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server
- https://help.figma.com/hc/en-us/articles/39216419318551
- https://help.figma.com/hc/en-us/articles/39166810751895

What the official docs emphasize:

- structured design context for agents
- access to components, variables, layout data, and file structure
- read and write workflows
- supported usage from agentic tools like Claude Code and Codex
- prebuilt skills such as `figma-implement-design`

This matters because it moves design-to-code from “look at a screenshot and guess” toward “work from real design structure.”

## Design-to-code product patterns

### Pattern 1. Structured context beats screenshot-only context

Screenshots are useful, but structured design context is stronger because it carries:

- component identity
- spacing and layout intent
- variables and tokens
- reusable system information

### Pattern 2. Visual validation matters

Even good code generation should be checked against the intended interface.

### Pattern 3. The best loop is bidirectional

Strong systems can:

- read design into code workflows
- push generated output or structure back into design workflows

### Pattern 4. Design systems should stay the source of truth

The strongest official Figma material repeatedly points back to using real components and variables rather than flattening everything into images.

## Codex and design-to-code

OpenAI’s official Codex use-case page explicitly highlights:

- building responsive front-end designs from screenshots and visual references
- turning Figma designs into code

Official source:

- https://developers.openai.com/codex/use-cases

This matters because it confirms design-to-code is no longer a side demo. It is a first-class workflow category.

## Underground Circle relevance

This topic should directly inform:

- Feed design-capable task bundles
- Room design execution workflows
- future design artifact cards
- Figma and MCP integration planning

## Sources

- Figma MCP overview: https://help.figma.com/hc/en-us/articles/35280968300439-Figma-MCP-collection-What-is-the-Figma-MCP-server
- Guide to Figma MCP server: https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server
- Get started with the Figma MCP server: https://help.figma.com/hc/en-us/articles/39216419318551
- Figma MCP skills: https://help.figma.com/hc/en-us/articles/39166810751895
- Codex use cases: https://developers.openai.com/codex/use-cases
