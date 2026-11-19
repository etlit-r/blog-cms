import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

/**
 * 未保存の変更があるまま画面を離れようとしたら確認する（アプリ内の移動と、タブを閉じる・再読み込みの両方）。
 * 返り値の skip.current を true にすると、次の移動では確認しない（保存・削除の直後の移動など）。
 */
export function useUnsavedGuard(dirty: boolean) {
  const skip = useRef(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !skip.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('保存していない変更があります。破棄して移動しますか？')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return skip;
}
