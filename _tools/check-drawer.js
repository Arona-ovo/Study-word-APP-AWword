// _tools/check-drawer.js - 首页焦点模式的「上滑抽屉」校验
// 覆盖：
//  1) 手势挂点：整页响应 —— 挂在**页面根节点**上，并同时驱动左右滑页与抽屉；
//     手势绝不能挂在 .page-slide / 把手上（那样总有区域手指落下去没人接）
//  2) 开合状态机：0 ↔ 实测内容高 的真实过渡（0 ↔ none 不可插值 = 没有动画）
//  3) drawerStyle：卡片平铺形态零干预；展开完成后交还自然高度（不裁卡片）
//  4) CSS：动画期间要裁、展开后必须放开（否则编辑态拖动排序会被裁掉）
//  5) 上滑阈值滑动：够阈值才开/关，且一次滑动只触发一次
//  6) 起手门槛线：落点在 hero 里不参与手势；页面已滚动时下滑不收起
//  7) 定时器不泄漏：单一实例 + onHide 清掉
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
// CRLF 归一：跨行字面量在 CRLF 下永远匹配不到（跟 check-version-egg 同一个坑）
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const home = R('pages/home/home.vue');

// 抠方法体：⚠️ 参数要通配（drawerStyle() 没参数，dhMove(e) 有 —— 写死 \(\)
// 会抠不到后者）；⚠️ 方法体最后一行不能是 // 行注释，否则拼出来的 } 会被注释吃掉。
const bodyOf = (name) => {
  const m = home.match(new RegExp('\\n    ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\},'));
  return m ? m[1] : '';
};

console.log('== 1. 手势挂点（整页）==');
assert(/class="drawer-handle"/.test(home), '存在抽屉把手（视觉提示 + 点击开关）');
// ⚠️ 关键：手势必须挂在**页面根节点**上 —— 用户要的是"主页全局往上滑"。
//    前两版分别挂在窄把手、再挂在把手加高后的空白带上；只要不是整页，
//    总有一部分区域（把手下方到屏幕底、底部链接、tabbar 上沿那截）手指落下去
//    没人接 touchmove —— 用户反馈就是"在首页上滑毫无反应"。
{
  const i = home.indexOf('class="container page-tabbar page-nav"');
  const openTag = i > 0 ? home.slice(i, home.indexOf('>', i)) : '';
  assert(openTag.length > 0, '能抠出页面根节点的开标签');
  assert(/@touchstart="onRootTouchStart"/.test(openTag) && /@touchmove="onRootTouchMove"/.test(openTag),
    '上滑抽屉手势挂在页面根节点上（整页响应，不是某一块）');
  assert(/@touchend="onRootTouchEnd"/.test(openTag) && /@touchcancel="onRootTouchEnd"/.test(openTag),
    'touchend / touchcancel 都清起点（抬手 / 被系统抢走都不留残状态）');
}
// 根节点同一批事件要同时喂给「左右滑页」和「抽屉」两组手势
{
  const self = {};
  const body = bodyOf('onRootTouchStart');
  assert(body.length > 0, '能抠出 onRootTouchStart() 方法体');
  const calls = (name) => new RegExp('this\\.' + name + '\\(').test(body);
  assert(calls('dhStart'), 'onRootTouchStart 会调 dhStart（抽屉手势接上了）');
  assert(calls('onSlideStart'), 'onRootTouchStart 仍调 onSlideStart（左右滑页没被顶掉）');
  const mv = bodyOf('onRootTouchMove');
  assert(/this\.dhMove\(/.test(mv) && /this\.onSlideMove\(/.test(mv),
    'onRootTouchMove 同时驱动 dhMove 与 onSlideMove');
  const en = bodyOf('onRootTouchEnd');
  assert(/this\.dhEnd\(/.test(en) && /this\.onSlideEnd\(/.test(en),
    'onRootTouchEnd 同时收 dhEnd 与 onSlideEnd');
}
// 手势**不能**再挂回 .page-slide 或把手：同一事件会被根节点和它各触发一次，动作翻倍
{
  const i = home.indexOf('class="page-slide"');
  const slideTag = i > 0 ? home.slice(i, home.indexOf('>', i)) : '';
  assert(!/@touch/.test(slideTag), '.page-slide 上没有重复挂手势（父层已整页接管）');
  const j = home.indexOf('class="dh-bar"');
  const barTag = j > 0 ? home.slice(j, home.indexOf('>', j)) : '';
  assert(/@tap="toggleDrawer"/.test(barTag), '点击开关仍挂在 .dh-bar 上');
  assert(!/@touch/.test(barTag), '.dh-bar 上不挂手势（避免和根节点重复触发）');
}
{
  const i = home.indexOf('class="focus-hero"');
  const hero = i > 0 ? home.slice(i, home.indexOf('\n    </view>', i)) : '';
  assert(i > 0 && hero.length > 0, '能抠出 hero 模板块');
  assert(!/@touchmove/.test(hero), 'hero 上不单独挂 touchmove（整页手势由根节点统一接）');
  assert(/@tap="startPractice"/.test(hero) && /@tap="openWordDrill"/.test(hero), 'hero 两颗入口仍在（背句子 / 背单词）');
}
// 常驻说明文字已下线（用户要求）：把手只剩一条短横杠，怎么用交给新手引导讲
{
  const i = home.indexOf('class="drawer-handle"');
  const handle = i > 0 ? home.slice(i, home.indexOf('\n    </view>', i)) : '';
  assert(handle.length > 0, '能抠出把手模板块');
  assert(!/上滑查看全部功能/.test(handle), '把手上不再显示「上滑查看全部功能」这类常驻文字');
  assert(!/dh-text|dh-chev/.test(handle), '把手上没有文字 / 箭头节点（只留一条横杠）');
  assert(/class="dh-grip"/.test(handle), '把手保留 grip 横杠（"下面还有东西"的视觉提示）');
}

console.log('== 2. 开合状态机（真实高度过渡）==');
assert(/drawerH:/.test(home) && /drawerMax:/.test(home), 'data 里有 drawerH / drawerMax');
assert(/measureDrawer\(\)/.test(home) && /selectAll\('\.mod-wrap'\)/.test(home),
  'measureDrawer() 用 selectAll(.mod-wrap) 量卡片真实内容高');
// 抠出三个方法体，用假 this 跑真代码（不是照抄一份逻辑来测）
// ⚠️ 参数要通配：drawerStyle() 没参数，dhMove(e) 有 —— 写死 \(\\) 会抠不到后者（假绿）
// 被 dhStart / dhMove 依赖的小工具也用**真方法体**拼进去：
// 拷一份逻辑来测等于没测（改动两边会漂移，断言永远绿）
const mkSelf = (extra) => {
  const base = {
    isFocus: true,
    drawerOpen: false,
    drawerH: 800,
    drawerMax: null,
    drawerT: 0,
    editing: false,
    __timers: [],
    __dhY: null,
    __dhX: 0,
    __dhAxis: 0,
    __dhFiredAt: 0,
    __pageTop: 0,
    // 桩：真实实现要读系统信息算底栏上沿（Node 里没有 uni）。
    // 默认给一个"底栏从 y=690 起"的视口，测试里按需覆盖。
    dhFloorY() { return 690 },
    setDrawerTimer(fn, ms) { this.__timers.push({ fn, ms }) },
    openDrawer() { this.drawerOpen = true },
    closeDrawer() { this.drawerOpen = false }
  };
  // ⚠️ 形参要按原方法补齐：拼接时统一写成 function () 会让带参方法 ReferenceError
  const HELPERS = { dhPoint: 'e', dhNum: 'a, b', dhFire: 'open', dhSwallowTap: '' };
  Object.keys(HELPERS).forEach(n => {
    const b = bodyOf(n);
    assert(b.length > 0, '能抠出 ' + n + '() 方法体');
    base[n] = new Function('return function (' + HELPERS[n] + ') {' + b + '}')();
  });
  return Object.assign(base, extra || {});
};
const runWith = (name, self) => {
  const b = bodyOf(name);
  if (!b) return null;
  const f = new Function('return function () {' + b + '}')();
  f.call(self);
  return self;
};

['drawerStyle', 'openDrawer', 'closeDrawer'].forEach(n => {
  assert(bodyOf(n).length > 0, '能抠出 ' + n + '() 方法体');
});

{
  const s = mkSelf();
  const f = new Function('return function () {' + bodyOf('drawerStyle') + '}')();
  assert(JSON.stringify(f.call(mkSelf({ isFocus: false }))) === '{}',
    '卡片平铺形态：drawerStyle 完全不干预（{}）');
  assert(JSON.stringify(f.call(mkSelf({ drawerMax: '0px' }))) === '{"maxHeight":"0px"}',
    '收起（动画钉住 0）：maxHeight = 0px');
  assert(JSON.stringify(f.call(mkSelf({ drawerOpen: true, drawerMax: null }))) === '{}',
    '展开完成后交还自然高度（drawerMax=null → 不加限制，卡片长高不会被裁）');
  assert(JSON.stringify(f.call(mkSelf({ drawerOpen: false, drawerMax: null }))) === '{"maxHeight":"0px"}',
    '收起且没在动画：仍是 0px');
}

{
  // 展开：先钉成「实测高 + 余量」，动画走完再交还自然高度
  const s = runWith('openDrawer', mkSelf());
  assert(s.drawerOpen === true, 'openDrawer 置 drawerOpen = true');
  assert(s.drawerMax === '920px', 'openDrawer 把高度钉成 实测高+120 = 920px（有具体值才有过渡）');
  assert(s.__timers.length === 1, 'openDrawer 挂了 1 个收尾定时器');
  s.__timers[0].fn.call(s);
  assert(s.drawerMax === null, '动画结束后 drawerMax 交还 null（之后不再裁切）');
  // 已经展开就别重复触发
  const s2 = runWith('openDrawer', mkSelf({ drawerOpen: true }));
  assert(s2.__timers.length === 0, '已经展开时 openDrawer 直接返回（不重复开）');
}

{
  // 收起：此刻可能是 none（不可插值），必须先钉回具体值，下一拍再收到 0
  const s = runWith('closeDrawer', mkSelf({ drawerOpen: true, drawerMax: null }));
  assert(s.drawerMax === '920px', 'closeDrawer 先把高度钉回具体值（none → 0 不会有过渡）');
  assert(s.__timers.length === 1, 'closeDrawer 挂了第 1 拍定时器');
  s.__timers[0].fn.call(s);
  assert(s.drawerMax === '0px' && s.drawerOpen === false, '第 1 拍：收到 0px 并置 drawerOpen = false');
  assert(s.__timers.length === 2, '第 1 拍里又挂了收尾定时器');
  s.__timers[1].fn.call(s);
  assert(s.drawerMax === null, '收尾把 drawerMax 还原成 null（收起分支接管）');
  const s2 = runWith('closeDrawer', mkSelf({ drawerOpen: false }));
  assert(s2.__timers.length === 0, '已经收起时 closeDrawer 直接返回');
}

console.log('== 3. 上滑手势 ==');
{
  const move = bodyOf('dhMove');
  assert(move.length > 0, '能抠出 dhMove() 方法体');
  const start = bodyOf('dhStart');
  assert(start.length > 0, '能抠出 dhStart() 方法体');
  const mk = (y0, open) => {
    const s = mkSelf({ drawerOpen: !!open });
    s.__opened = 0; s.__closed = 0;
    s.openDrawer = function () { this.__opened++; this.drawerOpen = true };
    s.closeDrawer = function () { this.__closed++; this.drawerOpen = false };
    new Function('return function (e) {' + start + '}')().call(s, { touches: [{ clientY: y0 }] });
    return s;
  };
  const swipe = (s, y) => new Function('return function (e) {' + move + '}')().call(s, { touches: [{ clientY: y }] });

  // 阈值 18px：略大于系统触摸容差（约 8~12px），既躲开手抖，又赶在
  // 浏览器判成"页面滚动"并发出 touchcancel 之前落地（见 home.vue 里的注释）。
  const up = mk(500, false);
  swipe(up, 485);
  assert(up.__opened === 0, '上滑 15px（手抖级别）不展开');
  swipe(up, 466);
  assert(up.__opened === 1, '上滑累计过阈值 → 展开一次');
  swipe(up, 420);
  assert(up.__opened === 1, '同一次滑动不会反复触发（触发后起点作废）');

  const down = mk(500, true);
  swipe(down, 515);
  assert(down.__closed === 0, '下滑 15px（手抖级别）不收起');
  swipe(down, 534);
  assert(down.__closed === 1, '下滑过阈值 → 收起一次');
  swipe(down, 580);
  assert(down.__closed === 1, '同一次滑动不会反复收起');

  // 横向为主 → 本次手势作废：那可能是左右滑页 / 图表拖动，抽屉不该抢
  const hor = mkSelf({ drawerOpen: false });
  hor.__opened = 0;
  hor.openDrawer = function () { this.__opened++ };
  const run = (name, self, ev) => new Function('return function (e) {' + bodyOf(name) + '}')().call(self, ev);
  run('dhStart', hor, { touches: [{ clientY: 500, clientX: 100 }] });
  run('dhMove', hor, { touches: [{ clientY: 480, clientX: 170 }] });
  assert(hor.__opened === 0, '横向位移更大时不抢（那是左右滑页 / 图表拖动）');
  // 手势作废后即便继续往上滑也不再响应（起点已清空）
  run('dhMove', hor, { touches: [{ clientY: 400, clientX: 170 }] });
  assert(hor.__opened === 0, '判定为横向后，本次手势全程作废');

  // 卡片平铺形态：dhStart 不记录起点（那个形态下页面要正常滚，一点都不能拦）
  const flat = mkSelf({ isFocus: false });
  run('dhStart', flat, { touches: [{ clientY: 500, clientX: 100 }] });
  assert(flat.__dhY == null, '卡片平铺形态下 dhStart 不记录起点');

  // 手势范围 = 整页，但**底栏那条带子**（为悬浮 tabbar 预留的 220rpx）不参与：
  // 手指落在底栏上是要切页的，当抽屉用会"一滑顺手换了页面"。
  const inBar = mk(720, false);
  assert(inBar.__dhY == null, '落点在底栏预留区（tabbar 那条）不记录起点');
  swipe(inBar, 660);
  assert(inBar.__opened === 0, '底栏区域上滑不会拉开抽屉（那是切页的地盘）');

  // 底栏以上 = 整块可见内容区：hero、把手、卡片、底部链接**任何**位置都要响应。
  // 这就是用户要的"主页全局往上滑"—— 少一个位置就是"滑了没反应"。
  [120, 300, 500, 680].forEach(y => {
    const s = mk(y, false);
    assert(s.__dhY === y, '内容区 y=' + y + ' → 记录起点（整页响应）');
    swipe(s, y - 30);
    assert(s.__opened === 1, '内容区 y=' + y + ' 上滑 → 拉开抽屉');
  });

  // 编辑态：手指是在拖卡片排序，纵向手势归拖拽，抽屉一律不参与
  // （否则拖到一半被"下滑收起"判定，卡片区直接塌掉）
  const editing = mkSelf({ drawerOpen: false, editing: true });
  editing.__opened = 0;
  editing.openDrawer = function () { this.__opened++ };
  run('dhStart', editing, { touches: [{ clientY: 600, clientX: 100 }] });
  assert(editing.__dhY == null, '编辑态下不记录起点（纵向手势归拖拽排序）');
  swipe(editing, 500);
  assert(editing.__opened === 0, '编辑态下上滑不会拉开抽屉');

  // 页面已经滚下去时，往下滑是在往回翻内容，不该把抽屉收了
  const scrolled = mk(600, true);
  scrolled.__pageTop = 120;
  swipe(scrolled, 660);
  assert(scrolled.__closed === 0, '页面已滚动时下滑不收起（那是在往回翻内容）');
  // 停在顶部时往下滑 = 想收起
  const atTop = mk(600, true);
  atTop.__pageTop = 0;
  swipe(atTop, 660);
  assert(atTop.__closed === 1, '页面在顶部时下滑 → 收起');
}

console.log('== 3b. 底栏上沿 / 滚动位置 / 吞掉滑动余波 ==');
assert(/onPageScroll\(e\)/.test(home) && /__pageTop\s*=/.test(home),
  '首页用 onPageScroll 记录滚动位置（供"下滑收起"区分手势场景）');
{
  const realFloor = new Function('return function () {' + bodyOf('dhFloorY') + '}')();
  assert(realFloor.call({}) === 0,
    '拿不到系统信息时 dhFloorY 返回 0 → 整页放开（量不到也不能让用户"滑了没反应"）');
  global.uni = { getSystemInfoSync: () => ({ windowWidth: 750, windowHeight: 1600 }) };
  assert(realFloor.call({}) === 1600 - 220,
    'dhFloorY = 视口高 − 底栏预留 220rpx（屏宽 750 时 220rpx = 220px）');
  global.uni = { getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 800 }) };
  assert(realFloor.call({}) === 800 - 110, '屏宽 375 时 220rpx = 110px');
  delete global.uni;
}
{
  // dhFire：官方触发器 —— 开/收 + 记时间戳 + 清起点
  const s = mkSelf({ drawerOpen: false });
  s.__opened = 0;
  s.openDrawer = function () { this.__opened++ };
  s.dhFire(true);
  assert(s.__opened === 1 && s.__dhFiredAt > 0, 'dhFire(true) 开抽屉并记下时间戳');
  assert(s.__dhY === null, 'dhFire 顺手清掉起点（一次滑动不会反复触发）');
  // 吞掉滑动余波：滑完平台可能补发一次 click，落在入口按钮上就会"边开抽屉边跳走"
  const t = mkSelf();
  assert(t.dhSwallowTap() === false, '平时不吞 tap');
  t.__dhFiredAt = Date.now();
  assert(t.dhSwallowTap() === true, '手势刚触发过 → 紧接着的 tap 被吞掉');
  t.__dhFiredAt = Date.now() - 5000;
  assert(t.dhSwallowTap() === false, '过了 400ms 就不再吞（正常点击照样有效）');
}
['startPractice', 'openWordDrill', 'goReview', 'goDrill'].forEach(n => {
  assert(/this\.dhSwallowTap\(\)/.test(bodyOf(n)),
    n + ' 会吞掉滑动余波（滑完不会顺手跳走）');
});

console.log('== 4. CSS：手势区要高、有滑入动画、动画期间裁切、展开后放开 ==');
{
  const css = home.slice(home.lastIndexOf('\n<style'));
  const rule = (sel) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];
  const isDrawer = rule('.mod-list.is-drawer');
  assert(isDrawer.length > 0, '存在 .mod-list.is-drawer 规则');
  assert(/transition:[^;]*max-height/.test(isDrawer), '抽屉有 max-height 过渡（高度真的会动）');
  // 一直 overflow:hidden 会把编辑态拖出容器的那张卡裁掉 —— 只能裁在动画期间
  const clip = rule('.mod-list.is-drawer.drawer-collapsed,\n.mod-list.is-drawer.drawer-animating');
  assert(clip.length > 0 && /overflow:\s*hidden/.test(clip),
    'overflow:hidden 只给「收起」和「动画中」两种状态');
  assert(!/overflow:\s*hidden/.test(isDrawer), '.mod-list.is-drawer 本身不带 overflow:hidden（展开后不裁）');
  const anim = rule('.mod-list.is-drawer:not(.drawer-collapsed) .mod-wrap');
  assert(anim.length > 0 && /animation:/.test(anim), '展开时卡片有淡入动画');
  const kf = (css.match(/@keyframes drawer-card-in\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(kf.length > 0, '存在 @keyframes drawer-card-in');
  assert(!/transform/.test(kf), '淡入动画不碰 transform（transform 是拖拽排序在用的）');
  // 把手：从"手势区"退回成一条短横杠（手势已经是整页响应），高度固定、不再收展。
  // 少了 touch-action:none，从把手上起手时浏览器会把手势抢去滚页面 →
  // 一滚动就发 touchcancel，上滑当场断掉。
  const dh = rule('.drawer-handle');
  assert(dh.length > 0, '存在 .drawer-handle 规则');
  assert(/height:\s*\d+rpx/.test(dh), '把手是一条固定高的短横杠（不再用高度当手势区）');
  assert(!/height:\s*\d+vh/.test(dh), '把手不再靠 vh 高度撑手势区（整页手势已接管）');
  assert(/touch-action:\s*none/.test(dh), '把手上 touch-action:none（不许浏览器抢去滚动）');

  // hero：抽屉收起时撑满「内容区 − 把手」，内容垂直居中 → 两个入口落在屏幕正中。
  // ⚠️ 算式里的 136rpx / 220rpx 必须和 App.vue 的 .page-nav / .page-tabbar 对齐，
  //    改了那边不改这里，两个入口就整体偏上或偏下。
  const heroTall = rule('.focus-hero.hero-tall');
  assert(heroTall.length > 0, '存在 .focus-hero.hero-tall 规则');
  // ⚠️ 只扫 min-height 那条声明本身：规则块里还有注释，注释里就写着 136rpx / 220rpx，
  //    扫整块会把注释也算进去 → 算式被改坏也照样绿（这是"注释被正则扫到"的老坑）。
  const mh = (heroTall.match(/min-height:\s*calc\([\s\S]*?\);/) || [''])[0];
  assert(mh.length > 0 && /100vh/.test(mh),
    '收起态 hero 高度按视口算（内容才是居中的，不是靠写死的 vh）');
  assert(/136rpx/.test(mh) && /220rpx/.test(mh),
    '算式里让出了顶栏 136rpx 与底栏预留 220rpx（与 App.vue 的留白一致）');
  assert(/status-bar-height/.test(mh) && /safe-area-inset-bottom/.test(mh),
    '同时让出状态栏与底部安全区（否则刘海屏 / 全面屏会偏）');
  const hero = rule('.focus-hero');
  assert(/transition:[^;]*min-height/.test(hero), 'hero 高度有过渡（开合是滑上去的，不是跳的）');
  assert(/justify-content:\s*center/.test(hero), 'hero 内容垂直居中');
  assert(!/min-height:\s*52vh/.test(hero), 'hero 不再用 52vh 那种"撑一半"的写法');
  const kfUp = (css.match(/@keyframes drawer-list-up\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(kfUp.length > 0 && /translateY/.test(kfUp), '抽屉是从下方滑上来的（不只是 fade）');
  assert(!/drawer-list-up/.test(rule('.mod-list.is-drawer:not(.drawer-collapsed) .mod-wrap')),
    '上滑位移加在容器上而不是卡片上（卡片 transform 归拖拽排序用）');
}

console.log('== 5. 定时器不泄漏 ==');
assert(/setDrawerTimer\(fn, ms\)\s*\{[\s\S]{0,160}?clearTimeout/.test(home),
  'setDrawerTimer 会先清掉上一个（单一实例，不会两个互相打架）');
{
  const onHide = (home.match(/\n  onHide\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  assert(onHide.length > 0, '能取到 onHide 函数体');
  assert(/this\.drawerT\)\s*\{\s*clearTimeout/.test(onHide), 'onHide 清掉抽屉定时器（切走不再改高度）');
}
assert(/setTimeout\(\(\) => \{ this\.measureDrawer\(\) \}, 60\)/.test(home),
  'onShow 里延迟量一次抽屉高度（收起状态也能量）');

console.log(fail === 0 ? '\n上滑抽屉全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
