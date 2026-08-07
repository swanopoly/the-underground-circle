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
        2 &&
      (proxySource.match(/label: null/g) || []).length === 2,
    "both public llm-proxy credential paths select the user's latest active key",
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
