# MCP Overview

Date: 2026-04-07
Type: Evergreen reference

## What MCP is

The Model Context Protocol is an open standard for connecting AI applications to external systems.

The official MCP site describes it as a standardized way for AI applications to connect to:

- data sources
- tools
- workflows

Official source:

- https://modelcontextprotocol.io/

The simplest mental model is:

- MCP is a protocol layer between an AI host and external capability providers

It matters because it reduces the need for one-off custom integrations and makes context access more composable.

## Why MCP matters

MCP matters because modern AI systems are only as useful as the context and tools they can safely access.

Without a protocol like MCP, every product ends up building bespoke integrations for:

- file systems
- databases
- APIs
- SaaS tools
- internal systems

With MCP, the host and server can speak a common language about:

- tools
- resources
- prompts
- capabilities

## What MCP is not

MCP does not tell you:

- which model to use
- how your app should render UI
- how your product should handle approvals
- how your reasoning loop should work

It only standardizes the context exchange and capability interface layer.

That distinction matters. MCP is infrastructure, not the whole product.

## The big product lesson

The strongest AI products increasingly treat MCP as a capability bus, not a gimmick.

That means:

- the host remains responsible for product UX
- the protocol handles capability exchange
- security and approvals stay explicit

## Sources

- MCP homepage: https://modelcontextprotocol.io/
- Architecture overview: https://modelcontextprotocol.io/docs/learn/architecture
- Specification overview: https://modelcontextprotocol.io/specification/2025-06-18/basic/index
