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
// ⚠️ 网络监听必须**在自检之外**单独挂（2026-10-14 补）：
//    autoCheck 开头就是 12 小时节流，节流窗口内它直接 return —— 要是只靠它顺手挂
//    watchWifi，那"回家连上 WiFi 自动把包下好"在最常见的场景里一次都不会发生。
assert(/updater\.watchNetwork\(\)/.test(app), 'App.vue 挂了网络变化监听（一有网就静默补下）');
const autoBlock = /setTimeout\(\(\) => \{ updater\.autoCheck\(\) \}, \d+\)/.exec(app);
assert(autoBlock && autoBlock[0].indexOf('watchNetwork') < 0,
  '网络监听不在 autoCheck 那个 setTimeout 里（不能靠会被节流挡掉的自检顺手挂）');
const sv = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/settings/settings.vue'), 'utf8');
assert(/\$t\('检查更新'\)/.test(sv), '设置页有「检查更新」入口');
assert(/\$t\('GitHub 上的最新版'\)/.test(sv), '设置页有「GitHub 上的最新版」入口');
assert(/@tap="checkUpdate"/.test(sv) && /@tap="openRelease"/.test(sv), '两行都接了点击');
assert(/\{\{ updateDesc \}\}/.test(sv) && /\{\{ updateBtn \}\}/.test(sv),
  '两行的文案走 computed（模板里不写表达式，项目约定 9）');
assert(/updater\.install\(/.test(sv) && /updater\.openReleasePage\(\)/.test(sv), '装包与打开发布页都接到 updater');
assert(/updater\.stagedPath\(\)/.test(sv), '设置页会看包是不是已经预下载好了（决定按钮写「安装」还是「去下载」）');
assert(/skipThis\(\)/.test(sv), '用户点「以后再说」会记一笔（这个版本不再重复提示）');
const en = fs.readFileSync(path.join(ROOT, 'utils/i18n-en.js'), 'utf8');
for (const k of ['检查更新', 'GitHub 上的最新版', '有新版本 {v}', '发现新版本 {v}', '已经是最新版',
  '不再提示', '更新', '还在后台下载，下好后点一下就装完', '更新包没下完整，正在重新下载']) {
  assert(en.indexOf("'" + k + "'") >= 0, '英文表有「' + k + '」');
}
// 包没下好 / 没网时点了更新，两个入口都得说人话 —— 否则就是"点了没反应"
assert(/offline/.test(sv), '设置页认得 offline（没网要给提示，不能静默失败）');
assert(/t\('现在没网，连上网再试'\)/.test(sv), '设置页给的是人话提示（不是错误码）');

// ---------- 第 2b 组：红点 + 首页弹窗的接入点 ----------
console.log('== 2b. 红点与更新弹窗 ==');
const hm = fs.readFileSync(path.join(ROOT, 'pages/home/home.vue'), 'utf8');
const pf = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.vue'), 'utf8');
assert(/updater\.hasPending\(\)/.test(pf), '「我的」页读 hasPending() 决定红点');
assert(/class="menu-dot"/.test(pf) && /v-if="updateDot"/.test(pf), '「设置」那行有红点元素');
assert(/\.menu-dot \{/.test(pf), '红点有样式（不然是个不显示的空 view）');
assert(/onShow[\s\S]{0,300}updateDot = updater\.hasPending\(\)/.test(pf), '切回「我的」会重读红点状态');
assert(/utils\/updater\.js/.test(hm), '首页引入了 updater');
// ⚠️ 别再用"onShow 之后 N 个字符内出现"这种距离窗口：onShow 只是多写了几行就会超窗口
// → 契约还在、断言却假红（2026-10-16 首页 onShow 加了 4 行就撞上）。直接抠函数体。
const iShow = hm.indexOf('\n  onShow() {');
const iShowEnd = iShow > 0 ? hm.indexOf('\n  },', iShow) : -1;
const showBody = iShow > 0 && iShowEnd > iShow ? hm.slice(iShow, iShowEnd) : '';
assert(showBody.length > 0, '能抠出首页 onShow 的函数体');
assert(/maybeUpdateAsk\(\)/.test(showBody), '首页 onShow 会问一次');
assert(/if \(updateAsked\) return/.test(hm), '本次进程只弹一次（切 tab 回来不重复骚扰）');
assert(/guide\.show \|\| this\.partnerAsk\.show/.test(hm), '引导 / 关联询问在场时不抢弹窗');
assert(/@confirm="onUpdateConfirm"/.test(hm) && /@cancel="onUpdateCancel"/.test(hm), '弹窗两个按钮都接了');
assert(/:confirm-text="\$t\('更新'\)"/.test(hm) && /:cancel-text="\$t\('不再提示'\)"/.test(hm),
  '两个按钮的文案是「更新」/「不再提示」');
assert(/onUpdateCancel[\s\S]{0,200}skipThis\(\)/.test(hm), '「不再提示」真的记了一笔 skip');
// ⚠️ 窗口 600 → 1200：方法里补了「整包没预下载好就交给浏览器」这段说明后，
// onUpdateConfirm 到 updater.install( 的字符距离变长了，600 卡不住。
// 放宽是让契约跟得上代码，**不是绕过** —— 仍然要求这两处落在同一段里（不在就红）。
assert(/onUpdateConfirm[\s\S]{0,1200}updater\.install\(/.test(hm), '点「更新」真的去装包（不是只关弹窗）');
assert(/info\.staged/.test(hm), '首页看得到包是不是已经下好了（下好了就不用再等下载）');
assert(/offline/.test(hm), '首页认得 offline（没网要给提示，不能静默失败）');
assert(/t\('更新包没下完整，正在重新下载'\)/.test(hm), '首页给的是人话提示（不是错误码）');
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
let netTypeStub = 'wifi';           // 网络类型桩：'wifi' / '4g' / 'unknown'
let netCb = null;                   // onNetworkStatusChange 的回调
const savedFiles = [];              // 调过 saveFile 的临时路径
const removedFiles = [];            // 调过 removeSavedFile 的路径
let dlCount = 0;                    // 发起过几次下载（盯"重复下载"这条规矩）
// 完整性校验靠 plus.io 读文件，所以得给它一套桩：
//   statSize  = 报出来的"文件真实大小"（0 = 文件不在了）
//   tailMode  = 'ok' 尾部有 zip 结尾标记 / 'truncated' 没有（截断包）/ 'none' 读不到内容
let statSize = 1234;
let savedGone = false;   // 模拟"已经存好的持久文件被系统清掉了"（只影响 /saved/ 下的路径，
                         // 临时文件照常 —— 否则连新下载下来的包都读不到，测不出重下）
let tailMode = 'ok';
const EOCD = '\x50\x4B\x05\x06';
const ioStub = {
  resolveLocalFileSystemURL: (p, ok, err) => {
    const isSaved = String(p).indexOf('/saved/') === 0;
    if ((isSaved && savedGone) || !statSize) { if (err) err(new Error('nofile')); return; }
    ok({
      file: (ok2) => ok2({ size: statSize, slice: () => ({ __slice: 1 }) })
    });
  },
  FileReader: function () {
    const self = this;
    this.onloadend = null;
    this.onerror = null;
    this.readAsText = function () {
      setTimeout(() => {
        const t = tailMode === 'ok' ? ('zzzz' + EOCD)
          : (tailMode === 'truncated' ? 'zzzzPK\x03\x04半截' : '');
        if (self.onloadend) self.onloadend({ target: { result: t } });
      }, 0);
    };
  }
};
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
    dlCount++;
    if (o && o.success) o.success({ statusCode: 200, tempFilePath: '/tmp/a.wgt' });
    return { onProgressUpdate: () => {} };
  },
  getNetworkType: (o) => {
    if (netTypeStub === 'unknown') { if (o && o.fail) o.fail(new Error('n/a')); return; }
    if (o && o.success) o.success({ networkType: netTypeStub });
  },
  saveFile: (o) => {
    savedFiles.push(o && o.tempFilePath);
    if (o && o.success) o.success({ savedFilePath: '/saved/pkg' });
  },
  removeSavedFile: (o) => { removedFiles.push(o && o.filePath); },
  onNetworkStatusChange: (cb) => { netCb = cb; },
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

  // ③b Release 会攒旧包（传了新的没删旧的），而 API 按上传顺序返回 —— 第一个常常是最旧的。
  //     拿第一个跟本机比，1.4.1 的用户就永远停在"已是最新"，新传上去的包根本发不出去
  //     （2026-10-15 真踩：1.4.3 传上去了，1.4.1 的 App 死活检测不到）。
  handler = () => ({
    assets: [
      { name: 'AWword-' + SAME + '.wgt', browser_download_url: 'http://x/' + SAME + '.wgt' },
      { name: 'AWword-' + NEWER + '.wgt', browser_download_url: 'http://x/' + NEWER + '.wgt' }
    ]
  });
  r = await up.check();
  eq(r.kind, 'wgt', '旧 wgt 排在新 wgt 前面 → 仍挑到新包（旧包不许挡路）');
  eq((r.version || []).join('.'), NEWER, '挑中的是新包的版本号（不是第一个）');

  // ③c 比本机还旧的整包也不许抢戏（两段式老包 AWword-1.4.apk 会把热更拦死）
  const OLD2 = [LV[0], LV[1]].join('.');
  handler = () => ({
    assets: [
      { name: 'AWword-' + OLD2 + '.apk', browser_download_url: 'http://x/' + OLD2 + '.apk' },
      { name: 'AWword-' + NEWER + '.wgt', browser_download_url: 'http://x/' + NEWER + '.wgt' }
    ]
  });
  r = await up.check();
  eq(r.kind, 'wgt', '比本机旧的 apk 不抢戏（老整包不该拦住热更）');

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
    io: ioStub,
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

  // ---------- 第 6 组：静默下载 + 校准（APK 与 WGT 共用同一套） ----------
  //
  // 这一组盯四类事故，而且**它们全都不报错**：
  //   · 同一个包被重复下载（启动自检 + 网络回调 + 设置页各触发一次 → 下三遍）
  //   · 残缺包被当成"已就绪"（大小不对 / 被截断，用户一点就装崩）
  //   · 换版本后拿旧包当新版装
  //   · 进程被杀后状态卡在 downloading，从此再也不下载
  console.log('');
  console.log('== 6. 静默下载与校准 ==');

  // 前面几组可能留了 skip / pending，先清干净，别让上一组的状态糊到这一组
  try { settingsMod.set({ updater: { skip: '', pending: '', dl: '' } }); } catch (e) {}
  statSize = 1234; tailMode = 'ok';
  const P6 = 'http://x/' + NEWER + '.wgt';
  const A6 = 'http://x/' + NEWER + '.apk';
  /** 造一个"已经发现新版本"的状态（version / kind / url / size 都齐） */
  const newPending = (kind, url, size) => {
    const m = mount({ plus: fakePlus });
    m.dropDl();
    try { settingsMod.set({ updater: { skip: '' } }); } catch (e) {}
    m.noteUpdate({ version: m.parseVersion(NEWER), kind: kind, url: url, size: size || 0 });
    return m;
  };

  // ① 能下好并落盘（存的是持久路径 —— 临时路径重启就没了，等于白下）
  netTypeStub = 'wifi';
  savedFiles.length = 0;
  const m6 = newPending('wgt', P6);
  eq(m6.stagedPath(), '', '还没下过 → 没有本地包');
  eq(await m6.ensure(), 'ok', '把包静默下好了（WGT）');
  eq(m6.stagedPath(), '/saved/pkg', '存的是持久路径（不是重启就丢的临时路径）');
  assert(savedFiles.length > 0, '真的落盘了（不是只在内存里记一笔）');
  assert(m6.pendingInfo() && m6.pendingInfo().ready === true, 'pendingInfo 会告诉 UI「已经就绪」');

  // ② 已经下好 → 直接复用，一个字节都不重下（这是每次启动都会走的高频路径）
  dlCount = 0;
  eq(await m6.ensure(), 'ready', '这个版本已经下好 → 复用，不重新下载');
  eq(dlCount, 0, '复用时一次下载请求都没发');

  // ③ 移动数据也下 —— 静默下载不分网络，用户永远不该"等下载"
  netTypeStub = '4g';
  dlCount = 0;
  const m6c = newPending('wgt', P6);
  eq(await m6c.ensure(), 'ok', '移动数据下照样静默下载（不分网络）');
  eq(dlCount, 1, '移动数据下真的发起下载了');

  // ③b 整包走的是同一套（APK 与 WGT 共用，不各写一遍）
  netTypeStub = '4g';
  dlCount = 0;
  const m6a = newPending('apk', A6);
  eq(await m6a.ensure(), 'ok', '整包走同一套静默下载（APK 与 WGT 共用）');
  eq(dlCount, 1, '整包也只下一次');

  // ③c 真没网 → 这次不动（不白重试）
  netTypeStub = 'none';
  dlCount = 0;
  eq(await newPending('wgt', P6).ensure(), 'offline', '确认没网 → 这次不下');
  eq(dlCount, 0, '没网时一个请求都没发');
  netTypeStub = 'wifi';

  // ④ 单一实例：同一个包正在下 → 后续触发复用同一个任务，绝不重复下载
  dlCount = 0;
  const m6s = newPending('wgt', P6);
  const t1 = m6s.ensure();
  const t2 = m6s.ensure();
  const t3 = m6s.ensure();
  eq(await t1, 'ok', '第一次触发真的去下了');
  eq(await t2, 'running', '第二次触发 → 复用正在跑的任务');
  eq(await t3, 'running', '第三次触发 → 同样复用');
  eq(dlCount, 1, '三次触发只对应一次下载（没有重复下载）');

  // ⑤ 完整性校验 · 大小对不上 → 判坏包，绝不当"已就绪"
  statSize = 1234;
  const m6size = newPending('wgt', P6, 9999);   // 远端说 9999，落下来的却是 1234
  eq(await m6size.ensure(), 'bad', '大小对不上 → 判为坏包');
  eq(m6size.stagedPath(), '', '坏包不算"已就绪" → 红点不会亮');

  // ⑤b 完整性校验 · 结构残缺（尾部没有 zip 结尾标记）→ 同样判坏包
  tailMode = 'truncated';
  const m6zip = newPending('wgt', P6);
  eq(await m6zip.ensure(), 'bad', '没有 zip 结尾标记 → 判为截断包');
  eq(m6zip.stagedPath(), '', '截断包不算"已就绪" → 红点不会亮');
  tailMode = 'ok';

  // ⑤c 读不到文件内容（H5 / 小程序没有 plus.io）→ 按通过放行
  //    不能因为读不了文件就永远不给更新 —— 那时"文件存在 + 大小对得上"已能挡掉大半残缺包
  tailMode = 'none';
  eq(await newPending('wgt', P6).ensure(), 'ok', '读不到文件内容 → 按通过放行（不能因此永远不给更新）');
  tailMode = 'ok';

  // ⑤d 下好之后文件被系统清掉 → 再校准时发现"不在了"，要重新下而不是拿个空路径凑数
  const m6gone = newPending('wgt', P6);
  eq(await m6gone.ensure(), 'ok', '先下好一版');
  savedGone = true;             // 只让 /saved/ 下的持久文件消失，临时文件照常能读
  dlCount = 0;
  eq(await m6gone.ensure(), 'ok', '文件被系统清掉 → 重新下（不是拿空路径凑数）');
  eq(dlCount, 1, '确实重新发起了一次下载');
  savedGone = false;

  // ⑥ 装本地包：不再联网，wgt 装完要重启 + 把包删掉
  netTypeStub = 'wifi';
  const m6e = newPending('wgt', P6);
  await m6e.ensure();
  const mp6 = mount({ plus: fakePlus });
  downloaded = null; restarted = false; removedFiles.length = 0;
  eq(await mp6.install(), true, '装已经下好的本地包');
  eq(downloaded, null, '已经下好了 → 装的时候不再联网下载');
  assert(restarted, 'wgt 装完重启（不重启不生效）');
  assert(removedFiles.length > 0, '装完把存下来的包删了（不能一直占着用户存储）');
  eq(mp6.stagedPath(), '', '记账也一起清了（只清记账会留下一坨没人认的文件）');

  // ⑦ 整包：装的时候**不能**重启（系统安装器要接手），文件也**不能**删（安装器还在读）
  const m6f = newPending('apk', A6);
  await m6f.ensure();
  const mp6f = mount({ plus: fakePlus });
  restarted = false; removedFiles.length = 0;
  eq(await mp6f.install(), true, '装已经下好的整包');
  eq(restarted, false, '整包不重启（系统安装器接手，这时候重启是捣乱）');
  eq(removedFiles.length, 0, '整包文件不能删 —— 安装器还在读它，删了就装一半');

  // ⑧ 换了版本 → 上一版留下的包不算数（拿旧包当新版装是最阴的一类 bug）
  netTypeStub = 'wifi';
  const m6g = newPending('wgt', P6);
  await m6g.ensure();
  assert(!!m6g.stagedPath(), '先下好一版');
  m6g.noteUpdate({ version: m6g.parseVersion(FAR), kind: 'wgt', url: 'http://x/' + FAR + '.wgt' });
  eq(m6g.stagedPath(), '', '换了版本 → 旧包的路径不再算数（不能拿旧包当新版装）');

  // ⑧b 上面那条靠的是 noteUpdate 顺手清掉旧包。但清不掉的情况是存在的（进程被杀、
  //     换了版本却没走 check），所以 stagedPath 自己还得再挡一道 —— 不能只靠上游打扫。
  netTypeStub = 'wifi';
  const m6k = newPending('wgt', P6);
  await m6k.ensure();
  assert(!!m6k.stagedPath(), '先下好一版（准备手工把记账改坏）');
  try {
    settingsMod.set({
      updater: { dl: JSON.stringify({ v: '9.9.9', kind: 'wgt', state: 'done', path: '/saved/pkg', at: Date.now() }) }
    });
  } catch (e) {}
  eq(m6k.stagedPath(), '', '记账里的版本号与待更新对不上 → 这个路径不算数（stagedPath 自己也要挡）');

  // ⑨ 进程被杀：状态卡在 downloading → 下次进来重新校准，不能从此再也不下载
  netTypeStub = 'wifi';
  const m6dead = newPending('wgt', P6);
  try {
    settingsMod.set({
      updater: { dl: JSON.stringify({ v: NEWER, kind: 'wgt', state: 'downloading', at: Date.now() - 10 * 60 * 1000 }) }
    });
  } catch (e) {}
  eq(m6dead.stagedPath(), '', '卡在 downloading 时不算已就绪（否则会拿个不存在的包去装）');
  dlCount = 0;
  eq(await m6dead.ensure(), 'ok', '卡死状态 → 重新校准并下载（不会从此再也不下）');
  eq(dlCount, 1, '校准时确实发起了一次下载');

  // ⑩ 下不到包 → 明确报错，绝不把没验过的东西交给安装器
  netTypeStub = 'none';           // 没网 + 没有本地包
  statSize = 1234;
  const m6bad = newPending('wgt', P6);
  let e6bad = '';
  try { await m6bad.install(); } catch (e) { e6bad = String((e && e.message) || e); }
  eq(e6bad, 'offline', '没网且没本地包 → 明确报 offline（不静默装个不存在的包）');

  // ⑩b 本地包装不上 → 自动退回在线装一次（不能把用户卡在"更新中"）
  netTypeStub = 'wifi';
  // 只让"本地路径"装失败，临时路径照常成功 —— 模拟文件被系统清掉那一类情况
  const flakyPlus = {
    io: ioStub,
    runtime: {
      install: (p, o, okCb, errCb) => {
        if (String(p).indexOf('/saved/') === 0) { if (errCb) errCb(new Error('boom')); return; }
        installed = p;
        if (okCb) okCb();
      },
      restart: () => { restarted = true; }
    }
  };
  const m6i = newPending('wgt', P6);
  await m6i.ensure();
  downloaded = null; restarted = false;
  // ⚠️ 一定要 try/catch 包住：不包的话"没有退回"会以未捕获 rejection 的形式把整个
  //    脚本崩掉 —— 那样看着也是失败，但报的是堆栈不是断言，坏了不好定位。
  let ok10 = false;
  let e10 = '';
  try { ok10 = await mount({ plus: flakyPlus }).install(); } catch (e) { e10 = String((e && e.message) || e); }
  eq(ok10 && !e10, true, '本地包装不上 → 自动退回在线装，最后还是装上了（' + (e10 || 'ok') + '）');
  assert(!!downloaded, '退回时真的去下载了（' + downloaded + '）');

  // ⑪ 网络变化监听：一有网就补下（WiFi / 移动数据都算），已下好后怎么变都不重下
  netTypeStub = '4g';
  dlCount = 0;
  const m6j = newPending('wgt', P6);
  m6j.watchNetwork();
  for (let i = 0; i < 5 && !m6j.stagedPath(); i++) await new Promise((r) => setTimeout(r, 0));
  eq(m6j.stagedPath(), '/saved/pkg', '移动数据下挂监听 → 同样当场补下（不分网络）');
  eq(dlCount, 1, '挂上那次只下了一次');
  assert(typeof netCb === 'function', '注册了网络变化监听');
  dlCount = 0;
  netCb({ isConnected: false, networkType: 'none' });
  netCb({ isConnected: true, networkType: '4g' });
  netCb({ isConnected: true, networkType: 'wifi' });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  eq(dlCount, 0, '已经下好了 → 网络怎么变都不重复下载');

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
  let installs = [];
  let opened = 0;
  let stagedSpy = '';                 // 假装"有没有预下载好"
  const updaterSpy = Object.assign({}, realUp, {
    skipThis: () => { skips++; },
    stagedPath: () => stagedSpy,
    // doUpdate 走的是统一入口 install()：有预下载好的包就装本地，没有才在线下
    install: () => { installs.push('install'); return Promise.resolve(true); },
    installWgt: (u) => { installs.push('wgt:' + u); return Promise.resolve(true); },
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
  deps.BUILD_INFO = { version: '1.4.5', versionCode: 145 };
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
    updateReady: false,
    updatePending: null
  }, Comp.methods);

  const wgtRel = { kind: 'wgt', version: up.parseVersion(NEWER), url: 'http://x/' + NEWER + '.wgt' };
  st.askUpdate(wgtRel);
  eq(st.confirm.show, true, '弹的是统一弹窗（confirm.show）');
  eq(st.confirm.action, 'update', '弹窗派发标记 = update');
  eq(st.confirm.title, '发现新版本 {v}', '标题带上版本号');
  eq(st.confirm.content, '正在后台下载，下好后一点就装完，不动你的学习数据',
    'wgt 没下好时如实说"正在后台下载"，也说清不动学习数据（不许谎报"正在下载"让人干等）');
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

  // 包还没下好 → **不许**去装。下载是静默的，把用户按在这儿干等是最差体验，
  // 而且没验过的包根本不该交给安装器。这条最容易被写成"点了就立刻下载"。
  installs = [];
  toasts.length = 0;
  st.updateReady = false;
  st.askUpdate(wgtRel);
  st.onConfirmYes(true);
  eq(installs.length, 0, '包还没下好 → 不调安装（不能拿个没验过的包去装）');
  assert(toasts.indexOf('还在后台下载，下好后点一下就装完') >= 0,
    '没下好 → 如实说"还在后台下载"（不谎报成"正在下载"）');

  // 已经下好 → 走统一安装入口，按钮与文案都换成"装"那一套
  stagedSpy = '/saved/pkg';
  st.updateReady = true;
  st.askUpdate(wgtRel);
  eq(st.confirm.confirmText, '立即安装', '包已经下好了 → 按钮写「立即安装」');
  eq(st.confirm.content, '已经下载好了，点一下就装完，不动你的学习数据', '文案也说清不用再下载了');
  toasts.length = 0;
  installs = [];
  st.onConfirmYes(true);
  eq(installs.length, 1, '已下载好时点「立即安装」→ 走安装');
  eq(installs[0], 'install', '走的是统一安装入口（它会自己决定装本地包还是现下）');
  assert(toasts.indexOf('正在安装…') >= 0, '已下载好 → 提示"正在安装"（不是"正在下载"）');
  stagedSpy = '';
  st.updateReady = false;

  // apk → 不去装，改走"打开发布页让用户自己下整包"
  const apkRel = { kind: 'apk', version: up.parseVersion(FAR), url: 'http://x/' + FAR + '.apk' };
  st.askUpdate(apkRel);
  eq(st.confirm.content, '正在后台下载完整安装包，下好后一点就装完', 'apk 没下好时如实说"正在后台下载完整安装包"');
  eq(st.confirm.confirmText, '去下载', 'apk 的确认键 = 去下载');
  installs = [];
  st.onConfirmYes(true);
  eq(opened, 1, 'apk 点确认 → 打开发布页（App 内不静默装整包）');
  eq(installs.length, 0, 'apk 没预下载好 → 不走安装通道');

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
  const u6 = mount({ settings: set6, plus: fakePlus });
  eq(u6.hasPending(), false, '一开始没有红点');

  handler = () => ({ assets: [{ name: 'AWword-' + NEWER + '.wgt', browser_download_url: 'http://x/' + NEWER + '.wgt', size: 1234 }] });
  await u6.check();
  // ⚠️ 本轮最核心的一条规矩：查到新版本**不等于**有红点。
  //    包没下好 / 校验没过就亮红点，等于把用户引向一次注定失败的点击 ——
  //    "红点亮了，点进去还要等十几秒甚至装不上"，比没有红点更糟。
  eq(u6.hasPending(), false, '刚查到新版本、包还没下好 → 不亮红点（下载中一律静默）');

  netTypeStub = 'wifi'; statSize = 1234; tailMode = 'ok';
  eq(await u6.ensure(), 'ok', '后台把包静默下好');
  eq(u6.hasPending(), true, '包下好且校验通过 → 红点亮起');
  const info6 = u6.pendingInfo();
  eq(info6 && info6.versionText, NEWER, '弹窗拿得到版本号');
  eq(info6 && info6.kind, 'wgt', '弹窗拿得到类型（决定正文走哪条文案）');
  eq(info6 && info6.url, 'http://x/' + NEWER + '.wgt', '弹窗拿得到下载直链（点「更新」要能用）');

  // 红点必须扛得住 App 重启：换一个模块实例（模拟冷启动）再读，还在
  const u6b = mount({ settings: set6, plus: fakePlus });
  eq(u6b.hasPending(), true, 'App 重启后红点还在（落在 storage，不是内存变量）');

  // 「不再提示」
  u6.skipThis();
  eq(u6.hasPending(), false, '点「不再提示」→ 红点消失');

  // ⚠️ skip 存的是**那一个版本号**，不是一句"永远别提醒我"。
  // 所以必须验：又发了更新的版本时红点要重新亮。
  // 这条最容易悄悄坏掉 —— 坏了不报错、不崩，只是用户从此再也收不到更新提示，
  // 等他自己发现已经是好几个版本之后了。
  eq(String(((set6.get() || {}).updater || {}).skip || ''), NEWER,
    '「不再提示」记的是那个版本号（不是永久静音开关）');
  u6.noteUpdate({ version: u6.parseVersion(FAR), kind: 'wgt', url: 'http://x/new' });
  // 换版本后旧包作废，得重新下好才亮 —— 这正是不拿旧包充数的表现
  eq(u6.hasPending(), false, '刚换版本、新包还没下好 → 还是不亮红点');
  await u6.ensure();
  eq(u6.hasPending(), true, '又发了更新的版本且下好了 → 红点重新亮（skip 只压得住那一个版本号）');

  // 装完新版本（本机版本号升上去）→ 红点自己消失，不需要任何手动清理。
  // 先清掉上一步的 skip：不然"不再提示"仍然生效，这里就验不到"装完自动消失"了。
  set6.set({ updater: { skip: '' } });
  u6.noteUpdate({ version: u6.parseVersion(NEWER), kind: 'wgt', url: 'http://x' });
  await u6.ensure();
  eq(u6.hasPending(), true, '（重新记一笔并下好，准备验"装完自动消失"）');
  const u6c = mount({ settings: set6, plus: fakePlus, BUILD_INFO: { version: FAR + '.9', versionCode: 999 } });
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
