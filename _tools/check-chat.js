// _tools/check-chat.js - AI 对话陪练：会话存档 / 句子收藏 / 句子进词书
//
// 要守的四件事（都是用户明确提的）：
//   1. 首页有**原生**卡入口（不是靠 AI 指令造出来的卡）
//   2. 对话能存下来（换一场、再回来还在；system 提示词不落盘）
//   3. 聊出来的句子能收，收完和单词一样有界面（收藏页的「例句」档 + 例句详情）
//   4. 收下来的句子能存进词书（整句作为那个词的例句一起进去）
const fs = require('fs');
const path = require('path');
const { load, loadCode, ROOT } = require('./lib/load');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}
function assert(cond, label) { if (cond) ok(label); else bad(label); }

// ---------- 装载真实模块（照 check-search.js 的配方） ----------
const mem = {};
const CHAT_MEM = {};
global.uni = {
  getStorageSync: (k) => (k === 'fj_chat_v1' ? CHAT_MEM[k] : mem[k]),
  setStorageSync: (k, v) => {
    if (k === 'fj_chat_v1') CHAT_MEM[k] = v;
    else mem[k] = v;
  },
  removeStorageSync: (k) => { delete mem[k]; delete CHAT_MEM[k]; },
  showToast: () => {},
  $emit: () => {},
  navigateTo: () => {},
  // 选词书用系统动作面板；测试里由断言指定选哪一本（见第 7 组）
  showActionSheet: (o) => { if (o && o.fail) o.fail({}) }
};

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
  featureOn: () => true, aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemma.lemma,
  chatCompletion: () => Promise.reject(new Error('no ai in test'))
});
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});
const search = load('utils/search.js', { wordbook, dict, importer });
const settings = load('utils/settings.js', {});
const tokenizeMod = load('utils/tokenize.js', {});
const tokenize = (tokenizeMod && tokenizeMod.tokenize) || tokenizeMod;
const chatStore = load('utils/chat-store.js', { settings });
// 抽测的"出题计划"（本地纯函数：分组、句长档位、错词复现频率）
const quizPlan = load('utils/quiz-plan.js');
const srs = load('utils/srs.js');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const homeSrc = read('pages/home/home.vue');
const layoutSrc = read('utils/home-layout.ts');
const schemaSrc = read('utils/page-schema.js');
const widgetSrc = read('components/home-widgets/widget-chat.vue');
const chatSrc = read('pkgManage/pages/chat/chat.vue');
const favSrc = read('pkgStudy/pages/favorites/favorites.vue');
const sdSrc = read('pkgStudy/pages/sentence-detail/sentence-detail.vue');

console.log('== 1. 会话存档：能存、能续、能换 ==');
const s0 = chatStore.active();
assert(!!s0 && !!s0.id, '第一次进来自动开一条会话');
eq(chatStore.activeId(), s0.id, '这条就是当前会话');
// 画面上的消息含 system（每次按当前词书重新生成），落盘时必须被剔掉
chatStore.saveMessages(s0.id, [
  { role: 'system', content: '你是英语陪练' },
  { role: 'user', content: 'I want to improve my English.' },
  { role: 'assistant', content: '' },                 // 流式空气泡（还没收到字）
  { role: 'assistant', content: '[object Object]' },   // 对象 String() 出来的垃圾
  { role: 'assistant', content: 'Sure! What do you find hardest?' }
]);
const saved = chatStore.get(s0.id);
eq(saved.messages.length, 2, '落盘 2 条（system / 空气泡 / 垃圾全剔掉）');
eq(saved.messages[0].role, 'user', '第一条是用户发言');
eq(saved.title, 'I want to improve my English.'.slice(0, 24), '标题取第一条用户发言（截断到 24 字）');

const s1 = chatStore.create();
assert(s1.id !== s0.id, '可以另开一场（id 不同）');
chatStore.saveMessages(s1.id, [{ role: 'user', content: 'second chat' }]);
eq(chatStore.sessions().length, 2, '两场会话都在');
eq(chatStore.sessions()[0].id, s1.id, '最近聊过的排在最前');
const back = chatStore.open(s0.id);
eq(back.messages.length, 2, '切回老会话：内容原样还在（对话真的存住了）');
chatStore.remove(s0.id);
eq(chatStore.sessions().length, 1, '删掉一场只剩一场');
eq(chatStore.activeId(), s1.id, '删掉的不是当前场时，当前场不受影响');

console.log('== 2. 存档不被撑爆 ==');
// 单会话只留最近 MAX_MSGS 条；会话条数也有上限
const many = [];
for (let i = 0; i < 260; i++) many.push({ role: 'user', content: 'line ' + i });
chatStore.saveMessages(s1.id, many);
eq(chatStore.get(s1.id).messages.length, chatStore.MAX_MSGS, '单会话消息数被夹到上限');
eq(chatStore.get(s1.id).messages[0].content, 'line 60', '留的是最近的那些（老的先丢）');
for (let i = 0; i < 30; i++) chatStore.create();
assert(chatStore.sessions().length <= chatStore.MAX_SESSIONS, '会话条数不超上限：' + chatStore.sessions().length);
chatStore.clearAll();
eq(chatStore.sessions().length, 0, '清空后一条不剩');

console.log('== 3. 收藏句子：去重、补译文、能取消 ==');
const EN1 = 'Practice is the key to improving your English.';
chatStore.clearAll();
const r1 = chatStore.saveSentence(EN1, '练习是提高英语水平的关键。', { from: 'chat' });
eq(r1.ok, true, '第一句收进去了');
eq(chatStore.isSentenceSaved(EN1), true, '再问就是"已收藏"');
eq(chatStore.savedCount(), 1, '收藏数 = 1');
const r2 = chatStore.saveSentence(EN1, '', { from: 'chat' });
eq(r2.dup, true, '同一句再收 = 重复（不会变成两条）');
eq(chatStore.savedCount(), 1, '收藏数还是 1');
// 同一句永远算出同一个 id：大小写 / 首尾空格不同也算同一句
eq(chatStore.sentenceIdOf(EN1), chatStore.sentenceIdOf('  ' + EN1.toUpperCase() + ' '), 'id 稳定（去空格 + 忽略大小写）');
const r3 = chatStore.saveSentence('   ', 'x', {});
eq(r3.ok, false, '空白句收不进去');
// 当时没配 AI → 译文是空的，之后再收同一句要把译文补上
chatStore.clearAll();
settings.reset ? settings.reset() : null;
const favs = settings.favorites().slice();
favs.forEach(f => settings.removeFavorite(f.type, f.id));
chatStore.saveSentence(EN1, '', { from: 'chat' });
eq(chatStore.savedCount(), 1, '没译文也先收下来');
chatStore.saveSentence(EN1, '练习是关键。', { from: 'chat' });
const refav = settings.favorites().filter(f => f.type === 'sentence')[0];
eq(refav && refav.zh, '练习是关键。', '再收一次把译文补上了');
chatStore.removeSentence(chatStore.sentenceIdOf(EN1));
eq(chatStore.savedCount(), 0, '取消收藏生效');

console.log('== 4. 首页原生卡入口 ==');
// 卡必须是"原生"的：注册表里有、schema 认、首页有渲染分支，缺一处就是造不出来的卡
assert(/\{\s*id:\s*'chat'[\s\S]{0,160}def:\s*true\s*\}/.test(layoutSrc), 'home-layout 注册了 chat 且默认上首页');
assert(/BUILTIN_TYPES[\s\S]{0,200}?'chat'/.test(schemaSrc), 'page-schema 的 BUILTIN_TYPES 认这个类型');
assert(/c\.type === 'chat'/.test(homeSrc), '首页有 chat 的渲染分支');
assert(/import WidgetChat from/.test(homeSrc) && /WidgetChat,/.test(homeSrc), '首页注册了组件');
assert(/<widget-chat\s*\/>/.test(homeSrc), '分支里真的渲染了这张卡');
// 入口一律置灰、绝不 v-if 藏（藏起来用户会当成功能被删了）
assert(/class="ch-main" :class="\{ 'entry-disabled': !aiOk \}"/.test(widgetSrc), '主按钮未配 AI 时置灰');
assert(!/ch-main[^>]*v-if=/.test(widgetSrc), '主按钮没有用 v-if 藏起来');
assert(/entry-disabled': !sessCount/.test(widgetSrc), '「历史对话」为空时也是置灰而不是消失');
assert(/favorites\/favorites\?tab=sentence/.test(widgetSrc), '卡上有「我的句子」入口');

console.log('== 5. 陪练页：能存对话、能收句子 ==');
assert(/import \* as chatStore from/.test(chatSrc), '陪练页接了 chat-store');
assert(/chatStore\.saveMessages\(/.test(chatSrc), '发完一句就落盘');
assert(/onUnload\(\)[\s\S]{0,200}chatStore\.flush\(\)/.test(chatSrc), '关页面前强制落盘（800ms 合并窗口会丢最后一句）');
assert(/onBackPress\(\)/.test(chatSrc), '历史面板开着时返回键先关面板');
assert(/@tap="saveMsg\(m\)"/.test(chatSrc), '每条气泡都有收藏按钮');
assert(/@longpress="saveMsg\(m\)"/.test(chatSrc), '长按气泡也能收藏');
// system 提示词跟着当前词书走，存下来只会越来越旧 → 展示层必须剔掉
assert(/filter\(m => m\.role === 'user' \|\| m\.role === 'assistant'\)/.test(chatSrc), 'system 提示词不显示在也不落盘');
assert(/chatStore\.sessions\(\)/.test(chatSrc), '有历史会话列表');
assert(/chatStore\.create\(\)/.test(chatSrc), '能开新对话');
// AI 的回复要能刷到屏幕上：占位气泡必须拿「push 进数组之后」的响应式代理来改。
// 用 push 前的裸对象改 → 不触发响应式 → viewMessages（计算属性，带缓存）不失效 →
// 回复明明拿到了，界面却一直停在空气泡上，只有退出重进才看得到。真机踩过。
assert(/const idx = this\.messages\.length/.test(chatSrc), '占位气泡：先记下标');
assert(/const bubble = this\.messages\[idx\]/.test(chatSrc), '改的是数组里那个响应式对象（不是 push 前的裸对象）');
assert(/void this\.streamTick/.test(chatSrc), 'viewMessages 依赖 streamTick（流式逐字也能失效重算）');
assert(/onDelta:[\s\S]{0,300}bubble\.content \+=[\s\S]{0,160}bump\(\)/.test(chatSrc), 'onDelta 里改完内容就 bump()：收到字就把字刷上去');
assert(((chatSrc.match(/bump\(\)/g) || []).length >= 3), '成功 / 失败 / 流式三处都 bump（不留下空气泡）');

console.log('== 6. 句子界面：收藏页分档 + 例句详情 ==');
assert(/\{ key: 'sentence', name: '例句' \}/.test(favSrc), '收藏页有「例句」这一档');
assert(/opt\.tab === 'sentence'/.test(favSrc), '带 ?tab=sentence 进来直接落在例句档');
assert(/f\.type === this\.tab/.test(favSrc), '按档过滤（不再和单词混在一起）');
assert(/sentence-detail\?id=/.test(favSrc), '例句能点开进详情页（和单词一样的界面）');
assert(/class="ac-title">\{\{ \$t\('加入词书'\)/.test(sdSrc), '例句详情有「加入词书」区');
assert(/@tap="pickWord"/.test(sdSrc), '可以挑这句里的哪个词进词书');

(async () => {
  console.log('== 7. 句子真的能存进词书（真跑一遍） ==');
  const sdScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(sdSrc) || [])[1] || '';
  const asked = [];
  const sdPage = loadCode(sdScript, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    settings, dict, wordbook, search, importer, tokenize,
    // 假模型层：只记下"问了谁"，不联网
    explainWord: async (w) => {
      asked.push(String(w));
      return { word: w, pos: 'n.', meaningZh: '（测试释义 ' + w + '）', kind: 'word' };
    },
    tts: { speakSentence: () => {}, speakWord: () => {}, stop: () => {} },
    FloatNavbar: {}, AppDialog: {}
  }, 'sentence-detail.vue').default;
  assert(!!sdPage && typeof sdPage.data === 'function', '例句详情脚本可加载（导出 default）');

  const vm = Object.assign({}, sdPage.data(), sdPage.methods, { en: '', zh: '', pick: '' });
  const EN = 'Practice is the key to improving your English.';
  vm.en = EN;
  vm.zh = '练习是提高英语水平的关键。';

  /* --- 候选词：虚词不能进候选 --- */
  const cands = vm.candidates(EN);
  assert(cands.indexOf('practice') >= 0, '实词进了候选：' + cands.join(','));
  ['the', 'is', 'to', 'your', 'and'].forEach(w => {
    assert(cands.indexOf(w) < 0, '虚词「' + w + '」不在候选里');
  });
  assert(cands.indexOf('improving') >= 0 && cands.indexOf('english') >= 0, '长词也在候选里');
  eq(cands.length <= 12, true, '候选最多 12 个（不把整句都摊开）');

  /* --- 真加入词书 --- */
  const bid = wordbook.createUserBook('对话收句测试', '单测');
  const list = wordbook.listBooks();
  const at = list.map(b => b.name).indexOf('对话收句测试');
  assert(at >= 0, '测试词书建好了');
  // 走的是统一弹窗（不是系统动作面板）：addToBook 打开面板 → onDlgConfirm(下标) 收口
  vm.pick = 'practice';
  vm.addToBook();
  assert(vm.dlg.show === true && vm.dlg.items.length === list.length, '弹出了词书选择面板');
  assert(vm.dlg.items.some(it => /\（当前\）$/.test(it.label)), '当前那本标了「（当前）」');
  await vm.onDlgConfirm(vm.dlg.items.map(it => it.label).indexOf('对话收句测试'));
  const inBook = importer.customWordsOf(bid).filter(w => String(w.word).toLowerCase() === 'practice')[0];
  assert(!!inBook, '这个词真的进了词书');
  eq(inBook && inBook.exampleEn, EN, '整句作为例句一起存进去了（保存的句子进了词书）');
  eq(inBook && inBook.exampleZh, vm.zh, '译文也一起进去了');
  // 词典里有的词用词典释义（不浪费一次 AI 请求）；词典没有的才去问 AI
  const dPractice = dict.lookup('practice');
  eq(inBook && inBook.meaning, (dPractice && dPractice.found) ? dPractice.meaning : '（测试释义 practice）',
    '释义来自词典（AI 只作兜底）');

  /* --- 词已经在书里：不算错，把句子挂成例句 --- */
  const pickBook = async (w) => {
    vm.pick = w;
    vm.addToBook();
    await vm.onDlgConfirm(vm.dlg.items.map(it => it.label).indexOf('对话收句测试'));
  };
  await pickBook('english');
  const second = importer.customWordsOf(bid).filter(w => String(w.word).toLowerCase() === 'english')[0];
  assert(!!second && second.exampleEn === EN, '换一个词也能收');
  await pickBook('english');       // 重复一次
  const again = importer.customWordsOf(bid).filter(w => String(w.word).toLowerCase() === 'english')[0];
  eq(again && again.exampleEn, EN, '重复收同一句不会报错，例句保持原样');

  /* --- 没选词 / 没词书时不炸 --- */
  vm.pick = '';
  await vm.addToBook();
  ok('没选词时点「加入词书」不炸（按钮是置灰的）');
  wordbook.deleteUserBook(bid);

  /* ============================================================
   * 8. AI 的回复要真的刷到屏幕上（Vue 3 响应式）
   * ------------------------------------------------------------
   * 真机症状：发完一句话，界面一直转圈/停在空气泡上，退出页面再进来回复才出现。
   * 根因：占位气泡是 push 前创建的裸对象，改它的 content 不会触发响应式，
   *       而 viewMessages 是计算属性（结果带缓存），于是永远不重算。
   * 下面用 Vue 3 的最小语义模拟（Proxy + 依赖收集 + 计算属性缓存）真跑一遍 send()，
   * 只守这一件事：改了内容，界面上必须看得见。
   * ============================================================ */
  console.log('== 8. 回复能刷到屏幕上（响应式） ==');
  const raw2px = new WeakMap();
  const depMap = new WeakMap();
  let activeEffect = null;
  function track(t, k) {
    if (!activeEffect) return;
    let m = depMap.get(t);
    if (!m) depMap.set(t, m = new Map());
    let s = m.get(k);
    if (!s) m.set(k, s = new Set());
    s.add(activeEffect);
  }
  function trigger(t, k) {
    const m = depMap.get(t);
    if (!m) return;
    const s = m.get(k);
    if (!s) return;
    s.forEach(e => { e.dirty = true });
  }
  function reactive(o) {
    if (!o || typeof o !== 'object') return o;
    if (raw2px.has(o)) return raw2px.get(o);
    const p = new Proxy(o, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        track(t, k);
        return (v && typeof v === 'object') ? reactive(v) : v;
      },
      set(t, k, v, r) {
        const old = Reflect.get(t, k, r);
        const res = Reflect.set(t, k, v, r);
        if (old !== v) trigger(t, k);
        return res;
      }
    });
    raw2px.set(o, p);
    return p;
  }
  function makeComputed(vm, fn) {
    const eff = { dirty: true, value: undefined };
    return () => {
      if (!eff.dirty) return eff.value;
      const prev = activeEffect;
      activeEffect = eff;
      try { eff.value = fn.call(vm) } finally { activeEffect = prev }
      eff.dirty = false;
      return eff.value;
    };
  }

  const tick = () => new Promise(r => setTimeout(r, 0));
  const chatScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(chatSrc) || [])[1] || '';
  // 每次请求的 payload 都留一份：抽测这一组的核心断言就是"发了什么给模型"
  // （出题指令有没有挂上、答案气泡有没有带上、词用完了有没有收尾指令）
  const payloads = [];
  let fakeMode = 'stream';
  let fakeReply = '';
  const ChatPage = loadCode(chatScript, {
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
    isAIEnabled: () => true,
    featureOn: () => true,
    tutorSystemPrompt: () => 'SYS',
    // 抽测用的三个提示词构造器（真身见 services/ai-content.js，这里只要形状）
    quizSystemPrompt: (pool) => 'QUIZSYS:' + (pool || []).map(w => w.w).join(','),
    quizNextHint: (b) => ((b && b.words && b.words.length) ? 'NEXT:' + b.words.map(w => w.w).join(',') : ''),
    quizWrapHint: () => 'WRAP',
    // 出题计划用真模块（本地纯函数，测的就是它）：题数/分组/复现频率都归它管
    quizPlan: quizPlan,
    srs: srs,
    chatTutor: async (msgs, opts) => {
      payloads.push(msgs);
      if (fakeMode === 'stream' && opts && opts.onDelta) {
        await tick(); opts.onDelta('Sure! ');
        await tick(); opts.onDelta('Let us practice.');
      }
      if (fakeMode === 'boom') throw new Error('down');
      return { content: fakeReply };
    },
    explainWord: async () => ({ meaningZh: '（测试释义）' }),
    wordbook,
    chatStore,
    tts: { speakSentence: () => {}, stop: () => {} },
    FloatNavbar: {}
  }, 'chat.vue').default;
  assert(!!ChatPage && typeof ChatPage.data === 'function', '陪练页脚本可加载（导出 default）');

  const lastOf = (arr) => arr[arr.length - 1];
  const boot = (mode, reply) => {
    fakeMode = mode; fakeReply = reply;
    const raw = Object.assign({}, ChatPage.data(), ChatPage.methods, {
      $nextTick: (fn) => { if (fn) fn() },
      aiEnabled: true
    });
    const vm = reactive(raw);
    // 盯住每一次"滚到底"：指令必须和上一次不同，值不变端上是不会滚的
    const jumps = [];
    const origScroll = raw.scrollToEnd;
    raw.scrollToEnd = function (force) {
      const before = raw.scrollTarget;
      origScroll.call(vm, force);
      jumps.push([before, raw.scrollTarget]);
    };
    vm.loadSession(chatStore.active());
    return { vm, view: makeComputed(vm, ChatPage.computed.viewMessages), jumps };
  };

  /* --- 流式：第一个字到了就该看见，不用等整句 --- */
  const a = boot('stream', 'Sure! Let us practice.');
  a.vm.draft = 'hello';
  const pending = a.vm.send();
  await tick();
  eq(lastOf(a.view()).content, 'Sure! ', '流式：第一个字到了屏幕上就有字（不是干等整句）');
  eq(a.vm.thinking, false, '流式：收到字后"思考中"就收起来');
  await pending;
  eq(lastOf(a.view()).content, 'Sure! Let us practice.', '流式：整句收完气泡是完整回复');
  // 计算属性确实是带缓存的 —— 正是这个缓存让"改裸对象"永远看不见
  assert(a.view() === a.view(), 'viewMessages 有缓存（所以必须靠响应式/手动失效来刷新）');

  /* --- 整块返回（端不支持流式，onDelta 一次都不调） --- */
  const b = boot('block', '整块回复');
  b.vm.draft = 'hi';
  await b.vm.send();
  eq(lastOf(b.view()).content, '整块回复', '不支持流式时：整块回复照样刷出来');
  eq(b.vm.thinking, false, '整块：收完不再转圈');

  /* --- 出错：气泡要给人话，不能留空气泡 --- */
  const c = boot('boom', '');
  c.vm.draft = 'hi';
  await c.vm.send();
  assert(/抱歉/.test(lastOf(c.view()).content), '出错时气泡给人话提示（不是空白）');
  eq(c.vm.thinking, false, '出错也不再转圈');

  /* ============================================================
   * 9. 回复出来后要自动滚到底 + 键盘别收
   * ------------------------------------------------------------
   * 真机症状：发完一句话，AI 的回复在屏幕外面，得手动往下滑才看得到。
   * 根因：scroll-into-view 只在**值变化**时滚动，写死 'msg-bottom' 连赋两次端上不动。
   * 另外 input 挂了 :disabled="thinking" → 焦点被抢走 → 键盘收起，聊天断断续续。
   * ============================================================ */
  console.log('== 9. 自动滚到底 / 键盘不收 ==');
  assert(/scrollToEnd\(/.test(chatSrc), '有 scrollToEnd()（统一收口"滚到最新一条"）');
  assert(/this\.scrollTarget = this\.scrollTarget === 'mb-a' \? 'mb-b' : 'mb-a'/.test(chatSrc),
    '两个锚点轮流指：每次都是真实变化（写死一个 id 端上不滚）');
  assert(!/scrollTarget = 'msg-bottom'/.test(chatSrc), '没有写死单一锚点');
  assert(/id="mb-a"/.test(chatSrc) && /id="mb-b"/.test(chatSrc), '底部两个锚点都在');
  assert(/onDelta:[\s\S]{0,400}scrollToEnd\(\)/.test(chatSrc), '流式逐字时跟着往下滚');
  assert(!/class="chat-input"[\s\S]{0,320}:disabled/.test(chatSrc),
    '输入框不因"思考中"被禁用（一禁用焦点就丢、键盘收起）');
  assert(/hold-keyboard="true"/.test(chatSrc), '点发送时键盘不收（hold-keyboard）');
  assert(/this\.keepKeyboard\(\)/.test(chatSrc), '发完一句把焦点抢回来');
  assert(/@blur="kbOn = false"/.test(chatSrc), '跟踪焦点状态（没丢就不做多余的抢焦）');

  const d = boot('block', 'ok');
  d.vm.draft = 'hi';
  await d.vm.send();
  assert(/^mb-[ab]$/.test(d.vm.scrollTarget), '发完消息给了滚到底的指令：' + d.vm.scrollTarget);
  eq(d.vm.inputFocus, true, '发完消息焦点回到输入框（键盘不收）');
  // 关键：每一次"滚到底"的指令都必须和上一次不同 —— 相同的值端上不会滚动
  assert(d.jumps.length >= 2, '发一条消息至少滚两次（发出时 + 收完时）：' + d.jumps.length);
  const stuck = d.jumps.filter(j => j[0] && j[0] === j[1]);
  eq(stuck.length, 0, '没有哪次滚到底和上一次指同一个锚点（否则端上不滚，回复留在屏幕外）');
  const used = {};
  d.jumps.forEach(j => { if (j[1]) used[j[1]] = true });
  assert(used['mb-a'] && used['mb-b'], '两个锚点都用上了：' + JSON.stringify(d.jumps));

  /* --- 9b. 键盘把输入框盖住了（真机反馈：看不见自己打了什么）---
     `softinputMode: adjustResize` 是 manifest 级配置（要重新运行 / 云打包才生效），
     而且部分 ROM 上键盘干脆就是个浮层 —— 两种情况都会让输入框被盖住。
     所以这里有一层**不依赖系统行为**的兜底：按键盘高度把底部一组顶上去，
     但系统如果已经压短过可视区就不要重复顶（否则输入框会被推到屏幕中间）。 */
  assert(/class="chat-bottom"[^>]*:style="bottomStyle"/.test(chatSrc), '底部一组整体绑定位移（状态条与输入框一起抬）');
  const tplBottom = chatSrc.match(/<view class="chat-bottom"[\s\S]*?<\/view>\s*<\/block>/);
  assert(!!tplBottom && /class="input-bar"/.test(tplBottom[0]), '输入框确实包在 .chat-bottom 里（不然抬的是别的元素）');
  assert(/uni\.onKeyboardHeightChange\(/.test(chatSrc) && /uni\.offKeyboardHeightChange\(/.test(chatSrc),
    '监听键盘高度，且页面卸载时摘掉（不然会留一个幽灵回调）');
  assert(/\.chat-bottom \{[\s\S]{0,90}flex-shrink: 0/.test(chatSrc), '.chat-bottom 不参与收缩（高度由它和消息列表分）');

  /* --- 9c. 消息一多就滑不动（用户反馈：「对话到第二句的时候甚至无法往下滑」）---
     flex 列里的子项默认 `min-height: auto` = "不许比内容矮"。列表少了 `min-height: 0`，
     消息一多就把容器撑高（而不是自己滚动）：容器溢出到可视区外 → 底部输入框被顶出屏幕，
     列表高度等于内容高度 → 一点可滚余量都没有。这两条是那个 bug 的根，别删。 */
  assert(/\.msg-list \{[\s\S]{0,400}min-height: 0/.test(chatSrc),
    '消息列表写了 min-height: 0（少了它消息一多就把容器撑高、自己反而滑不动）');
  assert(/\.chat-container\.chat-container \{[\s\S]{0,60}min-height: 0/.test(chatSrc),
    '用双类选择器压掉全局 .container 的 min-height: 100vh（同特异性时不能赌加载顺序）');
  assert(!/max-height:\s*100%/.test(chatSrc), '不再靠 max-height: 100% 兜高度（fixed 元素上百分比不一定按预期解析）');

  // 可视高度由 `uni.createSelectorQuery()` 量 `.chat-container` 得到（= webview 可视区高度，
  // adjustResize 生效时它**真的**会变矮）。
  // ⚠️ 别改回 `uni.getSystemInfoSync().windowHeight`：真机实测它不随键盘更新，
  // 「系统已经压过」会永远判 false → 系统压一次 + 自己再顶一次 → 输入框被推到屏幕中间
  // （2026-10-12 用户截图就是这个）。所以这里也必须 mock 选择器查询，而不是 systemInfo。
  assert(/measureViewport\(/.test(chatSrc) && /createSelectorQuery\(\)/.test(chatSrc) && /\.in\(this\)/.test(chatSrc),
    '用 createSelectorQuery 量容器高度（量的是真的会变的那一个）');
  assert(/applyKbPad\(\)\s*\{[\s\S]{0,400}this\.measureViewport\(/.test(chatSrc),
    'applyKbPad 走的是实测容器高度，不是某个系统 API 的快照');
  assert(!/const shrunk[\s\S]{0,80}viewportH\(/.test(chatSrc),
    '判断"系统压没压过"不许用 viewportH()（真机上它不更新，会稳输）');
  let fakeBoxH = 800;
  uni.createSelectorQuery = () => {
    const q = {
      in: () => q,
      select: () => q,
      boundingClientRect: (cb) => { cb({ height: fakeBoxH }); return q },
      exec: () => {}
    };
    return q;
  };
  // 量高度那两次是**延迟**判的（40ms / 200ms）：键盘回调可能比 webview resize 早一拍，
  // 立刻量会量到旧高度、误判成浮层键盘。所以这里也照真实时序等一等再断言。
  const settle = () => new Promise((r) => setTimeout(r, 260));
  const kb = boot('block', 'ok');
  kb.vm._winH = 800;
  kb.vm.onKbChange({ height: 320 });
  await settle();
  eq(kb.vm.kbPad, 320, '容器没变矮（键盘是浮层）→ 按键盘高度自己顶');
  fakeBoxH = 460;                    // 系统这次真把容器压短了
  kb.vm.onKbChange({ height: 320 });
  await settle();
  eq(kb.vm.kbPad, 0, '系统已经压短过可视区 → 不再自己顶（否则输入框会被推到屏幕中间）');
  eq(JSON.stringify(ChatPage.computed.bottomStyle.call(kb.vm)), '{}', '不需要顶的时候不产生空 style');
  fakeBoxH = 800;
  kb.vm.onKbChange({ height: 320 });
  await settle();
  assert(/paddingBottom/.test(JSON.stringify(ChatPage.computed.bottomStyle.call(kb.vm))),
    'bottomStyle 真的给出 padding-bottom：' + JSON.stringify(ChatPage.computed.bottomStyle.call(kb.vm)));
  // 键盘收起是**立刻**的（不用等那两次延迟判定）
  kb.vm.onKbChange({ height: 0 });
  eq(kb.vm.kbPad, 0, '键盘收起 → 撤掉位移（输入框落回屏幕底部）');
  // 高度一个都取不到时宁可自己顶 —— 不能让输入框留在键盘底下
  uni.createSelectorQuery = () => { throw new Error('no query') };
  uni.getSystemInfoSync = () => { throw new Error('no info') };
  const kb2 = boot('block', 'ok');
  kb2.vm._winH = 0;
  kb2.vm.onKbChange({ height: 300 });
  await settle();
  eq(kb2.vm.kbPad, 300, '量不到可视高度 → 保守地自己顶（看不见输入框比多顶一下糟得多）');
  // 选择器查得到元素、但元素还没布局完（height 为 0）→ 同样走兜底
  uni.createSelectorQuery = () => {
    const q = { in: () => q, select: () => q, boundingClientRect: (cb) => { cb({ height: 0 }); return q }, exec: () => {} };
    return q;
  };
  const kb3 = boot('block', 'ok');
  kb3.vm._winH = 800;
  kb3.vm.onKbChange({ height: 300 });
  await settle();
  eq(kb3.vm.kbPad, 300, '元素还没布局完（height = 0）→ 同样视为"量不到"，保守地自己顶');

  /* ============================================================
   * 10. 三个动作搬进顶栏胶囊
   * ------------------------------------------------------------
   * 用户反馈：「最顶上那三个功能，聊天记录多了就要翻到很上面才看得到」。
   * 那三个按钮原本在页面里另起一条工具栏 —— 内容一多就被推上去了。
   * 现在挂在胶囊的 actions 上（胶囊是 fixed，怎么滚都在）。
   * ============================================================ */
  console.log('== 10. 会话动作搬进顶栏胶囊 ==');
  assert(!/class="chat-bar"/.test(chatSrc), '页面里那条工具栏已删（它就是"要翻上去才看得到"的那条）');
  assert(/<float-navbar[^>]*:actions="navActions"[^>]*@action="onNavAction"/.test(chatSrc),
    '三个动作挂到顶栏胶囊上');
  assert(/navActions\(\)\s*\{[\s\S]{0,400}key: 'history'/.test(chatSrc)
    && /key: 'new'/.test(chatSrc) && /key: 'sentences'/.test(chatSrc),
    '历史 / 新对话 / 我的句子 三颗都还在（只是换了地方）');
  assert(/void this\.__lang/.test(chatSrc), '动作文案建立语言依赖（切英文要跟着变）');
  const nav = boot('block', 'ok');
  const acts = ChatPage.computed.navActions.call(nav.vm);
  eq(acts.length, 3, '三颗动作');
  eq(acts.map(a => a.key).join(','), 'history,new,sentences', 'key 顺序');
  nav.vm.onNavAction('history');
  eq(nav.vm.listShow, true, '历史 → 打开历史面板');
  const before = chatStore.sessions().length;
  nav.vm.onNavAction('new');
  eq(chatStore.sessions().length, before + 1, '新对话 → 真的开了一场新的');
  eq(nav.vm.listShow, false, '开新对话顺带收起面板');
  // 「我的句子」是跳页，交给 uni 记
  assert(/favorites\/favorites\?tab=sentence/.test(chatSrc), '我的句子 → 收藏页例句档');

  /* ============================================================
   * 11. 抽测：出题顺序在本地，模型只负责出题与点评
   * ------------------------------------------------------------
   * 用户要的：「用户说完一个目标然后 AI 就根据要背的单词来反复抽测，
   * 每次说出答案」。所以：
   *   · 词池开局时从当前词书取好（一轮不重复、进度可数）
   *   · 每轮把"这一轮考哪个词"作为 system 指令挂在 payload 末尾（不落盘、不显示）
   *   · 用户答完，页面**本地**把答案摆出来（模型忘了说也不会漏）
   *   · 模型用开头标记【对】/【错】判分，页面据此计数（状态条上看得见）
   * ============================================================ */
  console.log('== 11. 抽测（句子翻译）：本地定题与频率，模型只造句子/点评 ==');
  assert(/<float-navbar[\s\S]{0,200}actions/.test(chatSrc), '抽测引导条在输入框上方（不会跟着内容滚）');
  assert(/v-if="quiz\.on"[\s\S]{0,200}quizBarText/.test(chatSrc), '抽测中显示进度条');
  assert(/v-else[\s\S]{0,200}startQuizQuick/.test(chatSrc), '没抽测时给一键开局');
  assert(/\/抽测\|抽背\|抽考\|考考我\|考我/.test(chatSrc), '有"目标句"识别（说一句"考我…"就能开局）');
  assert(/quizPlan\.buildPool\(/.test(chatSrc) && /currentBookId\(/.test(chatSrc),
    '词池取当前词书（在哪本书就考哪本）');
  assert(/srs\.dateStr\(\)/.test(chatSrc), '拿今天日期 → "今天背过的词优先"（fs === today）');
  assert(/当前词书里没有可抽测的词/.test(chatSrc), '词书没词时给人话，不是干等');
  assert(/quizPlan\.noteUsed\(/.test(chatSrc) && /quizPlan\.noteResult\(/.test(chatSrc),
    '页面把"用词"和"达不达意"两笔账交给本地计划（复现频率靠它们调）');

  payloads.length = 0;
  const q = boot('block', 'Here is your first sentence.');
  const started = q.vm.startQuiz('考我 3 题');
  eq(started, true, '开局成功（词书里有词）');
  eq(q.vm.quiz.on, true, 'quiz.on');
  eq(q.vm.quiz.plan.total, 3, '题数按目标句里的数字（"考我 3 题"）');
  assert(q.vm.quiz.base.length >= 4, '词池按"每题最多 4 个词"备着：' + q.vm.quiz.base.length);
  assert(q.vm.quiz.base.every(w => w.w && w.m), '词池里每个词都带词形 + 释义（判"目标词理解偏差"要用）');
  assert(/QUIZSYS:/.test(q.vm.messages[0].content), 'system 换成抽测提示词');
  eq(q.vm.quiz.judge, false, '开局还没有译文要判（否则状态条一开始就多算一次"对"）');

  q.vm.draft = '考我 3 题';
  await q.vm.send();
  const b1 = q.vm.quiz.cur;
  eq(q.vm.quiz.plan.step, 1, '第一条消息就出了第一题');
  assert(!!b1 && b1.words.length >= 2, '第一题是**一组词**（不是单个词）：'
    + JSON.stringify(b1 && b1.words.map(w => w.w)));
  assert(b1.words.length <= 4, '一组不超过 4 个词（再多一定凑不出通顺的句子）');
  assert(b1.limit > 0 && b1.level > 0, '这一题带上了目标句长与水平档位（模型据此控难度）');
  const p1 = payloads[payloads.length - 1];
  eq(p1[p1.length - 1].content, 'NEXT:' + b1.words.map(w => w.w).join(','),
    'payload 末尾挂上"这一题用哪几个词"');
  assert(p1[p1.length - 1].role === 'system', '出题指令是 system（不显示、不落盘）');
  assert(!/NEXT:/.test(chatSrc.match(/this\.messages\.push\(\{ role: 'user'[\s\S]{0,200}/)[0]),
    '指令只进 payload，不塞进 messages');

  // 用户翻译这一句：本地先摆「本句目标词」，再让模型点评 + 出下一题
  fakeReply = '\u3010\u5bf9\u3011基本达意。\n\u3010\u7528\u8bcd\u3011' + b1.words.map(w => w.w).join(', ');
  q.vm.draft = '听收音机，保持稳定节奏。';
  await q.vm.send();
  const b2 = q.vm.quiz.cur;
  const msgs = q.vm.messages;
  // 用"找内容"而不是下标：中间还夹着 system / 欢迎语 / 上一轮的点评，
  // 按下标数很容易把断言写成"其实是别的气泡"（错一次就得再数一遍）
  const targetMsg = msgs.filter(m => /^本句目标词：/.test(m.content)).pop();
  assert(!!targetMsg && targetMsg.content.indexOf(b1.words[0].w) >= 0,
    '翻译前先把这一句的目标词摆出来（上一轮出题指令不会重发，模型靠它判偏差）：'
    + (targetMsg && targetMsg.content));
  eq(targetMsg && targetMsg.role, 'assistant', '目标词是一条正常气泡');
  eq(q.vm.quiz.right, 1, '模型开头是【对】→ 记一次达意');
  eq(q.vm.quiz.wrong, 0, '不达意的不涨');
  eq(lastOf(q.view()).content.indexOf('\u3010'), -1, '判定标记从气泡里去掉（用户看到干净的点评）');
  eq(lastOf(q.view()).content.indexOf('\u7528\u8bcd'), -1, '【用词】那行机器话也不给用户看');
  eq(q.vm.quiz.plan.step, 2, '接着出下一题');
  assert(!!b2 && b2.words.length >= 2, '第二题还是一组词');

  // 记账：达意 → 这一题用上的词 hit+1、水平档位升一档（下一句更长）
  const plan = q.vm.quiz.plan;
  const s1 = plan.seen[String(b1.words[0].w).toLowerCase()];
  assert(!!s1 && s1.hit === 1, '达意 → 用上的词 hit+1（复现频率降下来）：' + JSON.stringify(s1));
  eq(plan.tier, 1, '答对一题 → 水平档位 +1（下一句会加长）');

  // 答错 → 分开计数 + 错词马上回来 + 档位降回来
  fakeReply = '\u3010\u9519\u3011漏译了 "steady"。\n\u3010\u7528\u8bcd\u3011whatever';
  q.vm.draft = '随便翻一下。';
  await q.vm.send();
  const b3 = q.vm.quiz.cur;
  eq(q.vm.quiz.wrong, 1, '模型开头是【错】→ 记一次不达意');
  eq(q.vm.quiz.right, 1, '达意/不达意分开记');
  const s2 = plan.seen[String(b2.words[0].w).toLowerCase()];
  assert(!!s2 && s2.miss === 1, '写错的词 miss+1（提高复现频率）：' + JSON.stringify(s2));
  eq(plan.tier, 0, '答错一题 → 水平档位降回来（下一句会缩短）');
  // 模型这一轮一个目标词都没凑进句子（报了个不相干的词）→ 全部退回队列
  const dropped = b3.words.filter(w => {
    const st = plan.seen[String(w.w).toLowerCase()] || {};
    return !st.asked;
  }).map(w => w.w);
  eq(dropped.length, b3.words.length, '没凑进句子的词全部退回队列（不算考过、下次优先）：' + dropped.join(','));

  // 3 题出完 → 收尾指令 + 自动关局
  q.vm.draft = '最后一次翻译。';
  fakeReply = 'Great job today!';
  await q.vm.send();
  const pw = payloads[payloads.length - 1];
  eq(pw[pw.length - 1].content, 'WRAP', '题出完了发收尾指令（不是没头没尾地停住）');
  eq(q.vm.quiz.on, false, '这一轮回复拿到后自动关局（状态条收起）');

  // 用户自己点「结束抽测」
  const q2 = boot('block', '\u3010\u5bf9\u3011ok');
  q2.vm.startQuiz('');
  eq(q2.vm.quiz.plan.total, 6, '不给数字时用默认题数');
  q2.vm.quiz.right = 2;
  q2.vm.quiz.wrong = 1;
  q2.vm.stopQuiz();
  eq(q2.vm.quiz.on, false, '点结束就关局');
  assert(/抽测结束：共 3 题，对 2 错 1。/.test(lastOf(q2.view()).content),
    '结束时给一句小结：' + lastOf(q2.view()).content);
  // 一键开局：点了要**立刻**看到第一题（只把 on 立起来 = 点了没反应）
  payloads.length = 0;
  const q2b = boot('block', 'Question one: what does "improve" mean?');
  q2b.vm.startQuizQuick();
  await tick(); await tick();
  eq(q2b.vm.quiz.on, true, '一键开局：局开起来了');
  assert(q2b.vm.messages.some(m => m.role === 'user' && m.content === '抽测我'),
    '一键开局替用户说了一句（就是点的那颗）');
  const p1b = payloads[payloads.length - 1];
  assert(/^NEXT:/.test(p1b[p1b.length - 1].content), '一键开局立刻出第一题（不是点了没反应）');
  eq(q2b.vm.quiz.plan.step, 1, '第一题已出');
  // 静默结束：换会话 / 开新对话时不该往历史里塞小结
  const q3 = boot('block', 'ok');
  q3.vm.startQuiz('');
  const n0 = q3.vm.messages.length;
  q3.vm.newChat();
  eq(q3.vm.quiz.on, false, '开新对话 → 抽测作废（进度跟的是当前这场）');
  assert(!/抽测结束/.test(q3.vm.messages.map(m => m.content).join('|')), '静默结束不塞小结进新会话');
  eq(q3.vm.messages.length < n0 + 3, true, '新会话消息数正常（没多出一个残留气泡）');

  // 目标句识别不能误伤正常聊天
  const q4 = boot('block', 'ok');
  q4.vm.draft = 'What does "abandon" mean?';
  await q4.vm.send();
  eq(q4.vm.quiz.on, false, '普通提问不会误开局');

  console.log('');
  console.log(fail === 0 ? '对话陪练 · 收藏句子 · 句子进词书 全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
