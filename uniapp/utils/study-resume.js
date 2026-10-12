// utils/study-resume.js - 练习页的「断点续练」存盘
//
// 为什么要有它：背单词 / 句子练习的场次状态（这一组是哪些题、练到第几题、
// 每个词连对几次）原先**只活在页面内存里**。退出页面（返回上一页、切到别的应用被回收、
// 甚至只是误触返回）进程一销毁，回来就从第一题重来 —— 用户实测反馈过「太伤」。
//
// 注意区分两件事：
//   · **学习成果**（掌握度、今日计数）本来就即时落盘，退出不丢，这里不管；
//   · **场次进度**（这一组练到哪了）以前不落盘，这才是本模块要补的。
//
// 存的是 storage 而不是模块级变量：页面销毁后模块级变量一样没了（App 被系统回收时
// 整个 JS 上下文都没了），只有落到 storage 才扛得住"退出 App 再进来"。
//
// 两份快照分开存（背单词 / 句子练习各一把钥匙），互不覆盖：
// 用户完全可能两组都练到一半，只留一份的话另一边的进度会被顶掉。

const PREFIX = 'fj_study_resume_v1_';
const KINDS = { drill: 'drill', practice: 'practice' };

// 过期时间：放太久的断点没有意义 —— 词书可能换了、那批词早就复习过好几轮了，
// 硬把人塞回两周前的第 7 题反而莫名其妙。超过就当没有，静默重新组一组。
const TTL_MS = 7 * 24 * 3600 * 1000;

// 一份快照最多存多少题。防止"题目对象异常膨胀 / 被人塞进脏数据"时把 storage 撑爆。
const MAX_ITEMS = 200;

function keyOf(kind, bookId, source) {
  return PREFIX + kind + '_' + String(bookId || 'cur') + '_' + String(source || 'daily');
}

function nowMs() {
  return Date.now();
}

/**
 * 取一份快照。
 * 返回 null 的情况一律当"没有断点"，调用方直接重新组一组 —— 这条路径必须
 * **永远安全**：过期、损坏、词书对不上、storage 不可用，都不许抛到页面上。
 */
export function load(kind, bookId, source) {
  try {
    const raw = uni.getStorageSync(keyOf(kind, bookId, source));
    if (!raw) return null;
    const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!snap || typeof snap !== 'object') return null;
    // 版本不同 → 结构可能变了，直接丢（宁可让用户从头来，也不要拿错结构去渲染）
    if (Number(snap.v) !== 1) return null;
    if (!snap.at || nowMs() - Number(snap.at) > TTL_MS) return null;
    const items = Array.isArray(snap.items) ? snap.items : null;
    if (!items || !items.length) return null;
    if (items.length > MAX_ITEMS) return null;
    return snap;
  } catch (e) {
    // 存的是坏 JSON / storage 不可用：当没存过，不打扰用户
    return null;
  }
}

/**
 * 存一份快照。写失败（配额满 / 隐私模式）不算错误 —— 最坏的结果只是"这次没记住进度"，
 * 回到改之前的行为，绝不能因此弹错或中断练习。
 */
export function save(kind, bookId, source, payload) {
  try {
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    // 一组题都没得练了就别存，直接清掉更干净（否则下次进来恢复出个空场次）
    if (!items.length) { clear(kind, bookId, source); return false; }
    const snap = {
      v: 1,
      at: nowMs(),
      bookId: String(bookId || ''),
      source: String(source || ''),
      items: items.slice(0, MAX_ITEMS)
    };
    // 场次内部状态（队列 / 连对次数 / 计数）整块透传，由各自的页面定结构
    Object.keys(payload || {}).forEach(k => {
      if (k === 'items') return;
      snap[k] = payload[k];
    });
    uni.setStorageSync(keyOf(kind, bookId, source), JSON.stringify(snap));
    return true;
  } catch (e) {
    return false;
  }
}

/** 清一份快照（练完了 / 用户要换一组 / 换词书换来源都用得上） */
export function clear(kind, bookId, source) {
  try { uni.removeStorageSync(keyOf(kind, bookId, source)); } catch (e) {}
}

/** 清掉某个页面下所有词书、所有来源的断点（换词书时用它，避免留下孤儿） */
export function clearAll(kind) {
  try {
    const info = uni.getStorageInfoSync ? uni.getStorageInfoSync() : null;
    const keys = (info && info.keys) || [];
    const head = PREFIX + kind + '_';
    keys.forEach(k => {
      if (String(k).indexOf(head) === 0) {
        try { uni.removeStorageSync(k); } catch (e) {}
      }
    });
  } catch (e) {}
}

export const KIND = KINDS;
