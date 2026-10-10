// utils/intent.js - 首页输入框意图识别：这是「搜索」还是「指令」？
//
// 纯函数、零依赖，方便单测。策略是"规则优先 + 兜底搜索"：
//   1) 显式前缀（/、#、指令：）→ 一定是命令
//   2) 出现祈使动词 / 页面变更词 → 命令
//   3) 纯 ASCII 短词、或短中文且没有任何变更意图 → 搜索
//   4) 含糊地带 → 搜索（搜错只是没结果，误判成命令会去改页面，代价大得多）
//
// 判定只影响"走哪条路"，不影响安全性：即使用户强制当命令解析，
// 最终也要过 page-schema 白名单，改不动的东西照样改不动。

const MAX_INPUT = 200;

// ---------- 强制前缀 ----------
// '/' 走指令（slash command 的习惯）；':' 也当指令；'@' 是"艾特 AI"，同样走指令
// '#' 走强制搜索（想查一个恰好长得像指令的词时用）
const CMD_PREFIX = /^[\/:@]/;
const SEARCH_PREFIX = /^#/;

// ---------- 祈使 / 使役词：句子里出现这些，基本就是让 AI 干点什么 ----------
const IMPERATIVE = [
  '帮我把', '帮我将', '帮我', '请帮', '请把', '请将', '请让', '请给', '给我', '给我来',
  '我要', '我想', '我想要', '能否', '可不可以', '能不能', '能不能帮', '麻烦',
  '让首页', '让页面', '让卡片', '把首页', '把页面', '把卡片', '把背景', '把主题',
  '将首页', '将页面', '将背景', '将主题'
];

// ---------- 变更动词 ----------
const VERB_CHANGE = ['改成', '换成', '改为', '换为', '变成', '变为', '设置为', '设置成', '调成', '调到', '调整成', '调整为', '调高', '调低', '调大', '调小'];
const VERB_ADD = ['添加', '新增', '加上', '加一个', '加个', '加一张', '加一张卡', 'create', 'add'];
// ⚠️ 收纳/收起来/藏起来 是**界面自己的说法**（首页「收纳」按钮、收纳区），
// 用户会照着说。以前只有 删除/隐藏 在表里，"卡片全收起来"只能命中「页面域」(+2)，
// 够不到 4 分阈值 → 被判成查词。'不要' 也补上（page-agent 的路由表一直认它，
// 两边关键词表不一致正是今天「去掉所有卡片」那个 bug 的同类成因）。
const VERB_DEL = ['删除', '移除', '去掉', '去掉那', '隐藏', '隐藏掉', '删掉', '删了', '删去',
  '收纳', '收起来', '收掉', '藏起来', '不要', 'remove', 'delete', 'hide'];
const VERB_MOVE = ['移动', '挪到', '放到', '排到', '调到最', '置顶', '移到', '排序', '整理一下'];
const VERB_RESET = ['重置', '恢复默认', '还原', '撤销上一步', '撤回到'];
// 场景切换："进入沉浸专注模式" 这类没有具体变更动词，但明显是在下指令
const VERB_SCENE = ['模式', '进入', '切换到', '来一套', '整成', '氛围感'];

// ---------- 页面域名词 ----------
const DOMAIN_WORDS = [
  '首页', '页面', '卡片', '卡片样式', '背景', '壁纸', '主题', '配色', '字体', '字号',
  '动效', '动画', '圆角', '透明度', '间距', '密度', '深色', '夜间', '暗色', '明亮',
  '每日目标', '每日新词', '目标', '倒计时', '清单', '待办', '便签', '打卡',
  '心情', '氛围', '沉浸', '专注', '场景'
];

// ---------- 搜索味儿很重的信号 ----------
// 查词：单词本身 + 典型查词问法
const LOOKUP_HINT = ['是什么意思', '什么意思', '啥意思', '怎么读', '怎么用', '查一下', '查查', '查询', '搜一下', '搜搜', '什么意思啊'];

// 纯英文/数字判定
const ASCII_WORD = /^[A-Za-z][A-Za-z'\-]*$/;
const ASCII_ANY = /^[\x20-\x7f]+$/;

function hasAny(s, list) {
  for (let i = 0; i < list.length; i++) {
    if (s.indexOf(list[i]) >= 0) return true;
  }
  return false;
}

/** 去掉前后空白与强制前缀，返回 { text, forced:'command'|'search'|'' } */
function stripPrefix(raw) {
  const s = String(raw == null ? '' : raw).trim().slice(0, MAX_INPUT);
  if (!s) return { text: '', forced: '' };
  if (SEARCH_PREFIX.test(s)) return { text: s.slice(1).trim(), forced: 'search' };
  if (CMD_PREFIX.test(s)) {
    let t = s.slice(1).trim();
    // '@AI 把背景换成蓝色' → 顺手把开头的 "AI" 也剥掉，剩下的才是真正的指令正文
    if (s.charAt(0) === '@') t = t.replace(/^ai\b[\s:：,，]*/i, '');
    return { text: t, forced: 'command' };
  }
  return { text: s, forced: '' };
}

/**
 * 判定输入意图
 * @param {string} raw 用户输入
 * @returns { mode:'command'|'search', score, why, text, forced:''|'command'|'search' }
 *   text 是去掉强制前缀后的正文（搜索关键字 / 指令原文）
 *   forced 非空表示用户用了显式前缀强行指定，优先级高于自动判定与手动锁定
 */
export function detect(raw) {
  const p = stripPrefix(raw);
  const text = p.text;
  if (!text) return { mode: 'search', score: 0, why: '空输入', text: '', forced: '' };

  // 1) 显式前缀最可靠
  if (p.forced === 'command') return { mode: 'command', score: 100, why: '以 / : @ 开头', text: text, forced: 'command' };
  if (p.forced === 'search') return { mode: 'search', score: 100, why: '以 # 开头', text: text, forced: 'search' };

  const lower = text.toLowerCase();
  let score = 0;
  const hits = [];

  // ⚠️ 一律用 lower 而不是 text：VERB_* 里混着 'remove' / 'delete' / 'hide' / 'add' 这些
  // 英文关键词，而 hasAny 是**大小写敏感**的 indexOf。以前 lower 是算出来却没用的死变量，
  // 结果 "Hide the chart card"（句首大写）只能拿 0 分被判成查词，全小写的 "hide…" 才认。
  if (hasAny(lower, IMPERATIVE)) { score += 3; hits.push('使役'); }
  if (hasAny(lower, VERB_CHANGE)) { score += 4; hits.push('改值'); }
  if (hasAny(lower, VERB_ADD)) { score += 4; hits.push('新增'); }
  if (hasAny(lower, VERB_DEL)) { score += 4; hits.push('删除'); }
  if (hasAny(lower, VERB_MOVE)) { score += 4; hits.push('排序'); }
  if (hasAny(lower, VERB_RESET)) { score += 4; hits.push('重置'); }
  if (hasAny(lower, VERB_SCENE)) { score += 4; hits.push('场景'); }
  if (hasAny(lower, DOMAIN_WORDS)) { score += 2; hits.push('页面域'); }

  // 2) 搜索信号（负分）
  if (hasAny(lower, LOOKUP_HINT)) { score -= 5; hits.push('查词'); }
  // 单个英文单词（含连字符/撇号）：几乎一定是查词
  if (ASCII_WORD.test(text) && text.length <= 24 && !/\s/.test(text)) {
    score -= 6; hits.push('单词');
  } else if (ASCII_ANY.test(text) && text.length <= 20 && !/\s/.test(text)) {
    score -= 3; hits.push('英文短串');
  }
  // 很短的中文（≤6 字）且没触发任何变更信号 → 更像查词
  if (!/[a-zA-Z]/.test(text) && text.length <= 6 && score === 0) {
    score -= 2; hits.push('短中文');
  }

  // 3) 阈值：≥4 判为指令
  const mode = score >= 4 ? 'command' : 'search';
  return {
    mode: mode,
    score: score,
    why: hits.length ? hits.join('+') : '无明确信号',
    text: text,
    forced: ''
  };
}

/** 只要 mode */
export function isCommand(raw) {
  return detect(raw).mode === 'command';
}

/** 输入框提示文案：根据意图给不同 placeholder 后缀 */
export function hintFor(mode) {
  return mode === 'command' ? '松开即执行，可在「变更」里撤销' : '回车查词，/ 或 @ 开头可直接下指令';
}

/** 模式按钮的短标签（顶栏右侧那颗切换键） */
export function modeLabel(mode) {
  return mode === 'command' ? 'AI' : '搜';
}

/** 模式按钮的无障碍/提示文案 */
export function modeHint(mode, locked) {
  const to = mode === 'command' ? '查词' : 'AI 指令';
  return (locked ? '已手动锁定，点此切成' : '点此切成') + to;
}

/** 给指令模式用的快捷示例（空状态/引导） */
export const SUGGESTIONS = [
  '把背景换成安静的蓝色渐变',
  '加一张考试倒计时卡片',
  '把所有卡片圆角调大一点',
  '进入沉浸专注模式',
  '每日新词改成 30',
  '让首页文案更活泼一点',
  '隐藏打卡走势',
  '睡前复习模式'
];
