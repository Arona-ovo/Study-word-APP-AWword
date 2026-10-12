// _tools/check-cover-mascot.js - 校验启动页阿罗娜表情按学习状态切换（只读）
// 断言：
//   1. cover.vue 圆框是**两层图**：底层 baseSrc（= 原生启动图那张）+ 上层 moodSrc（状态表情）
//   2. 换脸必须是**淡入**，不是直接改 src（直接改 = 用户看到圆圈里跳了两张脸）
//   3. pickMood 调真实 engine 的 history/streak/overview/dateStr，按 9 种状态选 7 种表情
//   4. 七张表情图真实存在于 static/mascot/，体积可控（<120KB）
//   5. 各学习状态下引擎读数与预期表情一致（用真实 engine 计算）
//   6. 原生启动图（gen-splash.py 的 MASCOT）与 cover 底层图是**同一张**
//   7. 换脸时序真跑：首帧不换、动画没走完不换、图没解码不换、@load 不来有兜底
const { load, loadCode } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}

// ---------- 第 1 组：cover.vue 源码契约 ----------
console.log('[1] cover.vue 源码契约');
const src = fs.readFileSync(path.join(ROOT, 'pages', 'cover', 'cover.vue'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');
if (/:src="baseSrc"/.test(src)) ok('底层 image 绑定 baseSrc（= 原生启动图那张脸）');
else bad('底层 image 未绑定 baseSrc');
if (/:src="moodSrc"/.test(src)) ok('上层 image 绑定 moodSrc（按状态选的表情）');
else bad('上层 image 未绑定 moodSrc');
// ⚠️ 老写法是 data 里 mascotSrc: MASCOTS.hi、onLoad 里再赋一次 —— 同一次启动渲染两张脸，
//    用户看到的就是"圆圈里的图片变成两种"。这条把硬切钉死。
if (!/this\.mascotSrc\s*=/.test(src)) ok('不再直接改写同一个 src（那是硬切）');
else bad('仍在 onLoad 里直接改 src —— 用户会看到两张脸');
if (/moodSrc:\s*MASCOTS\[BASE_MOOD\]/.test(src)) ok('moodSrc 初值不是 pickMood 结果（首帧不许直接上表情）');
else bad('moodSrc 初值就是状态表情（首帧会跟原生启动图不一致）');
if (!/src="\/static\/mascot\.jpg"/.test(src)) ok('不再写死 /static/mascot.jpg');
else bad('仍写死 /static/mascot.jpg');
if (/pickMood/.test(src)) ok('存在 pickMood');
else bad('缺少 pickMood');
for (const call of ['history(0)', 'dateStr()', 'streak()', 'overview()']) {
  if (src.includes(call)) ok('pickMood 调用 engine.' + call.replace('()', ''));
  else bad('pickMood 未调用 ' + call);
}
for (const mood of ['smile', 'tongue', 'hi', 'nervous', 'sad', 'angry', 'shocked']) {
  // MASCOTS 键 + pickMood 逻辑里都要出现（部分走三目表达式，不强制 return 形式）
  if (new RegExp(mood + '\\s*:').test(src) && src.includes("'" + mood + "'")) ok('映射覆盖 ' + mood);
  else bad('映射缺少 ' + mood);
}
if (/catch \(e\)/.test(src)) ok('pickMood 有异常兜底');
else bad('pickMood 缺异常兜底（存储异常不能卡启动页）');

// ---- 换脸必须是淡入，且要在自动进首页之前淡完 ----
const numOf = (name) => Number((new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)').exec(src) || [])[1]);
const AUTO_ENTER = numOf('AUTO_ENTER_MS');
const SWAP_DELAY = numOf('SWAP_DELAY_MS');
const FADE = numOf('FADE_MS');
const LOAD_FB = numOf('LOAD_FALLBACK_MS');
if (AUTO_ENTER > 0 && SWAP_DELAY > 0 && FADE > 0 && LOAD_FB > 0)
  ok('换脸时序是四个具名常量（' + SWAP_DELAY + ' 起换 / 淡 ' + FADE + ' / 兜底 +' + LOAD_FB + ' / ' + AUTO_ENTER + ' 进首页）');
else bad('换脸时序常量缺失（AUTO_ENTER_MS / SWAP_DELAY_MS / FADE_MS / LOAD_FALLBACK_MS）');
if (SWAP_DELAY >= 600 && SWAP_DELAY <= 1500) ok('换脸时机在开场动画之后（' + SWAP_DELAY + 'ms）');
else bad('换脸时机 ' + SWAP_DELAY + 'ms 不对：太早会压住开场动画，太晚淡不完');
if (SWAP_DELAY + FADE < AUTO_ENTER) ok('淡入在自动进首页之前完成（' + (SWAP_DELAY + FADE) + ' < ' + AUTO_ENTER + '）');
else bad('淡入没结束就被切进首页（' + (SWAP_DELAY + FADE) + ' >= ' + AUTO_ENTER + '）');
const fadeCss = Number((/transition:\s*opacity\s*(\d+)ms/.exec(src) || [])[1]);
if (fadeCss === FADE) ok('样式过渡时长与 FADE_MS 一致（' + FADE + 'ms）');
else bad('样式过渡 ' + fadeCss + 'ms 与 FADE_MS(' + FADE + ') 不一致');
if (/\.mascot-mood\s*\{[^}]*opacity:\s*0/.test(src) && /\.mascot-mood\.show\s*\{[^}]*opacity:\s*1/.test(src))
  ok('上层默认透明、加 .show 才显示（淡入不是硬切）');
else bad('上层图不是 opacity 0→1 的淡入写法');
if (/@load="onMoodLoad"/.test(src) && /onMoodLoad\(\)\s*\{/.test(src)) ok('上层图解码完成才淡入（@load）');
else bad('缺 @load → onMoodLoad（图没解码完就淡入会露出空白）');

// ---------- 第 2 组：七张表情图存在且体积可控 ----------
console.log('[2] static/mascot 表情图');
const EXPECT = {
  smile: 'arona-smile.jpg', tongue: 'arona-tongue.jpg', hi: 'arona-hi.jpg',
  nervous: 'arona-nervous.jpg', sad: 'arona-sad.jpg',
  angry: 'arona-angry.jpg', shocked: 'arona-shocked.jpg'
};
for (const k of Object.keys(EXPECT)) {
  const p = path.join(ROOT, 'static', 'mascot', EXPECT[k]);
  if (!fs.existsSync(p)) { bad('缺少 ' + EXPECT[k]); continue; }
  const kb = Math.round(fs.statSync(p).size / 1024);
  if (kb > 0 && kb < 120) ok(EXPECT[k] + ' 存在（' + kb + 'KB）');
  else bad(EXPECT[k] + ' 体积异常（' + kb + 'KB，应在 1-120KB）');
  if (src.includes('/static/mascot/' + EXPECT[k])) ok('cover.vue 引用 ' + EXPECT[k]);
  else bad('cover.vue 未引用 ' + EXPECT[k]);
}

// ---------- 第 3 组：真实 engine 九态读数 ----------
console.log('[3] 学习状态 → 表情（真实 engine）');
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const lemma = load('utils/lemma.js');
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});

// 与 cover.vue pickMood 相同的判定（源码契约在第 1 组已锁，这里跑行为）
function mood() {
  const days = engine.history(0);
  if (!days.length) return 'hi';
  const byDate = {};
  days.forEach(d => { byDate[d.date] = d });
  const today = byDate[engine.dateStr()];
  if (today && today.total > 0) {
    const perfect = today.total >= 5 && today.correct >= today.total;
    return (perfect || engine.streak() >= 7) ? 'tongue' : 'smile';
  }
  let gap = 0;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (gap < 365) {
    const rec = byDate[engine.dateStr(d)];
    if (rec && rec.total > 0) break;
    gap++;
    d.setDate(d.getDate() - 1);
  }
  if (gap === 0) return engine.overview().wrongCount >= 20 ? 'nervous' : 'hi';
  if (gap >= 14) return 'shocked';
  if (gap >= 3) return 'angry';
  return 'sad';
}
function setDay(offset, total, correct) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const st = store.get();
  st.days[engine.dateStr(d)] = { total: total, correct: correct };
  store.save(st);
}
function addWrong(n) {
  const st = store.get();
  for (let i = 0; i < n; i++) st.wrong.push({ sid: 's' + i, dir: 'e2c', ts: Date.now() });
  store.save(st);
}

// 新用户：无任何记录
eq(mood(), 'hi', '新用户（无记录）');
// 今天练过：全对 ≥5 题 → 吐舌；有错 → 笑
setDay(0, 12, 12);
eq(mood(), 'tongue', '今天全对 12 题');
setDay(0, 10, 8);
eq(mood(), 'smile', '今天练了但有错');
// 连击满 7 天（哪怕今天有错）→ 吐舌
store.reset();
for (let i = 1; i <= 7; i++) setDay(i, 10, 6);
setDay(0, 10, 8);
eq(mood(), 'tongue', '连击 7 天 + 今天练过');
// 今天没练、连击未断：错题少 → 惊讶；错题 ≥20 → 紧张
store.reset();
setDay(1, 10, 6);
eq(mood(), 'hi', '连击未断（昨天练了）');
addWrong(20);
eq(mood(), 'nervous', '连击未断 + 错题 20');
// 断签：1-2 天委屈、3-13 天生气、14 天以上震惊
store.reset();
setDay(2, 10, 6);
eq(mood(), 'sad', '断签 1 天（最近一次是前天）');
store.reset();
setDay(4, 10, 6);
eq(mood(), 'angry', '断签 3 天');
store.reset();
setDay(15, 10, 6);
eq(mood(), 'shocked', '断签 14 天');

// ---------- 第 4 组：原生启动图与 cover 底层图必须是同一张脸 ----------
// 原生 splash 一淡出，露出来的就是 cover 这个圆圈。两张不一致的话，
// 用户看到的就是"圆圈里的图片变成两种"（哪怕 cover 内部已经改成淡入了）。
console.log('[4] 原生启动图 ↔ cover 底层图 同一张脸');
const genPath = path.join(__dirname, 'gen-splash.py');
const genSrc = fs.existsSync(genPath) ? fs.readFileSync(genPath, 'utf8') : '';
const genJoin = (/MASCOT\s*=\s*os\.path\.join\(([^)]*)\)/.exec(genSrc) || [])[1] || '';
const genFile = (/'([^']*arona[^']*)'/.exec(genJoin) || [])[1] || '';
const baseMood = (/const\s+BASE_MOOD\s*=\s*'([^']+)'/.exec(src) || [])[1] || '';
const baseRel = (new RegExp(baseMood + ":\\s*'([^']+)'").exec(src) || [])[1] || '';
const baseFile = (/\/static\/mascot\/([^']+)/.exec(baseRel) || [])[1] || '';
if (genFile && baseFile) eq(path.basename(genFile), baseFile, 'gen-splash.py 的 MASCOT 与 cover 底层图');
else bad('读不到 MASCOT（gen-splash.py: ' + (genFile || '?') + ' / cover 底层: ' + (baseFile || '?') + '）');

// ---------- 第 5 组：换脸时序真跑 ----------
console.log('[5] 换脸时序（真跑 cover.vue 的 script）');
const coverRaw = fs.readFileSync(path.join(ROOT, 'pages', 'cover', 'cover.vue'), 'utf8');
const coverScript = (/<script>([\s\S]*?)<\/script>/.exec(coverRaw) || [])[1] || '';
let switched = null;
global.uni.switchTab = (o) => { switched = (o || {}).url; };

const timers = [];
const Cover = loadCode(coverScript, {
  history: engine.history, streak: engine.streak, overview: engine.overview, dateStr: engine.dateStr,
  // 不真等：定时器收进队列，想让时间走到哪一刻就跑到哪一刻
  setTimeout: (fn, ms) => { const t = { fn, ms, done: false, id: timers.length + 1 }; timers.push(t); return t.id; },
  clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.done = true; },
  uni: global.uni
}, 'cover.vue').default;
const runUntil = (ms) => {
  timers.filter((t) => !t.done && t.ms <= ms).sort((a, b) => a.ms - b.ms)
    .forEach((t) => { t.done = true; t.fn(); });
};
const boot = () => {
  timers.length = 0;
  const vm = Object.assign({}, Cover.data(), Cover.methods, { $nextTick: (fn) => fn() });
  vm.onLoad = Cover.onLoad; // onLoad 是与 methods 平级的生命周期，不在 methods 里
  return vm;
};

// 场景一：今天练过（→ smile，与底层的 hi 不同）—— 最常见的路径
store.reset();
setDay(0, 10, 8);
let cv = boot();
cv.onLoad();
eq(cv.moodShown, false, '首帧不显示表情（圆圈里只有底层那张，与原生启动图一致）');
eq(cv.baseSrc, '/static/mascot/arona-hi.jpg', '底层 = 原生启动图那张');
eq(cv.moodSrc, '/static/mascot/arona-smile.jpg', '上层已备好目标表情');
runUntil(SWAP_DELAY - 1);
eq(cv.moodShown, false, '开场动画没走完就不换（' + (SWAP_DELAY - 1) + 'ms）');
runUntil(SWAP_DELAY);
eq(cv.moodShown, false, '时间到了但图没解码 → 仍不淡入（否则会淡入出一张空白）');
cv.onMoodLoad();
eq(cv.moodShown, true, '解码完成 → 淡入');

// 场景二：@load 一直不来（命中缓存可能不触发）→ 兜底要顶上，脸不能卡在底层
store.reset();
setDay(0, 10, 8);
cv = boot();
cv.onLoad();
runUntil(SWAP_DELAY + LOAD_FB + 1);
eq(cv.moodShown, true, '@load 没来时有兜底（脸不会一直卡在底层）');

// 场景三：表情正好就是底层那张（新用户 → hi）→ 不必淡入
store.reset();
cv = boot();
cv.onLoad();
eq(cv.moodSrc, cv.baseSrc, '新用户：上下两层同图');
eq(cv.moodShown, true, '同图时不走淡入（也不可能出现两张脸）');

// 场景四：自动进首页那条没被动过
store.reset();
setDay(0, 10, 8);
cv = boot();
cv.onLoad();
eq(timers[timers.length - 1].ms, AUTO_ENTER, '仍是 ' + AUTO_ENTER + 'ms 后自动进首页');
runUntil(AUTO_ENTER);
eq(switched, '/pages/home/home', '到点自动进首页');

process.exit(fail ? 1 : 0);
