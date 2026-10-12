// _tools/check-study-resume.js - 练习页「断点续练」校验
//
// 背景：背单词 / 句子练习的场次进度原先只活在页面内存里，退出页面就重置
// （2026-10-12 用户反馈）。修法是 utils/study-resume.js 落盘 + 两个页面接入。
//
// 断言：
//   1) study-resume.js 契约：按 (页面, 词书, 来源) 分钥匙、有版本号与过期、
//      损坏/过期数据一律当"没有断点"而不是抛到页面上
//   2) word-session 的快照能力：存进去再灌回来，队列和连对次数要一模一样；
//      快照对不上（词书换过）时自己放弃，绝不返回空题
//   3) 两个页面的接入点：退出存、进来读、做完清、换一组清
//   4) 真跑：模拟"答几题 → 退出 → 重新进"，进度必须接上

const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const eq = (a, b, m) => (a === b ? ok(m + ' = ' + b) : bad(m + ' 期望 ' + b + '，实际 ' + a));
const assert = (c, m) => (c ? ok(m) : bad(m));

// ---------- 第 1 组：study-resume.js 源码契约 ----------
console.log('== 1. study-resume.js 契约 ==');
const RS = 'utils/study-resume.js';
const src = fs.readFileSync(path.join(ROOT, RS), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
assert(/uni\.setStorageSync/.test(code) && /uni\.getStorageSync/.test(code),
  '落 storage（模块级变量扛不住"退出 App 再进来"）');
assert(/PREFIX/.test(code) && /bookId/.test(code) && /source/.test(code),
  '钥匙按 页面 + 词书 + 来源 分开（两组都练到一半时互不覆盖）');
assert(/TTL_MS/.test(code), '有过期时间（放太久的断点没有意义）');
assert(/MAX_ITEMS/.test(code), '题量有上限（脏数据不许把 storage 撑爆）');
for (const fn of ['load', 'save', 'clear', 'clearAll']) {
  assert(new RegExp('export function ' + fn + '\\(').test(code), '导出 ' + fn + '()');
}
// 三条"必须永远安全"的路径：storage 不可用 / JSON 坏了 / 没有这条 key
assert((code.match(/catch \(e\)/g) || []).length >= 4,
  '每条读写都包了 try/catch（storage 不可用、坏 JSON 都不许炸到页面上）');

// ---------- 第 2 组：运行时真跑 study-resume ----------
console.log('');
console.log('== 2. 真跑 study-resume ==');
const mem = {};
const uniStub = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(mem) })
};
const rs = load(RS, { uni: uniStub });

const ITEMS = [{ id: 101 }, { id: 102 }, { id: 103 }];
eq(rs.save('drill', 'core', 'daily', { items: ITEMS, queue: [102, 103], idx: 1 }), true, '存一份断点');
const got = rs.load('drill', 'core', 'daily');
assert(!!got, '取回来');
eq((got.items || []).length, 3, '题目整份带回来了');
eq(got.idx, 1, '做到第几题带回来了');

// 钥匙分开：另一边（句子练习）的断点不能被顶掉
rs.save('practice', 'core', 'daily', { items: ITEMS, idx: 2 });
eq(got && rs.load('drill', 'core', 'daily').idx, 1, '刷单词的断点没被句子练习顶掉');
eq(rs.load('practice', 'core', 'daily').idx, 2, '句子练习自己的断点在');
// 同页面不同来源也要分开
rs.save('drill', 'core', 'review', { items: ITEMS, idx: 3 });
eq(rs.load('drill', 'core', 'daily').idx, 1, 'daily 与 review 分开存');
eq(rs.load('drill', 'core', 'review').idx, 3, 'review 那份在');
// 不同词书分开
rs.save('drill', 'other', 'daily', { items: ITEMS, idx: 4 });
eq(rs.load('drill', 'core', 'daily').idx, 1, '换词书不会串到别的词书的进度');

// 过期
mem['fj_study_resume_v1_drill_core_daily'] = JSON.stringify({
  v: 1, at: Date.now() - 8 * 24 * 3600 * 1000, items: ITEMS, idx: 1
});
eq(rs.load('drill', 'core', 'daily'), null, '超过 7 天的断点当没有（null，不报错）');

// 坏数据三条：版本号不对 / 不是 JSON / 题目为空
mem['fj_study_resume_v1_drill_core_daily'] = JSON.stringify({ v: 99, at: Date.now(), items: ITEMS });
eq(rs.load('drill', 'core', 'daily'), null, '版本号对不上 → 丢弃');
mem['fj_study_resume_v1_drill_core_daily'] = '{ 这不是 json';
eq(rs.load('drill', 'core', 'daily'), null, '坏 JSON → 丢弃（不抛）');
eq(rs.save('drill', 'core', 'daily', { items: [] }), false, '空题组不存（直接清掉更干净）');

// storage 整个不可用（隐私模式）
const deadRs = load(RS, {
  uni: {
    getStorageSync: () => { throw new Error('deny'); },
    setStorageSync: () => { throw new Error('deny'); },
    removeStorageSync: () => { throw new Error('deny'); }
  }
});
eq(deadRs.load('drill', 'core', 'daily'), null, 'storage 不可用 → 取回 null（页面照常出一组新题）');
eq(deadRs.save('drill', 'core', 'daily', { items: ITEMS }), false, '存失败返回 false，不抛');

// ---------- 第 3 组：word-session 的快照 / 恢复 ----------
console.log('');
console.log('== 3. 真跑会话快照 ==');
const ws = load('utils/word-session.js', {
  uni: uniStub,
  wordbook: { masteryMap: () => ({}), bookWords: () => [], currentBookId: () => 'core' },
  sentenceIndex: { candidates: () => [] },
  srs: { dateStr: () => '2026-10-13', isDue: () => false, overdueDays: () => 0 }
});
const deck = [
  { id: 1, w: 'abandon', m: '放弃' },
  { id: 2, w: 'benefit', m: '益处' },
  { id: 3, w: 'campaign', m: '运动' }
];
const s1 = ws.createConfirmSession(deck, { review: false, modes: ['recog', 'recall', 'spell'] });
s1.answer(true);   // 词1 连对 1 次，重新排队
s1.answer(false);  // 词2 答错，streak 归零
const snap = s1.snapshot();
eq(snap.answered, 2, '快照记了作答次数');
eq(JSON.stringify(snap.queue), JSON.stringify([3, 1, 2]), '快照记的是队列（会重排，光记下标恢复不出来）');
eq(snap.state[1].streak, 1, '词1 的连对次数在快照里');
eq(snap.state[2].streak, 0, '词2 答错后归零');

// 用同一份 deck 重建 → 必须完全一致
const s2 = ws.createConfirmSession(deck, { review: false, modes: ['recog', 'recall', 'spell'], saved: snap });
eq(s2.resumed(), true, '标记"这是恢复来的"');
eq(JSON.stringify(s2.snapshot().queue), JSON.stringify(snap.queue), '队列一模一样');
eq(s2.progress().answered, 2, '作答次数接上了');
eq(s2.progress().done, s1.progress().done, '已记住数接上了');
eq(String(s2.current() && s2.current().id), '3', '当前题接上了（不是从头来）');

// 快照对不上（词书换过 → deck 里没那些 id）→ 自己放弃，退回全新一组
const otherDeck = [{ id: 7, w: 'x', m: '甲' }, { id: 8, w: 'y', m: '乙' }];
const s3 = ws.createConfirmSession(otherDeck, { review: false, saved: snap });
eq(s3.resumed(), false, '快照与这组词对不上 → 放弃（不硬灌）');
eq(JSON.stringify(s3.snapshot().queue), JSON.stringify([7, 8]), '退回全新一组，队列是完整的');
eq(String(s3.current() && s3.current().id), '7', 'current() 拿得到题（不会返回空题把页面搞白）');

// 队列里有重复 id 的坏快照 → 也必须放弃
const dupSnap = Object.assign({}, snap, { queue: [1, 1, 2] });
eq(ws.createConfirmSession(deck, { saved: dupSnap }).resumed(), false, '队列有重复 id → 放弃');

// 空队列 = 这一组做完了，恢复它等于直接结束（正常路径，不该被当成坏数据）
const doneSnap = Object.assign({}, snap, { queue: [], done: 3 });
const s4 = ws.createConfirmSession(deck, { saved: doneSnap });
eq(s4.isDone(), true, '空队列快照 = 上次这组已做完');

// ---------- 第 4 组：两个页面的接入点 ----------
console.log('');
console.log('== 4. 页面接入 ==');
const PAGES = {
  '背单词': 'pkgStudy/pages/word-drill/word-drill.vue',
  '句子练习': 'pkgStudy/pages/practice/practice.vue'
};
Object.keys(PAGES).forEach((name) => {
  const p = fs.readFileSync(path.join(ROOT, PAGES[name]), 'utf8');
  const rel = PAGES[name];
  assert(/utils\/study-resume\.js/.test(p), name + '：引入了 study-resume');
  assert(/saveResume\(\)/.test(p), name + '：有存断点的方法');
  assert(/resume\.clear\(/.test(p), name + '：有清断点的调用（做完 / 换一组）');
  assert(/resumeHint/.test(p), name + '：顶部有「接着上次」提示字段');
  assert(/onUnload[\s\S]{0,400}saveResume\(\)/.test(p), name + '：onUnload 也存一次（兜底）');
  assert(/restart\(\)[\s\S]{0,200}resume\.clear\(/.test(p), name + '：点「重新开始」先清断点（否则又读回来了）');
});
const wd = fs.readFileSync(path.join(ROOT, PAGES['背单词']), 'utf8');
assert(/saved: saved/.test(wd), '背单词：把快照喂给 createConfirmSession');
assert(/resumeHint = \(saved && this\.session\.resumed\(\)\)/.test(wd),
  '背单词：只有真恢复成功才提示（快照对不上时别跟用户提）');
const pr = fs.readFileSync(path.join(ROOT, PAGES['句子练习']), 'utf8');
assert(/if \(this\.restore\(source\)\) return/.test(pr), '句子练习：出题之前先看有没有断点');
assert(/items: this\.questions\b/.test(pr), '句子练习：题目整份存（不重新生成，AI 出题既慢又会换题）');

// ---------- 第 5 组：真跑"答几题 → 退出 → 重进" ----------
console.log('');
console.log('== 5. 真跑背单词页：退出再进来 ==');
const storage = {};
const pageUni = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
  showToast: () => {},
  request: () => {}
};
// 造 5 个词的假词书，绕开真实语料
const WORDS = [11, 12, 13, 14, 15].map(id => ({ id: id, w: 'w' + id, m: '义' + id, pos: 'n', lv: 1 }));
const fakeWordbook = {
  bookWords: () => WORDS,
  masteryMap: () => ({}),
  currentBookId: () => 'core',
  setMastery: () => {},
  getGoal: () => ({ practice: 10 })
};
const depBag = {
  uni: pageUni,
  wordbook: fakeWordbook,
  wordSession: load('utils/word-session.js', {
    uni: pageUni, wordbook: fakeWordbook,
    sentenceIndex: { candidates: () => [] },
    srs: { dateStr: () => '2026-10-13', isDue: () => false, overdueDays: () => 0 }
  }),
  resume: load(RS, { uni: pageUni }),
  engine: { recordAnswer: () => {}, addMasteredToday: () => {}, dailyQuestions: () => [] },
  iplus1: { recordMastery: () => {}, revokeMastery: () => {} },
  srs: { dateStr: () => '2026-10-13', learn: () => ({}), review: () => ({}), isDue: () => false },
  dict: { lookup: () => null },
  settings: { get: () => ({}), set: () => {} },
  theme: { barsSyncColors: () => true },
  sync: { mirrorFavorite: () => {}, unmirrorFavorite: () => {} },
  tts: { stop: () => {}, speakAuto: () => {}, speakSentence: () => {} },
  tokenize: () => [],
  // 页面是具名导入 { bookWordSet, targetWordSet, markTokens }，不是 wordMark.* ——
  // 依赖袋必须按 import 语句的原样给，漏一个就是 ReferenceError
  bookWordSet: () => ({}),
  targetWordSet: () => ({}),
  markTokens: () => [],
  wordMark: { bookWordSet: () => ({}), targetWordSet: () => ({}), markTokens: () => [] },
  sfx: { play: () => {} },
  confusion: { should: () => false, bump: () => {}, markTaught: () => {} },
  link: { hasCtx: () => false, getCtx: () => null, finish: () => {} },
  onboarding: { need: () => false, done: () => {} },
  t: (k) => String(k),
  BUILD_INFO: { version: '1.3 Beta' },
  FloatNavbar: { name: 'FloatNavbar' },
  WordSearch: { name: 'WordSearch' },
  ConfusionCard: { name: 'ConfusionCard' }
};

const wdSrc = fs.readFileSync(path.join(ROOT, PAGES['背单词']), 'utf8');
const wdScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(wdSrc) || [])[1] || '';
const Comp = loadCode(wdScript, depBag, 'word-drill.vue').default;
assert(!!(Comp && Comp.methods), '背单词页脚本起得来');

// 模拟一个页面实例（只挂用得上的字段）
function mount() {
  const vm = Object.assign({
    alive: true,
    bookId: 'core',
    source: 'daily',
    mode: 'choice',
    questions: [],
    session: null,
    doneCount: 0,
    answerCount: 0,
    resumeHint: '',
    counts: { pass: 0, partial: 0, fail: 0 },
    seenTimes: {},
    bookSet: {},
    $refs: {}
  }, Comp.methods);
  // start() 里会调 syncBars / setupByItem，这两个依赖别的字段，给个空壳顶住
  vm.syncBars = () => {};
  vm.setupByItem = (item) => { vm.lastItem = item; };
  return vm;
}

const p1 = mount();
p1.start('daily');
eq(p1.questions.length, 5, '第一次进：组了 5 个词');
eq(p1.resumeHint, '', '第一次进没有「接着上次」提示');
// 答 3 题（答错，这样队列会重排得比较明显）
const first = p1.session.current();
p1.session.answer(false);
p1.session.answer(false);
p1.session.answer(false);
p1.saveResume();
const before = JSON.stringify(p1.session.snapshot().queue);
eq(p1.session.progress().answered, 3, '答了 3 次');
assert(Object.keys(storage).length > 0, '断点落盘了（storage 里有东西）');

// 退出：页面销毁，内存里的会话全丢
const p2 = mount();     // 等价于"重新打开页面"：内存是全新的
p2.start('daily');
eq(p2.session.progress().answered, 3, '重新进来：作答次数接上了（不是 0）');
eq(JSON.stringify(p2.session.snapshot().queue), before, '队列接上了（练到哪个词没乱）');
eq(String(p2.session.current() && p2.session.current().id),
  String(p1.session.current() && p1.session.current().id), '当前要练的词还是刚才那个');
assert(p2.resumeHint !== '', '顶部给了「接着上次」提示 = ' + p2.resumeHint);
// 中途再答两题、再退出一次，仍然接得上
p2.session.answer(true);
p2.saveResume();
const p3 = mount();
p3.start('daily');
eq(p3.session.progress().answered, 4, '退出两次也接得上');

// 「重新开始」→ 断点清空，此后进来是全新一组
p3.restart();
eq(p3.resumeHint, '', '点「重新开始」后不再是"接着上次"');
eq(p3.session.progress().answered, 0, '重新开始：作答次数归零');
const p4 = mount();
p4.start('daily');
eq(p4.session.progress().answered, 0, '重新开始之后退出再进，也是全新的（断点已清）');
eq(p4.resumeHint, '', '此时不该再提示"接着上次"');

console.log('');
console.log(fail === 0 ? '断点续练全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
