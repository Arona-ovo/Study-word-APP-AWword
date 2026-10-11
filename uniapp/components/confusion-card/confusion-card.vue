<template>
  <view class="cc-mask" v-if="show" @tap="onMaskTap">
    <view class="cc-card" @tap.stop="noop">
      <!-- 顶部：两个词并排，先把"谁是谁"钉死 -->
      <view class="cc-head">
        <text class="cc-kicker">{{ $t('易混词') }}</text>
        <text class="cc-title">{{ $t('这两个词你又搞混了') }}</text>
      </view>

      <view class="cc-pair">
        <view class="cc-side">
          <text class="cc-word">{{ sideA.word }}</text>
          <text v-if="sideA.pos" class="cc-pos">{{ sideA.pos }}</text>
          <text class="cc-mean">{{ sideA.meaning }}</text>
          <text class="cc-flag">{{ $t('该用的') }}</text>
        </view>
        <view class="cc-vs">
          <text class="cc-vs-x">✕</text>
        </view>
        <view class="cc-side">
          <text class="cc-word">{{ sideB.word }}</text>
          <text v-if="sideB.pos" class="cc-pos">{{ sideB.pos }}</text>
          <text class="cc-mean">{{ sideB.meaning }}</text>
          <text class="cc-flag alt">{{ $t('你写成的') }}</text>
        </view>
      </view>

      <!-- 讲的部分：缓存命中是本地直出，没命中才去问一次模型 -->
      <scroll-view scroll-y class="cc-scroll">
        <view v-if="loading" class="cc-load">
          <view class="cc-spin"></view>
          <text class="cc-load-text">{{ $t('正在讲清这两个词…') }}</text>
        </view>

        <view v-else-if="errText" class="cc-err">
          <text class="cc-err-text">{{ errText }}</text>
        </view>

        <block v-else-if="teach">
          <view v-if="teach.diff" class="cc-sec">
            <text class="cc-label">{{ $t('核心区别') }}</text>
            <text class="cc-body">{{ teach.diff }}</text>
          </view>
          <view v-if="teach.tips" class="cc-sec">
            <text class="cc-label">{{ $t('怎么记住') }}</text>
            <text class="cc-body">{{ teach.tips }}</text>
          </view>
          <view v-if="exList.length" class="cc-sec">
            <text class="cc-label">{{ $t('例句') }}</text>
            <view v-for="(ex, i) in exList" :key="i" class="cc-ex">
              <text class="cc-ex-en">{{ ex.en }}</text>
              <text class="cc-ex-zh">{{ ex.zh }}</text>
              <text class="cc-ex-tag">{{ ex.useText }}</text>
            </view>
          </view>
        </block>
      </scroll-view>

      <view class="cc-foot">
        <text v-if="timesText" class="cc-times">{{ timesText }}</text>
        <view class="cc-btn" @tap="onNext">
          <text class="cc-btn-text">{{ $t('下一个') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// components/confusion-card - 易混词教学卡
//
// 职责边界很清楚：
//   · **要不要弹**由 utils/confusion.js 本地算（错够几次才算"经常搞混"），本组件不判断
//   · **讲什么**由 services/ai-content.js 的 explainConfusion() 生成
//   · 本组件只负责：先把两个词摆出来 → 取讲解（优先本地缓存）→ 展示 → 点「下一个」交还页面
//
// 缓存：讲过一次就存在 confusion 的记里（markTaught），同一对下次本地直出，不重复烧 token。
import { t } from '../../utils/i18n.js'
import * as confusion from '../../utils/confusion.js'
import { explainConfusion } from '../../services/ai-content.js'

export default {
  name: 'ConfusionCard',
  props: {
    show: { type: Boolean, default: false },
    // a = 本该写 / 选的那个词；b = 实际搞成的那个词
    a: { type: String, default: '' },
    b: { type: String, default: '' },
    posA: { type: String, default: '' },
    posB: { type: String, default: '' },
    meaningA: { type: String, default: '' },
    meaningB: { type: String, default: '' },
    // 本地账上这一对错了几次（只是给用户看一句"你已经错了 N 次"）
    times: { type: Number, default: 0 },
    // 每次弹 +1：同一对连续弹时 show 可能没变（true→true），靠它兜底触发重载
    seq: { type: Number, default: 0 }
  },
  data() {
    return { loading: false, err: '', teach: null }
  },
  computed: {
    sideA() { return this.side('a') },
    sideB() { return this.side('b') },
    // 例句：AI 给两条（一个用 a、一个用 b），标清楚这条在演示哪个词
    exList() {
      const ta = this.teach
      if (!ta || !ta.examples) return []
      return ta.examples.map(e => ({
        en: e.en || '',
        zh: e.zh || '',
        useText: t('这里用 {w}', { w: e.use === 'b' ? this.b : this.a })
      }))
    },
    errText() {
      if (!this.err) return ''
      if (this.err === 'no-ai') return t('AI 没启用或这项被关了，先把两个词的释义看清 —— 打开后这里会讲清区别')
      return this.err
    },
    timesText() {
      const n = Number(this.times) || 0
      if (n < 2) return ''
      return t('这一对你已经错了 {n} 次', { n: n })
    }
  },
  watch: {
    show(v) { if (v) this.load() },
    seq() { if (this.show) this.load() }
  },
  methods: {
    noop() {},
    // 词 + 词性 + 释义：AI 讲过了就用 AI 的，否则退回本地词书里那一条
    side(k) {
      const ta = this.teach
      const isA = k === 'a'
      const local = { word: isA ? this.a : this.b, pos: isA ? this.posA : this.posB, meaning: isA ? this.meaningA : this.meaningB }
      const got = ta && (isA ? ta.a : ta.b)
      if (!got) return { word: local.word, pos: local.pos, meaning: local.meaning || t('（本地暂无释义）') }
      return {
        word: local.word,
        pos: String(got.pos || local.pos || ''),
        meaning: String(got.meaning || local.meaning || '')
      }
    },
    async load() {
      this.err = ''
      const a = String(this.a || '').trim()
      const b = String(this.b || '').trim()
      if (!a || !b) { this.teach = null; return }
      // ① 本地缓存：同一对讲过一次就够，不反复烧 token
      const cached = confusion.teachOf(a, b)
      if (cached) { this.loading = false; this.teach = cached; return }
      // ② 没缓存才问模型
      this.loading = true
      this.teach = null
      try {
        const r = await explainConfusion(a, b, { meaningA: this.meaningA, meaningB: this.meaningB })
        this.teach = r
        this.loading = false
        // 存进本地账：下次直接出，也顺带把"教过了"记上（再错 REPEAT 次才会再讲）
        confusion.markTaught(a, b, r)
      } catch (e) {
        this.loading = false
        this.teach = null
        // notConfigured 覆盖两种：AI 没启用、或「易混词辨析」这项被关。
        // 这两类和"调了但失败"（网络 / 额度 / 熔断）要分开说，否则用户会以为 App 坏了。
        this.err = (e && e.notConfigured) ? 'no-ai' : String((e && e.message) || t('讲解没拿到，先记住上面两个释义'))
        console.error('[confusion-card]', e)
      }
    },
    onMaskTap() { this.$emit('close') },
    onNext() { this.$emit('next') }
  }
}
</script>

<style scoped>
/* 不用全局的 .pop-mask/.pop-card：那套是 76% 宽的小卡片，
   这里要放两个词 + 区别 + 记法 + 例句，得宽一点、能滚。 */
.cc-mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(23, 32, 26, 0.46);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.46);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 比 App.vue 的 .pop-mask(100) 高，压住页面上可能同时开着的点读弹窗 */
  z-index: 140;
}

.cc-card {
  width: 86%;
  max-height: 82%;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.9);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.9);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
  border-radius: 32rpx;
  padding: 36rpx 32rpx 28rpx;
  box-shadow: 0 20rpx 60rpx rgba(23, 32, 26, 0.18);
  box-shadow: 0 20rpx 60rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.18);
}

.cc-head { text-align: center; }

.cc-kicker {
  display: inline-block;
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 18rpx;
}

.cc-title {
  display: block;
  margin-top: 14rpx;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* 两个词并排：一眼看清"该用的"和"写成它的那个" */
.cc-pair {
  margin-top: 28rpx;
  display: flex;
  align-items: stretch;
}

.cc-side {
  flex: 1;
  min-width: 0;
  padding: 20rpx 14rpx;
  border-radius: 20rpx;
  background: rgba(128, 128, 128, 0.08);
  text-align: center;
}

.cc-vs { width: 56rpx; display: flex; align-items: center; justify-content: center; }

.cc-vs-x { font-size: 26rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.cc-word {
  display: block;
  font-size: 38rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.cc-pos {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cc-mean {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cc-flag {
  display: inline-block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.cc-flag.alt { color: #c2410c; }

.cc-scroll { margin-top: 24rpx; max-height: 620rpx; }

.cc-load { padding: 40rpx 0; text-align: center; }

.cc-spin {
  width: 48rpx;
  height: 48rpx;
  margin: 0 auto;
  border-radius: 50%;
  border: 6rpx solid #dfe6f5;
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: cc-rot 0.9s linear infinite;
}

@keyframes cc-rot { to { transform: rotate(360deg); } }

.cc-load-text {
  display: block;
  margin-top: 18rpx;
  font-size: 25rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cc-err { padding: 16rpx 4rpx; }

.cc-err-text {
  font-size: 25rpx;
  line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cc-sec { margin-bottom: 22rpx; }

.cc-label {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cc-body {
  display: block;
  margin-top: 8rpx;
  font-size: 27rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cc-ex {
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  background: rgba(128, 128, 128, 0.08);
}

.cc-ex-en {
  display: block;
  font-size: 27rpx;
  line-height: 1.5;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.cc-ex-zh {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cc-ex-tag {
  display: inline-block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.cc-foot { margin-top: 8rpx; text-align: center; }

.cc-times {
  display: block;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cc-btn {
  margin-top: 18rpx;
  height: 84rpx;
  border-radius: 999rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cc-btn:active { opacity: 0.86; }

.cc-btn-text { font-size: 30rpx; font-weight: 600; color: #fff; }
</style>
