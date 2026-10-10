// _tools/check-backup.js - 一键导出 / 导入（换手机迁移）校验（只读，不改源码）
// 运行：node _tools/check-backup.js
//
// 覆盖：
//   1) 收集范围：该搬的搬、AI 缓存不该搬、meta 统计准确
//   2) 信封：整包密文、meta 明文可预览、每次换盐换 nonce
//   3) standard 档往返一致、密钥能还原
//   4) password 档：迭代更高、不给密码 / 错密码都被挡下
//   5) 拒绝形态：篡改 / 缺字段 / 版本更新 / 空 / 非备份 —— 一个都不能写进 storage
//   6) peek 不解密就能看摘要
//   7) restore 真的落盘且带进度回调
//   8) 文件名带日期、可排序
//   9) backup-io 跨端契约（源码级）
//  10) 设置页接线（源码级）
//  11) 设置页运行时（真跑方法，不是只看字符串）
//  12) backupHint 必须是 computed（写在 methods 里会被渲染成函数源码）
//
// 为什么要有第 11 组：只看源码字符串会"假绿" —— 方法名写了但弹窗没弹出来、
// 覆盖确认没走、密码错了却直接覆盖，肉眼读代码全都发现不了。

const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function is(cond, m, extra) {
  cond ? ok(m + (extra === undefined ? '' : ' = ' + extra)) : bad(m + (extra === undefined ? '' : ' = ' + extra));
}
function eq(a, b, label) {
  if (JSON.stringify(a) === JSON.stringify(b)) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function errOf(fn) {
  try { fn(); return ''; } catch (e) { return String((e && e.message) || ''); }
}

/* ------------------------------------------------------------------ 0. 环境 */

const mem = {};
let toasts = [];
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => { toasts.push(String((o && o.title) || '')); },
  showModal: () => {},
  showActionSheet: () => {},
  getSystemInfoSync: () => ({ platform: 'android', uniPlatform: 'app' }),
  setClipboardData: (o) => { (o && o.success) && o.success(); },
  getClipboardData: (o) => { (o && o.success) && o.success({ data: '' }); }
};

const SECRET = 'sk-live-THIS-IS-A-SECRET-KEY-9999';
const CN = '中文 ✨ emoji 🎉 混排';

function seedStorage() {
  Object.keys(mem).forEach(k => { delete mem[k]; });
  mem['fj_eng_state_v1'] = {
    currentBook: 'fj_zsb_core',
    books: {
      fj_zsb_core: {
        mastery: {
          1: { m: 3 },
          2: { m: 1, due: '2026-10-11', st: 0 },
          3: { m: 5, due: '2026-10-12', st: 1 },
          4: { m: 0 }
        }
      }
    },
    wrong: [1, 2, 3, 4],
    days: {
      '2026-09-01': { total: 1 },
      '2026-10-01': { total: 2 },
      '2026-10-09': { total: 3 }
    },
    userBooks: [{ id: 'custom_x', name: CN }],
    customWords: { custom_x: [{ w: 'a' }, { w: 'b' }, { w: 'c' }] }
  };
  mem['fj_app_settings_v1'] = {
    locale: 'zh',
    profile: { nickname: 'arona' },
    ai: { baseURL: 'https://api.example.com/v1', apiKey: SECRET },
    backup: {}
  };
  mem['fj_chat_v1'] = { sessions: [{ id: 's1', msgs: [{ role: 'user', content: 'hi' }] }] };
  mem['fj_usage_v1'] = { days: { '2026-10-09': { calls: 3 } } };
  mem['fj_api_usage_v1'] = { total: 12 };
  // AI 缓存：故意放一份，用来证明它不会被搬走
  mem['fj_ai_cache_v1'] = { k1: { at: 1, text: 'cached' } };
}

(async function main() {
  const hash = await import('file:///' + path.join(ROOT, 'utils/hash.ts').replace(/\\/g, '/'));
  const rnd = await import('file:///' + path.join(ROOT, 'utils/random.ts').replace(/\\/g, '/'));
  const b = load('utils/backup.js', {
    hmacSha256: hash.hmacSha256,
    utf8Bytes: hash.utf8Bytes,
    randomBytes: rnd.randomBytes
  });

  /* ================================================================ 1. 收集 */
  console.log('\n== 1. 收集范围 ==');
  seedStorage();
  const c = b.collect();
  const keys = Object.keys(c.parts);
  is(keys.indexOf('fj_eng_state_v1') >= 0, '搬了学习数据（fj_eng_state_v1）');
  is(keys.indexOf('fj_app_settings_v1') >= 0, '搬了设置（含 AI 密钥）');
  is(keys.indexOf('fj_chat_v1') >= 0, '搬了对话陪练记录');
  is(keys.indexOf('fj_ai_cache_v1') < 0, 'AI 缓存不搬（有 7 天 TTL，搬过去只是把文件撑大）');
  eq(c.meta.words, 4, 'meta.words = 掌握度词条数');
  eq(c.meta.due, 2, 'meta.due = 已排进巩固队列的词数');
  eq(c.meta.wrong, 4, 'meta.wrong = 错题数');
  eq(c.meta.dayCount, 3, 'meta.dayCount = 有记录的天数');
  eq(c.meta.from, '2026-09-01', 'meta.from = 最早一天');
  eq(c.meta.to, '2026-10-09', 'meta.to = 最近一天');
  eq(c.meta.userBooks, 1, 'meta.userBooks = 自建词书数');
  eq(c.meta.customWords, 3, 'meta.customWords = 导入词数');
  eq(c.meta.hasSettings, true, 'meta.hasSettings');
  eq(c.meta.hasChat, true, 'meta.hasChat');
  eq(c.meta.nickname, 'arona', 'meta.nickname（换手机后对着名字能认出是不是自己的备份）');
  is(JSON.stringify(c.parts).indexOf(SECRET) > 0, '明文收集阶段确实含密钥（后面要被加密掉）');

  /* ================================================================ 2. 信封 */
  console.log('\n== 2. 信封：密文 / 明文摘要 / 每次都换盐 ==');
  const text = b.encode(c, '');
  const env = JSON.parse(text);
  is(text.indexOf(SECRET) < 0, '密文里搜不到明文密钥');
  is(text.indexOf('api.example.com') < 0, '连 API 地址也搜不到（地址同样属于隐私）');
  eq(env.app, 'awword', '信封打了应用标记（导入时能认出是不是自己的备份）');
  eq(env.enc, 'standard', '默认档 = standard');
  is(!!env.meta, 'meta 是明文（导入前要给人看）');
  eq(env.meta.words, 4, '明文 meta 里能直接读到词数');
  is(JSON.stringify(env.meta).indexOf(SECRET) < 0, '明文 meta 里没有密钥');
  is(env.salt !== env.nonce, 'salt 与 nonce 不同');
  const env2 = JSON.parse(b.encode(c, ''));
  is(env2.salt !== env.salt, '两次导出的 salt 不同（密钥流不会重复）');
  is(env2.nonce !== env.nonce, '两次导出的 nonce 不同');
  is(env2.data !== env.data, '两次导出得到的文本不同（不能靠对比文件判断有没有变化）');
  eq(env.mac.length, 64, 'mac 是十六进制 = 64 字符');
  eq(env.iter, 10000, 'standard 档迭代 10000（口令就在包里，慢没有意义）');

  /* ======================================================== 3. standard 往返 */
  console.log('\n== 3. standard 档往返 ==');
  const d = b.decode(text, '');
  is(JSON.stringify(d.parts) === JSON.stringify(c.parts), '解出来的数据与收集时完全一致');
  eq(d.enc, 'standard', '解出来标记的加密档位');
  eq(((d.parts['fj_app_settings_v1'] || {}).ai || {}).apiKey, SECRET, '密钥原样还原（换手机后不用重新填）');
  eq(((d.parts['fj_eng_state_v1'] || {}).userBooks || [])[0].name, CN, '中文 + emoji 往返不被弄坏');

  /* ======================================================== 4. password 档 */
  console.log('\n== 4. password 档 ==');
  const PWD = 'mypassword';
  const pText = b.encode(c, PWD);
  const pEnv = JSON.parse(pText);
  eq(pEnv.enc, 'password', '给了密码 → password 档');
  is(pEnv.iter > env.iter, '密码档迭代次数更高（要扛离线暴力） = ' + pEnv.iter + ' > ' + env.iter);
  const pd = b.decode(pText, PWD);
  is(JSON.stringify(pd.parts) === JSON.stringify(c.parts), '正确密码 → 解开且数据一致');
  eq(errOf(() => b.decode(pText, '')), 'NEED_PASSWORD', '不给密码 → 报「要密码」而不是「文件坏了」');
  eq(errOf(() => b.decode(pText, 'nope')), 'BAD_PASSWORD', '错密码 → BAD_PASSWORD');
  eq(errOf(() => b.decode(pText, PWD + ' ')), 'BAD_PASSWORD', '密码多一个空格也不算对');
  eq(errOf(() => b.decode(pText, 'awword-local-backup-v1')), 'BAD_PASSWORD', '内置口令解不开密码档');

  /* ======================================================== 5. 拒绝形态 */
  console.log('\n== 5. 拒绝形态（坏文件必须被挡下，不能写进 storage） ==');
  const tamperCipher = JSON.parse(JSON.stringify(env));
  tamperCipher.data = tamperCipher.data.slice(0, -4) + 'AAAA';
  eq(errOf(() => b.decode(JSON.stringify(tamperCipher), '')), 'TAMPERED', '改密文 → TAMPERED');
  const tamperMac = JSON.parse(JSON.stringify(env));
  tamperMac.mac = 'f'.repeat(64);
  eq(errOf(() => b.decode(JSON.stringify(tamperMac), '')), 'TAMPERED', '改 MAC → TAMPERED');
  const missing = JSON.parse(JSON.stringify(env));
  delete missing.nonce;
  eq(errOf(() => b.decode(JSON.stringify(missing), '')), 'BROKEN', '信封字段缺失 → BROKEN');
  const newer = JSON.parse(JSON.stringify(env));
  newer.v = 99;
  eq(errOf(() => b.decode(JSON.stringify(newer), '')), 'NEWER_VERSION', '版本比本应用新 → NEWER_VERSION');
  eq(errOf(() => b.decode('', '')), 'EMPTY', '空内容 → EMPTY');
  eq(errOf(() => b.decode('not json at all', '')), 'NOT_BACKUP', '不是 JSON → NOT_BACKUP');
  eq(errOf(() => b.decode(JSON.stringify({ app: 'other', v: 1 }), '')), 'NOT_BACKUP', '别的应用的文件 → NOT_BACKUP');

  /* ======================================================== 6. peek */
  console.log('\n== 6. 导入前预览（peek） ==');
  const pk = b.peek(text);
  eq(pk.meta.words, 4, '不解密也能读到词数');
  eq(pk.enc, 'standard', '能看出是哪一档（决定要不要先问密码）');
  is(JSON.stringify(pk.meta).indexOf(SECRET) < 0, '预览里没有密钥');
  is(!('parts' in pk), '预览不返回数据本体（没有解密）');
  eq(b.peek('garbage'), null, '不是备份 → 返回 null（不出异常，调用方好处理）');
  eq(b.peek(pText).enc, 'password', '密码档能被认出来');

  /* ======================================================== 7. restore */
  console.log('\n== 7. restore 落盘 ==');
  Object.keys(mem).forEach(k => { delete mem[k]; });
  const steps = [];
  const r = b.restore(d, (i, n) => steps.push(i + '/' + n));
  is(!!mem['fj_eng_state_v1'], '学习数据写回了 storage');
  is(!!mem['fj_app_settings_v1'], '设置写回了 storage');
  is(!('fj_ai_cache_v1' in mem), 'AI 缓存没被凭空造出来');
  eq(((mem['fj_app_settings_v1'] || {}).ai || {}).apiKey, SECRET, '还原后密钥可用');
  eq(r.failed, [], '没有写入失败的 key');
  eq(r.total, 5, '写入了 5 份数据');
  eq(steps.join(' '), '1/5 2/5 3/5 4/5 5/5', '每一步都回调了进度（界面能显示进度）');

  /* ======================================================== 8. 文件名 */
  console.log('\n== 8. 文件名 ==');
  eq(b.fileName(new Date(2026, 9, 10)), 'awword-backup-2026-10-10.json', '文件名带日期（在下载目录里一眼认得出）');
  is(/^awword-backup-\d{4}-\d{2}-\d{2}\.json$/.test(b.fileName()), '今天导出的文件名同样合规 = ' + b.fileName());
  const list = [
    { name: 'awword-backup-2026-09-01.json' },
    { name: 'awword-backup-2026-10-10.json' },
    { name: 'awword-backup-2026-10-02.json' }
  ].sort((a, x) => (a.name < x.name ? 1 : (a.name > x.name ? -1 : 0)));
  eq(list[0].name, 'awword-backup-2026-10-10.json', '按名倒序 → 最新那份排最前');

  /* ======================================================== 9. backup-io 契约 */
  console.log('\n== 9. backup-io 跨端契约（源码） ==');
  const io = read('utils/backup-io.js');
  is(io.indexOf('io.dcloud.common.util.DCloud_FileProvider') > 0, '首选云打包内置的 FileProvider');
  is(io.indexOf('androidx.core.content.FileProvider') > 0, '有 androidx 兜底（基座版本不同类名可能不一样）');
  is(io.indexOf('FLAG_GRANT_READ_URI_PERMISSION') > 0, '授予了读权限（否则接收方打不开文件）');
  is(io.indexOf('Intent.ACTION_SEND') > 0, '走 ACTION_SEND（系统分享面板 = 附近分享 / 互传 / 微信都在里面）');
  is(io.indexOf('createChooser') > 0, '用 createChooser 弹选择器');
  is(io.indexOf("'_downloads/awword/'") > 0, '优先写公共下载目录（用户在文件管理里找得到）');
  is(io.indexOf('/^awword-backup-.*\\.json$/i') > 0, '扫描按文件名正则过滤（不会把别的文件列进来）');
  is(io.indexOf('setClipboardData') > 0, '有剪贴板降级（小程序端没有文件 API）');
  is(io.indexOf("reason: 'WRITE_FAILED'") > 0, '写失败有明确原因码（调用方能说人话）');
  is(!/\beval\s*\(|new\s+Function/.test(io), '没有 eval / new Function（硬边界）');
  const shareBody = io.slice(io.indexOf('export function shareFile'), io.indexOf('/** 相对路径'));
  is(shareBody.indexOf('getUriForFile') > 0, '分享前先转成 content:// URI');
  // 真 bug 守门：目录不存在时会降级到另一个目录重写，此时 entry.fullPath 已经不是
  // 调用方传进来的 relPath。返回错的那一个 → 分享时按旧路径找不到文件。
  is(/writer\.onwrite\s*=\s*\(\)\s*=>\s*resolve\(relPath\)/.test(io), 'writeViaPlus 返回的是自己实际写入的路径（不是 entry.fullPath）');
  is(/if\s*\(got\)\s*return\s*\{\s*ok:\s*true,\s*path:\s*got/.test(io), 'writeBackup 用实际写入路径（降级时与请求目录不同）');
  is(!/path:\s*rel\b/.test(io), 'writeBackup 不再把自己拼的 rel 当成实际路径');

  /* ======================================================== 10. 设置页接线 */
  console.log('\n== 10. 设置页接线（源码） ==');
  const sv = read('pkgManage/pages/settings/settings.vue');
  const tpl = sv.slice(0, sv.lastIndexOf('</template>'));
  const dataSec = tpl.slice(tpl.indexOf("openSec === 'data'"), tpl.indexOf("openSec === 'data'") + 4000);
  is(/@tap="askExport"/.test(dataSec), '「数据与账号」里有导出入口');
  is(/@tap="askImport"/.test(dataSec), '「数据与账号」里有导入入口');
  const iExport = dataSec.indexOf('@tap="askExport"');
  const iClear = dataSec.indexOf('@tap="clearLearningData"');
  is(iExport > 0 && iClear > iExport, '导出 / 导入排在「清除学习数据」之前（想备份的人不该先看见一排红色）');
  ['askExport', 'askImport', 'doExport', 'doImport', 'previewImport', 'summaryText', 'importErrText']
    // 允许 async 前缀：doExport / doImport / askImport 都是异步方法
    .forEach(n => is(new RegExp('\\n    (?:async\\s+)?' + n + '\\(').test(sv), '定义了 ' + n + '()'));
  is(/backup\.encode\(backup\.collect\(\)/.test(sv), '导出 = 先收集再加密（顺序不能反）');
  is(/backupIO\.writeBackup\(/.test(sv), '导出会写成文件');
  is(/backupIO\.shareFile\(/.test(sv), '导出后调起系统分享（传到另一台手机靠它）');
  is(/copyToClipboard/.test(sv), '写不出文件时退到剪贴板');
  is(/backupIO\.scanBackups\(/.test(sv), '导入先扫本机已有的备份文件');
  is(/backup\.peek\(/.test(sv), '导入前用 peek 读摘要（不解密）');
  is(sv.indexOf("title: t('导入这份备份？')") > 0, '弹二次确认框');
  is(sv.indexOf("t('导入会覆盖本机现有的全部学习数据与设置，不可撤销。')") > 0, '确认框写明"会覆盖且不可撤销"');
  is(sv.indexOf("confirmText: t('覆盖导入')") > 0, '确认按钮写「覆盖导入」而不是「确定」');
  is(/backup\.decode\(this\.pendingImport/.test(sv), '确认后才真正解密');
  is(/backup\.restore\(/.test(sv), '解密后写回本机');
  is(/password: true/.test(sv), '密码输入是掩码的');
  is(/code === 'BAD_PASSWORD' \|\| code === 'NEED_PASSWORD'/.test(sv), '密码错了会再给一次机会');
  ['NEED_PASSWORD', 'BAD_PASSWORD', 'TAMPERED', 'NEWER_VERSION', 'NOT_BACKUP', 'EMPTY']
    .forEach(code => is(sv.indexOf("code === '" + code + "'") > 0, '错误码 ' + code + ' 翻成了人话'));
  is(/settings\.set\(\{ backup:/.test(sv), '记录了上次备份时间');
  is(/\{\{ backupHint \}\}/.test(tpl), '页面上显示备份提示');
  is(/backup:\s*\{[^}]*lastAt/.test(read('utils/settings.js')), '存档里有 backup 字段（关掉页面再进还认得）');

  /* ======================================================== 11. 运行时 */
  console.log('\n== 11. 设置页运行时（真跑方法） ==');
  const scr = sv.slice(sv.indexOf('<script>') + '<script>'.length, sv.lastIndexOf('</script>'));

  const noop = () => {};
  const settingsMod = load('utils/settings.js');
  const EN = load('utils/i18n-en.js');
  const i18n = load('utils/i18n.js', { settings: settingsMod, EN: EN.default || EN });
  const tt = i18n.t;

  // 假 IO：不碰 plus，直接把"写成功 / 分享成功"回报出来
  const fakeIO = {
    platform: () => 'app',
    fileCapable: () => true,
    writeBackup: async () => ({ ok: true, path: '_downloads/awword/x.json', dir: '_downloads/awword/' }),
    shareFile: async () => true,
    copyToClipboard: async () => true,
    readClipboard: async () => '',
    scanBackups: async () => [],
    readFile: async () => '',
    toAbsolutePath: (p) => '/sdcard/' + p
  };

  const deps = {
    t: tt,
    LOCALES: [{ key: 'zh', name: '中文' }, { key: 'en', name: 'English' }],
    currentLocale: () => 'zh',
    setLocale: noop,
    settings: settingsMod,
    store: { reset: noop },
    voiceStop: noop, voiceStatus: () => ({}), resetVoice: noop,
    validateKeyFormat: () => true, testAIConnection: async () => ({ ok: true }),
    PROVIDER_PRESETS: [], providerSupportsTTS: () => false, TTS_MODELS: [],
    IMAGE_MODELS: [], supportsImage: () => false,
    AI_FEATURES: [], featureMap: () => ({}), setFeature: noop, setAllAiFeatures: noop, offCount: () => 0,
    resetBreaker: noop,
    aiCache: { stats: () => ({ count: 0, size: 0 }) },
    apiUsage: { brief: () => '' },
    onboarding: { list: () => [], done: noop, reset: noop },
    aiSpeak: noop,
    sfx: { play: noop },
    backup: b,
    backupIO: fakeIO,
    BUILD_INFO: { version: '1.1 Beta', versionCode: 111 },
    BACKGROUNDS: {}, ACCENTS: {}, SWATCHES: [], CUSTOM_KEY: 'custom', DEFAULT_CUSTOM: {},
    currentBg: () => 'sky', setBackground: noop, backgroundOf: () => ({}),
    currentAccent: () => 'blue', setAccent: noop,
    currentBgImage: () => '', currentMask: () => 0, setMask: noop, currentBlur: () => 0, setBlur: noop,
    currentCustomColor: () => '', setCustomColor: noop,
    chooseBackgroundImage: async () => '', clearBgImage: noop,
    isDark: () => false, systemPrefersDark: () => false, currentDark: () => false,
    currentFollowSystem: () => true, setDark: noop, setFollowSystem: noop,
    barsSyncColors: () => true, currentSmooth: () => true, setSmooth: noop,
    hexToHsl: () => [0, 0, 0], hslToHex: () => '#000000', darkVariant: (x) => x,
    perf: { summary: () => ({ text: '' }) },
    QUALITY: [], glassText: () => '', motionText: () => '', shadowText: () => '',
    FloatNavbar: {}, AppDialog: {}
  };

  const opts = loadCode(scr, deps, 'settings.vue');
  const page = (opts && opts.default) || opts;
  const vm = Object.assign({}, typeof page.data === 'function' ? page.data() : {});
  Object.assign(vm, page.methods);
  // 这两个与备份无关，但 refresh() 会调，stub 掉以免把断言淹在无关报错里
  vm.loadFx = noop;
  vm.readEngineStatus = noop;

  const comp = page.computed || {};
  is(!!page.methods, '能取到页面选项对象（export default 挂 .default）');

  // --- 导出：点一下就该弹菜单
  toasts = [];
  vm.askExport();
  eq(vm.confirm.mode, 'sheet', '点「导出数据」→ 弹三选一菜单');
  eq((vm.confirm.items || []).length, 3, '菜单 3 项 = quick/pwd/copy');
  eq(vm.confirm.items[0].key, 'quick', '第一项就是一键导出（默认路径最短）');
  eq(vm.confirm.action, 'export-menu', 'action = export-menu');

  // --- 加密码导出：必须弹掩码输入框
  vm.onExportMenu('pwd');
  eq(vm.confirm.mode, 'input', '选加密码导出 → 弹输入框');
  eq(vm.confirm.password, true, '密码输入框是掩码的');
  eq(vm.confirm.action, 'export-pwd', 'action = export-pwd');

  // --- 密码太短要拦下（否则导出的文件"看起来有密码其实很弱"）
  toasts = [];
  vm.confirm = Object.assign({}, vm.blankConfirm(), { action: 'export-pwd', items: [] });
  vm.onConfirmYes('123');
  eq(toasts[toasts.length - 1], tt('密码至少 4 位'), '密码不足 4 位 → 拦下并提示');

  // --- 导入：先给摘要再确认，不能一上来就覆盖
  seedStorage();
  const good = b.encode(b.collect(), '');
  toasts = [];
  vm.previewImport(good);
  eq(vm.confirm.action, 'import-go', '导入前弹确认（不是直接覆盖）');
  eq(vm.confirm.confirmText, tt('覆盖导入'), '按钮写「覆盖导入」');
  is(/[1-9]/.test(vm.confirm.content), '确认文案里有摘要数字');
  is(vm.confirm.content.indexOf(tt('导入会覆盖本机现有的全部学习数据与设置，不可撤销。')) >= 0, '确认文案写明覆盖且不可撤销');
  eq(vm.pendingImport, good, '原文留在 pendingImport（等用户确认）');
  eq(toasts.length, 0, '预览阶段不弹 toast（不打断）');

  // --- 真导入：数据要落盘
  Object.keys(mem).forEach(k => { delete mem[k]; });
  toasts = [];
  await vm.doImport('');
  eq(toasts[toasts.length - 1], tt('导入完成'), '确认后导入完成');
  is(!!mem['fj_eng_state_v1'], '学习数据真的写进了 storage');
  is(!!mem['fj_app_settings_v1'], '设置真的写进了 storage');
  eq(vm.pendingImport, '', '导入完成后清掉待导入原文');

  // --- 密码档：先问密码
  seedStorage();
  const PWD2 = 'pw1234';
  const pwdText = b.encode(b.collect(), PWD2);
  toasts = [];
  vm.previewImport(pwdText);
  eq(vm.confirm.action, 'import-pwd', '密码档 → 先问密码');
  eq(vm.confirm.mode, 'input', '问密码用 input 模式');

  // --- 错密码：人话 + 再给一次机会，而不是静默失败或直接覆盖
  toasts = [];
  await vm.doImport('wrong-pw');
  eq(toasts[toasts.length - 1], tt('密码不对，再试一次'), '错密码 → 人话提示（不是 BAD_PASSWORD）');
  eq(vm.confirm.mode, 'input', '错密码后把密码框弹回来（不用重新选文件）');
  toasts = [];
  Object.keys(mem).forEach(k => { delete mem[k]; });
  await vm.doImport(PWD2);
  eq(toasts[toasts.length - 1], tt('导入完成'), '密码对了就能导入');
  is(!!mem['fj_eng_state_v1'], '密码档备份也真的落盘了');

  // --- 不是备份：人话 + 绝不弹确认框（弹了就等于诱导用户覆盖）
  seedStorage();
  toasts = [];
  vm.confirm = vm.blankConfirm();
  vm.previewImport('{"hello":1}');
  is(toasts.length > 0, '不是备份 → 人话提示');
  eq(vm.confirm.show, false, '不是备份时不弹确认框（不会误覆盖）');

  // --- 被篡改：摘要是明文所以能预览，但确认后必须被 MAC 挡下
  const bad = JSON.parse(good);
  bad.data = bad.data.slice(0, -4) + 'AAAA';
  toasts = [];
  vm.previewImport(JSON.stringify(bad));
  eq(vm.confirm.show, true, '被篡改的文件仍能预览（摘要是明文，这一步正常）');
  Object.keys(mem).forEach(k => { delete mem[k]; });
  toasts = [];
  await vm.doImport('');
  eq(toasts[toasts.length - 1], tt('备份文件被改动过，已拒绝导入'), '点确认 → 解密时被 MAC 挡下');
  eq(Object.keys(mem).length, 0, '（挡下即止，不写半份数据）');

  /* ============================================ 12. backupHint 是 computed */
  console.log('\n== 12. 备份提示是 computed（不是方法） ==');
  is(typeof comp.backupHint === 'function', 'backupHint 定义在 computed 里');
  const vm2 = Object.assign({}, typeof page.data === 'function' ? page.data() : {});
  vm2.lastBackupAt = 0;
  eq(comp.backupHint.call(vm2), tt('未备份'), '从没备份过 → 显示「未备份」');
  vm2.lastBackupAt = new Date(2026, 9, 10, 12, 0, 0).getTime();
  eq(comp.backupHint.call(vm2), tt('上次备份 {s}', { s: '10-10' }), '备份过 → 显示上次备份日期');
  is(!/\n    backupHint\(/.test(sv.slice(sv.indexOf('methods: {'))), 'methods 里没有同名 backupHint（否则模板拿到的是函数源码）');

  console.log('\n' + (fail === 0 ? '备份校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
