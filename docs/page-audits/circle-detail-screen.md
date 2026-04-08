# CircleDetailScreen Audit
Source: `src/screens/circles/CircleDetailScreen.tsx`
Last audited: 2026-04-03
Status: Watch.

## Findings
- Medium: the page persists active tab and cached circle data directly in raw `localStorage`/`AsyncStorage` with no versioning or freshness guard. See `src/screens/circles/CircleDetailScreen.tsx:52-92`.
- Low: cached circle payloads can become stale across schema or membership changes because the cache format has no invalidation strategy beyond best-effort overwrite.

