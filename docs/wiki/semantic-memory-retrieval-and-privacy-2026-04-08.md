# Semantic Memory Retrieval and Privacy

Date: 2026-04-08
Type: Dated research report
Scope: semantic retrieval, ranking, and privacy design for agent memory

## Why this matters

Agent memory fails in two common ways:

- it retrieves the wrong thing
- it retrieves the right thing for the wrong person

So memory quality depends on both retrieval quality and privacy boundaries.

## Best retrieval pattern

The strongest pattern is:

- filter by scope and visibility first
- then use semantic similarity
- then rerank by importance, confidence, freshness, and scope priority

This is better than:

- plain recency ordering
- plain keyword matching
- pure vector retrieval with weak metadata filters

## Why privacy is central

Private user memory should not leak through broad shared policies.

For agent systems, privacy must be enforced both:

- in database RLS
- in application-level query filters

## Best product implication

A strong managed-agent memory system should:

- keep startup memory small
- retrieve archival memory by meaning
- log which memories influenced a run
- protect private memory by default

## Sources

- Supabase semantic search docs: https://supabase.com/docs/guides/ai/semantic-search
- Supabase pgvector docs: https://supabase.com/docs/guides/database/extensions/pgvector
- PostgreSQL row security docs: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
