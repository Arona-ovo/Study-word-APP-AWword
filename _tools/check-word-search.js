// _tools/check-word-search.js - 练习 / 刷单词顶栏「随手查词」校验（只读 + 真跑组件方法）
//
// A. components/word-search（把组件 <script> 真加载起来跑）
//   1) 题没答完（locked）点顶栏 → 只给一句解释，不进搜索态（否则等于把答案摆在手边）
//   2) 答完了点 → 进搜索态并把输入框抢过来（弹键盘）
//   3) 已经开着搜索时再点一次 → 重新抢焦点（键盘被点掉后还能接着输）
//   4) 本地**一模一样**命中 → 不再问 AI（省额度）；只有近似命中 / 没命中才排 AI 兜底
//   5) 「没找到」只在本地 / 缓存 / AI 三条路全空时才说 —— AI 转圈期间不许先闪一句"没有"
//   6) 精确命中单独置顶、其余进「相近的词」且默认只露 4 条（搜 "in" 那类噪音的回归点）
//   7) 回车（onSubmit）要有明确动作：有那个词就进词条页，没有就立刻问 AI，没接 AI 就给说法
//   8) 空输入 → 结果与 lastQuery 一起清掉
//   9) AI 回来时输入已经换词 → 结果不贴到界面上（防串词）
//  10) 点结果 → 进单词详情页（w + book）
//  11) close 收干净：清 AI 定时器、清关键词、让顶栏失焦
//  12) 顶栏契约（组件挂在 float-navbar 上）
//  13) 最近查过（搜索历史）
//  14) 义项补全（与首页共用 word-polish-mixin：显示不全才补、补完落缓存、顺手预判几个）
//  15) 两个练习页的接入契约 = 分组标题的「== 15 ==」
//   - 主分支顶栏换成 <word-search>，锁定态由 canSearch 给
//   - canSearch 口径：practice 还要排除"目标词确认关进行中"（那一关考的就是词义）
//   - onShow 收面板（从词条页返回）、onUnload 关搜索（别让 AI 定时器跑到页面外面）
const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const toasts = [];
const navs = [];
global.uni = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: (o) => toasts.push((o && o.title) || ''),
  navigateTo: (o) => navs.push((o && o.url) || '')
};

const FILE = path.join(ROOT, 'components', 'word-search', 'word-search.vue');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const script = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(src) || [])[1] || '';
const tpl = (/<template>([\s\S]*)<\/template>/.exec(src) || [])[1] || '';

// 可控薄桩：这几条断言只关心"什么时候去查、结果贴不贴"，不关心真实检索
const stubs = {
  local: () => [],
  cache: () => null,
  explain: async (q) => ({ word: q, pos: 'v.', meaningZh: '释义-' + q, examples: [{ en: 'e', zh: 'z' }] }),
  aiOn: true
};

// 缓存里"已补全的词"：小写词 → 义项表。模拟 utils/ai-cache 里那份多义存储
const senseMap = {};
// 组件与 mixin 各有一份 aiCache 依赖袋（mixin 是独立模块，闭包里用的是自己的那份），
// 两边必须指向同一套数据，否则"缓存已有完整义项 → 不再补"这条断言永远测不到
const cacheApi = {
  findWord: (w) => stubs.cache(w),
  sentencesOf: () => [],
  sensesOf: (w) => senseMap[String(w || '').trim().toLowerCase()] || [],
  hasFullSenses: (w) => cacheApi.sensesOf(w).length >= 2
};
// 补全请求记一笔：只看"有没有发、带没带预判候选"，不去真跑模型
const polishLog = [];
let polishReply = { senses: [], examples: [], others: [] };
const expandStub = async (w, opts) => {
  polishLog.push({ w: String(w || ''), also: ((opts && opts.also) || []).slice() });
  return Object.assign({ word: w, pos: '' }, polishReply);
};
// 真 mixin（不是空壳桩）：只把它的三个外部依赖换成上面的可控实现
const wordPolishMixin = load('utils/word-polish-mixin.js', {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  aiCache: cacheApi,
  expandWord: expandStub
}).default;

// 最近搜过：做题页查词也复用同一份历史（不是另存一份）
const histLog = [];
const histStub = {
  list: () => histLog.slice().map((w) => ({ w: w, at: 0 })),
  add: (w) => { histLog.push(String(w)); return true; },
  remove: (w) => {
    const i = histLog.indexOf(String(w));
    if (i < 0) return false;
    histLog.splice(i, 1);
    return true;
  },
  clear: () => { histLog.length = 0; return true; }
};

const COMP = loadCode(script, {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  search: { localSearch: (bid, kw, limit) => stubs.local(bid, kw, limit) },
  aiCache: cacheApi,
  aiGateReason: () => (stubs.aiOn ? '' : '未配置 AI'),
  explainWord: (q) => stubs.explain(q),
  // 组件注册了这个娃就要给桩，否则脚本加载即崩（不是假绿，是压根跑不起来）
  FloatNavbar: {},
  SearchHistory: {},
  searchHistory: histStub,
  // 真 mixin：组件声明了 mixins: [wordPolishMixin()]，这里给的是同一个实现
  wordPolishMixin
}, 'word-search.vue').default;

assert(!!COMP && typeof COMP.data === 'function', '组件脚本可加载（导出 default）');

function mount(props) {
  // Vue 的 mixin 合并：组件自己的 data / methods 覆盖 mixin 的同名字段
  const mix = (COMP.mixins || []).reduce(function (acc, m) {
    return {
      data: Object.assign({}, acc.data, typeof m.data === 'function' ? m.data() : {}),
      methods: Object.assign({}, acc.methods, m.methods || {}),
      computed: Object.assign({}, acc.computed, m.computed || {})
    };
  }, { data: {}, methods: {}, computed: {} });
  const ctx = Object.assign(
    {}, mix.data, COMP.data(), mix.methods, COMP.methods, props || {}
  );
  ctx.$nextTick = (fn) => fn();          // 同步执行：断言里不用等
  ctx.__blurred = false;
  ctx.$refs = { navbar: { blurInput: () => { ctx.__blurred = true; } } };
  Object.keys(Object.assign({}, mix.computed, COMP.computed || {})).forEach((k) => {
    const fn = (mix.computed[k]) || (COMP.computed || {})[k];
    Object.defineProperty(ctx, k, { get: () => fn.call(ctx), configurable: true });
  });
  ctx.refreshAi();                       // 组件是 created 里做的，这里补上（否则 AI 那条路永远走不到）
  return ctx;
}

(async function main() {
  console.log('== 1. 题没答完：点顶栏不能进搜索态 ==');
  const locked = mount({ locked: true, bookId: 'fj_zsb_core' });
  toasts.length = 0;
  locked.open();
  eq(locked.active, false, '没答完时点顶栏不进搜索态');
  eq(toasts.length, 1, '给一句解释（不说清楚，用户只会以为顶栏坏了）');
  const locked2 = mount({ locked: true, lockHint: '自定提示' });
  toasts.length = 0;
  locked2.open();
  eq(toasts[0], '自定提示', '提示语可以由页面覆盖');

  console.log('\n== 2. 答完了：点开搜索并抢焦点 ==');
  const c = mount({ locked: false, bookId: 'B' });
  toasts.length = 0;
  c.open();
  eq(c.active, true, '进搜索态');
  eq(c.autofocus, true, '输入框抢焦点（键盘直接弹出来）');
  eq(toasts.length, 0, '不再提示');
  c.onBlur();
  eq(c.autofocus, false, '失焦后松开焦点标记');

  console.log('\n== 3. 搜索已经开着：再点一次重新抢焦点 ==');
  c.open();
  eq(c.active, true, '仍是搜索态');
  eq(c.autofocus, true, '焦点被抢回来（false→true 才触发重聚焦）');

  console.log('\n== 4. 本地命中：一模一样就不再问 AI ==');
  stubs.local = (bid, kw, limit) => {
    c.__limit = limit;
    return [{ w: 'improve', pos: 'v.', m: '改善', fromText: '当前词书' }];
  };
  c.onInput('improve');
  eq(c.results.length, 1, '列出本地结果');
  eq(c.lastQuery, 'improve', 'lastQuery 跟上');
  eq(c.timer, 0, '一模一样命中 → 不排 AI（省额度）');
  eq(c.__limit, 12, '本地最多取 12 条（精确命中排第一，其余按相关性；界面默认只露 4 条相近的）');

  console.log('\n== 5. 近似命中 / 没命中：排 AI 兜底，转圈期间不许说"没找到" ==');
  stubs.local = () => [{ w: 'improving', pos: '', m: '改善', fromText: '当前词书' }];
  const near = mount({ locked: false, bookId: 'B' });
  near.onInput('improve');
  eq(near.results.length, 1, '近似命中照样列出来给用户挑');
  assert(near.timer !== 0, '但不当成"查到了" → 排一次 AI 兜底');
  near.close();
  eq(near.timer, 0, 'close 时清掉 AI 定时器（页面走了不该还发请求）');

  stubs.local = () => [];
  stubs.cache = () => null;
  const none = mount({ locked: false, bookId: 'B' });
  none.onInput('zzzz');
  eq(none.results.length, 0, '没命中 → 空列表');
  assert(none.timer !== 0, '排 AI 兜底');
  // 这 700ms 空窗期也不能说"没找到"：那会儿还没问过 AI，
  // 先闪一句"没有"、再被 AI 结果顶掉，比什么都不显示更让人困惑
  eq(none.noExact, false, 'AI 请求还没发出去（等着呢）→ 同样不许说"没找到"');
  none.close();
  eq(none.timer, 0, 'close 时清掉 AI 定时器（页面走了不该还发请求）');

  // 「没找到」这句话什么时候能说：转圈期间不许说，三条路全空才说。
  // 关键是让请求真的"在路上"——只排定时器的话 aiLoading 从没亮过，断言等于没测。
  let releaseAi;
  stubs.explain = () => new Promise((res) => { releaseAi = res });
  const pend = mount({ locked: false, bookId: 'B' });
  pend.onInput('zzzz');
  if (pend.timer) { clearTimeout(pend.timer); pend.timer = 0 }
  const flying = pend.aiLookup('zzzz');
  eq(pend.aiLoading, true, 'AI 请求发出去 → 转圈亮起来');
  eq(pend.noExact, false, 'AI 还在路上时不显示"没找到"（否则先闪一下"没有"又冒出结果）');
  releaseAi(null);                        // AI 也没查到这个词
  await flying;
  eq(pend.aiLoading, false, '请求结束 → 转圈收掉');
  eq(pend.aiResult, null, 'AI 也给不出东西');
  eq(pend.noExact, true, '本地 / 缓存 / AI 全空 → 这时才说"没找到"（并给出路）');
  pend.close();
  stubs.explain = (q) => ({ word: q, pos: 'v.', meaningZh: '释义-' + q, examples: [{ en: 'e', zh: 'z' }] });

  console.log('\n== 6. 精确命中与「相近的词」分组 ==');
  // 回归点（用户实测）：搜 "in" 时词书里有几百条"含 in"的词（insurance / engine / criminal…），
  // 真正要查的 "in" 一条都不在里头。精确命中的必须单独拎出来置顶，
  // 相近的排在后面、默认只露几条，免得把"有没有"这个结论淹掉。
  stubs.local = () => [
    { w: 'in', pos: 'prep.', m: '在……里', fromText: '常用词' },
    { w: 'insurance', pos: 'n.', m: '保险', fromText: '当前词书' },
    { w: 'engine', pos: 'n.', m: '引擎', fromText: '当前词书' },
    { w: 'institute', pos: 'n.', m: '研究所', fromText: '当前词书' },
    { w: 'criminal', pos: 'n.', m: '罪犯', fromText: '当前词书' },
    { w: 'chain', pos: 'n.', m: '链条', fromText: '当前词书' }
  ];
  const grp = mount({ locked: false, bookId: 'B' });
  grp.onInput('in');
  eq(grp.exactHits.length, 1, '精确命中只有一条（就是 "in" 本身）');
  eq(grp.exactHits[0].w, 'in', '精确命中的是 "in"');
  eq(grp.nearHits.length, 5, '其余 5 条进"相近的词"');
  eq(grp.visibleNear.length, 4, '相近的词默认只露 4 条');
  eq(grp.timer, 0, '有精确命中 → 不用问 AI（词典已经给了释义）');
  assert(/搜索结果/.test(grp.panelTitle), '标题说"搜索结果"：' + grp.panelTitle);
  grp.nearAll = true;
  eq(grp.visibleNear.length, 5, '点「再显示」后铺开全部相近的词');
  grp.close();

  // 只有相近的：标题必须讲明白，否则用户以为里面就有他要的那个词
  stubs.local = () => [{ w: 'engine', pos: 'n.', m: '引擎', fromText: '当前词书' }];
  const onlyNear = mount({ locked: false, bookId: 'B' });
  onlyNear.onInput('in');
  eq(onlyNear.exactHits.length, 0, '一条精确命中都没有');
  assert(/没有完全匹配/.test(onlyNear.panelTitle), '标题讲清"没有完全匹配"：' + onlyNear.panelTitle);
  assert(/1/.test(onlyNear.panelTitle), '标题里带上相近的条数：' + onlyNear.panelTitle);
  onlyNear.close();

  // 布局契约（模板文本）：这两块的先后顺序不能反 —— 反过来就是这次反馈的现场
  const iAi = tpl.indexOf('v-if="aiResult"');
  const iNear = tpl.indexOf('v-if="nearHits.length"');
  assert(iAi > 0 && iNear > iAi, '「相近的词」排在 AI 结果之后（先给能用的，再给近似的）');
  assert(/当前词书里相近的词/.test(tpl), '相近的列表有明确小标题（不然用户以为里面就有他要的）');
  assert(/v-if="noExact"[\s\S]{0,700}?@tap="openQuery"/.test(tpl),
    '"没有这个词"时给一条出路：去词条页自己填释义');
  assert(/v-if="noExact"[\s\S]{0,400}?@tap="retryAi"/.test(tpl),
    '"没有这个词"时能一键重问 AI（不必重新打字）');
  // 三张卡（缓存 / AI / 查不到时的出路）统一走具名方法：
  // 模板里只留方法名，跳哪个词这件事写在 JS 里，好读也好测
  assert(/v-if="cached"[\s\S]{0,120}?@tap="openCached"/.test(tpl), '缓存卡 → openCached');
  assert(/v-if="aiResult"[\s\S]{0,120}?@tap="openAi"/.test(tpl), 'AI 卡 → openAi');
  assert(/openQuery\(\)\s*\{[\s\S]{0,120}?openWord\(\{ w: this\.lastQuery \}\)/.test(script),
    'openQuery 跳的就是当前查的这个词');

  console.log('\n== 7. 回车：给一个明确动作（不再把检索重跑一遍） ==');
  stubs.local = () => [
    { w: 'in', pos: 'prep.', m: '在……里', fromText: '常用词' },
    { w: 'engine', pos: 'n.', m: '引擎', fromText: '当前词书' }
  ];
  navs.length = 0;
  const ent = mount({ locked: false, bookId: 'B' });
  ent.onInput('in');
  ent.onSubmit('in');
  eq(navs.length, 1, '有精确命中 → 回车直接进词条页');
  eq(navs[0], '/pkgManage/pages/word-detail/word-detail?w=in&book=B', '去的就是那条词');
  ent.onSubmit('in');
  eq(navs.length, 2, '再按一次照样进（不吞按键）');

  // 没有精确命中 + 已接 AI → 立刻发请求，不等 700ms
  // 用一个别的脚本段落不会用到的词：这条请求会一直挂着（AI_INFLIGHT 里不会被清掉），
  // 复用 "zzzz" 会把后面那组"AI 结果贴上来"的断言连坐弄红
  const PEND_WORD = 'flibbertigibbet';
  stubs.local = () => [];
  stubs.cache = () => null;
  stubs.explain = () => new Promise(() => { /* 一直挂着：只看有没有发出去 */ });
  const ent2 = mount({ locked: false, bookId: 'B' });
  ent2.aiEnabled = true;
  ent2.onInput(PEND_WORD);
  assert(ent2.timer !== 0, '打字时先排了个 700ms 的 AI 定时器');
  toasts.length = 0;
  ent2.onSubmit(PEND_WORD);
  eq(ent2.timer, 0, '回车把排队中的 AI 定时器撤掉');
  eq(ent2.aiLoading, true, '立刻发 AI（不等那 700ms）');
  ent2.close();

  // 没接 AI：不能白按一下，得给个说法
  const ent3 = mount({ locked: false, bookId: 'B' });
  ent3.aiEnabled = false;
  ent3.onInput('zzzz');
  toasts.length = 0;
  ent3.onSubmit('zzzz');
  eq(toasts.length, 1, '没接 AI 时回车给一句解释（不能毫无反应）');
  assert(/释义/.test(toasts[0]), '解释里点明"可以自己去填释义"：' + toasts[0]);
  ent3.close();
  stubs.explain = (q) => ({ word: q, pos: 'v.', meaningZh: '释义-' + q, examples: [{ en: 'e', zh: 'z' }] });

  console.log('\n== 8. 空输入：结果与 lastQuery 一起清掉 ==');
  const blank = mount({ locked: false, bookId: 'B' });
  blank.onInput('apple');
  blank.onInput('   ');
  eq(blank.results.length, 0, '结果清空');
  eq(blank.lastQuery, '', 'lastQuery 清空');
  assert(blank.timer === 0, '没有挂着的 AI 定时器');

  console.log('\n== 9. AI 补充：只展示，输入换了词就不贴 ==');
  const ai = mount({ locked: false, bookId: 'B' });
  ai.onInput('zzzz');
  if (ai.timer) { clearTimeout(ai.timer); ai.timer = 0 }
  await ai.aiLookup('zzzz');
  eq(ai.aiResult && ai.aiResult.word, 'zzzz', 'AI 结果贴上来');
  eq(ai.aiLoading, false, '转圈收掉');
  eq(ai.noExact, false, '有 AI 结果就不显示"没找到"');
  ai.onInput('yyyy');
  if (ai.timer) { clearTimeout(ai.timer); ai.timer = 0 }
  ai.aiResult = null;
  await ai.aiLookup('zzzz');
  eq(ai.aiResult, null, '输入已经换词 → 旧结果不许贴到界面上（防串词）');
  ai.close();

  console.log('\n== 10. 点结果 → 单词详情页 ==');
  navs.length = 0;
  const go = mount({ bookId: 'fj_zsb_core' });
  go.openWord({ w: ' Improve ' });
  eq(navs.length, 1, '发起一次跳转');
  eq(navs[0], '/pkgManage/pages/word-detail/word-detail?w=improve&book=fj_zsb_core',
    'URL（词形小写 + 带当前词书）');
  navs.length = 0;
  go.openWord({ w: '' });
  eq(navs.length, 0, '空词不跳');

  console.log('\n== 11. close：收干净 ==');
  const cl = mount({ locked: false, bookId: 'B' });
  cl.onInput('zzzz');
  cl.close();
  eq(cl.active, false, '退出搜索态');
  eq(cl.keyword, '', '关键词清空');
  eq(cl.lastQuery, '', 'lastQuery 清空');
  eq(cl.results.length, 0, '结果清空');
  eq(cl.aiResult, null, 'AI 结果清空');
  eq(cl.__blurred, true, '让顶栏失焦（胶囊还原成标题）');

  console.log('\n== 12. 顶栏契约（组件挂在 float-navbar 上） ==');
  assert(/searchable/.test(tpl), '传了 searchable（非搜索态右侧有放大镜入口）');
  assert(/:search-locked="locked"/.test(tpl), '锁定态透传给顶栏（放大镜置灰，而不是藏起来）');
  assert(/@title-tap="open"/.test(tpl), '点标题 → open()');
  assert(/@search="onSubmit"/.test(tpl), '回车 → onSubmit（不是把同样的检索再跑一遍）');
  assert(/keep-keyboard/.test(tpl), '点别处不主动收键盘（滚结果时键盘不闪）');
  assert(/:autofocus="autofocus"/.test(tpl), '焦点由组件控制（打开即弹键盘）');

  console.log('\n== 13. 最近查过：做题页抬头查词也给同一份历史 ==');
  // 用户反馈：「搜索要显示历史记录」—— 做题中途抬头查的往往就是刚才没记住的词，
  // 这块不只在首页有，顶栏查词（word-search）也得有。
  assert(/<block v-if="!lastQuery">[\s\S]{0,200}<search-history/.test(tpl),
    '还没输入时先显示历史（打完字再让位给结果）');
  assert(/<search-history[^>]*ref="history"[^>]*@pick="onHistoryPick"/.test(tpl),
    '接住 pick 事件（点历史那条直接按它查）');
  const pickCall = [];
  const hp = mount({});
  hp.onInput = (v) => pickCall.push('input:' + v);
  hp.onHistoryPick('apple');
  // 这里用字符串比：eq 是全等比较，两个数组不可能全等
  eq(pickCall.join('|'), 'input:apple', '点历史条目 = 把这个词重新查一遍');
  histLog.length = 0;
  hp.rememberSearch('Banana');
  eq(histLog.join('|'), 'Banana', 'rememberSearch 真写进历史（不是只在界面上晃一下）');
  histLog.length = 0;
  navs.length = 0;
  hp.openWord({ w: 'Pear' });
  eq(histLog.join('|'), 'pear', '点开某条结果也记一笔（词统一存小写，下次同一个词不会再占两格）');
  assert(navs.length === 1 && /word-detail/.test(navs[0]), '顺手还是照旧跳词条页（' + navs[0] + '）');
  histLog.length = 0;
  hp.rememberSearch('   ');
  eq(histLog.length, 0, '空白不记（enter n 的什么都不该进历史）');

  console.log('\n== 14. 义项补全（做题页抬头查词同样要说全一个词的意思） ==');
  // 用户原话：「搜索出来的本地已缓存单词，有时候其他意思显示不全，有些一词多义显示不全，
  // 这个时候需要 AI 来补充」—— 首页有还不够，做题中途抬头查的往往就是刚才没记住的词。
  senseMap.bear = [];
  stubs.local = () => [{ w: 'bear', pos: 'n.', m: '熊', fromText: '当前词书' }];
  const po = mount({ locked: false, bookId: 'B' });
  po.onInput('bear');
  eq(po.polishWanted, true, '词书里只有"熊"一条 → 判定为显示不全，该补');
  assert(po.polishTimer !== 0, '停手后排了一次补全（不是边打字边发请求）');
  po.close();
  assert(po.polishTimer === 0, '收起搜索 → 补全定时器一起清掉（页面走了不该还发请求）');

  // 缓存里已经有完整义项 → 不补（补过一次就够，不反复烧 token）
  senseMap.bear = [{ pos: 'n.', meaning: '熊' }, { pos: 'v.', meaning: '忍受' }];
  const done = mount({ locked: false, bookId: 'B' });
  done.onInput('bear');
  eq(done.polishWanted, false, '★ 缓存里已有完整义项 → 不再补');
  assert(done.polishTimer === 0, '也不排补全请求（一个 token 都不花）');
  done.close();
  senseMap.bear = [];

  // 落地：补全回来 → 义项一列贴出来 + 预判词有可见反馈
  const POLISH_WORD = 'zilch';            // 独一无二的词：POLISH_DONE 一场会话只补一次
  stubs.local = () => [{ w: POLISH_WORD, pos: 'n.', m: '零', fromText: '当前词书' }];
  polishLog.length = 0;
  polishReply = {
    senses: [{ pos: 'n.', meaning: '零' }, { pos: 'n.', meaning: '无价值的东西' }],
    examples: [{ en: 'e', zh: 'z' }],
    others: [{ word: 'nil', pos: 'n.', meaning: '零' }]
  };
  const land = mount({ locked: false, bookId: 'B' });
  land.onInput(POLISH_WORD);
  if (land.polishTimer) { clearTimeout(land.polishTimer); land.polishTimer = 0 }
  const pf = land.aiPolish(POLISH_WORD);
  eq(land.polishLoading, true, '补全中 → 转圈亮起来');
  await pf;
  eq(land.polishLoading, false, '回来后转圈收掉');
  eq(land.polish && land.polish.senses.length, 2, '★ 两个义项都列出来（不再只有一个意思）');
  eq(land.polishPrefetchText, 'nil', '顺手备好的预判词有可见反馈');
  eq(polishLog.length, 1, '只发一次补全请求');
  // 换词后旧的补全不许贴上来
  land.onInput('other');
  if (land.polishTimer) { clearTimeout(land.polishTimer); land.polishTimer = 0 }
  eq(land.polish, null, '换词 → 上一轮的补全清掉（不张冠李戴）');
  land.close();
  polishReply = { senses: [], examples: [], others: [] };

  // 模板契约：补全那块是独立分支，排在 AI 结果之后、"相近的词"之前
  const iPolish = tpl.indexOf('v-else-if="polish"');
  const iAiResult = tpl.indexOf('v-if="aiResult"');
  assert(iPolish > 0 && iPolish > iAiResult, '补全块排在 AI 结果之后');
  assert(iPolish < iNear, '补全块排在「相近的词」之前（先给能用的，再给近似的）');
  assert(/v-if="polishLoading"/.test(tpl), '补全中给一句"正在补全这个词的义项…"');
  assert(/v-else-if="polishWanted"[\s\S]{0,200}?@tap="polishNow"/.test(tpl),
    '还差一次补全时给手动入口（AI 关着 / 不想等定时器时点一下）');
  // 缓存那条要带上义项表：mixin 靠它判断"界面上现在摆着几条义项"
  assert(/senses:\s*aiCache\.sensesOf\(/.test(script), 'cacheHitFor 返回的条目带上义项表');

  console.log('\n== 15. 两个练习页的接入契约 ==');
  [['practice', 'pkgStudy/pages/practice/practice.vue'],
    ['word-drill', 'pkgStudy/pages/word-drill/word-drill.vue']].forEach(function (pair) {
    const name = pair[0];
    const p = fs.readFileSync(path.join(ROOT, pair[1]), 'utf8').replace(/\r\n/g, '\n');
    assert(/import WordSearch from '\.\.\/\.\.\/\.\.\/components\/word-search\/word-search\.vue'/.test(p),
      name + ' 引入 word-search 组件');
    // 顺序不固定（后面还会挂 confusion-card），只断言两个都在注册列表里
    assert(/components:\s*\{[^}]*\bFloatNavbar\b[^}]*\bWordSearch\b[^}]*\}/.test(p), name + ' 注册组件');
    assert(/<word-search[\s\S]{0,220}?ref="search"/.test(p), name + ' 主分支顶栏用 word-search');
    assert(/:locked="!canSearch"/.test(p), name + ' 锁定态挂在 canSearch 上');
    assert(/:book-id="bookId"/.test(p), name + ' 搜索范围 = 当前词书');
    assert(/onShow\(\)[\s\S]{0,400}?\$refs\.search\.collapse\(\)/.test(p),
      name + ' onShow 收起搜索面板（从词条页返回不杵在那儿）');
    assert(/onUnload\(\)[\s\S]{0,700}?\$refs\.search\.close\(\)/.test(p),
      name + ' onUnload 关掉搜索（把 AI 定时器一起收干净）');
    const cs = p.slice(p.indexOf('canSearch()'), p.indexOf('canSearch()') + 320);
    assert(/this\.answered/.test(cs), name + ' canSearch 看 answered（结果出来了才放行）');
    assert(/this\.finished/.test(cs), name + ' canSearch 放行整组结束后的状态');
  });

  // practice 独有的那条：确认关进行中不能搜（那一关考的就是目标词的意思）
  const pv = fs.readFileSync(path.join(ROOT, 'pkgStudy/pages/practice/practice.vue'), 'utf8');
  const cs = pv.slice(pv.indexOf('canSearch()'), pv.indexOf('canSearch()') + 320);
  assert(/!this\.confirming/.test(cs),
    'practice：目标词确认关进行中也不给搜（否则等于把答案摆在手边）');
  const dv = fs.readFileSync(path.join(ROOT, 'pkgStudy/pages/word-drill/word-drill.vue'), 'utf8');
  assert(!/confirming/.test(dv.slice(dv.indexOf('canSearch()'), dv.indexOf('canSearch()') + 320)),
    'word-drill：三关每关都是独立作答，用 answered 一条就够');

  console.log('\n== 16. 三种结局要有三种说法（本地命中 / AI 命中 / 没找到 / 查询失败）==');
  // 用户实测反馈：查询结果一路走到"什么都没显示"就没了下文 —— 分不清
  // 「本地没有」「AI 也没有」「AI 请求挂了」这三种情况。它们该有三副不同的样子。
  {
    /* --- ① 本地命中：给词条，不问 AI --- */
    stubs.local = () => [{ w: 'apple', pos: 'n.', m: '苹果', fromText: '当前词书' }];
    stubs.cache = () => null;
    let asked = 0;
    stubs.explain = async (q) => { asked++; return { word: q, pos: 'v.', meaningZh: 'x' }; };
    const hit = mount({ locked: false, bookId: 'B' });
    hit.onInput('apple');
    eq(hit.exactHits.length, 1, '本地精确命中 → 结果就是它');
    eq(hit.timer, 0, '本地已经查到 → 不排 AI（不花额度）');
    eq(hit.noExact, false, '本地命中不说"没找到"');
    eq(hit.aiError, '', '本地命中也没有"查询失败"');
    hit.close();

    /* --- ② AI 命中：本地只有相似词，AI 结果必须与它们**同时**在 --- */
    stubs.local = () => [
      { w: 'running', pos: 'n.', m: '跑步', fromText: '当前词书' },
      { w: 'runner', pos: 'n.', m: '跑步者', fromText: '当前词书' }
    ];
    stubs.explain = async (q) => ({ word: q, pos: 'v.', meaningZh: '释义-' + q, examples: [] });
    asked = 0;
    const mixed = mount({ locked: false, bookId: 'B' });
    mixed.onInput('runz');
    eq(mixed.exactHits.length, 0, '本地只有相近的词，没有一模一样的');
    assert(mixed.nearHits.length > 0, '相近的词照旧列出来（' + mixed.nearHits.length + ' 条）');
    if (mixed.timer) { clearTimeout(mixed.timer); mixed.timer = 0 }
    await mixed.aiLookup('runz');
    assert(!!mixed.aiResult, 'AI 给回了结果');
    assert(mixed.nearHits.length > 0 && !!mixed.aiResult,
      '★ 相似词与 AI 结果同时在界面上（本地结果不覆盖 AI）');
    eq(mixed.noExact, false, 'AI 已经给了 → 不说"没找到"');
    eq(mixed.aiError, '', 'AI 成功 → 没有失败提示');
    mixed.close();

    /* --- ③ 没找到：本地没有、AI 也给不出 → 说清楚并给出路 --- */
    stubs.local = () => [];
    stubs.explain = async () => ({ word: '', pos: '', meaningZh: '', examples: [] });   // 空回复
    const none = mount({ locked: false, bookId: 'B' });
    none.onInput('zzqqxx');
    if (none.timer) { clearTimeout(none.timer); none.timer = 0 }
    await none.aiLookup('zzqqxx');
    eq(none.aiResult, null, 'AI 也给不出东西');
    eq(none.aiError, '', '★ AI 返回空 = "它也不知道"，**不是**查询失败');
    eq(none.noExact, true, '本地 / 缓存 / AI 全空 → 这时才说"没找到"');
    none.close();

    /* --- ④ 查询失败：请求本身出错（网络 / 接口），必须看得见、能重试 --- */
    stubs.explain = async () => { throw new Error('network down'); };
    const boom = mount({ locked: false, bookId: 'B' });
    boom.onInput('zzqqxx');
    if (boom.timer) { clearTimeout(boom.timer); boom.timer = 0 }
    await boom.aiLookup('zzqqxx');
    eq(boom.aiResult, null, '失败时没有结果卡');
    assert(!!boom.aiError, '★ 失败原因亮出来了：' + boom.aiError);
    eq(boom.aiLoading, false, '失败也要收掉转圈（不然一直卡在这）');
    eq(boom.noExact, false, '查询失败 ≠ 没找到，不再叠一句"本地词库没有"');
    // 换个词就得把它清掉，别让上一轮的失败提示挂在下一个词下面
    boom.onInput('other');
    eq(boom.aiError, '', '换了词 → 上一轮的失败提示清掉');
    boom.close();
    // 重试真的会再发一次请求：不是"看得见的按钮"，而是能走通
    stubs.explain = async (q) => { retries.push(q); throw new Error('still down'); };
    const retries = [];
    const again = mount({ locked: false, bookId: 'B' });
    again.onInput('zzqqxx');
    if (again.timer) { clearTimeout(again.timer); again.timer = 0 }
    await again.aiLookup('zzqqxx');
    await again.retryAi();
    eq(retries.length, 2, '点「重试」真的又发了一次请求（不是摆设）');
    again.close();

    /* --- 模板契约：三块各自独立，谁也别吞掉谁 --- */
    assert(/<view v-if="aiError"[\s\S]{0,120}?\{\{ aiError \}\}/.test(tpl), '失败态渲染 aiError 文本');
    assert(/<view v-if="aiError"[\s\S]{0,300}?@tap="retryAi"/.test(tpl), '失败态给「重试」入口');
    assert(/<view v-if="aiError"[\s\S]{0,300}?@tap="openQuery"/.test(tpl), '失败态也能手动添加这个词');
    assert(/<view v-if="noExact"[\s\S]{0,700}?@tap="openQuery"/.test(tpl),
      '"没找到"时给一条出路：去词条页自己填释义');
    assert(/<view v-if="noExact"[\s\S]{0,400}?@tap="retryAi"/.test(tpl),
      '"没找到"时能一键重问 AI（不必重新打字）');
    assert(!/v-else-if="aiError"/.test(tpl), '失败态是独立 v-if（不挂在别人后面被吞掉）');
    eq(/noExact\(\)[\s\S]{0,220}?!this\.aiError/.test(script), true,
      'noExact 把 aiError 排除在外（"没查成"和"没查到"不重复说）');
  }

  console.log('\n== 17. 不许替 AI 撒谎（短词陷入两难）==');
  // 用户实测反馈（2026-10-11 真机截图，首页同款问题）：搜 "en"，界面写着
  // 「本地词库没有「en」」+「AI 也未能补充这个词」，可 AI 结果、本机缓存都是空的，
  // 用户卡在中间无路可走。根因是**没问过 AI 却替它回了话** —— 界面必须区分
  // 「AI 真查过了」和「压根还没问过」，后者要把"去问 AI"的入口递到手上。
  {
    const SHORT = 'en';
    stubs.local = () => [
      { w: 'end', pos: 'n.', m: '结束', fromText: '当前词书' },
      { w: 'envy', pos: 'n.', m: '嫉妒', fromText: '当前词书' }
    ];
    stubs.cache = () => null;
    stubs.explain = async () => ({ word: '', pos: '', meaningZh: '', examples: [] });   // 空回复
    const p = mount({ locked: false, bookId: 'B' });
    p.onInput(SHORT);
    eq(p.exactHits.length, 0, '短词：本地没有一模一样的那条');
    assert(p.nearHits.length > 0, '短词：本地倒是有相近结果（' + p.nearHits.length + ' 条）');
    eq(p.aiTried, false, '★ 还没问过 AI → aiTried 保持 false');
    assert(!/AI 也/.test(p.aiHint), '★ 没问过就不许说"AI 也…"：' + p.aiHint);
    assert(/相近/.test(p.aiHint), '★ 这时要说"上面那些只是相近的"：' + p.aiHint);
    eq(p.aiActionText, '让 AI 查一下', '★ 没问过 → 按钮是"让 AI 查一下"');

    if (p.timer) { clearTimeout(p.timer); p.timer = 0 }
    await p.aiLookup(SHORT);
    eq(p.aiTried, true, '★ 真问过之后才把标记亮起来');
    assert(/AI 也没查到这个词/.test(p.aiHint), '★ AI 回来是空的 → 这时才说"AI 也没查到"：' + p.aiHint);
    eq(p.aiActionText, '再问一次', '★ 问过了 → 按钮改成"再问一次"（不然一直说"可以去问"就是鬼打墙）');

    p.onInput('other');
    eq(p.aiTried, false, '★ 换词 = 新一轮，"问过 AI"跟着归零（不能拿上一轮的结论说给新词听）');
    p.close();

    assert(/\{\{ aiHint \}\}/.test(tpl), '"没找到"那块的第二行交给 aiHint');
    assert(!/aiEnabled \? \$t\('AI 也未能补充这个词/.test(tpl), '不再写死"AI 也未能补充这个词"');
    assert(/\{\{ aiActionText \}\}/.test(tpl), '按钮文案跟着 aiTried 走（aiActionText）');
    assert(/this\.aiTried = true/.test(script), 'aiLookup 里真的把"问过了"记下来');
  }

  console.log('');
  console.log(fail === 0 ? '顶栏随手查词全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
