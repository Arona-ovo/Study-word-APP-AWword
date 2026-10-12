// _tools/check-smooth.js - 「流畅模式」开关校验（只读 + 内存 storage）
//
// 为什么要有这个开关：
//   App 端唯一的真绘制热点是 backdrop-filter —— 每一帧都要把窗体背后的区域
//   重新做一次高斯模糊（背景层那层是全屏的，最贵）。但毛玻璃又正是这套
//   "半透明玻璃"观感的来源，一刀切关掉等于砍掉设计语言。
//   所以做成开关：默认关（保留高级感），低端机自己打开换流畅度。
//
// 本脚本守四条契约：
//   1) 默认关闭 —— 不开就与改造前完全一致
//   2) 开关能持久化，且立刻反映到根节点 class
//   3) 开启后背景模糊强制归 0（全屏模糊是最贵的一项）
//   4) CSS 覆盖必须够强：用通配 + 伪元素 + !important，盖住散落在各页的硬编码 blur
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const mem = {};
const bgCalls = [];
let cssVars = {};

global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getSystemInfoSync: () => ({ statusBarHeight: 24, theme: 'light' }),
  setBackgroundColor: (o) => { bgCalls.push(o && o.backgroundColor); },
  setNavigationBarColor: () => {},
  onThemeChange: () => {},
  chooseImage: (o) => { o && o.success && o.success({ tempFilePaths: ['/tmp/p.png'] }) },
  saveFile: (o) => { o && o.success && o.success({ savedFilePath: '_doc/bg/p.png' }) }
};
global.window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };
global.document = {
  documentElement: { style: { setProperty: (k, v) => { cssVars[k] = v; } } }
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir, ext, out) => {
  out = out || [];
  fs.readdirSync(dir).forEach((n) => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n === 'node_modules' || n === 'unpackage' || n === '.hbuilderx') return;
      walk(p, ext, out);
    } else if (n.endsWith(ext)) out.push(p);
  });
  return out;
};

const settings = load('utils/settings.js');
settings.init();
const color = load('utils/color.js');
const theme = load('utils/theme.js', { settings, color });

(async () => {
  console.log('== 1. 默认值：流畅模式默认关闭 ==');
  // 默认关 → 不开就与改造前行为完全一致，不影响已有的毛玻璃观感
  eq(settings.defaults().performance.smooth, false, 'settings.defaults().performance.smooth');
  eq(theme.currentSmooth(), false, '初始 currentSmooth()');

  console.log('== 2. 开关可持久化 ==');
  eq(theme.setSmooth(true), true, 'setSmooth(true) 返回 true');
  eq(theme.currentSmooth(), true, '开启后 currentSmooth() = true');
  eq(settings.get().performance.smooth, true, '已写入 settings');
  // 换一个"读取器"重新从 storage 加载，验证真的落盘了
  const settings2 = load('utils/settings.js');
  settings2.init();
  const theme2 = load('utils/theme.js', { settings: settings2, color });
  eq(theme2.currentSmooth(), true, '重新加载后仍是 true（确实持久化）');
  eq(theme2.setSmooth(false), false, 'setSmooth(false) 返回 false');
  eq(theme2.currentSmooth(), false, '关闭后 currentSmooth() = false');

  console.log('== 3. 根节点 class 跟随开关 ==');
  eq(/\bapp-root\b/.test(theme2.rootClass()), true, '始终带 app-root');
  eq(/perf-smooth/.test(theme2.rootClass()), false, '关闭时不带 perf-smooth');
  theme2.setSmooth(true);
  eq(/perf-smooth/.test(theme2.rootClass()), true, '开启时带 perf-smooth');
  // 深色 + 流畅模式可以叠加，互不覆盖
  theme2.setDark(true);
  const cls = theme2.rootClass();
  eq(/perf-smooth/.test(cls) && /app-dark/.test(cls), true, '深色 + 流畅模式可共存：' + cls);
  theme2.setSmooth(false);
  theme2.setDark(false);

  console.log('== 4. 流畅模式下背景模糊强制归零 ==');
  // 注意：下发的是完整的 filter 值而不是裸像素 —— backdrop-filter: blur(0px) 依然会
  // 建立 backdrop root 并逐帧读背景，只有 none 才是真的不参与绘制。
  theme2.setBlur(16);
  const stBlur = theme2.rootStyle();
  eq(stBlur['--bg-blur'], 'blur(16px)', '关闭时 --bg-blur 跟随设置（完整 filter 值）');
  theme2.setSmooth(true);
  eq(theme2.rootStyle()['--bg-blur'], 'none', '开启后 --bg-blur 被强制为 none（不是 0px）');
  theme2.setSmooth(false);
  eq(theme2.rootStyle()['--bg-blur'], 'blur(16px)', '关闭后恢复原设置值（未被抹掉）');
  theme2.setBlur(0);
  eq(theme2.rootStyle()['--bg-blur'], 'none', '模糊设为 0 时同样下发 none');

  console.log('== 5. CSS 覆盖强度（必须能盖住各页硬编码的 blur）==');
  const app = read('App.vue');
  assert(/\.perf-smooth\s*\*/.test(app), '通配后代选择器：覆盖任意元素上的 backdrop-filter');
  assert(/\.perf-smooth\s*\*::before/.test(app) && /\.perf-smooth\s*\*::after/.test(app),
    '后代伪元素：* 匹配不到伪元素，必须单独写');
  assert(/\.perf-smooth::before/.test(app) && /\.perf-smooth::after/.test(app),
    '根节点自身伪元素：背景层的蒙版模糊（.app-root::after）在这里被关掉');
  const block = (app.match(/\/\* ===== 流畅模式[\s\S]*?\*\/([\s\S]*?)\n\n/) || [])[1] || '';
  assert(/backdrop-filter:\s*none\s*!important/.test(block), 'backdrop-filter 用 none + !important');
  assert(/-webkit-backdrop-filter/.test(block), '保留 -webkit- 前缀（App webview 需要）');
  assert(/\.perf-smooth\s+\.card/.test(app) && /\.perf-smooth\s+\.pop-card/.test(app),
    '卡片 / 弹窗在流畅模式下调实表面，补偿失去模糊后的可读性');

  console.log('== 6. 项目里所有 backdrop-filter 都被覆盖到 ==');
  // 覆盖靠的是通配选择器，所以只要确认：
  //   (a) 覆盖块里同时写了「元素」与「伪元素」两种形态
  //   (b) 覆盖块出现在 App.vue 全局样式里（非条件编译块内）
  const appIdx = app.indexOf('/* ===== 流畅模式');
  const perfIdx = app.indexOf('.perf-smooth');
  assert(appIdx >= 0 && perfIdx > appIdx, '覆盖块位于「流畅模式」注释之后');
  // 覆盖块不能落在 #ifdef 里，否则某个端不生效
  const beforeBlock = app.slice(0, appIdx);
  const openIf = (beforeBlock.match(/\/\* #ifdef/g) || []).length;
  const closeIf = (beforeBlock.match(/\/\* #endif \*\//g) || []).length;
  eq(openIf, closeIf, '覆盖块不在任何 #ifdef 条件编译块内');

  console.log('== 7. 设置页接入 ==');
  const set = read(path.join('pkgManage', 'pages', 'settings', 'settings.vue'));
  assert(/data-k="perf"/.test(set), '有「流畅模式」分组');
  assert(/@change="onSmooth"/.test(set), '有流畅模式开关');
  assert(/onSmooth\(e\)/.test(set), '有 onSmooth 处理方法');
  assert(/currentSmooth/.test(set), '引入 currentSmooth');

  console.log('== 8. 流畅模式不改数据、不改功能 ==');
  // setSmooth 只写 performance，不动 mastery / wrong / favorites / ai
  const before = JSON.stringify({
    m: settings2.get().home, w: settings2.get().privacy, a: settings2.get().ai
  });
  theme2.setSmooth(true);
  const after = JSON.stringify({
    m: settings2.get().home, w: settings2.get().privacy, a: settings2.get().ai
  });
  eq(after, before, '开关前后 home / privacy / ai 配置不变');

  console.log('');
  console.log(fail === 0 ? '流畅模式校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
