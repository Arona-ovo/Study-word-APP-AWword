// _tools/check-profile.js - 校验「我的」页个人资料默认值与迁移（只读）
// 运行：node _tools/check-profile.js
//
// 覆盖：
//  1) 默认昵称必须是 arona（不再用「学习者」）
//  2) settings.js 与 profile.vue 两处默认值一致（两者各存一份，容易改漏一边）
//  3) 老存档迁移：昵称仍为「学习者」或为空 → 自动改成 arona
//  4) 用户自定义过的昵称不被迁移覆盖
//  5) 默认头像必须指向 static/avatar-default.jpg（正方形、体积可控、整幅缩进不裁切），
//     不能再指回 800x480 的静态横图 mascot.jpg —— 头像框是 110rpx 正圆，
//     横图取中间方形后人物又小又偏、在圆里看不清脸，这种问题肉眼不看真机根本发现不了
//  6) 头像是能换的（用户反馈「用户不能改图片」）：
//     入口在编辑资料里 + 头像本身可点；走 chooseImage → saveFile 落本机 → profile.avatar；
//     并且给了「恢复默认头像」（settings.set 是深合并，恢复默认必须显式写空串）
//  7) 显示模式必须是 aspectFit（原框尽可能显示图片的全部），不能是 aspectFill

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

/** 用给定的已存数据跑一次 settings 读档，返回最终昵称 */
function nicknameWith(stored) {
  const mem = {};
  global.uni = {
    getStorageSync: (k) => mem[k],
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    showToast: () => {}
  };
  if (stored) mem['fj_app_settings_v1'] = stored;
  const s = load('utils/settings.js');
  s.init();
  return s.get().profile.nickname;
}

console.log('== 1. 默认昵称 = arona ==');
eq(nicknameWith(null), 'arona', '全新安装（无存档）');

console.log('== 2. 老存档迁移 ==');
eq(nicknameWith({ profile: { avatar: '', nickname: '学习者', account: 'local_x', bio: '' } }),
  'arona', '昵称还是老默认值「学习者」→ 迁移为 arona');
eq(nicknameWith({ profile: { avatar: '', nickname: '', account: 'local_x', bio: '' } }),
  'arona', '昵称为空 → 兜底为 arona');

console.log('== 3. 用户自定义昵称不被覆盖 ==');
eq(nicknameWith({ profile: { avatar: '', nickname: '小明', account: 'local_x', bio: '' } }),
  '小明', '自定义昵称保持原样');
eq(nicknameWith({ profile: { avatar: '', nickname: 'arona', account: 'local_x', bio: '' } }),
  'arona', '恰好等于新默认值的昵称也保持原样');

console.log('== 4. 两处默认值一致 ==');
const setSrc = R('utils/settings.js');
const vueSrc = R('pages/profile/profile.vue');
const m1 = /const DEFAULT_NICKNAME = '([^']*)'/.exec(setSrc);
const m2 = /const DEFAULT_NICKNAME = '([^']*)'/.exec(vueSrc);
assert(m1 && m2, 'settings.js 与 profile.vue 都定义了 DEFAULT_NICKNAME 常量');
if (m1 && m2) eq(m1[1], m2[1], '两处常量取值一致');

// 迁移分支存在
assert(/LEGACY_NICKNAME/.test(setSrc), 'settings.js 定义了旧昵称常量 LEGACY_NICKNAME');
assert(/nick === LEGACY_NICKNAME/.test(setSrc), '读档时做一次性迁移');

console.log('== 5. 默认头像资源 ==');
// 剥掉两种注释再扫（JS 行注释 + 块注释），免得注释里写的说明被当成真的引用
const vueClean = vueSrc.replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const av = /this\.profile\.avatar \|\| '([^']+)'/.exec(vueClean);
assert(av, 'profile.vue 有头像兜底表达式 profile.avatar || 默认图');
if (av) eq(av[1], '/static/avatar-default.jpg', '默认头像路径');
assert(!/static\/mascot\.jpg/.test(vueClean),
  '不再引用横版 mascot.jpg（800x480 取中间方后人物小且偏，不适合圆形头像）');

/** 极简 JPEG 尺寸解析：扫到 SOF 段读高宽（不引第三方库） */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const seg = buf.readUInt16BE(i + 2);
    if (seg < 2) return null;
    i += 2 + seg;
  }
  return null;
}

const avPath = path.join(ROOT, 'static', 'avatar-default.jpg');
assert(fs.existsSync(avPath), 'static/avatar-default.jpg 文件存在（生成：python _tools/gen-avatar.py）');
if (fs.existsSync(avPath)) {
  const buf = fs.readFileSync(avPath);
  const sz = jpegSize(buf);
  assert(!!sz, '是合法 JPEG（FFD8 + SOF 段可解析）');
  if (sz) {
    eq(sz.w, sz.h, '宽高相等（圆形头像用正方形）');
    assert(sz.w >= 256, '边长 ' + sz.w + 'px ≥ 256（110rpx 在 3x 屏约 158 物理像素）');
    // 「整幅缩进不裁切」得能验：画面四周必须有一圈同色留白。
    // 直接解 JPEG 像素太重，这里退一步查生成脚本的契约 ——
    // 脚本一旦被改回 crop（旧写法），这几条就会红。
    const gen = fs.readFileSync(path.join(__dirname, 'gen-avatar.py'), 'utf8');
    assert(/FIT\s*=/.test(gen) && /canvas\.paste/.test(gen),
      'gen-avatar.py 是「等比缩进 + 居中贴到方形画布」（不是裁切）');
    assert(!/\.crop\(\s*box\s*\)/.test(gen) && !/CROP_SIDE/.test(gen),
      'gen-avatar.py 里没有残留的裁切逻辑（CROP_SIDE / crop(box)）');
    const fit = Number((/FIT\s*=\s*([\d.]+)/.exec(gen) || [])[1]);
    assert(fit > 0.7 && fit < 0.98, 'FIT=' + fit + ' 在 0.7~0.98 之间（太小看不见人、太大又顶到圆边）');
  }
  const kb = Math.round(buf.length / 1024);
  if (kb > 0 && kb < 120) ok('体积 ' + kb + 'KB（应在 1-120KB，随包进 APK）');
  else bad('体积异常 ' + kb + 'KB（应在 1-120KB）');
}

console.log('== 6. 头像是能换的 ==');
// 用户反馈：「用户不能改图片」。以前编辑资料里只有昵称 + 签名，头像压根没有入口，
// 而左上角那张图也只是个 <image>，点了什么都不会发生。
assert(/@tap="chooseAvatar"/.test(vueClean), '头像本身可点（@tap="chooseAvatar"）');
assert(/class="field field-tap"[\s\S]{0,200}@tap="chooseAvatar"/.test(vueClean),
  '编辑资料里有「头像」那一行，点整行也能换（光靠小圆图，新用户想不到去点）');
assert(/\$t\('头像'\)/.test(vueClean), '那一行有「头像」标签');
// 显示模式：原框尽可能显示图片的全部
assert(/<image class="avatar" :src="avatarSrc" mode="aspectFit" \/>/.test(vueClean),
  '大头像用 mode="aspectFit"（完整显示，不裁切）');
assert(!/class="avatar"[^>]*aspectFill/.test(vueClean),
  '大头像不再用 aspectFill（那是"偏大/被裁"的直接原因）');
// 选图链路
const chooseBody = vueClean.match(/chooseAvatar\(\) \{([\s\S]*?)\n    \},/);
assert(!!chooseBody, '能抠出 chooseAvatar 方法体');
if (chooseBody) {
  const b = chooseBody[1];
  assert(/uni\.chooseImage\(/.test(b), '走系统选图 chooseImage（不自己造相册）');
  assert(/sourceType:\s*\[[^\]]*'album'/.test(b) && /'camera'/.test(b), '相册与拍照都给（端上二选一）');
  assert(/uni\.saveFile\(/.test(b), '选完 saveFile 落到本机（临时路径重启后会没）');
  assert(/fail:\s*\(\)\s*=>\s*\{[^}]*\}/.test(b), '用户取消选图要静默，不能弹错');
  assert(/setAvatar\(/.test(b), '存好之后交给 setAvatar 落盘');
}
const setBody = vueClean.match(/\n    setAvatar\(path\) \{([\s\S]*?)\n    \},/);
assert(!!setBody, '能抠出 setAvatar 方法体');
if (setBody) {
  assert(/settings\.set\(\{ profile: \{ avatar: p \} \}\)/.test(setBody[1]), 'setAvatar 写 profile.avatar');
  assert(/this\.refresh\(\)/.test(setBody[1]), '写完立刻 refresh（avatarSrc 是 computed，靠它跟着变）');
}
assert(/\bt\('已更新头像'\)/.test(vueClean), '换完给一句反馈（不然用户不知道成没成）');
// 恢复默认：settings.set 是深合并，必须显式写空串
const resetBody = vueClean.match(/resetAvatar\(\) \{([\s\S]*?)\n    \},/);
assert(!!resetBody, '能抠出 resetAvatar 方法体');
if (resetBody) {
  assert(/avatar: ''/.test(resetBody[1]),
    '恢复默认显式写 avatar: \'\'（深合并下"删 key"删不掉 —— 项目约定 14）');
  assert(!/delete\s/.test(resetBody[1]), '不是靠 delete 删字段');
}
assert(/v-if="profile\.avatar"[\s\S]{0,120}@tap="resetAvatar"/.test(vueClean),
  '换过才显示「恢复默认头像」（没换过时那一行是死的，反而让人以为默认图被改了）');

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
