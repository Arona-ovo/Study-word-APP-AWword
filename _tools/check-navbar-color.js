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
assert(/addFlags\(0x80000000\)/.test(fnBody),
  '加 FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS（不设这个 flag，setNavigationBarColor 不生效）');
assert(/importClass\('android\.graphics\.Color'\)/.test(fnBody) && /Color\.parseColor/.test(fnBody),
  'importClass 拿 android.graphics.Color 再 parseColor');
assert(/win\.setNavigationBarColor\(/.test(fnBody), '最终落到窗口 setNavigationBarColor');
assert(/syncNavBarColor\(nativeBg\)/.test(code),
  'applyBackground 里传 nativeBg（与 setBackgroundColor 同源：浅/深兜底都在那算好了）');
{
  // 调用顺序：必须在 setNavigationBarColor 之后、return 之前，别插到函数中间
  const iBg = code.indexOf('uni.setBackgroundColor');
  const iNav = code.indexOf('uni.setNavigationBarColor');
  const iSync = code.indexOf('syncNavBarColor(nativeBg)');
  assert(iBg > 0 && iNav > 0 && iSync > iNav && iSync > iBg, '调用点在两个 uni.* 之后（同一段原生同步逻辑里）');
}
{
  // #ifdef 在函数体内（晚于函数名出现），所以取"函数头到第一个 #endif"这一段
  const iDef = src.indexOf('#ifdef APP-PLUS', fnStart);
  const iEnd = src.indexOf('#endif', fnStart);
  assert(iDef > fnStart && iEnd > iDef, '函数体内被 #ifdef APP-PLUS / #endif 包住（只在 App 端编译）');
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

console.log(fail === 0 ? '\n导航条底色同步全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
