<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle" v-if="!empty">
    <float-navbar :title="$t('翻译练习')" />

    <!-- 答题流程 -->
    <block v-if="!finished">
      <!-- 顶部两条进度。
           上面「已做」：累计作答次数，从零开始累加、不带分母（同一个词/同一句反复
           确认也照记；改判不回退）。进度条按"每做完一轮（= 本组题量）"循环填充。
           下面「会了」：确认通过的题数，有上限（= 本组题量）。
           一遍答对不算会 —— 句子对了还得认出目标词（见下面的确认题），
           漏一个就只是"做了"，不会往"会了"上加。
           颜色由设置页「两条进度条同色系」决定（见 .pb-top.sync / .pb-top.split）。 -->
      <view class="pb-top" :class="barsSync ? 'sync' : 'split'">
        <view class="pb-bar done">
          <text class="pb-k">{{ $t('已做') }}</text>
          <view class="progress-track pb-track">
            <view class="progress-fill" :style="{ width: answerPct + '%' }"></view>
          </view>
          <text class="pb-v">{{ answerText }}</text>
        </view>
        <view class="pb-bar know">
          <text class="pb-k">{{ $t('会了') }}</text>
          <view class="progress-track pb-track">
            <view class="progress-fill" :style="{ width: correctCount / questions.length * 100 + '%' }"></view>
          </view>
          <text class="pb-v">{{ correctCount }} / {{ questions.length }}</text>
        </view>
      </view>

      <!-- 题干（英文题干支持点读） -->
      <view class="card q-card">
        <view class="q-meta">
          <text class="tag dir-tag">{{ q.dir === 'e2c' ? $t('英译汉') : $t('汉译英') }}</text>
          <text class="tag lv-tag">难度 Lv{{ q.lv }}</text>
          <text class="tag src-tag" v-if="source === 'review'">{{ $t('错题重练') }}</text>
          <text class="tag src-tag drill-tag" v-else-if="source === 'drill'">{{ $t('AI 专练') }}</text>
          <view class="replay-btn" :data-text="q.prompt" @tap="replay">{{ $t('重听') }}</view>
        </view>
        <view class="prompt" v-if="promptIsEn">
          <text
            v-for="(item, index) in promptTokens"
            :key="index"
            :class="item.w ? (item.target ? 'tok tg' : (item.book ? 'tok bk' : 'tok')) : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="prompt" v-else>{{ q.prompt }}</view>
        <view class="prompt-tip" v-if="promptIsEn">{{ $t('点击单词可查看词义并听发音') }}</view>
        <!-- 标注图例：句子里哪类词被标了出来 -->
        <view class="mark-legend" v-if="markCount.book">
          <text class="lg tg">{{ $t('本题目标词') }}</text>
          <text class="lg bk" v-if="markCount.book > markCount.target">{{ $t('词库已收') }}</text>
          <text class="lg-note">{{ markNote }}</text>
        </view>
      </view>

      <!-- 作答方式切换 -->
      <view class="mode-switch" :class="{ locked: answered }">
        <view class="mode-item" :class="{ active: mode === 'choice' }" data-m="choice" @tap="switchMode">{{ $t('选择题') }}</view>
        <view class="mode-item" :class="{ active: mode === 'input' }" data-m="input" @tap="switchMode">{{ $t('手动输入') }}</view>
      </view>

      <!-- 选择题模式 -->
      <view class="options" v-if="mode === 'choice'">
        <view
          v-for="(item, index) in options"
          :key="index"
          class="option"
          :class="{
            correct: answered && index === q.answerIndex,
            wrong: answered && selected === index && index !== q.answerIndex
          }"
          :data-i="index"
          @tap="choose"
          hover-class="option-hover"
        >
          <text class="option-label">{{ labels[index] }}</text>
          <!-- 中文选项整段渲染 -->
          <text v-if="!optionIsEn[index]" class="option-text">{{ item }}</text>
          <!-- 英文选项按单词拆分，支持点读（作答后点单词看词义/发音，未作答点单词=选中该项） -->
          <text v-else class="option-text">
            <text
              v-for="(tk, k) in optionTokens[index]"
              :key="k"
              :class="tk.w ? 'tok' : 'pun'"
              :data-w="tk.t"
              :data-isw="tk.w"
              :data-opt="index"
              @tap.stop="onOptionTokenTap"
            >{{ tk.t }}</text>
          </text>
        </view>
      </view>

      <!-- 手动输入模式 -->
      <view class="card input-card" v-else>
        <textarea
          class="answer-input"
          :placeholder="$t('请输入你的完整翻译...')"
          :value="input"
          @input="onInput"
          :disabled="answered"
          auto-height
          maxlength="300"
        />
        <button v-if="!answered" class="btn-primary submit-btn" @tap="submitInput" :disabled="!canSubmit">{{ $t('提交答案') }}</button>
      </view>

      <!-- 结果与解析 -->
      <view v-if="answered" class="card result-card">
        <view class="result-title" :class="result.pass ? 'ok' : (result.partial ? 'mid' : 'bad')">
          {{ result.pass ? $t('回答正确') : (result.partial ? $t('基本正确，继续打磨') : $t('回答有误')) }}
          <text class="result-score" v-if="mode === 'input' && !confirming">匹配度 {{ result.score }}%</text>
        </view>

        <!-- 目标词确认（不背单词机制）：句子对了不算学会，目标词也要认得出、想得起 -->
        <view class="confirm-block" v-if="confirming">
          <view class="cb-head">{{ confirmTitle }}</view>
          <view class="cb-word" :class="{ zh: confirmItem && confirmItem.mode === 'recall' }">{{ confirmPrompt }}</view>
          <view class="cb-opts">
            <view
              v-for="(item, i) in confirmItem.options"
              :key="i"
              class="cb-opt"
              :class="{
                correct: confirmSelected >= 0 && i === confirmItem.answerIndex,
                wrong: confirmSelected === i && i !== confirmItem.answerIndex
              }"
              :data-i="i"
              @tap="confirmChoose"
              hover-class="cb-opt-hover"
            >
              <text class="cb-label">{{ labels[i] }}</text>
              <text class="cb-text">{{ item }}</text>
            </view>
          </view>
          <view class="cb-note">{{ $t('两关都对才算真正记住本题的目标词') }}</view>
        </view>

        <view class="result-row" v-if="mode === 'input' && !confirming">
          <text class="result-label">{{ $t('你的答案') }}</text>
          <text class="result-value">{{ userAnswer }}</text>
        </view>
        <view class="result-row" v-if="!confirming">
          <view class="result-label-row">
            <text class="result-label">{{ $t('参考答案') }}</text>
            <view class="replay-btn small" :data-text="q.answer" @tap="replay">{{ speaking ? $t('播放中…') : $t('重听') }}</view>
          </view>
          <view class="result-value ref" v-if="answerIsEn">
            <text
              v-for="(item, index) in answerTokens"
              :key="index"
              :class="item.w ? (item.target ? 'tok tg' : (item.book ? 'tok bk' : 'tok')) : 'pun'"
              :data-w="item.t"
              :data-isw="item.w"
              @tap.stop="tapWord"
            >{{ item.t }}</text>
          </view>
          <text class="result-value ref" v-else>{{ q.answer }}</text>
        </view>
        <view class="note" v-if="q.note && !confirming">解析：{{ q.note }}</view>
        <!-- 确认期间藏起词义 chips（里面就是答案） -->
        <view class="word-chips" v-if="!confirming">
          <view class="chip" v-for="item in q.words" :key="item.id" :data-text="item.w" @tap="replay">{{ item.w }} {{ item.pos }}{{ item.m }}</view>
        </view>
        <view class="fav-row" v-if="!confirming" @tap="toggleFav">
          <text class="fav-star" :class="{ on: favOn }">{{ favOn ? $t('★ 已收藏') : $t('☆ 收藏本题') }}</text>
        </view>
        <view class="ai-block" :class="{ disabled: !aiEnabled }" v-if="!confirming">
          <view class="ai-head" @tap="toggleCritique">
            <text class="ai-title">{{ $t('AI 点评') }}</text>
            <text class="ai-sub">{{ aiEnabled ? $t('基于你本次作答') : aiReason }}</text>
            <text class="ai-chevron">{{ critiqueOpen ? $t('收起 ›') : $t('展开 ›') }}</text>
          </view>
          <view v-if="critiqueOpen" class="ai-body">
            <view v-if="critiqueLoading" class="ai-loading">
              <view class="loading-spinner small"></view>
              <text class="ai-loading-text">{{ $t('AI 正在点评…') }}</text>
            </view>
            <block v-else-if="critique">
              <view class="ai-comment">{{ critique.comment }}</view>
              <view class="ai-improved" v-if="critique.improved">改进译文：{{ critique.improved }}</view>
            </block>
            <view v-else-if="critiqueError" class="ai-error">{{ critiqueError }}</view>
          </view>
        </view>
        <view class="next-row" v-if="!confirming">
          <!-- 答对了但其实是蒙的：反悔改判，按答错记录 -->
          <text class="wrong-btn" v-if="result && result.pass" @tap="markWrong">{{ $t('记错了') }}</text>
          <button class="btn-primary next-btn" @tap="next">{{ idx + 1 === questions.length ? $t('查看结果') : $t('下一题') }}</button>
        </view>
      </view>
    </block>

    <!-- 本组总结 -->
    <view v-else class="summary">
      <view class="card summary-card">
        <view class="summary-title">{{ $t('本组练习完成') }}</view>
        <!-- 上面那个大数字就是"会了多少题"（确认通过的），所以副标题别再写"正确率"——
             一遍蒙对、确认没认出来的都不算会，两个口径已经不是一回事了 -->
        <view class="summary-score">{{ correctCount }}<text class="summary-total"> / {{ questions.length }}</text></view>
        <view class="summary-sub">{{ $t('学会 {a} / {b} 题 · 掌握度已更新', { a: correctCount, b: questions.length }) }}</view>
        <button class="btn-primary summary-btn" @tap="restart">{{ $t('再练一组') }}</button>
        <button class="btn-ghost summary-btn" @tap="goHome">{{ $t('返回首页') }}</button>
      </view>
    </view>

    <!-- 例句生成加载态（AI 生成可能有 1-3 秒延迟） -->
    <view class="loading-mask" v-if="loading">
      <view class="loading-card">
        <view class="loading-spinner"></view>
        <text class="loading-text">{{ $t('正在按 i+1 规则生成例句…') }}</text>
      </view>
    </view>

    <!-- 点读单词弹窗 -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <view class="pop-word">{{ pop.word }}</view>
        <view class="pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="pop-meaning none" v-else>{{ $t('未收录（仍可发音）') }}</view>
        <view class="pop-meta" v-if="pop.found">
          <text class="pop-src">{{ pop.srcLabel }}</text>
          <text class="pop-lemma" v-if="pop.inflected">原形 {{ pop.lemma }}</text>
        </view>
        <view class="pop-replay" :data-text="pop.word" @tap="replay">{{ $t('再听一次') }}</view>
      </view>
    </view>
  </view>

  <!-- 空状态 -->
  <view v-else class="empty page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('翻译练习')" />
    <view class="empty-text">{{ emptyText }}</view>
    <button class="btn-primary empty-btn" @tap="goHome">{{ $t('返回首页') }}</button>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import * as engine from '../../../utils/engine'
import * as session from '../../../utils/session'
import * as iplus1 from '../../../utils/iplus1'
import * as wordbook from '../../../utils/wordbook'
import * as wordSession from '../../../utils/word-session'
import * as judge from '../../../utils/judge'
import * as tts from '../../../services/voice'
import { barsSyncColors } from '../../../utils/theme.js'
import { aiGateReason } from '../../../services/config.js'
import { critiqueTranslation } from '../../../services/ai-content.js'
import * as dict from '../../../utils/dict'
import * as settings from '../../../utils/settings'
import * as sync from '../../../services/account-sync'
import { tokenize, isEnglish } from '../../../utils/tokenize'
import { bookWordSet, targetWordSet, markTokens, countMarked } from '../../../utils/word-mark'
import * as sfx from '../../../utils/sfx.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

/* ---------- 作答方式：选择题 / 手动输入 ----------
   和刷单词页同一条规矩（见 word-drill.vue）：选了就一直固定着 ——
   随手改成「手动输入」的人，不该每题都被弹回选择题重挑一次。
   存在 settings.study.practiceMode，换题 / 下次进页面都保持；
   顶部胶囊一直可见可点，想换随时点。脏值由 settings.studyMode() 统一回落。 */
const PRACTICE_MODES = ['choice', 'input']

export default {
  components: { FloatNavbar },
  data() {
    return {
      labels: ['A', 'B', 'C', 'D'],
      source: 'daily',
      questions: [],
      idx: 0,
      q: { dir: '', lv: 1, prompt: '', answer: '', options: [], answerIndex: 0, note: '', words: [] },
      options: [],
      // 进页面就恢复上次用的作答方式（与刷单词页同一套，见文件顶端说明）
      mode: settings.studyMode('practiceMode', PRACTICE_MODES, 'choice'),
      selected: -1,
      input: '',
      canSubmit: false,
      answered: false,
      result: null,
      userAnswer: '',
      // 目标词二次确认（不背单词机制）：句子答对先不落账，等确认结果
      confirming: false,
      pendingPass: null,
      // 确认题现在是**两道**：先「认得出」（词→选中文），再「想得起」（中文→选英文）。
      // 句子答对只说明会在语境里用它，不等于这个词的形、义、反向提取都通了 ——
      // 两关换的是提取方向，第二关比第一关难一档。
      confirmItems: [],
      confirmIdx: 0,
      confirmItem: null,
      confirmSelected: -1,
      // 「第 1 / 2 关 · 认得出」与这一关的题干（认得出给单词，想得起给中文释义）
      confirmTitle: '',
      confirmPrompt: '',
      // 切关之间的短延时（让人看清自己选对了再换下一关），页面离开时清掉
      confirmTimer: 0,
      // 下面那条进度条的分子 = 确认通过（真正算学会）的题数
      correctCount: 0,
      // 上面那条：累计作答次数（只增不减、不带分母；改判也不回退 —— 做了就是做了）
      answerCount: 0,
      answerPct: 0,
      answerText: '',
      // 两条进度条的颜色模式（设置页「两条进度条同色系」）：sync / split
      barsSync: true,
      finished: false,
      empty: false,
      emptyText: '',
      promptIsEn: false,
      promptTokens: [],
      // 当前词书的词汇集合：句子里哪些词是词书里的，靠它标出来
      bookSet: {},
      // 本题句子里的词书词统计（给图例那句话用）
      markCount: { book: 0, target: 0 },
      markNote: '',
      answerIsEn: false,
      answerTokens: [],
      optionIsEn: [],
      optionTokens: [],
      pop: { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' },
      loading: false,
      // 页面还"活着"吗：onUnload 置 false，用来掐断出题这类可能耗时几秒的异步。
      // 出题完成后会 setupQuestion → 自动朗读题目，页面都退出了还在响就是个 bug。
      alive: true,
      bookId: '',
      answerTimer: 0,
      speaking: false,
      favOn: false,
      aiEnabled: false,
      aiReason: '',
      critiqueOpen: false,
      critiqueLoading: false,
      critique: null,
      critiqueError: ''
    }
  },
  async onLoad(opt) {
    try {
      this.bookId = wordbook.currentBookId()
      const r = aiGateReason()
      this.aiReason = r
      this.aiEnabled = !r
      const src = opt && opt.source
      await this.start(src === 'review' ? 'review' : (src === 'drill' ? 'drill' : 'daily'))
    } catch (e) {
      // 出错可见化：不再无声空白，方便定位（正常情况不会走到这里）
      console.error('[practice onLoad]', e)
      this.loading = false
      this.empty = true
      this.emptyText = t('页面加载失败：') + String((e && e.message) || e)
    }
  },

  onShow() {
    // 从设置页改完配色回来要生效（页面是 navigateTo 打开的，返回时走 onShow）
    try { this.barsSync = barsSyncColors() } catch (e) { this.barsSync = true }
  },

  onHide() { this.clearAnswerTimer(); tts.stop() },
  onUnload() {
    // 页面销毁：先置 alive=false，让还在跑的出题（可能正卡在 AI 请求上）
    // 走 shouldStop 提前收尾，回来也不会再朗读题目
    this.alive = false
    this.clearAnswerTimer()
    tts.stop()
  },

  methods: {
    // 清理"作答后延迟朗读参考答案"的定时器，避免切题后仍触发上一题的语音。
    // 确认题切关的短延时也一并清掉（onHide / onUnload 都走这里）：
    // 人在确认区点了一关就切走了，定时器再把人拉回落账是很怪的。
    clearAnswerTimer() {
      if (this.answerTimer) {
        clearTimeout(this.answerTimer)
        this.answerTimer = 0
      }
      this.clearConfirmTimer()
    },

    /** 每组题量：取当前词书的每日练习目标，夹在 5-50 之间防止极端值 */
    sessionSize() {
      try {
        const g = wordbook.getGoal(this.bookId)
        const n = Number(g && g.practice) || 10
        return Math.max(5, Math.min(50, n))
      } catch (e) {
        return 10
      }
    },

    async start(source) {
      // 当前词书一个词都没有（如刚新建的自建词书）→ 明确提示，避免空转
      if (source !== 'review' && !wordbook.bookWords(this.bookId).length) {
        this.empty = true
        this.finished = false
        this.emptyText = t('当前词书还没有词汇，请到「词库 → 导入单词」粘贴单词或用 AI 生成')
        return
      }
      // 每组题量 = 该词书的「每日学会题量」目标（词库详情 → 每日目标 可调）
      const size = this.sessionSize()
      let qs = []
      if (source === 'review') {
        qs = engine.reviewQuestions()
      } else if (source === 'drill') {
        // AI 薄弱点专练：围绕未掌握词生成（失败回落到通用链路）
        this.loading = true
        try {
          qs = await session.buildDrillSession(size, this.bookId, () => !this.alive)
        } catch (e) {
          qs = []
        }
        this.loading = false
        // 退出得早：别再往下走兜底链路（那会再发一轮 AI 请求）
        if (!this.alive) return
        if (!qs.length) {
          // 兜底：没有可生成的内容时退回日常练习
          this.loading = true
          try { qs = await session.buildSession(size, this.bookId, () => !this.alive) } catch (e) { qs = engine.dailyQuestions(size) }
          this.loading = false
        }
      } else {
        // 走 i+1 链路：AI 生成 → 缓存 → 本地语料（可能耗时，展示加载态）
        this.loading = true
        try {
          qs = await session.buildSession(size, this.bookId, () => !this.alive)
        } catch (e) {
          qs = engine.dailyQuestions(size)
        }
        this.loading = false
      }
      // 出题期间页面被关掉了：到此为止。
      // 再往下就会 setupQuestion → 自动朗读题目，表现为"退出后还在出题、还有声音"。
      if (!this.alive) return
      if (!qs.length) {
        this.empty = true
        this.finished = false
        this.emptyText = source === 'review' ? t('太棒了，当前没有错题！') : t('暂时没有可练习的题目')
        return
      }
      this.source = source
      this.questions = qs
      this.correctCount = 0
      this.answerCount = 0
      this.answerPct = 0
      this.answerText = t('{n} 题', { n: 0 })
      this.finished = false
      this.empty = false
      this.setupQuestion(0)
    },

    setupQuestion(i) {
      const q = this.questions[i]
      const promptIsEn = isEnglish(q.prompt)
      const answerIsEn = isEnglish(q.answer)
      this.clearAnswerTimer()
      this.idx = i
      this.q = q
      this.options = q.options
      // 不在这里重置 mode：用户挑的作答方式要一直固定着（选手动输入就一路手动输入）。
      // 想换方式随时点顶部胶囊 —— 那条路会写进 settings（switchMode）。
      this.selected = -1
      this.input = ''
      this.canSubmit = false
      this.answered = false
      this.result = null
      this.userAnswer = ''
      // 确认态随题重置
      this.confirming = false
      this.pendingPass = null
      this.confirmItem = null
      this.confirmSelected = -1
      // 词书词汇集合算一次就够（做题期间词书不变）
      if (!this.bookSet || !Object.keys(this.bookSet).length) {
        this.bookSet = bookWordSet(this.bookId || q.bookId || '')
      }
      // 目标词 = 本题要练的词（i+1 生词 / AI 专练指定词）；其余词书词单独一档
      const tset = targetWordSet(q.words)
      this.promptIsEn = promptIsEn
      this.promptTokens = promptIsEn ? markTokens(tokenize(q.prompt), this.bookSet, tset) : []
      this.answerIsEn = answerIsEn
      this.answerTokens = answerIsEn ? markTokens(tokenize(q.answer), this.bookSet, tset) : []
      // 选项是否英文需在 JS 里预判断（模板不支持表达式调用），英文选项按单词拆分以支持点读
      this.optionIsEn = (q.options || []).map(t => isEnglish(t))
      // 英文选项只做分词（支持点读），【不带词书标注】：汉译英时选项就是候选答案，
      // 标出「本题目标词/词库已收」等于把正确答案高亮给用户看
      this.optionTokens = (q.options || []).map(t => (isEnglish(t) ? tokenize(t) : []))
      // 图例上的计数取"英文那一侧"的句子（汉译英时题干是中文，答案才是英文）
      this.markCount = countMarked(promptIsEn ? this.promptTokens : this.answerTokens)
      // 提示语在 JS 里算好：模板里没法做三元 + 占位符的组合
      const bn = this.markCount.book
      this.markNote = bn
        ? (promptIsEn ? t('本句含 {n} 个词库词', { n: bn }) : t('参考答案含 {n} 个词库词', { n: bn }))
        : ''
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }
      this.speaking = false
      // 收藏状态随题刷新
      this.favOn = settings.isFavorite('sentence', q.sid)
      // AI 点评状态随题重置
      this.critiqueOpen = false
      this.critiqueLoading = false
      this.critique = null
      this.critiqueError = ''
      // 题目加载后自动朗读题干（自动朗读失败静默，不打扰用户）
      tts.speakAuto(q.prompt)
    },

    switchMode(e) {
      if (this.answered) return
      const m = String((e.currentTarget.dataset || {}).m || '')
      if (PRACTICE_MODES.indexOf(m) < 0) return
      this.mode = m
      // 记住它：下一题、下次进页面都还是这一种。存不上也不影响本次作答。
      try { settings.set({ study: { practiceMode: m } }) } catch (err) { /* 见上 */ }
    },

    choose(e) {
      if (this.answered) return
      this.doChoose(Number(e.currentTarget.dataset.i))
    },

    // 实际作答逻辑（选项整项点击 与 选项内单词点击 共用）
    doChoose(sel) {
      if (this.answered || !(sel >= 0)) return
      const pass = sel === this.q.answerIndex
      this.selected = sel
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.q.options[sel])
    },

    // 选项内的单词被点击：未作答 = 选中该选项；已作答 = 查词义并发音
    onOptionTokenTap(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      if (!this.answered) {
        this.doChoose(Number(d.opt))
        return
      }
      this.tapWord(e)
    },

    onInput(e) {
      const v = e.detail.value
      this.input = v
      this.canSubmit = !!v.trim()
    },

    submitInput() {
      if (this.answered || !this.input.trim()) return
      const q = this.q
      const r = q.dir === 'e2c'
        ? judge.judgeZh(this.input, q.answer)
        : judge.judgeEn(this.input, q.answer)
      const status = r.pass ? 'pass' : (r.partial ? 'partial' : 'fail')
      this.finish(status, r.score, this.input.trim())
    },

    /**
     * 顶部两条进度条同步（与刷单词页同一套口径）。
     * 已做 = 累计作答次数：一次提交/选择 +1，确认题不算新的一次（它是同一题的一部分）；
     *   不设分母 —— 进度条按"每做完一轮（= 本组题量）"循环填充。
     * 会了 = 确认通过的题数，分母是本组题量。
     */
    syncBars() {
      const total = this.questions.length || 0
      const n = Number(this.answerCount) || 0
      const inLap = total ? n % total : 0
      this.answerPct = total ? Math.round(((n > 0 && inLap === 0 ? total : inLap) / total) * 100) : 0
      const lap = total && n > 0 ? Math.floor((n - 1) / total) + 1 : 0
      this.answerText = lap > 1
        ? t('{n} 题 · 第 {m} 轮', { n: n, m: lap })
        : t('{n} 题', { n: n })
    },

    finish(status, score, userAnswer) {
      // 上面那条进度条：一次作答 +1（累计，改判也不回退 —— 做了就是做了）
      this.answerCount = (Number(this.answerCount) || 0) + 1
      this.syncBars()
      // 不背单词机制：句子答对 ≠ 学会。日常 / AI 专练且本题有目标词时，
      // 先不落账，弹「目标词是什么意思」四选一 —— 确认对了才算 pass。
      // 错题重练（review）保持"第一次就对了就算记住"，不走确认。
      if (status === 'pass' && this.source !== 'review' && this.q.words && this.q.words.length) {
        const list = this.buildConfirms()
        if (list && list.length) {
          this.pendingPass = { score: score, userAnswer: userAnswer }
          this.confirming = true
          this.confirmItems = list
          this.confirmIdx = 0
          this.confirmItem = list[0]
          this.confirmSelected = -1
          this.setConfirmText()
          this.answered = true
          this.userAnswer = userAnswer
          this.result = { pass: true, partial: false, score: Math.round(score * 100) }
          // 音效等到确认出结果再响（commit 里），这里不响第二声
          return
        }
      }
      this.commit(status, score, userAnswer)
    },

    /**
     * 用本题第一个目标词造**两道**确认题（本地生成，零 AI 成本）：
     *   第 1 关 认得出 —— 给单词选中文（识别）
     *   第 2 关 想得起 —— 给中文选英文（反向提取，比识别难一档）
     * 只造得出一道（词书太小凑不齐反向选项等）就只出一道，调用方不挑；
     * 一道都造不出返回 null，退化成一次判定的老行为。
     */
    buildConfirms() {
      try {
        const w = this.q.words[0]
        if (!w || !w.w) return null
        const bid = this.bookId || this.q.bookId || ''
        const pool = wordbook.bookWords(bid)
        const item = wordSession.toItem(
          { id: w.id, w: w.w, pos: w.pos || '', m: w.m || '', lv: w.lv || 1 },
          pool, bid
        )
        if (!item) return null
        const out = [];
        ['recog', 'recall'].forEach(mode => {
          const bank = (item.modes || {})[mode]
          if (!bank || !bank.options || bank.options.length < 2) return
          out.push({
            mode: mode,
            w: item.w,
            m: item.m,
            options: bank.options,
            answerIndex: bank.answerIndex
          })
        })
        return out.length ? out : null
      } catch (e) {
        return null
      }
    },

    /** 确认区的标题与题干（模板不做三元 + 拼接，一律 JS 预算成字符串） */
    setConfirmText() {
      const it = this.confirmItem
      if (!it) { this.confirmTitle = ''; this.confirmPrompt = ''; return }
      const label = it.mode === 'recall' ? t('想得起') : t('认得出')
      const total = this.confirmItems.length || 1
      this.confirmTitle = total > 1
        ? t('第 {a} / {b} 关 · {m}', { a: this.confirmIdx + 1, b: total, m: label })
        : t('再确认一次：{m}', { m: label })
      // 认得出给单词；想得起只给中文释义（单词要自己从记忆里取出来）
      this.confirmPrompt = it.mode === 'recall' ? it.m : it.w
    },

    clearConfirmTimer() {
      if (this.confirmTimer) {
        clearTimeout(this.confirmTimer)
        this.confirmTimer = 0
      }
    },

    // 确认题作答：两关都对才真正 pass；第一关就没认出来按整题 fail 落账
    // （句子进错题本重练），也不必再考第二关了。
    confirmChoose(e) {
      if (!this.confirming) return
      const sel = Number(e.currentTarget.dataset.i)
      const it = this.confirmItem
      if (!it) return
      const pass = sel === it.answerIndex
      const p = this.pendingPass || { score: 1, userAnswer: this.userAnswer }
      this.confirmSelected = sel
      // 停 420ms 让人看清自己选的是对是错（选项会高亮），再进下一关或落账
      this.clearConfirmTimer()
      this.confirmTimer = setTimeout(() => {
        this.confirmTimer = 0
        if (!this.confirming) return   // 期间已经离开确认态（如页面被销毁）
        if (!pass) {
          this.confirming = false
          uni.showToast({ title: t('目标词没认出来，已按答错记录'), icon: 'none' })
          this.commit('fail', 0, p.userAnswer)
          return
        }
        if (this.confirmIdx + 1 < this.confirmItems.length) {
          // 过了这关，换一种提取方式再来一次
          this.confirmIdx++
          this.confirmItem = this.confirmItems[this.confirmIdx]
          this.confirmSelected = -1
          this.setConfirmText()
          return
        }
        this.confirming = false
        this.commit('pass', p.score, p.userAnswer)
      }, 420)
    },

    /**
     * 把本题的目标词写进跨天巩固队列（与刷单词共用 utils/srs.js 的同一套阶梯）。
     * 已经在队列里的（有 due）→ 这次算"巩固一次"，过了进一阶、没过退回第 0 阶；
     * 不在队列里的 → 先记一笔"见过"，等它在刷单词里正式过完三关才排期，
     * 免得句子蒙对一次就把一个压根没背过的词当成学会了。
     */
    scheduleWord(q, ok) {
      try {
        const w = q && q.words && q.words[0]
        const wid = (w && (w.id || w.w)) || (q && q.wordIds && q.wordIds[0]) || ''
        if (!wid) return
        const bid = this.bookId || q.bookId || ''
        const rec = (wordbook.masteryMap(bid) || {})[wid] || {}
        if (!rec.due) return
        wordSession.markReviewed(bid, wid, !!ok)
      } catch (e) {
        console.error('[practice scheduleWord]', e)
      }
    },

    // 落账出口（确认完成 / 无需确认的题都从这里走，保持原有记账口径）
    commit(status, score, userAnswer) {
      // 先取到局部：下面 recordStudy 要读它的多个字段，
      // 以前这里写的是裸 q（未定义）→ 每次作答都在写答题记录前抛错，记录永远写不进去
      const q = this.q
      engine.recordAnswer(q, status, this.mode, userAnswer)
      // 同步回写到词书维度的掌握度，作为下一轮 i+1 选词依据
      if (q.wordIds && q.wordIds.length) {
        iplus1.recordMastery(this.bookId || q.bookId, q.wordIds, status)
      }
      this.correctCount = this.correctCount + (status === 'pass' ? 1 : 0)
      // 每日目标的新口径：只有"确认通过"的题才算学会一笔（蒙对、确认没认出来的都不算）
      if (status === 'pass') {
        try { engine.addMasteredToday(1) } catch (e) { console.error('[practice addMasteredToday]', e) }
        // 跨天巩固：本题的目标词在这里和刷单词共用同一条调度队列 ——
        // 在翻译里认出它也算巩固了一次，两条练习链路不该各记一套账
        this.scheduleWord(q, true)
      } else if (status === 'fail') {
        // 到期回来的词却没答上来 → 退回第 0 阶，明天重来
        this.scheduleWord(q, false)
      }
      this.answered = true
      this.userAnswer = userAnswer
      this.result = {
        pass: status === 'pass',
        partial: status === 'partial',
        score: Math.round(score * 100)
      }
      // 答完先响一声（对 / 半对 / 错），再朗读参考答案 —— 两种声音叠在一起会很吵，
      // 所以朗读延后到音效播完之后；关掉音效就沿用原来的 400ms
      let readDelay = 400
      try {
        if (sfx.play(status)) readDelay = sfx.durationOf(status) + 120
      } catch (e) { /* 音效不可用不影响答题流程 */ }
      // 已登录：写一行 study_records（未登录时空操作，不影响练习流程）
      sync.recordStudy({
        bookId: this.bookId || q.bookId || '',
        sentenceId: q.sid || '',
        wordId: (q.words && q.words[0] && (q.words[0].id || q.words[0].w)) || (q.wordIds && q.wordIds[0]) || '',
        direction: q.dir || '',
        mode: this.mode || '',
        result: status,
        score: Math.round(score * 100),
        userAnswer: userAnswer || '',
        reference: q.answer || ''
      })
      // 作答后朗读参考答案，强化记忆（定时器由 clearAnswerTimer 统一清理）
      this.clearAnswerTimer()
      this.answerTimer = setTimeout(() => {
        this.answerTimer = 0
        tts.speakAuto(this.q.answer)
      }, readDelay)
    },

    /**
     * 「记错了」：句子答对了（或确认通过了），但其实没真会 —— 撤销 pass 改判答错。
     * 掌握度净 -2、今日 correct -1、句子进错题本，稍后重练。
     */
    markWrong() {
      if (!this.answered || !this.result || !this.result.pass || this.confirming) return
      const q = this.q
      try {
        engine.revokePass(q, this.mode, this.userAnswer)
        if (q.wordIds && q.wordIds.length) {
          iplus1.revokeMastery(this.bookId || q.bookId, q.wordIds)
        }
      } catch (e) {
        console.error('[practice markWrong]', e)
      }
      // 那笔"学会"要撤掉：改判的题不该留在今日学会数里
      try { engine.addMasteredToday(-1) } catch (e) { console.error('[practice addMasteredToday]', e) }
      this.correctCount = Math.max(0, this.correctCount - 1)
      this.result = { pass: false, partial: false, score: 0 }
      try { sfx.play('fail') } catch (e) { /* 音效不可用不影响改判 */ }
      uni.showToast({ title: t('已改判为答错'), icon: 'none' })
    },

    // 点读单词：查词义（核心词书 → 导入词 → 常用词典 → 词形还原）+ 发音
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
        found: !!entry.found,
        lemma: entry.lemma || '',
        inflected: entry.inflected || ''
      }
      // 未收录的单词仍走有道单词级发音（实测可用）
      tts.speakWord(dict.speakForm(raw))
    },

    closePop() {
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }
    },

    noop() {},

    // 重听：用户主动触发，force=true 永不被节流吞掉
    replay(e) {
      const text = e.currentTarget.dataset.text
      if (!text) { this.speaking = false; return }
      // 先发起播放再置位：speakSentence 内部 stop() 会触发上一次的 onDone（置 false）
      tts.speakSentence(text, {
        onDone: () => { this.speaking = false }
      })
      this.speaking = true
    },

    // 收藏当前题（例句），个人页「我的收藏」可查看
    toggleFav() {
      const q = this.q
      if (!q || !q.sid) return
      const wasOn = this.favOn
      const fav = { type: 'sentence', id: q.sid, en: q.prompt || '', zh: q.answer || '' }
      settings.toggleFavorite(fav)
      // 已登录：word_favorite 表同步（收藏→upsert，取消→软删除）
      if (wasOn) sync.unmirrorFavorite('sentence', q.sid)
      else sync.mirrorFavorite(fav)
      this.favOn = settings.isFavorite('sentence', q.sid)
    },

    // AI 点评：展开即按需调用，命中失败/未配置则提示，不阻断主流程
    toggleCritique() {
      if (!this.aiEnabled) {
        uni.showToast({ title: t('请先在设置中完成 AI 配置（') + this.aiReason + '）', icon: 'none' })
        return
      }
      this.critiqueOpen = !this.critiqueOpen
      if (this.critiqueOpen && !this.critique && !this.critiqueError && !this.critiqueLoading) {
        this.loadCritique()
      }
    },
    async loadCritique() {
      if (!this.aiEnabled || !this.userAnswer) return
      this.critiqueLoading = true
      this.critiqueError = ''
      try {
        const r = await critiqueTranslation({
          source: this.q.prompt,
          userAnswer: this.userAnswer,
          reference: this.q.answer,
          dir: this.q.dir
        })
        this.critique = { comment: r.comment || '', improved: r.improved || '' }
      } catch (e) {
        this.critiqueError = t('AI 点评暂不可用（请检查 AI 服务设置）')
      } finally {
        this.critiqueLoading = false
      }
    },

    next() {
      const n = this.idx + 1
      this.clearAnswerTimer()
      if (n >= this.questions.length) {
        tts.stop()
        this.finished = true
      } else {
        this.setupQuestion(n)
      }
    },

    restart() {
      this.clearAnswerTimer()
      this.start('daily')
    },

    goHome() {
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
/* 顶部双进度（已做 / 会了）：两条同分母，竖排各占一行 */
.pb-top { margin-bottom: 24rpx; }

.pb-bar { display: flex; align-items: center; }
.pb-bar + .pb-bar { margin-top: 14rpx; }

.pb-k {
  flex-shrink: 0;
  width: 72rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.pb-track { flex: 1; height: 10rpx; margin: 0 16rpx; }

.pb-v {
  flex-shrink: 0;
  min-width: 100rpx;
  text-align: right;
  font-size: 22rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* 两条进度条的颜色（设置 → 外观 → 练习进度条「两条进度条同色系」）。
   sync  同色系：已做 = 主题色浅版，已会 = 主题色实心（跟主题走，深浅区分）
   split 分开：  已做 = 主题色，已会 = 「成了」的绿色（色相区分）
   全部走 CSS 变量（--brand / --brand-rgb 由 theme.js 下发），换主题色、切深色模式自动跟随。 */
.pb-top.sync .pb-bar.done .progress-fill {
  background: #b9cdff;
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.38);
}
.pb-top.sync .pb-bar.know .progress-fill {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}
.pb-top.sync .pb-bar.know .pb-k,
.pb-top.sync .pb-bar.know .pb-v {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.pb-top.split .pb-bar.done .progress-fill {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}
.pb-top.split .pb-bar.know .progress-fill { background: #2f9e6e; }
.pb-top.split .pb-bar.know .pb-k,
.pb-top.split .pb-bar.know .pb-v { color: #2f9e6e; }

.q-card { margin-bottom: 24rpx; }

.q-meta { display: flex; align-items: center; margin-bottom: 18rpx; }

.dir-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; font-weight: 600; }
.dir-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.lv-tag { background: rgba(23, 32, 26, 0.07); color: #5a6560; margin-left: 12rpx; }
.lv-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); margin-left: 12rpx; }

.src-tag { background: rgba(247, 144, 9, 0.14); color: #b54708; margin-left: 12rpx; }

.src-tag.drill-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.src-tag.drill-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); }

/* AI 点评区块（与卡片同一套玻璃语言的内嵌面板） */
.ai-block {
  margin-top: 18rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 24rpx;
  padding: 8rpx 28rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.ai-block.disabled {
  background: rgba(255, 255, 255, 0.4);
  background: #f7f8f7;
  box-shadow: none;
}

.ai-block.disabled .ai-title { color: #b0b7b2; }

.ai-block.disabled .ai-chevron { color: #c8cdc9; }

.ai-head {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
}

.ai-title { font-size: 28rpx; font-weight: 600; color: #17201a; }
.ai-title { font-size: 28rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.ai-sub { font-size: 22rpx; color: #98a19b; margin-left: 16rpx; }
.ai-sub { font-size: 22rpx; color: var(--ink-3, #98a19b); margin-left: 16rpx; }

.ai-chevron { margin-left: auto; font-size: 24rpx; color: #1d4fd8; }
.ai-chevron { margin-left: auto; font-size: 24rpx; color: var(--brand-strong, #1d4fd8); }

.ai-body { padding: 4rpx 0 24rpx; border-top: 2rpx solid rgba(23, 32, 26, 0.07); }
.ai-body { padding: 4rpx 0 24rpx; border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.ai-loading { display: flex; align-items: center; padding: 20rpx 0; }

.ai-loading-text { margin-left: 16rpx; font-size: 24rpx; color: #98a19b; }
.ai-loading-text { margin-left: 16rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.loading-spinner.small {
  width: 36rpx;
  height: 36rpx;
  border-width: 4rpx;
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
}

.ai-comment { font-size: 28rpx; line-height: 1.7; color: #5a6560; }
.ai-comment { font-size: 28rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }

.ai-improved {
  margin-top: 14rpx;
  padding: 16rpx 20rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-left: 6rpx solid #2e6bff;
  border-left: 6rpx solid var(--brand, #2e6bff);
  border-radius: 16rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ai-error { font-size: 24rpx; color: #f79009; padding: 16rpx 0; }

.prompt {
  font-size: 36rpx;
  line-height: 1.7;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.tok { border-bottom: 2rpx dashed #bfd4ff; }

.tok:active { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.tok:active { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

.prompt-tip { margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.prompt-tip { margin-top: 14rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

/* 词库词标注：
   目标词（本题要练的）给底色 + 加粗，其余词书词只上色 + 实线下划线，
   这样一眼能分出"这句里哪个词是词书里的、哪个是本题重点"。 */
.tok.bk {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  border-bottom: 2rpx solid #9dbcff;
  border-bottom-color: rgba(var(--brand-rgb, 46, 107, 255), 0.45);
}
.tok.tg {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
  background: rgba(46, 107, 255, 0.14);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
  border-bottom: 2rpx solid transparent;
  border-radius: 6rpx;
}
.mark-legend { display: flex; align-items: center; margin-top: 14rpx; }
.lg { font-size: 22rpx; padding: 2rpx 14rpx; border-radius: 999rpx; margin-right: 14rpx; }
.lg.tg {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
  background: rgba(46, 107, 255, 0.14);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
}
.lg.bk {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.45);
}
.lg-note { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.replay-btn {
  flex-shrink: 0;
  margin-left: auto;
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
.replay-btn:active { background: rgba(46, 107, 255, 0.12); }
.replay-btn:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.replay-btn.small { margin-left: 16rpx; font-size: 22rpx; padding: 2rpx 18rpx; }

.fav-row {
  display: flex;
  justify-content: center;
  padding: 10rpx 0 6rpx;
}

.fav-star { font-size: 26rpx; color: #98a19b; }
.fav-star { font-size: 26rpx; color: var(--ink-3, #98a19b); }

.fav-star.on { color: #f79009; }

/* 作答方式切换：胶囊轨道 + 玻璃滑块，与底部导航同一语言 */
.mode-switch {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.mode-switch.locked { opacity: 0.5; }

.mode-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  border-radius: 999rpx;
}

/* 选中态用实心主色 —— 和刷单词页那排胶囊保持一致。
   只有"白底 + 蓝字"时一排胶囊里区分度太弱，看不出哪个被选了。 */
.mode-item.active {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2rpx 8rpx rgba(46, 107, 255, 0.28);
  transition: background 200ms ease, color 200ms ease;
}

/* 选项：玻璃卡片，选中/错误态用边框与淡色底反馈 */
.option {
  display: flex;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-radius: 24rpx;
  padding: 28rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 8rpx 24rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 8rpx 24rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
  transition: transform 180ms ease, background 200ms ease, border-color 200ms ease;
}

.option-hover { background: rgba(46, 107, 255, 0.1); }
.option-hover { background: rgba(var(--brand-rgb, 46, 107, 255), 0.1); }

.option.correct { border-color: #2e6bff; background: rgba(46, 107, 255, 0.13); }
.option.correct { border-color: var(--brand, #2e6bff); background: rgba(var(--brand-rgb, 46, 107, 255), 0.13); }

.option.wrong { border-color: #e5484d; background: rgba(229, 72, 77, 0.1); }

.option-label {
  flex-shrink: 0;
  width: 48rpx; height: 48rpx;
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

.option.correct .option-label { background: #2e6bff; color: #ffffff; }
.option.correct .option-label { background: #2e6bff; color: #ffffff; }
.option.correct .option-label { background: var(--brand, #2e6bff); color: #ffffff; }
.option.correct .option-label { background: var(--brand, #2e6bff); color: #ffffff; }

.option.wrong .option-label { background: #e5484d; color: #ffffff; }
.option.wrong .option-label { background: #e5484d; color: #ffffff; }

.option-text { flex: 1; font-size: 30rpx; line-height: 1.55; }

.input-card { margin-bottom: 24rpx; }

.answer-input {
  width: 100%;
  min-height: 160rpx;
  font-size: 30rpx;
  line-height: 1.6;
  box-sizing: border-box;
}

.submit-btn { margin-top: 24rpx; }

.result-card { margin-top: 6rpx; }

.result-title {
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  margin-bottom: 22rpx;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.result-title.ok { color: #1d4fd8; }
.result-title.ok { color: var(--brand-strong, #1d4fd8); }
.result-title.mid { color: #b54708; }
.result-title.bad { color: #e5484d; }

.result-score { font-size: 24rpx; font-weight: 400; color: #98a19b; }
.result-score { font-size: 24rpx; font-weight: 400; color: var(--ink-3, #98a19b); }

.result-row { margin-bottom: 16rpx; display: flex; flex-direction: column; }

.result-label-row { display: flex; align-items: center; margin-bottom: 6rpx; }

.result-label { font-size: 22rpx; color: #98a19b; margin-bottom: 6rpx; }
.result-label { font-size: 22rpx; color: var(--ink-3, #98a19b); margin-bottom: 6rpx; }

.result-label-row .result-label { margin-bottom: 0; }

.result-value { font-size: 30rpx; line-height: 1.6; }

.result-value.ref { color: #1d4fd8; font-weight: 600; }
.result-value.ref { color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.note {
  margin-top: 14rpx;
  padding: 18rpx 22rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-left: 6rpx solid #2e6bff;
  border-left: 6rpx solid var(--brand, #2e6bff);
  border-radius: 16rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.6;
}

.word-chips { display: flex; flex-wrap: wrap; margin-top: 18rpx; }

.chip {
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 22rpx;
  border-radius: 999rpx;
  padding: 10rpx 22rpx;
  margin: 0 12rpx 12rpx 0;
}

.next-btn { margin-top: 24rpx; }

/* 下一题行：记错了（反悔）+ 下一题并排 */
.next-row { display: flex; align-items: center; }
.wrong-btn {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
  padding: 20rpx 12rpx;
  margin-top: 24rpx;
}
.next-row .next-btn { flex: 1; margin-left: 16rpx; }

/* 目标词二次确认块（不背单词机制） */
.confirm-block {
  margin-top: 20rpx;
  padding: 26rpx 28rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 24rpx;
}

.cb-head {
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cb-word {
  margin-top: 14rpx;
  font-size: 56rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  text-align: center;
}

.cb-opts { margin-top: 20rpx; }

.cb-opt {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 14rpx;
}

.cb-opt-hover { background: rgba(46, 107, 255, 0.1); }
.cb-opt-hover { background: rgba(var(--brand-rgb, 46, 107, 255), 0.1); }

.cb-opt.correct { border-color: #2e6bff; background: rgba(46, 107, 255, 0.13); }
.cb-opt.correct { border-color: var(--brand, #2e6bff); background: rgba(var(--brand-rgb, 46, 107, 255), 0.13); }
.cb-opt.wrong { border-color: #e5484d; background: rgba(229, 72, 77, 0.1); }

.cb-label {
  flex-shrink: 0;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 22rpx;
  font-weight: 600;
  margin-right: 18rpx;
}

.cb-opt.correct .cb-label { background: #2e6bff; color: #ffffff; }
.cb-opt.correct .cb-label { background: var(--brand, #2e6bff); color: #ffffff; }
.cb-opt.wrong .cb-label { background: #e5484d; color: #ffffff; }

.cb-text { flex: 1; font-size: 28rpx; line-height: 1.5; color: #17201a; }
.cb-text { color: var(--ink-1, #17201a); }

.cb-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

.summary-card { text-align: center; padding: 72rpx 40rpx; }

.summary-title { font-size: 30rpx; color: #5a6560; }
.summary-title { font-size: 30rpx; color: var(--ink-2, #5a6560); }

.summary-score {
  font-size: 96rpx;
  font-weight: 600;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  margin-top: 24rpx;
  letter-spacing: 2rpx;
}

.summary-total { font-size: 42rpx; color: #98a19b; font-weight: 400; }
.summary-total { font-size: 42rpx; color: var(--ink-3, #98a19b); font-weight: 400; }

.summary-sub { font-size: 26rpx; color: #98a19b; margin: 18rpx 0 48rpx; }
.summary-sub { font-size: 26rpx; color: var(--ink-3, #98a19b); margin: 18rpx 0 48rpx; }

.summary-btn { margin-top: 20rpx; }

.loading-mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(244, 246, 244, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

.loading-card {
  background: rgba(255, 255, 255, 0.78);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.78);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 28rpx;
  padding: 48rpx 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 16rpx 44rpx rgba(23, 32, 26, 0.12);
  box-shadow: 0 16rpx 44rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.12);
}

.loading-spinner {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid #dfe6f5;
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: spin 0.9s linear infinite;
}

.loading-text {
  margin-top: 24rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 点读弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式，这里只写内容类 */

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

.empty { padding: 200rpx 60rpx; text-align: center; }

.empty-text { font-size: 30rpx; color: #98a19b; margin-bottom: 40rpx; }
.empty-text { font-size: 30rpx; color: var(--ink-3, #98a19b); margin-bottom: 40rpx; }

.empty-btn { width: 60%; }
</style>
