// check-version-egg.js - 版本号显示 + 设置页彩蛋（只读）
//
// 守三件事：
//   1) 版本号三端统一为 data/build-info.js 里的值，且与 manifest.json 的 versionName 一致。
//      之前 App 端读 plus.runtime.version、其余端读 uni.getSystemInfoSync().appVersion，
//      后者在微信小程序里返回的是**微信自己的版本号**（8.0.5 之类），跟本 App 无关。
//   2) 彩蛋挂在设置 › 关于 › 版本 上，连点触发；阈值/窗口是常量而不是散在方法里的魔法数。
//   3) 设置页（分包 pkgManage）不许为了显示规模去 import 语料本体 —— 那会把上百 KB
//      复制一份进分包，只为换几个数字。规模必须走几百字节的 build-info 快照。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const U = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, m) => assert(a === b, m + '（期望 ' + b + '，实际 ' + a + '）');

(async () => {
  const SET = 'pkgManage/pages/settings/settings.vue';
  // ⚠️ 先归一化换行符：settings.vue 在 Windows 上是 CRLF（\r\n）。
  // 下面第 8 组用 /\n    tapVersion\(\) \{\n/ 这种「带缩进的换行」正则抽方法体，
  // 不归一化的话 \n 后面永远跟着 \r，正则一次都匹配不到 ——
  // 表现为「方法明明写在文件里，脚本却报抽不出方法体」。
  const src = R(SET).replace(/\r\n/g, '\n');
  // 去掉整行 // 注释再扫代码契约：readVersion() 里那段"为什么不再读宿主版本"的说明
  // 会命中 plus.runtime.version 之类的字面量，那是文档不是代码。
  const code = src.replace(/^\s*\/\/.*$/gm, '');

  console.log('== 1. 版本号来源唯一 ==');
  const bi = await import(U('data/build-info.js'));
  const info = bi.BUILD_INFO;
  assert(!!info && typeof info.version === 'string', 'data/build-info.js 导出了 BUILD_INFO.version');
  eq(info.version, '1.1 Beta', '快照里的版本号');

  // manifest 是严格 JSON（HBuilderX 会重写它），别加注释
  const mf = JSON.parse(R('manifest.json'));
  eq(mf.versionName, info.version, 'manifest.json 的 versionName 与快照一致');
  assert(/^\d+$/.test(String(mf.versionCode)), 'versionCode 仍是整数（' + mf.versionCode + '）');
  // versionCode 只涨不跌，且前两位 = 主版本+次版本（1.1 → 111）。
  // 只改 versionName 不改 versionCode 是最容易漏的一步：系统/商店按 versionCode 判断
  // "是不是新版"，不涨就装不上（覆盖安装被拒），而界面上却显示着"新版本" —— 极难排查。
  const mm = String(info.version).match(/^(\d+)\.(\d+)/);
  assert(!!mm && String(mf.versionCode).indexOf(mm[1] + mm[2]) === 0,
    'versionCode 前两位跟着主/次版本走（' + mf.versionCode + ' ↔ ' + info.version + '）');
  assert(Number(mf.versionCode) >= 111, 'versionCode 只涨不跌（地板 111 = 1.1）');

  // 页面里不能再出现"读宿主 App 版本"的兜底：那正是小程序端显示 8.0.5 的根因
  assert(code.indexOf('plus.runtime.version') < 0, '不再读 plus.runtime.version');
  assert(code.indexOf('appVersion') < 0, '不再读 getSystemInfoSync().appVersion');
  assert(/readVersion\(\)\s*\{[\s\S]{0,200}?return BUILD_INFO\.version/.test(code),
    'readVersion() 返回 BUILD_INFO.version');
  assert(code.indexOf("version: '1.0.0'") < 0, 'data 里的占位版本 1.0.0 已不再作为初值');
  assert(/version:\s*BUILD_INFO\.version/.test(code), 'data 初值直接取 BUILD_INFO.version');

  console.log('== 2. 彩蛋接线 ==');
  assert(/class="row"\s+@tap="tapVersion"/.test(src), '版本行绑定了 @tap="tapVersion"');
  assert(/const EGG_TAPS\s*=\s*\d+/.test(src), '阈值是模块常量 EGG_TAPS');
  assert(/const EGG_WINDOW\s*=\s*\d+/.test(src), '连点窗口是模块常量 EGG_WINDOW');
  const taps = Number((src.match(/const EGG_TAPS\s*=\s*(\d+)/) || [])[1]);
  const win = Number((src.match(/const EGG_WINDOW\s*=\s*(\d+)/) || [])[1]);
  assert(taps >= 5 && taps <= 10, '阈值落在 5-10 下（实际 ' + taps + '）：太少会误触，太多没人点得到');
  assert(win >= 1500 && win <= 5000, '窗口落在 1.5-5 秒（实际 ' + win + 'ms）');

  assert(/function tapVersion|tapVersion\(\)\s*\{/.test(code), 'tapVersion 方法存在');
  assert(/function openEgg|openEgg\(\)\s*\{/.test(code), 'openEgg 方法存在');
  assert(/function closeEgg|closeEgg\(\)\s*\{/.test(code), 'closeEgg 方法存在');
  assert(/function noop|noop\(\)\s*\{\s*\}/.test(code), 'noop 方法存在（@tap.stop 的落点）');
  assert(/this\.eggTaps\s*=\s*0/.test(code), '开奖后计数归零（可以重复触发）');
  assert(/settings\.set\(\{\s*egg:\s*\{\s*found\s*\}\s*\}\)/.test(code), '发现次数落盘到 settings.egg.found');

  // 前几下要有提示，否则"点了没反应"，彩蛋永远没人发现；但不能第一下就提示
  assert(/eggTaps\s*>=\s*4/.test(code), '从第 4 下起给「还差几下」提示（前 3 下静默）');
  assert(/@tap\.stop="noop"/.test(src), '弹窗内部用 @tap.stop 挡住穿透（和 app-dialog 同款）');

  console.log('== 3. 彩蛋层是 fixed，且材质复用 App.vue ==');
  assert(/class="pop-mask egg-mask"/.test(src), '遮罩复用 .pop-mask');
  assert(/class="pop-card egg-card"/.test(src), '卡片复用 .pop-card');
  assert(/\.pop-mask\s*\{[\s\S]*?position:\s*fixed/.test(R('App.vue')), '.pop-mask 在 App.vue 里是 fixed');
  assert(/\.egg-mask\s*\{\s*z-index/.test(src), '.egg-mask 只补了 z-index，没有另起一套遮罩');
  // 撒花必须落在 overflow:hidden 的卡片里，否则会飘到卡片外
  assert(/\.egg-card\s*\{[\s\S]*?overflow:\s*hidden/.test(src), '.egg-card 有 overflow:hidden 收住撒花');
  assert(/\.egg-rain\s*\{[\s\S]*?pointer-events:\s*none/.test(src), '撒花层 pointer-events:none（不挡点击）');

  console.log('== 4. 不许为了显示数字把语料拖进分包 ==');
  // 设置页在 pkgManage，import 语料会让打包器把语料复制一份进分包
  ['data/lexicon-data.js', 'data/lexicon.js', 'data/words.js', 'data/sentences.js'].forEach(d => {
    assert(code.indexOf("'" + d + "'") < 0 && code.indexOf('/' + d) < 0,
      '设置页没有 import ' + d);
  });
  assert(code.indexOf('data/build-info.js') >= 0, '规模数字走 data/build-info.js');
  const kb = Math.round(fs.statSync(path.join(ROOT, 'data/build-info.js')).size / 1024 * 10) / 10;
  assert(kb < 4, 'build-info.js 足够小（' + kb + 'KB）');

  console.log('== 5. 规模数字是可信的（不是写死的过期值）==');
  const lex = await import(U('data/lexicon-data.js'));
  eq(info.lexCount, lex.LEX_COUNT, 'lexCount 与词条表行数一致');
  // 拿 BOOK_INDEX 的键当"考试词书"的真身：WORDBOOKS 里还挂着 custom_inbox（我的导入词书），
  // 它不是一本考纲词书，不该算进这个数。
  const bd = await import(U('data/bookdata.js'));
  const examIds = Object.keys(bd.BOOK_INDEX || {});
  eq(info.bookCount, examIds.length, 'bookCount 与考试词书数一致（' + examIds.join(',') + '）');
  const wb = await import(U('data/wordbooks.js'));
  const regIds = (wb.WORDBOOKS || []).map(b => b && b.id);
  assert(examIds.every(id => regIds.indexOf(id) >= 0), '每本考试词书都在 WORDBOOKS 里注册过');
  assert(info.sentenceCount > 100, 'sentenceCount 量级正常（' + info.sentenceCount + '）');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(info.builtAt), 'builtAt 是 YYYY-MM-DD（' + info.builtAt + '）');

  console.log('== 6. 彩蛋文案都进了英文表 ==');
  // 台词是运行时从 EGG_LINES 里挑的，check-i18n 扫不到（它只扫模板/代码里的 t('...') 字面量），
  // 所以这里单独把 EGG_LINES 的数组体抠出来逐条查表。
  const en = (await import(U('utils/i18n-en.js'))).default;
  const linesBlock = (src.match(/const EGG_LINES\s*=\s*\[([\s\S]*?)\n\]/) || [])[1] || '';
  const lines = (linesBlock.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
  assert(lines.length >= 3, 'EGG_LINES 至少 3 条台词（实际 ' + lines.length + '）');
  let miss = 0;
  lines.forEach(l => { if (!en[l]) { miss++; console.log('    缺英文: ' + l); } });
  assert(miss === 0, 'EGG_LINES 全部有英文译文（缺 ' + miss + ' 条）');
  ['彩蛋', '收起来', '发现次数', '内置词条', '考试词书', '练习例句', '再点 {n} 下…', '{n} 本', '第 {n} 次']
    .forEach(k => assert(!!en[k], '英文表有「' + k + '」'));

  console.log('== 7. 生成脚本会产出这个快照 ==');
  const bj = fs.readFileSync(path.join(__dirname, '..', '_vocab', 'build.js'), 'utf8');
  assert(bj.indexOf("build-info.js") >= 0, '_vocab/build.js 会写 data/build-info.js');
  assert(/const APP_VERSION\s*=\s*'/.test(bj), '版本号在 build.js 里是具名常量 APP_VERSION');

  console.log('== 8. 连点计数实跑 ==');
  // 前面几组都是静态扫描，守不住"计数到底对不对"。这里把 tapVersion 的方法体抽出来，
  // 在沙箱里用可控时钟真跑一遍 —— 阈值、窗口、提示时机都是跑出来的，不是看出来的。
  const body = (src.match(/\n    tapVersion\(\) \{\n([\s\S]*?)\n    \},/) || [])[1];
  assert(!!body, '抽得到 tapVersion 的方法体');
  if (body) {
    let clock = 1e6;
    const toasts = [];
    const ctx = {
      eggTaps: 0, eggLastAt: 0, opened: 0,
      openEgg() { this.opened++; }
    };
    const run = new Function('Date', 'EGG_TAPS', 'EGG_WINDOW', 't', 'uni', body);
    const tap = (gapMs) => {
      clock += (gapMs === undefined ? 120 : gapMs);
      run.call(
        ctx,
        { now: () => clock },
        taps, win,
        (s, v) => (v && v.n !== undefined ? s.replace('{n}', v.n) : s),
        { showToast: (o) => toasts.push(o.title) }
      );
    };

    // a) 阈值 -1 下：还不能开奖
    for (let i = 0; i < taps - 1; i++) tap();
    eq(ctx.opened, 0, '连点 ' + (taps - 1) + ' 下不开奖');
    // 前 3 下静默，第 4 下起才有提示
    eq(toasts.length, taps - 4, '提示条数 = 阈值 - 4（前 3 下静默，实际 ' + toasts.length + '）');
    eq(toasts[0], '再点 3 下…', '第一条提示是「再点 3 下…」');

    // b) 第 7 下：开奖，且计数归零
    tap();
    eq(ctx.opened, 1, '第 ' + taps + ' 下开奖');
    eq(ctx.eggTaps, 0, '开奖后计数归零');

    // c) 窗口过期：断一会儿再点，不该接着上次数继续
    ctx.opened = 0;
    toasts.length = 0;
    for (let i = 0; i < taps - 1; i++) tap();
    tap(win + 500);          // 停超过窗口，计数应清零
    eq(ctx.opened, 0, '中断超过窗口后，这一下只算第 1 下（不开奖）');
    eq(ctx.eggTaps, 1, '计数被重置为 1');
    for (let i = 0; i < taps - 1; i++) tap();
    eq(ctx.opened, 1, '重新连点阈值下后开奖');

    // d) 慢慢点（每下间隔都超过窗口）：永远开不了奖，避免"随手点几下就弹出来"
    ctx.opened = 0; ctx.eggTaps = 0; ctx.eggLastAt = 0;
    for (let i = 0; i < taps * 2; i++) tap(win + 100);
    eq(ctx.opened, 0, '每下都超出窗口时不会误开奖');
  }

  console.log(fail ? '\n失败 ' + fail + ' 项 ✗' : '\n版本号与彩蛋全部通过 ✓');
  process.exit(fail ? 1 : 0);
})();
