// services/api.js - 自家后端的**唯一出口**
//
// 现状：这一版**还没有服务器**，所以这里每个函数在"没填地址"时都走降级：
// 调用方保持纯本地行为，和改之前 100% 一致。等接了后端，在这里加接口即可，
// 业务代码一行都不用动（wgt 一推，老用户立刻变成"在线版"）。
//
// 三条硬约定（动这个文件前先看）：
//   1. 业务代码不许直接拼后端域名，一律走这里；
//   2. 没填地址**不是错误**，是"还没接"（notConfigured），可降级、不熔断；
//   3. 返回值一律当"可能被篡改 / 可能超时"处理 —— 前端必须能离线独立跑。

import { request, ServiceError } from './http.js';
import * as settings from '../utils/settings.js';

// 探活路径：后端只要回 200 就算活着，客户端不关心返回内容
const PING_PATH = '/ping';

function apiNode() {
  try {
    const s = settings.get() || {};
    return s.api || {};
  } catch (e) {
    return {};
  }
}

/** 当前填的服务器地址（去首尾空白与末尾斜杠；没填就是空串） */
export function baseURL() {
  return String(apiNode().baseURL || '').trim().replace(/\/+$/, '');
}

/** 填了服务器地址才算"接了后端" */
export function configured() {
  return !!baseURL();
}

/**
 * 存服务器地址。
 * ⚠️ 只做「去空白 + 去末尾斜杠」，**不**在这里校验协议 —— 校验放到测试连接里，
 * 否则用户填一半（还没打完 https://）就被拦住不让存，很烦。
 * ⚠️ settings.set() 是深合并（项目约定 14）：写空串就是"清掉"，不用删 key。
 */
export function setBaseURL(url) {
  const v = String(url || '').trim();
  try { settings.set({ api: { baseURL: v } }) } catch (e) {}
  return v.replace(/\/+$/, '');
}

/** 登录凭证（登录后才有；没登录是空串，所有同步调用自动降级） */
export function token() {
  return String(apiNode().token || '');
}

export function setToken(t) {
  const v = String(t || '');
  try { settings.set({ api: { token: v } }) } catch (e) {}
  return v;
}

export function clearToken() {
  try { settings.set({ api: { token: '' } }) } catch (e) {}
}

/** 拼完整地址；地址没填返回空串（调用方据此降级，不是报错） */
export function apiURL(path) {
  const b = baseURL();
  if (!b) return '';
  const p = String(path || '');
  // 调用方给了完整 URL 就原样用（少数需要跨域取文件的场景）
  if (/^https?:\/\//i.test(p)) return p;
  return b + (p.charAt(0) === '/' ? p : '/' + p);
}

/**
 * 统一请求出口：自动带 Authorization，失败一律是可降级的 ServiceError。
 * 没填地址 → reject(notConfigured)，不熔断（不是服务挂了）。
 */
export function apiRequest(path, opts) {
  const o = opts || {};
  const url = apiURL(path);
  if (!url) {
    return Promise.reject(new ServiceError('还没填服务器地址', {
      notConfigured: true, degradable: true
    }));
  }
  const headers = Object.assign({}, o.headers || {});
  const tk = token();
  if (tk) headers.Authorization = 'Bearer ' + tk;
  return request(Object.assign({}, o, { url: url, headers: headers }));
}

/**
 * 测试连接：GET /ping 通了就算活着（force：手动点的不该被熔断拦住）。
 * 返回 { ok, code } —— code 是失败原因的**枚举码**（见下面 codeOf），
 * 具体文案由页面层翻译，这里不管界面上写什么。
 */
export function testConnection() {
  return apiRequest(PING_PATH, { method: 'GET', timeout: 8000, force: true })
    .then(() => ({ ok: true, code: '' }))
    .catch((e) => {
      // 原始报错只进 console：里面可能有内网地址 / 堆栈，不该给用户看
      // （项目硬约束 17：reason 给用户，rawReason 才带内部细节）
      try { console.warn('[api] testConnection failed:', e && e.message) } catch (_) {}
      return { ok: false, code: codeOf(e) };
    });
}

// 把失败归一成**枚举码**，不是文案 —— 界面上写什么归页面层（那边才管翻译）。
// 码是稳定的契约，改文案不会影响它。
//   notset 没填地址 | timeout 超时 | unauthorized 401 | noping 404
//   server 5xx      | offline 连不上（地址错 / 没网 / 证书问题等）
function codeOf(e) {
  if (e && e.notConfigured) return 'notset';
  if (e && e.timeout) return 'timeout';
  if (e && e.status === 401) return 'unauthorized';
  if (e && e.status === 404) return 'noping';
  if (e && e.status >= 500) return 'server';
  return 'offline';
}
