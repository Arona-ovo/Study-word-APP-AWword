// utils/updater.js - 在线检查更新（GitHub Releases 当静态源）
//
// 版本源：一个**固定 tag** 的 Release（RELEASE_TAG）。每次发版往这个 Release 里换附件，
// App 里的地址不用改。附件按扩展名认，不需要再维护一份 update.json：
//   · *.wgt → 热更包（只换前端资源：JS / 页面 / 样式 / 图片）
//   · *.apk → 整包（动了原生配置或原生资源时用：权限 / 模块 / 图标 / 启动图 / AppID）
// 版本号从**文件名**里抽（AWword-1.2.1.wgt → 1.2.1），与本机版本比较。
//
// ⚠️ 本机版本用 BUILD_INFO.version，不用 plus.runtime.version：
//    plus.runtime.version 是原生 manifest 的版本，wgt 更新后它**不变** ——
//    拿它比会永远提示有更新；而且小程序端它返回的是宿主版本（如 8.0.5），早就不许读了。
//    BUILD_INFO.version 在前端资源里，wgt 装完就跟着变成新的，用它才是自洽的。
//
// ⚠️ 基座约束（docs/app-update.md 里那条 minApkVersionCode）：
//    wgt 只能换前端，换不了原生。所以**凡发 wgt 的改动都不许涉及原生**；
//    一旦动了原生，必须发 APK 并把这个 tag 下的 wgt 附件删掉 ——
//    否则老基座装上不兼容的资源包会白屏。这是运维约定，代码挡不住，写在这里提醒。
//
// 静默自检：启动后台查一次，只在**真有更新**时留个角标，不弹窗不打断；
// 手动检查（设置页）才给结果反馈。两者共用同一份 check()。
import * as settings from './settings.js'
import { BUILD_INFO } from '../data/build-info.js'

const REPO = 'Arona-ovo/Study-word-APP-AWword'
export const RELEASE_TAG = 'AWword-APP'
/** 给用户看的发布页（手动下载 / 看看更新了什么） */
export const RELEASE_PAGE = 'https://github.com/' + REPO + '/releases/tag/' + RELEASE_TAG
/** 版本接口：按 tag 取那一个 Release（含附件直链） */
const API = 'https://api.github.com/repos/' + REPO + '/releases/tags/' + RELEASE_TAG

const REQ_TIMEOUT = 8000
// 自动检查的间隔：启动就查太勤既费流量又可能撞 GitHub 的频率限制（未认证 60 次/小时/IP）
const CHECK_GAP_MS = 12 * 3600 * 1000

// 最近一次检查结果（模块级：设置页 onShow 读它决定要不要显示"有新版本"角标）。
// 跨页状态存模块级是本项目约定（tab 页常驻，别指望页面 data 活着）。
let latest = null

/** 本机（前端资源）版本 */
export function localVersion() {
  return String((BUILD_INFO && BUILD_INFO.version) || '').trim()
}

/**
 * 从文件名里抽版本号：AWword-1.2.1.wgt → [1, 2, 1]。
 * 抽不到返回 null —— 那种附件直接忽略（不能拿没有版本的东西去比大小）。
 */
export function parseVersion(s) {
  const m = String(s || '').match(/(\d+(?:\.\d+)+)/)
  if (!m) return null
  return m[1].split('.').map((n) => Number(n) || 0)
}

/** 语义化比较：a > b → 1，相等 → 0，a < b → -1（位数不等时缺位补 0） */
export function cmpVersion(a, b) {
  const x = a || []
  const y = b || []
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const p = x[i] || 0
    const q = y[i] || 0
    if (p > q) return 1
    if (p < q) return -1
  }
  return 0
}

/** 一次网络请求（包一层 Promise，失败要能被 catch 到，不能把异常漏到调用方） */
function getJson(url) {
  return new Promise((resolve, reject) => {
    try {
      uni.request({
        url: url,
        method: 'GET',
        timeout: REQ_TIMEOUT,
        header: { Accept: 'application/vnd.github+json' },
        success: (res) => {
          const code = res && res.statusCode
          if (code && code >= 400) { reject(new Error('HTTP ' + code)); return }
          resolve(res && res.data)
        },
        fail: (e) => reject(e || new Error('network'))
      })
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * 检查有没有新版本。
 * 返回 { kind, version, url, name }：
 *   kind = 'apk'  → 有新整包（优先：整包最彻底，且 wgt 装不上老基座时能兜底）
 *   kind = 'wgt'  → 有热更包
 *   kind = 'none' → 已是最新（或远端没有能认出来的附件）
 * 失败一律 throw，由调用方决定"静默"还是"提示"。
 */
export async function check() {
  const rel = await getJson(API)
  const list = (rel && rel.assets) || []
  const cur = parseVersion(localVersion())
  if (!cur) { latest = { kind: 'none' }; return latest }

  const pick = (re) => {
    for (let i = 0; i < list.length; i++) {
      const a = list[i] || {}
      const name = String(a.name || '')
      if (!re.test(name)) continue
      const v = parseVersion(name)
      if (!v) continue
      const url = String(a.browser_download_url || '')
      if (!url) continue
      return { version: v, url: url, name: name }
    }
    return null
  }

  const apk = pick(/\.apk$/i)
  if (apk && cmpVersion(apk.version, cur) > 0) {
    latest = { kind: 'apk', version: apk.version, url: apk.url, name: apk.name }
    noteUpdate(latest)
    return latest
  }
  const wgt = pick(/\.wgt$/i)
  if (wgt && cmpVersion(wgt.version, cur) > 0) {
    latest = { kind: 'wgt', version: wgt.version, url: wgt.url, name: wgt.name }
    noteUpdate(latest)
    return latest
  }
  latest = { kind: 'none' }
  return latest
}

/** 自动自检的结果（页面 onShow 拿来显示角标）；没查过就是 null */
export function peek() {
  return latest
}

/** 自检的节流：一天最多查两次，且"用户跳过过的那个版本"不再重复提示 */
export function shouldAutoCheck() {
  try {
    const u = (settings.get() || {}).updater || {}
    if (u.lastCheckAt && Date.now() - u.lastCheckAt < CHECK_GAP_MS) return false
    if (latest && latest.kind !== 'none') {
      const v = (latest.version || []).join('.')
      if (v && v === String(u.skip || '')) return false
    }
    return true
  } catch (e) {
    return false
  }
}

export function noteChecked() {
  try { settings.set({ updater: { lastCheckAt: Date.now() } }) } catch (e) {}
}

/** 用户点了"以后再说"：这个版本本次不再提示（下次发新版本还是会提示） */
export function skipThis() {
  try {
    const v = latest && latest.version ? latest.version.join('.') : ''
    settings.set({ updater: { skip: v } })
    // 红点也一起收掉 —— "以后再说"的意思就是这个版本别再在我眼前晃
    if (!v || v === pendingVersion()) clearPending()
  } catch (e) {}
}

// ---------- 待更新标记（首页弹窗 / 「我的 → 设置」红点用它）----------
//
// 为什么不直接用模块级的 latest：它是内存变量，App 一重启就没了。
// 自检有 12 小时节流，重启后那段时间根本不会发请求，红点会莫名其妙消失。
// 所以要落到 storage，让"有新版本"这件事**跨进程、跨天**地留着。
//
// ⚠️ 存 JSON 字符串而不是对象：settings.set() 是**深合并**（项目约定 14），
// 存对象的话清不掉（写 null 会被合并忽略）。字符串是整体覆盖，干净。

/** 记一笔"发现新版本" */
export function noteUpdate(r) {
  try {
    const v = r && r.version ? r.version.join('.') : ''
    if (!v) return
    settings.set({
      updater: { pending: JSON.stringify({ v: v, kind: String(r.kind || ''), url: String(r.url || '') }) }
    })
  } catch (e) {}
}

export function clearPending() {
  try { settings.set({ updater: { pending: '' } }) } catch (e) {}
}

/** 解析待更新标记（坏数据当没有） */
function pendingRaw() {
  try {
    const u = (settings.get() || {}).updater || {}
    const s = String(u.pending || '')
    if (!s) return null
    const o = JSON.parse(s)
    if (!o || !o.v) return null
    // 用户点过"不再提示"的版本 → 不再算待更新
    if (String(o.v) === String(u.skip || '')) return null
    return o
  } catch (e) {
    return null
  }
}

function pendingVersion() {
  const o = pendingRaw()
  return o ? String(o.v) : ''
}

/**
 * 有没有"该提示用户"的待更新版本。
 * ⚠️ 这里要重新比一次版本号：装上新版本之后，标记里那个版本号就不再比本机新了，
 * 红点会自动消失 —— 不用在装完后手动清（那一步很容易漏，漏了就是永远摘不掉的红点）。
 */
export function hasPending() {
  try {
    const o = pendingRaw()
    if (!o) return false
    const cur = parseVersion(localVersion())
    if (!cur) return false
    const v = parseVersion(String(o.v))
    return !!v && cmpVersion(v, cur) > 0
  } catch (e) {
    return false
  }
}

/** 待更新的详情（弹窗要点"更新"时得知道是热更还是整包、链接是什么） */
export function pendingInfo() {
  const o = pendingRaw()
  if (!o) return null
  return {
    version: parseVersion(String(o.v)) || [],
    versionText: String(o.v),
    kind: String(o.kind || ''),
    url: String(o.url || '')
  }
}

/**
 * 启动时的静默自检：失败一律静默（网络不通 / GitHub 抽风都不该打扰用户），
 * 只在真有更新时把结果留在 latest 里，等设置页去读。
 */
export async function autoCheck() {
  if (!shouldAutoCheck()) return null
  try {
    const r = await check()
    noteChecked()
    return r
  } catch (e) {
    return null
  }
}

/**
 * 安装热更包：下载 → install → 重启。
 * 只走 App 端（plus）；H5 / 小程序装不了 wgt，直接告诉调用方不支持。
 */
export function installWgt(url) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.runtime || !plus.runtime.install) {
      reject(new Error('not-app'))
      return
    }
    uni.downloadFile({
      url: url,
      success: (res) => {
        if (!res || res.statusCode !== 200) { reject(new Error('download')); return }
        plus.runtime.install(res.tempFilePath, { force: true }, () => {
          // 装完必须重启才生效（uni-app 的 wgt 更新规矩）
          clearPending()
          try { plus.runtime.restart() } catch (e) {}
          resolve(true)
        }, (e) => reject(e || new Error('install')))
      },
      fail: (e) => reject(e || new Error('download'))
    })
  })
}

/**
 * 打开发布页（手动下载整包 / 看看更新了什么）。
 * App 端走系统浏览器；H5 走 window.open；小程序打不开外链 → 复制链接（总有出路）。
 * 返回 'opened' / 'copied' / 'failed'，调用方按它给不同的提示。
 */
export function openReleasePage() {
  try {
    if (typeof plus !== 'undefined' && plus.runtime && plus.runtime.openURL) {
      plus.runtime.openURL(RELEASE_PAGE)
      return 'opened'
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.open) {
      window.open(RELEASE_PAGE, '_blank')
      return 'opened'
    }
  } catch (e) {}
  try {
    uni.setClipboardData({ data: RELEASE_PAGE })
    return 'copied'
  } catch (e) {}
  return 'failed'
}
