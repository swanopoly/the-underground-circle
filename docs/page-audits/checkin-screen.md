# CheckInScreen Audit
Source: `src/screens/checkin/CheckInScreen.tsx`
Last audited: 2026-04-03
Status: Needs fixes.

## Findings
- Medium: proof validation is presented as a real action, but it is not persisted anywhere yet. See `src/screens/checkin/CheckInScreen.tsx:366-378`.
- Medium: users still receive XP for proof validation even though the validation path is currently a placeholder. See `src/screens/checkin/CheckInScreen.tsx:370-377`. That can create misleading trust signals and reward inflation.

