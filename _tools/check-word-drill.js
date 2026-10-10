// _tools/check-word-drill.js - 「刷单词」独立模式 校验（只读，不改源码）
// 运行：node --experimental-strip-types _tools/check-word-drill.js
//
// 覆盖：
//   1) utils/word-session.js 组牌：字段齐全、不重复、干扰项不泄题
//   2) 三种来源语义：日常 / 复习（只 m<=2）/ 新词（只没见过的）
//   3) 排队是"该练程度"降序：新词优先、掌握度低的优先
//   4) 回写真的落到掌握度 + 今日统计 + 每日新词（页里用的就是这条链路）
//   5) 页面契约：异步取消纪律（照抄练习页）、不碰 AI 出题、词条有问题也不崩
//   6) 注册不漂移：home-layout / page-schema BUILTIN_TYPES / card-spec 路由表三处对齐
const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mem = {};
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function is(cond, m, extra) { cond ? ok(m + (extra === undefined ? '' : ' = ' + extra)) : bad(m + (extra === undefined ? '' : ' = ' + extra)); }
function eq(a, b, label) {
  if (JSON.stringify(a) === JSON.stringify(b)) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

/* ---------------- 依赖装配（与 check-session-concurrent.js 同一套） ---------------- */
const lemmaMod = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemmaMod.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook, wordIdsOfBook: wordbooks.wordIdsOfBook,
  setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
const srs = load('utils/srs.js');
const ws = load('utils/word-session.js', { wordbook, sentenceIndex, srs });

store.init();
wordbook.ensureShape();
const BID = wordbook.currentBookId();
const ALL = wordbook.bookWords(BID);

// 清空掌握度，保证每个分组都从干净的初始态开始
function wipe() {
  const st = store.get();
  st.books = st.books || {};
  st.books[BID] = { mastery: {} };
  st.days = {};
  st.mastery = {};
  st.wrong = [];
  store.save(st);
}

(async () => {
  /* ---------------- 0. 前置：词书里有词 ---------------- */
  console.log('== 0. 前置 ==');
  is(ALL.length > 0, '默认词书有词可用', ALL.length);
  is(typeof ws.buildDeck === 'function', '导出 buildDeck');
  is(typeof ws.counts === 'function', '导出 counts');
  eq(ws.SOURCES, ['daily', 'review', 'new'], '三种来源');

  /* ---------------- 1. 组牌字段 ---------------- */
  console.log('== 1. 组牌字段（10 词一组） ==');
  wipe();
  const deck = ws.buildDeck(10, BID, 'daily');
  eq(deck.length, 10, 'deck 长度');
  const shapeOk = deck.every(d =>
    d.id && typeof d.w === 'string' && d.m &&
    Array.isArray(d.options) && d.options.length >= 1 && d.options.length <= 4 &&
    Array.isArray(d.words) && d.words.length === 1 && d.words[0].id === d.id &&
    Array.isArray(d.wordIds) && d.wordIds[0] === d.id
  );
  is(shapeOk, '每题都有 id/w/m/options/words/wordIds（缺 words 会导致掌握度一笔不写）');
  const uniq = new Set(deck.map(d => d.id));
  is(uniq.size === deck.length, '同一组里没有重复的词', uniq.size);
  const answerOk = deck.every(d => d.options[d.answerIndex] === String(d.m).trim());
  is(answerOk, 'answerIndex 指向的正是这个词的中文释义');
  const ownerOk = deck.every(d => ALL.some(e => e.id === d.id));
  is(ownerOk, '每组词都来自当前词书（没有串到别本书）');

  /* ---------------- 2. 干扰项不能泄题 / 不能重复 ---------------- */
  console.log('== 2. 干扰项 ==');
  let dup = 0;
  let missingAnswer = 0;
  let tooMany = 0;
  deck.forEach(d => {
    const s = new Set(d.options);
    if (s.size !== d.options.length) dup++;
    if (d.options.indexOf(String(d.m).trim()) < 0) missingAnswer++;
    if (d.options.length > 4) tooMany++;
  });
  eq(dup, 0, '没有选项重复（释义撞车会变成"两个都对"）');
  eq(missingAnswer, 0, '每组都带着正确答案');
  eq(tooMany, 0, '选项不超过 4 个');
  // 词书的四个 Acad 选项如果全是同一词性，辨识度才有意义 —— 抽查同词性占比
  const posMap = {};
  ALL.forEach(e => { posMap[e.id] = String(e.pos || ''); });
  let samePos = 0;
  let sameable = 0;
  deck.forEach(d => {
    const peers = ALL.filter(e => String(e.pos || '') === posMap[d.id] && e.id !== d.id && String(e.m || '').trim() !== String(d.m).trim());
    if (!peers.length) return;
    sameable++;
    const hasSame = d.options.some((o, i) => i !== d.answerIndex && peers.some(p => String(p.m).trim() === o));
    if (hasSame) samePos++;
  });
  is(sameable === 0 || samePos === sameable, '有同词性候选时优先拿它当干扰项（' + samePos + '/' + sameable + '）');

  /* ---------------- 3. 三种来源的语义 ---------------- */
  console.log('== 3. 来源语义 ==');
  wipe();
  const first20 = ALL.slice(0, 20).map(e => e.id);
  // 先把 20 个词记住一半：一半变成"熟悉/掌握"，一半保持"学习中"
  first20.forEach((id, i) => {
    wordbook.setMastery(BID, id, i % 2 === 0 ? { m: 4, seen: 6 } : { m: 1, seen: 3 });
  });
  const map0 = wordbook.masteryMap(BID);
  const newPool = ws.pickWords(50, BID, 'new');
  is(newPool.length > 0, '新词来源有词（还剩一大半没见过）', newPool.length);
  is(newPool.every(e => !map0[e.id]), 'new 只取完全没有掌握记录的词');
  const revPool = ws.pickWords(50, BID, 'review');
  is(revPool.length > 0, '复习来源有词', revPool.length);
  is(revPool.every(e => map0[e.id] && (Number(map0[e.id].m) || 0) <= 2), 'review 只取学过但没掌握的（m<=2）');
  const dailyPool = ws.pickWords(50, BID, 'daily');
  // daily 不做任何过滤：它的池子一定不小于任一单一来源（新词、复习只是它的两个子集）
  is(dailyPool.length >= newPool.length && dailyPool.length >= revPool.length,
    'daily 覆盖面不小于任一单一来源（新词 / 复习都只是它的子集）', dailyPool.length);
  is(dailyPool.every(e => ALL.some(x => x.id === e.id)), 'daily 只吐当前词书的词');
  // 全记住之后 review 应为空：避免"复习"变成无限循环
  ALL.forEach(e => wordbook.setMastery(BID, e.id, { m: 4, seen: 9 }));
  eq(ws.pickWords(10, BID, 'review').length, 0, '全部掌握后 review 为空');
  eq(ws.pickWords(10, BID, 'new').length, 0, '全部见过后 new 为空');
  is(ws.pickWords(10, BID, 'daily').length === 10, 'daily 仍能出满一组（复习才是日常，不会无词可刷）');

  /* ---------------- 4. 排队顺序：该练的排前面 ---------------- */
  console.log('== 4. 排队优先级 ==');
  wipe();
  const last10 = ALL.slice(-10).map(e => e.id);
  // 末尾 10 个词练成"快会了"（m=1），前面的都练成"已经会了"（m=5）
  ALL.forEach(e => {
    if (last10.indexOf(e.id) >= 0) wordbook.setMastery(BID, e.id, { m: 1, seen: 1 });
    else wordbook.setMastery(BID, e.id, { m: 5, seen: 20 });
  });
  const ordered = ws.pickWords(ALL.length, BID, 'daily');
  // pickWords 有组量上限（DECK_SIZE.max），一次只会返回前若干名的词 ——
  // 所以只能"在出场的词里"比前后：拿 findIndex 的 -1 去比较会得出假结论。
  const pos = (id) => ordered.findIndex(e => e.id === id);
  const weakIdx = last10.map(pos);
  const strongIdx = ALL.filter(e => last10.indexOf(e.id) < 0).map(e => pos(e.id)).filter(i => i >= 0);
  is(weakIdx.every(i => i >= 0), '没掌握的词全部排进了这一组（10/10）');
  is(!!strongIdx.length && Math.max.apply(null, weakIdx) < Math.min.apply(null, strongIdx),
    '没掌握的词整体排在已掌握的词前面（m=1 先出场）');
  // 同一档位的词里，练过很多次的要往后排 —— 不然几块硬骨头会把整组题占满，
  // 用户会觉得"怎么老在刷这几个词"。
  // 排序里刻意带了随机抖动（每次组牌的顺序不完全一样），单次比较会偶发通过，
  // 所以这里跑多轮取平均位次：位次差是稳定的，单次输赢不是。
  const peers = last10.slice(1);
  const hot = last10[0];
  wordbook.setMastery(BID, hot, { m: 1, seen: 40 });
  const ROUNDS = 12;
  let hotSum = 0;
  let peerSum = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const od = ws.pickWords(ALL.length, BID, 'daily');
    const at = (id) => od.findIndex(e => e.id === id);
    hotSum += Math.max(0, at(hot));
    peers.forEach(id => { peerSum += Math.max(0, at(id)); });
  }
  const hotAvg = hotSum / ROUNDS;
  const peerAvg = peerSum / (ROUNDS * peers.length);
  is(hotAvg > peerAvg, '练过很多次的同档词平均排得更靠后（留给其它词露脸的机会）',
    hotAvg.toFixed(1) + ' vs ' + peerAvg.toFixed(1));

  /* ---------------- 5. counts 与 written-back ---------------- */
  console.log('== 5. 计数与回写 ==');
  wipe();
  const c0 = ws.counts(BID);
  eq(c0.new, ALL.length, '初始全部算新词');
  eq(c0.total, ALL.length, 'count 总数与词表一致');
  is(c0.new + c0.learning + c0.familiar + c0.mastered === c0.total, '四档之和 = 总数');

  // 走页面里那一模一样的回写路径：engine.recordAnswer + iplus1.recordMastery
  const item = ws.buildDeck(5, BID, 'daily')[0];
  const q = {
    sid: 'wd-' + item.id,
    dir: 'e2c',
    prompt: item.exampleEn || item.w,
    answer: item.exampleZh || item.m,
    lv: item.lv,
    note: '',
    words: item.words,
    wordIds: item.wordIds
  };
  const before = (wordbook.masteryMap(BID)[item.id] || {}).m || 0;
  engine.recordAnswer(q, 'pass', 'choice', '');
  iplus1.recordMastery(BID, item.wordIds, 'pass');
  const after = wordbook.masteryMap(BID)[item.id] || {};
  is((Number(after.m) || 0) >= before, '答对后掌握度上升或持平（' + before + ' → ' + after.m + '）');
  is(!!after.fs, '首次接触日期 fs 已写入（首页「每日新词」靠它统计）');
  const todayKey = engine.dateStr();
  const day = (store.get().days || {})[todayKey] || { total: 0, correct: 0 };
  eq(day.total, 1, '今日题量 +1（刷单词也算今日已练）');
  eq(day.correct, 1, '今日答对 +1');
  const gp0 = wordbook.goalProgress(BID);
  is(gp0.newWords.done >= 1, '「每日新词」进展计入本次刷词', gp0.newWords.done);
  // 答错 → 掉掌握度，且进错题本（练习页口径一致）
  const beforeFail = Number((wordbook.masteryMap(BID)[item.id] || {}).m) || 0;
  engine.recordAnswer(q, 'fail', 'choice', '');
  iplus1.recordMastery(BID, item.wordIds, 'fail');
  const afterFail = Number((wordbook.masteryMap(BID)[item.id] || {}).m) || 0;
  is(afterFail < beforeFail || afterFail === 0, '答错后掌握度下调（' + beforeFail + ' → ' + afterFail + '）');
  is((store.get().wrong || []).length === 1, '答错进错题本（有例句就当复习材料）');

  /* ---------------- 6. 例句挂载 ---------------- */
  console.log('== 6. 例句 ==');
  wipe();
  const withEx = ws.buildDeck(20, BID, 'daily').filter(d => d.exampleEn);
  is(withEx.length > 0, '组到的题里有带例句的', withEx.length + '/' + 20);
  is(withEx.every(d => /[A-Za-z]/.test(d.exampleEn)), '例句是英文（不是把释义当成句子塞进去）');
  const lowerHit = withEx.filter(d => String(d.exampleEn).toLowerCase().indexOf(String(d.w).toLowerCase()) >= 0);
  is(lowerHit.length > 0, '至少有一条例句直接含目标词形（页面高亮才看得见效果）', lowerHit.length);

  /* ---------------- 7. 页面契约 ---------------- */
  console.log('== 7. word-drill.vue 页面契约 ==');
  const pv = read(path.join('pkgStudy', 'pages', 'word-drill', 'word-drill.vue'));
  const pvScript = pv.slice(pv.indexOf('\n<script'), pv.indexOf('\n<style'));
  is(/alive:\s*true/.test(pvScript), 'data 里有 alive（异步取消标记）');
  const unload = (pvScript.match(/\n\s*onUnload\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  is(/this\.alive\s*=\s*false/.test(unload), 'onUnload 置 alive=false');
  is(/tts\.stop\(\)/.test(unload), 'onUnload 停掉语音（退出后不许还在念）');
  is(/clearAnswerTimer\(\)/.test(unload), 'onUnload 清掉延迟朗读定时器');
  is(/if\s*\(!this\.alive\)\s*return/.test(pvScript), '延迟回调里再判一次 alive（定时器跨越页面生命周期）');
  const hide = (pvScript.match(/\n\s*onHide\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  is(!!hide && !/alive\s*=\s*false/.test(hide), 'onHide 不置 alive=false（切后台回来还能继续刷）');
  // 这条模式的最大特点：不出题请求、不等 AI，组牌全在本地
  is(!/session\.buildSession|buildDrillSession/.test(pvScript), '不走句子出题（那是翻译练习的活）');
  is(!/sentence-api|ai-content/.test(pvScript), '不引 AI 出题模块（点进去就是第一题）');
  is(!/uni\.request|chatCompletion/.test(pvScript), '页面自身不发任何网络请求');
  // 回写两段都不能少
  is(/engine\.recordAnswer\(/.test(pvScript), '回写：engine.recordAnswer（今日统计 / 错题本 / 全局掌握度）');
  is(/iplus1\.recordMastery\(/.test(pvScript), '回写：iplus1.recordMastery（词书维度掌握度）');
  const qBlock = (pvScript.match(/const q = \{([\s\S]*?)\n      \}/) || [])[1] || '';
  is(/words:\s*item\.words/.test(qBlock) && /wordIds:\s*item\.wordIds/.test(qBlock),
    '喂给 recordAnswer 的题目带 words/wordIds（少了它掌握度不写）');
  is(/dir:\s*'e2c'/.test(qBlock), '错题本里存的是"英 → 中"方向（en/zh 不会颠倒）');
  // 空词书不能白屏
  is(/emptyText\s*=/.test(pvScript) && /wordbook\.bookWords\(this\.bookId\)\.length/.test(pvScript),
    '空词书走空态提示（不是转一圈然后白屏）');
  const tpl = pv.slice(0, pv.indexOf('\n<script'));
  is(/class="wd-input"/.test(tpl), '拼写模式有输入框');
  is(/data-s="'pass'/.test(tpl) && /data-s="'partial'/.test(tpl) && /data-s="'fail'/.test(tpl),
    '自评三档齐全（认识 / 模糊 / 不认识）');

  /* ---------------- 9. 模板引用不得指向不存在的字段 ---------------- */
  // 为什么单独一条：uni-app 模板里用到 data 里没有的字段不会报错，只会静默渲染成空白。
  // 演练，上一次迭代就出现过 —— 按钮上绑定了 {{ nextText }}，但 data 里压根没有这个键，
  // 结果最后一个词上的按钮是空的。编译期/运行环境都不吭声，只能静态守。
  console.log('== 8. 模板绑定 vs data 字段 ==');
  const tplStart = pv.indexOf('<template>');
  const tplRaw = pv.slice(tplStart, pv.indexOf('\n</script>'));
  const dataBlock = (pvScript.match(/\n\s*data\(\)\s*\{([\s\S]*?)\n  \},/) || [])[1] || '';
  const dataKeys = {};
  (dataBlock.match(/^\s{6}([A-Za-z_$][\w$]*)\s*:/gm) || []).forEach(m => {
    dataKeys[/([A-Za-z_$][\w$]*)\s*:/.exec(m)[1]] = true;
  });
  is(Object.keys(dataKeys).length > 10, '取到 data 字段表', Object.keys(dataKeys).length);
  // v-for 的作用域变量（(item, i) in cur.options / (item, index) in exampleTokens）
  const scope = {};
  (pv.match(/v-for="\(([^)]*)\)\s+in\s+/g) || []).forEach(m => {
    (/\(([^)]*)\)/.exec(m)[1]).split(',').forEach(x => { const k = x.trim(); if (k) scope[k] = true; });
  });
  (pv.match(/v-for="([A-Za-z_$][\w$]*)\s+in\s+/g) || []).forEach(m => {
    scope[/v-for="([A-Za-z_$][\w$]*)/.exec(m)[1]] = true;
  });
  is(!!scope.item && !!scope.index && !!scope.i, '识别到 v-for 作用域变量：' + Object.keys(scope).join(', '));
  const BUILTIN = { $t: 1, t: 1, true: 1, false: 1, null: 1, undefined: 1, Math: 1 };
  const exprs = [];
  (tplRaw.match(/\{\{([^}]*)\}\}/g) || []).forEach(m => exprs.push(m.slice(2, -2)));
  (tplRaw.match(/(?::|v-if|v-else-if|v-show)="([^"]*)"/g) || []).forEach(m => exprs.push(/="([^"]*)"$/.exec(m)[1]));
  const missing = {};
  exprs.forEach(raw => {
    const expr = raw.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    const re = /[A-Za-z_$][\w$]*/g;
    let m;
    while ((m = re.exec(expr))) {
      const before = expr.slice(0, m.index).replace(/\s+$/, '');
      if (before && /[.]$/.test(before)) continue;               // 属性取值：只看根标识符
      const after = expr.slice(m.index + m[0].length).replace(/^\s+/, '');
      if (/^\(/.test(after)) continue;                            // 函数调用
      const name = m[0];
      if (dataKeys[name] || scope[name] || BUILTIN[name]) continue;
      missing[name] = (missing[name] || 0) + 1;
    }
  });
  const missList = Object.keys(missing);
  is(missList.length === 0, '模板绑定的每个字段都在 data / v-for 作用域里' +
    (missList.length ? '（缺：' + missList.join('、') + '）' : ''));
  // 反向：模板里出现得的"职责字段"必须在 data 里（防止 nextText 这类漏配）
  ['idx', 'questions', 'sourceName', 'mode', 'cur', 'labels', 'phonetic', 'statusName',
    'answered', 'selected', 'input', 'canSubmit', 'spellHint', 'resultTitle', 'toneClass',
    'result', 'userAnswer', 'meaningText', 'masteryText', 'exampleTokens', 'favOn',
    'nextText', 'knownCount', 'summaryText', 'progressText', 'pop', 'emptyText',
    // 顶部双进度条的字段（模板绑定了但 data 里没有 → 静默空白，只能静态守）
    'answerCount', 'answerPct', 'answerText', 'barsSync', 'donePct'].forEach(k => {
      if (!dataKeys[k]) bad('data 缺字段 ' + k + '（模板会渲染成空白）');
    });

  /* ---------------- 9. 注册不漂移 ---------------- */
  console.log('== 9. 注册三处对齐 ==');
  const hlRaw = read('utils/home-layout.ts');
  const modIds = (hlRaw.match(/\{\s*id:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
  const modDesc = (hlRaw.match(/desc:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
  is(modIds.indexOf('worddrill') >= 0, 'home-layout 注册了 worddrill');
  is(modDesc.some(d => /刷单词|背单词/.test(d)), '模块说明讲清了它和翻译练习的区别');
  const schema = load('utils/page-schema.js');
  modIds.forEach(id => is(schema.BUILTIN_TYPES.indexOf(id) >= 0, 'page-schema.BUILTIN_TYPES 含 ' + id));
  eq(schema.BUILTIN_TYPES.length, modIds.length, 'BUILTIN_TYPES 与模块注册表一一对应（不多不少）');
  is(schema.BUTTON_ACTIONS.indexOf('worddrill') >= 0, 'page-schema.BUTTON_ACTIONS 含 worddrill（AI 卡按钮能进）');
  const cardSpec = load('utils/card-spec.js');
  is(!!cardSpec.PAGE_ROUTES.wordDrill &&
    cardSpec.PAGE_ROUTES.wordDrill.url === '/pkgStudy/pages/word-drill/word-drill',
    'card-spec.PAGE_ROUTES 含 wordDrill');
  is(cardSpec.PAGE_NAMES.indexOf('wordDrill') >= 0, 'PAGE_NAMES 暴露给 AI 指令的是 wordDrill');
  const pj = read('pages.json');
  is(pj.indexOf('"pages/word-drill/word-drill"') >= 0, 'pages.json 注册了页面');
  is(fs.existsSync(path.join(ROOT, 'pkgStudy', 'pages', 'word-drill', 'word-drill.vue')), '页面文件存在');
  // 首页卡与大 coworker
  const home = read('pages/home/home.vue');
  is(/WidgetWorddrill/.test(home) && /<widget-worddrill/.test(home), '首页有独立「刷单词」卡');
  const wSrc = read('components/home-widgets/widget-worddrill.vue');
  is(/uni\.\$on\('home:refresh', this\.refresh\)/.test(wSrc), '小组件订阅 home:refresh（刷完回首页就刷新）');
  is(/uni\.\$off\('home:refresh', this\.refresh\)/.test(wSrc), '小组件退订（tab 页常驻，避免重复监听）');
  is(/word-drill\/word-drill\?source=/.test(wSrc), '小组件三个入口都进刷单词页');

  /* ---------------- 10. 作答方式"选了就固定"（真跑页面方法） ---------------- */
  // 用户诉求：选了自评，下一个词也默认自评；选拼写就一路拼写。
  // 只断言"源码里没有 this.mode = 'choice'"是挡不住的 —— 换个写法（比如在
  // next() 里重置）照样能绕过静态扫描。所以这里把页面脚本真加载起来，
  // 对着真词书跑 setupQuestion / switchMode，看方式到底有没有保持。
  console.log('== 10. 作答方式固定：换了词也不回落 ==');
  const settingsMod = load('utils/settings.js', {});
  settingsMod.init();
  const tokenizeMod = load('utils/tokenize.js', {});
  const wordMark = load('utils/word-mark.js', {
    wordbook, lemma: lemmaMod.lemma, lemmaCandidates: lemmaMod.lemmaCandidates
  });
  // dict / tts 用最薄的桩：这条断言只关心作答方式，不关心释义与朗读。
  // （反过来，凡是要验释义/朗读的断言都必须用真模块，不能用桩 —— 见 MEMORY 的假绿纪律）
  const drillScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(pv) || [])[1] || '';
  const drillPage = loadCode(drillScript, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    engine, iplus1, wordbook, wordSession: ws, srs, settings: settingsMod,
    dict: { lookup: () => ({}) },
    barsSyncColors: () => true,
    sync: {}, tts: { speakAuto: () => {}, stop: () => {} },
    tokenize: tokenizeMod.tokenize,
    bookWordSet: wordMark.bookWordSet,
    targetWordSet: wordMark.targetWordSet,
    markTokens: wordMark.markTokens,
    sfx: { play: () => {} },
    FloatNavbar: {},
    WordSearch: {}
  }, 'word-drill.vue').default;
  is(!!drillPage && typeof drillPage.data === 'function', '页面脚本可加载（导出 default）');
  const newVM = () => Object.assign({}, drillPage.data(), drillPage.methods);

  eq(settingsMod.defaults().study.drillMode, 'choice',
    '默认作答方式 = 选义（老用户存档里没有这个键，深合并后也拿到它）');

  const drillDeck = ws.buildDeck(6, BID, 'daily');
  is(drillDeck.length >= 2, '组到 2 个以上词用于"换词"复验', drillDeck.length);

  const vm = newVM();
  vm.bookId = BID;
  vm.bookSet = wordMark.bookWordSet(BID);
  vm.questions = drillDeck;
  // 用户在第一个词上选了「自评」
  vm.switchMode({ currentTarget: { dataset: { m: 'self' } } });
  is(vm.mode === 'self', '点「自评」当场切过去', vm.mode);
  is(settingsMod.get().study.drillMode === 'self', '作答方式落盘（settings.study.drillMode）');
  // 关键：换到下一个词
  vm.setupQuestion(0);
  is(vm.mode === 'self', '换到第 1 个词仍是自评', vm.mode);
  vm.setupQuestion(1);
  is(vm.mode === 'self', '换到第 2 个词仍是自评（旧写法在这里弹回选义）', vm.mode);
  // 换成拼写 → 也是一路拼写
  vm.switchMode({ currentTarget: { dataset: { m: 'spell' } } });
  vm.setupQuestion(2);
  is(vm.mode === 'spell', '改成拼写后换词仍是拼写', vm.mode);
  // 重新进页面（data() 再跑一遍）= 上次用的方式
  is(newVM().mode === 'spell', '下次进页面还是上次那一种', newVM().mode);
  // 上面那次只证明"同一模块实例的内存 cache 还在"。真正的"记住"要过 storage ——
  // 换个全新的 settings 实例（= 重启 App）再读一次才算数。
  const settingsFresh = load('utils/settings.js', {});
  settingsFresh.init();
  is(settingsFresh.get().study.drillMode === 'spell',
    '重启 App 后仍读到拼写（真的写进 storage 了，不是只在内存里）',
    settingsFresh.get().study.drillMode);

  // 原行为不能丢：答过之后不许再切
  vm.answered = true;
  const beforeAns = vm.mode;
  vm.switchMode({ currentTarget: { dataset: { m: 'choice' } } });
  is(vm.mode === beforeAns, '已答完 → 点胶囊不生效（原护栏保留）', vm.mode);
  is(settingsMod.get().study.drillMode === beforeAns, '已答完 → 不写存档');
  vm.answered = false;
  // 脏数据 / 非法参数都不能崩、也不能写脏
  settingsMod.set({ study: { drillMode: '瞎写的' } });
  is(newVM().mode === 'choice', '存档是脏值 → 回落选义，不崩', newVM().mode);
  const beforeBad = vm.mode;
  vm.switchMode({ currentTarget: {} });
  is(vm.mode === beforeBad, '胶囊没有 data-m 时不炸、不改方式', vm.mode);
  settingsMod.set({ study: { drillMode: 'choice' } });

  // ⚠️ 真 bug 守门：上面几次 switchMode 都发生在"还没有会话"的时候，
  // 于是 setModes 那条分支从来没被执行 —— 典型的假绿。
  // 真刷题时会话一定存在，setModes 若给 const 重新赋值会抛
  // "Assignment to constant variable"，抛在 setupQuestion 之前，
  // 表现就是"胶囊高亮了、题目纹丝不动"—— 用户只以为按钮没用。
  (function () {
    const v = newVM();
    v.bookId = BID;
    v.bookSet = wordMark.bookWordSet(BID);
    v.questions = ws.buildDeck(4, BID, 'daily');
    v.session = ws.createConfirmSession(v.questions, { modes: ws.buildModeSequence('choice') });
    v.setupQuestion(0);
    let threw = '';
    try {
      v.switchMode({ currentTarget: { dataset: { m: 'spell' } } });
    } catch (e) {
      threw = String((e && e.message) || e);
    }
    eq(threw, '', '会话存在时切换作答方式不能抛错（modes 必须是 let）');
    eq(v.mode, 'spell', '会话存在时切换 → 偏好真的改了');
    eq(v.curMode, 'spell', '会话存在时切换 → 当前题目当场重画成新题型（这就是"看得见的后果"）');
    eq(v.promptIsWord, false, '切到拼写 → 题干立刻只给中文释义（不再显示单词）');
    // 切回来的链路同样要通
    let threw2 = '';
    try {
      v.switchMode({ currentTarget: { dataset: { m: 'choice' } } });
    } catch (e) {
      threw2 = String((e && e.message) || e);
    }
    eq(threw2, '', '切回去同样不抛错');
    eq(v.curMode, 'recog', '切回选义 → 当前题重画成认得出');
    eq(v.promptIsWord, true, '切回选义 → 题干重新显示单词');
  })();

  /* ---------------- 10b. 三关预览（让"点胶囊有用"看得见） ---------------- */
  // 真问题：三个胶囊看着像一排静态标签，用户点了不知道会发生什么 ——
  // 而它实际只改第一关。所以胶囊下面必须有一条会跟着变的"本轮三关"。
  console.log('== 10b. 三关预览（胶囊点了要有可见后果）==');
  (function () {
    const v = newVM();
    v.bookId = BID;
    v.bookSet = wordMark.bookWordSet(BID);
    v.questions = ws.buildDeck(4, BID, 'daily');
    v.session = ws.createConfirmSession(v.questions, { modes: ws.buildModeSequence(v.mode) });
    const names = () => v.modePlan.map(p => p.name).join(' > ');

    v.switchMode({ currentTarget: { dataset: { m: 'choice' } } });
    eq(v.modePlan.length, 3, '预览列出 3 关（不是只列当前这一关）');
    eq(names(), '认得出 > 想得起 > 写得出', '选义 → 认→想→写');
    is(v.modePlan[0].first === true, '第 1 项标了 first（= 跟着胶囊变的那一档）');
    is(v.modePlan[1].first === false && v.modePlan[2].first === false, '后两关不标 first');
    is(v.modePlan[0].on === true, '当前在第 1 关 → 第 1 项标 on');

    v.switchMode({ currentTarget: { dataset: { m: 'spell' } } });
    eq(names(), '写得出 > 认得出 > 想得起', '拼写 → 写→认→想（点完当场变，这就是"看得见的后果"）');
    v.switchMode({ currentTarget: { dataset: { m: 'self' } } });
    eq(names(), '自评 > 认得出 > 想得起', '自评 → 自评→认→想（自评只占第一关）');
    is(v.modePlan.every(p => typeof p.name === 'string' && p.name.length > 0), '每一项都有名字（模板不做函数调用，靠它预算）');

    // on 跟着连击走：过了第一关就该标到第 2 项 —— 这条顺带把它变成进度指示
    v.switchMode({ currentTarget: { dataset: { m: 'choice' } } });
    v.syncModePlan(1);
    is(v.modePlan[1].on === true, '连对一次 → on 移到第 2 项（预览兼做进度指示）');
    is(v.modePlan[0].on === false, '第 1 项不再标 on');
    v.syncModePlan(0);
    is(v.modePlan[0].on === true, '连击清零（答错退回第一关）→ on 回到第 1 项');
    // 走一遍真实链路：setupQuestion 必须把当前连击喂给预览（而不是永远标第 1 关）。
    // 用单词会话，答对后它会被排回队首，setupQuestion(0) 拿到的就是这个词
    const one = [v.questions[0]];
    v.questions = one;
    v.session = ws.createConfirmSession(one, { modes: ws.buildModeSequence('choice') });
    v.setupQuestion(0);
    is(v.modePlan[0].on === true, '闯第 1 关时预览标在第 1 项 = true', v.modePlan[0].on);
    v.session.answer(true);
    v.setupQuestion(v.questions.indexOf(v.session.current()));
    is(v.modePlan[1].on === true, '答对一关后重画 → 预览跟着标到第 2 项（真链路，不是只测函数）');

    // 模板契约：预览条必须真的渲染出来，且在胶囊下方、卡片上方
    const wdTpl = pv.slice(0, pv.lastIndexOf('</template>'));
    const iSw = wdTpl.indexOf('class="wd-switch"');
    const iPlan = wdTpl.indexOf('class="wd-plan"');
    const iCard = wdTpl.indexOf('class="card wd-card"');
    is(iSw > 0 && iPlan > iSw, '预览条排在胶囊之后');
    is(iCard > iPlan, '预览条排在词卡之前（顺序：胶囊 → 预览 → 提示 → 词卡）');
    is(/v-for="\(p, i\) in modePlan"/.test(wdTpl), '模板遍历 modePlan（不是写死三个）');
    is(/:class="\{ first: p\.first, on: p\.on \}"/.test(wdTpl), '模板按 first / on 上样式');
    is(/\{\{ \$t\('第一关跟着上面切换，后两关自动换成别的题型'\) \}\}/.test(wdTpl), '有一行说明文字讲清因果');
    is(/\{\{ \$t\('本轮三关'\) \}\}/.test(wdTpl), '预览条有「本轮三关」标签');
    // 选中态必须足够明显：只有"白底 + 蓝字"的话，一排胶囊里根本看不出哪个被选了
    const swActive = (pv.match(/\.wd-sw\.active\s*\{[\s\S]*?\}/) || [''])[0];
    is(/background:\s*var\(--brand/.test(swActive), '选中态用实心主色（不是只换个字色）');
    is(/color:\s*#ffffff/.test(swActive), '选中态文字转白（对比度够）');
  })();

  /* ---------------- 11. 多次确认会话（不背单词机制） ---------------- */
  // 用假词表精确驱动：createConfirmSession 是纯逻辑，不依赖真实掌握度
  console.log('== 11. 多次确认会话（三关跨题型）==');
  (function () {
    const fake = [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }];
    eq(ws.CONFIRM_TIMES, 3, '确认次数常量 = 3（连续答对三次才算记住）');
    eq(ws.CONFIRM_MODES, ['recog', 'recall', 'spell'], '三档题型按提取难度递增（识别→回忆→产出）');

    // 日常：全对也要过三关，且每关题型不同
    const s = ws.createConfirmSession(fake, {});
    eq(s.currentMode(), 'recog', '第 1 关 = 认得出（英→中选义）');
    let r = s.answer(true);            // w1 第 1 关
    is(r.done === false, '新词一遍答对不算记住');
    eq(r.mode, 'recog', '返回值带着这一关的题型（页面据此渲染）');
    eq(s.current().id, 'w2', '答对后先练别的词（不立即原题重现）');
    s.answer(true);                    // w2 第 1 关
    s.answer(true);                    // w3 第 1 关
    eq(s.currentMode(), 'recall', '回到 w1 换成第 2 关（想得起，中→英反向）');
    r = s.answer(true);                // w1 第 2 关
    is(r.done === false, '过了两关还不算记住');
    s.answer(true); s.answer(true);    // w2 / w3 第 2 关
    eq(s.currentMode(), 'spell', '第 3 关 = 写得出（中文+首字母拼写）');
    r = s.answer(true);                // w1 第 3 关 → 完成
    is(r.done === true, '三关全过 → 确认完成');
    eq(s.progress().done, 1, '进度 +1（页面顶部进度条的口径）');
    let guard = 0;
    while (!s.isDone() && guard++ < 50) s.answer(true);
    eq(s.progress().done, fake.length, '全对也逃不掉三关（done = 组词量）');
    eq(s.progress().answered, fake.length * 3, '总作答次数 = 词数 × 3（' + s.progress().answered + '）');

    // 复习：首答对即算记住；答错升级为完整确认
    const sr = ws.createConfirmSession(fake, { review: true });
    r = sr.answer(true);               // w1 首答对
    is(r.done === true, '复习：第一次就答对 → 直接算记住');
    const sr2 = ws.createConfirmSession(fake, { review: true });
    r = sr2.answer(false);             // w1 首答错
    is(r.need === 3, '复习首答错 → 升级为三关确认（need 1 → 3）');
    while (sr2.current() && sr2.current().id !== 'w1') sr2.answer(true);
    r = sr2.answer(true);              // w1 第二关
    is(r.done === false, '升级后一遍答对不再放行');

    // 答错打断连击：streak 清零，题型也退回第一关
    const sf = ws.createConfirmSession(fake, {});
    sf.answer(true);                   // w1 第 1 关
    while (sf.current() && sf.current().id !== 'w1') sf.answer(false);
    eq(sf.currentMode(), 'recall', 'w1 已连对一次 → 第 2 关');
    r = sf.answer(false);              // w1 第 2 关答错
    is(r.streak === 0 && r.done === false, '连对一次后答错 → 连击清零、不算记住');
    while (sf.current() && sf.current().id !== 'w1') sf.answer(false);
    eq(sf.currentMode(), 'recog', '答错后题型退回第 1 关（从头再走一遍）');

    // 「记错了」：撤销刚完成的确认（进度回退 + 回队列）；未完成的词只清连击
    const sm = ws.createConfirmSession(fake, {});
    sm.answer(true); sm.answer(true); sm.answer(true);   // 一轮 w1/w2/w3
    sm.answer(true); sm.answer(true); sm.answer(true);   // 二轮
    sm.answer(true);                                     // w1 三轮 → 完成，done=1
    eq(sm.progress().done, 1, '改判前 done = 1');
    sm.markWrong('w1');
    eq(sm.progress().done, 0, '记错了（已计入进度的）→ 进度回退');
    is(sm.current() !== null, '记错了 → 词重新回队列');
    sm.markWrong('w2');                                   // w2 还没完成，只清连击
    eq(sm.progress().done, 0, '记错了（未计入进度的）→ 不误伤 done');
  })();

  /* ---------------- 12. 记错了改判：revoke 链路 ---------------- */
  console.log('== 12. 记错了改判（revokePass / revokeMastery） ==');
  (function () {
    wipe();
    const item = ws.buildDeck(1, BID, 'daily')[0];
    const q = {
      sid: 'wd-' + item.id, dir: 'e2c',
      prompt: item.exampleEn || item.w, answer: item.exampleZh || item.m,
      lv: item.lv, note: '', words: item.words, wordIds: item.wordIds
    };
    // 页面路径：先按 pass 记账
    engine.recordAnswer(q, 'pass', 'choice', '蒙对的');
    iplus1.recordMastery(BID, item.wordIds, 'pass');
    const mPass = Number((wordbook.masteryMap(BID)[item.id] || {}).m) || 0;
    const dayPass = (store.get().days || {})[engine.dateStr()] || { total: 0, correct: 0 };

    // 点「记错了」
    engine.revokePass(q, 'choice', '蒙对的');
    iplus1.revokeMastery(BID, item.wordIds);

    const mAfter = Number((wordbook.masteryMap(BID)[item.id] || {}).m) || 0;
    is(mAfter < mPass, '词书掌握度净下调（' + mPass + ' → ' + mAfter + '）');
    const day2 = (store.get().days || {})[engine.dateStr()] || { total: 0, correct: 0 };
    eq(day2.total, dayPass.total, '今日题量不重复计（改判不是再做一题）');
    eq(day2.correct, Math.max(0, dayPass.correct - 1), '今日 correct -1（那题改判为错）');
    is((store.get().wrong || []).some(x => x.sid === q.sid), '改判后进错题本（稍后重练）');
    // 全局掌握度（engine 维度）同样净下调
    const gm = store.get().mastery[item.id] || { m: 0 };
    is(Number(gm.m) <= 0, '全局掌握度也改判（m = ' + gm.m + '）');
  })();

  /* ---------------- 13. 页面契约：确认机制 + 记错了 ---------------- */
  console.log('== 13. 页面契约（多次确认 / 记错了） ==');
  (function () {
    const tpl = pv.slice(0, pv.indexOf('\n<script'));
    is(/createConfirmSession/.test(pvScript), '接了多次确认会话（createConfirmSession）');
    is(/this\.session\.answer\(status === 'pass'\)/.test(pvScript), 'partial/fail 都喂"不认识"给会话');
    is(/markWrong/.test(pvScript) && /engine\.revokePass\(/.test(pvScript), '「记错了」接 engine.revokePass');
    is(/iplus1\.revokeMastery\(/.test(pvScript), '「记错了」同步撤销词书维度掌握度');
    is(/session\.markWrong\(/.test(pvScript), '「记错了」把词打回确认队列（连击清零）');
    is(/t\('再确认'\)/.test(pvScript), '第二次见到的词有「再确认」标记（JS 预计算进 confirmTag）');

    // 顶部两条进度条：上面"做了多少"（累计、无上限）、下面"会了多少"（doneCount）
    // 只数横条本身，不数条内的 .wd-bar-k / .wd-bar-v（前缀相同，别用模糊匹配）
    const barCount = (tpl.match(/class="wd-bar (?:\s*)(?:done|know)"/g) || []).length;
    eq(barCount, 2, '顶部两条进度条（已做 / 记住）');
    is(/\{\{ answerText \}\}/.test(tpl), '上面那条显示累计作答次数（不带分母 = 没有上限）');
    is(!/\{\{ triedCount \}\}/.test(tpl), '上面那条不再显示"x / 组词数"（会被组词数卡住）');
    is(/\{\{ doneCount \}\} \/ \{\{ questions\.length \}\}/.test(tpl), '下面那条显示"记住 x / n"（确认记住的词数）');
    is(/width: answerPct \+ '%'/.test(tpl) && /width: donePct \+ '%'/.test(tpl),
      '两条进度都走 JS 预计算的百分比（模板不做运算）');
    is(/syncBars\(\)/.test(pvScript), '有 syncBars() 统一刷新两条进度');
    // 配色：两条的颜色由设置决定，且必须走 CSS 变量（换主题色要跟着变，不能写死色值）
    is(/:class="barsSync \? 'sync' : 'split'"/.test(tpl), '两条进度条按设置切 sync / split 两套颜色');
    const wdStyle = pv.slice(pv.indexOf('\n<style'));
    ['.wd-top.sync .wd-bar.done .progress-fill', '.wd-top.sync .wd-bar.know .progress-fill',
      '.wd-top.split .wd-bar.done .progress-fill', '.wd-top.split .wd-bar.know .progress-fill'
    ].forEach(sel => {
      is(wdStyle.indexOf(sel) >= 0, '样式里有 ' + sel);
    });
    is(/rgba\(var\(--brand-rgb/.test(wdStyle) && /var\(--brand, #2e6bff\)/.test(wdStyle),
      'sync 模式用主题色的浅版 + 主题色实心（走 CSS 变量，跟着主题走）');
    is(/\.wd-top\.split[^}]*\{[^}]*#2f9e6e/.test(wdStyle.replace(/\n/g, ' ')),
      'split 模式下"已会"那条是绿色（与主题色分开）');
    is(/barsSyncColors\(\)/.test(pvScript), '颜色开关读 theme.barsSyncColors()（唯一读取口）');
    // 每日目标口径：确认达标 +1，「记错了」-1
    is(/addMasteredToday\(1\)/.test(pvScript), '确认达标 → engine.addMasteredToday(1)');
    is(/addMasteredToday\(-1\)/.test(pvScript), '「记错了」→ engine.addMasteredToday(-1)');
    is(/r\.rolledBack/.test(pvScript), '只在会话真的回退了进度时才撤那一笔（不误伤未完成的词）');
  })();

  /* ---------------- 14. 页面链路：学会计数真的落账 ---------------- */
  // 静态断言挡不住"记了一笔但记错地方"。这里真跑 finish / markWrong，
  // 看 days[today].mastered 到底有没有跟着确认会话走。
  console.log('== 14. 顶部双进度 + 学会计数（真跑页面方法） ==');
  (function () {
    wipe();
    is(typeof engine.addMasteredToday === 'function', 'engine 导出 addMasteredToday');
    const k = engine.dateStr();
    const dayOf = () => (store.get().days || {})[k] || { total: 0, correct: 0, mastered: 0 };
    engine.addMasteredToday(1);
    eq(dayOf().mastered, 1, 'addMasteredToday(+1) 落在 days[today].mastered');
    engine.addMasteredToday(-5);
    eq(dayOf().mastered, 0, '减成负数夹在 0（不会出现负进度）');
    eq(dayOf().total, 0, 'addMasteredToday 不动今日题量（那是 recordAnswer 的活）');

    // 换一套带 sync 桩的实例：finish() 会调 sync.recordStudy
    const drillPage2 = loadCode(drillScript, {
      t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m2, kk) => (v && v[kk] != null ? String(v[kk]) : m2)),
      engine, iplus1, wordbook, wordSession: ws, srs, settings: settingsMod,
      dict: { lookup: () => ({}) },
      barsSyncColors: () => true,
      sync: { recordStudy: () => {}, mirrorFavorite: () => {}, unmirrorFavorite: () => {} },
      tts: { speakAuto: () => {}, stop: () => {} },
      tokenize: tokenizeMod.tokenize,
      bookWordSet: wordMark.bookWordSet,
      targetWordSet: wordMark.targetWordSet,
      markTokens: wordMark.markTokens,
      sfx: { play: () => {} },
      FloatNavbar: {},
    WordSearch: {}
    }, 'word-drill.vue').default;

    const deck2 = ws.buildDeck(3, BID, 'daily');
    is(deck2.length === 3, '组到 3 个词用于走完确认流程', deck2.length);
    const vm2 = Object.assign({}, drillPage2.data(), drillPage2.methods);
    vm2.bookId = BID;
    vm2.bookSet = wordMark.bookWordSet(BID);
    vm2.questions = deck2;
    vm2.session = ws.createConfirmSession(deck2, {});
    vm2.seenTimes = {};
    vm2.doneCount = 0;
    vm2.answerCount = 0;
    vm2.alive = true;
    vm2.setupByItem(vm2.session.current());
    eq(vm2.answerCount, 0, '第一个词刚出现、还没作答 → 已做 = 0');
    eq(vm2.doneCount, 0, '还没确认 → 记住 = 0');

    // 第一轮：三个词各答一遍 —— 都没到确认次数（need=3），学会数一动不动
    eq(vm2.curMode, 'recog', '第一关 = 认得出（英→中选义）');
    eq(vm2.promptIsWord, true, '认得出这一关显示单词');
    for (let i = 0; i < 3; i++) {
      vm2.finish('pass', 1, '');
      vm2.setupByItem(vm2.session.current());
    }
    eq(vm2.answerCount, 3, '第一轮答完 → 已做 = 3（累计作答次数）');
    eq(vm2.answerPct, 100, '刚好做完一轮 → 上面那条满格');
    eq(vm2.doneCount, 0, '各答一遍不算学会（记住仍是 0）');
    eq(dayOf().mastered, 0, '一遍答对不进"学会"计数（蒙对不算）');
    eq(dayOf().total, 3, '但今日题量照记 3 题（做了就是做了）');

    // 第二轮（确认轮）：累计继续往上走 —— 上面那条没有上限，进度条进入下一轮
    vm2.finish('pass', 1, '');                        // 第 4 次作答（w1 第二关）
    eq(vm2.answerCount, 4, '进入第二轮 → 累计照加（不被组词数卡住）');
    eq(vm2.answerPct, 33, '第二轮第 1 题 → 上面那条从头再长（1/3 = 33%）');
    is(/第 2 轮/.test(vm2.answerText), '超过一轮后标出轮次（' + vm2.answerText + '）');
    vm2.setupByItem(vm2.session.current());
    eq(vm2.curMode, 'recall', '第二轮换题型 = 想得起（中→英反向）');
    // 反向题的题干是中文释义，不能再把单词摆出来（那等于没考）
    eq(vm2.promptIsWord, false, '想得起这一关不显示单词，只给中文释义');
    eq(vm2.promptText, vm2.cur.m, '题干 = 中文释义');
    vm2.finish('pass', 1, '');                        // 第 5 次（w2 第二关）
    vm2.setupByItem(vm2.session.current());
    vm2.finish('pass', 1, '');                        // 第 6 次（w3 第二关）
    eq(vm2.answerCount, 6, '两轮下来累计 6 次（组词数只有 3 → 确实没有上限）');
    eq(vm2.doneCount, 0, '过了两关仍不算学会（三关才够）');
    vm2.setupByItem(vm2.session.current());
    eq(vm2.curMode, 'spell', '第三轮换题型 = 写得出（中文+首字母拼写）');
    eq(vm2.promptIsWord, false, '拼写关同样不显示单词');
    is(/_/.test(vm2.spellHint), '拼写提示带首字母下划线（' + vm2.spellHint + '）');

    // 第三轮：三个词各过最后一关
    for (let i = 0; i < 3; i++) {
      vm2.finish('pass', 1, '');
      vm2.setupByItem(vm2.session.current());
    }
    eq(vm2.answerCount, 9, '三轮下来累计 9 次（3 词 × 3 关）');
    eq(vm2.doneCount, 3, '全部确认完成 → 记住 = 3');
    eq(dayOf().mastered, 3, '学会计数 = 3（与"记住"那条进度条一致）');
    eq(vm2.donePct, 100, '记住进度 100%');
    // 三关全过 = 当场学会，但**不等于长期记住** → 必须排进巩固队列，明天来确认
    const mm = wordbook.masteryMap(BID) || {};
    const queued = vm2.questions.filter(x => mm[x.id] && mm[x.id].due);
    eq(queued.length, 3, '三个词都排进了巩固队列（due 已写入）');
    is(srs.isDue(mm[vm2.questions[0].id], srs.dateStr()) === false,
      '学会当天不算到期（最早明天才回来确认）');
    eq(srs.diffDays(srs.dateStr(), mm[vm2.questions[0].id].due), 1, '首次巩固安排在明天（间隔 1 天）');
    is(/已巩固/.test(vm2.srsText), '答后揭示里显示巩固进度（' + vm2.srsText + '）');

    // 「记错了」：把最后那个词撤回来，学会计数跟着 -1；但"已做"是累计的，不回退
    const beforeWrong = dayOf().mastered;
    const beforeAns = vm2.answerCount;
    vm2.markWrong();
    eq(vm2.doneCount, 2, '改判后"记住"回退到 2');
    eq(dayOf().mastered, Math.max(0, beforeWrong - 1), '学会计数 -1（改判不留虚账）');
    eq(vm2.answerCount, beforeAns, '"已做"是累计口径，改判不回退（做了就是做了）');
    eq(dayOf().total, 9, '今日题量不变（改判不是又做了一题）');
  })();

  console.log('');
  console.log(fail === 0 ? '刷单词模式 校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});
