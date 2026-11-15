import { useId, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string };

/** ラベル付きの入力欄（スマホで押しやすい大きさ） */
export function Field({ label, hint, ...input }: Props) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
