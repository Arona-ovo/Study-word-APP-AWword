<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('单词详情')" />

    <!-- 传参缺失 -->
    <view v-if="missing" class="empty">
      <text class="empty-text">{{ $t('没有找到这个单词') }}</text>
      <text class="empty-hint">{{ $t('请从词库列表或首页搜索结果进入') }}</text>
    </view>

    <block v-else>
      <!-- 词头：单词 / 音标 / 收藏 / 释义 / 来源标签 -->
      <view class="card head-card">
        <view class="head-row">
          <view class="head-main">
            <text class="wd-word">{{ word }}</text>
            <text class="wd-ph" v-if="info.phonetic">/{{ info.phonetic }}/</text>
          </view>
          <text class="wd-fav" :class="{ on: faved }" @tap="toggleFav">{{ faved ? '★' : '☆' }}</text>
        </view>

        <view class="wd-mean" v-if="found">{{ posLabel }} {{ info.meaning }}</view>
        <view class="wd-mean none" v-else>{{ $t('词典暂未收录（仍可发音）') }}</view>

        <view class="wd-tags">
          <text class="tag wd-src">{{ srcLabel }}</text>
          <text class="tag wd-lv" v-if="lv">Lv{{ lv }}</text>
          <text class="tag wd-lemma" v-if="info.inflected">原形 {{ info.lemma }}</text>
        </view>

        <button class="btn-primary wd-speak" @tap="speakWord">{{ isSentence ? $t('朗读整句') : $t('朗读单词') }}</button>
      </view>

      <!-- 学习情况（该词在当前词书里才有掌握度） -->
      <view class="card stat-card" v-if="inBook">
        <view class="card-title">{{ $t('学习情况') }}</view>
        <view class="st-row">
          <view class="st-item">
            <text class="st-num">{{ mastery }}</text>
            <text class="st-label">{{ $t('掌握度') }}</text>
          </view>
          <view class="st-item">
            <text class="st-num">{{ seen }}</text>
            <text class="st-label">{{ $t('练习次数') }}</text>
          </view>
          <view class="st-item">
            <text class="st-num">{{ correct }}</text>
            <text class="st-label">{{ $t('答对') }}</text>
          </view>
        </view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: pct + '%' }"></view>
        </view>
        <text class="st-status">{{ statusName }}</text>
      </view>

      <!-- 加入词书：AI 补充的词只存在本机缓存里，要不要收进词书由这里决定；
           原有的词也可以从这儿加进别的词书 -->
      <view class="card add-card">
        <view class="card-title">{{ $t('加入词书') }}</view>
        <!-- 词典和 AI 都没收录：给一个自己填释义的入口。
             以前这里只有一句"先查到释义再加入"，可词典里没有、又没接 AI 的词
             就永远加不进去 —— 用户搜到的词等于白搜（实测反馈）。 -->
        <block v-if="!found">
          <view class="add-tip">{{ $t('词典和 AI 都没收录这个词：自己填个释义就能收进词书') }}</view>
          <view class="mn-row">
            <input
              class="mn-pos"
              v-model="manualPos"
              :placeholder="$t('词性')"
              placeholder-class="mn-ph"
            />
            <input
              class="mn-mean"
              v-model="manualMean"
              :placeholder="$t('释义')"
              placeholder-class="mn-ph"
            />
          </view>
          <button class="btn-primary add-btn" @tap="addManual">{{ $t('加入当前词书') }}</button>
        </block>
        <block v-else>
          <button
            v-if="!inBook"
            class="btn-primary add-btn"
            @tap="addToCurrent"
          >{{ $t('加入当前词书') }}</button>
          <text v-else class="add-tip">{{ $t('已在当前词书中') }}</text>
          <button
            v-if="allBooks.length"
            class="btn-ghost add-btn"
            @tap="pickBook"
          >{{ $t('加入 / 移出词书…') }}</button>
        </block>
      </view>

      <!-- 所属词库：每一行都能直接把这个词移出去。
           不用绕到上面的弹窗里"取消勾选" —— 用户想移出的时候，看的就是这张列表。 -->
      <view class="card book-card">
        <view class="card-title">{{ $t('所属词库') }}</view>
        <view v-for="(b, i) in books" :key="i" class="bk-row">
          <view class="bk-left">
            <text class="bk-name">{{ b.name }}</text>
            <text class="bk-cur" v-if="b.current">{{ $t('当前') }}</text>
          </view>
          <text class="bk-del" @tap="askRemoveBook(i)">{{ $t('移出') }}</text>
        </view>
        <view v-if="!books.length" class="bk-empty">{{ $t('尚未加入任何词库') }}</view>
      </view>

      <!-- 例句：优先用导入词自带的例句，其次从句库里反查含该词的句子 -->
      <view class="card ex-card" v-if="examples.length">
        <view class="card-title">{{ $t('例句') }}</view>
        <view
          v-for="(s, i) in examples"
          :key="i"
          class="ex-item"
          :data-text="s.en"
          @tap="speakEx"
        >
          <text class="ex-en">{{ s.en }}</text>
          <text class="ex-zh">{{ s.zh }}</text>
          <text class="ex-note" v-if="s.note">{{ s.note }}</text>
        </view>
        <text class="ex-tip">{{ $t('点击例句可朗读') }}</text>
      </view>
    </block>

    <!-- 全 App 统一弹窗：两种用法 —— 多选sheet（加入/移出词书）、confirm（移出确认） -->
    <app-dialog
      :show="dlg.show"
      :mode="dlg.mode"
      :btn-mode="dlg.btnMode"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :cancel-text="dlg.cancelText"
      :danger="dlg.danger"
      :multi="dlg.multi"
      :items="dlg.items"
      :value="dlg.value"
      :placeholder="dlg.placeholder"
      :error="dlg.error"
      :seq="dlg.seq"
      @confirm="onDlgConfirm"
      @cancel="closeDlg"
    />
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
// 单词详情（两个入口共用：词库详情 → 词汇明细；首页 → 搜索结果）
//
// 路由参数：?w=单词&id=词条id（可选）&book=词书id（可选）
//   · w 是唯一必填项：搜索结果里只有单词本身（来自 dict.lookup，没有词条 id）
//   · id / book 只用于定位"该词在词书里的掌握度"，缺失就只展示词典信息
//
// 数据全部来自现有结构，不臆造：
//   · 单词 / 词性 / 释义 / 音标 / 词形还原 → utils/dict.js 的 lookup()
//     （音标取自 WORDS 的 ph 字段，核心词目前普遍为空，所以按"有才显示"处理）
//   · 掌握度 / 练习次数 → wordbook.masteryMap(bookId)
//   · 所属词库 → wordbook.listBooks() 逐个查 bookWords()
//   · 例句 → 导入词自带的 exampleEn/exampleZh，否则用 sentence-index 反查句库
import * as dict from '../../../utils/dict'
import * as wordbook from '../../../utils/wordbook'
import * as sentenceIndex from '../../../utils/sentence-index'
import * as settings from '../../../utils/settings'
import * as sync from '../../../services/account-sync'
import * as aiCache from '../../../utils/ai-cache.js'
import * as search from '../../../utils/search'
import * as tts from '../../../services/voice'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

// 弹窗初始态：items 必须是新数组（共享引用会被 push 污染，见 openDlg）
function emptyDlg() {
  return {
    show: false,
    mode: 'confirm',    // confirm | sheet | input
    multi: false,       // sheet 的多选形态（词书勾选）
    btnMode: 'confirm', // confirm | alert
    title: '',
    content: '',
    confirmText: t('确定'),
    cancelText: t('取消'),
    danger: false,
    items: [],
    value: '',
    placeholder: '',
    error: '',
    seq: 0,
    action: ''          // 派发用：addBook
  }
}

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      dlg: emptyDlg(),
      word: '',
      wordId: '',
      bookId: '',
      missing: false,
      found: false,
      lv: 0,
      inBook: false,
      mastery: 0,
      seen: 0,
      correct: 0,
      pct: 0,
      statusName: t('新词'),
      faved: false,
      books: [],        // 已收录这个词的词书（「所属词库」列表）
      allBooks: [],     // 全部词书（多选弹窗的候选项）
      allBooks: [],
      examples: [],
      ownExample: null, // 这个词自带的例句（导入词自带 / AI 缓存），加入词书时一并带过去
      // 词典与 AI 都没有释义时，由用户自己填（不填就没有释义，加进词书也没法做题）
      manualPos: '',
      manualMean: '',
      info: {
        pos: '',
        meaning: '',
        phonetic: '',
        src: 'none',
        lemma: '',
        inflected: ''
      }
    }
  },
  computed: {
    srcLabel() {
      // 'ai' 是本机缓存里的 AI 补充词，dict.SRC_LABEL 里没有这一档
      if (this.info.src === 'ai') return t('AI 补充')
      return (dict.SRC_LABEL && dict.SRC_LABEL[this.info.src]) || t('未收录')
    },
    // pos 为 'sentence' 说明这条是整句译文（见 services/ai-content.js 的 explainWord）：
    // 那是个给程序看的标记，不是词性，直接显示 "sentence" 很奇怪。
    isSentence() {
      return String(this.info.pos || '').trim().toLowerCase() === 'sentence'
    },
    posLabel() {
      const p = String(this.info.pos || '').trim()
      return this.isSentence ? t('整句译文') : p
    }
  },
  onLoad(opt) {
    const o = opt || {}
    // 跳转方对 query 做了 encodeURIComponent；H5 会自动解码，
    // App 端不会 —— 不补这一步中文词会显示成 %e4%b8%80 之类的乱码
    const dec = (v) => {
      const s = String(v == null ? '' : v)
      if (!/%[0-9a-f]{2}/i.test(s)) return s
      try { return decodeURIComponent(s) } catch (e) { return s }
    }
    this.word = dec(o.w).trim().toLowerCase()
    this.wordId = dec(o.id)
    this.bookId = dec(o.book)
    this.missing = !this.word
    if (!this.missing) this.load()
  },
  onShow() {
    if (!this.missing) this.refreshFav()
  },
  onHide() { tts.stop() },
  onUnload() { tts.stop() },
  methods: {
    load() {
      // 1) 词典信息（核心词书 → 导入词 → 常用词 → 词形还原）
      const e = dict.lookup(this.word)
      this.found = !!e.found
      this.info = {
        pos: e.pos || '',
        meaning: e.meaning || '',
        phonetic: e.phonetic || '',
        src: e.src || 'none',
        lemma: e.lemma || '',
        inflected: e.inflected || ''
      }
      this.lv = e.lv || 0

      // 1.5) 词典没收录 → 看本机 AI 缓存。
      // AI 补充过的词只存在这里（不进任何词书），所以详情页必须从缓存把释义捞出来，
      // 否则 AI 词进来会显示"词典暂未收录"，也没法加入词书。
      if (!this.found) {
        try {
          const c = aiCache.findWord(this.word)
          if (c && c.meaning) {
            this.found = true
            this.info.pos = c.pos || ''
            this.info.meaning = c.meaning || ''
            this.info.src = 'ai'
          }
        } catch (err) { /* 缓存不可用则保持未收录 */ }
      }

      // 2) 词书归属：没传 book 就用当前词书；没传 id 就按单词名回查
      const bid = this.bookId || wordbook.currentBookId()
      let entry = null
      try {
        entry = wordbook.bookWords(bid).filter(x => String(x.w).toLowerCase() === this.word)[0] || null
      } catch (err) {
        entry = null
      }
      if (entry) {
        if (!this.wordId) this.wordId = String(entry.id || '')
        this.lv = entry.lv || this.lv
      }

      // 3) 掌握度（该词在当前词书里才有）
      this.inBook = !!entry
      if (entry) {
        let rec = null
        try {
          const m = wordbook.masteryMap(bid) || {}
          rec = m[entry.id] || null
        } catch (err) {
          rec = null
        }
        const mv = rec ? rec.m : 0
        this.mastery = mv
        this.seen = rec ? rec.seen || 0 : 0
        this.correct = rec ? rec.correct || 0 : 0
        this.pct = Math.round((mv / 5) * 100)
        // 与词库列表同一套口径
        if (!rec) this.statusName = t('新词')
        else if (mv >= 4) this.statusName = t('已掌握')
        else if (mv === 3) this.statusName = t('熟悉')
        else this.statusName = t('学习中')
      }

      // 4) 所属词库：遍历所有词书，分成「已收录」（列表要显示）与「全部」（弹窗候选项）
      // 词形比较统一转小写：词书里存的是 China 这种首字母大写的词时，
      // 不转小写会匹配不上 → 列表显示"没收录"、移出按钮也跟着不出现。
      const out = []
      const all = []
      const want = String(this.word).toLowerCase()
      try {
        wordbook.listBooks().forEach(b => {
          all.push({ id: b.id, name: b.name, current: !!b.current })
          try {
            const hit = wordbook.bookWords(b.id).filter(x => String(x.w).toLowerCase() === want)[0]
            if (hit) out.push({ id: b.id, name: b.name, current: !!b.current })
          } catch (err) { /* 单本书读失败不影响其他 */ }
        })
      } catch (err) { /* 词书列表不可用则留空 */ }
      this.books = out
      this.allBooks = all

      // 5) 例句：导入词自带的优先，其次从句库反查
      const list = []
      this.ownExample = null
      if (entry && entry.exampleEn) {
        list.push({ en: entry.exampleEn, zh: entry.exampleZh || '', note: '' })
        // 自带例句直接跟着词条一起进词书，省掉一次例句生成
        this.ownExample = { en: entry.exampleEn, zh: entry.exampleZh || '' }
      }
      try {
        (sentenceIndex.candidates(this.word) || []).forEach(s => {
          if (list.length >= 3) return
          if (list.some(x => x.en === s.en)) return
          list.push({ en: s.en || '', zh: s.zh || '', note: s.note || '' })
        })
      } catch (err) { /* 索引不可用则没有例句 */ }
      // 6) 本机缓存过的 AI 例句：临时查过的词，再来还能看到
      try {
        (aiCache.sentencesOf(this.word) || []).forEach(s => {
          if (list.length >= 3) return
          if (list.some(x => x.en === s.en)) return
          list.push({ en: s.en || '', zh: s.zh || '', note: t('本机缓存') })
          // AI 已经给过例句，加入词书时直接复用（没有自带例句时才用它）
          if (!this.ownExample && s.en) this.ownExample = { en: s.en, zh: s.zh || '' }
        })
      } catch (err) { /* 缓存不可用则跳过 */ }
      this.examples = list

      this.refreshFav()
    },

    refreshFav() {
      const key = this.wordId || this.word
      let on = false
      try {
        on = settings.favorites().some(f => f.type === 'word' && String(f.id) === String(key))
      } catch (e) {
        on = false
      }
      this.faved = on
    },

    // 收藏：与词库页同一套（本地 settings + 登录后镜像到 word_favorite 表）
    toggleFav() {
      const key = this.wordId || this.word
      const wasOn = this.faved
      const payload = {
        type: 'word',
        id: key,
        word: this.word,
        meaning: this.info.meaning || ''
      }
      settings.toggleFavorite(payload)
      try {
        if (wasOn) sync.unmirrorFavorite('word', key)
        else sync.mirrorFavorite(payload)
      } catch (e) { /* 未登录 / 库不可用时只存本地 */ }
      this.faved = !wasOn
      uni.showToast({ title: this.faved ? t('已收藏') : t('已取消收藏'), icon: 'none' })
    },

    // 单词发音：优先原形（词典收录形式），未收录也能读
    speakWord() {
      try {
        tts.speakWord(dict.speakForm(this.word))
      } catch (e) {
        tts.speakWord(this.word)
      }
    },

    speakEx(e) {
      const text = e.currentTarget.dataset && e.currentTarget.dataset.text
      if (!text) return
      tts.speakSentence(text)
    },

    // ---------- 加入词书 ----------
    // 两个入口共用：AI 补充的词（只在本机缓存里）和词典里原有的词。
    // 归属权交给用户 —— 搜过什么不会自动塞进任何词书。
    addToCurrent() {
      this.doAdd(this.bookId || wordbook.currentBookId())
    },

    /**
     * 词典和 AI 都没收录时，用用户自己填的词性 / 释义入库。
     * 入库走的是同一条管道（search.addWordToBook → importer 校验去重），
     * 加完之后再 load() 一次：lookup 会从本词书的导入词里把这条读回来（src=custom），
     * 于是"暂未收录"变成正经词条，掌握度 / 例句那些区块也跟着出来。
     */
    addManual() {
      const mean = String(this.manualMean || '').trim()
      if (!mean) {
        uni.showToast({ title: t('先填个释义'), icon: 'none' })
        return
      }
      const bid = this.bookId || wordbook.currentBookId()
      const payload = {
        word: this.word,
        pos: String(this.manualPos || '').trim(),
        meaning: mean,
        example: this.ownExample || null
      }
      const r = search.addWordToBook(bid, payload, { allowKnown: true })
      if (!r || !r.added) {
        uni.showToast({ title: (r && r.reason) || t('没能加入词书'), icon: 'none' })
        return
      }
      const hit = (this.allBooks || []).filter(b => b.id === bid)[0]
      // 整句进字典（词书名用占位符）：拼接出来的英文句子语序是错的
      uni.showToast({ title: t('已加入「{name}」', { name: (hit && hit.name) || t('词书') }), icon: 'none' })
      this.manualPos = ''
      this.manualMean = ''
      this.load()
      try { uni.$emit('home:refresh') } catch (e) { /* 首页不在时忽略 */ }
    },

    // 选词书：多选弹窗 —— 已收录的词书预勾选，
    // 勾选 = 加入，取消勾选 = 移出（「取消添加」也从这儿做）
    pickBook() {
      const all = this.allBooks || []
      if (!all.length) return
      const inIds = {}
      ;(this.books || []).forEach(b => { inIds[b.id] = true })
      this.openDlg({
        mode: 'sheet',
        multi: true,
        title: t('选择词书'),
        content: t('勾选加入，取消勾选则移出'),
        items: all.map(b => ({ label: b.name, id: b.id, checked: !!inIds[b.id] })),
        action: 'addBookMulti',
        confirmText: t('确定')
      })
    },

    // ---------- 统一弹窗 ----------
    openDlg(patch) {
      this.dlg = Object.assign(emptyDlg(), patch, {
        show: true,
        seq: (this.dlg.seq || 0) + 1
      })
    },

    closeDlg() {
      this.dlg = emptyDlg()
    },

    // payload 语义随 mode 变化：sheet → 选中下标，multi sheet → 下标数组，input → 文本，confirm → true
    onDlgConfirm(payload) {
      const d = this.dlg
      if (d.action === 'addBookMulti' && Array.isArray(payload)) {
        const ids = payload
          .map(i => (d.items || [])[i])
          .filter(it => it && it.id)
          .map(it => it.id)
        this.closeDlg()
        this.applyBookSelection(ids)
        return
      }
      if (d.action === 'addBook' && typeof payload === 'number') {
        const it = (d.items || [])[payload]
        this.closeDlg()
        if (it && it.id) this.doAdd(it.id)
        return
      }
      // 所属词库点「移出」后的确认（danger，默认按钮是取消）
      if (d.action === 'removeBookOne') {
        const bid = d.pendingBook
        this.closeDlg()
        if (bid) this.removeFromBook(bid)
        return
      }
      this.closeDlg()
    },

    /** 入库素材：词形 + 释义 + 该词已有的例句（省一次生成请求） */
    wordPayload() {
      return {
        word: this.word,
        pos: this.info.pos || '',
        meaning: this.info.meaning || '',
        example: this.ownExample || null
      }
    },

    /**
     * 多选确认：勾选集合 vs 当前所属集合做 diff。
     * 新勾选的逐本加入；取消勾选且原本收录的逐本移出（自定义词真删、内置词记黑名单）。
     */
    applyBookSelection(ids) {
      const want = {}
      ids.forEach(id => { want[id] = true })
      const curIds = (this.books || []).map(b => b.id)
      const toAdd = ids.filter(id => curIds.indexOf(id) < 0)
      const toRemove = curIds.filter(id => !want[id])
      if (!toAdd.length && !toRemove.length) {
        uni.showToast({ title: t('没有改动'), icon: 'none' })
        return
      }
      if (!this.found && toAdd.length) {
        uni.showToast({ title: t('这个词还没有释义'), icon: 'none' })
        return
      }
      let addOk = 0
      toAdd.forEach(id => {
        const r = search.addWordToBook(id, this.wordPayload(), { allowKnown: true })
        if (r && r.added) addOk++
      })
      let rmOk = 0
      toRemove.forEach(id => { if (this.removeWordFromBook(id)) rmOk++ })
      if (addOk + rmOk === 0) {
        uni.showToast({ title: t('没能改动词书'), icon: 'none' })
      } else {
        uni.showToast({ title: t('已加入 {a} 本，移出 {b} 本', { a: addOk, b: rmOk }), icon: 'none' })
      }
      // 收录关系变了：所属词库 / 按钮状态 / 首页数据都要刷新
      this.load()
      try { uni.$emit('home:refresh') } catch (e) { /* 首页不在时忽略 */ }
    },

    /**
     * 把当前词从某一本词书里移出。
     * 自定义词书里的词是真删，内置词书的词记进黑名单（不会再被自动带回来），
     * 两种情况都由 wordbook.removeWordsFromBook 处理，这里只负责找到词条 id。
     * @returns {boolean} 是否真的动了（没收录 / 读不到该词书都算没动）
     */
    removeWordFromBook(bookId) {
      try {
        const hit = wordbook.bookWords(bookId).filter(
          x => String(x.w).toLowerCase() === String(this.word).toLowerCase()
        )[0]
        if (!hit || !hit.id) return false
        const r = wordbook.removeWordsFromBook(bookId, [hit.id])
        return !!(r && (r.removed || r.hidden))
      } catch (e) {
        return false
      }
    },

    // 所属词库里点「移出」：先确认（移出后练习里不会再出现这个词）
    askRemoveBook(i) {
      const b = (this.books || [])[i]
      if (!b) return
      this.openDlg({
        mode: 'confirm',
        danger: true,
        title: t('移出词书'),
        content: t('把「{w}」从《{b}》移出？之后的练习里不会再出现。', { w: this.word, b: b.name }),
        confirmText: t('移出'),
        action: 'removeBookOne',
        pendingBook: b.id
      })
    },

    removeFromBook(bookId) {
      const name = ((this.books || []).filter(b => b.id === bookId)[0] || {}).name || t('词书')
      if (!this.removeWordFromBook(bookId)) {
        uni.showToast({ title: t('这个词已经不在该词书里了'), icon: 'none' })
      } else {
        uni.showToast({ title: t('已从「{name}」移出', { name: name }), icon: 'none' })
      }
      this.load()
      try { uni.$emit('home:refresh') } catch (e) { /* 首页不在时忽略 */ }
    },

    doAdd(bookId) {
      if (!this.found) {
        uni.showToast({ title: t('这个词还没有释义'), icon: 'none' })
        return
      }
      // allowKnown：核心词典里已有的词也能收进别的词书（不算重复）
      const r = search.addWordToBook(bookId, this.wordPayload(), { allowKnown: true })
      if (!r || !r.added) {
        uni.showToast({ title: (r && r.reason) || t('没能加入词书'), icon: 'none' })
        return
      }
      const hit = (this.allBooks || []).filter(b => b.id === bookId)[0]
      // 整句进字典（词书名用占位符）：拼接出来的英文句子语序是错的
      uni.showToast({ title: t('已加入「{name}」', { name: (hit && hit.name) || t('词书') }), icon: 'none' })
      // 刷新：掌握度 / 所属词库 / 按钮状态都要跟着变
      this.bookId = bookId
      this.load()
      try { uni.$emit('home:refresh') } catch (e) { /* 首页不在时忽略 */ }
    }
  }
}
</script>

<style>
.empty { padding: 160rpx 60rpx; text-align: center; }

.empty-text {
  display: block;
  font-size: 30rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-bottom: 16rpx;
}

.empty-hint {
  display: block;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.card-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
  margin-bottom: 18rpx;
}

/* ---------- 词头 ---------- */
.head-card { margin-bottom: 24rpx; }

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.head-main { flex: 1; min-width: 0; }

.wd-word {
  font-size: 56rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.wd-ph {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-fav {
  flex-shrink: 0;
  font-size: 40rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding-left: 20rpx;
}

.wd-fav.on { color: #7c3aed; }

.wd-mean {
  margin-top: 18rpx;
  font-size: 30rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-mean.none {
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-tags { margin-top: 16rpx; }

.wd-src {
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.wd-lv {
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}

.wd-lemma {
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-speak {
  margin-top: 24rpx;
  width: 100%;
  height: 80rpx;
  font-size: 28rpx;
}

/* ---------- 学习情况 ---------- */
.stat-card { margin-bottom: 24rpx; }

.st-row { display: flex; padding: 6rpx 0 18rpx; }

.st-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.st-num {
  font-size: 38rpx;
  font-weight: 700;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.st-label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.st-status {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ---------- 加入词书 ---------- */
.add-card { margin-bottom: 24rpx; }

.add-btn {
  width: 100%;
  height: 80rpx;
  margin: 0;
  font-size: 28rpx;
}

.add-btn + .add-btn,
.add-tip + .add-btn { margin-top: 16rpx; }

.add-tip {
  display: block;
  font-size: 24rpx;
  line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 自己填释义：词性窄、释义宽，一行放下；输入框用中性底色，
   和下面的主按钮拉开层次（这一块只在"词典 & AI 都没收录"时出现） */
.mn-row {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}

.mn-pos {
  width: 150rpx;
  height: 76rpx;
  padding: 0 20rpx;
  margin-right: 16rpx;
  font-size: 26rpx;
  border-radius: 16rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.mn-mean {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
  border-radius: 16rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.mn-ph {
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.mn-row + .add-btn { margin-top: 20rpx; }

/* ---------- 所属词库 ---------- */
.book-card { margin-bottom: 24rpx; }

.bk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 2rpx solid #eff2f5;
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.bk-row:last-child { border-bottom: none; }

.bk-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.bk-name {
  font-size: 27rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.bk-cur {
  margin-left: 12rpx;
  font-size: 20rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
}

/* 移出：常驻的次级动作，点一下弹确认。做成文字而不是按钮，
   是因为一行里放个实心按钮会把词书名挤掉（长词书名很常见）。 */
.bk-del {
  flex-shrink: 0;
  margin-left: 20rpx;
  padding: 6rpx 22rpx;
  font-size: 24rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
  border: 2rpx solid rgba(229, 72, 77, 0.3);
  border-radius: 999rpx;
}

.bk-del:active { background: rgba(229, 72, 77, 0.1); }

.bk-empty {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 12rpx 0;
}

/* ---------- 例句 ---------- */
.ex-card { margin-bottom: 24rpx; }

.ex-item { padding: 18rpx 0; }

.ex-item + .ex-item {
  border-top: 2rpx solid #eff2f5;
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.ex-en {
  display: block;
  font-size: 28rpx;
  line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.ex-zh {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.ex-note {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ex-tip {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
