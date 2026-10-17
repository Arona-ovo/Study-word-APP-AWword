// _tools/check-responsive.js - 屏幕自适应（换手机 / 转屏 / 折叠屏，比例不能变）
//
// 2026-10-17 用户问："这些页面应该都是可以根据屏幕变动的吧，不是写死的，
// 不要我目前手机这边看的正常，到时候换一部手机就比例完全变了。"
//
// 结论：布局**全部用 rpx**（750rpx = 屏宽 → 换手机是等比缩放，比例天然不变）。
// 真正会被屏幕尺寸坑到的只有两类东西，这个脚本就守这两类：
//
// ① **硬编码 px 尺寸**：rpx 跟着屏宽走，px 不跟 —— 混进一个 px，那个元素在别的
//    屏宽下就会跟周围的比例对不上（宽屏上偏小、窄屏上偏大）。
//    ⚠️ 两种 px 是**对的**，不许误杀：
//      · 1px / 0.5px 的 hairline 分隔线（要的就是"一个物理像素"）
//      · blur() 半径、box-shadow 的模糊半径（按物理尺寸一致才对）
//    ⚠️ 引导蒙层（onboarding-mask）整份用 px 是**刻意的**：它是系统弹窗式的气泡，
//      该保持物理尺寸，而且已经有 max-width: calc(100vw - 48px) 兜底（见白名单）。
//
// ② **用 JS 缓存过的 px**：rpx 是 CSS 层的，CSS 变量一变浏览器自己重算；
//    但 JS 里 `const x = upx(220)` 算出来的 px 就定死了 —— 屏幕尺寸一变
//    （横竖屏切换 / 折叠屏展开 / 分屏）就成了旧屏幕的值，必须重算。
//    → home.vue 的 remeasure() + onResize；theme.js 的 resetSafeInset()。
//
// ③ 纵向留白用 rpx（只跟屏宽走）时，屏幕"变扁"会挤爆内容盒 → 必须有 vh 上限。
//
// 断言分两层：源码契约（剥注释后扫）+ 白名单核对（白名单必须真的还在用 px）。
const fs = require('fs');
const path = require('path');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', 'uniapp', rel), 'utf8').replace(/\r\n/g, '\n');
// 剥两种注释再扫：注释里写 "width: 300px" 也会被正则扫到（假绿 / 假红）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
// 抠出某条规则 / 某个函数的**函数体**（大括号配平）。
// ⚠️ 不许拿正则去扫整个文件：文件里别处有同样的字样时，断言会永远为真 = 假绿
//    （2026-10-17 变异测试当场抓到三处：气泡的 position 扫到了别处的 fixed、
//     created 里的 remeasure 扫到了 onResize 里的、_safeB = -1 扫到了声明那一行）。
function body(s, sig) {
  const i = s.indexOf(sig);
  if (i < 0) return '';
  let depth = 0;
  for (let j = s.indexOf('{', i); j >= 0 && j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return s.slice(i, j + 1);
    }
  }
  return '';
}

const uniappDir = path.join(__dirname, '..', 'uniapp');
function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'unpackage' || n === 'node_modules' || n === 'static') continue;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.vue')) out.push(p);
  }
  return out;
}
const vueFiles = walk(uniappDir).map((p) => path.relative(uniappDir, p).replace(/\\/g, '/'));

console.log('== 1. 硬编码 px 尺寸（rpx 之外的尺寸单位）==');
// 允许的 px：hairline（1px / 0.5px）、0 值、blur / shadow 的模糊半径、vw/vh 混算里的 0
const PX_ALLOW = /(^|[^\d.])(0|1|0\.5)px\b/;
const WIDTH_KINDS = /(width|height|padding|margin|font-size|line-height|border-radius|top|left|right|bottom|gap|flex-basis|letter-spacing|min-height|max-height|min-width|max-width|border-width)/;
// 白名单：整份按物理尺寸设计、且有 max-width 兜底的气泡（见文件头）
const WHITELIST = ['components/onboarding-mask.vue'];

const offenders = [];
for (const rel of vueFiles) {
  if (WHITELIST.includes(rel)) continue;
  const raw = R(rel);
  // 只扫 <style> 段：模板里的行内样式数值另有讲究，另行处理
  const st = raw.lastIndexOf('\n<style');
  if (st < 0) continue;
  const css = strip(raw.slice(st));
  css.split('\n').forEach((line, i) => {
    if (!WIDTH_KINDS.test(line)) return;
    // 抓出这条声明里所有形如 `123px` 的数
    const m = line.match(/(\d+(?:\.\d+)?)px\b/g);
    if (!m) return;
    const bads = m.filter((x) => !PX_ALLOW.test(x));
    if (bads.length) offenders.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 70) + '   [' + bads.join(',') + ']');
  });
}
assert(offenders.length === 0,
  '页面/组件里没有硬编码 px 尺寸（rpx 才能跟着屏宽走）' + (offenders.length ? '\n      ' + offenders.slice(0, 8).join('\n      ') : ''));

console.log('== 2. 白名单仍然成立（不是"忘了改"）==');
{
  const w = R('components/onboarding-mask.vue');
  assert(/\d+px/.test(w), 'onboarding-mask 确实还在用 px（白名单没白列）');
  // ⚠️ 抠 .gd-tip 自己的块再断言：整个文件里 .gd-hole / .gd-center 也都是 fixed，
  //    扫全文的话把气泡改成 relative 也照样匹配（2026-10-17 变异抓到的假绿）。
  const tip = body(w, '.gd-tip {');
  assert(tip.length > 0, '抠到 .gd-tip 气泡规则');
  assert(/max-width:\s*calc\(100vw - \d+px\)/.test(w),
    '气泡有 max-width 兜底（窄屏上不会撑破，px 才敢用）');
  assert(/position:\s*fixed/.test(tip), '气泡自己是 fixed 定位（不参与文档流，不影响页面比例）');
}

console.log('== 3. JS 缓存的 px 必须能重算（转屏 / 折叠屏 / 分屏）==');
{
  const home = R('pages/home/home.vue');
  const code = strip(home);
  // rpx → px 的换算集中在一处，换算不出来要有兜底（拿不到屏宽时按 375）
  assert(/upx\(v\)\s*\{/.test(code), 'rpx → px 只有一个入口 upx()（不许各处自己乘屏宽）');
  assert(/uni\.upx2px/.test(code), '优先走 uni.upx2px（官方换算，跟 CSS 里的 rpx 同一套基准）');
  assert(/v \* w \/ 750/.test(code) || /v\s*\*\s*w\s*\/\s*750/.test(code),
    '拿不到 upx2px 时按 750 基准自己换（不能写死某个屏宽）');
  // 缓存的那几个距离：不许散落在 syncReveal 里现算（getSystemInfoSync 不便宜）
  assert(/remeasure\(\)\s*\{/.test(code), '有 remeasure() 把缓存的 px 集中重算');
  assert(/this\._spanPx = this\.upx\(520\)/.test(code) &&
         /this\._parallaxPx = this\.upx\(220\)/.test(code) &&
         /this\._heroLiftPx = this\.upx\(56\)/.test(code) &&
         /this\._deadPx = this\.upx\(16\)/.test(code),
    '四个距离（淡入 / 视差 / 上抬 / 死区）都由 remeasure 统一换算');
  // ⚠️ 关键：光有缓存不够，屏幕变了必须有人去重算
  assert(/onResize\(\)\s*\{[\s\S]{0,120}remeasure\(\)/.test(code),
    'onResize 里重算（转屏 / 折叠屏后缓存的 px 不会变成旧屏幕的值）');
  assert(/onResize\(\)\s*\{[\s\S]{0,200}syncReveal/.test(code),
    '重算完立刻用新值重排一次进度（否则要等下一次滚动才生效）');
  assert(/const dead = this\._deadPx/.test(code),
    '死区也走缓存（syncReveal 逐帧调用，兜底分支的 getSystemInfoSync 不能按帧跑）');
  // ⚠️ 必须抠 created **自己的函数体**：直接拿 created~onLoad 之间的一段去扫，
  //    会把紧挨着的 onResize 里的 remeasure 也算进来（2026-10-17 变异抓到的假绿）。
  assert(/this\.remeasure\(\)/.test(body(code, 'created() {')),
    'created 里先算一遍（首次进入也要有值）');
  assert(/onResize\(\)\s*\{[\s\S]{0,120}this\.remeasure\(\)/.test(code),
    'onResize 里调的是 remeasure 本身（不是把四个值再抄一遍）');
}

console.log('== 4. theme.js 缓存的实测安全区同样要能重算 ==');
{
  const th = strip(R('utils/theme.js'));
  assert(/export function resetSafeInset/.test(th), '导出 resetSafeInset（清掉缓存的导航条高度）');
  // ⚠️ 抠函数体再断言：文件开头那句 `let _safeB = -1;` 本身就带 "-1"，
  //    扫全文的话 resetSafeInset 写成 _safeB = 0 也照样通过（2026-10-17 变异抓到）。
  const rs = body(th, 'export function resetSafeInset()');
  assert(/_safeB = -1/.test(rs), '清缓存是置 -1（下一次 safeInsetPx 才会重新量）');
  assert(!/_safeB = 0/.test(rs), '不能置 0（那是"量过了、结果就是 0"，不会再重量）');
  // 缓存只能加在"第一次"上：每次都量就没意义了，每次都不量就永远不更新
  assert(/if \(_safeB >= 0\) return _safeB;/.test(th), 'safeInsetPx 只在首次真算（后续走缓存）');
}

console.log('== 5. 全局 mixin 要把尺寸变化广播到每个页面 ==');
{
  const mx = strip(R('utils/theme-mixin.js'));
  assert(/onResize\(\)\s*\{/.test(mx), 'theme-mixin 有 onResize（页面级生命周期，自动生效）');
  assert(/onResize\(\)\s*\{[\s\S]{0,200}resetSafeInset/.test(mx), 'onResize 里清掉安全区缓存');
  assert(/onResize\(\)\s*\{[\s\S]{0,240}refreshAppTheme/.test(mx), 'onResize 里重算根节点样式（--safe-b 才会更新）');
}

console.log('== 6. 纵向留白：rpx 只跟屏宽走，屏幕变扁要能收住 ==');
{
  const home = R('pages/home/home.vue');
  const css = strip(home.slice(home.lastIndexOf('\n<style')));
  const hero = (css.match(/\.focus-hero \{[\s\S]*?\n\}/) || [''])[0];
  assert(hero.length > 0, '抠到 .focus-hero 规则');
  // 竖屏下 244rpx 只占屏高约 15%，min() 不生效；屏幕一变扁（横屏 / 折叠屏展开）
  // 它才接管 —— 没有这条，内容盒会被挤成负数，入口被顶出屏幕。
  assert(/padding-top:\s*min\(/.test(hero) && /padding-bottom:\s*min\(/.test(hero),
    'hero 的上下留白有 vh 上限（屏幕变扁时不至于把内容挤没）');
  assert(/14vh/.test(hero) && /34vh/.test(hero), '上限用的是 vh（跟屏高走，正是 rpx 缺的那一维）');
  // ⚠️ 老 webview 不认 min() 会整条声明丢掉 → 必须先给一条不带 min() 的兜底
  const iFallback = hero.indexOf('padding:');
  const iMin = hero.indexOf('padding-top: min(');
  assert(iFallback >= 0 && iFallback < iMin,
    'min() 之前有一条普通 padding 兜底（老 webview 不认 min() 也不至于没留白）');
  // hero 高度本身要跟屏高走
  assert(/min-height:\s*calc\(100vh/.test(hero), 'hero 的高度跟屏高走（不是写死的某个值）');
}

console.log('== 7. 单位一致性：不能出现"一半 rpx 一半 px"的混合运算 ==');
{
  const home = R('pages/home/home.vue');
  const css = strip(home.slice(home.lastIndexOf('\n<style')));
  // calc(数字rpx + 数字px) 这种混合在现代浏览器里合法，但其中那个 px 是**不缩放**的，
  // 换手机就会跑偏 —— 这里只盯"rpx 与 px 直接相加"这一种最明显的。
  const mixed = (css.match(/calc\([^)]*\d+rpx[^)]*\d+px[^)]*\)/g) || [])
    .filter((s) => !/var\(--status-bar-height/.test(s) && !/env\(/.test(s) && !/var\(--safe-b/.test(s));
  assert(mixed.length === 0,
    'calc 里没有裸 rpx + 裸 px 的混合（var()/env() 兜底不算）' + (mixed.length ? '\n      ' + mixed.join('\n      ') : ''));
}

console.log('');
if (fail) { console.log('屏幕自适应 失败 ' + fail + ' 项'); process.exit(1); }
console.log('屏幕自适应 全部通过');
