import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

/**
 * 公開ページのプレビュー。サーバーで描画した HTML を iframe に表示する。
 * sandbox に allow-same-origin を付けないので、プレビューの中のスクリプトは管理画面の Cookie や API に触れられない。
 */
export function PreviewSheet({ load, onClose }: { load: () => Promise<string>; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((h) => !cancelled && setHtml(h))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // 開いたときに 1 度だけ読み込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet title="プレビュー" onClose={onClose} wide>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && html === null && <p className="hint center">表示を作っています…</p>}
      {html !== null && <iframe className="preview-frame" title="プレビュー" sandbox="allow-scripts" srcDoc={html} />}
    </Sheet>
  );
}
