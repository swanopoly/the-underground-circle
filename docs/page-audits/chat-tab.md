# ChatTab Audit
Source: `src/screens/circles/tabs/ChatTab.tsx`
Last audited: 2026-04-03
Status: Needs fixes.

## Findings
- High: the page accesses `localStorage` as a bare global inside runtime logic. See `src/screens/circles/tabs/ChatTab.tsx:339-345`. On native runtimes that identifier is not guaranteed to exist, which can throw before optional chaining helps.
- Medium: the page also injects and manipulates DOM/CSS directly on web. See `src/screens/circles/tabs/ChatTab.tsx:3166-3179`. That increases RN web fragility and should stay isolated behind explicit web-only helpers.

