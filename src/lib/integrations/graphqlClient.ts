export interface ProviderGraphqlResult<TData> {
  data: TData | null;
  error?: string;
  status: number;
  headers: Record<string, string>;
}

export interface ProviderGraphqlOptions {
  endpoint: string;
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  authHeader?: 'bearer' | 'raw' | 'none';
  timeoutMs?: number;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

function parseGraphqlError(errors: unknown): string | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors
    .map((error) => {
      if (error && typeof error === 'object' && 'message' in error) return String((error as any).message || '');
      return String(error || '');
    })
    .filter(Boolean)
    .join('; ') || 'GraphQL request failed.';
}

export async function providerGraphql<TData>({
  endpoint,
  token,
  query,
  variables,
  headers = {},
  authHeader = 'bearer',
  timeoutMs = 10_000,
}: ProviderGraphqlOptions): Promise<ProviderGraphqlResult<TData>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const authHeaders: Record<string, string> = {};
  if (authHeader === 'bearer') authHeaders.Authorization = `Bearer ${token}`;
  if (authHeader === 'raw') authHeaders.Authorization = token;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders,
        ...headers,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: controller?.signal,
    });
    const payload = await res.json().catch(() => null) as { data?: TData; errors?: unknown } | null;
    const graphqlError = parseGraphqlError(payload?.errors);
    return {
      data: payload?.data || null,
      error: graphqlError || (res.ok ? undefined : `HTTP ${res.status}`),
      status: res.status,
      headers: headersToRecord(res.headers),
    };
  } catch (error: any) {
    return {
      data: null,
      error: error?.name === 'AbortError' ? 'GraphQL request timed out.' : error?.message || 'GraphQL request failed.',
      status: 0,
      headers: {},
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
