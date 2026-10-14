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
// 静默自检：启动后台查一次，查到新版本也不立刻吭声 —— 先把包悄悄下好、验好，
// **只有校验通过**才允许留角标（见下面「静默下载 + 校准」那一节）。
// 手动检查（设置页）才给结果反馈。两者共用同一份 check()。
//
// 静默下载：WiFi 与移动数据都下，全程不弹窗、不显示进度、不亮红点。
// 目的是让用户永远不必"等下载" —— 红点亮起的时候，包已经在本地躺着了，
// 点一下就装完。反过来，没下好 / 校验没过就一律不提示，
// 否则等于把用户引向一次注定失败的点击。
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

  // size 是 GitHub 给的附件字节数 —— 下载完要拿它做完整性校验的第一道关
  // （见「静默下载」那一节）。拿不到就记 0，那一条校验自动跳过。
  const pick = (re) => {
    for (let i = 0; i < list.length; i++) {
      const a = list[i] || {}
      const name = String(a.name || '')
      if (!re.test(name)) continue
      const v = parseVersion(name)
      if (!v) continue
      const url = String(a.browser_download_url || '')
      if (!url) continue
      return { version: v, url: url, name: name, size: Number(a.size) || 0 }
    }
    return null
  }

  const apk = pick(/\.apk$/i)
  if (apk && cmpVersion(apk.version, cur) > 0) {
    latest = { kind: 'apk', version: apk.version, url: apk.url, name: apk.name, size: apk.size }
    noteUpdate(latest)
    return latest
  }
  const wgt = pick(/\.wgt$/i)
  if (wgt && cmpVersion(wgt.version, cur) > 0) {
    latest = { kind: 'wgt', version: wgt.version, url: wgt.url, name: wgt.name, size: wgt.size }
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
    // 换新版本了 → 上一版下好的包立刻作废并删掉
    // （不删就一直占着十几 MB，而且版本对不上也用不了，还会被误当成"已就绪"）
    const d = dlRaw()
    if (d && String(d.v) !== v) dropDl()
    settings.set({
      updater: {
        pending: JSON.stringify({
          v: v,
          kind: String(r.kind || ''),
          url: String(r.url || ''),
          size: Number(r.size) || 0
        })
      }
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
 *
 * 三条全中才算数，缺一条就不亮红点、不弹窗：
 *   ① 远端真有新版本（重新比一次版本号 —— 装完后它自动不再比本机新，
 *      红点自己消失，不用在装完时手动清，那一步最容易漏，漏了就是永远摘不掉的红点）
 *   ② 这个版本的包**已经下载完**
 *   ③ 且**通过了完整性校验**（大小对得上、zip 结构没被截断）
 *
 * ②③ 是 2026-10-14 定的规矩：下载中 / 下载失败 / 校验不过，用户一律看不到任何提示。
 * 否则会出现"红点亮了，点进去还要等十几秒甚至失败"—— 那比没有红点更糟。
 */
export function hasPending() {
  try {
    const o = pendingRaw()
    if (!o) return false
    const cur = parseVersion(localVersion())
    if (!cur) return false
    const v = parseVersion(String(o.v))
    if (!v || cmpVersion(v, cur) <= 0) return false
    return isReady(String(o.v))
  } catch (e) {
    return false
  }
}

/**
 * 待更新的详情（弹窗要点"更新"时得知道是热更还是整包、链接是什么）。
 * staged / ready = 这个版本的包已经下好并通过校验 → 点「更新」直接装本地包，不用再等。
 * size = 远端给的字节数（校验用）。
 */
export function pendingInfo() {
  const o = pendingRaw()
  if (!o) return null
  const ready = isReady(String(o.v))
  return {
    version: parseVersion(String(o.v)) || [],
    versionText: String(o.v),
    kind: String(o.kind || ''),
    url: String(o.url || ''),
    size: Number(o.size) || 0,
    staged: ready,
    ready: ready
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
    // 查到新版本就顺手把包静默下好。⚠️ 不 await：下载是慢活，不能拖住启动。
    // 失败也无所谓 —— ensure() 自己吞掉异常，而且没下好之前本来就不显示任何提示。
    try { ensure() } catch (e) {}
    return r
  } catch (e) {
    return null
  }
}

// ---------- 静默下载 + 校准（APK 与 WGT 共用同一套） ----------
//
// 目标：用户永远不必"等下载"。远端一有新版本，包就在后台悄悄下好、验好，
// 只有**校验通过**之后，红点与弹窗才被允许出现。下载中 / 下载失败 / 校验不过
// 一律静默 —— 在那三态下给用户提示，等于把他引向一次注定失败的点击。
//
// 状态机（持久化在 settings.updater.dl，JSON 字符串，跨进程存活）：
//   idle → downloading → done（大小 + 结构都验过）| failed
// 单一实例由两层保证：进程内靠模块级的 dlTask（同一个包只可能有一个 Promise 在跑），
// 跨进程靠持久化的 state（重启后看到 downloading 就知道上次没走完，重新校准）。
//
// 四条硬规矩：
//   1. 只下不装。自动重启是打断，绝不在用户不知情时干。
//   2. 全局同一时间只有一个下载任务；正在下的那个包不得被重复触发。
//   3. 已存在"版本对得上 + 校验通过"的包 → 直接复用，一个字节都不重下。
//   4. 下出来的东西必须能扔：换版本、装完、校验不过都要删干净，
//      不能悄悄吃掉用户十几 MB 存储，也不能留一堆残包 / 临时文件。

/** 下载超时：弱网下不给超时就会永远转圈（原来的下载连超时都没有） */
const DL_TIMEOUT = 60000
/** 卡死判定：downloading 停留超过这么久 → 认为进程被杀了，下次进来重新校准 */
const DL_STALE_MS = 5 * 60 * 1000
/** 校验 zip 结尾时读多少尾部字节（EOCD 本身 22 字节，注释最多 65535） */
const TAIL_BYTES = 65557

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

// ---------- 下载状态：持久化在 settings.updater.dl ----------
//
// ⚠️ 存 JSON 字符串而不是对象：settings.set() 是**深合并**（项目约定 14），
// 存对象的话清不掉（写 null 会被合并忽略）。字符串是整体覆盖，干净。

function dlRaw() {
  try {
    const u = (settings.get() || {}).updater || {}
    const s = String(u.dl || '')
    if (!s) return null
    const o = JSON.parse(s)
    return o && o.v ? o : null
  } catch (e) {
    return null
  }
}

function setDl(o) {
  try { settings.set({ updater: { dl: o ? JSON.stringify(o) : '' } }) } catch (e) {}
}

/** 卡在 downloading 够久了 → 多半是上次进程被杀，状态是脏的，得重新校准 */
function isStale(d) {
  return !!d && d.state === 'downloading' && (Date.now() - (Number(d.at) || 0)) > DL_STALE_MS
}

/**
 * 这个版本的包是不是已经**下好且验过**。
 * ⚠️ 只认 state === 'done' —— done 是校验通过之后才写进去的（见 verifyFile）。
 *    光有 path 不算数：那样残缺包会被当成"已就绪"，用户一点就装崩。
 */
export function isReady(v) {
  const d = dlRaw()
  if (!d || d.state !== 'done' || !d.path) return false
  const want = v || (pendingRaw() ? String(pendingRaw().v) : '')
  return !!want && String(d.v) === String(want)
}

/**
 * 已就绪的本地包路径；没有就返回空串。
 * ⚠️ 必须版本号对得上才算 —— 上一版留下的包对新版本没用，拿去装会装错版本。
 */
export function stagedPath() {
  if (!isReady('')) return ''
  const d = dlRaw()
  return d ? String(d.path) : ''
}

/** 删文件：savedFile 那条路删不掉临时文件，两种都要试 */
function removeFile(p) {
  const path = String(p || '')
  if (!path) return
  try { uni.removeSavedFile({ filePath: path }) } catch (e) {}
  try {
    if (typeof plus !== 'undefined' && plus.io) {
      plus.io.resolveLocalFileSystemURL(path, (e) => {
        try { e.remove(function () {}, function () {}) } catch (x) {}
      }, function () {})
    }
  } catch (e) {}
}

/** 连文件带记账一起扔掉（只清记账会留下一坨没人认的文件） */
export function dropDl() {
  const d = dlRaw()
  if (d) {
    if (d.path) removeFile(String(d.path))
    if (d.tmp && String(d.tmp) !== String(d.path)) removeFile(String(d.tmp))
  }
  setDl(null)
}

/** 旧名兼容：清掉已下好的包 */
export function clearStaged() {
  dropDl()
}

// ---------- 完整性校验 ----------
//
// 两道关，都过了才算"这个包能用"：
//   ① 大小：和 Release 接口给的 size 对得上（GitHub 每个附件都带，零成本）
//   ② 结构：文件尾部能找到 zip 的结尾标记 PK\x05\x06 —— wgt 和 apk 都是 zip，
//      被截断的包没有这个标记，一眼挡住
// 只比大小是不够的：一个被截成同样长度的坏包照样能过，装的时候才炸。

/** zip 结尾标记（EOCD） */
const EOCD = '\x50\x4B\x05\x06'

/** 读文件大小 + 尾部文本；读不到就给 size=0 / tail=''（调用方按"拿不到信息"处理） */
function statFile(path) {
  return new Promise((resolve) => {
    let done = false
    const fin = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      if (typeof plus === 'undefined' || !plus.io) { fin({ size: 0, tail: '' }); return }
      plus.io.resolveLocalFileSystemURL(String(path), (entry) => {
        entry.file((file) => {
          const size = Number(file && file.size) || 0
          if (!size) { fin({ size: 0, tail: '' }); return }
          const start = Math.max(0, size - TAIL_BYTES)
          try {
            const r = new plus.io.FileReader()
            r.onloadend = (e) => fin({ size: size, tail: String((e && e.target && e.target.result) || '') })
            r.onerror = () => fin({ size: size, tail: '' })
            r.readAsText(file.slice(start, size))
          } catch (e) { fin({ size: size, tail: '' }) }
        }, () => fin({ size: 0, tail: '' }))
      }, () => fin({ size: 0, tail: '' }))
    } catch (e) {
      fin({ size: 0, tail: '' })
    }
  })
}

/**
 * 校验一个本地包。返回 { ok, size, reason }。
 * reason: 'ok' 通过 / 'size' 大小不符 / 'zip' 结构不像完整 zip /
 *         'missing' 文件不在了 / 'io' 读不出来 / 'skip' 拿不到信息，按通过放行的
 *
 * ⚠️ 读不到文件内容（H5 / 小程序 / 接口不在）时按**通过**处理：
 *    不能因为读不了文件就永远不给更新 —— 那时"文件确实存在 + 大小对得上"
 *    已经能挡住绝大多数残缺包了。
 */
export function verifyFile(path, wantSize) {
  const want = Number(wantSize) || 0
  return statFile(path).then((info) => {
    if (info.size <= 0) return { ok: false, size: 0, reason: 'missing' }
    if (want > 0 && info.size !== want) return { ok: false, size: info.size, reason: 'size' }
    if (!info.tail) return { ok: true, size: info.size, reason: 'skip' }
    if (info.tail.indexOf(EOCD) >= 0) return { ok: true, size: info.size, reason: 'ok' }
    return { ok: false, size: info.size, reason: 'zip' }
  }).catch(() => ({ ok: false, size: 0, reason: 'io' }))
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

// ---------- 单一实例 ----------
// 进程内靠这两个模块级变量：dlTask 是唯一在跑的下载 Promise，dlKey 记它属于哪个包。
// 同一个包被反复触发（启动自检 + 网络回调 + 设置页进来）时，所有人拿到的是同一个
// Promise —— 不可能出现两个下载任务同时写一个文件的情况。
let dlTask = null
let dlKey = ''

/**
 * 静默下载的唯一入口。**APK 与 WGT 共用这一套**，差别只在 kind 影响文件名与安装方式。
 *
 * 返回：
 *   'ready'      本地已经有这个版本、且校验通过的包 → 直接复用，一个字节都没下
 *   'ok'         这次下好了并通过校验
 *   'running'    同一个包正在下，复用的是那个任务（没有重复触发）
 *   'bad'        下完了但校验没过（大小不符 / 结构残缺）→ 已丢弃，不提示
 *   'fail'       没下成（网络 / 落盘失败）
 *   'offline'    确定没网，这次不动
 *   'no-pending' 没有待更新版本
 *   null         异常（同样静默）
 *
 * ⚠️ 一律静默：这里失败不抛、不弹窗、不亮红点 —— 没下好之前用户本来就不该看到任何东西。
 */
export function ensure() {
  try {
    const o = pendingRaw()
    if (!o || !o.v || !o.url) return Promise.resolve('no-pending')
    const key = String(o.v) + '|' + String(o.kind || '')
    // 同一个包正在下 → 复用那个 Promise，绝不再起第二个下载
    if (dlTask && dlKey === key) {
      return dlTask.then(() => 'running', () => 'running')
    }
    dlKey = key
    dlTask = runDl(o)
    const clear = () => { if (dlKey === key) dlTask = null }
    dlTask.then(clear, clear)
    return dlTask
  } catch (e) {
    return Promise.resolve(null)
  }
}

function runDl(o) {
  const v = String(o.v)
  const kind = String(o.kind || '')
  return netType().then((net) => {
    if (net === 'none') return 'offline'
    const d = dlRaw()
    // ① 这个版本已经下好过 → 重新校验一次再用（文件可能早被系统清掉了）
    if (d && String(d.v) === v && d.state === 'done' && d.path) {
      return verifyFile(String(d.path), o.size).then((r) => {
        if (r.ok) return 'ready'
        // 校验不过 → 连文件带记账一起扔，重新下
        dropDl()
        return downloadOnce(o, v, kind)
      })
    }
    // ② 换版本了 / 上次失败 / 上次卡死 → 先清掉残留，再从头下
    //    （卡死 = state 停在 downloading 超过阈值，说明进程被杀了，那份记账是脏的）
    if (d && (String(d.v) !== v || d.state !== 'downloading' || isStale(d))) dropDl()
    return downloadOnce(o, v, kind)
  }).catch(() => null)
}

function downloadOnce(o, v, kind) {
  setDl({ v: v, kind: kind, state: 'downloading', at: Date.now() })
  return downloadTo(String(o.url)).then((tmp) => {
    const keep = { v: v, kind: kind, at: Date.now(), tmp: tmp }
    return verifyFile(tmp, o.size).then((r) => {
      if (!r.ok) {
        // 下完了却是个坏包 → 扔掉，记 failed。用户什么都看不到，下次再校准时会重下。
        setDl(Object.assign(keep, { state: 'failed' }))
        removeFile(tmp)
        return 'bad'
      }
      return persist(tmp).then((p) => {
        removeFile(tmp)   // 临时文件不删会攒出一堆没人认的十几 MB
        setDl({ v: v, kind: kind, state: 'done', path: p, size: r.size, at: Date.now() })
        return 'ok'
      }).catch(() => {
        setDl(Object.assign(keep, { state: 'failed' }))
        removeFile(tmp)
        return 'fail'
      })
    })
  }).catch(() => {
    setDl({ v: v, kind: kind, state: 'failed', at: Date.now() })
    return 'fail'
  })
}

/** 旧名兼容：以前叫"预下载"，现在就是这一个静默下载入口 */
export function prefetch() {
  return ensure()
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
 * 更新入口：装**已经下好并通过校验**的本地包（秒装，不耗流量）。
 *
 * 正常流程里，红点只在包就绪之后才亮，所以走到这儿理应已经有包了。
 * 没有的话就先静默补一次（兜底：用户可能是从别处点进来的），补不出来就明确报错，
 * 让调用方决定给什么提示 —— 绝不把一个没验过的包交给安装器。
 *
 * 可能的失败原因：
 *   'no-pending'   没有待更新版本
 *   'bad-package'   下完了但校验没过（残缺包）
 *   'offline'       没网，下不到
 *   'not-ready'     其他原因没拿到可用的包
 */
export async function install(onProgress) {
  const o = pendingRaw()
  if (!o) throw new Error('no-pending')
  const kind = String(o.kind || '')
  let p = stagedPath()
  if (!p) {
    const r = await ensure()
    p = stagedPath()
    if (!p) {
      throw new Error(r === 'bad' ? 'bad-package' : (r === 'offline' ? 'offline' : 'not-ready'))
    }
  }
  return installLocal(p, kind).catch((e) => {
    // 本地包装不上（文件被系统清了 / 没装未知应用的权限）→ 记账作废，退回在线装一次，
    // 不能把用户卡在"更新中"。整包没有"在线装"这条路（合规 + 老基座风险），
    // 只能把错误抛回去，让调用方带用户去浏览器下。
    if (kind === 'apk') throw e
    dropDl()
    return installWgt(String(o.url), onProgress)
  })
}

let watching = false
/**
 * 监听网络变化：一有网就把待更新的包补下好。**WiFi 和移动数据都下** ——
 * 静默下载的目的就是让用户永远不用等，管用户在什么网下。
 *
 * ⚠️ 挂上的那一刻还要**自己先下一次**：回调只在网络"发生变化"时才来，
 *    而"上次开 App 没网、这次一开就有网"压根不产生变化事件 ——
 *    那种情况下只挂回调的话，包永远等不到。
 *    ensure() 是幂等的（已下好返回 'ready'、正在下返回 'running'），多调无害。
 */
export function watchNetwork() {
  if (watching) return
  watching = true
  try {
    uni.onNetworkStatusChange((r) => {
      try {
        if (!r || !r.isConnected) return
        ensure()
      } catch (e) {}
    })
  } catch (e) {}
  try { ensure() } catch (e) {}
}

/** 旧名兼容（语义已经从"只盯 WiFi"扩成"任何网络"） */
export function watchWifi() {
  return watchNetwork()
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
