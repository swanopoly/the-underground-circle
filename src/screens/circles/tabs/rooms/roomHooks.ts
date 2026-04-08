// roomHooks.ts — React hooks wrapping the room repository layer.
// Each hook manages loading state, error handling, and realtime subscription cleanup.

import { useState, useEffect, useCallback, useRef } from 'react';
import * as repo from './roomRepository';
import type { RoomSummary, RoomFile, RoomMessage, RoomSection } from './roomTypes';

// ─── useRoomList ─────────────────────────────────────────────────────────────

/** Load all rooms for a circle with aggregate counts. */
export function useRoomList(circleId: string | null) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!circleId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await repo.loadRooms(circleId);
      setRooms(data);
    } catch (err) {
      console.error('[useRoomList] refresh failed:', err);
      setError('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    if (!circleId) {
      setRooms([]);
      setLoading(false);
      return;
    }
    refresh();
  }, [circleId, refresh]);

  return { rooms, loading, error, refresh };
}

// ─── useRoom ─────────────────────────────────────────────────────────────────

/** Load a single room with aggregate counts. */
export function useRoom(roomId: string | null) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await repo.loadRoom(roomId);
      setRoom(data);
    } catch (err) {
      console.error('[useRoom] refresh failed:', err);
      setError('Failed to load room');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [roomId, refresh]);

  return { room, loading, error, refresh };
}

// ─── useRoomFiles ────────────────────────────────────────────────────────────

/** Load files for a room with realtime subscription for updates. */
export function useRoomFiles(roomId: string | null) {
  const [files, setFiles] = useState<RoomFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await repo.loadFiles(roomId);
      setFiles(data);
      setError(null);
    } catch (err) {
      console.error('[useRoomFiles] refresh failed:', err);
      setError('Failed to load files');
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      setFiles([]);
      setLoading(false);
      return;
    }

    // Initial load
    refresh().finally(() => setLoading(false));

    // Realtime subscription — refetch on any change
    unsubRef.current = repo.subscribeToFiles(roomId, () => {
      refresh();
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [roomId, refresh]);

  return { files, loading, error, refresh };
}

// ─── useRoomMessages ─────────────────────────────────────────────────────────

/** Load messages for a room with realtime subscription. Exposes send/delete helpers. */
export function useRoomMessages(roomId: string | null, limit = 200) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await repo.loadMessages(roomId, limit);
      setMessages(data);
      setError(null);
    } catch (err) {
      console.error('[useRoomMessages] refresh failed:', err);
      setError('Failed to load messages');
    }
  }, [roomId, limit]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    // Initial load
    refresh().finally(() => setLoading(false));

    // Realtime subscription — refetch on any change
    unsubRef.current = repo.subscribeToMessages(roomId, () => {
      refresh();
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [roomId, refresh]);

  const sendMessage = useCallback(
    async (userId: string, content: string, messageType?: RoomMessage['messageType']) => {
      if (!roomId) return null;
      return repo.sendMessage(roomId, userId, content, messageType);
    },
    [roomId],
  );

  const deleteMessage = useCallback(async (messageId: string) => {
    const success = await repo.deleteMessage(messageId);
    if (success) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
    return success;
  }, []);

  return { messages, loading, error, sendMessage, deleteMessage, refresh };
}

// ─── useRoomSection ──────────────────────────────────────────────────────────

/** Manage which section of a room is currently active. */
export function useRoomSection(initialSection: RoomSection = 'overview') {
  const [activeSection, setSection] = useState<RoomSection>(initialSection);
  return { activeSection, setSection };
}
