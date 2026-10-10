// utils/dict.js - 点读查词统一入口（离线，无网络请求）
// 查词优先级：核心词书 → 用户导入词 → 内置常用词典 → 词形还原后再走一遍 → 未收录
// 未收录时仍返回 { found:false }，调用方可继续用 tts.speakWord() 发音（有道单词级可用）。
import { WORDS } from '../data/words.js';
import { COMMON_RAW } from '../data/common-words.js';
import { allByText } from '../data/lexicon.js';
import { getBook } from '../data/wordbooks.js';
import * as store from './store.js';
import * as wordbook from './wordbook.js';
import { lemmaCandidates, lemma } from './lemma.js';

export const SRC_LABEL = {
  core: '核心词书',
  book: '内置词书',
  custom: '我的导入',
  common: '常用词',
  none: '未收录'
};

const CORE = {};    // 'improve' -> { w, pos, meaning, lv, phonetic }
const COMMON = {};
const cache = {};

WORDS.forEach(function (w) {
  CORE[w.w.toLowerCase()] = {
    w: w.w,
    pos: w.pos || '',
    meaning: w.m || '',
    lv: w.lv || 1,
    phonetic: w.ph || '',
    src: 'core'
  };
});

COMMON_RAW.forEach(function (line) {
  const i = line.indexOf('|');
  if (i < 0) return;
  const j = line.indexOf('|', i + 1);
  if (j < 0) return;
  const key = line.slice(0, i).toLowerCase();
  COMMON[key] = {
    w: line.slice(0, i),
    pos: line.slice(i + 1, j),
    meaning: line.slice(j + 1),
    src: 'common'
  };
});

function normalize(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z'-]/g, '');
}

// 用户导入的词（按词书分桶存放：state.customWords[bookId] = [{ word, pos, meaning }]）
function customGet(key) {
  try {
    const st = store.get();
    const cw = st && st.customWords;
    if (!cw) return null;
    for (const bid in cw) {
      const list = cw[bid] || [];
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].word || '').toLowerCase() === key) {
          return { w: list[i].word, pos: list[i].pos || '', meaning: list[i].meaning || '', src: 'custom' };
        }
      }
    }
  } catch (e) {}
  return null;
}

function hit(key) {
  return CORE[key] || customGet(key) || COMMON[key] || bookGet(key) || null;
}

// 内置词书共享词条（data/lexicon.js）：排在 core / 导入词 / 常用词之后，
// 只作为"前三层都没收录"时的最后一道兜底 —— 让点读在任何内置考试词书的词汇上也能出释义。
// 复用同一份 allByText 索引，不额外建表 —— 覆盖率提升不需要额外内存。
function bookGet(key) {
  try {
    const w = allByText()[key];
    if (!w) return null;
    return { w: w.w, pos: w.pos || '', meaning: w.m || '', lv: w.lv || 0, phonetic: '', src: 'book' };
  } catch (e) { return null; }
}

// 查词：返回 { w, pos, meaning, phonetic, src, found, lemma, inflected }
export function lookup(raw) {
  const key = normalize(raw);
  if (!key) return { w: raw, pos: '', meaning: '', phonetic: '', src: 'none', found: false };
  if (cache[key]) return cache[key];

  let out = hit(key);
  let inflected = '';
  let lemmaForm = '';

  if (out) {
    lemmaForm = key;
  } else {
    const cands = lemmaCandidates(key);
    for (let i = 0; i < cands.length; i++) {
      const h = hit(cands[i]);
      if (h) {
        out = h;
        lemmaForm = cands[i];
        inflected = key;
        break;
      }
    }
  }

  const res = out
    ? {
        w: out.w,
        pos: out.pos || '',
        meaning: out.meaning || '',
        phonetic: out.phonetic || '',
        src: out.src,
        lv: out.lv || 0,
        found: true,
        lemma: lemmaForm || key,
        inflected: inflected
      }
    : { w: raw, pos: '', meaning: '', phonetic: '', src: 'none', found: false, lemma: key, inflected: '' };

  cache[key] = res;
  return res;
}

// 取单词的"最佳发音形式"：优先原形（词典收录形式）
export function speakForm(raw) {
  const r = lookup(raw);
  return r.found && r.lemma ? r.lemma : normalize(raw);
}

/* ---------- 点读弹窗底下那行「归属」标签 ----------
   用户想看的其实是「这个词属不属于我正在背的那本书」，
   而不是「这次词义是从哪一层翻出来的」。
   SRC_LABEL 说的是后者：正在背「福建专升本」的人点开一个词，
   底下却写着「核心词书」，看着就串台了（用户实测反馈）。
   所以另开一个口径：
     · 词在当前的词书里 → 返回那本书的名字（如「福建专升本」）
     · 不在            → 返回空串，调用方整行不渲染（他就是要「没在这本书就不显示」）
   判定不看 src：同一个词可能既在核心词表里、也在当前词书里，
   这时标签该跟着"我在背什么"走，而不是跟着"命中哪一层"走。 */

const BOOK_SETS = {};   // bookId -> { 小写词形: true }，避免每次点击都把整本书扫一遍

function bookSetOf(bid) {
  const key = String(bid || '');
  if (!BOOK_SETS[key]) {
    const set = {};
    try {
      wordbook.bookWords(key).forEach(function (w) {
        const t = String((w && w.w) || '').toLowerCase();
        if (t) set[t] = true;
      });
    } catch (e) { /* 词书读不出来 → 空集合，等于"哪本都没在" */ }
    BOOK_SETS[key] = set;
  }
  return BOOK_SETS[key];
}

// 命中判定与 word-mark.inBook 同一口径：先比原形，再比词形还原（improved → improve）
function inSet(key, set) {
  if (set[key]) return true;
  let cands = [];
  try { cands = lemmaCandidates(key) || []; } catch (e) { return false; }
  for (let i = 0; i < cands.length; i++) {
    if (set[String(cands[i] || '').toLowerCase()]) return true;
  }
  return false;
}

/**
 * 点读弹窗的归属标签。
 * @param raw    点到的词形（可带大小写 / 屈折）
 * @param bookId 要判定的词书，不传则用当前词书
 * @returns 词书名字；不在书里返回 ''
 */
export function ownerLabel(raw, bookId) {
  try {
    const key = normalize(raw);
    if (!key) return '';
    const bid = bookId || wordbook.currentBookId();
    if (!bid) return '';
    if (!inSet(key, bookSetOf(bid))) return '';
    const book = getBook(bid);
    return (book && book.name) || '';
  } catch (e) {
    return '';
  }
}

// 导入新词 / 切换词书后清空缓存
export function invalidateCache() {
  for (const k in cache) delete cache[k];
  for (const k in BOOK_SETS) delete BOOK_SETS[k];
}

export { lemma };
