# RoomsTab Audit
Source: `src/screens/circles/tabs/RoomsTab.tsx`
Last audited: 2026-04-03
Status: Needs fixes.

## Findings
- High: the page currently contributes TypeScript build failures through missing style keys used by the chat panel. See `src/screens/circles/tabs/RoomsTab.tsx:2147-2149` and the current `tsc` output for `assignToggle` / `assignToggleText`.
- Medium: the page has a very large web-only DOM and raw `localStorage` surface. Examples include `src/screens/circles/tabs/RoomsTab.tsx:43-46`, `src/screens/circles/tabs/RoomsTab.tsx:833-849`, and `src/screens/circles/tabs/RoomsTab.tsx:2950-2960`. That creates a high regression risk across RN web and makes platform separation difficult.

