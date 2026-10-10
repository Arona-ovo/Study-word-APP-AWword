// utils/word-session.js - 「刷单词」模式的组牌逻辑（纯本地，不走 AI）
//
// 和「翻译练习」是两条互不干扰的链路，分工如下：
//   翻译练习 = 围绕句子出题（i+1 选词 → AI 造句 → 中英互译），考的是"会不会用这个词"
//   刷单词   = 直接对着词表和掌握度排优先级，考的是"认不认识这个词"
// 两者只有回写口径共用（engine.recordAnswer + iplus1.recordMastery），
// 这样首页的今日数据 / 连续天数 / 掌握度概览两种练法都算数，但统计不用改第二套。
//
// 组牌不发请求：排序、配干扰项、找例句都在本地算完，所以点进去就是第一题，
// 没有"正在生成例句…"的等待。

import * as wordbook from './wordbook.js';
import * as sentenceIndex from './sentence-index.js';
import * as srs from './srs.js';

// 三种题目来源：
//   daily  日常：整本书按"该练程度"排队，新词优先、掌握度低的优先
//   review 复习：只取学过但还没掌握的词（m <= WEAK_M），期末一周刷的就是它
//   new    新词：只取完全没见过的词 —— 和首页「每日新词」目标天然对齐
export const SOURCES = ['daily', 'review', 'new'];

// 每组默认词量。固定值而不再加一个"每日刷词目标"：
// 已经有「每日新词」目标（按 fs 首见统计）在管节奏，这里只负责一次给多少词。
export const DECK_SIZE = { min: 5, max: 60, def: 20 };

const MASTERED_M = 4;
const WEAK_M = 2;
const MAX_OPTIONS = 4;

// 一个词"该练"的程度：越大越靠前。
// 三档 FedEx：①完全没见过排最前（不然新词永远轮不到，书背不完）
// ②掌握度越低越靠前（快要忘的先巩固）③练过很多次的往后排
// ——最后一条是关键：只按掌握度排的话，一批卡在 m=0 的硬骨头会把整组题占满，
//   其它词再也排不进来，用户感觉"怎么老是这几个词"。
function needScore(rec) {
  const jitter = Math.random();
  if (!rec) return 200 + jitter * 20;
  const m = Number(rec.m) || 0;
  const seen = Number(rec.seen) || 0;
  return 40 + (5 - Math.min(5, m)) * 30 - Math.min(24, seen) + jitter * 15;
}

export function statusKey(rec) {
  if (!rec) return 'new';
  const m = Number(rec.m) || 0;
  if (m >= MASTERED_M) return 'mastered';
  if (m >= WEAK_M + 1) return 'familiar';
  return 'learning';
}

/** 词书里的词按掌握情况分档计数（首页「刷单词」卡要用） */
export function counts(bookId) {
  const all = wordbook.bookWords(bookId) || [];
  const map = wordbook.masteryMap(bookId) || {};
  const out = { total: all.length, new: 0, learning: 0, familiar: 0, mastered: 0 };
  all.forEach(e => {
    out[statusKey(map[e.id] || null)]++;
  });
  return out;
}

/**
 * 到期巩固词在一组里最多占多少。
 * 不给上限的话，背到后面到期堆会越来越大，一组 20 个全是旧词，
 * 新词永远排不进来 —— 书就背不完了。给一半：既保证到期的当天会被照顾到，
 * 又留出名额推进新内容。
 */
export const DUE_RATIO = 0.5;

/** 这本书现在有多少词到期待巩固（首页「刷单词」卡要用） */
export function dueStats(bookId, today) {
  const map = wordbook.masteryMap(bookId || wordbook.currentBookId()) || {};
  return srs.dueCount(map, today || srs.dateStr());
}

/**
 * 组牌：先按来源筛一遍，然后——
 *   ① 到期的巩固词优先（按逾期天数，欠得越久越靠前），最多占 DUE_RATIO
 *   ② 剩下的名额再按"该练程度"降序补
 * 以前只有 ②，结果是"今天学完的词，明天再也不会主动出现"，
 * 除非它恰好掉进错题本。间隔重复本来该由调度器决定什么时候回来，
 * 而不是靠它自己烂到 m 掉下来才被捞起来。
 */
export function pickWords(n, bookId, source, today) {
  const map = wordbook.masteryMap(bookId) || {};
  const dt = srs.dateStr(today);
  const rows = (wordbook.bookWords(bookId) || []).map(e => {
    const rec = map[e.id] || null;
    return { entry: e, rec: rec, need: needScore(rec), due: srs.isDue(rec, dt) };
  });
  const want = Math.max(0, Math.min(DECK_SIZE.max, Number(n) || 0));
  if (!want) return [];

  let pool = rows;
  if (source === 'new') {
    pool = rows.filter(x => !x.rec);
  } else if (source === 'review') {
    pool = rows.filter(x => x.rec && (Number(x.rec.m) || 0) <= WEAK_M);
  }

  // 到期堆与常规堆分开排：到期堆按"逾期多久"，常规堆按"该练程度"
  const dueRows = pool.filter(x => x.due);
  dueRows.sort((a, b) => srs.overdueDays(b.rec, dt) - srs.overdueDays(a.rec, dt));
  const quota = Math.min(dueRows.length, Math.ceil(want * DUE_RATIO));
  const picked = dueRows.slice(0, quota);

  const taken = {};
  picked.forEach(x => { taken[x.entry.id] = true });
  const rest = pool.filter(x => !taken[x.entry.id]);
  rest.sort((a, b) => b.need - a.need);

  return picked.concat(rest).slice(0, want).map(x => x.entry);
}

// 干扰项：优先同词性的其它词 —— 四个选项都是名词时才有迷惑性，
// 混一个动词进去一眼就看出来了，那种"假难度"没有训练价值。
// 词书太小凑不满时降级到任意词性的其它词。
function distractors(entry, pool) {
  const own = String(entry.w || '').toLowerCase();
  const pos = String(entry.pos || '');
  const used = {};
  const answer = String(entry.m || '').trim();
  used[answer] = true;
  const same = [];
  const other = [];
  (pool || []).forEach(p => {
    if (!p || !p.m) return;
    if (String(p.w || '').toLowerCase() === own) return;
    const mean = String(p.m || '').trim();
    if (!mean || used[mean]) return;
    used[mean] = true;
    if (String(p.pos || '') === pos) same.push(mean);
    else other.push(mean);
  });
  return { same: same, other: other };
}

/**
 * 反向题的干扰项：给中文释义，选项是**英文单词**。
 * 同样优先同词性；另外按"长度差"排序取最接近的 ——
 * 四个选项里混一个明显更长/更短的词，用户不认得也能靠长度猜出来（那是假难度）。
 */
function wordDistractors(entry, pool) {
  const own = String(entry.w || '').toLowerCase();
  const pos = String(entry.pos || '');
  const len = own.length;
  const used = {};
  used[own] = true;
  const same = [];
  const other = [];
  (pool || []).forEach(p => {
    const w = String(p.w || '').toLowerCase();
    if (!w || used[w]) return;
    used[w] = true;
    const row = { w: p.w, gap: Math.abs(w.length - len) };
    if (String(p.pos || '') === pos) same.push(row);
    else other.push(row);
  });
  const sort = arr => arr.sort((a, b) => a.gap - b.gap).map(x => x.w);
  return { same: sort(same), other: sort(other) };
}

/** 拼写提示：首字母 + 其余用下划线（a _ _ _ e 比直接给 a**** 更像"提示"而非"剧透"） */
export function spellHint(word) {
  const w = String(word || '').trim();
  if (!w) return '';
  return w.split('').map((c, i) => (i === 0 ? c : '_')).join(' ');
}

// 打乱后放回：正确答案必须跟着换位，否则 answerIndex 会指到别人身上
function pack(raw, answer) {
  const arr = raw.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return { options: arr, answerIndex: Math.max(0, arr.indexOf(answer)) };
}

// 例句优先级：导入词自带的例句 > 本地语料反查。
// 语料里同一个词可能有好几句，取难度最接近、句子最短的那条 ——
// 短句更容易和单词本身绑定记忆。
function pickExample(entry) {
  const own = String(entry.exampleEn || '').trim();
  if (own) return { en: own, zh: String(entry.exampleZh || '').trim() };
  let list = [];
  try {
    list = sentenceIndex.candidates(entry.w) || [];
  } catch (e) {
    list = [];
  }
  if (!list.length) return null;
  const elv = Number(entry.lv) || 0;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    const s = list[i];
    const gap = Math.abs((Number(s.lv) || 0) - elv);
    const cur = Math.abs((Number(best.lv) || 0) - elv);
    if (gap < cur) best = s;
    else if (gap === cur && String(s.en || '').length < String(best.en || '').length) best = s;
  }
  return { en: String(best.en || ''), zh: String(best.zh || '') };
}

/**
 * 把词表里的一个词变成一道"刷单词"的题。
 * 返回体刻意带上 words / wordIds —— 回写要喂给 iplus1.recordMastery 与
 * engine.recordAnswer，两者都靠 q.words[].id 认词；少了它掌握度会一笔不写。
 */
export function toItem(entry, pool, bookId) {
  const map = wordbook.masteryMap(bookId) || {};
  const rec = map[entry.id] || null;
  const answer = String(entry.m || '').trim();
  const d = distractors(entry, pool);
  const bag = d.same.concat(d.other);
  const raw = [answer].concat(bag.slice(0, MAX_OPTIONS - 1));
  const packed = pack(raw, answer);
  const example = pickExample(entry);

  // 三档题型一次造齐（造题只用本地数据，没有网络开销）：
  //   recog  认得出 —— 看英文选中文（识别，最浅的一档，老版本只有这一种）
  //   recall 想得起 —— 看中文选英文（反向提取，比"认"难一档）
  //   spell  写得出 —— 看中文+首字母手写英文（产出，最难，也最练拼写）
  // 确认会话按连对次数逐档往上走，同一个词不会连着考同一种题型。
  const wd = wordDistractors(entry, pool);
  const wbag = wd.same.concat(wd.other);
  const wraw = [String(entry.w || '')].concat(wbag.slice(0, MAX_OPTIONS - 1));
  const wpacked = pack(wraw, String(entry.w || ''));

  return {
    id: entry.id,
    w: entry.w,
    pos: entry.pos || '',
    m: entry.m || '',
    lv: entry.lv || 1,
    custom: !!entry.custom,
    // 顶层 options/answerIndex 就是 recog 的那一份：
    // 翻译练习页的确认题还在用这两个字段（向后兼容，别删）
    options: packed.options,
    answerIndex: packed.answerIndex,
    modes: {
      recog: { options: packed.options, answerIndex: packed.answerIndex },
      recall: { options: wpacked.options, answerIndex: wpacked.answerIndex },
      spell: { answer: String(entry.w || ''), hint: spellHint(entry.w) }
    },
    exampleEn: example ? example.en : '',
    exampleZh: example ? example.zh : '',
    mastery: rec ? (Number(rec.m) || 0) : 0,
    seen: rec ? (Number(rec.seen) || 0) : 0,
    status: statusKey(rec),
    // 巩固调度状态（srs）：st 已完成几次 / due 下次哪天 / lp 忘过几次
    srs: {
      st: Number(rec && rec.st) || 0,
      due: String((rec && rec.due) || ''),
      lp: Number(rec && rec.lp) || 0
    },
    wordIds: [entry.id],
    words: [{ id: entry.id, w: entry.w, pos: entry.pos, m: entry.m }]
  };
}

/**
 * 组一组题。
 * 每组的干扰项候选池是「整本书」，不是「这组词」—— 只从 20 个词里找干扰项的话，
 * 四个选项会因为全都做过多轮往返而显得眼熟，等于变相提示。
 */
export function buildDeck(n, bookId, source) {
  const words = pickWords(n, bookId, source);
  const pool = wordbook.bookWords(bookId) || [];
  return words.map(e => toItem(e, pool, bookId));
}

// ---------- 多次确认会话（不背单词机制 + 跨题型） ----------
//
// 一遍答对不算学会。而且要**换着方式**答对才算：
//   · 同一个词要连续答对 CONFIRM_TIMES 次，且每次的题型都不同 ——
//     认得出（英→中选义）→ 想得起（中→英反向）→ 写得出（中文+首字母拼写）。
//     三档的提取难度是递增的（识别 < 回忆 < 产出），换路径本身就是强化，
//     比"同一道选择题刷三遍"有效得多 —— 后者考的还是那一条记忆通路。
//   · 中间答错一次就连击清零、题型退回第一档，重新排进队列再练。
//     队列里永远隔两个词再回头，避免刚看完答案马上原题重放。
//   · 复习（review）：第一次就答对 → 直接算记住；答错 → 升级成完整的三关确认。
//   · 「记错了」：答对之后反悔，连击清零、进度回退，该词重新排队。
//
// ⚠️ 场次内的三关只是"当场学会"，它**不**等于长期记住 ——
// 三关前后只隔几十秒，考的仍是短时记忆。真正的长期记忆由 srs.js 的
// 跨天巩固阶梯接管（明天、3 天后、7 天后……），两者是接力关系，不是替代。
export const CONFIRM_TIMES = 3;

// 三档题型，顺序即难度递增（第 n 关 = 第 n 项）
export const CONFIRM_MODES = ['recog', 'recall', 'spell'];

export const MODE_LABEL = {
  recog: '认得出',
  recall: '想得起',
  spell: '写得出',
  self: '自评'
};

/**
 * 页面上的三种作答方式 → 题型 key。
 * 'self'（自评）不在标准三档里 —— 它是"先在心里过一遍再给自己打分"，
 * 属于元认知判断，单独算一档，只在第一关出现，后两关仍走 认→想→写。
 */
const MODE_OF_UI = { choice: 'recog', spell: 'spell', self: 'self' };

/**
 * 按用户选的作答方式排出三关顺序：**第一关用他选的，后两关自动换成别的**。
 * 这样既尊重选择，又保证同一个词不会连着三遍考同一种提取方式 ——
 * 三遍同一种题型考的还是那一条记忆通路，换题型才是真的在换通路。
 */
export function buildModeSequence(preferred) {
  const first = MODE_OF_UI[preferred] || 'recog';
  if (first === 'self') return ['self', 'recog', 'recall'];
  const at = Math.max(0, CONFIRM_MODES.indexOf(first));
  const seq = [first];
  for (let i = 1; i < CONFIRM_MODES.length; i++) {
    seq.push(CONFIRM_MODES[(at + i) % CONFIRM_MODES.length]);
  }
  return seq.slice(0, CONFIRM_TIMES);
}

/** 连对到第几次该用哪种题型（走完就停在最后一档，防止越界） */
export function modeAt(streak, modes) {
  const seq = (modes && modes.length) ? modes : CONFIRM_MODES;
  const i = Math.max(0, Math.min(seq.length - 1, Number(streak) || 0));
  return seq[i];
}

export function createConfirmSession(deck, opts) {
  const review = !!(opts && opts.review);
  // ⚠️ 必须是 let：setModes() 会在用户中途换作答方式时重新赋值。
  // 写成 const 的话那一行直接抛 "Assignment to constant variable" ——
  // 抛在 switchMode 里，setupQuestion 就不会跑，表现为"胶囊高亮了但题目没变"，
  // 用户只会以为那三个按钮没用。
  let modes = (opts && opts.modes && opts.modes.length) ? opts.modes : CONFIRM_MODES;
  const byId = {};
  (deck || []).forEach(x => { byId[x.id] = x });
  const state = {};
  (deck || []).forEach(x => {
    state[x.id] = { streak: 0, need: review ? 1 : CONFIRM_TIMES };
  });
  let queue = (deck || []).map(x => x.id);
  let done = 0;      // 已确认记住的词数（页面进度条的分子）
  let answered = 0;  // 总作答次数

  // 重新排队：插到队列第 3 位（隔两个词再出现）；队列只剩它时就是立即重来
  function requeue(id) {
    queue.splice(Math.min(2, queue.length), 0, id);
  }

  return {
    /** 当前要练的词（deck 里的原对象）；null = 本组全部确认完成 */
    current() {
      return queue.length ? (byId[queue[0]] || null) : null;
    },

    /**
     * 中途换题型序列（用户在顶部胶囊换了作答方式）。
     * 只影响还没闯完的关：已经连对过的次数不清零，否则等于偷偷放水。
     */
    setModes(next) {
      if (next && next.length) modes = next.slice();
    },

    /** 当前这题该用哪种题型（第 n 关 = 第 n 档） */
    currentMode() {
      if (!queue.length) return modeAt(0, modes);
      return modeAt((state[queue[0]] || {}).streak, modes);
    },

    /** 当前词的闯关进度：连对几次 / 共几次 / 这一关考什么 */
    currentStep() {
      if (!queue.length) return { streak: 0, need: CONFIRM_TIMES, mode: modeAt(0, modes) };
      const s = state[queue[0]] || { streak: 0, need: CONFIRM_TIMES };
      return { streak: Number(s.streak) || 0, need: s.need, mode: modeAt(s.streak, modes) };
    },

    /** 回答一次（known=true 记「认识」）。返回该词的最新确认状态 */
    answer(known) {
      if (!queue.length) return null;
      const id = queue.shift();
      const s = state[id] || (state[id] = { streak: 0, need: CONFIRM_TIMES });
      const mode = modeAt(s.streak, modes);  // 必须在改 streak 之前取：这是"这一关"的题型
      answered++;
      if (known) {
        s.streak++;
        if (s.streak >= s.need) {
          done++;
          return { id, done: true, streak: s.streak, need: s.need, mode: mode };
        }
      } else {
        s.streak = 0;
        // 复习首答（need=1）没答上 → 升级成完整的三关确认，别让它一遍就溜过去
        if (s.need < CONFIRM_TIMES) s.need = CONFIRM_TIMES;
      }
      requeue(id);
      return { id, done: false, streak: s.streak, need: s.need, mode: mode };
    },

    /**
     * 「记错了」：把刚答对的那一笔作废（连击清零；若已计入进度则回退并重新排队）。
     * 返回 { ok, rolledBack }：rolledBack = 这个词原本已经算"记住"、这次被撤了 ——
     * 页面据此把今日「学会」计数 -1（否则目标口径里会留一笔虚的）。
     */
    markWrong(id) {
      const s = state[id];
      if (!s) return { ok: false, rolledBack: false };
      const completed = queue.indexOf(id) < 0;
      s.streak = 0;
      s.need = CONFIRM_TIMES;
      let rolledBack = false;
      if (completed) {
        done = Math.max(0, done - 1);
        rolledBack = true;
        requeue(id);
      }
      return { ok: true, rolledBack: rolledBack };
    },

    progress() {
      return { done, total: (deck || []).length, answered };
    },

    isDone() {
      return queue.length === 0;
    }
  };
}

// ---------- 与 srs 的接缝：把"当场学会 / 巩固一次"写进掌握度 ----------
// 状态机只管这一场次的连对与排队，落盘交给这里 —— 两个入口，别绕开直接写：
//   markLearned  第一次当场过关三关 → 进巩固队列，明天来确认
//   markReviewed 到期回来巩固一次 → 答对进一阶（间隔拉长），答错退回第 0 阶

export function markLearned(bookId, wordId, today) {
  const bid = bookId || wordbook.currentBookId();
  const map = wordbook.masteryMap(bid) || {};
  const patch = srs.learn(today || srs.dateStr());
  wordbook.setMastery(bid, wordId, patch);
  return Object.assign({}, map[wordId] || {}, patch);
}

export function markReviewed(bookId, wordId, ok, today) {
  const bid = bookId || wordbook.currentBookId();
  const map = wordbook.masteryMap(bid) || {};
  const patch = srs.review(map[wordId] || {}, ok, today || srs.dateStr());
  wordbook.setMastery(bid, wordId, patch);
  return Object.assign({}, map[wordId] || {}, patch);
}
