// _tools/check-perf.js - 「App 端跟随系统深色模式」+「渲染开销 / 自动降级」校验（只读）
// 运行：node --experimental-strip-types _tools/check-perf.js
//
// 两条真实问题，一组脚本守住：
//   A. 跟随系统深色模式没反应
//      根因是 uni-app 的 App 端原生容器默认锁在 light：
//        ① manifest.json 的 app-plus 必须写 "darkmode": true，否则
//           uni.getSystemInfoSync().theme 恒为 undefined、uni.onThemeChange 不注册
//        ② 即使开了 darkmode，也要 plus.nativeUI.setUIStyle('auto') 让容器跟随系统
//        ③ 页面全是 custom 导航，状态栏文字色只能靠 plus.navigator.setStatusBarStyle
//      另外：运行期切主题时，根节点 class 由 mixin 持有，必须靠事件通知才会重算。
//   B. 打完包滑动只有 30 多帧
//      主因是 backdrop-filter 逐帧重算高斯模糊。这里的对策：
//        ① 背景是渐变时（无自定义图）关掉卡片的模糊 —— 渐变是低频信号，
//           模糊前后观感一致，这笔开销买不到任何东西（bg-flat）
//        ② --bg-blur 下发 none 而不是 blur(0px) —— 后者照样建 backdrop root
//        ③ 流畅模式下 background-attachment 改 scroll（Android 已知掉帧源）
//        ④ 首次启动做一次性能探测，偏弱的机器自动打开流畅模式（utils/perf.js）
//        ⑤ 手势跟手节流到每帧一次，避免 touchmove 打满逻辑层→视图层通信

const fs = require('fs');
const path = require('path');
const { load, loadCode } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 递归收集源码（跳过产物与依赖目录）
function walk(dir, ext, out) {
  out = out || [];
  fs.readdirSync(dir).forEach((n) => {
    if (n === 'node_modules' || n === 'unpackage' || n === '.hbuilderx' || n === '.git') return;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, ext, out);
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
}

/* ---------------- mock ---------------- */
const mem = {};
let sysInfo = { statusBarHeight: 24, theme: 'dark', windowWidth: 360, windowHeight: 780, pixelRatio: 3 };
let uiStyle = 'light';
const uiCalls = [];
const barCalls = [];
const themeListeners = [];
const emitted = [];

global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getSystemInfoSync: () => sysInfo,
  setBackgroundColor: () => {},
  setNavigationBarColor: () => {},
  onThemeChange: (fn) => { themeListeners.push(fn); },
  $emit: (n, p) => { emitted.push(n); },
  $on: () => {},
  $off: () => {},
  chooseImage: (o) => { o && o.success && o.success({ tempFilePaths: ['/tmp/p.png'] }); },
  saveFile: (o) => { o && o.success && o.success({ savedFilePath: '_doc/bg/p.png' }); }
};
global.window = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) };
global.document = { documentElement: { style: { setProperty: () => {} }, classList: { add: () => {}, remove: () => {} } } };

// App 端的 HTML5+ 容器（theme.js 只通过 typeof 判断存在性，所以这里能给就给）
const plus = {
  nativeUI: {
    setUIStyle: (s) => { uiCalls.push(s); uiStyle = s === 'auto' ? 'auto' : s; },
    getUIStyle: () => uiStyle
  },
  navigator: { setStatusBarStyle: (s) => { barCalls.push(s); } }
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

(async () => {
  /* ================= A. 跟随系统深色模式 ================= */
  console.log('== A1. manifest 必须开 darkmode ==');
  const manifest = read('manifest.json');
  let appPlus = null;
  try {
    // 末尾可能被 HBuilderX 写成 JSON5，这里只取 app-plus 段手工解析
    const m = manifest.match(/"app-plus"\s*:\s*\{/);
    assert(!!m, 'manifest 里有 app-plus 节点');
    const i = manifest.indexOf('"darkmode"');
    appPlus = i >= 0 && i < manifest.indexOf('"mp-weixin"');
  } catch (e) { /* ignore */ }
  assert(appPlus, 'app-plus 节点里配置了 "darkmode": true（否则 theme 恒为 undefined）');
  assert(/"darkmode"\s*:\s*true/.test(manifest), 'darkmode 的值必须是 true');

  console.log('== A2. 原生容器与状态栏跟随 ==');
  const settings = load('utils/settings.js');
  settings.init();
  const color = load('utils/color.js');
  const theme = load('utils/theme.js', { settings, plus, color });
  theme.init();

  uiCalls.length = 0;
  theme.setFollowSystem(true);
  eq(uiCalls[uiCalls.length - 1], 'auto', '开启跟随时先把容器切成 auto');
  eq(theme.systemPrefersDark(), true, '系统 theme=dark → systemPrefersDark() 为 true');
  eq(theme.isDark(), true, '跟随系统时 isDark() 取系统值');
  assert(barCalls.length > 0 && barCalls[barCalls.length - 1] === 'light',
    '深色下状态栏文字转亮（custom 导航只能靠 plus.navigator）');

  // 关掉跟随 = 冻结在当前系统值（不是强行回浅色）
  theme.setFollowSystem(false);
  eq(uiCalls[uiCalls.length - 1], 'dark', '关掉跟随时冻结在当前系统值（此处为深色）');
  sysInfo = Object.assign({}, sysInfo, { theme: 'light' });
  theme.setFollowSystem(true);
  eq(uiCalls[uiCalls.length - 1], 'auto', '再次开启跟随 → auto');
  eq(theme.isDark(), false, '系统转浅色后 isDark() 跟着变');
  theme.setFollowSystem(false);
  eq(uiCalls[uiCalls.length - 1], 'light', '关掉跟随 → 冻结在浅色');
  theme.setDark(true);
  eq(uiCalls[uiCalls.length - 1], 'dark', '手动选深色时容器切 dark（原生弹窗也跟着变）');
  theme.setDark(false);
  sysInfo = Object.assign({}, sysInfo, { theme: 'dark' });

  console.log('== A3. 系统值读不到时的兜底 ==');
  // 有些内核不返回 theme：应退到 plus.nativeUI.getUIStyle()
  const savedInfo = sysInfo;
  sysInfo = { statusBarHeight: 24, windowWidth: 360, windowHeight: 780, pixelRatio: 3 };
  uiStyle = 'dark';
  eq(theme.systemPrefersDark(), true, 'getSystemInfoSync().theme 缺失时退到 getUIStyle()');
  uiStyle = 'light';
  eq(theme.systemPrefersDark(), false, 'getUIStyle()=light → false');
  sysInfo = savedInfo;
  uiStyle = 'auto';
  theme.setFollowSystem(true);

  console.log('== A4. 运行期切主题要能推动页面重算 ==');
  // 根节点 class / style 由 mixin 持有，apply() 必须发事件，否则只有下次 onShow 才生效
  emitted.length = 0;
  theme.apply();
  assert(emitted.indexOf('theme:change') >= 0, 'apply() 广播 theme:change');
  const mixinSrc = read('utils/theme-mixin.js');
  assert(/uni\.\$on\(\s*'theme:change'/.test(mixinSrc), 'theme-mixin 订阅 theme:change');
  assert(/uni\.\$off\(\s*'theme:change'/.test(mixinSrc), 'theme-mixin 在 onUnload 里退订（避免重复订阅）');
  // onThemeChange 回调里要把新值落盘，否则关掉跟随时会停在旧值
  const themeSrc = read('utils/theme.js');
  // 窗口 200 → 320（2026-10-16）：回调里在 settings.set 之前有一句
  // "不跟随就 return" 的守卫 + 一行说明注释，实到 216 字符。窗口太小会因为
  // 注释多写两行就误报（这次是它先红了才发现）—— 断言要测的是"落盘发生过"，
  // 不是"落盘发生在多少个字以内"。
  assert(/onThemeChange\(\(res\)[\s\S]{0,320}settings\.set\(\{\s*theme:\s*\{\s*dark:/.test(themeSrc),
    'uni.onThemeChange 回调把新 theme 写回设置');

  /* ================= B. 渲染开销 ================= */
  console.log('== B1. 无背景图 → bg-flat，卡片不做实时模糊 ==');
  theme.clearBgImage();
  theme.setSmooth(false);
  const clsFlat = theme.rootClass();
  assert(/\bbg-flat\b/.test(clsFlat), '默认（渐变背景）带 bg-flat：' + clsFlat);
  assert(/\bapp-root\b/.test(clsFlat), '仍然带 app-root（背景层）');

  console.log('== B2. 有背景图 → 不加 bg-flat（照片有高频细节，模糊才有意义） ==');
  await theme.chooseBackgroundImage();
  const clsImg = theme.rootClass();
  assert(!/\bbg-flat\b/.test(clsImg), '自定义背景图时不加 bg-flat：' + clsImg);
  theme.clearBgImage();

  console.log('== B3. App.vue 的 CSS 覆盖 ==');
  const app = read('App.vue');
  const flatBlock = (app.match(/\/\* ===== bg-flat[\s\S]*?\*\/([\s\S]*?)\/\* ===== 流畅模式/) || [])[1] || '';
  assert(flatBlock.length > 0, '有 bg-flat 段');
  assert(/\.bg-flat\s*\*::before/.test(flatBlock) && /\.bg-flat\s*\*::after/.test(flatBlock),
    'bg-flat 覆盖后代伪元素（* 匹配不到伪元素）');
  assert(/backdrop-filter:\s*none\s*!important/.test(flatBlock), 'bg-flat 用 none + !important');
  ['fnb', 'ftb', 'pop-card'].forEach((c) => {
    assert(new RegExp('\\.bg-flat\\s+\\.' + c.replace(/-/g, '\\-')).test(flatBlock),
      '例外：浮动窗体 .' + c + ' 保留模糊（面积小、叠在滚动内容上）');
  });
  assert(/backdrop-filter:\s*var\(--bg-blur,\s*none\)/.test(app),
    '蒙版层直接吃 --bg-blur 整条 filter 值（0 时是 none，不是 blur(0px)）');
  // 只看真实声明：先剥掉注释，否则注释里提到这个词会误判
  const pageBlock = (app.match(/^page \{[\s\S]*?\n\}/m) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/background-attachment:\s*fixed/.test(pageBlock),
    'page{} 不再写 background-attachment: fixed（Android 已知掉帧源，且被 fixed 背景层挡住看不见）');
  assert(/backgroundAttachment:\s*currentSmooth\(\)\s*\?\s*'scroll'\s*:\s*'fixed'/.test(read('utils/theme.js')),
    '流畅模式下根节点背景改 scroll');
  assert(/\.perf-smooth\s+\.card[\s\S]{0,400}box-shadow[^;]*!important/.test(app),
    '流畅模式下大半径投影收小（投影也是逐帧模糊）');
  // 进场 / 跟手两种动效状态共用一条规则提层（class 一摘掉就失效，不长期占显存）
  assert(/\.slide-enter,\s*\.dragging\s*\{[\s\S]{0,120}will-change:\s*transform/.test(app),
    '进场 / 跟手期间才提升合成层（class 摘掉即失效）');

  /* ================= C. 性能探测与自动降级 ================= */
  console.log('== C1. 探测结果可信 ==');
  const perf = load('utils/perf.js', { settings, theme });
  const cpu = perf.cpuScore();
  assert(cpu > 0, 'cpuScore() 返回有效分数 = ' + cpu);
  eq(perf.pixelCount(), Math.round(360 * 780 * 9), 'pixelCount() = w*h*dpr² = ' + perf.pixelCount());
  const d = perf.detect();
  assert(typeof d.tier === 'string' && ['low', 'mid', 'high'].indexOf(d.tier) >= 0, 'tier 合法 = ' + d.tier);
  assert(d.need === (d.lowCpu || d.bigPixels), 'need = lowCpu || bigPixels');
  assert(!!perf.tierText(d.tier), 'tierText 有文案 = ' + perf.tierText(d.tier));

  console.log('== C2. 自动降级只跑一次，且尊重手动选择 ==');
  // 先伪造一台"很强"的机器：不该自动开
  sysInfo = { windowWidth: 360, windowHeight: 640, pixelRatio: 2, theme: 'dark' };
  perf.autoDowngrade(true);
  const s1 = settings.get().performance;
  eq(s1.probed, true, '探测后 probed = true');
  eq(s1.smooth, false, '强机不自动开流畅模式');

  // 伪造一台"很弱"的机器：像素巨多 → 自动开
  sysInfo = { windowWidth: 480, windowHeight: 1000, pixelRatio: 4, theme: 'dark' };
  const r2 = perf.autoDowngrade(true);
  eq(r2.bigPixels, true, '识别出大光栅化面积');
  eq(settings.get().performance.smooth, true, '弱机自动开启流畅模式');
  eq(settings.get().performance.auto, true, '标记为自动开启');

  // 不 force 时不重跑
  const before = JSON.stringify(settings.get().performance);
  const r3 = perf.autoDowngrade(false);
  eq(r3.skipped, true, '已探测过 → 跳过');
  eq(JSON.stringify(settings.get().performance), before, '跳过时配置不变');

  // 用户手动关掉 → 之后自动检测不再覆盖
  theme.setSmooth(false, false);
  eq(settings.get().performance.manual, true, '手动拨开关后 manual = true');
  perf.autoDowngrade(true);
  eq(settings.get().performance.smooth, false, '手动关掉后自动检测不再改回来');

  console.log('== C3. 设置页接入 ==');
  const set = read(path.join('pkgManage', 'pages', 'settings', 'settings.vue'));
  assert(/from '\.\.\/(?:\.\.\/)+utils\/perf\.js'/.test(set), '引入 utils/perf.js');
  assert(/perf\.autoDowngrade\(true,\s*\{\s*rematch:\s*true\s*\}\)/.test(set),
    '有「重新检测」：强制重测 + rematch（清掉旧的手动档位，按新结果重新匹配）');
  assert(/setSmooth\(e\.detail\.value,\s*false\)/.test(set), '手动开关明确传 auto=false');
  assert(/perfText/.test(set), '展示探测结果文案');
  assert(/读取到/.test(set), '跟随系统时把读到的深浅色摆出来（便于排查）');

  console.log('== C4. 启动链路 ==');
  assert(/import \{\s*autoDowngrade\s*\} from '\.\/utils\/perf\.js'/.test(app), 'App.vue 引入 autoDowngrade');
  assert(/autoDowngrade\(false\)/.test(app), 'onLaunch 里延迟触发一次自动检测');
  assert(/setTimeout\(\(\) => \{ autoDowngrade\(false\) \}, \d+\)/.test(app), '延迟执行（不和首屏抢主线程）');

  console.log('== C5. 手势节流 ==');
  const mixinTs = read('utils/tab-slide-mixin.js');
  assert(/this\.__last = 0/.test(mixinTs), 'onSlideStart 重置节流时间戳');
  assert(/now - \(this\.__last \|\| 0\) < 16/.test(mixinTs), 'touchmove 节流到每帧一次');
  // 方向判定必须在节流之前，否则手感迟钝
  const iAxis = mixinTs.indexOf('this.__axis = 1');
  const iThrottle = mixinTs.indexOf('this.__last = now');
  assert(iAxis >= 0 && iThrottle > iAxis, '方向判定在节流之前（判定不改 data，要保持灵敏）');

  /* ================= D. 画质档位（6 档 + 三维微调） ================= */
  console.log('== D1. 档位表自洽 ==');
  const diff = require('fs').readFileSync(path.join(ROOT, 'utils', 'perf.js'), 'utf8');
  eq(perf.QUALITY_KEYS.join(','), 'high,clear,balanced,lite,eco,minimal', '六档由强到弱：' + perf.QUALITY_KEYS.join(' → '));
  // 单调：越强档位的模糊半径不小于弱档；省电档一旦出现就不能变回非省电
  let mono = true;
  for (let i = 1; i < perf.QUALITY_KEYS.length; i++) {
    const a = perf.qualityOf(perf.QUALITY_KEYS[i - 1]);
    const b = perf.qualityOf(perf.QUALITY_KEYS[i]);
    if (b.blurLg > a.blurLg || b.blurSm > a.blurSm) mono = false;
    if (!a.smooth && b.smooth) { /* 由非省电转省电，允许 */ }
    if (a.smooth && !b.smooth) mono = false;   // 省电档不能再变回非省电
  }
  assert(mono, '模糊半径与省电标记随档位单调，不会出现"更强的档反而更省"');
  ['high', 'clear', 'balanced'].forEach((k) => eq(perf.qualityOf(k).smooth, false, k + ' 不是省电档'));
  ['lite', 'eco', 'minimal'].forEach((k) => eq(perf.qualityOf(k).smooth, true, k + ' 是省电档'));
  assert(/FX_PARTS\s*=\s*\[[^\]]*'glass'[^\]]*'motion'[^\]]*'shadow'/.test(diff),
    '三个可微调维度：毛玻璃 / 动效 / 阴影');

  console.log('== D2. 分数 → 推荐档位单调 ==');
  const picks = [0, 12, 25, 40, 60, 80, 100].map((s) => perf.recommendQuality(s));
  const rank = (k) => perf.QUALITY_KEYS.indexOf(k);
  let ordered = true;
  for (let i = 1; i < picks.length; i++) {
    // 分数越高 → 档位越靠前（rank 越小）
    if (rank(picks[i]) > rank(picks[i - 1])) ordered = false;
  }
  assert(ordered, '分数升序对应档位不降级：' + [0, 12, 25, 40, 60, 80, 100].map((s, i) => s + '→' + picks[i]).join(' '));
  eq(perf.recommendQuality(100), 'high', '满分 → 高画质');
  eq(perf.recommendQuality(0), 'minimal', '零分 → 极简');

  console.log('== D2b. 像素封顶：分数再高也越不过 GPU 填充这条线 ==');
  // 实测反例：CPU 很强 + 3.1M 物理像素的机器拿 62 分被分到「均衡」，滑起来仍卡。
  // 毛玻璃逐帧模糊的开销在 GPU 填充率，CPU 测分代表不了它 → 自动档按像素封顶。
  eq(perf.pixelCap(3.1e6), 'lite', '3.1M 像素（高 DPI 屏）→ 封顶轻量');
  eq(perf.pixelCap(2.5e6), 'balanced', '2.5M 像素 → 封顶均衡');
  eq(perf.pixelCap(1e6), 'high', '常规屏不设限');
  eq(perf.pixelCap(0), 'high', '探测失败（0）不设限');
  const capRank = [1e6, 2.5e6, 3.1e6].map((px) => rank(perf.pixelCap(px)));
  assert(capRank[0] <= capRank[1] && capRank[1] <= capRank[2], '像素越大封顶越严（rank 不减）');
  eq(perf.pickAuto(100, 1e6), 'high', '满分 + 常规屏 → 高画质');
  eq(perf.pickAuto(100, 3.1e6), 'lite', '满分 + 3.1M 像素 → 也只给轻量');
  eq(perf.pickAuto(0, 1e6), 'minimal', '零分仍按分数给极简（分数线照常生效）');
  // 自动推荐链路（detect / autoKey / summary）必须走 pickAuto，不能绕开封顶
  assert(/recommend:\s*pickAuto\(score,\s*px\)/.test(diff), 'detect() 的 recommend 走 pickAuto');
  assert(/return pickAuto\(scoreOf\(p\.cpu \|\| 0, p\.px \|\| 0\), p\.px \|\| 0\)/.test(diff),
    'autoKey() 走 pickAuto');
  assert(/recommend:\s*pickAuto\(score,\s*p\.px \|\| 0\)/.test(diff), 'summary() 走 pickAuto');

  console.log('== D3. 换档真的改了毛玻璃变量 ==');
  theme.setSmooth(false);
  theme.setBlur(24);
  const stOf = () => theme.rootStyle();
  perf.setQuality('high', true);
  eq(stOf()['--glass-sm'], 'blur(8px) saturate(180%)', '高画质：卡片级玻璃保持原值 8px');
  eq(stOf()['--glass-lg'], 'blur(12px) saturate(180%)', '高画质：窗体级玻璃保持原值 12px');
  eq(stOf()['--bg-blur'], 'blur(24px)', '高画质：背景模糊上限 24');
  perf.setQuality('balanced', true);
  eq(stOf()['--glass-sm'], 'blur(5px) saturate(180%)', '均衡：卡片级玻璃减淡到 5px');
  eq(stOf()['--glass-lg'], 'blur(8px) saturate(180%)', '均衡：窗体级玻璃减淡到 8px');
  eq(stOf()['--bg-blur'], 'blur(16px)', '均衡：背景模糊被夹到 16（用户设的 24 不会生效）');
  perf.setQuality('lite', true);
  eq(stOf()['--glass-sm'], 'none', '轻量：卡片玻璃关闭（是 none，不是 blur(0px)）');
  eq(stOf()['--glass-lg'], 'none', '轻量：窗体玻璃也关闭 —— 关键窗体由 App.vue 例外恢复');
  eq(stOf()['--bg-blur'], 'none', '轻量：背景模糊归零');
  perf.setQuality('minimal', true);
  eq(stOf()['--glass-sm'], 'none', '极简：全树不模糊');
  perf.setQuality('clear', true);
  eq(stOf()['--glass-sm'], 'blur(6px) saturate(180%)', '清透：卡片级玻璃 6px（介于 8 与 5 之间）');
  eq(stOf()['--glass-lg'], 'blur(9px) saturate(180%)', '清透：窗体级玻璃 9px（介于 12 与 8 之间）');
  eq(stOf()['--bg-blur'], 'blur(20px)', '清透：背景模糊被夹到 20');
  perf.setQuality('eco', true);
  eq(stOf()['--glass-sm'], 'none', '省电：卡片玻璃关闭');
  eq(stOf()['--glass-lg'], 'none', '省电：窗体玻璃关闭（关键窗体由 App.vue 例外恢复）');
  eq(theme.currentFx().motion, 'off', '省电：动效关闭');
  eq(theme.currentFx().shadow, 'none', '省电：投影关闭');

  console.log('== D4. 根节点 class 带上三个维度 ==');
  perf.setQuality('balanced', true);
  const clsFx = theme.rootClass();
  assert(/fx-glass-full/.test(clsFx) && /fx-motion-reduced/.test(clsFx) && /fx-shadow-slim/.test(clsFx),
    '均衡档：' + clsFx.trim());
  perf.setQuality('minimal', true);
  const clsMin = theme.rootClass();
  assert(/fx-glass-off/.test(clsMin) && /fx-motion-off/.test(clsMin) && /fx-shadow-none/.test(clsMin),
    '极简档：' + clsMin.trim());

  console.log('== D5. 三维微调 + 改回默认值要能撤销 ==');
  perf.setQuality('high', true);
  eq(perf.customized(), false, '刚选完档位时没有自定义');
  perf.setFxPart('glass', 'off');
  eq(perf.getFx().glass, 'off', '单独关掉毛玻璃即时生效');
  eq(stOf()['--glass-sm'], 'none', '微调后变量也跟着变');
  eq(perf.customized(), true, '标记为已自定义');
  // 改回档位默认值 → 自定义标记自动消失（deepMerge 清不掉 null/空对象，这里专为此写了修复）
  perf.setFxPart('glass', 'full');
  eq(perf.customized(), false, '改回档位默认值后「已自定义」消失');
  // 换档位要把旧的微调整体清掉，否则会留下"轻量 + 玻璃全部"这种矛盾组合
  perf.setFxPart('motion', 'off');
  eq(perf.customized(), true, '再改动效 → 重新标记为自定义');
  perf.setQuality('balanced', true);
  eq(perf.customized(), false, '换档位时旧的微调被清空');

  console.log('== D6. 0 是合法的档位值，不能被当成「没设置」 ==');
  // 这三档的 maxBgBlur / blurSm 都是 0；用 > 0 判缺失会把它兜底成 24 / 8，
  // 表现为"轻量档把玻璃改回全部时卡片又模糊了"，档位静默失效
  perf.setQuality('lite', true);
  eq(theme.currentFx().maxBgBlur, 0, '轻量档 maxBgBlur = 0（不是被兜底成 24）');
  eq(theme.currentFx().blurSm, 0, '轻量档 blurSm = 0（不是被兜底成 8）');
  perf.setQuality('minimal', true);
  eq(theme.currentFx().maxBgBlur, 0, '极简档 maxBgBlur = 0');
  theme.setSmooth(false);

  console.log('== D7. 项目里不再有写死的毛玻璃半径 ==');
  const hardcoded = walk(ROOT, '.vue').filter((f) => {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return /(?:-webkit-)?backdrop-filter:\s*blur\((?:8|12)px\)/.test(src);
  });
  assert(hardcoded.length === 0,
    '没有写死的毛玻璃半径（应统一走 var(--glass-*)）' +
    (hardcoded.length ? '：' + hardcoded.map((f) => path.relative(ROOT, f)).join(', ') : ''));

  console.log('== D8. App.vue 的三档 CSS ==');
  const keyBlock = (app.match(/\/\* 毛玻璃 = 仅关键处[\s\S]*?\*\/([\s\S]*?)\n\}/) || [])[1] || '';
  assert(/\.fx-glass-key\s+\.fnb/.test(app) && /\.fx-glass-key\s+\.ftb/.test(app) && /\.fx-glass-key\s+\.pop-card/.test(app),
    '仅关键处：只有顶栏 / 底栏 / 弹窗恢复模糊');
  // 这些例外也要走 --glass-lg：写死半径的话档位就调不到它们（高画质档想给更大 blur 会失效）
  assert(new RegExp('backdrop-filter:\\s*var\\(--glass-lg[^\\n]*!\\s*important').test(keyBlock),
    '关键窗体的例外既要用 !important（盖住通配规则），又要走 --glass-lg 变量');
  assert(/\.fx-motion-reduced\s+\.page-slide/.test(app) && /\.fx-motion-off\s+\.page-slide/.test(app),
    '动效精简 / 关闭两档都有针对 .page-slide 的规则');
  assert(/\.fx-shadow-slim\s+\.card/.test(app) && /\.fx-shadow-none\s+\.card/.test(app),
    '阴影收窄 / 无两档都有针对 .card 的规则');
  assert(/border-color:\s*rgba\(var\(--shadow-rgb/.test(app),
    '无阴影时补一条发丝边，避免窗体糊进背景');
  {
    // 加载指示器绝对不能被关掉：那是"正在忙"的语义，关了用户会以为卡死
    // 项目换行不统一（有些文件是 CRLF），先归一化，别用 \n\n 这种依赖行尾的写法
    const flat = app.replace(/\r\n/g, '\n');
    const offNote = (flat.match(/\/\* 动效 = 关闭([\s\S]*?)\*\//) || [])[1] || '';
    const offBlock = (flat.match(/\/\* 动效 = 关闭[\s\S]*?\*\/([\s\S]*?)\n\s*\n/) || [])[1] || '';
    assert(offNote.length > 0 && offBlock.length > 0, '有「动效 = 关闭」段');
    // 规则体里不许出现加载指示器（注释放 offNote 里，不受这条约束）
    assert(!/sr-spin|\.spin\b|fnb-rotate|cmd-rotate/.test(offBlock),
      '关闭动效时把加载指示器排除在外（否则用户会以为卡死）');
    assert(/正在忙|一律不关/.test(offNote), '注释里写清了为什么不能关 loading');
  }

  console.log('== D9. 设置页的细分入口 ==');
  const set2 = read(path.join('pkgManage', 'pages', 'settings', 'settings.vue'));
  ['画质档位', '毛玻璃', '动效', '阴影'].forEach((n) => {
    assert(set2.indexOf("$t('" + n + "')") >= 0, '有「' + n + '」这一项');
  });
  assert(/@tap="onQuality\(q\.key\)"/.test(set2), '档位可点选');
  assert(/@tap="onFx\('glass', o\.v\)"/.test(set2), '毛玻璃可点选');
  assert(/@tap="onFx\('motion', o\.v\)"/.test(set2), '动效可点选');
  assert(/@tap="onFx\('shadow', o\.v\)"/.test(set2), '阴影可点选');
  assert(/onQuality\(k\)/.test(set2) && /perf\.setQuality\(k, true\)/.test(set2), '档位走 perf.setQuality');
  assert(/onFx\(part, v\)/.test(set2) && /perf\.setFxPart\(part, v\)/.test(set2), '微调走 perf.setFxPart');
  assert(/this\.loadFx\(\)/.test(set2), '有从设置回读状态的方法');
  assert(/\.seg-item\.on/.test(set2), '选中态有样式');
  // 老的总开关必须还在（别把用户熟悉的入口删了）
  assert(/@change="onSmooth"/.test(set2), '仍然保留流畅模式总开关');

  console.log('== D10. 新文案都有英文译文 ==');
  const en = read('utils/i18n-en.js');
  ['画质档位', '毛玻璃', '动效', '阴影', '自动', '高画质', '清透', '均衡', '轻量', '省电', '极简',
    '仅关键处', '完整', '精简', '收窄', '无', '已自定义：{list}',
    '完整的毛玻璃层次与动效', '玻璃更淡一档，动效仍然完整',
    '玻璃减淡、动效缩短，观感几乎不变',
    '只留大面积窗体的玻璃，卡片调实', '玻璃同轻量，动效与投影全关',
    '全树不模糊，关闭动效与投影'
  ].forEach((k) => {
    assert(en.indexOf("'" + k + "':") >= 0, '有译文：' + k);
  });

  // 这个组守住一条很容易被忽略的时序：探测是启动 1500ms 后才跑的，
  // 那时首屏早就渲染完了。不广播的话档位只在"下一次进页面"才生效，
  // 用户感知就是"自动匹配性能根本没起作用"。
  console.log('== D11. 首次探测后必须通知页面刷新 ==');
  try { settings.set({ performance: { probed: false } }); } catch (e) {}
  emitted.length = 0;
  const ad1 = perf.autoDowngrade(false);
  assert(ad1.skipped !== true, '首次启动真的跑了探测');
  assert(emitted.indexOf('theme:change') >= 0,
    '探测完广播 theme:change（首屏档位立即生效，不用等下次进页面）');
  emitted.length = 0;
  const ad2 = perf.autoDowngrade(false);
  assert(ad2.skipped === true, '已探测过则跳过（不重复测算，省启动开销）');
  assert(emitted.length === 0, '跳过时不广播（没变化就不打扰页面）');
  emitted.length = 0;
  perf.autoDowngrade(true);
  assert(emitted.indexOf('theme:change') >= 0, '设置页「重新检测」后同样广播');
  emitted.length = 0;
  perf.setQuality('lite', true);
  assert(emitted.indexOf('theme:change') >= 0, '手动切档位也广播（三个入口口径一致）');

  console.log('== D12. 「重新检测」要按新探测结果重新匹配（rematch） ==');
  // 重新检测的语义 = "按当前设备重新帮我匹配画质"：旧的手动档位（可能是在
  // 别的机器 / 旧版本上选的）必须被清掉、回到 auto，否则重测只改分数不改档。
  perf.setQuality('minimal', true);   // 伪造一个旧机器上手动选下的档位
  eq(settings.get().performance.manual, true, '前置：手动选档后 manual = true');
  sysInfo = { windowWidth: 360, windowHeight: 640, pixelRatio: 2, theme: 'dark' };
  const rr = perf.autoDowngrade(true, { rematch: true });
  eq(rr.quality, 'auto', 'rematch 后回到自动');
  eq(rr.manual, false, 'rematch 清掉手动标记');
  eq(settings.get().performance.quality, 'auto', 'auto 已落盘');
  eq(settings.get().performance.manual, false, 'manual = false 已落盘');
  eq(rr.level, perf.pickAuto(rr.score, rr.px), '档位 = 按新探测结果计算（综合分 + 像素封顶）');
  assert(!!rr.level && perf.QUALITY[rr.level], '算出的档位合法 = ' + rr.level);
  // 对照组：不带 rematch 的重测仍然尊重手动选择（老契约不能被顺手破坏）
  perf.setQuality('minimal', true);
  const rc = perf.autoDowngrade(true);
  eq(rc.quality, 'minimal', '不带 rematch：手动档位保持不变');

  console.log('== D13. 自动档老用户要能吃到新档位（跳过重测时静默刷新 fx） ==');
  // 模拟升级场景：老版本把自动档解析成「均衡」并落盘；新版加了像素封顶后
  // 同一台机器的自动档应解析为「轻量」。启动时的 autoDowngrade(false) 虽然跳过
  // 重测，也必须识别出 fx 过期、静默重写并广播，否则老用户永远停在旧档位。
  sysInfo = { windowWidth: 480, windowHeight: 1000, pixelRatio: 4, theme: 'dark' };
  settings.set({
    performance: {
      probed: true, manual: false, quality: 'auto',
      cpu: 60e6, px: 3.1e6, score: 62, tier: 'mid',
      fx: { glass: 'full', motion: 'reduced', shadow: 'slim', blurSm: 5, blurLg: 8, maxBgBlur: 16 },
      fxOverride: {}, smooth: false, auto: false
    }
  });
  emitted.length = 0;
  const rs = perf.autoDowngrade(false);
  eq(rs.skipped, true, '不重跑测算（probed 已存在）');
  eq(rs.silentRefresh, true, '但识别出自动档解析已变化，静默刷新');
  eq(rs.level, 'lite', '3.1M 像素 + 62 分 → 像素封顶解析为轻量');
  eq(settings.get().performance.fx.glass, 'key', 'fx 已重写为轻量档（卡片玻璃关掉）');
  eq(settings.get().performance.fx.blurSm, 0, '模糊半径同步重写（不是 blur(5px) 残留）');
  eq(settings.get().performance.smooth, true, '自动选到省电档 → 流畅模式跟着打开');
  assert(emitted.indexOf('theme:change') >= 0, '静默刷新后广播 theme:change（当前页立即生效）');
  emitted.length = 0;
  const rs2 = perf.autoDowngrade(false);
  eq(rs2.silentRefresh, undefined, 'fx 已对齐 → 下次跳过不再重写');
  assert(emitted.length === 0, '不再重复广播（没变化就不打扰页面）');
  // 手动档位不受静默刷新影响：fx 与档位一致时绝不乱动
  perf.setQuality('balanced', true);
  emitted.length = 0;
  const rs3 = perf.autoDowngrade(false);
  eq(rs3.silentRefresh, undefined, '手动档位不触发静默刷新');
  assert(emitted.length === 0, '手动档位下不广播');

  console.log('');
  console.log(fail === 0 ? '深色模式 / 渲染性能 校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
