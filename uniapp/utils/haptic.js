// utils/haptic.js - 触感反馈（震动）
//
// 用在这三处：底部菜单栏点击、首页抽屉拉到位、设置页「试一下」。
//
// 三条硬规矩：
//   1) 跟着设置走（设置 › 触感反馈）：总开关关掉就一次都不震，连 API 都不碰。
//   2) 连点保护：MIN_GAP 之内的重复触发直接丢掉 —— 否则滑一次抽屉能震出一窝蜂，
//      而且 Android 上连续 vibrate() 会把短震叠成长震，手感全毁。
//   3) 平台能力先验再调：App 走 plus.device.vibrate(ms)（能精确到毫秒），
//      其余端退 uni.vibrateShort；都没有就安静返回 false，绝不把异常抛给用户。
//
// ⚠️ Android 需要 android.permission.VIBRATE —— manifest.json 里已声明。
//    它是**安装时权限**（不用运行时弹框），但**改 manifest 必须重新打包 / 重打基座**：
//    老基座里没这个权限，真机调试时震动会静默失败。失败原因记在 lastError() 里，
//    设置页据此提示「需要重新打包」，而不是假装"本设备不支持震动"。
import * as settings from './settings.js';

// 三档强度（毫秒）。Android 上 10~15ms 是"哒"的一下，30ms 往上就开始"嗡"了，
// 所以 strong 也就 34ms —— 再长就不是反馈而是骚扰。
const LEVEL_MS = { light: 12, mid: 22, strong: 34 };
// 场景倍率：底部导航轻一点（点得频繁），抽屉到位稍重一点（一次滑动只响一声）
const KIND_K = { tap: 1, switch: 0.8, drawer: 1.15 };

const MIN_GAP = 70;   // 连点保护

let lastAt = 0;
let lastErr = '';

/** 总开关（设置 › 触感反馈）。读不到设置时按"开"处理（别让存档异常变成"永远不震"） */
export function isEnabled() {
  try {
    const h = settings.get().haptic;
    return !(h && h.on === false);
  } catch (e) {
    return true;
  }
}

/** 当前强度档：light | mid | strong（脏值一律回落到 mid） */
export function level() {
  try {
    const h = settings.get().haptic;
    const l = h && h.level;
    return LEVEL_MS[l] ? l : 'mid';
  } catch (e) {
    return 'mid';
  }
}

/** 某个场景这次该震多少毫秒 */
export function msOf(kind) {
  const base = LEVEL_MS[level()] || LEVEL_MS.mid;
  const k = KIND_K[kind] || 1;
  const ms = Math.round(base * k);
  return ms < 8 ? 8 : ms;
}

/** 上一次为什么没震成（'' = 没失败过 / 已经震成功）。设置页用它决定要不要提示"需重新打包" */
export function lastError() {
  return lastErr;
}

/** 有没有可用的震动 API（只回答"能不能调"，不保证真的震得动） */
export function hasApi() {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.device && typeof plus.device.vibrate === 'function') return true;
  // #endif
  return !!(typeof uni !== 'undefined' && typeof uni.vibrateShort === 'function');
}

function fire(ms) {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.device && typeof plus.device.vibrate === 'function') {
    plus.device.vibrate(ms);
    return true;
  }
  // #endif
  if (typeof uni !== 'undefined' && typeof uni.vibrateShort === 'function') {
    uni.vibrateShort({ type: ms <= 14 ? 'light' : (ms <= 26 ? 'medium' : 'heavy') });
    return true;
  }
  return false;
}

/**
 * 震一下。
 * @param {'tap'|'switch'|'drawer'} kind 场景（决定时长倍率）
 * @returns {boolean} 是否真的震了（关开关 / 连点 / 平台不支持都会返回 false）
 */
export function tick(kind) {
  if (!isEnabled()) return false;
  const now = Date.now();
  if (now - lastAt < MIN_GAP) return false;
  lastAt = now;                    // 先占位：就算这次没震成，也不该在 70ms 里重试
  const ms = msOf(kind);
  try {
    const done = fire(ms);
    if (!done) {
      lastErr = 'no-api';
      return false;
    }
    lastErr = '';
    return true;
  } catch (e) {
    // 原生调用不许完全静默（项目硬规矩 37）：真机"没震动"时控制台得有线索。
    // Android 上最常见的失败就是基座没打进 VIBRATE 权限 → SecurityException。
    lastErr = String((e && e.message) || e || 'error');
    console.warn('[haptic] vibrate failed:', e);
    return false;
  }
}

/** 总开关落盘 */
export function setOn(v) {
  try {
    settings.set({ haptic: { on: !!v } });
    return true;
  } catch (e) {
    console.warn('[haptic] setOn failed:', e);
    return false;
  }
}

/** 强度落盘（脏值回落 mid） */
export function setLevel(v) {
  const next = LEVEL_MS[v] ? v : 'mid';
  try {
    settings.set({ haptic: { level: next } });
    return true;
  } catch (e) {
    console.warn('[haptic] setLevel failed:', e);
    return false;
  }
}
