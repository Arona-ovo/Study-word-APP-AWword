// _tools/check-navbar.js - 首页搜索胶囊「铺满 / 收缩」状态机 + 样式契约校验（只读）
//
// 回归点：
//  1) 未聚焦且无关键词 → 左右槽收起（width 0），输入框铺满整个胶囊
//  2) 聚焦 → 槽展开，输入框只横向收缩、上下不动、两侧等宽（居中）
//  3) 失焦且没词 → 还原成铺满；失焦但有词 → 保持收缩（× 要有位置）
//  4) 点放大镜 = 执行搜索；非搜索模式左槽仍是返回键；右槽 × 行为不变
//  5) 收缩 / 还原必须走 width 过渡（有动画）
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp', 'components', 'float-navbar', 'float-navbar.vue');
const src = fs.readFileSync(FILE, 'utf8');
const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'))
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '');
const code = script.replace('export default', 'const COMP =') + '\n; return { COMP: COMP };';

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}
function yes(v, label) { if (v) ok(label); else bad(label); }

const uniCalls = [];
const uniMock = {
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  hideKeyboard: () => uniCalls.push('hideKeyboard'),
  navigateBack: () => uniCalls.push('navigateBack'),
  switchTab: (o) => uniCalls.push('switchTab:' + (o && o.url))
};
const backPages = [];
global.getCurrentPages = () => backPages;

// t 来自全局 mixin 的 $t（页面里是 $t，脚本里直接用 t）；这里用恒等桩 = 中文态行为
const api = new Function('uni', 't', code)(uniMock, (s) => String(s));

// 造一个组件实例：data + methods + computed（$emit 记下来）
function mount(props, keep) {
  const emits = [];
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, props, keep || {});
  ctx.$emit = (n, v) => emits.push({ n: n, v: v });
  Object.keys(api.COMP.computed).forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => api.COMP.computed[k].call(ctx), configurable: true });
  });
  ctx.emits = emits;
  return ctx;
}

console.log('== 1. 未使用 / 未点击：铺满整个胶囊 ==');
const idle = mount({ search: true, value: '', title: '' });
eq(idle.focused, false, '初始未聚焦');
eq(idle.active, false, 'active');
eq(idle.isFlat, true, 'isFlat（左右槽收起 → 输入框铺满）');

console.log('== 2. 点击输入框：收缩为内嵌尺寸 ==');
idle.onFocus();
eq(idle.focused, true, '已聚焦');
eq(idle.active, true, 'active');
eq(idle.isFlat, false, 'isFlat（槽展开 → 输入框横向收缩）');
eq(idle.emits[0].n, 'focus', '向页面抛出 focus');

console.log('== 3. 失焦且没有关键词：动画还原成铺满 ==');
idle.onBlur({ detail: { value: '' } });
eq(idle.focused, false, '失焦');
eq(idle.isFlat, true, 'isFlat 回到铺满');

console.log('== 4. 失焦但有关键词：保持收缩（× 要有落脚点） ==');
const typed = mount({ search: true, value: 'apple' });
eq(typed.isFlat, false, '有关键词时即便失焦也不铺满');
typed.onBlur({ detail: { value: 'apple' } });
eq(typed.isFlat, false, '失焦后仍保持收缩');
eq(typed.emits[typed.emits.length - 1].v, 'apple', 'blur 事件带上当前词');

console.log('== 5. 页面主动收起（点「收起」/清空）：失焦 + 收键盘 ==');
uniCalls.length = 0;
typed.blurInput();
eq(typed.focused, false, 'force 失焦');
yes(uniCalls.indexOf('hideKeyboard') >= 0, '调用了 hideKeyboard');

console.log('== 6. 左边放大镜：点击执行搜索 ==');
const withWord = mount({ search: true, value: 'apple' });
withWord.onLeftTap();
eq(withWord.emits.length, 1, '只发一个事件');
eq(withWord.emits[0].n, 'search', '事件名');
eq(withWord.emits[0].v, 'apple', '带上当前关键词');

console.log('== 7. 非搜索页：左槽仍是返回键，且不误触搜索 ==');
backPages.length = 0;
backPages.push({}, {});   // 栈深 2 → 显示返回键
uniCalls.length = 0;
const titleBar = mount({ search: false, value: '', title: '词库' });
eq(titleBar.isFlat, false, '非搜索模式不收起（返回键槽保持 72rpx）');
eq(titleBar.showBack, true, '栈深 > 1 显示返回键');
titleBar.onLeftTap();
yes(uniCalls.indexOf('navigateBack') >= 0, '点击走 navigateBack');
eq(titleBar.emits.filter(e => e.n === 'search').length, 0, '没有抛出 search');
// 返回前先同步问页面能不能 veto（before-back 回调）：强制模式页可借此把人按住，
// 顶栏不能自己绕开页面的 onBackPress 直接走 navigateBack
const bb = titleBar.emits.find(e => e.n === 'before-back');
yes(!!bb, '先发 before-back 让页面有机会拦截');
yes(typeof bb.v === 'function', 'before-back 带一个 veto 回调');

// veto 路径：父页面在 @before-back 里同步调用回调 → 不导航。
// 真实环境里 uni.$emit 会同步执行父页面的 handler，回调在 onBack 继续之前就生效；
// 这里用自定义 $emit 模拟"父页面同步拦截"。注意 mount() 不跑 created/mounted，
// stackN 仍是 -1，showBack 回落到 getCurrentPages —— 必须先把栈深撑到 2 才走得到 before-back；
// 且 mount() 会在返回前覆盖 $emit，所以得在 mount 之后再替换。
uniCalls.length = 0;
backPages.length = 0;
backPages.push({}, {});   // 栈深 2
let vetoed = false;
const vetoBar = mount({ search: false, value: '', title: '词库' });
vetoBar.$emit = (n, v) => { if (n === 'before-back') { v(); vetoed = true; } };
vetoBar.onLeftTap();
yes(vetoed && uniCalls.indexOf('navigateBack') < 0, 'veto 后不再 navigateBack');
// 对照：不拦截时才真的导航
uniCalls.length = 0;
const noVeto = mount({ search: false, value: '', title: '词库' });
noVeto.onLeftTap();
yes(uniCalls.indexOf('navigateBack') >= 0, '不被拦截时走 navigateBack');

uniCalls.length = 0;
backPages.length = 0;      // 栈深 1
const rootBar = mount({ search: false, value: '', title: '词库' });
rootBar.onLeftTap();
eq(uniCalls.length, 0, '栈深 1 且无返回键时点击不触发导航');

console.log('== 8. 右边 ×：行为与原来一致 ==');
const clearBar = mount({ search: true, value: 'apple' });
clearBar.onClear();
eq(clearBar.emits.length, 2, '两个事件（input + clear）');
eq(clearBar.emits[0].n + '=' + clearBar.emits[0].v, 'input=', '先清空输入');
eq(clearBar.emits[1].n, 'clear', '再抛 clear');

console.log('== 9. 样式契约：只缩左右、上下不变、有过渡 ==');
const style = src.slice(src.lastIndexOf('<style'));
const sideRule = style.match(/\.fnb-search-mode\s+\.fnb-side\s*\{([^}]*)\}/);
yes(!!sideRule, '存在 .fnb-search-mode .fnb-side 规则');
if (sideRule) {
  const body = sideRule[1];
  yes(/transition:[^;]*width\s+\d+ms/.test(body), '槽位有 width 过渡（收缩/放大都有动画）');
  const w = body.match(/width:\s*(\d+)rpx/);
  eq(w && w[1], '76', '展开态槽宽（rpx）');
  yes(/height:\s*100%/.test(body), '槽位与胶囊同高');
  yes(/overflow:\s*hidden/.test(body), '收起时裁掉图标');
}
const flatRule = style.match(/\.fnb-search-mode\s+\.fnb-side\.fnb-side-flat\s*\{([^}]*)\}/);
yes(!!flatRule && /width:\s*0/.test(flatRule[1]), '收起态槽宽 = 0（输入框铺满）');
yes(!!flatRule && /opacity:\s*0/.test(flatRule[1]), '收起态图标淡出');
const searchRule = style.match(/\.fnb-search\s*\{([^}]*)\}/);
yes(!!searchRule && /height:\s*100%/.test(searchRule[1]), '输入框上下与胶囊同高（只缩左右）');
yes(!!searchRule && /box-sizing:\s*border-box/.test(searchRule[1]), '输入框 border-box（不会撑出胶囊）');
yes(!!searchRule && /flex:\s*1/.test(searchRule[1]), '输入框 flex 1（随槽宽自动收缩、始终居中）');
yes(/\.fnb-search-mode\s*\{\s*padding:\s*0/.test(style), '搜索模式胶囊零内边距（才能真正铺满）');
yes(/\.mag-ring/.test(style) && /\.mag-handle/.test(style), '放大镜是 CSS 画的（不依赖图片资源）');
// 两侧槽共用同一条 width → 必然等宽 → 输入框居中
const allSideWidths = (style.match(/\.fnb-search-mode\s+\.fnb-side[^{]*\{[^}]*width:\s*(\d+)rpx/g) || []);
eq(allSideWidths.length, 1, '左右槽共用一条宽度规则（等宽 → 居中）');

console.log('== 10. 模式键（搜 / AI）常驻：收起态也要能切换 ==');
// 回归点：模式键以前也挂 fnb-side-flat —— 收起态是 width:0 + pointer-events:none，
// "没打字按了下回车 → 走到清空 → 顶栏失焦 → 胶囊收起"，这颗键就成了"看得见点不动"。
// 而且锁定态被藏起来更危险：用户以为自己没锁，随手打个单词却被当成指令真的改了首页。
const tpl = src.slice(0, src.indexOf('<script'));
// 只数真正绑定收起类的槽位（注释里也会提到这个类名，不能按裸字符串数）
const flatCount = (tpl.match(/fnb-side-flat': isFlat/g) || []).length;
eq(flatCount, 2, '模板里只有左右两个图标槽会收起');
const modeBlock = tpl.slice(tpl.indexOf('v-if="search && switchable"'), tpl.indexOf('@tap="onModeTap"'));
yes(!!modeBlock && !/fnb-side-flat/.test(modeBlock), '模式键不参与收起（常驻）');
yes(!/\.fnb-side-mode[^{]*\{[^}]*width:\s*0/.test(style), '模式键槽没有被样式写成 0 宽');

const idleMode = mount({ search: true, switchable: true, value: '', mode: 'search' });
eq(idleMode.isFlat, true, '空闲态左右槽确实收起（输入框铺满）');
idleMode.onModeTap();
eq(idleMode.emits.length, 1, '空闲态点模式键仍然有响应');
eq(idleMode.emits[0].n, 'mode-toggle', '事件名');
eq(idleMode.emits[0].v, 'command', '搜 → AI');
const cmdMode = mount({ search: true, switchable: true, value: '', mode: 'command' });
cmdMode.onModeTap();
eq(cmdMode.emits[0].v, 'search', 'AI → 搜');
const noSwitch = mount({ search: true, switchable: false, value: '', mode: 'command' });
noSwitch.onModeTap();
eq(noSwitch.emits.length, 0, 'switchable=false 的页面没有这颗键，点击不响应');

console.log('== 11. 标题右侧的快捷动作（actions）：非搜索态的"常驻入口" ==');
// 回归点（AI 对话页反馈）：「最顶上那三个功能，聊天记录多了就要翻到很上面才看得到」。
// 原因是那三个按钮放在页面里的工具栏上，没有 fixed。现在胶囊接管：怎么滚都在。
yes(/actions:\s*\{\s*type:\s*Array/.test(script), '组件声明了 actions 数组 prop');
yes(/onActionTap\(key\)\s*\{[\s\S]{0,120}\$emit\('action', key\)/.test(script),
  '点一下只发 action 事件（做什么由页面定，组件不猜）');
yes(/v-if="hasActions"[\s\S]{0,300}v-for="a in actions"/.test(tpl), '模板按数组渲染快捷动作');
yes(/hasActions\(\)\s*\{[\s\S]{0,200}!this\.search/.test(script),
  '搜索态不给动作留位置（那条胶囊是给输入框用的）');
yes(/flex-shrink:\s*0/.test(style.slice(style.indexOf('.fnb-acts'))), '动作区不被压缩');
yes(/\.fnb-title\s*\{[^}]*min-width:\s*0/.test(style),
  '标题可收缩（长标题不该把动作挤出屏幕外）');

const noAct = mount({ title: 'X' });
eq(noAct.hasActions, false, '没传 actions → 不出现');
const withAct = mount({ title: 'X', actions: [{ key: 'new', text: '新对话' }] });
eq(withAct.hasActions, true, '传了 actions → 出现');
withAct.onActionTap('new');
eq(withAct.emits.length, 1, '点一下有响应');
eq(withAct.emits[0].n, 'action', '事件名');
eq(withAct.emits[0].v, 'new', '事件带 key');
const inSearch = mount({ search: true, title: '', actions: [{ key: 'new', text: '新对话' }] });
eq(inSearch.hasActions, false, '搜索态隐藏（哪怕传了 actions）');

console.log('');
console.log(fail === 0 ? '顶栏搜索胶囊全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
