// _tools/check-dict.js - 校验词形还原 + 查词典优先级（只读）
const { load } = require('./lib/load');

// mock uni 存储（store.js 用到）
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const common = load('data/common-words.js');
const storeMod = load('utils/store.js');
const wordbook = load('utils/wordbook.js', { store: storeMod, WORDS: words.WORDS });
const books = load('data/wordbooks.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS,
  COMMON_RAW: common.COMMON_RAW,
  store: storeMod,
  lemmaCandidates: lemma.lemmaCandidates,
  lemma: lemma.lemma,
  wordbook: wordbook,
  getBook: books.getBook
});

let fail = 0;
function assert(cond, msg) {
  if (!cond) { fail++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

console.log('— 词形还原 —');
[
  ['improving', 'improve'],
  ['studies', 'study'],
  ['carried', 'carry'],
  ['children', 'child'],
  ['went', 'go'],
  ['bigger', 'big'],
  ['happier', 'happy'],
  ['quickly', 'quick'],
  ['possibly', 'possible'],
  ['lived', 'live'],
  ['stopped', 'stop'],
  ['running', 'run'],
  ['knives', 'knife'],
  ['is', 'be'],
  ['making', 'make'],
  ['larger', 'large']
].forEach(([w, want]) => {
  const cands = lemma.lemmaCandidates(w);
  assert(cands.indexOf(want) >= 0 || lemma.lemma(w) === want, w + ' → ' + want + '（候选：' + cands.slice(0, 3).join('/') + '）');
});

console.log('— 查词 —');
const cases = [
  ['improve', 'core'],
  ['is', 'common'],
  ['the', 'common'],
  ['improving', 'core'],
  ['practices', 'core'],
  ['happier', 'common'],
  ['English', 'common'],
  ['zzzzz', 'none']
];
cases.forEach(([w, src]) => {
  const r = dict.lookup(w);
  assert(r.src === src, w + ' → ' + src + '（实际 ' + r.src + '，释义：' + (r.meaning || '-') + '）');
});

// 用户导入词应能被命中
const st = storeMod.get();
// 用一个确定不在核心词书里的词，验证导入词优先级
st.customWords = { custom_inbox: [{ word: 'gumption', pos: 'n.', meaning: '进取心；魄力' }] };
storeMod.save(st);
dict.invalidateCache();
const r2 = dict.lookup('gumption');
assert(r2.src === 'custom' && r2.meaning === '进取心；魄力', '导入词 gumption → custom（实际 ' + r2.src + '）');

console.log('— 常用词典规模 —');
console.log('  词条数：' + common.COMMON_RAW.length);
const dupCheck = {};
let dup = 0;
common.COMMON_RAW.forEach(line => {
  const k = line.split('|')[0].toLowerCase();
  if (dupCheck[k]) { dup++; console.error('  ✗ 重复词条：' + k); }
  dupCheck[k] = 1;
  if (line.split('|').length < 3) { fail++; console.error('  ✗ 格式错误：' + line); }
});
assert(dup === 0, '无重复词条');

console.log('— 点读弹窗的归属标签 ownerLabel —');
// 口径：词在「我正在背的那本书」里 → 返回书名；不在 → ''（调用方整行不渲染）。
// 这跟 lookup().src 是两回事（src 说的是"这次释义命中哪一层"），别混。
{
  const bid = wordbook.currentBookId();
  const bookName = (books.getBook(bid) || {}).name || '';
  assert(!!bid && !!bookName, '拿得到当前词书与书名（' + bid + ' / ' + bookName + '）');

  const inBook = wordbook.bookWords(bid);
  assert(inBook.length > 0, '当前词书里有词（' + inBook.length + ' 条）');
  const sample = inBook.slice(0, 5);
  sample.forEach((w) => {
    const label = dict.ownerLabel(w.w, bid);
    assert(label === bookName, '书里的词 ' + w.w + ' → 显示「' + bookName + '」（实际 ' + JSON.stringify(label) + '）');
  });

  assert(dict.ownerLabel('zzzznope', bid) === '', '不在书里的词 → 空串（整行不显示）');
  assert(dict.ownerLabel('the', bid) === '', '超高频虚词不在词书里 → 也不显示');
  assert(dict.ownerLabel('improve', 'NO_SUCH_BOOK') === '', '词书 id 不存在 → 空串（不能崩、更不能乱写个名字）');

  // 屈折形态要能归位：点到的常常是句子里的 improving / went
  const inflected = dict.ownerLabel('improving', bid);
  assert(inflected === bookName || inflected === '',
    '屈折形态走词形还原（improving → ' + JSON.stringify(inflected) + '，与 improve 同判）');

  assert(dict.ownerLabel('', bid) === '' && dict.ownerLabel(null, bid) === '',
    '空输入 → 空串');

  // 换书：标签要跟着"我在背什么"走，而不是跟着"词义命中哪一层"走
  const sw = wordbook.listBooks().filter((b) => b.id && b.id !== bid)[0];
  if (sw) {
    const before = dict.ownerLabel(sample[0].w, bid);
    wordbook.switchBook(sw.id);
    const after = dict.ownerLabel(sample[0].w, sw.id);
    assert(before === bookName, '换书前：' + sample[0].w + ' 属于「' + bookName + '」');
    // 同一个词在另一本书里可能也有，也可能没有 —— 只要求"跟着当前书走、不串到别的名字上"
    assert(after === '' || after === sw.name,
      '换到「' + sw.name + '」后：标签跟着当前书走（' + JSON.stringify(after) + '）');
    wordbook.switchBook(bid);
  }
}

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
