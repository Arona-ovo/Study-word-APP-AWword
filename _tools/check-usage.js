// _tools/check-usage.js - 校验「停留时长圆环卡」（真实模块 + 只读源码）
// 运行：node _tools/check-usage.js
//
// 覆盖：
//  1) utils/usage.js 计时口径：起表 / 结算 / 30s 落盘 / 异常跨度丢弃
//  2) 按天存储：dayKey、14 天保留、持久化格式
//  3) 读数：todayMinutes / recentMinutes / avgMinutes（只按活跃天平均）/ totalMinutes
//  4) 圆环角度数学：两半合起来刚好覆盖 [0°, α]，且没有 360° 跳变（否则会整圈自旋）
//  5) 渲染契约：纯 transform + border（不用 Canvas / SVG / conic-gradient）
//  6) 接入：home-layout 注册、home.vue 导入注册与渲染分支、App.vue 起停表
//  7) 生命周期：定时器与 home:refresh 都要解绑

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- mock：uni 存储 ---------------- */
const mem = {};
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}
const near = (a, b, tol, label) =>
  (Math.abs(a - b) <= tol ? ok(label + ' ≈ ' + b) : bad(label + ' 期望 ≈' + b + '，实际 ' + a));

/* ---------------- 冻结时钟 ----------------
   usage.js 用 Date.now() 量跨度、用 new Date() 取「今天」。
   只替换 Date.now：跨度可控，而日期键仍是真实今天，两处口径一致。 */
const REAL_NOW = Date.now;
let NOW = REAL_NOW();
Date.now = () => NOW;

const usage = load('utils/usage.js');

(async () => {
  /* ---------- 1. 计时口径 ---------- */
  console.log('== 1. usage.js 计时口径 ==');
  usage.clear();
  NOW = REAL_NOW();
  eq(usage.todayMs(), 0, '清空后今日为 0');

  usage.start();
  NOW += 5 * 60000;
  usage.flush();
  eq(usage.todayMs(), 300000, '前台待 5 分钟 → 300000ms');
  eq(usage.todayMinutes(), 5, 'todayMinutes = 5');

  // 结算之后 enterAt 重置：同一段不会被重复计入
  usage.flush();
  eq(usage.todayMs(), 300000, '重复 flush 不重复计数');

  // start() 幂等：onShow 连来两次（中间没 onHide）也不吞掉中间那截
  NOW += 60000;
  usage.start();          // 内部先 flush 旧段（1 分钟）
  NOW += 2 * 60000;
  usage.flush();
  eq(usage.todayMs(), 480000, 'start 前先结算（5+1+2 分钟 = 480000ms）');

  // 异常跨度：> 6h 直接丢（时钟跳变 / 后台计时器），不能记成几十小时
  NOW += 7 * 3600000;
  usage.flush();
  eq(usage.todayMs(), 480000, '跨度 7 小时被丢弃（MAX_SPAN = 6h）');

  usage.stop();
  NOW += 3 * 60000;
  usage.flush();
  eq(usage.todayMs(), 480000, 'stop 之后不再累加');

  eq(usage.addMs(0), 480000, 'addMs(0) 不改变');
  eq(usage.addMs(-500), 480000, 'addMs(负数) 不改变');
  eq(usage.addMs(60000), 540000, 'addMs(1 分钟) 累加');

  /* ---------- 2. 按天存储 ---------- */
  console.log('== 2. 按天存储 / 淘汰 / 持久化 ==');
  const k = usage.dayKey(new Date(2026, 2, 10, 23, 59, 59));
  eq(k, '2026-03-10', 'dayKey 本地日期键');
  eq(usage.dayKey(new Date(2026, 0, 5, 0, 0, 0)), '2026-01-05', 'dayKey 补零');

  const stored = JSON.parse(mem['fj_usage_v1'] || '{}');
  eq(stored.v, 1, '持久化带版本号 v=1');
  assert(stored.days && typeof stored.days === 'object', '持久化含 days 对象');
  assert(k in stored.days === false, '历史日期未被写入');

  // 14 天保留：注入 20 天老数据后再写一次，键数应回到 14 且最新的留下
  const days = usage.raw();
  Object.keys(days).forEach(d => { delete days[d]; });
  for (let i = 19; i >= 0; i--) {
    const d = new Date(REAL_NOW() - i * 86400000);
    days[usage.dayKey(d)] = 60000;
  }
  eq(Object.keys(days).length, 20, '注入 20 天');
  usage.addMs(1000);
  const keys = Object.keys(days).sort();
  eq(keys.length, 14, '淘汰后保留 14 天');
  eq(keys[13], usage.dayKey(), '最新的一天（今天）保留');
  assert(keys.indexOf(usage.dayKey(new Date(REAL_NOW() - 19 * 86400000))) < 0, '最老的一天被淘汰');

  /* ---------- 3. 读数 ---------- */
  console.log('== 3. 读数：今日 / 近 n 天 / 日均 / 累计 ==');
  const d0 = usage.raw();
  Object.keys(d0).forEach(d => { delete d0[d]; });
  const today = usage.dayKey();
  const y = usage.dayKey(new Date(REAL_NOW() - 86400000));
  d0[today] = 30 * 60000;
  d0[y] = 10 * 60000;

  const recent = usage.recentMinutes(7);
  eq(recent.length, 7, 'recentMinutes(7) 返回 7 天');
  eq(recent[6], 30, '最后一项是今天');
  eq(recent[5], 10, '倒数第二项是昨天');
  assert(recent.slice(0, 5).every(m => m === 0), '其余 5 天为 0');
  // 顺序必须是时间升序（画折线 / 算日均都依赖这个顺序）
  eq(usage.dayKey(new Date(REAL_NOW() - 6 * 86400000)) < today, true, '首项 = 6 天前');

  // 日均只除以"有记录的天"：30 分钟 ÷ 7 天 = 4 分钟是误导，÷ 2 天 = 20 才对
  eq(usage.avgMinutes(7), 20, '日均按活跃天平均（(30+10)/2）');
  eq(usage.totalMinutes(7), 40, '近 7 天累计 40 分钟');

  Object.keys(d0).forEach(d => { delete d0[d]; });
  eq(usage.avgMinutes(7), 0, '没有任何记录时日均 0（不是 NaN）');
  eq(usage.avgMinutes(0), 0, 'avgMinutes(0) 仍为 0');
  // 0 / NaN 都当"没传"处理 → 默认 7 天（和 avgMinutes() 不传参一致）
  eq(usage.recentMinutes(0).length, 7, 'recentMinutes(0) 视为未传 → 7 天');
  eq(usage.recentMinutes(undefined).length, 7, 'recentMinutes(undefined) → 7 天');
  eq(usage.recentMinutes(3).length, 3, 'recentMinutes(3) → 3 天');

  /* ---------- 4. 圆环角度数学 ---------- */
  console.log('== 4. 圆环两半的角度数学 ==');
  const wSrc = R('components/home-widgets/widget-usage.vue');
  // 直接抠出组件里的两个 computed 方法体，用真实代码算，不复制一份（避免改了组件测试还绿）
  const bodyOf = (name) => {
    const m = wSrc.match(new RegExp('\\n    ' + name + '\\(\\) \\{([\\s\\S]*?)\\n    \\},'));
    return m ? m[1] : null;
  };
  const arcBodyL = bodyOf('arcL');
  const arcBodyR = bodyOf('arcR');
  assert(!!arcBodyL && !!arcBodyR, '能抠出 arcL / arcR 方法体');
  const deg = (o) => parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(o.transform)[1]);
  const arcL = new Function('_this', 'return (function(){' + arcBodyL + '\n}).call(_this);');
  const arcR = new Function('_this', 'return (function(){' + arcBodyR + '\n}).call(_this);');
  const phiL = (a) => deg(arcL({ alpha: a }));
  const phiR = (a) => deg(arcR({ alpha: a }));

  /**
   * 可见角域：弧元素自身覆盖 [φ-90°, φ+90°]（上圆角半圆，绕底边中点转）；
   * 右窗裁出 [0°,180°]，左窗裁出 [180°,360°]。角度一律以 12 点方向为 0°、顺时针为正。
   */
  const clip = (s, e, w1, w2) => {
    const a = Math.max(s, w1);
    const b = Math.min(e, w2);
    return b - a > 1e-9 ? [a, b] : null;
  };
  function coverage(a) {
    const r = clip(phiR(a) - 90, phiR(a) + 90, 0, 180);
    const l0 = clip(phiL(a) - 90, phiL(a) + 90, -180, 0);   // 左窗下移 360° 便于相交
    return { r, l: l0 ? [l0[0] + 360, l0[1] + 360] : null };
  }

  [0, 1, 30, 90, 179, 180, 181, 270, 359, 360].forEach(a => {
    const c = coverage(a);
    const len = (c.r ? c.r[1] - c.r[0] : 0) + (c.l ? c.l[1] - c.l[0] : 0);
    const from = c.r ? c.r[0] : (c.l ? c.l[0] : null);
    assert(Math.abs(len - a) < 1e-6,
      'α=' + a + '° 两半合计覆盖 ' + len.toFixed(1) + '°（应为 ' + a + '°）');
    assert(a === 0 || from === 0, 'α=' + a + '° 弧从 12 点方向起（起点 ' + from + '°）');
    if (a > 180) assert(!!c.l && Math.abs(c.l[1] - a) < 1e-6, 'α=' + a + '° 左半补到 ' + a + '°');
    else assert(c.l === null, 'α=' + a + '° 左半完全不露');
    if (a >= 180) assert(!!c.r && Math.abs(c.r[1] - 180) < 1e-6, 'α=' + a + '° 右半填满半圈');
  });

  // 相邻角度的旋转量不能有 ~360° 的跳变：CSS transition 会把差值画成一整圈自旋
  let maxJump = 0;
  let jumpAt = 0;
  for (let a = 1; a <= 360; a++) {
    const j = Math.max(Math.abs(phiL(a) - phiL(a - 1)), Math.abs(phiR(a) - phiR(a - 1)));
    if (j > maxJump) { maxJump = j; jumpAt = a; }
  }
  near(maxJump, 1, 1e-6, '每前进 1° 旋转量最大变化 ' + maxJump.toFixed(3) + '°（无整圈跳变，@' + jumpAt + '°）');
  assert(maxJump < 180, '不存在 ±360° 跳变（否则圆环会自旋');

  /* ---------- 5. 渲染契约 ---------- */
  console.log('== 5. 圆环渲染契约 ==');
  const tpl = wSrc.slice(0, wSrc.indexOf('\n<script'));
  const css = wSrc.slice(wSrc.indexOf('\n<style'));
  assert(!/<canvas/i.test(wSrc) && !/<svg/i.test(wSrc), '不用 Canvas / SVG（各端支持不一致）');
  // 只看样式块：注释里提到 conic-gradient 不算（模板注释里有说明文字）
  assert(!/conic-gradient/.test(css), '不用 conic-gradient（老 WebView 没有）');
  assert(/class="ring-win"/.test(tpl) && /overflow:\s*hidden/.test(css), '两个裁切窗口 overflow: hidden');
  assert(/transform-origin:\s*50%\s*100%/.test(css), '弧的旋转中心 = 底边中点（圆心）');
  assert(/border-bottom:\s*none/.test(css), '弧去掉下边框（否则半圆底边多一条线）');
  assert(/transition:\s*transform\s+900ms/.test(css), '弧带 transform 过渡（动画进度条）');
  assert(/prefers-reduced-motion/.test(css), '尊重「减弱动效」偏好');
  // 尺寸必须自洽：环 200、半宽 100、弧 200×100、上圆角 100
  assert(/\.ring\s*\{[^}]*width:\s*200rpx[^}]*height:\s*200rpx/s.test(css), '圆环 200×200rpx');
  assert(/\.ring-win\s*\{[^}]*width:\s*100rpx/s.test(css), '裁切窗口半宽 100rpx');
  assert(/\.ring-arc\s*\{[^}]*width:\s*200rpx[^}]*height:\s*100rpx/s.test(css), '弧元素 200×100rpx');
  assert(/border-top-left-radius:\s*100rpx/.test(css), '弧上圆角 100rpx');
  assert(/var\(--brand/.test(css) && /var\(--ink-1/.test(css), '弧用主色变量、数字用文本色变量');
  // 中间数字
  assert(/class="ring-mid"/.test(tpl), '圆心叠放数字');
  assert(/class="us-num"/.test(tpl), '中间大数字');
  assert(/targetAlpha\(\)/.test(wSrc) && /minutes \/ 60/.test(wSrc), '一整圈 = 60 分钟');
  assert(/Math\.min\(1,/.test(wSrc), '超过一小时夹取为满圈');

  /* ---------- 6. 接入 ---------- */
  console.log('== 6. 首页接入 ==');
  const L = await import('file:///' + path.join(ROOT, 'utils/home-layout.ts').replace(/\\/g, '/'));
  const mod = L.MODULES.filter(m => m.id === 'usage')[0];
  assert(!!mod, 'home-layout 注册了 usage 模块');
  eq(mod.def, false, 'usage 注册在案、默认进收纳区（数据类不该各占一层，2026-10-15 定）');
  assert(L.defaultLayout().indexOf('usage') < 0, '默认布局不含 usage');
  eq(L.stashed().some(m => m.id === 'usage'), true, 'usage 在收纳区（要用随时加回）');

  const home = R('pages/home/home.vue');
  assert(/import\s+WidgetUsage\s+from/.test(home), 'home.vue 导入 WidgetUsage');
  assert(/components:\s*\{[\s\S]*WidgetUsage/.test(home), 'home.vue 注册 WidgetUsage');
  assert(/c\.type === 'usage'/.test(home), 'home.vue 有 usage 渲染分支');

  const app = R('App.vue');
  assert(/import\s+\*\s+as\s+usage\s+from\s+'\.\/utils\/usage\.js'/.test(app), 'App.vue 导入 usage');
  const onShow = app.slice(app.indexOf('  onShow()'), app.indexOf('  onHide()'));
  const onHide = app.slice(app.indexOf('  onHide()'));
  assert(/usage\.start\(\)/.test(onShow), 'onShow 起表 usage.start()');
  assert(/usage\.stop\(\)/.test(onHide), 'onHide 停表 usage.stop()');

  /* ---------- 7. 生命周期 ---------- */
  console.log('== 7. 定时器与事件解绑 ==');
  assert(/beforeUnmount\(\)/.test(wSrc) && /beforeDestroy\(\)/.test(wSrc), '两种卸载钩子都写了');
  assert(/clearInterval\(this\.tick\)/.test(wSrc), '卸载时清掉 60s 自刷定时器');
  assert(/uni\.\$off\('home:refresh'/.test(wSrc), '卸载时解绑 home:refresh');
  assert(/uni\.\$on\('home:refresh'/.test(wSrc), '订阅首页刷新事件');
  assert(/usage\.flush\(\)/.test(wSrc), '读数前先结算（数字是实时的）');
  assert(/ready/.test(wSrc) && /setTimeout/.test(wSrc), '进场动画用 ready 门控（否则过渡被跳过）');

  // 语言切换要能重渲染
  assert(/void this\.__lang/.test(wSrc), '依赖 __lang 触发语言切换重渲染');

  /* ---------- 8. 老首页自动补新模块 ---------- */
  // 回归点：pageDoc 是持久化的，新增内置模块后老用户的首页里根本没有那张卡。
  // 必须自动补进来，同时「用户自己收纳掉的」绝不能被塞回去。
  console.log('== 8. 老首页自动补新模块 ==');
  const U = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
  const settings = await import(U('utils/settings.js'));
  const PD = await import(U('utils/page-doc.js'));
  const builtin = (id) => ({ id: id, type: id, builtin: true, visible: true, title: '', text: '', image: '', style: null, blocks: null });

  // 老数据：一张"更新前"的首页（缺 stats/goal），seenBuiltins 还是 null。
  // ⚠️ 2026-10-15 起 usage 不在 defaultLayout 里了（默认进收纳区），ensureBuiltins
  //     只补 def:true 的卡 —— 所以这里改用 stats/goal 验「自动补」这套机制本身。
  settings.set({ home: { doc: { version: PD.VERSION, cards: ['book', 'action'].map(builtin) }, seenBuiltins: null } });
  let d = PD.get();
  let ids = d.cards.filter(c => c.builtin).map(c => c.id);
  assert(ids.indexOf('stats') >= 0 && ids.indexOf('goal') >= 0, '老首页自动补上缺的内置卡（stats / goal）');
  eq(ids.slice(0, 2).join(','), 'book,action', '原有顺序不变（补在内置卡末尾）');

  // 补过一次就记录在案，不能每次进来都补
  eq(PD.get().cards.filter(c => c.builtin).length, ids.length, '第二次读取不重复补');

  // 用户自己收纳掉的模块不能被塞回来（seenBuiltins 记过 = 用户见过它）
  // seenBuiltins 从注册表动态取，别硬编码写死——以后再上新的内置模块，这条断言不会误报。
  const HL = await import(U('utils/home-layout.ts'));
  settings.set({
    home: {
      doc: { version: PD.VERSION, cards: ['book', 'action'].map(builtin) },
      seenBuiltins: HL.defaultLayout().slice()
    }
  });
  ids = PD.get().cards.filter(c => c.builtin).map(c => c.id);
  eq(ids.join(','), 'book,action', '记过的模块不再补回来（用户收纳的保持收纳）');

  // AI 造的卡要始终排在内置卡之后
  settings.set({
    home: {
      doc: {
        version: PD.VERSION,
        cards: ['book'].map(builtin).concat([{ id: 'c-1', builtin: false, blocks: [] }])
      },
      seenBuiltins: null
    }
  });
  d = PD.get();
  eq(d.cards[d.cards.length - 1].id, 'c-1', 'AI 卡仍在最后（补进来的内置卡在它之前）');
  assert(d.cards[0].builtin === true, '内置卡排在最前');

  console.log('');
  console.log(fail === 0 ? '停留时长圆环卡全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
