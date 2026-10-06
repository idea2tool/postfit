// 运行：node test/count.test.mjs
// 期望值来源：
//   - 普通文字、链接、中日韩文字：和 twitter-text 官方库 parseTweet().weightedLength 逐条对照一致
//   - 新式 emoji（🧑‍💻、🫶🏻）：npm 上的 twitter-text 3.x emoji 列表过时（会算成 5 和 4）；
//     2026-10-06 在 x.com 发推框实测，X 网站把它们都算作 2，这里以网站为准
import { count, platformById, split, cutIndex } from '../count.js';

const X = platformById('x');
const cases = [
  ['hello world', 11],
  ['你好，世界', 10],
  ['这个号重新开始 🌱', 17],
  ['Mixed 中文 and English 123', 26],
  ['👨‍👩‍👧‍👦 family emoji', 15],
  ['🇨🇳🇺🇸 flags', 10],
  ['keycap 1️⃣ 2️⃣', 12],
  ['© ® ™ plain', 12],
  ['©️ with variation', 17],
  ['link https://github.com/idea2tool/sketchwash end', 32],
  ['看这个 github.com/idea2tool 不错', 35],
  ['www.example.com and example.org/path?x=1.', 52],
  ['dash — and “quotes” and ‘single’ and … ellipsis', 48],
  ['café vs café (NFD)', 18],
  ['こんにちは 안녕하세요', 21],
  ['数学符号 ∑ ∞ ≠ ← →', 23],
  ['full-width ＡＢＣ１２３', 23],
  ['🧑‍💻', 2],   // x.com 实测
  ['🫶🏻', 2],   // x.com 实测
  ['a'.repeat(280), 280],
  ['中'.repeat(141), 282],
];

let fail = 0;
for (const [text, want] of cases) {
  const got = count(text, X);
  if (got !== want) { fail++; console.log('FAIL', want, got, JSON.stringify(text)); }
}

// 拆分后每条都不超过上限，拼回去不丢字
const long = '这是一段很长的中文，用来测试串推拆分。'.repeat(30) + ' https://github.com/idea2tool/postfit 最后一句话！';
const posts = split(long, X);
if (!posts.every(p => count(p, X) <= 280)) { fail++; console.log('FAIL split 超长'); }
const joined = split(long, X, { numbering: false }).join('');
if (joined.replace(/\s/g, '') !== long.replace(/\s/g, '')) { fail++; console.log('FAIL split 丢字'); }
if (cutIndex('中'.repeat(141), X) !== 140) { fail++; console.log('FAIL cutIndex'); }

console.log(fail ? `${fail} 项失败` : `全部通过（${cases.length} 条计数 + 3 项拆分检查）`);
process.exit(fail ? 1 : 0);
