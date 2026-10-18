// _tools/check-navbar-color.js - 底部系统导航条底色同步（App 端）
//
// 背景：webview 只铺到页面底边为止，再往下那一条（手势条 / 三大金刚键区域）
// 是**系统**画的，颜色由窗口的 navigationBarColor 决定。DCloud 默认不设，
// 系统就画纯白 —— 换壁纸、切深色都不跟（2026-10-16 真机反馈：
// "底部切换栏底下永远是白的"）。
// theme.js 的 syncNavBarColor 负责把这块底色同步成当前背景的实色兜底。
//
// 断言分两层：
//   源码契约（先剥注释再扫，防注释里的同名调用造成假绿）
//   + 行为（plus.android 桩 + 错误形态：抛异常 / plus.android 缺失都不能炸）
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

console.log('== 1. 源码契约（剥注释后扫描） ==');
const src = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'utils', 'theme.js'), 'utf8')
  .replace(/\r\n/g, '\n');
// 剥两种注释再扫：否则注释里提到 setNavigationBarColor 也会"通过"
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fnStart = code.indexOf('function syncNavBarColor');
assert(fnStart >= 0, 'theme.js 定义了 syncNavBarColor');
const fnBody = fnStart >= 0 ? code.slice(fnStart, code.indexOf('\n}', fnStart)) : '';
assert(/typeof plus === 'undefined' \|\| !plus\.android/.test(fnBody),
  '调用前判 plus 与 plus.android 存在（H5 / 小程序端不会走进来）');
assert(/try\s*{/.test(fnBody) && /catch/.test(fnBody), '整段包 try/catch（个别 ROM 不给权限也不能炸主线程）');
assert(/runtimeMainActivity\(\)/.test(fnBody) && /getWindow\(\)/.test(fnBody), '走 plus.android.runtimeMainActivity 取窗口');
// plus.android 桥接规矩：方法调用拿到的 Java 对象必须先 importClass 才能调它的方法。
// 漏了 importClass(main)/importClass(win) 会在 addFlags 处抛异常被 try 吞掉 →
// 表现是"改了等于没改"（2026-10-16 真机白条还在的原因之一）。
assert(/importClass\(main\)/.test(fnBody) && /importClass\(win\)/.test(fnBody),
  '对 main / win 先 importClass（否则调它们的方法直接抛异常，被 try 吞掉等于没改）');
const flagsAt = fnBody.indexOf('addFlags(0x80000000)');
const impAt = fnBody.indexOf('importClass(win)');
assert(flagsAt >= 0 && impAt >= 0 && impAt < flagsAt,
  'importClass(win) 在 addFlags 之前（顺序反了照样抛异常）');
assert(/addFlags\(0x80000000\)/.test(fnBody),
  '加 FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS（不设这个 flag，setNavigationBarColor 不生效）');
assert(/console\.warn\(/.test(fnBody),
  'catch 里要 console.warn（不能完全静默：基座控制台要能看到失败原因）');
// plus 晚于 apply 就绪时（启动时序），syncNavBarColor 会被守卫挡掉 → 必须补刷一次。
assert(/plusready/.test(code),
  'theme.init 里挂 plusready 补刷 apply（plus 晚就绪时窗口级同步不能漏掉）');

console.log('== 1.5 底部遮挡：env()=0 时用实测 --safe-b 让位 ==');
// webview 通铺到屏幕底、系统导航条画在它上面；Android webview 常报 env()=0 →
// 底部让位必须拿实测 inset（safeInsetPx）兜，否则卡片滑到最底被导航条切掉。
assert(/--safe-b/.test(code) && /safeInsetPx/.test(code) && /safeArea/.test(code),
  'theme.js 用 safeArea 算真实底部 inset，经 rootStyle 下发 --safe-b');
// 有 ROM 的 safeArea 会报出离谱的脏数据（真机出现过 inset≈270px：胶囊被顶到
// 屏幕中段）。必须有合理性上限（≤96px 且 ≤屏幕高的 8%），超限丢弃并 console.warn
// 原始值 —— 否则脏数据直接进 --safe-b，胶囊/内容被顶飞，且无从排查。
assert(/Math\.min\(96,\s*Math\.round\(\(\(sys && sys\.screenHeight\) \|\| 800\) \* 0\.08\)\)/.test(code),
  'safeInsetPx 有封顶：min(96px, 屏幕高的 8%)（脏 safeArea 不许进 --safe-b）');
assert(/safe-b 超限丢弃/.test(code) && /_safeB = 0;\s*\}\s*return _safeB;/.test(code.replace(/\r\n/g, '\n')),
  '超限的 inset 丢弃为 0（退回 env() 兜底）并 console.warn 原始值');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'App.vue'), 'utf8');
assert(/padding-bottom:\s*calc\(220rpx \+ max\(env\(safe-area-inset-bottom\), var\(--safe-b, 0px\)\)\)/.test(appSrc),
  'App.vue .page-tabbar 底部让位用 max(env, var(--safe-b))');
const ftbSrc = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'components', 'float-tabbar', 'float-tabbar.vue'), 'utf8');
assert(/padding-bottom:\s*calc\(20rpx \+ max\(env\(safe-area-inset-bottom\), var\(--safe-b, 0px\)\)\)/.test(ftbSrc),
  'float-tabbar 胶囊自己也让位 max(env, var(--safe-b))（否则下半截被导航条压住）');
assert(/importClass\('android\.graphics\.Color'\)/.test(fnBody) && /Color\.parseColor/.test(fnBody),
  'importClass 拿 android.graphics.Color 再 parseColor');
assert(/win\.setNavigationBarColor\(/.test(fnBody), '最终落到窗口 setNavigationBarColor');
assert(/syncNavBarColor\(nativeBg\)/.test(code),
  'applyBackground 里传 nativeBg（与 setBackgroundColor 同源：浅/深兜底都在那算好了）');
{
  // 调用顺序：必须在 setNavigationBarColor 之后、return 之前，别插到函数中间。
  // ⚠️ 三个位置必须在**同一个函数体内**取：直接 code.indexOf 会抓到别的函数 / 注释里
  //    的同名调用（syncNavBarColor 自己体内就有 setNavigationBarColor），
  //    那样比出来的顺序是错的 —— 2026-10-17 变异测试抓到这条一直是假绿。
  const iFn = code.indexOf('function applyBackground');
  assert(iFn >= 0, 'theme.js 有 applyBackground（原生同步的调用方）');
  const fn = iFn >= 0 ? code.slice(iFn, code.indexOf('\n}', iFn)) : '';
  const iBg = fn.indexOf('uni.setBackgroundColor');
  const iNav = fn.indexOf('uni.setNavigationBarColor');
  const iSync = fn.indexOf('syncNavBarColor(nativeBg)');
  assert(iBg > 0 && iNav > 0 && iSync > iNav && iSync > iBg,
    '调用点在 applyBackground 里的两个 uni.* 之后（同一段原生同步逻辑里）');
}
{
  // #ifdef 在函数体内（晚于函数名出现），所以取"函数头到第一个 #endif"这一段
  const iDef = src.indexOf('#ifdef APP-PLUS', fnStart);
  const iEnd = src.indexOf('#endif', fnStart);
  assert(iDef > fnStart && iEnd > iDef, '函数体内被 #ifdef APP-PLUS / #endif 包住（只在 App 端编译）');
}

console.log('== 1.7 uni.setNavigationBarColor 的失败兜底（不许甩原始 errMsg 到控制台） ==');
// 2026-10-18 Web 版控制台一进来就刷两条 {errMsg: "setNavigationBarColor:fail page not found"}：
// 启动就 apply，可这条 API 要落到**当前页面实例**上 —— 页面还没建，uni 就回 "page not found"。
// 那时候没写 fail 回调，原始 errMsg 被直接打出来，看着像崩了（其实一点功能没少）。
// 契约：必须带 fail → 页面未就绪排一次补刷；真失败要中文 warn（不许完全静默）。
{
  const iApply = code.indexOf('function applyBackground');
  const applyBody = iApply >= 0 ? code.slice(iApply, code.indexOf('\n}', iApply)) : '';
  assert(/uni\.setNavigationBarColor\(navBarOptsWithFail\(navOpts\)\)/.test(applyBody),
    '调用走 navBarOptsWithFail（带 fail 回调，uni 不再把原始 errMsg 打到控制台）');
  const iHelper = code.indexOf('function navBarOptsWithFail');
  assert(iHelper >= 0, '有 navBarOptsWithFail helper');
  const helperBody = iHelper >= 0 ? code.slice(iHelper, code.indexOf('\n}', iHelper)) : '';
  assert(/fallback\.fail = function/.test(helperBody), '返回的对象上挂了 fail');
  assert(/page not found/.test(helperBody) && /setTimeout/.test(helperBody) && /uni\.setNavigationBarColor\(navBarOptsWithFail\(opts\)\)/.test(helperBody),
    '识别 page not found 并排一次迟到的补刷（页面起来后再染一次；补刷这条也带 fail）');
  assert(/console\.warn\(/.test(helperBody), '补刷仍失败 / 别的失败要 console.warn（ 不许完全静默）');
  // webview 没通铺到屏幕底时（浏览器窗口 / 没重排）：screenHeight − safeArea.bottom 不是系统条
  const iSafe = code.indexOf('function safeInsetPx');
  const safeBody = iSafe >= 0 ? code.slice(iSafe, code.indexOf('\n}', iSafe)) : '';
  assert(/lost > 96/.test(safeBody) && /return 0/.test(safeBody),
    'webview 没通铺到屏幕底时不算系统条 inset（浏览器窗口 lost 一二百 px，别再刷"超限丢弃"）');
}

console.log('== 2. 行为：换背景 / 深色模式都跟着走 ==');
const mem = {};
const flags = [];
let barColor = null;
let barThrow = false;
const win = {
  addFlags: (f) => { flags.push(f); },
  setNavigationBarColor: (c) => { if (barThrow) throw new Error('permission denied'); barColor = c; }
};
// plus 对象故意留在外部持有：待会儿要把 android 摘掉测"缺失时不能炸"
// parseColor 桩原样返回 hex：真机返回 int，这里要能断言"染的是哪个色"
const plusStub = {
  android: {
    runtimeMainActivity: () => ({ getWindow: () => win }),
    importClass: () => ({ parseColor: (s) => s })
  }
};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  getSystemInfoSync: () => ({ statusBarHeight: 24, theme: 'light' }),
  setBackgroundColor: () => {},
  setNavigationBarColor: () => {}
};
global.window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };
global.document = { documentElement: { style: { setProperty: () => {} } } };
global.plus = plusStub;

const settings = load('utils/settings.js');
settings.init();
const color = load('utils/color.js');
const theme = load('utils/theme.js', { settings, color, plus: plusStub });

{
  const sky = theme.setBackground('sky');
  assert(barColor === sky.solid, '切 sky → 导航条染成 ' + sky.solid + '（实际 ' + barColor + '）');
  assert(flags.indexOf(0x80000000) >= 0, 'addFlags 传了 FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS');
}
{
  theme.setDark(true);
  const expect = theme.backgroundOf(theme.current(), true).solid;
  assert(barColor === expect, '深色模式 → 导航条转深色兜底 ' + expect + '（实际 ' + barColor + '）');
  theme.setDark(false);
  const back = theme.backgroundOf(theme.current(), false).solid;
  assert(barColor === back, '切回浅色 → 导航条回到 ' + back + '（实际 ' + barColor + '）');
}
{
  // 背景图档：CSS 侧铺不了系统条，用浅色兜底色 —— 至少不是白的
  const bgCalls = [];
  global.uni.setBackgroundColor = (o) => { bgCalls.push(o && o.backgroundColor); };
  theme.setBackground('default');
  const def = theme.backgroundOf('default', false).solid;
  assert(barColor === def, '预设 default → 导航条 = ' + def);
}

console.log('== 3. 错误形态：原生调用失败 / plus.android 缺失都不能炸 ==');
{
  let threw = null;
  try { barThrow = true; theme.apply(); } catch (e) { threw = e; }
  assert(threw === null, 'setNavigationBarColor 抛异常时 apply() 不炸（实际：' + (threw && threw.message) + '）');
  barThrow = false;
}
{
  // 摘掉 plus.android：H5 / 小程序 / 非 Android 端就是这条路
  const saved = plusStub.android;
  plusStub.android = undefined;
  let threw = null;
  try { theme.apply(); } catch (e) { threw = e; }
  assert(threw === null, '没有 plus.android 时 apply() 不炸（实际：' + (threw && threw.message) + '）');
  plusStub.android = saved;
  theme.apply();
}
{
  // runtimeMainActivity 返回 null（极早期启动）：静默
  const saved = plusStub.android.runtimeMainActivity;
  plusStub.android.runtimeMainActivity = () => null;
  let threw = null;
  try { theme.apply(); } catch (e) { threw = e; }
  assert(threw === null, 'runtimeMainActivity() 为 null 时不炸');
  plusStub.android.runtimeMainActivity = saved;
}

console.log('== 4. setNavigationBarColor 报 page not found 时的补刷与降级 ==');
{
  // uni 这条 API 要落到**当前页面实例**上：启动就 apply 时页面还没建 → 回 "page not found"
  // （2026-10-18 Web 版控制台刷了两条原始 errMsg）。期望：不炸、不当场刷 warn（那是时序
  // 不是错误）、排一次补刷；页面起来后真的再染一次；补刷仍失败才 warn 出来。
  const navLog = [];
  const warns = [];
  const timers = [];
  const savedWarn = console.warn;
  const savedTimer = global.setTimeout;
  const savedNav = global.uni.setNavigationBarColor;
  console.warn = (m) => { warns.push(String(m)); };
  global.setTimeout = (fn, ms) => { timers.push({ fn: fn, ms: ms }); return 0; };
  global.uni.setNavigationBarColor = (o) => {
    navLog.push(o);
    if (o && typeof o.fail === 'function') o.fail({ errMsg: 'setNavigationBarColor:fail page not found' });
  };
  // ⚠️ 定时器必须**加载时注入**（lib/load 的 sandbox 在 createContext 那一刻就把
  //    setTimeout 快照进去了，事后改 global.setTimeout 不影响已经 load 好的模块 →
  //    只能带着桩 reload 一份）。
  const theme2 = load('utils/theme.js', {
    settings, color, plus: plusStub,
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return 0; }
  });
  let threw = null;
  try { theme2.apply(); } catch (e) { threw = e; }
  assert(threw === null, 'page not found 时 apply() 不炸（实际：' + (threw && threw.message) + '）');
  assert(navLog.length >= 1 && typeof navLog[0].fail === 'function', '调用带了 fail 回调（uni 不会再甩原始 errMsg）');
  assert(warns.length === 0, '第一次 page not found 不 warn（是时序问题，靠补刷解决）：' + warns.join(' | '));
  const later = timers.filter((t) => t.ms === 300);
  assert(later.length >= 1, '排了一次 300ms 后的补刷（页面建好后重试）');
  later.forEach((t) => t.fn());   // 手动"到点"
  assert(navLog.length >= 2, '补刷真的又调了一次 setNavigationBarColor（页面起来后颜色能落上）');
  assert(warns.length >= 1 && /page not found/.test(warns.join(' ')),
    '补刷仍失败 → 用中文 warn 出来（不许完全静默）');
  console.warn = savedWarn;
  global.setTimeout = savedTimer;
  global.uni.setNavigationBarColor = savedNav;
}

{
  // ⚠️ 只测 "page not found" 会让"真失败静默"变成假绿（2026-10-18 变异测试抓到）：
  //    那条兜底 warn 被删掉后脚本照样全绿 —— 所以失败形态必须两种都测。
  const warns2 = [];
  const timers2 = [];
  const savedWarn2 = console.warn;
  const savedNav2 = global.uni.setNavigationBarColor;
  const theme3 = load('utils/theme.js', {
    settings, color, plus: plusStub,
    setTimeout: (fn, ms) => { timers2.push({ fn: fn, ms: ms }); return 0; }
  });
  console.warn = (m) => { warns2.push(String(m)); };
  global.uni.setNavigationBarColor = (o) => {
    if (o && typeof o.fail === 'function') o.fail({ errMsg: 'setNavigationBarColor:fail not supported' });
  };
  let threw2 = null;
  try { theme3.apply(); } catch (e) { threw2 = e; }
  console.warn = savedWarn2;
  global.uni.setNavigationBarColor = savedNav2;
  assert(threw2 === null, '非 page not found 的失败同样不炸（实际：' + (threw2 && threw2.message) + '）');
  assert(warns2.some((w) => /setNavigationBarColor/.test(w)),
    '真失败要当场 warn 出来（不许完全静默）：' + warns2.join(' | '));
  assert(timers2.length === 0, '真失败不排补刷（重试也没用，别空转）');
}

console.log(fail === 0 ? '\n导航条底色同步全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
