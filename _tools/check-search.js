// _tools/check-search.js - 校验首页顶部搜索的检索与入库逻辑（只读）
// 核心断言：
//   - 本地检索：当前词书（内置词 + 该书导入词）优先，命中词形或中文释义
//   - 词书无命中时回落到 dict.lookup（常用词典 / 词形还原），并给出来源标签
//   - AI 补充的词通过导入管道写进「当前词书」：去重、id 规则、例句回写
//   - 重复 / 非法词形不会重复入库，并返回可读原因
const fs = require('fs');
const path = require('path');
const { load, loadCode, ROOT } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  // onShow 里会 emit('home:refresh')；openWord 走 navigateTo（第 18 组会临时换掉它）
  $emit: () => {},
  navigateTo: () => {},
  switchTab: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}
function assert(cond, label) { if (cond) ok(label); else bad(label); }

// ---------- 装载真实模块 ----------
const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wb.getBook, wordbook, lemma: lemma.lemma
});
const aiCache = load('utils/ai-cache.js');
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemma.lemma,
  chatCompletion: () => Promise.reject(new Error('no ai in test'))
});
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma,
  // ownerLabel 用到的两个（本脚本暂时不测它，但依赖袋不能空着 —— 少一个要等调用期才炸）
  wordbook, getBook: wb.getBook
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});
const search = load('utils/search.js', { wordbook, dict, importer });

const CORE = 'fj_zsb_core';
const INBOX = 'custom_inbox';

console.log('== 1. 空关键词 / 空白串不检索 ==');
eq(search.localSearch(CORE, '').length, 0, 'localSearch(空串) 条数');
eq(search.localSearch(CORE, '   ').length, 0, 'localSearch(空格) 条数');

console.log('== 2. 当前词书命中：英文词形（大小写不敏感） ==');
const first = wordbook.bookWords(CORE)[0];
const byWord = search.localSearch(CORE, first.w.toUpperCase());
eq(byWord.length > 0, true, '命中大写的 ' + first.w);
eq(byWord[0].w, first.w, '返回原词形');
eq(byWord[0].fromText, '当前词书', '来源标签 = 当前词书');

console.log('== 3. 当前词书命中：中文释义 ==');
const zh = String(first.m || '').split(/[；;，,]/)[0];
const byZh = search.localSearch(CORE, zh);
eq(byZh.length > 0, true, '按释义「' + zh + '」命中');
eq(byZh.some(x => x.w === first.w), true, '命中结果含该词');

console.log('== 4. 结果上限 20 条 ==');
const broad = search.localSearch(CORE, 'a');
eq(broad.length <= 20, true, '宽泛查询返回条数 ≤ 20');

console.log('== 4.5 短查询：包含命中再多，也不能把真正的那个词挤掉 ==');
// 回归点（用户实测）：搜 "in" 时词书里有 268 条"含 in"的词（insurance / engine /
// criminal / institute…）。以前 localSearch **只在零命中时**才回落词典，
// 于是词典里那条真 "in"（常用词，在……里）被整块跳过 —— 用户看到一堆都不是他要的，
// 想查的 "in" 一条都没有，回车也没反应，还没法把它加进词书。
const inRows = search.localSearch(CORE, 'in');
assert(inRows.length > 0, '搜 "in" 有本地结果：' + inRows.length + ' 条');
eq(inRows[0].w.toLowerCase(), 'in', '第一条必须就是 "in" 本身');
eq(inRows[0].fromText, '常用词', '"in" 不在当前词书里 → 标成词典来源（常用词）');
assert(/在/.test(inRows[0].m || ''), '带上真实释义：' + inRows[0].m);
assert(inRows.filter(r => r.w.toLowerCase() === 'in').length === 1, '同一个词只出现一条（不重复）');
// 排序：以查询开头的（institute / initial）排在"中间含 in"的（engine / criminal / chain）之前。
// 只看前 5 条：名额有限的时候，先给最可能是他要的那些。
const in5 = search.localSearch(CORE, 'in', 5);
eq(in5.length, 5, '按 limit 截断：' + in5.map(r => r.w).join(' / '));
assert(in5.slice(1).every(r => /^in/i.test(r.w)),
  '第 2 条起都是"以 in 开头"的词，而不是中间含 in 的：' + in5.slice(1).map(r => r.w).join(' / '));

console.log('== 5. 词书无命中 → 回落 dict（常用词典/词形还原） ==');
const fallback = search.localSearch(CORE, 'Serendipity');
if (fallback.length) {
  ok('词典兜底命中：' + fallback[0].w + '（' + fallback[0].fromText + '）');
  eq(typeof fallback[0].fromText === 'string' && fallback[0].fromText.length > 0, true, '兜底结果带来源标签');
} else {
  ok('词典兜底未命中（该词不在常用词典，属正常）');
}
eq(search.localSearch(CORE, 'zzzzqqqqxxxx').length, 0, '乱码查询返回 0 条');

console.log('== 6. 只检索「当前词书」：别的词书的导入词不串味 ==');
const vd = importer.validateAndDedupe([{ word: 'gumption', pos: 'n.', meaning: '进取心' }], INBOX);
importer.importIntoBook(vd.accepted, INBOX);
eq(search.localSearch(CORE, 'gumption').length, 0, '核心词书搜不到 inbox 的导入词');
eq(search.localSearch(INBOX, 'gumption').length, 1, 'inbox 能搜到自己的导入词');
eq(search.localSearch(INBOX, 'gumption')[0].fromText, '当前词书', '导入词来源标签 = 当前词书');

console.log('== 7. AI 补充入库：新词写进当前词书 ==');
wordbook.switchBook(CORE);
const before = wordbook.bookVocab(CORE, 'all').total;
const r1 = search.addWordToBook(CORE, {
  word: 'photosynthesis',
  pos: 'n.',
  meaning: '光合作用',
  example: { en: 'Plants rely on photosynthesis to grow.', zh: '植物依靠光合作用生长。' }
});
eq(r1.added, true, 'addWordToBook(新词).added');
eq(r1.reason, '', 'addWordToBook(新词).reason 为空');
const after = wordbook.bookVocab(CORE, 'all').total;
eq(after, before + 1, '词汇明细总数 +1');
eq(search.localSearch(CORE, 'photosynthesis').length, 1, '入库后立刻能被本地搜到');

console.log('== 8. 例句回写（复用 AI 返回的例句，不再单独请求） ==');
const cw = importer.customWordsOf(CORE).filter(w => w.word === 'photosynthesis')[0];
eq(!!cw, true, '自定义词记录存在');
eq(cw && cw.exampleEn, 'Plants rely on photosynthesis to grow.', 'exampleEn 已回写');
eq(cw && cw.exampleZh, '植物依靠光合作用生长。', 'exampleZh 已回写');
eq(!!(cw && cw.exampleSid), true, 'exampleSid 已标记（练习页可直接使用）');

console.log('== 9. 重复入库被拦截，并给出可读原因 ==');
const r2 = search.addWordToBook(CORE, { word: 'photosynthesis', pos: 'n.', meaning: '光合作用' });
eq(r2.added, false, '第二次加入 .added');
eq(/已存在|重复/.test(r2.reason), true, '原因含「已存在」：' + r2.reason);
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '总数未重复增长');

console.log('== 10. 非法词形被拦截 ==');
const r3 = search.addWordToBook(CORE, { word: '光合作用', pos: 'n.', meaning: 'plants' });
eq(r3.added, false, '中文词形 .added');
eq(r3.reason.length > 0, true, '中文词形给出原因：' + r3.reason);
const r4 = search.addWordToBook(CORE, { word: '', pos: '', meaning: '' });
eq(r4.added, false, '空词形 .added');
const r5 = search.addWordToBook(CORE, { word: 'ok', pos: '', meaning: '' });
eq(r5.added, false, '缺释义 .added');
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '非法词未污染词库');

console.log('== 11. 未接 AI 时：只走本地，行为不变 ==');
// 页面侧逻辑：本地无命中且 aiEnabled=false 时不触发 AI 请求（此处只验证本地结果）
eq(search.localSearch(CORE, 'quintessential').length >= 0, true, '本地检索不抛异常');

console.log('== 12. 切词书后，补充的词落在切换后的当前词书 ==');
const newId = wordbook.createUserBook('搜索测试书', '单测');
wordbook.switchBook(newId);
const r6 = search.addWordToBook('', { word: 'ephemeral', pos: 'adj.', meaning: '短暂的' });
eq(r6.added, true, '空 bookId 时写入当前词书');
eq(wordbook.bookVocab(newId, 'all').total, 1, '新词书明细 = 1');
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '核心词书未受影响');
eq(search.localSearch(newId, 'ephemeral').length, 1, '新词书可搜到');
eq(search.localSearch(CORE, 'ephemeral').length, 0, '核心词书搜不到（按书隔离）');
wordbook.deleteUserBook(newId);
wordbook.switchBook(CORE);

console.log('== 13. "[object Object]" 不能进词库（也不能被当成搜索词） ==');
// 成因：搜索框在部分端拿到的不是字符串，String(v) 后变成 "[object Object]"，
// 被当待查词交给 AI，生成结果又被写进词库 —— 词库里就多出一个怪词条
const r7 = search.addWordToBook(CORE, { word: '[object Object]', pos: '', meaning: 'x' });
eq(r7.added, false, '垃圾词形不入库');
eq(search.localSearch(CORE, '[object Object]').length, 0, '垃圾词形检索不到');

// 万一历史版本已经写进去过：启动时的清理要能把它捞出来
const jb = wordbook.createUserBook('垃圾清理测试', '单测');
const st = store.get();
st.customWords[jb] = [
  { id: 'j1', word: '[object Object]', pos: '', meaning: 'x' },
  { id: 'j2', word: 'legitimate', pos: 'n.', meaning: '合理的' }
];
store.save(st);
eq(wordbook.bookWords(jb).length, 2, '清理前 2 条');
eq(wordbook.purgeJunkWords(), 1, 'purgeJunkWords 删掉 1 条垃圾');
eq(wordbook.bookWords(jb).length, 1, '清理后剩 1 条');
eq(wordbook.bookWords(jb)[0].w, 'legitimate', '正常单词未被误伤');
// "object" 是正经英文单词，不能被规则误删
st.customWords[jb] = [{ id: 'j3', word: 'object', pos: 'n.', meaning: '物体' }];
store.save(st);
eq(wordbook.purgeJunkWords(), 0, '"object" 不受影响');
eq(wordbook.bookWords(jb).length, 1, 'object 仍在');
// 幂等：再跑一次不会越删越少
eq(wordbook.purgeJunkWords(), 0, '重复清理幂等');
wordbook.deleteUserBook(jb);

console.log('== 14. 输入值归一化：非字符串不能变成搜索词 ==');
// 页面侧 pickText 的契约（home.vue）：事件对象 / {value} / null 都要能抠出字符串
const homeSrc = fs.readFileSync(path.join(ROOT, 'pages', 'home', 'home.vue'), 'utf8');
assert(/pickText\(v\)/.test(homeSrc), 'home.vue 有 pickText');
assert(/JUNK_TEXT\.test\(kw\)/.test(homeSrc), 'onSearchInput 拦掉 [object 开头');
assert(/WORDISH\.test\(q\)/.test(homeSrc), 'aiLookup 只问"像单词"的串');
assert(!/onSearchInput\(String\(/.test(homeSrc), '不再用 String(v) 直接当关键词');
const nbSrc = fs.readFileSync(path.join(ROOT, 'components', 'float-navbar', 'float-navbar.vue'), 'utf8');
assert(/pickValue\(e\)/.test(nbSrc), 'float-navbar 有 pickValue');
assert(!/\$emit\('search', e\.detail\.value\)/.test(nbSrc), '不再裸取 e.detail.value');

console.log('== 15. allowKnown：词典里已有的词也能收进别的词书 ==');
// 单词详情页「加入词书」要同时服务两类词：AI 补充的新词 + 词典里原有的词。
// 后者在默认导入管道里会被判成「已存在（去重）」，所以详情页走 allowKnown，
// 只按目标词书自身去重 —— 同一个词可以属于多本书，但不能在同一本书里重复。
const core0 = words.WORDS[0].w;
const r8 = search.addWordToBook(CORE, { word: core0, pos: 'v.', meaning: '测试释义' });
eq(r8.added, false, '默认管道：核心词不重复导入核心词书（' + r8.reason + '）');
const r9 = search.addWordToBook(CORE, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r9.added, false, 'allowKnown 也不重复塞回同一本书');
const ub2 = wordbook.createUserBook('加入词书测试', '单测');
const r10 = search.addWordToBook(ub2, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r10.added, true, 'allowKnown：核心词可收进另一本书');
eq(search.localSearch(ub2, core0).length, 1, '新书里能搜到这个词');
const r11 = search.addWordToBook(ub2, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r11.added, false, '同一本书不重复收录');
eq(wordbook.bookVocab(ub2, 'all').total, 1, '新书词汇数仍为 1');
wordbook.deleteUserBook(ub2);
// 非法词形在 allowKnown 下依旧要被拦住
const r12 = search.addWordToBook(CORE, { word: '光合作用', pos: 'n.', meaning: 'x' }, { allowKnown: true });
eq(r12.added, false, 'allowKnown 下中文词形仍被拦');
const r13 = search.addWordToBook(CORE, { word: '[object Object]', pos: '', meaning: 'x' }, { allowKnown: true });
eq(r13.added, false, 'allowKnown 下垃圾词形仍被拦');

console.log('== 16. AI 补充的词不自动进词书（归属权在用户） ==');
// home.vue 以前在 aiLookup 里顺手 addWordToBook，导致搜过一次的词全塞进核心词书。
// 现在 explainWord 只写 aiCache，词书要不要收由单词详情页的「加入词书」决定。
const homeSrc2 = fs.readFileSync(path.join(ROOT, 'pages', 'home', 'home.vue'), 'utf8');
// 只取 aiLookup 方法体（注释里的"以前会…"会干扰正则，先剥掉行注释）
const aiIdx = homeSrc2.indexOf('aiLookup(kw)');
assert(aiIdx > 0, '定位到 aiLookup 方法');
const aiBlock = homeSrc2.slice(aiIdx, aiIdx + 2000).replace(/\/\/[^\n]*/g, '');
assert(aiBlock.indexOf('async aiLookup') === 0 || aiBlock.indexOf('aiLookup(kw)') >= 0,
  '取到 aiLookup 方法体（' + aiBlock.length + ' 字符）');
assert(!/addWordToBook\s*\(/.test(aiBlock), 'aiLookup 不再调用 addWordToBook');
assert(!/addToBook\s*\(/.test(aiBlock), 'aiLookup 不再调用 addToBook');
assert(/aiCache\.findWord/.test(aiBlock), 'AI 结果只落本机缓存（aiCache）');
assert(/本机缓存 · 未加入词书/.test(homeSrc2), '角标文案说明「未加入词书」');
assert(/点开词条可加入词书/.test(homeSrc2), '提示用户去词条页加入');
assert(/class="sr-ai"[^>]*@tap="openWord/.test(homeSrc2), 'AI 结果块可点开进词条页');
// 缓存块原先挂在 v-else-if 链上，会被"本地命中"整块吞掉 —— 现在改成独立 v-if，
// 才能和本地（相近）命中同时显示。这条跟着改，防止有人把它改回互斥。
assert(/<block v-if="cached">[\s\S]{0,200}@tap="openWord/.test(homeSrc2), '缓存结果块也可点开进词条页（不再被本地命中吞掉）');
// 三块（缓存 / AI 加载中 / AI 结果）必须**各自独立** v-if。
// 只要有一个还是 v-else-if，它就会被上一块吞掉 → 又回到"两边都不显示"。
assert(/<view v-if="aiLoading"/.test(homeSrc2), 'AI 加载中是独立 v-if（不是挂在缓存块后面的 v-else-if）');
assert(/<view v-if="aiResult"/.test(homeSrc2), 'AI 结果是独立 v-if（不是挂在缓存块后面的 v-else-if）');
assert(!/v-else-if="(cached|aiLoading|aiResult)"/.test(homeSrc2), '三块结果区没有残留的 v-else-if 互斥链');

/* ---------------- 17. 近似命中也要让 AI 出手（真跑页面方法） ---------------- */
// 用户实测反馈：搜一个词，本地只给出"相近的"（包含匹配 / 词典回落到词形），
// 而 AI 那栏因为挂在 v-else-if 上被吞掉 → 要查的词一条没有、AI 也不显示。
// 只扫源码挡不住（把 v-else-if 改对了也不代表真的去问了 AI），所以真跑一遍。
(async () => {
  console.log('== 17. 没有完全匹配 → 也要问 AI ==');
  const intentMod = load('utils/intent.js', {});
  const aiAsked = [];
  const homeScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(homeSrc2) || [])[1] || '';
  const homePage = loadCode(homeScript, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    wordbook, dict, search, aiCache, intent: intentMod,
    // 假模型层：只记下"问了谁"，不联网。跟 check-ai-features.js 一个思路。
    explainWord: async (w) => {
      aiAsked.push(String(w));
      return { word: w, pos: 'n.', meaningZh: '（测试释义 ' + w + '）', examples: [], kind: 'word' };
    },
    looksLikeSentence: () => false,
    aiGateReason: () => '',          // 空 = 已接入 AI
    speakWord: () => {}, speak: () => {},
    hideNativeTabBar: () => {}, syncTabbar: () => {},
    // 必须是可调用的：home.vue 里是 mixins: [tabSlideMixin('home')]
    tabSlideMixin: () => ({}),
    // onShow 里会走一遍完整流程（词书概览 / 布局刷新 / 新手引导），
    // 这几个模块要给到能被调用到的形状，否则 onShow 半路抛错，
    // 下面几条断言会"莫名其妙"地红 —— 那是桩不全，不是产品逻辑错。
    homeLayout: { MODULES: [], saveLayout: () => {} },
    pageDoc: {}, pageCommand: { canUndo: () => false }, pageAgent: {}, cardSpec: {},
    onboarding: { shouldShow: () => false, count: () => 0, stepAt: () => null },
    FloatTabbar: {}, FloatNavbar: {}, WidgetProgress: {}, WidgetFavorites: {}, WidgetStreak: {},
    WidgetChart: {}, WidgetGoal: {}, WidgetUsage: {}, WidgetWorddrill: {}, WidgetChat: {},
    AppCardBlocks: {}, AppDialog: {}, OnboardingMask: {},
    // 搜索历史：首页注册了组件 + 引了模块，缺桩的话脚本加载即崩
    SearchHistory: {}, searchHistory: { list: () => [], add: () => true, remove: () => true, clear: () => true }
  }, 'home.vue').default;
  assert(!!homePage && typeof homePage.data === 'function', '首页脚本可加载（导出 default）');
  const vm = Object.assign({}, homePage.data(), homePage.methods);
  vm.aiEnabled = true;   // 由 aiGateReason() 在 onLoad 里写入，这里直接给
  // computed 也挂上：searchTitle / exactHits / nearHits 都是 computed，
  // 只给 data + methods 的话 this.exactHits 是 undefined，一读就 TypeError
  Object.keys(homePage.computed || {}).forEach((k) => {
    Object.defineProperty(vm, k, { get: () => homePage.computed[k].call(vm), configurable: true });
  });
  const titleOf = () => vm.searchTitle;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /* --- 1) 完全命中：不该再花这一份 token --- */
  vm.onSearchInput(core0);
  assert(vm.results.length > 0, '搜词书里有的词有本地命中：' + core0);
  assert(vm.hasExactHit(core0), '命中里有一模一样的那条 → 判为完全匹配');
  eq(vm.searchTimer, 0, '完全匹配时不排 AI 请求（省 token）');
  assert(/命中/.test(titleOf()), '标题是"命中 n 条"，不是"没有完全匹配"：' + titleOf());

  /* --- 2) 只有近似命中：必须问 AI，且两块同时留在界面上 --- */
  const near = String(core0).slice(0, 3);   // 前缀必定命中一堆、但不一定有"一模一样"的
  aiAsked.length = 0;
  vm.onSearchInput(near);
  assert(vm.results.length > 0, '近似命中：本地仍列出 ' + vm.results.length + ' 条（搜「' + near + '」）');
  assert(!vm.hasExactHit(near), '这几条里没有一模一样的 → 判为"没查到"');
  assert(vm.searchTimer !== 0, '排了 AI 请求（以前这里完全不问）');
  await wait(1300);
  assert(aiAsked.length === 1 && aiAsked[0] === near, 'AI 真的被调用了一次：' + aiAsked.join(','));
  // 核心断言：本地列表和 AI 结果同时在 —— 以前 AI 这块会被 v-else 吞掉
  assert(vm.results.length > 0 && !!vm.aiResult, '本地相近条目与 AI 结果**同时**存在（不再二选一）');
  assert(/没有完全匹配/.test(titleOf()), '标题讲清是"相近的"：' + titleOf());

  /* --- 3) 边打字的半成品不该去烧 token --- */
  aiAsked.length = 0;
  vm.onSearchInput(String(core0).slice(0, 2));
  eq(vm.searchTimer, 0, '只有 2 个字符 → 不排 AI（半成品，别烧 token）');
  // 中文查询走本地释义匹配，那本来就是用户要的，不用再让 AI 猜
  const zh = String((wordbook.bookWords(CORE)[0] || {}).m || '').slice(0, 2);
  if (zh) {
    aiAsked.length = 0;
    vm.onSearchInput(zh);
    assert(vm.results.length > 0, '中文查释义有本地命中：「' + zh + '」');
    eq(vm.searchTimer, 0, '中文查询 + 本地有命中 → 不排 AI');
  }
  await wait(1300);
  eq(aiAsked.length, 0, '上面这两种情况一个请求都没发');

  /* --- 4) 请求回来时已经换了词 → 结果不许贴到新词上 --- */
  vm.lastQuery = 'run';
  assert(vm.isCurrentQuery('run') === true, 'isCurrentQuery：同一个词为 true');
  assert(vm.isCurrentQuery('ru') === false, 'isCurrentQuery：换了词为 false（旧结果不再贴上来）');
  assert(vm.isCurrentQuery('RUN') === true, 'isCurrentQuery 大小写不敏感');

  /* --- 5) 返回键：搜索面板 / 编辑态 / 收纳抽屉要先被退掉，而不是直接退 App --- */
  assert(typeof homePage.onBackPress === 'function', '首页注册了 onBackPress（App 返回键有得拦）');
  // 上面几组把 searching 留在 true 了 —— 先退回空闲态，否则这条"空闲照旧"假红
  vm.clearSearch();
  vm.editing = false;
  vm.sheetShow = false;
  const idleBack = homePage.onBackPress.call(vm);
  eq(idleBack, false, '没有任何临时状态时，返回键照旧（不吞返回、能退 App）');
  vm.searching = true;
  eq(homePage.onBackPress.call(vm), true, '搜索面板开着 → 返回键被消化');
  eq(vm.searching, false, '返回键真的把搜索退掉了');
  vm.editing = true;
  eq(homePage.onBackPress.call(vm), true, '编辑态 → 返回键被消化');
  eq(vm.editing, false, '返回键退出了编辑态');
  vm.sheetShow = true;
  eq(homePage.onBackPress.call(vm), true, '收纳抽屉开着 → 返回键被消化');
  eq(vm.sheetShow, false, '返回键关掉了收纳抽屉');

  /* --- 6) 从搜索结果点进词条，返回首页时自动退出搜索 --- */
  // 用户实测要求：搜到的词点进去看完，返回以后要能退出搜索，不能停在那一屏结果上。
  const navUrls = [];
  global.uni.navigateTo = (o) => { navUrls.push(o && o.url); if (o && o.success) o.success({}) };
  vm.onSearchInput(near);
  assert(vm.searching === true, '搜完之后搜索面板是开着的');
  vm.openWord(vm.results[0]);
  assert(navUrls.length === 1 && /word-detail/.test(navUrls[0]), '点词条跳去了单词详情页：' + navUrls[0]);
  eq(vm.__searchOpened, true, '标记了"这次跳转来自搜索"');
  homePage.onShow.call(vm);      // 词条页返回 → onShow
  eq(vm.searching, false, '返回首页后搜索面板自动收起（退出了搜索）');
  eq(vm.results.length, 0, '搜索结果也一并清掉，回到干净的首页');
  eq(vm.__searchOpened, false, '标记用完即清，下一次 onShow 不会误伤');

  // 反过来：不是从搜索进去的（切 tab / 从词库返回），搜索结果必须原样留着
  vm.onSearchInput(near);
  assert(vm.searching === true, '再搜一次，面板重新打开');
  homePage.onShow.call(vm);      // 普通 onShow（没有那笔标记）
  eq(vm.searching, true, '普通返回不会误收搜索面板（切 tab 回来结果还在）');
  eq(vm.results.length > 0, true, '结果也留着：' + vm.results.length + ' 条');
  // navigateTo 失败（页面栈满等）要撤回标记，否则下一次 onShow 会白收一次
  global.uni.navigateTo = (o) => { if (o && o.fail) o.fail({ errMsg: 'navigateTo:fail 测试' }) };
  vm.openWord(vm.results[0]);
  eq(vm.__searchOpened, false, '跳转失败 → 撤回标记（不会下次白收一次）');
  global.uni.navigateTo = (o) => { navUrls.push(o && o.url) };

  console.log('');
  console.log(fail === 0 ? '首页搜索逻辑全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
