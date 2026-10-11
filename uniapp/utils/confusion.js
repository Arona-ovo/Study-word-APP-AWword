// utils/confusion.js - 「易混词」的**本地**检测与累计（不发一次网络请求）
//
// 用户原话：背单词时经常把 rise 和 rice 搞混 → 在学习过程中弹出教学卡片，
//          解释完点「下一个」继续背。并且：**判断"是否记错""是否反复记错"的算法是本地的，
//          只有触发算法时才启动页面、才调 AI**。
//
// 所以本模块只做两件事，且**一次网络都不发**：
//   1. 每次答错，从"用户提交的内容"里找出**被混进去的那个词**（peer）
//      · 手打拼写（spell / 汉译英输入）→ 直接就是那个词：rise 写成 rice
//      · 选择题：选项文本若是英文 → 直接用；若是中文释义 → 反查是哪个词的释义
//      · 只有**两个词确实长得像**（编辑距离）才认定是"搞混"，否则只是单纯的不会
//   2. 按"词对"累计次数，到阈值才说"该教了"
//
// 解释本身由 services/ai-content.js 的 explainConfusion() 生成，结果缓存进本模块的记录里
// （`teach` 字段）—— 同一对下次再看就是本地直出，不再花 token。
import * as settings from './settings.js'
import * as wordbook from './wordbook.js'
import { lemma } from './lemma.js'
import { aiGateReason } from '../services/config.js'
import { featureOn } from '../services/ai-gate.js'

// 独立 key：不进学习进度、不进掌握度（mastery 只有 {m, seen, correct} 三个字段的语义，
// 硬塞进去会被 recordMastery 的展开拷贝一路带着走，语义不明）
const KEY = 'fj_confusion_v1'
// 最多记多少对：超了淘汰最久没错的（这是个"最近常错"的账，不是全量错题账）
const MAX_PAIRS = 200
// 同一对错几次才算"经常搞混"：第一次可能是手滑，第二次就是模式
const TRIGGER = 2
// 教过一次之后又错几次可以再教（真的反复忘，值得再讲一遍）
const REPEAT = 3
// 太短的词不做形近判定：in / on / a 这种"差一个字母"没有教学价值
const MIN_LEN = 3

// ⚠️ 别写 /\p{...}/u —— App 端老 JS 引擎不认，会在模块顶层抛 SyntaxError（白屏）
const LATIN = /^[a-z][a-z'-]*$/

let cache = null

// ---------- 存储 ----------
function blank() {
  return { v: 1, pairs: {} }
}

export function init() {
  cache = null
  return raw()
}

export function raw() {
  if (cache) return cache
  let st = null
  try {
    const v = uni.getStorageSync(KEY)
    if (v && typeof v === 'object') st = v
  } catch (e) { st = null }
  if (!st || typeof st !== 'object' || !st.pairs || typeof st.pairs !== 'object') st = blank()
  cache = st
  return cache
}

function save(st) {
  cache = st
  try { uni.setStorageSync(KEY, st) } catch (e) { /* 存不进去不影响答题 */ }
  return st
}

/** 超过上限就淘汰最久没错的（保留"最近常搞混"的） */
function trim(st) {
  const keys = Object.keys(st.pairs || {})
  if (keys.length <= MAX_PAIRS) return
  keys.sort(function (x, y) {
    return (Number(st.pairs[x].last) || 0) - (Number(st.pairs[y].last) || 0)
  })
  const drop = keys.length - MAX_PAIRS
  for (let i = 0; i < drop; i++) delete st.pairs[keys[i]]
}

// ---------- 词形工具 ----------
function normWord(w) {
  return String(w == null ? '' : w).trim().toLowerCase().replace(/[^a-z'-]/g, '')
}

/** 编辑距离（judge.js 里也有一份，但那个不导出，且本模块要的是"两个词像不像"不是"答得对不对"） */
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = []
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * 两个词**长得像**吗（= 值得当成"搞混"而不是"不会"）。
 * 口径：编辑距离 ≤2 且不超过较长那个词的 40%。
 *   rise/rice = 1/4 ✅   rise/raise = 1/5 ✅   good/food = 1/4 ✅
 *   cat/dog = 3/3 ❌     apple/orange = 5/6 ❌
 */
export function alike(a, b) {
  const x = normWord(a), y = normWord(b)
  if (!x || !y || x === y) return false
  if (x.length < MIN_LEN || y.length < MIN_LEN) return false
  const d = levenshtein(x, y)
  if (d > 2) return false
  return d / Math.max(x.length, y.length) <= 0.4
}

/** pair 的 key：两个词排序后拼，保证 (rise,rice) 和 (rice,rise) 是同一对 */
export function pairKey(a, b) {
  const x = normWord(a), y = normWord(b)
  return x <= y ? x + '|' + y : y + '|' + x
}

/** 一个中文释义对应的词（反查当前词书）：选项给的是中文时要靠它找出"混成了哪个词" */
function wordByMeaning(text, bookId) {
  const q = String(text == null ? '' : text).trim()
  if (!q) return ''
  let pool = []
  try {
    pool = wordbook.bookWords(bookId || wordbook.currentBookId()) || []
  } catch (e) { return '' }
  let loose = ''
  for (let i = 0; i < pool.length; i++) {
    const m = String(pool[i].m || '').trim()
    if (!m) continue
    if (m === q) return String(pool[i].w || '')   // 完全相等，最可信
    if (!loose && (m.indexOf(q) >= 0 || q.indexOf(m) >= 0)) loose = String(pool[i].w || '')
  }
  return loose
}

/** 单个英文词的判定：屈折还原后是同一个词（rise/rises）→ 只是写错时态，不算搞混 */
function oneWord(t, ua) {
  const u = normWord(ua)
  if (!u || u === t) return ''
  let same = false
  try { same = lemma(u) === lemma(t) } catch (e) { same = false }
  if (same) return ''
  return alike(t, u) ? u : ''
}

/**
 * 整段文本里找形近词（句子练习的答案是**一句话**，混进去的词藏在里面）。
 * 例：目标 rise，用户写 "The rice of the sun..." → 扫到 rice。
 */
function scanText(t, text) {
  const toks = String(text || '').toLowerCase().split(/[^a-z']+/)
  for (let i = 0; i < toks.length; i++) {
    const w = String(toks[i] || '').replace(/^'+|'+$/g, '')
    if (!w || w.length < MIN_LEN || w === t) continue
    let same = false
    try { same = lemma(w) === lemma(t) } catch (e) { same = false }
    if (same) continue
    if (alike(t, w)) return w
  }
  return ''
}

/**
 * 从"用户提交的内容"里找出**被混进去的那个词**。
 * @param target 正确答案的那个词
 * @param userAnswer 用户提交的内容（手打拼写 / 被选中的选项文本 / 整句翻译）
 * @returns 那个词；'' 表示这次不构成"搞混两个词"
 */
export function peerOf(target, userAnswer, bookId) {
  const t = normWord(target)
  if (!t || t.length < MIN_LEN) return ''
  const ua = String(userAnswer == null ? '' : userAnswer).trim()
  if (!ua) return ''                       // 自评模式拿不到提交内容 → 无法判定
  // ① 单个英文词：手打拼写 / 英文选项
  if (LATIN.test(ua.toLowerCase())) return oneWord(t, ua)
  // ② 纯中文：选项给的是中文释义 → 反查是哪个词
  const byM = normWord(wordByMeaning(ua, bookId))
  if (byM && byM !== t && alike(t, byM)) return byM
  // ③ 其余（整句翻译 / 中英混排）：逐词扫一遍
  return scanText(t, ua)
}

// ---------- 累计 ----------
function bump(a, b) {
  const st = raw()
  const k = pairKey(a, b)
  const rec = st.pairs[k] || {
    a: normWord(a), b: normWord(b), n: 0, last: 0, taught: 0, teach: null, at: 0
  }
  rec.n = (Number(rec.n) || 0) + 1
  rec.last = Date.now()
  st.pairs[k] = rec
  trim(st)
  save(st)
  return rec
}

/** 这一对现在**该教**吗：错够次数了，且（没教过 / 教过之后又错了 REPEAT 次） */
export function shouldTeach(a, b) {
  const st = raw()
  const rec = st.pairs[pairKey(a, b)]
  if (!rec) return false
  const n = Number(rec.n) || 0
  if (n < TRIGGER) return false
  const taught = Number(rec.taught) || 0
  return taught === 0 || n >= taught + REPEAT
}

/**
 * 答错时调一次：解析 peer → 记账 → 判定该不该教。
 * @returns { a, b, n, should, key } —— 不构成混淆返回 null（页面什么都不用做）
 */
export function note(target, userAnswer, bookId) {
  const t = normWord(target)
  if (!t) return null
  const peer = peerOf(t, userAnswer, bookId)
  if (!peer) return null
  const rec = bump(t, peer)
  return {
    a: rec.a, b: rec.b, n: Number(rec.n) || 0,
    should: shouldTeach(t, peer),
    key: pairKey(t, peer)
  }
}

/** 记下"教过了"+ 把 AI 的解释存起来（同一对下次直接本地直出） */
export function markTaught(a, b, teach) {
  const st = raw()
  const k = pairKey(a, b)
  let rec = st.pairs[k]
  // 账上还没有这一对（清过数据、或页面拿的是内存里刚判定的结果）→ 先补一条。
  // 以前这里直接 return null：讲解就白讲了，下次弹还得再花一次 token。
  if (!rec) rec = bump(a, b)
  rec.taught = Number(rec.n) || 0
  if (teach) { rec.teach = teach; rec.at = Date.now() }
  save(st)
  return rec
}

/** 已存过的解释（缓存命中就不必再花 token） */
export function teachOf(a, b) {
  const st = raw()
  const rec = st.pairs[pairKey(a, b)]
  return (rec && rec.teach) || null
}

/** 按错的次数倒序（给"易混词"列表用） */
export function list() {
  const st = raw()
  return Object.keys(st.pairs || {}).map(k => st.pairs[k])
    .sort(function (x, y) { return (Number(y.n) || 0) - (Number(x.n) || 0) })
}

export function stats() {
  const st = raw()
  const keys = Object.keys(st.pairs || {})
  return { pairs: keys.length, max: MAX_PAIRS, trigger: TRIGGER, repeat: REPEAT }
}

export function clear() {
  save(blank())
  return true
}

// ---------- 开关 ----------
/**
 * 本地开关：要不要在练习里自动弹教学。关掉只是不打扰，**账照记**
 * （等哪天想开了，之前攒的数据还在）。
 */
export function localOn() {
  try { return (settings.get().study || {}).confusionTeach !== false } catch (e) { return true }
}

export function setLocal(on) {
  settings.set({ study: { confusionTeach: !!on } })
  return true
}

/**
 * 整体可用吗 = 本地开关 + AI 真的能用 + AI 分项开关。
 * 需求原话："**有 AI 的时候才会用该功能**" —— 没接 AI 就完全不弹，不做半成品。
 */
export function enabled() {
  if (!localOn()) return false
  if (!featureOn('confusion')) return false
  let r = ''
  try { r = aiGateReason() || '' } catch (e) { r = 'err' }
  return !r
}
