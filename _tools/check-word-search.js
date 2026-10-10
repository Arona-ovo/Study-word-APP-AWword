// _tools/check-word-search.js - 练习 / 刷单词顶栏「随手查词」校验（只读 + 真跑组件方法）
//
// A. components/word-search（把组件 <script> 真加载起来跑）
//   1) 题没答完（locked）点顶栏 → 只给一句解释，不进搜索态（否则等于把答案摆在手边）
//   2) 答完了点 → 进搜索态并把输入框抢过来（弹键盘）
//   3) 已经开着搜索时再点一次 → 重新抢焦点（键盘被点掉后还能接着输）
//   4) 本地**一模一样**命中 → 不再问 AI（省额度）；只有近似命中 / 没命中才排 AI 兜底
//   5) 「没找到」只在本地 / 缓存 / AI 三条路全空时才说 —— AI 转圈期间不许先闪一句"没有"
//   6) 空输入 → 结果与 lastQuery 一起清掉
//   7) AI 回来时输入已经换词 → 结果不贴到界面上（防串词）
//   8) 点结果 → 进单词详情页（w + book）
//   9) close 收干净：清 AI 定时器、清关键词、让顶栏失焦
// B. 两个练习页的接入契约
//   - 主分支顶栏换成 <word-search>，锁定态由 canSearch 给
//   - canSearch 口径：practice 还要排除"目标词确认关进行中"（那一关考的就是词义）
//   - onShow 收面板（从词条页返回）、onUnload 关搜索（别让 AI 定时器跑到页面外面）
const { loadCode } = require('./lib/load');
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

const COMP = loadCode(script, {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  search: { localSearch: (bid, kw, limit) => stubs.local(bid, kw, limit) },
  aiCache: { findWord: (w) => stubs.cache(w), sentencesOf: () => [] },
  aiGateReason: () => (stubs.aiOn ? '' : '未配置 AI'),
  explainWord: (q) => stubs.explain(q),
  FloatNavbar: {}
}, 'word-search.vue').default;

assert(!!COMP && typeof COMP.data === 'function', '组件脚本可加载（导出 default）');

function mount(props) {
  const ctx = Object.assign({}, COMP.data(), COMP.methods, props || {});
  ctx.$nextTick = (fn) => fn();          // 同步执行：断言里不用等
  ctx.__blurred = false;
  ctx.$refs = { navbar: { blurInput: () => { ctx.__blurred = true; } } };
  Object.keys(COMP.computed || {}).forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => COMP.computed[k].call(ctx), configurable: true });
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
  eq(c.__limit, 8, '本地最多列 8 条（这是做题中间抬头看一眼，不是词库检索页）');

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
  eq(pend.emptyState, false, 'AI 还在路上时不显示"没找到"（否则先闪一下"没有"又冒出结果）');
  releaseAi(null);                        // AI 也没查到这个词
  await flying;
  eq(pend.aiLoading, false, '请求结束 → 转圈收掉');
  eq(pend.aiResult, null, 'AI 也给不出东西');
  eq(pend.emptyState, true, '本地 / 缓存 / AI 全空 → 这时才说"没找到"');
  pend.close();
  stubs.explain = (q) => ({ word: q, pos: 'v.', meaningZh: '释义-' + q, examples: [{ en: 'e', zh: 'z' }] });

  console.log('\n== 6. 空输入：结果与 lastQuery 一起清掉 ==');
  const blank = mount({ locked: false, bookId: 'B' });
  blank.onInput('apple');
  blank.onInput('   ');
  eq(blank.results.length, 0, '结果清空');
  eq(blank.lastQuery, '', 'lastQuery 清空');
  assert(blank.timer === 0, '没有挂着的 AI 定时器');

  console.log('\n== 7. AI 补充：只展示，输入换了词就不贴 ==');
  const ai = mount({ locked: false, bookId: 'B' });
  ai.onInput('zzzz');
  if (ai.timer) { clearTimeout(ai.timer); ai.timer = 0 }
  await ai.aiLookup('zzzz');
  eq(ai.aiResult && ai.aiResult.word, 'zzzz', 'AI 结果贴上来');
  eq(ai.aiLoading, false, '转圈收掉');
  eq(ai.emptyState, false, '有 AI 结果就不显示"没找到"');
  ai.onInput('yyyy');
  if (ai.timer) { clearTimeout(ai.timer); ai.timer = 0 }
  ai.aiResult = null;
  await ai.aiLookup('zzzz');
  eq(ai.aiResult, null, '输入已经换词 → 旧结果不许贴到界面上（防串词）');
  ai.close();

  console.log('\n== 8. 点结果 → 单词详情页 ==');
  navs.length = 0;
  const go = mount({ bookId: 'fj_zsb_core' });
  go.openWord({ w: ' Improve ' });
  eq(navs.length, 1, '发起一次跳转');
  eq(navs[0], '/pkgManage/pages/word-detail/word-detail?w=improve&book=fj_zsb_core',
    'URL（词形小写 + 带当前词书）');
  navs.length = 0;
  go.openWord({ w: '' });
  eq(navs.length, 0, '空词不跳');

  console.log('\n== 9. close：收干净 ==');
  const cl = mount({ locked: false, bookId: 'B' });
  cl.onInput('zzzz');
  cl.close();
  eq(cl.active, false, '退出搜索态');
  eq(cl.keyword, '', '关键词清空');
  eq(cl.lastQuery, '', 'lastQuery 清空');
  eq(cl.results.length, 0, '结果清空');
  eq(cl.aiResult, null, 'AI 结果清空');
  eq(cl.__blurred, true, '让顶栏失焦（胶囊还原成标题）');

  console.log('\n== 10. 顶栏契约（组件挂在 float-navbar 上） ==');
  assert(/searchable/.test(tpl), '传了 searchable（非搜索态右侧有放大镜入口）');
  assert(/:search-locked="locked"/.test(tpl), '锁定态透传给顶栏（放大镜置灰，而不是藏起来）');
  assert(/@title-tap="open"/.test(tpl), '点标题 → open()');
  assert(/keep-keyboard/.test(tpl), '点别处不主动收键盘（滚结果时键盘不闪）');
  assert(/:autofocus="autofocus"/.test(tpl), '焦点由组件控制（打开即弹键盘）');

  console.log('\n== 11. 两个练习页的接入契约 ==');
  [['practice', 'pkgStudy/pages/practice/practice.vue'],
    ['word-drill', 'pkgStudy/pages/word-drill/word-drill.vue']].forEach(function (pair) {
    const name = pair[0];
    const p = fs.readFileSync(path.join(ROOT, pair[1]), 'utf8').replace(/\r\n/g, '\n');
    assert(/import WordSearch from '\.\.\/\.\.\/\.\.\/components\/word-search\/word-search\.vue'/.test(p),
      name + ' 引入 word-search 组件');
    assert(/components:\s*\{\s*FloatNavbar,\s*WordSearch\s*\}/.test(p), name + ' 注册组件');
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

  console.log('');
  console.log(fail === 0 ? '顶栏随手查词全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
