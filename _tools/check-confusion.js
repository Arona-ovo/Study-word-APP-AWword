// _tools/check-confusion.js - 「易混词教学」校验（真跑模块，不靠静态扫）
//
// 用户原话：
//   「背单词或者句子练习的时候，如果有某个句子或者单词，或者哪两个相似的单词经常搞混，
//     应该在学习的时候弹出界面进行教学 …… 有 AI 的时候才会用该功能，
//     判断用户是否记错和是否多次重复再一个单词记错算法是本地的，
//     只有触发这个算法的时候才启动页面，并且调用 AI 进行解释，同样设置里面可以开关这个。」
//
// 拆成四条契约，逐条守住：
//   1. **判定与计数纯本地**：找"被混进去的那个词"（peer）+ 累计次数，一次网络都不发
//   2. **错够次数才弹**：第一次手滑不算，第二次才算模式；教过之后要再错 REPEAT 次才再教
//   3. **有 AI 才用**：本地开关 + AI 可用 + AI 分项开关，三条缺一就不弹（不做半成品）
//   4. **讲过一次就缓存**：同一对第二次弹是本地直出，不重复烧 token
//
// 另按「漏注入依赖 = 假绿」的纪律：AI 那条路**必须**再验一次错误形态
// （关分项开关 / 没接 AI 时要抛 notConfigured，而不是"静默什么都不做"）。
const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const mem = {};
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  $emit: () => {}, $on: () => {}, $off: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

// ---------- 依赖装配 ----------
const settings = load('utils/settings.js', {}); settings.init();
const config = load('services/config.js', { settings });
const http = load('services/http.js');
const gate = load('services/ai-gate.js', { settings, ServiceError: http.ServiceError });
const lemmaMod = load('utils/lemma.js');

// 可控 LLM mock：behavior 是一条返回 JSON 文本的函数
const llm = { calls: 0, lastUser: '', lastSys: '', behavior: null };
const chat = (messages) => {
  const um = (messages || []).filter(m => m && m.role === 'user').pop();
  const sm = (messages || []).filter(m => m && m.role === 'system').pop();
  llm.lastUser = (um && um.content) || '';
  llm.lastSys = (sm && sm.content) || '';
  llm.calls++;
  const c = typeof llm.behavior === 'function' ? llm.behavior(llm.lastUser) : llm.behavior;
  return Promise.resolve({ content: c == null ? '{}' : c });
};

const aiCache = load('utils/ai-cache.js');
const aiContent = load('services/ai-content.js', {
  aiCache,
  chatCompletion: chat,
  chatCompletionStream: async (ms) => ({ content: (await chat(ms)).content }),
  isAIEnabled: config.isAIEnabled,
  getAIConfig: config.getAIConfig,
  chatEndpoint: config.chatEndpoint,
  ServiceError: http.ServiceError,
  request: () => Promise.reject(new Error('network down')),
  // 真守卫：分项开关被关时要真的抛，脚本第 5 组靠它验错误形态
  aiFeature: gate.ensureFeature,
  breakerKeyOf: () => '',
  resetBreaker: () => {}
});

// 真词书（中文选项要反查词书找词）与真屈折还原（rise/rises 不算搞混）
const words = load('data/words.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  wordIdsOfBook: wordbooks.wordIdsOfBook, setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: () => 0, dateStr: () => ''
});
store.init();
wordbook.ensureShape();

// 假词书：中文反查那条路要让"释义 → 词"可控，真词书里不一定有 rise/rice 这种对
const fakeBook = {
  bookWords: () => ([
    { id: 1, w: 'rise', pos: 'v.', m: '上升；升起' },
    { id: 2, w: 'rice', pos: 'n.', m: '米饭；大米' }
  ]),
  currentBookId: () => 'B'
};

const mk = (book) => load('utils/confusion.js', {
  settings,
  wordbook: book || wordbook,
  lemma: lemmaMod.lemma,
  aiGateReason: config.aiGateReason,
  featureOn: gate.featureOn
});

const C = mk();

// 默认把 AI 配成可用，后面第 4 组再逐条关掉验
settings.set({
  ai: {
    enabled: true, provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: 'deepseek-chat'
  }
});
settings.set({ study: { confusionTeach: true } });
C.clear();

/* ---------- 1. 形近判定：只有"长得像"才算搞混，不是所有答错都算 ---------- */
console.log('== 1. 形近判定 alike（不是所有答错都是搞混） ==');
eq(C.alike('rise', 'rice'), true, 'rise / rice 形近');
eq(C.alike('rise', 'raise'), true, 'rise / raise 形近');
eq(C.alike('quite', 'quiet'), true, 'quite / quiet 形近');
eq(C.alike('good', 'food'), true, 'good / food 形近');
eq(C.alike('cat', 'dog'), false, 'cat / dog 不像（只是不会）');
eq(C.alike('apple', 'orange'), false, 'apple / orange 不像');
eq(C.alike('rise', 'rise'), false, '同一个词不算一对');
eq(C.alike('in', 'on'), false, '太短不做形近判定（in / on 差一个字母没有教学价值）');
eq(C.alike('rise', ''), false, '空串不算');

/* ---------- 2. 找"被混进去的那个词" ---------- */
console.log('\n== 2. peerOf：从提交内容里找出搞成的那个词 ==');
const CF = mk(fakeBook);
eq(CF.peerOf('rise', 'rice'), 'rice', '手打拼写：rise 写成 rice');
eq(CF.peerOf('rise', 'Rice'), 'rice', '大小写无关');
eq(CF.peerOf('rise', 'rises'), '', '只是时态写错（屈折还原是同一个词）不算搞混');
eq(CF.peerOf('rise', 'rise'), '', '写对了不算');
eq(CF.peerOf('rise', ''), '', '自评模式拿不到提交内容 → 直接放弃');
eq(CF.peerOf('rise', '米饭；大米'), 'rice', '中文选项：反查词书找出混成了哪个词');
eq(CF.peerOf('rise', '上升；升起'), '', '选的是它自己的释义 → 不算');
eq(CF.peerOf('rise', 'The rice is on the table'), 'rice', '整句翻译：混进去的词藏在句子里');
eq(CF.peerOf('rise', 'The sun rises at six'), '', '整句里是 rises（同一个词）→ 不算');
eq(CF.peerOf('rise', '太阳升起来了'), '', '中文句子反查不到 → 不算（宁可不弹，不瞎弹）');
eq(C.alike('rise', 'rice') && CF.pairKey('rise', 'rice') === CF.pairKey('rice', 'rise'), true, 'pairKey 对称：(rise,rice) 与 (rice,rise) 是同一对');

/* ---------- 3. 累计：错够次数才教，教过之后要再错几次才再教 ---------- */
console.log('\n== 3. 本地累计与阈值（纯本机，不发一次网络） ==');
C.clear();
const n1 = C.note('rise', 'rice');
eq(n1 && n1.n, 1, '第一次记一笔');
eq(n1 && n1.should, false, '第一次不算"经常搞混"（可能只是手滑）');
const n2 = C.note('rise', 'rice');
eq(n2 && n2.n, 2, '第二次记一笔');
eq(n2 && n2.should, true, '第二次 → 该教了');
eq(C.shouldTeach('rise', 'rice'), true, 'shouldTeach 同一口径');
// 教过一次
C.markTaught('rise', 'rice', { diff: 'rise 是上升，rice 是米饭', tips: '', examples: [] });
eq(C.shouldTeach('rise', 'rice'), false, '刚教过 → 不再弹（不能每题都打断）');
eq(!!C.teachOf('rise', 'rice'), true, '讲解存进了本机（下次直接出）');
C.note('rise', 'rice');
C.note('rise', 'rice');
eq(C.shouldTeach('rise', 'rice'), false, '教过后又错 2 次 → 还不够（REPEAT=3）');
const n5 = C.note('rise', 'rice');
eq(n5 && n5.n, 5, '第 5 次');
eq(n5 && n5.should, true, '教过后又错满 3 次 → 真的反复忘，值得再讲一遍');
// 反向顺序：把 rice 写成 rise 是同一对
const rev = C.note('rice', 'rise');
eq(rev && rev.key, n1 && n1.key, '反着错记的是同一对');
// 不构成混淆的答错不该记账
const before = C.stats().pairs;
eq(C.note('rise', 'apple'), null, '写了个毫不相干的词 → 不记账');
eq(C.stats().pairs, before, '账上没有多出这一对');

console.log('\n== 3b. 真落盘（换实例 = 重启 App 还在） ==');
const C2 = mk();
C2.init();
eq(C2.stats().pairs, C.stats().pairs, '换个实例仍读到同一份账（真的写进 storage）');
eq(!!C2.teachOf('rise', 'rice'), true, '讲解也跟着落盘了');
eq(C2.shouldTeach('rise', 'rice'), C.shouldTeach('rise', 'rice'), '计数一并落盘（重启不会把阈值重新数一遍）');

console.log('\n== 3c. 上限淘汰 ==');
C.clear();
// 210 对：a = z??x、b = z??y（编辑距离 1，长度 4 → 0.25 ≤ 0.4，稳过形近判定）
for (let i = 0; i < 210; i++) {
  const p = String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
  C.note('z' + p + 'x', 'z' + p + 'y');
}
const st = C.stats();
assert(st.pairs <= st.max && st.pairs >= st.max - 10,
  '超过 ' + st.max + ' 对会淘汰最久没错的（现在 ' + st.pairs + '）');
C.clear();
eq(C.stats().pairs, 0, 'clear() 清空整本账');

/* ---------- 4. 三条开关：有 AI 才用 ---------- */
console.log('\n== 4. enabled()：本地开关 + AI 可用 + AI 分项开关，缺一不弹 ==');
C.clear();
eq(config.aiGateReason(), '', 'AI 配好了（前置条件）');
eq(C.enabled(), true, '三条都满足 → 可用');
settings.set({ study: { confusionTeach: false } });
eq(C.enabled(), false, '设置里关掉 → 不弹');
eq(C.localOn(), false, '本地开关读到 false');
settings.set({ study: { confusionTeach: true } });
eq(C.enabled(), true, '打开回来 → 恢复');
gate.setFeature('confusion', false);
eq(C.enabled(), false, 'AI 分项开关关掉 → 不弹');
gate.setFeature('confusion', true);
eq(C.enabled(), true, '分项开关打开回来 → 恢复');
settings.set({ ai: { apiKey: '' } });
eq(C.enabled(), false, 'AI 没配好 → 不弹（不做半成品）');
settings.set({ ai: { apiKey: 'sk-1234567890' } });
eq(C.enabled(), true, '配好回来 → 恢复');
// 关掉开关时账照记：以后打开立刻能看到历史
settings.set({ study: { confusionTeach: false } });
C.note('rise', 'rice');
eq(C.stats().pairs, 1, '开关关掉时账照记（只是不打扰）');
settings.set({ study: { confusionTeach: true } });
C.clear();

/* ---------- 5. AI 辨析：真解析 + 错误形态 ---------- */
console.log('\n== 5. explainConfusion：真解析 ==');
const GOOD = JSON.stringify({
  a: { word: 'rise', pos: 'v.', meaning: '上升；升起' },
  b: { word: 'rice', pos: 'n.', meaning: '米饭；大米' },
  diff: 'rise 是动词"上升"，rice 是名词"米饭"，一个讲动作一个讲食物',
  tips: 'ri**s**e 里有 s，想成 sun 升起来',
  examples: [
    { en: 'The sun rises at six.', zh: '太阳六点升起。', use: 'a' },
    { en: 'I eat rice every day.', zh: '我每天吃米饭。', use: 'b' },
    { en: 'This one is extra.', zh: '这条多余，应被砍掉', use: 'a' }
  ]
});

(async function main() {
  llm.behavior = () => GOOD;
  llm.calls = 0;
  const r = await aiContent.explainConfusion('rise', 'rice', { meaningA: '上升', meaningB: '米饭' });
  eq(r.a.word, 'rise', 'a = 本该用的那个词');
  eq(r.b.meaning, '米饭；大米', 'b 的释义');
  assert(r.diff.indexOf('米饭') >= 0, '核心区别讲出来了');
  eq(r.examples.length, 2, '例句恰好 2 条（多的砍掉）');
  eq(r.examples[0].use, 'a', '第一条标 a');
  eq(r.examples[1].use, 'b', '第二条标 b');
  assert(llm.lastUser.indexOf('rise') >= 0 && llm.lastUser.indexOf('rice') >= 0, '提示词里带上了两个词');
  assert(llm.lastUser.indexOf('上升') >= 0, '本地已知释义也带上了（免得模型把两个词讲反）');
  assert(/JSON/.test(llm.lastSys), 'system 提示词要求返回 JSON');

  console.log('\n== 5b. 错误形态（漏注入依赖 = 假绿，必须验） ==');
  // ① 模型返回空 → 抛可降级错误，页面照旧能显示本地那两条释义
  llm.behavior = () => JSON.stringify({ a: {}, b: {}, diff: '', tips: '' });
  let e1 = null;
  try { await aiContent.explainConfusion('rise', 'rice', {}); } catch (e) { e1 = e; }
  assert(!!e1, '内容为空 → 抛错（不能返回一张空卡片）');
  assert(!!(e1 && e1.degradable), '空内容是可降级错误（页面能兜底）');

  // ② 分项开关关掉 → 必须真的抛，而不是静默什么都不做
  gate.setFeature('confusion', false);
  llm.behavior = () => GOOD;
  let e2 = null;
  try { await aiContent.explainConfusion('rise', 'rice', {}); } catch (e) { e2 = e; }
  assert(!!e2, '「易混词辨析」关掉 → 抛错（这条路必须真的被守住）');
  assert(!!(e2 && e2.notConfigured), '关分项开关 = notConfigured（页面显示"这项被关了"而不是"出错了"）');
  gate.setFeature('confusion', true);

  // ③ AI 没启用 → notConfigured
  settings.set({ ai: { apiKey: '' } });
  let e3 = null;
  try { await aiContent.explainConfusion('rise', 'rice', {}); } catch (e) { e3 = e; }
  assert(!!(e3 && e3.notConfigured), 'AI 没启用 → notConfigured');
  settings.set({ ai: { apiKey: 'sk-1234567890' } });

  // ④ 缺词 → 直接抛，不浪费一次调用
  const before4 = llm.calls;
  let e4 = null;
  try { await aiContent.explainConfusion('rise', '', {}); } catch (e) { e4 = e; }
  assert(!!e4, '只有一个词 → 抛错');
  eq(llm.calls, before4, '不合规的输入不发请求（不烧冤枉 token）');

  /* ---------- 6. 组件真跑 ---------- */
  console.log('\n== 6. confusion-card 组件 ==');
  const ccSrc = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(read('components/confusion-card/confusion-card.vue')) || [])[1] || '';
  const CC = loadCode(ccSrc, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    confusion: C,
    explainConfusion: aiContent.explainConfusion
  }, 'confusion-card.vue').default;

  function mount(props) {
    const ctx = Object.assign({}, CC.data(), CC.methods, props || {});
    ctx.$emit = (name, arg) => { (ctx.__emits = ctx.__emits || []).push(name); ctx.__lastArg = arg; };
    Object.keys(CC.computed || {}).forEach(k => {
      Object.defineProperty(ctx, k, { get: () => CC.computed[k].call(ctx), configurable: true });
    });
    return ctx;
  }

  // ① 没缓存 → 调一次模型，讲完存进本机账
  C.clear();
  llm.behavior = () => GOOD;
  llm.calls = 0;
  const c1 = mount({ show: true, a: 'rise', b: 'rice', meaningA: '上升', meaningB: '米饭', times: 2 });
  await c1.load();
  eq(llm.calls, 1, '第一次弹 → 调一次模型');
  eq(c1.loading, false, '拿到结果后转出加载态');
  assert(!!c1.teach && c1.teach.diff, '讲解拿到了');
  eq(c1.sideA.word, 'rise', '左栏是本该用的那个词');
  eq(c1.sideB.word, 'rice', '右栏是搞成的那个词');
  eq(c1.sideB.meaning, '米饭；大米', '释义用 AI 给的（覆盖本地那条短的）');
  eq(c1.exList.length, 2, '两句例句');
  assert(c1.exList[0].useText.indexOf('rise') >= 0, '例句标注用的是哪个词');
  assert(c1.timesText.indexOf('2') >= 0, '告诉用户这一对错了几次');
  eq(!!C.teachOf('rise', 'rice'), true, '讲完存进本机账（下次本地直出）');

  // ② 第二次弹 → 缓存命中，一次请求都不发
  llm.calls = 0;
  const c2 = mount({ show: true, a: 'rise', b: 'rice', meaningA: '上升', meaningB: '米饭', times: 2 });
  await c2.load();
  eq(llm.calls, 0, '第二次弹 → 缓存命中，不再烧 token（假绿陷阱：这里最容易写成"没调用就算对"）');
  assert(!!c2.teach && c2.teach.diff, '缓存的讲解照样显示出来');

  // ③ 模型失败 → 报错，但两个本地释义照旧摆着
  C.clear();
  llm.behavior = () => 'not json at all';
  const c3 = mount({ show: true, a: 'rise', b: 'rice', meaningA: '上升；升起', meaningB: '米饭；大米' });
  await c3.load();
  assert(!!c3.err, '失败时给出失败态（不能一直转圈）');
  eq(c3.err === 'no-ai', false, '这次不是"没接 AI"，按普通失败提示');
  eq(c3.sideA.meaning, '上升；升起', '失败时本地释义照旧显示（卡片不是白板的）');
  eq(c3.sideB.meaning, '米饭；大米', '另一条也在');

  // ④ 没接 AI（notConfigured）→ 单独一句提示，别让人以为 App 坏了
  C.clear();
  gate.setFeature('confusion', false);
  const c4 = mount({ show: true, a: 'rise', b: 'rice', meaningA: '上升；升起', meaningB: '米饭；大米' });
  await c4.load();
  eq(c4.err, 'no-ai', '没接 AI / 这项被关 → 走专门的那句提示');
  assert(c4.errText.indexOf('AI') >= 0, '提示里说清是 AI 的问题');
  gate.setFeature('confusion', true);

  // ⑤ 本地没释义也不能显示空白
  C.clear();
  const c5 = mount({ show: true, a: 'rise', b: 'rice' });
  await c5.load();
  assert(!!c5.sideA.meaning && c5.sideA.meaning !== '', '本地也没释义时给占位文案（不留空白）');

  // ⑥ 按钮：点遮罩只关，点「下一个」交给父页面继续
  const c6 = mount({ show: true, a: 'rise', b: 'rice' });
  c6.__emits = [];
  c6.onMaskTap();
  c6.onNext();
  eq((c6.__emits || []).join(','), 'close,next', '遮罩 = close，「下一个」= next（父页面接着往下走）');

  /* ---------- 7. 两个练习页的接入契约 ---------- */
  console.log('\n== 7. 练习页接入 ==');
  [['practice', 'pkgStudy/pages/practice/practice.vue'],
    ['word-drill', 'pkgStudy/pages/word-drill/word-drill.vue']].forEach(function (pair) {
    const name = pair[0];
    const p = read(pair[1]);
    assert(/import ConfusionCard from '\.\.\/\.\.\/\.\.\/components\/confusion-card\/confusion-card\.vue'/.test(p),
      name + ' 引入教学卡组件');
    assert(/import \* as confusion from '\.\.\/\.\.\/\.\.\/utils\/confusion\.js'/.test(p),
      name + ' 引入本地判定模块');
    assert(/components:\s*\{[^}]*\bConfusionCard\b[^}]*\}/.test(p), name + ' 注册组件');
    assert(/<confusion-card[\s\S]{0,400}?@next="nextAfterConfusion"/.test(p),
      name + ' 卡片上的「下一个」接着往下练');
    assert(/maybeTeachConfusion\(/.test(p), name + ' 有本地判定的入口');
    assert(/if \(!confusion\.enabled\(\)\) return false/.test(p),
      name + ' 弹卡前先过 enabled()（没接 AI / 开关关掉就不弹）');
    assert(/const hit = confusion\.note\(/.test(p), name + ' 记账走 confusion.note（本机）');
    assert(/if \(!hit \|\| !hit\.should\) return false/.test(p), name + ' 没到阈值就什么都不做');
    // 只答错才判：答对的那条路径不该走
    const fin = p.slice(p.indexOf('let taught = false'));
    assert(/status === 'fail'/.test(fin.slice(0, 400)), name + ' 只有答错才做易混判定');
    // 弹了卡就不要再排朗读定时器，两个声音叠着谁也听不清
    assert(/if \(!taught\)[\s\S]{0,200}?answerTimer = setTimeout/.test(p),
      name + ' 弹了教学卡就不排朗读（不叠声音）');
    assert(/nextAfterConfusion\(\)[\s\S]{0,160}?this\.next\(\)/.test(p),
      name + '「下一个」真的进下一题');
  });

  // 句子练习的目标词是 q.words[0]；刷单词是 item.w —— 两处取词口径不同，各自断言
  assert(/const w0 = q\.words && q\.words\[0\]/.test(read('pkgStudy/pages/practice/practice.vue')),
    'practice 的目标词取 q.words[0]（句子翻译里的考点词）');
  assert(/status === 'fail' && theWord/.test(read('pkgStudy/pages/word-drill/word-drill.vue')),
    'word-drill 的目标词取当前条目 theWord（拼写的就是它本身）');

  /* ---------- 8. 设置页开关 ---------- */
  console.log('\n== 8. 设置页开关 ==');
  assert(/confusionTeach:\s*true/.test(read('utils/settings.js')), 'settings 默认开启（study.confusionTeach）');
  const sv = read('pkgManage/pages/settings/settings.vue');
  assert(/import \* as confusion from '\.\.\/\.\.\/\.\.\/utils\/confusion\.js'/.test(sv),
    '设置页引入 confusion');
  assert(/:checked="studyTeachOn"/.test(sv), '开关接在 computed 上');
  assert(/setStudy\('confusionTeach', e\.detail\.value\)/.test(sv), '开关写 study.confusionTeach');
  assert(/setStudy\(key, value\)[\s\S]{0,200}?settings\.set\(\{ study: patch \}\)/.test(sv),
    'setStudy 显式写值（深合并删 key 无效，必须写 true/false）');
  assert(/confusion\.stats\(\)\.pairs/.test(sv), '显示本机记了多少对');
  assert(/studyTeachOn\(\)[\s\S]{0,160}?!== false/.test(sv), '默认开（undefined 当开）');
  assert(/secHint\('study'\)|k === 'study'/.test(sv), '收起时也能看到开关状态');

  // 真跑一遍默认与关闭
  const setFresh = load('utils/settings.js', {});
  setFresh.init();
  eq(setFresh.defaults().study.confusionTeach, true, 'settings 默认值真的是 true（不是只看源码）');
  setFresh.set({ study: { confusionTeach: false } });
  eq(setFresh.get().study.confusionTeach, false, '关掉能写进去');
  setFresh.set({ study: { confusionTeach: true } });
  eq(setFresh.get().study.confusionTeach, true, '深合并下"删 key 无效"→ 打开必须显式写 true');

  // AI 功能清单里登记了这一项（设置页 UI 才会出现）
  assert(gate.AI_FEATURES.some(f => f.key === 'confusion'), 'ai-gate 登记了 confusion 分项开关');

  console.log('');
  console.log(fail === 0 ? '易混词教学校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
