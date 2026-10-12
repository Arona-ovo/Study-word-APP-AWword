<template>
  <view class="cover" :class="appTheme" :style="appBgStyle" @tap="enter">
    <view class="deco deco-1"></view>
    <view class="deco deco-2"></view>
    <view class="deco deco-3"></view>

    <view class="stage">
      <view class="ring"></view>
      <view class="mascot-wrap">
        <!-- 底层：与原生启动图同一张脸，保证 splash 淡出时看不出换图 -->
        <image class="mascot" :src="baseSrc" mode="aspectFill" />
        <!-- 上层：按学习状态选的表情，解码完成后淡入盖住底层（直接换 src 是硬切） -->
        <image
          class="mascot mascot-mood"
          :class="{ show: moodShown }"
          :src="moodSrc"
          mode="aspectFill"
          @load="onMoodLoad"
        />
      </view>
    </view>

    <view class="brand">
      <view class="app-name anim" style="animation-delay:.25s">ENGLISH TRAINER</view>
      <view class="divider anim" style="animation-delay:.55s"></view>
      <view class="app-en anim" style="animation-delay:.75s">FUJIAN · TRANSLATION PRACTICE</view>
    </view>

    <view class="footer anim" style="animation-delay:1s">
      <view class="load-track"><view class="load-fill"></view></view>
      <view class="hint">TAP TO START</view>
    </view>
  </view>
</template>

<script>
import { history, streak, overview, dateStr } from '../../utils/engine.js'

// 启动页阿罗娜表情：按学习状态选图（static/mascot/ 下同构图不同表情）
const MASCOTS = {
  none: '/static/mascot/arona-none.jpg',      // 无嘴待机脸：底层默认（见 BASE_MOOD）
  smile: '/static/mascot/arona-smile.jpg',    // 今天练过 → 开心笑
  tongue: '/static/mascot/arona-tongue.jpg',  // 今天全对 / 连击满 7 天 → 吐舌庆祝
  hi: '/static/mascot/arona-hi.jpg',          // 初次见面 / 连击未断等你来 → 惊讶 o 嘴
  nervous: '/static/mascot/arona-nervous.jpg',// 连击未断但错题积压多 → 紧张波浪嘴
  sad: '/static/mascot/arona-sad.jpg',        // 断签 1-2 天 → 委屈扁嘴
  angry: '/static/mascot/arona-angry.jpg',    // 断签 3-13 天 → 生气
  shocked: '/static/mascot/arona-shocked.jpg' // 断签 14 天以上 → 震惊
}

// 底层默认那张脸（**无嘴**待机版）：圆圈浮现时先是无嘴，之后状态表情淡入盖上来
// —— 无嘴 → 有嘴的过渡只有嘴部在动，视觉最自然（七种状态表情全都有嘴，
//     所以任何状态下都会走淡入，不存在"两层同图"）。
// ⚠️ 原生启动图（static/splash/*.9.png）现在**只画渐变背景、不画任何图案**（_tools/gen-splash.py）：
//    .9.png 的图案是固定像素、cover 是 rpx 布局，屏幕一宽圆圈必然错位（用户实测"跳一下"）。
//    所以圆圈/脸/文字全部由本页绘制：圆圈 stageIn 浮现 → 表情淡入。
const BASE_MOOD = 'none'

const AUTO_ENTER_MS = 2400   // 自动进入首页（与底部进度条动画同步）
const SWAP_DELAY_MS = 900    // 换脸时机：等开场文字动画（0.25s~1s）走完再换
const FADE_MS = 600          // 交叉淡入时长（与样式 .mascot-mood 的 transition 一致）
const LOAD_FALLBACK_MS = 400 // @load 没来时的兜底（缓存命中可能不触发）

export default {
  data() {
    return {
      baseSrc: MASCOTS[BASE_MOOD],
      moodSrc: MASCOTS[BASE_MOOD], // 先与底层同图（避免空 src），需要换时才改
      moodShown: false,
      moodLoaded: false,
      swapReady: false
    }
  },
  onLoad() {
    // ⚠️ 首帧必须是底层那张（= 原生启动图），表情只能**淡入**，
    //    不能在 onLoad 里直接改掉 src —— 那会让用户看到"圆圈里跳了两张脸"。
    this.moodSrc = MASCOTS[this.pickMood()] || MASCOTS[BASE_MOOD]
    if (this.moodSrc === this.baseSrc) {
      this.moodShown = true // 表情正好就是底层那张：不必淡入
    }
    this._swapTimer = setTimeout(() => {
      this.swapReady = true
      this.maybeShowMood()
    }, SWAP_DELAY_MS)
    // 兜底：@load 命中缓存时可能不触发，别让脸一直卡在底层
    this._loadTimer = setTimeout(() => {
      this.moodLoaded = true
      this.maybeShowMood()
    }, SWAP_DELAY_MS + LOAD_FALLBACK_MS)
    this.timer = setTimeout(() => this.enter(), AUTO_ENTER_MS)
  },
  onUnload() {
    clearTimeout(this.timer)
    clearTimeout(this._swapTimer)
    clearTimeout(this._loadTimer)
  },
  methods: {
    // 按练习记录选表情（越具体的判断越靠前）：
    //   从没练过 → hi 打招呼；今天练过 → 全对/连击 7 天吐舌，否则开心笑；
    //   今天没练先数断签天数（从昨天往回数连续没练的天数）：
    //   没断签（昨天练了）看错题积压 → ≥20 紧张，否则惊讶；
    //   断签 1-2 天委屈、3-13 天生气、14 天以上震惊
    pickMood() {
      try {
        const days = history(0)
        if (!days.length) return 'hi' // 从没练过：初次见面
        const byDate = {}
        days.forEach(d => { byDate[d.date] = d })
        const today = byDate[dateStr()]
        if (today && today.total > 0) {
          const perfect = today.total >= 5 && today.correct >= today.total
          return (perfect || streak() >= 7) ? 'tongue' : 'smile'
        }
        let gap = 0
        const d = new Date()
        d.setDate(d.getDate() - 1)
        while (gap < 365) {
          const rec = byDate[dateStr(d)]
          if (rec && rec.total > 0) break
          gap++
          d.setDate(d.getDate() - 1)
        }
        if (gap === 0) return overview().wrongCount >= 20 ? 'nervous' : 'hi'
        if (gap >= 14) return 'shocked'
        if (gap >= 3) return 'angry'
        return 'sad'
      } catch (e) {
        return 'hi' // 存储异常时兜底，不能让启动页卡住
      }
    },
    // 上层表情图解码完成 —— 换脸的第二个条件（第一个是开场动画走完）
    onMoodLoad() {
      this.moodLoaded = true
      this.maybeShowMood()
    },
    // 两个条件都满足才淡入：① 开场动画走完 ② 新图已解码（否则会淡入出一张空白）
    maybeShowMood() {
      if (this.moodShown || !this.swapReady || !this.moodLoaded) return
      this.$nextTick(() => { this.moodShown = true })
    },
    enter() {
      if (this.entered) return
      this.entered = true
      clearTimeout(this.timer)
      clearTimeout(this._swapTimer)
      clearTimeout(this._loadTimer)
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
/* 浅蓝封面：底色贴近全局背景的浅蓝调，避免启动时出现深色大色块 */
.cover {
  position: relative;
  min-height: 100vh;
  background: linear-gradient(165deg, #f2f7ff 0%, #e0ecff 52%, #cfe0ff 100%);
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 46, 107, 255), 0.06) 0%, rgba(var(--brand-rgb, 46, 107, 255), 0.13) 52%, rgba(var(--brand-rgb, 46, 107, 255), 0.22) 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 180rpx 48rpx 100rpx;
  overflow: hidden;
}

/* 深色模式下的封面：避免夜里启动时闪一下亮屏 */
.app-dark.cover {
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 46, 107, 255), 0.14) 0%, rgba(8, 10, 9, 0.6) 52%, #121513 100%);
}

.deco { position: absolute; border-radius: 50%; }
.deco-1 {
  width: 420rpx; height: 420rpx; right: -160rpx; top: -140rpx;
  background: radial-gradient(circle, rgba(46, 107, 255, 0.18), rgba(46, 107, 255, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 46, 107, 255), 0.18), rgba(var(--brand-rgb, 46, 107, 255), 0));
}
.deco-2 {
  width: 300rpx; height: 300rpx; left: -120rpx; top: 46%;
  background: radial-gradient(circle, rgba(46, 107, 255, 0.12), rgba(46, 107, 255, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 46, 107, 255), 0.12), rgba(var(--brand-rgb, 46, 107, 255), 0));
}
.deco-3 {
  width: 200rpx; height: 200rpx; right: 8%; bottom: 14%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0));
  background: radial-gradient(circle, rgba(var(--surface-rgb, 255, 255, 255), 0.75), rgba(var(--surface-rgb, 255, 255, 255), 0));
}

.stage {
  position: relative;
  width: 340rpx; height: 340rpx;
  display: flex; align-items: center; justify-content: center;
  /* 原生启动图只画渐变背景（图案全交给本页），圆圈在这里浮现——
     不能"啪"地出现，那样 splash → cover 仍是一次硬切 */
  opacity: 0;
  animation: stageIn 0.6s ease 0.15s forwards;
}

.ring {
  position: absolute;
  width: 340rpx; height: 340rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(46, 107, 255, 0.4);
  border: 3rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.4);
  animation: ringPulse 2.4s ease-out infinite;
}

.mascot-wrap {
  position: relative; /* 上层表情图要叠在底层那张上 */
  width: 320rpx; height: 320rpx;
  border-radius: 50%;
  background: #ffffff;
  background: var(--solid, #ffffff);
  border: 8rpx solid rgba(255, 255, 255, 0.95);
  border: 8rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.95));
  box-shadow: 0 16rpx 56rpx rgba(46, 107, 255, 0.22);
  box-shadow: 0 16rpx 56rpx rgba(var(--brand-rgb, 46, 107, 255), 0.22);
  overflow: hidden;
  animation: float 3.2s ease-in-out infinite;
}

.mascot { width: 100%; height: 100%; }

/* 上层表情图：默认全透明，等「开场动画走完 + 图已解码」才淡入盖住底层。
   直接换 src 是硬切（用户会看到圆圈里先后两张脸），所以必须叠一层做过渡。
   ⚠️ 600ms 与脚本里的 FADE_MS 是一对，改一个要改另一个（check-cover-mascot.js 盯）。 */
.mascot-mood {
  position: absolute;
  left: 0; top: 0;
  opacity: 0;
  transition: opacity 600ms ease;
}
.mascot-mood.show { opacity: 1; }

.brand {
  display: flex; flex-direction: column; align-items: center;
  margin-top: 72rpx;
}

.app-name {
  font-size: 46rpx;
  font-weight: 500;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  letter-spacing: 10rpx;
  text-indent: 10rpx;
  font-family: Georgia, "Times New Roman", serif;
}

.app-en {
  margin-top: 32rpx;
  font-size: 20rpx;
  letter-spacing: 5rpx;
  text-indent: 5rpx;
  color: rgba(29, 79, 216, 0.62);
  font-family: Georgia, "Times New Roman", serif;
}

.divider {
  width: 64rpx; height: 2rpx;
  background: rgba(46, 107, 255, 0.38);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.38);
  margin-top: 36rpx;
}

.footer {
  position: absolute; left: 0; right: 0; bottom: 100rpx;
  display: flex; flex-direction: column; align-items: center;
}

.load-track {
  width: 240rpx; height: 4rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.18);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.18);
  overflow: hidden;
}

.load-fill {
  height: 100%; width: 0;
  border-radius: 999rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  animation: load 2.4s linear forwards;
}

.hint {
  margin-top: 24rpx;
  font-size: 20rpx;
  letter-spacing: 4rpx;
  text-indent: 4rpx;
  color: rgba(29, 79, 216, 0.6);
}

.anim { opacity: 0; animation: fadeUp 0.7s ease forwards; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(36rpx); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes stageIn {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14rpx); }
}
@keyframes ringPulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.45); opacity: 0; }
}
@keyframes load {
  from { width: 0; }
  to { width: 100%; }
}
</style>
