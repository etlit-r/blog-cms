import { describe, expect, it } from 'vitest';
import { extractText, makeExcerpt } from '../src/lib/html';

describe('extractText', () => {
  it('タグを除き、段落の間に空白を入れる', async () => {
    expect(await extractText('<h2>見出し</h2><p>一段落目</p><p>二段落<strong>目</strong></p>')).toBe('見出し 一段落目 二段落目');
  });

  it('script / style の中身は含めない', async () => {
    expect(await extractText('<p>本文</p><script>alert("x")</script><style>p{color:red}</style><p>続き</p>')).toBe('本文 続き');
  });

  it('文字参照を戻す', async () => {
    expect(await extractText('<p>A &amp; B &lt;tag&gt; &#x1F600; &#12354;</p>')).toBe('A & B <tag> 😀 あ');
  });

  it('よく使う名前付き文字参照も戻す', async () => {
    expect(await extractText('<p>A&mdash;B&hellip; &ldquo;C&rdquo; &copy;</p>')).toBe('A—B… “C” ©');
  });

  it('改行タグで単語がくっつかない', async () => {
    expect(await extractText('一行目<br>二行目')).toBe('一行目 二行目');
  });
});

describe('makeExcerpt', () => {
  it('長い本文は 120 文字で切って … を付ける', async () => {
    const excerpt = await makeExcerpt(`<p>${'あ'.repeat(200)}</p>`);
    expect(excerpt).toBe('あ'.repeat(120) + '…');
  });

  it('短い本文はそのまま', async () => {
    expect(await makeExcerpt('<p>短い</p>')).toBe('短い');
  });
});

describe('extractText（ブロックの終わり）', () => {
  it('ブロック要素の後ろのテキストともくっつかない', async () => {
    expect(await extractText('<p>前</p>後')).toBe('前 後');
  });
});

describe('extractText（崩れた HTML）', () => {
  it('終了タグが省略されていても動く', async () => {
    expect(await extractText('<p>一<p>二<ul><li>三<li>四</ul>')).toBe('一 二 三 四');
  });
});
