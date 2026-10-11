// _tools/check-word-senses.js - 「词典完整义项表」校验（真跑模块）
//
// 用户原话：「许多单词有一词多义，尽量地把默认单词库都丰富一遍。
//           注意说的是单词库，不是词书。」
//
// 一句话背景：词书共享表的一行 = 一张**背诵卡**，释义只有 20 字上限，
//   所以 light（源表 22 义）这类多义词在界面上永远只看得到前四五个。
//   data/word-senses.js 是按同一套清洗规则另出的一份**不截断**版本，
//   只给查词 / 点读 / 词条页消费。
//
// 这个脚本守住四条边界（少一条就会悄悄退化成另一个东西）：
//   1. 数据本身合法：行数对得上、每行能切出 word|pos|释义
//   2. 长版必须**严格长于**短版，否则就是白占体积
//   3. 只给词典层用 —— **绝不并进** forEachEntry / searchRows，
//      那张平表每条只显示一行，塞长释义进去搜索列表就全变字墙了
//   4. **不产生词书 id** —— 词书那套（lexicon / bookdata / wordbook）
//      一个字都不许读它，否则老用户已背记录会错位且不报错
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  navigateTo: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const SENSES_PATH = path.join(ROOT, 'data', 'word-senses.js');

console.log('== 1. 数据文件与导出契约 ==');
assert(fs.existsSync(SENSES_PATH), 'data/word-senses.js 存在');
const src = fs.readFileSync(SENSES_PATH, 'utf8').replace(/\r\n/g, '\n');
const sensesMod = load('data/word-senses.js');
assert(typeof sensesMod.SENSES_COUNT === 'number', '导出 SENSES_COUNT 是数字');
assert(typeof sensesMod.SENSES_RAW === 'string', '导出 SENSES_RAW 是字符串');

const lines = sensesMod.SENSES_RAW.split('\n').filter((l) => l.trim());
assert(lines.length === sensesMod.SENSES_COUNT,
  'SENSES_COUNT 与实到行数一致（' + sensesMod.SENSES_COUNT + ' / ' + lines.length + '）');
assert(lines.length > 1000, '规模没有萎缩（实际 ' + lines.length + ' 条）');

console.log('\n== 2. 行格式：word|pos|释义 ==');
let badRow = ''
let emptyMean = 0
lines.forEach((l) => {
  const p = l.split('|')
  const w = p[0] || ''
  const m = p.slice(2).join('|')
  if (!/^[a-z][a-z'\-]*$/.test(w)) badRow = badRow || l
  if (!m) emptyMean++
})
assert(!badRow, '所有行的 word 列都是合法小写词形' + (badRow ? '（反例：' + badRow + '）' : ''))
assert(emptyMean === 0, '没有空释义行' + (emptyMean ? '（' + emptyMean + ' 行）' : ''))

// 不允许残留空格：源表「， 」排版已被 build.js 的 dropSpace 清掉，
// 留着空格的义项会过不了 SENSE_OK，等于这条数据白存。
const spaced = lines.filter((l) => /[　\s]/.test(l.split('|').slice(2).join('|')))
assert(spaced.length === 0, '释义里没有残留空格' + (spaced.length ? '（' + spaced[0] + '）' : ''))

console.log('\n== 3. dict 接入：完整义项层 ==')
const lemmaMod = load('utils/lemma.js');
const wordsMod = load('data/words.js');
const commonMod = load('data/common-words.js');
const wbMod = load('data/wordbooks.js');
const storeMod = load('utils/store.js');
const wordbookMod = load('utils/wordbook.js', {
  store: storeMod, WORDS: wordsMod.WORDS, WORDBOOKS: wbMod.WORDBOOKS, getBook: wbMod.getBook
});
const dict = load('utils/dict.js', {
  WORDS: wordsMod.WORDS,
  COMMON_RAW: commonMod.COMMON_RAW,
  store: storeMod,
  lemmaCandidates: lemmaMod.lemmaCandidates,
  lemma: lemmaMod.lemma,
  wordbook: wordbookMod,
  getBook: wbMod.getBook
})
assert(typeof dict.fullSensesOf === 'function', 'dict.fullSensesOf 存在')
assert(typeof dict.fullMeaningOf === 'function', 'dict.fullMeaningOf 存在')
assert(typeof dict.splitSenses === 'function', 'dict.splitSenses 存在')

console.log('\n== 4. splitSenses 的基本口径 ==')
assert(dict.splitSenses('').length === 0, "空串 → []（不是 ['']）")
assert(dict.splitSenses('a；b').join('/') === 'a/b', '全角分号切得开')
assert(dict.splitSenses('a; b').join('/') === 'a/b', '半角分号切得开，且顺手去空格')
assert(dict.splitSenses('  a  ').join('/') === 'a', '两端空白去掉')
assert(dict.splitSenses('苹果').length === 1, '单义项 = 1')

console.log('\n== 5. 抽样：多义词在词典层确实变全了 ==')
// 这些词都是「短版只有两三个义项、源表有十几个」的典型
const poly = ['light', 'hard', 'note', 'present', 'bear', 'bank', 'clear', 'book']
let okCnt = 0
poly.forEach((w) => {
  const lk = dict.lookup(w)
  const shortN = dict.splitSenses(lk.meaning).length
  const fullN = dict.fullSensesOf(w).length
  if (lk.found && fullN >= shortN && fullN > 0) okCnt++
  else bad(w + '：短版 ' + shortN + ' 义 / 长版 ' + fullN + ' 义')
})
assert(okCnt === poly.length, okCnt + '/' + poly.length + ' 个抽样多义词的长版义项 ≥ 短版')

// light 是最夸张的一个（源表 22 义），用它盯住"截断"这件事本身
const lightFull = dict.fullSensesOf('light')
assert(lightFull.length >= 8, 'light 的完整义项 ≥ 8 条（实际 ' + lightFull.length + ' 条）')
assert(dict.splitSenses(dict.lookup('light').meaning).length < lightFull.length,
  'light 的长版严格长于短版（说明补全真的生效了）')

console.log('\n== 6. 未收录的词不许编 ==')
assert(dict.fullSensesOf('zzzzzz').length === 0, '没见过的词 → []')
assert(dict.fullMeaningOf('zzzzzz') === '', '没见过的词 → 空串')
assert(dict.fullSensesOf('').length === 0, '空输入 → []')
assert(dict.fullSensesOf(null).length === 0, 'null → []')

console.log('\n== 7. ★ 不许进检索索引（否则搜索列表变字墙）==')
const rows = dict.searchRows()
assert(rows.length > 0, '检索表非空（' + rows.length + ' 条）')
const leaked = rows.filter((r) => r.src === 'senses')
assert(leaked.length === 0, '检索表里没有 senses 层' + (leaked.length ? '（泄漏 ' + leaked.length + ' 条）' : ''))
const srcSeen = {}
let unexpected = ''
rows.forEach((r) => {
  srcSeen[r.src] = (srcSeen[r.src] || 0) + 1
  if (['core', 'common', 'book', 'extra'].indexOf(r.src) < 0) unexpected = r.src
})
assert(!unexpected, '检索表 src 只有 core/common/book/extra' + (unexpected ? '（出现 ' + unexpected + '）' : ''))
console.log('     ' + JSON.stringify(srcSeen))

// forEachEntry 同样不许带出来
let seenSenses = false
dict.forEachEntry(function (k, w, pos, m, src) {
  if (src === 'senses') seenSenses = true
})
assert(!seenSenses, 'forEachEntry 也不会吐出 senses 层')

console.log('\n== 8. ★ 不许进词书（否则行号位移 = 老用户进度错位）==')
// 词书 id = 共享表行号 + LEX_START。word-senses.js 是**词典层覆盖**，
// 必须真的只是覆盖：谁生成 / 读取词书，谁就不许碰这个文件。
const guards = [
  ['data/lexicon.js', '共享表索引'],
  ['data/wordbooks.js', '词书定义'],
  ['utils/wordbook.js', '词书读取'],
  ['data/bookdata.js', '词书索引（生成产物，只读校验）']
]
guards.forEach(([f, tag]) => {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) { bad(tag + ' 文件不存在 ' + f); return }
  const t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  assert(t.indexOf('word-senses') < 0, tag + '（' + f + '）不读 word-senses.js')
})

// build.js 里生成共享表那条链路（keptRows）必须走 Strict 档
const buildSrc = fs.readFileSync(path.join(__dirname, '..', '_vocab', 'build.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const keptLine = buildSrc.split('\n').filter((l) => /const e = buildEntry\(/.test(l))[0] || ''
assert(/buildEntry\(r\.glosses\)/.test(keptLine),
  '共享表仍走严格档 buildEntry(r.glosses)（实际：' + keptLine.trim() + '）')

console.log('\n== 9. 词典层只覆盖、不新增（词书侧规模零变化）==')
// 词书那几张表的规模是冻结的：这里把数字钉死，
// 以后谁不小心让 senses 参与了词书生成，这条会当场报红。
const lexRaw = fs.readFileSync(path.join(ROOT, 'data', 'lexicon-data.js'), 'utf8').replace(/\r\n/g, '\n')
const mLex = /const LEX_RAW\s*=\s*`([\s\S]*?)`/.exec(lexRaw)
const lexN = (mLex ? mLex[1] : '').split('\n').filter((l) => l.trim()).length
assert(lexN === 3893, '共享表仍是 3893 行（实际 ' + lexN + '）')

console.log('\n== 10. 模板契约：词条页要摆完整义项 ==')
const wdPath = path.join(ROOT, 'pkgManage', 'pages', 'word-detail', 'word-detail.vue')
const wd = fs.readFileSync(wdPath, 'utf8').replace(/\r\n/g, '\n')
const tpl = (/<template>([\s\S]*)<\/template>/.exec(wd) || [])[1] || ''
assert(/class="card sense-card"/.test(tpl), '词条页有「完整义项」卡片')
assert(/v-if="senses\.length > 1"/.test(tpl), '只在真的多义时才显示（单义词不摆）')
assert(/v-for="\(s, i\) in senses"/.test(tpl), '义项逐条列出')
assert(/\{\{ i \+ 1 \}\}/.test(tpl), '义项带序号，方便对照')

console.log('');
console.log(fail === 0 ? '词典完整义项表全部通过' : '失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
