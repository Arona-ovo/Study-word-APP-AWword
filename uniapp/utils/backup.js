// utils/backup.js - 一键导出 / 导入学习数据（换手机迁移）
//
// ---------- 为什么必须做 ----------
// 这是个纯本地应用：全部数据躺在本机 storage 里，没有服务器、没有账号同步。
// 好处是"数据只属于你"，代价是**换手机就全没了** —— 之前没有任何补救办法。
//
// ---------- 加密：防什么、不防什么 ----------
// 备份里含 AI 配置（地址 + 密钥）。密钥明文躺在导出文件里是不能接受的：
// 这个文件会被发到微信、存进网盘、留在下载目录里。
// 所以整个 payload 都是密文，信封里只有 meta（词数/错题数这类统计）是明文，
// 方便导入前先确认"这份备份对不对"。
//
// 两档：
//   standard（默认，一键）密钥派生自 App 内置口令 —— **防明文泄露，不防逆向**。
//           拿到文件的人用文本编辑器打开只能看到 base64，看不到 sk-xxx；
//           但如果有人反编译本应用拿到内置口令，就能解开。这是有意的取舍：
//           换手机时用户最需要的是"别让我再输一遍密码"，而不是银行级保密。
//   password（可选）密钥派生自用户自己设的密码 —— 真正的机密性，代价是
//           忘了密码这份备份就废了（没有任何找回途径，因为压根没有服务器）。
//
// ---------- 加密原语（零依赖，沿用项目已有的实现） ----------
//   · sha256 / hmacSha256 / utf8Bytes ← utils/hash.ts（纯 TS，App/H5 都能跑）
//   · randomBytes ← utils/random.ts（crypto.getRandomValues）
//   · PBKDF2 与 HMAC 密钥流在这里现搭（各十来行），没有引入任何三方库。
// 用 HMAC-SHA256 当 PRF 生成密钥流再 XOR，是标准的流加密构造（ChaCha20 同思路），
// 只要 (key, nonce) 不重复就安全 —— 每次导出都新生成 salt 与 nonce，所以不会重复。

import { hmacSha256, utf8Bytes } from './hash.ts';
import { randomBytes } from './random.ts';

export const BACKUP_VERSION = 1;
export const APP_TAG = 'awword';

// 标准档的内置口令。见文件头"防什么、不防什么"：
// 它的作用是让文件里不出现明文密钥，不是抵御逆向。
const STANDARD_PASSPHRASE = 'awword-local-backup-v1';

// ---------------------------------------------------------------- 基础编解码

const HEX = '0123456789abcdef';

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[(bytes[i] >> 4) & 15] + HEX[bytes[i] & 15];
  return s;
}

function fromHex(s) {
  const str = String(s || '');
  if (str.length % 2) return new Uint8Array(0);
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = HEX.indexOf(str[i * 2]);
    const lo = HEX.indexOf(str[i * 2 + 1]);
    if (hi < 0 || lo < 0) return new Uint8Array(0);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    const left = bytes.length - i;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += left > 1 ? B64[(n >> 6) & 63] : '=';
    out += left > 2 ? B64[n & 63] : '=';
  }
  return out;
}

function fromBase64(s) {
  const str = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const chunk = str.substr(i, 4);
    let n = 0;
    let got = 0;
    for (let j = 0; j < 4; j++) {
      const idx = B64.indexOf(chunk[j]);
      if (idx < 0) break;
      n = (n << 6) | idx;
      got++;
    }
    n <<= (4 - got) * 6;
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let j = 0; j < got - 1; j++) out.push(bytes[j]);
  }
  return new Uint8Array(out);
}

/** UTF-8 解码（utf8Bytes 的反向，自己写一份：hash.ts 只导出了编码方向） */
function bytesToUtf8(bytes) {
  const b = bytes || new Uint8Array(0);
  const out = [];
  for (let i = 0; i < b.length;) {
    const c = b[i];
    if (c < 0x80) { out.push(String.fromCharCode(c)); i += 1; continue; }
    if (c >= 0xc0 && c < 0xe0 && i + 1 < b.length) {
      out.push(String.fromCharCode(((c & 0x1f) << 6) | (b[i + 1] & 0x3f)));
      i += 2;
      continue;
    }
    if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length) {
      out.push(String.fromCharCode(
        ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f)
      ));
      i += 3;
      continue;
    }
    if (c >= 0xf0 && i + 3 < b.length) {
      const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) |
        ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      const v = cp - 0x10000;
      out.push(String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)));
      i += 4;
      continue;
    }
    // 非法字节：换成占位符，别让一个坏字节炸掉整份备份的解析
    out.push('�');
    i += 1;
  }
  return out.join('');
}

function concat() {
  const parts = Array.prototype.slice.call(arguments);
  let total = 0;
  parts.forEach(p => { total += p.length; });
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  return out;
}

function u32be(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

// ---------------------------------------------------------------- 密钥与流加密

/** PBKDF2-HMAC-SHA256（只要 ≤32 字节，一个 block 就够，省掉多 block 拼接） */
function pbkdf2(password, salt, iterations, dkLen) {
  let u = hmacSha256(password, concat(salt, u32be(1)));
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256(password, u);
    for (let j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return t.slice(0, dkLen);
}

// 加密用与校验用必须是两把不同的子密钥，不能拿同一把既加密又算 MAC
function deriveKeys(passphrase, salt, iterations) {
  const km = pbkdf2(utf8Bytes(passphrase), salt, iterations, 32);
  return {
    enc: hmacSha256(km, utf8Bytes('awword-backup-enc')),
    mac: hmacSha256(km, utf8Bytes('awword-backup-mac'))
  };
}

/** HMAC-SHA256 当 PRF 生成密钥流（counter mode） */
function keystream(key, nonce, len) {
  const out = new Uint8Array(len);
  let off = 0;
  let c = 0;
  while (off < len) {
    const block = hmacSha256(key, concat(nonce, u32be(c++)));
    for (let i = 0; i < block.length && off < len; i++) out[off++] = block[i];
  }
  return out;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** 常时比较：MAC 比对不能短路，否则会漏出"前 n 字节是对的"这种信息 */
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}

// ---------------------------------------------------------------- 收集

// 要搬走的 storage key。AI 缓存（fj_ai_cache_v1）刻意**不**搬：
// 它有 7 天 TTL，本来就会过期，搬过去只是把文件撑大。
export const STORAGE_KEYS = {
  study: 'fj_eng_state_v1',
  settings: 'fj_app_settings_v1',
  chat: 'fj_chat_v1',
  usage: 'fj_usage_v1',
  apiUsage: 'fj_api_usage_v1'
};

function readRaw(key) {
  try {
    const v = uni.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return null;
    return v;
  } catch (e) {
    return null;
  }
}

function asObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * 明文摘要。放在信封里让用户**导入前**就能看到这份备份里有什么 ——
 * 拿到一个文件就覆盖掉全部数据是很吓人的事，先看一眼摘要是对的做法。
 */
function summarize(study) {
  const st = study || {};
  const books = st.books || {};
  let words = 0;
  let due = 0;
  Object.keys(books).forEach(bid => {
    const m = (books[bid] || {}).mastery || {};
    const ids = Object.keys(m);
    words += ids.length;
    ids.forEach(id => {
      const rec = m[id] || {};
      if (rec.due) due++;
    });
  });
  const days = Object.keys(st.days || {});
  days.sort();
  const userBooks = (st.userBooks || []).length;
  let customWords = 0;
  Object.keys(st.customWords || {}).forEach(bid => {
    customWords += ((st.customWords || {})[bid] || []).length;
  });
  return {
    bookCount: Object.keys(books).length,
    userBooks: userBooks,
    words: words,
    due: due,
    wrong: (st.wrong || []).length,
    dayCount: days.length,
    from: days.length ? days[0] : '',
    to: days.length ? days[days.length - 1] : '',
    customWords: customWords,
    currentBook: st.currentBook || ''
  };
}

/** 收集所有要搬走的数据。返回 { parts, meta } */
export function collect() {
  const parts = {};
  Object.keys(STORAGE_KEYS).forEach(name => {
    const raw = readRaw(STORAGE_KEYS[name]);
    if (raw !== null) parts[STORAGE_KEYS[name]] = raw;
  });
  const study = asObject(parts[STORAGE_KEYS.study]);
  const settings = asObject(parts[STORAGE_KEYS.settings]);
  const meta = Object.assign(summarize(study), {
    hasSettings: !!settings,
    hasChat: !!parts[STORAGE_KEYS.chat],
    locale: (settings || {}).locale || '',
    nickname: ((settings || {}).profile || {}).nickname || ''
  });
  return { parts: parts, meta: meta };
}

// ---------------------------------------------------------------- 打包 / 解包

/**
 * 打包成一份可传的文本。
 * @param {object} payload  collect() 的结果
 * @param {string} password 留空走 standard 档；传了就走 password 档
 */
export function encode(payload, password) {
  const parts = (payload && payload.parts) || {};
  const meta = (payload && payload.meta) || {};
  const usePwd = !!String(password || '');
  // 密码档迭代次数高一些（要扛离线暴力）；标准档低一些（反正口令就在包里，
  // 慢只会拖慢导出，换不来任何安全性）
  const iterations = usePwd ? 120000 : 10000;
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const keys = deriveKeys(usePwd ? String(password) : STANDARD_PASSPHRASE, salt, iterations);
  const plain = utf8Bytes(JSON.stringify(parts));
  const cipher = xorBytes(plain, keystream(keys.enc, nonce, plain.length));
  const mac = hmacSha256(keys.mac, concat(nonce, cipher));
  return JSON.stringify({
    app: APP_TAG,
    v: BACKUP_VERSION,
    at: new Date().toISOString(),
    enc: usePwd ? 'password' : 'standard',
    iter: iterations,
    salt: toHex(salt),
    nonce: toHex(nonce),
    mac: toHex(mac),
    // meta 不加密：导入前要给人看
    meta: meta,
    data: toBase64(cipher)
  });
}

/**
 * 解包。失败一律抛 Error（调用方拿它当提示文案用，所以写人话）。
 * 三种会失败的情况：不是本应用的备份 / 密码不对或文件被改过 / 版本不认识。
 */
export function decode(text, password) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('EMPTY');
  let env = null;
  try {
    env = JSON.parse(raw);
  } catch (e) {
    throw new Error('NOT_BACKUP');
  }
  if (!env || env.app !== APP_TAG) throw new Error('NOT_BACKUP');
  if (Number(env.v) > BACKUP_VERSION) throw new Error('NEWER_VERSION');
  const salt = fromHex(env.salt);
  const nonce = fromHex(env.nonce);
  const cipher = fromBase64(env.data);
  const mac = fromHex(env.mac);
  if (!salt.length || !nonce.length || !cipher.length) throw new Error('BROKEN');
  const usePwd = env.enc === 'password';
  // 密码档：没给密码直接说要密码，别拿内置口令去解（会解出垃圾还误报"文件坏了"）
  if (usePwd && !String(password || '')) throw new Error('NEED_PASSWORD');
  const keys = deriveKeys(
    usePwd ? String(password) : STANDARD_PASSPHRASE,
    salt,
    Number(env.iter) || (usePwd ? 120000 : 10000)
  );
  // 先验 MAC 再解密：被篡改的文件应该在这里被挡下
  if (!safeEqual(hmacSha256(keys.mac, concat(nonce, cipher)), mac)) {
    throw new Error(usePwd ? 'BAD_PASSWORD' : 'TAMPERED');
  }
  let parts = null;
  try {
    parts = JSON.parse(bytesToUtf8(xorBytes(cipher, keystream(keys.enc, nonce, cipher.length))));
  } catch (e) {
    throw new Error('BROKEN');
  }
  if (!parts || typeof parts !== 'object') throw new Error('BROKEN');
  return { parts: parts, meta: env.meta || {}, at: env.at || '', enc: env.enc || 'standard' };
}

/** 只看摘要不解密（导入前预览用）—— 信封里的 meta 本来就是明文 */
export function peek(text) {
  try {
    const env = JSON.parse(String(text || '').trim());
    if (!env || env.app !== APP_TAG) return null;
    return { meta: env.meta || {}, at: env.at || '', enc: env.enc || 'standard', v: Number(env.v) || 0 };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- 恢复

/**
 * 把解出来的数据写回本机。
 * 这是**覆盖**：换手机的场景就是要整包搬过来，做"合并"反而会留下
 * "哪些记的是旧的、哪些是新的"这种说不清的烂账。
 * 所以调用方必须先弹确认（设置页已经这么做了）。
 */
export function restore(decoded, onProgress) {
  const parts = (decoded && decoded.parts) || {};
  const keys = Object.keys(parts);
  const written = [];
  const failed = [];
  keys.forEach((k, i) => {
    if (typeof onProgress === 'function') onProgress(i + 1, keys.length);
    try {
      uni.setStorageSync(k, parts[k]);
      written.push(k);
    } catch (e) {
      failed.push(k);
    }
  });
  return { written: written, failed: failed, total: keys.length };
}

/** 备份文件名：awword-backup-2026-10-10.json（人一眼认得出，也方便在下载目录里找） */
export function fileName(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return 'awword-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
}
