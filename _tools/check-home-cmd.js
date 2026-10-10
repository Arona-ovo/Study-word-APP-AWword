// _tools/check-home-cmd.js - 「AI 修改首页」输入条与卡片交互回归（只读）
//
// 三个真机 bug 的防线：
//  1) 点推荐 chip 没反应：input blur → 键盘收起 → 页面重排，tap 落在已消失的推荐条上。
//     防线：showSuggest 必须用「blur 延迟收起」的 suggestAlive，不能用实时 inputFocused。
//  2) 语音输入完键盘自动收起：输入法在语音中间态会先发一个空 value 的 input 事件，
//     旧代码对空值直接 clearSearch() → 强制失焦 + 把锁定的指令模式重置成搜索。
//     防线：空值只清结果，不动模式、不抢焦点。
//  3) AI 卡片交互：
//     a. navigate 的 page 不在白名单时旧代码默认 'practice' —— 「设置快捷键」点下去进了练习页。
//        防线：normalizeAction 对非法 page 返回 null（运行时断言）。
//     b. 卡片配图没有任何换图入口。防线：编辑态「换图」按钮 + 页面走 image.set 指令。
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  chooseImage: (o) => { global.__chooseOpts = o; if (o && o.success) o.success({ tempFilePaths: ['file:///tmp/x.jpg'] }) },
  hideKeyboard: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const home = read('pages/home/home.vue');
const blocks = read('components/app-card-blocks.vue');

console.log('== 1. 推荐 chip：blur 延迟收起（tap 落得到） ==');
assert(/suggestAlive/.test(home), '存在 suggestAlive 状态');
const showSuggest = home.match(/showSuggest\(\)\s*\{[\s\S]*?\n    \}/);
assert(!!showSuggest && /suggestAlive/.test(showSuggest[0]), 'showSuggest 由 suggestAlive 驱动');
assert(!!showSuggest && !/this\.inputFocused/.test(showSuggest[0]), 'showSuggest 不再依赖实时 inputFocused');
const blurFn = home.match(/onInputBlur\(\)\s*\{[\s\S]*?\n    \},/);
assert(!!blurFn, '定位到 onInputBlur');
assert(!!blurFn && /setTimeout/.test(blurFn[0]), 'onInputBlur 延迟收起推荐条');
assert(!!blurFn && /__suggestTimer/.test(blurFn[0]), '延迟定时器可取消（focus 时清掉）');
const focusFn = home.match(/onInputFocus\(\)\s*\{[\s\S]*?\n    \},/);
assert(!!focusFn && /__suggestTimer/.test(focusFn[0]), 'onInputFocus 清掉待收起定时器');
const hideFn = home.match(/onHide\(\)\s*\{[\s\S]*?\n  \},/);
assert(!!hideFn && /__suggestTimer/.test(hideFn[0]), 'onHide 清定时器并收起推荐条');
assert(/@tap="useSuggestion\(s\)"/.test(home), 'chip 点击进入 useSuggestion');
const useSug = home.match(/useSuggestion\(s\)\s*\{[\s\S]*?\n    \},/);
assert(!!useSug && /this\.keyword = s/.test(useSug[0]), '点击后文字回填搜索栏（keyword = s）');
assert(!!useSug && /runCommand/.test(useSug[0]), '点击后执行指令');

console.log('== 2. 语音输入：空 input 事件不收键盘、不解锁模式 ==');
const onInput = home.match(/onSearchInput\(v\)\s*\{[\s\S]*?\n    \},/);
assert(!!onInput, '定位到 onSearchInput');
assert(!!onInput && /if \(!kw\) \{/.test(onInput[0]), '空值有独立分支');
assert(!!onInput && !/clearSearch/.test(onInput[0].match(/if \(!kw\) \{[\s\S]*?\n      \}/)[0]), '空值分支不调用 clearSearch（不抢焦点/不解锁模式）');
assert(!!onInput && /searching = false/.test(onInput[0].match(/if \(!kw\) \{[\s\S]*?\n      \}/)[0]), '空值分支只收起结果区');
assert(!!onInput && /JUNK_TEXT\.test\(kw\)\) \{ this\.clearSearch\(\)/.test(onInput[0]), '垃圾输入仍走 clearSearch（该收就收）');

console.log('== 3a. navigate：白名单外的页面名不作废成默认页 ==');
// card-spec 是独立模块，直接加载做运行时断言
const cardSpec = load('utils/card-spec.js');
eq(cardSpec.normalizeAction({ do: 'navigate', page: 'settings' }).page, 'settings', '白名单页面通过');
eq(cardSpec.normalizeAction({ do: 'navigate', page: 'setting' }), null, '拼错的页面名 → 动作作废');
eq(cardSpec.normalizeAction({ do: 'navigate', page: 'https://evil.com' }), null, '外链 → 动作作废');
eq(cardSpec.normalizeAction({ do: 'navigate', page: '' }), null, '空页面名 → 动作作废');
eq(cardSpec.normalizeAction({ do: 'navigate' }), null, '完全没写 page → 动作作废（不猜 practice）');

console.log('== 3b. 卡片配图：非编辑态有换图入口，表面无移除按钮 ==');
assert(/cb-img-edit/.test(blocks), '有「换图」按钮样式锚点');
assert(/<text v-if="editable" class="cb-img-edit"/.test(blocks), '换图按钮只在 editable（非编辑态）出现（外层已有 card.image 的 v-if）');
assert(!/cb-remove/.test(blocks) && !/\$t\('移除'\)/.test(blocks),
  '卡片表面没有「移除」按钮（收纳/删除统一走「编辑首页 → 添加组件」）');
assert(/@tap\.stop="onEditImage"/.test(blocks), '换图按钮点击不冒泡（不触发卡片动作）');
assert(/\$emit\('image'/.test(blocks), '换图事件抛给页面（组件不碰系统相册）');
assert(/:editable="!editing"/.test(home), '页面把编辑态取反传给 editable（编辑态遮罩挡住卡片内部）');
assert(!/removable/.test(home) && !/@remove=/.test(home), '页面不再传 removable / 不再接 remove 事件');
assert(/@image="onCardImage"/.test(home), '页面接了 image 事件');
const cardImg = home.match(/onCardImage\(e\)\s*\{[\s\S]*?\n    \},/);
assert(!!cardImg, '存在 onCardImage');
assert(!!cardImg && /chooseImage/.test(cardImg[0]), '走系统选图');
assert(!!cardImg && /op: 'image\.set'/.test(cardImg[0]), '选完图走 image.set 指令（进历史栈可撤销）');
assert(!!cardImg && /pageCommand\.commit/.test(cardImg[0]), '落盘走 pageCommand.commit（与指令链路同源）');

console.log('== 4. 空输入：keyword 跟着清（× 收得掉），但不动模式/焦点 ==');
// 顶栏的清除键是 v-if="search && value"，value 就是 keyword。
// 空值分支以前只清结果不更新 keyword → 用户把字全删了 × 还杵在那儿，点了还会收键盘。
// 但绝不能顺手把 modeLocked / inputFocused 也清了：那正是语音输入那个 bug 的来源
// （输入法在语音中间态先发一个空 value 的 input 事件，清了就收键盘 + 解锁成搜索）。
// 先看**代码**再看注释：这段分支里写了「不碰 modeLocked / inputFocused」的说明，
// 注释里出现这两个词不代表代码碰了它们 —— 扫契约前先把 // 与 /* */ 注释剥掉。
const emptyRaw = (onInput[0].match(/if \(!kw\) \{[\s\S]*?\n      \}/) || [''])[0];
const emptyBr = emptyRaw.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
assert(!!emptyBr && /this\.keyword = ''/.test(emptyBr), '空值分支同步清空 keyword');
assert(!/modeLocked/.test(emptyBr), '空值分支不动 modeLocked');
assert(!/inputFocused/.test(emptyBr), '空值分支不动 inputFocused');
assert(!/blurInput/.test(emptyBr), '空值分支不调 blurInput（不收键盘）');
assert(!/clearSearch/.test(emptyBr), '空值分支不调 clearSearch');

console.log('== 5. 指令应用：用发给模型的那份 doc（不是 await 之后新读的） ==');
// plan 是模型看着 base 的 docDigest 做出来的（「删掉第 2 张卡片」里的 2 指的是 base 里的第 2 张）。
// await 期间首页可能被 home:refresh 换过 doc，这时重新读一份再应用 → 序号对到别的卡上，删错卡片。
const rc = home.match(/async runCommand\(text\) \{[\s\S]*?\n    \},/);
assert(!!rc, '定位到 runCommand');
assert(!!rc && /const base = this\.doc \|\| pageDoc\.get\(\)/.test(rc[0]), '先快照 base');
assert(!!rc && /await pageAgent\.plan\(input, base/.test(rc[0]), 'plan 用 base');
assert(!!rc && /applyCommands\(base, r\.commands/.test(rc[0]), 'applyCommands 也用 base（模型看到的那份）');
assert(!!rc && !/applyCommands\(this\.doc \|\| pageDoc\.get\(\)/.test(rc[0]), '不再在 await 之后重新读 doc');
// 上一条没跑完时再回车：不能静默 return（用户会以为"按了没反应"），
// 也不能禁用输入框（:disabled 会抢焦点收键盘）—— 给一句提示。
assert(!!rc && /if \(this\.cmdRunning\) \{/.test(rc[0]), '执行中再回车有独立分支');
assert(!!rc && /showToast/.test(rc[0]), '执行中给提示（不是静默吞掉）');
// 只看模板：脚本注释里提到 :disabled 不算数（这条规则针对的是模板里的 input 元素）
const tplOnly = home.slice(0, home.indexOf('\n</template>'));
assert(!/:disabled/.test(tplOnly), '首页模板里没有 :disabled（输入框禁用会抢焦点收键盘）');

console.log('');
console.log(fail === 0 ? 'ALL PASS (check-home-cmd)' : fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1)
