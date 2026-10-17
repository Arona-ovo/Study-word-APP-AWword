// _tools/check-haptic.js - 触感反馈（震动）
//
// 2026-10-16 用户要求："从下往上滑的时候加点动效，或者可以加个震动。
// 点击底部菜单栏也可以有震动，设置里面也可以调整。"
//
// 落在三处：底部菜单栏点击、首页抽屉拉到位、设置 › 触感反馈（总开关 + 强度 + 试一下）。
// 实现在 utils/haptic.js，开关存 settings.haptic（默认 开 + mid）。
//
// ⚠️ 一条平台硬事实：Android 的震动要 android.permission.VIBRATE。
//    它是安装时权限（不用运行时弹框），但**写在 manifest 里 → 必须重新打包 / 重打基座**，
//    老基座没这个权限时 plus.device.vibrate 会抛 SecurityException。
//    所以模块里所有原生调用都 try/catch + console.warn，并把失败原因留在 lastError()
//    —— 设置页据此提示"多半要重新打包"，而不是谎报"这台设备不支持震动"。
//
// 断言分三层：源码契约（剥注释后扫）+ 行为（plus / uni 桩）+ 错误形态（抛异常 / 没 API 都不炸）。
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', 'uniapp', rel), 'utf8').replace(/\r\n/g, '\n');
// 剥两种注释再扫：注释里提到 plus.device.vibrate 也会被正则扫到（假绿 / 假红）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const hap = R('utils/haptic.js');
const code = strip(hap);

console.log('== 1. utils/haptic.js 源码契约 ==');
assert(/export function isEnabled/.test(code), '导出 isEnabled（总开关）');
assert(/export function tick/.test(code), '导出 tick（震一下）');
assert(/export function level/.test(code) && /export function setLevel/.test(code), '导出 level / setLevel（强度）');
assert(/export function setOn/.test(code), '导出 setOn（开关落盘）');
assert(/export function lastError/.test(code) && /export function hasApi/.test(code),
  '导出 lastError / hasApi（设置页据此提示"没震成"的原因）');
// 开关是一切的前提：关掉必须一次都不震，连 API 都不碰
assert(/if \(!isEnabled\(\)\) return false/.test(code), '总开关关掉直接返回（不碰任何原生 API）');
// 连点保护：滑一次抽屉 onPageScroll 能来几十次，不挡就是一窝蜂；
// 而且 Android 上连续 vibrate() 会把短震叠成长震，手感全毁。
assert(/MIN_GAP/.test(code) && /now - lastAt < MIN_GAP/.test(code), '有连点保护（MIN_GAP 之内直接丢掉）');
assert(/lastAt = now/.test(code), '占位在调用之前（就算这次没震成也不该在窗口里重试）');
// 平台能力先验再调：App 走 plus.device.vibrate（能给毫秒），其余退 uni.vibrateShort
assert(/plus\.device && typeof plus\.device\.vibrate === 'function'/.test(code),
  'App 端先判 plus.device.vibrate 存在再调（拿不到就退 uni.vibrateShort）');
assert(/uni\.vibrateShort/.test(code), '非 App / 没有 plus 时退 uni.vibrateShort');
assert(/typeof uni !== 'undefined' && typeof uni\.vibrateShort === 'function'/.test(code),
  '退路也先验能力（没有就安静返回 false）');
// 硬规矩 37：原生调用的 catch 不许完全静默
assert(/catch \(e\)/.test(code) && /console\.warn\(/.test(code), '原生调用失败要 console.warn（真机"没震动"得有线索）');
// 强度三档 + 场景倍率
assert(/light: 12/.test(code) && /mid: 22/.test(code) && /strong: 34/.test(code),
  '三档强度 12 / 22 / 34 ms（再长就不是反馈而是骚扰）');
assert(/drawer: 1\.15/.test(code), '抽屉到位比点击稍重（一次滑动只响一声）');
// 脏值回落：存档被写坏也不能变成"永远不震"或"震个不停"
assert(/LEVEL_MS\[l\] \? l : 'mid'/.test(code), '强度脏值回落 mid');
assert(/ms < 8 \? 8 : ms/.test(code), '算出来的时长有下限（不许算出 0ms）');

console.log('== 2. 设置默认值与权限声明 ==');
const st = R('utils/settings.js');
assert(/haptic: \{ on: true, level: 'mid' \}/.test(st),
  'settings 默认值带 haptic = { on: true, level: "mid" }（深合并，老用户自动拿到）');
// 权限只声明在 manifest（打包时生效），settings 里不重复
const mf = R('manifest.json');
assert(/android\.permission\.VIBRATE/.test(mf),
  'manifest.json 声明 android.permission.VIBRATE（没有它 Android 上根本震不动）');

console.log('== 3. 接入点 ==');
const ftb = R('components/float-tabbar/float-tabbar.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/utils\/haptic\.js'/.test(ftb),
  '底部菜单栏引入 haptic');
{
  const i = ftb.indexOf('go(e) {');
  const body = i > 0 ? ftb.slice(i, ftb.indexOf('\n    },', i)) : '';
  assert(/haptic\.tick\('tap'\)/.test(body), '点底栏震一下（tap 档）');
  // 位置：必须在"点当前 tab 直接 return"之后、切页动画之前 —— 反馈要立刻给到
  const iRet = body.indexOf('return;');
  const iTick = body.indexOf("haptic.tick('tap')");
  assert(iRet >= 0 && iTick > iRet, '震动在"重复点击已拦掉"之后（点当前页不该震）');
  assert(/catch/.test(body), '震动包了 catch（震不动也要把页切了）');
}
const home = R('pages/home/home.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/utils\/haptic\.js'/.test(home), '首页引入 haptic');
assert(/haptic\.tick\('drawer'\)/.test(strip(home)), '抽屉拉到位震一下（drawer 档）');
// ⚠️ 只断言"出现过 _drawerBuzzed 这个字段名"是不够的：把守卫 `if (!this._drawerBuzzed)`
//    改成 `if (true)` 之后，字段依然在赋值语句里出现 → 断言照过，而抽屉会每帧震一次
//    （2026-10-17 变异测试抓到）。必须钉住**那条判断本身**。
assert(/if \(!this\._drawerBuzzed\) \{/.test(strip(home)),
  '震之前先判"这一滑还没震过"（没有这道守卫，onPageScroll 每来一次就震一次）');
{
  const i = strip(home).indexOf('syncReveal(scrollTop) {');
  const body = i > 0 ? strip(home).slice(i, strip(home).indexOf('\n    },', i)) : '';
  const iFire = body.indexOf("haptic.tick('drawer')");
  const iReset = body.indexOf('_drawerBuzzed = false');
  assert(iFire > 0 && iReset > iFire, '先震、再把"已震"标记复位放在回落分支里（不会每帧都震）');
  assert(/if \(!this\._drawerBuzzed\) \{/.test(body),
    '守卫就在 syncReveal 里（不是在别处判断的）');
}
const set = R('pkgManage/pages/settings/settings.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/\.\.\/utils\/haptic\.js'/.test(set), '设置页引入 haptic');
assert(/data-k="haptic"/.test(set) && /openSec === 'haptic'/.test(set), '设置页有「触感反馈」分组');
assert(/@change="e => setHaptic\('on', e\.detail\.value\)"/.test(set), '设置页有总开关');
assert(/setHaptic\('level', 'light'\)/.test(set) && /setHaptic\('level', 'strong'\)/.test(set),
  '设置页能调强度（轻 / 中 / 强）');
assert(/@tap="previewHaptic"/.test(set), '设置页有「试一下」');
assert(/hapticFail/.test(set), '没震成时设置页有提示（多半是包里没打震动权限）');

console.log('== 4. 行为：开关 / 强度 / 连点 / 降级 ==');
const mem = {};
const vibes = [];      // plus.device.vibrate 收到的毫秒数
const shorts = [];     // uni.vibrateShort 收到的档位
let throwNext = false;
let warnCount = 0;

const plusStub = {
  device: {
    vibrate: (ms) => {
      if (throwNext) throw new Error('android.permission.VIBRATE denied');
      vibes.push(ms);
    }
  }
};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 24, theme: 'light' }),
  vibrateShort: (o) => { shorts.push(o && o.type); }
};
const realWarn = console.warn;
console.warn = (...a) => { warnCount++; };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const settings = load('utils/settings.js');
  settings.init();
  const haptic = load('utils/haptic.js', { settings, plus: plusStub });

  assert(haptic.isEnabled() === true, '默认开着');
  assert(haptic.level() === 'mid', '默认强度 = mid');

  vibes.length = 0;
  const r1 = haptic.tick('tap');
  assert(r1 === true && vibes.length === 1, '开着 → 真的震了（返回 true，vibrate 被调用一次）');
  assert(vibes[0] === 22, 'mid + tap → 22ms（实际 ' + vibes[0] + '）');

  // 连点：连着两次调用，第二次必须被挡掉（不是"隔一会儿再调"——那是正常应该震的）
  await sleep(90);
  vibes.length = 0;
  const r2a = haptic.tick('tap');
  const r2b = haptic.tick('tap');
  assert(r2a === true && r2b === false && vibes.length === 1,
    '连点被 MIN_GAP 挡掉（只震了 ' + vibes.length + ' 次，不叠成长震）');

  await sleep(90);
  vibes.length = 0;
  haptic.tick('drawer');
  assert(vibes[0] === Math.round(22 * 1.15), '抽屉档比点击重（' + vibes[0] + 'ms = 22 × 1.15）');

  await sleep(90);
  haptic.setLevel('strong');
  vibes.length = 0;
  haptic.tick('tap');
  assert(vibes[0] === 34, '强度切到 strong → 34ms（实际 ' + vibes[0] + '）');
  await sleep(90);
  haptic.setLevel('bogus');
  assert(haptic.level() === 'mid', '强度写脏值回落 mid');

  // ---- 错误形态 1：关掉开关 ----
  await sleep(90);
  haptic.setOn(false);
  vibes.length = 0;
  const rOff = haptic.tick('tap');
  assert(rOff === false && vibes.length === 0, '开关关掉 → 一次都不震');
  // ⚠️ 光测"关掉后没调用"不够：崩了也是没调用。所以下面必须看到"打开后又震了"
  haptic.setOn(true);
  await sleep(90);
  vibes.length = 0;
  assert(haptic.tick('tap') === true && vibes.length === 1, '重新打开 → 又震了（证明上面不是崩了）');

  // ---- 错误形态 2：原生抛异常（老基座没 VIBRATE 权限就是这个）----
  await sleep(90);
  throwNext = true;
  vibes.length = 0;
  warnCount = 0;
  const rThrow = haptic.tick('tap');
  throwNext = false;
  assert(rThrow === false, '原生抛异常 → 返回 false，不把异常抛给调用方');
  assert(warnCount === 1, '原生失败要 console.warn 一条（真机控制台得有线索）');
  assert(!!haptic.lastError(), '失败原因留在 lastError（设置页据此提示需重新打包）');

  // ---- 错误形态 3：没有 plus，退 uni.vibrateShort ----
  await sleep(90);
  const noPlus = load('utils/haptic.js', { settings, plus: {} });
  shorts.length = 0;
  const rShort = noPlus.tick('tap');
  assert(rShort === true && shorts.length === 1, '没有 plus.device 时退 uni.vibrateShort');
  assert(shorts[0] === 'medium', '22ms 映射到 medium 档（实际 ' + shorts[0] + '）');

  // ---- 错误形态 4：什么都没有 → 安静 false，不炸 ----
  await sleep(90);
  const none = load('utils/haptic.js', {
    settings,
    plus: undefined,
    uni: { getStorageSync: () => undefined }
  });
  let threw = false;
  let rNone = null;
  try { rNone = none.tick('tap') } catch (e) { threw = true }
  assert(!threw && rNone === false, '两端都没有震动 API → 安静返回 false，不抛异常');
  assert(none.lastError() === 'no-api', '没有 API 时 lastError = no-api');
  assert(none.hasApi() === false, 'hasApi 如实回答"调不动"');

  console.warn = realWarn;
  console.log(fail === 0 ? '\n触感反馈全部通过' : '\n失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
