<template>
  <view class="container page-nav wd" :class="appTheme" :style="appBgStyle" v-if="!empty">
    <float-navbar :title="$t('刷单词')" />

    <block v-if="!finished">
      <!-- 顶部两条进度。
           上面「已做」：累计作答次数，**没有上限** —— 确认机制下同一个词会来回确认，
           次数早晚会超过组词数，所以这里只累加、不设分母；进度条按"每做完一轮
           （= 组词数）"循环填充，刷第二遍确认时它会从头再长一遍。
           下面「记住」：确认达标的词数，有上限（= 组词数）。
           两条的颜色由设置页「两条进度条同色系」决定：sync = 浅版 + 主题色，
           split = 主题色 + 绿色（见 .wd-top.sync / .wd-top.split）。 -->
      <view class="wd-top" :class="barsSync ? 'sync' : 'split'">
        <view class="wd-bar done">
          <text class="wd-bar-k">{{ $t('已做') }}</text>
          <view class="progress-track wd-track">
            <view class="progress-fill" :style="{ width: answerPct + '%' }"></view>
          </view>
          <text class="wd-bar-v">{{ answerText }}</text>
        </view>
        <view class="wd-bar know">
          <text class="wd-bar-k">{{ $t('记住') }}</text>
          <view class="progress-track wd-track">
            <view class="progress-fill" :style="{ width: donePct + '%' }"></view>
          </view>
          <text class="wd-bar-v">{{ doneCount }} / {{ questions.length }}</text>
          <text class="tag src-tag">{{ sourceName }}</text>
        </view>
      </view>

      <!-- 作答方式：选义 / 拼写 / 自评
           光有三个胶囊用户根本看不出点了会怎样（它只决定第一关的题型），
           所以下面紧跟一条"本轮三关"预览：点哪一档，这一行当场就变。
           同时把当前所处的那一关标出来，这条就兼做了进度指示。 -->
      <view class="wd-switch" :class="{ locked: answered }">
        <view class="wd-sw" :class="{ active: mode === 'choice' }" data-m="choice" @tap="switchMode">{{ $t('选义') }}</view>
        <view class="wd-sw" :class="{ active: mode === 'spell' }" data-m="spell" @tap="switchMode">{{ $t('拼写') }}</view>
        <view class="wd-sw" :class="{ active: mode === 'self' }" data-m="self" @tap="switchMode">{{ $t('自评') }}</view>
      </view>
      <view class="wd-plan">
        <text class="wd-plan-k">{{ $t('本轮三关') }}</text>
        <view class="wd-plan-list">
          <block v-for="(p, i) in modePlan" :key="i">
            <text v-if="i > 0" class="wd-plan-sep">›</text>
            <text class="wd-plan-i" :class="{ first: p.first, on: p.on }">{{ p.name }}</text>
          </block>
        </view>
      </view>
      <text class="wd-plan-hint">{{ $t('第一关跟着上面切换，后两关自动换成别的题型') }}</text>

      <!-- 词卡：不背单词式大词卡 —— 只给题干，答案和例句都藏着。
           三关的题干不一样：认得出 / 自评 给单词，想得起 / 写得出 只给中文释义
           （这两关考的就是自己从记忆里把词取出来，把单词摆在那儿等于没考）。 -->
      <view class="card wd-card">
        <view class="wd-meta">
          <text class="tag pos-tag" v-if="cur.pos">{{ cur.pos }}</text>
          <text class="tag lv-tag">Lv{{ cur.lv }}</text>
          <text class="tag st-tag" :class="cur.status">{{ statusName }}</text>
          <!-- 三关进度：现在是第几关、这一关考哪种提取方式 -->
          <text class="tag mode-tag" v-if="modeLabel">{{ modeLabel }}</text>
          <!-- 答错过、被退回第一关又轮回来 -->
          <text class="tag again-tag" v-if="confirmTag">{{ confirmTag }}</text>
          <!-- 发音只在"给单词"的那两关有：想得起 / 写得出 一念就等于报答案 -->
          <text class="wd-say" v-if="promptIsWord" @tap="sayWord">{{ $t('发音') }}</text>
        </view>
        <view class="wd-word" v-if="promptIsWord" @tap="sayWord">{{ promptText }}</view>
        <view class="wd-word wd-word-zh" v-else>{{ promptText }}</view>
        <!-- 音标同理：音节数会把答案漏掉一大半 -->
        <text class="wd-ph" v-if="phonetic && promptIsWord">/{{ phonetic }}/</text>

        <!-- 认得出：英文 → 选中文（识别，最浅的一档） -->
        <view class="wd-opts" v-if="curMode === 'recog'">
          <view
            v-for="(item, i) in curOptions"
            :key="i"
            class="wd-opt"
            :class="{ correct: answered && i === curAnswerIndex, wrong: answered && selected === i && i !== curAnswerIndex }"
            hover-class="wd-opt-hover"
            :data-i="i"
            @tap="choose"
          >
            <text class="wd-ol">{{ labels[i] }}</text>
            <text class="wd-ot">{{ item }}</text>
          </view>
        </view>

        <!-- 想得起：中文 → 选英文（反向提取，比"认"难一档） -->
        <view class="wd-opts" v-else-if="curMode === 'recall'">
          <view
            v-for="(item, i) in curOptions"
            :key="i"
            class="wd-opt en"
            :class="{ correct: answered && i === curAnswerIndex, wrong: answered && selected === i && i !== curAnswerIndex }"
            hover-class="wd-opt-hover"
            :data-i="i"
            @tap="choose"
          >
            <text class="wd-ol">{{ labels[i] }}</text>
            <text class="wd-ot">{{ item }}</text>
          </view>
        </view>

        <!-- 写得出：给中文 + 首字母，写出英文单词（产出，最难的一档） -->
        <view class="wd-spell" v-else-if="curMode === 'spell' && !answered">
          <text class="wd-hint">{{ spellHint }}</text>
          <textarea class="wd-input" :placeholder="$t('拼出这个单词…')" :value="input" @input="onInput" auto-height maxlength="60" />
          <button class="btn-primary wd-submit" @tap="submitSpell" :disabled="!canSubmit">{{ $t('提交') }}</button>
        </view>

        <!-- 自评：先在心里过一遍，再给自己打分 -->
        <view class="wd-self" v-else-if="curMode === 'self' && !answered">
          <text class="wd-hint">{{ $t('先在心里过一遍意思，再给自己打分') }}</text>
          <view class="wd-self-row">
            <view class="wd-grade know" :data-s="'pass'" @tap="grade">{{ $t('认识') }}</view>
            <view class="wd-grade fuzzy" :data-s="'partial'" @tap="grade">{{ $t('模糊') }}</view>
            <view class="wd-grade forgot" :data-s="'fail'" @tap="grade">{{ $t('不认识') }}</view>
          </view>
        </view>
      </view>

      <!-- 答后：完整释义 + 例句 + 掌握度 -->
      <view v-if="answered" class="card wd-reveal">
        <view class="wd-rv-head" :class="toneClass">
          <text class="wd-rv-title">{{ resultTitle }}</text>
          <text class="wd-rv-score" v-if="mode === 'spell'">{{ result.score }}%</text>
        </view>

        <view class="wd-row" v-if="userAnswer">
          <text class="wd-k">{{ $t('你的答案') }}</text>
          <text class="wd-v">{{ userAnswer }}</text>
        </view>
        <view class="wd-row">
          <text class="wd-k">{{ $t('释义') }}</text>
          <text class="wd-v strong">{{ meaningText }}</text>
        </view>
        <view class="wd-row">
          <text class="wd-k">{{ $t('掌握度') }}</text>
          <text class="wd-v">{{ masteryText }}</text>
        </view>
        <!-- 跨天巩固进度：把"下次什么时候回来"摆出来，间隔重复只有被看见才有意义 -->
        <view class="wd-row" v-if="srsText">
          <text class="wd-k">{{ $t('巩固') }}</text>
          <text class="wd-v">{{ srsText }}</text>
        </view>

        <view class="wd-ex" v-if="cur.exampleEn">
          <view class="wd-ex-head">
            <text class="wd-k">{{ $t('例句') }}</text>
            <text class="wd-say small" :data-text="cur.exampleEn" @tap="replay">{{ $t('朗读') }}</text>
          </view>
          <view class="wd-ex-en">
            <text
              v-for="(item, index) in exampleTokens"
              :key="index"
              :class="item.w ? (item.target ? 'wd-tok tg' : (item.book ? 'wd-tok bk' : 'wd-tok')) : 'wd-pun'"
              :data-w="item.t"
              :data-isw="item.w"
              @tap.stop="tapWord"
            >{{ item.t }}</text>
          </view>
          <text class="wd-ex-zh" v-if="cur.exampleZh">{{ cur.exampleZh }}</text>
        </view>

        <view class="wd-fav" @tap="toggleFav">
          <text class="wd-fav-star" :class="{ on: favOn }">{{ favOn ? $t('★ 已收藏') : $t('☆ 收藏这个词') }}</text>
        </view>

        <view class="wd-act">
          <text class="wd-detail" @tap="openDetail">{{ $t('词条详情 ›') }}</text>
          <!-- 答对了但其实是蒙的 / 手滑：反悔改判，该词打回重练 -->
          <text class="wd-wrong" v-if="result && result.pass" @tap="markWrong">{{ $t('记错了') }}</text>
          <button class="btn-primary wd-next" @tap="next">{{ nextText }}</button>
        </view>
      </view>
    </block>

    <!-- 本组总结 -->
    <view v-else class="wd-summary">
      <view class="card wd-sum-card">
        <text class="wd-sum-title">{{ $t('这组刷完了') }}</text>
        <text class="wd-sum-num">{{ knownCount }}<text class="wd-sum-total"> / {{ questions.length }}</text></text>
        <text class="wd-sum-sub">{{ summaryText }}</text>
        <text class="wd-sum-foot">{{ progressText }}</text>
        <text class="wd-sum-sep">{{ $t('切换方式：选义 / 拼写 / 自评') }}</text>
        <button class="btn-primary wd-sum-btn" @tap="restart">{{ $t('再刷一组') }}</button>
        <button class="btn-ghost wd-sum-btn" @tap="goHome">{{ $t('返回首页') }}</button>
      </view>
    </view>

    <!-- 点读单词弹窗 -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <view class="wd-pop-word">{{ pop.word }}</view>
        <view class="wd-pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="wd-pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="wd-pop-none" v-else>{{ $t('未收录（仍可发音）') }}</view>
        <view class="wd-pop-src" v-if="pop.found">{{ pop.srcLabel }}</view>
        <view class="wd-pop-replay" :data-text="pop.word" @tap="replay">{{ $t('再听一次') }}</view>
      </view>
    </view>
  </view>

  <!-- 空状态 -->
  <view v-else class="container page-nav wd-empty" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('刷单词')" />
    <text class="wd-empty-text">{{ emptyText }}</text>
    <button class="btn-primary wd-empty-btn" @tap="goHome">{{ $t('返回首页') }}</button>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import * as engine from '../../../utils/engine'
import * as iplus1 from '../../../utils/iplus1'
import * as wordbook from '../../../utils/wordbook'
import * as wordSession from '../../../utils/word-session.js'
import * as srs from '../../../utils/srs.js'
import * as dict from '../../../utils/dict'
import * as settings from '../../../utils/settings'
import { barsSyncColors } from '../../../utils/theme.js'
import * as sync from '../../../services/account-sync'
import * as tts from '../../../services/voice'
import { tokenize } from '../../../utils/tokenize'
import { bookWordSet, targetWordSet, markTokens } from '../../../utils/word-mark'
import * as sfx from '../../../utils/sfx.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

// 掌握度标签：三种来源的翻译都由 setupQuestion 预算好，模板里不做三元 + 占位符的组合
const STATUS_NAME = { new: '新词', learning: '学习中', familiar: '熟悉', mastered: '已掌握' }

// 三关题型名（key 即中文原文，正好就是 i18n 的 key，直接喂 t()）
const MODE_LABEL = { recog: '认得出', recall: '想得起', spell: '写得出', self: '自评' }

/* ---------- 作答方式：选义 / 拼写 / 自评 ----------
   用户的诉求是"选了就一直固定着"：刷同一组词时换到下一个词，方式不能跳回选义；
   下次再进这一页也该还是上次那一种。所以方式存在 settings.study.drillMode，
   而不是 data 里的一个临时字段（旧写法 setupQuestion 里写死 this.mode = 'choice'，
   每换一个词就弹回选义，选拼写的人得一路重挑 20 次）。
   顶部胶囊一直可见可点，所以不存在"被锁死改不回来"的问题。
   读取走 settings.studyMode()：脏值统一回落选义（翻译练习页同款，别各写一份校验）。 */
const DRILL_MODES = ['choice', 'spell', 'self']

/** 进页面（data() 初值）时恢复上次用的作答方式 */
function savedDrillMode() {
  return settings.studyMode('drillMode', DRILL_MODES, 'choice')
}

export default {
  components: { FloatNavbar },
  data() {
    return {
      labels: ['A', 'B', 'C', 'D'],
      source: 'daily',
      questions: [],
      idx: 0,
      cur: { id: '', w: '', pos: '', m: '', lv: 1, options: [], answerIndex: 0, exampleEn: '', exampleZh: '', mastery: 0, status: 'new' },
      // 进页面就恢复上次用的作答方式（见文件顶端 savedDrillMode）
      mode: savedDrillMode(),
      // 当前这一关的题型（认得出 / 想得起 / 写得出 / 自评）。
      // 和上面的 mode 不是一回事：mode 是用户挑的"偏好"，curMode 是三关里当前这一关
      // 实际要考的提取方式 —— 第一关用他挑的，后两关自动换成别的，保证同一个词
      // 不会连着三遍考同一种通路（三遍同一种题型考的还是那一条记忆通路）。
      curMode: 'recog',
      // 当前这一关的选项与正确答案位置（recog 是中文选项，recall 是英文选项）
      curOptions: [],
      curAnswerIndex: 0,
      // 题干：认得出 / 自评 显示单词；想得起 / 写得出 显示中文释义（单词藏到答完再揭）
      promptText: '',
      promptIsWord: true,
      // 「第 2 关 · 想得起」这类标签，模板不做三元，JS 里预算成字符串
      modeLabel: '',
      // 胶囊底下的"本轮三关"预览：[{ name, first, on }]。
      // first = 这一档由上面的胶囊决定；on = 当前正处在这一关。
      // 模板不做函数调用，序列变化一律在这里预算好（见 syncModePlan）
      modePlan: [],
      selected: -1,
      input: '',
      canSubmit: false,
      answered: false,
      result: null,
      userAnswer: '',
      knownCount: 0,
      // 多次确认会话（不背单词机制）：下面那条进度条的分子 = 已确认记住的词数
      doneCount: 0,
      // 上面那条进度条：累计作答次数（只增不减、没有上限；改判也不回退 —— 做了就是做了）
      answerCount: 0,
      answerPct: 0,
      answerText: '',
      donePct: 0,
      // 两条进度条的颜色模式（设置页「两条进度条同色系」）：
      // sync = 浅版 + 主题色；split = 主题色 + 绿色。进页面时读一次
      barsSync: true,
      // 第二次及以后见到同一个词时显示「再确认」标签
      confirmTag: '',
      counts: { pass: 0, partial: 0, fail: 0 },
      finished: false,
      empty: false,
      emptyText: '',
      phonetic: '',
      exampleTokens: [],
      statusName: '',
      resultTitle: '',
      toneClass: '',
      masteryText: '',
      // 跨天巩固进度（"已巩固 2 / 7 次 · 下次 10-17"），只在答后揭示区显示
      srsText: '',
      meaningText: '',
      spellHint: '',
      sourceName: '',
      summaryText: '',
      progressText: '',
      nextText: '',
      pop: { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false },
      // 页面还活着吗：onUnload 置 false，用来掐断"答题后延迟朗读参考答案"这类定时器。
      // 沿用练习页（practice.vue）的同一套纪律：人已离开，不许再有声音。
      alive: true,
      bookId: '',
      answerTimer: 0,
      speaking: false,
      favOn: false,
      bookSet: {}
    }
  },

  onLoad(opt) {
    try {
      this.bookId = wordbook.currentBookId()
      const src = opt && opt.source
      this.start(src === 'review' ? 'review' : (src === 'new' ? 'new' : 'daily'))
    } catch (e) {
      console.error('[word-drill onLoad]', e)
      this.empty = true
      this.emptyText = t('页面加载失败：') + String((e && e.message) || e)
    }
  },

  onShow() {
    // 从设置页改完配色回来要生效（页面是 navigateTo 打开的，返回时走 onShow）
    try { this.barsSync = barsSyncColors() } catch (e) { this.barsSync = true }
  },

  onHide() {
    this.clearAnswerTimer()
    tts.stop()
  },
  onUnload() {
    this.alive = false
    this.clearAnswerTimer()
    tts.stop()
  },

  methods: {
    clearAnswerTimer() {
      if (this.answerTimer) {
        clearTimeout(this.answerTimer)
        this.answerTimer = 0
      }
    },

    /**
     * 每组词量：默认 20，夹 5-60。
     * 不额外做一个「每日刷词」目标 —— 首页的「每日新词」已经按首见日期（fs）管着节奏，
     * 这里只负责一次给多少词，两套目标叠在一起反而说不清。
     */
    deckSize() {
      const n = Number(wordSession.DECK_SIZE.def)
      return Math.max(wordSession.DECK_SIZE.min, Math.min(wordSession.DECK_SIZE.max, n))
    },

    start(source) {
      if (!wordbook.bookWords(this.bookId).length) {
        this.empty = true
        this.finished = false
        this.emptyText = t('当前词书还没有词汇，请到「词库 → 导入单词」粘贴单词或用 AI 生成')
        return
      }
      const deck = wordSession.buildDeck(this.deckSize(), this.bookId, source)
      if (!deck.length) {
        this.empty = true
        this.finished = false
        this.emptyText = source === 'review'
          ? t('暂时没有需要复习的词，先去刷一组新词吧')
          : (source === 'new' ? t('这本词书的词都见过了，可以换一组复习') : t('暂时没有可刷的词'))
        return
      }
      this.source = source
      this.questions = deck
      // 多次确认会话：复习首答对即算记住（need=1）；日常 / 新词要连过三关。
      // 三关的题型序列按用户挑的作答方式起头、其余轮转（选拼写就 写→认→想），
      // 这样既尊重选择，又保证同一个词不会三遍考同一种提取方式。
      this.session = wordSession.createConfirmSession(deck, {
        review: source === 'review',
        modes: wordSession.buildModeSequence(this.mode)
      })
      this.seenTimes = {}
      this.doneCount = 0
      this.answerCount = 0
      this.answerPct = 0
      this.answerText = t('{n} 题', { n: 0 })
      this.donePct = 0
      this.knownCount = 0
      this.counts = { pass: 0, partial: 0, fail: 0 }
      this.finished = false
      this.empty = false
      // 词书词汇集合算一次就够（做题期间词书不变）
      this.bookSet = bookWordSet(this.bookId)
      this.setupByItem(this.session.current())
    },

    /**
     * 顶部两条进度条同步。
     * 已做 = 累计作答次数（无上限）：确认机制下一个词要来回确认，次数会超过组词数，
     *   所以数字只管累加；进度条按"每做完一轮（= 组词数）"循环填充，
     *   刷第二遍时它会从头再长一遍 —— 否则一过组词数就永远顶在 100%。
     * 记住 = 连续确认达标、会话真正判"记住"的词数（有上限，分母 = 组词数）。
     */
    syncBars() {
      const total = this.questions.length || 0
      const n = Number(this.answerCount) || 0
      this.donePct = total ? Math.min(100, Math.round((this.doneCount / total) * 100)) : 0
      const inLap = total ? n % total : 0
      // 刚好做完一轮（n 是 total 的整数倍）时给满格，下一个答案再从头开始
      this.answerPct = total ? Math.round(((n > 0 && inLap === 0 ? total : inLap) / total) * 100) : 0
      const lap = total && n > 0 ? Math.floor((n - 1) / total) + 1 : 0
      this.answerText = lap > 1
        ? t('{n} 题 · 第 {m} 轮', { n: n, m: lap })
        : t('{n} 题', { n: n })
    },

    // 会话驱动：拿确认会话里的下一个词去渲染（找不到就收尾）
    setupByItem(item) {
      if (!item) {
        this.finishSummary()
        return
      }
      const i = this.questions.indexOf(item)
      this.setupQuestion(i < 0 ? 0 : i)
    },

    setupQuestion(i) {
      const item = this.questions[i]
      this.clearAnswerTimer()
      this.idx = i
      this.cur = item
      // 当前这一关考什么由确认会话决定（三关轮转），不跟着用户挑的 mode 走死
      const step = this.session
        ? this.session.currentStep()
        : { streak: 0, need: wordSession.CONFIRM_TIMES, mode: 'recog' }
      const curMode = step.mode || 'recog'
      this.curMode = curMode
      // 选项随题型走：认得出给中文选项，想得起给英文选项
      const bank = (item.modes || {})[curMode] || {}
      if (curMode === 'recog' || curMode === 'recall') {
        this.curOptions = bank.options || item.options || []
        this.curAnswerIndex = Number(bank.answerIndex == null ? item.answerIndex : bank.answerIndex) || 0
      } else {
        this.curOptions = []
        this.curAnswerIndex = 0
      }
      // 题干：认得出 / 自评 给单词；想得起 / 写得出 只给中文释义 ——
      // 这两关就是要你从记忆里把词取出来，一上来就把单词摆在那儿等于没考。
      this.promptIsWord = (curMode === 'recog' || curMode === 'self')
      this.promptText = this.promptIsWord ? item.w : (item.m || '')
      this.modeLabel = t('第 {a} / {b} 关 · {m}', {
        a: Math.min(step.streak + 1, step.need),
        b: step.need,
        m: t(MODE_LABEL[curMode] || '认得出')
      })
      this.syncModePlan(step.streak)
      // 这个词是第几次出现：只在"答错过、被退回第一关又轮回来"时标「再确认」——
      // 正常闯第 2、3 关时 modeLabel 已经写着"第 N 关"了，再标一遍是废话
      const seen = this.seenTimes || (this.seenTimes = {})
      seen[item.id] = (seen[item.id] || 0) + 1
      this.confirmTag = (seen[item.id] > 1 && step.streak === 0) ? t('再确认') : ''
      // 这个词算"练过了" → 上面那条进度条 +1（确认轮回头再练不再 +1）
      this.syncBars()
      // 不在这里重置 mode：用户挑的作答方式要一直固定着（选拼写就一路拼写）。
      // 想换方式随时点顶部胶囊 —— 那条路会写进 settings（switchMode）。
      this.selected = -1
      this.input = ''
      this.canSubmit = false
      this.answered = false
      this.result = null
      this.userAnswer = ''
      this.resultTitle = ''
      this.toneClass = ''
      this.speaking = false
      this.favOn = settings.isFavorite('word', item.id)
      // 以下几项模板里没法做"三元 + 占位符"的组合，一律在 JS 里预算成字符串
      const entry = dict.lookup(item.w)
      this.phonetic = entry && entry.phonetic ? entry.phonetic : ''
      this.statusName = t(STATUS_NAME[item.status] || '新词')
      this.meaningText = item.pos ? item.pos + ' ' + item.m : item.m
      this.masteryText = t('{m} / 5 · 见过 {n} 次', { m: item.mastery, n: item.seen })
      // 拼写关的提示：中文释义 + 首字母。以前只给释义，等于让人在整本书里猜是哪一个词；
      // 给首字母是"提示"而非"剧透" —— 能想起来的人不需要它，想不起来的人给了也想不起来
      this.spellHint = (item.m || '') + '　' + (bank.hint || '')
      this.sourceName = this.source === 'review'
        ? t('复习')
        : (this.source === 'new' ? t('新词') : t('日常'))
      // 最后一个词上的按钮要说"看结果"，提前在 JS 里算好（模板不做三元）
      this.nextText = i + 1 >= this.questions.length ? t('查看结果') : t('下一个')
      // 例句里的目标词高亮（}+1 那套 word-mark 复用，但答案里不算目标）
      const tset = targetWordSet([{ w: item.w }])
      this.exampleTokens = item.exampleEn
        ? markTokens(tokenize(item.exampleEn), this.bookSet, tset)
        : []
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false }
      this.nextText = t('下一个')
      // 自动朗读只在「认得出 / 自评」两关开：想得起和写得出考的就是自己从记忆里把词
      // 取出来，一上来先念一遍等于把答案念出来了（听到 apple 谁都能选对）
      if (this.promptIsWord) tts.speakAuto(item.w)
    },

    switchMode(e) {
      if (this.answered) return
      const m = String((e.currentTarget.dataset || {}).m || '')
      if (DRILL_MODES.indexOf(m) < 0) return
      this.mode = m
      // 记住它：下一个词、下次进页面都还是这一种。
      // 存不上（配额满等）也不影响本次作答，所以吞掉异常、只保证界面已切过去。
      try { settings.set({ study: { drillMode: m } }) } catch (err) { /* 见上 */ }
      // 三关序列跟着换（第一关用新选的，后两关轮转），并立刻按新题型重画当前这一题。
      // 已经连对过的次数不清零 —— 换了题型不等于可以少答一遍。
      if (this.session && this.session.setModes) {
        this.session.setModes(wordSession.buildModeSequence(m))
        this.setupQuestion(this.idx)
      }
      // 没有会话时（极少数兜底路径）setupQuestion 不会跑，这里补一次，
      // 保证"点胶囊 → 下面那行变"永远成立。
      // ⚠️ 有会话时绝不能在这里再算一遍：那会把"当前第几关"冲回第 0 关。
      else this.syncModePlan(0)
    },

    /**
     * 胶囊底下的"本轮三关"预览。
     * 为什么必须有：三个胶囊看起来像一排静态标签，用户点了不知道会发生什么 ——
     * 而它实际只改第一关。把三关顺序摆出来、并把"当前在第几关"标出来，
     * 点一下胶囊这一行立刻变，效果才看得见；顺带它还是个进度指示。
     */
    syncModePlan(streak) {
      const seq = wordSession.buildModeSequence(this.mode)
      const at = Math.max(0, Math.min(seq.length - 1, Number(streak) || 0))
      this.modePlan = seq.map((k, i) => ({
        // 兜底取 MODE_LABEL.recog 而不是再写一个中文字面量：
        // 同一句中文在脚本里每出现一次就多一处"静态中文"，白白推高漏网计数
        name: t(MODE_LABEL[k] || MODE_LABEL.recog),
        first: i === 0,
        on: i === at
      }))
    },

    choose(e) {
      if (this.answered) return
      const sel = Number(e.currentTarget.dataset.i)
      const pass = sel === this.curAnswerIndex
      this.selected = sel
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.curOptions[sel])
    },

    onInput(e) {
      const v = e.detail.value
      this.input = v
      this.canSubmit = !!String(v || '').trim()
    },

    // 拼写判分：大小写 / 首尾空格 / 句末标点都不算错，其余必须完全一致 ——
    // 拼写不像翻译有"意思接近"的空间，近似想过关只会把错觉练扎实
    submitSpell() {
      if (this.answered || !this.input.trim()) return
      const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\- ]/gi, '').replace(/\s+/g, ' ')
      const pass = norm(this.input) === norm(this.cur.w)
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.input.trim())
    },

    grade(e) {
      if (this.answered) return
      const s = e.currentTarget.dataset.s
      this.finish(s === 'pass' ? 'pass' : (s === 'partial' ? 'partial' : 'fail'), s === 'pass' ? 1 : 0, '')
    },

    /**
     * 一轮作答结束的统一出口。
     * 回写刻意和翻译练习走同一套（engine.recordAnswer + iplus1.recordMastery）：
     * 今日已练、连续天数、打卡走势、掌握度概览那几个口径不用再写第二份，
     * 用户在哪儿练的都会算进去。
     */
    finish(status, score, userAnswer) {
      const item = this.cur
      const bookId = this.bookId || ''
      const theWord = item.w || ''
      // 上面那条进度条：一次作答 +1（累计，改判也不回退 —— 做了就是做了）
      this.answerCount = (Number(this.answerCount) || 0) + 1
      // 合成一道"题目"喂给 recordAnswer：有例句就用例句当题干（答错时它顺理成章
      // 变成错题本里的一条翻译复习材料），没有例句就退化为单词本身。
      const q = {
        sid: 'wd-' + item.id,
        dir: 'e2c',
        prompt: item.exampleEn || theWord,
        answer: item.exampleZh || item.m,
        lv: item.lv,
        note: '',
        words: item.words,
        wordIds: item.wordIds
      }
      engine.recordAnswer(q, status, this.mode, userAnswer)
      iplus1.recordMastery(bookId, item.wordIds, status)
      // 留给「记错了」改判用（revokePass 要喂同一道题）
      this.lastQ = q

      this.answered = true
      this.userAnswer = userAnswer
      this.result = { pass: status === 'pass', partial: status === 'partial', score: Math.round(score * 100) }
      if (status === 'pass') this.counts.pass++
      else if (status === 'partial') this.counts.partial++
      else this.counts.fail++

      // 喂确认会话：pass 算认识，partial / fail 都算不认识。
      // 一遍答对不算学会 —— streak 达标才计入 doneCount（下面那条进度条 +1）
      const res = this.session ? this.session.answer(status === 'pass') : null
      if (this.session) this.doneCount = this.session.progress().done
      // 跨天巩固调度（srs）：这个词"在不在队列里"（有没有 due）决定这次算什么 ——
      //   不在队列 → 三关全过 = 第一次学会，进队列，明天来确认
      //   已在队列 → 三关全过 = 到期巩固成功，进一阶、间隔拉长
      //   已在队列但没过 → 退回第 0 阶，明天重来（不然到期了也能蒙混过关）
      const inQueue = !!(item.srs && item.srs.due)
      if (res && res.done) {
        try {
          if (inQueue) wordSession.markReviewed(bookId, item.id, true)
          else wordSession.markLearned(bookId, item.id)
        } catch (e) { console.error('[word-drill srs]', e) }
        // 每日目标的新口径：确认达标才算"学会"一笔（蒙对 / 一遍对的都不算）
        try { engine.addMasteredToday(1) } catch (e) { console.error('[word-drill addMasteredToday]', e) }
      } else if (inQueue) {
        try { wordSession.markReviewed(bookId, item.id, false) } catch (e) { console.error('[word-drill srs]', e) }
      }
      this.syncBars()
      this.knownCount = this.doneCount

      this.resultTitle = status === 'pass'
        ? (res && res.done ? t('记住了') : t('答对了，还差 {n} 关', { n: res ? Math.max(1, res.need - res.streak) : 1 }))
        : (status === 'partial' ? t('有点印象') : t('没答上来'))
      this.toneClass = status === 'pass' ? 'ok' : (status === 'partial' ? 'mid' : 'bad')
      this.nextText = this.session && this.session.isDone() ? t('查看结果') : t('下一个')
      // 掌握度在本次作答后已回写，这里取"更新后"的值显示
      const after = (wordbook.masteryMap(bookId) || {})[item.id] || {}
      this.masteryText = t('{m} / 5 · 见过 {n} 次', { m: Number(after.m) || 0, n: Number(after.seen) || 0 })
      // 巩固进度：把"这个词下次什么时候回来"直接摆在用户面前 ——
      // 间隔重复只有被看见才有意义，藏起来的调度等于没有调度
      const g = srs.stageText(after)
      this.srsText = g.graduated
        ? t('已巩固 7 / 7 次 · 出师了，不再安排复习')
        : (after.due
          ? t('已巩固 {a} / {b} 次 · 下次 {d}', { a: g.done, b: g.total, d: after.due })
          : t('还没进巩固队列，过了三关就安排'))

      let readDelay = 400
      try {
        if (sfx.play(status)) readDelay = sfx.durationOf(status) + 120
      } catch (e) { /* 音效不可用不影响答题流程 */ }
      sync.recordStudy({
        bookId: bookId,
        wordId: String(item.id || theWord),
        sentenceId: '',
        direction: 'w2c',
        mode: 'word-' + this.mode,
        result: status,
        score: Math.round(score * 100),
        userAnswer: userAnswer || '',
        reference: theWord
      })
      // 答后跟着念一遍这个词，把音和形对上（定时器由 clearAnswerTimer 统一清理）
      this.clearAnswerTimer()
      this.answerTimer = setTimeout(() => {
        this.answerTimer = 0
        if (!this.alive) return
        tts.speakAuto(theWord)
      }, readDelay)
    },

    /**
     * 「记错了」：答对了但其实是蒙的 / 手滑点错。
     * 撤销刚记的 pass 并改判为答错（掌握度净 -2、今日 correct -1、进错题本），
     * 确认会话里连击清零、进度回退，该词重新排队再练 —— 绝不让它"一遍就溜过去"。
     */
    markWrong() {
      if (!this.answered || !this.result || !this.result.pass) return
      const item = this.cur
      try {
        if (this.lastQ) engine.revokePass(this.lastQ, this.mode, this.userAnswer)
        iplus1.revokeMastery(this.bookId || '', item.wordIds)
      } catch (e) {
        console.error('[word-drill markWrong]', e)
      }
      // 会话回退：这个词原本已算"记住"的话，今日「学会」那一笔也要撤掉
      let rolledBack = false
      const r = this.session ? this.session.markWrong(item.id) : null
      rolledBack = !!(r && r.rolledBack)
      if (rolledBack) {
        try { engine.addMasteredToday(-1) } catch (e) { console.error('[word-drill addMasteredToday]', e) }
      }
      this.counts.pass = Math.max(0, this.counts.pass - 1)
      this.counts.fail++
      if (this.session) this.doneCount = this.session.progress().done
      this.syncBars()
      this.knownCount = this.doneCount
      this.result = { pass: false, partial: false, score: 0 }
      this.resultTitle = t('记错了，稍后再来一遍')
      this.toneClass = 'bad'
      this.nextText = this.session && this.session.isDone() ? t('查看结果') : t('下一个')
      const after = (wordbook.masteryMap(this.bookId) || {})[item.id] || {}
      this.masteryText = t('{m} / 5 · 见过 {n} 次', { m: Number(after.m) || 0, n: Number(after.seen) || 0 })
      try { sfx.play('fail') } catch (e) { /* 音效不可用不影响改判 */ }
      uni.showToast({ title: t('已记为没记住'), icon: 'none' })
    },

    // 点读例句里的单词：查词义 + 发音
    tapWord(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      const raw = d.w || ''
      if (!raw.trim()) return
      const entry = dict.lookup(raw)
      this.pop = {
        show: true,
        word: entry.w || raw,
        pos: entry.pos || '',
        meaning: entry.meaning || '',
        phonetic: entry.phonetic || '',
        srcLabel: dict.SRC_LABEL[entry.src] || '',
        found: !!entry.found
      }
      tts.speakWord(dict.speakForm(raw))
    },

    closePop() {
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false }
    },

    noop() {},

    sayWord() {
      const w = this.cur.w
      if (!w) return
      tts.speakWord(dict.speakForm(w))
    },

    // 重听（例句 / 弹窗里的词）：用户主动触发，force=true 永不被节流吞掉
    replay(e) {
      const text = e.currentTarget.dataset.text
      if (!text) { this.speaking = false; return }
      tts.speakSentence(text, { onDone: () => { this.speaking = false } })
      this.speaking = true
    },

    toggleFav() {
      const item = this.cur
      if (!item || !item.id) return
      // payload 与词库页 / 单词详情页同一套：type=word + word/meaning，
      // 「我的收藏」页按这份结构渲染，换了字段名收藏会变成空白条目
      const payload = {
        type: 'word',
        id: String(item.id),
        word: item.w || '',
        meaning: item.m || ''
      }
      const wasOn = this.favOn
      settings.toggleFavorite(payload)
      try {
        if (wasOn) sync.unmirrorFavorite('word', String(item.id))
        else sync.mirrorFavorite(payload)
      } catch (e) { /* 未登录 / 库不可用时只存本地 */ }
      this.favOn = !wasOn
    },

    openDetail() {
      const w = String(this.cur.w || '').trim().toLowerCase()
      if (!w) return
      uni.navigateTo({
        url: '/pkgManage/pages/word-detail/word-detail?w=' + encodeURIComponent(w) +
          '&id=' + encodeURIComponent(String(this.cur.id || '')) +
          '&book=' + encodeURIComponent(String(this.bookId || ''))
      })
    },

    // 本组总结：多次确认机制下，组结束 = 所有词都确认完成（X / X 恒满），
    // 有信息量的是总作答次数与答错次数（体现重复巩固的量）
    finishSummary() {
      const c = wordSession.counts(this.bookId)
      const n = this.counts.pass + this.counts.partial + this.counts.fail
      this.summaryText = t('共作答 {a} 次 · 答错 {b} 次', { a: n, b: this.counts.fail })
      this.progressText = t('全书 {t} 词：已掌握 {m} 个，待巩固 {l} 个', {
        t: c.total, m: c.mastered, l: c.new + c.learning
      })
      this.knownCount = this.session ? this.session.progress().done : this.counts.pass
      this.finished = true
    },

    next() {
      if (this.session && !this.session.isDone()) {
        this.setupByItem(this.session.current())
        return
      }
      this.finishSummary()
    },

    restart() {
      if (!this.alive) return
      this.start(this.source)
    },

    goHome() {
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
/* 顶部双进度：两条同分母，上面「已练」下面「记住」。
   不用全局的 .topbar —— 那是练习页的横排布局，这里要竖着放两条。 */
.wd-top { margin-bottom: 24rpx; }

.wd-bar { display: flex; align-items: center; }
.wd-bar + .wd-bar { margin-top: 14rpx; }

.wd-bar-k {
  flex-shrink: 0;
  width: 72rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-track { flex: 1; height: 10rpx; margin: 0 16rpx; }

.wd-bar-v {
  flex-shrink: 0;
  min-width: 100rpx;
  text-align: right;
  font-size: 22rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* 两条进度条的颜色（设置 → 外观 → 练习进度条「两条进度条同色系」）。
   sync  同色系：已做 = 主题色的浅版，已会 = 主题色实心（整体跟主题走，深浅区分）
   split 分开：  已做 = 主题色，已会 = 「成了」的绿色（色相区分，色弱也分得清）
   颜色一律走 CSS 变量（--brand / --brand-rgb 由 theme.js 下发），
   换主题色、切深色模式都自动跟着变，不写死任何色值。 */
.wd-top.sync .wd-bar.done .progress-fill {
  background: #b9cdff;
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.38);
}
.wd-top.sync .wd-bar.know .progress-fill {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}
.wd-top.sync .wd-bar.know .wd-bar-k,
.wd-top.sync .wd-bar.know .wd-bar-v {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.wd-top.split .wd-bar.done .progress-fill {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}
.wd-top.split .wd-bar.know .progress-fill { background: #2f9e6e; }
.wd-top.split .wd-bar.know .wd-bar-k,
.wd-top.split .wd-bar.know .wd-bar-v { color: #2f9e6e; }

.wd-switch {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 14rpx;
}

.wd-switch.locked { opacity: 0.5; }

.wd-sw {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 选中态用实心主色，不再只是"白底 + 蓝字" ——
   后者在一排胶囊里区分度太弱，用户会以为那三个只是标签、点了没反应。 */
.wd-sw.active {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2rpx 8rpx rgba(46, 107, 255, 0.28);
}

/* ===== 本轮三关预览 =====
   三个胶囊只决定第一关，这个事实光看胶囊是看不出来的 ——
   把它摆成一行，点哪一档这一行就当场变，效果才"看得见"。 */
.wd-plan {
  display: flex;
  align-items: center;
  padding: 0 12rpx;
}
.wd-plan-k {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-right: 12rpx;
  flex-shrink: 0;
}
.wd-plan-list { display: flex; align-items: center; flex: 1; }
.wd-plan-sep {
  font-size: 22rpx;
  color: #c8cdc9;
  color: var(--ink-3, #98a19b);
  margin: 0 8rpx;
}
.wd-plan-i {
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
}
/* 第一关 = 上面胶囊选的那一档，标成主色，把"选择 → 结果"这条因果画出来 */
.wd-plan-i.first {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
  font-weight: 500;
}
/* 当前所处的一关加一圈描边（和"第一关"可能不是同一个：答错过会退回第一关，
   但序列本身没变，所以两者分开标） */
.wd-plan-i.on {
  border: 2rpx solid #2e6bff;
  border: 2rpx solid var(--brand, #2e6bff);
}
.wd-plan-hint {
  display: block;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 0 12rpx;
  margin-top: 6rpx;
  margin-bottom: 20rpx;
}

.pos-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.pos-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.lv-tag { background: rgba(23, 32, 26, 0.07); color: #5a6560; margin-left: 12rpx; }
.lv-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); margin-left: 12rpx; }

.st-tag { margin-left: 12rpx; background: rgba(23, 32, 26, 0.07); color: #5a6560; }
.st-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); }
.st-tag.new { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.st-tag.new { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); }
.st-tag.familiar { background: rgba(124, 58, 237, 0.14); color: #7c3aed; }
.st-tag.mastered { background: rgba(47, 158, 110, 0.16); color: #2f9e6e; }

.src-tag { background: rgba(247, 144, 9, 0.14); color: #b54708; margin-left: 16rpx; }

/* 同一个词第二次出现（确认轮）：紫色标签区别于初见 */
.again-tag { margin-left: 12rpx; background: rgba(124, 58, 237, 0.12); color: #7c3aed; font-weight: 600; }

/* 三关进度标签：「第 2 / 3 关 · 想得起」。用琥珀色和"再确认"（紫）区分开：
   紫色说的是"这词又来了"，琥珀色说的是"现在在第几关、考的是哪种提取方式" */
.mode-tag {
  margin-left: 12rpx;
  background: rgba(247, 144, 9, 0.14);
  color: #f79009;
  font-weight: 600;
}

/* 「记错了」：答对后的反悔入口 */
.wd-wrong {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
  padding: 20rpx 8rpx;
  margin-left: 4rpx;
}

.wd-meta { display: flex; align-items: center; margin-bottom: 20rpx; }

.wd-say {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 24rpx;
}

.wd-say:active { background: rgba(46, 107, 255, 0.12); }
.wd-say:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.wd-say.small { margin-left: 16rpx; font-size: 22rpx; padding: 2rpx 18rpx; }

/* 主词：整页最大的字，衬线体 —— 不背单词那一类的第一眼焦点 */
.wd-word {
  text-align: center;
  font-size: 72rpx;
  line-height: 1.3;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  word-break: break-all;
}

/* 「想得起 / 写得出」两关的题干是中文释义：中文字号要收一档，
   72rpx 的中文会顶满两行、把下面的选项挤下去 */
.wd-word.wd-word-zh {
  font-size: 44rpx;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: 0 24rpx;
}

.wd-ph {
  display: block;
  text-align: center;
  margin-top: 6rpx;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-opts { margin-top: 32rpx; }

.wd-opt {
  display: flex;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-radius: 24rpx;
  padding: 26rpx 28rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 8rpx 24rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 8rpx 24rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.wd-opt-hover { background: rgba(46, 107, 255, 0.1); }
.wd-opt-hover { background: rgba(var(--brand-rgb, 46, 107, 255), 0.1); }

.wd-opt.correct { border-color: #2e6bff; background: rgba(46, 107, 255, 0.13); }
.wd-opt.correct { border-color: var(--brand, #2e6bff); background: rgba(var(--brand-rgb, 46, 107, 255), 0.13); }

.wd-opt.wrong { border-color: #e5484d; background: rgba(229, 72, 77, 0.1); }

.wd-ol {
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 24rpx;
  font-weight: 600;
  margin-right: 20rpx;
}

.wd-opt.correct .wd-ol { background: #2e6bff; color: #ffffff; }
.wd-opt.correct .wd-ol { background: var(--brand, #2e6bff); color: #ffffff; }
.wd-opt.wrong .wd-ol { background: #e5484d; color: #ffffff; }

.wd-ot { flex: 1; font-size: 30rpx; line-height: 1.55; color: #17201a; }
.wd-ot { color: var(--ink-1, #17201a); }

/* 反向题（想得起）的选项是英文单词：换衬线体、字号收一档 ——
   英文词普遍比中文释义长，四个选项都按 30rpx 撑会挤到换行 */
.wd-opt.en .wd-ot {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28rpx;
}

.wd-hint {
  display: block;
  margin: 24rpx 0 16rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 140rpx;
  font-size: 34rpx;
  line-height: 1.5;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
}

.wd-submit { margin-top: 24rpx; height: 88rpx; font-size: 30rpx; }

.wd-self-row { display: flex; margin-top: 20rpx; }

.wd-grade {
  flex: 1;
  text-align: center;
  padding: 22rpx 0;
  margin: 0 8rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.wd-grade:first-child { margin-left: 0; }
.wd-grade:last-child { margin-right: 0; }
.wd-grade.know { color: #2f9e6e; border-color: rgba(47, 158, 110, 0.4); }
.wd-grade.fuzzy { color: #f79009; border-color: rgba(247, 144, 9, 0.4); }
.wd-grade.forgot { color: #e5484d; border-color: rgba(229, 72, 77, 0.4); }
.wd-grade:active { opacity: 0.8; }

.wd-reveal { margin-top: 24rpx; }

.wd-rv-head { display: flex; align-items: center; margin-bottom: 18rpx; }

.wd-rv-title { font-size: 34rpx; font-weight: 600; }
.wd-rv-head.ok .wd-rv-title { color: #2f9e6e; }
.wd-rv-head.mid .wd-rv-title { color: #f79009; }
.wd-rv-head.bad .wd-rv-title { color: #e5484d; }

.wd-rv-score { margin-left: 16rpx; font-size: 24rpx; color: #98a19b; }
.wd-rv-score { color: var(--ink-3, #98a19b); }

.wd-row { display: flex; align-items: flex-start; margin-bottom: 14rpx; }

.wd-k {
  flex-shrink: 0;
  width: 120rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-v { flex: 1; font-size: 28rpx; line-height: 1.6; color: #5a6560; }
.wd-v { color: var(--ink-2, #5a6560); }

.wd-v.strong {
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-size: 32rpx;
  font-weight: 500;
}

.wd-ex {
  margin-top: 6rpx;
  padding: 20rpx 24rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-left: 6rpx solid #2e6bff;
  border-left-color: var(--brand, #2e6bff);
  border-radius: 16rpx;
}

.wd-ex-head { display: flex; align-items: center; }
.wd-ex-head .wd-k { width: auto; margin-right: 16rpx; }

.wd-ex-en { margin-top: 10rpx; }

.wd-tok,
.wd-pun {
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-size: 30rpx;
  line-height: 1.7;
}

.wd-pun { color: #17201a; }
.wd-pun { color: var(--ink-1, #17201a); }

.wd-tok { color: #17201a; border-bottom: 2rpx dashed #bfd4ff; }
.wd-tok { color: var(--ink-1, #17201a); }

.wd-tok:active { background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.wd-tok:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

/* 目标词（也就是正在刷的这个词）：底色 + 加粗，一眼看见它在句子里的样子 */
.wd-tok.tg {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
  background: rgba(46, 107, 255, 0.14);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
  border-bottom: 2rpx solid transparent;
  border-radius: 6rpx;
}

.wd-tok.bk {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  border-bottom: 2rpx solid rgba(46, 107, 255, 0.45);
  border-bottom-color: rgba(var(--brand-rgb, 46, 107, 255), 0.45);
}

.wd-ex-zh {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-fav { text-align: center; padding: 16rpx 0 6rpx; }

.wd-fav-star { font-size: 26rpx; color: #98a19b; }
.wd-fav-star { color: var(--ink-3, #98a19b); }
.wd-fav-star.on { color: #f79009; }

.wd-act { display: flex; align-items: center; margin-top: 12rpx; }

.wd-detail {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 20rpx 8rpx;
}

.wd-next { flex: 1; margin-left: 20rpx; height: 88rpx; font-size: 30rpx; }

.wd-summary { padding: 10rpx 0; }

.wd-sum-card { text-align: center; }

.wd-sum-title {
  display: block;
  font-size: 30rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-sum-num {
  display: block;
  margin-top: 18rpx;
  font-size: 84rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.wd-sum-total { font-size: 32rpx; color: #98a19b; font-weight: 400; }
.wd-sum-total { color: var(--ink-3, #98a19b); }

.wd-sum-sub { display: block; margin-top: 12rpx; font-size: 26rpx; color: #5a6560; }
.wd-sum-sub { color: var(--ink-2, #5a6560); }

.wd-sum-foot { display: block; margin-top: 10rpx; font-size: 24rpx; color: #98a19b; }
.wd-sum-foot { color: var(--ink-3, #98a19b); }

.wd-sum-sep { display: block; margin-top: 18rpx; font-size: 22rpx; color: #98a19b; }
.wd-sum-sep { color: var(--ink-3, #98a19b); }

.wd-sum-btn { margin-top: 24rpx; }

.wd-pop-word { font-size: 44rpx; font-weight: 600; color: #17201a; }
.wd-pop-word { color: var(--ink-1, #17201a); font-family: Georgia, "Times New Roman", serif; }

.wd-pop-ph { display: block; margin-top: 6rpx; font-size: 26rpx; color: #98a19b; }
.wd-pop-ph { color: var(--ink-3, #98a19b); }

.wd-pop-meaning { display: block; margin-top: 18rpx; font-size: 30rpx; color: #5a6560; }
.wd-pop-meaning { color: var(--ink-2, #5a6560); }

.wd-pop-none { display: block; margin-top: 18rpx; font-size: 28rpx; color: #98a19b; }
.wd-pop-none { color: var(--ink-3, #98a19b); }

.wd-pop-src { display: block; margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.wd-pop-src { color: var(--ink-3, #98a19b); }

.wd-pop-replay {
  display: inline-block;
  margin-top: 26rpx;
  font-size: 26rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border-color: rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 10rpx 32rpx;
}

.wd-empty-text {
  display: block;
  margin-top: 80rpx;
  font-size: 28rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  text-align: center;
}

.wd-empty-btn { margin-top: 60rpx; }
</style>
