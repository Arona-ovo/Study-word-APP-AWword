// _tools/check-word-polish.js - 「AI 补全多义 + 预判预取 + 全部落缓存」校验（真跑模块）
//
// 用户原话：
//   「搜索出来的本地已缓存单词，有时候其他意思显示不全，有些一词多义显示不全，
//     这个时候需要 AI 来补充，并且 AI 补充完，记得载入缓存，
//     并且 AI 补充没有的单词列表的时候要多补充几个预判用户要搜索的单词。
//     或者可以用本地多缓存一些来解决。」
//
// 拆成三条契约，逐条守住：
//   1. **只在"显示不全"时补**：缓存里已有 ≥2 个义项就不花 token（补过一次就够）
//   2. **补完一定写回缓存**：同一个词第二次查就是离线直出（"本地多缓存一些"）
//   3. **顺手多备几个词**：本次结果里用户八成要点开的几条 + 模型预判的同根/搭配词，
//      一次调用一起补，落成缓存条目（src='ai-prefetch'），用户还没查就已经备好
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const mem = {};
const toasts = [];
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => toasts.push(String((o && o.title) || '')),
  navigateTo: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

// ---------- 按依赖顺序装载真实模块 ----------
const settings = load('utils/settings.js'); settings.init();
const config = load('services/config.js', { settings });
const http = load('services/http.js');

// 可控 LLM mock：behavior 是一条返回 JSON 文本的函数（按 prompt 里的 Word:/ALSO: 定制）
const llmState = { behavior: null, calls: 0, lastUser: '' };
const llm = {
  chatCompletion: (messages) => {
    const um = (messages || []).filter(m => m && m.role === 'user').pop();
    llmState.lastUser = (um && um.content) || '';
    llmState.calls++;
    if (typeof llmState.behavior === 'function') {
      return Promise.resolve({ content: llmState.behavior(llmState.lastUser) });
    }
    return Promise.resolve({ content: llmState.behavior || '{}' });
  },
  chatCompletionStream: async (messages, opts) => {
    const r = await llm.chatCompletion(messages, opts);
    return { content: (r && r.content) || '' };
  },
  complete: () => Promise.resolve('')
};

const aiCache = load('utils/ai-cache.js');
const aiContent = load('services/ai-content.js', {
  aiCache,
  chatCompletion: llm.chatCompletion,
  chatCompletionStream: llm.chatCompletionStream,
  isAIEnabled: config.isAIEnabled,
  getAIConfig: config.getAIConfig,
  chatEndpoint: config.chatEndpoint,
  ServiceError: http.ServiceError,
  request: () => Promise.reject(new Error('network down')),
  // 分项开关一律放行（本脚本不测省 token 那条链路）
  aiFeature: () => {},
  breakerKeyOf: () => '',
  resetBreaker: () => {}
});

settings.set({
  ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: 'deepseek-chat' }
});

// ---------- 真 mixin（只把它的三个外部依赖换成桩） ----------
const t = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m));
const expandLog = [];
const expandStub = async (w, opts) => {
  expandLog.push({ w: String(w || ''), also: ((opts && opts.also) || []).slice() });
  return aiContent.expandWord(w, opts);
};
// 判定"本地还有没有更多义项"要查词典层那份完整义项表（data/word-senses.js），
// 少了这一项 mixin 加载即崩（不是假绿，是压根跑不起来）。
// ⚠️ utils/ 下的模块不会被自动装载，lemma / lemmaCandidates 必须显式给
const lemmaMod = load('utils/lemma.js');
const dict = load('utils/dict.js', {
  lemmaCandidates: lemmaMod.lemmaCandidates,
  lemma: lemmaMod.lemma
});
const mixinFactory = load('utils/word-polish-mixin.js', {
  aiCache, expandWord: expandStub, t, dict
}).default;

/** 把 mixin 与"宿主"合起来挂一个能跑的实例（模拟 Vue 的 mixin 合并） */
function mount(host) {
  const mix = mixinFactory();
  const ctx = Object.assign(
    {},
    mix.data(), (host && host.data) || {},
    mix.methods, (host && host.methods) || {}
  );
  Object.keys(Object.assign({}, mix.computed, (host && host.computed) || {})).forEach((k) => {
    const fn = (mix.computed && mix.computed[k]) || (host.computed && host.computed[k]);
    Object.defineProperty(ctx, k, { get: () => fn.call(ctx), configurable: true });
  });
  ctx.$nextTick = (fn) => fn();
  return ctx;
}

(async function main() {
  console.log('== 1. 缓存要存得下"多个义项"（否则永远补不完） ==');
  aiCache.init();
  aiCache.clearAll();
  aiCache.rememberWord({ word: 'Bear', pos: 'n.', meaning: '熊', src: 'ai' });
  eq(aiCache.sensesOf('bear').length, 0, '老式单条释义 → 没有义项表（这就是"显示不全"的来源）');
  eq(aiCache.hasFullSenses('bear'), false, '单条释义 → 判定为"还没补全"');
  aiCache.rememberWord({
    word: 'bear', pos: 'v.', meaning: '承受；忍受；承担',
    senses: [{ pos: 'n.', meaning: '熊' }, { pos: 'v.', meaning: '承受' },
      { pos: 'v.', meaning: '忍受' }, { pos: 'v.', meaning: '承担' }],
    src: 'ai'
  });
  eq(aiCache.sensesOf('bear').length, 4, '补齐后的义项原样存下来');
  eq(aiCache.hasFullSenses('bear'), true, '≥2 个义项 → 判定为已补全（不再花 token）');
  eq(aiCache.findWord('bear').meaning, '承受；忍受；承担', '主释义仍是拼好的那一句（界面那条卡片照旧能显示）');

  const many = [];
  for (let i = 0; i < 20; i++) many.push({ pos: 'n.', meaning: '义项' + i });
  aiCache.rememberWord({ word: 'run', pos: 'v.', meaning: '跑', senses: many, src: 'ai' });
  eq(aiCache.sensesOf('run').length, 8, '义项有上限 8 条（防模型塞一堆凑数义项把缓存撑大）');

  console.log('\n== 2. expandWord：补全 → 一定写回缓存 ==');
  aiCache.clearAll();
  llmState.calls = 0;
  llmState.behavior = () => JSON.stringify({
    word: 'bear', pos: 'n./v.',
    senses: [
      { pos: 'n.', meaning: '熊' },
      { pos: 'v.', meaning: '忍受；承受' },
      { pos: 'v.', meaning: '携带；带有' }
    ],
    examples: [{ en: 'I can\'t bear the noise.', zh: '我受不了这噪音。' }],
    others: [
      { word: 'bearable', pos: 'adj.', meaning: '可忍受的' },
      { word: 'unbearable', pos: 'adj.', meaning: '无法忍受的' }
    ]
  });
  const r1 = await aiContent.expandWord('bear');
  eq(r1.fromCache, false, '第一次 → 真去问模型');
  eq(llmState.calls, 1, '只发一次请求（1 个主词 + N 个预判词打包在一次调用里）');
  eq(r1.senses.length, 3, '三个义项都回来了');
  eq(aiCache.hasFullSenses('bear'), true, '★ 补完写进缓存：下次再查这个词不用再问 AI');
  eq(aiCache.sensesOf('bear').length, 3, '缓存里存的就是补全后的义项表');
  eq(aiCache.findWord('bear').meaning, '熊；忍受；承受；携带；带有', '主释义 = 全部义项拼起来（界面那条卡片一眼看全）');
  eq(aiCache.sentencesOf('bear').length, 1, '例句也进缓存（走 sentences 桶）');

  console.log('\n== 3. 预判预取：顺手把用户接下来要搜的词备好 ==');
  eq(r1.others.length, 2, '带回 2 个预判词');
  assert(!!aiCache.findWord('bearable'), '预判词 1 已落缓存（用户还没查，本机已经有了）');
  assert(!!aiCache.findWord('unbearable'), '预判词 2 已落缓存');
  eq(aiCache.findWord('bearable').meaning, '可忍受的', '预判词的释义也存下来了（查到时直接命中）');
  eq(r1.others.filter(o => String(o.word).toLowerCase() === 'bear').length, 0,
    'others 不含主词本身（否则等于自己补自己，白花 token）');

  // 已经有一条释义的词不再被覆盖：那可能是用户自己填的，不能被模型改写
  aiCache.rememberWord({ word: 'unbearable', pos: 'adj.', meaning: '我自己填的释义', src: 'manual' });
  llmState.behavior = () => JSON.stringify({
    word: 'tear', pos: 'n./v.',
    senses: [{ pos: 'n.', meaning: '眼泪' }, { pos: 'v.', meaning: '撕开' }],
    examples: [],
    others: [{ word: 'unbearable', pos: 'adj.', meaning: '模型给的释义' }]
  });
  await aiContent.expandWord('tear');
  eq(aiCache.findWord('unbearable').meaning, '我自己填的释义', '已有条目不被预判结果覆盖');

  console.log('\n== 4. 补过一次就不再花 token（"本地多缓存一些"是这么攒出来的） ==');
  llmState.calls = 0;
  const r2 = await aiContent.expandWord('bear');
  eq(r2.fromCache, true, '第二次 → 直接走缓存');
  eq(llmState.calls, 0, '一个 token 都没花');
  eq(r2.senses.length, 3, '缓存里那份义项原样返回');

  console.log('\n== 5. 本地点名的候选（本次搜索结果里排在前面的那几条） ==');
  aiCache.clearAll();
  llmState.calls = 0;
  llmState.behavior = (txt) => {
    const m = /ALSO:\s*([^\n]+)/.exec(txt || '');
    const also = m ? m[1].trim() : '(none)';
    return JSON.stringify({
      word: 'light', pos: 'n./adj.',
      senses: [{ pos: 'n.', meaning: '光' }, { pos: 'adj.', meaning: '轻的' }],
      examples: [],
      others: also === '(none)' ? [] : also.split(',').map(w => ({ word: w.trim(), pos: 'n.', meaning: '释义-' + w.trim() }))
    });
  };
  const r3 = await aiContent.expandWord('light', { also: ['lighting', 'lighter', 'delight', 'flight'] });
  assert(/ALSO:\s*lighting,\s*lighter,\s*delight/.test(llmState.lastUser),
    '本地候选带进提示词（模型先照顾这几条）：' + (/ALSO:[^\n]*/.exec(llmState.lastUser) || [''])[0]);
  assert(!/flight/.test(llmState.lastUser), '候选最多带 3 个（再多就是浪费 token）');
  eq(r3.others.length, 3, '点名的 3 个都补回来了');
  assert(!!aiCache.findWord('lighter'), '候选词落缓存（用户接下来点开它就不用等 AI）');
  eq(llmState.calls, 1, '仍然只花一次调用');

  console.log('\n== 6. 模型返回异常 / AI 没开：不炸、可降级 ==');
  llmState.behavior = () => '抱歉我不明白';
  let threw = false;
  try { await aiContent.expandWord('gibberish') } catch (e) { threw = true }
  assert(threw, '模型返回不是 JSON → 抛可降级错误（页面照旧显示本地那条）');
  eq(aiCache.hasFullSenses('gibberish'), false, '没补全的词不会被误标成"已补全"');

  aiContent.__off = true;
  settings.set({ ai: { enabled: false } });
  threw = false;
  try { await aiContent.expandWord('bearoff') } catch (e) { threw = true }
  assert(threw, 'AI 没接 → 抛 notConfigured（由页面决定要不要提示）');
  settings.set({
    ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890', model: 'deepseek-chat' }
  });

  console.log('\n== 7. mixin：什么时候该补（"显示不全"才补） ==');
  aiCache.clearAll();
  expandLog.length = 0;
  const short = mount({ data: { lastQuery: 'in', results: [], cached: null, aiEnabled: true } });
  eq(short.polishWanted, false, 'in / a / on 这种太短的不补（补出来多半是凑数义项）');

  const zh = mount({ data: { lastQuery: '苹果', results: [], cached: null, aiEnabled: true } });
  eq(zh.polishWanted, false, '中文查询不补（走本地释义匹配，那本来就是它要的）');

  const full = mount({
    data: {
      lastQuery: 'apple', aiEnabled: true, cached: null,
      results: [{ w: 'apple', m: '苹果' }]
    }
  });
  eq(full.polishWanted, true, '本地只有一条释义 → 值得补一次');
  aiCache.rememberWord({
    word: 'apple', pos: 'n.', meaning: '苹果；苹果公司',
    senses: [{ pos: 'n.', meaning: '苹果' }, { pos: 'n.', meaning: '苹果公司' }],
    src: 'ai'
  });
  eq(full.polishWanted, false, '★ 缓存里已经有完整义项 → 不再补（补过一次就够，不反复烧 token）');

  const twoLocal = mount({
    data: { lastQuery: 'bear', aiEnabled: true, cached: null, results: [{ w: 'bear', m: '熊；忍受' }] }
  });
  eq(twoLocal.polishWanted, false, '本地那条本身就是多义（分号隔开）→ 不用补');

  console.log('\n== 8. mixin：预判候选从"当前搜索结果"里挑 ==');
  aiCache.clearAll();
  const cand = mount({
    data: {
      lastQuery: 'light', aiEnabled: true, cached: null,
      results: [
        { w: 'light', m: '光' }, { w: 'lighting', m: '照明' },
        { w: 'lighter', m: '打火机' }, { w: 'delight', m: '高兴' },
        { w: 'flight', m: '航班' }
      ]
    }
  });
  eq(cand.polishCandidates('light').join('|'), 'lighting|lighter',
    '挑当前结果里排在前面的 2 条（用户正盯着这几条，点开概率最高）');
  aiCache.rememberWord({
    word: 'lighting', pos: 'n.', meaning: '照明；灯光',
    senses: [{ pos: 'n.', meaning: '照明' }, { pos: 'n.', meaning: '灯光' }], src: 'ai'
  });
  eq(cand.polishCandidates('light').join('|'), 'lighter|delight',
    '已经补全过的跳过（别再给人家补一遍）');
  eq(cand.polishCandidates('light').indexOf('light'), -1, '不含主词本身');

  console.log('\n== 9. mixin：排期 / 换词清理 / 落地 ==');
  const host = mount({
    data: { lastQuery: '', results: [], cached: null, aiEnabled: true },
    methods: {
      // 模拟宿主的输入：改词 → schedulePolish；清空 → clearPolish
      input(v) {
        const kw = String(v || '').trim();
        this.lastQuery = kw;
        if (!kw) { this.clearPolish(); return }
        this.schedulePolish(kw);
      }
    }
  });
  // violin 在本地词典里只有「小提琴」一条义项 → 属于"显示不全，该补"
  host.input('violin');
  assert(host.polishTimer !== 0, '停手后排了个定时器（不是边打字边发请求）');
  host.input('');
  eq(host.polishTimer, 0, '清空输入 → 定时器一起清掉（别补到空词上）');

  // 直接等定时器跑完太慢（1200ms）：这里手动触发一次，验证落地结果
  llmState.behavior = () => JSON.stringify({
    word: 'violin', pos: 'n.',
    senses: [{ pos: 'n.', meaning: '小提琴' }, { pos: 'n.', meaning: '小提琴手' }],
    examples: [{ en: 'She plays the violin.', zh: '她拉小提琴。' }],
    others: [{ word: 'violinist', pos: 'n.', meaning: '小提琴手' }]
  });
  host.input('violin');
  if (host.polishTimer) { clearTimeout(host.polishTimer); host.polishTimer = 0 }
  const flying = host.aiPolish('violin');
  eq(host.polishLoading, true, '补全中 → 界面有转圈（不然用户以为没反应）');
  await flying;
  eq(host.polishLoading, false, '回来后转圈收掉');
  eq(host.polish && host.polish.senses.length, 2, '★ 义项贴到界面上（一列全出来）');
  eq(host.polishPrefetched.join('|'), 'violinist', '预判词给一句可见反馈（"顺手备好了 xxx"）');
  eq(host.polishPrefetchText, 'violinist', '拼好的展示文字（模板里不写表达式，见项目约定 9）');
  assert(!!aiCache.findWord('violinist'), '预判词确实进了本机缓存');
  eq(aiCache.hasFullSenses('violin'), true, '主词也进了缓存（下次离线看全）');

  // 一场会话里同一个词只补一次：补完就写进缓存了，再补只是白烧 token
  expandLog.length = 0;
  host.input('violin');
  await host.aiPolish('violin');
  eq(expandLog.length, 0, '同一个词一场会话只补一次');

  console.log('\n== 10. mixin：换词后旧结果不许贴上来 ==');
  const swap = mount({
    data: { lastQuery: 'tiger', results: [], cached: null, aiEnabled: true }
  });
  llmState.behavior = () => JSON.stringify({ word: 'tiger', senses: [{ pos: 'n.', meaning: '老虎' }], examples: [], others: [] });
  const pend = swap.aiPolish('tiger');
  swap.lastQuery = 'lion';                       // 请求还在路上，用户已经改查别的词
  await pend;
  eq(swap.polish, null, '回来时输入框已经换词 → 不贴（否则张冠李戴）');
  eq(swap.polishLoading, false, '转圈照样收掉（换词后还留着转圈，用户会以为这词也卡住了）');

  console.log('\n== 11. mixin：AI 关着时给说法，不静默 ==');
  const off = mount({ data: { lastQuery: 'wolf', results: [], cached: null, aiEnabled: false } });
  toasts.length = 0;
  off.polishNow('wolf');
  eq(toasts.length, 1, 'AI 没接 → 手动点补全也给一句解释（不能点了没反应）');
  assert(/AI/.test(toasts[0]), '解释里点明要接 AI：' + toasts[0]);
  // 注意别用 eq 比定时器本身：Node 的 Timeout 是循环结构，JSON.stringify 会炸
  off.schedulePolish('wolf');
  assert(off.polishTimer === 0, 'AI 关着 → 不排补全请求（别让用户白等一个永远不会发的请求）');

  console.log('\n== 12. 两个使用方都接上了（首页 / 做题页顶栏查词） ==');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
  [['pages/home/home.vue', '首页'], ['components/word-search/word-search.vue', '做题页顶栏查词']]
    .forEach(function (pair) {
      const s = read(pair[0]);
      const tag = pair[1];
      const TPL = (/<template>([\s\S]*)<\/template>/.exec(s) || [])[1] || '';
      assert(/import wordPolishMixin from '[^']*utils\/word-polish-mixin\.js'/.test(s),
        tag + ' 引入 wordPolishMixin');
      assert(/mixins:\s*\[[^\]]*wordPolishMixin\(\)/.test(s), tag + ' 挂上 mixin');
      assert(/v-if="polishLoading"/.test(TPL), tag + ' 有"正在补全"的转圈');
      assert(/v-else-if="polish"/.test(TPL), tag + ' 有补全结果那块（且是独立分支，不会被上面吞掉）');
      assert(/v-else-if="polishWanted"[\s\S]{0,200}?@tap="polishNow"/.test(TPL),
        tag + ' 有手动入口（不想等定时器 / AI 关着时点一下）');
      assert(/polishPrefetchText/.test(TPL), tag + ' 预判词有可见反馈');
      assert(/schedulePolish\(/.test(s), tag + ' 输入后排队补全');
      assert(/clearPolish\(\)/.test(s), tag + ' 换词 / 收起时清掉补全（连定时器一起）');
    });

  console.log('');
  console.log(fail === 0 ? '义项补全 / 预判预取校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
