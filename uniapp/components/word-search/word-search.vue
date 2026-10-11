<template>
  <view class="ws">
    <!-- 平时就是普通标题栏；点标题或右侧放大镜 → 原地变搜索框（参考不背单词） -->
    <float-navbar
      ref="navbar"
      :title="title"
      :search="active"
      searchable
      :search-locked="locked"
      :autofocus="autofocus"
      keep-keyboard
      :value="keyword"
      :placeholder="$t('搜索单词或中文释义')"
      @input="onInput"
      @search="onSubmit"
      @clear="close"
      @focus="onFocus"
      @blur="onBlur"
      @title-tap="open"
    />

    <!-- 结果就地铺在顶栏下面（和首页同一套行为）：不盖住题目，也不接管返回键 -->
    <view v-if="active" class="card ws-card">
      <view class="ws-head">
        <text class="ws-title">{{ panelTitle }}</text>
        <text class="ws-close" @tap="close">{{ $t('收起') }}</text>
      </view>

      <!-- 刚点开、还没输入：先给"最近查过"（做题中间抬头查的大多是刚才没记住的词） -->
      <block v-if="!lastQuery">
        <search-history ref="history" @pick="onHistoryPick" />
        <view class="ws-state">
          <text class="ws-state-text">{{ $t('输入单词或中文释义，查完接着做题') }}</text>
        </view>
      </block>

      <block v-else>
        <!-- ① 一模一样的那条。
             搜 "in" 时这里出的就是 "in" 本身 —— 词书里没有、但词典里有也算
             （utils/search.js 的词典兜底，不再以"词书零命中"为前提）。
             以前没有这一步：书里"含 in"的词有两百多条，真正的 "in" 一条都没有，
             用户只能在一堆 insurance / engine / criminal 里挑（实测反馈）。 -->
        <view v-for="(it, i) in exactHits" :key="'e' + i" class="ws-item" @tap="openWord(it)">
          <view class="ws-line">
            <text class="ws-word">{{ it.w }}</text>
            <text v-if="it.pos" class="ws-pos">{{ it.pos }}</text>
            <text class="tag ws-src">{{ it.fromText }}</text>
          </view>
          <text class="ws-mean">{{ it.m }}</text>
        </view>

        <!-- ② 本机缓存命中：以前生成过，离线也能看，不花额度、不发请求 -->
        <view v-if="cached" class="ws-item" @tap="openCached">
          <view class="ws-line">
            <text class="ws-word">{{ cached.word }}</text>
            <text v-if="cached.pos" class="ws-pos">{{ cached.pos }}</text>
          </view>
          <text class="ws-mean">{{ cached.meaning }}</text>
          <view v-for="(ex, i) in cached.examples" :key="i" class="ws-ex">
            <text class="ws-ex-en">{{ ex.en }}</text>
            <text class="ws-ex-zh">{{ ex.zh }}</text>
          </view>
          <text class="ws-tip">{{ $t('来自本机缓存，不消耗 AI 额度') }}</text>
        </view>

        <!-- ③ AI 补充：转圈与结果 -->
        <view v-if="aiLoading" class="ws-state">
          <view class="ws-spinner"></view>
          <text class="ws-state-text">{{ $t('正在让 AI 补充这个词…') }}</text>
        </view>

        <view v-if="aiResult" class="ws-item" @tap="openAi">
          <view class="ws-line">
            <text class="ws-word">{{ aiResult.word }}</text>
            <text v-if="aiResult.pos" class="ws-pos">{{ aiResult.pos }}</text>
          </view>
          <text class="ws-mean">{{ aiResult.meaning }}</text>
          <view v-for="(ex, i) in aiResult.examples" :key="i" class="ws-ex">
            <text class="ws-ex-en">{{ ex.en }}</text>
            <text class="ws-ex-zh">{{ ex.zh }}</text>
          </view>
          <text class="ws-tip">{{ $t('点开词条可加入词书') }}</text>
        </view>

        <!-- ③b 查询失败必须看得见（和下面"没找到"是两回事）。
             以前 AI 请求挂了只是让 aiResult 保持 null —— 界面上跟"AI 查不到这个词"一模一样，
             用户既不知道是网络还是配置问题，也不知道还能再点一次（实测反馈）。
             「本地没找到」和「查询失败」是两回事，得分开说。 -->
        <view v-if="aiError" class="ws-state">
          <text class="ws-state-text">{{ aiError }}</text>
          <text class="ws-state-hint">{{ $t('网络恢复后可以直接再试一次') }}</text>
          <view class="ws-actions">
            <text class="ws-act" @tap="retryAi">{{ $t('重试') }}</text>
            <text class="ws-act" @tap="openQuery">{{ $t('手动添加「{q}」', { q: lastQuery }) }}</text>
          </view>
        </view>

        <!-- ③c AI 补全的多义：词书里一个词只存一条释义，老缓存也只有一条
             —— 于是"一词多义显示不全"。补回来的义项逐条列出来，
             expandWord() 已经把它们写进本机缓存 —— 下次再查同一个词，离线也是完整的。 -->
        <view v-if="polishLoading" class="ws-state">
          <view class="ws-spinner"></view>
          <text class="ws-state-text">{{ $t('正在补全这个词的义项…') }}</text>
        </view>
        <view v-else-if="polish" class="ws-polish">
          <view class="ws-line">
            <text class="ws-word">{{ polish.word }}</text>
            <text v-if="polish.pos" class="ws-pos">{{ polish.pos }}</text>
            <text class="tag ws-badge">{{ $t('AI 补全 · {n} 个义项', { n: polish.senses.length }) }}</text>
          </view>
          <view v-for="(s, i) in polish.senses" :key="'sp' + i" class="ws-sense">
            <text class="ws-sense-pos">{{ s.pos }}</text>
            <text class="ws-sense-m">{{ s.meaning }}</text>
          </view>
          <view v-for="(ex, i) in polish.examples" :key="'pe' + i" class="ws-ex">
            <text class="ws-ex-en">{{ ex.en }}</text>
            <text class="ws-ex-zh">{{ ex.zh }}</text>
          </view>
          <!-- 预判预取：顺手把用户接下来最可能查的几个词一起补了、存进缓存 -->
          <text v-if="polishPrefetchText" class="ws-tip">
            {{ $t('顺手备好了：{list}（已存本机缓存）', { list: polishPrefetchText }) }}
          </text>
          <text v-else class="ws-tip">{{ $t('已存入本机缓存，下次离线也能看全') }}</text>
        </view>
        <!-- 还差一次补全（AI 关着 / 不想等定时器）时给个手动入口，别让人干瞪眼 -->
        <view v-else-if="polishWanted" class="ws-state">
          <text class="ws-act" @tap="polishNow">{{ $t('让 AI 补全这个词的全部义项') }}</text>
        </view>

        <!-- ④ 一条精确命中都没有：先把"没有"说清楚，再给两条能走下去的路。
             以前这里什么都没有 —— 没配 AI 的话连转圈都不会出现，
             用户既不知道 "in" 到底有没有，也没有任何办法把它加进来（实测反馈）。 -->
        <view v-if="noExact" class="ws-state">
          <text class="ws-state-text">{{ $t('本地词库没有「{q}」', { q: lastQuery }) }}</text>
          <!-- 第二行按"到底问没问过 AI"分开说 —— 见 aiHint 的注释：
               没问过就不能替 AI 回绝，否则用户只剩"两难"（实测反馈：搜 "en"） -->
          <text class="ws-state-hint">{{ aiHint }}</text>
          <view class="ws-actions">
            <text v-if="aiEnabled" class="ws-act" @tap="retryAi">{{ aiActionText }}</text>
            <text class="ws-act" @tap="openQuery">{{ $t('手动添加「{q}」', { q: lastQuery }) }}</text>
          </view>
        </view>

        <!-- ⑤ 相近的词一律排在最后：用户先看到"有没有一模一样的"，
             再从近似里挑 —— 反过来（先铺一堆近似）就是这次反馈的问题 -->
        <block v-if="nearHits.length">
          <view class="ws-sub">{{ $t('当前词书里相近的词') }}</view>
          <view v-for="(it, i) in visibleNear" :key="'n' + i" class="ws-item" @tap="openWord(it)">
            <view class="ws-line">
              <text class="ws-word">{{ it.w }}</text>
              <text v-if="it.pos" class="ws-pos">{{ it.pos }}</text>
              <text class="tag ws-src">{{ it.fromText }}</text>
            </view>
            <text class="ws-mean">{{ it.m }}</text>
          </view>
          <!-- 近似命中可能几十上百条（搜 "in" 有 268 条）：先只列几条，
               要看全再点开，别一屏全是"含 in 的词" -->
          <text v-if="nearHits.length > visibleNear.length" class="ws-more" @tap="showAllNear">
            {{ $t('再显示 {n} 个', { n: nearHits.length - visibleNear.length }) }}
          </text>
          <text v-else class="ws-tip">{{ $t('点击任意词条查看详情') }}</text>
        </block>
      </block>
    </view>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js'
import * as search from '../../utils/search.js'
import * as aiCache from '../../utils/ai-cache.js'
import { aiGateReason } from '../../services/config.js'
import { explainWord } from '../../services/ai-content.js'
import FloatNavbar from '../float-navbar/float-navbar.vue'
import SearchHistory from '../search-history/search-history.vue'
import * as searchHistory from '../../utils/search-history.js'
import wordPolishMixin from '../../utils/word-polish-mixin.js'

// 打字停下来多久去问 AI（与首页同一节奏；本机缓存命中就不会问）
const AI_DELAY = 700
// 本地最多取几条：这是"做题中间抬头查一眼"，不是词库检索页，取太长会把题目挤没。
// 精确命中永远排第一，后面的都算"相近的"（默认只露 NEAR_SHOW 条）。
const LOCAL_LIMIT = 12
// 「相近的词」默认露几条：搜 "in" 能出两百多条，一屏铺满等于把"没有 in"这个结论淹掉
const NEAR_SHOW = 4
// 同一个词的上一个请求还没回来就别再发一次
const AI_INFLIGHT = new Set()

/**
 * 「做题页顶栏随时查词」（练习 / 刷单词共用）。
 *
 * 为什么不是直接在页面里写个输入框：
 *   · 两页各写一份会有两份行为，改一处漏一处（这两个页面本来就是同一套练习链路）；
 *   · 搜索结果的渲染逻辑与首页同源，放在组件里才不会跟首页越走越远。
 *
 * 门禁不在组件里，由页面通过 locked 传进来：
 *   题答出来之前不让搜 —— 否则等于把答案摆在手边（练习页的确认关尤其危险：
 *   那一关考的就是目标词的意思）。答完（对错都算）才放行。
 */
export default {
  name: 'WordSearch',
  components: { FloatNavbar, SearchHistory },
  // 与首页同一份"AI 补全多义 + 预判预取"逻辑：做题中间抬头查词，
  // 看到的同样只有词书里那一条释义，一样要说全（utils/word-polish-mixin.js）
  mixins: [wordPolishMixin()],
  props: {
    // 没进搜索态时显示的标题（与页面上原来的顶栏标题一致）
    title: { type: String, default: '' },
    // 搜索范围：一般传当前词书的 id
    bookId: { type: String, default: '' },
    // 现在能不能搜（页面判定：本题是否已经出结果）
    locked: { type: Boolean, default: false },
    // 锁着的时候点它给的解释（不说清楚，用户只会以为顶栏坏了）
    lockHint: { type: String, default: '' }
  },
  data() {
    return {
      active: false,          // 是否处在搜索态
      keyword: '',
      lastQuery: '',          // 已经查过的词（AI 回来时用来防串词）
      results: [],
      cached: null,
      aiResult: null,
      aiLoading: false,
      autofocus: false,       // 打开搜索时把输入框抢过来（弹键盘）
      aiEnabled: false,
      aiError: '',            // AI 查询失败的原因（给人看的那句；原始错误只进 console）
      aiTried: false,         // 这一轮**问过** AI 吗（决定"没找到"那块该说什么，见 aiHint）
      nearAll: false,         // 「相近的词」是否已展开全部
      timer: 0
    }
  },
  computed: {
    // 顶栏标题：有精确命中就说"搜索结果"；只有相近的必须讲明白，
    // 否则用户会以为"这几条里就有我要查的词"（与首页 searchTitle 同一口径）
    panelTitle() {
      if (!this.lastQuery) return t('查词')
      if (this.exactHits.length) return t('搜索结果')
      if (this.nearHits.length) return t('没有完全匹配 · 下面 {n} 条是相近的', { n: this.nearHits.length })
      return t('搜索结果')
    },

    // 和查询词**一模一样**的那条（大小写不敏感）。
    // localSearch 是包含匹配（搜 run 会出 running / runs），
    // 只有这里为空才算"没查到" —— 该继续看缓存 / 问 AI / 让人手动加。
    exactHits() {
      const q = String(this.lastQuery || '').trim().toLowerCase()
      if (!q) return []
      return (this.results || []).filter(function (r) {
        return String(r.w || '').trim().toLowerCase() === q
      })
    },
    nearHits() {
      const q = String(this.lastQuery || '').trim().toLowerCase()
      if (!q) return []
      return (this.results || []).filter(function (r) {
        return String(r.w || '').trim().toLowerCase() !== q
      })
    },
    visibleNear() {
      return this.nearAll ? this.nearHits : this.nearHits.slice(0, NEAR_SHOW)
    },

    /**
     * 「没找到」那块的第二行到底该说什么 —— 原则是**不许替 AI 撒谎**。
     *
     * 打字过程中的 AI 补充是被防抖推迟的（停手 700ms 才发），而且 aiLookup 自己也有一道
     * 「至少要有字母或汉字」的闸 —— 也就是说，"界面上写着没找到"的时候 AI 不一定真的被问过。
     * 以前一律写「AI 也未能补充这个词」—— 等于替 AI 回绝了一件它没做过的事，
     * 用户看到"AI 也不显示、缓存也没有"，就彻底没有下一步了（实测反馈）。
     *
     * 现在按四种情况分开说：没接 AI / 真问过了 / 只列出相近的 / 本地确实没有。
     */
    aiHint() {
      void this.__lang
      if (!this.aiEnabled) return t('接入 AI 后，搜不到的词会自动补充到本机缓存')
      if (this.aiTried) return t('AI 也没查到这个词，换个拼写试试')
      if (this.nearHits.length) {
        return t('上面 {n} 条只是相近的词，都不是「{q}」本身', { n: this.nearHits.length, q: this.lastQuery })
      }
      return t('本地没有这个词条，可以让 AI 查一下')
    },
    /** 那个按钮写什么：没问过 = 让 AI 查一下；问过了 = 再问一次 */
    aiActionText() {
      void this.__lang
      return this.aiTried ? t('再问一次') : t('让 AI 查一下')
    },
    // 一条精确命中都没有、缓存和 AI 也没给东西 → 显示"没有"+ 两条出路。
    // 别把 AI 的转圈/结果吞掉：那两样都在的时候用户马上就有答案了。
    // timer 也算"在路上"：打字后要等 700ms 才发请求，这段空窗期说"AI 也未能补充"
    // 是在撒谎（还没问呢），而且会先闪一句"没有"再被结果顶掉。
    // aiError 另算一种结局：那是"没查成"，不是"没查到"（单独的失败块已经说清楚了）。
    noExact() {
      return !!this.lastQuery && !this.exactHits.length && !this.aiError &&
        !this.cached && !this.aiLoading && !this.aiResult && !this.timer
    }
  },
  created() {
    this.refreshAi()
  },
  methods: {
    refreshAi() {
      try { this.aiEnabled = !aiGateReason() } catch (e) { this.aiEnabled = false }
    },

    /** 点标题 / 放大镜：锁着就解释一句，能搜就进入搜索态并把键盘叫出来 */
    open() {
      if (this.locked) {
        uni.showToast({ title: this.lockHint || t('答完这题就能查词'), icon: 'none' })
        return
      }
      this.refreshAi()
      if (this.active) {
        // 已经开着：把焦点抢回来（键盘被点掉之后还能再点一下继续输）
        this.autofocus = false
        this.$nextTick(() => { this.autofocus = true })
        return
      }
      this.active = true
      this.autofocus = true
    },

    onFocus() { this.autofocus = true },
    onBlur() { this.autofocus = false },

    /** 让历史组件重读一次（记了新的一笔之后同步过来） */
    refreshHistory() {
      const h = this.$refs && this.$refs.history
      if (h && typeof h.refresh === 'function') h.refresh()
    },

    /**
     * 记一笔搜索历史：只在"回车提交 / 点开某条结果"这两处记 ——
     * 边打字边记会把 ru / runn 这些半成品灌进来。
     */
    rememberSearch(w) {
      const word = String(w == null ? '' : w).trim()
      if (!word) return
      try { searchHistory.add(word) } catch (e) { /* 存不进去不影响查词本身 */ }
      this.refreshHistory()
    },

    /** 点历史里的词：直接拿它去搜（省得再拼一遍拼写） */
    onHistoryPick(w) {
      const word = String(w == null ? '' : w).trim()
      if (!word) return
      this.onInput(word)
    },

    /** 输入变化：本地先查，够不着再等 AI（与首页同一条判定链） */
    onInput(v) {
      const kw = String(v == null ? '' : v).trim()
      this.keyword = kw
      if (this.timer) { clearTimeout(this.timer); this.timer = 0 }
      // 换了词就得把上一轮的补全收干净（连定时器一起，否则会补到新词上）
      this.clearPolish()
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.aiError = ''
      this.aiTried = false   // 换了词 = 新一轮，"这一轮问过 AI 吗"得重新开始记
      this.nearAll = false
      if (!kw) {
        this.lastQuery = ''
        this.results = []
        return
      }
      this.lastQuery = kw
      this.results = search.localSearch(this.bookId, kw, LOCAL_LIMIT)
      // 本地命中里有没有**一模一样**的那个词？（exactHits 就是这件事）
      // 只有近似命中时不能认为"查到了"，得继续看缓存 / 问 AI。
      this.cached = this.exactHits.length ? null : this.cacheHitFor(kw)
      if (!this.exactHits.length && !this.cached && this.aiEnabled) {
        this.timer = setTimeout(() => { this.aiLookup(kw) }, AI_DELAY)
      }
      // 本地/缓存释义只有一条的话，停手一会儿让 AI 把全部义项补上（并写回缓存）
      this.schedulePolish(kw)
    },

    /**
     * 回车（顶栏 confirm）。
     * 以前直接挂在 onInput 上 —— 按回车等于把同样的检索再跑一遍，
     * 界面一点变化都没有，用户只会觉得"回车是坏的"（实测反馈）。
     * 现在给一个明确动作：有那个词就进词条页，没有就立刻去问 AI（不等 700ms），
     * AI 也没接就直说 —— 反正不让这一下白按。
     */
    onSubmit(v) {
      const kw = String(v == null || v === '' ? this.keyword : v).trim()
      if (!kw) return
      // 端上 confirm 事件有时不带 value：值还没同步过来的话先按输入走一遍
      if (kw !== this.keyword) { this.onInput(kw); return }
      if (this.timer) { clearTimeout(this.timer); this.timer = 0 }
      this.rememberSearch(kw)   // 回车 = 明确的"我要查这个"
      const hit = this.exactHits[0]
      if (hit) { this.openWord(hit); return }
      if (this.aiResult) { this.openWord({ w: this.aiResult.word }); return }
      if (this.cached) { this.openWord({ w: this.cached.word }); return }
      if (this.aiEnabled) { this.aiLookup(kw); return }
      uni.showToast({ title: t('未接入 AI，可在词条页自己填释义'), icon: 'none' })
    },

    // 本机缓存命中：把以前生成过的释义原样翻出来，不联网
    cacheHitFor(kw) {
      try {
        const w = aiCache.findWord(kw)
        if (!w) return null
        return {
          word: w.word,
          pos: String(w.pos || '').trim().toLowerCase() === 'sentence' ? '' : (w.pos || ''),
          meaning: w.meaning || '',
          // 补全过的词这里带着完整义项：[{ pos, meaning }, ...]；没补过就是 []
          senses: aiCache.sensesOf(w.word),
          examples: aiCache.sentencesOf(w.word).slice(0, 3).map(function (s) {
            return { en: s.en, zh: s.zh }
          })
        }
      } catch (e) {
        return null
      }
    },

    // AI 兜底：只展示、只进本机缓存，绝不自动写进词书（收不收由用户在词条页决定）
    async aiLookup(kw) {
      const q = String(kw || '').trim()
      // 至少要有个字母或汉字：标点、乱码不值得花一次请求
      if (!q || !/[a-zA-Z\u4e00-\u9fa5]/.test(q)) return
      if (!this.aiEnabled) return
      const key = q.toLowerCase()
      if (AI_INFLIGHT.has(key)) return
      AI_INFLIGHT.add(key)
      this.aiLoading = true
      this.aiResult = null
      this.aiError = ''
      // 记下"这一轮真的问过 AI"：不管回来的是结果、空手还是报错，
      // 「没找到」那块都得改口（不能一直说"可以让 AI 查一下"，那会变成鬼打墙）
      this.aiTried = true
      try {
        const r = await explainWord(q)
        const meaning = (r && r.meaningZh) || ''
        // 模型没给出释义 ≠ 查询失败：那是"AI 也不知道这个词"，该走"没找到"那条路。
        // 以前这两种情况混在一起，网络一抖和"确实查无此词"长得一模一样。
        if (!meaning) {
          if (this.isCurrentQuery(q)) { this.aiResult = null; this.aiError = '' }
          return
        }
        // 回来时用户可能已经改了输入：这条结果不能贴到界面上
        if (!this.isCurrentQuery(q)) return
        this.aiResult = {
          word: (r && r.word) || q,
          pos: (r && r.pos) || '',
          meaning: meaning,
          examples: (r && r.examples) || []
        }
      } catch (e) {
        // 「没查到」和「没查成」必须分开：以前失败只把 aiResult 置空，
        // 界面上和"AI 也不知道这个词"长得一样，用户连再试一次的入口都没有。
        if (this.isCurrentQuery(q)) {
          this.aiResult = null
          this.aiError = t('AI 查询失败，检查一下网络')
        }
        // 原始错误（含接口细节）只进 console，不摆到用户面前
        console.warn('[word-search] aiLookup failed:', e && e.message)
      } finally {
        AI_INFLIGHT.delete(key)
        if (this.isCurrentQuery(q)) this.aiLoading = false
      }
    },

    isCurrentQuery(q) {
      return String(this.lastQuery || '').trim().toLowerCase() === String(q || '').trim().toLowerCase()
    },

    /** 收起搜索（输入框也一起失焦，顶栏还原成标题） */
    close() {
      if (this.timer) { clearTimeout(this.timer); this.timer = 0 }
      const nb = this.$refs && this.$refs.navbar
      if (nb && nb.blurInput) nb.blurInput()
      this.active = false
      this.autofocus = false
      this.keyword = ''
      this.lastQuery = ''
      this.results = []
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.aiError = ''
      this.aiTried = false
      this.nearAll = false
      this.clearPolish()
    },

    /** 页面 onShow 调它：从词条页回来的话，别让搜索面板还挂在那儿 */
    collapse() {
      if (this.active) this.close()
    },

    /**
     * 「AI 查一下」：按钮上直接传 lastQuery 是模板里的函数调用，
     * 端上编译不稳（见项目约定 9：模板里一律别写表达式）→ 收到方法里来。
     */
    retryAi() {
      if (!this.lastQuery) return
      this.aiLookup(this.lastQuery)
    },

    /** 铺开全部"相近的词"（默认只露 4 条，免得一屏全是"含 in 的词"） */
    showAllNear() {
      this.nearAll = true
    },

    /** 「没有这个词」时的出路：带着当前查的词进词条页，自己填释义后加入词书 */
    openQuery() {
      this.openWord({ w: this.lastQuery })
    },

    // 缓存 / AI 那两张卡也能点开进词条页。
    // 模板里写成 openWord({ w: cached.word }) 这种对象字面量在端上编译不稳
    // （项目约定 9：模板里别放表达式）→ 一律收进方法。
    openCached() {
      if (this.cached) this.openWord({ w: this.cached.word })
    },
    openAi() {
      if (this.aiResult) this.openWord({ w: this.aiResult.word })
    },

    // 结果 → 单词详情（与首页 openWord 同一个页面、同一套参数）
    openWord(it) {
      const w = String((it && it.w) || '').trim().toLowerCase()
      if (!w) return
      // 查到了还点进去看 → 记一笔，下次不用重新拼拼写
      this.rememberSearch(w)
      uni.navigateTo({
        url: '/pkgManage/pages/word-detail/word-detail?w=' + encodeURIComponent(w) +
          '&book=' + encodeURIComponent(String(this.bookId || ''))
      })
    }
  }
}
</script>

<style scoped>
.ws-card {
  margin-bottom: 20rpx;
  padding: 22rpx 24rpx 18rpx;
}

.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.ws-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ws-close {
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 6rpx 8rpx;
}

.ws-item {
  padding: 16rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}

.ws-item:active { opacity: 0.6; }

/* AI 补全的义项表：与缓存/AI 那两张卡是并列的一块，
   加一道上边线，别让用户以为这几条义项是上面那条词自带的 */
.ws-polish {
  padding: 16rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.06);
  border-top: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}

.ws-badge { margin-left: 12rpx; }

.ws-sense {
  display: flex;
  align-items: baseline;
  margin-top: 8rpx;
}

.ws-sense-pos {
  flex-shrink: 0;
  width: 76rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ws-sense-m {
  flex: 1;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.ws-line {
  display: flex;
  align-items: center;
}

.ws-word {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
}

.ws-pos {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ws-src { margin-left: 12rpx; }

.ws-mean {
  display: block;
  margin-top: 6rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.ws-ex { display: block; margin-top: 8rpx; }

.ws-ex-en {
  display: block;
  font-size: 24rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
}

.ws-ex-zh {
  display: block;
  margin-top: 2rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ws-tip {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ws-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26rpx 10rpx 18rpx;
}

.ws-state-text {
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  text-align: center;
}

.ws-state-hint {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

/* 「当前词书里相近的词」小标题：把"这些只是相近的"写在列表头上，
   否则用户会以为里面就有他要查的那个词 */
.ws-sub {
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 相近命中一屏放不下时的展开入口 */
.ws-more {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

/* 「没有这个词」下面的两条出路：AI 查一下 / 手动添加 */
.ws-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12rpx;
}

.ws-act {
  margin: 0 12rpx;
  padding: 8rpx 14rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.ws-act:active { opacity: 0.55; }

.ws-spinner {
  width: 32rpx;
  height: 32rpx;
  margin-bottom: 12rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid var(--hairline, rgba(23, 32, 26, 0.12));
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: ws-rotate 0.9s linear infinite;
}

@keyframes ws-rotate {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ws-spinner { animation: none; }
}
</style>
