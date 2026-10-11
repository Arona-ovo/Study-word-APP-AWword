// utils/word-polish-mixin.js - 搜索结果「AI 补全多义 + 预判预取」（首页 / 做题页共用）
//
// 要解决的正是用户那句话：
//   「搜索出来的本地已缓存单词，有时候其他意思显示不全，有些一词多义显示不全」
//   词书里一个词只存一条释义，最早那批 AI 缓存也只有一条 —— 界面上就只有一个意思。
//
// 三条约定：
//   1. **只有"显示不全"才补**：缓存里已有 ≥2 个义项就不花 token（补过一次就够，
//      补完写进缓存，之后一直是完整的）
//   2. **补完一定写回缓存**（services/ai-content.js 的 expandWord 里做的），
//      所以同一个词第二次查就是离线直出 —— "本地多缓存一些"就是这么攒出来的
//   3. **顺手多备几个词**（预判预取）：本次搜索结果里排在前面、用户八成要点开的几条，
//      外加模型给的同根 / 搭配词，一次调用一起补，直接落成缓存条目。
//      用户还没查，那几个词已经在本机备好了 —— 查到时直接命中，不用等转圈
//
// 触发时机不是"边打字边补"：停手 POLISH_DELAY 才发，且同一个词一场会话只补一次。
// 另外给一颗手动入口（AI 关着 / 不想等的时候点一下），见模板里 polishAsk 那块。
import * as aiCache from './ai-cache.js'
import { expandWord } from '../services/ai-content.js'
import { t } from './i18n.js'
import * as dict from './dict.js'

// 停手多久才补：比"补生词"那条路（700ms）更晚 —— 补全不是刚需，别抢在打字前面
const POLISH_DELAY = 1200
// 太短的词不补：in / a / on 这种补出来的多半是凑数的义项
const POLISH_MIN_LEN = 3
// 只认字母类单词：中文查询走本地释义匹配，那本来就是它要的
// ⚠️ 别写 /\p{...}/u —— App 端老 JS 引擎不认，会在模块顶层抛 SyntaxError（白屏）
const LATIN_WORD = /^[a-zA-Z][a-zA-Z'-]*$/
// 一场会话里补过的词：补完就写进缓存了，重复补只是白烧 token
const POLISH_DONE = {}
// 预取候选最多带几个（其余交给模型预判）
const ALSO_MAX = 2

/** 一段话里有几个义项：中文按分号/顿号切，英文按分号切 */
function senseCount(text) {
  const s = String(text || '').trim()
  if (!s) return 0
  const parts = s.split(/[；;，,、]|\s+\/\s+/).map(x => String(x || '').trim()).filter(Boolean)
  return Math.max(1, parts.length)
}

export default function wordPolishMixin() {
  return {
    data() {
      return {
        // 补齐回来的完整义项（{ word, pos, senses, examples, others }）
        polish: null,
        polishLoading: false,
        polishTimer: 0
      }
    },
    computed: {
      /**
       * 当前这个词"显示不全"吗 —— 缓存里连两个义项都不到，就值得让 AI 补一次。
       * 补过之后缓存里就是完整条目，这个判定自然变成 false（不会反复烧 token）。
       */
      polishWanted() {
        const w = String(this.lastQuery || '').trim()
        if (!w || !LATIN_WORD.test(w) || w.length < POLISH_MIN_LEN) return false
        if (aiCache.hasFullSenses(w)) return false
        // 界面上现在摆着的义项数（本地命中优先，其次缓存那条）
        const shown = this.shownSenseCount()
        return shown < 2
      },
      /** 预判预取到的词名（给界面一句可见的反馈："顺手备好了 xxx"） */
      polishPrefetched() {
        const o = this.polish && this.polish.others
        return Array.isArray(o) ? o.map(x => String(x.word || '')).filter(Boolean) : []
      },
      /**
       * 拼好的那句"顺手备好了 a · b · c"。
       * 为什么不直接在模板里 `.join(' · ')`（项目约定 9：模板里别放表达式）——
       * 端上编译对模板内方法调用的处理一向不稳，一律先在 computed 里算成字符串。
       */
      polishPrefetchText() {
        return this.polishPrefetched.join(' · ')
      }
    },
    methods: {
      /**
       * 这个词**本机到底存了几个义项**（不是"界面上现在摆了几个"）。
       *
       * 判定要连词典层那份完整义项一起看 —— 搜索列表那一行是背诵卡口径（20 字上限），
       * 只看它会得出"只有 1 个义项"的错误结论，于是一个本地明明有 8 个义项
       * 的词被反复拿去问 AI，白白烧 token。
       */
      shownSenseCount() {
        const q = String(this.lastQuery || '').trim().toLowerCase()
        if (!q) return 0
        let n = 0
        // 检索结果里的精确命中（界面上正摆着的那条）
        const hit = (this.results || []).filter(
          r => String(r.w || '').trim().toLowerCase() === q
        )[0]
        if (hit) n = senseCount(hit.m)
        // 词典层的不截断版本（data/word-senses.js）
        try {
          const full = dict.fullSensesOf(q)
          if (full.length > n) n = full.length
        } catch (e) { /* 词典层不可用就只看检索结果 */ }
        if (n >= 2) return n
        // 本机 AI 缓存里补齐过的义项表
        const c = this.cached
        if (c && String(c.word || '').trim().toLowerCase() === q) {
          const cs = aiCache.sensesOf(q)
          if (cs.length >= 2) return cs.length
          const cm = senseCount(c.meaning)
          return cm > n ? cm : n
        }
        return n
      },
      /**
       * 预判：本次搜索结果里排在前面、还没缓存（或缓存也只有一条）、用户八成要点开的词。
       * 为什么拿"当前结果"当预判依据：用户正盯着这几条，点开的概率远高于任何别的猜测。
       */
      polishCandidates(word) {
        const out = []
        const self = String(word || '').trim().toLowerCase()
        const seen = {}
        if (self) seen[self] = true
        const list = (this.results || []).slice(0, 6)
        for (let i = 0; i < list.length && out.length < ALSO_MAX; i++) {
          const w = String(list[i].w || '').trim()
          if (!w) continue
          const k = w.toLowerCase()
          if (seen[k] || !LATIN_WORD.test(w) || w.length < POLISH_MIN_LEN) continue
          // 已经有完整释义的不再补（那可能是用户自己加过的，别覆盖）
          if (aiCache.hasFullSenses(w)) continue
          seen[k] = true
          out.push(w)
        }
        return out
      },
      /** 换了词 / 收起搜索：把上一轮的补全收干净（定时器也要清，否则会补到新词上） */
      clearPolish() {
        if (this.polishTimer) { clearTimeout(this.polishTimer); this.polishTimer = 0 }
        this.polish = null
        this.polishLoading = false
      },
      /**
       * 排一次补全。和"补生词"那条路分开计时：那条等 700ms，这条等 1200ms ——
       * 补全只是让释义更全，不该抢在用户还在打字的时候发请求。
       */
      schedulePolish(word) {
        if (this.polishTimer) { clearTimeout(this.polishTimer); this.polishTimer = 0 }
        const w = String(word || '').trim()
        if (!this.polishWanted) return
        if (!this.aiEnabled) return
        if (POLISH_DONE[w.toLowerCase()]) return
        this.polishTimer = setTimeout(() => {
          this.polishTimer = 0
          this.aiPolish(w)
        }, POLISH_DELAY)
      },
      /** 手动点「让 AI 补全全部义项」：不等定时器，立刻补 */
      polishNow() {
        const w = String(this.lastQuery || '').trim()
        if (!w) return
        if (!this.aiEnabled) {
          try { uni.showToast({ title: t('接入 AI 后才能补全义项'), icon: 'none' }) } catch (e) {}
          return
        }
        this.aiPolish(w)
      },
      async aiPolish(word) {
        const w = String(word == null ? this.lastQuery : word).trim()
        if (!w) return
        if (this.polishTimer) { clearTimeout(this.polishTimer); this.polishTimer = 0 }
        const k = w.toLowerCase()
        if (POLISH_DONE[k]) return
        POLISH_DONE[k] = true
        this.polishLoading = true
        try {
          const r = await expandWord(w, { also: this.polishCandidates(w) })
          // 回来了但输入框已经换了词 → 这条结果不能贴到界面上（否则张冠李戴）
          if (String(this.lastQuery || '').trim().toLowerCase() !== k) return
          const senses = (r && r.senses) || []
          if (!senses.length) return
          this.polish = {
            word: (r && r.word) || w,
            pos: (r && r.pos) || '',
            senses,
            examples: ((r && r.examples) || []).slice(0, 2),
            others: (r && r.others) || []
          }
        } catch (e) {
          // 补全失败不影响正常搜索：本地那条照旧显示，只是没多出义项
          if (String(this.lastQuery || '').trim().toLowerCase() === k) this.polish = null
        } finally {
          // 不管结果贴没贴上，转圈都得收 —— 换词后还留着转圈，用户会以为这词也卡住了
          this.polishLoading = false
        }
      }
    }
  }
}

export { senseCount }
