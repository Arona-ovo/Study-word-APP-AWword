// _tools/check-quiz-plan.js - 抽测的"出题计划"（utils/quiz-plan.js）
//
// 用户改的口径：抽测不再是"单词抽认"，而是**用一组目标词造一句通顺的话让用户翻译**。
// 于是本地要守四件事（对应需求里的 1/2/4/5 条）：
//   1. 一组 2~4 个词、今天背过的优先、句子长度随水平档位走
//   2. 模型凑不进去的词要**退回队列**，不白考
//   4. 写错的词下一题就回来，答对的词让出题位
//   5. 同一个词组合短期内不重复出
const { load } = require('./lib/load');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}
function assert(cond, label) { if (cond) ok(label); else bad(label); }

const qp = load('utils/quiz-plan.js');
const TODAY = '2026-10-11';

console.log('== 1. 题数夹取（读不出数字用默认，越界夹到 3~12）==');
eq(qp.planSize(0), qp.QUIZ_DEF, '不给数字 → 默认题数');
eq(qp.planSize('x'), qp.QUIZ_DEF, '读不出数字 → 默认题数');
eq(qp.planSize(2), qp.QUIZ_MIN, '太少 → 夹到下限');
eq(qp.planSize(99), qp.QUIZ_MAX, '太多 → 夹到上限');
eq(qp.planSize(5), 5, '正常值原样通过');

console.log('== 2. 词池优先级：今天背过的 > 不熟的 > 到期的 > 已掌握的老词 ==');
const words = [
  { id: 'a', w: 'alpha', pos: 'n.', m: '甲' },
  { id: 'b', w: 'bravo', pos: 'v.', m: '乙' },
  { id: 'c', w: 'charlie', pos: 'adj.', m: '丙' },
  { id: 'd', w: 'delta', pos: 'n.', m: '丁' }
];
const mastery = {
  a: { m: 5, seen: 9, correct: 9, fs: '2026-01-01', st: 4, due: '' },      // 早就掌握
  b: { m: 0, seen: 1, correct: 0, fs: TODAY, st: 0, due: TODAY },          // 今天刚背 + 最不熟
  c: { m: 1, seen: 2, correct: 1, fs: '2026-09-01', st: 1, due: '2026-11-01' },
  d: { m: 3, seen: 5, correct: 4, fs: '2026-08-01', st: 2, due: '2026-10-05' } // 已过期该巩固
};
const pool = qp.buildPool(words, mastery, TODAY, 4);
eq(pool.length, 4, '词池长度');
eq(pool[0].w, 'bravo', '今天刚背 + 最不熟的排第一（"用今天已背的单词"）');
eq(pool[pool.length - 1].w, 'alpha', '已掌握的老词排最后');
assert(pool.every(x => x.w && x.m), '每个词都带词形 + 释义');
assert(pool[0].pri > pool[pool.length - 1].pri, '优先级分降序：' + pool.map(x => x.w + ':' + x.pri).join(' > '));
eq(qp.priority(null, TODAY), 36, '没记录的词按"最不熟"给分（新词也该被考到）');
assert(qp.priority(mastery.d, TODAY) > 0, '到期该巩固的词有加权');

console.log('== 3. 一组 2~4 个词，且尽量不重词性 ==');
const plan = qp.createPlan(pool, { total: 3 });
const b1 = qp.nextBatch(plan);
assert(!!b1 && b1.words.length >= qp.BATCH_MIN, '第一题至少 2 个词（不是单词抽认）：'
  + JSON.stringify(b1 && b1.words.map(w => w.w)));
eq(b1.words.length, qp.BATCH_MIN, '档位 0（刚开局）一题 2 个词 —— 先短后长');
eq(b1.limit, qp.LEN_BY_TIER[0], '句长上限取档位 0 的值');
const posSet = {};
b1.words.forEach(w => { posSet[w.pos] = true });
assert(Object.keys(posSet).length >= 2, '一组里词性不单一（否则凑不出通顺句子）：'
  + JSON.stringify(b1.words.map(w => w.pos)));
eq(plan.step, 1, '出过一题 step=1');
assert(b1.words.every(w => w.w && w.m), '出题指令里每个词都带释义（模型不瞎编）');

console.log('== 4. 难度递进：档位越高，词越多、句越长 ==');
const plan2 = qp.createPlan(pool, { total: 6 });
qp.nextBatch(plan2);
plan2.tier = 2;
const b2 = qp.nextBatch(plan2);
eq(b2.words.length, 3, '档位 2 → 一题 3 个词');
plan2.tier = 4;
const b3 = qp.nextBatch(plan2);
eq(b3.words.length, qp.BATCH_MAX, '档位 4 → 一题 4 个词');
assert(b3.limit > b2.limit, '句子也一档比一档长：' + b2.limit + ' → ' + b3.limit);
eq(b3.level, 5, '水平档位一起传下去（模型据此控难度）');

console.log('== 5. 题出完 → null（页面据此收尾）==');
// 注意 planSize 会把 2 夹到 QUIZ_MIN=3，所以这里按 3 题走
const plan3 = qp.createPlan(pool, { total: 3 });
qp.nextBatch(plan3);
qp.nextBatch(plan3);
qp.nextBatch(plan3);
eq(qp.nextBatch(plan3), null, '题数用完 → null');
eq(plan3.step, 3, 'step 停在计划题数上');

console.log('== 6. 同一个词组合短期内不重复出 ==');
const big = [];
for (let i = 0; i < 12; i++) {
  big.push({
    id: 'w' + i,
    w: 'word' + i,
    pos: i % 3 === 0 ? 'n.' : (i % 3 === 1 ? 'v.' : 'adj.'),
    m: '释义' + i
  });
}
const plan4 = qp.createPlan(qp.buildPool(big, {}, TODAY, 12), { total: 5 });
const sigs = {};
let dup = 0;
for (let i = 0; i < 5; i++) {
  const b = qp.nextBatch(plan4);
  if (!b) break;
  const sig = qp.sigOf(b.words);
  if (sigs[sig]) dup++;
  sigs[sig] = true;
}
eq(dup, 0, '连着出 5 题，没有两道用同一组词');
eq(qp.sigOf([{ w: 'A' }, { w: 'b' }]), qp.sigOf([{ w: 'b' }, { w: 'a' }]), '签名与顺序无关');

console.log('== 7. 模型凑不进去的词退回队列（不白考）==');
const plan5 = qp.createPlan(pool, { total: 3 });
const bb = qp.nextBatch(plan5);
const dropped = qp.noteUsed(plan5, bb, [bb.words[0].w]);
eq(dropped.length, bb.words.length - 1, '只用一个词 → 其余退回');
eq(bb.used.length, 1, 'batch.used 只记真正用进句子的');
eq(bb.dropped.length, bb.words.length - 1, 'batch.dropped 记下退回的词');
const stBack = plan5.seen[String(bb.words[1].w).toLowerCase()];
eq(stBack.asked, 0, '退回的词不算考过（asked 还是 0）');
eq(stBack.cool, 0, '退回的词冷却清零（下一题优先考）');
const bb2 = qp.nextBatch(plan5);
qp.noteUsed(plan5, bb2, []);
eq(bb2.used.length, bb2.words.length, '模型没给【用词】→ 按"全用上了"兜底（否则同一道题反复出）');

console.log('== 8. 答对 / 答错：复现频率与水平档位 ==');
const plan6 = qp.createPlan(pool, { total: 4 });
const c1 = qp.nextBatch(plan6);
qp.noteUsed(plan6, c1, c1.words.map(w => w.w));
const r1 = qp.noteResult(plan6, c1, true);
eq(r1.hit.length, c1.words.length, '达意 → 用上的词全记 hit');
const rec1 = plan6.seen[String(c1.words[0].w).toLowerCase()];
eq(rec1.hit, 1, 'hit 计数');
eq(rec1.cool, qp.COOL_RIGHT, '答对的词冷却 ' + qp.COOL_RIGHT + ' 题（别占着题位）');
eq(plan6.tier, 1, '达意 → 水平档位 +1（下一句更长）');

const c2 = qp.nextBatch(plan6);
qp.noteUsed(plan6, c2, c2.words.map(w => w.w));
const r2 = qp.noteResult(plan6, c2, false);
eq(r2.miss.length, c2.words.length, '不达意 → 用上的词全记 miss');
const rec2 = plan6.seen[String(c2.words[0].w).toLowerCase()];
eq(rec2.miss >= 1, true, 'miss 计数');
eq(rec2.cool, 0, '写错的词不进冷却（下一题就能回来，复现频率靠 miss 权重）');
eq(qp.COOL_WRONG, 0, 'COOL_WRONG 必须是 0 —— 冷却中的词会被排到最后，那就跟"错词多考"反了');
eq(plan6.tier, 0, '不达意 → 水平档位 -1（下一句更短）');

console.log('== 9. 排序真的会变：错词往前、对的往后 ==');
const plan7 = qp.createPlan(qp.buildPool(big, {}, TODAY, 12), { total: 6 });
const first = qp.nextBatch(plan7);
qp.noteUsed(plan7, first, first.words.map(w => w.w));
qp.noteResult(plan7, first, false);
const wrongWord = first.words[0].w;
const rk = qp.rank(plan7).map(x => x.w);
assert(rk.indexOf(wrongWord) < 2, '刚写错的词排进最前面两位（复现频率提高）：位置 ' + rk.indexOf(wrongWord));

const plan8 = qp.createPlan(qp.buildPool(big, {}, TODAY, 12), { total: 6 });
const e1 = qp.nextBatch(plan8);
qp.noteUsed(plan8, e1, e1.words.map(w => w.w));
qp.noteResult(plan8, e1, true);
const rightWord = e1.words[0].w;
const rk2 = qp.rank(plan8).map(x => x.w);
assert(rk2.indexOf(rightWord) > 0, '答对的词不再排第一（让位给还没考的词）：位置 ' + rk2.indexOf(rightWord));

console.log('== 10. 统计与边界 ==');
const stats = qp.planStats(plan7);
eq(stats.step, 1, 'planStats 报出题数');
eq(stats.total, 6, 'planStats 报计划题数');
assert(stats.weakWords.indexOf(wrongWord) >= 0, 'planStats 列出薄弱词（收尾小结要用）：'
  + JSON.stringify(stats.weakWords));
assert(stats.tier === 0, 'planStats 带水平档位');
eq(qp.nextBatch(qp.createPlan([], { total: 3 })), null, '空池子 → 出不了题（开局时页面就该拦住）');
const tiny = qp.createPlan([{ w: 'only', pos: 'n.', m: '唯一' }], { total: 3 });
eq(qp.nextBatch(tiny), null, '池子只剩 1 个词 → 凑不出 2 个词的题 → 直接收尾（不死循环）');
eq(qp.nextBatch(null), null, '没开局也不炸');
assert(qp.planStats(null).step === 0, 'null 进 planStats 也安全');

console.log('');
console.log(fail === 0 ? '抽测出题计划（分组 / 频次 / 档位 / 退词）全部通过' : '失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
