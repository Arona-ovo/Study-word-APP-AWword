// _tools/check-partner.js - 「伙伴 App（PWstudy）可选关联」的契约校验（只读，不改源码）
//
// 为什么值得再守一道（和 check-link.js 分工）：
//   check-link.js 钉的是**数据通道**（包名 / scheme / 字段名）——那边坏了同样静默；
//   这个文件钉的是**用户意愿**：可跳过、可关闭、设置页能回来、练习中不打扰、LCancel 不删数据。
// 这一层坏了不会报错、不会崩，只是悄悄把"可选增强"做成"半绑架"，没人会报警。
//
// 分两部分：
//   ① 静态契约（正则匹配源码，和 check-link.js 同一个 strip() 套路）
//   ② 运行时：真跑 utils/partner.js 与 utils/link.js 的状态机，
//      把第 7 节验收清单里能在 Node 里跑出来的几条跑掉（真机 UI 那部分得人去点）。
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const is = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

/**
 * 剥注释后再匹配 —— 说明性注释会被自己的正则命中（本项目第 4 次踩）。
 * ⚠️ 先统一换行符：CRLF 文件上 /^…$/ 与 .* 都够不到行尾（\r 是 JS 正则的行终止符），
 *    剥注释会整条失效 —— 那和"没剥"一样会假绿/假红。
 */
function strip(src) {
  return src
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');
}

const readRaw = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');
const readStrip = (p) => strip(readRaw(p));

const pjs = readStrip('utils/partner.js');
const setSrc = readStrip('utils/settings.js');
const linkSrc = readStrip('utils/link.js');
const home = readStrip('pages/home/home.vue');
const page = readStrip('pkgManage/pages/settings/settings.vue');
const practice = readStrip('pkgStudy/pages/practice/practice.vue');

console.log('\n== 1. 意愿存哪儿、有哪些态 ==');
if (!readRaw('utils/partner.js')) bad('utils/partner.js 不存在');
else ok('utils/partner.js 存在');
is(/partner:\s*\{[^}]*state:\s*'undecided'/.test(setSrc),
  "settings 默认块带 partner.state = 'undecided'（未决定，不是默认就关联）");
['state', 'isLinked', 'installed', 'seen', 'noteSeen', 'practicing', 'shouldAsk', 'markAsked', 'link', 'unlink', 'noteSync', 'syncAgo']
  .forEach((f) => {
    is(new RegExp('export\\s+function\\s+' + f + '\\s*\\(').test(pjs), 'partner.js 导出 ' + f + '()');
  });
is(/pkg:\s*'com\.pwstudy\.app'/.test(pjs), "协议包名 = 'com.pwstudy.app'（与 PWstudy 侧 manifest 一致）");
is(/pkgs:\s*\[[^\]]*'com\.PWstudy'/.test(pjs), "包名是一组、含真机变体 'com.PWstudy'（HBuilderX 里手滑填的那个）");
is(/scheme:\s*'pwstudy'/.test(pjs), "伙伴 scheme = 'pwstudy'");

console.log('\n== 2. 三态流转（取消必须落到 declined） ==');
is(/export\s+function\s+unlink[\s\S]{0,240}state:\s*'declined'/.test(pjs),
  'unlink() 落到 declined（不会下次启动又弹一遍）');
is(/export\s+function\s+link[\s\S]{0,240}state:\s*'linked'/.test(pjs), 'link() 落到 linked');
is(/export\s+function\s+markAsked[\s\S]{0,240}askedCount/.test(pjs), 'markAsked() 累加 askedCount（「以后再说」也要记账）');

console.log('\n== 3. 防骚扰（这条链路最容易被做成骚扰） ==');
is(/ASK_MAX\s*=/.test(pjs), '有 ASK_MAX 上限（问够次数就永远闭嘴）');
is(/ASK_GAP_MS\s*=/.test(pjs), '有 ASK_GAP_MS 间隔');
is(/export\s+function\s+shouldAsk[\s\S]{0,700}o\.practicing/.test(pjs),
  'shouldAsk() 有 practicing 短路（练习中绝不弹窗）');
is(/export\s+function\s+shouldAsk[\s\S]{0,700}o\.installed/.test(pjs), 'shouldAsk() 先看装没装（没装不问）');
is(/export\s+function\s+shouldAsk[\s\S]{0,700}ASK_MAX/.test(pjs) &&
   /export\s+function\s+shouldAsk[\s\S]{0,700}ASK_GAP_MS/.test(pjs),
  'shouldAsk() 同时卡次数与间隔');
is(/STUDY_ROUTES\s*=/.test(pjs), '练习判定走一张路由清单（不是写死某一页）');
is(/practice\/practice/.test(pjs) && /word-drill\/word-drill/.test(pjs), '练习页清单覆盖练习与刷单词');

console.log('\n== 4. 取消关联不能删数据 ==');
{
  const i = pjs.indexOf('export function unlink');
  const j = pjs.indexOf('export function', i + 10);
  const body = i >= 0 ? pjs.slice(i, j > i ? j : pjs.length) : '';
  is(body && !/store\.reset|settings\.reset|removeStorage|\.clear\(/.test(body),
    'unlink() 只改意愿，不碰任何学习记录（掌握度 / 打卡 / 错题都在）');
}

console.log('\n== 5. 同步回执（否则通道断了没人知道） ==');
is(/partner\.noteSync\(/.test(linkSrc), 'link.js 送出战果时调了 noteSync()（设置页才答得出"上次同步"）');
is(/partner\.noteSeen\(/.test(linkSrc), '被对面唤起时记一笔 seenAt（系统查询被包可见性拦掉时的兜底证据）');
is(/export\s+function\s+syncAgo/.test(pjs), 'partner.js 提供 syncAgo()');

console.log('\n== 5b. 检测不到对面的兜底（Android 11+ 包可见性）==');
is(/isApplicationExist\(\{\s*action:[\s\S]{0,120}datauri/.test(pjs),
  '包名查不到时改查 scheme（第二档）');
is(/return\s+seen\(\)/.test(pjs), '最末一档退回"它唤起过我们"');
is(/SEEN_TTL_MS\s*=/.test(pjs), '唤起记录有有效期（卸了就不该一直当证据）');

console.log('\n== 6. 首次询问的接线（home.vue） ==');
is(/import\s+\*\s+as\s+partner\s+from\s+'\.\.\/\.\.\/utils\/partner\.js'/.test(home), 'home.vue 引入了 partner');
is(/this\.maybePartnerAsk\(\)/.test(home), 'onShow 调了 maybePartnerAsk()');
is(/mode="sheet"/.test(home) && /mode="sheet"\s*[\s\S]{0,300}partnerAskItems/.test(home),
  '询问弹窗是三选一菜单（app-dialog sheet 模式，不是确认框）');
is(/partner\.markAsked\(\)/.test(home), '弹之前先 markAsked()（关掉弹窗回前台不会立刻再弹）');
is(/},\s*1200\)/.test(home), '延迟 1.2 秒（首页还没渲染完就糊一张卡上来）');
is(/partnerAsk\.show \|\| this\.delConfirm\.show \|\| this\.guide\.show/.test(home),
  '已有弹窗 / 引导时让路（不互相覆盖）');
is(/partnerAskItems\(\)[\s\S]{0,300}打通（推荐）[\s\S]{0,200}以后再说[\s\S]{0,200}不用了/.test(home),
  '三个选项都在：打通 / 以后再说 / 不用了');
is(/if\s*\(\s*i\s*===\s*0[\s\S]{0,200}partner\.link\(\)/.test(home),
  '选项 0 = 打通（调 link()）');
is(/if\s*\(\s*i\s*===\s*2[\s\S]{0,200}partner\.unlink\(\)/.test(home), '选项 2 = 不用了（落到 declined）');
is(/__partnerTimer/.test(home), '定时器有句柄、离开首页时清掉');

console.log('\n== 7. 设置页的常驻入口（四种状态、四个动作） ==');
is(/import\s+\*\s+as\s+partner\s+from\s+'\.\.\/\.\.\/\.\.\/utils\/partner\.js'/.test(page), 'settings.vue 引入了 partner');
['refreshPartner', 'recheckPartner', 'doLink', 'doDecline', 'askUnlink', 'goPartner'].forEach((f) => {
  is(new RegExp('\\n\\s{4}' + f + '\\s*\\(').test(page), 'settings.vue 有 ' + f + '()');
});
is(/pn\.installed/.test(page) && /pn\.state\s*===\s*'linked'/.test(page) && /pn\.state\s*===\s*'declined'/.test(page),
  '模板覆盖四种状态（未安装 / 未决定 / 已关联 / 已关闭）');
is(/k\s*===\s*'partner'/.test(page), "收起态也要有一句话状态（secHint('partner')）");
is(/pn\.state\s*===\s*'declined'\s*\?\s*\$t\('重新关联'\)/.test(page), '已关闭状态下给「重新关联」（一次误点不会永久失去）');
is(/action:\s*'unlink'/.test(page) && /act\s*===\s*'unlink'/.test(page), '「取消关联」走了二次确认并真的落账');
is(/v-if="!pn\.installed"[\s\S]{0,900}\$t\('重新检测'\)/.test(page), '未安装时只留「重新检测」（不给点了没反应的按钮）');
is(/pn\.seen\s*\?[\s\S]{0,120}\$t\(/.test(page), '查不到但"它唤起过我们"时换一句说法（不是干巴巴一句"没装"）');
is(/void this\.__lang[\s\S]{0,400}今天 \{min\} 分钟 · \{words\} 词/.test(page), '已关联状态行说的是 i18n 占位符句子（不是裸拼中文）');
is(/this\.refreshPartner\(\)/.test(page), 'onShow → refresh() 每次重查系统（刚装/刚卸都要看得到）');

console.log('\n== 8. linked=0 时的回跳（文档 11.8） ==');
is(/linked:\s*lk\s*!==\s*'0'/.test(linkSrc), '只有 linked=0 才是手动模式（没这个参数按已关联处理，兼容老版本）');
is(/if\s*\(\s*this\.linked\s*\)\s*link\.finish/.test(practice), 'linked=1：离开练习页自动回传并跳回');
is(/else\s+link\.clearCtx\(\)/.test(practice), 'linked=0：不替用户跳，收干净会话上下文');
is(/class="pl-banner"\s*:class="\{\s*weak:\s*!linked\s*\}"[\s\S]{0,400}\$t\('回去'\)/.test(practice),
  'linked=0 时横幅降级、但仍给「回去」按钮（人是从对面点进来的，回不去像被绑架）');
is(/backToPartner/.test(practice), '手动「回去」仍然是同一个 finish 通道（数据一个不少）');

console.log('\n== 9. 运行时：状态机真跑一遍 ==');
const mem = {};
// 桩只认真机变体 com.PWstudy、不认协议包名 com.pwstudy.app ——
// installed() 若只会查一个包名，下面这些测试就全得红
let installedFlag = false;
let schemeFlag = false;   // "系统能查到接得住 pwstudy:// 的 Activity" 与否
const opened = [];
const toasts = [];
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => toasts.push(String((o && o.title) || ''))
};
global.plus = {
  runtime: {
    // 真机上 Android 11+ 会拦掉 pname 查询（一律 false），这里两档都能开，方便验兜底；
    // pname 只认 com.PWstudy（真机变体）—— 逼着被测代码把注册表里那组包名逐个试完
    isApplicationExist: (o) => {
      if (o && o.pname) return !!installedFlag && o.pname === 'com.PWstudy'
      if (o && o.datauri) return !!schemeFlag
      return false
    },
    openURL: (u) => { opened.push(String(u)); return true; },
    launchApplication: () => true
  }
};

const settingsMod = load('utils/settings.js');
const storeMod = load('utils/store.js');
const usageMod = load('utils/usage.js');
settingsMod.init();
storeMod.init();
// 假页栈：partner.practicing() 默认走 getCurrentPages()，这里把它塞进沙箱，
// "练习中不弹窗"这条才能自动重跑（不用靠人盯着真机）。
const pagesStack = [{ route: 'pages/home/home' }];
const partnerMod = load('utils/partner.js', {
  settings: settingsMod, store: storeMod, usage: usageMod, plus: global.plus,
  getCurrentPages: () => pagesStack
});
const linkMod = load('utils/link.js', { partner: partnerMod, plus: global.plus });

const ask = (pract) => partnerMod.shouldAsk({ installed: partnerMod.installed(), practicing: !!pract });

// —— 检测的三档判定（真机上最常出问题的一处）——
installedFlag = false;
schemeFlag = false;
settingsMod.set({ partner: { seenAt: 0 } });
eq(partnerMod.installed(), false, '一组包名全查不到、也没人唤起过 → 未检测到');
schemeFlag = true;
eq(partnerMod.installed(), true, '包名全查不到但接得住 pwstudy:// → 仍算装了（第二档）');
schemeFlag = false;
partnerMod.noteSeen();
eq(partnerMod.installed(), true, '系统查询全失败、但它真唤起过我们 → 也算装了（第三档，最硬）');
settingsMod.set({ partner: { seenAt: Date.now() - 20 * 86400000 } });
eq(partnerMod.installed(), false, '唤起记录超过 14 天 → 不再当证据（可能早卸了）');
settingsMod.set({ partner: { seenAt: 0 } });

// —— 只装 AWword：一切不可见 ——
installedFlag = false;
eq(partnerMod.installed(), false, '没装 PWstudy → installed() = false');
eq(ask(false), false, '没装 → 不该问');
installedFlag = true;
eq(partnerMod.installed(), true, '协议包名查不到、但真机变体 com.PWstudy 在 → installed() = true');
settingsMod.set({ partner: { v: 1, state: 'undecided', askedCount: 0, lastAskAt: 0, linkedAt: 0, lastSyncAt: 0, lastWords: 0 } });
eq(ask(false), true, '装了 + 从未问过 → 该问');
eq(ask(true), false, '练习中不弹窗');
// practicing() 本身：上面 shouldAsk 的 practicing 是传进去的，这里单独验它读页栈的四种形态
eq(partnerMod.practicing([{ route: 'pages/home/home' }]), false, 'practicing：首页不算练习中');
eq(partnerMod.practicing([{ route: 'pages/home/home' }, { route: 'pkgStudy/pages/practice/practice' }]), true,
  'practicing：栈顶在练习页 = 练习中');
eq(partnerMod.practicing([]), false, 'practicing：空页栈 = 不在练习');
eq(partnerMod.practicing(null), false, 'practicing：拿不到页栈不抛异常');
eq(partnerMod.practicing([{}]), false, 'practicing：脏页栈不抛异常');
// 真刀真枪：改页栈、走 practicing() 自己读 getCurrentPages 的路径
pagesStack.length = 0;
pagesStack.push({ route: 'pages/home/home' }, { route: 'pkgStudy/pages/word-drill/word-drill' });
eq(partnerMod.practicing(), true, 'practicing()：栈顶在刷单词页 = 练习中');
pagesStack.length = 0;
pagesStack.push({ route: 'pages/home/home' });
eq(partnerMod.practicing(), false, 'practicing()：栈顶回首页 = 不在练习');

// —— 以后再说：计数 3 次后闭嘴 ——
settingsMod.set({ partner: { state: 'undecided', askedCount: 0, lastAskAt: 0 } });
partnerMod.markAsked();
settingsMod.set({ partner: { lastAskAt: Date.now() - 3 * 86400000 } });
eq(ask(false), true, '隔够 2 天还能再问');
settingsMod.set({ partner: { askedCount: 2, lastAskAt: Date.now() - 3 * 86400000 } });
eq(ask(false), true, '第 3 次机会还在');
partnerMod.markAsked();
settingsMod.set({ partner: { lastAskAt: Date.now() - 3 * 86400000 } });
eq(ask(false), false, '问满 3 次 → 永远闭嘴');
settingsMod.set({ partner: { askedCount: 0, lastAskAt: Date.now() - 3600000 } });
eq(ask(false), false, '距上次不到 2 天 → 不问');

// —— 打通 / 取消 ——
partnerMod.link();
eq(partnerMod.state().state, 'linked', 'link() → linked');
eq(partnerMod.isLinked(), true, 'isLinked() = true');
eq(ask(false), false, '已关联 → 不再问');

// 取消前先造一份学习数据，证明"取消不删数据"
const ds = storeMod.get();
ds.days[usageMod.dayKey()] = { total: 4, correct: 3, mastered: 2 };
ds.mastery['1'] = { m: 4, seen: 1, correct: 1 };
storeMod.save(ds);
const snapshot = JSON.stringify(storeMod.get());
partnerMod.unlink();
eq(partnerMod.state().state, 'declined', 'unlink() → declined');
settingsMod.set({ partner: { askedCount: 0, lastAskAt: 0 } });
eq(ask(false), false, 'declined 后把计数清空也不再问（不许退回 undecided）');
eq(JSON.stringify(storeMod.get()), snapshot, '取消关联后学习数据一字未动');
partnerMod.link();
eq(partnerMod.state().state, 'linked', '关了还能再开回来');

// —— 今日数量与同步回执 ——
eq(partnerMod.todayWords(), 2, "todayWords() = days[].mastered（今天学会 2 词）");
usageMod.addMs(25 * 60000);
eq(partnerMod.todayMin(), 25, 'todayMin() = 今天 25 分钟（与统计页同一张表）');
partnerMod.noteSync(25, 12);
eq(partnerMod.state().lastWords, 12, 'noteSync() 记下本次词数');
eq(partnerMod.syncAgo().unit, 'min', '刚同步过 → syncAgo = min');
eq(partnerMod.syncAgo().n, 0, 'syncAgo = 刚刚');
settingsMod.set({ partner: { lastSyncAt: Date.now() - 40 * 60000 } });
eq(partnerMod.syncAgo().n, 40, '40 分钟前同步');
settingsMod.set({ partner: { lastSyncAt: Date.now() - 2 * 3600000 } });
eq(partnerMod.syncAgo().unit, 'hour', '2 小时前 → hour');
settingsMod.set({ partner: { lastSyncAt: Date.now() - 3 * 86400000 } });
eq(partnerMod.syncAgo().unit, 'day', '3 天前 → day');
settingsMod.set({ partner: { lastSyncAt: 0 } });
eq(partnerMod.syncAgo().unit, 'never', '从没同步过 → never');

console.log('\n== 10. 运行时：进出链路真跑一遍 ==');
const BACK_BASE = 'pwstudy://vocab-done?min=25&task=t1';
linkMod.clearCtx();
eq(linkMod.consume('awword://study?minutes=25&v=1&linked=1&task=t1&back=' + encodeURIComponent(BACK_BASE), () => {}),
  true, '认领 awword://study');
eq(linkMod.getCtx().linked, true, 'linked=1 → 自动模式');
linkMod.clearCtx();
linkMod.consume('awword://study?minutes=25&linked=0&task=t2&back=' + encodeURIComponent(BACK_BASE), () => {});
eq(linkMod.getCtx().linked, false, 'linked=0 → 手动模式');
linkMod.clearCtx();
linkMod.consume('awword://study?minutes=25&task=t3&back=' + encodeURIComponent(BACK_BASE), () => {});
eq(linkMod.getCtx().linked, true, '没带 linked（老版本 PWstudy）→ 按已关联处理');
linkMod.clearCtx();
eq(linkMod.consume('awword://study?minutes=20&zzz=1&due=9&streak=4&back=' + encodeURIComponent(BACK_BASE), () => {}),
  true, '多几个不认识的字段照样认（"只加可选字段"那一条规矩的兑现）');
linkMod.clearCtx();
eq(linkMod.consume('pwstudy://vocab-done?min=25', () => {}), false, '不是本 scheme → 不认领');

settingsMod.set({ partner: { lastSyncAt: 0 } });
opened.length = 0;
linkMod.clearCtx();
linkMod.consume('awword://study?minutes=25&task=t3&back=' + encodeURIComponent(BACK_BASE), () => {});
eq(linkMod.finish(7), true, 'finish() 跳出去了');
const outUrl = opened[0] || '';
is(/[?&]min=\d+/.test(outUrl), '回传 min（真实停留时长）：' + outUrl);
is(/[?&]words=7/.test(outUrl), '回传 words = 本次学会的词数');
is(/task=t3/.test(outUrl), 'task 原样带回（对面好对账）');
eq(linkMod.hasCtx(), false, 'finish() 之后 ctx 清空（来回切页不会重复记账）');
eq(partnerMod.syncAgo().unit, 'min', 'finish() 顺手记了 noteSync（设置页才答得出"上次同步"）');

// 错误形态：openURL 抛异常时不许把页面拖崩
linkMod.clearCtx();
linkMod.consume('awword://study?minutes=25&back=' + encodeURIComponent(BACK_BASE), () => {});
global.plus.runtime.openURL = () => { throw new Error('boom') };
let threw = false;
try { eq(linkMod.finish(3), false, '跳不出去时 finish() 返回 false（调用方据此给提示）') } catch (e) { threw = true }
eq(threw, false, 'finish() 吞咽跳转异常 —— 一个可选增强不许有能力拖垮练习页');

console.log('\n== 11. 运行时：首页「三选一」真跑一遍（第 7 节 AWword 侧清单） ==');
// 真把首页的方法门面跑起来：上面几组只能证明"这么写了"，这组证明"点下去真的这么走"。
// 做法是把 home.vue 的 <script> 直接 loadCode 起来，setTimeout 换成同步执行 ——
// 既不用等 1.2 秒，也顺便验了"确实是延迟 1200ms"。
const { loadCode } = require('./lib/load');
const homeRaw = readRaw('pages/home/home.vue');
const homeScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(homeRaw) || [])[1] || '';
const dummy = () => ({ name: 'X' });
const delays = [];
const Home = loadCode(homeScript, {
  // 脚本里其它依赖都是"页面能跑起来就行"级别的桩，唯一要认真传的是 partner ——
  // 它就是这一组要测的对象。t() 必须真替占位符（"将删除「{name}」"那次教训）。
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  setTimeout: (fn, ms) => { delays.push(ms); fn(); return 1; },
  clearTimeout: () => {},
  wordbook: {}, dict: {}, search: {}, aiGateReason: () => '', speakWord: () => {}, explainWord: () => '',
  looksLikeSentence: () => false, hideNativeTabBar: () => {}, syncTabbar: () => {},
  aiCache: {}, tabSlideMixin: () => ({}), wordPolishMixin: () => ({}),
  FloatTabbar: dummy(), FloatNavbar: dummy(), AppCardBlocks: dummy(), AppDialog: dummy(),
  OnboardingMask: dummy(), SearchHistory: dummy(), WidgetProgress: dummy(), WidgetFavorites: dummy(),
  WidgetStreak: dummy(), WidgetChart: dummy(), WidgetGoal: dummy(), WidgetUsage: dummy(),
  WidgetWorddrill: dummy(), WidgetChat: dummy(),
  homeLayout: {}, pageDoc: {}, pageCommand: {}, intent: { SUGGESTIONS: [] }, pageAgent: {}, cardSpec: {},
  speakAny: () => {}, onboarding: {}, searchHistory: {},
  partner: partnerMod, uni: global.uni
}, 'home.vue').default;

const hvm = Object.assign({}, Home.data ? Home.data() : {}, Home.methods || {});
const resetAsk = () => settingsMod.set({ partner: { state: 'undecided', askedCount: 0, lastAskAt: 0 } });

installedFlag = true;
pagesStack.length = 0;
pagesStack.push({ route: 'pages/home/home' });
resetAsk();
hvm.maybePartnerAsk();
eq(delays[delays.length - 1], 1200, '延迟 1.2 秒（不是首页一渲染完就糊上来）');
eq(hvm.partnerAsk.show, true, '装了 + 未决定 + 不在练习 → 弹出三选一');
eq(partnerMod.state().askedCount, 1, '弹之前已记账（关掉弹窗回前台不会立刻再弹）');
eq(Home.computed.partnerAskItems.call(hvm).length, 3, '菜单三项');

// 三个选项各自要去哪儿 —— 下标写错是最难发现的一类 bug（不报错，只是意愿反过来）
hvm.onPartnerAsk(0);
eq(partnerMod.state().state, 'linked', '点「打通（推荐）」→ linked');
resetAsk();
hvm.onPartnerAsk(1);
eq(partnerMod.state().state, 'undecided', '点「以后再说」→ 仍是未决定（还能再问，靠计数收尾）');
hvm.onPartnerAsk(2);
eq(partnerMod.state().state, 'declined', '点「不用了，我就专心背」→ declined（永不再自动弹）');

// 让路：别人已经占着屏幕时不许抢
resetAsk();
hvm.guide = { show: true };
hvm.partnerAsk = { show: false };
hvm.maybePartnerAsk();
eq(hvm.partnerAsk.show, false, '新手引导进行中 → 让路');
hvm.guide = { show: false };
hvm.sheetShow = true;
hvm.maybePartnerAsk();
eq(hvm.partnerAsk.show, false, '收纳抽屉开着 → 让路');
hvm.sheetShow = false;

// 练习中不弹窗（验收清单里最要紧的一条）
resetAsk();
pagesStack.push({ route: 'pkgStudy/pages/practice/practice' });
hvm.maybePartnerAsk();
eq(hvm.partnerAsk.show, false, '练习中 → 一次都不弹');
eq(partnerMod.state().askedCount, 0, '练习中不弹时也不记账（没打扰就别消耗次数）');
pagesStack.length = 0;
pagesStack.push({ route: 'pages/home/home' });

console.log('\n== 12. 运行时：设置页四态与四个动作真跑一遍 ==');
// 这一组覆盖第 7 节里那几条"设置页能否回来"：常驻入口不是摆设，取消后还能再开。
const settingsRaw = readRaw('pkgManage/pages/settings/settings.vue');
const settingsScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(settingsRaw) || [])[1] || '';
const St = loadCode(settingsScript, {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  partner: partnerMod, store: storeMod, settings: settingsMod, usage: usageMod,
  LOCALES: [{ key: 'zh', name: '中文' }, { key: 'en', name: 'English' }],
  current: () => 'zh', setLocale: () => {}, aiCache: { stats: () => ({}) },
  voiceStop: () => {}, voiceStatus: () => ({}), resetVoice: () => {},
  validateKeyFormat: () => true, testAIConnection: async () => ({ ok: true }),
  PROVIDER_PRESETS: [], providerSupportsTTS: () => false, TTS_MODELS: [],
  IMAGE_MODELS: [], supportsImage: () => false,
  AI_FEATURES: [], featureMap: () => ({}), setFeature: () => {}, setAllAiFeatures: () => {}, offCount: () => 0,
  resetBreaker: () => {}, apiUsage: { brief: () => '' }, onboarding: { restart: () => {} },
  confusion: { stats: () => ({ pairs: 0 }) }, aiSpeak: () => {}, sfx: {}, backup: {}, backupIO: {},
  BUILD_INFO: { version: '1.1' }, hexToHsl: () => ({}), hslToHex: () => '', darkVariant: () => '',
  perf: { rawQuality: () => 'high', getFx: () => ({}), summary: () => ({ text: '' }) },
  QUALITY: [], glassText: () => '', motionText: () => '', shadowText: () => '',
  FloatNavbar: dummy(), AppDialog: dummy(),
  ACCENTS: [], BACKGROUNDS: [], SWATCHES: [], DEFAULT_CUSTOM: '#ffffff',
  currentAccent: () => 'blue', currentBg: () => 'sky', currentBgImage: () => '',
  currentCustomColor: () => '', currentMask: () => 0.35, currentBlur: () => 0,
  isDark: () => false, currentFollowSystem: () => false, systemPrefersDark: () => false,
  barsSyncColors: () => true, currentSmooth: () => false,
  FONT_OPTIONS: [
    { key: 'system', name: '系统', stack: 'system-stack' },
    { key: 'serif', name: '衬线', stack: 'serif-stack' },
    { key: 'rounded', name: '等宽', stack: 'mono-stack' }
  ],
  DENSITY_OPTIONS: [
    { key: 'compact', name: '紧凑' },
    { key: 'cozy', name: '适中' },
    { key: 'relaxed', name: '宽松' }
  ],
  currentFont: () => 'system', setFont: () => {}, currentDensity: () => 'cozy', setDensity: () => {}
}, 'settings.vue').default;

const svm = Object.assign({}, St.data ? St.data() : {}, St.methods || {});
// pn 是模板四态的唯一数据源；__lang 是 $t 的语言依赖标记
svm.__lang = 1;

// 系统查不到（Android 11+ 包可见性），但它刚把用户送过来过 → 界面不能再说"未检测到"
installedFlag = false;
partnerMod.noteSeen();
svm.refreshPartner();
eq(svm.pn.installed, true, '系统查不到但它唤起过我们 → 界面算已装');
eq(svm.pn.seen, true, 'pn.seen 同步给模板（未检测到时会换一句说法）');

settingsMod.set({ partner: { seenAt: 0 } });
partnerMod.unlink();   // 先落到 declined，再看四种分支各自怎么写 pn
svm.refreshPartner();
eq(svm.pn.installed, false, 'pn.installed = false（没检测到 PWstudy）');
eq(svm.secHint('partner'), '未检测到', '收起态一句话 = 未检测到');

installedFlag = false;
settingsMod.set({ partner: { seenAt: 0 } });
toasts.length = 0;
svm.recheckPartner();
eq(toasts.length, 1, '「重新检测」仍查不到 → 说清可能原因（不是点了没反应）');
installedFlag = true;
svm.refreshPartner();
eq(svm.pn.installed, true, '装了 → pn.installed = true');
eq(svm.pn.state, 'declined', '意愿仍是 declined（取消关联不会被重置）');
eq(svm.secHint('partner'), '已关闭', '收起态一句话 = 已关闭');

svm.doLink();
eq(svm.pn.state, 'linked', '点「重新关联」→ 立刻变已关联');
eq(svm.secHint('partner'), '已关联', '收起态一句话 = 已关联');
settingsMod.set({ partner: { lastSyncAt: Date.now() - 3 * 60000, lastWords: 30 } });
svm.refreshPartner();
const statText = St.computed.partnerStatText.call(svm);
is(/今天 \d+ 分钟 · \d+ 词/.test(statText), '状态行带今天的数：' + statText);
is(/3 分钟前同步/.test(statText), '状态行必须带"上次同步多久之前"（否则通道断了没人发现）');

// 取消关联：二次确认 → 真的落账 → 还能再开回来
svm.askUnlink();
eq(svm.confirm.show, true, 'askUnlink 弹出二次确认');
eq(svm.confirm.action, 'unlink', '确认框 action = unlink');
is(/原样保留/.test(svm.confirm.content), '确认文案说清数据保留（不是"清空"）');
const woke = storeMod.get().mastery['1'];
svm.onConfirmYes(true);
eq(partnerMod.state().state, 'declined', '确认后真的落到 declined');
eq(svm.pn.state, 'declined', '刷新后状态行显示已关闭');
eq(storeMod.get().mastery['1'], woke, '点完「取消关联」，学习数据一个字没动');
svm.doLink();
eq(partnerMod.state().state, 'linked', '同一个入口能再开回来');

// 过去一趟：用户主动点才跳，且没起来要明说
toasts.length = 0;
svm.goPartner();
eq(toasts.length, 0, 'PWstudy 起得来 → 不打扰');
global.plus.runtime.launchApplication = () => { throw new Error('no such pkg') };
global.plus.runtime.openURL = () => { throw new Error('no activity') };
toasts.length = 0;
svm.goPartner();
is(toasts.length === 1 && /没能打开/.test(toasts[0]), '起不来 → 明说是"没能打开"，而不是默默无反应');

console.log('');
console.log(fail ? ('\n伙伴 App 关联巡检：' + fail + ' 项待处理') : '\n伙伴 App 关联巡检全部通过 ✓');
process.exit(fail ? 1 : 0);
