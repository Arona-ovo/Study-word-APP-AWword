// _tools/check-ai-content.js - AI 内容能力 + 练习页 onLoad 调用链冒烟（只读）
// 重点复现：practice.vue onLoad 会依次调用 ai.isAIEnabled / engine.reviewQuestions /
// session.buildSession / session.buildDrillSession，任何一处为 undefined 都会表现为
// "TypeError: (void 0) is not a function"。这里全部真跑一遍。
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  createInnerAudioContext: () => ({ play(){}, stop(){}, destroy(){}, onEnded(){}, onError(){} })
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

// 生成 k 个全局唯一的假单词（纯小写字母，能通过词形校验），
// 用来验证多轮抓取的累加与裁剪
let autoSeq = 0;
function letterCode(n) {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}
function mkWords(k) {
  const out = [];
  // 前缀 z 保证词长 ≥ 2（词形校验要求 [a-z][a-z'-]{1,19}）
  for (let i = 0; i < k; i++) out.push({ word: 'z' + letterCode(autoSeq++), pos: 'n.', meaning: 'm' });
  return out;
}

// ---------- 按依赖顺序装载真实模块 ----------
const settings = load('utils/settings.js'); settings.init();
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
const config = load('services/config.js', { settings });
const http = load('services/http.js');
// 可控的 LLM mock：测试里随时改 behavior；calls 统计真实进入 chatCompletion 的次数
const llmState = { behavior: 'reject' };
let calls = 0;
// 注意：deps 是被拷贝进 vm sandbox 的，所以要"改成别的实现"必须走这里的 behavior，
// 不能直接给 llm.chatCompletion 赋新函数（sandbox 里那份不会变）。
// behavior 支持：'reject' | 'garbage' | JSON 字符串 | (n) => Promise<{content}>
const llm = {
  chatCompletion: (messages) => {
    const b = llmState.behavior;
    // 从 user prompt 里读出"本次需要：N 个单词"，据此决定这一轮给多少个
    const um = (messages || []).filter(m => m && m.role === 'user').pop();
    const text = (um && um.content) || '';
    const m = /本次需要：(\d+) 个单词/.exec(text);
    const want = m ? Number(m[1]) : 0;
    if (typeof b === 'function') {
      calls++;
      return Promise.resolve(b(calls, want, text));
    }
    calls++;
    if (b === 'reject') return Promise.reject(new Error('network down'));
    if (b === 'garbage') return Promise.resolve({ content: '抱歉我不明白' });
    return Promise.resolve({ content: b });
  },
  // 流式版本：把整块结果一次性喂给 onDelta，再按 chatCompletion 的约定返回，
  // 这样"流式 / 非流式"两条路径都能被同一批用例覆盖
  chatCompletionStream: async (messages, opts) => {
    const r = await llm.chatCompletion(messages, opts);
    const content = (r && r.content) || '';
    if (opts && typeof opts.onDelta === 'function') {
      for (let i = 0; i < content.length; i += 8) opts.onDelta(content.slice(i, i + 8));
    }
    return { content };
  },
  complete: () => Promise.resolve(''),
  LLMError: http.ServiceError
};
const localTts = { speak(){}, speakWord(){}, stop(){}, isPlaying(){ return false }, warmup(){}, setVoiceOptions(){} };
const voice = load('services/voice.js', {
  localTts, request: http.request, ServiceError: http.ServiceError,
  getAIConfig: config.getAIConfig, isAIEnabled: config.isAIEnabled,
  getVoicePrefs: config.getVoicePrefs, speechEndpoint: config.speechEndpoint,
  providerSupportsTTS: config.providerSupportsTTS
});
// request 可控：测试连通性用例时切换实现
let reqImpl = () => Promise.reject(new Error('network down'));
// 底层缓存（sentence-api / ai-content 的内部依赖，必须先声明）
const aiCache = load('utils/ai-cache.js');
const aiContent = load('services/ai-content.js', {
  aiCache,
  chatCompletion: llm.chatCompletion,
  isAIEnabled: config.isAIEnabled,
  getAIConfig: config.getAIConfig,
  chatEndpoint: config.chatEndpoint,
  ServiceError: http.ServiceError,
  // AI 分项开关：这里一律放行（默认全开），本脚本不测省 token 那条链路
  aiFeature: () => {},
  breakerKeyOf: (u) => String(u || ''),
  resetBreaker: () => {},
  chatCompletionStream: llm.chatCompletionStream,
  request: (...a) => reqImpl(...a)
});
// 数量归一化相关的导出（第 10、11 组共用；这里取一次，避免声明顺序踩 TDZ）
const normalizeWordCount = aiContent.normalizeWordCount;
const WORDBOOK_COUNT = aiContent.WORDBOOK_COUNT;
// 门面（修复后：门面用具名导入叶子模块，harness 注入同名依赖）
const index = load('services/index.js', {
  llm, voice, config,
  explainWord: aiContent.explainWord,
  critiqueTranslation: aiContent.critiqueTranslation,
  generateDrill: aiContent.generateDrill,
  tutorSystemPrompt: aiContent.tutorSystemPrompt,
  chatTutor: aiContent.chat,
  validateKeyFormat: aiContent.validateKeyFormat,
  testAIConnection: aiContent.testAIConnection,
  generateWordbook: aiContent.generateWordbook,
  ServiceError: http.ServiceError, LLMError: http.ServiceError
});

const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma, chatCompletion: llm.chatCompletion
});
const session = load('utils/session.js', {
  iplus1, wordbook, api, aiContent, sentenceIndex,
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, getBook: wordbooks.getBook
});
// 导入管道（AI 生成词书 → 本地去重校验 → 归书 → 补例句 的真实链路）
const commonWords = load('data/common-words.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: commonWords.COMMON_RAW, store,
  lemmaCandidates: lemmaMod.lemmaCandidates, lemma: lemmaMod.lemma
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});

(async () => {
  console.log('== 1. practice.vue onLoad 调用链冒烟（全部必须为函数且可执行） ==');
  if (typeof index.ai.isAIEnabled === 'function') ok('ai.isAIEnabled 是函数');
  else bad('ai.isAIEnabled 不是函数（真机上会报 (void 0) is not a function）');
  if (typeof index.ai.explainWord === 'function' && typeof index.ai.critiqueTranslation === 'function' &&
      typeof index.ai.generateDrill === 'function' && typeof index.ai.tutorSystemPrompt === 'function' &&
      typeof index.ai.chatTutor === 'function') ok('ai 门面五个内容能力均为函数');
  else bad('ai 门面内容能力缺失');
  if (typeof engine.reviewQuestions === 'function' && typeof engine.dailyQuestions === 'function') ok('engine 抽题函数完好');
  else bad('engine 抽题函数缺失');
  if (typeof session.buildSession === 'function' && typeof session.buildDrillSession === 'function') ok('session 两种出题入口完好');
  else bad('session 出题入口缺失');

  console.log('== 2. AI 关闭时 practice onLoad 全链路（默认降级，不联网不抛错） ==');
  const rq = engine.reviewQuestions();
  ok('engine.reviewQuestions() 正常，返回 ' + rq.length + ' 题');
  const dq = await (async () => {
    try { return await session.buildSession(2, 'fj_zsb_core'); }
    catch (e) { return engine.dailyQuestions(2); }
  })();
  ok('buildSession(2) 正常（AI 关闭走语料），返回 ' + dq.length + ' 题');
  let drillQs = [];
  try { drillQs = await session.buildDrillSession(3, 'fj_zsb_core'); ok('buildDrillSession(3) 正常（AI 关闭回落语料），返回 ' + drillQs.length + ' 题'); }
  catch (e) { bad('buildDrillSession 不应抛错：' + e.message); }
  drillQs.forEach((q, i) => {
    if (!q.options || q.options.length !== 4) bad('专练第 ' + (i + 1) + ' 题选项数异常');
    if (q.options[q.answerIndex] !== q.answer) bad('专练第 ' + (i + 1) + ' 题答案下标不匹配');
  });
  if (drillQs.length && drillQs.every(q => q.options && q.options.length === 4)) ok('专练题目结构与日常练习一致');

  console.log('== 3. AI 内容能力：未配置 → 抛 notConfigured（页面据此提示，不阻断） ==');
  async function expectNotConfigured(promise, label) {
    try { await promise; bad(label + '：未配置时不应成功'); }
    catch (e) {
      if (e && e.notConfigured && e.degradable) ok(label + ' 抛 notConfigured+degradable');
      else bad(label + ' 错误标记异常：' + JSON.stringify({ degradable: e && e.degradable, notConfigured: e && e.notConfigured }));
    }
  }
  await expectNotConfigured(aiContent.explainWord('abandon'), 'explainWord');
  await expectNotConfigured(aiContent.critiqueTranslation({ source: 'a', userAnswer: 'b', reference: 'c', dir: 'c2e' }), 'critiqueTranslation');
  await expectNotConfigured(aiContent.generateDrill([{ word: 'abandon', meaning: '放弃' }]), 'generateDrill');
  await expectNotConfigured(aiContent.chat([{ role: 'user', content: 'hi' }]), 'chat');
  await expectNotConfigured(aiContent.generateWordbook({ topic: '商务英语' }), 'generateWordbook');

  console.log('== 4. explainWord：开启后解析 JSON + 缓存命中免联网 ==');
  settings.set({ ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' } });
  const goodJSON = '```json\n{"word":"abandon","pos":"v.","meaningZh":"放弃","examples":[{"en":"He abandoned the plan.","zh":"他放弃了那个计划。"}]}\n```';
  llmState.behavior = goodJSON;
  const callsBefore = calls;
  const ex1 = await aiContent.explainWord('Abandon');
  if (ex1.meaningZh === '放弃' && ex1.examples.length === 1) ok('容错解析围栏 JSON，释义/例句正确');
  else bad('explainWord 解析异常：' + JSON.stringify(ex1));
  const ex2 = await aiContent.explainWord('abandon');
  if (ex2.fromCache === true && calls === callsBefore + 1) ok('第二次命中缓存（未再发网络请求）');
  else bad('缓存未生效：fromCache=' + ex2.fromCache + ', calls=' + (calls - callsBefore));

  console.log('== 4b. 整句翻译：中文进 → 英文出（不再回一句同义中文） ==');
  // 用户报的问题：搜「把背景换成安静的蓝色渐变」这种整句，旧提示词只问"给定一个英文单词，
  // 给中文释义"，模型只能回一句中文改写，永远拿不到"这句话用英语怎么说"。
  const ZH_SENT = '把背景换成安静的蓝色渐变';
  const EN_TRANS = 'Change the background to a quiet blue gradient.';
  let lastUserPrompt = '';
  llmState.behavior = (n, want, text) => {
    lastUserPrompt = text;
    return {
      content: JSON.stringify({
        kind: 'sentence', word: ZH_SENT, pos: 'sentence', meaningZh: EN_TRANS,
        examples: [{ en: 'Change the background to a warmer colour.', zh: '把背景换成暖一点的颜色。' }]
      })
    };
  };
  const sent = await aiContent.explainWord(ZH_SENT);
  if (sent.kind === 'sentence' && sent.meaningZh === EN_TRANS) ok('整句输入 → kind=sentence，meaningZh 是英文译文');
  else bad('整句翻译异常：' + JSON.stringify(sent));
  if (sent.pos === 'sentence') ok("pos 标成 sentence（和 phrase 一个路数，一眼看出不是单词）");
  else bad('整句的 pos 应标成 sentence，实际 ' + sent.pos);
  if (lastUserPrompt.indexOf('这是一整句话') >= 0) ok('提示词里带了「这是一整句话，请给整句译文」');
  else bad('整句提示没进提示词：' + lastUserPrompt);
  const sentCached = await aiContent.explainWord(ZH_SENT);
  if (sentCached.fromCache === true && sentCached.kind === 'sentence') ok('缓存命中后仍能认出这是整句译文');
  else bad('整句缓存回读丢了 kind：' + JSON.stringify(sentCached));

  // 单词态不能被带偏：模型说 kind=word 时照旧走释义
  llmState.behavior = '{"kind":"word","word":"abandon","pos":"v.","meaningZh":"放弃","examples":[]}';
  const wordOne = await aiContent.explainWord('abandoning');
  if (wordOne.kind === 'word' && wordOne.pos === 'v.' && wordOne.meaningZh === '放弃') ok('kind=word 照常返回词性与释义');
  else bad('单词态被带偏：' + JSON.stringify(wordOne));
  // 老数据没 kind 字段 → 默认当单词，不能把老缓存判成句子
  llmState.behavior = '{"word":"legacy","pos":"n.","meaningZh":"遗留","examples":[]}';
  const legacy = await aiContent.explainWord('legacyword');
  if (legacy.kind === 'word') ok('模型没给 kind 时默认按单词处理（老缓存兼容）');
  else bad('缺 kind 时默认值错误：' + JSON.stringify(legacy));

  // looksLikeSentence 只是给模型的提示，判错也不影响功能 —— 但别离谱
  const LLS = aiContent.looksLikeSentence;
  if (LLS(ZH_SENT) === true) ok('中文长整句被判为句子');
  else bad('中文整句漏判');
  if (LLS('abandon') === false) ok('单个英文单词不是句子');
  else bad('单词被误判成句子');
  if (LLS('give up') === false) ok('两词短语交给模型判（本地不武断）');
  else bad('两词短语不应本地判成句子');
  if (LLS('I want to change the background.') === true) ok('英文整句被判为句子');
  else bad('英文整句漏判');

  console.log('== 5. 模型返回垃圾 → 抛可降级错误（页面回退本地词典/提示） ==');
  llmState.behavior = 'garbage';
  try { await aiContent.explainWord('novel'); bad('垃圾返回不应成功'); }
  catch (e) { if (e.degradable) ok('explainWord 垃圾返回 → degradable'); else bad('应标记 degradable'); }

  console.log('== 6. critiqueTranslation / generateDrill 正常解析 ==');
  llmState.behavior = '{"hasError":true,"comment":"时态用错了","improved":"I went to school yesterday."}';
  const cr = await aiContent.critiqueTranslation({ source: 'I go to school yesterday.', userAnswer: '我昨天去上学', reference: '我昨天去了学校', dir: 'e2c' });
  if (cr.hasError === true && cr.comment === '时态用错了' && cr.improved.indexOf('went') >= 0) ok('点评解析正确');
  else bad('critiqueTranslation 解析异常：' + JSON.stringify(cr));
  llmState.behavior = '{"en":"She decided to abandon the plan.","zh":"她决定放弃这个计划。","targetWords":["abandon"],"note":"abandon + 计划","level":2}';
  const dr = await aiContent.generateDrill([{ word: 'abandon', meaning: '放弃' }]);
  if (dr.en && dr.zh && dr.level === 2) ok('专练句解析正确');
  else bad('generateDrill 解析异常：' + JSON.stringify(dr));

  console.log('== 7. tutorSystemPrompt 含学习词提示 ==');
  const sp = aiContent.tutorSystemPrompt(['abandon', 'novel']);
  if (sp.indexOf('abandon') >= 0 && sp.indexOf('conversation partner') >= 0) ok('陪练系统提示词正确');
  else bad('tutorSystemPrompt 异常：' + sp);

  console.log('== 7b. 抽测提示词（句子翻译版）==');
  // 用户改的口径：「不要只做单词随机抽认（那样和直接背单词没有区别），
  // 而是用今天已背的词尽可能多地组合成一句语义通顺的句子，让用户翻译。」
  // 分工没变：用哪几个词、句子多长在**本地**（utils/quiz-plan.js），模型只造句子 + 点评。
  const zsp = aiContent.quizSystemPrompt([
    { w: 'abandon', pos: 'v.', m: '放弃' },
    { w: 'novel', pos: 'n.', m: '小说' }
  ]);
  if (zsp.indexOf('abandon') >= 0 && zsp.indexOf('小说') >= 0) ok('词池连词义一起进系统提示词（模型不瞎编释义）');
  else bad('quizSystemPrompt 没带上词池：' + zsp);
  if (/Only use words from this pool/i.test(zsp)) ok('明确"只用这些词"');
  else bad('quizSystemPrompt 没说只用词池里的词');
  if (/ONE new English sentence/i.test(zsp) && /translate into Chinese/i.test(zsp)) ok('一次只出一道题，且是"英译中"');
  else bad('quizSystemPrompt 没交代"一次一道英译中"：' + zsp);
  if (zsp.indexOf('\u3010\u5bf9\u3011') >= 0 && zsp.indexOf('\u3010\u9519\u3011') >= 0) ok('判分标记写清楚了（页面靠它计数）');
  else bad('quizSystemPrompt 缺判分标记约定：' + zsp);
  if (/output NO marker/i.test(zsp)) ok('第一题明确不许输出标记（否则白加一次"答对"）');
  else bad('quizSystemPrompt 没交代"第一题不出标记"');
  // 容错（用户要求 2）：凑不成就取子集或拆句，宁可少考几个词
  if (/subset that fits/i.test(zsp) && /split .{0,20}two short sentences/i.test(zsp)) ok('凑不成就取子集 / 拆成两句');
  else bad('quizSystemPrompt 没交代"凑不成一句话怎么办"');
  if (/NEVER force it/i.test(zsp)) ok('明确禁止硬凑不通顺的句子');
  else bad('quizSystemPrompt 没禁止硬凑');
  // 评判（用户要求 3）：整体达意 → 漏译/误译/目标词偏差 → 参考译文 → 搭配或语法讲解
  if (/overall meaning/i.test(zsp)) ok('先判整体是否达意');
  else bad('quizSystemPrompt 没要求先判整体达意');
  if (/漏译/.test(zsp) && /误译/.test(zsp)) ok('逐条指出漏译/误译');
  else bad('quizSystemPrompt 没要求逐条指出漏译/误译：' + zsp);
  if (/Reference:/i.test(zsp)) ok('要给参考译文');
  else bad('quizSystemPrompt 没要求参考译文');
  if (/collocation or grammar/i.test(zsp)) ok('要点出关键搭配或语法');
  else bad('quizSystemPrompt 没要求讲解搭配/语法');
  if (/encouraging/i.test(zsp)) ok('语气要求：鼓励、简洁');
  else bad('quizSystemPrompt 没提语气');
  if (zsp.indexOf('\u3010\u7528\u8bcd\u3011') >= 0) ok('要求回报"实际用进句子的词"（没用上的词要退回队列）');
  else bad('quizSystemPrompt 缺【用词】标记约定：' + zsp);
  if (/do not give the Chinese translation|Do not give the Chinese translation/i.test(zsp)) ok('出题时不许先给译文');
  else bad('quizSystemPrompt 没拦住"先把译文说了"');

  const batch = {
    words: [{ w: 'banana', pos: 'n.', m: '香蕉' }, { w: 'eat', pos: 'v.', m: '吃' }],
    limit: 9,
    level: 2,
    step: 1
  };
  const hint = aiContent.quizNextHint(batch);
  if (hint.indexOf('banana') >= 0 && hint.indexOf('香蕉') >= 0 && hint.indexOf('eat') >= 0) {
    ok('出题指令带上一组词的形与义');
  } else bad('quizNextHint 异常：' + hint);
  if (/9 words or fewer/.test(hint) && /level 2\/5/.test(hint)) ok('出题指令带上目标句长与水平档位（难度贴合）');
  else bad('quizNextHint 没带句长/档位：' + hint);
  if (hint.indexOf('\u3010\u7528\u8bcd\u3011') >= 0) ok('出题指令要求回报实际用词');
  else bad('quizNextHint 没要求回报用词：' + hint);
  if (/do not give the translation|Do not give the translation/i.test(hint)) ok('出题时不许先给译文');
  else bad('quizNextHint 没拦住"先把译文说了"');
  if (aiContent.quizNextHint(null) === '' && aiContent.quizNextHint({ words: [] }) === '') {
    ok('没有词时返回空串（页面据此判"考完了"）');
  } else bad('quizNextHint 空输入没兜底');
  const wh = aiContent.quizWrapHint();
  if (/Do not ask any new question/i.test(wh)) ok('收尾指令：不再出题、做小结');
  else bad('quizWrapHint 异常：' + wh);
  if (/translated wrongly/i.test(wh)) ok('收尾要列出写错的词（用户要求 4/5：让他知道该复习什么）');
  else bad('quizWrapHint 没要求列出错词：' + wh);

  console.log('== 8. validateKeyFormat 格式校验（纯本地） ==');
  const cases = [
    { c: {}, ok: false, tag: '全空' },
    { c: { baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' }, ok: false, tag: '缺密钥' },
    { c: { baseURL: 'ftp://x', apiKey: 'sk-1234567890', model: 'm' }, ok: false, tag: '地址协议错' },
    { c: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk 123', model: 'm' }, ok: false, tag: '密钥含空格' },
    { c: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-123', model: 'm' }, ok: false, tag: '密钥过短' },
    { c: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: '' }, ok: false, tag: '缺模型' },
    { c: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: 'deepseek-chat' }, ok: true, tag: '合规' }
  ];
  cases.forEach(x => {
    const r = aiContent.validateKeyFormat(x.c);
    if (r.ok === x.ok) ok('格式校验[' + x.tag + '] → ' + (r.ok ? '通过' : r.reason));
    else bad('格式校验[' + x.tag + '] 期望 ok=' + x.ok + '，实际 ' + JSON.stringify(r));
  });

  console.log('== 9. testAIConnection 连通性测试（成功 / 失败映射） ==');
  // 9a. 格式不合规 → notConfigured，不发请求
  reqImpl = () => { throw new Error('不应发起请求'); };
  settings.set({ ai: { enabled: true, baseURL: '', apiKey: '', model: '' } });
  try { await aiContent.testAIConnection(); bad('格式不合规不应成功'); }
  catch (e) { if (e.notConfigured) ok('格式不合规 → notConfigured（未发请求）'); else bad('应为 notConfigured：' + e.message); }
  // 9b. 2xx 且结构正确 → ok + latency
  settings.set({ ai: { enabled: true, baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: 'deepseek-chat' } });
  reqImpl = () => Promise.resolve({ statusCode: 200, data: { choices: [{ message: { content: 'pong' } }] } });
  const tc = await aiContent.testAIConnection();
  if (tc.ok === true && tc.reply === 'pong' && typeof tc.latencyMs === 'number') ok('连通成功 → { ok:true, reply, latencyMs }');
  else bad('连通成功结果异常：' + JSON.stringify(tc));
  // 9c. 401 → 友好中文提示
  reqImpl = () => Promise.reject(new http.ServiceError('HTTP 401', { status: 401, degradable: true }));
  try { await aiContent.testAIConnection(); bad('401 不应成功'); }
  catch (e) { if (e.message.indexOf('密钥无效') >= 0) ok('401 → 密钥无效提示'); else bad('401 提示异常：' + e.message); }
  // 9d. 网络错误 → 友好提示
  reqImpl = () => Promise.reject(new http.ServiceError('request:fail', { degradable: true }));
  try { await aiContent.testAIConnection(); bad('网络错误不应成功'); }
  catch (e) { if (e.message.indexOf('不可达') >= 0 || e.message.indexOf('跨域') >= 0) ok('网络错误 → 友好提示'); else bad('网络错误提示异常：' + e.message); }

  console.log('');
  console.log('== 10. generateWordbook：AI 生成词书 + 本地去重导入链路 ==');
  // 10a. 正常返回 → { bookName, words:[{word,pos,meaning}] }，非法/重复项被过滤
  settings.set({ ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' } });
  llmState.behavior = '{"bookName":"商务英语高频词","words":[{"word":"Negotiate","pos":"v.","meaning":"谈判"},{"word":"negotiate","pos":"v.","meaning":"重复项"},{"word":"invoice","pos":"n.","meaning":"发票"},{"word":"123","pos":"n.","meaning":"非法"},{"word":"contract","pos":"","meaning":"合同"}]}';
  const book = await aiContent.generateWordbook({ topic: '商务英语', count: 20 });
  if (book.bookName === '商务英语高频词' && book.words.length === 3 &&
      book.words.every(w => /^[a-z][a-z'-]*$/.test(w.word))) ok('生成词书解析正确，非法/重复项已过滤（' + book.words.map(w => w.word).join(', ') + '）');
  else bad('generateWordbook 解析异常：' + JSON.stringify(book));
  // 10b. 数量归一化（count 传 99999 → 夹取到 WORDBOOK_COUNT.MAX）
  const nb = normalizeWordCount(99999);
  if (nb.auto === false && nb.count === WORDBOOK_COUNT.MAX) ok('count=999 → 夹取到上限 ' + WORDBOOK_COUNT.MAX);
  else bad('count 归一化异常：' + JSON.stringify(nb));
  // 10c. 空结果 → degradable 错误
  llmState.behavior = '{"bookName":"x","words":[]}';
  try { await aiContent.generateWordbook({ topic: '空' }); bad('空结果不应成功'); }
  catch (e) { if (e.degradable) ok('空结果 → degradable（页面回退提示）'); else bad('应为 degradable：' + e.message); }
  // 10d. 真跑本地导入链路：AI 词表 → validateAndDedupe → importIntoBook（词进入本地词书）
  llmState.behavior = '{"bookName":"测试词书","words":[{"word":"gumption","pos":"n.","meaning":"进取心"},{"word":"abandon","pos":"v.","meaning":"放弃"}]}';
  const g = await aiContent.generateWordbook({ topic: '测试' });
  const vd = importer.validateAndDedupe(g.words, 'fj_zsb_core');
  const imp = importer.importIntoBook(vd.accepted, 'fj_zsb_core');
  const stored = importer.customWordsOf('fj_zsb_core').map(w => w.word);
  if (imp.added >= 1 && stored.indexOf('gumption') >= 0) ok('AI 生成词已写入本地词书（新增 ' + imp.added + ' 词，去重跳过 ' + vd.rejected.length + ' 条）');
  else bad('本地导入链路异常：' + JSON.stringify({ added: imp.added, stored }));
  // 10e. 再次导入同一批 → 全部被去重（幂等）
  const vd2 = importer.validateAndDedupe(g.words, 'fj_zsb_core');
  if (vd2.accepted.length === 0 && vd2.rejected.length === g.words.length) ok('重复导入全部去重（幂等）');
  else bad('去重幂等异常：' + JSON.stringify(vd2));

  console.log('');
  console.log('== 11. 生成词书的数量：自定义输入 / 不限（多轮抓取） ==');

  // 11a. 常量契约
  if (WORDBOOK_COUNT.MIN === 1 && WORDBOOK_COUNT.MAX >= 100 &&
      WORDBOOK_COUNT.PER_ROUND > 0 && WORDBOOK_COUNT.MAX_ROUNDS > 0) {
    ok('WORDBOOK_COUNT = ' + JSON.stringify(WORDBOOK_COUNT));
  } else bad('WORDBOOK_COUNT 异常：' + JSON.stringify(WORDBOOK_COUNT));

  // 11b. 自定义数字：任意值都能归一，越界被夹取
  const cntCases = [
    [1, { auto: false, count: 1 }],
    [7, { auto: false, count: 7 }],
    ['42', { auto: false, count: 42 }],
    [500, { auto: false, count: 500 }],
    [8000, { auto: false, count: 8000 }],
    [9999, { auto: false, count: 8000 }],
    [0, { auto: true, count: 0 }],
    [-1, { auto: true, count: 0 }],
    ['auto', { auto: true, count: 0 }],
    ['不限', { auto: true, count: 0 }],
    ['', { auto: true, count: 0 }],
    ['abc', { auto: true, count: 0 }]
  ];
  let casesOk = true;
  cntCases.forEach(([inp, exp]) => {
    const r = normalizeWordCount(inp);
    if (r.auto !== exp.auto || r.count !== exp.count) {
      casesOk = false;
      bad('normalizeWordCount(' + JSON.stringify(inp) + ') = ' + JSON.stringify(r) + '，期望 ' + JSON.stringify(exp));
    }
  });
  if (casesOk) ok('normalizeWordCount 归一化正确（固定值/越界夹取/不限/非法输入）');

  // 11c. 固定数量：够用就收手（25 词 → 1 轮）
  {
    const before = calls;
    llmState.behavior = (n, want) => Promise.resolve({
      content: JSON.stringify({ bookName: 'B', words: mkWords(want) })
    });
    const r = await aiContent.generateWordbook({ topic: 'T', count: 25 });
    const rounds = calls - before;
    if (r.words.length === 25 && rounds === 1 && !r.auto) ok('固定 25 词：1 轮拿满，裁剪到 25 词');
    else bad('固定 25 词异常：rounds=' + rounds + ' len=' + r.words.length);
  }

  // 11d. 固定数量 > PER_ROUND：分多轮抓取
  {
    const before = calls;
    llmState.behavior = (n, want) => Promise.resolve({
      content: JSON.stringify({ bookName: 'B', words: mkWords(want) })
    });
    const r = await aiContent.generateWordbook({ topic: 'T', count: 90 });
    const rounds = calls - before;
    if (r.words.length === 90 && rounds === Math.ceil(90 / WORDBOOK_COUNT.PER_ROUND)) {
      ok('固定 90 词：分 ' + rounds + ' 轮抓取（40+40+10）');
    } else bad('固定 90 词异常：rounds=' + rounds + ' len=' + r.words.length);
  }

  // 11e. 不限：模型给不出新词就停，并标记 complete
  {
    const before = calls;
    const first = [{ word: 'alpha', pos: 'n.', meaning: '首字母' }];
    llmState.behavior = () => Promise.resolve({
      content: JSON.stringify({ bookName: 'B', words: first })
    });
    const r = await aiContent.generateWordbook({ topic: 'T', count: 0 });
    const rounds = calls - before;
    if (r.auto && r.complete && r.words.length === 1 && rounds === 2) {
      ok('不限：模型无新词即停止 → complete=true，共 2 轮');
    } else bad('不限模式异常：' + JSON.stringify({ auto: r.auto, complete: r.complete, len: r.words.length, rounds }));
  }

  // 11f. 不限：持续有新词时累加（不因"单轮没给满"提前结束）
  {
    const before = calls;
    llmState.behavior = (n) => {
      // 每轮只给 5 个新词（远小于 PER_ROUND），应继续追问；第 4 轮给不出新词
      const rd = n - before;
      const k = rd >= 4 ? 0 : 5;
      return Promise.resolve({ content: JSON.stringify({ bookName: 'B', words: mkWords(k) }) });
    };
    const r = await aiContent.generateWordbook({ topic: 'T', count: 'auto' });
    const rounds = calls - before;
    if (r.words.length === 15 && r.complete && rounds === 4) {
      ok('不限：单轮未满不提前结束，累计 15 词后取完');
    } else bad('不限累加异常：' + JSON.stringify({ len: r.words.length, rounds, complete: r.complete }));
  }

  // 11g. 非法输入（null/undefined/NaN）不抛错 → 按不限处理
  {
    let noThrow = true;
    [null, undefined, NaN, {}].forEach(v => {
      try {
        const r = normalizeWordCount(v);
        if (!r.auto) noThrow = false;
      } catch (e) { noThrow = false; }
    });
    if (noThrow) ok('null/undefined/NaN/{} → 不抛错，按「不限」处理');
    else bad('非法输入处理异常');
  }

  console.log('');
  console.log(fail === 0 ? 'AI 内容能力全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
