// utils/page-command.js - 首页指令执行引擎
//
// 这是 AI 与页面之间唯一的窄管道：
//   AI → Command[] → normalize（白名单 + 夹取）→ apply → 新 pageDoc → Vue 渲染
//
// 两条硬规矩：
//   1) apply 一律返回**新对象**，绝不原地改 doc —— 失败回退就是"不写入"，撤销就是"换回来"
//   2) apply 里不碰 DOM、不拼 CSS 字符串、不 eval；需要发请求/朗读的动作
//      只往 effects 里塞一条描述，由页面侧异步执行

import * as pageDoc from './page-doc.js';
import * as schema from './page-schema.js';
import * as cardSpec from './card-spec.js';
import * as theme from './theme.js';
import * as settings from './settings.js';
import * as wordbook from './wordbook.js';

const MAX_HISTORY = 20;
let history = [];

// 场景宏里"找不到目标就跳过"的指令（见 run 的宏展开）
const MACRO_SKIPPABLE = ['card.hide', 'card.show', 'card.move', 'card.remove'];

/* ============================================================
 * 小工具
 * ============================================================ */
function cloneCards(doc) {
  return (doc.cards || []).map(c => Object.assign({}, c));
}

function withCards(doc, cards) {
  return Object.assign({}, doc, { cards: cards });
}

function at(cards, i) {
  return (i >= 0 && i < cards.length) ? i : -1;
}

/* ============================================================
 * 失败文案：给人看的 vs 给日志看的
 * ============================================================ */
/**
 * 指令实现里"走不下去"的分支一律返回这个。
 *   error  精确原因 —— 进日志、进 rawReason，也可以回喂给模型
 *   human  给人看的一句话（可以指路）。有就优先用它
 *
 * 为什么必须分开：`run()` 产出的 reason 会被 home.vue 的指令条**直接渲染**出来。
 * 之前的写法是 `reason: cmd.op + '：' + r.error`，界面于是出现
 * 「card.add：首页最多 12 张卡片」这种天书 —— 用户既不知道 card.add 是什么，
 * 也不知道下一步该删哪张卡。原始串现在只留在 rawReason / console 里。
 */
function fail(error, human) {
  return { doc: null, note: '', error: error, human: human || '' };
}

/**
 * 首页能同时放几张卡：只数**显示中**的卡。
 * 收纳（visible:false）起来的卡不占位置 —— 否则用户把卡收进「收纳区」之后
 * 照样加不进新卡，那个「收纳」按钮就成了死路，只能去删卡片。
 */
function visibleCount(cards) {
  return (cards || []).filter(c => c.visible !== false).length;
}

/** 抹掉内部前缀：'第 1 条：card.add：xxx' → 'xxx'（用于兜底的 error 文案） */
function stripOp(s) {
  return String(s == null ? '' : s)
    .replace(/^第\s*\d+\s*条：/, '')
    .replace(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*：/, '')
    .trim();
}

function insertAt(cards, card, to) {
  const arr = cards.slice();
  if (to === 'top') arr.unshift(card);
  else if (to === 'bottom' || typeof to !== 'number') arr.push(card);
  else arr.splice(Math.max(0, Math.min(arr.length, to)), 0, card);
  return arr;
}

function labelOf(card) {
  return card.title || card.type || card.id;
}

/* ============================================================
 * 卡片形态预设（AI 只给 type + 少量字段，这里展开成块）
 * ============================================================ */
function blocksForType(args) {
  const t = args.type || 'custom';
  const out = [];
  if (args.title) out.push({ kind: 'title', text: args.title });
  if (t === 'note') {
    out.push({ kind: 'text', text: args.text || '' });
  } else if (t === 'countdown') {
    out.push({ kind: 'countdown', title: args.title || '倒计时', date: args.date || '+7d' });
    if (args.text) out.push({ kind: 'text', text: args.text, tone: 'muted' });
  } else if (t === 'checklist') {
    // 项可以是纯字符串，也可以是 { text, done }
    const items = (args.items || []).map(x => {
      const o = (x && typeof x === 'object') ? x : { text: String(x == null ? '' : x), done: false };
      return { text: String(o.text == null ? '' : o.text), done: !!o.done };
    });
    out.push({ kind: 'checklist', items: items });
  } else if (t === 'stats') {
    const items = (args.items || []).slice(0, 4);
    items.forEach(x => {
      const o = (x && typeof x === 'object') ? x : { label: String(x), value: '' };
      out.push({ kind: 'stat', label: String(o.label || ''), value: String(o.value || ''), unit: String(o.unit || ''), live: o.live || 'none' });
    });
  } else if (t === 'quote') {
    out.push({ kind: 'quote', text: args.text || '', author: '' });
  } else if (t === 'custom') {
    (args.blocks || []).forEach(b => out.push(b));
  }
  return out;
}

/** 卡片上第一段可改写的文案：card.text → 扁平 blocks → design 节点（AI 卡的文案常藏在后两者里） */
function cardTextOf(c) {
  if (c.text) return c.text;
  const b = (c.blocks || []).find(b => (b.kind === 'text' || b.kind === 'quote' || b.kind === 'title') && b.text);
  if (b) return b.text;
  if (c.design && Array.isArray(c.design.sections)) {
    for (const sec of c.design.sections) {
      for (const n of (sec.items || [])) {
        if ((n.kind === 'text' || n.kind === 'title' || n.kind === 'quote') && n.text) return n.text;
      }
    }
  }
  return '';
}

/* ============================================================
 * 主题 / 背景：pageDoc 记值 + 副作用写进 settings.theme
 * ============================================================ */
export function applyThemeSideEffects(doc) {
  const t = (doc && doc.theme) || {};
  try {
    if (t.accent) theme.setAccent(t.accent);
    if (t.dark === true || t.dark === false) theme.setDark(t.dark);
    if (t.font) settings.set({ theme: { font: t.font } });
    // motion=true 表示"要动效" → 关闭流畅模式；false → 开启流畅模式（省性能）
    if (t.motion === true || t.motion === false) theme.setSmooth(!t.motion);
    if (t.density) settings.set({ theme: { density: t.density } });
  } catch (e) { /* 主题写失败不影响其他改动 */ }
  theme.apply();
}

export function applyBackgroundSideEffects(doc) {
  const b = (doc && doc.background) || {};
  try {
    if (b.preset) theme.setBackground(b.preset);
    if (b.image !== undefined && b.image !== null && b.image !== '') {
      settings.set({ theme: { bgImage: b.image } });
      theme.apply();
    }
    if (typeof b.mask === 'number') theme.setMask(b.mask);
    if (typeof b.blur === 'number') theme.setBlur(b.blur);
  } catch (e) { /* 同上 */ }
}

/* ============================================================
 * 指令实现：apply(doc, args) → { doc, note, effects? }
 * ============================================================ */
export const COMMANDS = {
  /* ---------- 结构 ---------- */
  'card.add': (doc, args) => {
    const cards = cloneCards(doc);
    if (visibleCount(cards) >= schema.LIMITS.MAX_CARDS) {
      return fail(
        '首页最多 ' + schema.LIMITS.MAX_CARDS + ' 张卡片',
        '首页最多同时放 ' + schema.LIMITS.MAX_CARDS + ' 张卡片，现在满着呢 —— 先删掉一张，或者把暂时不看的卡片「收纳」起来腾个位置'
      );
    }
    const blocks = blocksForType(args);
    if (!blocks.length) {
      return fail('这张卡片没有可渲染的内容', '这张卡片不知道要放什么 —— 说清楚内容再试，比如「加一张写着『距考研 100 天』的卡片」');
    }
    const card = {
      id: pageDoc.newCardId(doc),
      type: args.type || 'custom',
      builtin: false,
      visible: true,
      title: args.title || '',
      text: args.text || '',
      image: '',
      style: args.style || null,
      blocks: blocks
    };
    const next = withCards(doc, insertAt(cards, card, args.to));
    return { doc: next, note: '新增卡片「' + (card.title || card.type) + '」' };
  },

  /**
   * 整卡自由设计：布局 / 样式 / 数据 / 交互 / 内容都由 AI 定。
   * design 在 page-schema 里已经过 cardSpec.normalizeDesign 归一化，
   * 到这里时一定是"可渲染"的 —— 不需要再判合法性，只负责放对位置。
   */
  'card.design': (doc, args) => {
    const design = args.design;
    if (!design || !Array.isArray(design.sections)) {
      return { doc: null, note: '', error: '缺少可渲染的设计内容' };
    }
    const cards = cloneCards(doc);
    // 给了 target 就是改那张卡；改不到就报错，绝不悄悄新建（用户会以为改成功了）
    if (args.target) {
      const i = pageDoc.indexOfRef(doc, args.target);
      if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
      const old = cards[i];
      const next = Object.assign({}, old, {
        design: design,
        // 标题同步一份：编辑态卡片名、撤销摘要都要用它
        title: args.title || old.title || '',
        // 换成新设计后，老的扁平 blocks 就作废了（渲染器优先认 design）
        blocks: [],
        style: args.style ? Object.assign({}, old.style, args.style) : old.style
      });
      cards[i] = next;
      return { doc: withCards(doc, cards), note: '重新设计了「' + labelOf(next) + '」' };
    }
    if (visibleCount(cards) >= schema.LIMITS.MAX_CARDS) {
      return fail(
        '首页最多 ' + schema.LIMITS.MAX_CARDS + ' 张卡片',
        '首页最多同时放 ' + schema.LIMITS.MAX_CARDS + ' 张卡片，现在满着呢 —— 先删掉一张，或者把暂时不看的卡片「收纳」起来腾个位置'
      );
    }
    const card = {
      id: pageDoc.newCardId(doc),
      type: 'design',
      builtin: false,
      visible: true,
      title: args.title || '',
      text: '',
      image: '',
      style: args.style || null,
      blocks: [],
      design: design
    };
    return {
      doc: withCards(doc, insertAt(cards, card, args.to)),
      note: '新增一张自定义设计的卡片' + (card.title ? '「' + card.title + '」' : '')
    };
  },

  'card.remove': (doc, args) => {
    // 批量定位：target 是 "所有/全部/all" 时拿到的是全部下标（见 pageDoc.indicesOfRef）
    const idx = pageDoc.indicesOfRef(doc, args.target);
    if (!idx.length) {
      // 「去掉所有卡片」而首页本来就是空的：这不是"找不到某张卡"，别把用户带偏
      if (args.target && args.target.all) return fail('首页上没有卡片', '首页上已经没有卡片了');
      return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    }
    const cards = cloneCards(doc);
    if (idx.length > 1) {
      const keep = cards.filter((c, i) => idx.indexOf(i) < 0);
      return { doc: withCards(doc, keep), note: '删除全部 ' + idx.length + ' 张卡片' };
    }
    const gone = cards.splice(idx[0], 1)[0];
    return { doc: withCards(doc, cards), note: '删除卡片「' + labelOf(gone) + '」' };
  },

  'card.move': (doc, args) => {
    const from = pageDoc.indexOfRef(doc, args.target);
    if (from < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cards = cloneCards(doc);
    const card = cards.splice(from, 1)[0];
    let to = args.to;
    if (to === 'top') to = 0;
    else if (to === 'bottom') to = cards.length;
    else to = Math.max(0, Math.min(cards.length, Number(to) || 0));
    cards.splice(to, 0, card);
    return { doc: withCards(doc, cards), note: '把「' + labelOf(card) + '」移到第 ' + (to + 1) + ' 位' };
  },

  // hide / show 做成幂等：重复执行不算失败，否则场景宏里"隐藏一张本来就没上的卡"会整批挂掉
  'card.hide': (doc, args) => {
    const idx = pageDoc.indicesOfRef(doc, args.target);
    if (!idx.length) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cards = cloneCards(doc);
    let n = 0;
    idx.forEach(i => {
      if (cards[i].visible === false) return;    // 本来就收着 → 幂等跳过
      cards[i] = Object.assign({}, cards[i], { visible: false });
      n++;
    });
    if (!n) return { doc: doc, note: '', silent: true };
    return {
      doc: withCards(doc, cards),
      note: idx.length === 1 ? '隐藏卡片「' + labelOf(cards[idx[0]]) + '」' : '收纳了 ' + n + ' 张卡片'
    };
  },

  'card.show': (doc, args) => {
    const idx = pageDoc.indicesOfRef(doc, args.target);
    if (!idx.length) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cards = cloneCards(doc);
    let n = 0;
    idx.forEach(i => {
      if (cards[i].visible !== false) return;    // 本来就显示着 → 幂等跳过
      cards[i] = Object.assign({}, cards[i], { visible: true });
      n++;
    });
    if (!n) return { doc: doc, note: '', silent: true };
    return {
      doc: withCards(doc, cards),
      note: idx.length === 1 ? '显示卡片「' + labelOf(cards[idx[0]]) + '」' : '显示了 ' + n + ' 张卡片'
    };
  },

  'card.restore': (doc, args) => {
    const id = String(args.id || '');
    if (schema.BUILTIN_TYPES.indexOf(id) < 0) {
      return fail(
        '只能恢复内置卡片（' + schema.BUILTIN_TYPES.join('/') + '）',
        '只有被收纳起来的内置组件能加回来 —— AI 生成的卡片请在「添加组件」里加'
      );
    }
    if (pageDoc.indexOfRef(doc, { id: id }) >= 0) return fail('这张卡片已经在首页上', '这张卡片已经在首页上了');
    const cards = cloneCards(doc);
    cards.push(pageDoc.__builtin(id));
    return { doc: withCards(doc, cards), note: '加回卡片「' + id + '」' };
  },

  'card.reset': (doc) => {
    const fresh = pageDoc.defaultDoc();
    return { doc: fresh, note: '恢复默认首页', effects: [{ kind: 'resetTheme' }] };
  },

  /* ---------- 文案 ---------- */
  'text.set': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cards = cloneCards(doc);
    const cur = cards[i];
    // AI 造的卡正文在 blocks / design 里，改文案要同时改到节点，否则界面上看不到变化
    const blocks = (cur.blocks || []).map(b => {
      if (b.kind === 'text' || b.kind === 'quote') return Object.assign({}, b, { text: args.value });
      return Object.assign({}, b);
    });
    let nextCard = Object.assign({}, cur, {
      text: args.value,
      blocks: blocks.length ? blocks : cur.blocks
    });
    // 新设计规格：改第一个文案类节点（title / text），没有就整卡补一段正文
    if (!blocks.length && cur.design && Array.isArray(cur.design.sections)) {
      let hit = false;
      const sections = cur.design.sections.map(sec => Object.assign({}, sec, {
        items: (sec.items || []).map(n => {
          if (hit || (n.kind !== 'title' && n.kind !== 'text')) return n;
          hit = true;
          return Object.assign({}, n, { text: args.value });
        })
      }));
      if (hit) nextCard = Object.assign({}, nextCard, { design: Object.assign({}, cur.design, { sections: sections }) });
      else {
        const extra = cardSpec.normalizeNode({ kind: 'text', text: args.value });
        if (extra) {
          nextCard = Object.assign({}, nextCard, {
            design: Object.assign({}, cur.design, {
              sections: sections.concat([{ layout: 'stack', gap: 0, align: 'left', valign: '', items: [extra] }])
            })
          });
        }
      }
    }
    cards[i] = nextCard;
    return { doc: withCards(doc, cards), note: '改写「' + labelOf(cards[i]) + '」的文案' };
  },

  'text.rewrite': (doc, args) => {
    // target:"all" = 把首页上所有 AI 卡片的文案都改写一遍（内置卡的文案是功能性的，不动）
    if (args.target && args.target.all) {
      const effects = [];
      (doc.cards || []).forEach(c => {
        if (effects.length >= 4) return;                     // 最多改 4 张，别让用户干等
        if (c.builtin || c.visible === false) return;
        const origin = cardTextOf(c);
        if (!origin) return;
        effects.push({
          kind: 'rewrite',
          targetId: c.id,
          tone: args.tone,
          instruction: args.instruction || '',
          origin: origin
        });
      });
      if (!effects.length) {
        return { doc: null, note: '', error: '首页上没有可改写的 AI 卡片文案' };
      }
      return { doc: doc, note: '让 AI 用「' + args.tone + '」的语气改写 ' + effects.length + ' 张卡片的文案', effects: effects };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    // 需要再问一次模型 → 交给页面侧异步执行，执行完再补一条 text.set
    return {
      doc: doc,
      note: '让 AI 用「' + args.tone + '」的语气改写文案',
      effects: [{
        kind: 'rewrite',
        targetId: cards0(doc, i).id,
        tone: args.tone,
        instruction: args.instruction || '',
        origin: cards0(doc, i).text || ''
      }]
    };
  },

  'image.set': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cards = cloneCards(doc);
    const url = args.clear ? '' : (args.url || '');
    if (!args.clear && !url) return fail('缺少图片地址 url', '这张卡片没给图片地址 —— 说「给它换张图」我来自动生成');
    cards[i] = Object.assign({}, cards[i], { image: url });
    return { doc: withCards(doc, cards), note: args.clear ? '清除卡片配图' : '更换卡片配图' };
  },

  /* ---------- 样式 ---------- */
  'style.card': (doc, args) => {
    if (!args.style) return fail('缺少 style 参数', '没说清要改成什么样式 —— 比如「圆角调大一点」「字号大一些」');
    const cards = cloneCards(doc);
    // target:"all" = 所有卡片一起改（「把所有卡片圆角调大一点」）
    if (args.target && args.target.all) {
      const next = cards.map(c => Object.assign({}, c, { style: Object.assign({}, c.style, args.style) }));
      return { doc: withCards(doc, next), note: '调整全部 ' + next.length + ' 张卡片的样式' };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    cards[i] = Object.assign({}, cards[i], { style: Object.assign({}, cards[i].style, args.style) });
    return { doc: withCards(doc, cards), note: '调整「' + labelOf(cards[i]) + '」的样式' };
  },

  'style.text': (doc, args) => {
    const patch = {};
    if (args.size !== undefined && args.size !== null) patch.fontSize = args.size;
    if (args.weight) patch.fontWeight = args.weight;
    if (args.color) patch.color = args.color;
    if (args.align) patch.align = args.align;
    if (args.serif !== undefined) patch.serif = args.serif;
    const cards = cloneCards(doc);
    if (args.target && args.target.all) {
      const next = cards.map(c => Object.assign({}, c, { style: Object.assign({}, c.style, patch) }));
      return { doc: withCards(doc, next), note: '调整全部卡片的文字' };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return fail('没找到这张卡片', '首页上没找到这张卡片 —— 可以说「第 2 张」「最后一张」，或者直接写卡片标题');
    const cur = Object.assign({}, cards[i].style);
    cards[i] = Object.assign({}, cards[i], { style: Object.assign({}, cur, patch) });
    return { doc: withCards(doc, cards), note: '调整「' + labelOf(cards[i]) + '」的文字' };
  },

  /* ---------- 主题 ---------- */
  'theme.set': (doc, args) => {
    const cur = Object.assign({}, doc.theme);
    const patch = {};
    let touched = false;
    if (args.accent) { patch.accent = args.accent; touched = true; }
    if (args.dark === true || args.dark === false) { patch.dark = args.dark; touched = true; }
    if (args.font) { patch.font = args.font; touched = true; }
    if (args.motion === true || args.motion === false) { patch.motion = args.motion; touched = true; }
    if (args.density) { patch.density = args.density; touched = true; }
    if (!touched) return fail('theme.set 至少要给一个参数', '没听出你想把主题改成什么样 —— 比如「换成绿色主题」「字体用衬线」');
    const next = Object.assign({}, doc, { theme: Object.assign({}, cur, patch) });
    const names = Object.keys(patch).map(k => k + '=' + patch[k]).join('，');
    return { doc: next, note: '主题改为 ' + names, effects: [{ kind: 'theme' }] };
  },

  /* ---------- 背景 ---------- */
  'bg.set': (doc, args) => {
    const cur = Object.assign({}, doc.background);
    const patch = {};
    let touched = false;
    if (args.preset) { patch.preset = args.preset; patch.image = ''; patch.gradient = null; touched = true; }
    if (args.image) { patch.image = args.image; patch.gradient = null; touched = true; }
    if (typeof args.mask === 'number') { patch.mask = args.mask; touched = true; }
    if (typeof args.blur === 'number') { patch.blur = args.blur; touched = true; }
    if (args.gradient) { patch.gradient = args.gradient; patch.image = ''; touched = true; }
    if (args.mood) {
      // 心情换肤：一条指令同时定下渐变 + 主题色 + 密度
      const m = moodPreset(args.mood);
      patch.gradient = m.gradient;
      patch.image = '';
      touched = true;
      const nextTheme = Object.assign({}, doc.theme, { accent: m.accent, density: m.density });
      const next = Object.assign({}, doc, { background: Object.assign({}, cur, patch), theme: nextTheme });
      return {
        doc: next,
        note: '换成「' + args.mood + '」的背景与配色',
        effects: [{ kind: 'theme' }, { kind: 'bg' }]
      };
    }
    if (!touched) return fail('bg.set 至少要给一个参数', '没听出你想把背景改成什么样 —— 比如「背景换成安静的蓝色渐变」');
    const next = Object.assign({}, doc, { background: Object.assign({}, cur, patch) });
    return { doc: next, note: '调整背景', effects: [{ kind: 'bg' }] };
  },

  /* ---------- 学习目标 ---------- */
  'goal.set': (doc, args) => {
    const patch = {};
    if (typeof args.newWords === 'number') patch.newWords = args.newWords;
    if (typeof args.practice === 'number') patch.practice = args.practice;
    if (!Object.keys(patch).length) return fail('goal.set 至少要给一个参数', '没听出目标要改成多少 —— 比如「每天背 30 个新词」');
    try { wordbook.setGoal('', patch); } catch (e) { return fail('目标写入失败', '目标没存上，待会儿再试一次吧') }
    const txt = Object.keys(patch).map(k => (k === 'newWords' ? '每日新词' : '每日练习') + ' ' + patch[k]).join('，');
    return { doc: doc, note: '目标改为 ' + txt, effects: [{ kind: 'goal' }] };
  },

  /* ---------- 快照 ---------- */
  'skin.save': (doc, args) => {
    const name = String(args.name || '').trim();
    if (!name) return fail('缺少快照名称', '给这份快照起个名字吧 —— 比如「深夜模式」');
    try {
      const st = settings.get() || {};
      const skins = Object.assign({}, (st.home || {}).skins);
      skins[name] = JSON.parse(JSON.stringify(doc));
      settings.set({ home: { skins: skins } });
    } catch (e) { return { doc: null, note: '', error: '快照保存失败' } }
    return { doc: doc, note: '已把当前首页存成「' + name + '」' };
  },

  'skin.apply': (doc, args) => {
    const name = String(args.name || '').trim();
    const skins = ((settings.get() || {}).home || {}).skins || {};
    const hit = skins[name];
    if (!hit) return { doc: null, note: '', error: '没有叫「' + name + '」的快照' };
    const next = JSON.parse(JSON.stringify(hit));
    return { doc: next, note: '回到快照「' + name + '」', effects: [{ kind: 'theme' }, { kind: 'bg' }] };
  },

  /* ---------- 场景宏 ---------- */
  'macro.run': (doc, args) => {
    const name = String(args.name || '').trim();
    const m = MACROS[name];
    if (!m) return { doc: null, note: '', error: '没有叫「' + name + '」的场景' };
    // 宏 = 一组预设指令，交给 run 递归执行（保证走同一套校验）
    return { doc: doc, note: '进入「' + MACRO_NAMES[name] + '」模式', expand: m };
  },

  /* ---------- 语音 ---------- */
  'page.announce': (doc, args) => {
    const text = String(args.text || '').trim();
    if (!text) return { doc: null, note: '', error: '没有要朗读的内容' };
    return { doc: doc, note: '朗读一句话', effects: [{ kind: 'speak', text: text }] };
  }
};

function cards0(doc, i) {
  return (doc.cards || [])[i] || {};
}

export const MACRO_NAMES = { exam: '考试冲刺', commute: '通勤碎片', bedtime: '睡前复习', focus: '沉浸专注' };

export const MACROS = {
  exam: [
    { op: 'card.move', args: { target: { id: 'action' }, to: 'top' } },
    { op: 'card.show', args: { target: { id: 'goal' } } },
    { op: 'card.hide', args: { target: { id: 'favorites' } } },
    { op: 'theme.set', args: { accent: 'rose', density: 'compact' } },
    { op: 'bg.set', args: { gradient: { from: '#FFF1F1', to: '#FFD9D9', angle: 165 } } },
    { op: 'goal.set', args: { newWords: 30, practice: 20 } }
  ],
  commute: [
    { op: 'card.move', args: { target: { id: 'action' }, to: 'top' } },
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'theme.set', args: { accent: 'teal', density: 'compact' } },
    { op: 'bg.set', args: { preset: 'mint' } },
    { op: 'goal.set', args: { practice: 10 } }
  ],
  bedtime: [
    { op: 'card.move', args: { target: { id: 'chart' }, to: 'top' } },
    { op: 'theme.set', args: { accent: 'purple', dark: true, density: 'relaxed' } },
    { op: 'bg.set', args: { gradient: { from: '#232043', to: '#151226', angle: 165 } } }
  ],
  focus: [
    { op: 'card.hide', args: { target: { id: 'favorites' } } },
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'theme.set', args: { accent: 'graphite', motion: false, density: 'compact' } },
    { op: 'bg.set', args: { preset: 'default' } }
  ]
};

/** 心情 → 渐变 + 主题色 + 密度 */
export function moodPreset(mood) {
  const m = String(mood || '');
  const table = [
    // 颜色词行放最前：模型/用户描述常直接写「蓝色渐变」，命中颜色就该按颜色来，
    // 否则「安静的蓝色渐变」会先撞上「安静」掉进深海军蓝，跟用户想要的浅蓝差很远
    { k: ['绿'], g: { from: '#E1F4EA', to: '#C6EBD9', angle: 165 }, a: 'green', d: 'cozy' },
    { k: ['粉', '樱'], g: { from: '#FFE8F0', to: '#F3D9E6', angle: 165 }, a: 'rose', d: 'relaxed' },
    { k: ['紫', '薰衣草'], g: { from: '#E9E4F7', to: '#D5CBF0', angle: 165 }, a: 'purple', d: 'relaxed' },
    { k: ['黄', '橙', '金'], g: { from: '#FDF3E3', to: '#F7DFC4', angle: 165 }, a: 'amber', d: 'cozy' },
    { k: ['黑', '深色', '暗'], g: { from: '#232043', to: '#151226', angle: 165 }, a: 'purple', d: 'relaxed' },
    { k: ['蓝'], g: { from: '#DCEAFF', to: '#B9D5FF', angle: 165 }, a: 'blue', d: 'relaxed' },
    { k: ['沉静', '冷静', '安静', '下雨', '雨天'], g: { from: '#1E3A5F', to: '#0F1B2D', angle: 165 }, a: 'blue', d: 'relaxed' },
    { k: ['活泼', '开心', '周五', '轻快'], g: { from: '#FFE29F', to: '#FFA99F', angle: 165 }, a: 'amber', d: 'cozy' },
    { k: ['温暖', '暖', '治愈'], g: { from: '#FDF3E3', to: '#F7DFC4', angle: 165 }, a: 'amber', d: 'relaxed' },
    { k: ['清新', '薄荷', '清爽'], g: { from: '#E1F4EA', to: '#C6EBD9', angle: 165 }, a: 'green', d: 'cozy' },
    { k: ['专注', '严肃', '认真'], g: { from: '#E9ECEA', to: '#D6DBD8', angle: 165 }, a: 'graphite', d: 'compact' },
    { k: ['浪漫', '温柔', '柔和'], g: { from: '#FFE8F0', to: '#F3D9E6', angle: 165 }, a: 'rose', d: 'relaxed' },
    { k: ['夜晚', '夜间', '睡前'], g: { from: '#232043', to: '#151226', angle: 165 }, a: 'purple', d: 'relaxed' }
  ];
  for (const row of table) {
    if (row.k.some(x => m.indexOf(x) >= 0)) return { gradient: row.g, accent: row.a, density: row.d };
  }
  return { gradient: { from: '#EEF3F0', to: '#DCE7E1', angle: 165 }, accent: 'blue', density: 'cozy' };
}

/* ============================================================
 * 执行：原子性 —— 任一条失败就整体不写入
 * ============================================================ */
/**
 * @param {object} doc  当前 pageDoc（不会被修改）
 * @param {object[]} cmds 已归一化的指令
 * @param {object} opt { summary, live }
 * @returns { ok, doc, applied[], failed, reason, rawReason, effects[] }
 *   reason    —— 给人看的一句话，home.vue 会直接渲染（绝不含内部操作名）
 *   rawReason —— 带操作名的精确串，只用于日志/模型回喂
 */
export function run(doc, cmds, opt) {
  const o = opt || {};
  const start = doc;
  let cur = doc;
  const applied = [];
  const effects = [];

  const queue = [];
  (cmds || []).forEach(c => queue.push(c));

  // 失败时的 reason 会被 home.vue 的指令条**原样渲染**，所以只能放人话；
  // 带内部操作名的精确串一律进 rawReason / console（排查用，用户永远不该看到）。
  const bail = (cmd, raw, human) => {
    try { console.warn('[page-command] ' + raw) } catch (e) { /* 日志失败不影响返回 */ }
    return {
      ok: false,
      doc: start,
      applied: applied,
      failed: cmd,
      reason: human,
      rawReason: raw,
      effects: []
    };
  };

  // 宏展开：展开后的指令同样要走校验（不能因为是内置的就绕过）
  let guard = 0;
  while (queue.length && guard++ < 40) {
    const cmd = queue.shift();
    const impl = COMMANDS[cmd.op];
    if (!impl) {
      return bail(cmd, '不支持的指令 ' + cmd.op, '这个操作我这边做不了，换个说法试试');
    }
    let r;
    try {
      r = impl(cur, cmd.args || {});
    } catch (e) {
      r = fail(String((e && e.message) || '执行出错'), '这条指令没能执行，页面保持原样');
    }
    if (!r.doc) {
      const precise = r.error || '执行失败';
      // 指令自己带 human 最好；没带就退到精确原因，但要先抹掉 'card.add：' 这类前缀
      return bail(cmd, cmd.op + '：' + precise, r.human || stripOp(precise) || '这条指令没能执行');
    }
    if (r.expand) {
      // 宏：把展开的指令插到队首（保持原有顺序）
      const norm = schema.normalizeCommands(r.expand);
      if (!norm.ok) {
        return bail(cmd, '宏展开失败：' + norm.errors.join('；'), '这组内置操作没能展开，页面保持原样');
      }
      // 宏是"尽力而为"的组合：针对某张卡的指令，若这张卡不在首页就跳过，
      // 免得「隐藏收藏速览」在没上首页时把整组指令带崩。
      const safe = norm.commands.filter(c => {
        if (MACRO_SKIPPABLE.indexOf(c.op) < 0) return true;
        return pageDoc.indexOfRef(cur, c.args && c.args.target) >= 0;
      });
      queue.unshift.apply(queue, safe);
      applied.push({ op: cmd.op, note: r.note });
      continue;
    }
    cur = r.doc;
    // silent = 幂等命中（如"隐藏一张已经隐藏的卡"）：不计入摘要，避免刷屏
    if (!r.silent) applied.push({ op: cmd.op, note: r.note || '' });
    (r.effects || []).forEach(e => effects.push(e));
  }

  return { ok: true, doc: cur, applied: applied, failed: null, reason: '', effects: effects };
}

/** 解析 + 执行一步到位（页面侧主入口） */
export function applyCommands(doc, rawCmds, opt) {
  const n = schema.normalizeCommands(rawCmds);
  if (!n.ok) {
    // 同 run()：reason 会直接上界面。schema 的报错是「第 1 条：card.add：…」这种
    // 给模型看的精确串，去掉前缀才勉强能看，所以给人话兜一层。
    const precise = n.errors.join('；');
    try { console.warn('[page-command] 指令校验没通过：' + precise) } catch (e) { /* 见上 */ }
    const human = n.errors.map(stripOp).filter(Boolean).join('；');
    return {
      ok: false, doc: doc, applied: [], failed: null,
      reason: human || '这条指令没能解析成合法操作，换个说法试试',
      rawReason: precise,
      effects: [], errors: n.errors
    };
  }
  const r = run(doc, n.commands, opt);
  r.errors = n.errors;   // 被校验跳过的指令（已截断但仍是有效指令）
  return r;
}

/* ============================================================
 * 历史栈：撤销
 * ============================================================ */
/**
 * 入栈时连 settings.theme 一起留一份快照。
 * 原因：pageDoc.theme 是**稀疏**的（没改过的字段是 '' / null），
 * 只靠它还原不了"改之前是什么样"——比如 doc.theme.dark=null 既可能是"用户没说"，
 * 也可能是"撤销回没改过的状态"。带上这份基线，撤销才是真正的一步到位。
 */
export function snapshot(doc, summary) {
  const st = settings.get() || {};
  let th = null;
  let perf = null;
  try { th = JSON.parse(JSON.stringify(st.theme || {})); } catch (e) { th = null; }
  try { perf = JSON.parse(JSON.stringify(st.performance || {})); } catch (e) { perf = null; }
  history.push({
    doc: JSON.parse(JSON.stringify(doc)),
    theme: th,
    perf: perf,
    summary: summary || '',
    at: Date.now()
  });
  if (history.length > MAX_HISTORY) history.shift();
}

export function undo() {
  if (!history.length) return null;
  const last = history.pop();
  pageDoc.save(last.doc);
  // 还原外观：settings.set 是深合并、删不掉键，所以先用 defaults 补齐成一份完整的
  // 配置再整体写回，这样"改动前没这个键"也能正确回到没有的状态。
  try {
    const def = settings.defaults();
    const th = Object.assign({}, def.theme, last.theme || {});
    settings.set({ theme: th });
    if (last.perf) settings.set({ performance: Object.assign({}, def.performance, last.perf) });
  } catch (e) { /* 主题回退失败不影响其它改动 */ }
  applyThemeSideEffects(last.doc);
  applyBackgroundSideEffects(last.doc);
  return last.doc;
}

export function canUndo() {
  return history.length > 0;
}

export function lastUndo() {
  return history.length ? history[history.length - 1] : null;
}

export function clearHistory() {
  history = [];
}

/* ============================================================
 * 提交：执行成功后的收尾（落盘 + 主题/背景副作用）
 * ============================================================ */
export function commit(doc, summary) {
  snapshot(pageDoc.get(), summary || '');
  pageDoc.save(doc);
  applyThemeSideEffects(doc);
  applyBackgroundSideEffects(doc);
  return doc;
}

/** 生成给用户的变更摘要 */
export function summaryOf(applied) {
  const list = (applied || []).filter(a => a.note).map(a => a.note);
  if (!list.length) return '没有可应用的改动';
  return list.join('，');
}
