// utils/quiz-plan.js - 句子翻译式抽测的「出题计划」（纯本地，不联网）
//
// 用户原话：「不要只做单词随机抽认（那样和直接背单词没有区别），而是由 AI 用今天已背的单词、
// 或当前正在背的词书中的单词，尽可能多地组合成一句语义通顺、贴近真实语境的句子，
// 让用户进行翻译。」
//
// 所以本地要安排的不再是"下一个考哪个词"，而是"下一句拿哪几个词去凑"：
//   · 一题一组词（2~4 个），一句话尽量覆盖多个目标词
//   · 答错的词下一题就能回来（赶紧巩固），答对的词隔几题再说（别占着题位）
//   · 句子长度按水平档位递进：连对加长、连错缩短（贴合"用户当前水平"）
//   · 模型只能凑进一部分词时，没用上的退回队列，不白考
//     （模型在回复末尾用机器标记回报实际用词，页面解析后交给这里记账）
//   · 同一个词组合短时间内不重复出（sigs + recent 两道锁）
//
// ⚠️ 凑不凑得成一句通顺的话，判断权在模型（它才知道词能不能搭配）。
//    本地只负责"给候选、记账、调频率"—— 这条分工跟以前一样，没有变。

// 一句话里希望覆盖的目标词数。太少就退化成单词抽认，太多一定凑不出通顺的句子。
export const BATCH_MIN = 2
export const BATCH_MAX = 4

// 水平档位 → 目标句长上限（英文词数）
export const LEN_BY_TIER = [8, 10, 13, 16, 20]
export const TIER_MAX = LEN_BY_TIER.length - 1

// 冷却：**只给答对的词**设 —— 会了的让出题位，隔 5 题再来说。
// ⚠️ 答错的词不能进冷却：冷却中的词在 rank() 里被排到最后，
//    那正好和"写错的词提高复现频率"（用户要求 4）反着来。错词靠 miss 权重重排到前面。
export const COOL_WRONG = 0
export const COOL_RIGHT = 5

// 一场抽测出几道题（用户没在话里说数量时用默认值）
export const QUIZ_MIN = 3
export const QUIZ_MAX = 12
export const QUIZ_DEF = 6

/** 题数夹取：读不出数字用默认，越界夹到 3~12 */
export function planSize(n) {
  const v = parseInt(n, 10)
  if (!(v > 0)) return QUIZ_DEF
  return Math.max(QUIZ_MIN, Math.min(QUIZ_MAX, v))
}

/** 这个词今天刚背过（mastery.fs = 首次接触日期，就是「每日新词」那个口径） */
function isToday(rec, today) {
  return !!(today && rec && rec.fs && String(rec.fs) === String(today))
}

/** 到期待巩固（due 已过） */
function isDue(rec, today) {
  if (!rec || !rec.due || !today) return false
  return String(rec.due) <= String(today)
}

/**
 * 一个词的"该考程度"。三档叠加：
 *   ① 今天刚背的（fs = today）最该考 —— 用户原话就是"用今天已背的单词"
 *   ② 越不熟越靠前（m 越低分越高）
 *   ③ 到期待巩固的加权
 * 分数相同就保持传入顺序（V8 的 sort 是稳定的），所以词书的原始顺序是兜底秩序。
 */
export function priority(rec, today) {
  const r = rec || {}
  const m = Number(r.m) || 0
  let p = 0
  if (isToday(r, today)) p += 60
  if (m < 3) p += (3 - m) * 12
  if (isDue(r, today)) p += 15
  return p
}

/**
 * 造词池：按"该考程度"降序排，取前 count 个。
 * words   = [{ id, w, pos, m }]（词书原词）
 * mastery = { wordId: { m, seen, correct, fs, st, due, lp } }
 */
export function buildPool(words, mastery, today, count) {
  const map = mastery || {}
  const rows = []
  ;(words || []).forEach(e => {
    if (!e) return
    const w = String(e.w || '').trim()
    const m = String(e.m || '').trim()
    if (!w || !m) return
    rows.push({
      id: e.id,
      w: w,
      pos: String(e.pos || '').trim(),
      m: m,
      pri: priority(map[e.id], today)
    })
  })
  rows.sort((a, b) => b.pri - a.pri)
  const want = Math.max(BATCH_MIN * 2, Number(count) || 0)
  return rows.slice(0, want)
}

/** 整组词的签名（与顺序无关）：用来判"这道题是不是刚出过" */
export function sigOf(words) {
  return (words || [])
    .map(w => String((w && w.w) || '').toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|')
}

function norm(w) {
  return String((w && w.w) || '').toLowerCase()
}

function ensureSeen(plan, w) {
  const k = String(w || '').toLowerCase()
  if (!plan.seen[k]) plan.seen[k] = { asked: 0, miss: 0, hit: 0, cool: 0 }
  return plan.seen[k]
}

/** 开一局：pool 是 buildPool 的结果，total 是计划题数 */
export function createPlan(pool, opts) {
  const o = opts || {}
  return {
    total: planSize(o.total),
    step: 0,          // 已出题数
    tier: 0,          // 水平档位（0..TIER_MAX），连对升、连错降
    words: (pool || [])
      .filter(w => w && w.w && w.m)
      .map(w => ({ w: String(w.w), pos: String(w.pos || ''), m: String(w.m), pri: Number(w.pri) || 0 })),
    seen: {},         // 词 -> { asked, miss, hit, cool }
    sigs: {},         // 出过的词组合签名（防同一道题重复）
    recent: []        // 最近几题的用词，只用于展示/调试
  }
}

/** 这一题打算覆盖几个词 */
export function batchSize(plan) {
  const t = Math.max(0, Math.min(TIER_MAX, Number((plan || {}).tier) || 0))
  if (t <= 1) return BATCH_MIN
  if (t <= 3) return 3
  return BATCH_MAX
}

/** 这一题的目标句长上限（词数） */
export function sentenceLimit(plan) {
  const t = Math.max(0, Math.min(TIER_MAX, Number((plan || {}).tier) || 0))
  return LEN_BY_TIER[t]
}

/**
 * 候选排序：该考程度 + 本地记账。
 *   miss 加权重（错了要赶紧再见）、hit 减权重（会了就让位）、asked 略减（考过多次的排后）
 * 冷却中的词一律排到最后 —— 不是排除：词池小的时候该用还得用。
 */
export function rank(plan) {
  const rows = (plan.words || []).map(w => {
    const s = plan.seen[norm(w)] || null
    const asked = s ? s.asked : 0
    const miss = s ? s.miss : 0
    const hit = s ? s.hit : 0
    const cool = s ? s.cool : 0
    return {
      word: w,
      cool: cool > 0 ? 1 : 0,
      score: miss * 14 - hit * 9 - asked * 4 + w.pri * 0.5
    }
  })
  rows.sort((a, b) => (a.cool - b.cool) || (b.score - a.score))
  return rows.map(r => r.word)
}

/**
 * 从候选里组出这一题的目标词。
 * 优先让**词性分散**：三个名词凑不出句子，动词 + 名词 + 形容词才像人话。
 */
export function compose(words, want) {
  const list = words || []
  const out = []
  const taken = {}
  if (!list.length) return out
  const push = (w) => { taken[norm(w)] = true; out.push(w) }
  push(list[0])
  while (out.length < want && out.length < list.length) {
    const have = {}
    out.forEach(w => { have[String(w.pos || '')] = true })
    let next = null
    for (let i = 0; i < list.length; i++) {
      const w = list[i]
      if (taken[norm(w)]) continue
      if (w.pos && !have[String(w.pos)]) { next = w; break }
      if (!next) next = w
    }
    if (!next) break
    push(next)
  }
  return out
}

/**
 * 出下一题。返回
 *   { words: [{w,pos,m}], limit, level, step }
 * 或 null（题出完了 / 池子里实在凑不出词）。
 *
 * 只在**用户刚答完上一题**（或刚开局）时调用一次。
 */
export function nextBatch(plan) {
  if (!plan) return null
  if (plan.step >= plan.total) return null
  const ranked = rank(plan)
  if (!ranked.length) return null
  const want = batchSize(plan)

  // 同一个词组合不重复出：换个起点再组一次，最多试 6 次
  let words = null
  const maxOff = Math.min(6, ranked.length)
  for (let off = 0; off < maxOff; off++) {
    const cand = compose(ranked.slice(off), want)
    if (cand.length < BATCH_MIN) continue
    if (plan.sigs[sigOf(cand)]) continue
    words = cand
    break
  }
  // 全试过都重复 → 退一步：允许重复，但换个排序起点（池子太小的时候只能这样）
  if (!words) {
    const cand = compose(ranked.slice(1), want)
    if (cand.length >= BATCH_MIN) words = cand
  }
  if (!words || !words.length) return null

  const batch = {
    words: words.map(w => ({ w: w.w, pos: w.pos || '', m: w.m })),
    limit: sentenceLimit(plan),
    level: plan.tier + 1,
    step: plan.step + 1
  }
  plan.sigs[sigOf(batch.words)] = true
  plan.recent.push(batch.words.map(w => w.w))
  if (plan.recent.length > 5) plan.recent.shift()
  // 过了一题 → 所有冷却各走一格
  Object.keys(plan.seen).forEach(k => {
    if (plan.seen[k] && plan.seen[k].cool > 0) plan.seen[k].cool--
  })
  plan.step++
  return batch
}

/**
 * 记一道题的**用词**：模型这一题实际把哪些目标词用进了句子。
 * 没凑进去的词退回队列（不算考过、冷却清零），下次优先考虑 —— 对应
 * 用户要求里的"宁可少考几个词，也不要造出不通顺的句子"。
 *
 * ⚠️ used 为空（模型没给标记）时按"全用上了"处理：不然这些词永远轮不到，
 *    同一道题会被反复出到天荒地老。
 *
 * 结果写在 batch 上（batch.used / batch.dropped）：判分在**下一轮**才发生，
 * 到时候要按"真正用上的那几个词"记账，不能再回头看一次标记。
 */
export function noteUsed(plan, batch, used) {
  const targets = (batch && batch.words) || []
  if (!plan || !targets.length) return []
  const list = (used && used.length) ? used : targets.map(t => t.w)
  const set = {}
  list.forEach(w => { set[String(w || '').toLowerCase()] = true })

  const on = []
  const dropped = []
  targets.forEach(t => {
    if (set[String(t.w).toLowerCase()]) on.push(t.w)
    else {
      dropped.push(t.w)
      ensureSeen(plan, t.w).cool = 0     // 退回队列：下次优先考
    }
  })
  batch.used = on
  batch.dropped = dropped
  return dropped
}

/**
 * 记一道题的**结果**：整体翻译达没达意。
 *   right=true  → 用上的词 hit+1、冷却 COOL_RIGHT 题（会的词让出题位）；水平档位 +1
 *   right=false → 用上的词 miss+1、**不进冷却**（写错的词下一题就该回来）；水平档位 -1
 */
export function noteResult(plan, batch, right) {
  if (!plan || !batch) return { hit: [], miss: [] }
  const list = (batch.used && batch.used.length)
    ? batch.used
    : (batch.words || []).map(t => t.w)
  const hit = []
  const miss = []
  list.forEach(w => {
    const s = ensureSeen(plan, w)
    s.asked++
    if (right) { s.hit++; s.cool = COOL_RIGHT; hit.push(w) } else { s.miss++; s.cool = COOL_WRONG; miss.push(w) }
  })
  if (right) plan.tier = Math.min(TIER_MAX, (Number(plan.tier) || 0) + 1)
  else plan.tier = Math.max(0, (Number(plan.tier) || 0) - 1)
  return { hit: hit, miss: miss }
}

/** 给状态条 / 收尾小结用的统计 */
export function planStats(plan) {
  const p = plan || {}
  const seen = p.seen || {}
  const weak = []
  Object.keys(seen).forEach(k => {
    if (seen[k] && seen[k].miss > 0) weak.push({ w: k, miss: seen[k].miss, hit: seen[k].hit || 0 })
  })
  weak.sort((a, b) => b.miss - a.miss || a.w.localeCompare(b.w))
  return {
    step: Number(p.step) || 0,
    total: Number(p.total) || 0,
    tier: Number(p.tier) || 0,
    weak: weak,
    weakWords: weak.map(x => x.w)
  }
}
