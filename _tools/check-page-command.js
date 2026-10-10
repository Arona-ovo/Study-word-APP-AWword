// _tools/check-page-command.js - 「AI 指令输入框」全链路校验（只读源码 + 真实模块）
// 运行：node --experimental-strip-types _tools/check-page-command.js
//
// 覆盖：
//  1) page-schema：校验器"能救就救"（夹取/截断）与"救不了才失败"
//  2) 块 / 卡片样式归一化（13 种块、上限、非法值）
//  3) 指令归一化：op 白名单、必填参数、target 四种定位
//  4) pageDoc：默认卡、定位、移动 / 显隐 / 删除、活数据
//  5) 指令执行：增删改排 / 文案 / 样式 / 主题 / 背景 / 宏 / 快照
//  6) 原子回退（失败整批不写入）与撤销栈
//  7) intent：搜索 vs 指令的判定与强制前缀
//  8) page-agent：模型输出解析（合法 / 越界夹取 / 乱码重试 / 空指令说明）
//  9) 出图能力探测与渐变兜底
// 10) 源码契约：home.vue / app-card-blocks / float-navbar / 红线（无 eval、无 DOM 直改）
// 11) 失败文案分层：界面只出现人话，内部操作名只进 rawReason / 日志

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- mock：uni 存储 + 网络 ---------------- */
const kv = {};
const reqLog = [];
let nextReply = { choices: [{ message: { content: '' } }] };

global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {},
  request: (o) => {
    reqLog.push(o);
    if (o && typeof o.success === 'function') o.success({ statusCode: 200, data: nextReply });
  },
  downloadFile: () => {},
  saveFile: () => {},
  hideKeyboard: () => {},
  getSystemInfoSync: () => ({ statusBarHeight: 20 })
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a);
  const s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

(async () => {
  const settings = await import(P('utils/settings.js'));
  const theme = await import(P('utils/theme.js'));
  const homeLayout = await import(P('utils/home-layout.ts'));
  const schema = await import(P('utils/page-schema.js'));
  const pageDoc = await import(P('utils/page-doc.js'));
  const pageCommand = await import(P('utils/page-command.js'));
  const intent = await import(P('utils/intent.js'));
  const pageAgent = await import(P('services/page-agent.js'));
  const imageGen = await import(P('services/image-gen.js'));

  const DEF_LAYOUT = homeLayout.defaultLayout();

  /* ---------------- 1. 校验器 ---------------- */
  console.log('== 1. schema 校验器：能救就救 ==');
  eq(schema.LIMITS.MAX_COMMANDS, 8, '单次指令上限');
  eq(schema.LIMITS.MAX_CARDS, 12, '卡片总数上限');
  eq(schema.vInt(20, 44, 26)(999).value, 44, '超上限字号夹到 44');
  eq(schema.vInt(20, 44, 26)(5).value, 20, '低于下限字号夹到 20');
  eq(schema.vInt(20, 44, 26)('abc').value, 26, '非法字号回落默认');
  eq(schema.vStr(10, '')('abcdefghijklmnop').value, 'abcdefghij', '超长文案截断到 10');
  eq(schema.vColor('')('#2E6BFF').value, '#2E6BFF', '合法 #RRGGBB 通过');
  assert(schema.vColor('')('red').ok === false, '非十六进制颜色被拒');
  assert(schema.vColor('')('url(http://x)').ok === false, 'url() 颜色被拒');
  eq(schema.vColor('')('clear').value, '', "'clear' 表示清空颜色");
  assert(schema.vUrl()('javascript:alert(1)').ok === false, 'javascript: 协议被拒');
  assert(schema.vUrl()('https://a.com/b.png').ok === true, 'https 图片地址通过');
  assert(schema.vUrl()('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').ok === false, 'SVG data URL 被拒（可夹脚本）');
  assert(schema.vUrl()('data:image/png;base64,iVBORw0KGgo=').ok === true, 'PNG data URL 通过');
  assert(schema.vUrl()('_doc/bg_1.png').ok === true, '本地文件路径通过');
  eq(schema.vBool(false)('开').value, true, "中文'开'识别为 true");
  eq(schema.vBool(true)('off').value, false, "'off' 识别为 false");
  eq(schema.vEnum(schema.ACCENTS, '')('Blue').value, 'blue', '枚举大小写不敏感');
  assert(schema.vEnum(schema.ACCENTS, '')('rainbow').ok === false, '枚举外取值被拒');
  eq(schema.vDate()('+30d').value, '+30d', '相对日期 +30d 通过');
  eq(schema.vDate()('2026/3/5').value, '2026-03-05', '斜杠日期被规整');

  /* ---------------- 2. 块 / 卡片样式 ---------------- */
  console.log('== 2. 块与卡片样式归一化 ==');
  eq(schema.BLOCK_NAMES.length, 13, '块类型数量 = 13');
  const longText = 'x'.repeat(300);
  eq(schema.normalizeBlock({ kind: 'text', text: longText }).block.text.length,
     schema.LIMITS.MAX_TEXT, '块文案被截断到 MAX_TEXT');
  assert(schema.normalizeBlock({ kind: 'script' }).ok === false, '未知块类型被拒');
  eq(schema.normalizeBlocks(new Array(12).fill({ kind: 'divider' })).blocks.length,
     schema.LIMITS.MAX_BLOCKS, '块数量被截到 MAX_BLOCKS');
  eq(schema.normalizeBlock({ kind: 'checklist', items: 'a、b，c' }).block.items.length, 3,
     '清单支持中文顿号/逗号切分');
  const cs = schema.normalizeCardStyle({ radius: 999, opacity: 5, bg: 'red' });
  assert(cs.ok === false, '非法颜色让 style.card 整条失败');
  eq(schema.normalizeCardStyle({ radius: 999, opacity: 5 }).style.radius,
     schema.LIMITS.MAX_RADIUS, '圆角夹到上限');
  eq(schema.normalizeCardStyle({ radius: 999, opacity: 5 }).style.opacity,
     schema.LIMITS.MAX_OPACITY, '透明度夹到上限');

  /* ---------------- 3. 指令归一化 ---------------- */
  console.log('== 3. 指令归一化：白名单与必填 ==');
  eq(schema.COMMAND_OPS.length, 20, '指令条目数 = 20（含 card.design）');
  assert(schema.COMMAND_OPS.indexOf('card.design') >= 0, '指令表含 card.design');
  assert(schema.normalizeCommand({ op: 'card.drop' }).ok === false, '未知 op 被拒');
  assert(schema.normalizeCommand({ op: 'card.remove' }).ok === false, '缺少必填 target 被拒');
  assert(schema.normalizeCommand({ op: 'text.set', args: { target: { id: 'book' } } }).ok === false,
    'text.set 缺少 value 被拒');
  ['id', 'index', 'type', 'last'].forEach(k => {
    const t = (k === 'last') ? { last: true } : { [k]: (k === 'index' ? 0 : 'book') };
    assert(schema.normalizeCommand({ op: 'card.hide', args: { target: t } }).ok,
      'card.hide 支持按 ' + k + ' 定位');
  });
  assert(schema.normalizeCommand({ op: 'card.hide', args: { target: {} } }).ok === false,
    '空定位被拒');
  const many = new Array(12).fill({ op: 'page.announce', args: { text: 'hi' } });
  eq(schema.normalizeCommands(many).commands.length, schema.LIMITS.MAX_COMMANDS,
    '超量指令被截到 MAX_COMMANDS');
  eq(schema.normalizeCommands([]).ok, false, '空指令序列返回失败');

  /* ---------------- 3b. target 容错（2026-10-09 DeepSeek 实测翻车修复） ---------------- */
  console.log('== 3b. target 容错：空定位 / 字符串定位 / 别名 ==');
  // 1) 空定位形态：card.design 必须当"新建"处理，不能再判死（截图 15:22 的报错）
  ['', null, {}, '   '].forEach(t => {
    const design = { sections: [{ layout: 'stack', items: [{ kind: 'text', text: 'hi' }] }] };
    const r = schema.normalizeCommand({ op: 'card.design', args: { target: t, design: design } });
    assert(r.ok, 'card.design 空 target（' + JSON.stringify(t) + '）= 新建，不报错');
    assert(r.ok && !r.cmd.args.target, '空 target 不残留定位字段');
  });
  // 2) 必填定位的 op：空定位报错文案要指路
  const miss = schema.normalizeCommand({ op: 'card.remove', args: { target: '' } });
  assert(miss.ok === false && /卡片标题|last/.test(miss.reason), 'card.remove 空定位报错写明可用写法：' + (miss.reason || ''));
  // 3) 字符串定位
  const strRef = (t) => schema.normalizeRef(t).ref;
  eq(strRef('last'), { last: true }, '"last" 字符串定位');
  eq(strRef('第2张'), { index: 1 }, '"第2张" → 0 基 index 1');
  eq(strRef('2'), { index: 2 }, '裸数字按 0 基 index');
  eq(strRef('全部'), { all: true }, '"全部" → all');
  eq(strRef('chart'), { type: 'chart' }, '内置卡 id → type 定位');
  eq(strRef('打卡走势'), { title: '打卡走势' }, '其余字符串当标题');
  // 4) 对象别名：模型爱把标题塞进 name / label
  eq(strRef({ name: '今日心情' }), { title: '今日心情' }, '{name} 别名 → title');
  eq(strRef({ label: '考试倒计时' }), { title: '考试倒计时' }, '{label} 别名 → title');
  // 5) card.add 误带 target 直接忽略（手册写明 card.add 没有 target）
  const stray = schema.normalizeCommand({
    op: 'card.add',
    args: { type: 'note', text: 'hi', target: 'bottom' }
  });
  assert(stray.ok, 'card.add 误带 target 不报错');
  assert(stray.ok && !stray.cmd.args.target, 'card.add 的 target 被丢弃');
  // 6) indexOfRef 标题匹配：精确 → 包含 → type 回退
  const tdoc = { cards: [
    { id: 'c-1', type: 'design', builtin: false, title: '今日心情' },
    { id: 'c-2', type: 'chart', builtin: true, title: '打卡走势' }
  ] };
  eq(pageDoc.indexOfRef(tdoc, { title: '今日心情' }), 0, '标题精确匹配');
  eq(pageDoc.indexOfRef(tdoc, { title: '打卡' }), 1, '标题包含匹配');
  eq(pageDoc.indexOfRef(tdoc, { title: 'chart' }), 1, '标题没中时回退 type');
  // 7) 真实翻车信封（DeepSeek 原样输出形态）：新建一张有趣的卡片
  const crash = schema.normalizeCommands([
    { op: 'card.design', args: { target: '', title: '小趣味', design: { sections: [{ layout: 'stack', items: [{ kind: 'text', text: '笑一笑' }] }] } } }
  ]);
  assert(crash.ok, '实测翻车信封（target:""）整批通过');

  // 8) 归一化幂等：applyCommands 会对 plan 的产物再归一化一遍，枚举字段的 '' 默认值
  //    不能在第二遍炸出"取值必须是…"（真机联测抓到过：plan 过、执行反而失败）
  const once = schema.normalizeCommands([{ op: 'bg.set', args: { preset: '安静的蓝色渐变' } }]);
  assert(once.ok, 'bg.set 非法 preset 兜成 mood');
  const twice = schema.normalizeCommands(once.commands);
  assert(twice.ok, '归一化产物可再次归一化（幂等）：' + (twice.ok ? '' : twice.errors.join('；')));
  const themeOnce = schema.normalizeCommand({ op: 'theme.set', args: { accent: '' } });
  assert(themeOnce.ok, 'theme.set 空 accent 不报错（同一条幂等定律）');
  // 9) style.card 扁平参数：模型爱写 {radius:28} 而不是 {style:{radius:28}}
  const flat = schema.normalizeCommand({ op: 'style.card', args: { target: 'all', radius: 28 } });
  assert(flat.ok && flat.cmd.args.style && flat.cmd.args.style.radius === 28,
    'style.card 扁平样式参数被收拢成 style 对象');
  const flatRun = pageCommand.applyCommands(pageDoc.defaultDoc(), [flat.cmd], {});
  assert(flatRun.ok && flatRun.doc.cards.every(c => c.style && c.style.radius === 28),
    '扁平 style.card + all 定位真实执行');

  /* ---------------- 4. pageDoc ---------------- */
  console.log('== 4. pageDoc 模型 ==');
  let doc = pageDoc.defaultDoc();
  eq(doc.cards.map(c => c.id), DEF_LAYOUT, '默认卡片 = 默认布局');
  assert(doc.cards.every(c => c.builtin === true && c.visible === true), '默认卡都是内置且可见');
  eq(doc.background.preset, 'default', '默认背景预设');
  const seeded = pageDoc.get();
  eq(seeded.cards.map(c => c.id), DEF_LAYOUT, '首次读取按 home-layout 播种');
  // 定位
  eq(pageDoc.indexOfRef(doc, { id: 'stats' }), DEF_LAYOUT.indexOf('stats'), '按 id 定位');
  eq(pageDoc.indexOfRef(doc, { index: 1 }), 1, '按 index 定位');
  eq(pageDoc.indexOfRef(doc, { type: 'book' }), 0, '按 type 定位');
  eq(pageDoc.indexOfRef(doc, { last: true }), doc.cards.length - 1, 'last 定位到末尾');
  eq(pageDoc.indexOfRef(doc, { id: 'nope' }), -1, '找不到返回 -1');
  // 移动 / 显隐 / 删除
  const moved = pageDoc.moveCard(doc, 0, 2);
  eq(moved.cards.map(c => c.id)[2], DEF_LAYOUT[0], 'moveCard 换位生效');
  eq(doc.cards.map(c => c.id), DEF_LAYOUT, 'moveCard 不改原对象（不可变）');
  const hid = pageDoc.setVisible(doc, 'stats', false);
  eq(pageDoc.findCard(hid, 'stats').visible, false, 'setVisible 隐藏生效');
  const gone = pageDoc.removeCard(doc, 'stats');
  eq(gone.cards.length, doc.cards.length - 1, 'removeCard 删除生效');
  eq(pageDoc.newCardId({ cards: [{ id: 'c-1' }, { id: 'c-2' }] }), 'c-3', 'newCardId 不重复');
  // 活数据
  const live = pageDoc.liveValues();
  ['todayTotal', 'streak', 'mastered', 'newWordsDone', 'practiceTarget'].forEach(k => {
    assert(typeof live[k] === 'number', 'liveValues 提供 ' + k);
  });
  eq(pageDoc.liveText('none', live), null, "live 'none' 返回 null");
  eq(pageDoc.liveText('streak', live), String(live.streak), 'liveText 取真实值');

  /* ---------------- 5. 指令执行 ---------------- */
  console.log('== 5. 指令执行 ==');
  let r = pageCommand.applyCommands(pageDoc.defaultDoc(), [
    { op: 'card.add', args: { type: 'note', title: '今日提醒', text: '别忘了复习' } }
  ], {});
  assert(r.ok, 'card.add 成功');
  eq(r.doc.cards.length, DEF_LAYOUT.length + 1, '新增后卡片数 +1');
  const ai = r.doc.cards[r.doc.cards.length - 1];
  eq(ai.builtin, false, 'AI 卡标记 builtin=false');
  assert(ai.blocks.some(b => b.kind === 'title'), 'note 卡自动补标题块');
  assert(ai.blocks.some(b => b.kind === 'text'), 'note 卡带正文块');

  // 数组型 items：统计卡 / 清单卡（模型最爱给数组，之前会被占位校验器截成空串）
  r = pageCommand.applyCommands(doc, [{
    op: 'card.add',
    args: {
      type: 'stats',
      title: '今日一览',
      items: [{ label: '已练', value: '', unit: '题', live: 'todayTotal' },
              { label: '连续', value: '', unit: '天', live: 'streak' }]
    }
  }], {});
  assert(r.ok, '统计卡接受数组 items（含 live 绑定）');
  const statCard = r.doc.cards[r.doc.cards.length - 1];
  eq(statCard.blocks.filter(b => b.kind === 'stat').length, 2, '统计卡生成 2 个数字块');
  eq(statCard.blocks[1].live, 'todayTotal', '统计块保留 live 绑定');
  eq(statCard.blocks[2].live, 'streak', '第二个统计块的 live 也没丢');

  r = pageCommand.applyCommands(doc, [{
    op: 'card.add',
    args: { type: 'checklist', title: '今日待办', items: ['背 20 个新词', { text: '复习错题', done: true }] }
  }], {});
  assert(r.ok, '清单卡接受数组 items');
  const cl = r.doc.cards[r.doc.cards.length - 1].blocks.find(b => b.kind === 'checklist');
  eq(cl.items.length, 2, '清单两项都进来了');
  eq(cl.items[0].text, '背 20 个新词', '字符串项转成 { text }');
  eq(cl.items[1].done, true, '对象项保留 done 状态');

  // 上限
  let full = pageDoc.defaultDoc();
  for (let i = 0; i < 20; i++) {
    const rr = pageCommand.applyCommands(full, [{ op: 'card.add', args: { type: 'note', text: 'x' } }], {});
    if (rr.ok) full = rr.doc;
  }
  eq(full.cards.length, schema.LIMITS.MAX_CARDS, '卡片数被 MAX_CARDS 挡住');
  assert(pageCommand.applyCommands(full, [{ op: 'card.add', args: { type: 'note', text: 'x' } }], {}).ok === false,
    '到上限后 card.add 失败');

  // 隐藏 / 显示 / 移动
  r = pageCommand.applyCommands(doc, [{ op: 'card.hide', args: { target: { id: 'chart' } } }], {});
  eq(pageDoc.findCard(r.doc, 'chart').visible, false, 'card.hide 生效');
  r = pageCommand.applyCommands(r.doc, [{ op: 'card.show', args: { target: { id: 'chart' } } }], {});
  eq(pageDoc.findCard(r.doc, 'chart').visible, true, 'card.show 生效');
  // 幂等：重复隐藏不算失败
  r = pageCommand.applyCommands(r.doc, [
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'card.hide', args: { target: { id: 'chart' } } }
  ], {});
  assert(r.ok, '重复隐藏是幂等的，不整批失败');
  r = pageCommand.applyCommands(doc, [{ op: 'card.move', args: { target: { id: 'goal' }, to: 'top' } }], {});
  eq(r.doc.cards[0].id, 'goal', 'card.move 到 top');

  // target:"all"：样式指令对全部卡片生效（「把所有卡片圆角调大一点」）
  r = pageCommand.applyCommands(doc, [{ op: 'style.card', args: { target: '全部', style: { radius: 30 } } }], {});
  assert(r.ok, 'style.card 接受字符串 "全部" 定位');
  assert(r.ok && r.doc.cards.every(c => c.style && c.style.radius === 30), 'all 定位让每张卡片都改到');
  r = pageCommand.applyCommands(doc, [{ op: 'style.text', args: { target: { all: true }, size: 30 } }], {});
  assert(r.ok && r.doc.cards.every(c => c.style && c.style.fontSize === 30), 'style.text all 定位同样生效');

  // ---- 结构类 op 的 all：用户说「去掉主页所有卡片」（真机截图 2026-10-10 19:17）----
  // 以前只有 style.* 认 all：card.remove / card.hide 拿到 {all:true} 会一路走到
  // pageDoc.indexOfRef 结尾的 return -1，然后被误报成「没找到这张卡片」。
  // 根因是两个模块口径不一致 —— normalizeRef 支持 all，indexOfRef 不支持。
  const allDoc = pageCommand.applyCommands(pageDoc.defaultDoc(),
    [{ op: 'card.add', args: { type: 'note', title: 'A', text: 'x' } }], {}).doc;
  eq(pageDoc.indicesOfRef(allDoc, { all: true }).length, allDoc.cards.length, 'indicesOfRef({all:true}) 命中全部卡片');
  eq(pageDoc.indicesOfRef(allDoc, { id: 'chart' }).length, 1, 'indicesOfRef 单目标只回一个下标');
  eq(pageDoc.indicesOfRef(allDoc, { title: '根本没有这张卡' }).length, 0, 'indicesOfRef 找不到回空数组');
  // indexOfRef 保持单目标口径不动（move / text.set / image.set / card.design 还在用它）
  eq(pageDoc.indexOfRef(allDoc, { all: true }), -1, 'indexOfRef 对 all 仍然回 -1（单目标口径不变）');

  r = pageCommand.applyCommands(allDoc, [{ op: 'card.remove', args: { target: '所有' } }], {});
  assert(r.ok, 'card.remove 接受字符串 "所有"');
  eq(r.ok ? r.doc.cards.length : -1, 0, 'remove all 把首页清空');
  r = pageCommand.applyCommands(allDoc, [{ op: 'card.remove', args: { target: '全部卡片' } }], {});
  assert(r.ok, 'card.remove 接受 "全部卡片"');
  r = pageCommand.applyCommands(allDoc, [{ op: 'card.hide', args: { target: '全部' } }], {});
  assert(r.ok, 'card.hide 接受字符串 "全部"');
  assert(r.ok && r.doc.cards.every(c => c.visible === false), 'hide all 把每张卡都收进收纳区');
  r = pageCommand.applyCommands(r.doc, [{ op: 'card.show', args: { target: { all: true } } }], {});
  assert(r.ok && r.doc.cards.every(c => c.visible !== false), 'show all 把收纳的卡都放出来');
  // 全删后再来一次：幂等不炸，但也没有"删掉 0 张"的假成功
  r = pageCommand.applyCommands(Object.assign({}, pageDoc.defaultDoc(), { cards: [] }),
    [{ op: 'card.remove', args: { target: '所有' } }], {});
  assert(!r.ok && /已经没有卡片/.test(r.reason || ''), '空首页删「所有」提示「已经没有卡片」，不是「没找到这张卡片」');
  assert(pageCommand.applyCommands(allDoc, [{ op: 'card.move', args: { target: '所有', to: 'top' } }], {}).ok === false,
    'card.move 仍不接受 all（单目标指令，乱给就失败）');
  // 清空是破坏性操作，**撤销是它唯一的安全网** —— 必须真的能一张不少地收回来
  pageCommand.clearHistory();
  const keepDoc = pageCommand.commit(pageDoc.defaultDoc(), '清空前');
  const wiped = pageCommand.applyCommands(keepDoc, [{ op: 'card.remove', args: { target: '所有' } }], {}).doc;
  pageCommand.commit(wiped, '删除全部卡片');
  eq(wiped.cards.length, 0, '清空后首页 0 张卡');
  eq(pageCommand.canUndo(), true, '清空后可撤销');
  const back = pageCommand.undo();
  eq(back.cards.length, keepDoc.cards.length, '撤销把卡片一张不少地收回来');
  assert(back.cards.every(c => c.visible !== false), '撤销回来的卡片都是显示状态');
  const manual = schema.promptManual();
  assert(/card\.hide \/ card\.show \/ card\.remove 都支持/.test(manual),
    '手册告诉模型结构类指令也能用 all（否则模型会自己瞎挑一张卡）');
  assert(!/只有样式指令/.test(manual), '手册里「只有样式指令能用 all」的旧说法已删掉');

  // text.rewrite all：只为有文案的 AI 卡发效果，内置卡不动
  const rwDoc = (function () {
    let d = pageDoc.defaultDoc();
    d = pageCommand.applyCommands(d, [{ op: 'card.add', args: { type: 'note', title: 'A', text: '第一句' } }], {}).doc;
    d = pageCommand.applyCommands(d, [{ op: 'card.add', args: { type: 'note', title: 'B', text: '第二句' } }], {}).doc;
    return d;
  })();
  r = pageCommand.applyCommands(rwDoc, [{ op: 'text.rewrite', args: { target: '所有卡片', tone: '活泼' } }], {});
  assert(r.ok, 'text.rewrite all 通过');
  eq(r.ok ? r.effects.length : 0, 2, '只为 2 张 AI 卡发 rewrite 效果（内置卡跳过）');
  r = pageCommand.applyCommands(doc, [{ op: 'card.move', args: { target: { id: 'book' }, to: 'bottom' } }], {});
  eq(r.doc.cards[r.doc.cards.length - 1].id, 'book', 'card.move 到 bottom');
  // 恢复已删除的内置卡
  r = pageCommand.applyCommands(pageDoc.removeCard(doc, 'chart'), [
    { op: 'card.restore', args: { id: 'chart' } }
  ], {});
  assert(pageDoc.indexOfRef(r.doc, { id: 'chart' }) >= 0, 'card.restore 加回内置卡');
  assert(pageCommand.applyCommands(doc, [{ op: 'card.restore', args: { id: 'hack' } }], {}).ok === false,
    'card.restore 只认内置卡 id');

  // 文案：内置卡 + AI 卡的块都要改到
  r = pageCommand.applyCommands(doc, [{ op: 'text.set', args: { target: { id: 'book' }, value: '加油' } }], {});
  eq(pageDoc.findCard(r.doc, 'book').text, '加油', 'text.set 改内置卡文案');
  const noteDoc = pageCommand.applyCommands(doc, [
    { op: 'card.add', args: { type: 'note', text: '原文' } }
  ], {}).doc;
  r = pageCommand.applyCommands(noteDoc, [
    { op: 'text.set', args: { target: { last: true }, value: '改过的文案' } }
  ], {});
  const nt = r.doc.cards[r.doc.cards.length - 1];
  eq(nt.text, '改过的文案', 'text.set 改 AI 卡文案字段');
  assert(nt.blocks.some(b => b.text === '改过的文案'), 'text.set 同时改到块（界面才看得到）');

  // 样式
  r = pageCommand.applyCommands(doc, [
    { op: 'style.card', args: { target: { id: 'book' }, style: { radius: 999, bg: '#FFFFFF' } } }
  ], {});
  eq(pageDoc.findCard(r.doc, 'book').style.radius, schema.LIMITS.MAX_RADIUS, 'style.card 圆角被夹取');
  r = pageCommand.applyCommands(doc, [
    { op: 'style.text', args: { target: { id: 'book' }, size: 99, align: 'center' } }
  ], {});
  eq(pageDoc.findCard(r.doc, 'book').style.fontSize, schema.LIMITS.MAX_FONT, 'style.text 字号被夹取');
  eq(pageDoc.findCard(r.doc, 'book').style.align, 'center', 'style.text 对齐生效');

  // 主题 / 背景
  r = pageCommand.applyCommands(doc, [{ op: 'theme.set', args: { accent: 'purple', dark: true } }], {});
  eq(r.doc.theme.accent, 'purple', 'theme.set 主题色');
  eq(r.doc.theme.dark, true, 'theme.set 深色');
  assert(r.effects.some(e => e.kind === 'theme'), 'theme.set 产出 theme 副作用');
  assert(pageCommand.applyCommands(doc, [{ op: 'theme.set', args: {} }], {}).ok === false,
    'theme.set 至少一个参数');
  r = pageCommand.applyCommands(doc, [{ op: 'bg.set', args: { mood: '夜晚' } }], {});
  assert(r.doc.background.gradient && r.doc.background.gradient.from === '#232043', 'bg.set mood 命中夜晚渐变');
  eq(r.doc.theme.accent, 'purple', 'mood 同时改主题色');
  r = pageCommand.applyCommands(doc, [{ op: 'bg.set', args: { gradient: { from: '#112233', to: '#445566' } } }], {});
  eq(r.doc.background.gradient.angle, 165, '渐变缺省角度 165');
  assert(pageCommand.applyCommands(doc, [{ op: 'bg.set', args: { gradient: { from: 'red' } } }], {}).ok === false,
    '非法渐变颜色被拒');

  // bg.set 兜底：模型把自定义颜色写进 preset → 本地转 mood，不再整条判死
  let n = schema.normalizeCommand({ op: 'bg.set', args: { preset: '安静的蓝色渐变' } });
  assert(n.ok, '非法 preset 不再判死（转 mood）');
  eq(n.cmd.args.mood, '安静的蓝色渐变', '非法 preset 转成 mood');
  assert(!n.cmd.args.preset, '非法 preset 被移除');
  eq(pageCommand.moodPreset(n.cmd.args.mood).gradient.from, '#DCEAFF',
    '「安静的蓝色渐变」命中颜色词蓝（颜色行优先于心情行）');
  n = schema.normalizeCommand({ op: 'bg.set', args: { preset: 'SKY' } });
  assert(n.ok && n.cmd.args.preset === 'sky', '合法 preset 大小写不敏感照常通过');
  n = schema.normalizeCommand({ op: 'bg.set', args: { preset: '蓝色渐变', gradient: { from: '#112233', to: '#445566' } } });
  assert(n.ok && n.cmd.args.gradient && !n.cmd.args.mood, '已有 gradient 时非法 preset 只丢弃不再转 mood');
  n = schema.normalizeCommand({ op: 'bg.set', args: { preset: '胡说的', mood: '夜晚' } });
  assert(n.ok && n.cmd.args.mood === '夜晚', '已有 mood 时非法 preset 只丢弃');
  r = pageCommand.applyCommands(doc, [{ op: 'bg.set', args: { preset: '安静的蓝色渐变' } }], {});
  assert(r.ok && r.doc.background.gradient && r.doc.background.gradient.from === '#DCEAFF',
    '端到端：自定义颜色描述直接换出蓝色渐变');
  eq(pageCommand.moodPreset('夜晚').gradient.from, '#232043', '心情词行为不变（夜晚仍深色）');
  eq(pageCommand.moodPreset('完全没见过的词').gradient.from, '#EEF3F0', '未知心情仍走灰绿兜底');

  // 目标 / 快照 / 宏 / 朗读
  r = pageCommand.applyCommands(doc, [{ op: 'goal.set', args: { newWords: 30 } }], {});
  assert(r.ok && r.effects.some(e => e.kind === 'goal'), 'goal.set 生效并产出 goal 副作用');
  let d2 = pageCommand.applyCommands(doc, [{ op: 'theme.set', args: { accent: 'rose' } }], {}).doc;
  pageCommand.applyCommands(d2, [{ op: 'skin.save', args: { name: '考试' } }], {});
  r = pageCommand.applyCommands(doc, [{ op: 'skin.apply', args: { name: '考试' } }], {});
  eq(r.doc.theme.accent, 'rose', 'skin.apply 恢复快照里的主题');
  assert(pageCommand.applyCommands(doc, [{ op: 'skin.apply', args: { name: '不存在' } }], {}).ok === false,
    '不存在的快照报错');
  r = pageCommand.applyCommands(doc, [{ op: 'macro.run', args: { name: 'exam' } }], {});
  assert(r.ok, 'macro.run 展开后整组通过（不因缺卡而崩）');
  assert(r.doc.cards[0].id === 'action', '考试宏把学习入口置顶');
  eq(r.doc.theme.accent, 'rose', '考试宏改主题色');
  r = pageCommand.applyCommands(doc, [{ op: 'page.announce', args: { text: '今天也要加油' } }], {});
  assert(r.effects.some(e => e.kind === 'speak' && e.text === '今天也要加油'), 'page.announce 产出朗读');
  r = pageCommand.applyCommands(doc, [{ op: 'card.reset', args: {} }], {});
  eq(r.doc.cards.map(c => c.id), DEF_LAYOUT, 'card.reset 回到默认首页');

  /* ---------------- 6. 原子回退与撤销 ---------------- */
  console.log('== 6. 失败回退 / 撤销 ==');
  const before = pageDoc.defaultDoc();
  r = pageCommand.applyCommands(before, [
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'style.text', args: { target: { id: 'book' }, size: 30 } },
    { op: 'card.remove', args: { target: { id: '不存在的卡' } } }
  ], {});
  assert(r.ok === false, '序列里有失败项 → 整批失败');
  eq(JSON.stringify(r.doc), JSON.stringify(before), '失败时返回的仍是原 doc（页面一个字节都没变）');
  assert(r.reason.indexOf('没找到') >= 0, '失败原因可读：' + r.reason);

  pageCommand.clearHistory();
  eq(pageCommand.canUndo(), false, '清栈后不可撤销');
  let cur = pageDoc.defaultDoc();
  pageCommand.commit(cur, '初始');
  const next = pageCommand.applyCommands(cur, [
    { op: 'card.add', args: { type: 'quote', text: '每天一点' } }
  ], {}).doc;
  pageCommand.commit(next, '加一句格言');
  eq(pageCommand.canUndo(), true, '提交后可撤销');
  const undone = pageCommand.undo();
  eq(undone.cards.length, cur.cards.length, '撤销回到上一步的卡片数');
  eq(pageCommand.canUndo(), true, '还有更早的快照可继续撤销');
  pageCommand.undo();
  eq(pageCommand.canUndo(), false, '继续撤销到栈空');
  // 撤销必须连 settings.theme 一起还原（pageDoc.theme 是稀疏的，单靠它还原不干净）
  const th0 = JSON.parse(JSON.stringify((settings.get() || {}).theme || {}));
  const dA = pageDoc.defaultDoc();
  pageCommand.commit(dA, '基线');
  const dB = pageCommand.applyCommands(dA, [
    { op: 'theme.set', args: { accent: 'purple', dark: true, density: 'compact' } }
  ], {}).doc;
  pageCommand.commit(dB, '换个主题');
  const st1 = settings.get();
  assert(st1.theme.accent === 'purple', '提交后主题色写进 settings');
  assert(st1.theme.dark === true, '提交后深色写进 settings');
  pageCommand.undo();
  const st2 = settings.get();
  assert(st2.theme.accent === th0.accent, '撤销后主题色回到改动前（' + th0.accent + '）');
  assert(st2.theme.dark === th0.dark, '撤销后深色回到改动前');
  assert(st2.theme.density === th0.density, '撤销后密度回到改动前');

  const sum = pageCommand.summaryOf([
    { op: 'card.hide', note: '隐藏打卡走势' },
    { op: 'theme.set', note: '主题改为 accent=purple' }
  ]);
  assert(sum.indexOf('隐藏打卡走势') >= 0 && sum.indexOf('主题改为') >= 0, '摘要拼接多条：' + sum);

  /* ---------------- 7. 意图识别 ---------------- */
  console.log('== 7. intent：搜索 vs 指令 ==');
  eq(intent.detect('/把背景换成蓝色').mode, 'command', '/ 前缀强制指令');
  eq(intent.detect(':把背景换成蓝色').mode, 'command', ': 前缀强制指令');
  eq(intent.detect('#book').mode, 'search', '# 前缀强制搜索');
  // 「艾特 AI」：判定看走眼时的逃生通道，优先级高于自动判定与手动锁定
  eq(intent.detect('@把背景换成蓝色').mode, 'command', '@ 前缀强制指令');
  eq(intent.detect('@AI 把背景换成蓝色').mode, 'command', '@AI 前缀同样强制指令');
  eq(intent.detect('@AI 把背景换成蓝色').text, '把背景换成蓝色', '@AI 的 AI 二字被剥掉，只留正文');
  eq(intent.detect('@apple').mode, 'command', '@ 能盖过"单词"这个搜索信号');
  eq(intent.detect('#apple').mode, 'search', '# 能盖过任何指令信号');
  eq(intent.detect('把背景换成安静的蓝色渐变').mode, 'command', '含变更动词 → 指令');
  eq(intent.detect('帮我把每日新词改成 30').mode, 'command', '使役 + 改值 → 指令');
  eq(intent.detect('加一张考试倒计时卡片').mode, 'command', '新增 → 指令');
  eq(intent.detect('隐藏打卡走势').mode, 'command', '删除/隐藏 → 指令');
  eq(intent.detect('进入沉浸专注模式').mode, 'command', '场景 → 指令');
  eq(intent.detect('abandon').mode, 'search', '单个英文单词 → 搜索');
  eq(intent.detect('hello').mode, 'search', '短英文串 → 搜索');
  eq(intent.detect('这个词是什么意思').mode, 'search', '查词问法 → 搜索');
  eq(intent.detect('apple').mode, 'search', '水果名 → 搜索');
  eq(intent.detect('').mode, 'search', '空输入 → 搜索');
  eq(intent.detect('/').text, '', '只有前缀 → 正文为空');
  eq(intent.detect('  把背景换成蓝色  ').text, '把背景换成蓝色', '去掉首尾空白');
  assert(intent.SUGGESTIONS.length >= 6, '提供 ' + intent.SUGGESTIONS.length + ' 条指令示例');
  eq(intent.hintFor('command').indexOf('撤销') >= 0, true, '指令态提示带撤销说明');

  console.log('== 7b. forced 字段：手动锁定时也要能被显式前缀盖过 ==');
  eq(intent.detect('把背景换成蓝色').forced, '', '自动判定不带 forced');
  eq(intent.detect('/x').forced, 'command', '/ 带 forced=command');
  eq(intent.detect('@x').forced, 'command', '@ 带 forced=command');
  eq(intent.detect('#x').forced, 'search', '# 带 forced=search');

  console.log('== 7d. 顶栏模式键：自动判错的兜底 ==');
  const nbSrc = R(path.join('components', 'float-navbar', 'float-navbar.vue'));
  assert(/switchable:\s*\{\s*type:\s*Boolean/.test(nbSrc), 'float-navbar 有 switchable 开关（只有双模式页面才显示）');
  assert(/locked:\s*\{\s*type:\s*Boolean/.test(nbSrc), 'float-navbar 有 locked 属性（锁定态显示小锁点）');
  assert(/\$emit\('mode-toggle'/.test(nbSrc), '点模式键抛 mode-toggle（切到哪个模式由父页面定）');
  assert(/class="fnb-mode"/.test(nbSrc), '模式键本体 = .fnb-mode');
  assert(/fnb-mode-on/.test(nbSrc), '指令态整颗键染品牌色（.fnb-mode-on）');
  assert(/v-if="locked"\s+class="fnb-lock"/.test(nbSrc), '锁定态右上角小锁点');
  assert(/isCommand \? 'AI' : t?\(?'搜'\)?/.test(nbSrc), '键上直接写「AI / 搜」，所见即所得');

  const homeCmd = R(path.join('pages', 'home', 'home.vue'));
  assert(/\bswitchable\b/.test(homeCmd) && /@mode-toggle="toggleMode"/.test(homeCmd), '首页开启模式键并接住 mode-toggle');
  assert(/:locked="modeLocked"/.test(homeCmd), '首页把 modeLocked 传给顶栏');
  assert(/modeLocked:\s*false/.test(homeCmd), 'modeLocked 默认 false（默认走自动判定）');
  assert(/toggleMode\(next\)/.test(homeCmd), '有 toggleMode 方法');
  assert(/this\.modeLocked = true/.test(homeCmd), '手动切换后置锁定');
  assert(/if \(d\.forced \|\| !this\.modeLocked\) this\.inputMode = d\.mode/.test(homeCmd),
    '打字时：显式前缀或"未锁定"才改判（锁定后不再自动改）');
  assert(/const mode = this\.inputMode/.test(homeCmd), '后续分支以最终生效的模式为准，不用 d.mode');
  assert(/if \(d\.forced\) this\.inputMode = d\.mode/.test(homeCmd), '提交时显式前缀优先于手动锁定');
  assert(/retryAsSearch/.test(homeCmd) && /retryAsCommand/.test(homeCmd), '双向兜底：指令失败可改查词、搜不到可改指令');
  assert(/lastCmdText/.test(homeCmd), '记住上一条指令原文，兜底时不用重新输入');
  assert(/this\.modeLocked = false/.test(homeCmd), '清空输入即解锁');

  console.log('== 7c. 模式键文案 ==');
  eq(intent.modeLabel('command'), 'AI', '指令态按钮写 AI');
  eq(intent.modeLabel('search'), '搜', '搜索态按钮写搜');
  assert(intent.modeHint('search', false).indexOf('AI 指令') >= 0, '搜索态提示可切成指令');
  assert(intent.modeHint('search', true).indexOf('锁定') >= 0, '锁定时提示里带"锁定"');

  /* ---------------- 8. Agent 解析 ---------------- */
  console.log('== 8. page-agent：模型输出 → 指令 ==');
  settings.set({ ai: { enabled: true, provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' } });

  const withReply = async (content, input) => {
    reqLog.length = 0;
    let i = 0;
    const list = Array.isArray(content) ? content : [content];
    nextReply = { choices: [{ message: { content: list[0] } }] };
    const orig = global.uni.request;
    global.uni.request = (o) => {
      reqLog.push(o);
      const c = list[Math.min(i++, list.length - 1)];
      if (o && typeof o.success === 'function') o.success({ statusCode: 200, data: { choices: [{ message: { content: c } }] } });
    };
    const res = await pageAgent.plan(input || '把背景换成蓝色', pageDoc.defaultDoc(), {});
    global.uni.request = orig;
    return res;
  };

  let a = await withReply('```json\n{"say":"换成蓝色背景","commands":[{"op":"bg.set","args":{"preset":"sky"}}]}\n```');
  assert(a.ok, '容忍 markdown 代码块');
  eq(a.commands[0].op, 'bg.set', '解析出 bg.set');
  eq(a.say, '换成蓝色背景', '带出给用户的说明');

  a = await withReply('{"say":"圆角拉满","commands":[{"op":"style.card","args":{"target":{"id":"book"},"style":{"radius":999}}}]}');
  assert(a.ok, '越界值不失败');
  eq(a.commands[0].args.style.radius, schema.LIMITS.MAX_RADIUS, '圆角 999 被夹到上限');

  a = await withReply(['这不是 JSON', '{"say":"好了","commands":[{"op":"card.hide","args":{"target":{"id":"chart"}}}]}']);
  assert(a.ok, '第一次乱码 → 重试后成功');
  eq(a.attempts, 2, '重试次数 = 2');

  a = await withReply(['乱', '还是乱', '继续乱']);
  assert(a.ok === false, '连续三次乱码 → 明确失败');
  eq(a.attempts, 3, '最多尝试 3 次');
  assert(a.error.length > 0, '失败原因非空');

  a = await withReply('{"say":"这个我做不了","commands":[]}');
  assert(a.ok === false, '空指令序列 → 不算成功');
  eq(a.say, '这个我做不了', '把模型的说明带给用户');

  /* 用户报的问题：搜索框底下那条推荐语「把背景换成安静的蓝色渐变」（= SUGGESTIONS[0]）
     点下去会弹一段校验报错。两道防线都要守住：
       ① 模型把自定义颜色塞进 preset → schema 兜成 mood，整条指令照常成功；
       ② 模型干脆什么都不给 → 用用户原话补 mood，别"说改好了但页面没动"。 */
  const SUG0 = intent.SUGGESTIONS[0];
  assert(SUG0.indexOf('背景') >= 0, '第 1 条推荐语仍是背景类（实际：' + SUG0 + '）');

  a = await withReply('{"say":"换好了","commands":[{"op":"bg.set","args":{"preset":"安静的蓝色渐变"}}]}', SUG0);
  assert(a.ok, '推荐语「' + SUG0 + '」不再整条失败');
  eq(a.commands[0].args.mood, '安静的蓝色渐变', '非法 preset 兜成 mood');
  assert(!a.commands[0].args.preset, '非法 preset 已被丢弃');

  a = await withReply('{"say":"换好了","commands":[{"op":"bg.set","args":{}}]}', SUG0);
  eq(a.commands[0].args.mood, SUG0, '空 bg.set 用用户原话补 mood（否则"说改好了却没变"）');

  a = await withReply('{"say":"去掉了","commands":[{"op":"bg.set","args":{}}]}', '把背景图去掉');
  assert(!a.commands[0].args.mood, '没有颜色/氛围词时不瞎补 mood（实际：' + a.commands[0].args.mood + '）');

  a = await withReply('{"say":"模糊一点","commands":[{"op":"bg.set","args":{"blur":8}}]}', '把背景模糊一点');
  assert(!a.commands[0].args.mood, '只调模糊时不补 mood（别顺手铺一层渐变）');

  a = await withReply('{"say":"好了","commands":[{"op":"bg.set","args":{"preset":"sky"}}]}', SUG0);
  eq(a.commands[0].args.preset, 'sky', '模型给对了预设就照原样执行');

  /* 连续失败时给用户看的必须是**人话**。
     schema 的报错（"第 1 条：theme.set：accent：取值必须是 …"）只该回喂给模型，
     以前两者共用一个字符串，用户就在搜索栏底下看到一串字段名和枚举值。 */
  const ENUM_BAD = '{"say":"","commands":[{"op":"theme.set","args":{"accent":"彩虹色"}}]}';
  a = await withReply([ENUM_BAD, ENUM_BAD, ENUM_BAD], '换成彩虹色主题');
  assert(a.ok === false, '非枚举取值三次都失败（theme.set 没有本地兜底）');
  ['取值必须是', 'theme.set', 'accent'].forEach(bit => {
    assert(a.error.indexOf(bit) < 0, '失败提示里不含「' + bit + '」（实际：' + a.error + '）');
  });
  assert(a.error.indexOf('没有对应的选项') >= 0, '换成"这个说法我没对应选项"的人话：' + a.error);

  a = await withReply(['乱', '还是乱', '继续乱'], SUG0);
  assert(a.ok === false, '连续三次乱码 → 明确失败');
  assert(a.error.indexOf('JSON') < 0, '乱码失败提示里不含技术术语（实际：' + a.error + '）');
  assert(a.error.indexOf('换个说法') >= 0 || a.error.indexOf('再试') >= 0, '乱码失败提示给了下一步：' + a.error);

  const sp = pageAgent.systemPrompt(pageDoc.defaultDoc(), pageDoc.liveValues(), '');
  assert(sp.indexOf('只能输出 JSON') >= 0, 'system prompt 强调纯 JSON');
  assert(sp.indexOf('card.add') >= 0, 'system prompt 含指令手册');
  assert(sp.indexOf('当前首页') >= 0, 'system prompt 含当前页面状态');
  assert(pageAgent.docDigest(pageDoc.defaultDoc(), pageDoc.liveValues()).indexOf('真实学习数据') >= 0,
    '状态摘要含真实学习数据');
  assert(pageAgent.aiImagePrompt('帮我把背景换成下雨的窗边').indexOf('rain') >= 0
    || pageAgent.aiImagePrompt('帮我把背景换成下雨的窗边').indexOf('下雨的窗边') >= 0,
    '出图 prompt 保留画面描述');
  eq(pageAgent.fallbackGradient('abc'), pageAgent.fallbackGradient('abc'), '渐变兜底可复现');
  eq(pageAgent.FALLBACK_GRADIENTS.length, 5, '内置 5 套兜底渐变');

  /* ---------------- 8b. API 报错人话化（2026-10-09：用户要求"API 的问题报错也要写清楚"） ---------------- */
  console.log('== 8b. llm 报错映射：状态码 → 人话 ==');
  const llm = await import(P('services/llm.js'));
  const fe = llm.friendlyStatusError;
  const DS = 'DeepSeek';
  assert(fe({ status: 401 }, DS).indexOf('密钥') >= 0 && fe({ status: 401 }, DS).indexOf('401') >= 0,
    '401 → 指出密钥问题：' + fe({ status: 401 }, DS).slice(0, 40) + '…');
  assert(fe({ status: 402, detail: 'Insufficient Balance' }, DS).indexOf('余额') >= 0
    && fe({ status: 402, detail: 'Insufficient Balance' }, DS).indexOf('Insufficient Balance') >= 0,
    '402 → 指出余额不足并带上服务商说明');
  assert(fe({ status: 404 }, DS).indexOf('地址') >= 0, '404 → 指出接口地址不对');
  assert(fe({ status: 429 }, DS).indexOf('频繁') >= 0 || fe({ status: 429 }, DS).indexOf('配额') >= 0,
    '429 → 指出限频/配额');
  assert(fe({ status: 503 }, DS).indexOf('服务器故障') >= 0, '5xx → 指出服务商故障');
  assert(fe({ status: 401 }, 'Kimi').indexOf('Kimi') >= 0, '报错带上服务商名');
  // retryable 标记：429/5xx/超时可重试，401/402 快速失败
  const http = await import(P('services/http.js'));
  const mk = (extra) => new http.ServiceError('x', extra);
  assert(mk({ status: 429 }).status === 429, 'ServiceError.status 顶层可读');
  assert(mk({ detail: 'oops' }).detail === 'oops', 'ServiceError.detail 顶层可读');
  // 超时错误必须带 timeout 标记（llm 据此翻译成"可重试"的人话）
  const timeoutErr = mk({ timeout: true });
  assert(timeoutErr.timeout === true, 'ServiceError.timeout 顶层可读');
  // extractJSON 容忍尾逗号（模型 JS 习惯写法）
  a = await withReply('{"say":"好了","commands":[{"op":"bg.set","args":{"preset":"sky"}},]}');
  assert(a.ok && a.commands[0].op === 'bg.set', 'JSON 尾逗号被容忍');

  /* ---------------- 9. 出图能力探测 ---------------- */
  console.log('== 9. 出图能力探测与渐变兜底 ==');  eq(imageGen.supportsImage(), true, 'openai 服务商支持出图');
  eq(imageGen.imageEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/images/generations',
    '出图地址归一');
  settings.set({ ai: { provider: 'deepseek' } });
  eq(imageGen.supportsImage(), false, 'deepseek 不支持出图（走渐变兜底）');
  assert(imageGen.imageGateReason().indexOf('不支持出图') >= 0, '给出可读的不可用原因');
  settings.set({ ai: { provider: 'openai' } });
  eq(imageGen.wantsImage('生成一张下雨的窗边背景'), true, '识别"生成一张…"');
  eq(imageGen.wantsImage('把背景换成蓝色'), false, '普通换色不触发出图');
  eq(imageGen.IMAGE_MODELS.length >= 2, true, '提供出图模型候选');

  /* ---------------- 10. 源码契约与红线 ---------------- */
  console.log('== 10. 源码契约与红线 ==');
  const homeSrc = R('pages/home/home.vue');
  const homeTpl = homeSrc.slice(0, homeSrc.indexOf('\n<script'));
  const homeSc = homeSrc.slice(homeSrc.indexOf('\n<script'), homeSrc.indexOf('\n<style'));
  assert(/v-for="\(c, i\) in renderCards"/.test(homeTpl), '首页按 pageDoc.cards 渲染');
  assert(/:mode="inputMode"/.test(homeTpl), '顶栏接入双模式');
  assert(/:busy="cmdBusy"/.test(homeTpl), '顶栏接入加载态');
  assert(/class="cmd-bar"/.test(homeTpl), '存在指令状态条');
  assert(/@tap="undoLast"/.test(homeTpl), '存在撤销入口');
  assert(/cmd-sug/.test(homeTpl), '存在指令示例胶囊');
  assert(/@search="onSubmit"/.test(homeTpl), '回车走统一分流入口');
  ['page-doc.js', 'page-command.js', 'intent.js', 'services/page-agent.js', 'app-card-blocks.vue']
    .forEach(f => assert(homeSc.indexOf(f) >= 0, 'home.vue 导入 ' + f));
  ['runCommand', 'undoLast', 'runEffects', 'doRewrite', 'onCardToggle', 'deleteAiCard',
    'onCardAction', 'refreshDoc', 'persistDoc', 'cardStyle'].forEach(m => {
    assert(new RegExp('\\b' + m + '\\s*\\(').test(homeSc), 'home.vue method ' + m);
  });
  assert(/pageCommand\.commit\(/.test(homeSc), '执行成功后走 commit（落盘 + 撤销栈）');
  assert(/pageCommand\.applyCommands\(/.test(homeSc), '走统一执行入口');
  // AI 卡按钮的跳转表：词库是 tabBar 页，必须走 switchTab，navigateTo 打不开
  assert(/library:\s*'\/pages\/library\/library'/.test(homeSc), '按钮动作表含词库页');
  assert(/TAB_PAGES/.test(homeSc) && /uni\.switchTab\(\{ url \}\)/.test(homeSc),
    'tabBar 页用 switchTab 打开（TAB_PAGES 白名单）');

  // 卡片内容渲染已收敛到 components/card-canvas.vue（设计规格 v2）；
  // app-card-blocks.vue 只是外壳 + 老块的兼容转接。
  const canvasSrc = R('components/card-canvas.vue');
  ['title', 'text', 'metric', 'progress', 'ring', 'checklist', 'list', 'kv',
    'quote', 'tags', 'chips', 'toggle', 'field', 'image', 'countdown',
    'button', 'divider', 'spacer'].forEach(k => {
    assert(canvasSrc.indexOf("it.kind === '" + k + "'") >= 0, '渲染器支持节点 ' + k);
  });
  assert(/@tap\.stop="onCheck/.test(canvasSrc), '清单可点勾选');
  assert(/this\.\$emit\('act'/.test(canvasSrc), '交互走事件（组件自己不执行副作用）');
  assert(/@input="onField/.test(canvasSrc), '输入框写入卡片 state');
  // 老卡片（只有扁平 blocks）必须还能渲染：外壳负责转成 design
  const shellSrc = R('components/app-card-blocks.vue');
  assert(/designOf\(/.test(shellSrc), '外壳把老 blocks 转成 design（向后兼容）');
  assert(/<card-canvas/.test(shellSrc), '外壳把渲染交给 card-canvas');
  assert(/this\.\$emit\('state'/.test(shellSrc), '卡片内状态通过事件回写');

  const navSrc = R('components/float-navbar/float-navbar.vue');
  assert(/mode:/.test(navSrc) && /busy:/.test(navSrc), 'float-navbar 支持 mode / busy');
  assert(/fnb-cmd-mode/.test(navSrc), '指令态有专属描边样式');

  // 红线：AI 链路里绝不能出现 eval / new Function / 直改 DOM / 写源码
  ['utils/page-schema.js', 'utils/page-doc.js', 'utils/page-command.js',
    'utils/card-spec.js', 'services/page-agent.js', 'services/image-gen.js',
    'components/app-card-blocks.vue', 'components/card-canvas.vue'].forEach(f => {
    const src = R(f);
    assert(!/\beval\s*\(/.test(src), f + ' 无 eval');
    assert(!/new\s+Function/.test(src), f + ' 无 new Function');
    assert(!/document\.(getElementById|querySelector|createElement|body)/.test(src), f + ' 不直接操作 DOM');
    assert(!/innerHTML/.test(src), f + ' 不写 innerHTML');
  });
  const schemaSrc = R('utils/page-schema.js');
  // promptManual(ops?) —— 带可选参数后仍是"手册由 schema 自己推导"
  assert(/function\s+promptManual\s*\(/.test(schemaSrc), '指令手册由 schema 推导（与实现同源）');
  assert(schema.promptManual().indexOf('card.add') >= 0, 'promptManual 输出可用指令');

  // theme.set{font} / {density} 必须真的有地方消费，否则就是"说了不生效"的假指令
  const themeSrc = R('utils/theme.js');
  assert(/FONT_STACKS/.test(themeSrc) && /DENSITY_GAP/.test(themeSrc), 'theme.js 定义字体/密度取值表');
  assert(/'--app-font'/.test(themeSrc) && /'--app-gap'/.test(themeSrc), 'rootStyle 下发 --app-font / --app-gap');
  assert(/FONT_STACKS\[currentFont\(\)\]/.test(themeSrc), 'rootStyle 按当前字体取值');
  // 变量挂在页面根节点上，CSS 变量只向下继承 → 消费方必须是 .app-root / .container，不能是 page
  const appCss = R('App.vue');
  const fontRule = appCss.match(/\.app-root,\s*\n?\.container,?\s*\n?\.?c?o?v?e?r?\s*\{[^}]*\}/);
  assert(!!fontRule && /var\(--app-font/.test(fontRule[0]), 'App.vue 在根节点类上消费 --app-font');
  const pageRule = appCss.match(/\bpage\s*\{[^}]*\}/);
  assert(!pageRule || !/--app-font/.test(pageRule[0]), 'page{} 里不能引用 --app-font（取不到值）');
  assert(/var\(--app-gap/.test(homeSrc), 'home.vue 消费 --app-gap（模块间距）');
  const st = theme.rootStyle();
  assert(typeof st['--app-font'] === 'string' && st['--app-font'].length > 0, 'rootStyle 返回 --app-font = ' + st['--app-font']);
  assert(/^\d+rpx$/.test(st['--app-gap']), 'rootStyle 返回 --app-gap = ' + st['--app-gap']);
  settings.set({ theme: { font: 'serif', density: 'compact' } });
  eq(theme.rootStyle()['--app-gap'], '14rpx', '紧凑密度间距 = 14rpx');
  assert(/serif|Songti/.test(theme.rootStyle()['--app-font']), '衬线字体生效');
  settings.set({ theme: { font: 'system', density: 'cozy' } });

  /* ============================================================
   * 11. 失败文案分层：UI 只许出现人话  （2026-10-09 截图：界面出现
   *     「card.add：首页最多 12 张卡片」—— 内部操作名 + 精确报错直接甩给用户）
   * ============================================================ */
  console.log('== 11. 失败文案：给人看的 reason / 给日志的 rawReason ==');
  // 这条正是截图里的原样复现路径：card.add 打上限 → applyCommands 失败 → home.vue 直接渲染 reason
  let full2 = pageDoc.defaultDoc();
  for (let i = 0; i < 20; i++) {
    const rr = pageCommand.applyCommands(full2, [{ op: 'card.add', args: { type: 'note', text: 'x' } }], {});
    if (rr.ok) full2 = rr.doc;
  }
  const capHit = pageCommand.applyCommands(full2, [{ op: 'card.add', args: { type: 'note', text: 'x' } }], {});
  assert(capHit.ok === false, '满卡时 card.add 失败');
  // 内部操作名绝不许出现在 reason 里（中文文案里也不许夹 'card.add'）
  assert(!/card\.add/.test(capHit.reason), 'reason 不含内部操作名：' + capHit.reason);
  assert(!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*：/.test(capHit.reason), 'reason 不以 op：开头：' + capHit.reason);
  // 必须告诉用户怎么办，而不是只报"不行"
  assert(/删掉|收纳/.test(capHit.reason), '满卡文案给出路（删掉 / 收纳）：' + capHit.reason);
  // 精确串仍然留着，排查时不用复现
  assert(capHit.rawReason === 'card.add：首页最多 ' + schema.LIMITS.MAX_CARDS + ' 张卡片',
    'rawReason 保留精确串：' + capHit.rawReason);

  // 上限按"显示中"的卡算：收纳起来的卡不该把位置占死（只能去删卡就成死路了）
  const hideOne = pageCommand.applyCommands(full2, [
    { op: 'card.hide', args: { target: { id: full2.cards[full2.cards.length - 1].id } } }
  ], {});
  assert(hideOne.ok, '收纳一张卡');
  const afterHide = pageCommand.applyCommands(hideOne.doc, [{ op: 'card.add', args: { type: 'note', text: 'y' } }], {});
  assert(afterHide.ok, '收纳后腾出位置，可以再加卡（上限只数显示中的卡）');
  eq(afterHide.doc.cards.length, schema.LIMITS.MAX_CARDS + 1, '收纳不删卡，卡片总数可以超过上限');

  // 目标找不到：文案要指路，且不带 op 名
  const noCard = pageCommand.applyCommands(full2, [
    { op: 'card.remove', args: { target: { id: '不存在的卡' } } }
  ], {});
  assert(noCard.ok === false && noCard.reason.indexOf('没找到') >= 0, '找不到卡片时 reason 可读：' + noCard.reason);
  assert(!/card\.remove/.test(noCard.reason), '找不到卡片的 reason 不带 op 名');
  assert(/card\.remove/.test(noCard.rawReason), 'rawReason 带 op 名，便于定位');

  // 未知 op 直接进 run（applyCommands 会被 schema 先挡掉）
  const unknown = pageCommand.run(pageDoc.defaultDoc(), [{ op: 'nope.do', args: {} }], {});
  assert(unknown.ok === false && !/nope\.do/.test(unknown.reason), '未知指令的 reason 不提 op 名：' + unknown.reason);
  assert(unknown.rawReason.indexOf('nope.do') >= 0, '未知指令的 rawReason 带 op 名');

  // schema 校验没过（applyCommands 第一道门）同样只上人话
  const badRaw = pageCommand.applyCommands(pageDoc.defaultDoc(), [{ op: 'card.add', args: { type: '不存在的类型' } }], {});
  if (badRaw.ok === false) {
    assert(!/^第 \d+ 条：/.test(badRaw.reason) && !/card\.add/.test(badRaw.reason),
      '校验失败的 reason 不带「第 n 条：op：」前缀：' + badRaw.reason);
    assert(badRaw.rawReason.length > 0, '校验失败也保留 rawReason');
  }

  // 静态护栏：不许再写出「reason: cmd.op + '：' …」这种把 op 名拼进 UI 的代码。
  // 扫之前必须剥掉注释 —— 说明性注释里正引用了这个旧写法（踩过：被自己的注释判红）。
  const cmdSrc = R('utils/page-command.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert(!/reason:\s*cmd\.op/.test(cmdSrc), '源码里没有 reason: cmd.op 拼接（防止文案回退）');
  // 实现里抛异常的兜底也要走人话分支
  assert(/fail\(\s*String\(\(e && e\.message\)/.test(cmdSrc), '指令抛异常的兜底同样产出人话');
  // home.vue 侧：失败时打日志用 rawReason，界面用 reason
  assert(/res\.rawReason/.test(homeSrc), 'home.vue 用 rawReason 打日志');
  assert(/this\.cmdError\s*=\s*res\.reason/.test(homeSrc), 'home.vue 界面显示 res.reason');
  // 部分成功（有指令被跳过）必须说出来，不能只报成功摘要
  assert(/this\.cmdError\s*=\s*r\.error/.test(homeSrc), 'home.vue 接住 plan 的「有指令被跳过」提示');
  assert(/没做到/.test(homeSrc), '指令条对部分成功给出说明文案');

  // 模型侧也要提前知道装不装得下 —— 不写进 prompt，它就照常吐 card.add 撞我们的报错，
  // 用户看到的还是"指令失败"；写进去它就会 commands 为空 + say 里解释。
  const digestFull = pageAgent.docDigest(full2);
  assert(digestFull.indexOf('显示中 ' + schema.LIMITS.MAX_CARDS + ' / 上限 ' + schema.LIMITS.MAX_CARDS) >= 0,
    'docDigest 报出「显示中 n / 上限 m」');
  assert(/已满/.test(digestFull), '满卡时 digest 明说已满（模型据此改说人话）');
  assert(!/已满/.test(pageAgent.docDigest(pageDoc.defaultDoc())), '没满时不吓模型');

  console.log('');
  console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})();
