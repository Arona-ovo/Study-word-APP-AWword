// _tools/check-native-assets.js - 原生打包资源（桌面图标 / 启动图）配置校验
//
// 为什么要这道闸：
//   manifest.json 里图标配错一层级（写成 distribute.android.icons 而不是
//   distribute.icons.android）时，HBuilderX 不报错、校验脚本也发现不了，
//   云端打包会**静默回退到 DCloud 默认图标**（绿色 H），
//   而且启动界面默认「通用启动界面」= 应用图标 + 应用名，
//   于是开屏也是绿 H + 应用名 —— 一次配置错误同时毁掉桌面图标和启动图。
//   实际事故复盘见 uniapp/unpackage/release/apk 里打出来的 res/drawable-xxhdpi/icon.png。
//
// 校验项：
//   1) icons 必须挂在 app-plus.distribute.icons.{android,ios}（不是 distribute.android.icons）
//   2) 图标文件存在、是 png、像素尺寸与官方要求一致（mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192）
//   3) splashscreen 自定义启动图：文件存在、像素尺寸符合官方口径（hdpi 480x762 / xhdpi 720x1242）
//   4) app-plus.splashscreen 的三个关闭策略开关取值合法
//   5) 启动图别用 jpg 改名（magic number 必须是 PNG）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

// PNG 真实像素尺寸（读 IHDR，不依赖任何图像库）
function pngSize(buf) {
  if (buf.slice(1, 4).toString('latin1') !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

let mf;
try {
  mf = JSON.parse(R('manifest.json'));
} catch (e) {
  console.error('  ✗ manifest.json 不是严格 JSON：' + e.message);
  process.exit(1);
}

const dist = (mf['app-plus'] || {}).distribute || {};

// ---------- 1. 图标层级 ----------
console.log('== 1. 图标配置层级 ==');
assert(!(dist.android && dist.android.icons),
  'distribute.android 下不能再有 icons（这是错层级，打包会静默忽略）');
const icons = dist.icons || {};
const androidIcons = icons.android || {};
assert(Object.keys(androidIcons).length > 0, '图标挂在 distribute.icons.android（正确层级）');

// ---------- 2. 图标文件与尺寸 ----------
console.log('== 2. 图标文件 ==');
const ICON_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
Object.keys(ICON_PX).forEach(k => {
  const rel = androidIcons[k];
  if (!rel) { bad('缺少 ' + k + ' 图标配置'); return; }
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { bad(k + ' 图标文件不存在：' + rel); return; }
  const size = pngSize(fs.readFileSync(p));
  if (!size) { bad(k + ' 不是合法 png：' + rel); return; }
  assert(size.w === ICON_PX[k] && size.h === ICON_PX[k],
    k + ' 图标 ' + size.w + 'x' + size.h + '（要求 ' + ICON_PX[k] + '）');
});

// ---------- 3. 自定义启动图 ----------
console.log('== 3. 启动图配置 ==');
const spl = dist.splashscreen || {};
const style = spl.androidStyle;
assert(style === undefined || style === 'common' || style === 'default',
  'androidStyle 取值合法（' + (style || '未设置=通用启动界面') + '）');

if (style === 'default') {
  const targets = spl.android || {};
  assert(!!targets.hdpi, 'hdpi 启动图已配置（480x762）');
  // 官方 manifest 只定义 hdpi / xhdpi 两档；xxhdpi 是社区通行做法，配了就对尺寸负责
  const want = { hdpi: [480, 762], xhdpi: [720, 1242], xxhdpi: [1080, 1882] };
  Object.keys(targets).forEach(k => {
    const rel = targets[k];
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { bad(k + ' 启动图不存在：' + rel); return; }
    const size = pngSize(fs.readFileSync(p));
    if (!size) { bad(k + ' 启动图不是 png（jpg 改名会在打包时报错）：' + rel); return; }
    const w = want[k];
    assert(!w || (size.w === w[0] && size.h === w[1]),
      k + ' 启动图 ' + size.w + 'x' + size.h + (w ? '（建议 ' + w[0] + 'x' + w[1] + '）' : ''));
  });
} else {
  ok('未启用自定义启动图 → 走「通用启动界面」（应用图标 + 应用名 + 加载圈）');
}

// ---------- 4. 启动界面关闭策略 ----------
console.log('== 4. 启动界面关闭策略 ==');
const sp = (mf['app-plus'] || {}).splashscreen || {};
// ⚠️ HBuilderX 的 manifest 可视化编辑器在改动「模块配置」时会顺手把这一项写回 false
// （实测：取消勾选 Barcode 之后它变成了 false）。这里是**故意**设成 true 的 ——
// 我们启用了自定义启动图（复刻 cover 首屏），必须让它撑到首页首帧渲染完再撤，
// 否则中间会闪一帧白底。看到这条红，直接把 manifest 改回 true，别改断言。
assert(sp.alwaysShowBeforeRender === true,
  'alwaysShowBeforeRender=true（等首页渲染完再关启动图，避免闪白；HBuilderX 改模块时会写回 false，改回来即可）');
assert(sp.autoclose === true, 'autoclose=true（自动关闭）');
assert(typeof sp.delay === 'number', 'delay 是数字（' + sp.delay + '）');
if (typeof sp.waiting === 'boolean') {
  ok('waiting=' + sp.waiting + (sp.waiting === false ? '（自定义启动图上不再叠加载圈）' : ''));
}

// ---------- 5. 与 cover 页的衔接 ----------
console.log('== 5. 与 cover 首屏的衔接 ==');
const cover = R('pages/cover/cover.vue');
const light = /linear-gradient\(165deg, #f2f7ff 0%, #e0ecff 52%, #cfe0ff 100%\)/.test(cover);
assert(light, 'cover 首屏浅色底仍是 165deg #f2f7ff→#e0ecff→#cfe0ff（改这里要重新 gen-splash.py）');
// 启动图生成脚本仍在，改设计稿可复现
assert(fs.existsSync(path.join(__dirname, 'gen-splash.py')), '保留下 gen-splash.py 生成脚本（可复现）');

// ---------- 6. 模块白名单 ----------
// 勾选的原生模块会被打进基座/APK，没用到就是白白撑大体积。
// Barcode（扫码）曾经被勾上，评估后**明确不用**：备份密文实测 240 KB，
// 二维码版本 40 的硬上限是 2953 字节（手机对扫的可靠上限约 1~2 KB），差两个数量级，
// 装不下；换机迁移走「导出 → 系统分享面板（含各厂商互传，Wi-Fi 直连）」。
console.log('== 6. 原生模块白名单 ==');
const mods = (mf['app-plus'] || {}).modules || {};
const modKeys = Object.keys(mods);
assert(!mods.Barcode, '未勾选 Barcode 扫码模块（备份 240KB 装不进二维码，换机走系统分享互传）');
ok('已启用模块：' + (modKeys.length ? modKeys.join(' / ') : '（无）'));

console.log('\n' + (fail ? '✗ FAIL ' + fail : '✓ ALL PASS ' + pass + ' 项'));
process.exitCode = fail ? 1 : 0;
