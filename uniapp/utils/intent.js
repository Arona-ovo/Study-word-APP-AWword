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
  '我要', '我想', '我想要', '能否', '可不可以', '能不能', '能不能帮', '麻烦', '提醒',
  '让首页', '让页面', '让卡片', '把首页', '把页面', '把卡片', '把背景', '把主题',
  '将首页', '将页面', '将背景', '将主题'
];

// ---------- 变更动词 ----------
// ⚠️ 用户不会照着「改成 / 换成」说话。实测「换个海边风格的背景」里的'换个'、
// 「换回晨间那套」里的'换回'、'把现在这套存成晨间'里的'存成'以前都不在表里 ——
// 整句只有「页面域」的 2 分，够不到阈值 → 被当成查词，用户看到的是"没找到这个词"。
const VERB_CHANGE = ['改成', '换成', '改为', '换为', '变成', '变为', '设置为', '设置成', '调成', '调到',
  '调整成', '调整为', '调高', '调低', '调大', '调小', '调亮', '调暗', '调淡',
  '换个', '换一个', '换一下', '换下', '换回', '换到', '切回', '切成', '切换成',
  '换一本', '换本', '换套',
  '存成', '存为', '保存成', '命名为',
  // 数据类动作：没有对应 op，但"导出/清空记录"这种必须走到模型，
  // 让它指路去设置页 —— 留在查词里只会得到"没找到这个词"。
  '导出', '导出成', '备份', '导入', '清空', '清除', '删掉记录'];

// 开关类：'打开深色模式' / '动效关掉'。
// 单独给 3 分（不到阈值）：'打开相机' 这种跟首页无关的说法不能因此变成指令，
// 必须再搭上一个页面域词（+3）才够 4 分 —— 这正是"打开深色模式"该有的待遇。
const VERB_TOGGLE = ['关掉', '关了', '关闭', '开启', '打开', '启用', '停用'];

// 朗读类：'把这句话读出来'。page-agent 的路由表一直认它，意图表以前没有。
const VERB_SPEAK = ['朗读', '读出来', '读一遍', '读一下', '念出来', '念一遍', '念一下', '播报', '说一句', '念给我听'];

// 对界面的抱怨：'字太小了看不清'。
// 注意 DOMAIN 里的 '字小' 匹配不到 "字**太**小" —— 抱怨词嵌在中间，
// 所以这类"形容词 + 太"要单独收。它们几乎只用来形容界面，误判代价低。
const VERB_TUNE = ['太小', '太大', '太暗', '太亮', '太花', '太挤', '太乱', '太素', '太艳', '太淡', '太窄'];
const VERB_ADD = ['添加', '新增', '加上', '加一个', '加个', '加一张', '加一张卡', '加进', '加入', '加进去', 'create', 'add'];
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
// 权重是 3 分（不是 2）：实测"背景模糊一点""字太小了"这类**调参式说法**里
// 压根没有变更动词，只有"页面域 + 程度词"，2+2=4 太紧、2+2 还常被"短中文 -2"吃掉。
// 给到 3 分后，页面域 + 任一程度词就稳稳过线；而光秃秃一个「卡片」= 3 分仍不到 4，
// 依然判成查词（check-intent-route 第 5 组守着这条）。
const DOMAIN_WORDS = [
  '首页', '页面', '界面', '卡片', '卡片样式', '背景', '壁纸', '主题', '配色', '字体',
  '字号', '字大', '字小', '动效', '动画', '圆角', '透明度', '间距', '密度',
  '蒙版', '模糊', '紧凑', '宽松', '简洁',
  '深色', '夜间', '暗色', '明亮',
  '每日目标', '每日新词', '每日', '每天', '目标', '倒计时', '清单', '待办', '便签', '打卡',
  '心情', '氛围', '沉浸', '专注', '场景'
];

// ---------- 程度 / 评价词：调参式说法的唯一信号 ----------
// 「背景太花了，素一点」「界面紧凑一点」「字太小了看不清」这些都**没有**变更动词，
// 只靠"页面域 + 这里某个词"来表明"我想调一调"。以前整类说法全部掉进查词。
const DEGREE_WORDS = ['一点', '一些', '更', '太', '有点', '稍微', '略微', '过于', '这么', '那么', '再'];

// 「每天练50题」「每日新词改成30」里的数字 + 量词：有具体档位才像是下指令
const NUM_UNIT = /[0-9]+\s*(题|道|个|张|条|天|分钟|词|分)/;

// ---------- 学习数据域 ----------
// 「我今天学了多少」「我的掌握度怎么样」这类是**提问**，不是查词也不是改页面。
// 它们没有 op 可表达，但模型手里有 docDigest 里的【真实学习数据】，能直接答。
// 单独命中只给 3 分（不到阈值）：光说「今天」「复习」不该变成指令；
// 必须再搭上疑问句式（+2）才够线 —— 这样"问"才走 AI，"说"仍走查词。
const LEARN_WORDS = [
  '学习', '学了多少', '背了多少', '掌握度', '掌握', '连续天数', '连续', '打卡',
  '错题', '词书', '进度', '今日', '今天', '昨天', '本周', '这周', '最近', '状态',
  '复习', '生词', '背了', '学了', '题量', '正确率', '目标', '单词量',
  // 「我还有多少词没背」：句里既没有'背了'也没有'词书'，只有"没背"这种否定说法
  '还剩', '还有多少', '没背', '没学', '没记',
  // 功能请求类：这些**没有 op 能表达**，但模型知道该指路去哪个页面
  // （page-agent 的 prompt 规则 11 写了指路清单）。以前它们全被当成查词，
  // 用户看到"没找到 xx 这个词" —— 而实际上只要走到模型，它是能回答的。
  '词汇', '词根', '用法', '搭配', '例句', '怎么记', '怎么背', '发音', '朗读'
];

// 元问题：用户在问"这个框能干什么"。模型手里有完整指令手册，答得比谁都准。
const META_WORDS = ['你能做什么', '能做什么', '会做什么', '有什么功能', '怎么用这个', '怎么玩', '帮助', 'help'];

// 疑问句式：问号 / 吗 / 呢 / 怎么样 / 如何 / 多少 / 为什么 / 怎么
const QUESTION = /[？?]|吗$|呢$|怎么样|怎么办|如何|多少|为什么|怎么|几[个天次]/;

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
  if (hasAny(lower, VERB_TOGGLE)) { score += 3; hits.push('开关'); }
  if (hasAny(lower, VERB_SPEAK)) { score += 4; hits.push('朗读'); }
  if (hasAny(lower, VERB_TUNE)) { score += 4; hits.push('抱怨'); }
  if (hasAny(lower, VERB_ADD)) { score += 4; hits.push('新增'); }
  if (hasAny(lower, VERB_DEL)) { score += 4; hits.push('删除'); }
  if (hasAny(lower, VERB_MOVE)) { score += 4; hits.push('排序'); }
  if (hasAny(lower, VERB_RESET)) { score += 4; hits.push('重置'); }
  if (hasAny(lower, VERB_SCENE)) { score += 4; hits.push('场景'); }
  if (hasAny(lower, DOMAIN_WORDS)) { score += 3; hits.push('页面域'); }
  if (hasAny(lower, DEGREE_WORDS)) { score += 2; hits.push('程度'); }
  if (NUM_UNIT.test(text)) { score += 2; hits.push('档位'); }
  if (hasAny(lower, LEARN_WORDS)) { score += 3; hits.push('学习域'); }
  if (hasAny(lower, META_WORDS)) { score += 4; hits.push('元问题'); }
  if (QUESTION.test(text)) { score += 2; hits.push('疑问'); }

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
