// utils/partner.js - 与「伙伴 App」（PWstudy 番茄钟）的关联意愿
//
// 对接文档见 PWstudy 仓库 uniapp/docs/partner-link.md（交接版：docs/partner-handoff-awword.md）。
//
// 定位一句话：**AWword 不是 PWstudy 内置的背单词模块，PWstudy 也不是用户唯一的背单词入口。**
// 这里的「关联」只是一份**本地意愿记录** —— 关联了就互相跳转并交换数据；
// 不关联时 AWword 背单词、复习、查词一条都不少。
//
// 所以这个文件里每个函数都必须是"不关联也能活"的：
// 没装 / 没关联 / 非 App 端，任何一种情况都只返回 false 或 0，绝不抛错 ——
// 一个可选的增强，不该有能力拖垮主流程。

import * as settings from './settings.js'
import * as store from './store.js'
import * as usage from './usage.js'

// 协议版本。收到不认识的版本按 v1 处理 —— 两个 App 都在快速迭代，
// 版本号用来"知道对方更旧"，不是用来"拒绝服务"。
export const PROTOCOL_V = 1

// 自动询问的上限与间隔（防骚扰，见文档 11.6）
export const ASK_MAX = 3
export const ASK_GAP_MS = 2 * 24 * 3600 * 1000

/**
 * 伙伴注册表。
 *
 * 现在只有 PWstudy，但按"可以有多个"来组织：将来还接别的学习 App，
 * 只需要在这里加一项 —— 调用方拿的是 id，不是写死的包名。
 * 用户明确说过 PWstudy 不是唯一的番茄钟，所以 PWstudy 也不该享受硬编码的特殊待遇。
 */
export const PARTNERS = {
  pwstudy: {
    id: 'pwstudy',
    name: 'PWstudy',
    pkg: 'com.pwstudy.app',   // Android 包名：检测安装 + 唤起（与它 manifest 里的 packageName 一致）
    scheme: 'pwstudy'         // 它自己的 scheme
  }
}

export const DEFAULT_ID = 'pwstudy'

export function partnerOf(id) {
  return PARTNERS[id || DEFAULT_ID] || PARTNERS[DEFAULT_ID]
}

/* ==================== 是否正在练习 ==================== */

// 这三个页面 = "人正答着题"。在这些页面里绝不弹任何关联提示（见 11.6 条件 5）。
// 判据用当前页路由、而不是"有没有会话对象"：中途点开词义、切出去再回来的整段时间，
// 人都还在一组题里 —— 这时候糊一张询问卡上来，等于趁人思考时打断。
const STUDY_ROUTES = [
  'pkgStudy/pages/practice/practice',
  'pkgStudy/pages/word-drill/word-drill',
  'pkgStudy/pages/review-list/review-list'
]

function currentPages() {
  try {
    if (typeof getCurrentPages === 'function') return getCurrentPages()
  } catch (e) {}
  return []
}

/**
 * 当前是不是"正在练习中"。
 * pages 可选传入：默认自己读 getCurrentPages()，传值是为了让契约脚本塞一份假页栈来验。
 */
export function practicing(pages) {
  const list = pages || currentPages()
  try {
    if (!list || !list.length) return false
    const top = list[list.length - 1]
    const route = String((top && (top.route || top.$page && top.$page.path)) || '')
    if (!route) return false
    return STUDY_ROUTES.some((r) => route.indexOf(r) >= 0)
  } catch (e) {
    return false
  }
}

/* ==================== 状态读写 ==================== */

function blank() {
  return {
    v: PROTOCOL_V, state: 'undecided',
    askedCount: 0, lastAskAt: 0, linkedAt: 0, lastSyncAt: 0, lastWords: 0, seenAt: 0
  }
}

// "它唤起过我们"这条证据的有效期：超过 14 天就当没这回事（可能早卸了）
export const SEEN_TTL_MS = 14 * 24 * 3600 * 1000

export function state() {
  try {
    const p = settings.get().partner
    if (p && p.state) return Object.assign(blank(), p)
  } catch (e) {}
  return blank()
}

function write(patch) {
  try {
    settings.set({ partner: patch })
  } catch (e) {}
  return state()
}

export function isLinked() {
  return state().state === 'linked'
}

/* ==================== 检测对方装没装 ==================== */

/**
 * 伙伴 App 是否已安装。只支持 App 端 —— H5 / 小程序压根没有"检测已安装应用"，直接 false。
 *
 * 三档判定，从准到粗，任何一档命中就算装了：
 *   ① 按包名查（最准，也是最容易失效的一档）
 *   ② 查"有没有 Activity 接得住 pwstudy://"（Android 11+ 上包名查询被拦时，这条常被放行）
 *   ③ 它最近真的把我们唤起过（见 noteSeen）—— 系统查询说没装，可它明明跳得过来
 *
 * 为什么要叠到三档：Android 11（API 30）起有包可见性限制，targetSdk >= 30 的应用
 * 默认**看不见**别的已安装应用，① 会一律 false —— 表现就是"对面都能跳过来，这边
 * 却一直显示未检测到"。manifest 侧的 <queries> 与 QUERY_ALL_PACKAGES 都要**重新云打包**
 * 才生效，已经装在用户手机上的老 APK 永远吃不到，所以运行时必须有后两档兜底。
 */
export function installed() {
  const p = partnerOf()
  // #ifdef APP-PLUS
  try {
    const rt = (typeof plus !== 'undefined' && plus.runtime) ? plus.runtime : null
    if (rt && typeof rt.isApplicationExist === 'function') {
      if (rt.isApplicationExist({ pname: p.pkg })) return true
      try {
        if (rt.isApplicationExist({
          action: 'android.intent.action.VIEW',
          datauri: p.scheme + '://'
        })) return true
      } catch (e) {}
    }
  } catch (e) {}
  // #endif
  return seen()
}

/**
 * 「它唤起过我们」—— 由 utils/link.js 在被 pwstudy:// 唤起时记一笔。
 * 这是最硬的一条证据：系统可以不让查，但跳转发生过就是发生过。
 */
export function seen() {
  const at = Number(state().seenAt) || 0
  return !!at && Date.now() - at < SEEN_TTL_MS
}

export function noteSeen() {
  return write({ seenAt: Date.now() })
}

/* ==================== 该不该自动问 ==================== */

/**
 * 是否该弹首次询问。条件缺一不可（文档 11.6）：
 *   已安装 + 状态仍是 undecided + 没问够 3 次 + 距上次 ≥ 2 天 + 不在练习中
 *
 * practicing 由调用方算好传进来：这里默认从 getCurrentPages() 取页面栈，传值是
 * 为了让契约脚本能塞一份假页栈、把"练习中不弹窗"这条短路真的跑一遍。
 */
export function shouldAsk(opt) {
  const o = opt || {}
  if (!o.installed) return false
  if (o.practicing) return false
  const p = state()
  if (p.state !== 'undecided') return false
  if ((p.askedCount || 0) >= ASK_MAX) return false
  if (p.lastAskAt && Date.now() - p.lastAskAt < ASK_GAP_MS) return false
  return true
}

/** 点了「以后再说」：计数 +1。还能再问，但最多 3 次 */
export function markAsked() {
  const p = state()
  return write({ askedCount: (p.askedCount || 0) + 1, lastAskAt: Date.now() })
}

/** 点了「打通」，或设置页点「关联 / 重新关联」 */
export function link() {
  const p = state()
  return write({ state: 'linked', linkedAt: p.linkedAt || Date.now(), lastAskAt: Date.now() })
}

/**
 * 取消关联 / 明确不开。
 *
 * ⚠️ 落在 declined，不退回 undecided —— 否则下次启动又会重新弹一次首次提示。
 *    用户刚明确取消、转头又被问，是最招人烦的一种设计。
 * ⚠️ 只改意愿，**不碰任何学习数据**：掌握度、错题本、打卡记录是真实发生过的学习，
 *    不能因为用户取消了一个关联就被抹掉。所以这里刻意不引入 store.reset() 之类。
 */
export function unlink() {
  return write({ state: 'declined', lastAskAt: Date.now() })
}

/* ==================== 同步回执 ==================== */

/**
 * 每次把战果送回对面时调用：记下"链路真的通了"的时间。
 * 为什么单记这个：数据流用户看不见，界面上只写"已关联"的话，通道断了也没人发现 ——
 * 他会以为自己今天没背。
 */
export function noteSync(min, words) {
  const patch = { lastSyncAt: Date.now() }
  const w = Math.round(Number(words) || 0)
  if (w > 0) patch.lastWords = w
  return write(patch)
}

/** 今天学会了多少词（store 的 days[].mastered —— 口径与每日目标一致） */
export function todayWords() {
  try {
    const d = store.get().days[usage.dayKey()]
    if (!d) return 0
    const n = Number(d.mastered)
    return Math.round(n > 0 ? n : 0)
  } catch (e) {
    return 0
  }
}

/** 今天在 AWword 里待了多少分钟（usage 按天累计，与统计页同一份数据） */
export function todayMin() {
  try {
    return Math.round(Number(usage.todayMinutes()) || 0)
  } catch (e) {
    return 0
  }
}

/**
 * 上次同步距今多久：{ unit, n }
 * unit = 'never' | 'min' | 'hour' | 'day'，由页面拿去套 $t（文案不写死在这里）。
 */
export function syncAgo() {
  const p = state()
  if (!p.lastSyncAt) return { unit: 'never', n: 0 }
  const min = Math.floor((Date.now() - p.lastSyncAt) / 60000)
  if (min < 1) return { unit: 'min', n: 0 }
  if (min < 60) return { unit: 'min', n: min }
  const h = Math.floor(min / 60)
  if (h < 24) return { unit: 'hour', n: h }
  return { unit: 'day', n: Math.floor(h / 24) }
}

/* ==================== 过去 / 回来 ==================== */

/**
 * 主动唤起 PWstudy（设置页「去 PWstudy」）。
 * 必须是用户点的 —— 自动跳到别的 App 会把人从学习状态里拽出来（文档 11.5）。
 *
 * 先试 launchApplication（按包名起，最稳）；不支持再退回 scheme。
 * 都不行时返回 false，由调用方说一句人话提示。
 */
export function openPartner() {
  const p = partnerOf()
  // #ifdef APP-PLUS
  try {
    if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.launchApplication === 'function') {
      plus.runtime.launchApplication({ pname: p.pkg }, function () {}, function () {})
      return true
    }
  } catch (e) {}
  // #endif
  // #ifdef APP-PLUS
  try {
    if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.openURL === 'function') {
      plus.runtime.openURL(p.scheme + '://')
      return true
    }
  } catch (e) {}
  // #endif
  return false
}
