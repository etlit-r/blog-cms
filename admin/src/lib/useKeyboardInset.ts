import { useEffect, useState } from 'react';

/**
 * 画面下からスマホのソフトウェアキーボードの上端までの高さ（px）。
 * visualViewport は「実際に見えている範囲」なので、レイアウト全体の高さとの差がキーボードの高さになる。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
