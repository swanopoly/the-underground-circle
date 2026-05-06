export interface GraphqlRateLimit {
  limit?: number;
  remaining?: number;
  used?: number;
  resetAt?: string;
  cost?: number;
}

export interface GraphqlResult<TData> {
  data: TData | null;
  error: string | null;
  errors?: Array<{ message?: string; path?: Array<string | number> }>;
  status: number;
  rateLimit?: GraphqlRateLimit;
  headers: Record<string, string>;
}

interface ExecuteGraphqlOptions {
  endpoint: string;
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

function formatGraphqlErrors(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors
    .map((err) => {
      if (err && typeof err === "object" && "message" in err) return String((err as any).message || "");
      return String(err || "");
    })
    .filter(Boolean)
    .join("; ") || "GraphQL request failed.";
}

export async function executeGraphql<TData>({
  endpoint,
  token,
  query,
  variables,
  headers = {},
  timeoutMs = 10_000,
}: ExecuteGraphqlOptions): Promise<GraphqlResult<TData>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: controller.signal,
    });

    const responseHeaders = headersToRecord(res.headers);
    const payload = await res.json().catch(() => null) as {
      data?: TData;
      errors?: Array<{ message?: string; path?: Array<string | number> }>;
    } | null;
    const graphqlError = formatGraphqlErrors(payload?.errors);
    const httpError = res.ok ? null : `HTTP ${res.status}`;

    return {
      data: payload?.data || null,
      error: graphqlError || httpError,
      errors: payload?.errors,
      status: res.status,
      rateLimit: payload?.data && typeof payload.data === "object" && "rateLimit" in payload.data
        ? (payload.data as any).rateLimit
        : undefined,
      headers: responseHeaders,
    };
  } catch (error: any) {
    return {
      data: null,
      error: error?.name === "AbortError" ? "GraphQL request timed out." : error?.message || "GraphQL request failed.",
      status: 0,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}
