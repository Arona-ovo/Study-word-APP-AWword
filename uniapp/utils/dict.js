// utils/dict.js - 点读查词统一入口（离线，无网络请求）
// 查词优先级：核心词书 → 用户导入词 → 内置常用词典 → 内置词书共享表 → 查词补充表 → 词形还原后再走一遍 → 未收录
// 未收录时仍返回 { found:false }，调用方可继续用 tts.speakWord() 发音（有道单词级可用）。
import { WORDS } from '../data/words.js';
import { COMMON_RAW } from '../data/common-words.js';
import { EXTRA_RAW } from '../data/extra-words.js';
import { SENSES_RAW } from '../data/word-senses.js';
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
  extra: '补充词库',
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
  return CORE[key] || customGet(key) || COMMON[key] || bookGet(key) || extraGet(key) || null;
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

/* ---------- 查词补充表（data/extra-words.js） ----------
   背景就是「单词查询模块」的那句实测反馈 —— 本地查词会"完全搜不到"。
   根因不是词太少，而是 data/lexicon-data.js 里只有"被某本词书引用过"的行：
   每本词书都有 size 上限、还剔了初中词，于是 _vocab/src 的 7022 个候选里
   只有 3893 个真正落进了共享表。剩下那批同样是带中文释义的正经考试词，
   却因为"没被任何书挑中"而在 App 里查不到。

   extra-words.js 就是那批词的单独导出：行格式与共享表一致，**不进任何词书**
   （不产生新的词 id → 老用户已背进度不受影响），只当最后一层查词兜底。
   之所以放在 book 之后而不是之前：同一批词若在词书里也有，标签要显示"内置词书"。

   懒解析 + 单例：只有真的查到这一层才会把 2756 行拆成 Map。 */
let _extra = null;
function extraTable() {
  if (_extra) return _extra;
  const map = {};
  EXTRA_RAW.split('\n').forEach(function (line) {
    const i = line.indexOf('|');
    if (i < 0) return;
    const j = line.indexOf('|', i + 1);
    if (j < 0) return;
    const key = line.slice(0, i).toLowerCase();
    if (!key || map[key]) return;
    map[key] = {
      w: line.slice(0, i),
      pos: line.slice(i + 1, j),
      meaning: line.slice(j + 1),
      src: 'extra'
    };
  });
  _extra = map;
  return map;
}

function extraGet(key) {
  try {
    return extraTable()[key] || null;
  } catch (e) { return null; }
}

/* ---------- 词典完整义项表（data/word-senses.js） ----------
   用户反馈「许多单词有一词多义，尽量把默认单词库都丰富一遍」。
   问题是词书共享表的一行 = 一张**背诵卡**，释义只有 20 字上限 —— 一个词
   源表里有十几个义项，界面上永远只看得到前四五个。

   所以词表流水线（_vocab/build.js）按同一套清洗规则另出了一份**不截断**
   的版本，这里把它接进来。三条边界：

     1. **只给词典层用**：词条页 / 点读 / 义项补全。背诵卡和搜索结果列表
        仍然用短版 —— 那些地方要的是"一眼扫完"，摆一堵字墙反而难用。
     2. **不进检索索引**：刻意没有并进 forEachEntry / searchRows。
        那张平表是给"我打了几个字母，本地有没有"用的，每条只显示一行；
        把长释义塞进去，搜索列表就全变字墙了。
     3. **不产生词书 id**：和 extra-words.js 一样是只读查词兜底，
        不占共享表行号，老用户的学习进度一动不动。

   表里只收「短版被截断」的词（约 3316 条），其余词短版就是全量 ——
   所以查不到不代表性本地不认识，判断收录与否仍然走 lookup()。
   查找方式：直接在原始文本里扫那一行（'\n词|'），不预解析成 Map。
   3316 条建成对象要多吃约 800KB 常驻堆，而这功能只在词条页 / 义项补全
   这种"一次一两条"的地方用 —— 扫一次 319KB 文本是原生 indexOf，比重得多。 */
function sensesLine(key) {
  if (!key) return null
  const at = SENSES_RAW.indexOf('\n' + key + '|')
  if (at < 0) return null
  const end = SENSES_RAW.indexOf('\n', at + 1)
  return SENSES_RAW.slice(at + 1, end < 0 ? SENSES_RAW.length : end)
}

/**
 * "a；b；c" / "a，b，c" → ['a','b','c']（空输入返回 []，不是 ['']）。
 * 切分口径与 utils/word-polish-mixin.js 的 senseCount 保持一致 ——
 * 否则同一个词会算出两个"义项数"，界面该不该补 AI 就对不上了。
 */
export function splitSenses(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  return s.split(/[；;，,、]|\s+\/\s+/).map(function (x) { return String(x || '').trim() }).filter(Boolean);
}

/**
 * 这个词的**完整释义**（不截断）。词典层专用。
 * 表里没有长版时退回 lookup 的短版 —— 那份本来就已经是全量了。
 * @returns '' = 本地不认识这个词
 */
export function fullMeaningOf(raw) {
  try {
    const r = lookup(raw);
    if (!r.found) return '';
    // 用还原后的原形查（socks → sock）：表里存的是词表里的原形。
    // 原形那边也没有就退回原形本身再试一次（还原可能还原过头）。
    const lemma = String(r.lemma || normalize(raw) || '').toLowerCase()
    const line = sensesLine(lemma) || sensesLine(normalize(raw))
    if (!line) return r.meaning || ''
    const i = line.indexOf('|')
    const j = line.indexOf('|', i + 1)
    if (i < 0 || j < 0) return r.meaning || ''
    return line.slice(j + 1) || r.meaning || ''
  } catch (e) { return ''; }
}

/** 完整义项数组。空数组 = 本地不认识这个词。 */
export function fullSensesOf(raw) {
  return splitSenses(fullMeaningOf(raw));
}

/* ---------- 全量本地词典索引（给「搜/x 搜得着」用） ----------
   点读是"这个词什么意思"（精确命中，走 lookup）；
   查词是"我打了这几个字母，本地有没有"（要能前缀 / 近似匹配，必须扫全表）。

   以前 utils/search.js 只扫「当前词书」，4563 个内置词条只有**拼完整了**才捞得到
   （dict.lookup 是精确 + 词形还原），于是换个词书搜索结果就少一大截 —— 这就是
   "有些词明明有、就是搜不到"的来源。这里把所有层合成一张逻辑上的平表：

     core（words.js 640）→ common（常用词）→ book（共享表）→ extra（补充表）

   刻意**不含**用户的导入词：那是按词书分桶的私人内容，
   搜 A 书时不该蹦出 B 书里你自己加的词（check-search 第 6 组守的就是这条）。

   ⚠️ 两个都留着是为了把"省内存"和"省时间"分开：
   就地遍历不占额外内存，但每次按键要多花一倍时间（实测 7.7ms → 4.5ms 的差别，
   手机上感知得到）；固化成数组要多吃约 570KB 常驻堆（实测），换来每次按键快一倍。
   热路径（utils/search.js）用数组；一次性统计走 forEachEntry。
   check-builtin-books 第 8 组盯着这两个数。 */
export function forEachEntry(fn) {
  const visit = function (k, w, pos, m, src) {
    const key = String(k || '').toLowerCase();
    if (!key) return;
    fn(key, w, pos || '', m || '', src);
  };
  for (let i = 0; i < WORDS.length; i++) {
    const w = WORDS[i];
    visit(w.w, w.w, w.pos, w.m, 'core');
  }
  try {
    for (const key in COMMON) {
      const c = COMMON[key];
      visit(key, c.w, c.pos, c.meaning, 'common');
    }
    const abt = allByText();
    for (const key in abt) {
      const b = abt[key];
      visit(key, b.w, b.pos, b.m, 'book');
    }
  } catch (e) { /* 共享表读不出来就少一层，不致命 */ }
  try {
    const ex = extraTable();
    for (const key in ex) {
      const e = ex[key];
      visit(key, e.w, e.pos, e.meaning, 'extra');
    }
  } catch (e) { /* 同上 */ }
}

/**
 * 同一份平表，固化成数组返回（内部走一遍 forEachEntry，懒建 + 单例）。
 * 按键每敲一下都要扫全表，所以用数组而非就地遍历（时间/内存的取舍见上面那段注释）。
 * 新词入库后调用方的 invalidateCache() 会把它清掉重建。
 */
let _rows = null;
export function searchRows() {
  if (_rows) return _rows;
  const out = [];
  const seen = Object.create(null);
  forEachEntry(function (key, w, pos, m, src) {
    if (seen[key]) return;      // 同一词形多层重复 → 只留最高优先级的那条
    seen[key] = 1;
    out.push({ k: key, w: w, pos: pos, m: m, src: src });
  });
  _rows = out;
  return out;
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
  // 全量检索表跟着失效：新收的词下一次搜索就得搜得到，不能等重启 App
  _rows = null;
  // 完整义项表不建索引、不缓存，无需清理（见 sensesLine 的说明）
}

export { lemma };
