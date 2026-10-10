<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <!-- 悬浮顶栏：首页是「搜索 + AI 指令」双模式输入框 -->
    <float-navbar
      ref="navbar"
      search
      :mode="inputMode"
      :busy="cmdBusy"
      :locked="modeLocked"
      switchable
      :placeholder="navPlaceholder"
      :value="keyword"
      @input="onSearchInput"
      @search="onSubmit"
      @focus="onInputFocus"
      @blur="onInputBlur"
      @clear="clearSearch"
      @mode-toggle="toggleMode"
    />

    <!-- 内容区：切 tab 时整体左右滑动（顶栏与底栏留在外面，不跟着滑） -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <!-- AI 指令：加载态 / 执行结果 / 错误提示 / 撤销 -->
    <view v-if="cmdBar" class="cmd-bar" :class="'is-' + cmdState">
      <view v-if="cmdBusy" class="cmd-spin"></view>
      <text class="cmd-text">{{ cmdBarText }}</text>
      <text v-if="cmdState === 'done' && cmdCanUndo" class="cmd-undo" @tap="undoLast">{{ $t('撤销') }}</text>
      <!-- 判错的兜底：这条本来是想查词 → 一键按原文重搜 -->
      <text v-if="cmdState === 'error' && lastCmdText" class="cmd-undo" @tap="retryAsSearch">{{ $t('当成查词') }}</text>
      <text v-if="!cmdBusy" class="cmd-close" @tap="closeCmdBar">×</text>
    </view>

    <!-- 指令模式的快捷示例：聚焦且还没输入时出现 -->
    <scroll-view v-if="showSuggest" class="cmd-sug" scroll-x>
      <text v-for="s in suggestions" :key="s" class="cmd-chip" @tap="useSuggestion(s)">{{ s }}</text>
    </scroll-view>

    <!-- 搜索结果 -->
    <view v-if="searching && !editing" class="card search-card">
      <view class="sr-head">
        <text class="sr-title">{{ searchTitle }}</text>
        <text class="sr-close" @tap="clearSearch">{{ $t('收起') }}</text>
      </view>

      <!-- 本地命中（可能只是"相近的"：搜 run 会出 running / runs） -->
      <block v-if="results.length">
        <view v-for="(it, i) in results" :key="i" class="sr-item" @tap="openWord(it)">
          <view class="sr-line">
            <text class="sr-word">{{ it.w }}</text>
            <text v-if="it.pos" class="sr-pos">{{ it.pos }}</text>
            <text class="tag sr-src">{{ it.fromText }}</text>
          </view>
          <text class="sr-mean">{{ it.m }}</text>
        </view>
        <text class="sr-tip">{{ $t('点击任意词条查看详情') }}</text>
      </block>

      <!-- 下面这一块**不再和上面互斥**（原来是 v-else-if 链）：
           本地只命中"相近的"时，AI 那一栏会被整块吞掉 ——
           用户要查的词一条都没有，AI 也不出手，于是两边都不显示。
           现在两块可以同时出现：上面是"你可能想找的"，下面是 AI / 缓存给出的这个词。 -->
      <view v-if="results.length && (cached || aiLoading || aiResult)" class="sr-split"></view>

      <!-- 底层缓存命中：之前生成过，离线也能直接看 -->
      <block v-if="cached">
        <!-- 缓存里的词同样点得开：要不要收进词书在单词页决定 -->
        <view class="sr-item" @tap="openWord({ w: cached.word })">
          <view class="sr-line">
            <text class="sr-word">{{ cached.word }}</text>
            <text v-if="cached.kind === 'sentence'" class="sr-pos">{{ $t('整句译文') }}</text>
            <text v-else-if="cached.pos" class="sr-pos">{{ cached.pos }}</text>
          </view>
          <text class="sr-mean">{{ cached.meaning }}</text>
          <view v-for="(ex, i) in cached.examples" :key="i" class="sr-ex">
            <text class="sr-ex-en">{{ ex.en }}</text>
            <text class="sr-ex-zh">{{ ex.zh }}</text>
          </view>
        </view>
        <text class="sr-tip">{{ $t('来自本机缓存，不消耗 AI 额度 · 点开词条可加入词书') }}</text>
      </block>

      <!-- AI 补充中：整句输入时说的是"翻译"而不是"补充释义"，别让用户以为又要给自己一个中文解释。
           同样用独立 v-if：有缓存时就不再发请求，两者不会同时出现，但别再写成互斥链，
           否则以后谁给缓存块加个前置条件，AI 这块又会跟着被吞。 -->
      <view v-if="aiLoading" class="sr-state">
        <view class="sr-spinner"></view>
        <text class="sr-state-text">{{ aiLoadingText }}</text>
      </view>

      <!-- AI 已补充：只进本机缓存，不进任何词书（收不收进词书由用户在单词页决定） -->
      <view v-if="aiResult" class="sr-ai" @tap="openWord({ w: aiResult.word })">
        <view class="sr-line">
          <text class="sr-word">{{ aiResult.word }}</text>
          <text v-if="aiResult.kind === 'sentence'" class="sr-pos">{{ $t('整句译文') }}</text>
          <text v-else-if="aiResult.pos" class="sr-pos">{{ aiResult.pos }}</text>
        </view>
        <text class="sr-mean">{{ aiResult.meaning }}</text>
        <view v-for="(ex, i) in aiResult.examples" :key="i" class="sr-ex">
          <text class="sr-ex-en">{{ ex.en }}</text>
          <text class="sr-ex-zh">{{ ex.zh }}</text>
        </view>
        <view class="sr-foot">
          <text class="sr-badge">{{ aiBadge }}</text>
          <text class="sr-speak" :data-w="aiResult.word" @tap.stop="speakResult">{{ $t('发音') }}</text>
        </view>
        <text class="sr-tip">{{ $t('点开词条可加入词书') }}</text>
      </view>

      <!-- 没有结果：本地一条都没有、缓存和 AI 也没给东西 -->
      <view v-if="!results.length && !cached && !aiLoading && !aiResult" class="sr-state">
        <text class="sr-state-text">{{ $t('本地词库没有「{q}」', { q: lastQuery }) }}</text>
        <text class="sr-state-hint">{{ aiEnabled ? $t('AI 也未能补充这个词，换个拼写试试') : $t('接入 AI 后，搜不到的词会自动补充到本机缓存') }}</text>
        <view class="sr-actions">
          <text v-if="aiEnabled" class="sr-retry" @tap="aiLookup(lastQuery)">{{ $t('再试一次') }}</text>
          <!-- 反向兜底：这句其实是想让 AI 改页面 → 一键按指令重跑 -->
          <text class="sr-retry sr-retry-cmd" @tap="retryAsCommand">{{ $t('当成指令试试') }}</text>
        </view>
      </view>
    </view>

    <!-- 首页模块：按用户保存的顺序渲染；编辑态显示拖拽手柄与收纳按钮 -->
    <view
      class="mod-list"
      @touchmove="dragMove"
      @touchend="dragEnd"
      @touchcancel="dragEnd"
    >
      <view
        v-for="(c, i) in renderCards"
        :key="c.id"
        class="mod-wrap"
        :class="{ 'is-drag': dragIndex === i, 'is-editing': editing }"
        :style="wrapStyle(i)"
      >
        <!-- 编辑态遮罩：屏蔽模块内部点击（换词书 / 主按钮 / 小组件链接），只留手柄与收纳可点 -->
        <view v-if="editing" class="mod-shield"></view>

        <!-- 编辑态：整行都是拖动把手（触摸 + H5 鼠标都支持），收纳按钮除外 -->
        <view
          v-if="editing"
          class="mod-bar"
          @touchstart="dragStart(i, $event)"
          @mousedown="dragStartMouse(i, $event)"
        >
          <view class="mod-grip">
            <view class="grip-lines">
              <view class="grip-line"></view>
              <view class="grip-line"></view>
              <view class="grip-line"></view>
            </view>
            <text class="grip-text">{{ $t('拖动') }}</text>
          </view>
          <!-- 模块名：内置卡来自注册表（home-layout 的 name 字段），AI 卡用卡片标题 -->
          <text class="mod-name">{{ $t(moduleName(c)) }}</text>
          <text class="mod-hide" @touchstart.stop="noop" @mousedown.stop="noop" @tap="stashModule(c.id)">{{ $t('收纳') }}</text>
        </view>

        <!-- AI 造的卡片：统一走块渲染器（13 种块，schema 之外画不出来）。
             收纳 / 删除不再放卡片表面，编辑态和其他模块一样走上面的把手与「收纳」，
             彻底删除在「添加组件」面板里做（原生内置卡只能收纳、不可删除）。 -->
        <view v-if="!c.builtin" class="mod-widget">
          <app-card-blocks
            :card="c"
            :live="live"
            :editable="!editing"
            @toggle="onCardToggle"
            @state="onCardState"
            @action="onCardAction"
            @image="onCardImage"
          />
        </view>

        <!-- 模块 A：当前词书 -->
        <!-- 整卡点进「词库详情 → 批次进度」（卡片主体就是当前批次）。
             右上角那颗是另一件事 —— 「换词书」去的是独立的选择词书页（book-switch），
             所以它必须 @tap.stop，否则一次点击会先换页再叠一层详情页。 -->
        <view v-else-if="c.type === 'book'" class="card book-head-card tappable" :style="cardStyle(c)" @tap="goBookDetail">
          <view class="book-info">
            <view class="book-name">{{ bookName }}</view>
            <!-- 主进度展示"当前批次"，总进度作为次要信息（640 词时整本进度条几乎为 0） -->
            <view class="book-progress-text" v-if="batchTotal > 0">
              {{ batchNameText }} · {{ $t('已学 {t} / {n} 词', { t: batchTouched, n: batchTotal }) }}
            </view>
            <view class="book-progress-text" v-else-if="batchless">{{ $t('该词书还没有词汇，去「词库」添加') }}</view>
            <view class="book-progress-text" v-else>{{ $t('尚未开始') }}</view>
            <view class="progress-track book-track">
              <view class="progress-fill" :style="{ width: batchPct + '%' }"></view>
            </view>
            <view class="book-sub" v-if="wordCount > 0">{{ $t('全书已学 {t} / {n} 词', { t: touched, n: wordCount }) }}</view>
          </view>
          <view class="switch-link" @tap.stop="goBooks">{{ $t('换词书 ›') }}</view>
        </view>

        <!-- 模块 B：主行动区 -->
        <!-- 这里只放「翻译练习」这条线（主按钮 + 复习错题 + AI 专练）。
             刷单词是另一条线，入口只在下面那张独立的「刷单词」卡里 ——
             以前这里还挂着一颗「刷单词（背词义）」小胶囊，与卡片完全重复，
             而且三颗胶囊并排必然挤到换行裁字，已删。
             「复习错题」不做 v-if 隐藏：错题数一旦归零整颗胶囊就消失，
             用户会以为功能被删了（实际只是没有错题）。改成常驻 + 置灰，
             与「AI 薄弱点专练」未配置时的形态一致。 -->
        <view v-else-if="c.type === 'action'" class="action-area" :style="cardStyle(c)">
          <button class="btn-primary start-btn" @tap="startPractice">{{ today.total > 0 ? $t('继续学习') : $t('开始背单词') }}</button>
          <view class="mini-row">
            <button class="btn-mini" :class="{ 'entry-disabled': wrongCount === 0 }" @tap="goReview">
              {{ wrongCount > 0 ? $t('复习 {n} 道错题', { n: wrongCount }) : $t('复习错题') }}
            </button>
            <button class="btn-mini" :class="{ 'entry-disabled': !aiEnabled }" @tap="goDrill">{{ $t('AI 薄弱点专练') }}</button>
          </view>
          <view class="action-tip">{{ $t('每次 {n} 题 · 中英互译 · 难度随掌握情况调整', { n: sessionSize }) }}</view>
        </view>

        <!-- 模块 C：今日数据条（三项分别跳详情） -->
        <view v-else-if="c.type === 'stats'" class="card stats-row" :style="cardStyle(c)">
          <view class="stat-item" @tap="goHistory">
            <text class="stat-num">{{ today.total }}</text>
            <text class="stat-label">{{ $t('已练(题)') }}</text>
          </view>
          <view class="stat-item" @tap="goReviewList">
            <text class="stat-num" :class="{ warn: wrongCount > 0 }">{{ wrongCount }}</text>
            <text class="stat-label">{{ $t('待复习') }}</text>
          </view>
          <view class="stat-item" @tap="goStreak">
            <text class="stat-num">{{ streak }}</text>
            <text class="stat-label">{{ $t('连续(天)') }}</text>
          </view>
        </view>

        <!-- 可选小组件：掌握度概览 / 收藏速览 / 打卡周历 / 打卡走势 / 每日目标 / 停留时长 / 刷单词 -->
        <view v-else-if="c.type === 'progress'" class="mod-widget"><widget-progress /></view>
        <view v-else-if="c.type === 'favorites'" class="mod-widget"><widget-favorites /></view>
        <view v-else-if="c.type === 'streak'" class="mod-widget"><widget-streak /></view>
        <view v-else-if="c.type === 'chart'" class="mod-widget"><widget-chart /></view>
        <view v-else-if="c.type === 'goal'" class="mod-widget"><widget-goal /></view>
        <view v-else-if="c.type === 'usage'" class="mod-widget"><widget-usage /></view>
        <view v-else-if="c.type === 'worddrill'" class="mod-widget"><widget-worddrill /></view>
        <view v-else-if="c.type === 'chat'" class="mod-widget"><widget-chat /></view>

        <!-- AI 给内置卡加的配图与批注文案 -->
        <image v-if="c.builtin && c.image" class="mod-image" :src="c.image" mode="aspectFill" />
        <text v-if="c.builtin && c.text" class="mod-note">{{ c.text }}</text>
      </view>

      <!-- 空态兜底：理论上 normalize() 不会给出空布局 -->
      <view v-if="!renderCards.length" class="home-empty">
        <text class="home-empty-text">{{ $t('首页空空如也') }}</text>
        <text class="home-empty-link" @tap="toggleEdit">{{ $t('编辑首页，把组件加回来') }}</text>
      </view>
    </view>

    <!-- 底部操作行：非编辑态只留一个入口，保持简洁 -->
    <view class="home-foot">
      <block v-if="editing">
        <view class="foot-btn ghost" @tap="openSheet">{{ $t('＋ 添加组件') }}</view>
        <view class="foot-btn primary" @tap="finishEdit">{{ $t('完成') }}</view>
      </block>
      <view v-else class="foot-link" @tap="toggleEdit">{{ $t('编辑首页') }}</view>
    </view>
    </view>

    <!-- 收纳区：从首页移出的模块，可一键加回（放在 page-slide 之外，fixed 参照不受滑动动画影响） -->
    <view v-if="sheetShow" class="sheet-mask" @tap="closeSheet">
      <view class="sheet" @tap.stop="">
        <view class="sheet-head">
          <text class="sheet-title">{{ $t('添加组件') }}</text>
          <text class="sheet-close" @tap="closeSheet">{{ $t('关闭') }}</text>
        </view>
        <scroll-view class="sheet-body" scroll-y>
          <view
            v-for="m in sheetList"
            :key="m.id"
            class="sheet-item"
            @tap="restoreModule(m.id)"
          >
            <view class="sheet-info">
              <text class="sheet-name">{{ $t(m.name) }}</text>
              <text class="sheet-desc">{{ $t(m.desc) }}</text>
            </view>
            <text class="sheet-add">{{ $t('添加') }}</text>
          </view>
          <!-- AI 生成的卡片：收纳后在这里加回；也可以在这里彻底删除（不可恢复）。
               原生内置组件没有删除入口 —— 只能收纳，永远可以加回来。 -->
          <view v-if="aiSheetList.length" class="sheet-sep">
            <text class="sheet-sep-label">{{ $t('AI 生成的卡片') }}</text>
          </view>
          <view v-for="c in aiSheetList" :key="c.id" class="sheet-item">
            <view class="sheet-info">
              <text class="sheet-name">{{ $t(moduleName(c)) }}</text>
              <text class="sheet-desc">{{ $t('AI 生成的卡片，删除后无法恢复') }}</text>
            </view>
            <view class="sheet-ops">
              <text class="sheet-add" @tap="restoreModule(c.id)">{{ $t('添加') }}</text>
              <text class="sheet-del" @tap="deleteAiCard(c.id)">{{ $t('删除') }}</text>
            </view>
          </view>
          <view v-if="!sheetList.length && !aiSheetList.length" class="sheet-empty">
            <text class="sheet-empty-text">{{ $t('所有组件都已在首页上') }}</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="home" />

    <!-- 新手引导：首次进入分步高亮（fixed 浮层放在 .page-slide 之外） -->
    <onboarding-mask
      v-if="guide.show"
      :step="guideStep"
      :index="guide.index"
      :total="guide.total"
      :box="guide.box"
      :dark="isDark"
      @next="guideNext"
      @skip="guideFinish"
    />

    <!-- 删除 AI 卡确认（统一弹窗，替代系统 showModal；内置卡没有删除入口） -->
    <app-dialog
      :show="delConfirm.show"
      :title="$t('删除卡片')"
      :content="$t('将删除「{name}」，无法恢复。', { name: delConfirm.name })"
      :confirm-text="$t('删除')"
      :danger="true"
      @confirm="onDeleteConfirm"
      @cancel="delConfirm.show = false"
    />
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
import * as wordbook from '../../utils/wordbook'
import * as dict from '../../utils/dict'
import * as search from '../../utils/search'
import { aiGateReason } from '../../services/config.js'
import { speakWord } from '../../services/voice.js'
import { explainWord, looksLikeSentence } from '../../services/ai-content.js'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import * as aiCache from '../../utils/ai-cache.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import WidgetProgress from '../../components/home-widgets/widget-progress.vue'
import WidgetFavorites from '../../components/home-widgets/widget-favorites.vue'
import WidgetStreak from '../../components/home-widgets/widget-streak.vue'
import WidgetChart from '../../components/home-widgets/widget-chart.vue'
import WidgetGoal from '../../components/home-widgets/widget-goal.vue'
import WidgetUsage from '../../components/home-widgets/widget-usage.vue'
import WidgetWorddrill from '../../components/home-widgets/widget-worddrill.vue'
import WidgetChat from '../../components/home-widgets/widget-chat.vue'
import AppCardBlocks from '../../components/app-card-blocks.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import * as homeLayout from '../../utils/home-layout.ts'
import * as pageDoc from '../../utils/page-doc.js'
import * as pageCommand from '../../utils/page-command.js'
import * as intent from '../../utils/intent.js'
import * as pageAgent from '../../services/page-agent.js'
import * as cardSpec from '../../utils/card-spec.js'
import { speak as speakAny } from '../../services/voice.js'
import * as onboarding from '../../utils/onboarding.js'
import OnboardingMask from '../../components/onboarding-mask.vue'

// AI 补充的触发延迟：避免边打字边请求
const AI_DELAY = 700

// 在飞的 AI 查词（按词小写去重）。debounce 只挡得住"连续打字"，
// 挡不住"删一个字符再打回来"这种来回切换 —— 那会在 700ms 后各发一次，
// 同一个词花两份 token，回来晚了的那份还会覆盖掉先到的结果。
const AI_INFLIGHT = new Set()

// 把对象 String() 出来的垃圾（"[object Object]" 之类）。
// 以前它会被当成正经搜索词：AI 去解释它、把结果写进词库，
// 于是搜索里就冒出一个莫名其妙的 "Object"。现在一律拦掉。
const JUNK_TEXT = /^\[object\s/i
// 一个"像样的待查词"：字母/数字起头，只允许字母、数字、空格、撇号、连字符，≤40 字。
// 中英文单词、词组都过；"[object Object]"、整段句子、JSON 碎片都不过。
//
// 千万别写回 /^[\p{L}\p{N}]...$/u —— 这里原来是 Unicode 属性转义（\p{L} + /u），
// App 端的 app-service.js 跑在 uni-app 自带 JS 引擎（不是系统 WebView），
// 老引擎不认 \p{...}，会在**模块顶层**直接抛 SyntaxError：整个 home 模块没执行完，
// 页面实例建不起来 → createInstanceContext failed → 白屏。
// 内置浏览器（新版 Chrome）支持所以看不出问题，安卓基座才会炸。
// 下面用显式码点区间，语义等价且不带 /u：
//   \u00C0-\u024F 拉丁扩展（ā é ñ 等带音标字母） \u0400-\u04FF 西里尔
//   \u4E00-\u9FFF 中日韩统一表意文字（汉字）
const WORDISH = /^[A-Za-z0-9_\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF][A-Za-z0-9_\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\s'’\-·]{0,39}$/

/* 「本地有近似命中、但没有一模一样的」时补问 AI 的门槛。
   这条路比"一条都没有"那条路更容易误伤：本地命中越多说明用户还在打字中间态，
   把 ru / runn 这种半成品送去生成，既白烧 token，缓存里还会多一堆垃圾词条。
   所以门槛更严：① 只认字母类单词（中文查询走本地释义匹配，那本来就是它要的）
                  ② 至少 3 个字符
                  ③ 停顿更久才发（1100ms）
   同样别用 /\p{...}/u —— 见 WORDISH 上方注释：App 端老引擎不认，会在模块顶层炸。 */
const LATIN_WORD = /^[A-Za-z\u00C0-\u024F\u0400-\u04FF][A-Za-z\u00C0-\u024F\u0400-\u04FF\s'’\-·]{0,39}$/
const AI_NEAR_DELAY = 1100
const AI_NEAR_MIN_LEN = 3

// tabBar 页：只能用 switchTab 打开（AI 卡的按钮动作也要遵守）
const TAB_PAGES = ['/pages/home/home', '/pages/library/library', '/pages/review/review', '/pages/profile/profile']

export default {
  components: {
    FloatTabbar,
    FloatNavbar,
    WidgetProgress,
    WidgetFavorites,
    WidgetStreak,
    WidgetChart,
    WidgetGoal,
    WidgetUsage,
    WidgetWorddrill,
    WidgetChat,
    AppCardBlocks,
    OnboardingMask,
    AppDialog
  },
  mixins: [tabSlideMixin('home')],
  data() {
    return {
      bookId: '',
      bookName: '',
      touched: 0,
      mastered: 0,
      wordCount: 0,
      bookPct: 0,
      batchIndex: 0,
      batchName: '',
      batchTouched: 0,
      batchMastered: 0,
      batchTotal: 0,
      batchPct: 0,
      batchless: false,
      today: { total: 0, correct: 0 },
      streak: 0,
      wrongCount: 0,
      // 每组题量 = 当前词书的「每日学会题量」目标（词库详情 → 每日目标 可调）
      sessionSize: 10,
      aiEnabled: false,
      aiReason: '',
      // 顶部搜索
      keyword: '',
      lastQuery: '',
      searching: false,
      results: [],
      // 底层缓存命中的历史结果（离线可看，不发请求）
      cached: null,
      aiResult: null,
      aiLoading: false,
      searchTimer: 0,
      // ---------- 首页布局（顺序 / 编辑态 / 拖拽） ----------
      layout: [],
      editing: false,
      sheetShow: false,
      sheetList: [],
      // 删除 AI 卡的确认弹窗（AppDialog）：记下要删的卡 id 与名字
      delConfirm: { show: false, id: '', name: '' },
      dragIndex: -1,
      dragDy: 0,
      dragStartY: 0,
      dragHeights: [],
      // ---------- 页面文档（AI 指令唯一能改的东西） ----------
      doc: null,
      live: {},
      // ---------- 新手引导（utils/onboarding.js 定义步骤与状态） ----------
      guide: { show: false, index: 0, total: 0, box: null },
      guideTimer: 0,
      guideSeq: 0,   // 测量回调的防陈旧标记：步骤切走后回来的旧结果直接丢弃
      // ---------- AI 指令输入框 ----------
      inputMode: 'search',       // search | command
      // 模式是否被手动锁定：锁了之后打字不再自动改判，清空输入才解锁
      modeLocked: false,
      // 上一次提交的原文：指令失败时用它"当成查词"重跑，不要求用户重新输入
      lastCmdText: '',
      inputFocused: false,
      // 推荐条的"存活"状态：blur 后延迟 300ms 才收起（见 onInputBlur 的注释）
      suggestAlive: false,
      cmdState: '',              // '' | thinking | running | done | error
      cmdSay: '',
      cmdSummary: '',
      cmdError: '',
      cmdCanUndo: false,
      cmdRunning: false,
      suggestions: intent.SUGGESTIONS
    }
  },
  computed: {
    /** 双模式输入框：指令态给不同的 placeholder 与提示 */
    navPlaceholder() {
      void this.__lang   // 建立渲染依赖：切语言后 computed 立刻重算（否则 placeholder 卡在旧语言）
      return this.inputMode === 'command'
        ? t('说句话改首页，例如「背景换成安静的蓝」')
        : t('搜索单词或中文释义（/ @ 开头下指令）')
    },
    cmdBusy() {
      return this.cmdState === 'thinking' || this.cmdState === 'running'
    },
    cmdBar() {
      return !!this.cmdState
    },
    cmdBarText() {
      void this.__lang
      if (this.cmdState === 'thinking') return t('正在理解你的指令…')
      if (this.cmdState === 'running') return t('正在应用改动…')
      if (this.cmdState === 'error') return this.cmdError || t('这条指令没能执行')
      // 部分成功：有指令被校验跳过时也要说出来 —— 只报成功摘要，用户会以为整批都改了
      const done = this.cmdSay || this.cmdSummary || t('已应用')
      return this.cmdError ? t('已应用，但有一处没做到：{why}', { why: this.cmdError }) : done
    },
    showSuggest() {
      // 用 suggestAlive（blur 延迟收起）而不是 inputFocused：
      // inputFocused 实时变化会抢在 tap 之前把推荐条收走
      return this.inputMode === 'command' && this.suggestAlive && !this.keyword && !this.cmdBusy
    },
    /** 渲染用的卡片列表：平时看所有可见卡；编辑态也是全部可见卡（AI 卡与内置卡同样可拖拽 / 收纳） */
    renderCards() {
      const cs = (this.doc && this.doc.cards) || []
      return cs.filter(c => c.visible !== false)
    },
    /** 收纳区里的 AI 卡片：被收纳（visible=false）的那几张，可加回或彻底删除 */
    aiSheetList() {
      return ((this.doc && this.doc.cards) || []).filter(c => !c.builtin && c.visible === false)
    },
    searchTitle() {
      void this.__lang
      // 整句 + 占位符：英文里数量要放在中间（"{n} matches"），拼接会把语序搞反
      if (this.results.length) {
        // 下面还有 AI / 缓存那一块 → 说明本地只是"相近的"，标题必须讲清楚，
        // 否则用户会以为这几条里就有他要查的词
        if (this.cached || this.aiLoading || this.aiResult) {
          return t('没有完全匹配 · 下面 {n} 条是相近的', { n: this.results.length })
        }
        return t('本地词库 · 命中 {n} 条', { n: this.results.length })
      }
      if (this.cached) return t('缓存结果')
      if (this.aiLoading) return t('AI 补充中')
      if (this.aiResult) return t('AI 补充结果')
      return t('没有找到')
    },
    /** AI 补充结果的角标：以前会顺手写进词书，现在只落本机缓存 */
    // 等待提示分两种：查词是"补充释义"，整句是"翻译"。
    // 说成"补充释义"会让输入整句的人以为又要拿回一句中文解释。
    aiLoadingText() {
      void this.__lang
      const q = this.lastQuery
      if (looksLikeSentence(q)) return t('正在翻译「{q}」…', { q: q })
      // 本地有（相近的）命中时不能再说"本地词库没有" —— 上面明明列着几条
      return this.results.length
        ? t('没有完全匹配，正在用 AI 补充「{q}」…', { q: q })
        : t('本地词库没有「{q}」，正在用 AI 补充…', { q: q })
    },
    aiBadge() {
      void this.__lang
      return t('本机缓存 · 未加入词书')
    },
    /**
     * 批次名的展示层翻译。批次名在数据层生成时已拼死（"入门高频词 · 第 1 组"、
     * "全部词汇"、"导入批次 1"），而且老数据持久化里存的就是中文字符串 ——
     * 没法改生成逻辑了，只能展示时拆开翻：级别名和"第 n 组"各自走 i18n，
     * 查不到的（自建批次名等）原样回退。
     */
    batchNameText() {
      void this.__lang
      const name = this.batchName || ''
      let m = name.match(/^(.*) · 第 (\d+) 组$/)
      if (m) return t(m[1]) + ' · ' + t('第 {n} 组', { n: m[2] })
      m = name.match(/^导入批次 (\d+)$/)
      if (m) return t('导入批次 {n}', { n: m[1] })
      return t(name)
    },
    // 引导当前步骤（越界为 null，遮罩自动不渲染）
    guideStep() {
      return onboarding.stepAt(this.guide.index)
    },
    // 引导遮罩深浅色：模态层固定配色，这里只判一下当前主题
    isDark() {
      return (this.appTheme || '').indexOf('app-dark') >= 0
    }
  },
  created() {
    // 卡片样式缓存（见 cardStyle）：故意不进 data —— 不参与响应式，省掉额外渲染。
    // 但必须先挂到实例上：Vue 3 在**渲染期**访问实例上不存在的属性会告警
    // （"Property _styleSrc was accessed during render but is not defined"）。
    this._styleSrc = null
    this._styleMap = {}
  },
  onLoad() {
    this.refreshDoc()
  },
  onShow() {
    // 从搜索结果点进词条、再返回 → 搜索面板自动收起，回到干净的首页。
    // 只认 openWord 发起的那一次跳转（__searchOpened）：切 tab、从词库返回、
    // 首次进入都不受影响 —— 搜完就看，看完就退，不用再手动点「收起」。
    // 放在 onShow 最前面：它不依赖下面任何一步（词书概览 / 引导 / 布局刷新），
    // 即使后面某步出错，用户也一定退得出搜索。
    if (this.__searchOpened) {
      this.__searchOpened = false
      if (this.searching) this.clearSearch()
    }
    hideNativeTabBar()
    syncTabbar(this)
    // 词书在词库页切换后，回到首页自动刷新
    Object.assign(this, wordbook.homeOverview())
    this.sessionSize = this.loadSessionSize()
    const r = aiGateReason()
    this.aiReason = r
    this.aiEnabled = !r
    // 布局可能被「添加组件」改过，回到首页重新读一次
    this.refreshDoc()
    // 小组件（每日目标 / 打卡走势）是常驻实例，靠这个事件重新取数
    try { uni.$emit('home:refresh') } catch (e) {}
    // 首次进入：放一遍新手引导（已看完 / 跳过则不弹；设置页可重看）
    this.queueGuide()
  },
  onHide() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
    // 推荐条的延迟收起定时器也一并清掉，回来时重新由 focus 驱动
    if (this.__suggestTimer) { clearTimeout(this.__suggestTimer); this.__suggestTimer = 0 }
    this.suggestAlive = false
    // 离开首页一律退出编辑态，保证回来时界面是简洁的
    this.editing = false
    this.sheetShow = false
    this.dragIndex = -1
    this.dragDy = 0
    // 引导没放完就切走了：必须把遮罩收起来。
    // 遮罩是「9999px 扩散」的 fixed 层，留在页面上会盖住一切（包括底部导航）；
    // 别的页面也没有对应遮罩，回不来就成了"死遮罩"。
    // 这里只收起 UI、不复写 index —— 没走完就不置完成标记，回到首页会从断点继续。
    if (this.guide.show) {
      this.guide.show = false
      this.guide.box = null
    }
    if (this.guideTimer) { clearTimeout(this.guideTimer); this.guideTimer = 0 }
  },
  // 返回键 / 返回手势：搜索结果、编辑态、收纳抽屉都是"页面里的临时状态"，
  // 返回键该先退出它们，而不是直接把 App 退出（首页是栈底页，返回 = 退出应用）。
  // 和 library-detail 的 onBackPress 同一套约定：return true = 这次返回已被消化。
  // 顺序 = 覆盖层级从内到外：抽屉 → 编辑 → 搜索（搜索卡只在非编辑态出现）。
  // 注意：小程序端没有这个钩子，那边靠右上角胶囊返回，行为不受影响。
  onBackPress() {
    if (this.sheetShow) { this.closeSheet(); return true }
    if (this.editing) { this.finishEdit(); return true }
    if (this.searching) { this.clearSearch(); return true }
    return false
  },
  methods: {
    // ---------- 新手引导 ----------
    // 原则：目标测不到（被收纳 / 结构变了）就跳过那一步，宁可少讲也不能卡死。
    // 首次进首页延迟一拍再启动：等首屏卡片渲染完，测量才有目标。
    queueGuide() {
      if (!onboarding.shouldShow() || this.guide.show) return
      if (this.guideTimer) clearTimeout(this.guideTimer)
      this.guideTimer = setTimeout(() => {
        this.guideTimer = 0
        // 等待期间可能已在设置页重看过又完成（极端时序），再核对一次
        if (!onboarding.shouldShow()) return
        this.guide.total = onboarding.count()
        // 走到一半被打断过（onHide 收起了遮罩）就从断点继续，否则从头开始
        if (!(this.guide.index > 0 && this.guide.index < onboarding.count())) {
          this.guide.index = 0
        }
        this.guide.box = null
        this.guide.show = true
        this.measureGuide()
      }, 700)
    },
    measureGuide() {
      const st = onboarding.stepAt(this.guide.index)
      if (!st) { this.guideFinish(); return }
      if (!st.target) { this.guide.box = null; return }
      const seq = ++this.guideSeq
      this.rectOf(st.target).then(rect => {
        if (seq !== this.guideSeq) return
        if (!rect || !(rect.width > 0)) { this.guideNext(); return }
        // 目标不在视口内（如「编辑首页」在页面底部）：滚到屏幕中部再测一次
        const vh = this.guideViewportH()
        if (rect.top < 0 || rect.top + rect.height > vh) {
          this.scrollGuideTarget(rect, () => {
            this.rectOf(st.target).then(r2 => {
              if (seq !== this.guideSeq) return
              this.guide.box = (r2 && r2.width > 0) ? r2 : rect
            })
          })
          return
        }
        this.guide.box = rect
      })
    },
    // 测一个引导目标的视口矩形。两种来源：
    //   { sel }       页面内元素 → createSelectorQuery().in(this)
    //   { ref, sel }  子组件内元素 → 组件暴露的 rect(sel, cb)
    //                 （小程序端页面的 query 选不进自定义组件内部）
    rectOf(target) {
      return new Promise(resolve => {
        let settled = false
        const done = (r) => { if (!settled) { settled = true; resolve(r || null) } }
        try {
          const comp = target.ref ? this.$refs[target.ref] : null
          if (comp && typeof comp.rect === 'function') {
            comp.rect(target.sel, done)
          } else {
            uni.createSelectorQuery().in(this).select(target.sel).boundingClientRect(done).exec()
          }
        } catch (e) {
          done(null)
        }
        setTimeout(() => done(null), 900) // 兜底：回调不来（节点不存在等）就当测不到
      })
    },
    scrollGuideTarget(rect, cb) {
      try {
        const q = uni.createSelectorQuery().in(this)
        q.selectViewport().scrollOffset()
        q.exec(res => {
          const cur = (res && res[0] && res[0].scrollTop) || 0
          const to = Math.max(0, cur + rect.top - this.guideViewportH() / 2 + rect.height / 2)
          try { uni.pageScrollTo({ scrollTop: to, duration: 200 }) } catch (e) { /* 不滚就放上面 */ }
          setTimeout(cb, 340)
        })
      } catch (e) {
        cb()
      }
    },
    guideViewportH() {
      try {
        const s = uni.getSystemInfoSync()
        return s.windowHeight || 600
      } catch (e) {
        return 600
      }
    },
    guideNext() {
      const r = onboarding.advance(this.guide.index, this.guide.total)
      if (r.done) { this.guideFinish(); return }
      this.guide.index = r.index
      this.guide.box = null
      this.measureGuide()
    },
    guideFinish() {
      this.guideSeq++
      this.guide.show = false
      this.guide.box = null
      this.guide.index = 0
      onboarding.finish()
    },

    // ---------- 首页布局：顺序 / 收纳 / 拖拽 ----------
    // 唯一真相是 pageDoc.cards；homeLayout 只是模块注册表 + 老设置的兼容镜像
    refreshDoc() {
      try {
        this.doc = pageDoc.get()
      } catch (e) {
        this.doc = null
      }
      try {
        this.live = pageDoc.liveValues()
      } catch (e) {
        this.live = {}
      }
      this.layout = this.builtinIds()
      this.cmdCanUndo = pageCommand.canUndo()
    },
    builtinIds() {
      return ((this.doc && this.doc.cards) || []).filter(c => c.builtin).map(c => c.id)
    },
    /**
     * 可见卡在 doc.cards 里的下标序列：编辑态的拖拽下标要换算回真实下标。
     * 必须和 renderCards 的口径一致（全部可见卡，内置 + AI），否则收纳过卡片后会错位。
     */
    visibleIndexes() {
      const out = []
      ;((this.doc && this.doc.cards) || []).forEach((c, i) => {
        if (c.visible !== false) out.push(i)
      })
      return out
    },
    /** 内置结构的任何改动都要落盘，并回写 homeLayout 让老入口保持一致 */
    persistDoc(doc) {
      this.doc = doc
      pageDoc.save(doc)
      try { homeLayout.saveLayout(pageDoc.builtinOrder(doc)) } catch (e) { /* 兼容镜像写失败无碍 */ }
      this.layout = this.builtinIds()
    },
    has(id) {
      return this.layout.indexOf(id) >= 0
    },
    /** 每组题量：与练习页同源，均取当前词书的「每日学会题量」目标 */
    loadSessionSize() {
      try {
        const g = wordbook.getGoal(this.bookId || wordbook.currentBookId())
        const n = Number(g && g.practice) || 10
        return Math.max(5, Math.min(50, n))
      } catch (e) {
        return 10
      }
    },
    nameOf(id) {
      const m = homeLayout.moduleOf(id)
      return m ? m.name : id
    },
    /** 编辑态把手 / 收纳区里显示的名字：内置卡查注册表，AI 卡用标题 */
    moduleName(c) {
      if (!c) return ''
      if (c.builtin) return this.nameOf(c.id)
      return c.title || t('AI 卡片')
    },
    toggleEdit() {
      this.editing = !this.editing
      if (!this.editing) this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    finishEdit() {
      this.editing = false
      this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    // 收纳区 = 注册表里「不在首页 / 已隐藏」的模块
    openSheet() {
      const cs = (this.doc && this.doc.cards) || []
      this.sheetList = homeLayout.MODULES.filter(m => {
        const hit = cs.find(c => c.id === m.id)
        return !hit || hit.visible === false
      })
      this.sheetShow = true
    },
    closeSheet() {
      this.sheetShow = false
    },
    stashModule(id) {
      const cards = (this.doc && this.doc.cards) || []
      const card = cards.find(c => c.id === id)
      const name = this.moduleName(card)
      const visible = cards.filter(c => c.visible !== false)
      if (visible.length <= 1) {
        uni.showToast({ title: t('至少保留一个组件'), icon: 'none' })
        return
      }
      this.persistDoc(pageDoc.setVisible(this.doc, id, false))
      uni.showToast({ title: t('已收纳「{name}」', { name: t(name) }), icon: 'none' })
    },
    restoreModule(id) {
      const cards = (this.doc && this.doc.cards) || []
      const card = cards.find(c => c.id === id)
      const name = this.moduleName(card)
      if (card) {
        this.persistDoc(pageDoc.setVisible(this.doc, id, true))
      } else {
        // 从未上过首页的模块：补一张内置卡进去
        const next = Object.assign({}, this.doc, {
          cards: cards.concat([pageDoc.__builtin(id)])
        })
        this.persistDoc(next)
      }
      uni.showToast({ title: t('已添加「{name}」', { name: t(name) }), icon: 'none' })
    },
    /**
     * 彻底删除一张 AI 卡（收纳区里的「删除」）。内置卡没有这个入口 —— 原生组件
     * 只能收纳、永远可加回；AI 卡删掉即从 doc 里移除，无法恢复，所以先确认。
     */
    deleteAiCard(id) {
      const card = ((this.doc && this.doc.cards) || []).find(c => c.id === id)
      if (!card || card.builtin) return
      this.delConfirm = { show: true, id: id, name: this.moduleName(card) }
    },
    onDeleteConfirm() {
      const id = this.delConfirm.id
      const name = this.delConfirm.name
      this.delConfirm.show = false
      if (!id) return
      this.persistDoc(pageDoc.removeCard(this.doc, id))
      uni.showToast({ title: t('已删除「{name}」', { name: name }), icon: 'none' })
    },
    // 拖拽：把"记录起点 + 量各模块高度"抽成公共入口，触摸 / 鼠标两条路共用
    beginDrag(i, clientY) {
      this.dragIndex = i
      this.dragStartY = typeof clientY === 'number' ? clientY : 0
      this.dragDy = 0
      this.dragHeights = []
      try {
        const q = uni.createSelectorQuery().in(this)
        q.selectAll('.mod-wrap').boundingClientRect()
        q.exec(res => {
          const arr = (res && res[0]) || []
          this.dragHeights = arr.map(r => (r && r.height) || 0)
        })
      } catch (err) {
        this.dragHeights = []
      }
    },
    dragStart(i, e) {
      if (!this.editing) return
      const t = (e && e.touches && e.touches[0]) || {}
      this.beginDrag(i, t.clientY)
    },
    // H5 桌面浏览器没有 touch 事件（用户用鼠标），补一条 mouse 路径；
    // App 端逻辑层没有 document，自动跳过
    dragStartMouse(i, e) {
      if (!this.editing) return
      if (typeof document === 'undefined') return
      if (e && e.preventDefault) e.preventDefault()
      this.beginDrag(i, e ? e.clientY : 0)
      const mm = (ev) => {
        this.dragDy = (ev && typeof ev.clientY === 'number' ? ev.clientY : 0) - this.dragStartY
      }
      const mu = () => {
        document.removeEventListener('mousemove', mm)
        document.removeEventListener('mouseup', mu)
        this.dragEnd()
      }
      document.addEventListener('mousemove', mm)
      document.addEventListener('mouseup', mu)
    },
    dragMove(e) {
      if (this.dragIndex < 0) return
      const t = (e && e.touches && e.touches[0]) || {}
      const y = typeof t.clientY === 'number' ? t.clientY : 0
      const dy = y - this.dragStartY
      // 只在同一屏内做小幅位移，避免拖出可视区
      this.dragDy = dy
    },
    dragEnd() {
      if (this.dragIndex < 0) return
      const from = this.dragIndex
      const hs = this.dragHeights
      const dy = this.dragDy
      const to = homeLayout.dropIndex(from, dy, hs)
      this.dragIndex = -1
      this.dragDy = 0
      this.dragStartY = 0
      if (to !== from) {
        // 编辑态渲染的是「全部可见卡」，下标要换算回 doc.cards 的真实下标
        const idx = this.visibleIndexes()
        const realFrom = idx[from]
        const realTo = idx[Math.max(0, Math.min(idx.length - 1, to))]
        if (realFrom != null && realTo != null && realFrom !== realTo) {
          this.persistDoc(pageDoc.moveCard(this.doc, realFrom, realTo))
        }
      }
    },
    wrapStyle(i) {
      if (this.dragIndex !== i) return ''
      return 'transform: translateY(' + this.dragDy + 'px); z-index: 30;'
    },
    /** 卡片样式覆盖：把 style.card / style.text 的结果转成 inline style */
    // 样式只取决于 doc，没必要每张卡每次渲染都拼一遍字符串：
    // doc 变了才整批重算一次（下划线字段不进响应式，不会引发额外渲染）
    cardStyle(c) {
      if (this._styleSrc !== this.doc) this.rebuildStyles()
      return (c && this._styleMap[c.id]) || ''
    },
    rebuildStyles() {
      const map = {}
      ;((this.doc && this.doc.cards) || []).forEach((c) => {
        const s = this.buildStyle(c)
        if (s) map[c.id] = s
      })
      this._styleMap = map
      this._styleSrc = this.doc
    },
    buildStyle(c) {
      const st = (c && c.style) || null
      if (!st) return ''
      const out = []
      if (st.bg) out.push('background:' + st.bg + ';')
      else if (st.opacity != null) out.push('background:rgba(var(--surface-rgb, 255,255,255), ' + st.opacity + ');')
      if (st.radius != null) out.push('border-radius:' + st.radius + 'rpx;')
      if (st.padding != null) out.push('padding:' + st.padding + 'rpx;')
      if (st.fontSize) out.push('font-size:' + st.fontSize + 'rpx;')
      if (st.fontWeight) out.push('font-weight:' + st.fontWeight + ';')
      if (st.color) out.push('color:' + st.color + ';')
      if (st.align) out.push('text-align:' + st.align + ';')
      if (st.serif) out.push('font-family:Georgia,"Times New Roman","PingFang SC",serif;')
      if (st.shadow === 'none') out.push('box-shadow:none;')
      if (st.shadow === 'lifted') out.push('box-shadow:0 18rpx 44rpx rgba(var(--shadow-rgb, 23,32,26), 0.14);')
      if (st.border === 'none') out.push('border:none;')
      if (st.border === 'bold') out.push('border:4rpx solid rgba(var(--brand-rgb, 46,107,255), 0.3);')
      return out.join('')
    },
    // 空处理：给 .stop 修饰符占位用（收纳按钮要挡住把手区的拖拽启动）
    noop() {},

    // ---------- 三个数据块 → 详情页 ----------
    goHistory() {
      if (this.editing) return
      uni.navigateTo({ url: '/pkgStudy/pages/history/history' })
    },
    goReviewList() {
      if (this.editing) return
      uni.navigateTo({ url: '/pkgStudy/pages/review-list/review-list' })
    },
    goStreak() {
      if (this.editing) return
      uni.navigateTo({ url: '/pkgStudy/pages/streak/streak' })
    },

    startPractice() {
      if (this.editing) return
      uni.navigateTo({ url: '/pkgStudy/pages/practice/practice?source=daily' })
    },
    goReview() {
      if (this.editing) return
      // 没有错题就别跳进空练习页 —— 直接说清楚错题从哪来
      if (!this.wrongCount) {
        uni.showToast({ title: t('还没有错题，练习时答错的词会进这里'), icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pkgStudy/pages/practice/practice?source=review' })
    },
    goDrill() {
      if (this.editing) return
      if (!this.aiEnabled) {
        uni.showToast({ title: t('请先在设置中完成 AI 配置（') + this.aiReason + '）', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pkgStudy/pages/practice/practice?source=drill' })
    },
    /**
     * 当前词书卡：整卡点进「词库详情」。
     * 卡片主体是"这本背到哪了"，所以落在「批次进度」分段（详情页的默认分段也是它）；
     * 想看词表 / 导入 / 改目标，详情页顶部四个分段一键切。
     * 注意：不能用 switchTab('/pages/library/library') —— tabBar 页只切 tab 就停住，
     * 用户看到的还是列表页，等于"点了没反应"（这就是以前那张卡的毛病）。
     */
    goBookDetail() {
      if (this.editing) return
      uni.navigateTo({ url: '/pkgManage/pages/library-detail/library-detail?tab=batch' })
    },
    // 刷单词的入口只在「刷单词」卡（widget-worddrill）里，这里不再挂重复入口
    goBooks() {
      if (this.editing) return
      // 直接进入「更换词书」页（词库 tab 内也保留同款入口）
      // 与整卡点击明确区分：这颗只负责"换一本"，不负责"看这本的详情"
      uni.navigateTo({ url: '/pkgManage/pages/book-switch/book-switch' })
    },

    // ---------- 顶部输入：搜索 / 指令双模式 ----------
    onInputFocus() {
      if (this.__suggestTimer) { clearTimeout(this.__suggestTimer); this.__suggestTimer = 0 }
      this.inputFocused = true
      this.suggestAlive = true
    },
    /**
     * 失焦不能立刻收起推荐条：
     * 点「推荐」的动作顺序是 touchstart → input blur（键盘收起、页面重排）→ tap。
     * 推荐条要是跟着 blur 立刻消失/移位，tap 就落空了 —— 看起来就是
     * 「点了推荐直接退出搜索，什么都没发生」。给 300ms 缓冲，让 tap 落得到。
     */
    onInputBlur() {
      this.inputFocused = false
      if (this.__suggestTimer) clearTimeout(this.__suggestTimer)
      this.__suggestTimer = setTimeout(() => {
        this.__suggestTimer = 0
        this.suggestAlive = false
      }, 300)
    },

    /**
     * 模式键：手动在「搜 / AI」之间切换，并锁定。
     * 锁定后打字不再自动改判 —— 自动判定再准也有看走眼的时候，
     * 而"想查词却真的改了首页"比"想改首页却只搜了一下"难受得多。
     * 清空输入（clearSearch）即解锁，回到自动判定。
     */
    toggleMode(next) {
      const want = next === 'command' || next === 'search'
        ? next
        : (this.inputMode === 'command' ? 'search' : 'command')
      this.modeLocked = true
      this.inputMode = want
      // 切走的时候把另一侧的状态收干净，避免"搜索结果"和"指令结果"同时占屏
      if (want === 'command') {
        if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
        this.searching = false
        this.results = []
        this.cached = null
        this.aiResult = null
        this.aiLoading = false
      } else {
        this.closeCmdBar()
      }
    },

    /**
     * 指令失败时的兜底：这句其实只是想查词 → 按原文重跑一次搜索。
     * 不要求用户重新输入，也不用手动切模式。
     */
    retryAsSearch() {
      const t = this.lastCmdText || this.keyword
      this.closeCmdBar()
      this.modeLocked = true
      this.inputMode = 'search'
      this.runSearch(t)
    },

    /** 反向兜底：搜索没结果 → 这句话其实是想让 AI 改页面 */
    retryAsCommand() {
      const t = this.lastQuery || this.keyword
      this.modeLocked = true
      this.inputMode = 'command'
      this.runCommand(t)
    },

    /**
     * 把任意来源的"输入值"抠成字符串。
     * 键盘回车在某些端给的不是字符串（可能是事件、可能是 { value }），
     * 以前直接 String(v) 就变成 "[object Object]" 被拿去搜索 —— 见 WORDISH 的注释。
     */
    pickText(v) {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        if (typeof v.detail === 'string') return v.detail
        if (v.detail && typeof v.detail.value === 'string') return v.detail.value
        if (typeof v.value === 'string') return v.value
        if (typeof v.text === 'string') return v.text
      }
      if (typeof v === 'number') return String(v)
      return String(this.keyword || '')
    },

    // 回车 / 点左侧图标：走**界面上显示的那个**模式（所见即所得），
    // 只有显式前缀（/ : @ #）能盖过它 —— 前缀是用户当下最明确的表达。
    // 边打字边改判是 onSearchInput 的事：那样用户能看见模式键自己变色，
    // 而不是按下回车才发现"我以为在查词，结果首页被改了"。
    onSubmit(v) {
      const raw = this.pickText(v)
      const d = intent.detect(raw)
      if (d.forced) this.inputMode = d.mode   // 前缀说了算，同时把界面同步过去
      const mode = this.inputMode
      // 用剥掉前缀后的正文：'/'、'@'、'#' 这种只有前缀没有正文的输入同样是"没内容"
      const text = d.text
      // 空内容回车 = 什么都不做。
      // 以前它会走到 runSearch('') → onSearchInput('') → clearSearch()，
      // 而 clearSearch 会调顶栏的 blurInput() 强制失焦：胶囊立刻收起，
      // 右侧的模式键被一起收成 width:0 + pointer-events:none ——
      // 于是"没打字按了下回车，切换键就点不动了"。没有输入就没有意图，直接返回。
      if (!String(text || '').trim()) return
      if (mode === 'command') {
        this.lastCmdText = text
        this.runCommand(text)
      } else {
        this.runSearch(text)
      }
    },
    useSuggestion(s) {
      this.keyword = s
      this.inputMode = 'command'
      this.modeLocked = true
      this.lastCmdText = s
      this.runCommand(s)
    },

    /**
     * 执行一条自然语言指令：
     *   模型 → 指令序列 → schema 校验 → 原子执行 → 落盘 → 撤销栈
     * 任一步失败都保持原页面不变（不可变对象的天然回退）。
     */
    async runCommand(text) {
      const input = String(text || '').trim()
      if (!input) return
      // 上一条还没跑完就再回车：以前是静默 return，用户看到的是"按了没反应、
      // 也不知道为什么"。给一句话说明比什么都不说强。
      // 这里**不能**禁用输入框来防重复提交 —— :disabled 会抢走焦点、把软键盘收掉。
      if (this.cmdRunning) {
        try { uni.showToast({ title: t('上一条还没执行完'), icon: 'none' }) } catch (e) {}
        return
      }
      this.cmdRunning = true
      this.cmdState = 'thinking'
      // 走指令就把搜索结果收起来，别让两块内容同时占着屏幕
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      this.searching = false
      this.results = []
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.cmdSay = ''
      this.cmdSummary = ''
      this.cmdError = ''
      // doc 理论上 onLoad 就准备好了；万一为空就用当前存储值兜底，避免整条链路崩掉
      const base = this.doc || pageDoc.get()
      try {
        const r = await pageAgent.plan(input, base, { live: this.live })
        if (!r.ok || !r.commands.length) {
          // 模型只回答、没改页面（问学习数据 / 指路去别的页面）：这是正常问答，
          // 不是执行失败 —— 走普通气泡，别甩红条。
          // ⚠️ 必须把 cmdCanUndo 清掉：不清的话这里会挂着上一条指令的撤销键，
          // 用户点一下撤的是上一步的改动，跟眼前这句回答毫无关系。
          if (r.answered && r.say) {
            this.cmdState = 'done'
            this.cmdSay = r.say
            this.cmdCanUndo = false
            return
          }
          this.cmdState = 'error'
          this.cmdError = r.error || r.say || t('这个我还改不了')
          return
        }
        this.cmdState = 'running'
        // ⚠️ 必须拿 **base**（发给模型的那一份）来应用，不能在这里重新读 this.doc。
        // plan 是模型看着 base 的 docDigest 做出来的（「删掉第 2 张卡片」里的 2
        // 指的就是 base 里的第 2 张）。await 期间首页可能被 home:refresh 之类的
        // 事件换过 doc，这时重新读一份再应用 → 序号对到别的卡上，删错卡片。
        // 所见即所得：模型看到的那份，就是被改的那份。
        const res = pageCommand.applyCommands(base, r.commands, { live: this.live })
        if (!res.ok) {
          // 原子回退：applyCommands 失败时返回的仍是原 doc，页面一个字节都没变。
          // res.reason 已经是人话（内部操作名只留在 res.rawReason），这里直接显示；
          // res.rawReason 打日志，方便排查而不用让用户看天书。
          if (res.rawReason) { try { console.warn('[home] 指令没能应用：' + res.rawReason) } catch (err) {} }
          this.cmdState = 'error'
          this.cmdError = res.reason || t('指令没能应用')
          return
        }
        const summary = r.say || pageCommand.summaryOf(res.applied)
        // 第三个参数把 effects 传进去：commit 靠里面 book.switch 的 prev
        // 记下"换词书前的那一本"，撤销才能把词书一起还原。
        // ⚠️ 不传的话 commit 只能读执行后的 currentBookId —— 撤销会变成空操作。
        this.doc = pageCommand.commit(res.doc, summary, res.effects)
        this.cmdState = 'done'
        this.cmdSay = summary
        this.cmdSummary = pageCommand.summaryOf(res.applied)
        // plan 在这种情况下的 error 是"有指令被跳过"的人话说明（不是报错）。
        // 以前写的是 res.error —— run() 根本没这个字段，等于把提示整条丢了：
        // 用户看到"已应用"，其实有一项没做，属于静默的部分失败。
        this.cmdError = r.error || ''
        this.cmdCanUndo = pageCommand.canUndo()
        this.layout = this.builtinIds()
        this.runEffects(res.effects)
      } catch (e) {
        this.cmdState = 'error'
        // e.message 可能是 'xxx is not a function' 这种内部串：只进日志，界面一律说人话
        try { console.warn('[home] 指令执行抛错：', e) } catch (err) {}
        this.cmdError = t('执行出错，已保持原样')
      } finally {
        this.cmdRunning = false
      }
    },

    /** effects 是"需要发请求 / 需要朗读"的二次动作，由页面侧异步完成 */
    async runEffects(effects) {
      const list = effects || []
      let needTheme = false
      for (const ef of list) {
        if (ef.kind === 'theme' || ef.kind === 'bg' || ef.kind === 'resetTheme') needTheme = true
        if (ef.kind === 'goal') this.sessionSize = this.loadSessionSize()
        // 换词书：目标（每本词书各自一套）、词书名、词数、批次进度全变了。
        // 只刷 sessionSize 不够 —— 卡片上的 {{live.*}} 绑定读的是 this.live，
        // 不重取的话首页会一直显示上一本词书的数据，看起来像"切了但没生效"。
        if (ef.kind === 'book') {
          this.sessionSize = this.loadSessionSize()
          this.refreshDoc()
        }
        if (ef.kind === 'speak' && ef.text) {
          try { speakAny(ef.text) } catch (e) { /* 朗读失败不影响其它 */ }
        }
        if (ef.kind === 'rewrite') await this.doRewrite(ef)
      }
      if (needTheme) {
        try { this.refreshAppTheme() } catch (e) { /* 全局 mixin 未挂载时忽略 */ }
      }
    },

    /** text.rewrite：再问一次模型，拿到文案后走一条 text.set 补上 */
    async doRewrite(ef) {
      const out = await pageAgent.rewrite(ef.origin, ef.tone, ef.instruction)
      if (!out) return
      const target = ef.targetId ? { id: ef.targetId } : { last: true }
      const res = pageCommand.applyCommands(this.doc, [
        { op: 'text.set', args: { target: target, value: out } }
      ], { live: this.live })
      if (!res.ok) return
      this.doc = pageCommand.commit(res.doc, t('改写文案'))
      this.cmdSummary = pageCommand.summaryOf(res.applied)
      this.cmdCanUndo = pageCommand.canUndo()
    },

    /** 撤销上一步：直接换回历史栈里最近的 pageDoc */
    undoLast() {
      const last = pageCommand.lastUndo()
      const d = pageCommand.undo()
      if (!d) { this.cmdCanUndo = false; return }
      this.doc = d
      // 用 refreshDoc 而不是只刷 layout：撤销会把 book.switch 一起回退
      // （page-command 的 undo 还原了 currentBook），不重取 live 的话
      // 卡片上还挂着新词书的书名和词数，用户会以为"撤销了但没完全撤销"。
      this.refreshDoc()
      this.sessionSize = this.loadSessionSize()
      try { this.refreshAppTheme() } catch (e) { /* ignore */ }
      this.cmdState = 'done'
      this.cmdSay = t('已撤销：') + ((last && last.summary) || t('上一步改动'))
      this.cmdSummary = ''
      this.cmdCanUndo = pageCommand.canUndo()
    },
    closeCmdBar() {
      this.cmdState = ''
      this.cmdSay = ''
      this.cmdSummary = ''
      this.cmdError = ''
    },

    // ---------- AI 造的卡片：交互回写 ----------
    /**
     * 清单勾选。新设计是"两层"，所以定位是 (si 区, ii 节点, index 项)；
     * 老卡片只有扁平 blocks，就退回"第一个 checklist 块"。
     */
    onCardToggle(e) {
      const id = e && e.id
      const idx = e && e.index
      if (!id || idx == null) return
      const cards = ((this.doc && this.doc.cards) || []).map(c => {
        if (c.id !== id) return Object.assign({}, c)
        // 新设计：design.sections[si].items[ii].items[index]
        if (c.design && Array.isArray(c.design.sections)) {
          const si = e.si == null ? 0 : e.si
          const ii = e.ii == null ? 0 : e.ii
          const sections = c.design.sections.map((sec, a) => {
            if (a !== si) return Object.assign({}, sec)
            return Object.assign({}, sec, {
              items: (sec.items || []).map((n, b) => {
                if (b !== ii || n.kind !== 'checklist' || !(n.items || [])[idx]) return n
                return Object.assign({}, n, {
                  items: n.items.map((it, j) => (j === idx ? Object.assign({}, it, { done: !it.done }) : it))
                })
              })
            })
          })
          return Object.assign({}, c, { design: Object.assign({}, c.design, { sections: sections }) })
        }
        // 老块：扁平数组，定位第一个 checklist
        let touched = false
        const blocks = (c.blocks || []).map(b => {
          if (touched || b.kind !== 'checklist' || !(b.items || [])[idx]) return Object.assign({}, b)
          touched = true
          return Object.assign({}, b, {
            items: b.items.map((it, j) => (j === idx ? Object.assign({}, it, { done: !it.done }) : it))
          })
        })
        return Object.assign({}, c, { blocks: blocks })
      })
      this.persistDoc(Object.assign({}, this.doc, { cards: cards }))
    },
    /**
     * 卡片内状态（chips / 开关 / 输入框 / 计数）写回这张卡自己的 design.state。
     * 状态只存在这张卡里，不外发、不进学习数据。
     */
    onCardState(e) {
      const id = e && e.id
      const patch = e && e.patch
      if (!id || !patch) return
      const cards = ((this.doc && this.doc.cards) || []).map(c => {
        if (c.id !== id) return Object.assign({}, c)
        const d = Object.assign({}, c.design || { v: 2, sections: [] })
        d.state = Object.assign({}, d.state || {}, patch)
        return Object.assign({}, c, { design: d })
      })
      this.persistDoc(Object.assign({}, this.doc, { cards: cards }))
    },
    // 卡片删除已移到收纳区（deleteAiCard）；AI 指令的 card.remove 仍走 pageCommand 链路
    /** 编辑态手动换卡片配图：本地选图 → 走 image.set 指令（进历史栈，可撤销） */
    onCardImage(e) {
      const id = e && e.id
      if (!id) return
      uni.chooseImage({
        count: 1,
        success: (r) => {
          const url = (r && r.tempFilePaths && r.tempFilePaths[0]) || ''
          if (!url) return
          const base = this.doc || pageDoc.get()
          const res = pageCommand.applyCommands(base, [{ op: 'image.set', target: { id }, url }], { live: this.live })
          if (!res.ok) {
            uni.showToast({ title: res.reason || t('换图失败'), icon: 'none' })
            return
          }
          // 摘要与指令链路的 note 保持同源（撤销时显示同一句），不走 t()
          this.doc = pageCommand.commit(res.doc, '更换卡片配图')
          this.cmdCanUndo = pageCommand.canUndo()
          try { uni.showToast({ title: t('已更换配图'), icon: 'success' }) } catch (err) {}
        },
        fail: () => { /* 用户取消选图，静默 */ }
      })
    },
    onCardAction(e) {
      if (!e) return
      // 新规格的动作：state.* 已在组件里转成 onCardState，这里只管"有副作用"的那几个
      const kind = e.kind || ''
      if (kind === 'toast') {
        if (e.text) uni.showToast({ title: String(e.text).slice(0, 40), icon: 'none' })
        return
      }
      if (kind === 'copy') {
        try { uni.setClipboardData({ data: String(e.text || '') }) } catch (err) { /* 端不支持就算了 */ }
        return
      }
      if (kind === 'refresh') {
        this.refreshDoc()
        try { uni.$emit('home:refresh') } catch (err) { /* 同上 */ }
        return
      }
      if (e.speak) {
        try { speakAny(e.speak) } catch (err) { /* ignore */ }
      }
      // 练习：source 由卡片指定（daily / review / drill），走同一个练习页
      if (kind === 'practice') {
        const src = ['daily', 'review', 'drill'].indexOf(e.source) >= 0 ? e.source : 'daily'
        uni.navigateTo({ url: '/pkgStudy/pages/practice/practice?source=' + src })
        return
      }
      const map = {
        practice: '/pkgStudy/pages/practice/practice?source=daily',
        review: '/pkgStudy/pages/practice/practice?source=review',
        drill: '/pkgStudy/pages/practice/practice?source=drill',
        library: '/pages/library/library',
        worddrill: '/pkgStudy/pages/word-drill/word-drill?source=daily',
        stats: '/pkgStudy/pages/history/history',
        history: '/pkgStudy/pages/history/history',
        streak: '/pkgStudy/pages/streak/streak',
        wordbook: '/pkgManage/pages/book-switch/book-switch',
        speak: ''
      }
      let url = map[e.action]
      // 新规格：navigate 带的是页面名，走 utils/card-spec 的白名单（出不去这个名单）
      if (!url && kind === 'navigate' && e.page) {
        try {
          const route = cardSpec.PAGE_ROUTES[e.page]
          if (route) {
            if (route.tab) uni.switchTab({ url: route.url })
            else uni.navigateTo({ url: route.url })
          }
        } catch (err) { /* 白名单里没有 → 什么都不做 */ }
        return
      }
      if (!url) return
      // 词库是 tabBar 页，navigateTo 打不开，必须走 switchTab
      if (TAB_PAGES.indexOf(url) >= 0) uni.switchTab({ url })
      else uni.navigateTo({ url })
    },

    // ---------- 顶部搜索 ----------
    onSearchInput(v) {
      const kw = this.pickText(v).trim()
      // 拦掉 "[object Object]" 这类把对象 String() 出来的垃圾：
      // 拿去搜会搜出怪东西，交给 AI 还会被写进词库
      // 空值只清结果：语音输入时输入法常先发一个空 value 的 input 事件再上屏，
      // 这里若走 clearSearch 会①把键盘收掉②把锁定的指令模式重置成搜索 —— 两头都坑。
      if (!kw) {
        if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
        this.searching = false
        this.results = []
        this.cached = null
        this.aiResult = null
        this.aiLoading = false
        // keyword 要跟着清掉：顶栏的清除键是 `v-if="search && value"` 挂在 keyword 上的，
        // 不更新的话用户把字全删了、× 还杵在那儿，点了还会收键盘。
        // 只清 keyword，**不**碰 modeLocked、不碰 inputFocused ——
        // 那两样一动，语音输入的中间态就会收键盘 + 把锁定的指令模式重置成搜索。
        this.keyword = ''
        return
      }
      if (JUNK_TEXT.test(kw)) { this.clearSearch(); return }
      this.keyword = kw
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      // 边打字边判意图：命中指令词就把输入框切成指令态，不再走查词。
      // 手动锁定后不再自动改判，但显式前缀（/ : @ #）依然能盖过锁定。
      const d = intent.detect(kw)
      if (d.forced || !this.modeLocked) this.inputMode = d.mode
      // 后面一律以「最终生效的模式」为准：手动锁定后 d.mode 可能和界面上的不一样
      const mode = this.inputMode
      if (mode === 'command') {
        this.searching = false
        this.results = []
        this.cached = null
        this.aiResult = null
        this.aiLoading = false
        return
      }
      this.searching = true
      this.lastQuery = kw
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.results = search.localSearch(this.bookId, kw)
      // 本地命中里有没有**一模一样**的那个词？
      // localSearch 是包含匹配：搜 run 会出 running / runs，词典还可能回落到词形
      // run 本身 —— 这些都只是"相近"，用户要查的那个词其实一条都没有。
      // 以前这种情况完全不问 AI，而 AI 结果又挂在 v-else-if 链上被本地命中吞掉，
      // 于是出现"两边都没有、两边都不显示"（用户实测反馈）。
      const exact = this.hasExactHit(kw)
      // 底层缓存里有这个词的话，即便没配 AI 也能离线翻出来看（不联网、不发请求）
      this.cached = exact ? null : this.cacheHitFor(kw)
      // 没查到一模一样的 + 缓存也没有 + 已接入 AI → 稍等一下再自动补充
      //   · 一条本地命中都没有：和以前一样，700ms 后就问（用户可能就是查个新词）
      //   · 只有近似命中：更保守（见 AI_NEAR_* 的注释），避免边打字边烧 token
      const near = this.results.length > 0
      const nearOk = near && LATIN_WORD.test(kw) && kw.length >= AI_NEAR_MIN_LEN
      if (!exact && !this.cached && this.aiEnabled && (!near || nearOk)) {
        const delay = near ? AI_NEAR_DELAY : AI_DELAY
        this.searchTimer = setTimeout(() => { this.aiLookup(kw) }, delay)
      }
    },
    /**
     * 本地结果里有没有和查询词**一模一样**的那条（大小写不敏感）。
     * 近似命中不算 —— 那正是"看着有、其实没有"的情况。
     */
    hasExactHit(kw) {
      const q = String(kw || '').trim().toLowerCase()
      if (!q) return false
      return (this.results || []).some(r => String(r.w || '').trim().toLowerCase() === q)
    },
    runSearch(v) {
      this.onSearchInput(this.pickText(v))
    },
    clearSearch() {
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      // 收起结果时让输入框失焦 → 顶栏胶囊动画还原成铺满态
      const nb = this.$refs && this.$refs.navbar
      if (nb && nb.blurInput) nb.blurInput()
      this.keyword = ''
      this.lastQuery = ''
      this.searching = false
      this.results = []
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      // 清空即解锁：下一次输入重新交给自动判定
      this.inputMode = 'search'
      this.modeLocked = false
      this.inputFocused = false
    },
    // 底层缓存命中：把之前生成过的释义 / 例句原样翻出来，不联网
    cacheHitFor(kw) {
      try {
        const w = aiCache.findWord(kw)
        if (!w) return null
        const ex = aiCache.sentencesOf(w.word)
        return {
          word: w.word,
          pos: w.pos || '',
          // pos 标成 sentence = 这条缓存存的是整句译文（见 ai-content.explainWord）
          kind: String(w.pos || '').trim().toLowerCase() === 'sentence' ? 'sentence' : 'word',
          meaning: w.meaning || '',
          examples: ex.slice(0, 4).map(s => ({ en: s.en, zh: s.zh })),
          cached: true
        }
      } catch (e) {
        return null
      }
    },

    // AI 补充：拿到释义 → 只落本机缓存（explainWord 内部已写入）→ 展示给用户。
    // 不再自动写进任何词书：临时查一个词就被塞进核心词书，词库很快就脏了。
    async aiLookup(kw) {
      const q = this.pickText(kw).trim()
      if (!q) return
      // 最后一道闸：不像单词就不问 AI。
      // 否则 "[object Object]"、整段句子这类东西也会被送去生成，
      // 生成结果还会被写进词库 —— 词库里就会多一个莫名其妙的 "Object"
      if (!WORDISH.test(q)) return
      const hasCache = !!aiCache.findWord(q)
      // 没配 AI 且缓存也没有 → 直接放弃（不弹错误、不转圈）
      if (!this.aiEnabled && !hasCache) return
      // 同一个词上一个请求还没回来 → 复用它的结果，别再发一次
      const inflightKey = q.toLowerCase()
      if (AI_INFLIGHT.has(inflightKey)) return
      AI_INFLIGHT.add(inflightKey)
      this.aiLoading = true
      this.aiResult = null
      try {
        const r = await explainWord(q)
        const meaning = (r && r.meaningZh) || ''
        if (!meaning) throw new Error('empty')
        const examples = (r && r.examples) || []
        // 只展示、不入库：explainWord 内部已经把释义与例句写进 aiCache（本机缓存），
        // 词书是用户自己的地盘 —— 要不要收进去，由他在单词详情页点「加入词书」决定。
        // 以前这里会顺手 addWordToBook，导致搜过一次的词全塞进核心词书。
        // kind='sentence' 时 meaning 是整句译文（中文进→英文出），
        // 展示位置与单词释义一样，只是顶部提示语不同。
        // 回来时输入框已经换了词（边打字边请求很常见）→ 这条结果不能贴到界面上，
        // 否则 "ru" 的释义会挂在 "run" 上。
        if (!this.isCurrentQuery(q)) return
        this.aiResult = {
          word: (r && r.word) || q,
          pos: (r && r.pos) || '',
          kind: (r && r.kind) || 'word',
          meaning,
          examples
        }
      } catch (e) {
        // 同上：已经换了词就别清 —— 那会顺手把新词的这条结果也抹掉
        if (this.isCurrentQuery(q)) this.aiResult = null
      } finally {
        AI_INFLIGHT.delete(inflightKey)
        // 还停留在发起时的那个词上才收起转圈：已经换了词说明后面还有请求在跑，
        // 提前置 false 会让它刚转起来就被掐掉（闪一下就消失）
        if (this.isCurrentQuery(q)) this.aiLoading = false
      }
    },
    /** 输入框里现在还是这个词吗（AI 请求回来时的比对，大小写不敏感） */
    isCurrentQuery(q) {
      return String(this.lastQuery || '').trim().toLowerCase() === String(q || '').trim().toLowerCase()
    },
    speakResult(e) {
      const w = e.currentTarget.dataset && e.currentTarget.dataset.w
      if (!w) return
      try { speakWord(dict.speakForm(w)) } catch (err) { speakWord(w) }
    },
    // 搜索结果 → 单词详情（与词库「词汇明细」共用同一页面）
    // 搜索命中的是"单词本身"，没有词条 id，所以只传 w + 当前词书
    openWord(it) {
      const w = String((it && it.w) || '').trim().toLowerCase()
      if (!w) return
      const url = '/pkgManage/pages/word-detail/word-detail?w=' + encodeURIComponent(w) +
        '&book=' + encodeURIComponent(String(this.bookId || ''))
      // 记一笔"这次跳转是从搜索结果发起的"：词条页返回时（onShow）据此收起搜索面板。
      // 先置位、失败回调里再撤回。反过来（在 success 里置位）有时序盲区 ——
      // 万一 success 比返回还晚到，这个标记就永远生效不了，搜索又退不出去了。
      this.__searchOpened = true
      uni.navigateTo({ url, fail: () => { this.__searchOpened = false } })
    }
  }
}
</script>

<style>
/* ---------- AI 指令状态条 ---------- */
.cmd-bar {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  padding: 18rpx 24rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
}

.cmd-bar.is-error {
  border-color: rgba(229, 72, 77, 0.3);
  border-color: rgba(229, 72, 77, 0.3);
}

.cmd-spin {
  width: 28rpx;
  height: 28rpx;
  flex-shrink: 0;
  margin-right: 16rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: cmd-rotate 0.9s linear infinite;
}

@keyframes cmd-rotate {
  to { transform: rotate(360deg); }
}

.cmd-text {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cmd-bar.is-error .cmd-text {
  color: #e5484d;
  color: var(--danger, #e5484d);
}

.cmd-undo {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 24rpx;
}

.cmd-undo:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.cmd-close {
  flex-shrink: 0;
  margin-left: 18rpx;
  font-size: 30rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 0 4rpx;
}

/* 指令示例胶囊：横向滚动，一行放得下就居中 */
.cmd-sug {
  white-space: nowrap;
  margin-bottom: 20rpx;
}

.cmd-chip {
  display: inline-block;
  margin-right: 14rpx;
  padding: 12rpx 26rpx;
  font-size: 23rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.24);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.24);
  border-radius: 999rpx;
}

.cmd-chip:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

/* 内置卡上 AI 加的批注与配图 */
.mod-note {
  display: block;
  margin-top: var(--app-gap, 12rpx);
  padding: 14rpx 18rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.08);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.08);
  border-radius: 14rpx;
}

.mod-image {
  display: block;
  width: 100%;
  height: 180rpx;
  margin-top: var(--app-gap, 12rpx);
  border-radius: 18rpx;
}

/* 搜索结果卡 */
.search-card { margin-bottom: 24rpx; }

.sr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.sr-title { font-size: 26rpx; font-weight: 600; color: #17201a; }
.sr-title { font-size: 26rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.sr-close { font-size: 24rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }

.sr-item {
  padding: 18rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.sr-line { display: flex; align-items: baseline; }

.sr-word {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.sr-pos { margin-left: 12rpx; font-size: 24rpx; color: #98a19b; }
.sr-pos { margin-left: 12rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.sr-src {
  margin-left: auto;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.sr-mean {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.5;
}

.sr-tip {
  display: block;
  padding-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 本地"相近命中"与下面 AI / 缓存那块之间的分隔。
   没有它两块会糊在一起，用户分不清哪几条是词库里的、哪一条是 AI 给的。 */
.sr-split {
  height: 2rpx;
  margin: 18rpx 0 6rpx;
  background: rgba(23, 32, 26, 0.09);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.09);
}

.sr-state { padding: 24rpx 0 8rpx; text-align: center; }

.sr-state-text { display: block; font-size: 26rpx; color: #5a6560; }
.sr-state-text { display: block; font-size: 26rpx; color: var(--ink-2, #5a6560); }

.sr-state-hint {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
}

.sr-retry {
  display: inline-block;
  margin-top: 18rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 8rpx 32rpx;
}

/* 没结果时的两个兜底动作：再试一次 AI 补充 / 当成指令重跑 */
.sr-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.sr-retry-cmd {
  margin-left: 16rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  border-color: rgba(23, 32, 26, 0.16);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
}

.sr-spinner {
  width: 40rpx;
  height: 40rpx;
  margin: 0 auto 16rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: sr-spin 0.9s linear infinite;
}

@keyframes sr-spin {
  to { transform: rotate(360deg); }
}

.sr-ai { padding: 6rpx 0 4rpx; }

.sr-ex {
  margin-top: 14rpx;
  padding: 14rpx 18rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
  border-radius: 16rpx;
}

.sr-ex-en {
  display: block;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.5;
}

.sr-ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: #5a6560; }
.sr-ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.sr-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18rpx;
}

.sr-badge {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 6rpx 20rpx;
}

.sr-speak {
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 26rpx;
}

/* 块 A：词书卡
   这张卡只承载"我在背哪本、背到哪了"，属于一眼扫过的信息卡，刻意比通用 .card 矮一档：
   内边距 40→26rpx，标题与右上角链接对齐「刷单词」卡的 28/22rpx，行间距一并收紧。
   之前用的是全站默认字号，在这一屏里显得比同页的卡片大一号，看着不协调。 */
.book-head-card {
  display: flex;
  align-items: center;
  padding: 26rpx 32rpx;
}

/* 整卡可点：按下给一点点底色反馈，让人知道"这张卡是能点的"。
   颜色走 CSS 变量，换主题色 / 切深色自动跟随。 */
.book-head-card.tappable:active {
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.06);
}

.book-info {
  flex: 1;
  min-width: 0;
}

.book-name {
  font-size: 28rpx;
  line-height: 1.25;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.book-progress-text {
  font-size: 22rpx;
  line-height: 1.25;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  margin-top: 2rpx;
}

.book-track {
  margin-top: 10rpx;
}

.book-sub {
  font-size: 22rpx;
  line-height: 1.25;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-top: 4rpx;
}

/* 「换词书 ›」和整卡点击是两件事：整卡进词库详情，这颗进选择词书页。
   做成一颗轻量胶囊 —— ① 22rpx 的裸文字触摸热区太小，撑到 10/16rpx；
   ② 让它看起来像"一个独立按钮"，不会被当成整卡行为的一部分。 */
.switch-link {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  padding: 10rpx 16rpx;
  margin: -10rpx -16rpx -10rpx 0;
  border-radius: 999rpx;
}

.switch-link:active {
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
}

/* 块 B：主行动区 */
.action-area {
  margin-top: 20rpx;
}

/* 主按钮略收一档，与次级按钮形成主次关系 */
.start-btn {
  height: 88rpx;
  font-size: 30rpx;
}

/* 次级按钮：小胶囊。属性与「刷单词」卡里的 .wb-mini 完全一致（等分撑满一行、
   26rpx / 72rpx、品牌色 34% 描边），保证全页只有一种小胶囊。
   两颗时各占一半，宽约 340rpx，最长的「复习 128 道错题」也放得下；
   white-space: nowrap 是兜底：宁可整颗被裁也不许字在胶囊内折行（固定高度会切掉半行）。 */
.mini-row {
  display: flex;
  margin-top: 14rpx;
}

.btn-mini {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  height: 72rpx;
  font-size: 26rpx;
  white-space: nowrap;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  margin: 0 8rpx;
}

.btn-mini::after { border: none; }

.btn-mini:first-child { margin-left: 0; }
.btn-mini:last-child { margin-right: 0; }

.btn-mini:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.entry-disabled {
  color: #b0b7b2 !important;
  border-color: rgba(23, 32, 26, 0.1) !important;
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1) !important;
  background: rgba(255, 255, 255, 0.45) !important;
  background: #f7f8f7 !important;
}

.action-tip {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

/* 块 C：数据条 */
.stats-row {
  margin-top: 24rpx;
  display: flex;
  padding: 32rpx 0;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 36rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.stat-num.warn {
  color: #f79009;
}

.stat-label {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-top: 6rpx;
}

/* 可点数据项：轻微按压反馈 */
.stat-item:active .stat-num { opacity: 0.6; }

/* ---------- 首页模块编辑（拖拽 / 收纳） ---------- */
.mod-list { position: relative; }

.mod-wrap { position: relative; }

.mod-wrap.is-editing {
  border-radius: 20rpx;
  background: rgba(46, 107, 255, 0.05);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.05);
  padding: 0 12rpx 12rpx;
  margin-bottom: 20rpx;
}

.mod-wrap.is-drag {
  opacity: 0.92;
  box-shadow: 0 12rpx 32rpx rgba(23, 32, 26, 0.16);
  box-shadow: 0 12rpx 32rpx rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.86);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
}

/* 编辑态：透明遮罩挡住模块内容，手柄行靠更高层级浮在它上面 */
.mod-shield {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
}

.mod-bar {
  position: relative;
  z-index: 11;
  display: flex;
  align-items: center;
  padding: 14rpx 8rpx 12rpx;
  /* 把手区域内禁掉滚动手势，拖动时页面不会跟着滚；页面其他区域照常可滚 */
  touch-action: none;
  /* H5 桌面：鼠标提示可拖 */
  cursor: grab;
}

.mod-bar:active { cursor: grabbing; }

.mod-grip {
  display: flex;
  align-items: center;
  margin-right: 14rpx;
  flex-shrink: 0;
}

.grip-lines {
  display: flex;
  flex-direction: column;
  margin-right: 10rpx;
}

.grip-line {
  width: 30rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: #98a19b;
  background: var(--ink-3, #98a19b);
  margin: 4rpx 0;
}

.grip-text {
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
}

.mod-name {
  flex: 1;
  font-size: 24rpx;
  font-weight: 600;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  letter-spacing: 1rpx;
}

.mod-hide {
  font-size: 24rpx;
  color: #e5484d;
  padding: 8rpx 20rpx;
  border: 2rpx solid rgba(229, 72, 77, 0.3);
  border-radius: 999rpx;
}

.mod-hide:active { background: rgba(229, 72, 77, 0.1); }

/* 模块间距跟着「密度」走（theme.set{density} 下发 --app-gap） */
.mod-widget { margin-top: var(--app-gap, 24rpx); }

/* 底部操作行 */
.home-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 28rpx;
  margin-bottom: 40rpx;
}

.foot-btn {
  height: 76rpx;
  min-width: 220rpx;
  padding: 0 40rpx;
  margin: 0 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  border-radius: 999rpx;
}

.foot-btn.primary {
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

.foot-btn.primary:active { opacity: 0.86; }

.foot-btn.ghost {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
}

.foot-btn.ghost:active {
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

.foot-link {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 12rpx 32rpx;
}

.foot-link:active { opacity: 0.6; }

/* 空态 */
.home-empty { padding: 60rpx 0; text-align: center; }

.home-empty-text {
  display: block;
  font-size: 28rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.home-empty-link {
  display: inline-block;
  margin-top: 20rpx;
  font-size: 26rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

/* ---------- 收纳区面板 ---------- */
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 900;
  background: rgba(23, 32, 26, 0.35);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.35);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.sheet {
  background: #ffffff;
  background: var(--surface, #ffffff);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 32rpx 40rpx;
  max-height: 70vh;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.sheet-close {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sheet-body { max-height: 54vh; }

.sheet-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.sheet-info { flex: 1; min-width: 0; }

.sheet-name {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sheet-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.5;
}

.sheet-add {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 24rpx;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 10rpx 28rpx;
}

.sheet-add:active { opacity: 0.86; }

/* AI 卡片分区：分隔标题 + 「添加 / 删除」双按钮 */
.sheet-sep { padding: 28rpx 0 4rpx; }

.sheet-sep-label {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sheet-ops { flex-shrink: 0; margin-left: 20rpx; display: flex; align-items: center; }

.sheet-ops .sheet-add { margin-left: 0; }

.sheet-del {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-size: 24rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
  background: transparent;
  border: 2rpx solid rgba(229, 72, 77, 0.45);
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
}

.sheet-del:active { opacity: 0.7; }

.sheet-empty { padding: 48rpx 0; text-align: center; }

.sheet-empty-text {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
