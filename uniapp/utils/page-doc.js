// utils/page-doc.js - 首页「页面文档」：AI 可改的那份数据
//
// 边界：AI 不碰 DOM、不碰源码，只能通过指令改这份 doc；
// 页面是 doc 的纯函数渲染结果。doc 每次都整体替换（不可变），
// 所以「失败回退」天然等于「不写入新 doc」，撤销也只是换回上一个对象。
//
// 与 utils/home-layout.ts 的分工：
//   · home-layout 负责「内置模块有哪些 + 默认顺序 + 拖拽落点算法」
//   · pageDoc.cards 是最终渲染用的有序列表：内置卡 + AI 新建的卡
//   首次进入时用 home-layout 的 defaultLayout() 播种，之后以 pageDoc 为准。

import * as settings from './settings.js';
import * as wordbook from './wordbook.js';
import * as homeLayout from './home-layout.ts';
import * as usage from './usage.js';
import * as engine from './engine.js';

export const VERSION = 1;

/** 一张内置卡的最小形态（渲染时按 type 找到对应模块组件） */
function builtinCard(id) {
  return {
    id: id,
    type: id,
    builtin: true,
    visible: true,
    title: '',
    text: '',
    image: '',
    style: null,
    blocks: null
  };
}

/** 造一张内置卡（card.restore 用；不直接导出，避免被当成通用工厂） */
export function __builtin(id) {
  return builtinCard(id);
}

export function defaultDoc() {
  return {
    version: VERSION,
    background: { preset: 'default', image: '', mask: 0.35, blur: 0, gradient: null },
    theme: { accent: '', dark: null, font: '', motion: null, density: '' },
    cards: homeLayout.defaultLayout().map(builtinCard)
  };
}

function deepClone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
}

function markSeen(doc) {
  try {
    const ids = (doc.cards || []).filter(c => c.builtin).map(c => String(c.id));
    settings.set({ home: { seenBuiltins: ids } });
  } catch (e) { /* 记不住不影响渲染 */ }
}

/**
 * 新增内置模块后，老用户的首页里没有那张卡（doc 是持久化的，不会自己长出来）。
 * 判据是 home.seenBuiltins —— 这张首页"见过"哪些内置卡：
 *   · 从没记过 → 老数据，把注册表里默认上首页、而这张 doc 里没有的模块补进来
 *   · 记过且某模块在记录里 → 用户自己收纳/删掉了，绝不再塞回去
 * 补充的卡放在内置卡末尾、AI 卡之前。
 */
function ensureBuiltins(doc) {
  const st = settings.get() || {};
  const raw = (st.home || {}).seenBuiltins;
  const seen = Array.isArray(raw) ? raw.map(String) : null;
  const cards = (doc.cards || []).slice();
  const built = cards.filter(c => c.builtin);
  const ai = cards.filter(c => !c.builtin);
  const add = homeLayout.defaultLayout().filter(id =>
    !built.some(c => String(c.id) === id) && (!seen || seen.indexOf(id) < 0));

  markSeen(add.length ? Object.assign({}, doc, { cards: built.concat(add.map(builtinCard), ai) }) : doc);
  if (!add.length) return doc;

  const next = Object.assign({}, doc, { cards: built.concat(add.map(builtinCard), ai) });
  save(next);          // 只补一次，之后 seenBuiltins 里有记录就不再动
  return next;
}

export function get() {
  const st = settings.get() || {};
  const home = st.home || {};
  const doc = home.doc;
  if (doc && doc.version === VERSION && Array.isArray(doc.cards) && doc.cards.length) {
    return ensureBuiltins(doc);
  }
  // 首次进入：用 home-layout 里已排好的模块顺序播种，老用户自定义的顺序不丢
  let seeded;
  try {
    seeded = syncFromLayout(defaultDoc(), homeLayout.layout());
  } catch (e) {
    seeded = defaultDoc();
  }
  markSeen(seeded);
  return seeded;
}

export function save(doc) {
  try {
    settings.set({ home: { doc: deepClone(doc) } });
  } catch (e) { /* 存不下不影响渲染 */ }
  return doc;
}

export function reset() {
  const d = defaultDoc();
  save(d);
  return d;
}

/** 生成 AI 卡片的 id（稳定、可读、不重复） */
export function newCardId(doc) {
  let n = 1;
  const used = {};
  (doc.cards || []).forEach(c => { used[String(c.id)] = true });
  let id = 'c-' + n;
  while (used[id]) { n++; id = 'c-' + n; }
  return id;
}

// ---------- 卡片定位 ----------
/** ref → 在 doc.cards 里的下标；找不到返回 -1。
 *  title 引用：先精确匹配，再"包含"匹配（模型转述标题时经常多字少字）；
 *  都没命中时回退按 type 找一次 —— 「隐藏打卡走势」这类写法两条路都通。 */
export function indexOfRef(doc, ref) {
  const cards = (doc && doc.cards) || [];
  const r = ref || {};
  if (r.id) return cards.findIndex(c => String(c.id) === String(r.id));
  if (typeof r.index === 'number' && r.index >= 0 && r.index < cards.length) return r.index;
  if (r.title) {
    const t = String(r.title);
    const exact = cards.findIndex(c => c.title && String(c.title) === t);
    if (exact >= 0) return exact;
    const fuzzy = cards.findIndex(c => c.title && String(c.title).indexOf(t) >= 0);
    if (fuzzy >= 0) return fuzzy;
    return cards.findIndex(c => String(c.type) === t);
  }
  if (r.type) return cards.findIndex(c => String(c.type) === String(r.type));
  if (r.last) return cards.length - 1;
  return -1;
}

/**
 * ref → 命中卡片的下标**数组**（批量 op 用）。
 *
 * 为什么需要它：indexOfRef 是单目标口径，`{all:true}` 走到最后只会 return -1。
 * 而 normalizeRef 是**支持** all 的（"所有/全部/all" 都解析成 {all:true}），
 * 两个模块口径不一致 → 「去掉主页所有卡片」在 page-command 里被判「没找到这张卡片」
 * （真机截图 2026-10-10 19:17）。这里是补上 all 的落点，而不是把 all 从 normalizeRef 拿掉。
 *
 * all = doc.cards 里的**全部**卡片（含已收纳的）。对 hide / show 这类幂等 op 没差别；
 * 对 remove 就是真的全删 —— 有 20 步 undo 和 card.reset 兜底。
 */
export function indicesOfRef(doc, ref) {
  const cards = (doc && doc.cards) || [];
  const r = ref || {};
  if (r.all) return cards.map((c, i) => i);
  const i = indexOfRef(doc, r);
  return i >= 0 ? [i] : [];
}

// ---------- 卡片编辑（内置编辑器 / 指令共用） ----------
function cloneCards(doc) {
  return (doc.cards || []).map(c => Object.assign({}, c));
}

function withCards(doc, cards) {
  return Object.assign({}, doc, { cards: cards });
}

/** 换位（拖拽用）：from → to */
export function moveCard(doc, from, to) {
  const cards = cloneCards(doc);
  if (from < 0 || from >= cards.length) return doc;
  let t = Math.max(0, Math.min(cards.length - 1, to));
  if (t === from) return doc;
  const item = cards.splice(from, 1)[0];
  cards.splice(t, 0, item);
  return withCards(doc, cards);
}

/** 显示 / 隐藏（收纳区用） */
export function setVisible(doc, id, visible) {
  const cards = cloneCards(doc);
  const i = cards.findIndex(c => String(c.id) === String(id));
  if (i < 0) return doc;
  cards[i] = Object.assign({}, cards[i], { visible: !!visible });
  return withCards(doc, cards);
}

/** 删除一张卡（AI 卡直接删；内置卡只是"移出"，可用 card.restore 加回） */
export function removeCard(doc, id) {
  const cards = cloneCards(doc);
  const i = cards.findIndex(c => String(c.id) === String(id));
  if (i < 0) return doc;
  cards.splice(i, 1);
  return withCards(doc, cards);
}

export function findCard(doc, id) {
  return (doc.cards || []).find(c => String(c.id) === String(id)) || null;
}

// ---------- 与 home-layout 对齐 ----------
/**
 * 用户用「编辑首页」拖拽 / 收纳改了内置模块顺序后，把变化同步回 pageDoc。
 * AI 新建的卡片不受影响，保持在末尾。
 * 已被移除的内置卡：从 cards 里删掉；新增的：按 layout 顺序插回去。
 */
export function syncFromLayout(doc, layoutIds) {
  const ids = Array.isArray(layoutIds) ? layoutIds : [];
  const ai = (doc.cards || []).filter(c => !c.builtin);
  const built = ids.map(id => {
    const hit = (doc.cards || []).find(c => c.id === id && c.builtin);
    return hit || builtinCard(id);
  });
  return Object.assign({}, doc, { cards: built.concat(ai) });
}

/** 当前内置模块顺序（给 home-layout 回写用） */
export function builtinOrder(doc) {
  return (doc.cards || []).filter(c => c.builtin && c.visible).map(c => c.id);
}

// ---------- 活数据（给 AI 造的卡用） ----------
/**
 * 把真实学习数据暴露成一组键值，AI 造的卡片可以通过 block.live 绑上去，
 * 这样卡片显示的是真实进度而不是模型编出来的死数字。
 */
/**
 * 卡片能绑定的"活数据"目录。
 * 安全口径（见 utils/card-spec.js 的 LIVE_FIELDS）：
 *   只有学习统计，没有任何身份信息 / 密钥 / 设备信息；
 *   只读快照，卡片改不动这些数字。
 */
export function liveValues() {
  const out = {
    todayTotal: 0, todayCorrect: 0, wrongCount: 0, streak: 0, longestStreak: 0,
    mastered: 0, wordCount: 0, accuracy: 0,
    newWordsDone: 0, newWordsTarget: 20, practiceDone: 0, practiceTarget: 10,
    bookName: '', batchName: '', batchDone: 0, batchTotal: 0, batchPct: 0, bookPct: 0,
    usageToday: 0, usageAvg: 0
  };
  try {
    const ov = wordbook.homeOverview();
    out.todayTotal = (ov.today && ov.today.total) || 0;
    out.todayCorrect = (ov.today && ov.today.correct) || 0;
    out.wrongCount = ov.wrongCount || 0;
    out.streak = ov.streak || 0;
    out.mastered = ov.mastered || 0;
    out.wordCount = ov.wordCount || 0;
    // 词书 / 批次进度：卡片可以直接显示"当前批次学到哪"
    out.bookName = String(ov.bookName || '');
    out.batchName = String(ov.batchName || '');
    out.batchDone = ov.batchTouched || 0;
    out.batchTotal = ov.batchTotal || 0;
    out.batchPct = ov.batchPct || 0;
    out.bookPct = ov.bookPct || 0;
  } catch (e) { /* 取不到就用 0 */ }
  try { out.longestStreak = engine.longestStreak() || 0; } catch (e) { /* 同上 */ }
  out.accuracy = out.todayTotal ? Math.round((out.todayCorrect / out.todayTotal) * 100) : 0;
  // 停留时长（分钟）：只在本机累计，同样是只读的统计值
  try {
    usage.flush();
    out.usageToday = usage.todayMinutes();
    out.usageAvg = usage.avgMinutes(7);
  } catch (e) { /* 计时不可用就按 0 */ }
  try {
    const gp = wordbook.goalProgress();
    out.newWordsDone = gp.newWords.done;
    out.newWordsTarget = gp.newWords.target;
    out.practiceDone = gp.practice.done;
    out.practiceTarget = gp.practice.target;
  } catch (e) { /* 同上 */ }
  return out;
}

/** 把块上的 live 绑定解析成展示值 */
export function liveText(key, live) {
  if (!key || key === 'none') return null;
  const v = live[key];
  return v === undefined ? null : String(v);
}
