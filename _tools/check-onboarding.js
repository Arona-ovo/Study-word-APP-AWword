// _tools/check-onboarding.js - 首次进入新手引导 校验
// 覆盖：
//  1) 状态机：shouldShow / finish / restart / isDone 的闭环（读完设置即不再打扰）
//  2) 步骤定义：数量、id 唯一、文案非空、target 形态合法（null / {sel} / {ref,sel}）
//  3) advance 纯逻辑与 stepAt 越界
//  4) 文案国际化的英文译文全覆盖（引导是第一眼看到的东西，不能裸中文撞英文界面）
//  5) 目标选择器接线：ref 与页面模板一致、组件内有对应 class 与 rect() 测量口
//  6) 首页接线：遮罩挂在 .page-slide 之外、事件方法存在、看完落盘
//  7) 遮罩组件：box-shadow 挖洞、层级压过悬浮 tabbar、touch 截断、模板无裸中文
//  8) 设置页「重看引导」入口
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const { load } = require('./lib/load');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
// ⚠️ 一律归一化换行符再匹配：home.vue 在 Windows 工作区里可能被存成 CRLF
// （编辑器 / 工具写入时会转），而下面的断言里有 `</view>\n\n    <!-- …` 这种
// 跨行字面量 —— CRLF 下 `\n` 后面总跟着 `\r`，字面量永远匹配不到，
// 表现为"明明代码是对的，脚本却报红"。跟 check-version-egg.js 同一个坑。
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/* ---------------- mock 环境 ---------------- */
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}, $emit: () => {}, $on: () => {}, $off: () => {}
};

// onboarding 依赖 settings —— 注入真实 settings.js（storage 已 mock）
const settings = load('utils/settings.js');
settings.init();

const ob = load('utils/onboarding.js', { settings });

console.log('== 1. 完成状态机 ==');
assert(ob.shouldShow() === true, '全新安装：shouldShow = true（要引导）');
assert(ob.isDone() === false, 'isDone = false');
ob.finish();
assert(ob.shouldShow() === false, 'finish() 后不再弹');
const saved = settings.get().onboarding;
assert(saved && saved.done === true && saved.v === ob.VERSION, '落盘内容含 done 与版本号（v=' + ob.VERSION + '）');
assert(saved.at > 0, 'at 记了完成时间');
ob.restart();
assert(ob.shouldShow() === true, 'restart() 后重新要引导（设置页重看用）');
ob.finish();
assert(ob.shouldShow() === false, '再 finish 闭环');

console.log('== 2. 步骤定义 ==');
const steps = ob.steps();
assert(steps.length >= 4, '步骤数 ' + steps.length + ' ≥ 4（挑重点，不做流水账）');
assert(steps.length === ob.count(), 'count() 与 steps() 一致');
const ids = steps.map(s => s.id);
assert(new Set(ids).size === ids.length, 'id 唯一：' + ids.join(' / '));
assert(ids[0] === 'welcome', '第一步是欢迎（无高亮）');
const shapes = steps.every(s =>
  s.title && s.body &&
  (s.target === null ||
   (s.target && typeof s.target.sel === 'string' && !s.target.ref) ||
   (s.target && typeof s.target.sel === 'string' && typeof s.target.ref === 'string'))
);
assert(shapes, '每步 title/body 非空且 target 形态合法');

console.log('== 3. 推进与越界 ==');
assert(ob.stepAt(0).id === 'welcome', 'stepAt(0) = welcome');
assert(ob.stepAt(steps.length - 1) !== null, 'stepAt(最后一步) 存在');
assert(ob.stepAt(steps.length) === null, 'stepAt(越界) = null');
assert(ob.stepAt(-1) === null, 'stepAt(-1) = null');
assert(ob.advance(0, 5).done === false && ob.advance(0, 5).index === 1, '0 → 1 未完');
assert(ob.advance(3, 5).done === false && ob.advance(3, 5).index === 4, '3 → 4 未完');
assert(ob.advance(4, 5).done === true, '4 → 完成（最后一步的下一步收尾）');
assert(ob.advance(-1, 5).index === 0, '从 -1（未开始）推进到 0');
assert(ob.advance(0, 0).done === true, 'total=0 视为完成（不会卡死）');

console.log('== 3b. 乱数据防御（真实运行时）==');
assert(ob.advance(undefined, 5).index === 0, 'index = undefined → 从第 0 步继续，不崩');
assert(ob.advance(NaN, 5).index === 0, 'index = NaN → 从第 0 步继续，不崩');
assert(ob.advance(0, -5).done === true, 'total 为负 → 视为完成，不卡死');
assert(ob.stepAt(999) === null && ob.stepAt(-99) === null, '极端越界 index 安全返回 null');
// 这条最关键：isDone() 里 catch 吞异常返回 true，写错会在真机上变成「永远不弹引导」，
// 而且不打日志、不报错，只能靠这里守住。
const badSettings = { get() { throw new Error('storage boom') }, set() { throw new Error('storage boom') } };
const obBad = load('utils/onboarding.js', { settings: badSettings });
assert(obBad.isDone() === true, '读设置抛异常 → 判定已完成（宁可不打扰，也不崩）');
let obBadThrew = false;
try { obBad.finish(); obBad.restart(); } catch (e) { obBadThrew = true; }
assert(!obBadThrew, '写设置失败也不向上抛（引导 UI 不会因此卡住）');

console.log('== 4. 英文译文全覆盖 ==');
const en = load('utils/i18n-en.js', { settings }).default;
const missing = [];
steps.forEach(s => {
  if (!en[s.title]) missing.push('title: ' + s.title);
  if (!en[s.body]) missing.push('body: ' + s.title);
});
['跳过', '下一步', '开始使用'].forEach(k => { if (!en[k]) missing.push('按钮: ' + k); });
['新手引导', '回首页重新走一遍功能介绍', '重看 ›'].forEach(k => { if (!en[k]) missing.push('设置页: ' + k); });
assert(missing.length === 0, missing.length ? '缺译文：' + missing.join(' / ') : '步骤与按钮文案全部有英文译文');

console.log('== 5. 目标选择器接线 ==');
const home = R('pages/home/home.vue');
const navbar = R('components/float-navbar/float-navbar.vue');
const tabbar = R('components/float-tabbar/float-tabbar.vue');
const byId = (id) => steps.find(s => s.id === id);

assert(/ref="navbar"/.test(home), '首页给 float-navbar 标了 ref="navbar"');
assert(/ref="tabbar"/.test(home), '首页给 float-tabbar 标了 ref="tabbar"');
assert(/class="fnb-search"/.test(navbar), 'float-navbar 内存在 .fnb-search（引导目标）');
assert(/class="ftb"/.test(tabbar), 'float-tabbar 内存在 .ftb（引导目标）');
assert(/rect\(sel, cb\)/.test(navbar) && /boundingClientRect/.test(navbar), 'float-navbar 暴露 rect() 测量口');
assert(/rect\(sel, cb\)/.test(tabbar) && /boundingClientRect/.test(tabbar), 'float-tabbar 暴露 rect() 测量口');
assert(/class="action-area"/.test(home), '首页存在 .action-area（「开始背单词」目标）');
assert(/class="foot-link"/.test(home), '首页存在 .foot-link（「编辑首页」目标）');
// ref 与 target 对得上
const refTargets = steps.filter(s => s.target && s.target.ref).map(s => s.target.ref);
assert(refTargets.every(r => r === 'navbar' || r === 'tabbar'), 'ref 只指向首页已注册的两个浮层组件：' + refTargets.join(','));

console.log('== 6. 首页接线 ==');
assert(/import \* as onboarding from '.*onboarding\.js'/.test(home), '首页引入 onboarding 模块');
assert(/import OnboardingMask from '.*onboarding-mask\.vue'/.test(home), '首页引入遮罩组件');
assert(/OnboardingMask/.test(home.match(/components:\s*\{[^}]*\}/)[0]), '遮罩组件已注册');
assert(/<onboarding-mask/.test(home), '模板里挂了 <onboarding-mask>');
assert(/v-if="guide\.show"/.test(home), '遮罩由 guide.show 控制');
assert(/@next="guideNext"/.test(home) && /@skip="guideFinish"/.test(home), 'next / skip 事件已接');
assert(/:box="guide\.box"/.test(home) && /:step="guideStep"/.test(home) && /:dark="isDark"/.test(home), '步骤 / 矩形 / 深色模式 props 已传');
assert(/this\.queueGuide\(\)/.test(home), 'onShow 里触发 queueGuide');
assert(/queueGuide\(\)\s*\{[\s\S]*?onboarding\.shouldShow\(\)/.test(home), '启动前核对完成状态（重看后能再弹）');
assert(/guideFinish\(\)\s*\{[\s\S]*?onboarding\.finish\(\)/.test(home), '看完 / 跳过会落盘');
assert(/rect\.width > 0\)\)\s*\{\s*this\.guideNext\(\); return \}/.test(home), '目标测不到时跳过该步（不卡死）');
// 遮罩挂在 .page-slide 之外：模板里 mask 标签出现在 </view>（slide 结束）之后
const tpl = home.slice(0, home.indexOf('\n</template>'));
const slideEnd = tpl.lastIndexOf('</view>\n\n    <!-- 悬浮磨砂玻璃标签栏');
const maskAt = tpl.indexOf('<onboarding-mask');
const tabbarAt = tpl.indexOf('<float-tabbar');
assert(maskAt > tabbarAt, '遮罩在 float-tabbar 之后（页面尾部，fixed 不随内容滑动）');
assert(slideEnd > 0 && maskAt > slideEnd, '遮罩位于 .page-slide 之外（硬约束 4）');

console.log('== 7. 遮罩组件 ==');
const mask = R('components/onboarding-mask.vue');
assert(/box-shadow:\s*0 0 0 9999px/.test(mask), '挖洞用巨大 spread 的 box-shadow（各端一致）');
assert(/z-index:\s*950/.test(mask), '遮罩 z-index 950（压过 tabbar 的 500 / navbar 的 400）');
assert(/@touchmove\.stop\.prevent/.test(mask), '引导期间截断滑动（不会把页面横滑切走）');
assert(/\$emit\('next'\)/.test(mask) && /\$emit\('skip'\)/.test(mask), 'next / skip 都向外抛');
assert(/gd-tip-center/.test(mask) && /isLast \? \$t\('开始使用'\) : \$t\('下一步'\)/.test(mask.replace(/\s+/g, ' ')), '欢迎居中态与最后一步按钮文案都在');
assert(/perf-smooth \.gd-hole/.test(mask), '流畅模式下关掉呼吸动画');
// 模板无裸中文（check-i18n 同款规则，防止阈值悄悄上涨）
{
  const cut = mask.indexOf('\n</template>');
  const tplM = mask.slice(0, cut);
  const HAN = /[\u4e00-\u9fa5]/;
  const leak = [];
  (tplM.match(/>[^<>{}]*</g) || []).forEach(m => {
    const v = m.slice(1, -1).trim();
    if (HAN.test(v) && !v.includes('$t(')) leak.push(v);
  });
  assert(leak.length === 0, leak.length ? '模板裸中文：' + leak.join(' / ') : '遮罩模板文案全走 $t');
}

console.log('== 8. 设置页「重看」入口 ==');
const st = R('pkgManage/pages/settings/settings.vue');
assert(/@tap="replayGuide"/.test(st), '关于分组里有重看入口');
assert(/replayGuide\(\)\s*\{[\s\S]*?onboarding\.restart\(\)/.test(st), '点击先 restart 清完成标记');
assert(/replayGuide\(\)\s*\{[\s\S]*?uni\.switchTab\(\{ url: '\/pages\/home\/home' \}\)/.test(st), '然后跳回首页自动重放');

console.log('== 9. settings 默认值 ==');
const sd = R('utils/settings.js');
assert(/onboarding:\s*\{\s*done:\s*false/.test(sd), 'settings 默认值含 onboarding.done = false');

console.log('== 10. 遮罩绝不能残留（否则会盖住整个底部导航）==');
// 遮罩用 9999px 扩散的 box-shadow 挖洞，是压过底栏（z-index 500）的 fixed 层。
// 引导放着的时候切走页面，若不收起遮罩，用户回来看到的就是"底栏不见了"。
assert(/onHide\(\)\s*\{[\s\S]*?if\s*\(this\.guide\.show\)\s*\{[\s\S]{0,160}?this\.guide\.show\s*=\s*false/.test(home),
  'onHide 会把进行中的遮罩收起来');
// 收起 UI 但不清进度：既不置完成标记，也要保留 index，回来从断点继续
assert(/if\s*\(!\s*\(this\.guide\.index\s*>\s*0[\s\S]{0,120}?onboarding\.count\(\)\)\)\s*\{[\s\S]{0,80}?this\.guide\.index\s*=\s*0/.test(home),
  '断点续播：走到一半回来从原步骤继续（不是从头，也不会卡在遮罩上）');
// 先截出 onHide 函数体再判：直接 /onHide[\s\S]*?guideFinish/ 会一路吃到 methods 区，必定误报
const onHideBody = (home.match(/\n  onHide\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
assert(onHideBody.length > 0, '能取到 onHide 函数体');
assert(!/guideFinish\(\)/.test(onHideBody),
  'onHide 不调 guideFinish（没看完就不能标记已完成）');

console.log(fail === 0 ? '\n新手引导全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
