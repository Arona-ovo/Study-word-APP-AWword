<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('例句详情')" />

    <!-- 收藏可能已被移除 / 传参缺失 -->
    <view v-if="!en" class="empty">{{ $t('该例句不存在或已取消收藏') }}</view>

    <block v-else>
      <view class="card detail-card">
        <view class="detail-head">
          <text class="detail-tag">{{ $t('例句') }}</text>
          <text class="detail-remove" @tap="unfavorite">{{ $t('取消收藏') }}</text>
        </view>

        <!-- 英文原文：逐词拆分，点词查词义 + 发音 -->
        <view class="detail-en">
          <text
            v-for="(item, index) in tokens"
            :key="index"
            :class="item.w ? 'tok' : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="detail-tip">{{ $t('点击单词可查看词义并听发音') }}</view>

        <!-- 整句翻译 -->
        <view class="detail-zh">{{ zh }}</view>
      </view>

      <!-- 加入词书：把这句收进词书。
           词书是以「词」为单位的，所以整句不是单独一条，而是挂在你选的那个词下面当例句
           —— 之后在词库里翻到这个词，看到的就是聊天里那句原话。 -->
      <view class="card add-card">
        <view class="ac-head">
          <text class="ac-title">{{ $t('加入词书') }}</text>
          <text class="ac-hint">{{ $t('选一个词，整句会作为它的例句一起存进去') }}</text>
        </view>
        <view v-if="cands.length" class="ac-words">
          <text
            v-for="w in cands"
            :key="w"
            class="ac-chip"
            :class="{ on: pick === w }"
            :data-w="w"
            @tap="pickWord"
          >{{ w }}</text>
        </view>
        <view v-else class="ac-none">{{ $t('这句里没有可收录的单词') }}</view>
        <button class="btn-primary detail-btn" :class="{ 'entry-disabled': !pick || adding }" @tap="addToBook">
          {{ adding ? $t('加入中…') : addBtnText }}
        </button>
      </view>

      <!-- 发音 / 收藏操作 -->
      <view class="detail-actions">
        <button class="btn-primary detail-btn" @tap="speakSentence">{{ speaking ? $t('播放中…') : $t('朗读整句') }}</button>
        <button class="btn-ghost detail-btn" @tap="unfavorite">{{ $t('取消收藏') }}</button>
      </view>
    </block>

    <!-- 全 App 统一弹窗：选词书（单选 sheet） -->
    <app-dialog
      :show="dlg.show"
      :mode="dlg.mode"
      :multi="dlg.multi"
      :title="dlg.title"
      :content="dlg.content"
      :items="dlg.items"
      :seq="dlg.seq"
      @confirm="onDlgConfirm"
      @cancel="closeDlg"
    />

    <!-- 点读单词弹窗（与练习页同一套视觉） -->
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
// 例句详情（我的收藏 → 点例句进入）
// 职责：展示收藏例句的原文与整句翻译；逐词点读（词义弹窗 + 发音）；整句朗读；取消收藏
// 数据来源：只传收藏 id，页面自己回 settings 里查原文 —— 避免长句走 URL 传参的编码坑
import * as settings from '../../../utils/settings'
import * as dict from '../../../utils/dict'
import * as wordbook from '../../../utils/wordbook'
import * as search from '../../../utils/search'
import * as importer from '../../../utils/importer.js'
import { explainWord } from '../../../services/ai-content.js'
import * as tts from '../../../services/voice'
import { tokenize } from '../../../utils/tokenize'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

const EMPTY_POP = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }

/** 统一弹窗的初始态：items 每次都要新数组（共享引用会被 push 污染） */
function emptyDlg() {
  return { show: false, mode: 'sheet', multi: false, title: '', content: '', items: [], seq: 0, action: '' }
}

// 挑候选词时先滤掉这些：冠词、代词、助动词之类收进词书没有学习价值，
// 留着只会把候选列表撑爆、把真正该背的词挤到后面。
const STOP = {};
(['the', 'and', 'but', 'for', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'you', 'your', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'there', 'here',
  'what', 'when', 'where', 'which', 'while', 'with', 'from', 'into', 'about', 'over', 'under',
  'just', 'very', 'much', 'many', 'more', 'most', 'some', 'any', 'all', 'not', 'now', 'then',
  'can', 'could', 'would', 'should', 'will', 'shall', 'must', 'does', 'did', 'doing', 'done',
  'because', 'also', 'too', 'only', 'even', 'still', 'than', 'other', 'another', 'every'])
  .forEach(w => { STOP[w] = true });

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      id: '',
      en: '',
      zh: '',
      tokens: [],
      speaking: false,
      cands: [],      // 这句里值得收的词（已排好序）
      pick: '',      // 当前选中的那个
      adding: false,
      bookName: '',
      bookList: [],   // 弹窗里列出的词书（点选后按同一顺序取回）
      dlg: emptyDlg(),
      pop: Object.assign({}, EMPTY_POP)
    }
  },

  computed: {
    addBtnText() {
      return this.bookName ? t('加入「{name}」', { name: this.bookName }) : t('加入词书')
    }
  },

  onLoad(opt) {
    const id = (opt && opt.id) || ''
    this.id = id
    const fav = settings.favorites().find(f => f.type === 'sentence' && f.id === id)
    if (fav) {
      this.en = fav.en || ''
      this.zh = fav.zh || ''
    }
    this.tokens = tokenize(this.en)
    this.cands = this.candidates(this.en)
    this.pick = this.cands[0] || ''
    try {
      const bid = wordbook.currentBookId()
      const b = wordbook.listBooks().filter(x => x.id === bid)[0]
      this.bookName = (b && b.name) || ''
    } catch (e) { this.bookName = '' }
  },

  onHide() { this.stopAll() },
  onUnload() { this.stopAll() },

  methods: {
    stopAll() {
      this.speaking = false
      tts.stop()
    },

    // 点读单词：查词（核心词书 → 导入词 → 常用词典 → 词形还原）+ 弹窗 + 发音
    // 弹窗大字展示「点到的词形」（保留大小写，如 I / English），
    // 词义/音标/词性来自同一次 lookup —— 分词结果与释义一一对应；
    // 只有当点到的词是变形（如 signed → sign）时才显示「原形」行
    tapWord(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      const raw = d.w || ''
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

    // 弹窗里的"再听一次"：用户主动触发，force 语义由 tts 层保证不被节流吞掉
    replayWord(e) {
      const text = e.currentTarget.dataset.text
      if (!text) return
      tts.speakWord(text)
    },

    // 整句朗读：先发起播放再置位（speakSentence 内部 stop 会触发上一次 onDone）
    speakSentence() {
      if (!this.en) return
      tts.speakSentence(this.en, {
        onDone: () => { this.speaking = false }
      })
      this.speaking = true
    },

    // ---------- 加入词书 ----------
    /** 这句里值得收的词：滤掉虚词与短词，词书里还没有的排前面，其次长的排前面 */
    candidates(en) {
      const seen = {}
      const out = []
      ;(tokenize(String(en || '')) || []).forEach(tk => {
        if (!tk || !tk.w) return
        const low = String(tk.t || '').toLowerCase()
        if (low.length < 3 || STOP[low] || !/^[a-z]+$/.test(low)) return
        if (seen[low]) return
        seen[low] = 1
        out.push(low)
      })
      const have = {}
      try {
        wordbook.bookWords(wordbook.currentBookId()).forEach(w => { have[String(w.w || '').toLowerCase()] = 1 })
      } catch (e) { /* 词书读不出来就只按长度排 */ }
      out.sort((a, b) => ((have[a] ? 1 : 0) - (have[b] ? 1 : 0)) || (b.length - a.length))
      return out.slice(0, 12)
    },
    pickWord(e) {
      const w = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.w
      if (w) this.pick = w
    },
    /** 词的释义：先查词典，词典没有就问 AI（走 aiCache，同一个词不会问第二次） */
    async resolveWord(w) {
      const d = dict.lookup(w)
      if (d && d.found && d.meaning) return { word: w, pos: d.pos || '', meaning: d.meaning }
      try {
        const r = await explainWord(w)
        // pos === 'sentence' 是「这条缓存存的是整句译文」的标记，不是词性
        if (r && r.meaningZh) return { word: w, pos: r.pos === 'sentence' ? '' : (r.pos || ''), meaning: r.meaningZh }
      } catch (e) { /* 没配 AI / 关了释义：收不进去，下面给人话 */ }
      return null
    },
    addToBook() {
      const w = String(this.pick || '')
      if (!w || this.adding) return
      const books = wordbook.listBooks() || []
      if (!books.length) {
        uni.showToast({ title: t('还没有词书，先去「词库」建一本'), icon: 'none' })
        return
      }
      // 选词书：走全 App 统一弹窗（不是系统动作面板 —— 系统弹窗在 App 端 CSS 管不到，
      // 宽高圆角和玻璃卡片对不上）。当前那本标「（当前）」，点一下就加。
      this.bookList = books
      const cur = wordbook.currentBookId()
      this.dlg = Object.assign(emptyDlg(), {
        show: true,
        mode: 'sheet',
        action: 'addSentenceBook',
        title: t('加入词书'),
        content: t('把「{w}」收进去，整句作为它的例句', { w: w }),
        items: books.map(b => ({ id: b.id, label: b.name + (b.id === cur ? t('（当前）') : '') })),
        seq: (this.dlg.seq || 0) + 1
      })
    },
    // 单选 sheet 回传的是下标（app-dialog 的 pick）
    onDlgConfirm(i) {
      const act = this.dlg.action
      this.closeDlg()
      if (act !== 'addSentenceBook') return
      const b = this.bookList[Number(i)]
      if (b) this.doAdd(b)
    },
    closeDlg() { this.dlg = emptyDlg() },
    async doAdd(book) {
      const w = String(this.pick || '')
      if (!w || this.adding) return
      this.adding = true
      try {
        const info = await this.resolveWord(w)
        if (!info) {
          uni.showToast({ title: t('「{w}」词典里没有释义，接入 AI 后可自动补充', { w: w }), icon: 'none' })
          return
        }
        const payload = Object.assign({}, info, { example: { en: this.en, zh: this.zh } })
        const r = search.addWordToBook(book.id, payload, { allowKnown: true })
        if (r && r.added) {
          uni.showToast({ title: t('已加入「{name}」', { name: book.name }), icon: 'none' })
          try { uni.$emit('home:refresh') } catch (e) {}
          return
        }
        // 词已经在这本书里了（不算错）：那就只把整句挂上去当例句 ——
        // attachExampleTo 只对导入词生效，内置词会失败，落到下面的提示
        if (importer.attachExampleTo(book.id, w, this.en, this.zh)) {
          uni.showToast({ title: t('「{w}」已在词书里，这句已存为它的例句', { w: w }), icon: 'none' })
          return
        }
        uni.showToast({ title: (r && r.reason) || t('没能加入词书'), icon: 'none' })
      } finally {
        this.adding = false
      }
    },

    // 取消收藏：软提示后返回列表（列表 onShow 会自动刷新）
    unfavorite() {
      if (!this.id) return
      settings.removeFavorite('sentence', this.id)
      this.stopAll()
      uni.showToast({ title: t('已取消收藏'), icon: 'none' })
      setTimeout(() => {
        uni.navigateBack()
      }, 300)
    }
  }
}
</script>

<style>
.empty { text-align: center; color: #98a19b; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.detail-card { margin-bottom: 24rpx; }

.detail-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18rpx; }

.detail-tag {
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
  font-weight: 600;
}

.detail-remove { font-size: 24rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* 英文原文：Georgia 衬线，逐词可点（虚线下划线提示可点读） */
.detail-en {
  font-size: 32rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-weight: 500;
}

.pun { color: #17201a; color: var(--ink-1, #17201a); }

.tok { border-bottom: 2rpx dashed #bfd4ff; }

.tok:active { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.tok:active { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

.detail-tip {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.detail-zh {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #eff2f5;
  font-size: 28rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* ---------- 加入词书 ---------- */
.add-card { margin-bottom: 24rpx; }

.ac-head { margin-bottom: 16rpx; }

.ac-title { font-size: 28rpx; font-weight: 600; color: #17201a; }
.ac-title { font-size: 28rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.ac-hint { display: block; margin-top: 8rpx; font-size: 22rpx; color: #98a19b; line-height: 1.6; }
.ac-hint { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); line-height: 1.6; }

.ac-words { display: flex; flex-wrap: wrap; }

/* 候选词：点一下换选中的那个。英文用 Georgia 衬线，和题干一致 */
.ac-chip {
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 8rpx 22rpx;
  margin: 0 14rpx 14rpx 0;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
}

.ac-chip.on {
  color: #ffffff;
  font-weight: 600;
  background: #7c3aed;
  border-color: #7c3aed;
}

.ac-none { font-size: 24rpx; color: #98a19b; margin-bottom: 18rpx; }
.ac-none { font-size: 24rpx; color: var(--ink-3, #98a19b); margin-bottom: 18rpx; }

.detail-actions { display: flex; flex-direction: column; }

.detail-btn { width: 100%; }

.detail-btn + .detail-btn { margin-top: 20rpx; }

/* ---------- 点读弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式 ---------- */

.pop-word {
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: #5a6560; }
.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: var(--ink-2, #5a6560); }

.pop-meaning.none { color: #98a19b; }
.pop-meaning.none { color: var(--ink-3, #98a19b); }

.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: #98a19b; }
.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: var(--ink-3, #98a19b); }

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

.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: #98a19b; }
.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

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
