// utils/theme-mixin.js - 页面根节点的外观挂载（全局 mixin）
//
// App 端逻辑层跑在独立 JS 引擎里，拿不到 document，写不了 CSS 变量；
// 所以深色模式 / 背景图要通过在页面根节点上渲染 class 与 inline style 来实现。
// H5 端这两者也会渲染，与 documentElement 上的 CSS 变量互补，结果一致。
//
// 用法：main.js 里 app.mixin(themeMixin)，页面根节点加
//       :class="appTheme" :style="appBgStyle"

import * as theme from './theme.js';

export default {
  data() {
    return {
      appTheme: '',
      appBgStyle: {}
    };
  },
  onLoad() {
    this.refreshAppTheme();
    // 运行期切主题（系统深浅色切换 / AI 指令 theme.set）时页面根节点要跟着重算
    try {
      if (typeof uni !== 'undefined' && typeof uni.$on === 'function') uni.$on('theme:change', this.refreshAppTheme);
    } catch (e) {}
  },
  onShow() {
    this.refreshAppTheme();
  },
  // 屏幕尺寸变了（横竖屏切换 / 折叠屏展开 / 分屏）：rootStyle 里带了一堆按
  // "当时那块屏幕"算出来的值（--safe-b 的实测导航条高度、背景图的铺法），
  // 不重算就会跟新屏幕对不上。rpx 本身是响应式的（750rpx = 屏宽），
  // 但凡是**用 JS 缓存过的 px** 都必须在这里清掉重来。
  onResize() {
    try {
      theme.resetSafeInset();
    } catch (e) {}
    this.refreshAppTheme();
  },
  onUnload() {
    try {
      if (typeof uni !== 'undefined' && typeof uni.$off === 'function') uni.$off('theme:change', this.refreshAppTheme);
    } catch (e) {}
  },
  methods: {
    refreshAppTheme() {
      try {
        this.appTheme = theme.rootClass();
      } catch (e) {
        this.appTheme = '';
      }
      try {
        this.appBgStyle = theme.rootStyle();
      } catch (e) {
        this.appBgStyle = {};
      }
    }
  }
};
