// _tools/check-theme.js - 外观主题校验（只读 + 内存 storage）
// 验证：预设合法、默认值、切换后持久化、CSS 变量写入、未知 key 兜底、
//       背景模糊、深色模式、跟随系统、深色下的主色提亮与背景降亮度
const { load } = require('./lib/load');

const mem = {};
const bgCalls = [];
const pickCalls = [];
const navCalls = [];
let cssVars = {};
let sysTheme = 'light';   // 模拟系统深色开关

global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getSystemInfoSync: () => ({ statusBarHeight: 24, theme: sysTheme }),
  setBackgroundColor: (o) => { bgCalls.push(o && o.backgroundColor); },
  setNavigationBarColor: (o) => { navCalls.push(o); },
  onThemeChange: () => {},
  chooseImage: (o) => {
    pickCalls.push(o);
    o && o.success && o.success({ tempFilePaths: ['/tmp/picked.png'] });
  },
  saveFile: (o) => { o && o.success && o.success({ savedFilePath: '_doc/bg/picked.png' }); }
};
global.window = {
  matchMedia: () => ({ matches: sysTheme === 'dark', addEventListener: () => {} })
};
global.document = {
  documentElement: {
    style: {
      setProperty: (k, v) => { cssVars[k] = v; }
    }
  }
};

const settings = load('utils/settings.js');
settings.init();
// theme.js 现在依赖 utils/color.js（自定义底色的解析 / 深色变体）
const color = load('utils/color.js');
const theme = load('utils/theme.js', { settings, color });

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

console.log('== 1. 预设完整性 ==');
const names = theme.BACKGROUNDS.map(b => b.name);
if (theme.BACKGROUNDS.length >= 4) ok('预设数量 = ' + theme.BACKGROUNDS.length + '（' + names.join(' / ') + '）');
else bad('预设太少');
const allValid = theme.BACKGROUNDS.every(b => b.key && b.name && b.css && b.solid);
if (allValid) ok('每个预设都有 key / name / css / solid');
else bad('预设字段缺失');
const keys = theme.BACKGROUNDS.map(b => b.key);
if (new Set(keys).size === keys.length) ok('key 无重复');
else bad('key 重复');

console.log('== 2. 默认背景与兜底 ==');
// 首次进入的默认背景 = 浅蓝（2026-10-09 用户要求："第一次点进去使用的时候背景要是默认的浅蓝色"）。
// 只影响从没改过背景的新用户：settings.load 是 deepMerge(defaults(), 存档)，
// 老用户存档里的 background 会原样保留，不会被这个默认值顶掉。
if (theme.current() === 'sky') ok('首次进入默认 background = sky（浅蓝）');
else bad('首次进入默认应为 sky，实际 ' + theme.current());
{
  const sky = (theme.BACKGROUNDS || []).filter((b) => b.key === 'sky')[0];
  if (sky && sky.css && sky.solid && sky.darkCss && sky.darkSolid) ok('sky 预设四件套齐全（浅/深 × 渐变/纯色）');
  else bad('sky 预设缺字段 —— 默认背景会在深色模式下失效');
  if (sky && /linear-gradient/.test(sky.css) && !/#e4e9e4$/.test(sky.css)) ok('sky 是浅蓝渐变，不是兜底灰');
  else bad('sky 的 css 不像浅蓝渐变：' + (sky && sky.css));
}
if (theme.currentAccent() === 'blue') ok('默认主题色 = blue');
else bad('默认主题色应为 blue，实际 ' + theme.currentAccent());
if (theme.currentBgImage() === '') ok('默认无自定义背景图');
else bad('默认不应有背景图');

console.log('== 3. 切换背景：写 CSS 变量 + 持久化 + 原生窗口色 ==');
cssVars = {};
bgCalls.length = 0;
const item = theme.setBackground('sky');
if (item.key === 'sky') ok('setBackground 返回 sky');
else bad('setBackground 返回错误：' + item.key);
if (cssVars['--app-bg'] === item.css) ok('CSS 变量 --app-bg 已写入渐变');
else bad('CSS 变量未写入：' + cssVars['--app-bg']);
if (bgCalls.length === 1 && bgCalls[0] === item.solid) ok('原生窗口底色已同步 = ' + item.solid);
else bad('原生窗口底色未同步：' + JSON.stringify(bgCalls));
if (theme.current() === 'sky') ok('已持久化到 settings');
else bad('未持久化，current() = ' + theme.current());

// 重新读取（模拟重启）
const settings2 = load('utils/settings.js');
settings2.init();
const theme2 = load('utils/theme.js', { settings: settings2, color });
if (theme2.current() === 'sky') ok('重启后仍为 sky（storage 生效）');
else bad('重启后丢失：' + theme2.current());

console.log('== 4. init() 恢复 + 状态栏变量兜底 ==');
cssVars = {};
theme.init();
if (cssVars['--app-bg']) ok('init 重新写入 --app-bg');
else bad('init 未写入 --app-bg');

console.log('== 5. 设置页数据形状 ==');
const s = settings.get();
if (s.theme && s.theme.background) ok('settings.theme.background = ' + s.theme.background);
else bad('settings.theme.background 缺失');
settings.set({ ai: { enabled: false } });
if (settings.get().theme.background === 'sky') ok('写其他分组不影响 theme');
else bad('写其他分组把 theme 冲掉了');

console.log('== 6. 主题色切换 ==');
const acc = theme.setAccent('purple');
if (acc.key === 'purple') ok('setAccent 返回 purple');
else bad('setAccent 返回错误');
if (cssVars['--brand'] === '#7c3aed' && cssVars['--brand-rgb'] === '124, 58, 237') ok('主色变量已写入（--brand / --brand-rgb）');
else bad('主色变量未写入：' + JSON.stringify(cssVars));
if (cssVars['--brand-strong'] === '#5b21b6') ok('深色变量已写入 --brand-strong');
else bad('--brand-strong 未写入');
if (theme.setAccent('nope').key === 'blue') ok('未知主题色兜底为 blue');
else bad('未知主题色未兜底');
theme.setAccent('blue');

/* ---------------- 6b. 两条进度条的颜色开关 ---------------- */
// 练习页顶部「已做 / 已会」两条进度条：sync = 同色系（浅版 + 主题色），
// split = 分开（主题色 + 绿色）。开关存在 settings.theme.progressSync，
// 唯一读取口是 theme.barsSyncColors()：只有显式 false 才算"分开"。
console.log('== 6b. 进度条颜色开关 ==');
if (theme.barsSyncColors() === true) ok('默认同色系（progressSync 缺省 = true）');
else bad('默认不是同色系');
settings.set({ theme: { progressSync: false } });
if (theme.barsSyncColors() === false) ok('显式关掉 → barsSyncColors() = false');
else bad('关掉后仍是 true');
settings.set({ theme: { progressSync: '瞎写的' } });
if (theme.barsSyncColors() === true) ok('脏值回落同色系（只有 false 才算分开）');
else bad('脏值没回落');
settings.set({ theme: { progressSync: true } });
if (theme.barsSyncColors() === true) ok('切回来 = true');
else bad('切不回来');
// 默认值要在 defaults() 里（老存档 deepMerge 后也拿得到，否则老用户读不到这个开关）
if (settings.defaults && settings.defaults().theme.progressSync === true) {
  ok('settings.defaults().theme.progressSync = true（老存档也能读到）');
} else bad('defaults 里没有 theme.progressSync');

(async () => {
  console.log('== 7. 自定义背景图（相册导入） ==');
  cssVars = {};
  pickCalls.length = 0;
  const picked = await theme.chooseBackgroundImage();
  if (picked === '_doc/bg/picked.png') ok('选图后落到本地路径 = ' + picked);
  else bad('选图结果异常：' + picked);
  if (theme.currentBgImage() === '_doc/bg/picked.png') ok('背景图已持久化到 settings');
  else bad('背景图未持久化');
  if (/url\(/.test(cssVars['--app-bg'] || '') && /cover/.test(cssVars['--app-bg'] || '')) ok('--app-bg 写入了背景图（url + cover）');
  else bad('--app-bg 不是背景图：' + cssVars['--app-bg']);
  if ((cssVars['--app-bg-mask'] || '').indexOf('rgba(255, 255, 255,') === 0) ok('蒙版变量已写入 = ' + cssVars['--app-bg-mask']);
  else bad('蒙版未写入：' + cssVars['--app-bg-mask']);
  theme.setMask(0.9);
  if (theme.currentMask() === 0.8) ok('蒙版上限钳制到 0.8');
  else bad('蒙版未钳制：' + theme.currentMask());
  theme.clearBgImage();
  if (theme.currentBgImage() === '' && cssVars['--app-bg-mask'] === 'transparent') ok('清除背景图后回到预设（蒙版重置）');
  else bad('清除背景图失败：' + cssVars['--app-bg-mask']);

  console.log('== 8. 背景模糊（0-24px，钳制） ==');
  cssVars = {};
  await theme.chooseBackgroundImage();
  theme.setBlur(12);
  if (cssVars['--app-bg-blur'] === '12px') ok('模糊变量已写入 = 12px');
  else bad('模糊变量未写入：' + cssVars['--app-bg-blur']);
  if (theme.currentBlur() === 12) ok('模糊已持久化');
  else bad('模糊未持久化：' + theme.currentBlur());
  theme.setBlur(99);
  if (theme.currentBlur() === 24) ok('上限钳制到 24');
  else bad('上限未钳制：' + theme.currentBlur());
  theme.setBlur(-5);
  if (theme.currentBlur() === 0) ok('下限钳制到 0');
  else bad('下限未钳制：' + theme.currentBlur());

  console.log('== 9. 深色模式：底色 / 原生窗口 / 根节点 class ==');
  cssVars = {};
  navCalls.length = 0;
  theme.clearBgImage();
  theme.setDark(true);
  if (theme.isDark() === true) ok('isDark() = true');
  else bad('isDark() 应为 true');
  // 深色不再一刀切 DARK_BG_CSS，而是用所选背景的压暗变体（换背景立即生效）
  const curBg = theme.BACKGROUNDS.find(b => b.key === theme.current());
  if (cssVars['--app-bg'] === (curBg.darkCss || theme.DARK_BG_CSS)) ok('底色切到深色变体 = ' + cssVars['--app-bg']);
  else bad('底色未切换：' + cssVars['--app-bg']);
  if (theme.rootClass().indexOf('app-root') === 0) ok('根节点 class = ' + theme.rootClass());
  else bad('根节点缺少 app-root：' + theme.rootClass());
  if (theme.rootClass().indexOf('app-dark') > 0) ok('根节点带 app-dark（深色令牌）');
  else bad('根节点缺少 app-dark：' + theme.rootClass());
  if (theme.rootStyle().backgroundColor === (curBg.darkSolid || theme.DARK_BG)) ok('深色无背景图时根节点铺深色变体底 = ' + theme.rootStyle().backgroundColor);
  else bad('深底未写入：' + JSON.stringify(theme.rootStyle()));
  const lastNav = navCalls[navCalls.length - 1];
  if (lastNav && lastNav.frontColor === '#ffffff') ok('状态栏文字转白 = ' + lastNav.frontColor);
  else bad('状态栏未转白：' + JSON.stringify(lastNav));
  if (bgCalls[bgCalls.length - 1] === (curBg.darkSolid || theme.DARK_BG)) ok('原生窗口底色转深色变体 = ' + bgCalls[bgCalls.length - 1]);
  else bad('原生窗口底色未转深：' + bgCalls[bgCalls.length - 1]);
  // 核心修复点：深色下换背景必须立刻可见
  const mint = theme.BACKGROUNDS.find(b => b.key === 'mint');
  theme.setBackground('mint');
  if (cssVars['--app-bg'] === mint.darkCss) ok('深色下换背景立即生效（mint → ' + cssVars['--app-bg'].slice(0, 40) + '…）');
  else bad('深色下换背景无效：' + cssVars['--app-bg']);
  theme.setDark(false);
  if (theme.isDark() === false && theme.rootClass().indexOf('app-dark') < 0) ok('关闭深色后回到浅色');
  else bad('关闭深色失败');

  console.log('== 10. 深色 + 背景图：蒙版由白转黑（降亮度） ==');
  cssVars = {};
  await theme.chooseBackgroundImage();
  theme.setMask(0.4);
  const lightMask = cssVars['--app-bg-mask'];
  theme.setDark(true);
  const darkMask = cssVars['--app-bg-mask'];
  if (/^rgba\(255, 255, 255,/.test(lightMask || '')) ok('浅色蒙版叠白 = ' + lightMask);
  else bad('浅色蒙版异常：' + lightMask);
  if (/^rgba\(8, 10, 9,/.test(darkMask || '')) ok('深色蒙版叠黑（降亮度）= ' + darkMask);
  else bad('深色蒙版异常：' + darkMask);
  if (/url\(/.test(cssVars['--app-bg'] || '')) ok('深色下背景图仍然保留');
  else bad('深色下背景图丢失：' + cssVars['--app-bg']);
  theme.clearBgImage();

  console.log('== 11. 跟随系统 ==');
  sysTheme = 'dark';
  theme.setFollowSystem(false);
  theme.setDark(false);
  if (theme.isDark() === false) ok('未跟随系统时不受系统影响');
  else bad('未跟随系统却跟随了');
  theme.setFollowSystem(true);
  if (theme.currentFollowSystem() === true) ok('跟随系统已开启');
  else bad('跟随系统未持久化');
  if (theme.isDark() === true) ok('系统为深色 → isDark() 跟随为 true');
  else bad('未跟随系统深色');
  if (theme.rootClass().indexOf('app-dark') > 0) ok('根节点进入深色');
  else bad('根节点未进入深色');
  sysTheme = 'light';
  theme.apply();
  if (theme.isDark() === false) ok('系统切回浅色 → isDark() 跟随为 false');
  else bad('系统切回浅色后仍为深色');
  theme.setFollowSystem(false);
  if (theme.isDark() === false) ok('关闭跟随后沿用切换瞬间的系统值（浅色）');
  else bad('关闭跟随后状态错误');

  console.log('== 12. 深色下主色提亮（保证对比度） ==');
  cssVars = {};
  theme.setAccent('blue');
  theme.setDark(false);
  const lightBrand = cssVars['--brand'];
  theme.setDark(true);
  const darkBrand = cssVars['--brand'];
  if (lightBrand === '#2e6bff') ok('浅色主色 = ' + lightBrand);
  else bad('浅色主色异常：' + lightBrand);
  if (darkBrand === '#6f9bff') ok('深色主色已提亮 = ' + darkBrand);
  else bad('深色主色未提亮：' + darkBrand);
  if (cssVars['--brand-rgb'] === '111, 155, 255') ok('深色 --brand-rgb = ' + cssVars['--brand-rgb']);
  else bad('深色 --brand-rgb 异常：' + cssVars['--brand-rgb']);
  theme.setDark(false);
  theme.setAccent('blue');

  console.log('== 13. 预设在 App 端靠 inline 挂到根节点 ==');
  theme.setBackground('sky');
  const st = theme.rootStyle();
  if (/gradient/.test(st.backgroundImage || '')) ok('渐变预设写入 inline backgroundImage');
  else bad('渐变预设未写入：' + JSON.stringify(st));
  if (st.backgroundAttachment === 'fixed') ok('渐变背景 fixed（滚动时不跟着走）');
  else bad('渐变背景未 fixed：' + JSON.stringify(st));
  theme.setBackground('default');
  const st2 = theme.rootStyle();
  if (!st2.backgroundImage && st2.backgroundColor) ok('纯色预设只写 backgroundColor = ' + st2.backgroundColor);
  else bad('纯色预设 inline 异常：' + JSON.stringify(st2));

  console.log('== 13b. 背景层：固定 + 蒙版 + 模糊（滚动时只有窗体动） ==');
  theme.setMask(0.35);
  theme.setBlur(8);
  const st3 = theme.rootStyle();
  if (st3.backgroundAttachment === 'fixed') ok('根节点背景 fixed（背景不随滚动移动）');
  else bad('根节点背景未 fixed：' + JSON.stringify(st3));
  if (st3['--bg-mask'] === 'rgba(255, 255, 255, 0.35)') ok('蒙版下发 = ' + st3['--bg-mask']);
  else bad('蒙版未下发：' + st3['--bg-mask']);
  // 下发完整 filter 值：blur(0px) 会建立 backdrop root 并逐帧读背景，none 才不参与绘制
  if (st3['--bg-blur'] === 'blur(8px)') ok('模糊下发 = ' + st3['--bg-blur']);
  else bad('模糊未下发：' + st3['--bg-blur']);
  theme.setDark(true);
  if (theme.rootStyle()['--bg-mask'] === 'rgba(8, 10, 9, 0.35)') ok('深色下蒙版转黑（降亮度）');
  else bad('深色蒙版异常：' + theme.rootStyle()['--bg-mask']);
  theme.setDark(false);
  await theme.chooseBackgroundImage();
  const st4 = theme.rootStyle();
  if (/url\(/.test(st4.backgroundImage || '') && st4.backgroundAttachment === 'fixed') ok('自定义背景图 fixed 铺满（滚动不动）');
  else bad('背景图未 fixed：' + JSON.stringify(st4));
  if (/^url\(/.test(st4['--bg-img'] || '')) ok('背景图同时下发 --bg-img（fixed 背景层）');
  else bad('--bg-img 未下发：' + st4['--bg-img']);
  if (st4['--bg-color']) ok('背景色同时下发 --bg-color = ' + st4['--bg-color']);
  else bad('--bg-color 未下发');
  theme.clearBgImage();
  if (theme.rootStyle()['--bg-img'] === 'none') ok('清除背景图后 --bg-img = none');
  else bad('清除后 --bg-img 应为 none：' + theme.rootStyle()['--bg-img']);
  theme.clearBgImage();
  theme.setBlur(0);
  theme.setMask(0.35);

  console.log('== 14. 每个页面根节点都挂了外观 class / style（App 端唯一生效通道） ==');
  const fs = require('fs');
  const path = require('path');
  const PAGES_DIRS = ['pages', 'pkgStudy/pages', 'pkgManage/pages']
    .map(d => path.join(__dirname, '..', 'uniapp', d))
    .filter(d => fs.existsSync(d));
  function walkPages(dir, out) {
    fs.readdirSync(dir).forEach((n) => {
      const p = path.join(dir, n);
      if (fs.statSync(p).isDirectory()) walkPages(p, out);
      else if (/\.vue$/.test(n)) out.push(p);
    });
    return out;
  }
  const pageFiles = [];
  PAGES_DIRS.forEach(d => walkPages(d, pageFiles));
  const missing = pageFiles.filter((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return s.indexOf('appTheme') < 0 || s.indexOf('appBgStyle') < 0;
  });
  if (missing.length === 0) ok(pageFiles.length + ' 个页面全部已挂载');
  else bad('以下页面未挂载：' + missing.join(', '));
  // 根节点不能写死 background（会盖住 .app-dark 与 inline 背景图）
  const bgHack = pageFiles.filter((f) => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('<style');
    return i >= 0 && /\n\s*(?:background:\s*(?:transparent|#f4f6f4|#e4e9e4|#fff|white);)/.test(s.slice(i));
  });
  if (bgHack.length === 0) ok('无页面在根节点样式里写死背景');
  else console.log('  · 提示：这些页面仍有写死背景（需人工确认是否作用于根节点）：' + bgHack.join(', '));

  console.log('== 15. App.vue 背景层 CSS 契约 ==');
  // ⚠️ 工作区文件是 CRLF：跨行正则里的 `\n\n`、lookbehind 会在 \r 上失手
  // （2026-10-12：App.vue 统一成 CRLF 后这组凭空红了三条）——匹配前先归一成 \n
  const appVue = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'App.vue'), 'utf8')
    .replace(/\r\n/g, '\n');
  const hasRoot = /\.app-root\s*\{[^}]*position:\s*relative[^}]*z-index:\s*0/s.test(appVue);
  if (hasRoot) ok('.app-root 是层叠上下文（蒙版层才能落在背景之上、内容之下）');
  else bad('.app-root 缺少 position:relative + z-index:0');
  const bgLayer = /\.app-root::before\s*\{([\s\S]*?)\}/.exec(appVue);
  if (bgLayer) {
    const body = bgLayer[1];
    if (/background-color:\s*var\(--bg-color/.test(body) && /background-image:\s*var\(--bg-img/.test(body)) ok('背景层消费 --bg-color / --bg-img');
    else bad('背景层未消费背景变量：' + body.trim());
  } else bad('App.vue 缺少 .app-root::before 背景层');
  const shared = /\.app-root::before,\s*\.app-root::after\s*\{([\s\S]*?)\}/.exec(appVue);
  if (shared) {
    const body = shared[1];
    if (/position:\s*fixed/.test(body)) ok('背景层 / 蒙版层都是 fixed（滚动时背景不动）');
    else bad('背景层不是 fixed');
    if (/pointer-events:\s*none/.test(body)) ok('两层都不拦点击');
    else bad('背景层会挡住点击');
  } else bad('App.vue 缺少 .app-root::before/::after 公共声明');
  const layer = /(?<!,)\n\s*\.app-root::after\s*\{([\s\S]*?)\}/.exec(appVue);
  if (layer) {
    const body = layer[1];
    if (/z-index:\s*-1/.test(body)) ok('蒙版层 z-index:-1（在内容之下、背景之上）');
    else bad('蒙版层 z-index 不对');
    if (/background:\s*var\(--bg-mask/.test(body)) ok('蒙版层消费 --bg-mask');
    else bad('蒙版层未消费 --bg-mask');
    if (/backdrop-filter:\s*var\(--bg-blur/.test(body)) ok('蒙版层消费 --bg-blur（背景模糊，整条 filter 值）');
    else bad('蒙版层未消费 --bg-blur');
  } else bad('App.vue 缺少 .app-root::after 蒙版层');
  console.log('== 16. 浅色底色不再接近白 ==');
  // 卡片是 rgba(255,255,255,0.72) 的磨砂玻璃，叠在底色上大概就是这个亮度。
  // 以前默认底 #f4f6f4 和它只差 8 个灰阶 —— 看上去就是"一整屏白"，窗体立不起来。
  const cardOver = (hex) => {
    const c = color.hexToRgb(hex);
    return color.rgbToHex(
      c[0] + (255 - c[0]) * 0.72,
      c[1] + (255 - c[1]) * 0.72,
      c[2] + (255 - c[2]) * 0.72
    );
  };
  const avg = (hex) => {
    const c = color.hexToRgb(hex);
    return (c[0] + c[1] + c[2]) / 3;
  };
  const gapOf = (hex) => Math.round(avg(cardOver(hex)) - avg(hex));
  theme.setDark(false);
  const defSolid = theme.BACKGROUNDS[0].solid;
  const defLum = color.luminance(defSolid);
  if (defLum < 0.85) ok('默认底色亮度 ' + defLum.toFixed(2) + ' < 0.85（不再接近白）');
  else bad('默认底色仍接近白 = ' + defSolid + '（亮度 ' + defLum.toFixed(2) + '）');
  const defGap = gapOf(defSolid);
  if (defGap >= 12) ok('默认底色与玻璃卡片差 ' + defGap + ' 个灰阶（窗体立得住）');
  else bad('默认底色与卡片只差 ' + defGap + ' 阶，会糊成一片');
  if (theme.LIGHT_BG === defSolid) ok('LIGHT_BG 与默认底色一致 = ' + theme.LIGHT_BG);
  else bad('LIGHT_BG（' + theme.LIGHT_BG + '）与默认底色（' + defSolid + '）不一致');
  // 渐变预设取中间色标做代表
  const tooWhite = theme.BACKGROUNDS.filter(b => color.luminance(b.solid) > 0.9).map(b => b.key);
  if (tooWhite.length === 0) ok(theme.BACKGROUNDS.length + ' 个浅色预设都不再接近白（最亮 ' +
    Math.max.apply(null, theme.BACKGROUNDS.map(b => color.luminance(b.solid))).toFixed(2) + '）');
  else bad('这些预设仍接近白：' + tooWhite.join(', '));
  // 深色档不能跟着被改浅
  const darkTooLight = theme.BACKGROUNDS.filter(b => color.luminance(b.darkSolid) > 0.05).map(b => b.key);
  if (darkTooLight.length === 0) ok('深色档没有被这次改动带偏（仍是很暗的同色相变体）');
  else bad('这些深色档变亮了：' + darkTooLight.join(', '));

  console.log('== 17. 自定义底色 ==');
  if (settings.defaults().theme.bgColor === '') ok('settings 默认 bgColor 为空（没挑过就用 DEFAULT_CUSTOM）');
  else bad('settings 默认 bgColor 应为空');
  theme.setDark(false);
  const c1 = theme.setCustomColor('#7fb3ff');
  if (c1 === '#7fb3ff') ok('setCustomColor 返回归一化 hex = ' + c1);
  else bad('setCustomColor 返回异常：' + c1);
  if (theme.current() === 'custom') ok('挑色即切到 custom 档（不用再点一次）');
  else bad('没切到 custom：' + theme.current());
  if (theme.currentCustomColor() === '#7fb3ff') ok('已持久化到 settings.theme.bgColor');
  else bad('未持久化：' + theme.currentCustomColor());
  cssVars = {};
  theme.apply();
  if ((cssVars['--app-bg'] || '').indexOf('#7fb3ff') >= 0) ok('自定义色进了背景渐变 = ' + cssVars['--app-bg'].slice(0, 48) + '…');
  else bad('自定义色没进 --app-bg：' + cssVars['--app-bg']);
  const st5 = theme.rootStyle();
  if (st5.backgroundColor === '#7fb3ff' && /gradient/.test(st5.backgroundImage || '')) ok('根节点铺自定义色（App 端 inline 兜底）');
  else bad('根节点未铺自定义色：' + JSON.stringify(st5));
  if (bgCalls[bgCalls.length - 1] === '#7fb3ff') ok('原生窗体底色同步 = ' + bgCalls[bgCalls.length - 1]);
  else bad('原生窗体底色未同步：' + bgCalls[bgCalls.length - 1]);
  // 深色：同色相压暗，不能一刀切回 #121513（否则深色下挑的颜色等于白挑）
  theme.setDark(true);
  const dv = theme.backgroundOf('custom', true).solid;
  if (dv !== '#7fb3ff' && dv !== theme.DARK_BG) ok('深色档是同色相压暗变体 = ' + dv);
  else bad('深色档没变（等于丢掉了用户挑的颜色）：' + dv);
  const hL = color.hexToHsl('#7fb3ff').h, hD = color.hexToHsl(dv).h;
  if (Math.abs(hL - hD) <= 2) ok('深色变体保住色相（' + hL + '° → ' + hD + '°）');
  else bad('深色变体色相漂移：' + hL + '° → ' + hD + '°');
  const dvLum = color.luminance(dv);
  if (dvLum < 0.06) ok('深色变体足够暗（亮度 ' + dvLum.toFixed(3) + '）');
  else bad('深色变体不够暗：' + dv + '（亮度 ' + dvLum.toFixed(3) + '）');
  theme.setDark(false);
  // 非法颜色：什么都不改，返回当前值
  const keep = theme.currentCustomColor();
  if (theme.setCustomColor('not-a-color') === keep && theme.currentCustomColor() === keep) ok('非法颜色被拒，原值不变 = ' + keep);
  else bad('非法颜色没被拒：' + theme.currentCustomColor());
  if (theme.setCustomColor('#ABC') === '#aabbcc') ok('三位简写也能收（#ABC → #aabbcc）');
  else bad('三位简写未归一化：' + theme.currentCustomColor());
  // 切回预设要干净
  theme.setBackground('default');
  if (theme.current() === 'default' && !/7fb3ff|aabbcc/.test(cssVars['--app-bg'] || '')) ok('切回预设正常（不再带自定义色）');
  else bad('切回预设失败：' + cssVars['--app-bg']);
  if (theme.setCustomColor(theme.DEFAULT_CUSTOM) === theme.DEFAULT_CUSTOM) ok('DEFAULT_CUSTOM 可用 = ' + theme.DEFAULT_CUSTOM);
  else bad('DEFAULT_CUSTOM 异常：' + theme.DEFAULT_CUSTOM);
  theme.setBackground('default');
  theme.setDark(false);

  if (/\.cover\.app-root::before,\s*\.cover\.app-root::after\s*\{[^}]*display:\s*none/s.test(appVue)) ok('启动封面不叠背景层与蒙版');
  else bad('封面应排除背景层');
  if (/page\s*\{[^}]*background-attachment:\s*fixed/s.test(appVue)) ok('page 兜底底色同样 fixed');
  else bad('page 兜底底色未 fixed');
  // 窗体必须保持半透明毛玻璃（不能被改成不透明）
  if (/var\(--surface-rgb[^)]*\)\s*,\s*0?\.\d+\)/.test(appVue) && /backdrop-filter/.test(appVue)) ok('.card / .glass 仍是半透明 + 背景模糊');
  else bad('窗体被改成了不透明（应保留毛玻璃）');

  console.log(fail === 0 ? '\n外观主题全部通过' : '\n存在 ' + fail + ' 项失败');
  process.exitCode = fail === 0 ? 0 : 1;
})();
