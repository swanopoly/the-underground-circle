# MCP Security And Consent

Date: 2026-04-07
Type: Evergreen reference

## Why this matters

MCP makes AI systems more powerful by connecting them to external capabilities.

That means security and consent become product-critical.

The more useful the system is, the more important it is to answer:

- what can it access
- what can it call
- who approved it
- how visible are those actions

## Security themes in the spec and docs

The current MCP specification explicitly includes:

- lifecycle management
- capability negotiation
- authorization for HTTP-based transports

Official source:

- https://modelcontextprotocol.io/specification/2025-06-18/basic/index

The host is also expected to enforce security policies and user authorization decisions.

## Why hosts matter so much

Security in MCP is not only a server problem.

The host is responsible for:

- permission boundaries
- user consent flows
- visibility into exposed capabilities
- coordination of security policy

This is an important design lesson:

- the protocol helps
- the product still owns the trust model

## Strong product patterns

### Pattern 1. Clear capability visibility

Users should be able to see:

- which servers are connected
- which tools are available
- which resources are exposed

### Pattern 2. Human-in-the-loop for risky actions

This is especially important for tool invocations with external effect.

### Pattern 3. Read and write should feel different

Read-style resource access is not the same as write-style tool execution.

The product should reflect that difference clearly.

### Pattern 4. Transport-aware trust

Local STDIO and remote HTTP are not the same trust surface.

That difference should influence approval and visibility design.

## Underground Circle relevance

This should influence:

- chat approvals
- room tool access
- task capability bundles
- OpenSwan and MCP integration governance

## Sources

- Specification overview: https://modelcontextprotocol.io/specification/2025-06-18/basic/index
- Architecture overview: https://modelcontextprotocol.io/docs/learn/architecture
- Tools docs: https://modelcontextprotocol.io/docs/concepts/tools
