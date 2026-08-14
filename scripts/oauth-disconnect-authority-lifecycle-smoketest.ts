/**
 * Runtime/source contract for lifecycle-safe destructive OAuth disconnects.
 *
 * The module is transpiled in-memory with authSession replaced by a bounded
 * test double. This keeps the smoke independent of React Native while still
 * executing the real disconnect implementations.
 *
 * Run:
 *   npx tsx scripts/oauth-disconnect-authority-lifecycle-smoketest.ts
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src", "lib", "oauthConnect.ts"),
  "utf8",
);
const officeSource = fs.readFileSync(
  path.join(root, "src", "screens", "circles", "tabs", "OfficeTab.tsx"),
  "utf8",
);
const customizeSource = fs.readFileSync(
  path.join(root, "src", "screens", "circles", "tabs", "office", "CustomizePanel.tsx"),
  "utf8",
);

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition)
    throw new Error(
      `OAuth disconnect authority lifecycle smoke failed: ${message}`,
    );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type OAuthRuntime = {
  disconnectOAuth: (
    provider: "google" | "microsoft",
    jwt?: string,
    isAuthorityCurrent?: () => boolean,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  disconnectFigmaOAuth: (
    jwt?: string,
    isAuthorityCurrent?: () => boolean,
    signal?: AbortSignal,
  ) => Promise<
    | { outcome: "disconnected"; disconnected: true }
    | { outcome: "unknown"; disconnected: false }
  >;
};

let freshBearer = "fresh-session-bearer";
let freshBearerReads = 0;
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: "oauthConnect.ts",
}).outputText;
const runtimeModule: { exports: Partial<OAuthRuntime> } = { exports: {} };
const evaluate = new Function("require", "module", "exports", output);
evaluate(
  (specifier: string) => {
    if (specifier !== "./authSession")
      throw new Error(`Unexpected test import: ${specifier}`);
    return {
      getFreshAccessToken: async () => {
        freshBearerReads += 1;
        return freshBearer;
      },
    };
  },
  runtimeModule,
  runtimeModule.exports,
);
const runtime = runtimeModule.exports as OAuthRuntime;

check(
  source.includes("export type OAuthAuthorityFence = () => boolean;"),
  "disconnect authority has an explicit lifecycle-fence type",
);
check(
  source.includes("callerSignal?: AbortSignal"),
  "destructive callers can retire work with an AbortSignal",
);
check(
  source.includes("if (isAuthorityCurrent && !capturedBearer) return null;"),
  "an exact mutation cannot fall through to a replacement global session",
);
check(
  source.includes(
    "return oauthAuthorityIsCurrent(isAuthorityCurrent, callerSignal) && disconnected;",
  ),
  "Office disconnect rechecks authority after its complete deadline operation",
);
check(
  source.includes(
    "return oauthAuthorityIsCurrent(isAuthorityCurrent, callerSignal)\n      ? result",
  ),
  "Figma disconnect rechecks authority after its complete deadline operation",
);

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    let officeFetches = 0;
    let officeInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      officeFetches += 1;
      officeInit = init;
      return { ok: true } as Response;
    }) as typeof fetch;

    const officeController = new AbortController();
    const officeResult = await runtime.disconnectOAuth(
      "google",
      "captured-office-bearer",
      () => true,
      officeController.signal,
    );
    check(officeResult, "a current Office authority can disconnect");
    check(
      officeFetches === 1,
      "a current Office disconnect dispatches exactly once",
    );
    check(
      (officeInit?.headers as Record<string, string>)?.Authorization ===
        "Bearer captured-office-bearer",
      "Office disconnect uses the explicitly captured bearer",
    );
    check(
      officeInit?.signal instanceof AbortSignal,
      "Office disconnect binds its request to cancellation",
    );
    check(
      JSON.parse(String(officeInit?.body)).provider === "google",
      "Office disconnect preserves the exact provider target",
    );
    check(
      freshBearerReads === 0,
      "exact Office disconnect never reads the global session",
    );

    officeFetches = 0;
    const retiredBeforeOffice = await runtime.disconnectOAuth(
      "microsoft",
      "retired-office-bearer",
      () => false,
      new AbortController().signal,
    );
    check(!retiredBeforeOffice, "a pre-retired Office authority fails closed");
    check(
      officeFetches === 0,
      "a pre-retired Office authority never reaches the server",
    );

    officeFetches = 0;
    const missingExactBearer = await runtime.disconnectOAuth(
      "google",
      undefined,
      () => true,
      new AbortController().signal,
    );
    check(
      !missingExactBearer,
      "an exact Office disconnect without its captured bearer fails closed",
    );
    check(officeFetches === 0, "a missing exact bearer cannot dispatch");
    check(
      freshBearerReads === 0,
      "a missing exact bearer cannot adopt the active global session",
    );

    const officeFetchStarted = deferred<void>();
    const officeFetchResponse = deferred<Response>();
    let officeCurrent = true;
    globalThis.fetch = (async () => {
      officeFetchStarted.resolve();
      return officeFetchResponse.promise;
    }) as typeof fetch;
    const retiringOffice = runtime.disconnectOAuth(
      "google",
      "retiring-office-bearer",
      () => officeCurrent,
      new AbortController().signal,
    );
    await officeFetchStarted.promise;
    officeCurrent = false;
    officeFetchResponse.resolve({ ok: true } as Response);
    check(
      !(await retiringOffice),
      "Office success arriving after authority retirement is discarded",
    );

    const abortController = new AbortController();
    const abortStarted = deferred<void>();
    let requestObservedAbort = false;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        abortStarted.resolve();
        init?.signal?.addEventListener(
          "abort",
          () => {
            requestObservedAbort = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      })) as typeof fetch;
    const abortedOffice = runtime.disconnectOAuth(
      "microsoft",
      "aborted-office-bearer",
      () => true,
      abortController.signal,
    );
    await abortStarted.promise;
    abortController.abort();
    check(
      !(await abortedOffice),
      "an aborted Office disconnect cannot report success",
    );
    check(
      requestObservedAbort,
      "caller cancellation aborts the active Office request",
    );

    let figmaInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      figmaInit = init;
      return {
        ok: true,
        json: async () => ({ disconnected: true }),
      } as Response;
    }) as typeof fetch;
    const figmaResult = await runtime.disconnectFigmaOAuth(
      "captured-figma-bearer",
      () => true,
      new AbortController().signal,
    );
    check(
      figmaResult.outcome === "disconnected",
      "a current Figma authority can disconnect",
    );
    check(
      (figmaInit?.headers as Record<string, string>)?.Authorization ===
        "Bearer captured-figma-bearer",
      "Figma disconnect uses the explicitly captured bearer",
    );
    check(
      figmaInit?.signal instanceof AbortSignal,
      "Figma disconnect binds its request to cancellation",
    );
    check(
      freshBearerReads === 0,
      "exact Figma disconnect never reads the global session",
    );

    const figmaJsonStarted = deferred<void>();
    const figmaJsonResult = deferred<{ disconnected: boolean }>();
    let figmaCurrent = true;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => {
          figmaJsonStarted.resolve();
          return figmaJsonResult.promise;
        },
      }) as Response) as typeof fetch;
    const retiringFigma = runtime.disconnectFigmaOAuth(
      "retiring-figma-bearer",
      () => figmaCurrent,
      new AbortController().signal,
    );
    await figmaJsonStarted.promise;
    figmaCurrent = false;
    figmaJsonResult.resolve({ disconnected: true });
    check(
      (await retiringFigma).outcome === "unknown",
      "Figma success arriving after authority retirement is discarded",
    );

    let legacyAuthorization = "";
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      legacyAuthorization =
        (init?.headers as Record<string, string>)?.Authorization || "";
      return { ok: true } as Response;
    }) as typeof fetch;
    freshBearer = "legacy-refreshed-bearer";
    const legacyResult = await runtime.disconnectOAuth("google");
    check(legacyResult, "legacy Office callers remain supported");
    check(
      freshBearerReads === 1,
      "legacy Office callers can still refresh the active session",
    );
    check(
      legacyAuthorization === "Bearer legacy-refreshed-bearer",
      "legacy Office disconnect uses its refreshed session bearer",
    );

    check(
      officeSource.includes("disconnectOAuth(\n        provider,\n        scope.accessToken,"),
      "Office Calendar and Email disconnects pass the captured bearer",
    );
    check(
      officeSource.includes("() => isServiceOAuthScopeCurrent(scope),\n        controller.signal,"),
      "Office Calendar and Email disconnects pass the exact fence and cancellation signal",
    );
    check(
      officeSource.includes("serviceOAuthDisconnectControllerRef.current?.controller.abort()"),
      "Office retires an in-flight disconnect controller with its UI or authority scope",
    );
    check(
      customizeSource.includes("disconnectFigmaOAuth(\n        authority.accessToken,"),
      "Customize passes the captured bearer to Figma disconnect",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(
    `OAuth disconnect authority lifecycle smoke passed (${assertions} assertions).`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
