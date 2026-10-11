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
// ⚠️ 口径更新（2026-10-11）：localSearch 现在跨「当前词书 + 全量本地词典」检索，
// 所以这里不再只有孤零零 1 条 —— 排在第一位的必须是它自己，来源标签也必须是「当前词书」。
const ub2Hit = search.localSearch(ub2, core0);
assert(ub2Hit.length >= 1, 'allowKnown：新书里能搜到这个词（共 ' + ub2Hit.length + ' 条）');
eq(ub2Hit[0].w, core0, '第一条就是它本人（相似词不能把它挤下去）');
eq(ub2Hit[0].fromText, '当前词书', '来源标签跟着"这个词属于哪本书"走');
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
  /* ---------------- 18. 本地词库有多大：能查到的词条必须是全量 ---------------- */
// 用户实测反馈：「尽可能把全部单词都纳入本地词库，避免出现完全搜不到任何单词的情况」。
// 以前 search.js 只扫当前词书，内置那几千个词条只有**拼完整了**才被 dict.lookup 捞得到，
// 于是换个词书能搜到的东西就少一大截，打一半更是直接归零。现在扫的是全量平表。
{
  const rows = dict.searchRows();
  const bySrc = rows.reduce((a, r) => { a[r.src] = (a[r.src] || 0) + 1; return a; }, {});
  console.log('     全量索引 ' + rows.length + ' 条：' + JSON.stringify(bySrc));
  assert(rows.length >= 7000, '全量本地词典 ≥ 7000 条（实际 ' + rows.length + '）');
  assert(bySrc.core >= 600, '核心词书 ' + bySrc.core + ' 条进来了');
  assert(bySrc.common >= 800, '常用词 ' + bySrc.common + ' 条进来了');
  assert(bySrc.book >= 3000, '内置词书共享表 ' + bySrc.book + ' 条进来了');
  assert(bySrc.extra >= 2000, '查词补充表 ' + bySrc.extra + ' 条进来了（这批以前压根搜不到）');

  // 补充词表的存在意义：_vocab/src 的考试词表里，没被任何词书挑中的那批词
  // （每本词书都有 size 上限 + 剔初中词）。它们全都不在 core / common / book 里，
  // 也就是说**没有这张表的话，它们是彻底搜不到的**（不再是"换个词书就没有"的问题）。
  const extra = load('data/extra-words.js');
  const lexiconRows = load('data/lexicon.js', {}).lexWords();
  const covered = Object.create(null);
  words.WORDS.forEach(w => { covered[w.w.toLowerCase()] = 1; });
  common.COMMON_RAW.forEach(line => { covered[line.split('|')[0].toLowerCase()] = 1; });
  lexiconRows.forEach(w => { covered[String(w.w).toLowerCase()] = 1; });
  const xe = extra.EXTRA_RAW.split('\n').filter(Boolean).map(l => l.split('|')[0].toLowerCase());
  assert(xe.length >= 2000, 'extra-words 词条数 ≥ 2000（实际 ' + xe.length + '）');
  const dupInExtra = xe.filter(w => covered[w]);
  assert(dupInExtra.length === 0,
    '补充表的每个词都不在 core/常用词/内置词书里（纯新增，不是重复占位）' +
    (dupInExtra.length ? '（重复的：' + dupInExtra.slice(0, 5).join(', ') + '）' : ''));
  assert(xe.every(w => /^[a-z][a-z'-]*$/.test(w)), '补充表词形全部合法');

  // 抽样：这些词以前肯定查不到，现在必须能精确命中
  const probeWords = [xe[0], xe[Math.floor(xe.length / 3)], xe[Math.floor(xe.length * 2 / 3)], xe[xe.length - 1]];
  probeWords.forEach((w) => {
    const r = search.localSearch(CORE, w, 5);
    assert(r.length > 0 && r[0].w.toLowerCase() === w,
      '以前查不到的词现在能查到：' + w + '（第一条 ' + (r[0] && r[0].w) + '）');
  });

  // 换到一本几乎空的词书，内置词照样能搜到 —— 以前这里是一条都不会有的
  const emptyBook = wordbook.createUserBook('18 组·空书', '单测');

  // 日常短词 / 口语 / 缩略语：这批词被 _vocab/build.js 的 STOP 表挡在**词书**之外是对的
  // （没人需要把 "hi" 做成单词卡片），可它们在本地词典里曾经压根不存在 ——
  // 用户随手敲一个短词就什么都查不到（真机反馈搜 "en"） 。现在 must 能精确查到。
  const EVERYDAY = ['hi', 'hey', 'oh', 'ah', 'um', 'yeah', 'bye', 'wow',
    'vs', 'etc', 'per', 'via', 'nor', 'ms', 'dr', 'pm', 'id', 'ad', 'tv', 'pc',
    'net', 'fax', 'ex', 'pi', 'fig', 'men', 'women', 'won'];
  const missingEveryday = EVERYDAY.filter(function (w) {
    const r = search.localSearch(emptyBook, w, 5);
    return !(r.length > 0 && String(r[0].w).toLowerCase() === w);
  });
  assert(missingEveryday.length === 0,
    '★ 日常短词在本地词典里查得到（' + EVERYDAY.length + ' 个抽样）' +
    (missingEveryday.length ? '（查不到的：' + missingEveryday.join(', ') + '）' : ''));
  const cs = search.localSearch(emptyBook, 'computer', 5);
  assert(cs.length > 0 && cs[0].w.toLowerCase() === 'computer',
    '空词书里也能搜到内置词 computer（实际 ' + cs.map(r => r.w).join('/') + '）');
  wordbook.deleteUserBook(emptyBook);
}

console.log('== 19. 分档排序：高度匹配的在前，相似词不许淹没它 ==');
{
  // 六档常量：UI 与后续断言都靠它说话，改语义必须改这里
  eq(search.TIER.EXACT, 1, 'TIER.EXACT');
  eq(search.TIER.LEMMA, 2, 'TIER.LEMMA（词形还原）');
  eq(search.TIER.PREFIX, 3, 'TIER.PREFIX');
  eq(search.TIER.TYPO, 4, 'TIER.TYPO（拼写最接近）');
  eq(search.TIER.SUBSTR, 5, 'TIER.SUBSTR（词形里含）');
  eq(search.TIER.MEANING, 6, 'TIER.MEANING（只在释义里含）');

  // 编辑距离：必须支持相邻字符对调，否则 recieve → receive 距离是 2，会被别的词压下去
  eq(search.boundedEdit('receive', 'recieve', 2), 1, 'ie/ei 打反只算 1 次编辑');
  eq(search.boundedEdit('color', 'colour', 2), 1, '差一个字母 = 1');
  eq(search.boundedEdit('cat', 'dog', 2), 3, '完全不同 = 3（>cap 时返回 cap+1）');
  eq(search.boundedEdit('run', 'running', 2), 3, '长度差超过上限直接判不相关（返回 cap+1）');
  eq(search.boundedEdit('improve', 'approve', 2), 2, '两处不同 = 2');

  // ① 一模一样的那条永远第一
  const imp = search.localSearch(CORE, 'improve', 8);
  eq(imp[0].w, 'improve', '第一条 = 输入本身');
  eq(imp[0].tier, search.TIER.EXACT, '档次 = EXACT');

  // ② 词形还原：studies → study，排在"只是长得像"的前面
  const st = search.localSearch(CORE, 'studies', 6);
  assert(st[0] && st[0].w.toLowerCase() === 'study' && st[0].tier === search.TIER.LEMMA,
    'studies → study，且落在 LEMMA 档（实际 ' + (st[0] && st[0].w) + '）');

  // ③ 前缀排在"词形里含"之前
  const ind = search.localSearch(CORE, 'in', 10);
  const subs = ind.filter(r => r.w.toLowerCase().indexOf('in') > 0);
  const pres = ind.filter(r => r.w.toLowerCase().indexOf('in') === 0);
  assert(pres.length > 1 && (!subs.length || ind.indexOf(pres[pres.length - 1]) < ind.indexOf(subs[0])),
    '"以 in 开头"的全部排在"中间含 in"的前面');

  // ④ 拼错了也能找到正解，而且是第一条（Damerau 距离：recieve → receive = 1）
  const rc = search.localSearch(CORE, 'recieve', 8);
  assert(rc.length > 0 && rc[0].w.toLowerCase() === 'receive',
    'recieve → receive 排第一（实际 ' + rc.slice(0, 3).map(r => r.w).join('/') + '）');

  // ⑤ 已经打对了就别再列一堆"差一两个字母"的噪声 —— 那正是"相似词淹没目标词"
  const imps = search.localSearch(CORE, 'improve', 20);
  eq(imps.filter(r => r.tier === search.TIER.TYPO).length, 0, '有精确命中时不给拼写纠错（避免噪声）');
  const comp = search.localSearch(CORE, 'comput', 20);
  eq(comp.filter(r => r.tier === search.TIER.TYPO).length, 0, '已有前缀命中时同样不做纠错');

  // ⑥ 短词不纠错：2 个字母时几乎所有词都"差一个字母"，放行等于把目标词淹掉
  eq(search.localSearch(CORE, 'in', 20).filter(r => r.tier === search.TIER.TYPO).length, 0, '2 字母查询不做拼写纠错');

  // ⑦ 同档内部按"接近程度"排：前缀档里短词在前
  const pre = comp.filter(r => r.tier === search.TIER.PREFIX).map(r => r.w.toLowerCase());
  eq(pre.length >= 2 && pre[0] === 'compute', true, '前缀档内词短的在前：' + pre.join(' / '));
}

/* ---------------- 20. 各层来源标签要说清楚 ---------------- */
{
  const rows = {};
  dict.searchRows().forEach(r => { if (!rows[r.src]) rows[r.src] = r; });
  Object.keys(rows).forEach(src => {
    assert(!!dict.SRC_LABEL[src] && typeof dict.SRC_LABEL[src] === 'string',
      '来源 src=' + src + ' 有中文标签：' + dict.SRC_LABEL[src]);
  });
  eq(dict.SRC_LABEL.extra, '补充词库', '补充词表自己的标签');
  // 用户导入词**不进**全量索引：搜 A 书不该蹦出 B 书里你自己加的词
  const own = dict.searchRows().filter(r => r.src === 'custom');
  eq(own.length, 0, '全量索引里没有用户导入词（跨书不串味）');
}

console.log('== 17. 没有完全匹配 → 也要问 AI ==');
  const intentMod = load('utils/intent.js', {});
  const aiAsked = [];
  // AI 的行为由这里驱动：ok = 正常出释义 / fail = 请求本身出错 / empty = 没给出释义
  let aiMode = 'ok';
  const homeScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(homeSrc2) || [])[1] || '';
  const homePage = loadCode(homeScript, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    wordbook, dict, search, aiCache, intent: intentMod,
    // 假模型层：只记下"问了谁"，不联网。跟 check-ai-features.js 一个思路。
    // 失败/空回复两种分支要用得上（上面刚声明的那个人身在这）
    explainWord: async (w) => {
      aiAsked.push(String(w));
      if (aiMode === 'fail') throw new Error('network down');
      if (aiMode === 'empty') return { word: w, pos: '', meaningZh: '', examples: [], kind: 'word' };
      return { word: w, pos: 'n.', meaningZh: '（测试释义 ' + w + '）', examples: [], kind: 'word' };
    },
    looksLikeSentence: () => false,
    aiGateReason: () => '',          // 空 = 已接入 AI
    speakWord: () => {}, speak: () => {},
    hideNativeTabBar: () => {}, syncTabbar: () => {},
    // 必须是可调用的：home.vue 里是 mixins: [tabSlideMixin('home'), wordPolishMixin()]
    tabSlideMixin: () => ({}),
    // 义项补全：首页引了这个 mixin，缺桩脚本加载即崩（不是假绿，是压根跑不起来）。
    // 用真 mixin：onSearchInput 里会调 clearPolish() / schedulePolish()，空壳桩会 TypeError
    wordPolishMixin: load('utils/word-polish-mixin.js', {
      t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
      aiCache,
      expandWord: async () => ({ senses: [], examples: [], others: [] }),
      // 判定"本地还有没有更多义项"要查词典层那份完整义项表（data/word-senses.js），
      // 少了这一项 mixin 加载即崩（不是假绿，是压根跑不起来）
      dict
    }).default,
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
  // mixin 也要合进来：clearPolish / schedulePolish 都来自 word-polish-mixin，
  // 不合的话 onSearchInput 一进来就 TypeError（那不是产品逻辑错，是桩没搭全）
  const vmMix = (homePage.mixins || []).reduce(function (acc, m) {
    return {
      data: Object.assign({}, acc.data, typeof m.data === 'function' ? m.data() : {}),
      methods: Object.assign({}, acc.methods, m.methods || {}),
      computed: Object.assign({}, acc.computed, m.computed || {})
    };
  }, { data: {}, methods: {}, computed: {} });
  const vm = Object.assign(
    {}, vmMix.data, homePage.data(), vmMix.methods, homePage.methods
  );
  vm.aiEnabled = true;   // 由 aiGateReason() 在 onLoad 里写入，这里直接给
  // computed 也挂上：searchTitle / exactHits / nearHits 都是 computed，
  // 只给 data + methods 的话 this.exactHits 是 undefined，一读就 TypeError
  const vmComputed = Object.assign({}, vmMix.computed, homePage.computed || {});
  Object.keys(vmComputed).forEach((k) => {
    Object.defineProperty(vm, k, { get: () => vmComputed[k].call(vm), configurable: true });
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

  /* --- 7) 三种结局要有三种说法：本地命中 / AI 命中 / 没找到 / 查询失败 --- */
  // 用户实测反馈：查词一路走到"屏幕上一句话都没有"就没了下文，分不清
  // 「本地没有」「AI 也没有」「AI 请求挂了」。它们必须是三副不同的样子，各自还能往下走。
  vm.onSearchInput(core0);
  eq(vm.noExactHit, false, '本地精确命中 → 不算"没找到"');
  eq(vm.showNotFound, false, '本地精确命中 → 不显示"没找到"那一块');
  eq(vm.aiError, '', '本地精确命中 → 也没有失败提示');

  aiMode = 'fail';
  vm.onSearchInput('zzqqxx');
  if (vm.searchTimer) { clearTimeout(vm.searchTimer); vm.searchTimer = 0 }
  await vm.aiLookup('zzqqxx');
  assert(!!vm.aiError, '★ 请求出错 → 失败原因亮出来：' + vm.aiError);
  eq(vm.aiLoading, false, '出错也要把转圈收掉（不然一直卡在这）');
  eq(vm.showNotFound, false, '★ 查询失败 ≠ 没找到，不叠一句"本地词库没有"');

  aiMode = 'empty';
  vm.onSearchInput('zzppww');
  if (vm.searchTimer) { clearTimeout(vm.searchTimer); vm.searchTimer = 0 }
  await vm.aiLookup('zzppww');
  eq(vm.aiError, '', '★ AI 返回空 = "它也不知道"，不当成查询失败');
  eq(vm.showNotFound, true, '本地 / 缓存 / AI 全空 → 这时才说"没找到"');

  // 「本地给了一堆相似词、但没有用户要查的那个词」→ 这句"没找到"同样要出现，
  // 否则用户盯着一屏相似词，既不知道查不到、也不知道下一步能干嘛
  aiMode = 'empty';
  vm.onSearchInput(String(core0).slice(0, 3));
  if (vm.searchTimer) { clearTimeout(vm.searchTimer); vm.searchTimer = 0 }
  await vm.aiLookup(String(core0).slice(0, 3));
  assert(vm.results.length > 0, '本地确有相似结果（' + vm.results.length + ' 条）');
  eq(vm.showNotFound, true, '★ 只有相似词时也要说"没找到"（以前这种情形一句话都不给）');
  aiMode = 'ok';

  const homeSrc3 = homeSrc2;
  assert(/<view v-if="showNotFound"/.test(homeSrc3), '首页「没找到」块的开关改成了 showNotFound');
  assert(!/v-if="!results\.length && !cached && !aiLoading && !aiResult && !searchTimer"/.test(homeSrc3),
    '不再以"本地一条结果都没有"为前提（那是把含糊的一屏相似词当成找到了）');
  assert(/<view v-if="aiError"[\s\S]{0,300}?\{\{ aiError \}\}/.test(homeSrc3), '首页失败态渲染 aiError 文本');
  assert(/<view v-if="aiError"[\s\S]{0,300}?@tap="aiLookup\(lastQuery\)"/.test(homeSrc3), '首页失败态给「重试」入口');
  assert(/showNotFound\(\)[\s\S]{0,240}?!this\.aiError/.test(homeScript),
    'showNotFound 把 aiError 排除在外（"没查成"和"没查到"分开说）');

  console.log('\n== 21. 不许替 AI 撒谎 + 回车必须有明确动作 ==');
  /* --- 1) 短词两难：不许替 AI 撒谎 + 回车必须有明确动作 --- */
  // 用户实测反馈（2026-10-11 真机截图）：搜 "en"，屏幕上写着
  // 「本地词库没有「en」」+「AI 也未能补充这个词」，而 AI 结果、本机缓存都是空的，
  // 回车也没有任何反应 —— 用户彻底没有下一步可走。
  // 两个真因：
  //   ① 界面替 AI 撒谎：'en' 只有 2 个字母，达不到 AI_NEAR_MIN_LEN，
  //      自动路径**压根没去问 AI**，界面却一律写"AI 也未能补充"；
  //   ② 回车退化成 runSearch(text)：把同样的检索再跑一遍，界面纹丝不动。
  const SHORT = 'en';   // 本地有 12 条相近词、但**没有**一模一样的那条（probe 过）
  aiMode = 'empty';
  vm.onSearchInput(SHORT);
  assert(vm.results.length > 0, '搜短词「' + SHORT + '」本地仍有相近结果（' + vm.results.length + ' 条）');
  eq(vm.searchTimer, 0, '★ 短词不自动问 AI（防抖 + 长度门槛，避免边打字烧 token）');
  eq(vm.aiTried, false, '★ 没问过 AI 就不许声称问过了（这是这条反馈的根）');
  assert(!/AI 也/.test(vm.aiHint), '★ 没问过 AI 时第二行不许出现"AI 也…"：' + vm.aiHint);
  assert(/相近/.test(vm.aiHint) && vm.aiHint.indexOf(SHORT) >= 0,
    '★ 这时要说清"上面那几条只是相近的"并点出查的词：' + vm.aiHint);
  eq(vm.aiActionText, '让 AI 查一下', '★ 没问过 → 按钮是"让 AI 查一下"（入口得摆在手上）');

  // 回车 = 用户明确的动作 → 立刻问 AI，不受上面那条长度门槛限制
  aiAsked.length = 0;
  vm.onSubmit(SHORT);
  assert(aiAsked.length === 1 && aiAsked[0] === SHORT,
    '★ 回车后立刻真的去问了 AI（不再退化成"再跑一遍同样的检索"）：' + aiAsked.join(','));
  eq(vm.aiTried, true, '★ 真问过之后，这一轮的"问过 AI"标记亮起来');
  await wait(50);   // aiLookup 是 async，等它落地
  assert(/AI 也没查到这个词/.test(vm.aiHint), '★ AI 回来是空的 → 这时才可以说"AI 也没查到"：' + vm.aiHint);
  eq(vm.aiActionText, '再问一次', '★ 问过了 → 按钮改成"再问一次"（不会鬼打墙地重复"可以去问"）');

  // 换个词 = 新一轮，标记必须跟着归零，否则会拿上一轮的结论说给新词听
  vm.onSearchInput(String(core0).slice(0, 2));
  eq(vm.aiTried, false, '★ 换了词就把"问过 AI"重置（否则新词沿用上一轮的说法）');
  if (vm.searchTimer) { clearTimeout(vm.searchTimer); vm.searchTimer = 0 }
  await wait(50);
  aiMode = 'ok';

  // 模板契约：第二行改由 aiHint 统一出口，不再写死 aiEnabled 三元的那一句
  assert(/\{\{ aiHint \}\}/.test(homeSrc3), '首页「没找到」块的第二行交给 aiHint');
  assert(!/aiEnabled \? \$t\('AI 也未能补充这个词/.test(homeSrc3),
    '首页不再写死"AI 也未能补充这个词"（那是替 AI 撒谎的那一行）');
  assert(/@tap="askAi"/.test(homeSrc3) && /\{\{ aiActionText \}\}/.test(homeSrc3),
    '首页给了「让 AI 查一下 / 再问一次」按钮（文案随 aiTried 变化）');
  assert(/@tap="openQuery"/.test(homeSrc3), '首页给了「手动添加」这条出口（AI 关着也能走下去）');
  assert(/askAi\(\)[\s\S]{0,160}?this\.aiLookup\(this\.lastQuery\)/.test(homeScript), 'askAi 真的把当前词交给 AI');
  // 做题页顶栏查词是同一套链路，同样的话术要同步过去
  const wsSrc = fs.readFileSync(path.join(ROOT, 'components', 'word-search', 'word-search.vue'), 'utf8');
  assert(/\{\{ aiHint \}\}/.test(wsSrc), '查词组件同样用 aiHint（两边口径不能走偏）');
  assert(!/aiEnabled \? \$t\('AI 也未能补充这个词/.test(wsSrc), '查词组件不再写死"AI 也未能补充这个词"');
  assert(/aiTried/.test(wsSrc) && /aiActionText/.test(wsSrc), '查词组件同步了 aiTried / aiActionText');

  console.log('');
  console.log(fail === 0 ? '首页搜索逻辑全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
