// _tools/check-drawer.js - 首页焦点形态「往上滑看卡片」的校验
//
// 形态（2026-10-16 第六版 → 第七版，本文件）：卡片就在**正常文档流**里、排在首屏之后，
// 往上滑 = **页面原生滚动**。没有抽屉实体、没有把手、也没有任何自定义纵向手势。
// 焦点模式下 onPageScroll 把"往上滑了多少"推进成 0→1 的进度，卡片随之淡入 + 上移、
// 两个入口随之渐隐（合成器接管，零重排）。
// "抽屉没有实体"= 下方卡片本身就是抽屉，靠滚动淡入 + 滑出来，而非独立浮层。
//
// ⚠️ 第十版（2026-10-17）：整张主页 = 一张**和屏幕一样大、且完全透明**的卡。
//   上滑时是"这一整张卡"在往上走（外壳 .focus-hero 只吃 transform），
//   滑动那一段卡面 .hero-glass 长出**模糊**把主页糊掉（用户："把主页变模糊，并且隐去"），
//   滑回顶部一切归零 —— **背景重新高清**（用户："主页背景还是切回来要显示清晰的背景图片"）。
//   这里撞的是和第八版**同一棵**树，只不过换了一层：卡面是 .focus-hero 的子节点，
//   而 .focus-hero 以前要承担"入口渐隐"，一旦带 opacity 就自成 backdrop root，
//   卡面从此糊不到背景 → 用户只看到"背景图纹丝不动地平移"。
//   所以这里把 hero 拆成三层：外壳（transform）/ 卡面（backdrop-filter）/ 内容（opacity），
//   **渐隐搬去内层 .hero-body**，外壳这辈子不许再带 opacity。
//   模糊走"五档切 class + 恒定半径"：卡面背后是 fixed 不动的背景层，整段滚动里
//   要糊的内容没变 → 每档至多重算一次高斯模糊（逐帧改半径 = 掉帧老路）。
//
// ⚠️ 第八版（2026-10-16 末）：只改了"玻璃不像玻璃"这一件事 —— 底板从 .mod-list::before
//   搬到**外层 .mod-sheet::before**。CSS 里 backdrop root 由 opacity<1 / filter / mask /
//   mix-blend-mode / will-change(这些) 创建：底板挂在要淡入的 .mod-list 身上时，
//   它的 backdrop 被隔离在自己那一层里，背后只剩卡片自己 → 糊了个寂寞，
//   看到的就是一块平涂半透明白片（用户："缺少立体感，不像苹果那种玻璃"）。
//   拆两层后 .mod-sheet 只吃 transform（transform 建 stacking context，但**不建**
//   backdrop root）→ 底板能一路糊到首页背景与 hero 内容。同时给玻璃加上
//   立体四件套（顶沿内高光 / 底沿内暗边 / 整圈 hairline / 双层投影）+ 渐变表面。
//
// ⚠️ 第七版只改了一件事，但它是"真机完全没动画"的根因：
//   进度**不再写 DOM**（`el.style.setProperty('--reveal', …)`），改成**响应式数据 +
//   响应式 :style 绑定**下发。因为 App 端逻辑层**没有 document**，ref 拿到的也不是
//   能写 style 的 DOM 节点 —— 上一版那套"先验 setProperty 可用再用"的写法，
//   在真机上每一次都验不过 → 整条链路静默失效（脚本全绿，按钮不渐隐、抽屉没动画）。
//   App 端唯一可用的样式通道就是 `:style` 绑定，且内联只认 px（rpx 不被转换）。
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
//     上下留白对称（入口在屏幕正中）；首屏只有裸的两个按钮（.focus-panel 背景卡
//     已按用户要求下线，不许再回来）；
//     .mod-list 默认 --reveal:1（常显），滚动时 syncReveal 按"卡片真实入屏高度"
//     （getBoundingClientRect + 缓存视口高）把 0→1 推进 --reveal 做淡入 + 上移，
//     同一条进度同时写进 --hero-fade → 两个入口渐隐（滑回去则回来）；
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
// 进度**只能**来自 onPageScroll 报的 scrollTop。App 端逻辑层没有 document（硬规矩 42），
// 量节点那条路（getBoundingClientRect / ref.$el.style.setProperty）在真机上每次都验不过
// → 整条链路静默失效：2026-10-16 真机"按钮不渐隐、抽屉没动画"，而脚本全绿。别再走回去。
// ⚠️ "不许出现某能力"这类断言必须**先剥注释再扫**，否则测的是注释、永远红
// （注释里写着"别再去 getBoundingClientRect"也会被正则扫到）。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
assert(!/getBoundingClientRect/.test(strip(home)),
  '不再量节点算进度（App 端逻辑层没有 document，量了也拿不到 → 整条动画静默失效）');
assert(!/\.style\.setProperty\(/.test(strip(home)),
  '不许再直接写 DOM style（App 端拿不到节点；只能走响应式 :style 绑定）');
assert(/onPageScroll\(e\)/.test(home) && /e\.scrollTop/.test(home),
  'onPageScroll 收 scrollTop 作为唯一进度来源（不依赖任何 DOM）');
// 进度必须落到**响应式数据**上，再由 :style 下发 —— App 端唯一的样式通道。
// 默认 p=1 / revealOn=false：JS 一环没跑时卡片常显、入口不淡出（绝不能反过来藏起来）。
assert(/revealP: 1/.test(home) && /revealOn: false/.test(home),
  'reveal 进度进 data（响应式），默认常显、不接手势');
assert(/:style="listRevealStyle"/.test(home) && /:style="heroCardStyle"/.test(home) && /:style="heroBodyStyle"/.test(home),
  '卡片 / 全屏卡外壳 / 入口内容的样式都由 :style 绑定下发（App 端唯一可用的样式通道）');
// 玻璃底板那一层也要走同一条通道（它吃位移，跟着卡片一起被"拉上来"）
assert(/:style="sheetRevealStyle"/.test(home), '玻璃底板层也走 :style 绑定下发位移');
// 内联写**真实属性**（opacity / transform）而不只是 CSS 变量：真实属性各端一定生效，
// CSS 变量在部分端可能拿不到 —— 动画这种"看不见就等于没做"的东西不能押在变量上。
assert(/opacity: String\(this\.revealP\)/.test(home),
  '卡片内联写真实 opacity（不依赖 CSS 变量，各端一定生效）');
// ⚠️ 必须锚到 `+ off`（卡片那条）：第十一版 heroCardStyle 也用了 translate3d（+ lift），
//    只写 /transform: 'translate3d/ 的话，删掉卡片这条也会被 hero 那条顶住 = 假绿
//    （2026-10-17 变异测试抓到）。
assert(/transform: 'translate3d\(0,' \+ off/.test(home),
  '卡片内联写真实 transform（带视差位移 off，不依赖 CSS 变量）');
assert(/opacity: \(1 - fade\)\.toFixed\(3\)/.test(home),
  '入口内联写真实 opacity（卡片出来→入口淡出，滑回去→入口回来）');
// 非焦点 / 没卡（全收纳）必须常显、入口不淡出：那一屏全靠入口，淡掉就是空屏。
assert(/let p = 1[\s\S]{0,200}if \(focus\) \{/.test(home),
  '只有"焦点 + 有卡"才接手势，其余态 p 恒 1（卡片常显、入口不淡出）');
assert(/'--hero-pe': fade > 0\.9 \? 'none' : 'auto'/.test(home),
  '淡到 0.9 以上才关 pointer-events（半透明时入口仍可点）');
// 单位是 px：uni-app **只转换 CSS 文件里的 rpx**，内联样式里的 rpx 不会被转换 → 必须自己换。
assert(/uni\.upx2px/.test(home),
  '内联位移走 uni.upx2px 换成 px（内联样式里的 rpx 不会被 uni-app 转换）');
// 淡入距离：320 时一甩就滑完（真机反馈"没有任何动画"），必须 ≥480rpx。
assert(/this\.upx\((4\d\d|5\d\d|6\d\d)\)/.test(home),
  '淡入距离 ≥480rpx（太短则一甩就滑完，看不出动画）');
// 量化到 0.05 一档：home.vue 模板很大，整页重渲染的代价不能按帧付。
// 0.05 的 opacity 跳变肉眼看不见，但渲染次数从"每帧一次"降到"一次滑动最多 20 次"。
assert(/Math\.round\(p \* 20\) \/ 20/.test(home),
  '进度量化到 0.05 一档（不是每帧写一次，避免整页重渲染掉帧）');
// 抽屉拉到位震一下（用户要的"加点动效或震动"），且一次滑动只响一声。
assert(/haptic\.tick\('drawer'\)/.test(home), '抽屉拉到位震一下');
// ⚠️ 同上：只验字段名不够（`if (true)` 也能让它出现），要钉那条判断
assert(/if \(!this\._drawerBuzzed\) \{/.test(home),
  '一次滑动只震一声（有"已震"守卫；滑回去再拉才会再响）');
// ---- 落位那一记 Q 弹（2026-10-16 用户："要有 Q 弹的动效，像卡片从远处丢过来"） ----
// ⚠️ 只写 /playThrow\(\)/ 会匹配到**方法定义本身**（`playThrow() {`）→ 删掉唯一的
//    调用点也照样通过 = 假绿（2026-10-17 变异抓到）。必须带 `this.` 前缀（调用形态），
//    并且落在 syncReveal 之后（调用点在那里面）。
assert(/this\.playThrow\(\)/.test(home) &&
       home.indexOf('this.playThrow()') > home.indexOf('syncReveal(scrollTop) {'),
  '抽屉落位真的调用了回弹（不是只留一个没人调的定义）');
// 量化过的进度必须真的写回响应式数据，否则内联样式永远停在初值
assert(/Math\.abs\(q - this\.revealP\)/.test(home) && /this\.revealP = q/.test(home),
  '进度跨档才写回 revealP（量化值与响应式数据必须对得上）');
assert(/popSeq/.test(home) && /popSeq % 2 \? 'pop-a' : 'pop-b'/.test(home),
  '回弹用 pop-a / pop-b **交替**（同一个 class 摘了戴上会被一次渲染合并，第二次放不响）');
assert(!/this\.popSeq = true/.test(home) && /this\.popSeq = \(this\.popSeq \|\| 0\) \+ 1/.test(home),
  'popSeq 是累加计数而不是布尔（布尔来回切 = 同一个 class，动画不会重播）');
assert(/class="mod-throw" :class="popClass"/.test(home),
  '回弹挂在专门的 .mod-throw 层（它没有内联 transform，动画不会盖掉跟手的位移）');
{
  const kb = (n) => {
    const m = css.match(n === 'a' ? /@keyframes sheet-pop-a \{[\s\S]*?\n\}/ : /@keyframes sheet-pop-b \{[\s\S]*?\n\}/);
    return m ? m[0] : '';
  };
  const a = kb('a');
  const b = kb('b');
  assert(a.length > 0 && b.length > 0, 'pop-a / pop-b 各有一份 keyframes（缺一份就只有单数次能响）');
  // 幅度必须压住：大了就是廉价弹窗。峰值缩放 ≤1.04，且最后一帧必须回到原位。
  const peak = Math.max(...[...a.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1])));
  assert(peak > 1 && peak <= 1.04, '回弹的峰值缩放 >1 但 ≤1.04（Q 弹，不是弹窗）');
  assert(/100% \{ transform: translateY\(0\) scale\(1\)/.test(a), '回弹收在原位（不留偏移）');
  assert(!/opacity|width|height|margin|padding/.test(a), '回弹只动 transform（纯合成器属性，零重排）');
  assert(/\.mod-throw\.pop-a \{ animation: sheet-pop-a/.test(css) && /\.mod-throw\.pop-b \{ animation: sheet-pop-b/.test(css),
    '两个 class 各绑一份自己的动画名字');
  // 关动效的档位要一起停（装饰性动作不能硬加）
  assert(/\.fx-motion-off \.mod-throw\.pop-a[\s\S]{0,200}animation:\s*none/.test(css),
    '动效关闭档位下不放回弹');
  assert(/prefers-reduced-motion: reduce[\s\S]{0,200}\.mod-throw\.pop-a[\s\S]{0,120}animation:\s*none/.test(css),
    '系统"减弱动效"下不放回弹');
}
  // 抽屉透明度在 2026-10-17 **调回来了**（用户："还是调回原来那样，这样子和卡片的
  // 对比度比较高"）：上面那张全屏卡是透明的、只在上滑瞬间糊一下，于是这层是下面
  // 那摞卡**唯一的实背景** —— 太透（0.09 那版）卡片跟底板几乎分不开。
  // 但也不能一路抬上去：超过 0.2 就又变成那块被砍掉的奶白板。
  // ⚠️ 只量**表面那几层**（background-image）：那道 1.5rpx 的顶沿高光本来就该亮，
  //    它是"线"不是"面"，混在一起量会把这条线误判成奶白。
  {
    const veil = rule('.mod-sheet::before');
    // ⚠️ 锚到语句末尾的 `);`：rgba(var(--surface-rgb, 255, 255, 255), 0.09) 里
    //    第一个能配上的数字是 var() 里兜底的 255，不锚末尾会把 alpha 读成 255。
    const bg = (veil.match(/background-color:[^;]*?,\s*([\d.]+)\s*\);/) || [])[1];
    assert(Number(bg) >= 0.12 && Number(bg) <= 0.2,
      '玻璃本体色落在 0.12~0.2（比全屏卡实得多 → 卡片有对比；再实就变白板）');
    const img = (veil.match(/background-image:[\s\S]*?;/) || [''])[0];
    const whites = [...img.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map((m) => Number(m[1]));
    assert(whites.length > 0 && Math.max(...whites) <= 0.36,
      '表面高光最亮处 ≤0.36（够亮能托住对比度，又不至于糊成奶白）');
  }
// syncReveal 必须待在 methods 里：onReady / onPageScroll / watch 都以 this.syncReveal 调用，
// 放到 methods 外（与生命周期选项平级）就不是实例方法 → 真机报
// "this.syncReveal is not a function"（2026-10-16 真踩，脚本全绿却炸在基座上）。
const mStart = home.indexOf('methods: {');
const rStart = home.indexOf('syncReveal(scrollTop) {');
assert(mStart >= 0 && rStart >= 0 && rStart > mStart,
  'syncReveal 定义在 methods 之内（在 methods 外它不是实例方法，this.syncReveal 会炸）');
// mod-wrap 上隐藏 action 卡必须用 v-show：Vue 3 里 v-if 与 v-for 同元素时
// v-if 先求值、拿不到循环变量 c（真机报 "Property c was accessed during render"，
// 且 isActionInFocus(c) 恒 false → 焦点模式藏不住 action 卡）。
assert(/v-show="!isActionInFocus\(c\)"/.test(home),
  'mod-wrap 用 v-show 隐藏 action 卡（v-show 在循环体内求值，作用域正确）');
assert(!/v-if="!isActionInFocus\(c\)"/.test(home),
  'mod-wrap 不许用 v-if 隐藏 action 卡（v-if 与 v-for 同元素先求值，c 未定义）');
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
  assert(/class="focus-keyinfo"/.test(hero) && /class="focus-sub"/.test(hero),
    'hero 仍是「关键信息 + 两个大入口 + 小字」三段');
  // 2026-10-16 用户要求"中间的背单词/背句子只保留 button，不需要背景的卡片"：
  // .focus-panel（毛玻璃面板）已下线，首屏就是裸的两个按钮，不再有背景卡。
  assert(!/focus-panel/.test(home),
    '不再有 .focus-panel 背景卡（入口只要裸按钮，面板已下线）');
}

console.log('== 3. hero 形态：铺满一屏 + 裸按钮入口渐隐 + 卡片淡入 ==');
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
  // 左右 0：入口与下方卡片同宽；上下留白对称于整屏 → 两个入口落在屏幕正中
  // （底栏 220 + 24、顶栏 136，差值 108 补在 padding-top）。
  assert(/108rpx/.test(pad) && /220rpx/.test(pad) && /safe-area-inset-bottom/.test(pad),
    'padding 上下对称于整屏（108 = 24 + 220 − 136）→ 入口在屏幕正中');
  // 左右必须是 0：hero 与下方卡片同宽，一眼看过去才是"一摞卡"。
  // ⚠️ 上面那条只验了上下（108 / 220），横向写成 32rpx 也照样通过 = 假绿
  //    （2026-10-17 变异抓到）→ 这条专门钉横向。
  assert(/\)\s+0\s+calc\(24rpx/.test(pad), 'hero 左右内边距是 0（与下方卡片同宽）');
  assert(/justify-content:\s*center/.test(hero), 'hero 内容垂直居中');
  assert(!/transition/.test(hero), 'hero 上没有任何过渡（高度 / 内边距不参与动画）');
  // 入口渐隐（2026-10-16 用户要求）：上滑时卡片淡入、两个入口渐隐；
  // 卡片滑回去 → fade 归 0 → 入口回来。同一条进度的正反两面。
  // ⚠️ 默认值必须是 0（全显示）：JS 一环没跑时入口一定要在，绝不能默认藏。
  // ---- 全屏那张卡（2026-10-17 第十版）：hero 拆成「外壳 / 卡面 / 内容」三层 ----
  // 卡面 .hero-glass 是 .focus-hero 的**子节点** —— 外壳一带 opacity 就自成
  // backdrop root，卡面从此糊不到 app 背景（用户看到的是"背景图纹丝不动地平移"）。
  // 这是第十版的全关节，必须钉在**源头**上，而不是钉在"效果应该出现"上。
  assert(!/opacity\s*:/.test(hero),
    '.focus-hero 外壳上不许出现任何 opacity（一带就把卡面的 backdrop 隔离了）');
  assert(!/backdrop-filter/.test(hero), '外壳自己不带 backdrop-filter（那是 .hero-glass 的活）');
  assert(/class="hero-glass"/.test(home) && /class="hero-body"/.test(home),
    'hero 拆成「外壳 transform / 卡面 hero-glass / 内容 hero-body」三层');
  // ---- 第十一版：卡面必须挂在 .hero-card 上，不能挂进 .focus-hero ----
  // 外壳带 scale(1→0.95)，卡面一旦是它的子节点就跟着一起缩 → 满糊时左右各空出
  // 2.5% 屏宽（2026-10-17 真机："整页模糊没有占满全屏，左右两边占不满"）。
  // ⚠️ 修法不是"把外扩加大"：那等于把整屏高斯的面积放大三四成（掉帧老路）。
  {
    const tpl = home.slice(home.indexOf('<template>'), home.indexOf('</template>'))
      .replace(/<!--[\s\S]*?-->/g, '');
    const iCard = tpl.indexOf('class="hero-card"');
    const iGlass = tpl.indexOf('class="hero-glass"');
    const iHero = tpl.indexOf('class="focus-hero"');
    assert(iCard >= 0, '存在 .hero-card 外框（卡面的定位基准）');
    assert(iCard < iGlass && iGlass < iHero,
      '卡面挂在 .hero-card 上、且排在 .focus-hero 之前（不受外壳 scale 影响）');
    // 卡面必须在 hero 的**外面**：把它塞回 hero 里就又跟着缩了
    const heroOpen = tpl.indexOf('>', iHero);
    const heroClose = tpl.indexOf('</view>', heroOpen);
    assert(iGlass < heroOpen || iGlass > heroClose,
      '.hero-glass 不能落在 .focus-hero 内部（一进去就跟着 scale 缩，左右又空出来）');
    const card = rule('.hero-card');
    assert(card.length > 0, '存在 .hero-card 规则');
    assert(!/transform|opacity|filter/.test(card),
      '.hero-card 外框不带 transform / opacity / filter（带了卡面就跟着缩、或 backdrop 被隔离）');
    assert(/position:\s*relative/.test(card), '.hero-card 是卡面的定位基准');
    // 外扩量：左右正好抵消 .container 的 28rpx 内边距即可，不许为了补 scale 而加大
    const g = rule('.hero-glass');
    assert(/left:\s*-28rpx/.test(g) && /right:\s*-28rpx/.test(g),
      '卡面左右只外扩 28rpx（正好抵消 container 内边距 = 屏宽；不许为补 scale 而加大）');
  }
  // 内容层：入口渐隐搬到这里（外壳再也不能吃 opacity）
  {
    const body = rule('.hero-body');
    assert(body.length > 0, '存在 .hero-body 规则（入口渐隐在这一层）');
    assert(/opacity:\s*calc\(1 - var\(--hero-fade, 0\)\)/.test(body),
      'hero-body 透明度 = 1 − --hero-fade（默认 0 = 全显示，JS 失效也不会藏起入口）');
    assert(/pointer-events:\s*var\(--hero-pe, auto\)/.test(body),
      '淡到近乎全隐时关掉 pointer-events（不许点到看不见的按钮）');
  }
  // 整张主页自己就是"那张卡"：外壳往上抬 = 整屏一起往上走（用户："整体都有立体感"）
  assert(/translate3d\(0,-/.test(home), '全屏卡外壳带一个向上的位移（整屏一起滑，不是只有下面在动）');
  assert(/this\._heroLiftPx = this\.upx\(\d+\)/.test(home), '上抬距离走 upx→px 换算（内联不认 rpx）');
  // 卡面：静止必须全透明（背景图要高清），只在上滑那一段长出模糊
  {
    const glass = rule('.hero-glass');
    assert(glass.length > 0, '存在 .hero-glass 规则（全屏那张卡的卡面）');
    // 用户原话："注意这里只是为了动画，主页背景还是切回来要显示清晰的背景图片"
    // → 静止档必须什么都不做；反过来写成"默认就糊"，背景图就永远回不到高清。
    assert(/--hero-glass-op:\s*0/.test(glass) && /opacity:\s*var\(--hero-glass-op, 0\)/.test(glass),
      '卡面默认全透明（静止时背景图必须是高清的）');
    assert(!/background-color/.test(glass),
      '卡面不给本体色（没有模糊时它就是一片奶白垫片 —— 正是上一版被砍掉的东西）');
    // 卡面与 .focus-hero 现在是**兄弟**，靠 z-index 分先后（不再是父子的 z-index:-1）
    assert(/z-index:\s*0\b/.test(glass) && /pointer-events:\s*none/.test(glass),
      '卡面垫在内容之下且不吃点击');
    assert(/z-index:\s*1\b/.test(rule('.focus-hero')),
      '.focus-hero 自己要站到卡面之上（否则整块主页内容被那层模糊盖住）');
    // 五档齐不齐：少一档就是"台阶缺一级"
    for (let i = 0; i <= 4; i++) {
      assert(css.indexOf('.hero-glass-' + i + ' {') > 0, '存在第 ' + i + ' 档 hero-glass-' + i);
    }
    assert(/--hero-glass-blur:\s*var\(--glass-sheet/.test(css),
      '满档复用 --glass-sheet（跟着画质档位缩放，glass:off 时一起退回 none）');
    // 只过渡 opacity：**过渡模糊半径 = 逐帧重跑整屏高斯模糊**，是掉帧的老路
    const tr = (glass.match(/transition:[^;]*/) || [''])[0];
    assert(/opacity/.test(tr) && !/backdrop-filter|blur\(/.test(tr),
      '卡面只过渡 opacity（不过渡模糊半径）');
    // 档位只能由「切 class」驱动，不许把半径写进内联样式逐帧改
    assert(/class="hero-glass" :class="glassLevel"/.test(home),
      '卡面按 glassLevel 切 class 驱动（不逐帧写样式）');
    // ⚠️ 只圈 glassLevel **函数体本身**（到它自己的 `},` 为止）：拿"到下一个方法名"
    //    当边界会把下一段方法的注释也算进来 —— 那段注释正要讲 backdrop-filter，会误判。
    const gStart = home.indexOf('glassLevel() {');
    const gBody = gStart > 0 ? home.slice(gStart, home.indexOf('\n    },', gStart)) : '';
    assert(gBody.length > 0 && !/backdrop-filter|setProperty/.test(gBody),
      'glassLevel 只返回 class 名（不直接下发模糊半径 / 不碰 DOM）');
    assert(/return 'hero-glass-' \+ n/.test(gBody) && /revealOn\) return 'hero-glass-0'/.test(gBody),
      '不接手势时落在第 0 档（什么都不做 → 背景图高清）');
    // 三条兜底，缺一条就有一类机器看不到 / 卡不住：
    // ① App.vue 的 .bg-flat 用 !important 关掉了**所有** backdrop-filter，卡面必须抢回来
    assert(/\.bg-flat \.hero-glass[\s\S]{0,200}!important/.test(css),
      'bg-flat 下用 !important 把卡面的模糊抢回来（糊的是整张主页，不能省）');
    // ② 整屏高斯是本 App 最贵的一笔绘制，低端机必须有退路
    assert(/\.perf-smooth \.hero-glass[\s\S]{0,200}opacity:\s*0 !important/.test(css),
      '流畅模式下整屏高斯直接退掉');
    // ③ 不支持 backdrop-filter 的老 WebView：直接摘掉，**不许抬本体色救**
    //    （抬本体色 = 一整块奶白垫片盖住主页，正是上一版被砍掉的那个东西）
    assert(/@supports not[\s\S]{0,600}\.hero-glass \{[^}]*opacity:\s*0 !important/.test(css),
      '老 WebView 不支持时直接摘掉卡面（不许抬本体色救，那是一整块奶白）');
  }
  // 抽屉感③：首页这层随抽屉上来轻微缩小（景深）——抽屉在上、首页沉下去。
  assert(/transform:\s*scale\(calc\(1 - [\d.]+ \* var\(--hero-fade, 0\)\)\)/.test(hero),
    'hero 随 --hero-fade 轻微缩小（景深：抽屉在上、首页沉下去；仍是 transform）');
  // 卡片淡入：mod-list 读 --reveal 决定透明度与上移，纯合成器属性（不掉帧）。
  // "抽屉没有实体"= 下方卡片本身就是抽屉，靠滚动进度淡入 + 上移，而非独立浮层。
  const list = rule('.mod-list');
  assert(list.length > 0, '存在 .mod-list 规则');
  // ⚠️ 默认必须 --reveal:1（卡片常显）：静止态"看不到卡片"由 hero 铺满屏幕底边
  // （布局）保证，绝不靠 CSS 把初值锁 0 —— 否则 onPageScroll 一不触发就永久隐藏（真机已踩）。
  assert(/--reveal:\s*1/.test(list), 'mod-list 默认 --reveal:1（卡片常显；藏卡只靠布局，不靠 opacity）');
  assert(/opacity:\s*var\(--reveal/.test(list), 'mod-list 透明度随 --reveal 变化（淡入）');
  // 位移不在这一层了：放在外层 .mod-sheet（下面第 3 组单独守），
  // 因为带 opacity 的层不能同时当玻璃底板的宿主（会把 backdrop 隔离）。
  // 抽屉感①：这摞卡要**落后于滚动**才看得出"被拉上来"（视差）。
  // 之前只有 56rpx，跟着页面一起平移 → 真机反馈"没有任何动画、层级和首页没区别"。
  // ⚠️ 位移在**外层 .mod-sheet** 上（底板跟着卡片一起走），不在 .mod-list 上。
  const sheet = rule('.mod-sheet');
  assert(sheet.length > 0, '存在 .mod-sheet 规则（玻璃底板的宿主层）');
  const slide = (sheet.match(/translateY\([^)]*\(1 - var\(--reveal, 1\)\) \* (\d+)rpx\)/) || [])[1];
  assert(Number(slide) >= 140,
    '抽屉的上滑视差 ≥140rpx（太小就跟页面同速平移，看不出抽屉被拉上来）');
  // ⚠️ 底板宿主层**绝不能带 opacity**：backdrop root 由 opacity<1 / filter / mask /
  //    mix-blend-mode / will-change(这些) 创建，一带上，底板的 backdrop-filter 就只能
  //    糊到自己这一层里（背后只剩卡片自己）→ 糊了个寂寞，看着就是一块平涂半透明白片。
  //    这正是 2026-10-16 用户"玻璃缺少立体感、不像苹果那种"的根因。
  assert(!/opacity|filter:|mask|mix-blend-mode/.test(sheet),
    '底板宿主层不带 opacity / filter / mask（否则 backdrop 被隔离，玻璃糊不到首页内容）');
  assert(!/\.mod-list::before/.test(css),
    '底板不再挂在 .mod-list 上（.mod-list 带淡入 opacity，会把 backdrop 隔离在自己层里）');
  // 抽屉感②：整摞卡共用一张玻璃底板（缝隙里露出被模糊的首页内容）→ 另一层的证据。
  const veil = rule('.mod-sheet::before');
  assert(veil.length > 0, '存在 .mod-sheet::before 玻璃底板规则');
  assert(/backdrop-filter/.test(veil) && /--glass-sheet/.test(veil),
    'mod-sheet::before 是玻璃底板（卡片缝隙露出被模糊的首页内容）');
  assert(!/opacity/.test(veil),
    '底板自身不带 opacity（一有就把 backdrop 隔离，玻璃感全废；出场靠位移）');
  // 立体感四件套：顶沿内高光（最关键的一条）+ 底沿内暗边（厚度）+ 整圈 hairline +
  // 双层外投影。只有"半透明 + 一层投影"就是一块灰片，不是玻璃。
  assert((veil.match(/inset/g) || []).length >= 3,
    '底板至少三道 inset（顶沿高光 / 底沿暗边 / 整圈描边）→ 玻璃才有厚度与朝向');
  assert((veil.match(/box-shadow[^;]*0 -2rpx|box-shadow[^;]*-2rpx/g) || []).length > 0,
    '外投影是双层的（近层紧实 + 远层扩散 → 真的浮起来）');
  assert(/background-image/.test(veil) && /gradient/.test(veil),
    '玻璃表面是渐变而不是平涂（有明暗过渡才像一块有朝向的玻璃）');
  assert(/box-shadow/.test(veil) && /border-radius/.test(veil),
    '底板带投影与圆角（抽屉是从下面推上来的）');
  assert(/pointer-events:\s*none/.test(veil), '底板不吃点击');
  // App.vue 的 .bg-flat 会 !important 关掉所有 backdrop-filter（背景是平滑渐变时
  // 糊背景赚不到观感）。但底板背后是**首页内容**，必须抢回来；同时给流畅模式兜底。
  assert(/\.bg-flat \.mod-sheet::before[\s\S]{0,300}!important/.test(css),
    'bg-flat（无自定义背景图）下底板的模糊要抢回来（它糊的是首页内容，不是背景）');
  assert(/\.perf-smooth \.mod-sheet::before/.test(css),
    '流畅模式给底板兜底（关掉模糊时要抬起本体色，不能剩一层 14% 的白）');
  assert(css.indexOf('.bg-flat .mod-sheet::before') < css.indexOf('.perf-smooth .mod-sheet::before'),
    'perf-smooth 那条排在 bg-flat 之后（同特异性，后者覆盖前者）');
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
  // 卡片区允许带内联样式，但**只能是 reveal 的那一份**（opacity / transform）——
  // 高度 / 显隐绝不能由 JS 控（那正是上一版"自定义抽屉"的做法，已废弃）。
  const list = home.slice(iList - 40, home.indexOf('>', iList) + 1);
  assert(/:style="listRevealStyle"/.test(list),
    '.mod-list 上只挂 reveal 的内联样式（不再由 JS 控高度 / 显隐）');
  assert(!/height|display/.test(list),
    '.mod-list 内联样式里不许出现高度 / display（那正是上一版抽屉的做法）');
  // 空态兜底：卡片被全部收纳时 hero 必须退回自然高度 ——
  // 否则"＋ 添加组件 / 编辑首页"全在下一屏之后，而页面又几乎没得滚，用户以为加不回来。
  assert(/:class="\{ 'hero-empty': !renderCards\.length \}"/.test(home),
    'hero 在"卡片全被收纳"时挂 hero-empty');
  const empty = rule('.focus-hero.hero-empty');
  assert(/min-height:\s*0/.test(empty), 'hero-empty 时 hero 不再缩短（兜底入口全在首屏）');
  // hero-empty 也不补左右边距：入口宽度与其他态一致
  assert(/padding:\s*40rpx 0/.test(empty), 'hero-empty 的左右仍是 0（入口与其他态同宽）');
}

console.log(fail === 0 ? '\n上滑看卡片全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
