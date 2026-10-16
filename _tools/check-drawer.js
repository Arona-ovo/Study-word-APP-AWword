// _tools/check-drawer.js - 首页焦点模式的「上滑抽屉」校验
// 覆盖：
//  1) 手势挂点：把手是手势区；hero 上绝不能挂 touchmove（会误触两颗入口按钮）
//  2) 开合状态机：0 ↔ 实测内容高 的真实过渡（0 ↔ none 不可插值 = 没有动画）
//  3) drawerStyle：卡片平铺形态零干预；展开完成后交还自然高度（不裁卡片）
//  4) CSS：动画期间要裁、展开后必须放开（否则编辑态拖动排序会被裁掉）
//  5) 上滑阈值滑动：够阈值才开/关，且一次滑动只触发一次
//  6) 定时器不泄漏：单一实例 + onHide 清掉
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

console.log('== 1. 手势挂点 ==');
assert(/class="drawer-handle"/.test(home), '存在抽屉把手（手势区）');
assert(/@touchstart="dhStart"/.test(home) && /@touchmove="dhMove"/.test(home), '把手接住了 touchstart / touchmove');
assert(/@touchend="dhEnd"/.test(home), '把手接住了 touchend（抬手清掉起点）');
// hero 里是两颗入口按钮，在按钮上滑动会顺带触发按钮自己的 click
// （一边开抽屉一边跳走），所以手势只能挂在把手上。
{
  const i = home.indexOf('class="focus-hero"');
  const hero = i > 0 ? home.slice(i, home.indexOf('\n    </view>', i)) : '';
  assert(i > 0 && hero.length > 0, '能抠出 hero 模板块');
  assert(!/@touchmove/.test(hero), 'hero 上没有挂 touchmove（不能在入口按钮上抢手势）');
  assert(/@tap="startPractice"/.test(hero) && /@tap="openWordDrill"/.test(hero), 'hero 两颗入口仍在（背句子 / 背单词）');
}

// 点击只挂在中间那条上：手势区现在很高（吃掉 hero 以下的空白），
// 若整体响应点击，点空白就会把抽屉点开 —— 用户明确要的是"滑出来"，不是"点出来"。
{
  const i = home.indexOf('class="drawer-handle"');
  // 注意只切到自己的开标签为止：children 里的 .dh-bar 是带 @tap 的（那是对的）
  const openTag = i > 0 ? home.slice(i, home.indexOf('>', i)) : '';
  const handle = i > 0 ? home.slice(i, home.indexOf('\n    </view>', i)) : '';
  assert(openTag.length > 0 && handle.length > 0, '能抠出把手自身的开标签与整块模板');
  assert(!/@tap=/.test(openTag), '大手势区本身不响应点击（避免在空白上误开抽屉）');
  assert(/class="dh-bar" @tap="toggleDrawer"/.test(home), '点击只挂在中间那条 .dh-bar 上');
}

console.log('== 2. 开合状态机（真实高度过渡）==');
assert(/drawerH:/.test(home) && /drawerMax:/.test(home), 'data 里有 drawerH / drawerMax');
assert(/measureDrawer\(\)/.test(home) && /selectAll\('\.mod-wrap'\)/.test(home),
  'measureDrawer() 用 selectAll(.mod-wrap) 量卡片真实内容高');
// 抠出三个方法体，用假 this 跑真代码（不是照抄一份逻辑来测）
// ⚠️ 参数要通配：drawerStyle() 没参数，dhMove(e) 有 —— 写死 \(\\) 会抠不到后者（假绿）
const bodyOf = (name) => {
  const m = home.match(new RegExp('\\n    ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\},'));
  return m ? m[1] : '';
};
const mkSelf = (extra) => Object.assign({
  isFocus: true,
  drawerOpen: false,
  drawerH: 800,
  drawerMax: null,
  drawerT: 0,
  __timers: [],
  setDrawerTimer(fn, ms) { this.__timers.push({ fn, ms }) },
  openDrawer() { this.drawerOpen = true },
  closeDrawer() { this.drawerOpen = false }
}, extra || {});
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

  // 阈值 28px：原先 40，放松是刻意的 —— 这是屏幕下半区唯一的纵向手势，
  // 收紧到用户在 LB 机上"滑了没反应"就是白做，误开的代价只是再往下滑回去。
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
}

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
  // 手势区必须是「一整块高的区域」而不是一条窄把手：窄把手只在它自己那几十 rpx 上
  // 接得到 touchmove，手指落在它下面（屏幕下半部分）就是完全没反应。
  const dh = rule('.drawer-handle');
  assert(dh.length > 0, '存在 .drawer-handle 规则');
  assert(/height:\s*\d+vh/.test(dh), '收起时把手是一整块高的手势区（vh 具体值 → 覆盖屏幕下半部）');
  assert(/height:\s*\d+rpx/.test(rule('.drawer-handle.dh-open')),
    '展开后把手收成窄条（两端都得是具体值，auto 不可插值 = 没有过渡）');
  assert(/transition:[^;]*height/.test(dh), '把手收窄本身有 height 过渡');
  // 少了这条，浏览器会把手势抢去做页面滚动 → 一滚动就发 touchcancel，手势当场断掉
  assert(/touch-action:\s*none/.test(dh), '手势区 touch-action:none（不许浏览器抢去滚动）');
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
