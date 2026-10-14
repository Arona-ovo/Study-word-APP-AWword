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
//
// 预下载：连着 WiFi 时先把包偷偷下好存着，用户点「更新」时一步装完（见下面
// 「预下载」那一节）。手机上 GitHub 附件的 CDN 在移动网下经常慢到十几秒才出首字节，
// 但 WiFi 下其实很快 —— 所以把"下载"这件慢事挪到 WiFi 时做，是性价比最高的提速。
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
    // 换新版本了 → 上一版预下载好的包作废（不删就一直占着十几 MB，而且版本对不上也用不了）
    const old = stagedRaw()
    if (old && String(old.v) !== v) clearStaged()
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

/**
 * 待更新的详情（弹窗要点"更新"时得知道是热更还是整包、链接是什么）。
 * staged = 这个版本已经趁 WiFi 下好了 → 点「更新」直接装本地包，不用再等下载。
 */
export function pendingInfo() {
  const o = pendingRaw()
  if (!o) return null
  return {
    version: parseVersion(String(o.v)) || [],
    versionText: String(o.v),
    kind: String(o.kind || ''),
    url: String(o.url || ''),
    staged: !!stagedPath()
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
    // 有更新就趁 WiFi 把包先下好。⚠️ 不 await：下载是慢活，不能拖住启动。
    // 失败也无所谓（prefetch 自己吞掉异常），用户点「更新」时还有在线那条路。
    watchWifi()
    try { prefetch() } catch (e) {}
    return r
  } catch (e) {
    return null
  }
}

// ---------- 预下载：趁 WiFi 把包装好，用户点「更新」时一步装完 ----------
//
// 为什么值得做：手机在移动网下取 GitHub 附件经常十几秒才出首字节，同一个包在 WiFi 下
// 却几秒就完。把"下载"这件慢事挪到连 WiFi 时偷偷做完，用户点「更新」就只剩 install
// 一步 —— 体感从"干等一分钟"变成"一秒装完"。
//
// 四条硬规矩，违反任何一条都是事故：
//   1. 只在 WiFi 下动流量。拿不到网络类型一律按"不是 WiFi"处理 —— 宁可不下，不能偷跑。
//   2. 只下不装。自动重启是打断，绝不在用户不知情时干。
//   3. 存下来的包必须能扔：版本变了、装完了就删，不能悄悄吃掉用户十几 MB 存储。
//   4. 本地包装不上（文件被系统清了 / 没装未知应用的权限）要能退回在线那条老路，
//      不能把用户卡在"更新中"。

/** 下载超时：弱网下不给超时就会永远转圈（原来的下载连超时都没有） */
const DL_TIMEOUT = 60000

/**
 * 当前网络类型：'wifi' / 'cellular' / 'none' / 'unknown'。
 * ⚠️ 拿不到（接口不在 / 回调没来）按 'unknown' —— 那不是 WiFi，不许下。
 */
export function netType() {
  return new Promise((resolve) => {
    let settled = false
    const done = (t) => { if (!settled) { settled = true; resolve(t) } }
    try {
      uni.getNetworkType({
        success: (r) => {
          const t = String((r && r.networkType) || '')
          done(t === 'wifi' ? 'wifi' : (t === 'none' ? 'none' : 'cellular'))
        },
        fail: () => done('unknown')
      })
      return
    } catch (e) {}
    // uni 那条路走不通时退到 App 端的原生接口（同步，拿不到常数就算了）
    try {
      if (typeof plus !== 'undefined' && plus.networkinfo) {
        const t = plus.networkinfo.getCurrentType()
        done(t === plus.networkinfo.CONNECTION_WIFI ? 'wifi'
          : (t === plus.networkinfo.CONNECTION_NONE ? 'none' : 'cellular'))
        return
      }
    } catch (e) {}
    done('unknown')
  })
}

function stagedRaw() {
  try {
    const u = (settings.get() || {}).updater || {}
    const s = String(u.staged || '')
    if (!s) return null
    const o = JSON.parse(s)
    return o && o.v && o.path ? o : null
  } catch (e) {
    return null
  }
}

/**
 * 已经下好、可以拿来装的本地包路径；没有就返回空串。
 * ⚠️ 必须版本号对得上才算 —— 上一版留下的包对新版本没用，拿去装会装错版本。
 */
export function stagedPath() {
  const o = stagedRaw()
  if (!o) return ''
  const pen = pendingRaw()
  if (!pen || String(pen.v) !== String(o.v)) return ''
  return String(o.path)
}

/** 下载到临时文件（带超时；有进度回调就顺便报百分比） */
function downloadTo(url, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const task = uni.downloadFile({
        url: url,
        timeout: DL_TIMEOUT,
        success: (res) => {
          if (!res || res.statusCode !== 200 || !res.tempFilePath) { reject(new Error('download')); return }
          resolve(res.tempFilePath)
        },
        fail: (e) => reject(e || new Error('download'))
      })
      // 进度回调挂在返回的任务上（不在 options 里）；拿不到任务就算了，不影响下载本身
      try {
        if (task && task.onProgressUpdate && onProgress) {
          task.onProgressUpdate((r) => {
            if (r && r.totalBytesExpectedToWrite > 0) {
              onProgress(Math.floor(r.totalBytesWritten * 100 / r.totalBytesExpectedToWrite))
            }
          })
        }
      } catch (e) {}
    } catch (e) {
      reject(e || new Error('download'))
    }
  })
}

/** 把临时文件存成持久文件（tempFilePath 重启后可能被清，必须另存） */
function persist(tmp) {
  return new Promise((resolve, reject) => {
    try {
      uni.saveFile({
        tempFilePath: tmp,
        success: (r) => {
          const p = String((r && r.savedFilePath) || '')
          if (p) resolve(p)
          else reject(new Error('save'))
        },
        fail: (e) => reject(e || new Error('save'))
      })
    } catch (e) {
      reject(e || new Error('save'))
    }
  })
}

/**
 * 后台预下载：把待更新的那个包下好存着，不装。
 * 返回 'ok'（下好了）/ 'already'（这个版本早下过了）/ 'no-wifi'（不是 WiFi，不动流量）
 * / null（失败）。⚠️ 失败一律静默 —— 预下载是锦上添花，它失败不该打扰任何人，
 * 用户点「更新」时还有在线下载那条路。
 */
export async function prefetch() {
  try {
    const o = pendingRaw()
    if (!o || !o.v || !o.url) return null
    if (stagedPath()) return 'already'
    if ((await netType()) !== 'wifi') return 'no-wifi'
    const tmp = await downloadTo(String(o.url))
    const p = await persist(tmp)
    settings.set({
      updater: { staged: JSON.stringify({ v: String(o.v), kind: String(o.kind || ''), path: p, at: Date.now() }) }
    })
    return 'ok'
  } catch (e) {
    return null
  }
}

/**
 * 扔掉存下来的包。⚠️ 文件与记账要一起清，只清记账会留下一坨没人认的十几 MB。
 */
export function clearStaged() {
  try {
    const o = stagedRaw()
    if (o && o.path) {
      try { uni.removeSavedFile({ filePath: String(o.path) }) } catch (e) {}
    }
  } catch (e) {}
  try { settings.set({ updater: { staged: '' } }) } catch (e) {}
}

/** 装已经下好的本地包（wgt 与 apk 都走这里） */
export function installLocal(path, kind) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.runtime || !plus.runtime.install) {
      reject(new Error('not-app'))
      return
    }
    plus.runtime.install(String(path), { force: true }, () => {
      clearPending()
      if (kind === 'apk') {
        // 整包：系统安装器会接手，这时候重启纯属捣乱；本地文件也不能删 ——
        // 安装器还在读它，删了就装一半。等下次换版本时由 noteUpdate 顺手清掉。
        resolve(true)
        return
      }
      clearStaged()
      // 装完必须重启才生效（uni-app 的 wgt 更新规矩）
      try { plus.runtime.restart() } catch (e) {}
      resolve(true)
    }, (e) => reject(e || new Error('install')))
  })
}

/**
 * 更新入口：优先装已经下好的本地包（秒装）；没下过才现下。
 *
 * ⚠️ 现下的那条路**必须先过 WiFi 这道门**：拿不到"是 WiFi"就抛 'need-wifi'，
 *    一个字节都不下。手机在移动网下取 GitHub 附件经常十几秒才出首字节，16MB 的
 *    整包更是能拖到用户以为 App 死了 —— 那种体验不如直接告诉他"连上 WiFi 就好"。
 *    （包已经在 WiFi 下预下载好的情况不走这道门：装本地包不耗流量。）
 *
 * 可能的失败原因，调用方按它决定给什么提示：
 *   'no-pending'     没有待更新版本
 *   'need-wifi'      不是 WiFi，不能下（提示用户连 WiFi，连上会自动下好）
 *   'need-download'  整包，且在 WiFi 下但没预下载好 → 交给浏览器，App 内不静默拉
 */
export async function install(onProgress) {
  const o = pendingRaw()
  if (!o) throw new Error('no-pending')
  const kind = String(o.kind || '')
  const url = String(o.url || '')

  /** 在线下载：先过 WiFi 门，再下。本地包那条路不经过这里。 */
  const online = async () => {
    if ((await netType()) !== 'wifi') throw new Error('need-wifi')
    return installWgt(url, onProgress)
  }

  const local = stagedPath()
  if (local) {
    return installLocal(local, kind).catch((e) => {
      // 本地包装不上（文件被系统清了 / 没装未知应用的权限）→ 退回在线那条老路，
      // 不能把用户卡在"更新中"。整包没有"在线装"这条路（合规 + 老基座风险），
      // 只能把错误抛回去，让调用方带用户去浏览器下。
      if (kind === 'apk') throw e
      clearStaged()
      return online()
    })
  }
  // 没预下载好 → 要真下流量。整包十几 MB，移动网下更不该拉，所以 apk 同样先过门。
  if (kind === 'apk') {
    if ((await netType()) !== 'wifi') throw new Error('need-wifi')
    throw new Error('need-download')
  }
  return online()
}

let watching = false
/**
 * 监听网络变化：一接上 WiFi 就把待更新的包补下好。
 * （自检那次只在启动时跑一次，用户是回家才连上 WiFi 的话就靠这个补。）
 *
 * ⚠️ 挂上的那一刻还要**自己先下一次**：回调只在网络"发生变化"时才来，
 *    而"上次开 App 是移动网、这次一开就已经连着 WiFi"根本不产生变化事件 ——
 *    那种情况下只挂回调的话，包永远等不到（用户明明在 WiFi 下却一直没预下载）。
 *    prefetch 自己是幂等的（已下过返回 'already'、没待更新返回 null），多调无害。
 */
export function watchWifi() {
  if (watching) return
  watching = true
  try {
    uni.onNetworkStatusChange((r) => {
      try {
        if (!r || !r.isConnected || String(r.networkType || '') !== 'wifi') return
        prefetch()
      } catch (e) {}
    })
  } catch (e) {}
  try { prefetch() } catch (e) {}
}

/**
 * 安装热更包：下载 → install → 重启。
 * 只走 App 端（plus）；H5 / 小程序装不了 wgt，直接告诉调用方不支持。
 */
export function installWgt(url, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.runtime || !plus.runtime.install) {
      reject(new Error('not-app'))
      return
    }
    downloadTo(url, onProgress).then((tmp) => {
      plus.runtime.install(tmp, { force: true }, () => {
        // 装完必须重启才生效（uni-app 的 wgt 更新规矩）
        clearPending()
        try { plus.runtime.restart() } catch (e) {}
        resolve(true)
      }, (e) => reject(e || new Error('install')))
    }).catch((e) => reject(e || new Error('download')))
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
