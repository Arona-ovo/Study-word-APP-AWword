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
//   3) splashscreen 启动图必须是 **.9.png（九宫格）**，尺寸 = 官方内容尺寸 + 2（外圈 1px 黑线），
//      且黑线结构合法；**启动图只画渐变背景、全幅可拉伸**（图案全交给 cover 页画并淡入）
//   4) app-plus.splashscreen 的三个关闭策略开关取值合法
//   5) 启动图别用 jpg 改名（magic number 必须是 PNG）
//
// ⚠️ 第 3 组为什么这么严（两次实测事故）：
//   ① 启动图会被**铺满整屏**（fitXY）。普通 png 的比例只要和手机屏幕对不上，整张图就被拉长 ——
//      图 1080x1882（比例 0.574）遇上 1212x2616 的手机（比例 0.463），纵向被拉长约 24%，
//      圆头像变竖椭圆、字母被抻长。用户反馈："第一次打开软件，图片是被拉伸的"。
//      官方解法就是 .9.png（"指定特定的区域进行拉伸而不失真"）：
//        https://uniapp.dcloud.net.cn/collocation/manifest  → App Splashscreen
//   ② 后来又在启动图上画了"圆头像 + 文字 + 进度槽"想跟 cover 页无缝衔接，
//      但 .9.png 图案区是**固定像素**、cover 的圆圈是 **rpx 布局**（随屏宽缩放）——
//      1212px 宽的屏上前者 ≈490px、后者 ≈549px（差 12%，命中 xhdpi 图差 40%），
//      用户实测"第一张跟第二张之间圆圈错位/跳一下"。位图图案跟不上每台屏幕的宽度，是死结。
//   2026-10-12 起的定案：启动图**只画渐变背景**（拉伸无感），圆圈/脸/文字全部由 cover 页
//   绘制并淡入（check-cover-mascot.js 第 4 组守另一头）。所以这里的黑线契约是
//   "上边/左边各一整段（全幅可拉伸）" —— 如果以后往启动图上加回图案，这里会红。
const fs = require('fs');
const path = require('path');
const png = require('./lib/png');

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

// ---------- 3. 自定义启动图必须是合法 .9.png ----------
console.log('== 3. 启动图（.9.png 九宫格）==');
const spl = dist.splashscreen || {};
const style = spl.androidStyle;
assert(style === undefined || style === 'common' || style === 'default',
  'androidStyle 取值合法（' + (style || '未设置=通用启动界面') + '）');

if (style === 'default') {
  const targets = spl.android || {};
  assert(!!targets.hdpi, 'hdpi 启动图已配置');
  // 官方建议的内容尺寸；落盘文件各方向 +2px 放黑线
  const want = { hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [1080, 1920] };
  Object.keys(targets).forEach(k => {
    const rel = targets[k];
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { bad(k + ' 启动图不存在：' + rel); return; }
    if (!/\.9\.png$/.test(rel)) {
      bad(k + ' 启动图不是 .9.png（普通 png 会被铺满整屏拉伸变形）：' + rel);
      return;
    }
    const buf = fs.readFileSync(p);
    const size = pngSize(buf);
    if (!size) { bad(k + ' 启动图不是 png（jpg 改名会在打包时报错）：' + rel); return; }
    const w = want[k];
    assert(!w || (size.w === w[0] + 2 && size.h === w[1] + 2),
      k + ' 启动图 ' + size.w + 'x' + size.h + (w ? '（应为内容 ' + w[0] + 'x' + w[1] + ' + 2px 黑线）' : ''));

    // ---- 黑线结构：这是"图案不变形"的唯一保证，必须逐像素看
    let img;
    try {
      img = png.decode(buf);
    } catch (e) {
      bad(k + ' 启动图解码失败：' + e.message);
      return;
    }
    const top = png.blackRuns(img, 'top');       // 可水平拉伸的列
    const left = png.blackRuns(img, 'left');     // 可垂直拉伸的行
    const right = png.blackRuns(img, 'right');   // padding
    const bottom = png.blackRuns(img, 'bottom');

    // 右、下要"拉满"（官方：不拉满部分设备会显示灰色区域）
    assert(right.length === 1 && bottom.length === 1 &&
      right[0][0] === 0 && right[0][1] === size.h - 2 &&
      bottom[0][0] === 0 && bottom[0][1] === size.w - 2,
      k + ' 右边/下边黑线拉满（否则部分设备显示灰边）');

    // 上边/左边黑线必须是**一整段**（全幅可拉伸）：启动图只画渐变背景，
    // 画面里没有任何不可拉伸的图案（图案全交给 cover 页，防圆圈错位）。
    // 整幅可拉伸 + 平滑渐变 = 任意屏幕比例都无感；
    // 若以后往启动图上加回图案，这里会红（check-cover-mascot.js 第 4 组也会红）。
    assert(top.length === 1 && top[0][0] === 0 && top[0][1] === size.w - 2,
      k + ' 上边黑线一整段（纯渐变背景全幅可拉伸），实际 ' + top.length + ' 段');
    assert(left.length === 1 && left[0][0] === 0 && left[0][1] === size.h - 2,
      k + ' 左边黑线一整段（纯渐变背景全幅可拉伸），实际 ' + left.length + ' 段');

    // 四条边除黑线外必须透明，否则 aapt 认不出黑线
    ['top', 'left', 'right', 'bottom'].forEach(edge => {
      assert(png.restTransparent(img, edge), k + ' ' + edge + ' 边非黑线的像素全透明（aapt 靠这个认黑线）');
    });
  });

  // static/ 下的文件会全部打进 apk：旧版普通 png 不能留着
  const dir = path.join(ROOT, 'static', 'splash');
  if (fs.existsSync(dir)) {
    const strays = fs.readdirSync(dir).filter(n => !/\.9\.png$/.test(n));
    assert(strays.length === 0, 'static/splash 下没有残留的普通 png（会白占 apk 体积）：'
      + (strays.join(', ') || '无'));
  }
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
