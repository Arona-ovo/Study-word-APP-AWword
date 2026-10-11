#!/usr/bin/env node
/**
 * 内置词书数据生成器
 *
 * 作用：把 _vocab/src 下的开源词表（含中文释义）+ 两份词频表，
 *      加工成 App 可直接 import 的两个数据文件：
 *        uniapp/data/lexicon-data.js —— 共享词条表（word|pos|释义）
 *        uniapp/data/bookdata.js     —— 每本词书的词条索引
 *        uniapp/data/build-info.js   —— 语料规模快照（设置页彩蛋用，几百字节）
 *
 * 两个文件都只放数据不含逻辑：读取/解码/缓存统一写在 uniapp/data/lexicon.js，
 * 这样重新生成时不会覆盖手写代码。
 *
 * 为什么这么切：
 *   多本词书之间重复词条很多（四级/六级/考研 大量重合），
 *   释义只存一份、各词书只存「词条序号」引用，比每本词书各存一份词条省一半以上体积。
 *
 * 用法：node build.js
 *
 * 数据来源（均为开源仓库，详见 README.md）：
 *   junior / senior / cet4 / cet6 / kaoyan —— KyleBing/english-vocabulary（词条 + 中文释义）
 *   freq-web-20k                           —— first20hours/google-10000-english（网页词频）
 *   freq-subtitle-50k                      —— hermitdave/FrequencyWords（影视字幕词频）
 *
 * 两个刻意取舍：
 *   1) 词频只用于「给词排序」（高频先学），不用于「决定收不收录」——
 *      收录只看它在不在对应考试词表里，避免词频表的领域偏向污染词书内容。
 *   2) 释义宽进严出：源表里每个词条有多个来源的多个义项，逐条过滤后再限长合并，
 *      宁可义项少一点，也不要出现「(Have)人名；芬)哈韦」这种脏内容。
 */

const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'src')
const OUT = path.join(__dirname, '..', 'uniapp', 'data')

// ---------------------------------------------------------------- 常量配置

// 新词条 id 起始值。核心词书 words.js 占用 1..640，这里从 10001 起，永不相撞。
const LEX_START = 10001

// 释义上限（汉字数）。中文在 UTF-8 里一个字 3 字节，这个数几乎线性地决定产物体积；
// 而主包源码上限由 _tools/check-bundle-size.js 盯着（微信小程序主包 2MB 的余量换算出来的）。
// 调大前先跑一遍那个脚本确认还有余量。
const MAX_MEAN = 20
const MAX_SENSE = 10

// 纯语法功能词：不当背单词词条（词义在内置词典里仍查得到），
// 否则第一组会变成 "the / of / and" 这种没法背的内容。
const STOP = new Set([
  // 冠词 / 指示 / 限定
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'such', 'same', 'other', 'another',
  'some', 'any', 'each', 'every', 'all', 'both', 'either', 'neither', 'none', 'no', 'not',
  'much', 'many', 'few', 'less', 'least', 'own', 'more', 'most', 'enough',
  // 人称 / 物主 / 反身 / 疑问代词
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'myself', 'himself', 'herself', 'itself', 'yourself', 'ourselves', 'themselves', 'oneself',
  'who', 'whom', 'whose', 'which', 'what', 'whatever', 'whoever', 'whichever',
  'somebody', 'anybody', 'everybody', 'nobody', 'someone', 'anyone', 'everyone',
  'something', 'anything', 'everything', 'nothing', 'one', 'ones',
  // be / 助动词 / 情态
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'doing', 'done',
  'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must', 'ought',
  // 纯结构性介词 / 连词 / 引导词
  'and', 'or', 'but', 'nor', 'so', 'than', 'as', 'if', 'whether', 'unless',
  'because', 'although', 'though', 'while', 'whereas', 'whereby', 'wherein',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'into', 'onto', 'upon',
  'per', 'via', 'off', 'out', 'up', 'away', 'along', 'across', 'through', 'throughout',
  'during', 'until', 'since', 'within', 'without', 'among', 'amongst', 'toward', 'towards',
  'there', 'here', 'when', 'whenever', 'where', 'wherever', 'why', 'how', 'however',
  // 语用词
  'yes', 'yeah', 'yep', 'ok', 'okay', 'oh', 'ah', 'um', 'well', 'hey', 'hi', 'hello',
  'yes', 'please', 'thanks', 'thank', 'sorry', 'excuse', 'pardon', 'bye', 'wow',
  'mr', 'mrs', 'ms', 'sir', 'madam', 'dr', 'prof', 'vs', 'etc', 'eg', 'ie',
  // 网络高频噪声（网页词频带来的，不是考点）
  'http', 'https', 'www', 'com', 'net', 'org', 'html', 'php', 'asp', 'url', 'ip',
  'email', 'fax', 'dvd', 'cd', 'tv', 'pc', 'id', 'pm', 'am', 'ad', 'inc', 'ltd'
])

// 不宜出现在背单词卡片上的词（粗俗 / 露骨）。源词表里确实收了这些词（考研词表里有 ass），
// 但作为 App 的默认学习内容不合适 —— 它们仍可在点读词典里查到，只是不进词书。
const SENSITIVE = new Set([
  'sex', 'sexual', 'sexy', 'gay', 'lesbian', 'homo', 'ass', 'arse', 'butt', 'damn',
  'porn', 'nude', 'naked', 'condom', 'orgasm', 'breast', 'nipple', 'penis', 'vagina',
  'bitch', 'boobs', 'dick', 'slut', 'whore', 'erotic', 'nylon'
])

// 词性标记
const POS_ALL = /(?:^|[\s(（])(n|v|adj|adv|prep|conj|pron|num|art|int|aux|modal|aux\.v|vt|vi)\.\s*/g
const POS_HEAD = /(?:^|[\s(（])(n|v|adj|adv|prep|conj|pron|num|art|int|aux|modal|aux\.v|vt|vi)\./
const POS_MAP = {
  n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', conj: 'conj.',
  pron: 'pron.', num: 'num.', art: 'art.', int: 'int.', aux: 'aux.', modal: 'aux.', vt: 'v.', vi: 'v.'
}

const CJK = /[一-龥]/
const WORD_RE = /^[a-z][a-z'\-]*$/
// 合格义项：只允许中文汉字与中文标点，出现拉丁字母 / 半角括号的一律丢弃
const SENSE_OK = /^[一-龥、，：？！…·～（）0-9]+$/
// 合并后的整条释义：同上，外加义项之间的分号
const MEAN_OK = /^[一-龥、，：？！…·～（）0-9；]+$/
// 人名 / 地名 / 学科标注：这类义项是词典副产品，不是考点
const SENSE_JUNK = /(人名|姓氏|名字|女子名|男子名|地名|国名|货币|化学元素|度量衡|棒球|足球术语)/

// ---------------------------------------------------------------- 读取源数据

function readLines(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/)
}

// 词条表：每行 '单词\t释义'
function loadVocab(file) {
  const map = new Map()
  let skipped = 0
  for (const raw of readLines(file)) {
    const line = raw.trimEnd()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 2) { skipped++; continue }
    const w = parts[0].trim().toLowerCase().replace(/[^a-z'\-]/g, '')
    const gloss = parts[1].trim()
    if (!WORD_RE.test(w) || w.length < 2) { skipped++; continue }
    if (!CJK.test(gloss)) { skipped++; continue }
    if (!map.has(w)) map.set(w, [])
    map.get(w).push(gloss)
  }
  return { map, skipped }
}

// 词频表：每行 '单词 计数'，只取行号当排名
function loadFreq(file) {
  const rank = new Map()
  for (const line of readLines(file)) {
    const p = line.split(/\s+/)
    const w = (p[0] || '').trim().toLowerCase().replace(/[^a-z'\-]/g, '')
    if (!w || rank.has(w)) continue
    rank.set(w, rank.size + 1)
  }
  return rank
}

// ---------------------------------------------------------------- 义项清洗

// 义项分隔符。源表一行里可能同时出现 "adv. 到处，周围 prep. 关于"：
// 剥掉词性标记时若不补分隔符，两段释义会粘成 "到处，周围关于" —— 这是脏数据最大的来源。
// 所以剥词性时统一塞一个不可见的 SEP，最后按 SEP 和分号一起切开。
const SEP = '\u0001'

// 按分号 / SEP 切，跳过括号里的分号（"在（表示时间；地点）"这种不该被切开）
function splitSenses(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth++
    else if (ch === '）' || ch === ')') depth--
    if ((ch === '；' || ch === ';' || ch === SEP) && depth <= 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

// 剥词性标记，并留下分隔符保证义项边界
function stripPos(s) {
  return s.replace(POS_ALL, SEP)
}

function normalizeSpace(s) {
  return s.replace(/[　\s]+/g, ' ').trim()
}

function trimPunct(s) {
  return s.replace(/^[,，;；.。、:：()（）[\]【】"'"'·]+|[,，;；.。、:：()（）[\]【】"'"'·]+$/g, '').trim()
}

function cleanSense(chunk) {
  let s = trimPunct(normalizeSpace(chunk))
  if (!s || s.length < 2) return ''       // 单字多半是被切碎的残渣
  if (!CJK.test(s)) return ''             // 没中文 = 残留标记
  if (s.length > MAX_SENSE) s = s.slice(0, MAX_SENSE)
  if (!SENSE_OK.test(s)) return ''        // 含拉丁字母 / 半角括号，多为音译人名或脏数据
  if (SENSE_JUNK.test(s)) return ''
  // 括号必须成对：源表里有 "(要人)的侍从" 这类写法，切开后容易只剩半个括号
  const c1 = (s.match(/（/g) || []).length, c2 = (s.match(/）/g) || []).length
  if (c1 !== c2) return ''
  return s
}

// 义项互相包含的只留一个：不同来源对同一义项的措辞略有出入
// （"现在" vs "现在的现在"、"只，仅仅" vs "只，仅仅唯一的"），不去重的话会出现重复解释。
function covered(s, senses) {
  return senses.some(old => old.includes(s) || s.includes(old))
}

// 截到「不超过 max 的最长合法前缀」，而不是生切一刀。
// 生切的坑：行序 = 用户的学习进度（见 README），若某行因为切出来的片段含非法字符被整条丢弃，
// 后面所有行的行号都会位移，已存的掌握度全部错位。这里从长往短找，保证
// 「原来能留下来的行，放宽上限后一定还能留下来」，放宽 MAX_MEAN 就纯变成释义变长、不带副作用。
function clipMean(s, max) {
  const n = Math.min(s.length, max)
  for (let i = n; i >= 1; i--) {
    const t = trimPunct(s.slice(0, i))
    if (t && CJK.test(t) && MEAN_OK.test(t)) return t
  }
  return ''
}

function buildEntry(glosses) {
  let pos = ''
  const senses = []

  // 短的释义通常最精炼，优先；长的用来补齐
  const ordered = glosses.slice().sort((a, b) => a.length - b.length)
  for (const g of ordered) {
    if (!pos) {
      const m = g.match(POS_HEAD)
      if (m && POS_MAP[m[1]]) pos = POS_MAP[m[1]]
    }
    for (const chunk of splitSenses(stripPos(g))) {
      const s = cleanSense(chunk)
      if (!s || covered(s, senses)) continue
      senses.push(s)
    }
  }

  let m = ''
  for (const s of senses) {
    if (!m) { m = s; continue }
    const next = m + '；' + s
    if (next.length > MAX_MEAN) break
    m = next
  }

  // 全部义项都被过滤掉（多见于全是音译人名的条目）：退回第一条释义，截断保底
  if (!m) {
    for (const g of ordered) {
      const raw = trimPunct(normalizeSpace(splitSenses(stripPos(g))[0] || ''))
      const clipped = clipMean(raw, MAX_MEAN)
      if (clipped) { m = clipped; break }
    }
  }
  // 兜底也没救回来（如 "abbr. 联合国（United Nations）" 这类带原文的缩写）：整条丢弃
  if (m && !MEAN_OK.test(m)) m = ''
  return { pos, m }
}

// ---------------------------------------------------------------- 主流程

const lists = {}
for (const [key, file] of Object.entries({
  junior: 'junior.txt',
  senior: 'senior.txt',
  cet4: 'cet4.txt',
  cet6: 'cet6.txt',
  kaoyan: 'kaoyan.txt'
})) {
  const { map, skipped } = loadVocab(file)
  lists[key] = map
  console.log(`[source] ${key}: ${map.size} 词条（跳过 ${skipped} 行）`)
}

const freqWeb = loadFreq('freq-web-20k.txt')
const freqSub = loadFreq('freq-subtitle-50k.txt')
console.log(`[freq] web=${freqWeb.size} subtitle=${freqSub.size}`)

// 核心词书已有词条：不再进共享表，避免同词两个 id
const wordsJs = fs.readFileSync(path.join(OUT, 'words.js'), 'utf8')
const coreText = new Set()
const reCore = /w:\s*'([^']+)'/g
let mc
while ((mc = reCore.exec(wordsJs))) coreText.add(mc[1].toLowerCase())
console.log(`[core] words.js 已有 ${coreText.size} 个词条，将从新词表中排除`)

// 合并所有词表：key -> { glosses:[], in:Set(词表名) }
const all = new Map()
let stopHit = 0
let sensHit = 0
let dupHit = 0
for (const [key, map] of Object.entries(lists)) {
  for (const [w, glosses] of map) {
    if (STOP.has(w)) { stopHit++; continue }
    if (SENSITIVE.has(w)) { sensHit++; continue }
    if (coreText.has(w)) { dupHit++; continue }
    if (!all.has(w)) all.set(w, { glosses: [], in: new Set() })
    const e = all.get(w)
    for (const g of glosses) e.glosses.push(g)
    e.in.add(key)
  }
}
console.log(`[merge] 候选 ${all.size}（剔除功能词 ${stopHit} 次、与核心词重复 ${dupHit} 次）`)

// 词频打分：两份词频表各占一半权重，缺失项按表尾处理。越小越常用。
const FALLBACK_WEB = 26000
const FALLBACK_SUB = 55000
function freqScore(w) {
  const a = freqWeb.has(w) ? freqWeb.get(w) : FALLBACK_WEB
  const b = freqSub.has(w) ? freqSub.get(w) : FALLBACK_SUB
  return 0.5 * (a / 20000) + 0.5 * (b / 50000)
}

// 最终排序分 = 65% 词频 + 35%「被几本考试词表同时收录」。
//
// 为什么不全用词频：网页语料有很强的领域偏向，纯词频排序会把 site / code / file / tv /
// shopping 这类"网上常见、考试不考"的词顶到第一批；影视字幕语料则塞进 oh / hi / damn /
// darling 这类口语碎片。而"同时出现在初中+高中+四级+六级+考研"是很好的中心度信号 ——
// 五张考试词表都收的词，几乎一定是要考的核心词。两个信号掺一下，首批就是真正的考点高频词。
function score(w, listCount) {
  const centrality = 1 - (listCount - 1) / 4   // 命中 1 张表 → 1；5 张表全中 → 0
  return 0.65 * freqScore(w) + 0.35 * centrality
}

// ---------------------------------------------------------------- 词书选取规则
//
// 选词原则（重要）：
//   掌握度是「按词书」分别记录的（state.books[bid].mastery），同一词条在 A 书学会了，
//   换到 B 书仍然是 0 —— 所以两本词书内容高度重合 = 让用户把同样的词重背一遍。
//   因此这里做成「阶梯式」：每本书只收更基础词书没收的新词，用户一路往上走全是生词。
//
// 每本书自选一条union 词源，不做跨书去重。理由：
//   掌握度是按词书分开记录的（换书=从头再来），所以重合≠能白拿，只是"不同用户选不同考试"而已；
//   而用户在词书列表里点「大学英语四级」，期望看到的就是一份完整的四级词表，
//   而不是"四级里排除掉专升本已收的那部分"。重合的词条在共享表里只占一份，不额外花体积。
//
// union: 收录来源；size: 目标词数（取该范围内词频最高的 N 个 → 每本书内部高频在前、低频在后）
// exclude（可选）：剔除某个来源词表里的词，用来划掉「这本词书的目标用户早该会了」的那部分。
//   这不是为了省体积，是为了别让用户花钱背已经会的东西 —— 专升本词书如果按词频从头取，
//   追加批次会变成 about / time / see / get 这种初中词（实测就排在手写核心词的正后面，
//   难度明显倒挂）。初中词表正好是这条"基础线"：中考 / 高考两本保留，其余四本都划掉。
//
// union: 收录来源；size: 目标词数（取该范围内词频最高的 N 个 → 每本书内部高频在前、低频在后）
const BOOKS = [
  { id: 'junior_core', union: ['junior'], size: 700 },
  { id: 'gao_kao', union: ['senior', 'junior'], size: 1300 },
  { id: 'fj_zsb_core', union: ['cet4', 'senior', 'junior'], size: 1700, exclude: ['junior'] },
  { id: 'cet4', union: ['cet4'], size: 2200, exclude: ['junior'] },
  { id: 'cet6', union: ['cet6'], size: 1900, exclude: ['junior'] },
  { id: 'kaoyan', union: ['kaoyan'], size: 2200, exclude: ['junior'] }
]

const rows = []
for (const [w, e] of all) {
  rows.push({ w, pos: '', m: '', s: score(w, e.in.size), in: e.in, glosses: e.glosses })
}
rows.sort((a, b) => a.s - b.s || (a.w < b.w ? -1 : 1))

const bookIndex = {}
let unionRef = new Set()
for (const b of BOOKS) {
  const cand = rows
    .map((r, i) => ({ i, s: r.s, r }))
    .filter(x => b.union.some(k => x.r.in.has(k)))
    .filter(x => !(b.exclude || []).some(k => x.r.in.has(k)))
    .sort((x, y) => x.s - y.s)
  const picked = cand.slice(0, b.size)
  bookIndex[b.id] = picked.map(x => x.i)
  picked.forEach(x => unionRef.add(x.i))
  console.log(`[book] ${b.id}: 候选 ${cand.length} → 取 ${picked.length}`)
}

// 共享表只保留真正被某本词书用到的词，进一步省体积
rows.forEach((r, i) => {
  if (!unionRef.has(i)) return
  const e = buildEntry(r.glosses)
  r.pos = e.pos
  r.m = e.m
})
// 过滤掉清洗后无有效释义的（其余行整体下标会变，因此先标记再重建）
const keptRows = []
const oldToNew = new Map()
rows.forEach((r, i) => {
  if (!unionRef.has(i)) return
  if (!r.m) return
  oldToNew.set(i, keptRows.length)
  keptRows.push(r)
})
for (const b of BOOKS) {
  bookIndex[b.id] = bookIndex[b.id].map(i => oldToNew.get(i)).filter(x => x !== undefined)
}
console.log(`[lexicon] 共享词条 ${keptRows.length}（被至少一本词书引用）`)
BOOKS.forEach(b => console.log(`   最终 ${b.id}: ${bookIndex[b.id].length} 词`))

// ---------------------------------------------------------------- 查词补充词库（extra-words）
//
// 用户实测反馈「本地查词完全搜不到某个词」的根因，其实不是"词太少"，而是
// **上面这些候选里有一大批压根没被任何词书引用**：每本词书都有 size 上限，还剔了初中词，
// 于是 ${all.size} 个候选里只有 ${keptRows.length} 个进了共享表。剩下那些同样是正经考试词、
// 同样带中文释义，却因为"没被任何书挑中"而在 App 里查不到。
//
// 这里把它们单独导出成一份**只读查词表**：
//   · 不进任何词书 → 不占共享表的行号 → 老用户已背进度一个字都不用动
//     （行号就是学习进度索引，见 README「重生成后必须做的行序校验」）
//   · 只给 utils/dict.js 当最后一层兜底，让查词 / 点读能翻到它
// 清洗规则与共享表完全一致（复用同一个 buildEntry），所以不会出现只有一边有的脏释义。
const keptWordSet = new Set(keptRows.map(r => r.w))
// 常用词词典（data/common-words.js）里已有的也剔掉：
// 反正那一层本来就能查到，再存一份只是重复占体积。
const commonWordSet = new Set()
fs.readFileSync(path.join(OUT, 'common-words.js'), 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .forEach(function (line) {
    const m = /^\s*'([^']+)'/.exec(line)
    if (!m) return
    const k = m[1].split('|')[0].trim().toLowerCase()
    if (k) commonWordSet.add(k)
  })

const extraRows = []
for (const [w, e] of all) {
  if (keptWordSet.has(w) || commonWordSet.has(w)) continue
  const built = buildEntry(e.glosses)
  if (!built.m) continue            // 释义被清洗规则剔光了（多为音译人名 / 缩写），不收录
  extraRows.push({ w, pos: built.pos, m: built.m, s: freqScore(w) })
}
// ---------------------------------------------------------------- 日常短词 / 口语 / 缩略语
//
// 主流程的 STOP 表会剔掉 hi / ok / vs / nor / net 这类"功能词"——**对词书来说完全正确**：
// 没有人需要把 "hi" 做成一张单词卡片。可词典是另一回事：真机反馈里用户随手敲一个短词，
// 本地一条都答不上来（它们既不在考试词表、也不在常用词表，等于在本地词典里不存在）。
// 所以补一张亲手校过的 everyday.txt，**只喂给查词补充表**（只读、不进任何词书、
// 不占共享表行号），让日常短词也能立刻查到，同时不污染任何人的背诵列表。
//
// ⚠️ 这张表不能丢进上面那条合并链：那样会被 STOP 表整批剔掉，白补。
const extraSet = new Set(extraRows.map(r => r.w))
const { map: everydayMap } = loadVocab('everyday.txt')
let everydayHit = 0
for (const [w, glosses] of everydayMap) {
  if (keptWordSet.has(w) || commonWordSet.has(w) || extraSet.has(w)) continue
  const built = buildEntry(glosses)
  if (!built.m) continue            // 释义被清洗规则剔光了就不收（宁缺毋滥）
  extraRows.push({ w, pos: built.pos, m: built.m, s: freqScore(w) })
  extraSet.add(w)
  everydayHit++
}
console.log(`[extra] 日常短词 / 口语 / 缩略语补 ${everydayHit} 条（候选 ${everydayMap.size}）`)

// 按词频排：查词命中多条时，靠前的更可能是用户想查的那个（与共享表同一口径）
extraRows.sort((a, b) => a.s - b.s || (a.w < b.w ? -1 : 1))
console.log(`[extra] 查词补充词库 ${extraRows.length} 条（候选 ${all.size}，已剔共享表 ${keptWordSet.size} / 常用词 ${commonWordSet.size}）`)

// lv 不落文件：运行时按「所在行 / 总行数」切四档即可（行已按词频排好序）
const lvOf = (i, n) => {
  const r = i / n
  return r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4
}

// ---------------------------------------------------------------- 输出

const noShot = s => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

const lexRaw = '\n' + keptRows.map(r => `${r.w}|${r.pos}|${r.m}`).join('\n') + '\n'
const kB = Buffer.byteLength(lexRaw) / 1024

const lexiconJs = `// data/lexicon-data.js - 内置词书共享词条表（**自动生成，请勿手改**）
// 生成脚本：_vocab/build.js（node _vocab/build.js）
//
// 为什么是裸字符串而不是对象数组：
//   ${keptRows.length} 个词条写成对象字面量约 ${(keptRows.length * 62 / 1024).toFixed(0)}KB，写成一行一条的裸字符串只有 ${kB.toFixed(0)}KB，
//   读取时只是 split('\\n')，比解析几万个对象字面量更快、内存更省。
//
// 行格式：word|pos|释义
//   id 不落文件：行号 + LEX_START 即词条 id（第 0 行 → ${LEX_START}），省掉每行一个数字。
//   lv 也不落文件：行已按词频排好序，按「行号 / 总行数」四等分即 1-4 档（见 lexicon.js 的 lvOf）。
//
// 与 data/words.js（核心 ${coreText.size} 词）无重复，两者合并后才是 App 的完整内置词库。
// 词条来源与许可见 _vocab/README.md。
export const LEX_START = ${LEX_START}
export const LEX_COUNT = ${keptRows.length}

export const LEX_RAW = \`${noShot(lexRaw)}\`
`

// 索引用定长 3 位 base36（最大 46655，够 ${keptRows.length} 个词条用）
const IDX_LEN = 3
function encodeIdx(list) {
  return list.map(i => i.toString(36).padStart(IDX_LEN, '0')).join('')
}
const idxParts = BOOKS.map(b => `  ${b.id}: '${encodeIdx(bookIndex[b.id])}'`)

const bookdataJs = `// data/bookdata.js - 内置词书的词条索引（**自动生成，请勿手改**）
// 生成脚本：_vocab/build.js（node _vocab/build.js）
//
// 词书只存「词条序号」，真正的词条在 lexicon.js 里只存一份，避免多本词书重复存释义。
// 编码：每 ${IDX_LEN} 个字符一个序号，base36，取用时按 ${IDX_LEN} 位切片 parseInt(s, 36)。
// 序号 n 的词条 id 为 n + LEX_START；同一词条可被多本词书引用（掌握度按词书分别记录，互不影响）。
export const IDX_LEN = ${IDX_LEN}

export const BOOK_INDEX = {
${idxParts.join(',\n')}
}
`

// 查词补充词表：格式与 lexicon-data.js 完全一致（word|pos|释义，一行一条），
// 区别只在于**它不属于任何词书** —— 没有行号 = 没有学习进度，纯查词兜底用。
const extraRaw = '\n' + extraRows.map(r => `${r.w}|${r.pos}|${r.m}`).join('\n') + '\n'
const extraKB = Buffer.byteLength(extraRaw) / 1024

const extraJs = `// data/extra-words.js - 查词补充词表（**自动生成，请勿手改**）
// 生成脚本：_vocab/build.js（node _vocab/build.js）
//
// 存在理由（用户实测反馈「本地查词完全搜不到」）：
//   _vocab/src 的 5 张考试词表合计 ${all.size} 个候选词，但每本词书都有 size 上限、
//   还剔了初中词，真正被某本词书引用的只有 ${keptRows.length} 个（= lexicon-data.js 的行）。
//   剩下这 ${extraRows.length} 个同样是带中文释义的正经考试词，却因为"没被任何书挑中"而查不到。
//
// 为什么不直接塞进 lexicon-data.js：
//   共享表的**行号就是用户的学习进度索引**（id = 行号 + LEX_START，掌握度按 id 存在本机）。
//   往中间插一行，后面所有词的 id 全部位移，老用户已背记录会挂到别的词上且不报错。
//   所以这份表独立成文件：只给查词 / 点读作兜底，不进任何词书，绝不产生新的词书 id。
//
// 消费方：utils/dict.js（把它并进"全量本地词典"索引），utils/search.js（跨全量词典检索）。
//
// 行格式：word|pos|释义（与共享表一致）
// 词条来源与许可见 _vocab/README.md。
export const EXTRA_COUNT = ${extraRows.length}

export const EXTRA_RAW = \`${noShot(extraRaw)}\`
`

// ---------------------------------------------------------------- 规模快照
// 设置页（在分包 pkgManage 里）的彩蛋要显示「本地装了多少东西」，
// 但为了几个数字去 import 174KB 的语料，会把语料再复制一份进分包 —— 得不偿失。
// 所以这里把数字预先算好，写成几百字节的小文件，设置页只引它。
// 改版本号改这里（APP_VERSION），同时记得同步 uniapp/manifest.json 的 versionName。
const APP_VERSION = '1.1 Beta'

const sentenceJs = fs.readFileSync(path.join(OUT, 'sentences.js'), 'utf8')
const sentenceCount = (sentenceJs.match(/\{ id: \d+,/g) || []).length
const builtAt = new Date().toISOString().slice(0, 10)

const buildInfoJs = `// data/build-info.js - 内置语料规模快照（**自动生成，请勿手改**）
// 生成脚本：_vocab/build.js（node _vocab/build.js）
//
// 存在意义：设置页（分包 pkgManage）的彩蛋要显示这些数字，但不能 import 语料本身
// —— 那会把 100KB+ 的语料再复制一份进分包。这里只存几个数字，几百字节。
//
// version 是对外显示的版本号（设置 › 关于 › 版本），改它同时要改 manifest.json
// 的 versionName，两处保持一致（check-version-egg.js 会盯）。
export const BUILD_INFO = {
  version: '${APP_VERSION}',
  lexCount: ${keptRows.length},
  coreCount: ${coreText.size},
  bookCount: ${BOOKS.length},
  sentenceCount: ${sentenceCount},
  builtAt: '${builtAt}'
}
`

fs.writeFileSync(path.join(OUT, 'lexicon-data.js'), lexiconJs, 'utf8')
fs.writeFileSync(path.join(OUT, 'bookdata.js'), bookdataJs, 'utf8')
fs.writeFileSync(path.join(OUT, 'extra-words.js'), extraJs, 'utf8')
fs.writeFileSync(path.join(OUT, 'build-info.js'), buildInfoJs, 'utf8')

const s1 = Buffer.byteLength(lexiconJs) / 1024
const s2 = Buffer.byteLength(bookdataJs) / 1024
const s3 = Buffer.byteLength(buildInfoJs) / 1024
const s4 = Buffer.byteLength(extraJs) / 1024
console.log(`\n[out] lexicon-data.js ${s1.toFixed(1)}KB（${keptRows.length} 词条）`)
console.log(`[out] bookdata.js ${s2.toFixed(1)}KB`)
console.log(`[out] 合计 ${(s1 + s2).toFixed(1)}KB`)
console.log(`[out] extra-words.js ${s4.toFixed(1)}KB（${extraRows.length} 条，只用于查词）`)
console.log(`[out] build-info.js ${s3.toFixed(1)}KB（句库 ${sentenceCount} 条，版本 ${APP_VERSION}）`)

console.log('\n[sample] 最常考前 8 个词条：')
keptRows.slice(0, 8).forEach((r, i) => console.log(`   ${r.w} | ${r.pos} | ${r.m} | lv${lvOf(i, keptRows.length)}`))
console.log('[sample] 中段 4 个词条：')
keptRows.slice(1200, 1204).forEach((r, i) => console.log(`   ${r.w} | ${r.pos} | ${r.m} | lv${lvOf(1200 + i, keptRows.length)}`))
console.log('[sample] 末 4 个词条：')
keptRows.slice(-4).forEach((r, i) => console.log(`   ${r.w} | ${r.pos} | ${r.m} | lv${lvOf(keptRows.length - 4 + i, keptRows.length)}`))
