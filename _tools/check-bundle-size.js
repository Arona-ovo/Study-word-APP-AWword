// _tools/check-bundle-size.js - 主包体积与分包边界校验（只读）
//
// 为什么要这个脚本：分包最容易"白做"——只要主包里有任何一个文件 import 了分包页面，
// 那个页面就会被打回主包，subPackages 写得再漂亮也没用。这类引用是后面加功能时
// 无意识写进去的，肉眼很难发现，所以固化成断言。
//
// 核心断言：
//   - 主包（cover + 4 个 tabBar 页 + App/main）的闭包里不含任何分包页面
//   - 主包闭包里的 data 文件在白名单内，总体积不超上限
//   - tabBar 四页必须在主包；分包页必须都在 subPackages 里注册
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const P = (...a) => path.join(ROOT, ...a);

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

/* ---------------- pages.json（带注释，需 strip） ---------------- */
const pjRaw = fs.readFileSync(P('pages.json'), 'utf8');
const pj = JSON.parse(pjRaw.replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1'));

/* ---------------- 导入图 ---------------- */
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  const p = path.resolve(path.dirname(from), spec);
  for (const c of [p, p + '.vue', p + '.js', p + '.ts', path.join(p, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}
function deps(f) {
  const t = fs.readFileSync(f, 'utf8');
  const out = [];
  const re = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(t))) {
    const r = resolveSpec(f, m[1]);
    if (r) out.push(r);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
function closure(entries) {
  const seen = new Set();
  const q = entries.filter(fs.existsSync);
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    deps(f).forEach((d) => { if (!seen.has(d)) q.push(d); });
  }
  return seen;
}

console.log('== 1. 分包注册 ==');
const mainPaths = pj.pages.map((p) => p.path);
const subRoots = (pj.subPackages || []).map((s) => s.root);
assert(subRoots.length >= 1, '至少有一个分包（实际 ' + subRoots.length + '）');
const subPages = [];
(pj.subPackages || []).forEach((s) => {
  s.pages.forEach((p) => subPages.push(s.root + '/' + p.path));
});
assert(subPages.length >= 10, '分包页数 ' + subPages.length);
subPages.forEach((p) => {
  assert(fs.existsSync(P(p + '.vue')), '分包页文件存在 ' + p);
});
const tabPaths = (pj.tabBar && pj.tabBar.list ? pj.tabBar.list : []).map((t) => t.pagePath);
assert(tabPaths.length === 4, 'tabBar 4 项');
tabPaths.forEach((t) => {
  assert(mainPaths.indexOf(t) >= 0, 'tabBar 页 ' + t + ' 在主包');
});

console.log('== 2. 主包闭包不含分包页面（防"分包白做"）==');
const entries = mainPaths.map((p) => P(p + '.vue'))
  .concat([P('App.vue'), P('main.js')]);
const mainSet = closure(entries);
const leaked = [...mainSet].map(rel).filter((r) => /^pkg[A-Za-z]+\//.test(r));
assert(leaked.length === 0, '主包闭包不含任何分包文件' + (leaked.length ? '（泄漏：' + leaked.join(', ') + '）' : ''));
console.log('     主包模块数：' + mainSet.size);

console.log('== 3. 主包 data 白名单与体积 ==');
// data/lexicon-data.js 与 bookdata.js 是「内置词书语料」，必须用同步 import（词书批次是启动时构建的静态数据），
// 所以它们确实落在这个闭包里 —— 唯一能把它们挪出去的办法是把整块词书改成异步加载，代价是页面全面异步化。
//
// ⚠️ 阈值口径（2026-10-09 修正）：本项目主战场是 **Android APK**，不是微信小程序。
// App 端没有"主包 2MB"那套限制，源码字节数跟安装体积、启动性能都只有很弱的相关性。
// 以前这里挂着 1200KB 并注明"为小程序主包让路"，结果是个**错误的前提**——为了保这条线，
// 词书释义上限 MAX_MEAN 被从 20 一路压到 15，等于拿产品质量去喂一个不成立的约束。
// 现在降格为「防无限膨胀的粗护栏」：真正的 App 侧约束（装载耗时、常驻堆内存）
// 由 check-builtin-books.js 第 7 组守着，那才是 APK 上真正会被感知的指标。
// data/extra-words.js 是 2026-10-11 新增的「查词补充词表」（2756 条，113KB）：
// _vocab/src 里那些**没被任何词书挑中**的考试词条，以前在本地是彻底搜不到的（详见文件头注释）。
// 它同样是"启动时静态装载的语料"，所以归到下面那组，跟词书语料一起看总量。
const ALLOW = ['data/words.js', 'data/sentences.js', 'data/wordbooks.js', 'data/common-words.js',
  'data/lexicon.js', 'data/lexicon-data.js', 'data/bookdata.js', 'data/extra-words.js'];
const BOOKLOAD = ['data/lexicon-data.js', 'data/bookdata.js', 'data/extra-words.js'];
const inMain = [...mainSet].map(rel).filter((r) => r.startsWith('data/')).sort();
inMain.forEach((d) => assert(ALLOW.indexOf(d) >= 0, '主包 data 在白名单内：' + d));

const kbOf = (list) => list.reduce((s, d) => s + fs.statSync(P(d)).size, 0) / 1024;
const bookKB = kbOf(inMain.filter((d) => BOOKLOAD.indexOf(d) >= 0));
const otherKB = kbOf(inMain.filter((d) => BOOKLOAD.indexOf(d) < 0));
const dataKB = bookKB + otherKB;
console.log('     词书语料 ' + bookKB.toFixed(0) + ' KB + 其余 data ' + otherKB.toFixed(0) + ' KB = ' + dataKB.toFixed(0) + ' KB');
// 300 → 360（2026-10-11）：加了查词补充词表 extra-words.js（2756 条 / 113KB）。
// 这笔开销换的是「本地搜不到单词」这个实测痛点 —— 以前 search 只扫当前词书，
// 内置几千个词只有拼完整了才捞得到；现在全量表常驻，词表本身就成了可搜索资产。
// 行序（= 用户学习进度）一个字没动：它不属于任何词书，不产生新 id。
// 真正会被用户感知的指标（装载耗时 / 常驻内存）由 check-builtin-books 第 7 组守。
assert(bookKB <= 360, '内置词书语料 ≤ 360 KB（实际 ' + bookKB.toFixed(0) + '）');
// wordbooks.js 现在要定义 6 本词书 + 自建/导入书的兜底逻辑，从 3KB 涨到 ~9KB 属于合理增长，
// 预算从 200 抬到 210；真正要盯的是 sentences.js（119KB 的句库），它一动这个数就会跳。
assert(otherKB <= 210, '其余 data ≤ 210 KB（实际 ' + otherKB.toFixed(0) + '）');

const totalKB = [...mainSet].reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;
console.log('     主包源码合计 ' + totalKB.toFixed(0) + ' KB');
// 见上方阈值口径注释：主战场是 APK，这条只用来拦"某个不小心 import 了整个语料/分包"这类失控，
// 不是性能指标。1600 KB 换算下来距 App 端任何实际瓶颈都还很远，留出余量避免它再次变成
// 逼着砍产品功能的假约束。真正会被用户感知的（装载耗时 / 常驻内存）由 check-builtin-books 第 7 组守。
assert(totalKB <= 1600, '主包源码 ≤ 1600 KB（粗护栏，防无意识膨胀）');

console.log('== 4. 分包内相对导入可解析 ==');
let broken = 0;
subRoots.forEach((root) => {
  const dir = P(root);
  const walk = (d) => fs.readdirSync(d).forEach((n) => {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(vue|js|ts)$/.test(n)) {
      const t = fs.readFileSync(p, 'utf8');
      const re = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;
      let m;
      while ((m = re.exec(t))) {
        if (!resolveSpec(p, m[1])) { broken++; console.error('      无法解析 ' + rel(p) + ' → ' + m[1]); }
      }
    }
  });
  if (fs.existsSync(dir)) walk(dir);
});
assert(broken === 0, '分包内相对导入全部可解析（断链 ' + broken + ' 处）');

console.log(fail === 0 ? '\n分包边界与体积全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
