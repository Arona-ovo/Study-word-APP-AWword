// services/ai-gate.js - AI 功能的分项开关
//
// 为什么要有这一层：AI 是按 token 计费的，而 App 里这些能力的调用频次天差地别 ——
// "AI 生成词书"一次几千 token，"AI 聊天"是持续对话，"AI 例句"每次出题都可能触发。
// 以前只有「总开关」，用户想省钱就只能整个关掉，连查词补释义这种低价高频的能力也一起没了。
// 这里把每个**独立的 AI 消耗点**登记成一项，用户在设置里逐项开关，用到哪开哪。
//
// 设计约束：
//   1. 默认全开，且**未登记的 key 视为开启**（`!== false`）。这样以后新增功能时，
//      老用户不会被静默降级 —— 要么他明确关过，要么就是开的。
//   2. 守卫只放在**真正花钱的出口**（去模型的那一步），尤其不挡缓存读取：
//      缓存命中不花 token，关了也该让用户看到之前拿到的结果。
//   3. 一律抛**可降级错误**，调用方已有的 try/catch 与本地兜底全部复用，不用改。
import * as settings from '../utils/settings.js'
import { ServiceError } from './http.js'

// key 是稳定标识（写进存储，改名会导致用户设置失效）
// level 是相对开销，帮用户判断"关哪个最省"
export const AI_FEATURES = [
  {
    key: 'lookup',
    name: '查词与整句翻译',
    desc: '搜索框里用 AI 补充本地没收录的释义，或把整句翻成英文',
    level: 'low', levelLabel: '低'
  },
  {
    key: 'sentence',
    name: 'AI 例句',
    desc: '出题时生成贴合你进度的例句。关掉后完全走本地句库',
    level: 'high', levelLabel: '高'
  },
  {
    key: 'critique',
    name: '翻译点评',
    desc: '作答后给出批改意见与更地道的译法',
    level: 'high', levelLabel: '高'
  },
  {
    key: 'drill',
    name: '薄弱点专练',
    desc: '针对你常错的词生成专项练习句',
    level: 'mid', levelLabel: '中'
  },
  {
    key: 'confusion',
    name: '易混词辨析',
    desc: '同一个词反复搞混时（rise / rice 这类），练习中弹出一张对比讲解卡。'
      + '判断与计数都在本机，只有真触发了才会调一次模型',
    level: 'mid', levelLabel: '中'
  },
  {
    key: 'wordbook',
    name: 'AI 生成词书',
    desc: '按主题批量造词与释义，单次消耗最大的一项',
    level: 'max', levelLabel: '极高'
  },
  {
    key: 'chat',
    name: 'AI 聊天伙伴',
    desc: '自由对话练习，会持续消耗',
    level: 'high', levelLabel: '高'
  },
  {
    key: 'command',
    name: '首页 AI 指令',
    desc: '用一句话改首页布局与卡片',
    level: 'mid', levelLabel: '中'
  },
  {
    key: 'image',
    name: 'AI 生成配图',
    desc: '给卡片和背景出图。关掉后改用纯色渐变',
    level: 'high', levelLabel: '高'
  }
]

const KEYS = AI_FEATURES.map((f) => f.key)

// AI 朗读（TTS）用的是 voice 下的独立开关，不在本表 —— 它是"要不要更自然的人声"，
// 跟这里的"要不要调大模型生成内容"不是一回事，混在一个列表里反而看不懂。
export function featureKeys() {
  return KEYS.slice()
}

export function featureMap() {
  const f = (settings.get().ai || {}).features || {}
  return f
}

export function featureOn(key) {
  return featureMap()[key] !== false
}

// 注意：打开时必须**显式写 true**，不能靠"删掉这个 key 恢复未登记"。
// settings.set() 是深合并，覆盖对象里没出现的 key 会保留旧值 ——
// 删 key 等于什么都没改，用户关掉之后就再也打不开了。
export function setFeature(key, on) {
  if (KEYS.indexOf(key) < 0) return false
  const next = Object.assign({}, featureMap())
  next[key] = !!on
  settings.set({ ai: { features: next } })
  return true
}

export function offCount() {
  const f = featureMap()
  return KEYS.filter((k) => f[k] === false).length
}

export function allOn() {
  return offCount() === 0
}

export function setAll(on) {
  const f = featureMap()
  const next = {}
  if (!on) KEYS.forEach((k) => { next[k] = false })
  else KEYS.forEach((k) => { if (f[k] === false) next[k] = true })
  settings.set({ ai: { features: next } })
}

const NAME_OF = {}
AI_FEATURES.forEach((f) => { NAME_OF[f.key] = f.name })

// 出口守卫：功能被关时抛**可降级**错误，调用方已有的兜底链路原样生效
export function ensureFeature(key) {
  if (featureOn(key)) return
  const n = NAME_OF[key] || key
  throw new ServiceError('「' + n + '」已在设置里关闭', {
    degradable: true,
    notConfigured: true,
    featureOff: true
  })
}

// 给人看的： toast / 占位提示用，不算错误
export function offHint(key) {
  const n = NAME_OF[key] || key
  return '「' + n + '」当前是关闭的，可在「设置 › AI › AI 功能」里打开'
}
