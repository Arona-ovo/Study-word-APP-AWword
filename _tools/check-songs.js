// _tools/check-songs.js - 校验「今日歌曲」卡（真实模块 + 真实组件 + 只读源码）
// 运行：node _tools/check-songs.js
//
// 这个功能最怕两件事，本脚本主要盯这两件：
//  1) 推荐出一首**不存在的歌** —— 所以歌名表是内置的，且不许为空、不许有脏行；
//     匹配与推荐全是确定性纯函数，同一天必须得到同一批（否则"今日歌曲"名不副实）。
//  2) 越权 —— 播放 / 歌词 / 封面各有各的权利人，这张卡只许给「歌名 + 演唱者」。
//     第 6 组专门扫这件事，加了音频能力会直接红。
//
// 覆盖：
//  1) 歌名表：格式、非空、无重复、规模、无中文歌名
//  2) 匹配：精确 / 包含 / 虚词不命中 / 复数还原 / 返回值是副本（索引不许被污染）
//  3) 推荐确定性：同 seed 同结果、换批换结果、一词一首、一歌一次
//  4) 池子小的时候凑得满（放宽"一词一首"，但歌仍不重复）
//  5) 组件：已学词优先、空了兜底全书、跨天重置批次、换一批、复制、生命周期
//  6) 版权边界：不许出现播放 / 歌词 / 封面
//  7) 接入：home-layout 注册、home.vue 三处、i18n 译文齐全

const fs = require('fs');
const path = require('path');
const { load, loadCode } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FILE = 'data/song-links.js';
const WIDGET = 'components/home-widgets/widget-songs.vue';

/* ---------------- mock ---------------- */
const mem = {};
let toasts = [];
let copied = null;
let onCalls = [];
let offCalls = [];
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => { toasts.push(String((o && o.title) || '')); },
  setClipboardData: (o) => { copied = o && o.data; if (o && o.success) o.success(); },
  $on: (ev) => { onCalls.push(ev); },
  $off: (ev, fn) => { offCalls.push(ev); }
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

/* ---------------- 真实模块 ---------------- */
const songs = load(FILE);
const src = R(FILE);
const tplSrc = R(WIDGET);
const widgetSrc = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(tplSrc) || [])[1] || '';
const tpl = (/<template>([\s\S]*)<\/template>/.exec(tplSrc) || [])[1] || '';

// 组件是 <script lang="ts">，loadCode 走的是纯 JS 解释器，见 `x as T` / `(n: number)` 就崩。
// 这里只剥这类类型标注（白名单：几个基础类型 + Array<T>），不碰对象字面量的值 ——
// 用"只删后面跟类型名"的规则，才不会把 { song: s.song } 里的值一起吃掉。
function deTs(s) {
  return s
    .replace(/\s+as\s+[A-Za-z_$][\w$]*(?:<[^<>]*>)?/g, '')
    .replace(/:\s*(?:any|string|number|boolean)\[\]/g, '')
    .replace(/:\s*(?:any|string|number|boolean)(?=[,)\s}=;])/g, '')
    .replace(/:\s*Array<[^<>]*>/g, '');
}
const widgetJs = deTs(widgetSrc);

/* ---------- 1. 歌名表 ---------- */
console.log('== 1. 歌名表 ==');
const raw = songs.SONG_RAW || [];
assert(Array.isArray(raw) && raw.length > 300, '表里歌曲数 = ' + raw.length + '（低于 300 多半是被误删了）');

let badLine = '';
let noArtist = 0;
let cjkSong = 0;
const dup = {};
let dupCount = 0;
raw.forEach((line) => {
  const i = String(line).indexOf('|');
  if (i <= 0) { badLine = badLine || String(line); return; }
  const song = String(line).slice(0, i).trim();
  const artist = String(line).slice(i + 1).trim();
  if (!song || !artist) noArtist++;
  if (/[\u4e00-\u9fa5]/.test(song)) cjkSong++;
  const k = song.toLowerCase() + '|' + artist.toLowerCase();
  if (dup[k]) dupCount++;
  dup[k] = true;
});
eq(badLine, '', '每行都有 "歌名|演唱者" 分隔符');
eq(noArtist, 0, '歌名与演唱者都非空的行数异常计数');
eq(cjkSong, 0, '中文歌名数（这张表只收英文歌名）');
eq(dupCount, 0, '完全重复（同歌名 + 同演唱者）的行数');
// 同名不同歌手是允许的（Dreams 有 Cranberries 和 Fleetwood Mac 两版），但要真的能区分
const bySong = {};
raw.forEach((line) => {
  const i = String(line).indexOf('|');
  const s = String(line).slice(0, i).trim().toLowerCase();
  (bySong[s] = bySong[s] || []).push(String(line).slice(i + 1).trim());
});
const sharedNames = Object.keys(bySong).filter((s) => bySong[s].length > 1);
assert(sharedNames.length > 0 && sharedNames.every((s) => {
  const artists = bySong[s];
  return new Set(artists.map((a) => a.toLowerCase())).size === artists.length;
}), '同名歌（' + sharedNames.length + ' 组）演唱者都不同，不会被当成重复行');

/* ---------- 2. 匹配 ---------- */
console.log('== 2. 匹配 ==');
const find = (w, song) => songs.matchFor(w).filter((x) => x.song === song)[0];
assert(find('yesterday', 'Yesterday') && find('yesterday', 'Yesterday').kind === 'exact',
  'yesterday → Yesterday（The Beatles）判为 exact');
assert(find('money', 'Money') && find('money', 'Money').kind === 'exact',
  'money → Money（Pink Floyd）判为 exact');
assert(find('thunder', 'Thunder') && find('thunder', 'Thunder').kind === 'exact',
  'thunder → Thunder（Imagine Dragons）判为 exact');
assert(!!find('take', 'Take On Me') && find('take', 'Take On Me').kind === 'in',
  'take → Take On Me（a-ha）判为 in（词出现在歌名里）');
eq(songs.matchFor('the').length, 0, '虚词 the 不命中（否则每首歌都算命中）');
eq(songs.matchFor('and').length, 0, '虚词 and 不命中');
eq(songs.matchFor('of').length, 0, '虚词 of 不命中');
eq(songs.matchFor('as').length, 0, '两个字母的词不命中（太短，匹配噪音）');
eq(songs.matchFor('').length, 0, '空词不命中');
eq(songs.matchFor(null).length, 0, 'null 不命中（不抛异常）');
// 歌名是复数、用户背的是单数 —— 还原不到就等于这个词的歌永远推不出来
assert(songs.matchFor('dream').some((x) => x.song === 'Dreams'),
  '单数 dream 能匹配到复数歌名 Dreams（词形还原生效）');
assert(songs.matchFor('tear').some((x) => x.song === 'Tears in Heaven'),
  '单数 tear 能匹配到 Tears in Heaven');
eq(songs.hasSong('yesterday'), true, 'hasSong(yesterday)');
eq(songs.hasSong('zzzzzz'), false, 'hasSong(不存在的词)');

// 返回值必须是副本：索引是共享的，谁改了一处后面全错
const first = songs.matchFor('money');
first.length = 0;
first.push({ song: '污染', artist: '污染', kind: 'exact' });
assert(!songs.matchFor('money').some((x) => x.song === '污染'),
  '改掉 matchFor 的返回值不影响下一次匹配（返回的是副本）');

/* ---------- 3. 推荐：确定性与不重复 ---------- */
console.log('== 3. 推荐：确定性与不重复 ==');
const lexSrc = R('data/lexicon-data.js');
const lexM = /export const LEX_RAW = `([\s\S]*?)`/.exec(lexSrc) || [];
const bookWords = (lexM[1] || '')
  .split('\n')
  .filter((l) => l.indexOf('|') > 0)
  .map((l) => {
    const p = l.split('|');
    return { w: p[0].trim(), m: (p[2] || '').trim(), status: 'mastered' };
  });
assert(bookWords.length > 1000, '词书取到 ' + bookWords.length + ' 个词（够做池子）');

const a1 = JSON.stringify(songs.recommend(bookWords, 3, '2026-10-14'));
const a2 = JSON.stringify(songs.recommend(bookWords, 3, '2026-10-14'));
eq(a1 === a2, true, '同一天同一 seed → 同一批（"今日歌曲"才成立）');
const b1 = JSON.stringify(songs.recommend(bookWords, 3, '2026-10-14#1'));
assert(a1 !== b1, '换一批（offset+1）后结果变了（刷新按钮不是摆设）');

// 30 天里每天的推荐不能都长一样，否则"每天推荐"等于没做
const seen = {};
for (let d = 1; d <= 30; d++) {
  seen[JSON.stringify(songs.recommend(bookWords, 3, '2026-10-' + d))] = true;
}
assert(Object.keys(seen).length >= 20,
  '30 天里出现 ' + Object.keys(seen).length + ' 种不同推荐（≥20，说明真的每天换）');

const picked = songs.recommend(bookWords, 3, '2026-11-01');
eq(picked.length, 3, '要 3 首给 3 首');
eq(new Set(picked.map((x) => x.song + '|' + x.artist)).size, picked.length, '同一首歌不重复出现');
// 「一个词只出一首」只在池子够大时成立（池子小会放宽，见第 4 组）。
// 只测单个 seed 会漏：洗牌后恰好三个词互不相同的话，去掉去重也照样绿 ——
// 所以这里跑 20 个 seed，只要有一次同词出两首就算破。
let dupWord = 0;
let dupSong = 0;
for (let i = 0; i < 50; i++) {
  const p = songs.recommend(bookWords, 3, 'seed-' + i);
  if (new Set(p.map((x) => x.word)).size !== p.length) dupWord++;
  if (new Set(p.map((x) => x.song + '|' + x.artist)).size !== p.length) dupSong++;
}
eq(dupWord, 0, '50 个 seed 里都没有「同一个词占两首」');
eq(dupSong, 0, '50 个 seed 里都没有「同一首歌出现两次」');
assert(picked.every((x) => x.song && x.artist && x.word), '每条推荐三样都有（词 / 歌名 / 演唱者）');
assert(picked.every((x) => x.kind === 'exact' || x.kind === 'in'), 'kind 只有 exact / in 两种');
eq(JSON.stringify(songs.recommend([], 3, 'x')), '[]', '空词表返回空（不硬凑）');
eq(JSON.stringify(songs.recommend([{ w: 'zzzzz' }], 3, 'x')), '[]', '配不上的词返回空');

/* ---------- 4. 池子小也凑得满 ---------- */
console.log('== 4. 池子小也凑得满 ==');
const tiny = songs.recommend([{ w: 'dream', m: '梦' }], 3, 'x');
assert(tiny.length >= 2,
  '只给一个词也能出 ' + tiny.length + ' 首（放宽"一词一首"，但歌仍不重复）');
eq(new Set(tiny.map((x) => x.song + '|' + x.artist)).size, tiny.length, '放宽后歌依然不重复');
assert(tiny.every((x) => x.word === 'dream'), '放宽出来的仍围绕同一个词（不是乱抓别的词）');
const one = songs.recommend([{ w: 'money', m: '钱' }], 1, 'x');
eq(one.length, 1, '要 1 首就给 1 首');

/* ---------- 5. 组件行为 ---------- */
console.log('== 5. 组件行为 ==');
// 词表桩：前两个是「没学过但配得上歌」，后面几个是「学过且配得上」
let vocab = {
  list: [
    { w: 'yesterday', m: '昨天', status: 'new' },
    { w: 'money', m: '钱', status: 'new' },
    { w: 'heaven', m: '天堂', status: 'mastered' },
    { w: 'thunder', m: '雷', status: 'learning' },
    { w: 'mirror', m: '镜子', status: 'familiar' },
    { w: 'shower', m: '淋浴', status: 'mastered' }
  ]
};
let bookVocabCalls = [];
const wordbookStub = {
  bookVocab: () => { bookVocabCalls.push(1); return vocab; }
};
const tStub = (s) => String(s);
let spoken = [];
const Def = loadCode(widgetJs, {
  t: tStub,
  wordbook: wordbookStub,
  songLinks: songs,
  speakWord: (w) => spoken.push(w)
}, 'widget-songs.vue').default;

const mk = () => Object.assign({}, Def.data(), Def.methods);
let vm = mk();
vm.refresh();
assert(bookVocabCalls.length === 1, 'refresh 读了当前词书（bookVocab 调用 1 次）');
eq(vm.list.length, 3, '卡片出 3 首');
assert(vm.list.every((x) => x.word !== 'yesterday' && x.word !== 'money'),
  '只从「已学过的词」里挑（没学过的 yesterday / money 不出现）');
assert(vm.list.every((x) => x.mean), '每条都带上了词的释义（不然用户不知道这个词的歌凭什么是它）');

// 已学词一个都配不上 → 退回整本书，卡片不能开天窗
vocab = {
  list: [
    { w: 'yesterday', m: '昨天', status: 'new' },
    { w: 'money', m: '钱', status: 'new' }
  ]
};
vm = mk();
vm.refresh();
assert(vm.list.length > 0 && vm.list.every((x) => x.word === 'yesterday' || x.word === 'money'),
  '已学词为空时退回整本词书（卡片不会开天窗）');

// 已学词有，但配不上歌；全书里别的词配得上
vocab = {
  list: [
    { w: 'zzzzz', m: '没有这个词', status: 'mastered' },
    { w: 'thunder', m: '雷', status: 'new' }
  ]
};
vm = mk();
vm.refresh();
assert(vm.list.length > 0 && vm.list[0].word === 'thunder',
  '已学词配不上歌时，兜底到整本词书（' + JSON.stringify(vm.list.map((x) => x.word)) + '）');

// 一本词书整体都配不上 → 空态，不硬凑
vocab = { list: [{ w: 'zzzzz', m: 'x', status: 'mastered' }] };
vm = mk();
vm.refresh();
eq(vm.list.length, 0, '整本都配不上时是空态（不编歌名凑数）');
assert(/sg-empty/.test(tpl), '模板有空态分支');

// 生命周期
vm = mk();
onCalls = []; offCalls = [];
vm.created ? vm.created() : Def.created.call(vm);
assert(onCalls.indexOf('home:refresh') >= 0, '订阅 home:refresh（学完新词回来能重算）');
Def.beforeDestroy.call(vm);
assert(offCalls.indexOf('home:refresh') >= 0, '退订 home:refresh（tab 页常驻，不解绑会重复订阅）');

// 跨天重置批次
vocab = { list: bookWords.slice(0, 200) };
vm = mk();
vm.refresh();
const day1 = JSON.stringify(vm.list);
vm.day = '2000-01-01';
vm.offset = 5;
vm.refresh();
eq(vm.offset, 0, '跨天后刷新批次归零（新的一天就是新的一批）');

// 换一批真的换（用整本词书：池子小的时候怎么刷都是那几首，测不出"换"）
vocab = { list: bookWords };
vm = mk();
vm.refresh();
const batch0 = JSON.stringify(vm.list);
toasts = [];
vm.nextBatch();
assert(JSON.stringify(vm.list) !== batch0, '点「换一批」真的换了内容');
eq(vm.offset, 1, '换一批后 offset = 1');
eq(toasts.length, 0, '大池子下换一批不弹提示');

// 池子太小，怎么刷都一样 → 要提示，且 offset 退回（不然每次点都白点）
vocab = { list: [{ w: 'money', m: '钱', status: 'mastered' }] };
vm = mk();
vm.refresh();
const before = JSON.stringify(vm.list);
toasts = [];
vm.nextBatch();
eq(vm.offset, 0, '刷不出新歌时 offset 退回原位（不然下次还得白点一次）');
assert(toasts.length === 1 && /多背点词/.test(toasts[0]),
  '刷不出新歌时给出人话提示：' + JSON.stringify(toasts[0]));

// 复制
vocab = { list: bookWords.slice(0, 200) };
vm = mk();
vm.refresh();
copied = null;
toasts = [];
vm.copySong(vm.list[0]);
assert(copied && copied.indexOf(vm.list[0].song) === 0 && copied.indexOf(vm.list[0].artist) > 0,
  '点歌曲复制的是「歌名 + 演唱者」：' + JSON.stringify(copied));
assert(toasts.length === 1 && /复制/.test(toasts[0]), '复制后有 toast 反馈：' + JSON.stringify(toasts[0]));
copied = null;
vm.copySong({});
eq(copied, null, '空条目不复制（不往剪贴板塞空字符串）');
// 点词朗读
spoken = [];
vm.say('heaven');
eq(spoken.join(','), 'heaven', '点词朗读走 speakWord');
assert(/@tap\.stop="say\(it\.word\)"/.test(tpl), '朗读与复制分层：点词不会顺带触发复制');

/* ---------- 6. 版权边界 ---------- */
console.log('== 6. 版权边界（只给歌名，不播放 / 不给歌词 / 不给封面）==');
// 扫之前先剥注释：组件头部的说明里就写着"不给歌词""不给封面"这几个字，
// 不剥的话这条断言永远绿 —— 它测的是注释，不是代码。
function noComments(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}
const code = noComments(widgetSrc);
assert(!/createInnerAudioContext|InnerAudioContext|backgroundAudioManager|BackgroundAudioManager/.test(code + tpl),
  '组件里没有任何音频播放接口');
assert(!/createVideoContext|uni\.playVoice|plus\.audio/.test(code + tpl), '组件里没有其它播放通道');
assert(!/歌词|lyric|Lyric/.test(code + tpl), '组件里没有歌词');
assert(!/封面|cover|Cover|albumArt/.test(code + tpl), '组件里没有封面 / 专辑图');
assert(!/<image/.test(tpl), '卡片里没有 <image>（不显示任何图，避免封面）');
assert(/不播放/.test(widgetSrc), '底部说明写明了「不播放」（这条说明本身就是边界的一部分）');
assert(/services\/voice\.js/.test(code), '点词朗读仍走 voice（朗读单词与播放歌曲是两回事）');
// 注释里必须留着这条边界说明 —— 下一个人加"顺手播一下"之前得先看见它
assert(/版权|不播放|不要.*播放/.test(widgetSrc), '组件里写明了版权边界（防止后人顺手加播放）');
assert(/版权|录音制作者权|表演者权/.test(R(FILE)), '歌名表头部写明了版权边界');

/* ---------- 7. 接入 ---------- */
console.log('== 7. 接入 ==');
const layoutSrc = R('utils/home-layout.ts');
const homeSrc = R('pages/home/home.vue');
assert(/id:\s*'songs'/.test(layoutSrc), 'home-layout 注册了 songs 模块');
assert(/def:\s*true/.test(layoutSrc.slice(layoutSrc.indexOf("id: 'songs'"), layoutSrc.indexOf("id: 'songs'") + 200)),
  '默认就在首页（用户不用自己去收纳区翻）');
assert(/import WidgetSongs from '\.\.\/\.\.\/components\/home-widgets\/widget-songs\.vue'/.test(homeSrc),
  'home.vue 导入了组件');
assert(/WidgetSongs,/.test(homeSrc), 'home.vue 注册了组件');
assert(/c\.type === 'songs'/.test(homeSrc) && /<widget-songs \/>/.test(homeSrc),
  'home.vue 有 songs 的渲染分支');

/* ---------- 8. i18n ---------- */
console.log('== 8. 英文文案 ==');
const enTable = load('utils/i18n-en.js').default || {};
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const keys = [];
const re = /\$?\bt\(\s*'([^']+)'/g;
let m;
const scan = widgetSrc + '\n' + tpl;
while ((m = re.exec(scan))) keys.push(m[1]);
const uniq = keys.filter((k, i) => keys.indexOf(k) === i);
assert(uniq.length >= 6, '卡片里有 ' + uniq.length + ' 条待翻译文案');
const missing = uniq.filter((k) => !(norm(k) in enTable));
eq(missing.length, 0, '未翻译文案：' + JSON.stringify(missing));
// 模块名 / 说明是「添加组件」面板上的文案，同样是界面文字
const songMod = /id:\s*'songs',\s*name:\s*'([^']+)',\s*desc:\s*'([^']+)'/.exec(layoutSrc);
assert(!!songMod, '能从注册表里读出 songs 的 name / desc');
if (songMod) {
  assert(norm(songMod[1]) in enTable, '模块名有译文：' + songMod[1]);
  assert(norm(songMod[2]) in enTable, '模块说明有译文');
}

console.log('');
console.log(fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过');
process.exit(fail ? 1 : 0);
