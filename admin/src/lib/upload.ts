import { ApiError, UNAUTHORIZED_EVENT } from './api';
import { resizeImage } from './imageResize';
import type { Media } from './types';

/**
 * 画像を縮小してアップロードする。onProgress には 0〜1 の進み具合を渡す。
 * 進み具合を知るため、fetch ではなく XMLHttpRequest を使う。
 */
export async function uploadImage(file: File, onProgress: (ratio: number) => void, alt = ''): Promise<Media> {
  const resized = await resizeImage(file);
  const ext = resized.original.type === 'image/webp' ? 'webp' : 'jpg';
  const form = new FormData();
  form.set('original', resized.original, `image.${ext}`);
  form.set('thumb', resized.thumb, `thumb.${ext}`);
  form.set('width', String(resized.width));
  form.set('height', String(resized.height));
  form.set('alt', alt);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/media');
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'network_error', '通信できませんでした。電波の状態を確認してください'));
    xhr.onload = () => {
      const data = xhr.response as { media?: Media; error?: { code: string; message: string } } | null;
      if (xhr.status === 201 && data?.media) {
        onProgress(1);
        resolve(data.media);
        return;
      }
      if (xhr.status === 401 && data?.error?.code === 'unauthorized') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      reject(new ApiError(xhr.status, data?.error?.code ?? 'unknown', data?.error?.message ?? `アップロードに失敗しました (${xhr.status})`));
    };
    xhr.send(form);
  });
}
