// _tools/check-handlers.js - 模板里绑定的事件方法是否真的存在（不存在 = 点击直接崩）
// 运行：node _tools/check-handlers.js
//
// 顺带查两条 uni-app 硬规则：
//   · 跳转目标必须在 pages.json 里注册
//   · tabBar 页只能用 switchTab，不能用 navigateTo / redirectTo

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

// 全局 mixin / 运行时注入的属性，不算未定义
// 全局 mixin / 页面 mixin 注入的方法，不算未定义
const INJECTED = [
  'appTheme', 'appBgStyle', 'slideCls', 'slideStyle', 'noop',
  'onSlideStart', 'onSlideMove', 'onSlideEnd', 'refreshAppTheme'
];

const files = [];
(function walk(d) {
  fs.readdirSync(d).forEach(n => {
    const fp = path.join(d, n);
    if (fs.statSync(fp).isDirectory()) {
      if (['node_modules', 'unpackage', '.hbuilderx'].includes(n)) return;
      walk(fp);
    } else if (n.endsWith('.vue')) files.push(fp);
  });
})(ROOT);

// mixin 提供的方法也算"已定义"：模板里绑定的 handler 常常来自 mixin
// （例：word-polish-mixin 的 polishNow 被首页 / 做题页顶栏查词共用），
// 只看文件自己的 <script> 会把它们全判成未定义 —— 那是假红，不是真漏。
function mixinSource(script, fp) {
  const block = /mixins:\s*\[([\s\S]*?)\]/.exec(script);
  if (!block) return '';
  const names = block[1].match(/[A-Za-z_$][\w$]*(?=\s*\()/g) || [];
  if (!names.length) return '';
  let extra = '';
  const re = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(script))) {
    if (names.indexOf(m[1]) < 0) continue;
    const p = path.resolve(path.dirname(fp), m[2]);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) extra += '\n' + fs.readFileSync(p, 'utf8');
    } catch (e) { /* 读不到就按"没定义"处理，让断言照常报警 */ }
  }
  return extra;
}

/* ---------------- 1. 事件方法存在性 ---------------- */
console.log('== 1. 模板事件方法是否定义（' + files.length + ' 个 .vue）==');
let checked = 0;
files.forEach(fp => {
  const src = fs.readFileSync(fp, 'utf8');
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
  const tEnd = src.indexOf('\n<style');
  const tpl = src.slice(0, tEnd > 0 ? tEnd : src.length);
  const sStart = src.indexOf('\n<script');
  if (sStart < 0) return;
  const script = src.slice(sStart) + mixinSource(src.slice(sStart), fp);

  // 修饰符（.stop / .prevent …）可有可无；方法名后必须紧跟 "(" 或收尾引号，
  // 以此跳过 `e => setAI(...)` 这类内联箭头表达式（其中的 e 不是方法）
  const re = /@(?:tap|click|change|confirm|input|blur|focus|scroll|touchstart|touchmove|touchend|touchcancel|mousedown|mouseup|longpress)(?:\.[\w.]+)*\s*=\s*"([A-Za-z_$][\w$]*)\s*(?:\(|")/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(tpl))) {
    const name = m[1];
    if (seen.has(name) || INJECTED.indexOf(name) >= 0) continue;
    seen.add(name);
    checked++;
    const defined = new RegExp('\\b' + name + '\\s*[(:=]').test(script);
    assert(defined, rel + ' → ' + name);
  }
});
ok('共校验 ' + checked + ' 个事件绑定');

/* ---------------- 2. 跳转目标已注册 + tabBar 规则 ---------------- */
console.log('== 2. 跳转目标与 tabBar 规则 ==');
const pj = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1')
);
const reg = new Set(pj.pages.map(p => p.path));
// 分包页面同样算"已注册"：path 形如 pkgStudy/pages/practice/practice
(pj.subPackages || []).forEach(sp => (sp.pages || []).forEach(p => reg.add(sp.root + '/' + p.path)));
const tabs = new Set(((pj.tabBar && pj.tabBar.list) || []).map(x => x.pagePath));
assert(tabs.size === 4, 'tabBar 4 个页：' + [...tabs].join(', '));

let navCount = 0;
['pages', 'pkgStudy/pages', 'pkgManage/pages', 'utils', 'components', 'services'].forEach(dir => {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) return;
  (function w(x) {
    fs.readdirSync(x).forEach(n => {
      const fp = path.join(x, n);
      if (fs.statSync(fp).isDirectory()) return w(fp);
      if (!/\.(vue|js|ts)$/.test(fp)) return;
      const s = fs.readFileSync(fp, 'utf8');
      const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
      let m;
      // 直接写在调用里的 url
      const re1 = /(navigateTo|redirectTo|switchTab)\s*\(\s*\{[^}]*url:\s*['"](\/[^'"?]+)/g;
      while ((m = re1.exec(s))) {
        navCount++;
        const p = m[2].replace(/^\//, '');
        assert(reg.has(p), '目标已注册 ' + p + '（' + rel + '）');
        if (m[1] !== 'switchTab') assert(!tabs.has(p), 'tabBar 页用 switchTab：' + p + '（' + rel + '）');
      }
    });
  })(d);
});
ok('共校验 ' + navCount + ' 处跳转');
// 注：写在变量里的跳转表（如首页 AI 卡按钮的 action→url 映射）由
// check-page-command.js 第 10 组单独校验，这里的正则只覆盖直接写在调用里的 url。

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
