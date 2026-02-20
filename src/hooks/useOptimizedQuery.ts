/**
 * Optimized query hooks for Supabase queries with pagination, caching, and error handling
 * Provides consistent query patterns across the app for better performance
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

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

// Specialized hook for user's circles
export function useUserCircles() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
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
  return useOptimizedQuery(
    'check_ins',
    '*, user:profiles(username, display_name)',
    (query) => query
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false }),
    { pageSize: 30, realtime: true }
  );
}

// Specialized hook for circle members
export function useCircleMembers(circleId: string) {
  return useOptimizedQuery(
    'circle_members',
    '*, user:profiles(username, display_name, avatar_url)',
    (query) => query
      .eq('circle_id', circleId)
      .order('joined_at', { ascending: true }),
    { pageSize: 100, realtime: true }
  );
}