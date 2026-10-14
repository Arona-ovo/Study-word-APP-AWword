// _tools/lib/load.js - 把 uniapp 里的极简 ESM 模块转成 CJS 在 vm 中执行（只读，不改源码）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../uniapp');

const IMPORT_RE = /^[ \t]*import\s+([^;]*?)\s+from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm;

function resolveSpec(fromRel, spec) {
  const p = path.resolve(ROOT, path.dirname(fromRel), spec);
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  for (const c of [p, p + '.js']) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { file: c, rel: path.relative(ROOT, c).replace(/\\/g, '/') };
  }
  return null;
}

// 只自动装载 data/ 下的模块：它们是纯数据/纯函数，没有 uni.* 之类的运行时依赖，
// 显式 deps 永远优先（脚本里故意覆盖的 WORDS / SENTENCES 不会被这里改写）。
function autoLoad(rel, deps, cache) {
  const key = rel;
  if (cache[key]) return cache[key];
  cache[key] = {}; // 先占位，防止循环导入打转
  const mod = loadInner(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel, {}, cache);
  cache[key] = mod;
  return mod;
}

// 抽出 src 里的 import 语句，自动递归装载 data/ 下的目标模块
function collectImports(src, rel, deps, cache) {
  const extra = {};
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(src))) {
    const clause = m[1].trim();
    // 组件 import（*.vue）：自动补一个空桩。
    // 不补的话，每往首页加一张卡片，所有把 home.vue 的 <script> loadCode 起来的校验脚本
    // 都会崩在 ReferenceError: Xxx is not defined —— 它们测的是联动 / 搜索，
    // 没义务知道首页今天多了哪张卡。
    // 只看扩展名、不要求文件解析得到：loadCode 常被告知 'home.vue' 这种不带目录的
    // 文件名，相对路径根本指不到真实文件，而桩本来就不需要真文件。
    if (/\.vue$/.test(m[2])) {
      const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
      if (ns) {
        if (!(ns[1] in deps)) extra[ns[1]] = {};
        continue;
      }
      const named = /^\{([^}]*)\}$/.exec(clause);
      if (named) {
        named[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
          const to = (s.split(/\s+as\s+/)[1] || s).trim();
          if (!(to in deps)) extra[to] = {};
        });
        continue;
      }
      const def = /^([A-Za-z_$][\w$]*)$/.exec(clause);
      if (def && !(def[1] in deps)) extra[def[1]] = {};
      continue;
    }
    const hit = resolveSpec(rel, m[2]);
    if (!hit) continue;
    if (!/^data\//.test(hit.rel) && !/\/data\//.test(hit.rel)) continue;
    let mod;
    try { mod = autoLoad(hit.rel, {}, cache); } catch (e) { continue; }

    const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    if (ns) {
      if (!(ns[1] in deps)) extra[ns[1]] = mod;
      continue;
    }
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (named) {
      named[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
        const parts = s.split(/\s+as\s+/);
        const from = parts[0].trim();
        const to = (parts[1] || parts[0]).trim();
        if (!(to in deps) && from in mod) extra[to] = mod[from];
      });
      continue;
    }
    const def = /^([A-Za-z_$][\w$]*)$/.exec(clause);
    if (def) {
      if (!(def[1] in deps)) extra[def[1]] = mod.default || mod;
    }
  }
  return extra;
}

function toCJS(src) {
  const exported = [];
  let hasDefault = false;
  let out = src
    // import * as x from '...' / import x from '...' / import { a, b } from '...'
    .replace(/^\s*import\s+[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    // export { a, b };
    .replace(/export\s*\{([^}]*)\}\s*;?/g, (m, names) => {
      const list = names.split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const parts = s.split(/\s+as\s+/);
        return (parts[1] || parts[0]).trim() + ': ' + parts[0].trim();
      });
      return '__exports({' + list.join(',') + '});';
    })
    // export default ... （函数声明/对象字面量都能这样转成表达式）
    .replace(/^\s*export\s+default\s+/gm, (m) => { hasDefault = true; return 'const __default = '; })
    // export const/let/function/class
    .replace(/^\s*export\s+((?:async\s+)?(?:const|let|var|function|class))\s+([A-Za-z_$][\w$]*)/gm,
      (m, kind, name) => { exported.push(name); return kind + ' ' + name; });

  // import.meta 在 vm（script 模式）下是语法错误，替换为注入的沙箱全局
  out = out.replace(/import\.meta/g, '__importMeta');

  // 收集所有 export 声明的标识符
  out += '\n;__exports({' + exported.map(n => n + ':' + n).join(',') + '});';
  if (hasDefault) out += '\n;if (typeof __default !== "undefined") __exports({ default: __default });';
  return out;
}

// 直接用代码字符串执行（.vue 的 <script> 块用这个入口）
function loadCode(src, deps, filename) {
  return loadInner(src, filename || 'inline.js', deps, {});
}

function loadInner(src, rel, deps, cache) {
  const extra = collectImports(src, rel, deps || {}, cache);
  const module = { exports: {} };
  const sandbox = Object.assign(
    {
      module, exports: module.exports, console, Math, Date, JSON, Set, Map, Object, Array, String, Number, RegExp,
      setTimeout, clearTimeout, setInterval, clearInterval,
      uni: global.uni, window: global.window, document: global.document
    },
    extra,
    deps || {}
  );
  sandbox.__exports = (obj) => { Object.assign(module.exports, obj); };
  sandbox.globalThis = sandbox;
  sandbox.__importMeta = { env: {} };
  vm.createContext(sandbox);
  vm.runInContext(toCJS(src), sandbox, { filename: rel || 'inline.js' });
  return module.exports;
}

function load(rel, deps) {
  return loadInner(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel, deps, {});
}

module.exports = { load, loadCode, ROOT };
