import { useCallback, useRef, useState } from 'react';
import type { Media } from './types';
import { uploadImage } from './upload';

export type UploadItem = {
  key: number;
  name: string;
  progress: number; // 0〜1
  status: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
};

let nextKey = 1;

/**
 * 複数の画像を 1 枚ずつ順番にアップロードする（スマホの回線でも詰まらないように）。
 * upload() はアップロードに成功した画像を選んだ順に返す。
 */
export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  /** 前に始めたアップロード。後から選んだ画像は、これが終わってから送る */
  const running = useRef<Promise<unknown>>(Promise.resolve());

  const update = (key: number, patch: Partial<UploadItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const upload = useCallback(async (files: File[]): Promise<Media[]> => {
    const queued = files.map((file) => ({ file, key: nextKey++ }));
    setItems((list) => [
      // 前回の完了分は消し、失敗したものは残して見えるようにする
      ...list.filter((it) => it.status !== 'done'),
      ...queued.map(({ file, key }) => ({ key, name: file.name || '画像', progress: 0, status: 'waiting' as const })),
    ]);

    const previous = running.current;
    const run = (async () => {
      await previous.catch(() => {});
      return uploadAll(queued);
    })();
    running.current = run;
    return run;
  }, []);

  async function uploadAll(queued: { file: File; key: number }[]): Promise<Media[]> {
    const uploaded: Media[] = [];
    for (const { file, key } of queued) {
      update(key, { status: 'uploading' });
      try {
        uploaded.push(await uploadImage(file, (progress) => update(key, { progress })));
        update(key, { status: 'done', progress: 1 });
      } catch (e) {
        update(key, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    // 成功したものは少ししてから一覧から消す
    setTimeout(() => setItems((list) => list.filter((it) => it.status !== 'done')), 1500);
    return uploaded;
  }

  const dismiss = useCallback((key: number) => setItems((list) => list.filter((it) => it.key !== key)), []);
  const busy = items.some((it) => it.status === 'waiting' || it.status === 'uploading');

  return { items, upload, dismiss, busy };
}
