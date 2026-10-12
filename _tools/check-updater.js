// _tools/check-updater.js - 在线更新校验（GitHub Releases 当版本源）
//
// 断言：
//   1) 源码契约：版本源是那个固定 tag 的 Release；本机版本读 BUILD_INFO.version
//      （不许用 plus.runtime.version —— wgt 更新后它不变，会永远提示有更新）
//   2) 附件约定：*.wgt 热更 / *.apk 整包，版本号从文件名抽；apk 优先于 wgt
//   3) 设置页两行入口（检查更新 / GitHub 上的最新版）+ 文案走 computed（模板不写表达式）
//   4) App.vue 有静默自检（延迟 + 只留结果不弹窗）
//   5) 运行时真跑：无更新 / 有 wgt / 有 apk / 附件没版本号 / 请求失败 /
//      自检节流 / 装包（有 plus 与没 plus）/ 打开发布页的三种结局
const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const PAGE = 'https://github.com/Arona-ovo/Study-word-APP-AWword/releases/tag/AWword-APP';

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const eq = (a, b, m) => (a === b ? ok(m + ' = ' + b) : bad(m + ' 期望 ' + b + '，实际 ' + a));
const assert = (c, m) => (c ? ok(m) : bad(m));

// ---------- 第 1 组：updater.js 源码契约 ----------
console.log('== 1. updater.js 源码契约 ==');
const UP = 'utils/updater.js';
const src = fs.readFileSync(path.join(ROOT, UP), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
assert(/REPO\s*=\s*'Arona-ovo\/Study-word-APP-AWword'/.test(code)
  && /RELEASE_TAG\s*=\s*'AWword-APP'/.test(code)
  && /RELEASE_PAGE\s*=\s*'https:\/\/github\.com\/'\s*\+\s*REPO\s*\+\s*'\/releases\/tag\/'\s*\+\s*RELEASE_TAG/.test(code),
  '发布页地址是用户给的那个固定 tag（拼接成 github.com/Arona-ovo/Study-word-APP-AWword/releases/tag/AWword-APP）');
assert(/releases\/tags\//.test(code), '版本接口按 tag 取那一个 Release（换附件即可，不用改 App 里的地址）');
assert(!/plus\.runtime\.version/.test(code),
  '本机版本不用 plus.runtime.version（wgt 装完它不变 → 会永远提示有更新）');
assert(/BUILD_INFO\.version/.test(code) || /BUILD_INFO/.test(code), '本机版本读 BUILD_INFO（前端资源版本）');
assert(/\\\.wgt\$/i.test(code) && /\\\.apk\$/i.test(code), '附件按扩展名认：wgt 热更 / apk 整包');
assert(/browser_download_url/.test(code), '用附件直链下载（GitHub 给的，不用再拼）');
assert(/plus\.runtime\.restart/.test(code), 'wgt 装完必须重启才生效');
for (const fn of ['check', 'autoCheck', 'installWgt', 'openReleasePage', 'peek', 'skipThis']) {
  assert(new RegExp('export (async )?function ' + fn + '\\(').test(code), '导出 ' + fn + '()');
}

// ---------- 第 2 组：settings 里的节流字段 + 启动自检 + 设置页入口 ----------
console.log('== 2. 接入点 ==');
const st = fs.readFileSync(path.join(ROOT, 'utils/settings.js'), 'utf8');
assert(/updater:\s*\{\s*lastCheckAt/.test(st), 'settings 默认值里有 updater.lastCheckAt（自检节流）');
const app = fs.readFileSync(path.join(ROOT, 'App.vue'), 'utf8');
assert(/updater\.autoCheck\(\)/.test(app), 'App.vue 启动后做一次自检');
assert(/setTimeout\(\(\) => \{ updater\.autoCheck\(\) \}, \d+\)/.test(app), '自检是延迟的（不和首屏抢主线程）');
assert(!/updater\.check\(\)/.test(app) || /autoCheck/.test(app), '启动自检走 autoCheck（自带节流与静默）');
const sv = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/settings/settings.vue'), 'utf8');
assert(/\$t\('检查更新'\)/.test(sv), '设置页有「检查更新」入口');
assert(/\$t\('GitHub 上的最新版'\)/.test(sv), '设置页有「GitHub 上的最新版」入口');
assert(/@tap="checkUpdate"/.test(sv) && /@tap="openRelease"/.test(sv), '两行都接了点击');
assert(/\{\{ updateDesc \}\}/.test(sv) && /\{\{ updateBtn \}\}/.test(sv),
  '两行的文案走 computed（模板里不写表达式，项目约定 9）');
assert(/updater\.installWgt\(/.test(sv) && /updater\.openReleasePage\(\)/.test(sv), '装包与打开发布页都接到 updater');
assert(/skipThis\(\)/.test(sv), '用户点「以后再说」会记一笔（这个版本不再重复提示）');
const en = fs.readFileSync(path.join(ROOT, 'utils/i18n-en.js'), 'utf8');
for (const k of ['检查更新', 'GitHub 上的最新版', '有新版本 {v}', '发现新版本 {v}', '已经是最新版',
  '不再提示', '更新']) {
  assert(en.indexOf("'" + k + "'") >= 0, '英文表有「' + k + '」');
}

// ---------- 第 2b 组：红点 + 首页弹窗的接入点 ----------
console.log('== 2b. 红点与更新弹窗 ==');
const hm = fs.readFileSync(path.join(ROOT, 'pages/home/home.vue'), 'utf8');
const pf = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.vue'), 'utf8');
assert(/updater\.hasPending\(\)/.test(pf), '「我的」页读 hasPending() 决定红点');
assert(/class="menu-dot"/.test(pf) && /v-if="updateDot"/.test(pf), '「设置」那行有红点元素');
assert(/\.menu-dot \{/.test(pf), '红点有样式（不然是个不显示的空 view）');
assert(/onShow[\s\S]{0,300}updateDot = updater\.hasPending\(\)/.test(pf), '切回「我的」会重读红点状态');
assert(/utils\/updater\.js/.test(hm), '首页引入了 updater');
assert(/maybeUpdateAsk\(\)/.test(hm) && /onShow[\s\S]{0,900}maybeUpdateAsk\(\)/.test(hm), '首页 onShow 会问一次');
assert(/if \(updateAsked\) return/.test(hm), '本次进程只弹一次（切 tab 回来不重复骚扰）');
assert(/guide\.show \|\| this\.partnerAsk\.show/.test(hm), '引导 / 关联询问在场时不抢弹窗');
assert(/@confirm="onUpdateConfirm"/.test(hm) && /@cancel="onUpdateCancel"/.test(hm), '弹窗两个按钮都接了');
assert(/:confirm-text="\$t\('更新'\)"/.test(hm) && /:cancel-text="\$t\('不再提示'\)"/.test(hm),
  '两个按钮的文案是「更新」/「不再提示」');
assert(/onUpdateCancel[\s\S]{0,200}skipThis\(\)/.test(hm), '「不再提示」真的记了一笔 skip');
assert(/onUpdateConfirm[\s\S]{0,600}installWgt\(/.test(hm), '点「更新」真的去装包（不是只关弹窗）');
// ⚠️ 这三个方法必须在 methods 里。写在 onShow / onHide 旁边是**组件选项顶层**，
// Vue 不会把它挂到实例上 → this.maybeUpdateAsk is not a function（2026-10-13 就这么栽的：
// 生命周期与 methods 是平级的，不是它的子项）。
const hmMethods = (/methods:\s*\{/.exec(hm) || null);
assert(!!hmMethods, '首页有 methods');
const hmFrom = hmMethods ? hmMethods.index : 0;
for (const fn of ['maybeUpdateAsk', 'onUpdateConfirm', 'onUpdateCancel']) {
  assert(new RegExp('\\n {4}' + fn + '\\(').test(hm.slice(hmFrom)),
    fn + ' 定义在 methods 里（不是挂在生命周期旁边）');
}

// ---------- 第 3 组：运行时真跑 ----------
console.log('== 3. 真跑 updater ==');
const mem = {};
let handler = null;       // 返回 release 数据；抛错 = 请求失败
let downloaded = null;
let installed = null;
let restarted = false;
let copied = '';
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  request: (o) => {
    if (!handler) { if (o && o.fail) o.fail(new Error('network')); return; }
    try {
      const data = handler(o && o.url);
      if (o && o.success) o.success({ statusCode: 200, data: data });
    } catch (e) {
      if (o && o.fail) o.fail(e);
    }
  },
  downloadFile: (o) => {
    downloaded = o && o.url;
    if (o && o.success) o.success({ statusCode: 200, tempFilePath: '/tmp/a.wgt' });
  },
  setClipboardData: (o) => { copied = (o && o.data) || ''; }
};

const settingsMod = load('utils/settings.js', {});
settingsMod.init();

function mount(extra) {
  return load(UP, Object.assign({ settings: settingsMod }, extra || {}));
}
const up = mount();

// 版本号解析与比较（边界：位数不等、抽不到）
eq(String(up.parseVersion('AWword-1.2.1.wgt')), '1,2,1', '版本号从文件名抽出来');
eq(up.parseVersion('latest.wgt'), null, '抽不到版本号的附件直接忽略（不拿没版本的东西比大小）');
eq(up.cmpVersion([1, 2, 1], [1, 2]), 1, '1.2.1 > 1.2（位数不等时缺位补 0）');
eq(up.cmpVersion([1, 2], [1, 2]), 0, '1.2 = 1.2');
eq(up.cmpVersion([1, 1, 9], [1, 2]), -1, '1.1.9 < 1.2');
assert(/^\d/.test(up.localVersion()), '本机版本读得到（' + up.localVersion() + '）');

// ⚠️ 下面的 fixture 一律**从本机版本算出来**，不写死 1.2.1 这种字面量 ——
// 否则每次改版本号这些用例都会凭空变红（2026-10-12 改 1.3 时踩到：1.2.1 < 1.3，
// "有更新"的场景直接变成"没更新"）。
const LV = up.parseVersion(up.localVersion()) || [1, 0];
const SAME = LV.join('.');                                  // 等于本机
const NEWER = [LV[0], LV[1], (LV[2] || 0) + 1].join('.');   // 比本机新一点
const FAR = [LV[0], LV[1] + 1].join('.');                   // 次版本 +1
assert(up.cmpVersion(up.parseVersion(NEWER), LV) > 0,
  '测试用的「新版本」确实比本机新（' + NEWER + ' > ' + SAME + '）');

(async () => {
  // ① 已经是最新（远端版本 = 本机）
  handler = () => ({ assets: [{ name: 'AWword-' + SAME + '.wgt', browser_download_url: 'http://x/' + SAME + '.wgt' }] });
  let r = await up.check();
  eq(r.kind, 'none', '远端版本不比本机新 → 没有更新');

  // ② 有热更包
  handler = () => ({ assets: [{ name: 'AWword-' + NEWER + '.wgt', browser_download_url: 'http://x/' + NEWER + '.wgt' }] });
  r = await up.check();
  eq(r.kind, 'wgt', '有更新的 wgt → 热更');
  eq((r.version || []).join('.'), NEWER, '带上它的版本号');

  // ③ 有整包：优先（整包最彻底，也是 wgt 装不上老基座时的兜底）
  handler = () => ({
    assets: [
      { name: 'AWword-' + FAR + '.apk', browser_download_url: 'http://x/' + FAR + '.apk' },
      { name: 'AWword-' + FAR + '.1.wgt', browser_download_url: 'http://x/' + FAR + '.1.wgt' }
    ]
  });
  r = await up.check();
  eq(r.kind, 'apk', '同时有 apk 与 wgt → 优先整包');

  // ④ 附件连版本号都没有 → 不认
  handler = () => ({ assets: [{ name: 'latest.wgt', browser_download_url: 'http://x/latest.wgt' }] });
  r = await up.check();
  eq(r.kind, 'none', '附件没有版本号 → 不拿它当更新');

  // ⑤ 请求失败 → check 抛（由调用方决定静默还是提示，不能假装"已是最新"）
  handler = null;
  let threw = false;
  try { await up.check(); } catch (e) { threw = true; }
  assert(threw, '请求失败 → check 抛错（绝不谎报"已是最新"）');

  // ⑥ 自检节流：刚查过就不再查（也不该发请求）
  handler = () => { throw new Error('不该发请求'); };
  up.noteChecked();
  const r2 = await up.autoCheck();
  eq(r2, null, '刚查过 → 自检直接跳过（不发请求）');
  // 把时间推回节流窗口之外，再查一次就要真发请求了
  try { settingsMod.set({ updater: { lastCheckAt: Date.now() - 24 * 3600 * 1000 } }); } catch (e) {}
  handler = () => ({ assets: [{ name: 'AWword-9.9.wgt', browser_download_url: 'http://x/9.9.wgt' }] });
  const r3 = await up.autoCheck();
  assert(r3 && r3.kind === 'wgt', '过了节流窗口 → 自检真的去查了');
  assert(up.peek() && up.peek().kind === 'wgt', '结果留在 peek() 里（设置页 onShow 读它显示角标）');

  // ⑦ 装包：没 plus（H5 / 小程序）→ 明确说装不了，不能卡在"更新中"
  const noPlus = mount();
  let e1 = '';
  try { await noPlus.installWgt('http://x/1.wgt'); } catch (e) { e1 = String((e && e.message) || e); }
  eq(e1, 'not-app', '非 App 端装 wgt → 明确失败（调用方好给"去手动下载"的出路）');

  // ⑧ 装包：有 plus → 下载 → install → 重启
  const fakePlus = {
    runtime: {
      install: (p, o, okCb, errCb) => { installed = p; if (okCb) okCb(); },
      restart: () => { restarted = true; }
    }
  };
  const withPlus = mount({ plus: fakePlus });
  downloaded = null; restarted = false;
  const done = await withPlus.installWgt('http://x/' + NEWER + '.wgt');
  eq(done, true, 'App 端装 wgt 成功');
  eq(downloaded, 'http://x/' + NEWER + '.wgt', '下载的是那条直链');
  assert(!!installed, '调了 plus.runtime.install');
  assert(restarted, '装完重启（wgt 不重启不生效）');

  // ⑨ 打开发布页：三种结局都要有
  const noWin = mount();
  const r9 = noWin.openReleasePage();
  assert(r9 === 'copied' || r9 === 'failed', '打不开外链时至少有复制链接这条出路（' + r9 + '）');
  eq(copied, PAGE, '复制的是发布页地址');
  const withPlusOpen = mount({ plus: { runtime: { openURL: (u) => { copied = 'opened:' + u; } } } });
  eq(withPlusOpen.openReleasePage(), 'opened', 'App 端用系统浏览器打开发布页');
  eq(copied, 'opened:' + PAGE, '打开的地址正确');

  // ---------- 第 4 组：真跑设置页的「更新弹窗派发」 ----------
  // 光看静态契约会留下一个大口子：askUpdate 到底开没开弹窗、「确定」有没有真的去装包、
  // 「以后再说」到底记没记 skip —— 这三件事只有把 methods 跑起来才知道。
  // （项目吃过亏：光验"关掉后没调用"会被"崩了也是没调用"骗过去，见 MEMORY 硬约束 15）
  console.log('');
  console.log('== 4. 真跑设置页的更新弹窗 ==');

  const toasts = [];
  let sysModal = 0;
  const uniStub = {
    showToast: (o) => { toasts.push(o && o.title); },
    showModal: () => { sysModal++; },
    setClipboardData: () => {},
    navigateTo: () => {}
  };
  // load() 把 uni 注入沙箱；settings.js 是真模块（updater 要用它的 updater.skip）
  const settingsForUp = load('utils/settings.js', { uni: uniStub });
  const realUp = load('utils/updater.js', { uni: uniStub, settings: settingsForUp });
  let skips = 0;
  const installs = [];
  let opened = 0;
  const updaterSpy = Object.assign({}, realUp, {
    skipThis: () => { skips++; },
    installWgt: (u) => { installs.push(u); return Promise.resolve(true); },
    openReleasePage: () => { opened++; return 'opened'; }
  });

  // 设置页 import 了四十来个标识符，这里按 import 语句自动生成桩：
  // 只把真正要观测的那几个换成真的，其余给一个「怎么调都不炸」的 Proxy。
  // 新增 import 时不用回来补名单 —— 漏掉的也自动有桩，不会假红。
  const svSrc = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/settings/settings.vue'), 'utf8');
  const svScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(svSrc) || [])[1] || '';
  const deps = { uni: uniStub };
  const IMPORT_RE = /^[ \t]*import\s+([^;]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm;
  let im;
  while ((im = IMPORT_RE.exec(svScript))) {
    const clause = im[1].trim();
    const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    if (ns) {
      deps[ns[1]] = new Proxy({}, { get: () => (() => ({})) });
      continue;
    }
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (named) {
      named[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
        const p = s.split(/\s+as\s+/);
        deps[(p[1] || p[0]).trim()] = () => ({});
      });
      continue;
    }
    const def = /^([A-Za-z_$][\w$]*)$/.exec(clause);
    if (def) deps[def[1]] = () => ({});
  }
  // 观测点换成真的
  deps.updater = updaterSpy;
  deps.settings = settingsForUp;
  deps.t = (k) => String(k);   // 译文函数：直接回 key，断言文案选了哪条
  deps.BUILD_INFO = { version: '1.3 Beta', versionCode: 131 };
  deps.FloatNavbar = { name: 'FloatNavbar' };
  deps.AppDialog = { name: 'AppDialog' };

  const Comp = loadCode(svScript, deps, 'settings.vue').default;
  assert(Comp && Comp.methods, '设置页脚本能整体起得来（methods 拿到了）');
  assert(Comp.methods.askUpdate && Comp.methods.onConfirmNo && Comp.methods.onConfirmYes,
    '有 askUpdate / onConfirmNo / onConfirmYes 三个派发方法');

  // 只挂需要的那几个字段 —— data() 里还有几十个字段依赖别的模块，这里不碰
  const st = Object.assign({
    confirm: { show: false, seq: 0 },
    updateState: 'idle',
    updateVer: '',
    updateKind: '',
    updatePending: null
  }, Comp.methods);

  const wgtRel = { kind: 'wgt', version: up.parseVersion(NEWER), url: 'http://x/' + NEWER + '.wgt' };
  st.askUpdate(wgtRel);
  eq(st.confirm.show, true, '弹的是统一弹窗（confirm.show）');
  eq(st.confirm.action, 'update', '弹窗派发标记 = update');
  eq(st.confirm.title, '发现新版本 {v}', '标题带上版本号');
  eq(st.confirm.content, '下载后自动安装并重启，不动你的学习数据', 'wgt 的文案讲清"不动学习数据"');
  eq(st.confirm.confirmText, '立即更新', 'wgt 的确认键 = 立即更新');
  eq(st.confirm.cancelText, '以后再说', '取消键 = 以后再说（不是"取消"，语义不同）');
  eq(st.confirm.danger, false, '更新不是危险操作（不用红色 danger 样式）');
  eq(st.updatePending, wgtRel, '这一版的 Release 挂在 updatePending 上');

  eq(sysModal, 0, '整条链路没碰系统弹窗（页面层统一走 app-dialog）');

  // 取消 → 记一笔 skip（下次启动的自检不再问这个版本）
  st.onConfirmNo();
  eq(skips, 1, '点「以后再说」→ 记一笔 skip');
  eq(st.confirm.show, false, '弹窗关掉');

  // 别的弹窗取消不该误记 skip
  st.confirm = Object.assign(st.blankConfirm(), { show: true, action: 'clear' });
  st.onConfirmNo();
  eq(skips, 1, '别的弹窗点取消 → 不记 skip（只有更新弹窗的取消是"以后再说"）');

  // 确定 → 真的去装 wgt
  st.askUpdate(wgtRel);
  st.onConfirmYes(true);
  eq(installs.length, 1, '点「立即更新」→ 调了安装');
  eq(installs[0], wgtRel.url, '装的是这一版的直链');
  eq(skips, 1, '走安装路径时不记 skip');

  // apk → 不去装，改走"打开发布页让用户自己下整包"
  const apkRel = { kind: 'apk', version: up.parseVersion(FAR), url: 'http://x/' + FAR + '.apk' };
  st.askUpdate(apkRel);
  eq(st.confirm.content, '这次要下载完整安装包', 'apk 的文案换成"完整安装包"');
  eq(st.confirm.confirmText, '去下载', 'apk 的确认键 = 去下载');
  st.onConfirmYes(true);
  eq(opened, 1, 'apk 点确认 → 打开发布页（App 内不静默装整包）');
  eq(installs.length, 1, 'apk 不走 wgt 安装通道');

  // ---------- 第 5 组：真跑红点 / 弹窗的生命周期 ----------
  // 红点最怕两件事：① 该出现时不出现 ② 装完新版本后**永远摘不掉**。
  // 后者尤其恶心（用户更新完还天天看见红点），必须有一条断言盯着。
  console.log('');
  console.log('== 5. 真跑红点生命周期 ==');
  const st6 = {};
  const uni6 = {
    getStorageSync: (k) => (k in st6 ? st6[k] : ''),
    setStorageSync: (k, v) => { st6[k] = v; },
    removeStorageSync: (k) => { delete st6[k]; },
    showToast: () => {},
    downloadFile: () => {}
  };
  const set6 = load('utils/settings.js', { uni: uni6 });
  // 用 mount() 而不是直接 load：uni.request 走的是全局 stub（handler 那一套），
  // 自己传 uni 会把 request 顶掉 → check() 直接 TypeError
  const u6 = mount({ settings: set6 });
  eq(u6.hasPending(), false, '一开始没有红点');

  handler = () => ({ assets: [{ name: 'AWword-' + NEWER + '.wgt', browser_download_url: 'http://x/' + NEWER + '.wgt' }] });
  await u6.check();
  eq(u6.hasPending(), true, '查到新版本 → 有红点');
  const info6 = u6.pendingInfo();
  eq(info6 && info6.versionText, NEWER, '弹窗拿得到版本号');
  eq(info6 && info6.kind, 'wgt', '弹窗拿得到类型（决定正文走哪条文案）');
  eq(info6 && info6.url, 'http://x/' + NEWER + '.wgt', '弹窗拿得到下载直链（点「更新」要能用）');

  // 红点必须扛得住 App 重启：换一个模块实例（模拟冷启动）再读，还在
  const u6b = mount({ settings: set6 });
  eq(u6b.hasPending(), true, 'App 重启后红点还在（落在 storage，不是内存变量）');

  // 「不再提示」
  u6.skipThis();
  eq(u6.hasPending(), false, '点「不再提示」→ 红点消失');

  // 装完新版本（本机版本号升上去）→ 红点自己消失，不需要任何手动清理。
  // 先清掉上一步的 skip：不然"不再提示"仍然生效，这里就验不到"装完自动消失"了。
  set6.set({ updater: { skip: '' } });
  u6.noteUpdate({ version: u6.parseVersion(NEWER), kind: 'wgt', url: 'http://x' });
  eq(u6.hasPending(), true, '（重新记一笔，准备验"装完自动消失"）');
  const u6c = mount({ settings: set6, BUILD_INFO: { version: FAR + '.9', versionCode: 999 } });
  eq(u6c.hasPending(), false, '装完新版本 → 红点自己消失（版本号不再比本机新）');

  // 坏数据不许把红点逻辑搞崩
  set6.set({ updater: { pending: '{ 这不是 json' } });
  eq(u6.hasPending(), false, '坏 JSON → 当没有红点（不抛、不误报）');
  set6.set({ updater: { pending: '{"kind":"wgt"}' } });     // 缺版本号
  eq(u6.hasPending(), false, '没有版本号的标记 → 当没有红点');

  console.log('');
  console.log(fail === 0 ? '在线更新全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
