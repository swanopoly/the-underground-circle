# LoginScreen Audit
Source: `src/screens/auth/LoginScreen.tsx`
Last audited: 2026-04-03
Status: Needs fixes.

## Findings
- High: the page currently contributes multiple TypeScript build failures tied to invalid React Native style values and ref typing around the login form. See `src/screens/auth/LoginScreen.tsx:230-246` and `src/screens/auth/LoginScreen.tsx:343-424`.
- High: the page renders a raw `<div>` inside the RN tree for the shimmer effect on web. See `src/screens/auth/LoginScreen.tsx:407-413`. That breaks the RN abstraction and is part of the current typecheck failure surface.
- Medium: the page relies on direct DOM mutation and one-time global CSS injection. See `src/screens/auth/LoginScreen.tsx:26-61` and `src/screens/auth/LoginScreen.tsx:126-140`. That makes the screen fragile across RN web rendering changes.

