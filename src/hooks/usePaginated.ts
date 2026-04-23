/**
 * usePaginated — minimal, query-shape-agnostic pagination hook.
 *
 * Wraps any async "fetch rows for a range" function in a `hasMore` /
 * `loadMore` / `refresh` interface. Designed to pair with Supabase
 * `.range(from, to)` but doesn't depend on it, so the same hook works for
 * REST, fetch, or any cursor-ish backend.
 *
 * Not a replacement for React Query — intentionally tiny. Use this for lists
 * that were previously hardcoded to `.limit(50)` and will quietly truncate as
 * circles grow (members, challenges, missions feeds, etc.).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type UsePaginatedOptions<Row> = {
  /**
   * Stable identity for this paginated list. When this key changes (e.g. the
   * user switches circles) the hook resets and refetches from page 0. Strings
   * are compared via `JSON.stringify` so array keys like `['members', id]`
   * work.
   */
  key: unknown[] | string;
  /** Number of rows to request per page. Defaults to 25. */
  pageSize?: number;
  /**
   * Fetch a single page. `from`/`to` are zero-indexed row offsets (inclusive),
   * matching Supabase's `.range()` semantics. Return `rows` *as received*; the
   * hook decides `hasMore` by comparing returned length to pageSize.
   */
  fetchPage: (from: number, to: number) => Promise<{ rows: Row[]; error?: unknown }>;
  /**
   * Called once per unique `key` after the first successful fetch. Useful for
   * lazy-initialising counters (e.g. "42 members total") without a second
   * query. Receives the total count if the backend returned one (Supabase's
   * `count` meta) — otherwise omitted.
   */
  onFirstLoad?: (rows: Row[]) => void;
  /** Skip the automatic first-page fetch. Caller must invoke refresh(). */
  manual?: boolean;
};

export type UsePaginatedResult<Row> = {
  rows: Row[];
  loading: boolean;
  loadingMore: boolean;
  error: unknown | null;
  hasMore: boolean;
  /** Fetch the next page and append. No-op when already loading or no more rows. */
  loadMore: () => Promise<void>;
  /** Reset to page 0 and refetch. */
  refresh: () => Promise<void>;
  /** Total number of rows currently in state. */
  count: number;
};

function stringifyKey(key: unknown[] | string): string {
  return typeof key === 'string' ? key : JSON.stringify(key);
}

export function usePaginated<Row>(opts: UsePaginatedOptions<Row>): UsePaginatedResult<Row> {
  const { pageSize = 25, fetchPage, onFirstLoad, manual } = opts;
  const keyStr = useMemo(() => stringifyKey(opts.key), [opts.key]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Latest versions of the inputs, accessed inside async closures so stale
  // renders don't write into newer state.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const firstLoadCalledRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async (mode: 'refresh' | 'append') => {
    const gen = ++generationRef.current;
    if (mode === 'refresh') {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    const from = mode === 'refresh' ? 0 : rows.length;
    const to = from + pageSize - 1;

    try {
      const { rows: fetched, error: fetchError } = await fetchPageRef.current(from, to);
      if (gen !== generationRef.current) return; // stale response — ignore

      if (fetchError) {
        setError(fetchError);
        if (mode === 'refresh') setRows([]);
        setHasMore(false);
        return;
      }

      setHasMore(fetched.length >= pageSize);
      if (mode === 'refresh') {
        setRows(fetched);
        if (onFirstLoad && firstLoadCalledRef.current !== keyStr) {
          firstLoadCalledRef.current = keyStr;
          onFirstLoad(fetched);
        }
      } else {
        setRows(prev => [...prev, ...fetched]);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e);
      setHasMore(false);
    } finally {
      if (gen === generationRef.current) {
        if (mode === 'refresh') setLoading(false);
        else setLoadingMore(false);
      }
    }
  // `rows` only used to derive offset for `append`; tracking via state is fine.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr, pageSize, onFirstLoad, rows.length]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    await load('append');
  }, [load, loading, loadingMore, hasMore]);

  // Auto-fetch on first render + whenever the stable key changes.
  useEffect(() => {
    if (manual) return;
    firstLoadCalledRef.current = null;
    void load('refresh');
  // load is stable enough; keyStr is the real dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr, manual]);

  return { rows, loading, loadingMore, error, hasMore, loadMore, refresh, count: rows.length };
}
