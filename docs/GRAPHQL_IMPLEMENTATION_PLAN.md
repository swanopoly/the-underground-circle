# GraphQL Implementation Plan

## Current build status

- GitHub GraphQL is implemented server-side in `supabase/functions/_shared/github-graphql.ts`.
- `github-oauth?action=list_repos` now prefers GitHub GraphQL and falls back to REST.
- Shared app-side provider GraphQL helper is available in `src/lib/integrations/graphqlClient.ts`.
- Linear and Shopify connector adapters now have GraphQL-based credential tests and action manifests.

## Rules

- Keep user/provider secrets on Edge Functions or connector backends. Do not expose arbitrary provider GraphQL tokens to general UI code.
- Use GraphQL for aggregate read surfaces and provider-native APIs.
- Keep Supabase Realtime for live event streams.
- Keep vault reveal/use behind RPC or Edge Functions with explicit audit, approval, purpose, and scoped grants.
- Prefer allowlisted/persisted operations for any first-party GraphQL exposed to clients.
- Track query cost/rate-limit metadata for GitHub and Shopify.

## Build order

1. GitHub GraphQL repo summaries.
2. GitHub PR/issue dashboard query for Office and Chat.
3. Linear OAuth plus issue/project/cycle GraphQL connector.
4. Shopify Admin GraphQL connector for products, orders, and store automation playbooks.
5. Office GraphQL/BFF aggregate query for command center data if current Supabase calls become too fragmented.
6. Query allowlist, cost logging, and regression tests for all provider GraphQL operations.

## Do not migrate

- Vault secrets and credential reveal.
- Simple Supabase CRUD screens.
- Supabase Realtime subscriptions.
- Webhook ingestion handlers.
