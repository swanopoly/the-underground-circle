# MCP Tools, Resources, And Prompts

Date: 2026-04-07
Type: Evergreen reference

## The three most important server-side concepts

MCP servers commonly expose three important building blocks:

- tools
- resources
- prompts

These are easy to confuse, but they solve different problems.

## Tools

The official tools docs describe tools as functions that the language model can actively call.

Official source:

- https://modelcontextprotocol.io/docs/concepts/tools

Important product meaning:

- tools are action-oriented
- the model can decide when to invoke them

Examples:

- query an API
- create a calendar event
- update a record
- trigger an external process

Why this matters:

- tools are where action and risk usually enter the system

The official docs also emphasize that there should be human oversight for trust and safety.

## Resources

The official resources docs describe resources as passive data sources that provide context.

Official source:

- https://modelcontextprotocol.io/docs/concepts/resources

Important product meaning:

- resources are application-driven, not necessarily model-driven
- they are read-oriented context carriers

Examples:

- files
- database schemas
- knowledge base entries
- application state references

Why this matters:

- resources are often safer and more stable than tools
- they help the host ground the model without automatically granting action power

## Prompts

Prompts in MCP represent reusable workflow or interaction templates provided by the server.

They matter because they let a server expose higher-level workflows, not just raw actions or raw data.

Important product meaning:

- prompts are workflow scaffolds
- they can standardize how a host starts a particular capability flow

## Why the distinction matters so much

If you collapse these concepts together, you get messy products.

The clean split is:

- resources provide context
- tools perform actions
- prompts shape workflows

That split is one of the most useful product-design lessons in the whole protocol.

## Underground Circle relevance

This maps directly to:

- wiki and room files as resources
- task and external-service actions as tools
- starter flows and agent templates as prompts

## Sources

- Tools: https://modelcontextprotocol.io/docs/concepts/tools
- Resources: https://modelcontextprotocol.io/docs/concepts/resources
- Server concepts: https://modelcontextprotocol.io/docs/learn/server-concepts
