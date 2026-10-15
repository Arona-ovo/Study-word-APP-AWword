// utils/onboarding.js - 首次进入的新手引导（步骤定义 + 完成状态 + 推进逻辑）
//
// 职责切分：
//   本文件只管三件事 —— 步骤定义（挑最该先知道的几件事）、完成状态持久化、
//   步骤推进的纯逻辑 advance()。
//   测量目标位置在 pages/home/home.vue（页面才能拿到节点矩形），
//   遮罩与气泡渲染在 components/onboarding-mask.vue。
//
// 完成状态存在 settings.onboarding（独立字段，与学习进度无关）：
//   { done: false, v: 步骤版本, at: 完成时间 }
// done 为 false 时首页 onShow 会放一遍；看完/跳过置 done，设置页可「重看」。

import * as settings from './settings.js'

const VERSION = 1

// target 的三种形态：
//   null                无高亮（欢迎步骤，气泡居中显示）
//   { sel }             页面内元素：home.vue 用 createSelectorQuery().in(this) 测
//   { ref, sel }        子组件内元素：调 this.$refs[ref].rect(sel, cb) 测
//                       （小程序端页面的 query 选不进自定义组件内部，必须组件自己量）
//
// targetFocus 是可选的「焦点模式专用目标」：首页有焦点 + 抽屉 / 卡片平铺两种形态，
// 同一件事的入口在两种形态里位置不同（焦点模式没有 action 卡）。
// home.vue 焦点模式下优先用 targetFocus，测不到再退回 target。
//
// 任何目标都可能不存在（模块被收纳 / 结构改动 / 当前形态没有这个元素）：
// 测量失败一律自动跳过该步，绝不能把用户卡死在引导里。
const STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用',
    body: '背单词的完整闭环都在本地：选词书 → 练习 → 复习错题。下面几步带你认一下首页，随时可以跳过。',
    target: null
  },
  {
    id: 'search',
    title: '顶部：查词 + AI 指令',
    body: '输入英文单词直接查释义，本地没有的会由 AI 自动补充；点右侧「AI」切到指令模式，说「把首页换个颜色」页面就会照做。',
    target: { ref: 'navbar', sel: '.fnb-search' }
  },
  {
    id: 'start',
    title: '中间：开始背单词',
    body: '每组都是中英互译，答错的自动进错题本；下面两个小按钮直达错题复习和 AI 薄弱点专练。',
    // 焦点模式下没有 action 卡（它的主按钮与主页 hero 重复，已整卡隐藏），
    // 所以这一步改指向 hero 上的两颗入口；卡片平铺模式仍用 .action-area。
    target: { sel: '.action-area' },
    targetFocus: { sel: '.focus-cta' }
  },
  {
    id: 'drawer',
    title: '底部：上滑看全部功能',
    body: '主页只留背单词 / 背句子两个入口；把手往上滑，词书进度、今日数据、每日目标这些卡片就出来了，往下滑回去就能收起。',
    // 只有焦点模式有把手（卡片平铺模式下这个元素不存在 → 测量失败会自动跳过该步）
    target: { sel: '.drawer-handle' }
  },
  {
    id: 'edit',
    title: '底部：编辑首页',
    body: '点「编辑首页」后卡片可以拖动排序、把不想要的收纳起来，也能从「＋ 添加组件」加回来。',
    target: { sel: '.foot-link' }
  },
  {
    id: 'tabbar',
    title: '底部导航：四个页',
    body: '词库（换词书 / 导入 / AI 生成词书）、错题（复习）、我的（设置与 AI 配置）。首页内容左右滑动也能切页。',
    target: { ref: 'tabbar', sel: '.ftb' }
  }
]

function steps() {
  return STEPS.slice()
}

function count() {
  return STEPS.length
}

/** 越界返回 null，调用方据此收尾 */
function stepAt(i) {
  return (i >= 0 && i < STEPS.length) ? STEPS[i] : null
}

/**
 * 推进一步：返回 { index, done }。
 * done 为 true 表示已经走完（调用方应当结束引导并落盘）。
 * 纯函数放这里，方便校验脚本直接测推进逻辑，不依赖页面实例。
 */
function advance(i, total) {
  const n = (typeof i === 'number' && i >= 0 ? i : -1) + 1
  // 异常配置（total<=0）：视为已完成，绝不把用户卡死在引导里
  if (typeof total === 'number' && total <= 0) return { index: n, done: true }
  return { index: n, done: n >= (total || STEPS.length) }
}

// ---------- 完成状态 ----------

function isDone() {
  try {
    const ob = settings.get().onboarding
    return !!(ob && ob.done)
  } catch (e) {
    return true // 读不了设置就别打扰用户（宁可不再弹）
  }
}

function shouldShow() {
  return !isDone()
}

function finish() {
  try {
    settings.set({ onboarding: { done: true, v: VERSION, at: Date.now() } })
  } catch (e) { /* 落盘失败不阻塞界面 */ }
}

/** 设置页「重看引导」用：清掉完成标记，回到首页 onShow 会重新放一遍 */
function restart() {
  try {
    settings.set({ onboarding: { done: false, v: VERSION, at: 0 } })
  } catch (e) { /* 同上 */ }
}

export {
  VERSION,
  steps, count, stepAt, advance,
  isDone, shouldShow, finish, restart
}
