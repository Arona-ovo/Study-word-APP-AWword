// _tools/check-builtin-books.js - 内置考试词书（专升本 / 四六级 / 考研 / 高考 / 中考）校验（只读）
//
// 覆盖的是「本功能专属」的不变量，通用口径在 check-bookscope.js / check-batches.js 里：
//   1. 6 本内置词书都成规模，书内无重复词条，所有词条 id 都能解析出词对象
//   2. 共享词条表与核心 640 词没有重名（同一词条两个 id 会让掌握度各记一份）
//   3. 切到新词书后：出题选词 / 首页概览 / 熟词池 都按新书口径走
//   4. 词条 id 范围不冲突；掌握度按词书隔离（同一 id 在两本书里互不干扰）
//   5. 点读能查到共享表里的词，且解析耗时在预算内
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

// ---------- 装载真实模块 ----------
const t0 = Date.now();
// APK 是主战场：真正的使用约束是「这些语料同步装载时占多少时间、多少堆内存」，
// 不是源码字节数（App 端没有小程序那套主包 2MB 限制）。这里顺手把它固化成断言。
const h0 = process.memoryUsage().heapUsed;
const words = load('data/words.js');
const lex = load('data/lexicon.js');
const wb = load('data/wordbooks.js');
const bookdata = load('data/bookdata.js');
const parseMs = Date.now() - t0;
const heapKB = (process.memoryUsage().heapUsed - h0) / 1024;

const lemma = load('utils/lemma.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', { SENTENCES: sentences.SENTENCES, lemmaCandidates: lemma.lemmaCandidates });
const engine = load('utils/engine.js', { WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex });
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', { getBook: wb.getBook, wordbook, lemma: lemma.lemma });
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma
});

const ALL_BY_ID = lex.allById();
const EXAM_IDS = ['fj_zsb_core', 'cet4', 'cet6', 'kaoyan', 'gao_kao', 'junior_core'];

console.log('== 1. 内置词书规模 ==');
const builtin = wb.WORDBOOKS.filter(b => EXAM_IDS.indexOf(b.id) >= 0);
eq(builtin.length, EXAM_IDS.length, '内置考试词书数量');
builtin.forEach(b => {
  const ids = wb.wordIdsOfBook(b.id);
  const uniq = new Set(ids);
  const name = String(b.id).padEnd(13) + b.name;
  if (ids.length < 500) bad(name + ' 词量过少：' + ids.length);
  else if (uniq.size !== ids.length) bad(name + ' 书内有重复词条：' + ids.length + ' vs ' + uniq.size);
  else if (b.batches.length < 20) bad(name + ' 批次过少：' + b.batches.length);
  else ok(name + '：' + ids.length + ' 词 / ' + b.batches.length + ' 批');
});

console.log('== 2. 词条唯一性 ==');
const badIds = [];
builtin.forEach(b => wb.wordIdsOfBook(b.id).forEach(id => { if (!ALL_BY_ID[id]) badIds.push(b.id + ':' + id) }));
eq(badIds.length, 0, '所有批次词 id 都能解析出词条' + (badIds.length ? '（缺：' + badIds.slice(0, 5).join(',') + '）' : ''));

const coreWords = new Set(words.WORDS.map(w => w.w.toLowerCase()));
const lexWords = lex.lexWords();
const clash = lexWords.filter(w => coreWords.has(w.w.toLowerCase()));
eq(clash.length, 0, '共享表与核心 640 词重名数' + (clash.length ? '（如 ' + clash.slice(0, 5).map(w => w.w) + '）' : ''));
const minId = Math.min.apply(null, lexWords.map(w => w.id));
eq(minId >= 10001, true, '共享词条 id 起始值 ≥ 10001（实际 ' + minId + '）');
eq(lexWords.filter(w => !w.m || !w.w).length, 0, '共享表无空词条');

// 索引解码要和词条数组对得上
const decoded = Object.keys(bookdata.BOOK_INDEX).map(k => {
  const raw = bookdata.BOOK_INDEX[k];
  return { k: k, n: raw.length / bookdata.IDX_LEN };
});
const idxOK = decoded.every(d => Math.abs(d.n - wb.wordIdsOfBook(d.k === 'fj_zsb_core' ? d.k : d.k).length + (d.k === 'fj_zsb_core' ? words.WORDS.length : 0)) < 2);
eq(idxOK, true, 'BOOK_INDEX 词条数与各方一致');

console.log('== 3. 切到四级词书后按新口径走 ==');
wordbook.switchBook('cet4');
eq(wordbook.currentBookId(), 'cet4', '当前词书已切换');
const cet4Ids = new Set(wb.wordIdsOfBook('cet4'));
const picked = iplus1.pickNewWords('cet4', 3, []);
eq(picked.words.length > 0, true, '四级词书能选出新词');
eq(picked.words.every(w => cet4Ids.has(w.id)), true, '选出的词都属于四级词书');
const ov = wordbook.homeOverview(true);
eq(ov.bookId, 'cet4', '首页概览取到四级词书');
eq(ov.wordCount, cet4Ids.size, '首页概览词量 = 四级词书词量');
eq(ov.batchTotal > 0, true, '首页概览有当前批次');
const known = iplus1.knownPool('cet4', 120);
eq(known.length > 0, true, '四级词书冷启动也有熟词池（' + known.length + '）');

console.log('== 4. AI 请求难度是数字（不是写死的 "zsb"）==');
const req = iplus1.buildRequest('cet4', { newCount: 1 });
eq(typeof req.level, 'number', 'buildRequest.level 类型');
eq(req.level >= 1 && req.level <= 4, true, 'buildRequest.level 落在 1-4（实际 ' + req.level + '）');

console.log('== 5. 掌握度按词书隔离 ==');
const shared = lexWords.find(w => wb.wordIdsOfBook('cet4').indexOf(w.id) >= 0 && wb.wordIdsOfBook('cet6').indexOf(w.id) >= 0) ||
  { id: wb.wordIdsOfBook('cet4')[0] };
wordbook.setMastery('cet4', shared.id, { m: 5, seen: 3, correct: 3 });
eq(wordbook.masteryMap('cet4')[shared.id].m, 5, 'cet4 里该词已掌握');
eq((wordbook.masteryMap('cet6')[shared.id] || {}).m || 0, 0, '同一词条在 cet6 里仍是 0（互不串味）');

console.log('== 6. 点读覆盖率提升到共享表 ==');
const onlyLex = lexWords[Math.floor(lexWords.length / 2)];
const hit = dict.lookup(onlyLex.w);
eq(hit.found, true, '点读能查到共享词条 ' + onlyLex.w);
eq(hit.src, 'book', '点读来源标记为 book（实际 ' + hit.src + '）');
eq(hit.meaning.length > 0, true, '有中文释义');

console.log('== 7. 装载开销预算（APK 才是主战场）==');
console.log('     首次装载 + 解析共享表：' + parseMs + 'ms（' + lexWords.length + ' 词条）');
if (parseMs > 800) bad('解析耗时超预算 800ms：' + parseMs + 'ms');
else ok('解析耗时在预算内');
// 手机上 App 启动时有别的东西在抢资源，给词书语料留 8MB 的堆上限。
// 这条比"源码多少 KB"有意义得多：同样的 200KB 文本，建成 index 后的常驻内存才是真开销。
console.log('     常驻堆内存增量：' + heapKB.toFixed(0) + ' KB');
if (heapKB > 8 * 1024) bad('堆内存超预算 8MB：' + heapKB.toFixed(0) + 'KB');
else ok('堆内存在预算内');

// 产物体积
const kb = ['data/lexicon-data.js', 'data/bookdata.js']
  .reduce((s, f) => s + fs.statSync(path.join(__dirname, '..', 'uniapp', f)).size, 0) / 1024;
console.log('     词书语料体积：' + kb.toFixed(0) + ' KB');
if (kb > 300) bad('词书语料超预算 300KB：' + kb.toFixed(0) + 'KB');
else ok('词书语料体积在预算内');

console.log('');
console.log('== 8. 查词补充表的开销（本地词库扩容的代价是否被盯住）==');
// 这批词表 _vocab/src 里本来就有，只是没被任何词书挑中，以前在本地完全搜不到。
// 既然它们是往 App 里加了的，就得有人看着它的真实代价 —— 否则下次再"顺手加一批"就没人拦了。
{
  const h1 = process.memoryUsage().heapUsed;   // 只量"建检索表"这一段的增量
  const t1 = Date.now();
  const rows = dict.searchRows();
  const buildMs = Date.now() - t1;
  const rowsKB = (process.memoryUsage().heapUsed - h1) / 1024;
  const bySrc = rows.reduce((a, r) => { a[r.src] = (a[r.src] || 0) + 1; return a; }, {});
  console.log('     全量检索表 ' + rows.length + ' 条：' + JSON.stringify(bySrc) + '，建表 ' + buildMs + 'ms');
  if (rows.length < 7000) bad('全量检索表规模倒退：' + rows.length + ' 条（应 ≥ 7000）');
  else ok('全量检索表规模');
  if (buildMs > 300) bad('建表耗时超预算 300ms：' + buildMs + 'ms');
  else ok('建表耗时在预算内');
  console.log('     词书语料 + 检索表常驻：' + rowsKB.toFixed(0) + ' KB（本次增量）/ 累计 ' + ((heapKB + rowsKB) / 1024).toFixed(1) + ' MB');
  // 盯增量，不盯累计：累计值受 V8 何时 GC 影响很大（同样的代码能飘 ±2MB），
  // 用它做门槛会变成一条"时红时绿"的假断言。
  // 门槛放宽到 4MB 是有依据的：这里没法强制 GC（跑的是普通 node），增量里含
  // 尚未回收的中间垃圾；加 --expose-gc 逐段实测的话，"补充词表"本身约 890KB、
  // "固化检索表"约 570KB，合计 1.5MB 左右。4MB 是为了让这条线只对"又塞进来一整张词表"
  // 这种量级的变化报红，而不是每天因 GC 时机不同红一次。
  if (rowsKB > 4 * 1024) bad('检索表增量超预算 4MB：' + rowsKB.toFixed(0) + 'KB');
  else ok('检索表内存增量在预算内');
  if (heapKB + rowsKB > 8 * 1024) bad('常驻堆内存超预算 8MB：' + (heapKB + rowsKB).toFixed(0) + 'KB');
  else ok('常驻堆内存在预算内');
}

// ---------------------------------------------------------------------------
console.log('');
console.log('');
console.log('== 9. 完整义项层的开销（一词多义补全的代价是否被盯住）==');
// 与上一组同一条规矩：**往词典里加东西必须有人记账**。
// 这张表 319KB / 3316 条，只在词条页 / 点读 / 义项补全这种"一次一两条"的地方用，
// 所以刻意不预解析成 Map —— 扫原始文本取行即可，省下约 800KB 常驻堆。
// 下面量的是这三笔账：规模、装载耗时、单次查询耗时。
{
  const sensesPath = path.join(__dirname, '..', 'uniapp', 'data', 'word-senses.js');
  const h9 = process.memoryUsage().heapUsed;
  const t9 = Date.now();
  const sensesMod = load('data/word-senses.js');
  const loadMs = Date.now() - t9;
  const loadKB = (process.memoryUsage().heapUsed - h9) / 1024;
  const sensesRaw = String(sensesMod.SENSES_RAW || '');
  const sensesCount = sensesMod.SENSES_COUNT;
  const rawKB = fs.statSync(sensesPath).size / 1024;
  console.log('     data/word-senses.js ' + rawKB.toFixed(0) + ' KB（' + sensesCount + ' 条）');
  console.log('     装载 ' + loadMs + 'ms，常驻 +' + loadKB.toFixed(0) + ' KB');
  if (sensesCount > 1000) ok('完整义项规模没有萎缩（' + sensesCount + ' 条）');
  else bad('完整义项规模萎缩：' + sensesCount + ' 条（应 > 1000）');
  if (rawKB <= 400) ok('完整义项源码 ≤ 400 KB（实际 ' + rawKB.toFixed(0) + ' KB）');
  else bad('完整义项源码超预算 400KB：' + rawKB.toFixed(0) + ' KB');
  if (loadKB <= 1200) ok('完整义项常驻内存增量 ≤ 1200 KB（实际 ' + loadKB.toFixed(0) + ' KB）');
  else bad('完整义项常驻内存超预算：' + loadKB.toFixed(0) + ' KB（这张表刻意不建索引，涨了说明有人改成了预解析）');

  // 行格式：word|pos|释义（与共享表同口径，便于逐行 diff）
  const lines = sensesRaw.split('\n').filter((l) => l.trim());
  let badRow = '';
  let emptyMean = 0;
  const seen = {};
  let dup = 0;
  lines.forEach((l) => {
    const p = l.split('|');
    const w = p[0] || '';
    const m = p.slice(2).join('|');
    if (!/^[a-z][a-z'\-]*$/.test(w)) badRow = badRow || l;
    if (!m) emptyMean++;
    if (seen[w]) dup++;
    seen[w] = 1;
  });
  if (!badRow) ok('word 列全是合法小写词形');
  else bad('word 列有非法词形（反例：' + badRow + '）');
  if (emptyMean === 0) ok('没有空释义行');
  else bad('有 ' + emptyMean + ' 行空释义');
  if (dup === 0) ok('同一个词不重复出现');
  else bad('同一个词重复出现 ' + dup + ' 行');
  // 残留空格是被清洗规则剔掉的信号（dropSpace 已在 build 阶段处理）
  const spaced = lines.filter((l) => /[　\s]/.test(l.split('|').slice(2).join('|')));
  if (spaced.length === 0) ok('释义里没有残留空格');
  else bad('释义里有残留空格（反例：' + spaced[0] + '）');

  // 长版必须**严格长于**短版，否则就是白占体积。
  // 抽样取常见的多义词：这些词短版一定被 20 字截断过，长版理应更长。
  const probe = ['light', 'hard', 'note', 'present', 'bear', 'bank',
    'clear', 'book', 'run', 'stand', 'free', 'right'];
  let longer = 0;
  for (const w of probe) {
    const shortN = dict.splitSenses(dict.lookup(w).meaning).length;
    const fullN = dict.fullSensesOf(w).length;
    if (fullN > shortN) longer++;
  }
  console.log('     抽样里长版严格更全的：' + longer + ' / ' + probe.length);
  if (longer >= Math.ceil(probe.length / 2)) ok('至少一半抽样词的长版严格长于短版（' + longer + '/' + probe.length + '）');
  else bad('长版没比短版更全，白占体积：' + longer + '/' + probe.length);

  const tq = Date.now();
  for (let i = 0; i < 200; i++) dict.fullSensesOf(probe[i % probe.length]);
  const queryMs = Date.now() - tq;
  console.log('     200 次查询耗时 ' + queryMs + 'ms（单次 ' + (queryMs / 200).toFixed(3) + 'ms）');
  // 不建索引、只扫文本 → 单次应该在 0.1ms 量级。
  // 若这里飙到毫秒级，多半是有人把它改成了 split() 后逐行匹配（那会每次建 3316 个字符串）。
  if (queryMs <= 400) ok('200 次完整义项查询 ≤ 400ms（实际 ' + queryMs + 'ms）');
  else bad('完整义项查询太慢：200 次 ' + queryMs + 'ms（多半是被改成了逐行 split 匹配）');
}


console.log('');
console.log(fail === 0 ? '内置词书全部通过' : '失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
