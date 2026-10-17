// utils/theme.js - 全局外观：主题色 + 背景 + 深色模式
//
// 实现方式（两条通道并行，H5 / App 都能生效）：
//   1) CSS 变量：写在 documentElement 上（H5 可用）
//        --brand / --brand-strong / --brand-rgb   主色
//        --app-bg        页面兜底背景（纯色 / 渐变 / 背景图）
//   2) 根节点 class / inline style：'app-root app-dark acc-blue' + 背景变量
//      （App 端逻辑层没有 DOM，只能靠 Vue 渲染）
//        --bg-color / --bg-img   背景（App.vue 里 fixed 的 .app-root::before 消费）
//        --bg-mask / --bg-blur   淡化蒙版与背景模糊（.app-root::after 消费）
//        backgroundAttachment: fixed —— 根节点自己的同款背景，作为兜底
//      App.vue 的全局样式里用 .app-dark 重定义 --ink-* / --surface-rgb 等中性色变量，
//      页面样式全部写成 var(--x, 原值)，所以浅色下不写变量也完全可用。
//
// 因为卡片、顶栏、底栏都是半透明磨砂玻璃，背景会透过它们显示出来。
// 背景画在 fixed 层上：上下滑动时只有窗体在动，背景不动。

import * as settings from './settings.js';
import * as color from './color.js';

// ---------- 主题色 ----------
// rgb 用于 rgba(var(--brand-rgb), alpha) 这种半透明写法；dark 系列用于深色模式（提亮以保证对比度）
export const ACCENTS = [
  { key: 'blue', name: '蓝', rgb: '46, 107, 255', main: '#2e6bff', strong: '#1d4fd8', rgbDark: '111, 155, 255', mainDark: '#6f9bff', strongDark: '#9dbcff' },
  { key: 'teal', name: '青', rgb: '13, 148, 136', main: '#0d9488', strong: '#0f766e', rgbDark: '45, 212, 191', mainDark: '#2dd4bf', strongDark: '#5eead4' },
  { key: 'green', name: '绿', rgb: '34, 139, 87', main: '#228b57', strong: '#1a6d43', rgbDark: '74, 222, 128', mainDark: '#4ade80', strongDark: '#86efac' },
  { key: 'purple', name: '紫', rgb: '124, 58, 237', main: '#7c3aed', strong: '#5b21b6', rgbDark: '167, 139, 250', mainDark: '#a78bfa', strongDark: '#c4b5fd' },
  { key: 'amber', name: '橙', rgb: '202, 111, 6', main: '#ca6f06', strong: '#a15405', rgbDark: '251, 191, 36', mainDark: '#fbbf24', strongDark: '#fcd34d' },
  { key: 'rose', name: '玫红', rgb: '225, 29, 72', main: '#e11d48', strong: '#be123c', rgbDark: '251, 113, 133', mainDark: '#fb7185', strongDark: '#fda4af' },
  { key: 'graphite', name: '墨绿灰', rgb: '62, 74, 66', main: '#3e4a42', strong: '#2b332d', rgbDark: '154, 167, 160', mainDark: '#9aa7a0', strongDark: '#c2ccc6' }
];

// ---------- 背景预设 ----------
// darkCss / darkSolid：深色模式下的同款变体（把渐变整体压暗，保留色相）。
// 没有它们，深色下一刀切用 DARK_BG_CSS，用户换任何背景都"没效果"。
// 注意：BACKGROUNDS 引用了下面的 DARK_BG_*，所以这三个常量必须先声明（避免 TDZ）。
export const DARK_BG = '#121513';
export const DARK_BG_CSS = 'linear-gradient(165deg, #171b19 0%, #121513 100%)';
// 浅色底色比"接近白"要再压一档：卡片本身是 rgba(白, 0.72) 的磨砂玻璃，
// 底色越接近白，卡片和背景就越糊成一片（#f4f6f4 时两者只差 8 个灰阶，
// 看上去就是"一整屏白"）。压到 #e4e9e4 后差出 18 个灰阶，窗体才立得起来。
export const LIGHT_BG = '#e4e9e4';

// ---------- 字体 / 密度（settings.theme.font / .density，AI 指令 theme.set 可改） ----------
// 走 rootStyle() 下发成 CSS 变量，App.vue 里统一消费；没有这两张表的话
// theme.set{font} / {density} 会"写了但不生效"。
export const FONT_STACKS = {
  system: '-apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", "Times New Roman", "SimSun", serif',
  rounded: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
};
export const DENSITY_GAP = { compact: '14rpx', cozy: '24rpx', relaxed: '34rpx' };

// 浅色档整体压深过一轮（原来每个预设的头一档都在 #f2-#ff 之间，铺开就是"一屏白"）：
// 色相与配比不动，只把三个色标各压深一档，渐变两头也拉开一点，层次才看得出来。
export const BACKGROUNDS = [
  { key: 'default', name: '浅灰', css: '#e4e9e4', solid: '#e4e9e4', darkCss: DARK_BG_CSS, darkSolid: DARK_BG },
  { key: 'sky', name: '浅蓝', css: 'linear-gradient(165deg, #e6efff 0%, #d6e5ff 52%, #c2d9ff 100%)', solid: '#d6e5ff',
    darkCss: 'linear-gradient(165deg, #1c2d42 0%, #152234 52%, #101a29 100%)', darkSolid: '#152234' },
  { key: 'mint', name: '薄荷', css: 'linear-gradient(165deg, #e5f5ed 0%, #d1eadf 52%, #bfe1d2 100%)', solid: '#d1eadf',
    darkCss: 'linear-gradient(165deg, #193228 0%, #12281f 52%, #0d1f18 100%)', darkSolid: '#12281f' },
  { key: 'sand', name: '暖砂', css: 'linear-gradient(165deg, #f7f1e6 0%, #f0e4d2 52%, #e7d7bd 100%)', solid: '#f0e4d2',
    darkCss: 'linear-gradient(165deg, #332a19 0%, #282013 52%, #1e180e 100%)', darkSolid: '#282013' },
  { key: 'lilac', name: '淡紫', css: 'linear-gradient(165deg, #f1edff 0%, #e2dbf6 52%, #d5ccf2 100%)', solid: '#e2dbf6',
    darkCss: 'linear-gradient(165deg, #272039 0%, #1e182c 52%, #161221 100%)', darkSolid: '#1e182c' },
  { key: 'dawn', name: '晨曦', css: 'linear-gradient(165deg, #fff0ec 0%, #ffdbd5 52%, #ffccd3 100%)', solid: '#ffdbd5',
    darkCss: 'linear-gradient(165deg, #3a1f1f 0%, #2d1717 52%, #221111 100%)', darkSolid: '#2d1717' }
];

// ---------- 自定义背景色 ----------
// 预设再多也只能是"挑一个别人配好的"，所以再开一条路：用户自己定一个底色。
// 存的是 hex（settings.theme.bgColor），选了就等于切到 background:'custom'。
// 深色模式下不丢这个颜色 —— 换成同色相的压暗变体（见 color.darkVariant），
// 和预设的 darkCss 一个道理：深色下换背景也必须看得出换了。
export const CUSTOM_KEY = 'custom';
export const CUSTOM_NAME = '自定义';
// 从没挑过颜色时的起点（和新的默认浅灰同档，不会一上来就是个突兀的颜色）
export const DEFAULT_CUSTOM = '#dce5dc';
// 取色面板的快捷色板：18 个，按色相大致排一圈，末尾留几个中性色与偏深的
export const SWATCHES = [
  '#e4e9e4', '#d8e0d8', '#cddcd2',
  '#d6e5ff', '#c3d9f7', '#d1eadf',
  '#bfe4d8', '#eaf0d2', '#f0e4d2',
  '#f6e2c9', '#ffdbd5', '#ffd8e0',
  '#f2d9ec', '#e2dbf6', '#d5ccf2',
  '#cfd6e8', '#c8ccc6', '#aeb8b2'
];

// 深色模式的底色（不是纯黑：纯黑在 OLED 上会和玻璃卡片糊在一起，主流做法用 #121212 一档的深灰）
// （DARK_BG / DARK_BG_CSS / LIGHT_BG 已上移到 BACKGROUNDS 之前，那里会被引用）

function findIn(list, key, fallbackIndex) {
  return list.find(b => b.key === key) || list[fallbackIndex || 0];
}

function themeState() {
  try {
    return settings.get().theme || {};
  } catch (e) {
    return {};
  }
}

export function current() {
  return themeState().background || 'default';
}

export function currentAccent() {
  return themeState().accent || 'blue';
}

export function currentBgImage() {
  return themeState().bgImage || '';
}

export function currentMask() {
  const v = themeState().bgMask;
  return typeof v === 'number' ? v : 0.35;
}

export function currentBlur() {
  const v = themeState().bgBlur;
  return typeof v === 'number' ? v : 0;
}

/** 自定义底色（hex，小写 #rrggbb）；没挑过返回 '' */
export function currentCustomColor() {
  return color.normalizeHex(themeState().bgColor);
}

/** 当前生效的底色（供取色面板当起点 / 给自定义色块上色） */
export function effectiveColor(dark) {
  return backgroundOf(current(), !!dark).solid;
}

export function currentDark() {
  return !!themeState().dark;
}

export function currentFont() {
  const s = settings.get() || {};
  const f = ((s.theme || {}).font) || 'system';
  return FONT_STACKS[f] ? f : 'system';
}

export function currentDensity() {
  const s = settings.get() || {};
  const d = ((s.theme || {}).density) || 'cozy';
  return DENSITY_GAP[d] ? d : 'cozy';
}

export function currentFollowSystem() {
  return !!themeState().followSystem;
}

/**
 * 练习页顶部两条进度条要不要同色系（已做 / 已会）。
 * 只有显式写成 false 才算"分开"，脏值 / 缺省一律回落 true（同色系）。
 */
export function barsSyncColors() {
  const v = (themeState() || {}).progressSync;
  return v === false ? false : true;
}

// ---------- 流畅模式 ----------
// 关闭后：全树 backdrop-filter 置 none（唯一真正的绘制热点），表面调实补偿可读性。
// 背景与卡片依旧半透明，所以"有层次的玻璃感"还在，只是不再实时模糊。
export function currentSmooth() {
  try {
    return !!(settings.get().performance || {}).smooth
  } catch (e) {
    return false
  }
}

// auto=true 表示这次是自动探测开的（utils/perf.js）；用户手动拨开关传 false，
// 之后的自动检测就不再覆盖这个选择
export function setSmooth(v, auto) {
  const on = !!v
  try {
    const perf = { smooth: on }
    // auto === true  自动探测开的（utils/perf.js）
    // auto === false 用户手动拨的 → 记 manual，之后自动检测不再覆盖
    // auto 未传      内部调用，不动来源标记
    if (auto === true) perf.auto = true
    if (auto === false) { perf.auto = false; perf.manual = true; }
    settings.set({ performance: perf })
  } catch (e) {}
  apply()
  return on
}

// ---------- 原生容器的深浅色（App 端"跟随系统"真正生效的开关） ----------
// uni-app 的 App 端原生容器默认锁在 light：
//   ① manifest.json 的 app-plus 里没有 "darkmode": true 时，
//      uni.getSystemInfoSync().theme 恒为 undefined，uni.onThemeChange 也不会注册；
//   ② 即使开了 darkmode，也要调用 plus.nativeUI.setUIStyle('auto') 让容器跟随系统，
//      否则系统切到深色、App 这边读到的还是 light。
// 两条都补齐，"跟随系统深色模式"才会真正动起来。
export function syncNativeUiStyle(style) {
  try {
    if (typeof plus !== 'undefined' && plus.nativeUI && typeof plus.nativeUI.setUIStyle === 'function') {
      plus.nativeUI.setUIStyle(style);
      return true;
    }
  } catch (e) {
    /* 非 App 端或内核较旧，忽略 */
  }
  return false;
}

// 跟随系统 → auto；手动指定 → dark / light（原生弹窗、日期选择器也跟着变）
export function nativeUiStyleFor() {
  return currentFollowSystem() ? 'auto' : (currentDark() ? 'dark' : 'light');
}

// 底部系统导航条（手势条 / 三大金刚键）底色：webview 只铺到页面底边为止，
// 再往下那一条是系统画的，窗口的 navigationBarColor 没设过就是纯白 ——
// 换壁纸、切深色都不跟（真机 2026-10-16 反馈）。这里把窗口导航条底色
// 同步成当前背景的实色兜底（背景图时用浅/深兜底色），换背景即时联动。
// ⚠️ 只在 App 端走 plus.android；H5 / 小程序没有这个概念。
function syncNavBarColor(hex) {
  // #ifdef APP-PLUS
  try {
    if (typeof plus === 'undefined' || !plus.android || !hex) return;
    const main = plus.android.runtimeMainActivity();
    if (!main) return;
    // ⚠️ plus.android 桥接规矩：方法调用拿到的 Java 对象必须先 importClass，
    //    才能调它自己的方法 —— 漏了这一步会在 addFlags 处抛异常，被 try 吞掉，
    //    表现就是"改了等于没改"（2026-10-16 真机白条还在的原因之一）。
    plus.android.importClass(main);
    const win = main.getWindow();
    plus.android.importClass(win);
    // FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS：不设这个，setNavigationBarColor 不生效
    win.addFlags(0x80000000);
    const Color = plus.android.importClass('android.graphics.Color');
    win.setNavigationBarColor(Color.parseColor(hex));
  } catch (e) {
    // 不能完全静默：基座控制台要能看到失败原因（白条只是丑，不影响功能）
    console.warn('[theme] syncNavBarColor failed:', (e && e.message) || e);
  }
  // #endif
}

// 状态栏文字颜色：页面全是 custom 导航，uni.setNavigationBarColor 管不到状态栏，
// 只能用 plus.navigator.setStatusBarStyle —— 否则深色底上状态栏图标还是黑的。
function syncStatusBarStyle(dark) {
  try {
    if (typeof plus !== 'undefined' && plus.navigator && typeof plus.navigator.setStatusBarStyle === 'function') {
      plus.navigator.setStatusBarStyle(dark ? 'light' : 'dark');
    }
  } catch (e) {
    /* 忽略 */
  }
}

// ---------- 深色模式判定 ----------
// 系统主题：① uni.getSystemInfoSync().theme（需 manifest 开 darkmode）
//          ② App 端 plus.nativeUI.getUIStyle()  ③ H5 的 prefers-color-scheme
export function systemPrefersDark() {
  try {
    const info = uni.getSystemInfoSync();
    if (info && (info.theme === 'dark' || info.theme === 'light')) return info.theme === 'dark';
  } catch (e) {
    /* 部分端不支持，继续往下 */
  }
  try {
    if (typeof plus !== 'undefined' && plus.nativeUI && typeof plus.nativeUI.getUIStyle === 'function') {
      const s = plus.nativeUI.getUIStyle();
      if (s === 'dark') return true;
      if (s === 'light') return false;
      // 'auto'：拿不到具体值，继续往下问
    }
  } catch (e) {
    /* 忽略 */
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return !!window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch (e) {
    /* 忽略 */
  }
  return false;
}

// 最终生效的深色状态：跟随系统时以系统为准
export function isDark() {
  return currentFollowSystem() ? systemPrefersDark() : currentDark();
}

function setVar(name, value) {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty(name, value);
    }
  } catch (e) {
    /* App 端逻辑层没有 document，走根节点 class 通道 */
  }
}

// 本地路径 → 可直接写进 CSS url() 的地址（App 端需要转换 _doc/ 这类相对路径）
function cssImageUrl(path) {
  let p = String(path || '');
  if (!p) return '';
  if (/^(file:|blob:|data:|https?:)/i.test(p)) return p;
  try {
    if (typeof plus !== 'undefined' && plus.io && typeof plus.io.convertLocalFileSystemURL === 'function') {
      p = plus.io.convertLocalFileSystemURL(p) || p;
    }
  } catch (e) {}
  return p;
}

function applyAccent(key, dark) {
  const a = findIn(ACCENTS, key);
  if (dark) {
    setVar('--brand', a.mainDark || a.main);
    setVar('--brand-strong', a.strongDark || a.strong);
    setVar('--brand-rgb', a.rgbDark || a.rgb);
  } else {
    setVar('--brand', a.main);
    setVar('--brand-strong', a.strong);
    setVar('--brand-rgb', a.rgb);
  }
  return a;
}

/**
 * 背景解析：预设查表，自定义色现算。
 * 返回 { key, name, css, solid }，css / solid 已经是"当前深浅模式该用的那一档"。
 * 所有消费方（CSS 变量、原生窗体底色、根节点 inline）都从这里取，避免各算各的。
 */
export function backgroundOf(key, dark) {
  if (key === CUSTOM_KEY) return customBackground(dark);
  const item = findIn(BACKGROUNDS, key);
  return {
    key: item.key,
    name: item.name,
    css: dark ? (item.darkCss || DARK_BG_CSS) : item.css,
    solid: dark ? (item.darkSolid || DARK_BG) : item.solid
  };
}

// 自定义色 → 同色相的浅渐变。纯色铺满会很"死"，两头的轻微明暗差给它一点方向感，
// 幅度压得很小（±7%），不会把用户挑的颜色改得认不出来。
function customBackground(dark) {
  const hex = currentCustomColor() || DEFAULT_CUSTOM;
  const base = dark ? color.darkVariant(hex) : hex;
  return {
    key: CUSTOM_KEY,
    name: CUSTOM_NAME,
    css: 'linear-gradient(165deg, ' + color.shade(base, 0.07) + ' 0%, ' + base + ' 52%, ' + color.shade(base, -0.09) + ' 100%)',
    solid: base
  };
}

// 背景：图片 → 原图 + 蒙版；预设 → 渐变；深色 → 深灰底（图片仍可用，蒙版换成黑色降亮度）
function applyBackground(key, image, mask, blur, dark) {
  const bg = backgroundOf(key, dark);
  const a = Math.max(0, Math.min(0.8, Number(mask) || 0));
  const b = Math.max(0, Math.min(24, Number(blur) || 0));
  const maskColor = maskColorOf(dark, a);

  if (image) {
    const url = cssImageUrl(image);
    setVar('--app-bg', 'url("' + url + '") center center / cover no-repeat fixed');
    setVar('--app-bg-mask', maskColor);
    setVar('--app-bg-blur', b + 'px');
  } else {
    // 深色也用用户选的那一档，只是换成压暗后的同款变体 —— 换背景立刻能看到差别
    // （整幅渐变，不再叠蒙版；淡化/模糊只对"背景图"有意义）
    setVar('--app-bg', bg.css);
    setVar('--app-bg-mask', 'transparent');
    setVar('--app-bg-blur', '0px');
  }

  // 原生窗体底色 + 状态栏文字颜色（App 端 overscroll / 状态栏不会跟着 CSS 变）
  const nativeBg = image ? (dark ? DARK_BG : LIGHT_BG) : bg.solid;
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.setBackgroundColor === 'function') {
      uni.setBackgroundColor({ backgroundColor: nativeBg, backgroundColorTop: nativeBg, backgroundColorBottom: nativeBg });
    }
  } catch (e) {
    /* 部分端不支持，忽略 */
  }
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.setNavigationBarColor === 'function') {
      uni.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: nativeBg });
    }
  } catch (e) {
    /* 部分端不支持，忽略 */
  }
  // 底部系统导航条那条白的根源（见函数注释）：窗口级 navigationBarColor 跟背景走
  syncNavBarColor(nativeBg);
  return bg;
}

// ---------- 底部系统导航条 / 手势区的真实高度（--safe-b） ----------
// App 端 webview 是通铺到屏幕底的（float-tabbar 探针 screen==window），
// 系统导航条画在 webview **上面**：env(safe-area-inset-bottom) 在不少 Android
// webview 里恒为 0 —— 靠它让位，卡片滑到最底会钻进导航条底下被切掉
// （2026-10-16 真机："底部那条染成背景色后开始遮挡卡片"）。
// 这里用系统信息算真实 inset，经 rootStyle() 以 --safe-b 下发；
// 消费方一律 max(env(...), var(--safe-b, 0px))：env 报对了用它，报 0 用实测值。
let _safeB = -1;
function safeInsetPx() {
  if (_safeB >= 0) return _safeB;
  _safeB = 0;
  // ⚠️ 下面这段只在**第一次**跑（后面都走缓存）→ 屏幕尺寸变了必须走
  //    resetSafeInset() 清掉缓存再算，否则拿到的是旧屏幕的导航条高度
  //    （横竖屏切换 / 折叠屏展开 / 分屏：见 theme-mixin 的 onResize）。
  let sys = null;
  try {
    if (typeof uni !== 'undefined' && uni.getSystemInfoSync) sys = uni.getSystemInfoSync() || null;
  } catch (e) {
    // 拿不到系统信息就保持 0：env() 那条还在兜底
    console.warn('[theme] safeInsetPx sysinfo failed:', e);
  }
  let diag = '';
  if (sys) {
    // 首选 safeArea：bottom 之下就是系统条/手势区
    if (sys.safeArea && sys.screenHeight) {
      _safeB = Math.max(0, (sys.screenHeight - sys.safeArea.bottom) || 0);
      diag = 'screenHeight=' + sys.screenHeight + ' safeArea.bottom=' + sys.safeArea.bottom;
    }
    // 兜底 safeAreaInsets（部分机型只给这个）
    if (!_safeB && sys.safeAreaInsets && sys.safeAreaInsets.bottom) {
      _safeB = sys.safeAreaInsets.bottom;
      diag = 'safeAreaInsets.bottom=' + sys.safeAreaInsets.bottom;
    }
  }
  // ⚠️ 有 ROM 的 safeArea 会报出离谱的脏数据（2026-10-16 真机：inset≈270px，
  // 悬浮胶囊被顶到屏幕中段、hero 内容整体偏上）。真实导航条/手势区不可能
  // 超过屏幕高的 8%（且 ≤96px）—— 超限一律视为脏数据丢弃，退回 env() 兜底，
  // 并把原始值打进控制台（下次再飘还能看到是哪个字段报的）。
  const cap = Math.min(96, Math.round(((sys && sys.screenHeight) || 800) * 0.08));
  if (_safeB > cap) {
    console.warn('[theme] safe-b 超限丢弃: ' + _safeB + 'px（cap=' + cap + 'px，' + diag + '）');
    _safeB = 0;
  }
  return _safeB;
}
// 屏幕尺寸变了要清一次缓存：safeInsetPx 是按"当时那块屏幕"算的，屏高 / safeArea
// 一变（横竖屏切换、折叠屏展开、分屏）旧值就失效了 —— 要么让位过头（胶囊浮在中间），
// 要么让位不够（卡片钻进导航条）。清掉后下次 rootStyle() 会重算。
export function resetSafeInset() {
  _safeB = -1;
}

// 统一应用（主题色 + 背景 + 深色）
export function apply() {
  const dark = isDark();
  applyAccent(currentAccent(), dark);
  applyBackground(current(), currentBgImage(), currentMask(), currentBlur(), dark);
  // App 端：原生容器与状态栏都跟着走，否则 CSS 变深了、原生部分还是浅的
  syncNativeUiStyle(nativeUiStyleFor());
  syncStatusBarStyle(dark);
  // H5 同步一份到 documentElement 上的 class，保证 html/body 与页面一致
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const cl = document.documentElement.classList;
      if (dark) cl.add('app-dark');
      else cl.remove('app-dark');
    }
  } catch (e) {}
  // 运行期切主题时，页面的根节点 class / style 也要重算（它们由 mixin 持有，不会自己变）
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.$emit === 'function') uni.$emit('theme:change');
  } catch (e) {}
  return dark;
}

export function setAccent(key) {
  const a = findIn(ACCENTS, key);
  try {
    settings.set({ theme: { accent: a.key } });
  } catch (e) {}
  apply();
  return a;
}

export function setBackground(key) {
  // 'custom' 不在 BACKGROUNDS 表里（它是现算的），别被 findIn 兜底成 default
  const k = key === CUSTOM_KEY ? CUSTOM_KEY : findIn(BACKGROUNDS, key).key;
  try {
    settings.set({ theme: { background: k, bgImage: '' } });
  } catch (e) {}
  apply();
  return backgroundOf(k, isDark());
}

/**
 * 挑一个自定义底色：等于"选了这个颜色"，所以顺手切到 custom 档并清掉背景图，
 * 不用用户再点一次。颜色不合法就什么都不改（返回当前值）。
 */
export function setCustomColor(hex) {
  const c = color.normalizeHex(hex);
  if (!c) return currentCustomColor();
  try {
    settings.set({ theme: { background: CUSTOM_KEY, bgColor: c, bgImage: '' } });
  } catch (e) {}
  apply();
  return c;
}

export function setMask(v) {
  const n = Math.max(0, Math.min(0.8, Number(v) || 0));
  try {
    settings.set({ theme: { bgMask: n } });
  } catch (e) {}
  apply();
  return n;
}

// 背景模糊（0-24px）：盖在背景之上的蒙版层用 backdrop-filter 实现，
// 不支持 backdrop-filter 的端自动退化为"只有淡化没有模糊"。
export function setBlur(v) {
  const n = Math.max(0, Math.min(24, Number(v) || 0));
  try {
    settings.set({ theme: { bgBlur: n } });
  } catch (e) {}
  apply();
  return n;
}

export function setDark(v) {
  const n = !!v;
  try {
    settings.set({ theme: { dark: n } });
  } catch (e) {}
  apply();
  return n;
}

export function setFollowSystem(v) {
  const n = !!v;
  try {
    // 先把容器切到 auto，再读系统值 —— 否则读到的还是上一次手动写死的 light/dark
    if (n) syncNativeUiStyle('auto');
    // 跟随系统：把当前系统值落到 dark 上，关掉跟随时从这个值继续
    settings.set({ theme: { followSystem: n, dark: systemPrefersDark() } });
  } catch (e) {}
  apply();
  return n;
}

// 蒙版颜色：浅色下用白（提亮 / 淡化），深色下用黑（降亮度）
export function maskColorOf(dark, mask) {
  const a = Math.max(0, Math.min(0.8, Number(mask) || 0));
  return dark ? 'rgba(8, 10, 9, ' + a + ')' : 'rgba(255, 255, 255, ' + a + ')';
}

// ---------- 画质档位 → CSS 变量 / class ----------
// 三个维度（毛玻璃 / 动效 / 阴影）由 utils/perf.js 算好写进
// settings.performance.fx 后下发。**这里不 import perf.js** —— perf 依赖 theme
// 做 setSmooth，反向依赖会成环；theme 只读结果，各写各的。
// 没有 fx（老数据 / 还没探测过）时一律用 full + 8/12px，观感与改造前完全一致。
export function currentFx() {
  let fx = null;
  try {
    fx = (settings.get().performance || {}).fx;
  } catch (e) {
    fx = null;
  }
  fx = fx || {};
  const sm = Number(fx.blurSm);
  const lg = Number(fx.blurLg);
  // 注意 maxBgBlur 的"缺失"判定只能用 == null：**0 是合法且最严格的档位**
  // （轻量 / 极简档就是 0），用 > 0 判断会把它误当成没设置而兜底成 24 —— 那样
  // 在轻量档把毛玻璃改回"全部"时卡片会重新模糊，等于档位失效。
  const maxBg = fx.maxBgBlur == null ? 24 : Number(fx.maxBgBlur);
  return {
    glass: fx.glass || 'full',
    motion: fx.motion || 'full',
    shadow: fx.shadow || 'full',
    // 半径同样只能按"是不是 NaN"来判断缺失：0 是合法值（轻量 / 极简档），
    // 用 > 0 会把 0 兜底成 8/12，让档位在这里悄悄失效
    blurSm: isNaN(sm) ? 8 : sm,
    blurLg: isNaN(lg) ? 12 : lg,
    maxBgBlur: isNaN(maxBg) ? 24 : maxBg
  };
}

// 毛玻璃的整条 filter 值。
// 下发 none 而不是 blur(0px)：后者照样建立 backdrop root 并逐帧读回背景像素，
// 只有 none 才是真的不参与绘制（这是本项目踩过的坑，别改回去）。
function glassFilter(px, mode) {
  if (mode === 'off' || mode === 'key') return 'none';
  if (!(px > 0)) return 'none';
  return 'blur(' + px + 'px) saturate(180%)';
}

// ---------- 页面根节点用（App 端没有 DOM，只能靠 Vue 渲染 class / style） ----------
export function rootClass() {
  const dark = isDark();
  const fx = currentFx();
  // app-root 挂背景层与蒙版层（见 App.vue）；app-dark 提供深色档的中性色令牌；
  // acc-* 提供 App 端的主色深色档（App 逻辑层没有 DOM，写不了 CSS 变量）；
  // perf-smooth 为流畅模式，由 App.vue 的全局样式统一关掉 backdrop-filter；
  // fx-* 是画质档位的三个维度，同样交给 App.vue 的全局样式消费。
  let cls = 'app-root ';
  if (dark) cls += 'app-dark ';
  if (currentSmooth()) cls += 'perf-smooth ';
  cls += 'fx-glass-' + fx.glass + ' ';
  cls += 'fx-motion-' + fx.motion + ' ';
  cls += 'fx-shadow-' + fx.shadow + ' ';
  // 没有自定义背景图 → 背景是平滑渐变：渐变本身就是低频信号，"模糊后的渐变"
  // 和"原渐变"肉眼看不出差别，但 backdrop-filter 会在滚动时逐帧重算每张卡片
  // 区域的高斯模糊（卡片数量多、面积大，是掉帧的主因）。所以直接关掉卡片的模糊，
  // 只保留半透明 —— 层次感不变，绘制成本归零。顶栏 / 底栏 / 弹窗见 App.vue 的例外。
  if (!currentBgImage()) cls += 'bg-flat ';
  return cls + 'acc-' + currentAccent();
}

// 根节点 inline style：背景 + 蒙版 + 模糊
//   背景必须 background-attachment: fixed —— 滚动时背景钉在视口上不动，只有窗体在动。
//   蒙版 / 模糊用 CSS 变量下发，App.vue 的 .app-root::before 消费（App 端没有 document，
//   只能走 inline style；伪元素会继承宿主元素的自定义属性，所以这条路两端都通）。
export function rootStyle() {
  const dark = isDark();
  const fx = currentFx();
  // 两层上限叠加，取更严的那个：
  //   ① 流畅模式 / 省电档 → 直接归 0（全屏 backdrop-filter 是最贵的一项）
  //   ② 画质档位 → 各档有自己的上限（高画质 24 / 均衡 16 / 轻量与极简 0）
  const cap = currentSmooth() ? 0 : Math.min(24, fx.maxBgBlur);
  const bn = Math.max(0, Math.min(cap, Number(currentBlur()) || 0));
  // 写成完整的 filter 值而不是 "0px"：backdrop-filter: blur(0px) 依然会建立
  // backdrop root 并逐帧读取背景，只有 none 才是真的不参与绘制。
  const b = bn > 0 ? ('blur(' + bn + 'px)') : 'none';
  const image = currentBgImage();
  const bg = backgroundOf(current(), dark);
  const solid = image ? (dark ? DARK_BG : LIGHT_BG) : bg.solid;
  // 深色也用所选那一档的压暗变体，保证"换背景"在任何模式下都立即可见
  const bgCss = bg.css;

  // 两条通道写同一份背景：
  //   ① inline background（+ fixed）直接画在根节点上 —— 不依赖 CSS 变量，兜底最稳
  //   ② --bg-color / --bg-img 交给 App.vue 里 fixed 的 .app-root::before —— 滚动时绝对不动
  //   两条都在，谁生效都一样；② 生效时蒙版层才好在它之上做淡化与模糊。
  const style = {
    // background-attachment: fixed 在 Android WebView 上会强制主线程逐帧重绘背景，
    // 是已知的滚动掉帧源。背景本来就有 fixed 的伪元素层（见 App.vue）在画，
    // 根节点这份只是兜底 —— 流畅模式下让它随内容滚，观感一致、开销归零。
    backgroundAttachment: currentSmooth() ? 'scroll' : 'fixed',
    '--bg-color': solid,
    '--bg-img': image ? 'url("' + cssImageUrl(image) + '")' : (/gradient/.test(bgCss) ? bgCss : 'none'),
    '--bg-mask': maskColorOf(dark, currentMask()),
    '--bg-blur': b,
    // 底部系统条 / 手势区的真实高度：Android webview 常报 env()=0，
    // 但导航条实实在在画在 webview 上面 —— 底部让位必须用它兜（见 safeInsetPx 注释）
    '--safe-b': safeInsetPx() + 'px',
    // 窗体的毛玻璃：两档半径（卡片级 sm / 顶栏底栏弹窗级 lg）。
    // 全项目 120 多处 backdrop-filter 都写成 var(--glass-sm, 原值)，所以改档位
    // 只需要改这两个变量，不必碰任何一个组件。带了原值兜底：万一某端没继承到
    // 变量（App 端样式隔离的情况），观感自动退回改造前的样子。
    '--glass-sm': glassFilter(fx.blurSm, fx.glass),
    '--glass-lg': glassFilter(fx.blurLg, fx.glass),
    // 首页抽屉底板专用：面积大得多（整摞卡一整块），卡片那档 12px 糊不出
    // "隔着一层玻璃"的感觉，所以要更狠；但仍按 lg 等比缩放 → 轻量 / 极简档
    // 自动跟着变淡，glass:off 也照样退回 none（跟上面两档同一套开关）。
    '--glass-sheet': glassFilter(Math.min(30, Math.round(fx.blurLg * 1.7)), fx.glass),
    // 字体与密度：AI 指令 theme.set 改的就是这两个，靠变量下发才有实际观感
    '--app-font': FONT_STACKS[currentFont()] || FONT_STACKS.system,
    '--app-gap': DENSITY_GAP[currentDensity()] || DENSITY_GAP.cozy
  };
  style.backgroundColor = solid;
  if (image) {
    style.backgroundImage = 'url("' + cssImageUrl(image) + '")';
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center center';
    style.backgroundRepeat = 'no-repeat';
  } else if (/gradient/.test(bgCss)) {
    style.backgroundImage = bgCss;
  }
  return style;
}

// 从相册选图作为背景（落到本地后再记录路径）
export function chooseBackgroundImage() {
  return new Promise((resolve) => {
    try {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album'],
        success: (res) => {
          const tmp = res && res.tempFilePaths && res.tempFilePaths[0];
          if (!tmp) { resolve(null); return; }
          persistImage(tmp).then((saved) => {
            try {
              settings.set({ theme: { bgImage: saved } });
            } catch (e) {}
            apply();
            resolve(saved);
          });
        },
        fail: () => resolve(null)
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function persistImage(tmp) {
  return new Promise((resolve) => {
    try {
      if (typeof uni !== 'undefined' && uni && typeof uni.saveFile === 'function') {
        uni.saveFile({
          tempFilePath: tmp,
          success: (r) => resolve((r && r.savedFilePath) || tmp),
          fail: () => resolve(tmp)
        });
        return;
      }
    } catch (e) {}
    resolve(tmp);
  });
}

export function clearBgImage() {
  try {
    settings.set({ theme: { bgImage: '' } });
  } catch (e) {}
  apply();
}

// 启动时调用：恢复上次选择的外观，并监听系统主题变化
export function init() {
  apply();
  // plus 可能晚于本次 apply 才就绪：那时 syncNavBarColor 的守卫会直接 return，
  // 窗口级同步（底部导航条底色）就永远差这一次 → 补刷，否则白条修不掉。
  // #ifdef APP-PLUS
  try {
    if (typeof plus === 'undefined' && typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('plusready', () => { try { apply() } catch (e) {} }, { once: true });
    }
  } catch (e) {}
  // #endif
  initStatusBarVar();
  watchSystemTheme();
  return {
    accent: currentAccent(),
    background: current(),
    // 自定义底色（custom 档才有效，其余为空串）
    bgColor: currentCustomColor(),
    image: currentBgImage(),
    dark: isDark(),
    followSystem: currentFollowSystem()
  };
}

// 系统主题在应用运行期间切换（Android 10+ / H5）时自动跟随
// App 端前提：manifest 开了 darkmode 且容器已 setUIStyle('auto')，否则回调不会来
function watchSystemTheme() {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.onThemeChange === 'function') {
      uni.onThemeChange((res) => {
        if (!currentFollowSystem()) return;
        // 回调自带 theme 时直接落盘，省一次系统读取（关掉跟随时从这个值继续）
        if (res && (res.theme === 'dark' || res.theme === 'light')) {
          try {
            settings.set({ theme: { dark: res.theme === 'dark' } });
          } catch (e) {}
        }
        apply();
      });
    }
  } catch (e) {
    /* 继续尝试 H5 的 matchMedia */
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentFollowSystem()) apply();
      });
    }
  } catch (e) {
    /* 忽略 */
  }
}

// --status-bar-height 在个别端缺失时，用系统信息补一个，避免自定义顶栏被状态栏压住
export function initStatusBarVar() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const el = document.documentElement;
    let cur = '';
    try {
      if (typeof getComputedStyle === 'function') {
        cur = getComputedStyle(el).getPropertyValue('--status-bar-height') || '';
      }
    } catch (e) {
      cur = '';
    }
    if (cur && String(cur).trim() && String(cur).trim() !== '0px') return;
    let h = 0;
    try {
      const info = uni.getSystemInfoSync();
      h = (info && info.statusBarHeight) || 0;
    } catch (e) {
      h = 0;
    }
    el.style.setProperty('--status-bar-height', h + 'px');
  } catch (e) {
    /* 忽略 */
  }
}
