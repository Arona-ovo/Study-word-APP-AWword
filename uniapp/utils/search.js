// utils/search.js - 首页顶部搜索的检索与入库逻辑（与页面解耦，便于单测）
//
// 检索顺序：当前词书（内置词 + 该书导入词）→ 常用词典 / 词形还原（dict.lookup）
// 入库：复用导入管道 importer.validateAndDedupe + importIntoBook，
//      保证与「词库 → 导入单词」完全一致（去重校验、id 规则、点读缓存失效）。

import * as wordbook from './wordbook.js';
import * as dict from './dict.js';
import * as importer from './importer.js';

const DEFAULT_LIMIT = 20;

// 什么样的查询值得再走一遍词典兜底：单个英文词（含连字符 / 撇号）。
// 中文释义、整句、"[object Object]" 之类都不该往词典里塞。
const LATIN_WORD = /^[a-zA-Z][a-zA-Z'-]*$/;

// 本地检索：命中词形或中文释义
//
// 排序按相关性分四档，**必须**分档：只按词书里的原始顺序取，
// 搜 "in" 会先撞上一堆"含 in"的词（insurance / engine / criminal…），
// 把真正的 "in" 挤到列表外面 —— 用户看到的就是"一堆都不是我要的"（实测反馈）。
//   ① 完全相等  ② 以查询开头  ③ 词形里含  ④ 释义里含
export function localSearch(bookId, kw, limit) {
  const q = String(kw || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const max = limit || DEFAULT_LIMIT;
  const out = [];
  const seen = Object.create(null);   // 小写词形 → 已收录：同一个词只出现一条

  // 1) 当前词书（内置词 + 该书导入词）
  try {
    const bid = bookId || wordbook.currentBookId();
    const exact = [];
    const prefix = [];
    const contains = [];
    const byMean = [];
    wordbook.bookWords(bid).forEach((w) => {
      const form = String(w.w || '').toLowerCase();
      if (!form) return;
      let bucket = null;
      if (form === lower) bucket = exact;
      else if (form.indexOf(lower) === 0) bucket = prefix;
      else if (form.indexOf(lower) > 0) bucket = contains;
      else if (String(w.m || '').indexOf(q) >= 0) bucket = byMean;
      if (bucket) bucket.push({ w: w.w, pos: w.pos || '', m: w.m || '', fromText: '当前词书' });
    });
    [exact, prefix, contains, byMean].forEach((bucket) => {
      bucket.forEach((row) => {
        const k = String(row.w).toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(row);
      });
    });
  } catch (e) {
    /* 词书读取失败则跳过，继续走词典兜底 */
  }

  // 2) 词典兜底：用户打的那个词本身在词典里（核心词书 → 常用词典 → 内置词书 → 词形还原）。
  //    ⚠️ 这一步**不再以"词书零命中"为前提**。以前就是这么写的，于是
  //    搜 "in" 时书里有 268 条包含命中 → 词典那条真 "in"（在……里）被整块跳过，
  //    用户只看到 insurance / engine / criminal，想查的 "in" 一条都没有（实测反馈）。
  //    命中且词书里没有同一个词形时插到最前面：他要找的就是这条。
  //    custom 不算 —— 那是别的词书里的导入词，会让人误以为已在本词书里，也会挡掉 AI 补词路径。
  if (LATIN_WORD.test(q)) {
    try {
      const e = dict.lookup(q);
      if (e && e.found && e.src !== 'custom' && !seen[String(e.w || q).toLowerCase()]) {
        out.unshift({
          w: e.w || q,
          pos: e.pos || '',
          m: e.meaning || '',
          fromText: (dict.SRC_LABEL && dict.SRC_LABEL[e.src]) || '词典'
        });
      }
    } catch (e) {
      /* 查词失败视为未命中 */
    }
  }

  return out.slice(0, max);
}

// 把一个词写进词书（本地）
// item: { word, pos, meaning, example?: { en, zh } }
// opts: { allowKnown?: boolean } —— true 表示「核心词典里已有也不算重复」，
//       用于单词详情页的「加入词书」（同一个词可以收进多本书）。
// 返回 { added, reason } —— added=false 时 reason 说明原因（已存在 / 词形非法 …）
export function addWordToBook(bookId, item, opts) {
  const bid = bookId || wordbook.currentBookId();
  const word = String((item && item.word) || '').trim();
  if (!word) return { added: false, reason: '词形为空' };

  const { accepted, rejected } = importer.validateAndDedupe(
    [{ word, pos: (item && item.pos) || '', meaning: (item && item.meaning) || '' }],
    bid,
    opts
  );
  if (!accepted.length) {
    const r = rejected && rejected[0];
    return { added: false, reason: (r && r.reason) || '未能加入词库' };
  }
  try {
    const res = importer.importIntoBook(accepted, bid);
    // 例句：直接复用 AI 释义里带的例句，省掉一次生成请求
    const ex = item && item.example;
    if (ex && ex.en) {
      try { importer.attachExampleTo(bid, word, ex.en, ex.zh || '') } catch (e) { /* 例句写入失败不影响入库 */ }
    }
    return { added: !!(res && res.added), reason: '' };
  } catch (e) {
    return { added: false, reason: '写入失败' };
  }
}
