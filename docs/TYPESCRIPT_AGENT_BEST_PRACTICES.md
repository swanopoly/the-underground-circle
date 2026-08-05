# TypeScript Agent Best Practices

**Last researched:** 2026-05-28

This is the TypeScript standard for agents contributing to The Underground
Circle. It applies to app code, shared libraries, chat automation, desktop and
browser bridges, wiki data, and agent runtime TypeScript. Supabase edge
functions have their own typecheck, but should follow the same modeling rules.
For general coding, security, review, and handoff rules, also read
`docs/CODING_AGENT_BEST_PRACTICES.md`.

The current app baseline is Expo / React Native with TypeScript `~5.9.2`,
`strict: true`, and an app typecheck at:

```sh
npm run typecheck:app
```

## Core Rules

1. Keep `strict` as the floor.
   Do not loosen `tsconfig.json`, add broad `skip` flags, or hide errors with
   unchecked casts. If a third-party type is wrong, isolate the workaround next
   to the integration and explain why it is safe.

2. Treat boundaries as untrusted.
   Chat messages, bridge responses, desktop automation output, Supabase rows,
   local storage, JSON files, URL params, and provider responses should enter as
   `unknown` or a typed transport DTO, then be narrowed before use.

3. Prefer precise domain types over generic records.
   Agent runtime code should model surfaces, routes, recovery options, tool
   calls, approvals, and execution states as literal unions or discriminated
   unions. Avoid `Record<string, any>` for product state.

4. Use discriminated unions for state machines.
   A status flag plus optional fields is usually weaker than a union where each
   state carries exactly the fields it needs.

5. Narrow before acting.
   Use control-flow checks, type guards, `in` checks, `Array.isArray`, and
   equality narrowing. Avoid non-null assertions unless a preceding guard makes
   the invariant obvious in the same function.

6. Use `unknown`, not `any`, for values that still need proof.
   `any` disables type checking at the exact places agents most often make
   mistakes. If `any` is unavoidable for a third-party escape hatch, localize it
   to one line and convert it back into a typed value immediately.

7. Make exhaustiveness explicit.
   Switch on discriminants and force a `never` check in the default branch so new
   route kinds or tool states fail at typecheck time.

8. Use `satisfies` for checked literals.
   Prefer `const routes = { ... } satisfies Record<RouteKind, RouteConfig>` when
   the object should be checked against a contract without losing useful literal
   inference.

9. Use type-only imports for types.
   Prefer `import type { Foo } from './foo'` when the import is erased at
   runtime. This keeps bundling and side effects predictable.

10. Design as if stricter indexed and optional checks are enabled.
    Even though this repo does not currently enable every strictness flag, write
    new code so it would survive `noUncheckedIndexedAccess` and
    `exactOptionalPropertyTypes`: check array indexes, provide fallbacks for map
    lookups, and distinguish an omitted optional property from a property set to
    `undefined`.

## Result And Error Modeling

Do not make UI, chat, or agent runtime code infer failure type from free-form
strings when a typed result can carry the same information.

```ts
type DesktopBridgeErrorCode =
  | 'bridge_unreachable'
  | 'permission_required'
  | 'unsupported_app'
  | 'operation_failed';

type DesktopBridgeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: DesktopBridgeErrorCode;
      message: string;
      retryable: boolean;
      userActionRequired: boolean;
    };

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

function describeBridgeResult<T>(result: DesktopBridgeResult<T>): string {
  if (result.ok) return 'Desktop bridge completed the request.';

  switch (result.code) {
    case 'bridge_unreachable':
      return 'Start or repair the desktop bridge before retrying.';
    case 'permission_required':
      return 'Grant the required local permission, then retry.';
    case 'unsupported_app':
      return 'Choose another app route or create an app adapter first.';
    case 'operation_failed':
      return result.message;
    default:
      return assertNever(result.code);
  }
}
```

## Boundary Parsing Pattern

Use a small parser or normalizer at every trust boundary, then keep the rest of
the code typed.

```ts
type AppAutomationSurface = 'browser' | 'desktop' | 'file' | 'hybrid';

interface AppAutomationRequest {
  surface: AppAutomationSurface;
  userText: string;
  requiresApproval: boolean;
}

function isAutomationSurface(value: unknown): value is AppAutomationSurface {
  return value === 'browser' || value === 'desktop' || value === 'file' || value === 'hybrid';
}

function parseAutomationRequest(input: unknown): AppAutomationRequest | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as { surface?: unknown; userText?: unknown; requiresApproval?: unknown };

  if (!isAutomationSurface(value.surface)) return null;
  if (typeof value.userText !== 'string' || value.userText.trim().length === 0) return null;

  return {
    surface: value.surface,
    userText: value.userText.trim(),
    requiresApproval: value.requiresApproval === true,
  };
}
```

## React Native And Expo Rules

- Type component props with named interfaces when the props are reused or
  non-trivial.
- Keep hooks typed at the boundary: navigation params, route params, async
  loaders, context values, and callback payloads.
- Avoid putting JSX in pure runtime modules. Shared logic under `src/lib` should
  stay testable from `tsx` smoke scripts without importing React Native UI.
- Keep UI state and runtime state separate. UI display labels should not be the
  discriminants used by planner, bridge, or execution logic.
- Use Expo's generated environment types and the local app typecheck instead of
  adding global ambient declarations for convenience.

## Agent Runtime Rules

- Extend the existing canonical owner before creating a parallel path. Check
  `docs/AGENTS_ROADMAP.md` first.
- For planner and route code, make the return type explicit. A changed union
  should force all callers and smoke tests to acknowledge the new case.
- For bridge and app-control code, type the receipt, proof, blocker, and
  recovery path. The chat should render useful user choices without parsing a
  raw exception string.
- For provider and model routing, keep provider ids, model ids, billing modes,
  and fallback reasons as literal types or validated strings.
- For SQL-backed data, map rows into app DTOs before handing them to UI or
  runtime planners. Do not let nullable database shape leak through the whole
  app unless the UI truly needs it.
- For Supabase functions, run the function typecheck when the edited path is
  under `supabase/functions` or shared with edge code:

```sh
npm run typecheck:functions
```

## Agent Edit Checklist

Before editing:

- Read the local types and the owning roadmap entry.
- Search for the existing union, helper, parser, or smoke test before adding a
  new one.
- Decide which trust boundary needs validation.

While editing:

- Add or extend the narrowest domain type.
- Parse `unknown` once at the boundary.
- Use discriminated unions for multi-state flows.
- Keep casts local and justified.
- Prefer `import type` for erased imports.
- Add a focused smoke test when the behavior is planner, bridge, route,
  approval, recovery, provider, or persistence logic.

Before handing back:

```sh
npm run typecheck:app
git diff --check
```

Also run the targeted smoke for the changed behavior. If the change touches
Supabase functions, run `npm run typecheck:functions`.

## Review Checklist

When reviewing TypeScript changes, look for:

- New `any`, `as any`, double casts, or unguarded `JSON.parse`.
- Non-null assertions that are not dominated by an obvious guard.
- Optional fields that actually represent separate states.
- Index lookups used without a fallback or guard.
- UI strings used as runtime discriminants.
- Planner or bridge failures represented only as free-form text.
- New files that duplicate a canonical owner in `docs/AGENTS_ROADMAP.md`.
- Missing smoke coverage for changed automation, route, bridge, approval,
  recovery, provider, or persistence behavior.

## Sources To Recheck

- TypeScript Handbook:
  [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html),
  [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html),
  [Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html),
  [Objects](https://www.typescriptlang.org/docs/handbook/2/objects.html),
  [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html), and
  [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html).
- TypeScript TSConfig reference:
  [`strict`](https://www.typescriptlang.org/tsconfig/strict.html),
  [`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html),
  [`exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html),
  and [`noImplicitOverride`](https://www.typescriptlang.org/tsconfig/noImplicitOverride.html).
- [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
  before adopting new syntax or config behavior.
- typescript-eslint:
  [recommended type-checked configs](https://typescript-eslint.io/users/configs/),
  [`no-explicit-any`](https://typescript-eslint.io/rules/no-explicit-any/), and
  [`consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports/).
- [Expo TypeScript guide](https://docs.expo.dev/guides/typescript/) for Expo /
  React Native project typing.
- [React TypeScript guide](https://react.dev/learn/typescript) for component and
  hook typing patterns.
