// _tools/check-api.js - 自家后端接口层（services/api.js）校验
//
// 背景：这一版 APP **还没有服务器**，但迟早要接（云端同步 / 在线账号）。
// 现在把"出网口子"先收敛到一个文件，业务代码一律不许自己拼域名、自己发请求 ——
// 等服务器就绪，wgt 一推就能让老用户变"在线版"，业务层一行都不用改。
//
// 断言：
//   1) api.js 契约：导出齐全、不硬编码域名、没填地址 = 可降级不是报错
//   2) 业务层不许直连后端（pages / pkgStudy / components 里不许出现 uni.request）
//   3) settings 里新增 api 默认值，且老存档读不到这个字段时不崩
//   4) 运行时真跑：地址拼接、Authorization、没填地址**一个包都不许发**
//   5) 鉴权与测试连接：自动带 Authorization、force 能穿过熔断、
//      失败返回**枚举码**（文案归页面层翻译，内部细节不进 UI）

const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const eq = (a, b, m) => (a === b ? ok(m + ' = ' + b) : bad(m + ' 期望 ' + b + '，实际 ' + a));
const assert = (c, m) => (c ? ok(m) : bad(m));

const API = 'services/api.js';
const SET = 'utils/settings.js';

// ---------- 第 1 组：api.js 源码契约 ----------
console.log('== 1. api.js 契约 ==');
const src = fs.readFileSync(path.join(ROOT, API), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/^\s*\/\/.*$/gm, '');
assert(fs.existsSync(path.join(ROOT, API)), 'services/api.js 存在（自家后端唯一出口）');

for (const fn of ['baseURL', 'configured', 'setBaseURL', 'token', 'setToken',
  'clearToken', 'apiURL', 'apiRequest', 'testConnection']) {
  assert(new RegExp('export function ' + fn + '\\(').test(code), '导出 ' + fn + '()');
}

// 不许硬编码域名：唯一允许的 https?:// 是"调用方给了完整 URL 就原样用"的判定正则，
// 以及注释里的说明文字（注释已剥掉）。这里查**字符串字面量**里出现的域名。
const lits = src.match(/'[^']*https?:\/\/[^']*'/g) || [];
const hostLike = lits.filter(s => /https?:\/\/[a-z0-9.-]+/i.test(s));
eq(hostLike.length, 0, '没有硬编码的后端域名（地址一律来自设置里的配置项）');

// 没填地址 = "还没接"，必须带 notConfigured + degradable，且**不能熔断**
assert(/notConfigured:\s*true/.test(code) && /degradable:\s*true/.test(code),
  '没填地址标记成 notConfigured + degradable（调用方据此降级，不当错误提示）');
assert(/Promise\.reject\(new ServiceError/.test(code),
  '没填地址时直接拒绝请求（不是返回空数据骗调用方）');

// Authorization 只在有 token 时带
assert(/headers\.Authorization\s*=\s*'Bearer '\s*\+\s*tk/.test(code),
  '带 Authorization 头（Bearer + token）');
assert(/if \(tk\)/.test(code), '没登录（无 token）就不带 Authorization 头');

// 手动点「测试连接」必须能穿过熔断（否则服务刚挂过一次就再也试不了）
assert(/force:\s*true/.test(code), 'testConnection 带 force（熔断时手动重试也发得出去）');
assert(/PING_PATH/.test(code), '探活走独立的 /ping 路径（不依赖任何业务接口）');

// ---------- 第 2 组：业务层不许直连后端 ----------
console.log('');
console.log('== 2. 业务层不许直连后端 ==');
// 白名单：services/http.js 是封装本身；utils/updater.js 走的是 GitHub 发布源
// （固定 tag 的 Release，不是自家后端），两者都不算"业务代码绕过接口层"。
const scanDirs = ['pages', 'pkgStudy', 'components'];
let direct = [];
for (const d of scanDirs) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(vue|js|ts)$/.test(f)) continue;
      const c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      const lines = c.split('\n');
      lines.forEach((ln, i) => {
        if (/uni\.request\s*\(/.test(ln.replace(/^\s*\/\/.*$/, ''))) {
          direct.push(d + '/' + path.relative(abs, p).replace(/\\/g, '/') + ':' + (i + 1));
        }
      });
    }
  };
  walk(abs);
}
eq(direct.length, 0, '页面 / 组件里没有直接发请求的地方（一律走 services/api.js）'
  + (direct.length ? ' —— 发现：' + direct.join(', ') : ''));

// ---------- 第 3 组：settings 默认值 + 老存档兼容 ----------
console.log('');
console.log('== 3. settings 默认值 / 老存档兼容 ==');
const setSrc = fs.readFileSync(path.join(ROOT, SET), 'utf8').replace(/\r\n/g, '\n');
assert(/api:\s*\{\s*baseURL:\s*''\s*,\s*token:\s*''\s*\}/.test(setSrc.replace(/^\s*\/\/.*$/gm, '')),
  'settings 默认里有 api = { baseURL, token }（空 = 还没接服务器）');

// 内存 storage，用来真跑 settings 模块
const mem = {};
const uniStub = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(mem) })
};
const settingsMod = load(SET, { uni: uniStub });
const def = settingsMod.get() || {};
assert(def.api && def.api.baseURL === '' && def.api.token === '',
  '默认没填服务器地址 → 所有同步调用降级成纯本地');

// ⚠️ 下面几组要 await，CJS 没有顶层 await，统一包进 async IIFE
(async () => {

// ---------- 第 4 组：运行时真跑 ----------
console.log('');
console.log('== 4. 真跑 api ==');
const http = load('services/http.js', { uni: uniStub });
const ServiceError = http.ServiceError;

// 可切换行为的 request 桩：只记录调用，不真发
let calls = [];
let reqImpl = () => Promise.resolve({ ok: true });
const mockRequest = (o) => {
  calls.push(o || {});
  return reqImpl(o || {});
};

function mountApi(settingsStub) {
  return load(API, {
    request: mockRequest,
    ServiceError: ServiceError,
    settings: settingsStub || settingsMod
  });
}

// 存档里**根本没有 api 字段**（老用户升级上来的真实形态）
const bareStub = { get: () => ({}), set: () => {} };
const bare = mountApi(bareStub);
eq(bare.configured(), false, '老存档里没有 api 字段 → 当成"还没接"，不崩');
eq(bare.apiURL('/ping'), '', '没填地址时不拼地址（调用方据此降级）');
eq(bare.token(), '', '没登录时 token 是空串');

// settings.get() 直接坏掉（storage 被清 / 权限异常）
const brokenStub = { get: () => { throw new Error('storage dead') }, set: () => {} };
const broken = mountApi(brokenStub);
eq(broken.configured(), false, 'settings 读不出来时不崩（降级成"还没接"）');
eq(broken.baseURL(), '', 'settings 读不出来时地址是空串');

const api = mountApi();

// 地址拼接：末尾斜杠、相对路径、完整 URL
api.setBaseURL('https://api.example.com/');
eq(api.baseURL(), 'https://api.example.com', '末尾斜杠被去掉（避免拼出 //）');
eq(api.apiURL('/fav'), 'https://api.example.com/fav', '带斜杠的路径正常拼');
eq(api.apiURL('fav'), 'https://api.example.com/fav', '没带斜杠的路径自动补上');
eq(api.apiURL('https://cdn.other.com/x.json'), 'https://cdn.other.com/x.json',
  '给了完整 URL 就原样用（少数跨域取文件的场景）');
eq(api.configured(), true, '填了地址 → 算"接了后端"');

// 前后空白（用户从别处粘过来很常见）
api.setBaseURL('  https://api.example.com  ');
eq(api.baseURL(), 'https://api.example.com', '前后空白被去掉');

// 没填地址时一个包都不许发
calls = [];
api.setBaseURL('');
let rejectErr = null;
await api.apiRequest('/fav', { method: 'GET' }).catch((e) => { rejectErr = e; });
eq(calls.length, 0, '没填服务器地址时**一个包都不发**（静悄悄走本地，不打扰用户）');
assert(!!rejectErr, '没填地址时请求是失败的（不是返回空数据骗调用方）');
eq(rejectErr.notConfigured, true, '错误带 notConfigured 标记');
eq(rejectErr.degradable, true, '错误带 degradable 标记（调用方可以放心降级）');
eq(calls.length, 0, '确认降级路径没有副作用（只 reject、不发包）');

// ---------- 第 5 组：Authorization 与 testConnection ----------
console.log('');
console.log('== 5. 鉴权与测试连接 ==');
api.setBaseURL('https://api.example.com');

// 没登录：不带 Authorization
calls = [];
api.apiRequest('/fav', { method: 'GET' });
eq(calls.length, 1, '填了地址就真的发请求了');
eq(calls[0].headers.Authorization, undefined, '没登录时请求里不带 Authorization 头');
eq(calls[0].url, 'https://api.example.com/fav', '请求地址拼对了');

// 登录后：带上
api.setToken('tok-123');
calls = [];
api.apiRequest('/fav', { method: 'POST', data: { a: 1 } });
eq(calls[0].headers.Authorization, 'Bearer tok-123', '登录后自动带上 Authorization 头');
eq(calls[0].method, 'POST', '方法传得过去');
eq(calls[0].data.a, 1, '请求体传得过去');

// 退出登录
api.clearToken();
eq(api.token(), '', '退出登录后 token 清空');

// testConnection：通
reqImpl = () => Promise.resolve({ ok: true });
let tc = await api.testConnection();
eq(tc.ok, true, '测试连接：通了 → ok = true');
eq(tc.code, '', '通了不带原因码');

// testConnection：不通（服务没起 / 地址填错，都归为 ok=false，绝不抛到页面上）
reqImpl = () => Promise.reject(new ServiceError('connect ECONNREFUSED', { degradable: true }));
tc = await api.testConnection();
eq(tc.ok, false, '测试连接：连不上 → ok = false（不抛）');
eq(tc.code, 'offline', '连不上 → 码 = offline');
// ⚠️ 硬约束 17：回给前端的只有枚举码，原始报错留在 console（里面可能有内网地址）
eq(/ECONNREFUSED/.test(String(tc.code)), false, '返回里没有原始报错（内部细节不进 UI）');

// 不同失败给不同码，页面才好翻译成不同的出路（统一成"连不上"等于没说）
// 码是枚举、不随文案变，所以这里可以放心写死 —— 改文案不会让它假红
const cases = [
  [{ notConfigured: true }, 'notset'],
  [{ timeout: true }, 'timeout'],
  [{ status: 401 }, 'unauthorized'],
  [{ status: 404 }, 'noping'],
  [{ status: 500 }, 'server']
];
const codes = [];
for (const [extra, want] of cases) {
  reqImpl = () => Promise.reject(new ServiceError('boom', extra));
  const got = await api.testConnection();
  codes.push(got.code);
  eq(got.code, want, '失败 ' + JSON.stringify(extra) + ' → 码 ' + want);
  eq(got.ok, false, '　且 ok = false');
}
eq(new Set(codes).size, codes.length, '不同失败给不同码（不是一句"连不上"糊弄）');

// testConnection：必须 force（熔断中手动重试也发得出去）
calls = [];
reqImpl = () => Promise.resolve({ ok: true });
await api.testConnection();
eq(calls[0].force, true, '测试连接带 force（熔断期间手动点也能试）');
assert(calls[0].timeout > 0, '测试连接有超时上限（填错地址不会一直转圈）');
eq(calls[0].url, 'https://api.example.com/ping', '探活打的是 /ping');

// 没填地址时测试连接不该崩，给一条能行动的原因
api.setBaseURL('');
calls = [];
tc = await api.testConnection();
eq(tc.ok, false, '没填地址时点测试连接 → ok = false，不崩');
eq(tc.code, 'notset', '没填地址时测试连接 → 码 = notset');
eq(calls.length, 0, '没填地址时测试连接也不发包');

console.log('');
console.log(fail === 0 ? '接口层全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);

})();
