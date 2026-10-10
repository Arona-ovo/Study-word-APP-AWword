// _tools/check-profile.js - 校验「我的」页个人资料默认值与迁移（只读）
// 运行：node _tools/check-profile.js
//
// 覆盖：
//  1) 默认昵称必须是 arona（不再用「学习者」）
//  2) settings.js 与 profile.vue 两处默认值一致（两者各存一份，容易改漏一边）
//  3) 老存档迁移：昵称仍为「学习者」或为空 → 自动改成 arona
//  4) 用户自定义过的昵称不被迁移覆盖
//  5) 默认头像必须指向 static/avatar-default.jpg（正方形、体积可控），
//     不能再指回 800x480 的静态横图 mascot.jpg —— 头像框是 110rpx 正圆 + aspectFill，
//     横图会被裁得只剩半张脸，这种问题肉眼不看真机根本发现不了

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
  '不再引用横版 mascot.jpg（800x480 塞进正圆会被 aspectFill 裁烂）');

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
    eq(sz.w, sz.h, '宽高相等（圆形头像用正方形，方形图不会被 aspectFill 裁）');
    assert(sz.w >= 256, '边长 ' + sz.w + 'px ≥ 256（110rpx 在 3x 屏约 158 物理像素）');
  }
  const kb = Math.round(buf.length / 1024);
  if (kb > 0 && kb < 120) ok('体积 ' + kb + 'KB（应在 1-120KB，随包进 APK）');
  else bad('体积异常 ' + kb + 'KB（应在 1-120KB）');
}

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
