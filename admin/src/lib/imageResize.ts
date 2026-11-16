/** 長辺の上限（サーバー側の MEDIA_MAX_EDGE と同じ） */
export const MAX_EDGE = 1600;
/** サムネイルの長辺（サーバー側の THUMB_EDGE と同じ） */
export const THUMB_EDGE = 800;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

export type ResizedImage = {
  original: Blob;
  thumb: Blob;
  width: number;
  height: number;
};

export class ImageResizeError extends Error {}

/**
 * スマホで撮った写真を、アップロード前にブラウザで縮小する。
 * - 長辺 1600px と 800px の 2 サイズを作る
 * - WebP にする（非対応のブラウザでは JPEG）
 * - Canvas で描き直すので、EXIF（撮影場所の GPS 情報など）は含まれない
 */
export async function resizeImage(file: File): Promise<ResizedImage> {
  if (!file.type.startsWith('image/') && file.type !== '') {
    throw new ImageResizeError(`「${file.name}」は画像ではありません`);
  }
  const source = await decode(file);
  try {
    const big = scaleTo(source.width, source.height, MAX_EDGE);
    const mime = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';
    const bigCanvas = draw(source.image, big.width, big.height, mime);
    const small = scaleTo(big.width, big.height, THUMB_EDGE);
    // サムネイルは縮小済みの画像からさらに縮小する（一度に大きく縮めるより、ぎざぎざが出にくい）
    const smallCanvas = draw(bigCanvas, small.width, small.height, mime);
    const [original, thumb] = await Promise.all([toBlob(bigCanvas, mime), toBlob(smallCanvas, mime)]);
    return { original, thumb, width: big.width, height: big.height };
  } finally {
    source.release();
  }
}

/** 長辺が max を超えないように縮小した大きさ（拡大はしない）。サーバー側の thumbSize と同じ計算 */
export function scaleTo(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type Decoded = { image: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  // createImageBitmap は写真の向き（EXIF Orientation）を反映して読み込む
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // 古い Safari などでは <img> で読み込む
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageResizeError(`「${file.name}」を読み込めませんでした。この形式には対応していない可能性があります`);
  }
}

function draw(image: CanvasImageSource, width: number, height: number, mime: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageResizeError('画像を処理できませんでした');
  if (mime === 'image/jpeg') {
    // JPEG は透明を持てないので、透明な部分を白にする
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageResizeError('画像を変換できませんでした'))),
      mime,
      mime === 'image/webp' ? WEBP_QUALITY : JPEG_QUALITY,
    );
  });
}

let webpSupport: Promise<boolean> | null = null;

/** WebP で書き出せるか（非対応のブラウザでは PNG が返ってくる） */
function supportsWebp(): Promise<boolean> {
  webpSupport ??= new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    canvas.toBlob((blob) => resolve(blob?.type === 'image/webp'), 'image/webp');
  });
  return webpSupport;
}
