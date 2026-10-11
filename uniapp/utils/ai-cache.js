// utils/ai-cache.js - AI 内容的底层缓存（独立于词书）
//
// 为什么单独一层：
//   练习时生成的句子、搜索时临时查看的 AI 例句，以前要么用完即弃、要么写进词书
//   （把临时查的词混进学习词表，污染进度）。现在统一落到这一层：
//     · 不进词书 —— 只影响"能不能看到"，不影响"要背什么"
//     · 可检索   —— 之后再搜同一个词 / 看同一个词，能直接命中已生成的内容
//     · 可清空   —— 设置页按「缓存单词」「缓存例句」两类一次性清掉，
//                   不做逐条删除（用户明确要求：统一删除，不是一句一句删）
//
// 存储：独立 key `fj_ai_cache_v1`，不与学习进度 `fj_eng_state_v1` 混在一起，
// 这样"清缓存"绝不会误伤掌握度和错题本。

const KEY = 'fj_ai_cache_v1';
const TTL = 7 * 24 * 3600 * 1000;   // 7 天：过期的内容自动淘汰
const MAX_WORDS = 2000;
const MAX_SENTENCES = 1000;
const MAX_SIG = 500;
// 一个词最多记多少个义项：这是"补全多义"用的，真正常用的义项一般也就三五个，
// 再多就是模型在凑数了，记下来反而把那一条撑得没法看
const MAX_SENSES = 8;

let cache = null;

// 落盘节流（与 utils/store.js 同理）：
// 缓存条目是一条条记进来的（一个单词 / 一句例句一次 remember），
// 每次都把整个缓存（上限 2000 词 + 1000 句）序列化后同步写盘太贵。
// 改成改内存立即生效、写盘合并到 800ms 窗口；切后台由 App.vue onHide 调 flush() 兜底。
const WRITE_GAP = 800;
let dirty = false;
let timer = 0;
// 同 store.js：初值取当前时间，避免第一次 remember 就被判定为"早就该写了"而立即落盘
let lastWriteAt = Date.now();

function blank() {
  return { words: [], sentences: [], sig: {} };
}

function normalize(o) {
  if (!o || typeof o !== 'object') return blank();
  return {
    words: Array.isArray(o.words) ? o.words : [],
    sentences: Array.isArray(o.sentences) ? o.sentences : [],
    sig: (o.sig && typeof o.sig === 'object') ? o.sig : {}
  };
}

function read() {
  try {
    const raw = uni.getStorageSync(KEY);
    if (!raw) return blank();
    return normalize(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (e) {
    return blank();
  }
}

function writeNow() {
  if (!dirty || !cache) return;
  dirty = false;
  lastWriteAt = Date.now();
  try { uni.setStorageSync(KEY, cache); } catch (e) {}
}

// 排一次落盘：距上次写入不足 WRITE_GAP 就顺延，窗口内的多次 remember 合并成一次写
function schedule() {
  if (timer) return;
  const wait = Math.max(0, WRITE_GAP - (Date.now() - lastWriteAt));
  timer = setTimeout(() => {
    timer = 0;
    writeNow();
  }, wait);
}

function write() {
  dirty = true;
  schedule();
}

// 立即落盘：切后台 / 清空缓存时调用（清空必须立刻生效，否则杀进程后旧内容会复活）
export function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  writeNow();
}

function cur() {
  if (!cache) cache = read();
  return cache;
}

function key(w) {
  return String(w || '').trim().toLowerCase();
}

function fresh(ts) {
  return Date.now() - (ts || 0) <= TTL;
}

export function init() { cache = read(); }

export function raw() { return cur(); }

// 概览：给设置页显示条数和最后更新时间
export function stats() {
  const c = cur();
  let latest = 0;
  c.words.forEach(w => { if ((w.ts || 0) > latest) latest = w.ts || 0; });
  c.sentences.forEach(s => { if ((s.ts || 0) > latest) latest = s.ts || 0; });
  return { words: c.words.length, sentences: c.sentences.length, updatedAt: latest };
}

// ---------- 缓存单词 ----------
// entry: { word, pos, meaning, senses, phonetic, src }
// senses 是补齐的义项表 [{pos, meaning}] —— 老缓存（AI 只回一条释义）没有这个字段，
// 取的时候一律按"可能没有"处理，别直接 .length。
export function findWord(q) {
  const k = key(q);
  if (!k) return null;

  const c = cur();
  for (let i = 0; i < c.words.length; i++) {
    const w = c.words[i];
    if (key(w.word) !== k) continue;
    if (!fresh(w.ts)) { c.words.splice(i, 1); write(); return null; }
    return w;
  }
  return null;
}

/**
 * 缓存里这个词的义项表（补齐过才是多条，老条目是 []）。
 * 判断"这个词显示全不全"一律用这里：**缓存有 ≥2 个义项就别再花一次 AI**。
 */
export function sensesOf(q) {
  const w = findWord(q);
  return (w && Array.isArray(w.senses)) ? w.senses : [];
}

/** 这个词的缓存已经补齐过义项了吗 */
export function hasFullSenses(q) {
  return sensesOf(q).length >= 2;
}

export function rememberWord(entry) {
  const c = cur();
  const word = key(entry && entry.word);
  if (!word) return null;
  const senses = Array.isArray(entry && entry.senses)
    ? entry.senses
      .map(s => ({
        pos: String((s && s.pos) || ''),
        meaning: String((s && s.meaning) || '')
      }))
      .filter(s => s.meaning)
      .slice(0, MAX_SENSES)
    : [];
  const rec = {
    word,
    pos: String((entry && entry.pos) || ''),
    meaning: String((entry && entry.meaning) || ''),
    senses,
    phonetic: String((entry && entry.phonetic) || ''),
    src: String((entry && entry.src) || 'ai'),
    q: String((entry && entry.q) || ''),
    ts: Date.now()
  };
  // 同一个词只留最新一条，避免缓存无限长
  const i = c.words.findIndex(x => key(x.word) === word);
  if (i >= 0) c.words.splice(i, 1);
  c.words.unshift(rec);
  if (c.words.length > MAX_WORDS) c.words.length = MAX_WORDS;
  write();
  return rec;
}

export function words() { return cur().words.slice(); }

// ---------- 缓存例句 ----------
// s: { sid, en, zh, newWords, scene, source, metrics }；sig 为请求签名（可省）
export function sentenceBySig(sig) {
  if (!sig) return null;
  const c = cur();
  const hit = c.sig[sig];
  if (!hit) return null;
  if (!fresh(hit.ts)) { delete c.sig[sig]; write(); return null; }
  return hit.data;
}

export function rememberSentence(s, sig) {
  const c = cur();
  const en = String((s && s.en) || '').trim();
  if (!en) return null;
  const word = key((s && s.word) || ((s && s.newWords && s.newWords[0]) ? (s.newWords[0].word || s.newWords[0]) : ''));
  const rec = {
    sid: String((s && s.sid) || 'aic-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
    en,
    zh: String((s && s.zh) || ''),
    word,
    source: String((s && s.source) || 'ai'),
    ts: Date.now()
  };
  const i = c.sentences.findIndex(x => x.sid === rec.sid);
  if (i >= 0) c.sentences.splice(i, 1);
  c.sentences.unshift(rec);
  if (c.sentences.length > MAX_SENTENCES) c.sentences.length = MAX_SENTENCES;
  if (sig) {
    c.sig[sig] = { ts: rec.ts, data: rec };
    const keys = Object.keys(c.sig);
    if (keys.length > MAX_SIG) keys.slice(0, keys.length - MAX_SIG).forEach(k => delete c.sig[k]);
  }
  write();
  return rec;
}

export function sentences() { return cur().sentences.slice(); }

// 某个词缓存过哪些例句（给「搜索 / 查看」用）
export function sentencesOf(w) {
  const k = key(w);
  if (!k) return [];
  return cur().sentences.filter(s => key(s.word) === k);
}

// ---------- 清空（只按类别整体清） ----------
// 清空一律立即落盘：这是用户主动操作，杀进程后不该复活
export function clearWords() {
  const c = cur();
  c.words = [];
  write();
  flush();
  return true;
}

export function clearSentences() {
  const c = cur();
  c.sentences = [];
  c.sig = {};     // 签名索引也要一起清，否则会命中"已删"的旧例句
  write();
  flush();
  return true;
}

export function clearAll() {
  cache = blank();
  write();
  flush();
  return true;
}
