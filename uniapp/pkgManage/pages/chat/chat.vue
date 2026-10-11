<template>
  <view class="container chat-container page-nav" :class="appTheme" :style="appBgStyle">
    <!-- 顶部胶囊：标题 + 三个会话动作（历史 / 新对话 / 我的句子）+ 抽测。
         以前这三个在页面里另起一条工具栏，聊天记录一多就被推到上面去了（用户反馈）：
         要翻到最顶上才够得着。胶囊是 fixed 的，怎么滚都在。
         抽测不是"换个页面"，是这场对话的另一种玩法，所以它是引导条而不是导航。 -->
    <float-navbar :title="$t('AI 对话陪练')" :actions="navActions" @action="onNavAction" />

    <!-- 未开启 AI：引导 -->
    <view v-if="!aiEnabled" class="guide">
      <view class="guide-emoji">🤖</view>
      <view class="guide-title">{{ $t('AI 对话陪练未开启') }}</view>
      <view class="guide-sub">{{ $t('在「设置 → AI 与语音」中填入服务商地址与密钥后，即可用英文和 AI 聊天练习。') }}</view>
      <button class="btn-primary guide-btn" @tap="goSettings">{{ $t('去设置开启') }}</button>
    </view>

    <block v-else>
      <scroll-view class="msg-list" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="true">
        <view v-for="(m, i) in viewMessages" :key="i" class="msg-row" :class="m.role">
          <view class="msg-col">
            <!-- 长按气泡 = 收藏这句（和点的效果一样，只是更快） -->
            <view class="bubble" :class="m.role" @longpress="saveMsg(m)">{{ m.content }}</view>
            <view class="msg-acts">
              <text class="msg-act" :class="{ on: m.saved }" @tap="saveMsg(m)">
                {{ m.saved ? '★ ' + $t('已收藏') : '☆ ' + $t('收藏这句') }}
              </text>
              <text class="msg-act" @tap="speak(m.content)">{{ $t('朗读') }}</text>
            </view>
          </view>
        </view>
        <view v-if="thinking" class="msg-row assistant">
          <view class="bubble assistant typing"><view class="dot"></view><view class="dot"></view><view class="dot"></view></view>
        </view>
        <!-- 两个锚点轮流用：scroll-into-view 只在**值变化**时才会滚，
             同一个 id 连赋两次端上纹丝不动（结果就是回复落在屏幕外，得手动往下滑） -->
        <view id="mb-a"></view>
        <view id="mb-b"></view>
      </scroll-view>

      <!-- 抽测状态条：这不是"工具栏"（工具栏会随内容被推上去），
           而是这一局的进度 —— 贴在输入框正上方，一眼看到"第几题、对了几个" -->
      <view v-if="quiz.on" class="quiz-bar">
        <text class="qb-txt">{{ quizBarText }}</text>
        <text class="qb-stop" @tap="stopQuiz">{{ $t('结束抽测') }}</text>
      </view>

      <!-- 抽测入口：说一句目标就能开始（「考我今天背的词」「抽测 20 个」）。
           光靠"用户自己想到这么说"不够，所以给一颗一键开始的引导条。 -->
      <view v-else class="quiz-start">
        <text class="qs-chip" @tap="startQuizQuick">{{ $t('抽测我') }}</text>
        <text class="qs-hint">{{ $t('也可以直接说「考我今天背的词」') }}</text>
      </view>

      <view class="input-bar">
        <input
          class="chat-input"
          :value="draft"
          @input="e => draft = e.detail.value"
          :focus="inputFocus"
          :hold-keyboard="true"
          @focus="kbOn = true"
          @blur="kbOn = false"
          :placeholder="inputPlaceholder"
          confirm-type="send"
          @confirm="send"
        />
        <button class="send-btn" @tap="send" :disabled="!draft.trim() || thinking">
          {{ thinking ? '…' : $t('发送') }}
        </button>
      </view>
    </block>

    <!-- 历史对话：点一条切过去；删除只删那一条 -->
    <view v-if="listShow" class="cb-mask" @tap="closeList">
      <view class="cb-sheet" @tap.stop="noop">
        <view class="cb-head">
          <text class="cb-title">{{ $t('历史对话') }}</text>
          <text class="cb-close" @tap="closeList">{{ $t('关闭') }}</text>
        </view>
        <scroll-view class="cb-body" scroll-y>
          <view
            v-for="(s, i) in sessions"
            :key="s.id"
            class="cb-item"
            :class="{ cur: s.id === sessionId }"
            @tap="openSession(s.id)"
          >
            <view class="cb-line">
              <text class="cb-name">{{ chatTitle(s, i) }}</text>
              <text class="cb-del" @tap.stop="delSession(s.id)">{{ $t('删除') }}</text>
            </view>
            <text class="cb-sub">{{ whenText(s.updatedAt) }} · {{ $t('{n} 条消息', { n: s.messages.length }) }}</text>
          </view>
          <view v-if="!sessions.length" class="cb-empty">{{ $t('还没有历史对话') }}</view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import { isAIEnabled } from '../../../services/config.js'
import { featureOn } from '../../../services/ai-gate.js'
import { tutorSystemPrompt, quizSystemPrompt, quizNextHint, quizWrapHint, chat as chatTutor, explainWord } from '../../../services/ai-content.js'
import * as wordbook from '../../../utils/wordbook'
import * as chatStore from '../../../utils/chat-store.js'
import * as tts from '../../../services/voice'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

const GREETING = "Hi! I'm your English partner. Let's chat — how are you today?";

// 抽测：一次考几个词（用户没在话里说数量时用这个）
const QUIZ_N = 10;
// 抽测：一场最多几个词 —— 太多了一轮跑不完，状态条的"第 n/N 题"也没意义
const QUIZ_MAX = 30;
const QUIZ_MIN = 3;
// 「考我今天背的词」这类目标句：出现了这些词才算要开局。
// 不写宽一点（比如光一个"测试"）：正常聊天里也会出现"测试"，误开局会把对话带跑偏。
const QUIZ_WORDS = /抽测|抽背|抽考|考考我|考我|来考|考一下|出题|小测|quiz\s*me|test\s*me/i;

// 判定标记里的「对」。写成转义不是故弄玄虚：这不是界面文案（不归 i18n 管，是模型
// 回复的解析结果），但 check-i18n 会扫"没套 $t 的中文字面量"，直接写会让它误报一处。
const MARK_RIGHT = '\u5bf9';

export default {
  components: { FloatNavbar },
  data() {
    return {
      aiEnabled: false,
      sessionId: '',
      messages: [],
      draft: '',
      thinking: false,
      scrollTarget: '',
      lastScrollAt: 0,    // 滚到底的节流（流式逐字来，别一个字滚一次）
      inputFocus: false,  // 发完一句后把焦点抢回来（键盘不收，聊天是连续的）
      kbOn: false,        // input 当前有没有焦点：没丢就别做多余的 false→true（会闪）
      savedSig: 0,        // 收藏状态变了要重算 viewMessages
      streamTick: 0,      // 流式每来一段就 +1：viewMessages 是计算属性，靠它失效重算
      listShow: false,
      sessions: [],
      // 抽测（AI 抽考单词）：出题顺序与进度在**本地**，模型只负责出题语言与点评。
      // on      这局开着没有
      // pool    考哪些词（[{w, pos, m}]，开局时从当前词书取好，之后不再变）
      // idx     下一个要考的词在 pool 里的下标
      // cur     正在等用户回答的那个词（用来在用户答完后把答案摆出来）
      // right/wrong 依据模型回复开头的【对】/【错】计数
      // judge   这一轮回复里"有没有要判的答案"（第一题没得判，不能白加一次对）
      // wrap    这一轮回复是收尾话（词考完了）→ 拿到回复就关局
      quiz: { on: false, pool: [], idx: 0, cur: null, right: 0, wrong: 0, judge: false, wrap: false }
    }
  },
  computed: {
    // 顶栏胶囊上的三个快捷动作。用 computed 而不是 data：文案要跟着语言切
    // （`void this.__lang` 是 i18n 的响应式依赖，全局 mixin 提供的，见 utils/i18n.js）
    navActions() {
      void this.__lang
      return [
        { key: 'history', text: t('历史') },
        { key: 'new', text: t('新对话') },
        { key: 'sentences', text: t('我的句子') }
      ]
    },
    inputPlaceholder() {
      void this.__lang
      return this.quiz.on ? t('写它的意思或拼写…') : t('用英语和 AI 聊点什么…')
    },
    quizBarText() {
      void this.__lang
      const q = this.quiz
      return t('抽测中 · 第 {a}/{b} 题 · 对 {c} 错 {d}', {
        a: Math.min(q.idx, q.pool.length), b: q.pool.length, c: q.right, d: q.wrong
      })
    },
    // 展示用：去掉 system（它每次都按当前词书重新生成，不该出现在屏幕上），
    // 另外把"这句收过没有"提前算好 —— 小程序端模板里不能写函数调用。
    viewMessages() {
      // 这两个是"手动失效开关"：收藏状态变了 / 流式又吐了几个字，都要重算。
      // ⚠️ 少了 streamTick 这一行，AI 的回复会一直停在空气泡上（计算属性缓存不失效）。
      void this.savedSig
      void this.streamTick
      return this.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content,
          saved: chatStore.isSentenceSaved(m.content)
        }))
    }
  },
  onLoad(opt) {
    this.aiEnabled = !!isAIEnabled() && featureOn('chat')
    if (!this.aiEnabled) return
    this.loadSession(chatStore.active())
    if (opt && opt.list === '1') this.openList()
  },
  onUnload() {
    // 关页面前一定落盘：写盘是 800ms 合并的，直接退出可能丢最后一句
    this.persist()
    chatStore.flush()
    tts.stop()
  },
  onBackPress() {
    // 历史面板开着 → 返回键先关它，而不是直接离开页面
    if (this.listShow) { this.closeList(); return true }
    return false
  },
  methods: {
    // ---------- 会话 ----------
    learnedWords() {
      try {
        // 按当前词书口径取词（内置词 + 该书导入词），自建词书同样适用
        const bid = wordbook.currentBookId()
        const m = wordbook.masteryMap(bid)
        const all = wordbook.bookWords(bid)
        // 优先取「学习中/新词」作为陪练用词提示
        const weak = all.filter(w => ((m[w.id] || {}).m || 0) < 3).slice(0, 12)
        const pick = weak.length ? weak : all.slice(0, 12)
        return pick.map(w => w.w).filter(Boolean)
      } catch (e) { return [] }
    },
    // system 提示词不落盘：每次按当前词书重新生成，存下来只会越来越旧
    systemMsg() {
      const content = this.quiz.on
        ? quizSystemPrompt(this.quiz.pool)
        : tutorSystemPrompt(this.learnedWords())
      return { role: 'system', content }
    },
    loadSession(s) {
      if (!s) return
      // 换了一场对话 → 这一局抽测就作废了（进度条跟的是当前这场）。
      // 静默结束：不在别人刚打开的历史里塞一条"抽测结束"。
      if (this.quiz.on) this.stopQuiz(true)
      this.sessionId = s.id
      const history = (s.messages || []).map(m => ({ role: m.role, content: m.content }))
      this.messages = [this.systemMsg()].concat(
        history.length ? history : [{ role: 'assistant', content: GREETING }]
      )
      this.savedSig++
      this.scrollToEnd(true)
    },
    persist() {
      if (!this.sessionId) return
      // 存档是附属功能：写盘炸了也绝不能把"发一句话"这个主流程带崩
      try { chatStore.saveMessages(this.sessionId, this.messages) } catch (e) { /* 存不下就算了，聊天继续 */ }
    },
    newChat() {
      this.persist()
      // 新对话 = 新的一局：抽测进度不跟着搬过去
      if (this.quiz.on) this.stopQuiz(true)
      const s = chatStore.create()
      this.messages = [this.systemMsg(), { role: 'assistant', content: GREETING }]
      this.sessionId = s.id
      this.savedSig++
      this.closeList()
      uni.showToast({ title: t('已开一场新对话'), icon: 'none' })
    },
    openList() {
      this.sessions = chatStore.sessions()
      this.listShow = true
    },
    closeList() { this.listShow = false },
    openSession(id) {
      this.persist()
      const s = chatStore.open(id)
      this.closeList()
      if (s) this.loadSession(s)
    },
    delSession(id) {
      chatStore.remove(id)
      this.sessions = chatStore.sessions()
      // 删掉的正是当前这场 → 切到剩下最近的一场（没有就新开）
      if (id === this.sessionId) {
        const s = chatStore.active()
        this.loadSession(s)
      }
    },
    noop() {},

    // ---------- 滚到底 / 键盘 ----------
    /**
     * 滚到最新一条。
     * ⚠️ scroll-into-view 只在**值发生变化**时才滚动 —— 写死同一个 id 连赋两次，
     *    端上不会有任何反应（真机表现：发完一句话，AI 的回复在屏幕外面，得手动往下滑）。
     *    所以两个锚点轮流指，保证每次都是一次真实的变化。
     */
    scrollToEnd(force) {
      const now = Date.now()
      if (!force && now - this.lastScrollAt < 150) return   // 流式逐字来，别一个字滚一次
      this.lastScrollAt = now
      // 等新内容先渲染出来再滚，否则滚的是上一帧的底部
      this.$nextTick(() => {
        this.scrollTarget = this.scrollTarget === 'mb-a' ? 'mb-b' : 'mb-a'
      })
    },
    // 发完一句键盘要留着：聊天是连续的，每句都收起来就得重新点一下输入框。
    // 只有焦点真被抢走了才抢回来（false→true 会闪一下，没丢就别动）
    keepKeyboard() {
      if (this.kbOn) return
      this.inputFocus = false
      this.$nextTick(() => { this.inputFocus = true })
    },

    // ---------- 收藏句子 ----------
    // 聊天里冒出来的好句子，一键收进「我的收藏」，和词库页收藏的例句是同一套：
    // 之后在收藏列表里能点开逐词点读、也能把这整句存进词书（见 sentence-detail）。
    async saveMsg(m) {
      const en = String((m && m.content) || '').trim()
      if (!en) return
      if (chatStore.isSentenceSaved(en)) {
        try {
          const id = 'csen-' + chatStore.sentenceIdOf(en)
          chatStore.removeSentence(id)
          this.savedSig++
          uni.showToast({ title: t('已取消收藏'), icon: 'none' })
        } catch (e) {}
        return
      }
      // 译文：有 AI 就顺手问一句（结果进 aiCache，同一句不会问第二次）。
      // 没配 AI / 关了释义开关也不拦着收藏 —— 句子先存下来，译文以后再补。
      let zh = ''
      if (this.aiEnabled) {
        uni.showToast({ title: t('正在补充译文…'), icon: 'none', duration: 1200 })
        try {
          const r = await explainWord(en)
          if (r) zh = String(r.meaningZh || '').trim()
        } catch (e) { zh = '' }
      }
      const res = chatStore.saveSentence(en, zh, { from: 'chat' })
      this.savedSig++
      if (res && res.ok) uni.showToast({ title: t('已收进「我的收藏」'), icon: 'none' })
      else if (res && res.dup) uni.showToast({ title: t('这句已经收过了'), icon: 'none' })
      else uni.showToast({ title: t('这句收不进来'), icon: 'none' })
    },
    speak(text) {
      const s = String(text || '').trim()
      if (!s) return
      try { tts.speakSentence(s) } catch (e) {}
    },

    goSettings() {
      uni.navigateTo({ url: '/pkgManage/pages/settings/settings' })
    },
    goSentences() {
      uni.navigateTo({ url: '/pkgStudy/pages/favorites/favorites?tab=sentence' })
    },
    /** 顶栏胶囊上的快捷动作（组件只发 key，做什么由页面定） */
    onNavAction(key) {
      if (key === 'history') { this.openList(); return }
      if (key === 'new') { this.newChat(); return }
      if (key === 'sentences') { this.goSentences(); return }
    },

    // ---------- 抽测（AI 抽考单词） ----------
    /**
     * 抽测用词池：从**当前词书**里取（用户在哪本书里就考哪本书），
     * 掌握度低的排前面 —— 会的最少的最该被考。
     * 词义一并带上：一是模型手里有权威释义就不会瞎编，二是页面能在用户答完后
     * 立刻把答案摆出来（不依赖模型有没有说）。
     */
    quizWordPool(count) {
      try {
        const bid = wordbook.currentBookId()
        const m = wordbook.masteryMap(bid)
        const all = wordbook.bookWords(bid) || []
        const lv = (w) => ((m[w.id] || {}).m || 0)
        const weak = all.filter(w => lv(w) < 3)
        const rest = all.filter(w => lv(w) >= 3)
        return weak.concat(rest).slice(0, count).map(w => ({
          w: String(w.w || '').trim(),
          pos: String(w.pos || '').trim(),
          m: String(w.m || '').trim()
        })).filter(x => x.w && x.m)
      } catch (e) { return [] }
    },
    /** 目标句里能读出的题量（「抽测 20 个」），读不出来用默认值，夹在 3~30 */
    quizCount(goal) {
      const hit = String(goal || '').match(/\d+/)
      const n = hit ? parseInt(hit[0], 10) : QUIZ_N
      if (!(n > 0)) return QUIZ_N
      return Math.max(QUIZ_MIN, Math.min(QUIZ_MAX, n))
    },
    /**
     * 开局。返回是否真的开起来了（词书里一个词都没有时开不了，
     * 这时候要给一句人话，而不是让用户对着空气说"考我"）。
     */
    startQuiz(goal) {
      const pool = this.quizWordPool(this.quizCount(goal))
      if (!pool.length) {
        uni.showToast({ title: t('当前词书里没有可抽测的词'), icon: 'none' })
        return false
      }
      this.quiz = { on: true, pool: pool, idx: 0, cur: null, right: 0, wrong: 0, judge: false, wrap: false }
      // 换上抽测专用的 system 提示词（下一句就会带上）。messages[0] 就是 system。
      this.messages[0] = this.systemMsg()
      return true
    },
    /**
     * 一键开局（输入框上方那颗引导条）。
     * 光把 quiz.on 立起来是不够的 —— 那样界面上不会有任何变化，
     * 用户看到的是"点了一下，没反应"。所以替用户说一句「抽测我」（就是他刚点的那颗），
     * 走一遍正常的发送流程，AI 随即把第一题问出来。
     */
    startQuizQuick() {
      if (this.thinking) return
      if (!this.startQuiz('')) return
      this.draft = t('抽测我')
      this.send()
    },
    /** 「考我今天背的词」这类目标句 —— 识别到才开局，正常聊天不会被带跑 */
    wantsQuiz(text) {
      return QUIZ_WORDS.test(String(text || ''))
    },
    /**
     * 下一个要考的词。词用完返回 null（这一轮就该收尾了）。
     * 顺序由本地定：一轮跑完不重复、进度可数 —— 全交给模型自由发挥的话，
     * 它会翻来覆去考同一个词。
     */
    nextQuizWord() {
      const q = this.quiz
      if (!q.on || q.idx >= q.pool.length) return null
      const w = q.pool[q.idx]
      q.idx++
      q.cur = w
      return w
    },
    /** 用户答完后，本地把这一题的正确答案摆出来（100% 有，不靠模型复述） */
    answerFor(cur) {
      if (!cur) return ''
      return t('答案：{a}{b}', { a: cur.pos ? cur.pos + ' ' : '', b: cur.m })
    },
    /**
     * 解析模型回复开头的判定标记【对】/【错】。
     * 标记要**在开头**才算 —— 点评里出现"错"字很常见，不能见字就计数。
     * 命中后从气泡里去掉标记，用户看到的是干净的点评。
     */
    readVerdict(text) {
      const s = String(text || '')
      const m = s.match(/^\s*【([\u5bf9\u9519])】/)
      if (!m) return { hit: false, right: false, text: s }
      return { hit: true, right: m[1] === MARK_RIGHT, text: s.replace(/^\s*【[\u5bf9\u9519]】\s*/, '') }
    },
    /**
     * 结束抽测。quiet = 静默（换会话 / 开新对话时用，别往别人的历史里塞消息）。
     * 状态条与输入框占位文案都跟着 quiz.on 走，所以这里只需把 on 关掉。
     */
    stopQuiz(quiet) {
      if (!this.quiz.on) return
      const r = this.quiz.right
      const w = this.quiz.wrong
      this.quiz.on = false
      this.quiz.cur = null
      this.quiz.judge = false
      if (quiet) return
      this.messages.push({ role: 'assistant', content: t('抽测结束：共 {a} 题，对 {b} 错 {c}。', { a: r + w, b: r, c: w }) })
      this.savedSig++
      this.persist()
      this.scrollToEnd(true)
    },

    async send() {
      const text = String(this.draft || '').trim()
      if (!text || this.thinking) return
      // 抽测："考我今天背的词"这类目标句 —— 先在**本地**开局（考哪本书、考几个都在本地定好），
      // 再让 AI 只负责把题问出来与点评。识别不到就当普通聊天，不受影响。
      if (!this.quiz.on && this.wantsQuiz(text)) this.startQuiz(text)
      this.messages.push({ role: 'user', content: text })
      this.draft = ''
      this.thinking = true
      // 刚才是"在答题"：本地先把这一题的正确答案摆出来。
      // 为什么不等模型说：模型可能忘了说、也可能说错；正确释义本地本来就有。
      // 这条气泡同时会进 payload，模型据此判对错（手里有权威答案，判得准）。
      if (this.quiz.on && this.quiz.cur) {
        this.messages.push({ role: 'assistant', content: this.answerFor(this.quiz.cur) })
        this.quiz.cur = null
        this.quiz.judge = true
        this.savedSig++
      }
      this.persist()
      this.scrollToEnd(true)
      this.keepKeyboard()
      // 仅把 system + 历史 + 当前问题发给模型（system 在最前）
      const payload = this.messages.map(m => ({ role: m.role, content: m.content }))
      // 抽测：把"这一轮考哪个词"作为隐藏指令挂在 payload 末尾。
      // 它不写进 messages —— 既不显示在界面上，也不落进对话存档。
      if (this.quiz.on) {
        const next = this.nextQuizWord()
        if (next) {
          payload.push({ role: 'system', content: quizNextHint(next) })
        } else {
          payload.push({ role: 'system', content: quizWrapHint() })
          this.quiz.wrap = true   // 这轮回复是收尾话，拿到后就结束本局
        }
      }
      // 先占一个空气泡：流式时逐字往里灌，体验像真人打字；
      // 端不支持流式时 onDelta 一次都不会被调，chat() 内部自动回退整块返回，
      // 最后这里还是会拿到完整内容 —— 两条路径在同一处收口。
      //
      // ⚠️ 必须拿「push 进数组之后」的那个对象来改：Vue 3 里 push 进去的是裸对象，
      //    直接改裸对象不会触发响应式，而 viewMessages 是计算属性（结果会被缓存），
      //    于是回复明明已经拿到、界面却停在空气泡上 —— 只有退出重进才看得到。
      const idx = this.messages.length
      this.messages.push({ role: 'assistant', content: '' })
      const bubble = this.messages[idx]
      const bump = () => { this.streamTick++ }
      try {
        const r = await chatTutor(payload, {
          onDelta: (piece) => {
            bubble.content += String(piece || '')
            bump()                  // 哪怕代理失效，也能靠它把字刷到屏幕上
            this.thinking = false   // 第一个字到了就不再"思考中"
            this.scrollToEnd()      // 字一个一个来，跟着往下滚
          }
        })
        const reply = (r && r.content) ? r.content.trim() : ''
        // 抽测：读开头的【对】/【错】。只在"这一轮真的有答案要判"时计数 ——
        // 第一题没人回答过，白加一次"答对"会让状态条的数字从一开始就是错的。
        if (this.quiz.judge) {
          const v = this.readVerdict(reply)
          if (v.hit) {
            if (v.right) this.quiz.right++
            else this.quiz.wrong++
          }
          this.quiz.judge = false
          bubble.content = v.hit ? (v.text || t('（AI 没有返回内容）')) : (reply || t('（AI 没有返回内容）'))
        } else {
          bubble.content = reply || t('（AI 没有返回内容）')
        }
        bump()
      } catch (e) {
        bubble.content = t('抱歉，我暂时无法回应（请检查 AI 服务设置或网络）。')
        this.quiz.judge = false
        bump()
      } finally {
        this.thinking = false
        this.persist()
        chatStore.flush()
        this.scrollToEnd(true)
        // 词考完了：这一轮是收尾话 → 关掉状态条（静默，总结在 AI 那条气泡里）
        if (this.quiz.wrap) { this.quiz.wrap = false; this.stopQuiz(true) }
      }
    },

    // ---------- 展示用小工具 ----------
    chatTitle(s, i) {
      try { return chatStore.titleOf(s, i) } catch (e) { return '' }
    },
    whenText(at) {
      const ms = Date.now() - (Number(at) || 0)
      if (!(ms >= 0) || !at) return ''
      if (ms < 60 * 1000) return t('刚刚')
      if (ms < 3600 * 1000) return t('{n} 分钟前', { n: Math.floor(ms / 60000) })
      if (ms < 24 * 3600 * 1000) return t('{n} 小时前', { n: Math.floor(ms / 3600000) })
      return t('{n} 天前', { n: Math.floor(ms / 86400000) })
    }
  }
}
</script>

<style>
.chat-container {
  display: flex;
  flex-direction: column;
  /* ⚠️ 高度必须靠 fixed + 四边贴 0，不能写 `height: 100vh`：
     1. 全局 softinputMode 是 adjustResize（见 pages.json），键盘弹出时压的是 webview
        可视区高度，window 不动；而 `100vh` 在部分 Android WebView 上**不随可视区更新**，
        键盘出来后高度还是旧值 → 底部被吃掉，看着像"被顶上去"。
     2. fixed 四边贴 0 才跟着可视区实时收缩。`min-height: 0` 留给内部 flex 正常收缩。 */
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  /* 全局 `.container` 带 `min-height: 100vh`（给普通页面兜底用），而 min-height 会盖过
     top/bottom 算出来的高度 → 这里必须显式压回 0；再加 max-height 兜一道：
     fixed 元素的百分比相对**初始包含块**（= 可视区），键盘弹出时它会跟着更新。 */
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
  /* 不要写死背景：根节点同时承担深色底 / 背景图（.app-dark 与 inline style） */
}

.guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 60rpx;
  text-align: center;
}

.guide-emoji { font-size: 96rpx; }

.guide-title { font-size: 34rpx; font-weight: 600; color: #17201a; margin-top: 24rpx; }
.guide-title { font-size: 34rpx; font-weight: 600; color: var(--ink-1, #17201a); margin-top: 24rpx; }

.guide-sub { font-size: 26rpx; color: #5a6560; line-height: 1.7; margin: 18rpx 0 40rpx; }
.guide-sub { font-size: 26rpx; color: var(--ink-2, #5a6560); line-height: 1.7; margin: 18rpx 0 40rpx; }

.guide-btn { width: 60%; }

/* ---------- 抽测：进度条 + 一键开局（会话工具条已搬进顶栏胶囊） ---------- */
.quiz-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin: 0 24rpx 10rpx;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
}

.qb-txt {
  font-size: 23rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.qb-stop {
  font-size: 23rpx;
  padding: 4rpx 8rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.qb-stop:active { opacity: 0.6; }

.quiz-start {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin: 0 24rpx 10rpx;
}

.qs-chip {
  font-size: 23rpx;
  line-height: 1;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
  border: 2rpx solid rgba(46, 107, 255, 0.3);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
  border-radius: 999rpx;
  padding: 10rpx 22rpx;
}

.qs-chip:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.22); }

.qs-hint {
  margin-left: 16rpx;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.msg-list {
  flex: 1;
  padding: 0 24rpx 24rpx;
  box-sizing: border-box;
}

.msg-row {
  display: flex;
  margin-bottom: 16rpx;
}

.msg-row.user { justify-content: flex-end; }

.msg-row.assistant { justify-content: flex-start; }

/* 气泡 + 操作行竖排：操作行跟着气泡对齐，不会跑到屏幕另一头 */
.msg-col { display: flex; flex-direction: column; max-width: 78%; }

.msg-row.user .msg-col { align-items: flex-end; }

.bubble {
  padding: 20rpx 26rpx;
  border-radius: 24rpx;
  font-size: 30rpx;
  line-height: 1.6;
  word-break: break-word;
}

.bubble.user {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  border-bottom-right-radius: 6rpx;
}

.bubble.assistant {
  background: rgba(255, 255, 255, 0.74);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.74);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #17201a;
  color: var(--ink-1, #17201a);
  border-bottom-left-radius: 6rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.bubble.typing { display: flex; align-items: center; }

/* 气泡下面的小操作：收藏 / 朗读。字号压到 20rpx，不抢正文 */
.msg-acts {
  display: flex;
  align-items: center;
  margin-top: 8rpx;
  padding: 0 6rpx;
}

.msg-act {
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-right: 20rpx;
}

.msg-act.on { color: #7c3aed; font-weight: 600; }

.dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #c8cdc9;
  margin: 0 4rpx;
  animation: blink 1.2s infinite both;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

/* 底部输入条：与悬浮导航同一套磨砂玻璃，形成上下呼应 */
.input-bar {
  display: flex;
  align-items: center;
  padding: 16rpx 20rpx;
  padding-bottom: calc(16rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-top: 2rpx solid rgba(255, 255, 255, 0.7);
  border-top: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.chat-input {
  flex: 1;
  height: 76rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 999rpx;
  padding: 0 28rpx;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.send-btn {
  flex-shrink: 0;
  margin-left: 16rpx;
  height: 76rpx;
  line-height: 76rpx;
  padding: 0 36rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 999rpx;
}

.send-btn[disabled] { opacity: 0.5; }

/* ---------- 历史对话面板 ---------- */
.cb-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 60;
  background: rgba(23, 32, 26, 0.34);
  display: flex;
  align-items: flex-end;
}

.cb-sheet {
  width: 100%;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.96);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.cb-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }

.cb-title { font-size: 30rpx; font-weight: 600; color: #17201a; }
.cb-title { font-size: 30rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.cb-close { font-size: 24rpx; color: #98a19b; }
.cb-close { font-size: 24rpx; color: var(--ink-3, #98a19b); }

.cb-body { max-height: 56vh; }

.cb-item {
  padding: 20rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.cb-item.cur { }

.cb-line { display: flex; align-items: center; justify-content: space-between; }

.cb-name {
  flex: 1;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-item.cur .cb-name { font-weight: 600; color: #1d4fd8; }
.cb-item.cur .cb-name { color: var(--brand-strong, #1d4fd8); }

.cb-del { flex-shrink: 0; margin-left: 20rpx; font-size: 24rpx; color: #e5484d; }

.cb-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: #98a19b; }
.cb-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.cb-empty { padding: 60rpx 0; text-align: center; font-size: 26rpx; color: #98a19b; }
.cb-empty { padding: 60rpx 0; text-align: center; font-size: 26rpx; color: var(--ink-3, #98a19b); }
</style>
