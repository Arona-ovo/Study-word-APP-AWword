// check-intent-route.js - 指令意图路由：子集合法性、瘦身幅度、安全回退
//                        + 意图关键词表（界面用语 / 英文大小写 / 两张表同步）

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = (rel) => 'file:///' + path.resolve(HERE, '..', 'uniapp', rel).replace(/\\/g, '/');
const pa = await import(P('services/page-agent.js'));
const schema = await import(P('utils/page-schema.js'));
const intent = await import(P('utils/intent.js'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}

// ---------- 1. 无参 / 空子集 = 全量（行为兼容） ----------
console.log('== 1. 全量兼容 ==');
const full = schema.promptManual();
const viaEmpty = schema.promptManual([]);
ok(full === viaEmpty, '空子集等价全量');
ok(schema.COMMAND_OPS.every(op => full.indexOf('- ' + op + '：') >= 0), '全量含全部 ' + schema.COMMAND_OPS.length + ' 条 op');

// ---------- 2. 子集合法性 ----------
console.log('== 2. 子集合法 ==');
const sub = schema.promptManual(['bg.set']);
ok(sub.indexOf('- bg.set：') >= 0, '含目标 op');
ok(sub.indexOf('card.design') < 0, '不带无关 op');
ok(sub.indexOf('preset=') >= 0, 'bg.set 子集含背景说明');
ok(sub.length < full.length * 0.4, '明显瘦身', sub.length + ' vs ' + full.length);

const subDesign = schema.promptManual(['card.design', 'card.add']);
ok(subDesign.indexOf('card.design') >= 0, 'design 子集含 op');
// design spec 的特征行（card-spec.promptSpec 的内容）
const specFull = (await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/utils/card-spec.js')).promptSpec();
const specMarker = specFull.split('\n').find(l => l.trim().length > 10) || '';
ok(specMarker && subDesign.indexOf(specMarker.trim()) >= 0, 'design 子集含设计说明书');

// ---------- 3. 路由判定 ----------
console.log('== 3. 路由判定 ==');
const cases = [
  ['把背景换成海边', true, ['bg.set']],
  ['主题换成深色', true, ['theme.set']],
  ['把第2张卡片删掉', true, ['card.remove']],
  ['把每日目标设成30个词', true, ['goal.set']],
  ['保存一个叫晨间的快照', true, ['skin.save']],
  ['给我做一张今日统计卡', true, ['card.design']],
  ['背景换成森林，顺便把错题卡删了', false, null],   // 复合 → 全量
  ['随便搞点什么', false, null],                        // 无匹配 → 全量
  ['', false, null]
];
cases.forEach(([text, expectSub, mustOps]) => {
  const r = pa.routeOps(text);
  if (!expectSub) {
    ok(r.ops === null, '「' + text + '」→ 全量');
    return;
  }
  const hit = r.ops && mustOps.every(op => r.ops.indexOf(op) >= 0);
  ok(!!hit, '「' + text + '」→ 子集含 ' + mustOps.join(','), r.ops);
});

// ---------- 4. 造卡意图必带 design spec ----------
console.log('== 4. 造卡带说明书 ==');
const r4 = pa.routeOps('给我做一张倒计时卡片');
ok(r4.ops && r4.ops.indexOf('card.design') >= 0, 'ops 含 card.design');
const manual4 = schema.promptManual(r4.ops);
ok(manual4.indexOf(specMarker.trim()) >= 0, '手册含设计说明书');

// ---------- 5. 意图关键词表：界面用语要收得下 ----------
// 「收纳 / 收起来 / 藏起来」是**首页自己界面上的说法**（收纳按钮、收纳区），
// 用户会照着说。以前 VERB_DEL 里只有 删除/隐藏，
// "卡片全收起来" 只命中「页面域」(+2)，够不到 4 分阈值 → 被判成查词。
console.log('== 5. 意图关键词表 ==');
const M = (s) => intent.detect(s).mode;
const cmdCases = [
  '卡片全收起来', '把倒计时卡片收纳起来', '把打卡走势藏起来',
  '去掉主页所有卡片', '把所有卡片都删掉', '隐藏打卡走势'
];
cmdCases.forEach(s => ok(M(s) === 'command', '「' + s + '」→ 指令', M(s)));
// 别把查词误判成指令：这类误判会真的去改首页，代价远大于"该改没改成"
ok(M('apple') === 'search', '「apple」→ 查词');
ok(M('Apple') === 'search', '「Apple」→ 查词');
ok(M('abandon 是什么意思') === 'search', '「…是什么意思」→ 查词');
ok(M('卡片') === 'search', '光说「卡片」→ 查词（不够 4 分）');

// 英文指令：句首大写也要认。
// VERB_* 里混着 'remove' / 'delete' / 'hide' / 'add'，而 hasAny 是大小写敏感的
// indexOf —— 以前 lower 是算出来却没用的死变量，"Hide the chart card" 只能拿 0 分。
['hide the chart card', 'Hide the chart card', 'Remove all cards', 'Add a countdown card', 'Delete the note']
  .forEach(s => ok(M(s) === 'command', '英文「' + s + '」→ 指令（大小写不敏感）', M(s)));

// ---------- 6. intent 与 ROUTE_RULES 关键词同步 ----------
// 两张表不同步 = "判成指令，但手册里没给它该用的 op"，
// 「去掉主页所有卡片」那个 bug 正是这么来的（手册说只有 style.* 能用 all，
// 而删除路由出的 op 组里根本没有 style.*）。
console.log('== 6. 两张关键词表同步 ==');
['收纳', '收起来', '藏起来', '去掉', '隐藏', '删除', '移除'].forEach(k => {
  const s = '把这张卡片' + k;
  const r = pa.routeOps(s);
  ok(M(s) === 'command', '「' + k + '」intent 判为指令', M(s));
  ok(r.ops && r.ops.indexOf('card.hide') >= 0, '「' + k + '」routeOps 出 card.hide', r.ops);
});
// 英文指令拿不到中文关键词 → 回退全量，绝不因为猜错而"这个改不了"
ok(pa.routeOps('Remove all cards').ops === null, '英文指令回退全量（不猜子集）');

// ---------- 7. 调参式 / 开关式 / 朗读式说法必须判成指令 ----------
// 2026-10-10 用户反馈"很多问题回答不了"，压测 66 条真实口语后发现一大类根因：
// 「背景模糊一点」「字太小了」「换回晨间那套」这些**没有变更动词**的说法
// 只拿到「页面域」2 分，够不到阈值 → 被当查词 → 用户看到"没找到这个词"。
console.log('== 7. 调参 / 开关 / 朗读说法 ==');
[
  '换个海边风格的背景', '背景太花了，素一点', '界面紧凑一点', '动效关掉',
  '背景模糊一点', '背景蒙版调亮一点', '字太小了看不清', '每天练50题',
  '把现在这套存成晨间', '换回晨间那套', '把「今天也要加油」读出来'
].forEach(s => ok(M(s) === 'command', '「' + s + '」→ 指令', M(s) + '/' + intent.detect(s).score + ' ' + intent.detect(s).why));

// ---------- 8. 学习数据问答走 AI；寒暄与查词别被误伤 ----------
// 这类问题没有任何 op 能表达，但模型手里有 docDigest 的【真实学习数据】，能直接答。
// 判定口径：学习域(+3) + 疑问句式(+2) 才够线 —— 两边单独出现都不该变成指令。
console.log('== 8. 学习问答 vs 误伤 ==');
[
  '我今天学了多少', '我的掌握度怎么样', '我还有多少词没背', '最近学习状态如何', '今天适合复习吗'
].forEach(s => ok(M(s) === 'command', '「' + s + '」→ 指令（交给 AI 答）', M(s)));
// 防误伤：光有学习域没有疑问（"今天"），或光有疑问没有学习域（"离线也能用吗"）
['今天', '复习', '离线也能用吗', '你好', '你是谁', 'apple 怎么读', '卡片']
  .forEach(s => ok(M(s) === 'search', '「' + s + '」→ 仍判查词', M(s)));

// ---------- 9. 两张表同步：新增的关键词 ROUTE_RULES 也要认 ----------
console.log('== 9. 新关键词同步 ==');
[['每天练50题', 'goal.set'], ['背景模糊一点', 'bg.set'], ['界面紧凑一点', 'theme.set'],
 ['换回晨间那套', 'skin.apply'], ['把「今天也要加油」读出来', 'page.announce']].forEach(([s, op]) => {
  const r = pa.routeOps(s);
  ok(r.ops === null || r.ops.indexOf(op) >= 0, '「' + s + '」手册含 ' + op, r.ops);
});

// ---------- 10. 功能请求类：没有 op，但模型能指路 ----------
// 「帮我出10道练习题」「换一本词书」「导出我的学习数据」这些没有任何 op 能表达，
// 走查词只会得到"没找到这个词"。模型手里有指路清单（prompt 规则 11），
// 所以必须让它们进指令通道。误判代价很低：规则 12 禁止硬凑指令，最坏是白跑一次 API。
console.log('== 10. 功能请求类 ==');
[
  '换成四级词书', '我要背考研词汇', '换一本词书', '帮我出10道练习题',
  '把不认识的词加进生词本', 'abandon 怎么记', '这个单词怎么背', '提醒我每天晚上8点背单词',
  '导出我的学习数据', '清空所有学习记录', '给我讲讲这个词根', '我能做什么', '你能做什么'
].forEach(s => ok(M(s) === 'command', '「' + s + '」→ 指令（交给 AI 答/指路）', M(s)));
// 寒暄与纯查词保持查词：这是有意的 —— 不让"你好"这种也去烧一次 API
['你好', '你是谁', '随便', 'apple', '卡片'].forEach(s => ok(M(s) === 'search', '「' + s + '」→ 仍判查词', M(s)));

console.log('');
console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('FAILED'); process.exit(1); }
console.log('OK');
