// _tools/check-practice.js - 练习页「退出后异步不许再出声」校验（只读，不改源码）
//
// 背景（用户实测 bug）：点「开始背单词」后立刻退出页面，出题的 await 还在跑，
// 跑完会 setupQuestion → 自动朗读题目，于是"人已经离开了，手机还在念题"。
// 而且 AI 生成是要花钱的，退出后仍把整组题生成完等于白烧 token。
//
// 修法是两头堵，本脚本两头都盯：
//   ① session 层：buildSession / buildDrillSession / buildCustomSession 接受 shouldStop，
//      在批次边界提前收手（省掉后续 AI 请求）
//   ② practice 层：onUnload 置 alive=false，await 之后立刻 return（不再朗读、不再写状态）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 存储桩：必须真的读写内存，不能空着。
// settings.load() 把 uni.* 包在 try/catch 里，少了这个桩会**静默**退化成 defaults()——
// 于是"落盘了没"这条断言会假绿（只验到内存里的 cache 变了，storage 一个字节没写）。
const mem = {};
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const is = (c, m) => (c ? ok(m) : bad(m));

const PRACTICE = path.join('pkgStudy', 'pages', 'practice', 'practice.vue');
const pv = read(PRACTICE);
const sv = read('utils/session.js');

console.log('== 1. 页面有"还活着吗"的标记 ==');
is(/alive:\s*true/.test(pv), 'data 里有 alive 字段（默认 true）');

console.log('== 2. 退出时必须置 false ==');
// 先截出 onUnload 函数体，避免正则一路吃到 methods 区
const unloadM = pv.match(/\n\s*onUnload\(\)\s*\{([\s\S]*?)\n  \},/);
const unload = unloadM ? unloadM[1] : '';
is(unload.length > 0, '有 onUnload');
is(/this\.alive\s*=\s*false/.test(unload), 'onUnload 把 alive 置 false');
is(/tts\.stop\(\)/.test(unload), 'onUnload 停掉正在播的语音');
is(/clearAnswerTimer\(\)/.test(unload), 'onUnload 清掉"答后延迟朗读"定时器');

console.log('== 3. 切后台不能误伤（回来还要继续练）==');
// onHide 是单行写法 `onHide() { ... },`，不能用"匹配到 \n  },"的多行正则，
// 否则会一路吃掉后面的 onUnload，把它的 alive=false 算到 onHide 头上（假红）
const hideM = pv.match(/\n\s*onHide\(\)\s*\{([^\n]*)\}/);
const hide = hideM ? hideM[1] : '';
is(hide.length > 0, '有 onHide');
is(!/alive\s*=\s*false/.test(hide),
  'onHide 不置 alive=false（只停声音，出题继续；否则切后台回来反而没题）');

console.log('== 4. 出题调用都要带取消信号 ==');
// 三处：drill 主链路、drill 兜底链路、日常链路。
// 注意不能用 \([^)]*\) 去抓整段调用 —— 实参里有箭头函数 `() => !this.alive`，
// 它自带的括号会把匹配提前截断，导致数出来的"带取消信号"永远是 0（假红）
const totalCalls = (pv.match(/session\.build(?:Session|DrillSession)\(/g) || []).length;
const stopCalls = (pv.match(/session\.build(?:Session|DrillSession)\([^\n]*!this\.alive\)/g) || []).length;
is(totalCalls >= 3, '找到出题调用点（' + totalCalls + ' 处）');
is(stopCalls === totalCalls,
  '每处都传了 () => !this.alive（' + stopCalls + '/' + totalCalls + '）');

console.log('== 5. await 之后要立刻收手 ==');
const startM = pv.match(/\n\s*async start\(source\)\s*\{([\s\S]*?)\n    \},/);
const start = startM ? startM[1] : '';
is(start.length > 0, '找到 start()');
const guards = (start.match(/if\s*\(!this\.alive\)\s*return/g) || []).length;
is(guards >= 2, 'await 后至少两道关口（drill 兜底前 + 最终进 setupQuestion 前）: ' + guards);
// 最关键的一条：日常链路（else 分支）的 await 到 setupQuestion 之间必须有关口。
// 不能用 lastIndexOf('if (!this.alive) return') —— drill 分支里也有一道，
// 它会先被找到，于是即使把"共同关口"删掉，断言仍然误报为通过（假绿）。
// 必须限定区间：从最后一次出题 await 起，到 setupQuestion 为止。
const setupIdx = start.indexOf('this.setupQuestion(0)');
const lastAwait = start.lastIndexOf('await session.build');
const between = lastAwait >= 0 && setupIdx > lastAwait ? start.slice(lastAwait, setupIdx) : '';
is(!!between && /if\s*\(!this\.alive\)\s*return/.test(between),
  '最后一次出题 await 到 setupQuestion 之间有关口（日常链路也覆盖到）');
is(/tts\.speakAuto/.test(pv), '确认朗读入口确实在 setupQuestion 里（防改名后断言空转）');

console.log('== 6. session 层真的接受取消 ==');
['buildSession', 'buildDrillSession'].forEach((fn) => {
  const m = sv.match(new RegExp('export async function ' + fn + '\\(([^)]*)\\)'));
  is(!!m && /shouldStop/.test(m[1]), fn + ' 签名带 shouldStop');
});
const cm = sv.match(/async function buildCustomSession\(([^)]*)\)/);
is(!!cm && /shouldStop/.test(cm[1]), 'buildCustomSession 签名带 shouldStop（导入词书走这条）');
is(/function stopped\(/.test(sv), '有统一的取消判定函数 stopped()');
// 判定函数必须自己吞异常：页面可能已半销毁，shouldStop 抛错不能把出题搞崩
const sm = sv.match(/function stopped\(shouldStop\)\s*\{([\s\S]*?)\n\}/);
is(!!sm && /try\s*\{/.test(sm[1]) && /catch/.test(sm[1]),
  'stopped() 自己吞异常（页面半销毁时不连累出题）');
// 批次边界要有检查点
const checks = (sv.match(/if\s*\(stopped\(shouldStop\)\)\s*return questions/g) || []).length;
is(checks >= 5, '五个批次边界都设了检查点（3 个主循环 + 2 个补题循环）: ' + checks);
// 取消要能透传给自建词书那条分支
is(/return buildCustomSession\(n, bid, shouldStop\)/.test(sv),
  'buildSession 把取消信号透传给 buildCustomSession');

console.log('== 7. 不要靠抛异常来取消 ==');
is(!/throw new Error/.test(sv.slice(sv.indexOf('function stopped'), sv.indexOf('function stopped') + 400)),
  'stopped() 不用抛异常做控制流（会把已生成的题一起丢掉）');

/* ---------------- 8. 作答方式"选了就固定"（真跑页面方法） ---------------- */
// 与刷单词页同一条规矩：选了「手动输入」，下一题还得是手动输入。
// 只扫源码挡不住（换个地方重置就绕过了），所以把页面脚本真加载起来跑一遍。
// 除 settings 外一律用薄桩：这条断言只关心作答方式，不关心分词 / 朗读 / 词书标注。
console.log('== 8. 作答方式固定：换了题也不回落 ==');
const { load, loadCode } = require('./lib/load');
const settingsMod = load('utils/settings.js', {});
settingsMod.init();
const pScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(pv) || [])[1] || '';
const page = loadCode(pScript, {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  engine: {}, session: {}, iplus1: {}, judge: {}, dict: {}, sync: {}, sfx: {},
  barsSyncColors: () => true,
  wordbook: { bookWords: () => [], currentBookId: () => '' },
  tts: { speakAuto: () => {}, stop: () => {} },
  aiGateReason: () => '',
  critiqueTranslation: () => {},
  settings: settingsMod,
  tokenize: () => [], isEnglish: () => false,
  bookWordSet: () => ({}), targetWordSet: () => ({}),
  markTokens: () => [], countMarked: () => ({ book: 0 }),
  FloatNavbar: {},
  WordSearch: {}
}, 'practice.vue').default;
is(!!page && typeof page.data === 'function', '页面脚本可加载（导出 default）');
const newVM = () => Object.assign({}, page.data(), page.methods);
const Q = (i) => ({
  dir: 'e2c', lv: 1, prompt: 'hello ' + i, answer: '你好', options: ['甲', '乙', '丙', '丁'],
  answerIndex: 0, note: '', words: [], sid: 's' + i
});

is(settingsMod.defaults().study.practiceMode === 'choice', '默认作答方式 = 选择题');
is(newVM().mode === 'choice', '首次进页面用选择题', newVM().mode);
const vm = newVM();
vm.bookId = '';
vm.questions = [Q(0), Q(1), Q(2)];
vm.switchMode({ currentTarget: { dataset: { m: 'input' } } });
is(vm.mode === 'input', '点「手动输入」当场切过去', vm.mode);
is(settingsMod.get().study.practiceMode === 'input', '作答方式落盘（settings.study.practiceMode）');
vm.setupQuestion(0);
is(vm.mode === 'input', '换到第 1 题仍是手动输入', vm.mode);
vm.setupQuestion(1);
is(vm.mode === 'input', '换到第 2 题仍是手动输入（旧写法在这里弹回选择题）', vm.mode);
is(newVM().mode === 'input', '下次进页面还是上次那一种', newVM().mode);
// 上面那次 newVM() 只证明"同一个模块实例的内存 cache 还在"。
// 真正的"记住"要过 storage —— 换个全新的 settings 实例（= 重启 App）再读一次。
const settingsFresh = load('utils/settings.js', {});
settingsFresh.init();
is(settingsFresh.get().study.practiceMode === 'input',
  '重启 App 后仍读到手动输入（真的写进 storage 了，不是只在内存里）',
  settingsFresh.get().study.practiceMode);
// 两个页面各记各的：改练习页不该把刷单词页的方式也改掉
is(settingsMod.get().study.drillMode === 'choice', '刷单词页的 drillMode 不受影响（两个键独立）');
// 原护栏不能丢
vm.answered = true;
vm.switchMode({ currentTarget: { dataset: { m: 'choice' } } });
is(vm.mode === 'input', '已答完 → 点胶囊不生效（原护栏保留）', vm.mode);
vm.answered = false;
settingsMod.set({ study: { practiceMode: '瞎写的' } });
is(newVM().mode === 'choice', '存档是脏值 → 回落选择题，不崩', newVM().mode);
const beforeBad = vm.mode;
vm.switchMode({ currentTarget: {} });
is(vm.mode === beforeBad, '胶囊没有 data-m 时不炸、不改方式', vm.mode);

/* ---------------- 9. 目标词两关确认 + 记错了（不背单词机制） ---------------- */
// 诉求：一遍答对不算学会；答对后允许反悔。
// 页面把 finish 拆成「确认 → commit」两段：句子答对先不落账，
// 弹两道本地生成的确认题（认得出 → 想得起），都对才真正 pass。
console.log('== 9. 目标词两关确认 + 记错了 ==');
is(/confirming/.test(pv) && /pendingPass/.test(pv), '有确认态与待落账暂存（pass 不再一遍定案）');
is(/buildConfirms\(\)/.test(pv) && /wordSession\.toItem\(/.test(pv), '确认题用 wordSession.toItem 本地生成（零 AI 成本）');
// 两关换的是提取方向：第一关"认得出"（词→选中文），第二关"想得起"（中文→选英文）
is(/\['recog', 'recall'\]/.test(pv), '确认是两关：先认得出、再想得起（换提取方向）');
is(/confirmIdx/.test(pv) && /confirmItems/.test(pv), '两关之间有当前关索引（confirmIdx）');
is(/confirmChoose/.test(pv), '有确认作答入口 confirmChoose');
is(/this\.source !== 'review'/.test(pv), '错题重练不走确认（复习第一次答对就算记住）');
is(/this\.commit\('fail', 0,/.test(pv), '第一关就没认出来 → 整题按 fail 落账（句子进错题本）');
is(/this\.commit\('pass', p\.score,/.test(pv), '两关都过 → 整题按 pass 落账');
// 确认期间不能露出参考答案（chips 里就是答案）
is(/v-if="!confirming"/.test(pv), '确认期间藏起参考答案 / 词义 chips（不泄题）');
// 跨天巩固：确认过了，本题的目标词要写进与刷单词共用的那条 srs 队列
is(/scheduleWord\(/.test(pv) && /wordSession\.markReviewed\(/.test(pv),
  '确认通过 → 目标词写进跨天巩固队列（两条链路共用一套调度）');
is(/engine\.revokePass\(/.test(pv) && /markWrong/.test(pv), '「记错了」接 engine.revokePass（撤销 + 改判）');
is(/iplus1\.revokeMastery\(/.test(pv), '「记错了」同步撤销词书维度掌握度');
// 确认链路的守卫：造不出题时退化为一次判定（不能把用户卡死在确认里）
is(/return null/.test(pv.slice(pv.indexOf('buildConfirms()'), pv.indexOf('buildConfirms()') + 1200)),
  'buildConfirms 造不出确认题 → 返回 null 退化为老行为');
// 切关的短延时要能被页面离开清掉，否则人在确认区切走了还会被拉回落账
is(/clearConfirmTimer\(\)/.test(pv), '确认切关的定时器有清理入口');
// 取样必须取**方法体**（onHide / onUnload 里出现的是调用点，不是定义）
const catKey = 'clearAnswerTimer() {';
const catBody = pv.slice(pv.indexOf(catKey), pv.indexOf(catKey) + 400);
is(/this\.clearConfirmTimer\(\)/.test(catBody),
  '页面离开（onHide / onUnload 走 clearAnswerTimer）时一并清掉确认定时器');
// revokePass 真的改账（这里只验导出，语义细节在 check-word-drill 第 12 组守）
const { load: loadE } = require('./lib/load');
const engineReal = (() => {
  const memE = {};
  const uniBak = global.uni;
  global.uni = {
    getStorageSync: (k) => (k in memE ? memE[k] : ''),
    setStorageSync: (k, v) => { memE[k] = v; },
    removeStorageSync: (k) => { delete memE[k]; }
  };
  const storeE = loadE('utils/store.js');
  storeE.init();
  const mod = loadE('utils/engine.js', { store: storeE, WORDS: [], SENTENCES: [], sentenceIndex: { byLevel: () => [], neighbours: () => [] } });
  global.uni = uniBak;
  return mod;
})();
is(typeof engineReal.revokePass === 'function', 'engine.revokePass 已导出（练习页记错了依赖它）');

/* ---------------- 10. 双进度条 + 每日目标按"学会"计 ---------------- */
// 用户诉求：顶部两条进度 —— 一条"做了多少题"，一条"会了多少题"；
// 每日目标数的是"会了多少"，不是"答对多少"（一遍蒙对、确认没认出来的都不算）。
console.log('== 10. 双进度条与「学会」计数 ==');
const pTpl = pv.slice(0, pv.indexOf('\n<script'));
// 只数横条本身，不数条内的 .pb-k / .pb-v（前缀相同，别用模糊匹配）
const barN = (pTpl.match(/class="pb-bar (?:done|know)"/g) || []).length;
is(barN === 2, '顶部两条进度条（已做 / 会了）', barN);
is(/\{\{ answerText \}\}/.test(pTpl), '上面那条 = 累计作答次数（不带分母）');
is(/\{\{ correctCount \}\} \/ \{\{ questions\.length \}\}/.test(pTpl), '下面那条 = 会了几题 / 共几题');
is(/width: answerPct \+ '%'/.test(pTpl), '上面那条的宽度走 JS 预计算（answerPct）');
is(/syncBars\(\)/.test(pv), '有 syncBars() 统一刷新两条进度');
// 配色：两条颜色由设置决定，且必须走 CSS 变量（换主题色要跟着变，不能写死）
is(/:class="barsSync \? 'sync' : 'split'"/.test(pTpl), '两条进度条按设置切 sync / split 两套颜色');
const pbStyle = pv.slice(pv.indexOf('\n<style'));
['.pb-top.sync .pb-bar.done .progress-fill', '.pb-top.sync .pb-bar.know .progress-fill',
  '.pb-top.split .pb-bar.done .progress-fill', '.pb-top.split .pb-bar.know .progress-fill'
].forEach(sel => is(pbStyle.indexOf(sel) >= 0, '样式里有 ' + sel));
is(/rgba\(var\(--brand-rgb/.test(pbStyle) && /var\(--brand, #2e6bff\)/.test(pbStyle),
  'sync 模式 = 主题色浅版 + 主题色实心（走 CSS 变量，跟着主题走）');
is(/barsSyncColors\(\)/.test(pv), '颜色开关读 theme.barsSyncColors()（唯一读取口）');
is(/addMasteredToday\(1\)/.test(pv), '确认通过落账 → engine.addMasteredToday(1)');
is(/addMasteredToday\(-1\)/.test(pv), '「记错了」→ engine.addMasteredToday(-1)');
// 只有真正 pass（走过确认）才记一笔：确认没认出来走的是 fail 分支
const commitAt = pv.indexOf('commit(status, score, userAnswer) {');
is(commitAt > 0 && /status === 'pass'/.test(pv.slice(commitAt, commitAt + 2600)),
  'addMasteredToday 只挂在 status === pass 上（确认没认出来的不算学会）');

// 真跑一遍：用带记录的 engine 桩，看落账 / 改判到底记了几笔。
// 语义（写进 days[today].mastered、夹 0）由 check-word-drill 第 14 组用真 engine 守。
const spy = [];
const page2 = loadCode(pScript, {
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m2, kk) => (v && v[kk] != null ? String(v[kk]) : m2)),
  engine: {
    recordAnswer: () => {}, revokePass: () => {},
    addMasteredToday: (d) => { spy.push(d); return 0; }
  },
  session: {}, judge: {}, dict: {}, sfx: {},
  iplus1: { recordMastery: () => {}, revokeMastery: () => {} },
  barsSyncColors: () => true,
  sync: { recordStudy: () => {} },
  wordbook: { bookWords: () => [], currentBookId: () => '' },
  tts: { speakAuto: () => {}, stop: () => {} },
  aiGateReason: () => '',
  critiqueTranslation: () => {},
  settings: settingsMod,
  tokenize: () => [], isEnglish: () => false,
  bookWordSet: () => ({}), targetWordSet: () => ({}),
  markTokens: () => [], countMarked: () => ({ book: 0 }),
  FloatNavbar: {},
  WordSearch: {}
}, 'practice.vue').default;
// 本文件只有 is()，这里补一个"带实际值"的相等断言
const eqv = (a, b, m) => is(a === b, m + ' = ' + a + (a === b ? '' : '（期望 ' + b + '）'));
const vm3 = Object.assign({}, page2.data(), page2.methods);
vm3.bookId = '';
vm3.questions = [Q(0), Q(1), Q(2)];
vm3.setupQuestion(0);
eqv(vm3.answerCount, 0, '刚切到第 1 题、还没作答 → 已做 = 0');
// 上面那条是累计口径：一次作答 +1，不设分母（确认题不算新的一次）
vm3.finish('pass', 1, '你好');
eqv(vm3.answerCount, 1, '句子答了一次 → 已做 = 1');
vm3.setupQuestion(1);
vm3.finish('pass', 1, '你好');
eqv(vm3.answerCount, 2, '再答一题照加（累计，不是"第几题"）');
// 累计口径不因改判回退：做了就是做了
vm3.markWrong();
eqv(vm3.answerCount, 2, '改判后"已做"不回退（累计口径）');
// 下面测"学会"记账：清掉上面那几笔记的笔数，只看这一轮
spy.length = 0;
vm3.setupQuestion(2);
const knew0 = vm3.correctCount;          // 前面 2 次 pass - 1 次改判 = 1
vm3.commit('pass', 1, '你好');
eqv(vm3.answerCount, 2, '落账（commit）不额外 +1（确认是同一题的一部分）');
is(spy.join(',') === '1', '确认通过 → 学会计数 +1', spy.join(',') || '（空）');
eqv(vm3.correctCount, knew0 + 1, '会了那条进度条 +1');
vm3.markWrong();
is(spy.join(',') === '1,-1', '「记错了」→ 学会计数 -1（不留虚账）', spy.join(','));
eqv(vm3.correctCount, knew0, '改判后"会了"回退（上面那条"已做"不跟着退）');
vm3.commit('fail', 0, '错的');
is(spy.join(',') === '1,-1', '答错 / 确认没认出来 → 不记学会', spy.join(','));
// 竖排两条：样式上不能沿用练习页原来那条横排的 .topbar（两条会并到一行去）
is(!/class="topbar"/.test(pTpl) && /class="pb-top"/.test(pTpl), '两条竖排各占一行（不再复用横排的 .topbar）');

console.log('');
console.log(fail === 0 ? '练习页异步取消 校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
