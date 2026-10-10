// _tools/check-word-pop.js - 四个「点读弹窗」的两条用户可见契约（只读）
//
// 背景（用户实测反馈，截图是翻译练习页的弹窗）：
//   1) 弹窗底下那行标签写的是「核心词书」—— 那是"这次词义是从哪一层翻出来的"，
//      不是"这个词属不属于我正在背的书"。正在背「福建专升本」的人看着就是串台。
//      现在的口径：词在当前词书里 → 显示那本书的名字；不在 → 整行不显示。
//   2) 点弹窗里的单词毫无反应，用户只会以为界面卡了。
//      现在点单词本身（或「查看词条」）进单词详情页。
//
// 这四个弹窗的标记几乎一模一样（只是前缀不同：practice/word-drill 各自带前缀，
// sentence-detail/wrong-detail 共用 .pop-*），所以用同一组断言扫四遍 ——
// 以后再加第五个点读弹窗，把它加进 FILES 就会一起被守住。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const FILES = {
  '翻译练习': 'pkgStudy/pages/practice/practice.vue',
  '刷单词': 'pkgStudy/pages/word-drill/word-drill.vue',
  '句子详情': 'pkgStudy/pages/sentence-detail/sentence-detail.vue',
  '错题详情': 'pkgStudy/pages/wrong-detail/wrong-detail.vue'
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

/** 只取 <template> 段：脚本里的注释也会出现同样字样，不能整文件扫 */
function tplOf(src) {
  const m = /<template>([\s\S]*)<\/template>/.exec(src);
  return m ? m[1] : '';
}

Object.keys(FILES).forEach(function (name) {
  const file = FILES[name];
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const tpl = tplOf(src);
  console.log('\n== ' + name + '（' + file + '）');

  // --- 1. 归属标签 ---
  assert(/dict\.ownerLabel\(/.test(src),
    '标签用 dict.ownerLabel（只看"在不在我当前背的词书里"）');
  assert(!/SRC_LABEL\[entry\.src\]/.test(src),
    '不再用 SRC_LABEL[entry.src]（那是"命中哪一层"，会显示成「核心词书」）');
  // 不在书里时标签是空串 → 必须靠 v-if 挡掉，否则会留下一个空气泡
  assert(/class="[^"]*pop-src"[^>]*v-if="pop\.srcLabel"/.test(tpl),
    '标签为空时不渲染（不然留个空胶囊）');

  // --- 2. 点单词进词条页 ---
  assert(/class="[^"]*pop-word"[^>]*@tap="openPopWord"/.test(tpl),
    '点弹窗里的单词 → 进词条页（以前点了毫无反应）');
  assert(/查看词条/.test(tpl), '再多给一个「查看词条」入口（光靠点单词，用户看不出来能点）');
  assert(/openPopWord\(\)\s*\{/.test(src), '有 openPopWord 方法');
  assert(/\/pkgManage\/pages\/word-detail\/word-detail\?w='/.test(src),
    '跳的是单词详情页（w 参数）');
  assert(/encodeURIComponent\(w\)/.test(src), '单词做过 encodeURIComponent');
  assert(/closePop\(\)/.test(src.slice(src.indexOf('openPopWord()'), src.indexOf('openPopWord()') + 400)),
    '跳转前先关弹窗（返回时别还挂着）');
});

// --- 3. 「再听一次」与「查看词条」并排，得有一层容器给行距 ---
console.log('\n== 药丸并排（.pop-actions）');
['pkgStudy/pages/practice/practice.vue',
  'pkgStudy/pages/sentence-detail/sentence-detail.vue',
  'pkgStudy/pages/wrong-detail/wrong-detail.vue'].forEach(function (f) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
  const tpl = tplOf(src);
  assert(/<view class="pop-actions">/.test(tpl), f.split('/').pop() + ' 两颗药丸有 .pop-actions 容器');
  assert(/\.pop-actions\s*\{[\s\S]{0,120}?display:\s*flex/.test(src), f.split('/').pop() + ' .pop-actions 横向排列');
  assert(/\.pop-actions\s+\.pop-replay\s*\{[^}]*margin-top:\s*0/.test(src),
    f.split('/').pop() + ' 容器里那颗药丸不再自带 margin-top（否则两颗会错位）');
});
// 刷单词页用的是自己的前缀
const drill = fs.readFileSync(path.join(ROOT, FILES['刷单词']), 'utf8').replace(/\r\n/g, '\n');
assert(/<view class="wd-pop-actions">/.test(tplOf(drill)), '刷单词页有 .wd-pop-actions 容器');
assert(/\.wd-pop-actions\s*\{[\s\S]{0,120}?display:\s*flex/.test(drill), '刷单词页 .wd-pop-actions 横向排列');

console.log('');
console.log(fail === 0 ? '点读弹窗契约全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
