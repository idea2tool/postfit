// postfit 计数核心：浏览器和 Node 都能用，方便和官方库对照测试。
//
// X 的规则来自 twitter-text 官方配置 v3：
//   https://github.com/twitter/twitter-text/blob/master/config/v3.json
//   下面几段 Unicode 范围内的字符算 1，其余（包括中日韩文字）算 2；
//   每个 emoji 算 2；每个链接固定算 23；计数前先做 NFC 规范化。
// Bluesky 的规则来自官方 lexicon：app.bsky.feed.post 的 text 最多 300 个字形（grapheme）。
// 其他平台没有公开的精确算法，按字形数估算，界面上标「约」。

const X_RANGES = [[0x0000, 0x10FF], [0x2000, 0x200D], [0x2010, 0x201F], [0x2032, 0x2037]];
const X_URL_LENGTH = 23;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const TLDS = 'com|org|net|io|dev|ai|app|co|me|cn|jp|kr|tw|hk|uk|de|fr|us|ca|au|in|xyz|gg|so|sh|tv|info|edu|gov|ly|to|fm|page|site|tech|blog|news';
const URL_STOP = '\\s<>"\'，。！？、；：（）【】《》「」';
const URL_RE = new RegExp(
  `https?:\\/\\/[^${URL_STOP}]+` +
  `|(?<![\\w@./-])(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![\\w-])(?:\\/[^${URL_STOP}]*)?`,
  'gi');

/** 把文字切成「链接」和「普通文字」两种片段，保留在原文里的位置。 */
export function tokenize(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index < last) continue;
    const url = m[0].replace(/[.,;:!?)\]}'"]+$/, ''); // 句末标点不算链接的一部分
    if (!url) continue;
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index), start: last });
    out.push({ type: 'url', text: url, start: m.index });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), start: last });
  return out;
}

export function isEmoji(g) {
  // 只把真正的 emoji 算进来：不含 FE0F 的 ©、® 这类老字符在 X 的规则里仍然算 1
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g) &&
    [...g].some(c => c.codePointAt(0) > 0x10FF);
}

function xGraphemeWeight(g) {
  if (isEmoji(g)) return 2;
  let w = 0;
  for (const ch of g.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    w += X_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return w;
}

/**
 * 把文字拆成最小计数单位：一个链接、或一个字形。
 * 返回 [{ start, end, w }]，w 是这个单位在该平台的计数。
 */
export function units(text, platform) {
  const out = [];
  for (const tok of tokenize(text)) {
    if (tok.type === 'url' && platform.url != null) {
      out.push({ start: tok.start, end: tok.start + tok.text.length, w: platform.url });
      continue;
    }
    for (const { segment, index } of graphemes.segment(tok.text)) {
      const start = tok.start + index;
      out.push({ start, end: start + segment.length, w: platform.rule === 'x' ? xGraphemeWeight(segment) : 1 });
    }
  }
  return out;
}

export const PLATFORMS = [
  { id: 'x', name: 'X', limit: 280, rule: 'x', url: X_URL_LENGTH, exact: true },
  { id: 'xlong', name: 'X Premium', limit: 25000, rule: 'x', url: X_URL_LENGTH, exact: true, fold: 280 },
  { id: 'bluesky', name: 'Bluesky', limit: 300, rule: 'grapheme', url: null, exact: true },
  { id: 'threads', name: 'Threads', limit: 500, rule: 'grapheme', url: null, exact: false },
  { id: 'mastodon', name: 'Mastodon', limit: 500, rule: 'grapheme', url: 23, exact: false },
  { id: 'linkedin', name: 'LinkedIn', limit: 3000, rule: 'grapheme', url: null, exact: false },
  { id: 'instagram', name: 'Instagram', limit: 2200, rule: 'grapheme', url: null, exact: false },
];

export const platformById = id => PLATFORMS.find(p => p.id === id);

export function count(text, platform) {
  return units(text, platform).reduce((sum, u) => sum + u.w, 0);
}

/** 从哪个位置开始超出 limit；不超出返回 null。 */
export function cutIndex(text, platform, limit = platform.limit) {
  let sum = 0;
  for (const u of units(text, platform)) {
    if (sum + u.w > limit) return u.start;
    sum += u.w;
  }
  return null;
}

/**
 * 拆成串推：优先在段落、句子结尾断开；一句话本身超长时，才在字中间断开。
 * numbering 为 true 时，每条末尾加「 1/3」，拆分时会预留这部分的长度。
 */
export function split(text, platform, { numbering = true } = {}) {
  const reserve = numbering ? 6 : 0; // 「 99/99」最多 6 个 ASCII 字符
  const limit = platform.limit - reserve;
  const chunks = text.match(/[^\n。！？!?…]*?(?:[。！？!?…]+[”’」』"')）]*|\.(?=\s)|\n+|$)|[^\n]+/gs)?.filter(Boolean) ?? [];
  const posts = [];
  let cur = '';
  const flush = () => { if (cur.trim()) posts.push(cur.trim()); cur = ''; };
  for (const chunk of chunks) {
    if (count(cur + chunk, platform) <= limit) { cur += chunk; continue; }
    flush();
    if (count(chunk, platform) <= limit) { cur = chunk; continue; }
    // 一个句子本身就超长：按计数单位硬切
    let piece = '', sum = 0;
    for (const u of units(chunk, platform)) {
      if (sum + u.w > limit) { posts.push(piece.trim()); piece = ''; sum = 0; }
      piece += chunk.slice(u.start, u.end);
      sum += u.w;
    }
    cur = piece;
  }
  flush();
  if (!numbering || posts.length < 2) return posts;
  return posts.map((p, i) => `${p} ${i + 1}/${posts.length}`);
}

export function stats(text) {
  const segs = [...graphemes.segment(text)].map(s => s.segment);
  return {
    chars: segs.length,
    cjk: (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length,
    words: (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length,
    links: tokenize(text).filter(t => t.type === 'url').length,
    emoji: segs.filter(isEmoji).length,
  };
}
