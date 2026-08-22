/**
 * Optimized query hooks for Supabase queries with pagination, caching, and error handling
 * Provides consistent query patterns across the app for better performance
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { indexSafeProfiles, loadSafeCircleProfiles, type SafeProfile } from '../lib/safeProfiles';

export interface QueryOptions {
  pageSize?: number;
  initialLoad?: boolean;
  realtime?: boolean;
}

export interface QueryResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  total?: number;
}

export function useOptimizedQuery<T>(
  tableName: string,
  selectQuery: string,
  filterFn?: (query: any) => any,
  options: QueryOptions = {}
): QueryResult<T> {
  const {
    pageSize = 50,
    initialLoad = true,
    realtime = false
  } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | undefined>();
  const [page, setPage] = useState(0);

  const fetchData = useCallback(async (pageNum: number, append: boolean = false) => {
    try {
      setError(null);
      if (!append) setLoading(true);

      let query = supabase
        .from(tableName)
        .select(selectQuery);

      // Apply custom filters
      if (filterFn) {
        query = filterFn(query);
      }

      // Add pagination
      query = query
        .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1)
        .limit(pageSize);

      const { data: result, error: queryError, count } = await query;

      if (queryError) {
        throw queryError;
      }

      const newData = (result as T[]) || [];
      
      if (append) {
        setData(prev => [...prev, ...newData]);
      } else {
        setData(newData);
      }

      // Update pagination state
      setHasMore(newData.length === pageSize);
      setPage(pageNum);
      
      if (count !== null) {
        setTotal(count);
      }

    } catch (err: any) {
      console.error(`Error fetching ${tableName}:`, err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tableName, selectQuery, filterFn, pageSize]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    await fetchData(page + 1, true);
  }, [page, hasMore, loading, fetchData]);

  const refresh = useCallback(async () => {
    setPage(0);
    await fetchData(0, false);
  }, [fetchData]);

  // Initial load
  useEffect(() => {
    if (initialLoad) {
      fetchData(0);
    }
  }, [fetchData, initialLoad]);

  // Real-time subscriptions
  useEffect(() => {
    if (!realtime) return;

    const channel = supabase
      .channel(`${tableName}_changes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        () => {
          refresh().catch(err => console.error('Error refreshing from realtime:', err));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableName, realtime, refresh]);

  return {
    data,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    total
  };
}

function useCircleProfileHydration<T extends { user_id: string }>(
  circleId: string,
  base: QueryResult<T>,
): QueryResult<T & { user: SafeProfile | null }> {
  const [hydrated, setHydrated] = useState<Array<T & { user: SafeProfile | null }>>([]);
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    loadSafeCircleProfiles({ circleId, userIds: base.data.map(row => row.user_id) })
      .then(rows => {
        if (cancelled) return;
        const profileById = indexSafeProfiles(rows);
        setHydrated(base.data.map(row => ({ ...row, user: profileById.get(row.user_id) || null })));
      })
      .catch(() => { if (!cancelled) setHydrated([]); })
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [base.data, circleId]);

  return { ...base, data: hydrated, loading: base.loading || hydrating };
}

// Specialized hook for user's circles
export function useUserCircles() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    }).catch(() => {
      setUserId(null);
    });
  }, []);

  return useOptimizedQuery(
    'circles',
    `
      *,
      circle_members!inner(count),
      circle_members!inner(role)
    `,
    (query) => {
      if (!userId) return query.eq('id', 'never-match'); // Don't load if no user
      return query
        .eq('circle_members.user_id', userId)
        .order('created_at', { ascending: false });
    },
    { pageSize: 20, realtime: true }
  );
}

// Specialized hook for circle check-ins
export function useCircleCheckIns(circleId: string) {
  const base = useOptimizedQuery<{ user_id: string }>(
    'check_ins',
    '*',
    (query) => query
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false }),
    { pageSize: 30, realtime: true }
  );
  return useCircleProfileHydration(circleId, base);
}

// Specialized hook for circle members
export function useCircleMembers(circleId: string) {
  const base = useOptimizedQuery<{ user_id: string }>(
    'circle_members',
    '*',
    (query) => query
      .eq('circle_id', circleId)
      .order('joined_at', { ascending: true }),
    { pageSize: 100, realtime: true }
  );
  return useCircleProfileHydration(circleId, base);
}
