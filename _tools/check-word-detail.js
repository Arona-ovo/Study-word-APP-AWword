// _tools/check-word-detail.js - 统一单词详情页校验（只读）
// 覆盖：
//  1) 页面存在 + 已注册进 pages.json（custom 导航）
//  2) 两个入口（词库词汇明细 / 首页搜索结果）都跳转到同一个路由
//  3) 详情页契约：返回按钮、数据字段、方法齐全
//  4) 页面依赖的数据源真实可用（真跑 dict / wordbook / sentence-index）
//  5) 只用现有字段：不臆造音标 / 例句来源
const fs = require('fs');
const path = require('path');
const { load, loadCode } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const FILE = 'pkgManage/pages/word-detail/word-detail';
// 分包后 pages.json 里写的是相对分包的路径，磁盘上多一层 pkgManage/
const PAGE = 'pages/word-detail/word-detail';

/* ---------- 1. 页面与路由 ---------- */
console.log('== 1. 页面与路由注册 ==');
assert(fs.existsSync(path.join(ROOT, FILE + '.vue')), '页面文件存在 ' + FILE + '.vue');
const pj = R('pages.json');
assert(pj.indexOf('"' + PAGE + '"') >= 0, 'pages.json 已注册该路由');
const seg = pj.slice(pj.indexOf('"' + PAGE + '"'));
assert(/navigationStyle"\s*:\s*"custom"/.test(seg.slice(0, 200)), '该页为 custom 导航（由 float-navbar 提供返回）');

const wd = R(FILE + '.vue');
const tpl = wd.slice(0, wd.indexOf('\n<script'));
const sc = wd.slice(wd.indexOf('\n<script'), wd.indexOf('\n<style'));

/* ---------- 2. 两个入口 ---------- */
console.log('== 2. 两个入口共用同一路由 ==');
const lib = R('pkgManage/pages/library-detail/library-detail.vue');
const home = R('pages/home/home.vue');

// 词汇明细加了长按多选：tap 改走 onWordTap 分发（多选态切换选中，普通态进详情）
assert(/@tap="onWordTap\(item\)"/.test(lib), '词库「词汇明细」列表项 tap 走 onWordTap');
assert(/onWordTap\(item\) \{[\s\S]*?openWord\(item\)/.test(lib), '非多选态仍进 openWord 详情');
assert(/openWord\(item\)\s*\{/.test(lib), '词库页实现 openWord 方法');
assert(/word-detail\?w=.*&id=/.test(lib), '词库入口传 w + id + book');

assert(/class="sr-item"[^>]*@tap="openWord\(it\)"/.test(home) ||
       (/sr-item/.test(home) && /@tap="openWord\(it\)"/.test(home)), '首页搜索结果项绑定 openWord(it)');
assert(/openWord\(it\)\s*\{/.test(home), '首页实现 openWord 方法');
assert(/word-detail\?w=/.test(home), '首页入口传 w + book');

// 两个入口的目标路由必须完全一致
const urlRe = /\/pages\/word-detail\/word-detail\?w=/g;
const libHits = (lib.match(urlRe) || []).length;
const homeHits = (home.match(urlRe) || []).length;
assert(libHits >= 1 && homeHits >= 1, '两处入口指向同一路由（词库 ' + libHits + ' 处 / 首页 ' + homeHits + ' 处）');

// 首页原本的"点击发音"入口仍保留给 AI 补充结果
assert(/speakResult/.test(home), '首页 AI 补充结果的「发音」仍可用');

/* ---------- 3. 详情页契约 ---------- */
console.log('== 3. 详情页契约 ==');
assert(/<float-navbar/.test(tpl), '有 float-navbar（自带返回按钮）');
// 文案已 i18n 化：标题可能是 :title="$t('单词详情')"
assert(/:title="\$t\('单词详情'\)"|title="单词详情"/.test(tpl), '导航标题 = 单词详情');

['word', 'wordId', 'bookId', 'missing', 'found', 'lv', 'inBook', 'mastery', 'seen',
 'correct', 'pct', 'statusName', 'faved', 'books', 'examples', 'info']
  .forEach(k => assert(new RegExp('\\b' + k + '\\s*:').test(sc), 'data 含 ' + k));

['load', 'refreshFav', 'toggleFav', 'speakWord', 'speakEx',
 'addToCurrent', 'pickBook', 'doAdd']
  .forEach(m => assert(new RegExp('\\b' + m + '\\s*\\(').test(sc), 'method ' + m));

assert(/onLoad\(opt\)/.test(sc), 'onLoad 读取路由参数');
// 跳转方对 query 做了 encodeURIComponent；App 端不会自动解码 —— 必须手动 dec，
// 否则中文词在详情页显示成 %e4%b8%80 之类的乱码
assert(/const\s+dec\s*=/.test(sc) && /decodeURIComponent/.test(sc), '定义 dec 解码助手（内含 decodeURIComponent）');
assert(/this\.word\s*=\s*dec\(o\.w\)/.test(sc), 'w 参数经过 dec 解码');
assert(/this\.wordId\s*=\s*dec\(o\.id\)/.test(sc) && /this\.bookId\s*=\s*dec\(o\.book\)/.test(sc), 'id / book 参数同样解码');
assert(/\/%\[0-9a-f\]\{2\}\//i.test(sc), '解码前先判断是否含百分号编码（无编码参数原样返回）');
assert(/try\s*\{\s*return\s+decodeURIComponent/.test(sc), '解码包 try/catch（坏编码不崩页面）');
assert(/o\.w/.test(sc) || /opt\.w/.test(sc), '以单词名 w 作为必填参数');
assert(/o\.id/.test(sc) || /opt\.id/.test(sc), 'id 可选（搜索结果没有词条 id）');
assert(/currentBookId\(\)/.test(sc), '未传 book 时回落到当前词书');
assert(/onHide[\s\S]*tts\.stop\(\)/.test(sc), '离开页面时停止朗读');

// 只用现有模块，没有新造依赖
['utils/dict', 'utils/wordbook', 'utils/sentence-index', 'utils/settings',
 'services/account-sync', 'services/voice', 'components/float-navbar', 'utils/search']
  .forEach(p => assert(sc.indexOf(p) >= 0, '依赖现有模块 ' + p));

/* ---------- 4. 不臆造字段 ---------- */
console.log('== 4. 只使用现有数据结构 ==');
assert(/dict\.lookup\(/.test(sc), '单词/词性/释义/音标来自 dict.lookup');
assert(/v-if="info\.phonetic"/.test(tpl), '音标按"有才显示"处理（WORDS 多数无 ph 字段）');
assert(/entry\.exampleEn/.test(sc), '例句优先用导入词自带的 exampleEn/exampleZh');
assert(/sentenceIndex\.candidates\(/.test(sc), '其余例句由句库倒排索引反查（不臆造）');
assert(/wordbook\.masteryMap\(/.test(sc), '掌握度来自 wordbook.masteryMap');
assert(/wordbook\.listBooks\(\)[\s\S]*bookWords\(/.test(sc), '所属词库由 listBooks + bookWords 实查');
assert(/dict\.SRC_LABEL/.test(sc), '来源标签复用 dict.SRC_LABEL');

/* ---------- 5. 数据源真实可用 ---------- */
console.log('== 5. 数据源真跑一遍 ==');
const settingsMod = load('utils/settings.js'); settingsMod.init();
const lemmaMod = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const dictMod = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: load('data/common-words.js').COMMON_RAW, store,
  lemmaCandidates: lemmaMod.lemmaCandidates, lemma: lemmaMod.lemma
});
const sIdx = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemmaMod.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex: sIdx
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  wordIdsOfBook: wordbooks.wordIdsOfBook, setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});

const e = dictMod.lookup('improve');
assert(e.found && e.meaning && e.pos, 'dict.lookup("improve") = ' + e.pos + ' ' + e.meaning);
assert(typeof e.phonetic === 'string', 'phonetic 字段存在（可能为空串，按条件渲染）');

const all = wordbook.bookWords('fj_zsb_core');
assert(all.length > 0 && all[0] && typeof all[0].w === 'string' && 'id' in all[0],
  'bookWords 返回 ' + all.length + ' 条，含 id / w 字段（页面据此查掌握度）');

const mm = wordbook.masteryMap('fj_zsb_core');
assert(mm && typeof mm === 'object', 'masteryMap 可用（返回 ' + Object.keys(mm).length + ' 条记录）');

const cands = sIdx.candidates('improve');
assert(Array.isArray(cands) && cands.length > 0,
  'sentenceIndex.candidates("improve") 命中 ' + cands.length + ' 句（页面例句来源）');
assert(cands[0] && typeof cands[0].en === 'string' && typeof cands[0].zh === 'string',
  '例句条目含 en / zh 字段');

const books = wordbook.listBooks();
assert(books.length > 0 && books.some(b => b.current), 'listBooks 返回 ' + books.length + ' 本，含当前词书');

/* ---------- 6. 加入词书（AI 词 + 原有词，归属权交给用户） ---------- */
console.log('== 6. 「加入词书」入口 ==');
assert(/加入词书/.test(tpl), '模板有「加入词书」卡片标题');
assert(/@tap="addToCurrent"/.test(tpl), '「加入当前词书」按钮绑定 addToCurrent');
assert(/@tap="pickBook"/.test(tpl), '「加入 / 移出词书…」按钮绑定 pickBook');
assert(/v-if="!inBook"/.test(tpl), '已在本词书时不重复显示主按钮');
assert(/已在当前词书中/.test(tpl), '已收录时给出明确状态文案');
// 2026-10-09：词书弹窗改多选 —— 列出全部词书（已收录的预勾选），不再只列"还没收录的"
assert(/v-if="allBooks\.length"/.test(tpl), '有任何词书就显示「加入 / 移出词书」入口');
assert(/加入 \/ 移出词书/.test(tpl), '按钮文案点明可移出（不只是加入）');
// 2026-10-11：词典 + AI 都没收录的词，以前这里只有一句"先查到释义再加入" ——
// 可这样的词永远查不到释义，也就永远加不进词书（用户："我也无法添加新词"）。
// 现在给一个自己填释义的入口：两个输入框 + 同一颗「加入当前词书」。
assert(/v-if="!found"/.test(tpl), '没有释义时走另一条分支');
assert(/词典和 AI 都没收录这个词/.test(tpl), '说清楚是"词典和 AI 都没收录"（不是"先查到再加入"）');
assert(/v-model="manualPos"[\s\S]{0,400}?v-model="manualMean"/.test(tpl), '给出词性 / 释义两个输入框');
assert(/@tap="addManual"/.test(tpl), '「加入当前词书」在没有释义时改绑 addManual');
assert(/addManual\(\)\s*\{[\s\S]{0,600}?addWordToBook\(/.test(sc), 'addManual 走同一条入库管道');
assert(/addManual\(\)\s*\{[\s\S]{0,900}?this\.load\(\)/.test(sc), '加完重新 load（"暂未收录"变成正经词条）');

assert(/components\/app-dialog/.test(sc), '选词书用全 App 统一的 app-dialog（不用系统弹窗）');
assert(/<app-dialog/.test(tpl) && /@confirm="onDlgConfirm"/.test(tpl), '模板挂载 app-dialog 并接住 confirm');
assert(/:multi="dlg\.multi"/.test(tpl), '弹窗接了 multi 属性（多选形态）');
assert(/mode:\s*'sheet'/.test(sc) && /multi:\s*true/.test(sc), 'pickBook 用 sheet + multi（多选菜单）模式');
assert(!/uni\.showModal|uni\.showActionSheet/.test(sc), '不调用系统弹窗');
// 多选弹窗必须列出全部词书、已收录的预勾选（checked 来自 books 实查结果）
const pickBody = sc.slice(sc.indexOf('pickBook() {'), sc.indexOf('openDlg(patch)'));
assert(/allBooks \|\| \[\]/.test(pickBody), '候选列表来自 allBooks（全部词书都能勾）');
assert(/checked:\s*!!inIds\[b\.id\]/.test(pickBody), '已收录的词书预勾选（checked 来自 books 实查）');
assert(/勾选加入，取消勾选则移出/.test(sc), '弹窗里写明"取消勾选 = 移出"（取消添加的入口）');
// 确认后做 diff：新勾选加入、取消勾选移出
const applyBody = sc.slice(sc.indexOf('applyBookSelection(ids)'), sc.indexOf('doAdd(bookId)'));
assert(/applyBookSelection\(ids\)/.test(sc), '多选确认走 applyBookSelection');
assert(/toAdd/.test(applyBody) && /toRemove/.test(applyBody), '勾选集合与所属集合做 diff（加入 + 移出）');
assert(/wordbook\.removeWordsFromBook\(/.test(applyBody), '取消勾选走 removeWordsFromBook（自定义真删 / 内置记黑名单）');
assert(/search\.addWordToBook\(/.test(applyBody), '新勾选走 search.addWordToBook（同一套去重/id/例句回写）');
assert(/bookWords\((?:id|bookId)\)\.filter/.test(applyBody), '移出前先在书里定位词条 id（不臆造 id）');
assert(/已加入 \{a\} 本，移出 \{b\} 本/.test(sc), '结果 toast 带加/移数量');
assert(/home:refresh/.test(applyBody), '收录关系变化后广播首页刷新');
assert(/allowKnown:\s*true/.test(sc), '入库走 allowKnown（词典已有的词也能收进别的词书）');
assert(/this\.ownExample/.test(sc), '加入时带上该词已有的例句（省掉一次生成请求）');
assert(/r\.added/.test(sc) && /uni\.showToast/.test(sc), '失败时把原因（去重/词形非法）吐出来');
assert(/this\.load\(\)/.test(sc.slice(sc.indexOf('doAdd'))), '加入后重新 load 刷新状态');

/* ---------- 6b. 所属词库每一行都能直接移出 ---------- */
// 用户反馈：详情页只有「加入词书」，在「所属词库」列表里没办法把词移出去。
// 光有多选弹窗里的"取消勾选"不够 —— 想移出时看的就是这张列表，入口得在这儿。
console.log('== 6b. 所属词库直接移出 ==');
assert(/v-for="\(b, i\) in books"/.test(tpl) && /@tap="askRemoveBook\(i\)"/.test(tpl),
  '所属词库每一行都有移出入口（不用绕到弹窗取消勾选）');
assert(/askRemoveBook\(i\)\s*\{/.test(sc), 'askRemoveBook 方法存在');
const askBody = sc.slice(sc.indexOf('askRemoveBook(i) {'), sc.indexOf('removeFromBook(bookId)'));
assert(/mode:\s*'confirm'/.test(askBody), '移出前先确认（不误触）');
assert(/danger:\s*true/.test(askBody), '确认弹窗用危险色（移出会丢收录关系）');
assert(/action:\s*'removeBookOne'/.test(askBody), '确认后走 removeBookOne 派发');
assert(/removeBookOne/.test(sc.slice(sc.indexOf('onDlgConfirm'))), 'onDlgConfirm 处理 removeBookOne（含 pendingBook）');
// 移出逻辑必须只有一份：弹窗取消勾选与列表行移出共用同一条路径
assert(/removeWordFromBook\(bookId\)\s*\{/.test(sc), '移出逻辑抽成 removeWordFromBook');
assert(/toRemove\.forEach\(id => \{ if \(this\.removeWordFromBook\(id\)\)/.test(sc),
  '多选弹窗的移出复用同一个 removeWordFromBook');
assert(/wordbook\.removeWordsFromBook\(bookId, \[hit\.id\]\)/.test(sc), '实际移出走 removeWordsFromBook（自定义真删 / 内置黑名单）');
assert(/已从「\{name\}」移出/.test(sc) && /已经不在该词书里了/.test(sc),
  '移出结果有明确反馈（成功 / 本来就不在）');
assert(/home:refresh/.test(sc.slice(sc.indexOf('removeFromBook(bookId)'))), '移出后广播首页刷新');

// allBooks / books 必须在 load() 里实算，不能是写死的空数组
// 注意用 'load() {' 定位方法体：'load()' 会先命中 onLoad 里的 this.load()
const loadBody = sc.slice(sc.indexOf('load() {'), sc.indexOf('\n    refreshFav()'));
assert(/this\.books\s*=/.test(loadBody), 'load 里填充 books（已收录，供列表展示）');
assert(/this\.allBooks\s*=/.test(loadBody), 'load 里填充 allBooks（弹窗候选项）');
assert(!/otherBooks/.test(sc), '旧的 otherBooks 已清理（多选弹窗只需要 allBooks）');
assert(/const want = String\(this\.word\)\.toLowerCase\(\)/.test(sc),
  '词形比较统一转小写（China 这种首字母大写的不然匹配不上，移出按钮不出现）');

/* ---------- 6c. 移出真的生效（真跑页面方法） ---------- */
// 只断言源码里"调用了 removeWordsFromBook"是不够的 —— 用户抱怨的就是移不出来。
// 这里把页面脚本真加载起来，对着真实词书跑一遍，看词是不是真的消失了。
console.log('== 6c. 移出真的生效 ==');
const wdScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(R(FILE + '.vue')) || [])[1] || '';
const wdToasts = [];
global.uni.showToast = (o) => wdToasts.push(String((o && o.title) || ''));
const wdPage = loadCode(wdScript, {
  // i18n 桩：必须真的填占位符，否则「已从「{name}」移出」里看不到词书名
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
  dict: dictMod,
  wordbook,
  sentenceIndex: sIdx,
  settings: settingsMod,
  sync: {},
  aiCache: { findWord: () => null, sentencesOf: () => [] },
  search: { addWordToBook: () => ({ added: true }) },
  tts: { speak: () => {}, speakSentence: () => {}, stop: () => {} },
  FloatNavbar: {}, AppDialog: {}
}, 'word-detail.vue').default;
const vm = Object.assign({}, wdPage.data(), wdPage.methods);
let reloaded = 0, emitted = 0;
vm.load = () => { reloaded++ };
global.uni.$emit = (ev) => { if (ev === 'home:refresh') emitted++ };

const inBook = wordbook.bookWords('fj_zsb_core');
const victim = inBook[0];
assert(!!victim, '内置词书有词可测（' + inBook.length + ' 个）');
vm.word = String(victim.w).toLowerCase();
vm.books = [{ id: 'fj_zsb_core', name: '福建专升本', current: true }];

wdToasts.length = 0;
assert(vm.removeWordFromBook('fj_zsb_core') === true, 'removeWordFromBook 报告移出成功');
const after = wordbook.bookWords('fj_zsb_core');
assert(!after.some(x => String(x.w).toLowerCase() === vm.word),
  '移出后该词真的不在词书里了（' + vm.word + '，' + inBook.length + ' → ' + after.length + '）');
assert(vm.removeWordFromBook('fj_zsb_core') === false, '重复移出返回 false（幂等，不报假成功）');

wdToasts.length = 0; reloaded = 0; emitted = 0;
vm.removeFromBook('fj_zsb_core');
assert(wdToasts.some(x => /已经不在该词书里了/.test(x)), '第二次点移出提示"已经不在该词书里了"');
assert(reloaded === 1 && emitted === 1, '移出后重载页面并广播首页刷新（load ×' + reloaded + ' / emit ×' + emitted + '）');

// 换一个词走完整成功路径：先把词加进另一本词书，再从那儿移出
const other = wordbook.bookWords('cet4')[0];
if (other) {
  vm.word = String(other.w).toLowerCase();
  vm.books = [{ id: 'cet4', name: '四级', current: false }];
  wdToasts.length = 0; reloaded = 0; emitted = 0;
  vm.removeFromBook('cet4');
  assert(wdToasts.some(x => x.indexOf('四级') >= 0), '移出成功时 toast 带词书名：' + wdToasts[0]);
  assert(!wordbook.bookWords('cet4').some(x => String(x.w).toLowerCase() === vm.word),
    '第二本词书同样真的移出成功（' + vm.word + '）');
  assert(reloaded === 1 && emitted === 1, '成功路径也重载 + 广播刷新');
}

// 所属词库列表必须与移除后的真实状态一致（不能靠前端删数组假装成功）
vm.word = String(victim.w).toLowerCase();
vm.books = [];
vm.allBooks = [];
try {
  wordbook.listBooks().forEach(b => {
    if (wordbook.bookWords(b.id).some(x => String(x.w).toLowerCase() === vm.word)) {
      vm.books.push({ id: b.id, name: b.name, current: !!b.current });
    }
  });
} catch (e) {}
assert(vm.books.every(b => b.id !== 'fj_zsb_core'), '移出后 所属词库 里不再有这本书（实查 bookWords 确认）');

/* ---------- 7. AI 补充的词在详情页要有释义可看、可收 ---------- */
console.log('== 7. AI 缓存词在详情页的表现 ==');
assert(/aiCache\.findWord\(/.test(sc), '详情页从 aiCache 捞 AI 补充的释义');
assert(/info\.src\s*=\s*'ai'/.test(sc), 'AI 词的来源标记为 src=ai');
assert(/'ai'\)\s*return\s*t?\(?'AI 补充'\)?/.test(sc), '来源标签显示「AI 补充」');
assert(/aiCache\.sentencesOf\(/.test(sc), 'AI 缓存的例句也会展示');

console.log('');
console.log(fail === 0 ? '单词详情页全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
