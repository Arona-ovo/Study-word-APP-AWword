// utils/page-schema.js - 首页 AI 指令的参数契约（唯一真相来源）
//
// 卡片"里面"长什么样，由 utils/card-spec.js 定义；这里只负责把「整张卡片设计」
// 作为一条指令接进来，并复用它的归一化（同一份红线，同一个入口）。
//
// 这一层是整个「AI 改页面」能力的安全边界：
//   · AI 只能输出 op + args，且 op 必须命中 COMMANDS 白名单
//   · args 逐字段校验：枚举必须命中、数值一律夹取、字符串截断、颜色/URL 走正则
//   · 这份 schema 同时用来生成塞给模型的「指令手册」，两边永远一致
//
// 设计原则：能救就救（夹取 / 截断 / 取默认值），救不了才让这一条指令失败。
// 模型输出 opacity: 5 不该让整批指令挂掉，夹到 1 就行。

import * as cardSpec from './card-spec.js';

// ---------- 全局上限（无法被指令绕过） ----------
export const LIMITS = {
  MAX_COMMANDS: 8,      // 单次最多几条指令
  MAX_CARDS: 12,        // 首页**同时显示**的卡片上限（收纳起来的卡不占位置，见 page-command 的 visibleCount）
  MAX_BLOCKS: 8,        // 单卡最多几个块
  MAX_ITEMS: 12,        // 列表 / 清单项上限
  MAX_TEXT: 200,        // 单段文案
  MAX_TITLE: 24,        // 卡片标题
  MAX_SHORT: 40,        // 短文本（键值对的 v / 图片说明等）
  MAX_SUMMARY: 120,     // 指令摘要
  MIN_FONT: 20,
  MAX_FONT: 44,
  MIN_RADIUS: 0,
  MAX_RADIUS: 32,
  MIN_PAD: 0,
  MAX_PAD: 48,
  MIN_OPACITY: 0.3,
  MAX_OPACITY: 1,
  MIN_MASK: 0,
  MAX_MASK: 0.8,
  MIN_BLUR: 0,
  MAX_BLUR: 24
};

// ---------- 取值域（与 theme.js / home-layout.ts 保持一致） ----------
export const ACCENTS = ['blue', 'teal', 'green', 'purple', 'amber', 'rose', 'graphite'];
export const BG_PRESETS = ['default', 'sky', 'mint', 'sand', 'lilac', 'dawn'];
export const FONTS = ['system', 'serif', 'rounded'];
export const DENSITY = ['compact', 'cozy', 'relaxed'];
export const TONES = ['normal', 'muted', 'strong'];
export const ALIGNS = ['left', 'center', 'right'];
export const SHADOWS = ['none', 'soft', 'lifted'];
export const BORDERS = ['none', 'hairline', 'bold'];

// 内置卡片类型：与 utils/home-layout.ts 的 MODULES id 一一对应
export const BUILTIN_TYPES = ['book', 'action', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage', 'progress', 'favorites', 'streak'];

// AI 可新建的卡片形态（都展开成块序列，渲染器是同一套）
export const CUSTOM_TYPES = ['custom', 'note', 'countdown', 'checklist', 'stats', 'quote'];

// 卡片上的「活数据」绑定：让 AI 造出来的卡能显示真实进度，而不是死数字
export const LIVE_KEYS = [
  'none',
  'todayTotal',   // 今日已练题数
  'todayCorrect', // 今日答对题数
  'wrongCount',   // 待复习错题
  'streak',       // 连续天数
  'mastered',     // 已掌握词数
  'wordCount',    // 全书词数
  'newWordsDone', // 今日新词进度 done
  'newWordsTarget',
  'practiceDone', // 今日学会题量 done（确认通过才计入，蒙对不算）
  'practiceTarget'
];

// 按钮动作白名单：只能跳已存在的页面，不能带任意 URL 参数
export const BUTTON_ACTIONS = [
  'practice', 'review', 'drill', 'library', 'stats', 'history', 'streak', 'wordbook', 'speak',
  // 刷单词：单独的背单词页（与翻译练习互不干扰）
  'worddrill'
];

/* ============================================================
 * 校验器：每个返回 { ok, value, reason }
 * ============================================================ */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function fail(reason) { return { ok: false, value: undefined, reason: reason }; }

function vEnum(values, def) {
  return (v) => {
    // 空串视同"没给"：归一化产物里枚举字段的默认值就是 ''，
    // 指令要被 applyCommands 再归一化一遍，'' 若当真值校验会炸出"取值必须是…"，
    // 也就是说 plan 阶段通过、执行阶段反而失败 —— 用户看到的就是这种鬼报错。
    if (v === undefined || v === null || v === '') return { ok: true, value: def };
    const s = String(v).trim();
    // 大小写不敏感地兜一次，模型常写 'Blue'
    const hit = values.find(x => x.toLowerCase() === s.toLowerCase());
    if (!hit) return fail('取值必须是 ' + values.join(' / '));
    return { ok: true, value: hit };
  };
}

function vInt(min, max, def) {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: def };
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return { ok: true, value: def };
    return { ok: true, value: Math.max(min, Math.min(max, n)) };
  };
}

function vNum(min, max, def) {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: def };
    const n = Number(v);
    if (!isFinite(n)) return { ok: true, value: def };
    return { ok: true, value: Math.round(Math.max(min, Math.min(max, n)) * 100) / 100 };
  };
}

function vStr(max, def) {
  return (v) => {
    if (v === undefined || v === null) return { ok: true, value: def === undefined ? '' : def };
    const s = String(v).slice(0, max);
    return { ok: true, value: s };
  };
}

// 颜色：只放行 #RGB / #RRGGBB / 'clear'（清空），不接受 url() 或任意字符串
function vColor(def) {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: def === undefined ? '' : def };
    const s = String(v).trim();
    if (s === 'clear' || s === 'none') return { ok: true, value: '' };
    if (!HEX.test(s)) return fail('颜色需为 #RGB 或 #RRGGBB');
    return { ok: true, value: s };
  };
}

function vBool(def) {
  return (v) => {
    if (v === undefined || v === null) return { ok: true, value: !!def };
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on', '开', '打开'].indexOf(s) >= 0) return { ok: true, value: true };
      if (['false', '0', 'no', 'off', '关', '关闭'].indexOf(s) >= 0) return { ok: true, value: false };
      return { ok: true, value: !!def };
    }
    return { ok: true, value: !!v };
  };
}

// 三态布尔：没给参数时返回 null（区别于显式的 false），
// 让 theme.set 这类指令能分清"用户没说"和"用户要关掉"
function vBoolTri() {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: null };
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on', '开', '打开'].indexOf(s) >= 0) return { ok: true, value: true };
      if (['false', '0', 'no', 'off', '关', '关闭'].indexOf(s) >= 0) return { ok: true, value: false };
      return { ok: true, value: null };
    }
    return { ok: true, value: !!v };
  };
}

// URL：协议白名单，挡掉 javascript: / vbscript:
function vUrl() {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: '' };
    const s = String(v).trim();
    // svg 不放行：SVG 里能夹脚本，图片块只认位图格式
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return { ok: true, value: s };
    if (/^https?:\/\/\S+$/i.test(s)) return { ok: true, value: s };
    // 本地形态：App 的 file:// 与 _doc/_www、小程序的 wxfile://、H5 的 blob:（会话级）
    if (/^(file:|wxfile:|blob:|_doc\/|_www\/|doc:\/\/|untrusted:\/)/i.test(s)) return { ok: true, value: s };
    if (/^[a-z]:[\\/]/i.test(s)) return { ok: true, value: s };
    // 本地相对路径（uni.saveFile 返回的常见形态）
    if (/^\/?(storage|data|user)\//i.test(s)) return { ok: true, value: s };
    return fail('图片地址只支持 http(s) / 本地文件路径');
  };
}

// 日期：YYYY-MM-DD 或 +Nd（相对天数）
function vDate() {
  return (v) => {
    if (v === undefined || v === null || v === '') return { ok: true, value: '' };
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };
    if (/^\+\d{1,4}d$/.test(s)) return { ok: true, value: s };
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      const p = s.split('/');
      const pad = (n) => (n.length < 2 ? '0' + n : n);
      return { ok: true, value: p[0] + '-' + pad(p[1]) + '-' + pad(p[2]) };
    }
    return fail('日期需为 YYYY-MM-DD 或 +Nd（如 +30d）');
  };
}

function vToList(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean);
  return [];
}

/* ============================================================
 * 块（block）schema —— AI 造卡片的积木
 * ============================================================ */
function blockSchema(name, params, max) {
  return { name, params, max: max || 1 };
}

export const BLOCK_SCHEMA = {
  title: {
    params: { text: vStr(60, ''), size: vInt(LIMITS.MIN_FONT, LIMITS.MAX_FONT, 30), align: vEnum(ALIGNS, 'left'), serif: vBool(false) },
    max: 1
  },
  text: {
    params: {
      text: vStr(LIMITS.MAX_TEXT, ''), size: vInt(LIMITS.MIN_FONT, LIMITS.MAX_FONT, 26),
      tone: vEnum(TONES, 'normal'), align: vEnum(ALIGNS, 'left'), serif: vBool(false)
    },
    max: 3
  },
  stat: {
    params: { label: vStr(12, ''), value: vStr(16, ''), unit: vStr(6, ''), live: vEnum(LIVE_KEYS, 'none') },
    max: 4
  },
  kv: {
    params: { items: (v) => ({ ok: true, value: vToList(v).slice(0, 8).map(it => {
      const o = (it && typeof it === 'object') ? it : { v: String(it == null ? '' : it) };
      return { k: String(o.k == null ? '' : o.k).slice(0, 16), v: String(o.v == null ? '' : o.v).slice(0, LIMITS.MAX_SHORT) };
    }) }) },
    max: 1
  },
  list: {
    params: { items: (v) => ({ ok: true, value: vToList(v).slice(0, LIMITS.MAX_ITEMS).map(x => String(x == null ? '' : x).slice(0, 60)) }), ordered: vBool(false) },
    max: 1
  },
  checklist: {
    params: { items: (v) => ({ ok: true, value: vToList(v).slice(0, LIMITS.MAX_ITEMS).map(it => {
      const o = (it && typeof it === 'object') ? { text: it.text, done: it.done } : { text: String(it == null ? '' : it), done: false };
      return { text: String(o.text == null ? '' : o.text).slice(0, 60), done: !!o.done };
    }) }) },
    max: 1
  },
  progress: {
    params: { label: vStr(20, ''), value: vInt(0, 100, 0), live: vEnum(LIVE_KEYS, 'none'), target: vInt(1, 500, 100) },
    max: 2
  },
  countdown: {
    params: { title: vStr(20, '倒计时'), date: vDate() },
    max: 1
  },
  quote: {
    params: { text: vStr(120, ''), author: vStr(20, ''), serif: vBool(true) },
    max: 1
  },
  tags: {
    params: { items: (v) => ({ ok: true, value: vToList(v).slice(0, 8).map(x => String(x == null ? '' : x).slice(0, 16)) }), tone: vEnum(['brand', 'neutral', 'warn'], 'brand') },
    max: 1
  },
  image: {
    params: { url: vUrl(), ratio: vNum(0.3, 2, 1.2), caption: vStr(LIMITS.MAX_SHORT, '') },
    max: 2
  },
  divider: { params: {}, max: 2 },
  button: {
    params: { text: vStr(20, '开始'), action: vEnum(BUTTON_ACTIONS, 'practice'), speak: vStr(120, '') },
    max: 2
  }
};

export const BLOCK_NAMES = Object.keys(BLOCK_SCHEMA);

/** 校验单个块 → { ok, block, reason } */
export function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '块必须是对象' };
  const kind = String(raw.kind || raw.type || '').trim().toLowerCase();
  const spec = BLOCK_SCHEMA[kind];
  if (!spec) return { ok: false, reason: '未知块类型 ' + (kind || '(空)') + '，可用：' + BLOCK_NAMES.join('/') };
  const out = { kind: kind };
  const src = (raw.args && typeof raw.args === 'object') ? raw.args : raw;
  for (const key of Object.keys(spec.params)) {
    const r = spec.params[key](src[key]);
    if (!r.ok) return { ok: false, reason: kind + '.' + key + '：' + r.reason };
    if (r.value !== undefined) out[key] = r.value;
  }
  return { ok: true, block: out };
}

/** 校验块序列 → { ok, blocks, reason } */
export function normalizeBlocks(raw) {
  const list = vToList(raw).slice(0, LIMITS.MAX_BLOCKS);
  const out = [];
  for (const it of list) {
    const r = normalizeBlock(it);
    if (!r.ok) return { ok: false, reason: r.reason };
    out.push(r.block);
  }
  return { ok: true, blocks: out };
}

/* ============================================================
 * 通用参数片段
 * ============================================================ */
const CARD_STYLE = {
  bg: vColor(''),
  opacity: vNum(LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY, 0.72),
  radius: vInt(LIMITS.MIN_RADIUS, LIMITS.MAX_RADIUS, 22),
  padding: vInt(LIMITS.MIN_PAD, LIMITS.MAX_PAD, 24),
  shadow: vEnum(SHADOWS, 'soft'),
  border: vEnum(BORDERS, 'hairline')
};

/** 校验卡片样式覆盖 → { ok, style } */
export function normalizeCardStyle(raw) {
  if (!raw || typeof raw !== 'object') return { ok: true, style: null };
  const out = {};
  for (const key of Object.keys(CARD_STYLE)) {
    if (raw[key] === undefined) continue;
    const r = CARD_STYLE[key](raw[key]);
    if (!r.ok) return { ok: false, reason: 'style.' + key + '：' + r.reason };
    out[key] = r.value;
  }
  return { ok: true, style: Object.keys(out).length ? out : null };
}

// 卡片引用：id > index > type > title > last（all 是集合定位，只给样式类指令用）
//
// 【2026-10-09 容错重构】DeepSeek 实测最爱犯的三种错，以前都会把整条指令判死：
//   1) 新建卡片时带了空定位  target:"" / null / {}  →「缺少卡片定位」重试 3 次仍失败
//   2) 把定位写成字符串       "last" / "第2张" / "打卡走势"
//   3) 把标题塞进别名         { name:'今日心情' } / { label:'...' }
// 现在这三种都能落到一个可用引用；真正给不出定位才报错，且报错写明怎么改。

const NO_TARGET = '需要指明要改哪张卡片（target：id / index / type / last，或直接写卡片标题）';

// 中文数字 → 数值（只处理手册里会出现的一到十）
function cnNum(s) {
  const table = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^[0-9]+$/.test(s)) return Number(s);
  return table[s] || 0;
}

/** 字符串定位："last" / "第2张" / "3" / 内置卡 id / 卡片标题（兜底） */
function refFromToken(s) {
  const t = String(s).trim();
  if (/^(last|末尾|最后|最后一张|最后一个)$/i.test(t)) return { ok: true, ref: { last: true } };
  if (/^(top|第一张|第一个|顶部|置顶)$/i.test(t)) return { ok: true, ref: { index: 0 } };
  // 「所有/全部」的各种口语说法都收下 —— 用户说「去掉主页所有卡片」时模型很容易
  // 原样返回这个词，收不到就会退化成"标题匹配"→ 找不到 → 报「没找到这张卡片」。
  if (/^(all|every|全部|所有|全都|统统|全部卡片|所有卡片|所有的卡片|每一张|每张|每一张卡片|每一张卡)$/i.test(t)) {
    return { ok: true, ref: { all: true } };
  }
  const m = /^第\s*([0-9一二两三四五六七八九十]+)\s*[张个条块]?[卡片]?$/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (n >= 1) return { ok: true, ref: { index: n - 1 } };   // 「第2张」是人话计数，转 0 基
  }
  if (/^[0-9]+$/.test(t)) return { ok: true, ref: { index: Number(t) } }; // 裸数字按 0 基 index（摘要里就是 #0 #1 #2）
  if (BUILTIN_TYPES.indexOf(t) >= 0) return { ok: true, ref: { type: t } };
  // 其余字符串一律当标题去匹配（indexOfRef 里精确 → 包含），比直接判死多一次机会
  return { ok: true, ref: { title: t } };
}

export function normalizeRef(raw) {
  if (raw === undefined || raw === null) return { ok: false, reason: NO_TARGET };
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { ok: false, reason: NO_TARGET };
    return refFromToken(s);
  }
  if (typeof raw === 'number') {
    return isFinite(raw) && raw >= 0
      ? { ok: true, ref: { index: Math.floor(raw) } }
      : { ok: false, reason: NO_TARGET };
  }
  if (typeof raw !== 'object') return { ok: false, reason: NO_TARGET };
  const r = raw;
  if (r.id !== undefined && r.id !== null && r.id !== '') return { ok: true, ref: { id: String(r.id) } };
  if (r.index !== undefined && r.index !== null && r.index !== '') {
    const n = Math.floor(Number(r.index));
    if (isFinite(n) && n >= 0) return { ok: true, ref: { index: n } };
  }
  if (r.type !== undefined && r.type !== null && r.type !== '') return { ok: true, ref: { type: String(r.type) } };
  if (r.title !== undefined && r.title !== null && r.title !== '') return { ok: true, ref: { title: String(r.title) } };
  // 模型爱把标题塞进别的字段名里，顺手接住
  const alias = r.name || r.label || r.card || r.cardTitle;
  if (alias !== undefined && alias !== null && alias !== '') return { ok: true, ref: { title: String(alias) } };
  if (r.last) return { ok: true, ref: { last: true } };
  if (r.all || r.every) return { ok: true, ref: { all: true } };
  return { ok: false, reason: NO_TARGET };
}

// target 是否真的"给了"：""/null/{}/[] 都算没给 —— 这是 DeepSeek 新建卡片时
// 最常带的垃圾定位，以前会把 card.design 整条判死（截图 2026-10-09 15:22 的报错）
export function targetProvided(t) {
  if (t === undefined || t === null) return false;
  if (typeof t === 'string') return !!t.trim();
  if (Array.isArray(t)) return t.length > 0;
  if (typeof t === 'object') return Object.keys(t).length > 0;
  return true;
}

/** 通用参数归一化：按 params 表逐字段跑校验器 */
export function normalizeArgs(schema, raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  const required = [];
  for (const key of Object.keys(schema)) {
    const spec = schema[key];
    const r = spec(src[key]);
    if (!r.ok) return { ok: false, reason: key + '：' + r.reason };
    if (r.value !== undefined) out[key] = r.value;
    if (spec.required && (r.value === undefined || r.value === '' || r.value === null)) required.push(key);
  }
  if (required.length) return { ok: false, reason: '缺少必填参数：' + required.join(', ') };
  return { ok: true, args: out };
}

/** 给 schema 里的校验器打上 required 标记 */
export function req(fn) {
  fn.required = true;
  return fn;
}

/* ============================================================
 * 指令参数 schema（op → params）
 * ============================================================ */
export const COMMAND_PARAMS = {
  'card.add': {
    type: req(vEnum(CUSTOM_TYPES, 'custom')),
    title: vStr(LIMITS.MAX_TITLE, ''),
    text: vStr(LIMITS.MAX_TEXT, ''),
    blocks: vStr(0, ''),            // 占位：真正处理在 normalize 里（避免被截断）
    date: vDate(),
    items: vStr(0, ''),             // 占位
    to: vInt(0, LIMITS.MAX_CARDS, -1),
    style: vStr(0, '')              // 占位
  },
  'card.remove': { target: req(vStr(0, '')) },
  'card.move': { target: req(vStr(0, '')), to: req(vStr(0, '')) },
  'card.hide': { target: req(vStr(0, '')) },
  'card.show': { target: req(vStr(0, '')) },
  'card.restore': { id: req(vStr(24, '')) },
  'card.reset': {},
  // 整卡自由设计：AI 自己决定布局 / 样式 / 数据 / 交互 / 内容（红线见 card-spec.js）
  'card.design': {
    target: vStr(0, ''),   // 占位：卡片定位，真正处理在 normalize 里
    design: vStr(0, ''),   // 占位：整份设计（对象），走 cardSpec.normalizeDesign
    title: vStr(LIMITS.MAX_TITLE, ''),
    state: vStr(0, ''),    // 占位：初始状态
    style: vStr(0, ''),    // 占位：卡片级样式
    to: vInt(0, LIMITS.MAX_CARDS, -1)
  },
  'text.set': { target: req(vStr(0, '')), value: req(vStr(LIMITS.MAX_TEXT, '')) },
  'text.rewrite': { target: req(vStr(0, '')), tone: vEnum(['简洁', '正式', '活泼', '温柔', '鼓励', '幽默'], '简洁'), instruction: vStr(160, '') },
  'image.set': { target: req(vStr(0, '')), url: vUrl(), clear: vBool(false) },
  'style.card': { target: req(vStr(0, '')), style: vStr(0, '') },
  'style.text': {
    target: req(vStr(0, '')),
    size: vInt(LIMITS.MIN_FONT, LIMITS.MAX_FONT, 26),
    weight: vEnum(['400', '500', '600'], '400'),
    color: vColor(''),
    align: vEnum(ALIGNS, 'left'),
    serif: vBool(false)
  },
  'theme.set': {
    accent: vEnum(ACCENTS, ''),
    dark: vBoolTri(),
    font: vEnum(FONTS, ''),
    motion: vBoolTri(),
    density: vEnum(DENSITY, '')
  },
  'bg.set': {
    preset: vEnum(BG_PRESETS, ''),
    image: vUrl(),
    mask: vNum(LIMITS.MIN_MASK, LIMITS.MAX_MASK, null),
    blur: vInt(LIMITS.MIN_BLUR, LIMITS.MAX_BLUR, null),
    gradient: vStr(0, ''),
    mood: vStr(20, '')
  },
  'goal.set': { newWords: vInt(5, 300, null), practice: vInt(5, 300, null) },
  // 换词书。name / id 二选一（都给也行），name 支持简称：
  // 用户说"换成四级词书"时模型写 {name:"四级"} 就能命中，不必记 id。
  // 不能把两个都设成 required —— 模型常常只说得清其中一种。
  'book.switch': { name: vStr(24, ''), id: vStr(24, '') },
  'skin.save': { name: req(vStr(16, '')) },
  'skin.apply': { name: req(vStr(16, '')) },
  'macro.run': { name: req(vEnum(['exam', 'commute', 'bedtime', 'focus'], 'exam')) },
  'page.announce': { text: vStr(160, '') }
};

/** 指令元信息（生成 prompt 手册 + UI 展示用） */
export const COMMAND_META = {
  'card.add': { group: '结构', desc: '新增一张卡片。type=custom 时需给 blocks' },
  'card.remove': { group: '结构', desc: '删除卡片' },
  'card.move': { group: '结构', desc: '移动卡片到指定位置（to 可为 0-n / top / bottom）' },
  'card.hide': { group: '结构', desc: '隐藏卡片（保留，可再显示）' },
  'card.show': { group: '结构', desc: '显示已隐藏的卡片' },
  'card.restore': { group: '结构', desc: '把已删除的内置卡片加回来' },
  'card.reset': { group: '结构', desc: '恢复默认首页（清掉所有 AI 改动）' },
  'card.design': { group: '结构', desc: '自由设计一张卡片（布局 / 样式 / 数据 / 交互全由你定）；给 target 就是改那张，不给就新建' },
  'text.set': { group: '文案', desc: '直接替换卡片文案' },
  'text.rewrite': { group: '文案', desc: '让 AI 按语气改写卡片文案（会再调用一次模型）' },
  'image.set': { group: '文案', desc: '给卡片换图或清图' },
  'style.card': { group: '样式', desc: '调整卡片背景/透明度/圆角/内边距/投影/描边' },
  'style.text': { group: '样式', desc: '调整卡片文字的字号/字重/颜色/对齐/字体' },
  'theme.set': { group: '主题', desc: '主题色 / 深色模式 / 字体 / 动效 / 密度' },
  'bg.set': { group: '背景', desc: '背景预设 / 图片 / 渐变 / 蒙版 / 模糊 / 心情' },
  'goal.set': { group: '学习', desc: '调整当前词书的每日目标' },
  'book.switch': { group: '学习', desc: '切换当前词书。name 可写简称（四级 / 六级 / 考研 / 专升本 / 高考 / 中考），id 写精确 id' },
  'skin.save': { group: '快照', desc: '把当前首页存成命名快照' },
  'skin.apply': { group: '快照', desc: '应用某个已保存的快照' },
  'macro.run': { group: '场景', desc: '运行内置场景宏：exam/commute/bedtime/focus' },
  'page.announce': { group: '语音', desc: '把一句话朗读出来' }
};

export const COMMAND_OPS = Object.keys(COMMAND_META);

/** 校验指令信封 → { ok, cmd, reason } */
export function normalizeCommand(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '指令必须是对象' };
  const op = String(raw.op || '').trim();
  if (!COMMAND_PARAMS[op]) {
    return { ok: false, reason: '未知指令 ' + (op || '(空)') + '，支持的指令：' + COMMAND_OPS.join(', ') };
  }
  const srcRaw = (raw.args && typeof raw.args === 'object') ? raw.args : raw;
  let src = srcRaw;

  // book.switch：name / id 至少给一个。
  // 放这里（而不是执行层）是因为这条报错会**回喂给模型重试一轮**，
  // 在 plan 阶段就拦下，模型有机会补上参数；等执行层才发现就整批回退了。
  if (op === 'book.switch') {
    const hasName = String(srcRaw.name == null ? '' : srcRaw.name).trim() !== '';
    const hasId = String(srcRaw.id == null ? '' : srcRaw.id).trim() !== '';
    if (!hasName && !hasId) {
      return { ok: false, reason: 'book.switch：需要 name 或 id —— 说清要换成哪本词书（name 可写简称，如 四级 / 考研 / 专升本）' };
    }
  }

  // 特殊参数（对象 / 数组 / 多形态）单独归一化，再拼回去
  const extra = {};
  // 只有参数表里声明了 target 的 op（card.design 也算）才处理定位；
  // 模型给 card.add 误带 target:"bottom" 之类的垃圾直接忽略，别拿去报错。
  if (COMMAND_PARAMS[op].target || op === 'card.design') {
    if (!targetProvided(src.target)) {
      if (COMMAND_PARAMS[op].target && COMMAND_PARAMS[op].target.required) {
        return { ok: false, reason: op + '：' + NO_TARGET };
      }
      // card.design 无 target = 新建（手册里就是这么承诺的）
    } else {
      const r = normalizeRef(src.target);
      if (!r.ok) {
        // 定位给了但解析不了：给一次"当新建"的兜底会让用户误以为改成功，
        // 所以保留失败 —— 但报错写清楚怎么修，让重试那一轮能改对。
        return { ok: false, reason: op + '：' + r.reason };
      }
      extra.target = r.ref;
    }
  }
  if (op === 'style.card') {
    // 模型常把样式参数拍平在 args 上（{radius:28} 而不是 {style:{radius:28}}），
    // 把散落的样式键收拢成 style 对象再走统一归一化
    let styleSrc = src.style;
    if (!styleSrc || typeof styleSrc !== 'object') {
      const flat = {};
      Object.keys(CARD_STYLE).forEach(k => { if (src[k] !== undefined) flat[k] = src[k]; });
      if (Object.keys(flat).length) styleSrc = flat;
    }
    if (styleSrc !== undefined) {
      const r = normalizeCardStyle(styleSrc);
      if (!r.ok) return { ok: false, reason: 'style.card：' + r.reason };
      extra.style = r.style;
    }
  }
  if (op === 'card.add' && src.blocks !== undefined) {
    const r = normalizeBlocks(src.blocks);
    if (!r.ok) return { ok: false, reason: 'card.add：' + r.reason };
    extra.blocks = r.blocks;
  }
  if (op === 'card.add' && src.style !== undefined) {
    const r = normalizeCardStyle(src.style);
    if (!r.ok) return { ok: false, reason: 'card.add：' + r.reason };
    extra.style = r.style;
  }
  if (op === 'card.design') {
    // 整份设计交给 card-spec 归一化：越界夹取、非法丢弃，产物永远可渲染
    if (src.design === undefined || src.design === null) {
      return { ok: false, reason: 'card.design：缺少 design（卡片设计内容）' };
    }
    const r = cardSpec.normalizeDesign(src.design);
    if (!r.ok) return { ok: false, reason: 'card.design：' + r.reason };
    extra.design = r.design;
    if (src.state !== undefined && src.state !== null) {
      const st = cardSpec.normalizeStateBag(src.state);
      if (Object.keys(st).length) extra.design = Object.assign({}, r.design, { state: st });
    }
    if (src.style !== undefined) {
      const r2 = normalizeCardStyle(src.style);
      if (!r2.ok) return { ok: false, reason: 'card.design：' + r2.reason };
      extra.style = r2.style;
    }
    const t = src.to;
    if (typeof t === 'string' && /^(top|bottom)$/i.test(String(t).trim())) extra.to = String(t).trim().toLowerCase();
    else if (t !== undefined && t !== '' && t !== null) extra.to = vInt(0, LIMITS.MAX_CARDS, -1)(t).value;
    else extra.to = 'bottom';
  }
  // items 既可能是数组也可能是"、/,"分隔的字符串；统计卡的每一项还是对象 {label,value,live}，
  // 所以对象要原样保留（之前只处理字符串，数组会被占位校验器截成空串 → 统计卡造不出来）
  if (op === 'card.add' && src.items !== undefined) {
    const raw = Array.isArray(src.items) ? src.items : vToList(src.items);
    extra.items = raw.slice(0, LIMITS.MAX_ITEMS).map(x => {
      if (x && typeof x === 'object') return x;
      return String(x == null ? '' : x).slice(0, 60);
    });
  }
  if (op === 'bg.set' && src.gradient !== undefined && src.gradient !== '') {
    const g = (src.gradient && typeof src.gradient === 'object') ? src.gradient : {};
    const from = vColor('')(g.from);
    const to = vColor('')(g.to);
    if (!from.ok || !to.ok) return { ok: false, reason: 'bg.set.gradient：' + (!from.ok ? from.reason : to.reason) };
    if (!from.value || !to.value) return { ok: false, reason: 'bg.set.gradient 需要 from 与 to 两个颜色' };
    extra.gradient = { from: from.value, to: to.value, angle: vInt(0, 360, 165)(g.angle).value };
  }
  if (op === 'bg.set') {
    // 模型爱把「安静的蓝色渐变」这类自定义颜色描述塞进 preset，而 preset 只认 6 个预设名。
    // 直接判死会导致重试 3 次还失败（模型改不对）；这里做本地兜底：
    // 非法 preset 转成 mood（moodPreset 按关键词映射渐变，带颜色词兜底），保住这条指令。
    const p = src.preset;
    if (p !== undefined && p !== null && String(p).trim() !== '') {
      const s = String(p).trim();
      const hit = BG_PRESETS.some(x => x.toLowerCase() === s.toLowerCase());
      if (!hit) {
        const hasMood = src.mood !== undefined && src.mood !== null && String(src.mood).trim() !== '';
        src = Object.assign({}, src);
        delete src.preset;
        if (!hasMood && !extra.gradient) src.mood = s.slice(0, 20);
      }
    }
  }
  // to 允许多形态：数字 / 'top' / 'bottom'
  if (op === 'card.move') {
    const t = src.to;
    if (typeof t === 'string' && /^(top|bottom)$/i.test(String(t).trim())) extra.to = String(t).trim().toLowerCase();
    else if (t !== undefined) extra.to = vInt(0, LIMITS.MAX_CARDS, 0)(t).value;
    else extra.to = 0;
  } else if (op === 'card.add') {
    const t = src.to;
    if (typeof t === 'string' && /^(top|bottom)$/i.test(String(t).trim())) extra.to = String(t).trim().toLowerCase();
    else if (t !== undefined && t !== '' && t !== null) extra.to = vInt(0, LIMITS.MAX_CARDS, -1)(t).value;
    else extra.to = 'bottom';
  }

  // target / blocks / style 这类"对象型"参数已在上面单独归一化，
  // 从通用表里摘掉，免得占位声明（vStr(0)）把它们判成缺少必填项
  const params = Object.assign({}, COMMAND_PARAMS[op]);
  Object.keys(extra).forEach(k => { delete params[k]; });
  const r = normalizeArgs(params, src);
  if (!r.ok) return { ok: false, reason: op + '：' + r.reason };
  const args = Object.assign({}, r.args, extra);
  // 抹掉占位字段（COMMAND_PARAMS 里为了统一声明写的占位）
  delete args.blocksRaw;
  return { ok: true, cmd: { op: op, args: args } };
}

/** 校验整批指令 → { ok, commands, errors } */
export function normalizeCommands(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return { ok: false, errors: ['指令序列为空'] };
  const cmds = [];
  const errors = [];
  list.slice(0, LIMITS.MAX_COMMANDS).forEach((c, i) => {
    const r = normalizeCommand(c);
    if (r.ok) cmds.push(r.cmd);
    else errors.push('第 ' + (i + 1) + ' 条：' + r.reason);
  });
  return { ok: cmds.length > 0, commands: cmds, errors: errors };
}

/* ============================================================
 * 生成给模型的「指令手册」（由 schema 推导，永远与实现一致）
 * ============================================================ */
/** 挑出要写进手册的 op：不传 / 传空 → 全量（保证能力集不缩水） */
function pickOps(ops) {
  if (!ops || !ops.length) return COMMAND_OPS.slice();
  const hit = COMMAND_OPS.filter(op => ops.indexOf(op) >= 0);
  return hit.length ? hit : COMMAND_OPS.slice();
}

/**
 * 生成给模型的「指令手册」（由 schema 推导，永远与实现一致）
 *
 * @param {string[]} [ops] 只渲染这些 op。意图路由命中时可以只发子集，
 *   省掉大半 token —— cardSpec.promptSpec() 占了整份手册的 61%，
 *   但只有 card.design 用得上它。传空 / 不传 = 全量，行为与以前一致。
 */
export function promptManual(ops) {
  const list = pickOps(ops);
  const has = (op) => list.indexOf(op) >= 0;
  const lines = [];
  lines.push('可用指令（op 必须完全匹配）：');
  list.forEach(op => {
    lines.push('- ' + op + '：' + COMMAND_META[op].desc);
  });
  lines.push('');
  if (has('card.remove') || has('card.hide') || has('card.show') || has('card.move') ||
      has('card.restore') || has('card.design') || has('text.set') || has('style.card') || has('image.set')) {
    lines.push('卡片定位 target：{id|index|type|last}，优先级 id > index > type > last；也可以直接给字符串（内置卡 id、"last"、"第2张"、卡片标题）。');
    lines.push('内置卡片 id（可见的那几张）：' + BUILTIN_TYPES.join(', ') + '。');
    lines.push('AI 卡片的 id 见下方【当前首页】清单（#0 #1… 后面的那个 id）。');
    lines.push('target 可以写 "all"（= 全部卡片，含已收纳的）：style.card / style.text / card.hide / card.show / card.remove 都支持 —— 用户说「去掉所有卡片」「全部隐藏」「都显示出来」时必须用 all，不要自己挑一张。');
    lines.push('card.move / text.set / image.set / card.design 是单目标指令，不支持 all，必须给具体定位。');
    lines.push('');
  }
  if (has('card.add')) {
    lines.push('card.add 的 type：custom（需给 blocks）/ note / countdown / checklist / stats / quote。card.add 没有 target 参数，不要写。');
    lines.push('可用块 kind：' + BLOCK_NAMES.join(', '));
    lines.push('块示例：{"kind":"title","args":{"text":"今日小结"}}');
    lines.push('块的 live 字段可绑活数据：' + LIVE_KEYS.filter(x => x !== 'none').join(', '));
    lines.push('');
  }
  if (has('theme.set')) {
    lines.push('主题：accent=' + ACCENTS.join('/') + '；font=' + FONTS.join('/') + '；density=' + DENSITY.join('/'));
  }
  if (has('bg.set')) {
    lines.push('背景：preset=' + BG_PRESETS.join('/') + '；gradient={from,to,angle}；mood 为心情/颜色词（如 沉静/活泼/温暖/蓝色渐变）——用户描述自定义颜色时用 mood 或 gradient，preset 只能填上面列出的预设名');
  }
  if (has('theme.set') || has('bg.set')) lines.push('');
  if (has('book.switch')) {
    lines.push('book.switch：name 或 id 给一个就行；name 支持简称（四级 / 六级 / 考研 / 专升本 / 高考 / 中考）。'
      + '可选词书清单见下方【当前首页】的「可选词书」—— 只能从里面挑，不要编书名。');
    lines.push('');
  }
  if (has('card.design')) {
    lines.push(cardSpec.promptSpec());
    lines.push('');
  }
  lines.push('数值会被自动夹取：字号 ' + LIMITS.MIN_FONT + '-' + LIMITS.MAX_FONT +
    '，圆角 ' + LIMITS.MIN_RADIUS + '-' + LIMITS.MAX_RADIUS +
    '，透明度 ' + LIMITS.MIN_OPACITY + '-' + LIMITS.MAX_OPACITY +
    '，进度 0-100。');
  lines.push('最多 ' + LIMITS.MAX_COMMANDS + ' 条指令，首页同时最多显示 ' + LIMITS.MAX_CARDS + ' 张卡片（收纳起来的卡不占位置）。');
  return lines.join('\n');
}

export { vEnum, vInt, vNum, vStr, vColor, vBool, vBoolTri, vUrl, vDate, vToList };
