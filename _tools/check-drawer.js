// _tools/check-drawer.js - 首页焦点形态「往上滑看卡片」的校验
//
// 形态（2026-10-16 第五版 → 第六版，本文件）：卡片就在**正常文档流**里、排在首屏之后，
// 往上滑 = **页面原生滚动**。没有抽屉实体、没有把手、也没有任何自定义纵向手势。
// 但卡片**默认隐藏**：焦点模式下 onPageScroll 把"往上滑"的进度推进 CSS 变量 `--reveal`，
// .mod-list 随它做 opacity 淡入 + translateY 上移（合成器接管，零重排）。
// "抽屉没有实体"= 下方卡片本身就是抽屉，靠滚动淡入 + 滑出来，而非独立浮层。
//
// 为什么是这套（连改数版的教训，别再走回头路）：
//   · 早期四版想用"自定义手势 + 高度过渡"做抽屉：把手从窄条 → 加高 → 内容层 → 根节点，
//     每次都被真机反馈"上滑没反应"或"掉帧"。
//   · 掉帧根因是**动画布局属性**：max-height / min-height / padding-top 过渡，
//     每帧重排首屏 + 重做毛玻璃 backdrop-filter，手机必掉帧。
//   · 而"往上滑看下面卡片"本就是页面滚动（合成器接管、零重排）。
//     所以把卡片放回正常文档流、删掉手势与高度动画，只保留**滚动进度 → opacity/transform**
//     这一条合成器友好的链路——既连贯跟手，又绝不掉帧。
//
// 覆盖：
//  1) 拆干净：抽屉状态机 / 自定义手势 / 把手 / 量高 都不留（onPageScroll 现只驱动淡入）
//  2) 手势挂点：根节点只接左右滑页（onSlide*），不再包一层 dh* 包装方法
//  3) hero 形态：铺满到屏幕底边（卡片静止时结构性藏在折叠线之下，不靠 opacity）+
//     内容收进与下方卡片同款面板 + 上下留白对称（入口在屏幕正中）；
//     .mod-list 默认 --reveal:1（常显），滚动时 syncReveal 按"卡片真实入屏高度"
//     （getBoundingClientRect + 缓存视口高）把 0→1 推进 --reveal 做淡入 + 上移；
//     ⚠️ 严禁 .reveal-idle 这类把初值锁 0 的强制类（onPageScroll 不触发就永久隐藏）
//  4) 不掉帧：不许再有重排型过渡（min-height / max-height / padding）；只允许 opacity / transform
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

console.log('== 1. 抽屉状态机 / 自定义手势 已拆干净（onPageScroll 现在只驱动淡入） ==');
// 留一半最危险：半截状态机 + 原生滚动会互相打架（比如字段还在、还有人读它）
assert(!/drawer-handle|dh-bar|dh-grip/.test(home), '模板与 CSS 里都不再有把手');
assert(!/drawerOpen|drawerMax|drawerH|drawerStyle|drawerT/.test(home), '不留抽屉状态机字段');
assert(!/dhStart|dhMove|dhEnd|dhFire|dhSwallowTap|dhGateY|dhFloorY|dhPoint|dhNum/.test(home),
  '不留任何自定义纵向手势方法');
assert(!/__pageTop/.test(home),
  '不留「页面滚动位置」字段（那是给"下滑收抽屉"区分场景用的，现在滚动就是滚动）');
assert(!/measureDrawer/.test(home),
  '不再量卡片高度（高度不再需要被 JS 知道；拖拽排序自己那份量高不受影响）');
// onPageScroll 现在允许存在，但只能触发淡入（卡片真实入屏进度推进 --reveal），
// 不能拿来做"开合抽屉"那套状态机（@touch 手势 / 折叠 class 早就被第 2 组守住了）。
assert(/onPageScroll/.test(home), '焦点模式卡片淡入需要 onPageScroll（触发 reveal 重算）');
assert(/setProperty\(['"]--reveal['"]/.test(home),
  'onPageScroll 把进度写到 --reveal（CSS 变量 → 合成器接管，零重排，不掉帧）');
// 进度按"卡片真实入屏高度"算（getBoundingClientRect + 缓存视口高），
// 不是按绝对 scrollTop / 320 —— 后者会让 reveal 在卡片入屏前就到 1（淡入永远看不到），
// 且一旦 onPageScroll 不触发就暴露出"卡片藏不住/卡死"的隐患。
assert(/getBoundingClientRect/.test(home), 'syncReveal 读 .mod-list 真实位置算入屏进度');
assert(/window\.innerHeight|getSystemInfoSync/.test(home), '视口高被缓存（算入屏进度用，不逐帧取系统信息）');
assert(!/this\._scrollTop \/ 320/.test(home),
  'reveal 不再按绝对 scrollTop/320 归一化（那是上一版"淡入看不到 + 卡死"的根）');
// ⚠️ 静止态"藏卡"只能由布局（hero 铺满屏幕底边）保证，绝不能靠 CSS 把 --reveal 锁 0：
// 否则 onPageScroll 没覆盖上就永久隐藏（真机已踩）。所以这里禁止 reveal-idle 这类强制类。
assert(!/\.mod-list\.reveal-idle/.test(home), '禁止 .mod-list.reveal-idle 强制 0（会卡死隐藏）');
assert(!/revealIdle/.test(home), '模板 / computed 不许再出现 revealIdle（藏卡不靠 JS 时机）');
assert(!/drawerCollaps|collapseDrawer|openDrawer|closeDrawer|drawerState/.test(home),
  'onPageScroll 不接任何抽屉开合状态机');

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
  assert(/class="focus-panel"/.test(hero), 'hero 内容收在面板里（首屏第一眼是一张卡，不是散落的文字）');
  assert(/class="focus-keyinfo"/.test(hero) && /class="focus-sub"/.test(hero),
    '面板内仍是「关键信息 + 两个大入口 + 小字」三段');
}

console.log('== 3. hero 形态：铺满一屏 + 面板 + reveal 双保险 ==');
{
  const hero = rule('.focus-hero');
  assert(hero.length > 0, '存在 .focus-hero 规则');
  const mh = (hero.match(/min-height:\s*calc\([^;]*\)/) || [''])[0];
  assert(mh.length > 0 && /100vh/.test(mh), 'hero 高度按视口算（一直铺下去）');
  assert(/136rpx/.test(mh) && /status-bar-height/.test(mh),
    '算式里让出顶栏 136rpx 与状态栏（与 App.vue 的 .page-nav 对齐）');
  // 关键反转（2026-10-16 真机二次反馈"首页还是能看到底部的卡片"）：
  // 探出量方案（hero 短 320rpx 让卡片露头）依赖 --reveal 归零才不可见，
  // JS 一环没跑卡片就明晃晃露在首屏 —— 已废弃。现在 hero 必须铺满到屏幕底边，
  // 卡片静止时**结构性**地在折叠线之下（和 opacity 无关，怎么都看不见）。
  assert(!/320rpx/.test(mh),
    'min-height 里不许再出现探出量 320rpx（卡片必须整体藏在折叠线之下）');
  assert(!/220rpx/.test(mh),
    'min-height 里不出现底栏预留 220rpx（底栏让位由 padding 承担）');
  const pad = (hero.match(/padding:\s*[^;]*;/) || [''])[0];
  // 左右 0：面板与下方卡片同宽；上下留白对称于整屏 → 两个入口落在屏幕正中
  // （底栏 220 + 24、顶栏 136，差值 108 补在 padding-top）。
  assert(/108rpx/.test(pad) && /220rpx/.test(pad) && /safe-area-inset-bottom/.test(pad),
    'padding 上下对称于整屏（108 = 24 + 220 − 136）→ 入口在屏幕正中');
  assert(/justify-content:\s*center/.test(hero), 'hero 内容垂直居中');
  assert(!/transition/.test(hero), 'hero 上没有任何过渡（高度 / 内边距不参与动画）');
  // 面板 = 下方卡片同款"窗体"：半透明表面 + 模糊 + 发丝边 + 投影
  const panel = rule('.focus-panel');
  assert(panel.length > 0, '存在 .focus-panel 规则');
  assert(/rgba\(var\(--surface-rgb/.test(panel) && /backdrop-filter/.test(panel) && /--glass-lg/.test(panel),
    '面板是毛玻璃表面（和 .card 同款令牌，深色模式自动翻转）');
  assert(/var\(--hairline/.test(panel) && /var\(--shadow-rgb/.test(panel),
    '面板带发丝边与投影（视觉上"浮"在背景之上，成第一张卡）');
  // 卡片淡入：mod-list 读 --reveal 决定透明度与上移，纯合成器属性（不掉帧）。
  // "抽屉没有实体"= 下方卡片本身就是抽屉，靠滚动进度淡入 + 上移，而非独立浮层。
  const list = rule('.mod-list');
  assert(list.length > 0, '存在 .mod-list 规则');
  // ⚠️ 默认必须 --reveal:1（卡片常显）：静止态"看不到卡片"由 hero 铺满屏幕底边
  // （布局）保证，绝不靠 CSS 把初值锁 0 —— 否则 onPageScroll 一不触发就永久隐藏（真机已踩）。
  assert(/--reveal:\s*1/.test(list), 'mod-list 默认 --reveal:1（卡片常显；藏卡只靠布局，不靠 opacity）');
  assert(/opacity:\s*var\(--reveal/.test(list), 'mod-list 透明度随 --reveal 变化（淡入）');
  assert(/transform:\s*translateY/.test(list) && /--reveal/.test(list),
    'mod-list 随 --reveal 上移（滑出感）');
  assert(!/transition[^;{}]*(min-height|max-height|padding)/.test(list),
    'mod-list 不接任何重排型过渡（只动 opacity / transform）');
  // 逆向契约：绝不允许"CSS 强制藏卡"的类/初值 0（那是上一版卡死隐藏的根）
  assert(!/\.mod-list\.reveal-idle/.test(css), '不允许 .mod-list.reveal-idle 这类强制 0 规则');
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

console.log('== 5. 顺序：「编辑首页」在卡片之后 ==');{
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
  // 空态兜底：卡片被全部收纳时 hero 必须退回自然高度 ——
  // 否则"＋ 添加组件 / 编辑首页"全在下一屏之后，而页面又几乎没得滚，用户以为加不回来。
  assert(/:class="\{ 'hero-empty': !renderCards\.length \}"/.test(home),
    'hero 在"卡片全被收纳"时挂 hero-empty');
  const empty = rule('.focus-hero.hero-empty');
  assert(/min-height:\s*0/.test(empty), 'hero-empty 时 hero 不再缩短（兜底入口全在首屏）');
  // hero-empty 也不补左右边距：面板宽度与其他态一致
  assert(/padding:\s*40rpx 0/.test(empty), 'hero-empty 的左右仍是 0（面板同宽）');
}

console.log(fail === 0 ? '\n上滑看卡片全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
