/**
 * Pure/source smoke for the user-owned model credential boundary.
 *
 * Run:
 *   deno test --allow-env --allow-read scripts/model-credential-policy-smoketest.ts
 */

import {
  byokMissingMessage,
  byokUnreadableMessage,
  resolveUserModelApiKey,
  StoredApiKeyLookupError,
} from "../supabase/functions/_shared/edge.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`model credential policy smoke failed: ${message}`);
  }
}

function rpcClient(
  resolve: (
    name: string,
    args: Record<string, unknown>,
  ) =>
    | { data: unknown; error: unknown }
    | Promise<{ data: unknown; error: unknown }>,
) {
  return { rpc: resolve };
}

function restoreEnv(name: string, prior: string | undefined): void {
  if (prior === undefined) Deno.env.delete(name);
  else Deno.env.set(name, prior);
}

Deno.test("user_required resolves only the explicit or authenticated user's credential", async () => {
  const allowAllName = "ALLOW_PLATFORM_MODEL_KEYS_FOR_ALL";
  const platformKeyName = "ANTHROPIC_API_KEY";
  const priorAllowAll = Deno.env.get(allowAllName);
  const priorPlatformKey = Deno.env.get(platformKeyName);

  try {
    Deno.env.set(allowAllName, "true");
    Deno.env.set(platformKeyName, "platform-test-key");

    let explicitRpcCalls = 0;
    const explicit = await resolveUserModelApiKey({
      supabase: rpcClient(() => {
        explicitRpcCalls += 1;
        return { data: null, error: null };
      }),
      userId: "authenticated-user",
      provider: "anthropic",
      requestApiKey: "  request-test-key  ",
      envVarName: platformKeyName,
      credentialPolicy: "user_required",
    });
    check(explicit?.source === "request", "an explicit request key wins");
    check(
      explicit.apiKey === "request-test-key",
      "the explicit key is trimmed",
    );
    check(explicitRpcCalls === 0, "an explicit key bypasses stored-key lookup");

    const latestCapture: { args?: Record<string, unknown> } = {};
    const latest = await resolveUserModelApiKey({
      supabase: rpcClient((name, args) => {
        check(name === "get_user_api_key", "uses the canonical stored-key RPC");
        latestCapture.args = args;
        return {
          data: [{ api_key: "latest-user-key", endpoint: null }],
          error: null,
        };
      }),
      userId: "authenticated-user",
      provider: "anthropic",
      label: null,
      envVarName: platformKeyName,
      credentialPolicy: "user_required",
    });
    check(latest?.source === "user", "the authenticated user's key is used");
    check(latest.apiKey === "latest-user-key", "the stored key is returned");
    check(
      latestCapture.args?.p_user_id === "authenticated-user",
      "lookup pins the authenticated user",
    );
    check(
      latestCapture.args?.p_provider === "anthropic",
      "lookup pins the exact provider",
    );
    check(
      latestCapture.args?.p_label === null,
      "explicit null selects the latest active provider row",
    );

    const defaultCapture: { args?: Record<string, unknown> } = {};
    await resolveUserModelApiKey({
      supabase: rpcClient((_name, args) => {
        defaultCapture.args = args;
        return { data: null, error: null };
      }),
      userId: "authenticated-user",
      provider: "anthropic",
      credentialPolicy: "user_required",
    });
    check(
      defaultCapture.args?.p_label === "default",
      "an omitted label preserves the default-row contract",
    );

    const missingUserKey = await resolveUserModelApiKey({
      supabase: rpcClient(() => ({ data: null, error: null })),
      userId: "authenticated-user",
      provider: "anthropic",
      label: null,
      envVarName: platformKeyName,
      credentialPolicy: "user_required",
    });
    check(
      missingUserKey === null,
      "user_required never falls back to an available platform key",
    );

    const compatibleDefault = await resolveUserModelApiKey({
      supabase: rpcClient(() => ({ data: null, error: null })),
      userId: "authenticated-user",
      provider: "anthropic",
      envVarName: platformKeyName,
    });
    check(
      compatibleDefault?.source === "platform",
      "the omitted policy preserves legacy allowlisted fallback",
    );

    let corruption: unknown = null;
    try {
      await resolveUserModelApiKey({
        supabase: rpcClient(() => ({
          data: null,
          error: { message: "ciphertext failure" },
        })),
        userId: "authenticated-user",
        provider: "anthropic",
        label: null,
        envVarName: platformKeyName,
        credentialPolicy: "user_required",
      });
    } catch (error) {
      corruption = error;
    }
    check(
      corruption instanceof StoredApiKeyLookupError,
      "unreadable user ciphertext throws instead of using the platform key",
    );

    check(
      byokMissingMessage("anthropic") ===
        "Connect your Anthropic API key in Marketplace → Models, then retry.",
      "missing-key recovery points to the current Marketplace surface",
    );
    check(
      byokUnreadableMessage("anthropic") ===
        "Your saved Anthropic API key could not be read. Replace it in Marketplace → Models, then retry.",
      "unreadable-key recovery points to Replace key on the provider card",
    );
  } finally {
    restoreEnv(allowAllName, priorAllowAll);
    restoreEnv(platformKeyName, priorPlatformKey);
  }
});

Deno.test("user_required preserves canonical-first legacy provider-key compatibility", async () => {
  const canonicalCalls: string[] = [];
  const canonical = await resolveUserModelApiKey({
    supabase: rpcClient((_name, args) => {
      const provider = String(args.p_provider || "");
      canonicalCalls.push(provider);
      return provider === "huggingface"
        ? {
          data: [{ api_key: "canonical-hf-key", endpoint: null }],
          error: null,
        }
        : { data: [{ api_key: "legacy-hf-key", endpoint: null }], error: null };
    }),
    userId: "authenticated-user",
    provider: "huggingface",
    label: null,
    credentialPolicy: "user_required",
  });
  check(
    canonical?.apiKey === "canonical-hf-key",
    "the canonical Hugging Face row wins",
  );
  check(
    JSON.stringify(canonicalCalls) === JSON.stringify(["huggingface"]),
    "a canonical hit does not query the legacy Hugging Face alias",
  );

  for (
    const testCase of [
      {
        canonical: "huggingface",
        legacy: "hugging_face",
        key: "legacy-hf-key",
      },
      { canonical: "zai", legacy: "z_ai", key: "legacy-zai-key" },
    ]
  ) {
    const calls: string[] = [];
    const resolved = await resolveUserModelApiKey({
      supabase: rpcClient((_name, args) => {
        const provider = String(args.p_provider || "");
        calls.push(provider);
        return provider === testCase.legacy
          ? { data: [{ api_key: testCase.key, endpoint: null }], error: null }
          : { data: null, error: null };
      }),
      userId: "authenticated-user",
      provider: testCase.canonical,
      label: null,
      credentialPolicy: "user_required",
    });
    check(
      resolved?.source === "user" && resolved.apiKey === testCase.key,
      `${testCase.canonical} uses its legacy row after a clean canonical miss`,
    );
    check(
      JSON.stringify(calls) ===
        JSON.stringify([testCase.canonical, testCase.legacy]),
      `${testCase.canonical} lookup order is canonical then legacy`,
    );
  }

  const missingCalls: string[] = [];
  const missing = await resolveUserModelApiKey({
    supabase: rpcClient((_name, args) => {
      missingCalls.push(String(args.p_provider || ""));
      return { data: null, error: null };
    }),
    userId: "authenticated-user",
    provider: "huggingface",
    label: null,
    envVarName: "HF_TOKEN",
    credentialPolicy: "user_required",
  });
  check(
    missing === null,
    "missing canonical and legacy rows do not use a platform key",
  );
  check(
    JSON.stringify(missingCalls) ===
      JSON.stringify(["huggingface", "hugging_face"]),
    "a clean double miss performs only the two stored-key lookups",
  );

  for (const failProvider of ["huggingface", "hugging_face"]) {
    const calls: string[] = [];
    let failure: unknown = null;
    try {
      await resolveUserModelApiKey({
        supabase: rpcClient((_name, args) => {
          const provider = String(args.p_provider || "");
          calls.push(provider);
          return provider === failProvider
            ? { data: null, error: { message: "ciphertext failure" } }
            : { data: null, error: null };
        }),
        userId: "authenticated-user",
        provider: "huggingface",
        label: null,
        envVarName: "HF_TOKEN",
        credentialPolicy: "user_required",
      });
    } catch (error) {
      failure = error;
    }
    const expectedCalls = failProvider === "huggingface"
      ? ["huggingface"]
      : ["huggingface", "hugging_face"];
    check(
      failure instanceof StoredApiKeyLookupError,
      `${failProvider} lookup error remains terminal`,
    );
    check(
      JSON.stringify(calls) === JSON.stringify(expectedCalls),
      `${failProvider} lookup error stops before any later credential source`,
    );
  }
});

Deno.test("public chat edges pin structured user-owned credential failures", async () => {
  const chatSource = await Deno.readTextFile(
    new URL("../supabase/functions/chat-stream/index.ts", import.meta.url),
  );
  const proxySource = await Deno.readTextFile(
    new URL("../supabase/functions/llm-proxy/index.ts", import.meta.url),
  );
  const sharedSource = await Deno.readTextFile(
    new URL("../supabase/functions/_shared/edge.ts", import.meta.url),
  );

  const userRequiredExit = sharedSource.indexOf(
    'if (credentialPolicy === "user_required") return null',
  );
  const platformEnvRead = sharedSource.indexOf(
    "const platformKey = opts.envVarName ? Deno.env.get(opts.envVarName) : null",
  );
  check(
    userRequiredExit >= 0 && platformEnvRead > userRequiredExit,
    "the user-required exit precedes every platform environment read",
  );
  check(
    (chatSource.match(/credentialPolicy: "user_required"/g) || []).length ===
        1 &&
      (chatSource.match(/label: null/g) || []).length === 1,
    "chat-stream selects the latest active Anthropic key under user_required",
  );
  check(
    !chatSource.includes("envVarName:"),
    "chat-stream does not offer a platform key name",
  );
  check(
    /credentialErrorResponse\(\s*409,\s*"credential_unreadable",\s*byokUnreadableMessage\("anthropic"\)/s
      .test(chatSource),
    "chat-stream emits a structured 409 for unreadable credentials",
  );
  check(
    /credentialErrorResponse\(\s*400,\s*"key_missing",\s*byokMissingMessage\("anthropic"\)/s
      .test(chatSource),
    "chat-stream emits a structured 400 for a missing Anthropic key",
  );
  check(
    (proxySource.match(/credentialPolicy: "user_required"/g) || []).length ===
        3 &&
      (proxySource.match(/label: null/g) || []).length === 3,
    "all public llm-proxy catalog, embedding, and chat credential paths select the user's latest active key",
  );
  check(
    !proxySource.includes("envVarName"),
    "llm-proxy does not offer platform fallback",
  );
  check(
    proxySource.includes(
      '"credential_unreadable",\n      byokUnreadableMessage(),',
    ),
    "llm-proxy returns the shared Marketplace recovery copy",
  );
});
