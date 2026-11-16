import { useMemo } from 'react';
import { mediaPathsInHtml, thumbPath } from '../lib/media';

type Props = {
  bodyHtml: string;
  /** 手動で選んだカバー（/media/...）。null なら自動 */
  value: string | null;
  onChange: (value: string | null) => void;
};

/** カバー画像の選択。本文の画像を横に並べ、タップで選ぶ */
export function CoverPicker({ bodyHtml, value, onChange }: Props) {
  const images = useMemo(() => mediaPathsInHtml(bodyHtml), [bodyHtml]);
  // 手動で選んだ画像を本文から消しても、選択肢には残す
  const options = value && !images.includes(value) ? [value, ...images] : images;
  const autoImage = images[0];

  return (
    <div className="field">
      <span className="label">カバー画像</span>
      <ul className="cover-picker" role="radiogroup" aria-label="カバー画像">
        <li>
          <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)}>
            {autoImage ? <img src={thumbPath(autoImage)} alt="" /> : <span className="cover-none">画像なし</span>}
            <span className="cover-label">自動</span>
          </button>
        </li>
        {options.map((path) => (
          <li key={path}>
            <button type="button" role="radio" aria-checked={value === path} aria-label="この画像をカバーにする" onClick={() => onChange(path)}>
              <img src={thumbPath(path)} alt="" />
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">トップページなどで記事の画像として大きく表示されます。「自動」は本文の最初の画像です。</p>
    </div>
  );
}
