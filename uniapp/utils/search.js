// utils/search.js - 首页顶部搜索的检索与入库逻辑（与页面解耦，便于单测）
//
// 检索顺序：当前词书（内置词 + 该书导入词）→ 常用词典 / 词形还原（dict.lookup）
// 入库：复用导入管道 importer.validateAndDedupe + importIntoBook，
//      保证与「词库 → 导入单词」完全一致（去重校验、id 规则、点读缓存失效）。

import * as wordbook from './wordbook.js';
import * as dict from './dict.js';
import * as importer from './importer.js';

const DEFAULT_LIMIT = 20;

// 什么样的查询值得再走一遍词典兜底：单个英文词（含连字符 / 撇号）。
// 中文释义、整句、"[object Object]" 之类都不该往词典里塞。
const LATIN_WORD = /^[a-zA-Z][a-zA-Z'-]*$/;

/**
 * 分档排序：数字越小越靠前。
 *   1 EXACT    —— 与输入一模一样（run → run）
 *   2 LEMMA    —— 输入是它的某种变形（studies → study、running → run）
 *   3 PREFIX   —— 以输入开头（comp → computer / compare）
 *   4 TYPO     —— 拼写最接近（recieve → receive），宁疑似熟悉也要排在"只是顺带含着"之前
 *   5 SUBSTR   —— 词形里含（in → engine / criminal）
 *   6 MEANING  —— 只有释义里含（查中文时走这一档）
 *
 * 这六档的存在理由就是用户那句实测反馈：「大量相似词淹没了我要查的那个词」。
 * 以前是按词书原始顺序一把梭，搜 "in" 会先撞上两百多条"含 in"的词，
 * 真正的 "in" 排在很后面；现在它永远在第 1 档的第 1 条。
 */
export const TIER = { EXACT: 1, LEMMA: 2, PREFIX: 3, TYPO: 4, SUBSTR: 5, MEANING: 6 };

/**
 * 拼写容错的编辑距离上限。短词必须给 0 ——
 * 输入 2 个字母时几乎所有词都和它"差一个字母"（in / an / on / it / is），
 * 一旦放行，热门位置上全是不相干的词，正好反过来淹没目标词。
 */
function typoLimit(q) {
  if (!LATIN_WORD.test(q)) return 0;   // 中文查询不做拼写纠错
  const n = q.length;
  if (n < 4) return 0;                 // 太短：不纠错
  if (n < 6) return 1;                 // receiver / recieve 差 1
  return 2;                            // 长词容许差 2（双写、s/em 这类）
}

/**
 * 有上限的编辑距离（Damerau–Levenshtein）：超过 cap 就提前退出，返回 cap + 1。
 * 每次搜索要扫几千条词条，跑完整版动态规划太浪费；大多数字词在头两三个字符就分出胜负了。
 *
 * ⚠️ 必须带"相邻字符对调"（transposition）：最常见的手误就是 ie/ei、 Form 顺序打反
 * （recieve → receive）。只算增删改的话 receive 距离是 2，会被 relieve、recipe 这些
 * 距离 1 的词压在下面 —— 用户拼错了，我们却把正确答案排在第七条，等于没纠错。
 */
export function boundedEdit(a, b, cap) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  let p2 = null;                      // i-2 行（算对调时要往回看两行）
  let p1 = new Array(lb + 1);         // i-1 行
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) p1[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charAt(j - 1) ? 0 : 1;
      let v = p1[j - 1] + cost;
      const del = p1[j] + 1;
      const ins = cur[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ca === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        const swap = p2[j - 2] + 1;
        if (swap < v) v = swap;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // 这一整行的最小编辑距离已经超过上限 → 最终值不可能再回到上限之内
    if (rowMin > cap) return cap + 1;
    const spare = p2;
    p2 = p1; p1 = cur; cur = spare || new Array(lb + 1);
  }
  return p1[lb];
}

/**
 * 判定一条词条落在哪一档；返回 0 表示不相关。
 * @param form 词条的小写词形
 * @param lower 查询词的小写形式
 * @param cap   拼写容错上限（0 = 这一轮不做纠错）
 */
function tierOf(form, lower, cap) {
  if (form === lower) return TIER.EXACT;
  if (form.indexOf(lower) === 0) return TIER.PREFIX;
  if (cap > 0 && Math.abs(form.length - lower.length) <= cap &&
      boundedEdit(form, lower, cap) <= cap) return TIER.TYPO;
  if (form.indexOf(lower) > 0) return TIER.SUBSTR;
  return 0;
}

/**
 * 同一档内部的"接近程度"：越小越靠前。
 *   前缀 / 包含 → 词越短越接近输入；拼写纠错 → 先按编辑距离，再按词长。
 * 不做这一步的话，档内顺序取决于语料里的行号：搜 recieve 时 receive 被排在
 * believe / recede 后面，等于把"拼写最接近"这条承诺又丢了一半。
 */
function closeness(tier, row, lower, cap) {
  const w = String(row.w || '').toLowerCase();
  if (tier === TIER.PREFIX || tier === TIER.SUBSTR) return w.length * 10 + w.indexOf(lower);
  if (tier === TIER.TYPO) return boundedEdit(w, lower, cap) * 1000 + w.length;
  return w.length;
}

/**
 * 本地检索：跨「当前词书 + 全量本地词典」，按上面的六档排序返回。
 *
 * 检索范围为什么扩了（用户实测：有些词明明有、就是搜不到）：
 *   以前第一步只扫当前词书，内置那 7000 多个词条只有**拼完整了**才被 dict.lookup 捞得到，
 *   于是换个词书能搜到的东西就少一大截，输入一半更是直接归零。
 *   现在 dict.searchRows() 给出全量平表（核心 / 常用词 / 内置词书 / 补充词库），
 *   前缀、拼写近似、中文释义全部走同一套扫描，判不到 "in" 这种情况基本消失。
 *
 * 刻意不含的部分：别的词书里的导入词（那是别人的私人内容，搜 A 书不该蹦出 B 书的词，
 * check-search 第 6 组守这条）。当前词书自己的导入词照旧在第一步就被扫到。
 *
 * @returns [{ w, pos, m, fromText, tier }]，已按档位排好并截断到 limit
 */
export function localSearch(bookId, kw, limit) {
  const q = String(kw || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const max = limit || DEFAULT_LIMIT;

  // 为什么要扫两遍：拼写纠错（TYPO）只在"连一个一模一样 / 前缀命中的都没有"时才用得上，
  // 而它是对每条词条跑一次编辑距离 —— 七八千条下来是实打实的十几毫秒。
  // 先按 cap=0（不纠错）扫一遍，只有在确实没抓到强命中时才重扫一次带上纠错。
  let res = collect(bookId, q, lower, 0);
  const cap = typoLimit(lower);
  if (cap > 0 && !res.strong) res = collect(bookId, q, lower, cap);

  return merge(res, lower, cap, max);
}

/** 扫一遍全部候选，按档位分桶。cap = 0 时跳过拼写纠错那一档。 */
function collect(bookId, q, lower, cap) {
  const seen = Object.create(null);   // 小写词形 → 已收录：同一个词只出现一条
  const buckets = [[], [], [], [], [], [], []];   // 下标即档位，0 号不用
  let seq = 0;                        // 收录顺序：当前词书先扫，同等接近时它排前面

  const put = function (tier, row) {
    buckets[tier].push({ row: row, o: seq++ });
  };

  // 先扫当前词书：**优先级高于词典**。同一个词既在书里又在词典里时，
  // 界面上要显示"当前词书"（用户关心的是这个词在不在他正在背的这本里）。
  try {
    const bid = bookId || wordbook.currentBookId();
    wordbook.bookWords(bid).forEach((w) => {
      const form = String(w.w || '').toLowerCase();
      if (!form || seen[form]) return;
      let tier = tierOf(form, lower, cap);
      if (!tier && String(w.m || '').indexOf(q) >= 0) tier = TIER.MEANING;
      if (!tier) return;
      seen[form] = 1;
      put(tier, { w: w.w, pos: w.pos || '', m: w.m || '', fromText: '当前词书', tier: tier });
    });
  } catch (e) {
    /* 词书读取失败则跳过，继续走全量词典 */
  }

  // 再扫全量本地词典：只补上面没出现过的词形。
  // 这里用固化好的数组而不是 dict.forEachEntry 就地遍历 —— 每次按键都要扫一遍，
  // 拿约 570KB 常驻内存换一半的时间（实测 7.7ms → 4.5ms），手机上感知得到。
  try {
    dict.searchRows().forEach((r) => {
      const form = r.k;
      if (seen[form]) return;
      let tier = tierOf(form, lower, cap);
      if (!tier && r.m && r.m.indexOf(q) >= 0) tier = TIER.MEANING;
      if (!tier) return;
      seen[form] = 1;
      put(tier, {
        w: r.w,
        pos: r.pos || '',
        m: r.m || '',
        fromText: (dict.SRC_LABEL && dict.SRC_LABEL[r.src]) || '词典',
        tier: tier
      });
    });
  } catch (e) {
    /* 词典读不出来不影响词条性质的结果 */
  }

  // 词形还原兜底：输入的是一个词的变形（studies / running / better）。
  // 放在第 2 档 —— 比"前缀像"更贴近用户要找的东西，但又排在真的一模一样之后。
  if (!buckets[TIER.EXACT].length && LATIN_WORD.test(q)) {
    try {
      const e = dict.lookup(q);
      const key = String((e && e.w) || '').toLowerCase();
      // custom 不算 —— 那是别的词书里的导入词，会让人误以为已在本词书里，也会挡掉 AI 补词路径
      if (e && e.found && e.src !== 'custom' && key && !seen[key]) {
        seen[key] = 1;
        put(TIER.LEMMA, {
          w: e.w,
          pos: e.pos || '',
          m: e.meaning || '',
          fromText: (dict.SRC_LABEL && dict.SRC_LABEL[e.src]) || '词典',
          tier: TIER.LEMMA
        });
      }
    } catch (e) {
      /* 查词失败视为未命中 */
    }
  }

  // strong = 已经找到了"高度匹配"的东西：一模一样 / 就是它的变形 / 前缀就能看出来。
  // 有它就不再做拼写纠错（省一次全表扫描，也避免噪声）。
  return {
    buckets: buckets,
    strong: buckets[TIER.EXACT].length > 0 || buckets[TIER.LEMMA].length > 0 ||
      buckets[TIER.PREFIX].length > 0
  };
}

/** 把分好档的桶摊平成结果列表 */
function merge(res, lower, cap, max) {
  const buckets = res.buckets;
  // 拼写纠错只在**连一个一模一样的、或前缀命中的都没有**时才出手。
  // 已经打对了（improve）或打到一半已经看得出（comput）还列一堆 prove / approve / commit，
  // 就是拿"纠错"的名义重新制造噪声 —— 这正是用户说的"相似词淹没目标词"。
  const noisy = res.strong;
  const out = [];
  for (let t = TIER.EXACT; t <= TIER.MEANING; t++) {
    if (t === TIER.TYPO && noisy) continue;
    const list = buckets[t];
    if (t === TIER.PREFIX || t === TIER.TYPO || t === TIER.SUBSTR) {
      list.forEach(function (x) { x.d = closeness(t, x.row, lower, cap); });
      list.sort(function (a, b) { return a.d - b.d || a.o - b.o; });
    }
    for (let i = 0; i < list.length && out.length < max; i++) out.push(list[i].row);
  }
  return out;
}

// 把一个词写进词书（本地）
// item: { word, pos, meaning, example?: { en, zh } }
// opts: { allowKnown?: boolean } —— true 表示「核心词典里已有也不算重复」，
//       用于单词详情页的「加入词书」（同一个词可以收进多本书）。
// 返回 { added, reason } —— added=false 时 reason 说明原因（已存在 / 词形非法 …）
export function addWordToBook(bookId, item, opts) {
  const bid = bookId || wordbook.currentBookId();
  const word = String((item && item.word) || '').trim();
  if (!word) return { added: false, reason: '词形为空' };

  const { accepted, rejected } = importer.validateAndDedupe(
    [{ word, pos: (item && item.pos) || '', meaning: (item && item.meaning) || '' }],
    bid,
    opts
  );
  if (!accepted.length) {
    const r = rejected && rejected[0];
    return { added: false, reason: (r && r.reason) || '未能加入词库' };
  }
  try {
    const res = importer.importIntoBook(accepted, bid);
    // 例句：直接复用 AI 释义里带的例句，省掉一次生成请求
    const ex = item && item.example;
    if (ex && ex.en) {
      try { importer.attachExampleTo(bid, word, ex.en, ex.zh || '') } catch (e) { /* 例句写入失败不影响入库 */ }
    }
    return { added: !!(res && res.added), reason: '' };
  } catch (e) {
    return { added: false, reason: '写入失败' };
  }
}
