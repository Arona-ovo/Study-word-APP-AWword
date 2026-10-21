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

// ---------- 干扰项：像 + 每次不一样 ----------
// ⚠️ 2026-10-21 重做。旧实现是"按词性分两堆 → slice(0, 3)"，两个毛病：
//   ① 取到的是**词表里排最靠前的同词性词**，一次抽好之后整场不变 →
//      用户每次进背单词看到的另外三个一模一样；
//   ② 那三个跟要背的词毫无关系，只是恰好同词性 —— 没有迷惑性，等于白送。
// 现在两步：先按"像不像"打分排序，再**从最像的一批里随机抽**。
//   像 = 有迷惑性（真难度）；随机 = 每次不一样（不会背成"选项固定"的假记忆）。
// ⚠️ 仍然同词性优先：四个选项都是名词时才有迷惑性，混一个动词进去一眼就看出来了。
const NEAR_POOL = 12;   // 从最像的这么多里随机抽（池子越小越难，越大越随机）

// 中文释义的"像"：共享的二字块越多越像。
// "减少；降低" 与 "降低；缩减" 很像是真的像；"苹果" 与 "提高" 一点也不像。
// 只看汉字（词性标注里的 n. / v. 符号不参与，否则所有 v. 都"很像"）。
const HAN_RE = /[\u4e00-\u9fa5]/;
function hanGrams(s) {
  const t = String(s || '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) {
    if (HAN_RE.test(t[i]) && HAN_RE.test(t[i + 1])) out.push(t.slice(i, i + 2));
  }
  return out;
}
export function zhSim(a, b) {
  const ga = hanGrams(a);
  const gb = hanGrams(b);
  if (!ga.length || !gb.length) return 0;
  const left = {};
  ga.forEach(g => { left[g] = (left[g] || 0) + 1; });
  let hit = 0;
  gb.forEach(g => { if (left[g] > 0) { left[g]--; hit++; } });
  return hit / (ga.length + gb.length - hit);   // 0~1 的 Jaccard
}

// 英文词形的"像"：公共前缀最吃重（前缀相同的词最容易看混），其次是公共后缀，
// 长度差是扣分项 —— 四个选项里混一个明显更长/更短的，不认得也能靠长度猜出来。
export function enSim(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return 0;
  let pre = 0;
  const maxPre = Math.min(x.length, y.length);
  while (pre < maxPre && x[pre] === y[pre]) pre++;
  let suf = 0;
  const maxSuf = Math.min(x.length, y.length) - pre;
  while (suf < maxSuf && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  return pre * 2 + suf - Math.abs(x.length - y.length) * 0.5;
}

// 洗牌后取前 need 个
function take(rows, need) {
  const pool = rows.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, need).map(x => x.text);
}

// "算不算像"的下限。⚠️ 不能只看 score > 0：
//   中文那边 >0 就够（= 至少共享一个二字词块，信号已经很强）；
//   英文那边 >0 太松（只要首字母相同就有分），得抬到 3 —— 那才叫"形近词"。
const ZH_NEAR = 0.08;
const EN_NEAR = 3;

/**
 * 抽干扰项（rows 已按 score 降序）：
 *   ① 优先只从**真的像**的那批里随机抽（score >= floor）；
 *   ② 像的不够（词书里确实没有近义 / 形近词）再从其余候选里随机补。
 * ⚠️ 关键是"随机"：旧实现取的是排序后的前 need 个 —— 那就是每次都一样的固定三个。
 */
function sampleNear(rows, need, floor) {
  if (!rows.length || need <= 0) return [];
  let cut = 0;
  while (cut < rows.length && rows[cut].score >= floor) cut++;
  const got = take(rows.slice(0, cut), need);
  if (got.length < need) {
    got.push.apply(got, take(rows.slice(cut, cut + NEAR_POOL), need - got.length));
  }
  return got;
}

// 认得出（看英文选中文）：干扰项按**中文释义**的相似度排
function distractors(entry, pool, need) {
  const own = String(entry.w || '').toLowerCase();
  const pos = String(entry.pos || '');
  const answer = String(entry.m || '').trim();
  const used = {};
  used[answer] = true;
  const same = [];
  const other = [];
  (pool || []).forEach(p => {
    if (!p || !p.m) return;
    if (String(p.w || '').toLowerCase() === own) return;
    const mean = String(p.m || '').trim();
    if (!mean || used[mean]) return;
    used[mean] = true;
    const row = { text: mean, score: zhSim(answer, mean) };
    if (String(p.pos || '') === pos) same.push(row);
    else other.push(row);
  });
  const bySim = (a, b) => b.score - a.score;
  same.sort(bySim);
  other.sort(bySim);
  const got = sampleNear(same, need, ZH_NEAR);
  // 同词性不够（词书小 / 该词性词少）再从别的词性里补
  if (got.length < need) got.push.apply(got, sampleNear(other, need - got.length, ZH_NEAR));
  return got;
}

// 想得起（看中文选英文）：干扰项按**词形**的相似度排
function wordDistractors(entry, pool, need) {
  const own = String(entry.w || '').toLowerCase();
  const pos = String(entry.pos || '');
  const used = {};
  used[own] = true;
  const same = [];
  const other = [];
  (pool || []).forEach(p => {
    const w = String(p.w || '').toLowerCase();
    if (!w || used[w]) return;
    used[w] = true;
    const row = { text: p.w, score: enSim(own, w) };
    if (String(p.pos || '') === pos) same.push(row);
    else other.push(row);
  });
  const bySim = (a, b) => b.score - a.score;
  same.sort(bySim);
  other.sort(bySim);
  const got = sampleNear(same, need, EN_NEAR);
  if (got.length < need) got.push.apply(got, sampleNear(other, need - got.length, EN_NEAR));
  return got;
}

/** 三种题型的选项一次造齐（造题只用本地数据，没有网络开销） */
function buildOptions(entry, pool) {
  const need = MAX_OPTIONS - 1;
  const answer = String(entry.w || '');
  const mean = String(entry.m || '').trim();
  const packed = pack([mean].concat(distractors(entry, pool, need)), mean);
  const wpacked = pack([answer].concat(wordDistractors(entry, pool, need)), answer);
  return {
    recog: packed,
    recall: wpacked,
    spell: { answer: answer, hint: spellHint(entry.w) }
  };
}

/**
 * 同一场次里重抽干扰项（同一个词第二次出现时换一批选项）。
 * 三关之间、或者答错被退回重排队再出现时，选项不该还是原来那三个 ——
 * 背单词页每次出题前调一次。不传 pool 就当没这事（调用方拿不到词表时别炸）。
 */
export function refreshOptions(item, pool) {
  if (!item || !pool || pool.length < 2) return item;
  const opts = buildOptions({ id: item.id, w: item.w, pos: item.pos, m: item.m }, pool);
  item.modes = {
    recog: opts.recog,
    recall: opts.recall,
    spell: opts.spell
  };
  // 顶层这两个字段是向后兼容用的（翻译练习页的确认题还在读），必须跟着一起换
  item.options = opts.recog.options;
  item.answerIndex = opts.recog.answerIndex;
  return item;
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
  const example = pickExample(entry);
  // 三档题型一次造齐（造题只用本地数据，没有网络开销）：
  //   recog  认得出 —— 看英文选中文（识别，最浅的一档，老版本只有这一种）
  //   recall 想得起 —— 看中文选英文（反向提取，比"认"难一档）
  //   spell  写得出 —— 看中文+首字母手写英文（产出，最难，也最练拼写）
  // 确认会话按连对次数逐档往上走，同一个词不会连着考同一种题型。
  // ⚠️ 选项走 buildOptions：干扰项是"像的里面随机抽"（见 NEAR_POOL 那一段的注释）。
  const opts = buildOptions(entry, pool);

  return {
    id: entry.id,
    w: entry.w,
    pos: entry.pos || '',
    m: entry.m || '',
    lv: entry.lv || 1,
    custom: !!entry.custom,
    // 顶层 options/answerIndex 就是 recog 的那一份：
    // 翻译练习页的确认题还在用这两个字段（向后兼容，别删）
    options: opts.recog.options,
    answerIndex: opts.recog.answerIndex,
    modes: opts,
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

/**
 * 从快照恢复会话时的验证：快照里记的是"上次那组词"和"练到哪了"，
 * 但两次进入之间词书可能被换掉、词条可能被删 —— 拿一份对不上的快照直接灌进去，
 * 轻则队列里出现空题（`byId[id]` 是 undefined → current() 返回 null → 页面空白），
 * 重则进度条分母和队列对不上。所以恢复前必须逐个 id 校验，对不上就整份作废。
 * 返回 null = 这份快照不能用（调用方退回"重新组一组"）。
 */
function validSnapshot(deck, snap) {
  if (!snap || typeof snap !== 'object') return null;
  const byId = {};
  (deck || []).forEach(x => { byId[x.id] = x });
  const queue = Array.isArray(snap.queue) ? snap.queue : null;
  if (!queue) return null;
  // 队列里每个 id 都得在这组题里，且不能重复
  const seen = {};
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (!byId[id] || seen[id]) return null;
    seen[id] = true;
  }
  // 每个词的闯关状态也必须是这份 deck 里的（多出来的直接丢，不整份作废）
  const state = {};
  (deck || []).forEach(x => {
    const s = snap.state && snap.state[x.id];
    state[x.id] = s
      ? { streak: Math.max(0, Number(s.streak) || 0), need: Math.max(1, Number(s.need) || CONFIRM_TIMES) }
      : { streak: 0, need: snap.review ? 1 : CONFIRM_TIMES };
  });
  return { queue: queue.slice(), state: state, modes: snap.modes, review: !!snap.review };
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
  let state = {};
  (deck || []).forEach(x => {
    state[x.id] = { streak: 0, need: review ? 1 : CONFIRM_TIMES };
  });
  let queue = (deck || []).map(x => x.id);
  let done = 0;      // 已确认记住的词数（页面进度条的分子）
  let answered = 0;  // 总作答次数

  // 断点续练：把上次那份快照灌回来（study-resume.js 负责存/取）。
  // 只在**刚创建时**生效一次 —— 之后的状态变化由调用方重新 snapshot() 存盘。
  const restored = validSnapshot(deck, opts && opts.saved);
  if (restored) {
    queue = restored.queue;
    state = restored.state;
    if (restored.modes && restored.modes.length) modes = restored.modes.slice();
    done = Math.max(0, Number(opts.saved.done) || 0);
    answered = Math.max(0, Number(opts.saved.answered) || 0);
    // done 不能超过这组词的总数（快照被改坏时的兜底，进度条不会溢出）
    done = Math.min(done, (deck || []).length);
  }

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
    },

    /**
     * 断点续练快照（纯 JSON，给 study-resume.js 存盘用）。
     * 存 queue 而不是"当前第几题"：确认会话的队列是**会重排**的
     * （答错 / 记错了都会把该词插回第 3 位），光记下标恢复不出"谁还没过"。
     */
    snapshot() {
      return {
        queue: queue.slice(),
        state: Object.keys(state).reduce((o, id) => {
          o[id] = { streak: state[id].streak, need: state[id].need };
          return o;
        }, {}),
        modes: modes.slice(),
        review: review,
        done: done,
        answered: answered
      };
    },

    /** 这一场是不是从上次接着练的（页面据此提示"已回到上次进度"） */
    resumed() {
      return !!restored;
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
