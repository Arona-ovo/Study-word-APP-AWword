<template>
  <view class="ftb-wrap">
    <view class="ftb">
      <!-- 选中指示：整格平移（transform，不触发重排），内层胶囊留出与 item 相同的左右间距 -->
      <view class="ftb-ind" :style="{ transform: 'translateX(' + indX + '%)' }">
        <view class="ftb-ind-pill"></view>
      </view>

      <view
        v-for="t in tabs"
        :key="t.key"
        class="ftb-item"
        :class="{ active: activeKey === t.key }"
        :data-k="t.key"
        hover-class="ftb-item-press"
        hover-start-time="0"
        hover-stay-time="40"
        @tap="go"
      >
        <!-- 图标：支持 CSS mask 的端（App / H5）用同一张剪影当蒙版、拿主题色去填，
             换主题色时图标跟着变；不支持的端退回原来的两张图切换（行为不变）。
             剪影图本身是单色 + 透明底，静止/选中两张的 alpha 形状完全一致，
             所以一张图就够用，不需要为每个主题色再备一套。 -->
        <view v-if="maskOk" class="ftb-icon ftb-icon-mask" :class="'ico-' + t.key"></view>
        <image v-else class="ftb-icon" :src="activeKey === t.key ? t.active : t.icon" mode="aspectFit" />
        <text class="ftb-text">{{ tabText(t) }}</text>
      </view>
    </view>
  </view>
</template>

<script>
// 悬浮磨砂玻璃 tabBar（页面内显式注册，不依赖 easycom）
// 用法：在每个 tab 页根节点末尾放 <float-tabbar ref="tabbar" current="home" />，
//      页面 onShow 里再调一次 this.$refs.tabbar.sync()（= 上报"当前是我"）。
// 原生 tabBar 由 utils/nav.js 的 hideNativeTabBar() 隐藏（App 端）。
//
// 本组件**不保存任何状态**：胶囊位置与选中态的唯一真相在 utils/tab-slide.js
// （见那里的注释）。每个 tab 页各有一个本组件实例，但谁隐藏谁就收不到通知 —— 状态
// 留在实例里就必然"切回来时先画一帧旧的"，那正是连点动画错乱的根因。这里只做两件事：
//   ① 把共享状态镜像成 data 供模板渲染；
//   ② 把点击 / 手势翻译成对共享状态的修改。

import {
  TABS, tabIndex, tabText, markSwitch, requestLeave, LEAVE,
  onPreview, offPreview, watchTabUI, moveIndicator, highlightTab, settleTab, scheduleNav
} from '../../utils/tab-slide.js';
// 点底栏震一下（设置 › 触感反馈 可关 / 可调强度）
import * as haptic from '../../utils/haptic.js';

// 图标能不能用 CSS mask 上色：能的话「换主题色 → 图标跟着变色」，
// 不能就退回两张图切换（老行为）。detect 一次就够，不用每个实例都问。
// 小程序逻辑层没有 DOM / CSS 全局 → false → 走兜底，和现在一模一样。
function maskSupported() {
  try {
    if (typeof CSS === 'undefined' || !CSS || typeof CSS.supports !== 'function') return false;
    return !!(CSS.supports('mask-image', 'url(x.png)') ||
              CSS.supports('-webkit-mask-image', 'url(x.png)'));
  } catch (e) {
    return false;
  }
}

export default {
  name: 'FloatTabbar',
  props: {
    // 当前 tab key：home / library / review / profile
    current: { type: String, default: '' }
  },
  data() {
    return {
      // 下面两个字段只是"共享状态的镜像"：任何实例改了它，这里都会被 watchTabUI 同步回来
      indIndex: -1,
      activeKey: '',
      maskOk: maskSupported(),
      tabs: TABS
    };
  },
  computed: {
    curIndex() {
      return tabIndex(this.current);
    },
    indX() {
      return (this.indIndex < 0 ? 0 : this.indIndex) * 100;
    }
  },
  created() {
    // 订阅共享状态：任何一个页面改动了它，这里都跟着变 —— 连被切走的、还没显示过的
    // 实例也跟着变，显示出来时第一帧就是对的，不需要任何"回来再修一次"的机制。
    this.__off = watchTabUI(s => {
      this.indIndex = s.ind;
      this.activeKey = s.active;
    });
    // 手势切页时页面会通知本实例目标 tab（底栏与内容同步动，而不是事后追）
    onPreview(this.current, key => this.preview(key));
  },
  mounted() {
    this.settle();
    // #ifdef APP-PLUS
    this.probeVisible();
    // #endif
  },
  beforeUnmount() {
    if (this.__off) { this.__off(); this.__off = null; }
    offPreview(this.current);
  },
  methods: {
    // 底栏文案走 i18n：读一下 __lang 建立渲染依赖，切语言后自动重画
    tabText(t) {
      void this.__lang;
      return tabText(t && t.key);
    },
    // 本页面成为可见 tab：由 mounted 与页面 onShow（nav.syncTabbar）驱动。
    // 这一步同时承担"高亮落地" —— 页面真的显示了，就不用再靠点击时的临时高亮撑着，
    // 也不存在"残留的 pending 把高亮指到别人身上"。
    settle() {
      const i = this.curIndex;
      if (i < 0) return;
      settleTab(this.current);
    },
    // 页面 onShow 的入口（utils/nav.js 的 syncTabbar 调它）
    sync() {
      this.settle();
    },
    // 手势切页专用：页面开始把内容推出屏幕时就通知底栏，指示胶囊跟着一起走。
    // 否则要等新页显示（约 200ms 后）底栏才开始追，和内容明显不同步。
    // 这里**只动胶囊、不碰高亮**：此刻页面还没切走，选中高亮仍应属于当前页；
    // 若提前把高亮指到目标，等用户再滑回本页时 settle() 会把它从目标拽回来 —— 那一下
    // 就是底栏"莫名其妙晃一下"。
    preview(key) {
      const i = tabIndex(key);
      if (i < 0) return;
      moveIndicator(i);
    },
    go(e) {
      const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.k : '';
      const t = this.tabs.find(x => x.key === key);
      // 点当前 tab：不重复导航、不重播动画（activeKey 已是全局真相，连点的同一格会被拦掉）
      if (!t || t.key === this.activeKey) return;
      // 触感反馈：确认"点中了"，在切页动画之前就给到（晚了就分不清是哪一下的反馈）。
      // 开关关掉 / 平台不支持都只是不震，不影响切页。
      try { haptic.tick('tap') } catch (err) { /* 震不动也要把页切了 */ }
      // 胶囊与高亮同时动：不然高亮先跳、胶囊隔一会儿才追，看着像"晃了两下"
      moveIndicator(tabIndex(t.key));
      highlightTab(t.key);
      // 记下方向（离场动画据此决定轻移的方向）
      const dir = markSwitch(this.current, t.key);
      // 先让**当前页**淡出让位：它此刻是可见的，动画可控；
      // 目标页只要在它自己的离场态上淡入即可（起始帧是它上次可见时画好的，不会跳变）。
      // 反过来若直接 switchTab，新页的起始帧赶不上首帧渲染 → 就是那一下"闪"。
      const left = requestLeave(this.current, dir);
      const path = t.path;
      // 排队的切页可被"改主意"覆盖：在离场窗口里再点别的格，只换目的地、不排两次、
      // 也不吞掉这次点击（详情见 tab-slide.js 的 scheduleNav 注释）。
      scheduleNav(function () { uni.switchTab({ url: path }); }, left ? LEAVE.SWITCH_AT : 0);
    },
    // 供新手引导测量组件内元素（视口坐标）；拿不到给 null。
    // 页面级的 createSelectorQuery 选不进自定义组件内部，必须组件自己量。
    rect(sel, cb) {
      try {
        uni.createSelectorQuery().in(this).select(sel).boundingClientRect(cb).exec();
      } catch (e) {
        if (cb) cb(null);
      }
    },
    // 诊断：「底部导航不见了」在 App 端几乎总是 webview 没重排 —— 原生 tabBar 隐藏后
    // 页面窗口仍按"被占掉一块"的高度布局，本组件的 fixed bottom:0 于是沉到屏幕外。
    // 这里把关键数值打出来：Chrome 里 inspect App webview，看 lost 就能定性。
    // 只打日志、不擅自改布局 —— 各机型状态栏 / 虚拟按键高度不一，自动纠偏容易误伤。
    probeVisible() {
      setTimeout(() => {
        try {
          const sys = uni.getSystemInfoSync();
          if (!sys) return;
          const lost = (sys.screenHeight || 0) - (sys.windowHeight || 0);
          console.log('[float-tabbar] screen=' + sys.screenHeight + ' window=' + sys.windowHeight + ' lost=' + lost);
          if (lost > 120) {
            console.warn('[float-tabbar] 窗口比屏幕矮了 ' + lost + 'px —— 像是原生 tabBar 占位后 webview 没重排，自绘底栏会沉到屏幕外');
          }
        } catch (e) { /* 系统信息拿不到就跳过诊断 */ }
      }, 800);
    }
  }
};
</script>

<style scoped>
/* 外层只负责定位，不拦截触摸：只有中间的胶囊可点 */
.ftb-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 500;
  padding: 0 24rpx;
  padding-bottom: calc(20rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  /* Android webview 常报 env()=0，系统导航条却画在 webview 上面 → 实测 inset 兜底
     （theme.js rootStyle 下发 --safe-b）；否则胶囊下半截被导航条压住 */
  padding-bottom: calc(20rpx + max(env(safe-area-inset-bottom), var(--safe-b, 0px)));
  pointer-events: none;
}

/* 磨砂玻璃胶囊
   不透明度只能到 0.68 的坑（2026-10-09 截图）：底栏是全项目**唯一**常年压在
   滚动内容上面的窗体（卡片之间是静止的，底栏下面却一直有过路的行）。
   0.68 + blur(12px) 挡不住大字：首页「今日数据条」的 57 / 28 / 3 从胶囊里
   透出来一清二楚，看着像渲染错位。放到 0.86 —— 仍能透出背景色（玻璃感还在，
   深色档 46,52,48 下也不会变成一块死黑），但下面的文字不再可读。
   注意低画质档位（fx-glass-key / 流畅模式）会关掉 backdrop-filter，
   那时半透明就是**唯一**的遮挡手段，所以这里不能依赖模糊来兜底。 */
.ftb {
  position: relative;
  display: flex;
  align-items: center;
  height: 112rpx;
  border-radius: 56rpx;
  background: rgba(255, 255, 255, 0.86);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.6);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.6));
  box-shadow: 0 12rpx 40rpx rgba(23, 32, 26, 0.14), 0 2rpx 8rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 12rpx 40rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.14), 0 2rpx 8rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  pointer-events: auto;
  overflow: hidden;
}

/* 选中指示：整格平移。宽度固定 25%，与 flex:1 + margin:6rpx 的 item 完全对齐；
   用 transform 而不是 left，避免每帧重排（滑动更顺、不卡）。 */
.ftb-ind {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 25%;
  z-index: 0;
  /* 跟手优先：220ms + 起步就快的曲线。再短会失去"连续滑动"的过渡感，
     再长就会觉得点了之后还要等一下才到位。 */
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

/* 选中指示层没有"跳起点"那一套了：所有实例共享同一份位置，隐藏的实例也会跟着更新，
   显示出来的第一帧就是对的，不再需要"关掉过渡先跳到旧位置"的补丁。 */
.ftb-ind-pill {
  position: absolute;
  top: 12rpx;
  bottom: 12rpx;
  left: 6rpx;
  right: 6rpx;
  border-radius: 44rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
}

.ftb-item {
  position: relative;
  z-index: 1;
  flex: 1;
  height: 88rpx;
  margin: 0 6rpx;
  border-radius: 44rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: transform 120ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease;
}

/* 按下反馈：轻微、快速回弹，避免"按下去半天才弹回来"的黏滞感 */
.ftb-item-press {
  transform: scale(0.94);
  opacity: 0.7;
}

.ftb-icon {
  width: 40rpx;
  height: 40rpx;
}

/* 蒙版版图标：形状取自 PNG 的 alpha，颜色由 CSS 变量给 —— 换主题色就换色。
   不支持 mask 的端走 <image> 那一路，这里的类根本不会被用到。
   未选中用 ink-3（深色模式下会自动变浅），选中用 brand —— 与文字、指示胶囊同源。 */
.ftb-icon-mask {
  background-color: #98a19b;
  background-color: var(--ink-3, #98a19b);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-position: center;
  mask-position: center;
  transition: background-color 140ms ease;
}

.ftb-item.active .ftb-icon-mask {
  background-color: #2e6bff;
  background-color: var(--brand, #2e6bff);
}

/* 四个 tab 各一张剪影（key 与文件名不同名：错题的 key 是 review、图是 wrong.png，
   所以这里写死映射；改图时记得同步 _tools/check-tabbar.js 的断言） */
.ico-home {
  -webkit-mask-image: url('/static/tabbar/home.png');
  mask-image: url('/static/tabbar/home.png');
}
.ico-library {
  -webkit-mask-image: url('/static/tabbar/library.png');
  mask-image: url('/static/tabbar/library.png');
}
.ico-review {
  -webkit-mask-image: url('/static/tabbar/wrong.png');
  mask-image: url('/static/tabbar/wrong.png');
}
.ico-profile {
  -webkit-mask-image: url('/static/tabbar/profile.png');
  mask-image: url('/static/tabbar/profile.png');
}

/* 选中时图标弹一下（240ms）。class 只在"变为选中"时才加上，
   所以每次切换恰好播一次；页面被缓存后重新显示不会重播。 */
.ftb-item.active .ftb-icon {
  animation: ftb-pop 240ms cubic-bezier(0.34, 1.4, 0.4, 1);
}

@keyframes ftb-pop {
  0% { transform: scale(0.88); }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.ftb-text {
  margin-top: 4rpx;
  font-size: 20rpx;
  line-height: 1.2;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
  transition: color 140ms ease;
}

.ftb-item.active .ftb-text {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  font-weight: 600;
}
</style>
