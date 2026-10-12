// _tools/check-link.js - 与 PWstudy（番茄钟）的联动契约校验（只读，不改源码）
//
// 为什么值得专门守一道：这套联动**失效时是完全静默的**，不报错、不崩、界面照常 ——
//   · manifest 漏了 schemes     → 系统根本不认 awword://，对方"跳过去"毫无反应
//   · App.vue 没接 newintent     → 冷启动能进来，但 App 已在后台时再被唤起就没反应
//   · finish() 的字段名改了       → 链接收得到，但对面记不进统计，用户只当"没记上"
//   · 少了 ctx 为空的短路         → 自己点开 App 的人也会看到一条莫名其妙的来路横幅
// 四种都不会抛异常，只能靠静态钉契约 + 真机点一遍。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const is = (c, m) => (c ? ok(m) : bad(m));

const mf = read('manifest.json');
const link = read('utils/link.js');
const app = read('App.vue');
const practice = read('pkgStudy/pages/practice/practice.vue');

console.log('\n[1] 系统认不认这个 scheme');
// 少了它，PWstudy 那边 plus.runtime.openURL('awword://…') 会直接失败，且无任何提示
is(/"schemes"\s*:\s*\[[^\]]*"awword"/.test(mf), 'manifest 声明了 schemes: ["awword"] —— 没有它系统不认 awword://');
is(mf.indexOf('"app-plus"') >= 0 && mf.indexOf('"schemes"') > mf.indexOf('"app-plus"'),
   'schemes 挂在 app-plus 下（挂错层级等于没写）');

console.log('\n[2] 联动模块导出齐不齐');
['parse', 'consume', 'hasCtx', 'getCtx', 'clearCtx', 'finish', 'openUrl'].forEach((f) => {
  is(new RegExp('export\\s+function\\s+' + f + '\\s*\\(').test(link), 'link.js 导出 ' + f + '()');
});
is(/SCHEME\s*=\s*'awword'/.test(link), "SCHEME = 'awword'（与 manifest 声明一致）");
is(/PARTNER_SCHEME\s*=\s*'pwstudy'/.test(link), "PARTNER_SCHEME = 'pwstudy'（与对方 scheme 对齐）");

console.log('\n[3] 进来的字段名（PWstudy → 这边）');
// 对方生成的是 awword://study?minutes=&task=&back=，字段名一改就对不上
is(/params\.minutes/.test(link), '认 minutes（对方建议的本次时长）');
is(/params\.task/.test(link), '认 task（对得上 PWstudy 的任务）');
is(/params\.back/.test(link), '认 back（学完回哪去）');
// linked：对面当前有没有把我们当已关联 —— 决定"自动回跳"还是"留个按钮自己点"（文档 11.8）
is(/params\.linked/.test(link), '认 linked（0 = 手动回跳；没有这个参数按已关联处理）');
is(/kind\s*!==\s*'study'/.test(link), "只认 kind = 'study'");

console.log('\n[4] 回去的字段名（这边 → PWstudy）');
is(/mergeQuery\(\s*c\.back/.test(link), '在对方给的 back 地址上改参数（不另造一个 URL，免得丢掉它带的上下文）');
is(/min\s*:/.test(link), '回传 min');
is(/words\s*:/.test(link), '回传 words（本次学会的词数）');
is(/task\s*:\s*c\.taskId/.test(link), '回传 task');
// min 必须是真实停留时长：把进来时的"建议时长"原样送回去 = 统计全是假的
is(/Date\.now\(\)\s*-\s*c\.startAt/.test(link), 'min 取真实停留时长（不是把对方的建议值转手还回去）');

console.log('\n[5] 接线：唤起与离开两头都通');
is(/import\s+\*\s+as\s+link\s+from\s+'\.\/utils\/link\.js'/.test(app), 'App.vue 引入了 link');
is(/link\.consume\(/.test(app), 'App.vue 调了 consume()');
is(/'newintent'/.test(app), 'App.vue 挂了 newintent（App 在后台时被唤起也要接住）');
is(/link\.hasCtx\(\)/.test(practice), '练习页读 hasCtx() 决定显不显示来路提示');
is(/link\.finish\(/.test(practice), '练习页离开时调 finish() 回传');
is(/link\.finish\(this\.correctCount\)/.test(practice),
   '回传的是 correctCount（确认通过 = 真学会），不是 answerCount（做过几道题）');
is(/i18n\.js'/.test(practice) && /link/.test(practice), '练习页同时持有 i18n 与 link（来路文案走 $t）');

console.log('\n[6] 自己点开 App 时不受任何影响');
// ctx 为空时整条链路必须完全不参与，否则没从 PWstudy 进来的用户会看到一条莫名的横幅
is(/if\s*\(!\s*ctx\s*\)\s*return/.test(link), '没有 ctx 时直接返回');
is(/v-if="fromLink"/.test(practice), '来路提示是 v-if 控制的（没来路就不渲染）');

console.log('\n[7] 包名与 Android 包可见性（对接文档 11.1 / 11.2）');
// 包名是对方检测我们装没装的钥匙 —— 发布后一改，老用户本地存的关联状态全部失效
is(/"packageName"\s*:\s*"com\.AWword"/.test(mf), 'manifest 钉住了 packageName = com.AWword（发布后不许再改）');
is(/<queries>[\s\S]*?<package\s+android:name="com\.pwstudy\.app"\s*\/>[\s\S]*?<\/queries>/.test(read('AndroidManifest.xml')),
   'AndroidManifest.xml 的 <queries> 里声明了 com.pwstudy.app（targetSdk>=30 才看得到对方）');
// 双保险：<queries> 只对新装/重装的包生效，已经躺在用户手机里的老 APK 吃不到 ——
// QUERY_ALL_PACKAGES 是同一件事的另一条路（PWstudy 侧也是这么做的）
is(/QUERY_ALL_PACKAGES/.test(mf), 'manifest 声明了 QUERY_ALL_PACKAGES（包可见性的兜底）');

if (fail) {
  console.error('\n存在 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('\n联动契约 校验全部通过 ✓');
