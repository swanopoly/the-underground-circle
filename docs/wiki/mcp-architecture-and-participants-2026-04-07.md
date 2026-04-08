# MCP Architecture And Participants

Date: 2026-04-07
Type: Evergreen reference

## Core architecture

MCP uses a host-client-server architecture.

The official architecture docs describe the participants as:

- host
- client
- server

Official source:

- https://modelcontextprotocol.io/docs/learn/architecture

## Host

The host is the AI application the user actually interacts with.

Examples:

- an AI coding tool
- a desktop assistant
- an IDE integration
- a chat product

The host is responsible for:

- coordinating one or more MCP clients
- managing permissions and lifecycle
- aggregating context
- deciding how the user experiences the result

## Client

Each MCP client is the connection-specific protocol component between the host and one MCP server.

The official docs emphasize that the host may create one client per server connection.

Why this matters:

- clients are protocol units
- hosts are product units

That distinction is easy to blur if you are thinking only in product terms.

## Server

An MCP server exposes capabilities to a host through the protocol.

Examples:

- file access
- database access
- API operations
- search
- workflow prompts

The server does not own the whole user experience. It exposes capability in a standardized way.

## Why this architecture is strong

This architecture creates clear boundaries:

- the host owns user experience
- the client owns the connection
- the server owns capability exposure

That separation is one of the main reasons MCP can scale across many products and many integrations.

## Product lesson

When teams misunderstand MCP, they often try to make servers behave like full applications.

That is usually the wrong abstraction.

The best pattern is:

- keep the server focused on capability
- keep the host focused on user experience and policy

## Sources

- MCP architecture overview: https://modelcontextprotocol.io/docs/learn/architecture
- Understanding MCP clients: https://modelcontextprotocol.io/docs/learn/client-concepts
- Understanding MCP servers: https://modelcontextprotocol.io/docs/learn/server-concepts
- Specification architecture: https://modelcontextprotocol.io/specification/2024-11-05/architecture/index
