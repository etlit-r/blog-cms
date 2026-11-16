import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Media } from './types';

type ListResponse = { items: Media[]; nextCursor: string | null };

/** メディアライブラリの一覧（新しい順、もっと見るで続きを読む） */
export function useMediaList() {
  const [items, setItems] = useState<Media[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<ListResponse>(`/media${cursor ? `?cursor=${cursor}` : ''}`);
      setItems((prev) => (cursor && prev ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(null), [load]);

  return {
    items,
    loading,
    error,
    hasMore: nextCursor !== null,
    loadMore: () => void load(nextCursor),
    reload: () => void load(null),
    /** アップロードした画像を先頭に足す */
    prepend: (added: Media[]) => setItems((prev) => [...added.slice().reverse(), ...(prev ?? [])]),
    update: (m: Media) => setItems((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? null),
    remove: (id: number) => setItems((prev) => prev?.filter((x) => x.id !== id) ?? null),
  };
}
