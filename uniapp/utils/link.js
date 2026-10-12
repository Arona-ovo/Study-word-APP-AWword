// utils/link.js - 与「PWstudy」番茄钟 App 的联动
//
// 协议由 PWstudy 侧定死（见 PWstudy 仓库的 uniapp/utils/link.js），这边只做另一半。
//
// ① 进来：PWstudy → AWword
//      awword://study?minutes=25&task=<taskId>&back=<urlencoded 回跳地址>
//    minutes 是那边建议的本次时长，back 是学完该跳回去的地址。
//    ⚠️ 光写这个文件不够 —— 还必须在 manifest.json 的
//       app-plus.distribute.android.schemes 里声明 "awword"，系统才认这个 scheme。
//
// ② 回去：AWword → PWstudy
//      pwstudy://vocab-done?min=<实际分钟>&words=<本次学会的词数>&task=<taskId>
//    min 用**真实**停留时长，不是进来时那个建议值。
//    words 用确认通过（真正算学会）的题数 —— 这个数 PWstudy 那边永远测不到：
//    它只有系统的使用情况统计，只看得见"你在 AWword 待了 25 分钟"，
//    看不见你在这 25 分钟里过了几个词。所以词数只能由这边回传。
//
// ③ 没从 PWstudy 进来时：ctx 为空，这个模块不参与任何流程，行为与本改动之前完全一致。

import * as partner from './partner.js'

export const SCHEME = 'awword';
export const PARTNER_SCHEME = 'pwstudy';
// 与 PWstudy 侧同一个 key：那边拿它把时长记进 daily[].byApp['app:awword']
export const PARTNER_KEY = 'app:awword';

/* ==================== 本次会话的上下文 ====================
 * 模块级单例：App.vue 在唤起时写入，练习页读它决定"要不要结束时回跳"。
 * 不走 storage —— 它只活在一次跳转的生命周期里，杀进程就该丢。
 */
let ctx = null;

function enc(s) {
  return encodeURIComponent(String(s == null ? '' : s));
}

/** 解析一条 awword:// 链接；不是本 scheme 返回 null */
export function parse(url) {
  const raw = String(url || '');
  const i = raw.indexOf('://');
  if (i < 0) return null;
  if (raw.slice(0, i).toLowerCase() !== SCHEME) return null;
  let rest = raw.slice(i + 3);
  let query = '';
  const q = rest.indexOf('?');
  if (q >= 0) { query = rest.slice(q + 1); rest = rest.slice(0, q); }
  const params = {};
  query.split('&').forEach((pair) => {
    if (!pair) return;
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    try {
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch (e) {
      params[k] = v;
    }
  });
  return { kind: rest.split('/').filter(Boolean)[0] || '', params };
}

/**
 * 把 kv 合并进一个 URL 的 query（已存在的 key 覆盖，不存在的新增）。
 * 回跳地址是 PWstudy 生成的、可能带别的参数，所以不能直接拼一个新的 —— 要在它身上改。
 */
function mergeQuery(url, kv) {
  const i = url.indexOf('?');
  const head = i >= 0 ? url.slice(0, i) : url;
  const q = i >= 0 ? url.slice(i + 1) : '';
  const out = [];
  const seen = {};
  q.split('&').forEach((pair) => {
    if (!pair) return;
    const k = pair.split('=')[0];
    seen[k] = 1;
    if (Object.prototype.hasOwnProperty.call(kv, k)) out.push(k + '=' + enc(kv[k]));
    else out.push(pair);
  });
  Object.keys(kv).forEach((k) => {
    if (seen[k]) return;
    if (kv[k] === undefined || kv[k] === null || kv[k] === '') return;
    out.push(k + '=' + enc(kv[k]));
  });
  return out.length ? head + '?' + out.join('&') : head;
}

export function openUrl(url) {
  if (!url) return false;
  // #ifdef APP-PLUS
  try {
    plus.runtime.openURL(url);
    return true;
  } catch (e) {}
  // #endif
  return false;
}

/* ==================== 进来 ==================== */

export function hasCtx() {
  return !!ctx;
}

export function getCtx() {
  return ctx;
}

export function clearCtx() {
  ctx = null;
}

/**
 * 处理一条进来的链接（App.vue 冷启动 / newintent 时调用）。
 * 认领了就存下上下文并跳到练习页，返回 true。
 *
 * @param {string} url  plus.runtime.arguments
 * @param {function} [go]  测试/自定义跳转用；不给就 navigateTo 练习页
 */
export function consume(url, go) {
  const link = parse(url);
  if (!link || link.kind !== 'study') return false;
  const minutes = Math.round(Number(link.params.minutes) || 0);
  // linked：对面（PWstudy）现在是不是把我们当关联伙伴。
  //   0      → 手动模式：来路提示保留「回去」按钮，但学完不替用户自动跳
  //   1 / 没这个参数 → 自动模式（没这个参数 = 老版本 PWstudy，按已关联处理）
  // 为什么不能缺了默认：一次"失去明示同意"的自动跳转 = 把用户扣在对面。
  const lk = String(link.params.linked == null ? '' : link.params.linked).toLowerCase();
  ctx = {
    minutes: minutes > 0 ? minutes : 25,
    taskId: link.params.task || '',
    back: link.params.back || (PARTNER_SCHEME + '://vocab-done'),
    linked: lk !== '0',
    startAt: Date.now()
  };
  // 记一笔"对面真的把我们唤起过"：系统查询（isApplicationExist）可能被 Android 11+ 的
  // 包可见性拦掉，但这条跳转发生过就是发生过 —— 设置页据此不再显示"未检测到"。
  try { partner.noteSeen() } catch (e) {}
  const nav = go || function (u) { uni.navigateTo({ url: u }); };
  try {
    // from=pwstudy 只是给页面一个标记（练习页读它显示来路横幅）
    nav('/pkgStudy/pages/practice/practice?from=pwstudy');
  } catch (e) {
    // 跳转失败也要保住 ctx：用户可能自己点进练习页
  }
  return true;
}

/* ==================== 回去 ==================== */

/** 本次实际停留了多少分钟（至少 1 —— 0 分钟那边按没学处理，白跑一趟） */
export function elapsedMin() {
  if (!ctx) return 0;
  return Math.max(1, Math.round((Date.now() - ctx.startAt) / 60000));
}

/**
 * 收尾并把战果送回 PWstudy。返回 true 表示真的跳了。
 * words = 本次确认通过（真正算学会）的词数；不传就用 0（只说时长，不编词数）。
 * ⚠️ 调完 ctx 就清了：同一个会话只回传一次，来回切页面不会重复记账。
 */
export function finish(words) {
  if (!ctx) return false;
  const c = ctx;
  ctx = null;
  const min = Math.max(1, Math.round((Date.now() - c.startAt) / 60000));
  const w = Math.round(Number(words) || 0);
  const url = mergeQuery(c.back, {
    min: min,
    words: w > 0 ? w : '',
    task: c.taskId
  });
  // 记一笔"链路真的通了"：设置页靠它回答"上次同步是什么时候"（见 utils/partner.js）。
  // 放在 openUrl 之前 —— 跳不跳得出去是那边的事，这边确实已经把数据送出去了。
  try { partner.noteSync(min, w) } catch (e) {}
  return openUrl(url);
}
