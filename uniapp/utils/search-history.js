// utils/search-history.js - 搜索历史（本机存档）
//
// 存的是「我查过哪些词」，不是「我现在在背什么」——
// 所以它单独一个 key，换词书、清学习数据都不该把它带走（清缓存/卸载才没）。
//
// 什么时候记一笔：
//   · 回车提交（用户明确要查这个）
//   · 点开某条结果（查到了、进词条页看详情，说明这次搜索有价值）
// 边打字边记会把 ru / runn 这些半成品灌进来，历史就废了。

const KEY = 'fj_search_history_v1';
// 最多留多少条：这是"最近查过"，不是流水账，超过就丢最旧的
const MAX = 20;

function read() {
  try {
    const v = uni.getStorageSync(KEY);
    if (!v) return [];
    const list = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (x) { return x && typeof x.w === 'string' && x.w.trim(); })
      .slice(0, MAX);
  } catch (e) {
    return [];
  }
}

function write(list) {
  try {
    uni.setStorageSync(KEY, list);
    return true;
  } catch (e) {
    return false;
  }
}

/** 最近查过的词（新的在前） */
export function list() {
  return read();
}

/**
 * 记一笔。同一个词再来一次就提到最前面（不去重的话，"查过"这件事会被埋掉）。
 * @param w 词形（可带大小写）
 * @returns 是否真的写进去了
 */
export function add(w) {
  const word = String(w == null ? '' : w).trim();
  // 至少要有个字母或汉字：标点、乱码、"[object Object]" 不该进历史
  if (!word || !/[a-zA-Z\u4e00-\u9fa5]/.test(word)) return false;
  const lower = word.toLowerCase();
  const cur = read();
  const kept = cur.filter(function (x) { return String(x.w).toLowerCase() !== lower; });
  kept.unshift({ w: word, at: Date.now() });
  return write(kept.slice(0, MAX));
}

/** 删掉一条（点历史词右边的 × ） */
export function remove(w) {
  const lower = String(w == null ? '' : w).trim().toLowerCase();
  if (!lower) return false;
  const kept = read().filter(function (x) { return String(x.w).toLowerCase() !== lower; });
  return write(kept);
}

/** 全部清空（「清空」按钮） */
export function clear() {
  return write([]);
}
