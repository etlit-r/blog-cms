import { useEffect, useState } from 'react';
import { api } from './api';
import type { SiteSettings } from './types';

/** サイト設定（公開サイトの URL など）を読み込む */
export function useSettings() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SiteSettings>('/settings')
      .then((s) => !cancelled && setSettings(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, setSettings, error };
}
