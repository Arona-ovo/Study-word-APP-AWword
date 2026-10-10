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
      @search="onInput"
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

      <!-- 刚点开、还没输入 -->
      <view v-if="!lastQuery" class="ws-state">
        <text class="ws-state-text">{{ $t('输入单词或中文释义，查完接着做题') }}</text>
      </view>

      <block v-else>
        <!-- 本地命中（当前词书优先，含"相近的"：搜 run 会出 running / runs） -->
        <block v-if="results.length">
          <view v-for="(it, i) in results" :key="i" class="ws-item" @tap="openWord(it)">
            <view class="ws-line">
              <text class="ws-word">{{ it.w }}</text>
              <text v-if="it.pos" class="ws-pos">{{ it.pos }}</text>
              <text class="tag ws-src">{{ it.fromText }}</text>
            </view>
            <text class="ws-mean">{{ it.m }}</text>
          </view>
          <text class="ws-tip">{{ $t('点击任意词条查看详情') }}</text>
        </block>

        <!-- 本机缓存命中：以前生成过，离线也能看，不花额度、不发请求 -->
        <view v-if="cached" class="ws-item" @tap="openWord({ w: cached.word })">
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

        <view v-if="aiLoading" class="ws-state">
          <view class="ws-spinner"></view>
          <text class="ws-state-text">{{ $t('正在让 AI 补充这个词…') }}</text>
        </view>

        <view v-if="aiResult" class="ws-item" @tap="openWord({ w: aiResult.word })">
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

        <!-- 本地一条都没有、缓存和 AI 也给不出东西 -->
        <view v-if="emptyState" class="ws-state">
          <text class="ws-state-text">{{ $t('本地词库没有「{q}」', { q: lastQuery }) }}</text>
          <text class="ws-state-hint">{{ aiEnabled ? $t('AI 也未能补充这个词，换个拼写试试') : $t('接入 AI 后，搜不到的词会自动补充到本机缓存') }}</text>
        </view>
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

// 打字停下来多久去问 AI（与首页同一节奏；本机缓存命中就不会问）
const AI_DELAY = 700
// 本地最多列几条：这是"做题中间抬头查一眼"，不是词库检索页，列太长会把题目挤没
const LOCAL_LIMIT = 8
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
  components: { FloatNavbar },
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
      timer: 0
    }
  },
  computed: {
    panelTitle() {
      return this.lastQuery ? t('搜索结果') : t('查词')
    },
    // 「什么都没找到」只在真的全空时出现，别把 AI 的转圈/结果吞掉
    emptyState() {
      return !!this.lastQuery && !this.results.length &&
        !this.cached && !this.aiLoading && !this.aiResult
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

    /** 输入变化：本地先查，够不着再等 AI（与首页同一条判定链） */
    onInput(v) {
      const kw = String(v == null ? '' : v).trim()
      this.keyword = kw
      if (this.timer) { clearTimeout(this.timer); this.timer = 0 }
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      if (!kw) {
        this.lastQuery = ''
        this.results = []
        return
      }
      this.lastQuery = kw
      this.results = search.localSearch(this.bookId, kw, LOCAL_LIMIT)
      // 本地命中里有没有**一模一样**的那个词？localSearch 是包含匹配（搜 run 会出
      // running / runs），只有近似命中时不能认为"查到了"，得继续看缓存 / 问 AI。
      const exact = this.results.some(function (r) {
        return String(r.w || '').trim().toLowerCase() === kw.toLowerCase()
      })
      this.cached = exact ? null : this.cacheHitFor(kw)
      if (!exact && !this.cached && this.aiEnabled) {
        this.timer = setTimeout(() => { this.aiLookup(kw) }, AI_DELAY)
      }
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
      try {
        const r = await explainWord(q)
        const meaning = (r && r.meaningZh) || ''
        if (!meaning) throw new Error('empty')
        // 回来时用户可能已经改了输入：这条结果不能贴到界面上
        if (!this.isCurrentQuery(q)) return
        this.aiResult = {
          word: (r && r.word) || q,
          pos: (r && r.pos) || '',
          meaning: meaning,
          examples: (r && r.examples) || []
        }
      } catch (e) {
        if (this.isCurrentQuery(q)) this.aiResult = null
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
    },

    /** 页面 onShow 调它：从词条页回来的话，别让搜索面板还挂在那儿 */
    collapse() {
      if (this.active) this.close()
    },

    // 结果 → 单词详情（与首页 openWord 同一个页面、同一套参数）
    openWord(it) {
      const w = String((it && it.w) || '').trim().toLowerCase()
      if (!w) return
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
