import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { cleanTagName, tagKey } from '../lib/tags';
import type { Tag } from '../lib/types';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
};

/** 入力を確定する区切り文字（Enter に加えて、読点・カンマ） */
const SEPARATORS = /[、,，]/;

/**
 * タグ入力。入力中は既存タグを候補に出し、確定した時点で追加する（未登録のタグは保存時に作られる）。
 */
export function TagInput({ value, onChange }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const composing = useRef(false); // 日本語入力の変換中は Enter で確定しない

  // 入力が止まってから 200ms 後に候補を取得する
  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ items: Tag[] }>(`/tags?q=${encodeURIComponent(q)}`)
        .then(({ items }) => !cancelled && setSuggestions(items))
        .catch(() => !cancelled && setSuggestions([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);

  function add(raw: string) {
    const name = cleanTagName(raw);
    setText('');
    setSuggestions([]);
    if (!name || value.some((t) => tagKey(t) === tagKey(name))) return;
    onChange([...value, name]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      remove(value.length - 1);
    }
  }

  function onInput(next: string) {
    // 区切り文字が入力されたら、その手前までを確定する
    if (SEPARATORS.test(next)) {
      const parts = next.split(SEPARATORS);
      const rest = parts.pop() ?? '';
      const added = [...value];
      for (const p of parts) {
        const name = cleanTagName(p);
        if (name && !added.some((t) => tagKey(t) === tagKey(name))) added.push(name);
      }
      onChange(added);
      setText(rest);
      return;
    }
    setText(next);
  }

  const visible = suggestions.filter((s) => !value.some((t) => tagKey(t) === tagKey(s.name)));

  return (
    <div className="field">
      <label htmlFor={id}>タグ</label>
      <div className="tag-input">
        {value.map((tag, i) => (
          <span key={tag} className="chip">
            #{tag}
            <button type="button" aria-label={`${tag} を外す`} onClick={() => remove(i)}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          placeholder={value.length ? '' : '入力して Enter で追加'}
          enterKeyHint="done"
          autoCapitalize="none"
          autoComplete="off"
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {visible.length > 0 && (
        <ul className="suggestions" role="listbox" aria-label="タグの候補">
          {visible.map((s) => (
            <li key={s.id}>
              {/* 押した瞬間に入力欄からフォーカスが外れて、入力中の文字が先に確定されるのを防ぐ */}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.name)}>
                #{s.name}
                <span className="count">{s.postCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Enter・読点（、）・カンマで区切ります。候補をタップしても追加できます。</p>
    </div>
  );
}
