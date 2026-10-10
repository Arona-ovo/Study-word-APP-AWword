<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('错题详情')" />

    <!-- 错题可能已答对移出 / 传参缺失 -->
    <view v-if="!d" class="empty">{{ $t('该错题已不存在或已移出错题本') }}</view>

    <block v-else>
      <view class="card detail-card">
        <view class="detail-head">
          <text class="dir-tag">{{ d.dir === 'e2c' ? $t('英译汉') : $t('汉译英') }}</text>
          <text class="mode-tag">{{ modeText }}</text>
          <text class="detail-time">{{ d.timeStr }}</text>
        </view>

        <!-- 题目：英文侧逐词拆分，点词查词义 + 发音 -->
        <view class="sec-label">{{ $t('题目') }}</view>
        <view class="q-text en" v-if="qTokens.length">
          <text
            v-for="(item, index) in qTokens"
            :key="index"
            :class="item.w ? 'tok' : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="q-text zh" v-else>{{ d.prompt }}</view>

        <!-- 你的答案 -->
        <view class="sec-label">{{ $t('你的答案') }}</view>
        <view class="ans user" :class="{ none: !d.userAnswer }">{{ d.userAnswer || $t('未填写') }}</view>

        <!-- 参考答案：英译汉时答案是英文 → 同样支持点读 -->
        <view class="sec-label">{{ $t('参考答案') }}</view>
        <view class="ans ref en" v-if="aTokens.length">
          <text
            v-for="(item, index) in aTokens"
            :key="index"
            :class="item.w ? 'tok' : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="ans ref" v-else>{{ d.answer }}</view>

        <view class="detail-tip">{{ $t('点击单词可查看词义并听发音') }}</view>
      </view>

      <!-- 朗读英文侧（题目或参考答案，哪边是英文读哪边） -->
      <view class="detail-actions">
        <button class="btn-primary detail-btn" @tap="speakEn">{{ speaking ? $t('播放中…') : $t('朗读英文') }}</button>
      </view>
    </block>

    <!-- 点读单词弹窗（与例句详情同一套视觉） -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <!-- 点单词本身也能进词条页：以前点了毫无反应，用户只会以为界面卡了 -->
        <view class="pop-word" @tap="openPopWord">{{ pop.word }}</view>
        <view class="pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="pop-meaning none" v-else>{{ $t('未收录（仍可发音）') }}</view>
        <!-- 标签 = 这个词在不在「我正在背的词书」里；不在就整行不显示 -->
        <view class="pop-meta" v-if="pop.srcLabel || pop.inflected">
          <text class="pop-src" v-if="pop.srcLabel">{{ pop.srcLabel }}</text>
          <text class="pop-lemma" v-if="pop.inflected">原形 {{ pop.lemma }}</text>
        </view>
        <view class="pop-actions">
          <view class="pop-replay" :data-text="pop.word" @tap="replayWord">{{ $t('再听一次') }}</view>
          <view class="pop-replay" @tap="openPopWord">{{ $t('查看词条') }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
// 错题详情（错题回顾 → 点错题卡片进入）
// 职责：展示单条错题的完整记录（题目 / 你的答案 / 参考答案 / 方向 / 答题方式 / 时间）；
//       英文侧逐词点读（词义弹窗 + 发音）；整句朗读英文
// 数据来源：只传 sid + dir，页面自己回 engine 查记录 —— 避免长句走 URL 传参的编码坑
import * as engine from '../../../utils/engine'
import * as dict from '../../../utils/dict'
import * as tts from '../../../services/voice'
import { tokenize } from '../../../utils/tokenize'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

const EMPTY_POP = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }

function hasZh(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''))
}

export default {
  components: { FloatNavbar },
  data() {
    return {
      sid: '',
      dir: '',
      d: null,
      qTokens: [],
      aTokens: [],
      speaking: false,
      pop: Object.assign({}, EMPTY_POP)
    }
  },

  computed: {
    modeText() {
      if (!this.d) return ''
      return this.d.mode === 'input' ? t('手动输入') : t('选择题')
    }
  },

  onLoad(opt) {
    this.sid = decodeURIComponent((opt && opt.sid) || '')
    this.dir = (opt && opt.dir) || ''
    const rec = engine.wrongDetail(this.sid, this.dir)
    if (!rec) return
    this.d = rec
    // 题目 / 参考答案哪边是英文就拆哪边，支持逐词点读
    this.qTokens = hasZh(rec.prompt) ? [] : tokenize(rec.prompt)
    this.aTokens = hasZh(rec.answer) ? [] : tokenize(rec.answer)
  },

  onHide() { this.stopAll() },
  onUnload() { this.stopAll() },

  methods: {
    stopAll() {
      this.speaking = false
      tts.stop()
    },

    // 点读单词：查词（核心词书 → 导入词 → 常用词典 → 词形还原）+ 弹窗 + 发音
    tapWord(e) {
      const dset = e.currentTarget.dataset
      if (!dset.isw) return
      const raw = dset.w || ''
      if (!raw.trim()) return
      const entry = dict.lookup(raw)
      this.pop = {
        show: true,
        word: raw,
        pos: entry.pos || '',
        meaning: entry.meaning || '',
        phonetic: entry.phonetic || '',
        srcLabel: dict.ownerLabel(raw),
        found: !!entry.found,
        lemma: entry.lemma || '',
        inflected: entry.inflected || ''
      }
      // 未收录的单词仍走有道单词级发音
      tts.speakWord(dict.speakForm(raw))
    },

    // 弹窗里的单词 / 「查看词条」→ 单词详情页（先关弹窗，返回时别还挂着）
    openPopWord() {
      const w = String(this.pop.word || '').trim().toLowerCase()
      if (!w) return
      this.closePop()
      uni.navigateTo({
        url: '/pkgManage/pages/word-detail/word-detail?w=' + encodeURIComponent(w)
      })
    },

    closePop() {
      this.pop = Object.assign({}, EMPTY_POP)
    },

    noop() {},

    replayWord(e) {
      const text = e.currentTarget.dataset.text
      if (!text) return
      tts.speakWord(text)
    },

    // 朗读英文侧：英译汉读题目，汉译英读参考答案；都没有就不动
    speakEn() {
      if (!this.d) return
      // 不盲信 en 字段：老记录 / 异常记录里可能存反了，按"不含中文的那一边"来读
      const sides = [this.d.en, this.d.prompt, this.d.answer]
      const target = sides.filter(s => s && !hasZh(s))[0] || ''
      if (!target) return
      tts.speakSentence(target, {
        onDone: () => { this.speaking = false }
      })
      this.speaking = true
    }
  }
}
</script>

<style>
.empty { text-align: center; color: #98a19b; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.detail-card { margin-bottom: 24rpx; }

.detail-head {
  display: flex;
  align-items: center;
  margin-bottom: 22rpx;
}

.dir-tag {
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
}

.mode-tag {
  margin-left: 12rpx;
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
  font-weight: 600;
}

.detail-time { margin-left: auto; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.sec-label { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); margin-bottom: 8rpx; }

/* 题目：英文用 Georgia 衬线大字；中文稍小 */
.q-text {
  font-size: 32rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
  margin-bottom: 26rpx;
}

.q-text.en, .ans.en {
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-weight: 500;
}

.q-text.zh { font-size: 30rpx; }

.pun { color: #17201a; color: var(--ink-1, #17201a); }

.tok { border-bottom: 2rpx dashed #bfd4ff; }

.tok:active { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.tok:active { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

.ans { font-size: 30rpx; line-height: 1.65; margin-bottom: 26rpx; }

.ans.user { color: #e5484d; }

.ans.user.none { color: #98a19b; color: var(--ink-3, #98a19b); }

.ans.ref { color: #1d4fd8; color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.detail-tip { margin-top: 4rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.detail-actions { display: flex; flex-direction: column; }

.detail-btn { width: 100%; }

/* ---------- 点读弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式 ---------- */

.pop-word {
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: #5a6560; color: var(--ink-2, #5a6560); }

.pop-meaning.none { color: #98a19b; color: var(--ink-3, #98a19b); }

.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.pop-meta { margin-top: 12rpx; display: flex; justify-content: center; }

.pop-src {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
}

.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.pop-replay {
  display: inline-block;
  margin-top: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid #2e6bff;
  border: 2rpx solid var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 12rpx 48rpx;
}

/* 「再听一次」与「查看词条」并排：行距统一由这层给 */
.pop-actions { margin-top: 36rpx; display: flex; align-items: center; justify-content: center; gap: 20rpx; }
.pop-actions .pop-replay { margin-top: 0; padding: 12rpx 34rpx; }
</style>
