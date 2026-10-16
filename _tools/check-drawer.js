// _tools/check-drawer.js - 首页焦点形态「往上滑看卡片」的校验
//
// 形态（2026-10-16 第五版，commit e032f80 → 本版）：卡片就在**正常文档流**里、
// 排在首屏之后，往上滑 = **页面原生滚动**。没有抽屉、没有把手、也没有任何自定义纵向手势。
//
// 为什么改成这样（连改四版的教训，别再走回头路）：
//   · 前四版都想用"自定义手势 + 高度过渡"去做这个抽屉：把手位置从窄条 → 加高 →
//     内容层 → 根节点，每次都被真机反馈"上滑没反应"或"掉帧"。
//   · 掉帧的根因是**动画的是布局属性**：max-height / min-height / padding-top 过渡，
//     每帧都要重新排一遍首屏 + 重新做一次毛玻璃 backdrop-filter，手机上必然掉帧。
//   · 而"往上滑看下面的卡片"本来就是页面滚动能做的事（合成器接管、零重排）。
//     所以最终把卡片放回正常文档流，删掉整套手势与高度动画。
//
// 覆盖：
//  1) 拆干净：抽屉状态机 / 自定义手势 / 把手 / 量高 都不留
//  2) 手势挂点：根节点只接左右滑页（onSlide*），不再包一层 dh* 包装方法
//  3) hero 几何：铺到屏幕底边（卡片正好从下一屏开始）+ 内容盒对称于整屏（两入口在正中）
//  4) 不掉帧：不许再出现会触发重排的过渡（min-height / max-height / 出现动画）
//  5) 顺序：「编辑首页」排在卡片之后（只有滑到底才看得到）
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
const css = home.slice(home.lastIndexOf('\n<style'));
// 取一条 CSS 规则的规则体。⚠️ 必须先把注释剥掉再断言：
// 注释里常常写着同样的字面量（比如"220rpx"），扫整块规则会把注释也扫进去 → 假绿。
const rule = (sel) => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
};

console.log('== 1. 抽屉那套已经拆干净 ==');
// 留一半最危险：半截状态机 + 原生滚动会互相打架（比如字段还在、还有人读它）
assert(!/drawer-handle|dh-bar|dh-grip/.test(home), '模板与 CSS 里都不再有把手');
assert(!/drawerOpen|drawerMax|drawerH|drawerStyle|drawerT/.test(home), '不留抽屉状态机字段');
assert(!/dhStart|dhMove|dhEnd|dhFire|dhSwallowTap|dhGateY|dhFloorY|dhPoint|dhNum/.test(home),
  '不留任何自定义纵向手势方法');
assert(!/onPageScroll|__pageTop/.test(home),
  '不留「页面滚动位置」字段（那是给"下滑收抽屉"区分场景用的，现在滚动就是滚动）');
assert(!/measureDrawer/.test(home),
  '不再量卡片高度（高度不再需要被 JS 知道；拖拽排序自己那份量高不受影响）');

console.log('== 2. 手势挂点：根节点只负责左右滑页 ==');
{
  const i = home.indexOf('class="container page-tabbar page-nav"');
  const openTag = i > 0 ? home.slice(i, home.indexOf('>', i)) : '';
  assert(openTag.length > 0, '能抠出页面根节点的开标签');
  assert(/@touchstart="onSlideStart"/.test(openTag) && /@touchmove="onSlideMove"/.test(openTag),
    '根节点仍接左右滑页手势（tab-slide-mixin，纵向它自己会让开）');
  assert(/@touchend="onSlideEnd"/.test(openTag) && /@touchcancel="onSlideEnd"/.test(openTag),
    'touchend / touchcancel 都收尾');
  assert(!/dh/.test(openTag.replace(/onSlide(Start|Move|End)/g, '')),
    '根节点上没有抽屉手势（纵向一律交给原生滚动）');
}
{
  const i = home.indexOf('class="page-slide"');
  const tag = i > 0 ? home.slice(i, home.indexOf('>', i)) : '';
  assert(tag.length > 0, '能抠出 .page-slide 开标签');
  assert(!/@touch/.test(tag), '.page-slide 上不挂触摸手势（这里只做左右滑页的位移样式）');
}
{
  const i = home.indexOf('class="focus-hero"');
  const hero = i > 0 ? home.slice(i, home.indexOf('\n    </view>', i)) : '';
  assert(hero.length > 0, '能抠出 hero 模板块');
  assert(!/@touch/.test(hero), 'hero 上没有触摸手势（两颗入口按钮要能正常点、页面要能滚）');
  assert(/@tap="startPractice"/.test(hero) && /@tap="openWordDrill"/.test(hero),
    'hero 两颗入口仍在（背句子 / 背单词）');
}

console.log('== 3. hero 几何：铺到屏幕底边 + 两个入口落在正中 ==');
{
  const hero = rule('.focus-hero');
  assert(hero.length > 0, '存在 .focus-hero 规则');
  const mh = (hero.match(/min-height:\s*calc\([^;]*\)/) || [''])[0];
  assert(mh.length > 0 && /100vh/.test(mh), 'hero 高度按视口算（一直铺下去）');
  assert(/136rpx/.test(mh) && /status-bar-height/.test(mh),
    '算式里让出顶栏 136rpx 与状态栏（与 App.vue 的 .page-nav 对齐）');
  // 关键：不减底栏预留，hero 才会一直铺到屏幕底边 —— 卡片正好从"下一屏"开始，
  // 首屏干净得只剩两个入口（这也是"没有把手也不觉得少了什么"的原因）。
  assert(!/220rpx/.test(mh),
    'min-height 不减底栏预留（铺到屏幕底边 → 卡片正好从下一屏开始）');
  const pad = (hero.match(/padding:\s*[^;]*;/) || [''])[0];
  assert(/220rpx/.test(pad) && /safe-area-inset-bottom/.test(pad),
    '底部留白含 tabbar 预留的 220rpx 与安全区');
  // 上下留白相等 → 内容盒对称于整屏，两个入口才落在屏幕正中。
  // 顶栏占了 136rpx、底栏留了 220rpx，差值要补在 padding-top 上。
  assert(/108rpx/.test(pad),
    '顶部留白补上「底栏比顶栏多留的那一截」（内容盒对称于整屏 → 入口在正中）');
  assert(/justify-content:\s*center/.test(hero), 'hero 内容垂直居中');
  assert(!/transition/.test(hero), 'hero 上没有任何过渡（高度 / 内边距不参与动画）');
}

console.log('== 4. 不掉帧：不许再有重排型过渡 ==');
// 这一组是本轮的核心契约：布局属性的过渡 = 每帧重排 + 重新毛玻璃 = 掉帧。
// 别再为了"好看一点"把过渡加回来 —— 原生滚动的顺滑来自合成器，不是来自 CSS 动画。
assert(!/transition[^;{}]*min-height/.test(css), '没有 min-height 过渡（逐帧重排的来源）');
assert(!/transition[^;{}]*max-height/.test(css), '没有 max-height 过渡');
assert(!/transition[^;{}]*padding/.test(css), '没有 padding 过渡');
assert(!/drawer-list-up|drawer-card-in/.test(css), '不再有抽屉的出现动画（往上滑 = 原生滚动本身）');
assert(!/drawer-collapsed|drawer-animating|is-drawer|hero-tall/.test(home),
  '不再有折叠 / 动画 / 高矮开关这类状态 class');

console.log('== 5. 顺序：「编辑首页」在卡片之后 ==');
{
  const iHero = home.indexOf('class="focus-hero"');
  const iList = home.indexOf('class="mod-list"');
  const iFoot = home.indexOf('class="home-foot"');
  assert(iHero > 0 && iList > iHero, 'hero 排在卡片之前（首屏只有两个入口）');
  assert(iFoot > iList, '「编辑首页」排在卡片之后 → 只有滑到卡片最底下才看得到');
  const foot = home.slice(iFoot, home.indexOf('\n    </view>', iFoot));
  assert(/class="foot-link"/.test(foot), '非编辑态仍是那颗「编辑首页」链接');
  // 卡片区不能带内联高度/显隐样式（那正是上一版的抽屉做法）
  const list = home.slice(iList - 40, home.indexOf('>', iList) + 1);
  assert(!/:style=/.test(list), '.mod-list 上没有内联样式（不再由 JS 控高度）');
}

console.log(fail === 0 ? '\n上滑看卡片全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
