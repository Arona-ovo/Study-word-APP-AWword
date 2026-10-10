<template>
  <view class="fnb-wrap" :style="{ paddingTop: (barH + 8) + 'px' }">
    <!-- 搜索模式：未聚焦时左右两个图标槽收起（width 0），输入框铺满整个胶囊；
         聚焦（或已有关键词）时两个槽展开到 76rpx，输入框只横向收缩、保持居中，
         上下始终与胶囊同高 —— 收缩 / 还原都走 width 过渡动画。
         例外：最右侧的模式键不参与收起（常驻），理由见下面那颗键的注释。 -->
    <view class="fnb" :class="{ 'fnb-search-mode': search, 'fnb-cmd-mode': isCommand }">
      <view class="fnb-side" :class="{ 'fnb-side-flat': isFlat }" @tap="onLeftTap">
        <text v-if="!search && showBack" class="fnb-back" hover-class="fnb-back-press" hover-start-time="0" hover-stay-time="70">‹</text>
        <view v-else-if="busy" class="fnb-spin" hover-start-time="0" hover-stay-time="70"></view>
        <view v-else-if="search && isCommand" class="fnb-wand" hover-class="fnb-mag-press" hover-start-time="0" hover-stay-time="70">
          <view class="wand-v"></view>
          <view class="wand-h"></view>
        </view>
        <view v-else-if="search" class="fnb-mag" hover-class="fnb-mag-press" hover-start-time="0" hover-stay-time="70">
          <view class="mag-ring"></view>
          <view class="mag-handle"></view>
        </view>
      </view>

      <input
        v-if="search"
        class="fnb-search"
        :class="{ 'fnb-search-cmd': isCommand }"
        :value="value"
        :placeholder="placeholder"
        placeholder-style="color:#a8b0ab;font-size:26rpx"
        :confirm-type="isCommand ? 'send' : 'search'"
        :focus="autofocus"
        :hold-keyboard="keepKeyboard"
        @input="onInput"
        @confirm="onConfirm"
        @focus="onFocus"
        @blur="onBlur"
      />
      <!-- 标题栏本身可点：点了就切到搜索态（不是搜索态的页面才需要） -->
      <text v-else class="fnb-title" :class="{ 'fnb-title-tappable': searchable }" @tap="onTitleTap">{{ title }}</text>

      <view
        class="fnb-side"
        :class="{ 'fnb-side-flat': isFlat, 'fnb-side-dim': dimSearchEntry }"
        @tap="onRightTap"
      >
        <text v-if="search && value" class="fnb-clear">×</text>
        <!-- 非搜索态：右侧一颗放大镜，明示"这条顶栏点得开"。
             还没答完题时置灰而不是藏起来 —— 藏了用户会以为这功能不存在（见项目约定 16）。 -->
        <view v-else-if="!search && searchable" class="fnb-mag" hover-class="fnb-mag-press" hover-start-time="0" hover-stay-time="70">
          <view class="mag-ring"></view>
          <view class="mag-handle"></view>
        </view>
      </view>

      <!-- 模式切换键：自动判定再准也有看走眼的时候，留一颗手动开关兜底。
           点一下就在「搜 / AI」之间切换并锁定，清空输入才回到自动判定。
           常驻（不挂 fnb-side-flat，跟着一起收起会有两个麻烦）：
             ① 收起态是 width:0 + pointer-events:none —— 键还在屏幕上但点不动，
                用户看到的就是"这颗键失灵了"；
             ② 锁定态被藏起来更危险：用户以为自己没锁，随手打个单词却被当成
                AI 指令真的去改首页。
           空闲时也必须能看到"回车会走哪条路"，所见即所得才成立。 -->
      <view
        v-if="search && switchable"
        class="fnb-side fnb-side-mode"
        @tap="onModeTap"
      >
        <view class="fnb-mode" :class="{ 'fnb-mode-on': isCommand, 'fnb-mode-lock': locked }">
          <text class="fnb-mode-txt">{{ modeText }}</text>
          <view v-if="locked" class="fnb-lock"></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
// 悬浮磨砂玻璃顶栏（与底部 float-tabbar 同一套视觉语言）
// 用法：页面根节点加 class="page-nav"，模板顶部放 <float-navbar title="xxx" />
//      pages.json 对应页面需要 "navigationStyle": "custom"（否则会多出原生导航栏）
// 返回键：默认按页面栈深度自动判断（栈深 > 1 才显示），也可用 :back="true/false" 强制

export default {
  name: 'FloatNavbar',
  props: {
    title: { type: String, default: '' },
    // 不传则自动判断：页面栈里还有上一页才显示返回键
    back: { type: Boolean, default: null },
    // 搜索模式：中间渲染输入框而不是标题（首页用）
    search: { type: Boolean, default: false },
    value: { type: String, default: '' },
    placeholder: { type: String, default: t('搜索') },
    // 输入模式：search（查词） / command（AI 指令）—— 只影响图标与描边颜色
    mode: { type: String, default: 'search' },
    // 模式是否被用户手动锁定（锁定时模式键上带一个小锁点）
    locked: { type: Boolean, default: false },
    // 是否显示右侧的模式切换键（只有"搜索 + 指令"双模式的页面才需要）
    switchable: { type: Boolean, default: false },
    // 执行中：左槽换成转圈
    busy: { type: Boolean, default: false },
    // 标题栏能不能"点开搜索"（练习/刷单词这类页面用：平时是标题，点一下变搜索框）
    searchable: { type: Boolean, default: false },
    // 搜索暂时不可用（题还没答完）：放大镜与标题只置灰，点了发 title-tap 让页面解释原因
    searchLocked: { type: Boolean, default: false },
    // 切到搜索态时把输入框抢过来（弹键盘）
    autofocus: { type: Boolean, default: false },
    // 点页面别处不主动收键盘（搜索结果在下方的页面用，滚结果时键盘不闪）
    keepKeyboard: { type: Boolean, default: false }
  },
  data() {
    return { barH: 0, focused: false }
  },
  computed: {
    showBack() {
      if (this.back === true) return true
      if (this.back === false) return false
      try {
        const pages = getCurrentPages()
        return Array.isArray(pages) && pages.length > 1
      } catch (e) {
        return false
      }
    },
    // 收缩态只在「搜索模式 + 既没聚焦也没有关键词」时出现
    active() {
      return !!this.focused || !!this.value
    },
    isFlat() {
      return !!this.search && !this.active
    },
    isCommand() {
      return !!this.search && this.mode === 'command'
    },
    modeText() {
      return this.isCommand ? 'AI' : t('搜')
    },
    // 搜索入口置灰：只在"非搜索态 + 可搜 + 当前还不能搜"时成立
    dimSearchEntry() {
      return !!(this.searchable && this.searchLocked && !this.search)
    }
  },
  created() {
    // 状态栏高度：CSS 变量 --status-bar-height 在部分端缺失时用系统信息兜底
    let h = 0
    try {
      const info = uni.getSystemInfoSync()
      h = (info && info.statusBarHeight) || 0
    } catch (e) {
      h = 0
    }
    this.barH = h
  },
  mounted() {
    // 冷启动兜底：个别端在 created 时会拿到 statusBarHeight = 0，
    // 搜索框整个顶进状态栏里，看起来就像"搜索框不见了"。挂载后再补取一次。
    if (this.barH) return
    setTimeout(() => {
      if (this.barH) return
      try {
        const info = uni.getSystemInfoSync()
        const h = (info && info.statusBarHeight) || 0
        if (h) this.barH = h
      } catch (e) { /* 保持 0，CSS 变量还有一层兜底 */ }
    }, 120)
  },
  methods: {
    // 供新手引导测量组件内元素（视口坐标）；拿不到给 null。
    // 页面级的 createSelectorQuery 选不进自定义组件内部，必须组件自己量。
    rect(sel, cb) {
      try {
        uni.createSelectorQuery().in(this).select(sel).boundingClientRect(cb).exec()
      } catch (e) {
        cb && cb(null)
      }
    },
    /**
     * 把 input / confirm 事件里的值抠出来。
     * 各端 detail 的形态并不一致：有的是 { value }，有的直接就是字符串，
     * 某些端在键盘回车时还会给出别的形状。以前直接取 e.detail.value，
     * 一旦拿到的是对象，String() 之后就变成 "[object Object]" 被当成搜索词
     * —— 于是 AI 去解释这个词、还把它写进词库，搜索结果里就冒出一个 "Object"。
     * 这里统一兜一层：拿不到字符串就退回当前值，绝不让对象往外传。
     */
    pickValue(e) {
      const d = e && e.detail
      if (typeof d === 'string') return d
      if (d && typeof d.value === 'string') return d.value
      if (d && typeof d.text === 'string') return d.text
      return this.value || ''
    },
    onInput(e) {
      this.$emit('input', this.pickValue(e))
    },
    onConfirm(e) {
      this.$emit('search', this.pickValue(e))
    },
    // 聚焦/失焦驱动胶囊的收缩与还原
    onFocus() {
      this.focused = true
      this.$emit('focus', this.value || '')
    },
    onBlur(e) {
      this.focused = false
      const v = e && e.detail && e.detail.value != null ? e.detail.value : (this.value || '')
      this.$emit('blur', v)
    },
    // 供父页面主动收起（清空搜索时把胶囊还原成铺满态）
    blurInput() {
      this.focused = false
      try { uni.hideKeyboard() } catch (e) {}
      this.$emit('blur', this.value || '')
    },
    // 左槽：非搜索模式是返回键；搜索模式是放大镜，点击即执行搜索
    onLeftTap() {
      if (!this.search) { this.onBack(); return }
      this.$emit('search', this.value || '')
    },
    // 右槽：搜索态 = 清除；非搜索态 = 搜索入口（与点标题同义）
    onRightTap() {
      if (this.search) { this.onClear(); return }
      this.onTitleTap()
    },
    /**
     * 点标题 / 右侧放大镜 = 请求切到搜索模式。
     * 组件只负责"用户想搜了"这个信号，能不能搜（比如题没答完）由页面判定 ——
     * 它才知道现在的业务状态，组件不该猜。
     */
    onTitleTap() {
      if (!this.searchable) return
      this.$emit('title-tap')
    },
    onClear() {
      this.$emit('input', '')
      this.$emit('clear')
    },
    // 模式键：只发事件，切到哪个模式由父页面决定（它才知道当前输入该怎么判）
    onModeTap() {
      if (!this.search || !this.switchable) return
      this.$emit('mode-toggle', this.mode === 'command' ? 'search' : 'command')
    },
    onBack() {
      if (!this.showBack) return
      const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
      if (pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.switchTab({ url: '/pages/home/home' })
      }
    }
  }
}
</script>

<style scoped>
/* 外层只负责定位与状态栏留白；只有中间的胶囊可点 */
.fnb-wrap {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  z-index: 400;
  padding: 0 24rpx 8rpx;
  pointer-events: none;
}

.fnb {
  position: relative;
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 8rpx;
  border-radius: 44rpx;
  background: rgba(255, 255, 255, 0.68);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.68);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 10rpx 30rpx rgba(23, 32, 26, 0.07), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  pointer-events: auto;
}


/* 搜索模式：胶囊去掉左右内边距，输入框才能真正铺满 */
.fnb-search-mode {
  padding: 0;
}

/* 指令态：胶囊描边换成品牌色，一眼能看出"这条会改页面" */
.fnb-cmd-mode {
  border-color: rgba(46, 107, 255, 0.55);
  border-color: rgba(var(--brand-rgb, 46, 107, 255), 0.55);
  box-shadow: 0 10rpx 30rpx rgba(46, 107, 255, 0.14), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--brand-rgb, 46, 107, 255), 0.14), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
}

.fnb-search-cmd {
  background: rgba(46, 107, 255, 0.06);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.06);
  border-color: rgba(46, 107, 255, 0.24);
  border-color: rgba(var(--brand-rgb, 46, 107, 255), 0.24);
}

/* 执行中转圈 */
.fnb-spin {
  width: 30rpx;
  height: 30rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: fnb-rotate 0.9s linear infinite;
}

@keyframes fnb-rotate {
  to { transform: rotate(360deg); }
}

/* ===== 模式切换键（搜 / AI）=====
   自动判定再准也有看走眼的时候：把"想让 AI 改页面"判成查词只是白搜一次，
   把"想查词"判成指令则会真的去改首页 —— 后者代价大得多。
   所以顶栏右侧常驻一颗模式键，所见即所得：键上写着什么，回车就走哪条路。
   点过之后进入锁定态（右上角一个小点），打字不再自动改判，清空输入才解锁。 */
.fnb-mode {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46rpx;
  min-width: 58rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  border: 2rpx solid rgba(23, 32, 26, 0.1);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.1));
  transition: background 200ms ease, border-color 200ms ease, opacity 160ms ease;
}

.fnb-mode:active { opacity: 0.6; }

.fnb-mode-txt {
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 指令态：整颗键染上品牌色，和胶囊描边、魔杖图标同一套语言 */
.fnb-mode-on {
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-color: rgba(46, 107, 255, 0.34);
  border-color: rgba(var(--brand-rgb, 46, 107, 255), 0.34);
}

.fnb-mode-on .fnb-mode-txt {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

/* 锁定标记：右上角一个小点，提示"这条是我自己定的，不再自动改判" */
.fnb-lock {
  position: absolute;
  right: 6rpx;
  top: 6rpx;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

/* 指令态图标：一根小魔杖（两条短线交叉，纯 CSS） */
.fnb-wand {
  position: relative;
  width: 32rpx;
  height: 32rpx;
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.wand-v {
  position: absolute;
  left: 14rpx;
  top: 2rpx;
  width: 4rpx;
  height: 28rpx;
  border-radius: 2rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  transform: rotate(45deg);
}

.wand-h {
  position: absolute;
  left: 2rpx;
  top: 14rpx;
  width: 28rpx;
  height: 4rpx;
  border-radius: 2rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  transform: rotate(45deg);
}

.fnb-search-mode .fnb-side-flat .fnb-wand {
  transform: scale(0.72);
}

@media (prefers-reduced-motion: reduce) {
  .fnb-spin { animation: none; }
}

.fnb-side {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 搜索入口置灰：题还没答完时不能搜。**只降透明度、不隐藏** ——
   藏起来用户会以为这功能不存在（项目约定 16），点了由页面说明为什么。 */
.fnb-side-dim { opacity: 0.4; }

/* 可点开的标题：按一下有点反馈，暗示"这里能按" */
.fnb-title-tappable:active { opacity: 0.55; }

/* 搜索模式的左右槽：展开态 76rpx，收起态 0（输入框随之铺满 / 收缩） */
.fnb-search-mode .fnb-side {
  width: 76rpx;
  height: 100%;
  overflow: hidden;
  transition: width 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 200ms ease;
}

.fnb-search-mode .fnb-side.fnb-side-flat {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.fnb-back {
  font-size: 48rpx;
  line-height: 1;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  transition: opacity 180ms ease, transform 180ms ease;
}

.fnb-back-press { opacity: 0.5; transform: translateX(-4rpx); }

.fnb-title {
  flex: 1;
  text-align: center;
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 搜索模式：胶囊内嵌输入框（首页）
   - 上下：height 100%，始终与胶囊同高（收缩时只动左右，不动上下）
   - 左右：flex 1，随左右槽的 width 过渡自动收缩 / 铺满，且两侧等宽 → 始终居中 */
.fnb-search {
  flex: 1;
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 28rpx;
  margin: 0;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  /* 输入框用浅灰填充：顶栏本身已经是白色窗体，再叠白就看不见输入框了 */
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 999rpx;
}

/* 放大镜：纯 CSS 画的线性图标（不引外部图片，App/H5/小程序都一致） */
.fnb-mag {
  position: relative;
  width: 34rpx;
  height: 34rpx;
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.mag-ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 24rpx;
  height: 24rpx;
  box-sizing: border-box;
  border: 3rpx solid #2e6bff;
  border: 3rpx solid var(--brand, #2e6bff);
  border-radius: 50%;
}

.mag-handle {
  position: absolute;
  left: 19rpx;
  top: 19rpx;
  width: 3rpx;
  height: 13rpx;
  border-radius: 2rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  transform: rotate(-45deg);
  transform-origin: 0 0;
}

.fnb-mag-press { opacity: 0.5; }

/* 收起时图标同步缩小一点，配合槽位宽度一起过渡 */
.fnb-search-mode .fnb-side-flat .fnb-mag,
.fnb-search-mode .fnb-side-flat .fnb-clear {
  transform: scale(0.72);
}

.fnb-clear {
  font-size: 34rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .fnb-search-mode .fnb-side,
  .fnb-mag,
  .fnb-clear {
    transition: none;
  }
}
</style>
