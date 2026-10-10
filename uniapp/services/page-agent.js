// services/page-agent.js - 自然语言 → 指令序列
//
// 这是 AI 唯一"说话"的地方：它只输出一份 JSON 信封
//   { "say": "给用户的一句话说明", "commands": [ {op, args}, ... ] }
// JSON 解析、op 白名单、参数夹取全部交给 utils/page-schema，
// 所以模型再怎么胡说，最多是"这条指令被跳过"，不可能改到页面之外。
//
// 未配置 / 请求失败 / 解析不出来，一律返回 ok:false + 人话 error，由页面提示。

import { chatCompletion } from './llm.js';
import { isAIUsable, aiGateReason } from './config.js';
import * as schema from '../utils/page-schema.js';
import * as pageDoc from '../utils/page-doc.js';
import * as imageGen from './image-gen.js';
import * as wordbook from '../utils/wordbook.js';
import { featureOn } from './ai-gate.js';

const MAX_ATTEMPTS = 3;
const MAX_INPUT = 200;

// ---------- 与 ai-content.js 同源的容错抽取 ----------
function extractJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  let start = -1;
  let close = '';
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) { start = objStart; close = '}'; }
  else if (arrStart >= 0) { start = arrStart; close = ']'; }
  if (start < 0) return null;
  const slice = s.slice(start, s.lastIndexOf(close) + 1);
  if (s.lastIndexOf(close) < start) return null;
  // 先按标准 JSON 解析；失败再容忍一次尾逗号（模型常写 {"a":1,} 这种 JS 习惯）
  try { return JSON.parse(slice); } catch (e) {}
  try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
}

// ---------- 当前页面状态摘要（喂给模型） ----------
export function docDigest(doc, live) {
  const d = doc || pageDoc.get();
  const lv = live || pageDoc.liveValues();
  const all = d.cards || [];
  const cards = all.map((c, i) => {
    return '#' + i + ' ' + c.id + ' type=' + c.type +
      (c.builtin ? ' 内置' : ' AI') +
      (c.visible === false ? ' 已隐藏' : '') +
      (c.title ? ' 标题「' + c.title + '」' : '') +
      (c.text ? ' 文案「' + String(c.text).slice(0, 30) + '」' : '');
  });
  // 上限按"显示中"的卡算（收纳 = visible:false 不占位置，见 page-command 的 visibleCount）。
  // 这一句必须写进 digest：不告诉模型它就会照常吐 card.add，然后指令在我们的
  // 执行层被打回，用户看到的是一条报错；写进去它就知道该说人话（commands 为空 + say 说明）。
  const shown = all.filter(c => c.visible !== false).length;
  const cap = schema.LIMITS.MAX_CARDS;
  const bg = d.background || {};
  const th = d.theme || {};
  return [
    '【当前首页】卡片共 ' + all.length + ' 张（显示中 ' + shown + ' / 上限 ' + cap + ' 张' +
      (shown >= cap ? '，已满 —— 想加新卡必须先删掉或收纳一张，做不到就在 say 里说明' : '') + '）：',
    cards.join('\n'),
    '',
    '背景：preset=' + (bg.preset || 'default') +
      (bg.gradient ? ' gradient=' + bg.gradient.from + '→' + bg.gradient.to : '') +
      (bg.image ? ' 有自定义图' : '') + ' mask=' + (bg.mask == null ? 0.35 : bg.mask),
    '主题：accent=' + (th.accent || '默认') + ' dark=' + (th.dark == null ? '跟随系统' : th.dark) +
      ' font=' + (th.font || '默认') + ' density=' + (th.density || '默认'),
    '',
    '【真实学习数据】（造卡时用 {{live.字段}} 绑定，别编数字）：' +
      '今日题量=' + lv.todayTotal + '，今日答对=' + lv.todayCorrect +
      '，正确率=' + lv.accuracy + '%，错题=' + lv.wrongCount +
      '，连续天数=' + lv.streak + '（最长 ' + lv.longestStreak + '）' +
      '，已掌握=' + lv.mastered + '/' + lv.wordCount +
      '，今日新词=' + lv.newWordsDone + '/' + lv.newWordsTarget +
      '，今日练习=' + lv.practiceDone + '/' + lv.practiceTarget +
      '，词书=' + (lv.bookName || '（未选）') + '，当前批次=' + (lv.batchName || '—') +
      ' ' + lv.batchDone + '/' + lv.batchTotal +
      '，今日停留=' + lv.usageToday + ' 分钟，日均=' + lv.usageAvg + ' 分钟',
    '',
    '【可选词书】（book.switch 只能从这里面挑，不要编书名）：' + (bookOptions() || '（读不到词书列表）')
  ].join('\n');
}

/**
 * 可选词书清单（喂给模型）。
 * 没有它，模型只能靠训练数据里的印象猜书名 —— "换成四级词书" 会被编成
 * 「CET-4 Vocabulary」之类我们这儿不存在的名字，book.switch 匹配不上就报错。
 */
function bookOptions() {
  try {
    const list = wordbook.listBooks() || [];
    return list.map(b => b.name + (b.current ? '（当前）' : '')).join('、');
  } catch (e) {
    return '';
  }
}

/* ============================================================
 * 本地意图路由：先用关键词猜出可能用到的 op，只把对应手册发给模型
 * ============================================================
 * 整份手册 3702 字符，其中 61% 是 card.design 专属的卡片设计说明书，
 * 而"把背景换成海边"这种请求根本用不到它。本地先粗筛一遍，
 * 只发子集 → 单次请求省掉约 2/3 token。
 *
 * 安全底线：任何拿不准的情况一律回退全量（ops=null），
 * 宁可多花 token，也绝不因为路由猜错而让用户"这个改不了"。
 */
const ROUTE_RULES = [
  { keys: ['背景', '壁纸', '底色', '渐变', '配色', '氛围', '心情', '蒙版', '模糊', '护眼', '海边', '天空', '森林'], ops: ['bg.set'] },
  { keys: ['主题', '深色', '夜间', '暗色', '亮色', '字体', '衬线', '圆体', '动效', '动画', '密度', '紧凑', '宽松'], ops: ['theme.set'] },
  // ⚠️ 这里的关键词必须和 utils/intent.js 的 VERB_DEL 保持一致（收纳/收起来/收掉 都要有）。
  // 两张表不同步就会出现"意图判成指令，但手册里没给它该用的 op"——
  // 「去掉主页所有卡片」那个 bug 正是这么来的（手册说只有 style.* 能用 all，
  // 而这组 op 里根本没有 style.*）。
  { keys: ['删除', '删掉', '删了', '删去', '去掉', '移除', '不要', '隐藏', '显示', '藏起来', '收纳', '收起来', '收掉', '移动', '换到', '顺序', '位置', '调到', '恢复', '默认', '还原', '重置'], ops: ['card.remove', 'card.hide', 'card.show', 'card.move', 'card.restore', 'card.reset'] },
  { keys: ['文案', '文字', '标题', '改成', '写成', '换句', '语气', '改写', '幽默', '正式', '活泼', '温柔', '鼓励', '简洁', '那句话'], ops: ['text.set', 'text.rewrite', 'style.text'] },
  { keys: ['样式', '字号', '字大', '字小', '颜色', '圆角', '透明', '边距', '对齐', '居中', '加粗', '描边', '投影'], ops: ['style.card', 'style.text'] },
  // ⚠️ '每天' 必须和 intent.js 同步（那边 DOMAIN_WORDS 刚补了它）。
  // 不同步的后果老样子：判成指令，但手册里没给 goal.set → 模型只能瞎猜或空手而归。
  { keys: ['目标', '每日', '每天', '计划', '任务量'], ops: ['goal.set'] },
  // 词书类：book.switch 是 2026-10-10 才有的指令，关键词必须和 intent.js 的
  // LEARN_WORDS 同步（那边收了 '词汇' / '词书'），否则又会出现"判成指令但手册没给 op"。
  { keys: ['词书', '词汇', '换本', '换一本', '考研', '四级', '六级', '专升本', '高考', '中考'], ops: ['book.switch'] },
  { keys: ['快照', '存成', '保存', '应用', '换回', '方案'], ops: ['skin.save', 'skin.apply'] },
  { keys: ['考试', '通勤', '睡前', '专注', '场景', '模式'], ops: ['macro.run'] },
  { keys: ['朗读', '读出来', '念', '播报', '说一句'], ops: ['page.announce'] },
  { keys: ['图片', '配图', '插画', '贴图', '换图', '画'], ops: ['image.set', 'bg.set'] }
];

// 出现这些词 → 用户想"造/改一张排版讲究的卡"，必须带上 card.design 及其说明书。
// 注意这里不放「卡片」这种中性词 —— "把第 2 张卡片删掉"只是删除，
// 带上 2244 字符的设计说明书纯属浪费。
const DESIGN_HINTS = ['设计', '排版', '布局', '造', '做一张', '加一张', '加个', '新增', '来一张', '分栏', '两栏', '多栏', '分区', '统计卡', '清单', '倒计时'];

// 造卡类请求够用的最小 op 集
const STRUCTURE_OPS = ['card.add', 'card.design', 'card.remove', 'card.hide', 'card.show', 'card.move', 'card.restore', 'card.reset', 'text.set', 'style.card'];

/**
 * @param {string} text
 * @returns {{ops: string[]|null, groups: number, design: boolean}} ops 为 null 表示发全量
 */
export function routeOps(text) {
  const s = String(text || '');
  if (!s) return { ops: null, groups: 0, design: false };
  const hit = [];
  let groups = 0;
  ROUTE_RULES.forEach(r => {
    if (r.keys.some(k => s.indexOf(k) >= 0)) { hit.push.apply(hit, r.ops); groups++; }
  });
  const design = DESIGN_HINTS.some(k => s.indexOf(k) >= 0);
  // 复合意图（≥2 组）→ 全量，避免漏掉"…顺便再把…"那半句
  if (groups >= 2) return { ops: null, groups: groups, design: design };

  const ops = hit.slice();
  if (design) {
    STRUCTURE_OPS.forEach(op => { if (ops.indexOf(op) < 0) ops.push(op); });
  }
  // 一组都没命中：只有明确的"造卡"意图才敢给子集，否则一律全量 ——
  // 猜错让用户"这个改不了"，比多花几千 token 贵得多
  if (!ops.length) return { ops: null, groups: groups, design: design };
  return { ops: ops, groups: groups, design: design };
}

// ---------- System Prompt ----------
export function systemPrompt(doc, live, extraRule, ops) {
  return [
    '你是「背单词」App 首页的页面编辑助手。用户用自然语言描述想要的改动，你把它翻译成指令序列。',
    '',
    '硬性规则（违反即失败）：',
    '1. 只能输出 JSON，不要 markdown 代码块，不要任何解释文字。',
    '2. 只能使用下面列出的 op，绝不发明新 op；参数只能用列出的取值。',
    '3. 不许输出代码、CSS、HTML、表达式，不许要求操作 DOM 或改源码。',
    '4. 参数取值越界会被自动夹取，所以你不必纠结精确值，但要挑合理的档位。',
    '5. 指令要少而准：能 1 条做完别拆成 3 条；做不到就 commands 为空数组，并在 say 里说明原因。',
    '6. 卡片文案、标题请使用简体中文，长度克制（标题 ≤ 12 字）。',
    '7. 涉及真实学习数据的展示，一律用 live 绑定，不要写死数字。',
    '8. 想造一张"排版讲究"的卡片（多栏、卡片内分区、有底色、带交互）时，优先用 card.design，',
    '   它比 card.add 自由得多；简单的一两句话小卡才用 card.add。',
    '9. card.design 新建卡片时省略 target（不要写 target:"" 或 null）；要改造某张现有卡片才给 target。',
    '',
    // 下面这几条专门治"很多问题回答不了"。
    // 实测 66 条真实口语里有 29 条压根没有 op 能表达（问学习数据、出练习题、换词书、
    // 设提醒、换语言、导出数据…）。以前模型只会回"这个我还改不了"，
    // 用户看到的就是一句冰冷的拒绝 —— 但它手里其实握着【真实学习数据】，
    // 也知道别的页面能干什么。把这两件事写进规则，回答率能救回一大半。
    '面对问句（不是"帮我改点什么"）时的处理：',
    '10. 用户问学习数据（今天学了多少 / 掌握多少 / 连续几天 / 还有多少没背 / 最近状态如何），',
    '    commands 必须是空数组，把答案写进 say。数字只准取自下面【真实学习数据】，一个都不许编。',
    '    答不上来的字段就说"这个我没有数据"，别猜。',
    '11. 用户想做的事这里没有对应指令（出题 / 加生词本 / 定时提醒 / 换界面语言 / 导出数据 / 讲某个单词），',
    '    commands 必须是空数组，在 say 里直接告诉他去哪儿做：',
    '    出题练习→练习页；刷单词→刷单词页；查词 / 生词本→词库页；学习总结 / 曲线→统计页；',
    '    定时提醒 / 界面语言 / 数据导出导入→设置页；用英文聊天 / 问单词怎么用→对话陪练页；错题→复习列表页。',
    '12. 硬凑一条不相关的指令比空指令糟糕得多 —— 那会把首页改成用户根本没要的样子。',
    '    拿不准就 commands 为空，用 say 说清"能做的是什么 / 该去哪儿"。',
    // 出图相关的临时规则放最后：它只在 wantsImage() 命中时才出现，
    // 编号跟着上面走，不要跟 10/11/12 撞号（撞号会让模型不知道该听哪条）。
    extraRule ? ('13. ' + extraRule) : '',
    '',
    (ops && ops.length) ? '本次只列出与这个请求相关的指令（不见的指令本次用不到）。' : '',
    schema.promptManual(ops),
    '',
    '输出格式（严格）：',
    '{"say":"一句话说明你做了什么（≤40字，给用户看）","commands":[{"op":"card.add","args":{...}}]}',
    '',
    docDigest(doc, live)
  ].filter(Boolean).join('\n');
}

// ---------- 信封校验 ----------
function pickCommands(env) {
  if (!env) return null;
  if (Array.isArray(env)) return env;                       // 直接给数组也接受
  if (Array.isArray(env.commands)) return env.commands;
  if (Array.isArray(env.ops)) return env.ops;
  return null;
}

function pickSay(env) {
  if (!env || Array.isArray(env)) return '';
  return String(env.say || env.message || env.note || '').slice(0, 120);
}

/**
 * 校验失败的原因翻成人话。
 *
 * schema 给的是开发者视角的精确报错（"bg.set：preset：取值必须是 default / sky / …"），
 * 它有两个用途：① 回喂给模型让它改（这个必须精确，别动）；② 显示给用户（这个必须是人话）。
 * 以前两者共用一个字符串，用户就在搜索栏底下看到了一串字段名和枚举值 ——
 * 既看不懂，也没法据此换一种说法。
 */
function humanizeError(reason) {
  const s = String(reason || '');
  if (!s) return '这个我还改不了，换个说法试试';
  if (s.indexOf('取值必须是') >= 0) {
    return '这个说法我这边没有对应的选项，换个更常见的说法再试试。';
  }
  if (s.indexOf('需要指明要改哪张卡片') >= 0) {
    return '说清楚要改哪张卡片 —— 可以说「最后一张」「第2张」，或直接写卡片标题。';
  }
  if (s.indexOf('缺少必填') >= 0 || s.indexOf('缺少') >= 0) {
    return '这条指令缺了关键信息 —— 说清楚要改哪张卡、改成什么。';
  }
  if (s.indexOf('未知指令') >= 0) {
    return '这个操作我还不会做。';
  }
  if (s.indexOf('指令序列为空') >= 0) {
    return '我没听懂这条指令，换个说法再试试。';
  }
  if (s.indexOf('没有解析到 JSON') >= 0 || s.indexOf('模型返回异常') >= 0) {
    return 'AI 这次没给出能用的结果，再试一次或换个说法。';
  }
  return '这条指令我没能解析成合法操作，换个说法再试试。';
}

// 只有用户确实在描述"想要什么样的背景"时才敢替他补 mood。
// 不能无条件补：'把背景图去掉' 归一化后同样是"四个字段全空"，
// 补上 mood 反而会凭空铺一层渐变 —— 那比什么都不做更糟。
const BG_MOOD_HINT = [
  '蓝', '绿', '粉', '紫', '黄', '金', '红', '橙', '青', '灰', '黑', '白',
  '暖', '冷', '深色', '浅色', '暗', '明亮', '安静', '宁静', '沉静', '温柔',
  '活泼', '清爽', '清新', '治愈', '氛围', '心情', '渐变'
];

/**
 * bg.set 兜底：模型把"安静的蓝色渐变"这类描述整个丢掉时，
 * 归一化后 preset / mood / gradient / image 会全空 —— 指令"执行成功"，页面却一个像素没变，
 * 用户看到的是"它说改好了，但什么都没发生"。
 * 这里用用户原话补一个 mood（moodPreset 按关键词映射渐变，带颜色词兜底），让请求不落空。
 */
function fillBgMood(commands, input) {
  const raw = String(input || '');
  const text = raw.slice(0, 20);
  if (!text || !BG_MOOD_HINT.some(k => raw.indexOf(k) >= 0)) return commands;
  return commands.map(c => {
    if (!c || c.op !== 'bg.set') return c;
    const a = c.args || {};
    // 已经有能落地的东西（预设 / 心情 / 渐变 / 换图），或者只是调蒙版模糊，就别插手
    if (a.preset || a.mood || a.image || (a.gradient && a.gradient.from)) return c;
    if (a.mask !== null && a.mask !== undefined) return c;
    if (a.blur !== null && a.blur !== undefined) return c;
    return Object.assign({}, c, { args: Object.assign({}, a, { mood: text }) });
  });
}

/**
 * 自然语言 → 指令序列
 * @param {string} text 用户输入
 * @param {object} doc 当前 pageDoc
 * @param {object} opt { live, timeout, onAttempt }
 * @returns {Promise<{ok, commands, say, error, attempts, image}>}
 */
export async function plan(text, doc, opt) {
  const o = opt || {};
  const input = String(text || '').trim().slice(0, MAX_INPUT);
  const cur = doc || pageDoc.get();
  if (!input) return { ok: false, commands: [], say: '', error: '说点什么吧', attempts: 0 };
  // 分项开关：用户在设置里关掉「首页 AI 指令」后，这里连一次模型都不该调
  if (!featureOn('command')) {
    return { ok: false, commands: [], say: '', error: 'AI 指令已关闭，可在「设置 › AI › AI 功能」里打开', attempts: 0 };
  }
  const gate = aiGateReason();
  if (gate) return { ok: false, commands: [], say: '', error: gate + '，指令功能暂不可用', attempts: 0 };

  const live = o.live || pageDoc.liveValues();

  // ---- 前置：要不要真的出一张图 ----
  let extraRule = '';
  let image = null;
  if (imageGen.wantsImage(input)) {
    if (imageGen.supportsImage()) {
      // 出图是"锦上添花"：这一步无论出什么岔子都不能拖垮后面的指令解析
      let g = null;
      try {
        g = await imageGen.generate(aiImagePrompt(input));
      } catch (e) {
        g = null;
      }
      if (g && g.path) {
        image = g;
        extraRule = '已为你生成好一张背景图，直接用 bg.set 的 image 参数引用这个本地路径：' + g.path;
      } else {
        extraRule = '图片接口这次没出图，请改用 bg.set 的 gradient（两个和谐的颜色）或 mood 来表达画面氛围。';
      }
    } else {
      extraRule = '当前服务商不支持出图。请只用 bg.set 的 gradient（from/to 两个颜色 + angle）或 mood 来表达用户想要的画面氛围，不要给 image 参数。';
    }
  }

  const route = routeOps(input);
  const sysMsg = { role: 'system', content: systemPrompt(cur, live, extraRule, route.ops) };
  let lastError = '';
  let attempts = 0;
  // 超时 30s：DeepSeek 高峰期一个 4000 字 system prompt 的请求 20s 经常不够
  const timeoutMs = o.timeout || 30000;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts++;
    if (o.onAttempt) o.onAttempt(attempts);
    // 每轮都是 system + 一条 user：重试不累积上一轮的 assistant 回复。
    // 那份 JSON 又长又没用，累积下去第 2 次请求的 token 接近翻倍，
    // 而"上次错在哪"已经写进这条 user 的 '上次输出有问题：' 里了。
    // API 层面的瞬时错误（超时 / 限频 / 5xx）不带 feedback —— 那不是模型输出的问题。
    const messages = [
      sysMsg,
      { role: 'user', content: lastError ? (input + '\n\n上次输出有问题：' + lastError + '\n请修正后重新输出纯 JSON。') : input }
    ];

    let content = '';
    try {
      const r = await chatCompletion(messages, { temperature: 0.3, timeout: timeoutMs });
      content = r.content || '';
    } catch (e) {
      const msg = (e && e.message) || 'AI 请求失败';
      // 超时 / 限频 / 服务商故障 → 换一轮再试；密钥错、余额空这类配置问题重试也没用，立刻失败
      if (!(e && e.retryable) || i === MAX_ATTEMPTS - 1) {
        return { ok: false, commands: [], say: '', error: msg, attempts: attempts };
      }
      lastError = '';
      continue;
    }

    const env = extractJSON(content);
    const rawCmds = pickCommands(env);
    if (!rawCmds) {
      lastError = '没有解析到 JSON（需要 {"say":...,"commands":[...]}）';
      continue;
    }
    if (!rawCmds.length) {
      // 模型明确"只回答、不改页面"：这不是错误。
      // answered=true 让界面走普通气泡而不是红色报错条 —— 用户问「我今天学了多少」
      // 拿到一句回答，跟"指令执行失败"是两回事，不该共用同一套红字。
      const say = pickSay(env);
      return {
        ok: false,
        commands: [],
        say: say,
        error: say || '这个我还改不了',
        answered: !!say,
        attempts: attempts,
        image: image
      };
    }
    const n = schema.normalizeCommands(rawCmds);
    if (!n.ok) {
      lastError = n.errors.join('；');
      continue;
    }
    return {
      ok: true,
      commands: fillBgMood(n.commands, input),
      say: pickSay(env),
      // 部分指令被跳过时也要说人话（校验原因只回喂给模型用，不往界面上甩）
      error: n.errors.length ? humanizeError(n.errors.join('；')) : '',
      attempts: attempts,
      image: image
    };
  }

  // 三次都失败了才走到这里。lastError 是给模型看的精确报错，
  // 直接展示给用户就是"第 1 条：bg.set：preset：取值必须是 …"这种天书。
  try { console.warn('[page-agent] 指令解析连续失败：', lastError) } catch (e) {}
  return {
    ok: false,
    commands: [],
    say: '',
    error: lastError ? humanizeError(lastError) : '连续几次都没解析成功，换个说法试试',
    attempts: attempts
  };
}

/** 把中文的画面描述压成一句适合出图模型的英文 prompt */
export function aiImagePrompt(text) {
  const s = String(text || '').trim();
  const cleaned = s
    .replace(/帮我把|帮我将|帮我|请帮|请把|请将|请让|给我/g, '')
    .replace(/换成|改成|改为|变成|设置为|设置成|生成一张|生成个|画一张|画个|来张图|来一张图/g, '')
    .replace(/背景|壁纸|图片/g, '')
    .trim();
  const base = cleaned || s;
  return [
    'A soft, minimal, low-saturation vertical background for a study app.',
    'Subject mood: ' + base.slice(0, 120) + '.',
    'No text, no letters, no UI elements, no people faces, gentle gradient-friendly composition, plenty of empty space at the top.'
  ].join(' ');
}

/* ============================================================
 * 附带的小模型能力：文案改写 / 背景配色描述
 * ============================================================ */

/**
 * 按语气改写一段文案（text.rewrite 的异步副作用）
 * @returns {Promise<string>} 改写后的文案；失败返回 ''
 */
export async function rewrite(text, tone, instruction) {
  const src = String(text || '').trim();
  if (!src || !featureOn('command')) return '';
  if (!isAIUsable()) return '';
  const tips = {
    '简洁': '更短更直接', '正式': '书面、克制', '活泼': '轻松有元气',
    '温柔': '柔和体贴', '鼓励': '给人打气', '幽默': '一点点俏皮'
  };
  const t = tips[tone] || '简洁';
  const prompt = [
    '把下面这句 App 首页文案改写得' + t + '，保持原意，简体中文，不超过 40 字，只输出改写结果本身：',
    instruction ? '补充要求：' + instruction : '',
    '原文：' + src
  ].filter(Boolean).join('\n');
  try {
    const r = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: 0.8, timeout: 15000 }
    );
    const out = String(r.content || '').trim().replace(/^["'「」]|["'「」]$/g, '');
    return out.slice(0, 120) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 背景配色描述：出图不可用时的兜底
 * @returns {Promise<{from,to,angle,accent}|null>}
 */
export async function describeBackground(text) {
  const s = String(text || '').trim();
  if (!s || !featureOn('image') || !isAIUsable()) return null;
  const prompt = [
    '用户想要这样的首页背景氛围：' + s,
    '请给出最贴切的一组配色，只输出 JSON：',
    '{"from":"#RRGGBB","to":"#RRGGBB","angle":165,"accent":"blue|teal|green|purple|amber|rose|graphite 之一","name":"四个字以内的氛围名"}',
    '要求：低饱和、护眼、适合做学习类 App 的背景渐变，两个颜色明度接近。'
  ].join('\n');
  try {
    const r = await chatCompletion([{ role: 'user', content: prompt }], { temperature: 0.6, timeout: 15000 });
    const o = extractJSON(r.content);
    if (!o || !o.from || !o.to) return null;
    const from = schema.vColor('')(o.from);
    const to = schema.vColor('')(o.to);
    if (!from.ok || !to.ok) return null;
    const accent = schema.vEnum(schema.ACCENTS, '')(o.accent);
    return {
      from: from.value,
      to: to.value,
      angle: schema.vInt(0, 360, 165)(o.angle).value,
      accent: accent.value || '',
      name: String(o.name || '').slice(0, 8)
    };
  } catch (e) {
    return null;
  }
}

/** 本地兜底配色：模型也没给出来时用（与 moodPreset 不重复，这里更"保守护眼"） */
export const FALLBACK_GRADIENTS = [
  { from: '#dbeafe', to: '#eef2ff', angle: 165, accent: 'blue' },
  { from: '#dcfce7', to: '#ecfdf5', angle: 175, accent: 'green' },
  { from: '#f5f3ff', to: '#fdf4ff', angle: 155, accent: 'purple' },
  { from: '#fef3c7', to: '#fff7ed', angle: 150, accent: 'amber' },
  { from: '#e2e8f0', to: '#f1f5f9', angle: 180, accent: 'graphite' }
];

export function fallbackGradient(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(h) % FALLBACK_GRADIENTS.length];
}
