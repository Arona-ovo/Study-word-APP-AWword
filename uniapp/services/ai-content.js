// services/ai-content.js - 基于统一大模型层的高层 AI 内容能力
// 全部走 services/llm（OpenAI 兼容），未配置 / 失败一律抛可降级错误，由调用方兜底。
// 密钥零硬编码：地址与密钥仅来自 settings / 环境变量，见 config.js。
import { chatCompletion, chatCompletionStream } from './llm.js'
import { isAIEnabled, getAIConfig, chatEndpoint } from './config.js'
import { request, ServiceError, resetBreaker, breakerKeyOf } from './http.js'
// 底层缓存：释义 / 例句统一落在这里（独立 key，不进词书、不进学习进度）
import * as aiCache from '../utils/ai-cache.js'
// 分项开关：查词 / 点评 / 专练 / 生成词书 / 聊天，各自可被用户在设置里关掉省 token
import { ensureFeature as aiFeature } from './ai-gate.js'

// 从模型返回里抽取第一个 JSON 值（对象或数组；容忍 ```json 代码块与前后多余文本）
function extractJSON(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const objStart = s.indexOf('{')
  const arrStart = s.indexOf('[')
  let start = -1
  let close = ''
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) { start = objStart; close = '}' }
  else if (arrStart >= 0) { start = arrStart; close = ']' }
  if (start < 0) return null
  const end = s.lastIndexOf(close)
  if (end < start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch (e) { return null }
}

function ensureEnabled() {
  if (!isAIEnabled()) {
    throw new ServiceError('AI 服务未启用或缺少配置', { degradable: true, notConfigured: true })
  }
}

// ---------- 1. 单词释义 + 整句翻译 ----------
// 返回 { word, pos, meaningZh, kind:'word'|'sentence', examples:[{en,zh}], fromCache }
//
// 为什么一个函数管两件事：搜索框只有一个入口，用户不会先声明"我要查词还是翻译"。
// 中文输入尤其分不清 —— 「把背景换成安静的蓝色渐变」是词还是句，只有模型判得准。
// 所以统一交给模型判 kind，再决定 meaningZh 装什么：
//   kind=word     → meaningZh = 中文释义（查词的老行为）
//   kind=sentence → meaningZh = **整句译文**（中文进 → 英文出；英文进 → 中文出）
// 以前没有这条分支，整句会被当单词查：模型只能回一句同义中文改写，
// 用户要的"这句话用英语怎么说"就永远拿不到。
export async function explainWord(word) {
  const w = String(word || '').trim()
  if (!w) throw new ServiceError('单词为空', { degradable: true })

  // 先查底层缓存：命中就直接返回，**不要求已配置 AI**
  // ——这样之前生成过的内容，离线 / 未配置也能再搜到、再看到。
  const hit = aiCache.findWord(w)
  if (hit) {
    return {
      word: hit.word,
      pos: hit.pos || '',
      meaningZh: hit.meaning || '',
      // 补齐过的多义条目会把义项表一起存下来（老缓存没有 → []）
      senses: aiCache.sensesOf(hit.word),
      kind: isSentencePos(hit.pos) ? 'sentence' : 'word',
      // 例句单独存在 sentences 桶里，这里按词捞回来即可
      examples: aiCache.sentencesOf(hit.word).map(s => ({ en: s.en, zh: s.zh })),
      fromCache: true
    }
  }

  aiFeature('lookup')
  ensureEnabled()

  const sys = [
    'You are an English-Chinese dictionary and translation assistant for Chinese students.',
    'First decide whether the input is a single word/short phrase, or a whole sentence.',
    'Return ONLY strict JSON: {"kind":"word"|"sentence","word":"...","pos":"...","meaningZh":"...","examples":[{"en":"...","zh":"..."}]}.',
    'If kind="word": pos is a grammar tag (n./v./adj./phrase), and meaningZh is the concise Chinese definition.',
    'If kind="sentence": pos must be "sentence", and meaningZh must be the translation of the WHOLE input into the other language (Chinese in -> English out, English in -> Chinese out).',
    'Never rewrite a sentence into a same-language paraphrase — that is not a translation and is useless to the user.',
    'Use CEFR A2-B1 level examples, exactly 2 examples.',
    'No markdown, no code fences, no extra text.'
  ].join(' ')
  const hint = looksLikeSentence(w) ? '（这是一整句话，请给整句译文）' : ''
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: 'Input: ' + w + hint }
  ], { temperature: 0.3, timeout: 15000 })

  const obj = extractJSON(r.content)
  if (!obj || !obj.meaningZh) throw new ServiceError('模型返回异常', { degradable: true })
  const kind = obj.kind === 'sentence' ? 'sentence' : 'word'
  const out = {
    word: obj.word || w,
    // 句子没有词性可标：统一打 'sentence'，和 'phrase' 一个路数，一眼能看出这不是单词
    pos: kind === 'sentence' ? (obj.pos || 'sentence') : (obj.pos || ''),
    meaningZh: obj.meaningZh,
    kind: kind,
    senses: Array.isArray(obj.senses) ? obj.senses.slice(0, 8) : [],
    examples: Array.isArray(obj.examples) ? obj.examples.slice(0, 4) : []
  }
  // 落底层：单词一条 + 每个例句一条（以后搜索/查看同一个词能直接命中）
  aiCache.rememberWord({
    word: out.word, pos: out.pos, meaning: out.meaningZh, senses: out.senses, src: 'ai', q: w
  });
  out.examples.forEach(ex => {
    aiCache.rememberSentence({ en: ex.en, zh: ex.zh, word: out.word, source: 'ai' });
  });
  return Object.assign({ fromCache: false }, out)
}

/** pos 标成 sentence = 这条缓存存的是整句译文，不是单词释义 */
function isSentencePos(pos) {
  return String(pos || '').trim().toLowerCase() === 'sentence'
}

// 预判预取的数量上限：多了就是浪费 token，也容易把缓存塞满一堆用户根本不查的词
const MAX_ALSO = 3       // 调用方本地点名的候选（本次搜索结果里排在前面的那几条）
const MAX_RELATED = 3    // 模型自己预判的同根 / 搭配词
const MAX_OTHERS = 5     // 一次调用总共最多补几个附带词

/**
 * 「补全多义 + 顺手多备几个词」—— 一次调用拿回三样东西：
 *
 *   1. 目标词的**常用义项表**（`senses`）。词书里一个词只存一条释义，
 *      老缓存也只有一条 —— 用户看到的就是"一词多义显示不全"。
 *   2. 例句（走 sentences 桶，和 explainWord 同一套）
 *   3. `others`：预判用户**接下来最可能查**的几个词，顺手一起补了。
 *      来源两路：调用方本地传进来的候选（`also`，通常是本次搜索结果里排在前面、
 *      用户八成要点开的那几条）+ 模型给的同根词 / 搭配 / 高频邻词（`related`）。
 *
 * **全部写进 aiCache**（用户原话："AI 补充完，记得载入缓存"）：
 *   · 主词记成完整义项条目 → 下次再查，离线也能看到全部义项，不用再花一次 token
 *   · others 一并落成缓存条目（src='ai-prefetch'）→ "本地多缓存一些"就是这么来的：
 *     用户还没查，那几个词已经在本机备好了，查到时直接命中、不再等 AI
 *
 * 代价控制：一次调用覆盖 1 个主词 + 最多 5 个附带词，比"每个词各问一次"省得多；
 * 是否调用由页面决定（缓存里已有 ≥2 个义项就别再补）。
 *
 * @param word 要补全的词
 * @param opts { also: string[] } 本地预判的候选词（≤3）
 * @returns { word, pos, senses:[{pos,meaning}], examples:[{en,zh}], others:[{word,pos,meaning}] }
 */
export async function expandWord(word, opts) {
  const w = String(word || '').trim()
  if (!w) throw new ServiceError('单词为空', { degradable: true })

  // 已经补齐过就直接从缓存返回 —— 不花 token（守卫只挡花钱的那一步，缓存读取不挡）
  if (aiCache.hasFullSenses(w)) {
    const hit = aiCache.findWord(w)
    return {
      word: hit.word,
      pos: hit.pos || '',
      senses: aiCache.sensesOf(w),
      examples: aiCache.sentencesOf(hit.word).map(s => ({ en: s.en, zh: s.zh })).slice(0, 2),
      others: [],
      fromCache: true
    }
  }

  aiFeature('lookup')
  ensureEnabled()

  const also = ((opts && opts.also) || [])
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .slice(0, MAX_ALSO)

  const sys = [
    'You are an English-Chinese dictionary for Chinese students.',
    'Return ONLY strict JSON: ',
    '{"word":"...","pos":"...","senses":[{"pos":"n.","meaning":"中文释义"}],',
    '"examples":[{"en":"...","zh":"..."}],"others":[{"word":"...","pos":"...","meaning":"中文释义"}]}.',
    'senses: list EVERY commonly used sense of the word, most frequent first.',
    'Give 1 sense only if the word truly has just one; do NOT invent rare or obsolete senses.',
    'examples: exactly 1 short CEFR A2-B1 sentence with Chinese translation.',
    'others: first give an entry for EACH word listed in ALSO below (if any), then add up to '
      + MAX_RELATED + ' words the student is most likely to look up next '
      + '(same root, common collocations, or closely related high-frequency words).',
    'Never include the main word itself in others. At most ' + MAX_OTHERS + ' entries in others.',
    'All Chinese definitions must be concise. No markdown, no code fences, no extra text.'
  ].join(' ')
  const user = 'Word: ' + w + '\nALSO: ' + (also.length ? also.join(', ') : '(none)')

  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.3, timeout: 20000 })

  const obj = extractJSON(r.content)
  if (!obj) throw new ServiceError('模型返回异常', { degradable: true })

  const senses = (Array.isArray(obj.senses) ? obj.senses : [])
    .map(s => ({
      pos: String((s && s.pos) || ''),
      meaning: String((s && s.meaning) || '')
    }))
    .filter(s => s.meaning)
    .slice(0, 8)
  const meaningZh = senses.length
    ? senses.map(s => s.meaning).join('；')
    : String(obj.meaningZh || '')
  if (!senses.length && !meaningZh) throw new ServiceError('模型返回异常', { degradable: true })

  const examples = (Array.isArray(obj.examples) ? obj.examples : [])
    .map(e => ({ en: String((e && e.en) || ''), zh: String((e && e.zh) || '') }))
    .filter(e => e.en)
    .slice(0, 2)

  const main = String(obj.word || w).trim().toLowerCase()
  const others = (Array.isArray(obj.others) ? obj.others : [])
    .map(o => ({
      word: String((o && o.word) || '').trim(),
      pos: String((o && o.pos) || ''),
      meaning: String((o && o.meaning) || '')
    }))
    .filter(o => o.word && o.meaning && o.word.toLowerCase() !== main)
    .slice(0, MAX_OTHERS)

  const out = {
    word: String(obj.word || w).trim(),
    pos: String(obj.pos || ''),
    senses,
    meaningZh,
    examples,
    others,
    fromCache: false
  }

  // 落底层：主词（带完整义项）+ 例句 + 预判的那几个词
  aiCache.rememberWord({ word: out.word, pos: out.pos, meaning: meaningZh, senses, src: 'ai', q: w })
  examples.forEach(ex => {
    aiCache.rememberSentence({ en: ex.en, zh: ex.zh, word: out.word, source: 'ai' })
  })
  others.forEach(o => {
    // 已经有一条完整释义的不再覆盖（那可能是用户自己加过的）
    if (aiCache.findWord(o.word)) return
    aiCache.rememberWord({ word: o.word, pos: o.pos, meaning: o.meaning, src: 'ai-prefetch', q: '' })
  })
  return out
}

/**
 * 本地粗判"这更像一整句还是单词"。
 * 只用来给模型加一句提示，不参与最终判定（最终以模型返回的 kind 为准 ——
 * 中文没有词边界，靠长度猜「不可回收垃圾」是词还是句，正则猜不准）。
 */
export function looksLikeSentence(s) {
  const t = String(s || '').trim()
  if (!t) return false
  // 英文按空格切：≥3 个词基本是句子（"give up" 这类两词短语还是词条，交给模型判）
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length >= 3) return true
  // 中文没边界，用长度兜：≥8 字基本是短语/句子，短的交模型
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length
  return cjk >= 8 && !/[A-Za-z]/.test(t)
}

// ---------- 2. 翻译点评 ----------
// params: { source(待翻译原文), userAnswer(学生译文), reference(参考答案), dir('e2c'|'c2e') }
// 返回 { hasError, comment, improved }
export async function critiqueTranslation(p) {
  aiFeature('critique')
  ensureEnabled()
  if (!p || !p.userAnswer) throw new ServiceError('缺少学生译文', { degradable: true })
  const dir = p.dir === 'e2c' ? 'e2c' : 'c2e'
  const sys = [
    'You are a patient translation tutor for Chinese English learners.',
    'Given the source text, the student\'s translation and the reference translation,',
    'evaluate the student\'s translation in Chinese. Point out concrete errors (if any) and give an improved version.',
    'Return ONLY strict JSON: {"hasError":true/false,"comment":"中文点评","improved":"改进后的译文"}.',
    'Be encouraging. If the translation is good, say so and still offer a slightly better phrasing.',
    'No markdown, no code fences.'
  ].join(' ')
  const user = [
    '翻译方向：' + (dir === 'e2c' ? '英译汉' : '汉译英'),
    '原文：' + (p.source || ''),
    '学生译文：' + (p.userAnswer || ''),
    '参考答案：' + (p.reference || ''),
    '请输出 JSON 点评。'
  ].join('\n')
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.4, timeout: 15000 })
  const obj = extractJSON(r.content)
  if (!obj) throw new ServiceError('点评生成失败', { degradable: true })
  return {
    hasError: !!obj.hasError,
    comment: obj.comment || '',
    improved: obj.improved || ''
  }
}

/**
 * 「易混词辨析」—— 学生总把 A 写成/选成 B（rise ↔ rice、quite ↔ quiet…）时讲清两个词。
 *
 * 触发由 utils/confusion.js 本地算（错够几次才算"经常搞混"），这里**只负责讲**。
 * 调用方（components/confusion-card）会先用 `confusion.teachOf()` 查本地缓存，
 * 命中就不进这个函数 —— 同一个对讲一次就够，不反复烧 token。
 *
 * @param a 学生**本该**写 / 选的那个词
 * @param b 学生**实际搞成**的那个词
 * @param opts { meaningA, meaningB } 本地已有的释义（有的话一起给，免得模型把两个词的意思搞反）
 * @returns { a:{word,pos,meaning}, b:{word,pos,meaning}, diff, tips, examples:[{en,zh,use}] }
 */
export async function explainConfusion(a, b, opts) {
  aiFeature('confusion')
  ensureEnabled()
  const wa = String(a || '').trim()
  const wb = String(b || '').trim()
  if (!wa || !wb) throw new ServiceError('需要两个词才能辨析', { degradable: true })

  const o = opts || {}
  const sys = [
    'You are an English teacher helping a Chinese student who keeps confusing two similar words.',
    'Return ONLY strict JSON: ',
    '{"a":{"word":"...","pos":"...","meaning":"中文释义"},',
    '"b":{"word":"...","pos":"...","meaning":"中文释义"},',
    '"diff":"中文：一句话点出核心区别（读音/词性/意思/用法），要具体到能区分",',
    '"tips":"中文：一条记得住的技巧（词根、联想、谐音、搭配都行），一到两句",',
    '"examples":[{"en":"...","zh":"中文翻译","use":"a 或 b"}]}.',
    'Give exactly 2 examples: one using word a, one using word b. Mark each with "use":"a" or "use":"b".',
    'Sentences must be short (CEFR A2-B1) and make the difference obvious in context.',
    'All Chinese must be concise. No markdown, no code fences, no extra text.'
  ].join(' ')
  const user = [
    'Word a (the one the student SHOULD have used): ' + wa + (o.meaningA ? '（已知释义：' + o.meaningA + '）' : ''),
    'Word b (the one the student actually used): ' + wb + (o.meaningB ? '（已知释义：' + o.meaningB + '）' : ''),
    '请输出 JSON 辨析。'
  ].join('\n')

  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.4, timeout: 20000 })

  const obj = extractJSON(r.content)
  if (!obj) throw new ServiceError('辨析生成失败', { degradable: true })

  const side = (v, fallback) => ({
    word: String((v && v.word) || '').trim() || fallback,
    pos: String((v && v.pos) || ''),
    meaning: String((v && v.meaning) || '')
  })
  const out = {
    a: side(obj.a, wa),
    b: side(obj.b, wb),
    diff: String(obj.diff || ''),
    tips: String(obj.tips || ''),
    examples: (Array.isArray(obj.examples) ? obj.examples : [])
      .map(e => ({
        en: String((e && e.en) || ''),
        zh: String((e && e.zh) || ''),
        use: String((e && e.use) || '').trim().toLowerCase() === 'b' ? 'b' : 'a'
      }))
      .filter(e => e.en)
      .slice(0, 2)
  }
  // 两个词的释义都没拿到、区别也没讲出来 → 这次算失败（页面照旧能显示本地那两条释义）
  if (!out.a.meaning && !out.b.meaning && !out.diff) {
    throw new ServiceError('辨析内容为空', { degradable: true })
  }
  return out
}

// ---------- 3. AI 薄弱点专练（针对指定词生成练习句） ----------
// words: [{ word, meaning }]；返回 { en, zh, targetWords, note, level }
export async function generateDrill(words) {
  aiFeature('drill')
  ensureEnabled()
  const list = (words || []).filter(x => x && x.word).map(x => (x.word + (x.meaning ? '(' + x.meaning + ')' : '')))
  if (!list.length) throw new ServiceError('未指定目标词', { degradable: true })
  const sys = [
    'You create English-Chinese translation practice sentences for Chinese students.',
    'Use the given target words naturally in ONE English sentence (8-30 words).',
    'Return ONLY strict JSON: {"en":"英文句子","zh":"中文翻译","targetWords":["目标词"],"note":"一句中文考点说明","level":1}.',
    'Level 1-5 by difficulty. Keep vocabulary at CEFR A2-B1 except the target words.',
    'No markdown, no code fences.'
  ].join(' ')
  const user = '目标词（必须用到）：' + list.join('，') + '\n请输出 JSON。'
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.8, timeout: 15000 })
  const obj = extractJSON(r.content)
  if (!obj || !obj.en || !obj.zh) throw new ServiceError('生成失败', { degradable: true })
  return {
    en: String(obj.en).trim(),
    zh: String(obj.zh).trim(),
    targetWords: Array.isArray(obj.targetWords) ? obj.targetWords : list.map(x => x.split('(')[0]),
    note: obj.note || '',
    level: obj.level || 1
  }
}

// ---------- 4. 对话陪练 ----------
export function tutorSystemPrompt(learnedWords) {
  const hint = (learnedWords && learnedWords.length)
    ? ('The student is currently learning these words, try to use them naturally: ' + learnedWords.slice(0, 12).join(', ') + '.')
    : ''
  return [
    'You are a friendly English conversation partner for a Chinese student learning English.',
    'Always reply in simple English (CEFR A2-B1).',
    'Gently correct the student\'s grammar or wording when needed, and encourage them.',
    'Keep each reply short (1-3 sentences).',
    hint
  ].filter(Boolean).join(' ')
}

/**
 * 抽测模式的 system 提示词。
 *
 * 分工：**出题顺序由页面（本地）定**，模型只做两件事 —— 把这一题问出来、点评上一题。
 * 全交给模型自由发挥的话，它会翻来覆去考同一个词、还会顺手编释义；
 * 而本地手里有当前词书的原词与原释义，正好把这两件事钉死。
 *
 * 判定标记：让模型在**判分**时以「【对】/【错】」开头。自然语言里"对了""答错啦"
 * 混在点评中间，正则判不准；固定标记还能让页面把"对 x 错 y"直接数出来（状态条上可见）。
 * 第一题还没人回答，所以明确要求那一轮**不许**输出标记 —— 否则会白加一次"答对"。
 */
export function quizSystemPrompt(pool) {
  const list = (pool || [])
    .filter(w => w && w.w)
    .slice(0, 30)
    .map(w => w.w + (w.pos ? ' (' + w.pos + ')' : '') + ' = ' + w.m)
    .join('; ')
  return [
    'You are a vocabulary quiz coach for a Chinese student.',
    'Ask about exactly ONE word per reply, then wait for the student to answer.',
    'The student may answer in Chinese or English; accept either.',
    'Grading rule: if you are grading the student\'s answer to your previous question,'
      + ' start your reply with the exact marker 【对】 or 【错】 (nothing before it, no space).',
    'If there is no student answer to grade yet (this is the first question),'
      + ' do NOT output any marker — just ask the question.',
    'After the marker, give ONE short sentence of feedback, then immediately ask the next question.',
    'Never reveal the answer before the student answers. Keep everything short (1-3 sentences). Reply in English.',
    'Only quiz words from this pool; their meanings below are authoritative — do not invent meanings: ' + list
  ].join(' ')
}

/**
 * 抽测：把"这一轮要考哪个词"作为一条 system 指令挂在 payload 末尾。
 * 它**只在发给模型的那份 payload 里**（页面不往 messages 里存、也不显示），
 * 所以既不会污染界面，也不会写进对话存档。
 */
export function quizNextHint(w) {
  if (!w || !w.w) return ''
  return [
    'QUIZ STEP: ask the student about exactly this word: "' + w.w + '"'
      + (w.pos ? ' (' + w.pos + ')' : '') + ' — ' + w.m + '.',
    'Ask ONE question about it (its Chinese meaning, or a fill-in-the-blank sentence) in English, 1-2 sentences.',
    'Do not ask about any other word, and do not give the answer.'
  ].join(' ')
}

/** 词考完了：让模型收尾（这一轮之后页面会自动结束抽测） */
export function quizWrapHint() {
  return [
    'QUIZ STEP: every word in the pool has been asked.',
    'Do not ask any new question; use 2-3 sentences to wrap up:'
      + ' praise what the student did well, and list the words that were answered wrong.'
  ].join(' ')
}

export async function chat(messages, opts) {
  aiFeature('chat')
  ensureEnabled()
  if (!messages || !messages.length) throw new ServiceError('对话为空', { degradable: true })
  const o = Object.assign({ temperature: 0.7, timeout: 20000 }, opts || {})
  // 给了 onDelta 就走流式：一个字一个字往外吐，不用干等 20s
  if (typeof o.onDelta === 'function') {
    try {
      return await chatCompletionStream(messages, o)
    } catch (e) {
      // 什么情况下值得"整块再来一次"：
      //   · 端不支持流式（streamUnsupported）—— 本来就没收到一个字；
      //   · 流式请求超时 / 服务商 5xx —— 干等一场不如换成整块再试一次。
      // 鉴权类（401/402/404/422）和限频（429）不重试：重试也是同一个错，
      // 而且会把用户的时间白白耗掉，直接给人话报错更好。
      // 已经收到一半内容的失败也不重试（免得重复输出）—— 那种错误不在下面的白名单里。
      const ex = (e && e.extra) || {}
      const worthRetry = !!ex.streamUnsupported || !!(e && e.timeout) ||
        (typeof e.status === 'number' && e.status >= 500)
      if (!worthRetry) throw e
    }
  }
  return chatCompletion(messages, o)
}

// ---------- 6. AI 生成词书（按主题生成词表，供本地导入） ----------
//
// 数量支持三种写法：
//   · 固定数量：1 ~ 500 的任意整数（UI 用预设胶囊或直接输入）
//   · 不限    ：0 / -1 / 'auto' / Infinity —— 分多轮抓取，
//               直到模型给不出新词（认为该主题已覆盖完整）或触达安全上限
//   · 非法输入：统一按「不限」处理，不阻断主流程
export const WORDBOOK_COUNT = {
  MIN: 1,
  MAX: 8000,        // 安全上限：即便选「不限」也不会无限发请求
  PER_ROUND: 40,    // 单轮上限：一次要太多会被截断，JSON 直接解析失败
  MAX_ROUNDS: 200,  // 与 MAX/PER_ROUND 对齐：8000 / 40 = 200 轮封顶
  // 欠量补抓：模型经常一次给不满（要 40 只给 20），只按 ceil(count/PER_ROUND) 算轮次
  // 会导致 count≤40 时只有 1 轮、要多少拿不到多少。多给几轮让它补齐，
  // 真给不出新词时由 exhausted 提前跳出，不会空转。
  TOP_UP_ROUNDS: 5
};

// 把各种写法归一成 { auto, count }；auto=true 表示「不限」
export function normalizeWordCount(raw) {
  if (raw === 0 || raw === -1) return { auto: true, count: 0 }
  const s = String(raw == null ? '' : raw).trim().toLowerCase()
  if (!s || s === 'auto' || s === 'all' || s === 'unlimited' || s === '不限制' ||
      s === '不限' || s === '无上限' || s === 'infinity') {
    return { auto: true, count: 0 }
  }
  const n = Math.floor(Number(s))
  if (!isFinite(n) || n <= 0) return { auto: true, count: 0 }
  return {
    auto: false,
    count: Math.min(WORDBOOK_COUNT.MAX, Math.max(WORDBOOK_COUNT.MIN, n))
  }
}

// 单轮问模型要一批词；exclude = 已经收录的词，让模型避开
async function requestWordBatch(o) {
  const sys = [
    'You build English vocabulary word lists for Chinese learners.',
    'Return ONLY strict JSON: {"bookName":"词书名称(中文)","words":[{"word":"英文单词","pos":"词性如 n./v./adj.","meaning":"中文释义"}]}.',
    'Only common, useful words that clearly belong to the given topic.',
    'No duplicates. No proper nouns. English words must be lowercase.',
    'If you cannot find enough remaining words, return only the words you still have. Never pad the list with off-topic or rare words.',
    'No markdown, no code fences, no extra text.'
  ].join(' ')

  const lines = ['主题：' + o.topic, '本次需要：' + o.want + ' 个单词', '难度：' + o.level]
  const ex = (o.exclude || []).filter(Boolean)
  if (ex.length) lines.push('已经收录、必须跳过的单词：' + ex.join(', '))
  lines.push('请输出 JSON。')

  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: lines.join('\n') }
  ]
  const reqOpts = { temperature: 0.8, timeout: 45000, params: { max_tokens: 2400 } }

  // 给了 onDelta 就走流式：一批 2400 token 的 JSON 要等十几秒，
  // 流式期间把"已收到多少字"透给页面，等待不再像卡死。
  // 端不支持流式 → 整块回退，结果完全一样（流式只用于展示进度，解析仍等全文）
  let r
  if (typeof o.onDelta === 'function') {
    try {
      r = await chatCompletionStream(msgs, Object.assign({}, reqOpts, { onDelta: o.onDelta }))
    } catch (e) {
      if (!(e && e.extra && e.extra.streamUnsupported)) throw e
      r = await chatCompletion(msgs, reqOpts)
    }
  } else {
    r = await chatCompletion(msgs, reqOpts)
  }

  const obj = extractJSON(r.content)
  const arr = Array.isArray(obj) ? obj : (obj && obj.words)
  if (!Array.isArray(arr) || !arr.length) return { bookName: '', words: [] }

  const seen = new Set()
  const words = []
  arr.forEach(it => {
    if (!it || typeof it !== 'object') return
    const word = String(it.word || it.w || '').trim().toLowerCase()
    const meaning = String(it.meaning || it.m || it.def || '').trim()
    const pos = String(it.pos || '').trim()
    if (!/^[a-z][a-z'-]{1,19}$/.test(word)) return
    if (!meaning || seen.has(word)) return
    seen.add(word)
    words.push({ word, pos, meaning })
  })

  return { bookName: (obj && obj.bookName) || '', words }
}

// opts: { topic 主题, count 数量(1-8000) 或 0/'auto'=不限, level 难度, onProgress 进度回调 }
// onProgress 可以是 async：每轮请求前 await 它，调用方能借此插入「暂停/取消」检查点。
// 返回 { bookName, words, auto, complete, rounds }
export async function generateWordbook(opts) {
  aiFeature('wordbook')
  ensureEnabled()
  const o = opts || {}
  const topic = String(o.topic || '').trim()
  if (!topic) throw new ServiceError('请填写主题', { degradable: true })
  const level = String(o.level || '').trim() || '通用（CEFR A2-B1）'
  const want = normalizeWordCount(o.count)

  // 「不限」= 一直取到模型给不出新词为止；MAX 只是防失控的兜底
  const target = want.auto ? WORDBOOK_COUNT.MAX : want.count
  // o.banned：目标词书里已有的词。它们也算"重复"，会占用额度，
  // 所以轮次预算里再加一份 —— 要 5 个、撞上 2 个已有词 → 继续生成到凑够 5 个新的为止
  // （用户口径：总共生成 7 个，而不是直接少给 2 个）
  const banned = []
  ;(o.banned || []).forEach(w => {
    const k = String(w || '').trim().toLowerCase()
    if (k) banned.push(k)
  })
  const baseRounds = Math.ceil(target / WORDBOOK_COUNT.PER_ROUND) + WORDBOOK_COUNT.TOP_UP_ROUNDS
  const maxRounds = Math.max(1, Math.min(
    WORDBOOK_COUNT.MAX_ROUNDS,
    baseRounds + (banned.length ? baseRounds : 0)
  ))

  const collected = []
  const seen = new Set()
  banned.forEach(w => seen.add(w))
  let dup = 0              // 被判重复丢掉的词数（含词书里已有的）
  let bookName = ''
  let round = 0
  let exhausted = false    // 模型给不出新词了 → 视为该主题已取完
  let streamed = 0         // 本轮流式已收到的字符数（仅展示用）
  let lastStreamNotify = 0

  while (collected.length < target && round < maxRounds) {
    // 显式取消协议：调用方（后台任务）点「停止」时立刻结束抓取，返回已收集的词。
    // 不用异常传递取消 —— onProgress 的异常会被下面的 try/catch 吞掉。
    if (typeof o.shouldStop === 'function' && o.shouldStop()) break
    round++
    if (o.onProgress) {
      // await：让调用方能在"每一轮请求之前"插入暂停 / 取消检查点
      try { await o.onProgress({ got: collected.length, target, round, auto: want.auto, dup }) } catch (e) {}
    }
    const g = await requestWordBatch({
      topic,
      level,
      want: Math.min(WORDBOOK_COUNT.PER_ROUND, target - collected.length),
      // 排除项分两段带：最近生成的（模型容易复读）+ 词书里已有的（别再给），
      // 各截一部分避免把 prompt 撑爆
      exclude: collected.slice(-120).map(w => w.word).concat(banned.slice(-80)),
      // 流式进度：节流后转发给 onProgress（streaming 标记告诉调用方
      // "这只是展示用的心跳，别在这里做暂停/取消闸门"）
      onDelta: (piece) => {
        if (typeof o.onProgress !== 'function') return
        streamed += piece.length
        const now = Date.now()
        if (now - lastStreamNotify < 400) return
        lastStreamNotify = now
        try { o.onProgress({ got: collected.length, target, round, auto: want.auto, dup, streamed: streamed, streaming: true }) } catch (e) {}
      }
    })
    if (g.bookName && !bookName) bookName = g.bookName

    const fresh = g.words.filter(w => !seen.has(w.word))
    // 重复的直接丢掉，额度不减 → while 会继续下一轮补足到 target
    dup += g.words.length - fresh.length
    if (!fresh.length) { exhausted = true; break }
    fresh.forEach(w => { seen.add(w.word); collected.push(w) })
  }

  if (!collected.length) {
    throw new ServiceError('AI 未生成有效单词，请换个主题重试', { degradable: true })
  }

  return {
    bookName: bookName || topic,
    words: collected.slice(0, target),
    auto: want.auto,
    // 不限模式下 exhausted 才代表"真的取完了"，否则是撞到了 MAX 上限
    complete: want.auto ? exhausted : collected.length >= want.count,
    // 查重丢掉的词数：给 UI 解释"为什么模型回了 7 个却只入库 5 个"
    dup,
    rounds: round
  }
}

// ---------- 5. 配置校验 + 连通性测试（设置页用） ----------
// 纯格式校验，不发网络请求。返回 { ok, reason }
export function validateKeyFormat(cfg) {
  const c = cfg || {}
  const url = String(c.baseURL || '').trim()
  const key = String(c.apiKey || '').trim()
  const model = String(c.model || '').trim()
  if (!url) return { ok: false, reason: '未填写 API 地址' }
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, reason: 'API 地址需以 http:// 或 https:// 开头' }
  if (!key) return { ok: false, reason: '未填写 API 密钥' }
  if (/\s/.test(key)) return { ok: false, reason: '密钥不能包含空格' }
  if (key.length < 8) return { ok: false, reason: '密钥长度过短（至少 8 位）' }
  if (!/^[\x21-\x7E]+$/.test(key)) return { ok: false, reason: '密钥含非法字符' }
  if (!model) return { ok: false, reason: '未填写模型名（如 gpt-4o-mini / deepseek-chat）' }
  return { ok: true, reason: '' }
}

// 真实连通性测试：发一条最小请求（max_tokens=8）验证密钥确实可用。
// 不依赖 enabled 开关（设置页可能还没打开总开关），只要有地址+密钥即可测。
// 成功返回 { ok:true, latencyMs, reply }；失败抛 ServiceError（带友好中文原因）。
export async function testAIConnection() {
  const cfg = getAIConfig()
  const fmt = validateKeyFormat(cfg)
  if (!fmt.ok) throw new ServiceError(fmt.reason, { degradable: true, notConfigured: true })
  const url = chatEndpoint(cfg.baseURL)
  const key = breakerKeyOf(url)
  const t0 = Date.now()
  try {
    const res = await request({
      url,
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
      data: {
        model: cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        temperature: 0
      },
      timeout: 12000,
      // 手动"测试连接"必须绕过熔断：正在冷却时用户点测试，
      // 就是想看看现在通不通，被熔断挡掉会显示一个假失败
      force: true
    })
    const data = res && res.data
    const choices = data && data.choices
    if (!choices || !choices.length) {
      throw new ServiceError('接口返回结构异常，请确认地址是 OpenAI 兼容接口', { degradable: true })
    }
    // 测通了说明服务是好的，把之前攒下的失败记录清掉
    resetBreaker(key)
    const reply = ((choices[0] && choices[0].message) || {}).content || ''
    return { ok: true, latencyMs: Date.now() - t0, reply: String(reply).trim().slice(0, 40) }
  } catch (e) {
    const st = e && e.extra && e.extra.status
    let msg
    if (st === 401 || st === 403) msg = '密钥无效或无权限（HTTP ' + st + '）'
    else if (st === 404) msg = '接口地址不正确（HTTP 404）'
    else if (st === 429) msg = '请求过于频繁，稍后重试（HTTP 429）'
    else if (e && e.extra && e.extra.timeout) msg = '连接超时，请检查网络或地址'
    else if (e instanceof ServiceError && e.message.indexOf('HTTP ') === 0) msg = '连接失败（' + e.message + '）'
    else if (e && e.extra && e.extra.notConfigured) msg = e.message
    else msg = '网络错误或地址不可达，请检查配置（浏览器预览还可能受跨域限制）'
    throw new ServiceError(msg, { degradable: true, status: st })
  }
}
