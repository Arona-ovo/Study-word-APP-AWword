# 升本英语翻译 · uni-app 版

<div align="center">

![platform](https://img.shields.io/badge/platform-Android%20%C2%B7%20WeChat%20Mini%20Program%20%C2%B7%20H5-2E6BFF?logo=android&logoColor=white)

![framework](https://img.shields.io/badge/uni--app-Vue%203-41B883?logo=vue.js&logoColor=white)

![offline](https://img.shields.io/badge/offline--first-%E2%9C%93-0F6E56?logo=airplane&logoColor=white)

![words](https://img.shields.io/badge/%E8%AF%8D%E5%BA%93-6%20%E8%AF%8D%E4%B9%A6%20%C2%B7%204421%20words%20%C2%B7%20626%20sentences-185FA5)

![ai](https://img.shields.io/badge/AI-OpenAI%20compatible-412991?logo=openai&logoColor=white)

![build](https://img.shields.io/badge/build-HBuilderX-FF6C37)

</div>

由原微信小程序 1:1 重写的 uni-app 工程，**一套代码同时发布：Android APK、微信小程序、H5**。  
功能与原小程序完全一致：题库/自适应引擎/判分/语音/看板娘封面均原样迁移。

## ✨ 特性一览

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| 📚 **内置词书**    | 6 本自带考试词书（专升本 2425 / 四级 2388 / 六级 1966 / 考研 2387 / 高考 1390 / 中考 799）+ 626 例句 + 986 常用词，按批递进，掌握 70% 解锁下一批 |
| 🚀 **熟词过滤**    | 二分抽 20 个词估词汇量，**认识的直接整段标记跳过**（可一键撤销）；入口：词库 → 熟词过滤     |
| 🎯 **自适应抽题**   | i+1 策略：掌握度 ≥3 出熟词、≤2 出生成词；选择题 + 手动输入两种作答                        |
| ✍️ **双向判分**    | 汉译英 = 关键词 55% + 编辑距离 45%；英译汉 = 中文 n-gram 重合度                    |
| 🔁 **一遍不算会**   | 同一词隔两位再确认一次才算记住；答对后可「记错了」反悔改判；顶部「已做 / 会了」两条进度分开看 |
| 🔊 **语音朗读**    | 整句走系统原生 / speechSynthesis，降级有道整句 → 逐词；单词走有道，兜底原生                |
| 🤖 **AI 增强**   | 释义例句、翻译点评、薄弱点专练、对话陪练、词书生成；结果进本地缓存，离线可看                          |
| 📈 **学习数据**    | 打卡走势（股票式折线，背了涨、没背跌）、掌握度概览、打卡周历、每日目标                             |
| 🧩 **首页自定义**   | 模块拖拽排序 / 收纳；新增 AI 指令框——说一句话就能改页面，可撤销、失败自动回退                     |
| 🔐 **纯本地可选账号** | SQLite + PBKDF2 哈希，零网络请求；不注册也能完整使用                              |
| 🪟 **毛玻璃视觉**   | 背景钉在视口不动，窗体半透明磨砂；另留「流畅模式」给低端机                                   |

## 📑 目录

<!-- 锚点规则：GitHub 会把标题里的 emoji 剥掉，并在原位置留下一个连字符。
     所以「## 📁 目录说明」的锚点是 #-目录说明（多一个前导 -），
     而没带 emoji 的标题就是普通 slug。改标题时记得同步这里，
     可用 _tools/_scratch/check-anchors.js 一条条核对。 -->

- [目录说明](#-目录说明)
- [AI 服务层](#ai-服务层可选未配置时行为不变)
- [一、运行调试](#一运行调试)
- [二、打包 Android APK](#二打包-android-apk云打包无需装-android-sdk)
- [三、词书与词汇口径](#三词书与词汇口径重要)
- [三之二、不背单词机制与双进度条](#三之二不背单词机制与双进度条)
- [四、底部导航](#四底部导航悬浮磨砂玻璃)
- [五、全局视觉统一](#五全局视觉统一磨砂玻璃--去蓝色顶栏)
- [五之二、本地账号系统](#五之二本地账号系统纯本地零网络请求)
- [五之三、首页自定义](#五之三首页自定义跳转--小组件--拖拽收纳)
- [五之四、数据备份与换机迁移](#五之四数据备份与换机迁移utilsbackupjs--utilsbackup-iojs)
- [六、与原小程序的差异](#六与原小程序的差异)

## 📁 目录说明

```
├── main.js / App.vue        # 入口 + 全局样式（设计令牌与原 DESIGN.md 一致）
├── pages.json               # 路由 + tabBar(4 项带图标) + 窗口样式（替代原 app.json）
├── manifest.json            # 应用配置（App 打包在此配置）
├── static/avatar-default.jpg  # 「我的」页默认头像（512x512 正方形，_tools/gen-avatar.py 生成）
├── static/mascot.jpg        # 看板娘横版原画（现只给仓库根 README 当 Logo，App 内不再引用）
├── static/mascot/           # 启动页阿罗娜七表情（smile/tongue/hi/nervous/sad/angry/shocked，按学习状态切换，见 pages/cover）
├── static/                  # 默认头像 / 看板娘 / icons/ 应用图标 / tabbar/ 底部导航图标（scripts/gen-tab-icons.py 生成）
├── data/  words.js / sentences.js / wordbooks.js / common-words.js   # 题库与词书
├── services/                # 统一 AI 服务层（详见下文「AI 服务层」）
│   ├── config.js            # 中心化配置：设置 + 环境变量，密钥零硬编码；含服务商预设
│   ├── http.js              # 统一请求：超时 / 错误归一化 / 可降级标记
│   ├── llm.js               # OpenAI 兼容大模型接口（例句生成等）
│   ├── voice.js             # 统一朗读入口：AI 语音 → 本地 TTS 自动降级
│   ├── ai-content.js        # AI 内容能力：单词释义 / 翻译点评 / 薄弱点专练 / 对话陪练
│   └── index.js             # 门面：页面只 import { ai } 或 { voice }
├── utils/ store / settings / engine / judge / tts / tokenize …  # 存储/设置/引擎/判分/本地语音/分词
├── components/float-tabbar/  # 悬浮磨砂玻璃底部导航（自绘，替代原生 tabBar）
└── pages/
    ├── cover / home / library / profile / review                 # 主包 5 页
    ├── pkgStudy/   practice（翻译练习）/ word-drill（刷单词）/ stats / history
    │              / review-list / favorites / sentence-detail / streak / wrong-detail
    └── pkgManage/  settings / library-detail / book-switch / known-filter（熟词过滤）
                   / word-detail / chat / login / donate
```

## AI 服务层（可选，未配置时行为不变）

页面从 `services/` 各叶子模块直接具名导入（`config.js` / `ai-content.js` / `voice.js`），  
`services/index.js` 的 `{ ai }` 门面仅作可选聚合入口。  
**注意**：页面与 utils 不要 import 门面的 namespace（`import * as ai`），HBuilderX(Vite)  
编译链下曾出现门面对象成员丢失（`ai.isAIEnabled is not a function`），叶子模块无此问题。

- **服务商预设**：设置页一键选择 OpenAI / DeepSeek / Kimi / 通义千问 / 自定义，  
  自动填入地址与模型；DeepSeek 等文本-only 服务商不支持云端语音，朗读自动走本地
- **例句生成**：`utils/sentence-api.js` 走 `services/llm`（OpenAI 兼容 `/chat/completions`），  
  校验不通过或失败自动降级本地语料，主流程永不中断
- **朗读**：`services/voice` 先尝试 OpenAI 兼容 `/audio/speech`（音色更自然），失败回退  
  「原生 TTS → 有道」本地链路；单词点读始终用有道词典音
- **AI 内容能力**（`services/ai-content.js`，均需开启 AI，失败自动兜底不阻断）：
  - `ai.explainWord(w)` 单词释义 + 地道例句（词库页「AI 释义」按钮，结果本地缓存 7 天）
  - `ai.critiqueTranslation(...)` 答题后「AI 点评」：指出译文错误并给改进版（练习页按需展开）
  - `ai.generateDrill(words)` 薄弱点专练：围绕掌握度低的词生成练习句（首页「AI 薄弱点专练」入口，  
    失败回落通用 i+1 出题链路）
  - `ai.tutorSystemPrompt / ai.chatTutor` 对话陪练（我的 → AI 对话陪练，用已学词汇英文聊天）
  - `ai.generateWordbook({topic,count})` **AI 生成词书**（词库 → 导入单词页）：  
    输入主题（如"商务英语高频词"）与词数。数量支持**自定义输入**（1 ~ 500 任意整数）  
    与 **「不限」**（`count: 0 / -1 / 'auto'`：分多轮持续追问模型，  
    每轮排除已收录的词，直到模型给不出新词，视为该主题已覆盖完整，500 词为安全兜底）。  
    生成后**在本地**跑完整导入管道  
    （`utils/importer.js`：解析 → 去重校验 → 归入词书 → 逐词补例句），全程写入本机 storage。  
    落地方式二选一：**新建词书**（生成一本独立自建词书，可在「更换词书」切换）  
    或 **并入现有词书**；AI 未配置时该区块整体置灰
- **配置入口**：设置页 →「AI 与语音」（服务商 / API 地址 / API Key / 模型 / 音色 / 语速 /  
  中英文朗读开关）；Key 仅保存在本机 storage，也可用编译期环境变量  
  `VITE_AI_BASE_URL / VITE_AI_API_KEY / VITE_AI_MODEL / VITE_AI_TTS_VOICE` 注入
- **配置校验与连通性测试**：设置页 AI 区提供「测试连接」——先做本地格式校验  
  （地址协议 / 密钥长度与字符 / 模型名），再真实发一条 `max_tokens=8` 的请求验证密钥可用；  
  通过后状态条明确显示 **「✓ 可正常使用（延迟 xxx ms）」**，失败按 HTTP 状态给出中文原因  
  （密钥无效 / 地址错误 / 超时 / 网络不可达等）。结果按"地址|模型|密钥"指纹持久化，  
  任一字段变化即自动复位为待验证。  
  注：H5 浏览器预览可能受跨域限制导致测试失败，属正常现象，App 端不受影响
- **未配置即置灰**：API 密钥未填写（或地址/总开关缺失）时，所有 AI 功能入口  
  （首页「AI 薄弱点专练」、词库「AI 释义」与「AI 生成词书」、练习页「AI 点评」、  
  我的「AI 对话陪练」、设置页「使用 AI 朗读」开关）均显示为灰色、点击只提示原因，  
  不打开也不触发；判定逻辑集中在 `services/config.js` 的 `aiGateReason()`
- **默认关闭**：不填任何配置 = 与改造前完全一致（本地发音 + 本地语料出题）

## 一、运行调试

1. 下载安装 **HBuilderX**（官方免费）：<https://www.dcloud.io/hbuilderx.html>
2. HBuilderX → 文件 → 打开目录 → 选择本 `uniapp` 文件夹
3. 首次打开 `manifest.json`（可视化编辑器），点「基础配置 → 应用标识 AppID → 重新获取」
4. 运行：
   - 浏览器预览：运行 → 运行到浏览器
   - 微信小程序：运行 → 运行到小程序模拟器 → 微信开发者工具
   - 手机真机：运行 → 运行到手机或模拟器（需开启手机 USB 调试）

## 二、打包 Android APK（云打包，无需装 Android SDK）

1. HBuilderX 中选中项目 → 菜单「发行」→「原生 App-云打包」
2. 选择 Android；证书选「使用 DCloud 公用测试证书」即可先打测试包（正式发布需自有证书）
3. 勾选「广告」选项按需 → 打包，等待云端编译完成（约 5-15 分钟）
4. 下载 APK 安装到手机即可

**注意**：

- **整句朗读走系统 TTS**（Android `TextToSpeech` / H5 `speechSynthesis`），一次合成整句，**无需联网**；  
  不可用时才回退在线语音接口，回退链路是有道整句 → 逐词连读
- **中文读得"一顿一顿"怎么排查**：逐词连读的每一词都要现发起一次 HTTP 请求，这是听感断裂的直接来源。  
  设置 → 语音 → **整句朗读引擎**可选：自动（系统优先）/ 只用系统语音（宁可不念也不逐词念）/ 只用在线发音；  
  旁边有**系统语音状态**与「重新检测」，能看到系统语音是否就绪、中英文是否可用、设备语言是什么。  
  引擎侧已加固：`setLanguage` 会按 `zh-CN → zh → zh-TW → zh-HK` 依次尝试（不少国产引擎对 zh-CN 报 -1），  
  全失败但设备默认语言就是要读的那门语言时仍用默认语言播；语言/初始化的失败缓存改成带有效期  
  （10 分钟 / 60 秒，原来是永久和 5 分钟），一次抖动不会让整场朗读一直降级
- 逐词降级时**预连接下一个单元**（提前建好 `InnerAudioContext` 并灌 src），把单元之间的网络等待抹掉
- **单词点读走在线词典音**（dict.youdao.com），发音更准，需联网；联网失败才用系统 TTS 兜底
- **点读弹窗底下那行标签**用 `dict.ownerLabel(word, bookId)`，口径是「这个词属不属于**我正在背的那本书**」：  
  在书里 → 返回书名（如「福建专升本」），不在 → 返回空串、调用方整行不渲染。  
  **别改回 `dict.SRC_LABEL`** —— 那说的是"这次释义命中哪一层"（core / book / custom / common），  
  正在背专升本的人点开一个词却看到「核心词书」，看着像串台。判定不看 `src`  
  （同一个词可能既在核心表、也在当前词书里）：按 bookId 缓存一份小写词形集合  
  （`wordbook.bookWords` 建，导入词 / 切词书后由 `dict.invalidateCache()` 一起清），  
  屈折形态先经 `lemmaCandidates` 还原再比（improving → improve）
- 项目根目录 `AndroidManifest.xml` 声明了 `TTS_SERVICE` 的 `<queries>`：Android 11+ 必须，  
  否则系统 TTS 绑不上引擎会自动降级（听感回到一词一顿）。云端打包才生效，标准基座真机运行不生效
- `package="com.example.dancibei"` 是占位值，云端打包时以 HBuilderX 里配置的 Android 包名为准；  
  manifest.json 的 `appid` 为空，打包前需在 HBuilderX「基础配置 → 重新获取」
- 学习数据存储在 App 本地（uni.Storage），卸载即清除
- 正式上架应用市场前，把 manifest 里的应用名称、图标（1024×1024 png）、版本号配好，并申请自有签名证书

## 三、词书与词汇口径（重要）

所有「词汇」类视图都严格按 **当前词书** 口径，互不串味：

- 一本词书的词 = **该词书导入词**（`state.customWords[bookId]`）
  - **该词书内置词**（`data/wordbooks.js` 的批次 wordIds）
- 掌握度一律读 `state.books[bookId].mastery`，与首页进度条 / 批次解锁同源
- 因此**空词书（无内置词、无导入词）的词汇明细必然为空**；  
  未登记/新建的词书 id 由 `getBook()` 返回空书，**不会**悄悄回退到核心词书
- 统一入口：`utils/wordbook.js` 的 `bookVocab(bookId, filter)`  
  → `{ bookId, total, customTotal, counts, list }`，  
  以及 `bookWords(bookId)` → 统一词对象 `{id,w,pos,m,lv,custom}`  
  （出题选词 / 明细 / 统计 / 换词书页共用同一口径）

> 反例（改造前）：`engine.vocabList()` 读全局扁平 `state.mastery` 且不分词书，  
> 任何词书下都显示同一批词，切到空词书也照旧显示核心词书的 640 词。  
> 该方法现已仅由 `engine.stats()` 内部保留，页面不再直接使用。

### 内置考试词书

自带 6 本，无需联网、无需导入，在「更换词书」页按类别分组展示：

| 词书（id）              | 词量 / 批次   | 说明                                    |
| ------------------- | --------- | ------------------------------------- |
| 福建专升本 `fj_zsb_core` | 2425 / 121 | **默认词书**。前 32 批是老版手写的 640 个核心高频词（顺序与编号未动），其后是追加的考纲词 |
| 大学英语四级 `cet4`       | 2388 / 80 | CET-4 大纲词汇，按词频排序                      |
| 大学英语六级 `cet6`       | 1966 / 66 | CET-6 大纲词汇                            |
| 考研英语 `kaoyan`       | 2387 / 80 | 考研高频与核心词                              |
| 高考英语 `gao_kao`      | 1390 / 70 | 高中 / 高考必备词汇                           |
| 中考英语 `junior_core`  | 799 / 40  | 初中 / 中考必备词汇                           |

几个设计取舍：

- **词条只存一份。** 各词书重合词条极多，`data/lexicon-data.js` 存共享释义（word\|pos\|释义），
  每本书只在 `data/bookdata.js` 里存「词条序号」，比每本各存一份全量词条省一半以上体积。
  两者都是 `_vocab/build.js` 从开源词表生成的，重新生成不会覆盖手写代码，详见 `_vocab/README.md`。
- **每本书内部按词频排序**（高频先学），批次名按「在本册中的位置」四等分命名，
  所以每本书都是一条 入门 → 冲刺 的完整曲线。
- **掌握度按词书分别记录**（`state.books[bookId].mastery`），换词书等于从头开始，
  所以各词书内容不强行去重 —— 用户点「大学英语四级」，看到的就是一份完整的四级词表。
- **旧用户进度不受影响**：默认词书 id 仍是 `fj_zsb_core`，前 32 批的 640 个词 id 与顺序原样保留，
  本地学习记录（按词 id 记）继续对得上。
- **体积与开销**（本机实测）：词书语料 205 KB（源码文本），运行时解析 6 ms、堆内存 +0.59 MB、
  建完 6 本词书的全部批次 37 ms —— 一次性，之后全是缓存。所以走同步 `import` 就够了，
  没必要为它把整条词书链路改成异步。主包体积由 `_tools/check-bundle-size.js` 盯着。

### 词书分类与自建词书

| 类型     | 例子                | 批次        | 词来源       | 练习链路     |
| ------ | ----------------- | --------- | --------- | -------- |
| 内置批次词书 | 上面 6 本考试词书        | 有（40-121 批） | 共享词条表      | i+1 批次链路 |
| 无批次词书  | 我的导入词书 / **自建词书** | 无         | 该书导入词     | 导入词链路    |

「更换词书」页按 `group` 分组渲染（升学考试 / 大学英语 / 中学词汇 / 我的），
词书卡上会有「默认词书」提示标签；内置词书长按同样会给出提示（不支持重命名 / 删除）。

- **自建词书**：`state.userBooks = [{id,name,desc,createdAt}]`，词仍存在 `customWords[bookId]`
  - 可在「更换词书」页 `＋ 新建空白词书`；长按自建词书可**重命名 / 删除**（删除会一并清掉掌握度与词）
  - 删除的若是当前词书，自动退回默认词书（福建专升本）；内置词书不可删除
- **无批次词书如何出题**（`utils/session.js` `buildCustomSession`）：  
  优先用该词已生成的例句（`exampleEn/exampleZh`）直接组题；  
  缺例句则走统一生成链路（AI → 缓存 → 语料）。目标词 id 即导入词 id，  
  答题后写回该书掌握度；空词书返回空组，练习页给出「该词书还没有词汇」提示而非空白。
- **data 层解耦**：`data/wordbooks.js` 不反向依赖 utils，  
  由 `utils/wordbook.js` 通过 `setUserBookProvider()` 注入自建词书读取函数，  
  使 `getBook()` 也能解析自建词书 id

### 熟词过滤（估算词汇量，对标扇贝）

入口：词库 tab →「熟词过滤」卡（副标题会显示上次的战果，如「已跳过 1364 词 · 点击重测」）。
实现在 `utils/known-filter.js` + `pkgManage/pages/known-filter/known-filter.vue`：

- **为什么能"抽 20 个词估出词汇量"**：内置词书内部是按词频排序的（高频在前），
  所以"认识 / 不认识"在词表上是一条清晰的边界 —— 用二分就能找到它。
  12 段 × 每段抽 5 词测试，按每段认识率（≥60% 算认识）决定往前往后，收敛到一段之内。
- **「认识」要过二次确认**：先只给单词，用户点「认识」后才亮出释义让他对一遍 ——
  挡住"看着眼熟就点认识"的误判，否则整段会被高估。
- **测试过程零写入**：只有最后点「应用」才落账（掌握度直接标到已掌握），
  此前随便点、随时退出都不会动数据；应用后可以**一键撤销**（落账前会把整份
  `mastery` 与 `removedBookWords` 快照存进 `filterRun`）。
- **不能污染"今日新词"**：批量标记时 `fs`（首次接触日）一律写昨天，
  否则今天一标记，首页「每日新词」会瞬间爆表（`goalProgress()` 就是按 `fs === 今天` 数的）。

### 错题本（答错 → 列表 → 重练）

- `engine.recordAnswer(q, 'fail', ...)` 写入 `state.wrong`，**并把句子原文一起存下来**：  
  `en` / `zh` / `lv` / `note` / `wordIds`
- 为什么必须存原文：i+1 / AI / 导入词生成的句子 `sid` 带 `corpus-` / `ai-` / `cw-` 前缀，  
  **不在 `data/sentences.js` 语料表里**。只存 sid 的话，`wrongList()` 与 `reviewQuestions()`  
  按 `SENTENCES.find(s => s.id === sid)` 反查必然落空 —— 错题明明记录了，列表和重练却都是空的。  
  （`resolveWrongSentence()` 仍保留"剥前缀再查一次"的兼容分支，老数据不会丢）
- 答对（含错题重练答对）即移出；半对 `partial` 不进错题本、也不移出已有错题
- 校验脚本：`_tools/check-wrong.js`（6 组：进本 / 列表还原 / 重练出题 / 答对移出 / 半对 / 老记录兼容 / 脏数据过滤）

## 三之二、不背单词机制与双进度条

> 一遍答对就 +1 是假的：选项里挑出来的"会"、刚看完答案的"会"，都不是真会。
> 这一整套改动的出发点就是**把"做了多少"和"会了多少"彻底分开记账**。

### 先说清楚：次数不是关键，跨题型和跨时间才是

第一版做的是"连对 2 次才算会"，后来发现**方向错了**：
这 2 次前后只隔几十秒（隔两个词回头），考的是短时记忆；而**两次都是同一道选择题**，
考的还是那一条记忆通路。把 2 改成 4 也只是把同样的短时记忆多刷两遍。

查完不背单词的真实实现和认知科学的结论，差距在两条上：

| 维度 | 我们原来的做法 | 不背单词 | 科学依据 |
| -- | -- | -- | -- |
| **提取方式** | 只有"看词选中文"一种 | 4 种题型：选释义 / 想中文 / 中文回想英文 / 拼写 | 识别（recognition）< 回忆（recall）< 产出（production），换路径本身就是强化 |
| **时间跨度** | 全在同一场次的几十秒内 | 4 次间隔**逐次拉长**；复习首次安排在学习后 1~2 天，间隔超 100 天判定掌握 | Cepeda 等 2006《Psychological Bulletin》元分析（317 个实验）：分散练习优于集中，且**要记多久、间隔就得有多长** |

所以改造分两块，分别对应这两条：

- **当场三关跨题型**（`word-session.js`）—— 换提取路径
- **跨天巩固阶梯**（`utils/srs.js`）—— 换时间跨度

两者是**接力关系，不是替代关系**：当场过三关 = "今天会了"（即时反馈，进度条 +1、
每日目标 +1）；跨天巩固 = "真的变成长期记忆"。当场刷得再熟也顶替不了隔天再问一次。

### 当场三关：认得出 → 想得起 → 写得出

`utils/word-session.js` 的 `createConfirmSession(deck, { review, modes })`：

- 新词 / 日常：同一个词要连过 `CONFIRM_TIMES = 3` 关，且**三关的题型各不相同**
- 答完不原地重放，而是**插回队列第 3 位**（隔两个词再回头）—— 否则考的是瞬时记忆
- 中间答错一次：连击清零、题型退回第一关，重新排队
- 复习（`source=review`）：第一次就答对**直接算记住**，答错才升级成完整的三关
- 组结束的唯一条件：队列里所有词都确认完

三档题型（`toItem()` 里一次造齐，造题只用本地数据）：

| 档 | 题干 | 作答 | 提取难度 |
| -- | -- | -- | -- |
| `recog` 认得出 | 英文单词 | 选中文释义 | 识别（最浅） |
| `recall` 想得起 | 中文释义 | 选**英文**单词（反向） | 回忆 |
| `spell` 写得出 | 中文 + 首字母提示 | 手写英文单词 | 产出（最难） |
| `self` 自评 | 英文单词 | 先在心里过一遍再给自己打分 | 元认知判断，只在第一关出现 |

**两个"必须藏起来"的细节**（漏了就等于没考）：

- `recall` / `spell` 两关**不显示单词**，题干换成中文释义 —— 一上来就把单词摆出来等于没考
- 这两关也**不自动朗读、不显示音标** —— 听到 apple 谁都能选对，音节数能把答案漏掉一大半

序列由 `buildModeSequence(偏好)` 生成：**第一关用用户在顶部胶囊选的，后两关自动轮转**。
既尊重选择，又保证同一个词不会三遍考同一种通路：

```
选义  → 认得出 → 想得起 → 写得出
拼写  → 写得出 → 认得出 → 想得起
自评  → 自评   → 认得出 → 想得起
```

#### 胶囊底下必须有「本轮三关」预览

三个胶囊**只决定第一关**，这个事实光看胶囊根本看不出来 —— 用户会以为那三个按钮点了没用。
所以胶囊正下方跟一条预览（`modePlan`，由 `syncModePlan(连击)` 预计算，模板不做函数调用）：

- 点哪一档，这一行**当场就变**（`switchMode` → `setModes` → `setupQuestion` → `syncModePlan`）
- 第 1 项标 `first`（主色淡底）= 跟着胶囊变的那一档，把「选择 → 结果」这条因果画出来
- 当前所处的那一关标 `on`（主色描边），这条顺带兼做进度指示
- 底下再一行小字说明因果：「第一关跟着上面切换，后两关自动换成别的题型」

选中态用**实心主色**（`var(--brand)` + 白字），不再只是"白底 + 蓝字" ——
后者在一排胶囊里区分度太弱，看不出哪个被选了。练习页那两个（`选择题 / 手动输入`）同样处理。

> ⚠️ **修过一个真 bug**：`createConfirmSession` 里 `modes` 声明成了 `const`，而
> `setModes()` 会重新赋值 → 抛 `Assignment to constant variable`。
> 抛在 `setupQuestion` 之前，表现就是"**胶囊高亮了、题目纹丝不动**"——
> 用户只会以为按钮没用。原校验是假绿：那几次 `switchMode` 都发生在
> **还没有会话**的时候，`setModes` 分支从来没被执行过。已补「会话存在时切换」的回归断言。

### 跨天巩固：1/3/7/15/30/60/100 天阶梯

`utils/srs.js` 是纯函数模块（不依赖存储与引擎，方便单测）。掌握度记录里多两个字段：
`st`（已巩固几次）与 `due`（下次哪天回来），和原来的 `m`（熟练强度）**不互相推导** ——
m 高不代表不用复习（不复习它就会掉回去），due 到了也不代表 m 一定低。

| 事件 | 结果 |
| -- | -- |
| 当场三关全过（第一次学会） | `st=0`，`due = 明天`（**当场不算第 1 次巩固**，否则首档间隔会被吃掉一档） |
| 到期回来巩固，答对 | `st+1`，间隔按阶梯拉长（3 → 7 → 15 → 30 → 60 → 100 天） |
| 到期回来巩固，**答错** | 退回第 0 阶、明天重来，`lp`（遗忘次数）+1（Leitner：答错回第 1 格） |
| 走完 7 次 | 毕业，`due` 清空，不再安排复习 |
| 已毕业的词答错 | 也能退回第 0 阶（不留"毕业即免检"的窟窿） |

阶梯取值 1/3/7/15/30/60/100 天的理由：首档 1 天贴合艾宾浩斯曲线最陡的那段
（不复习 24 小时内就忘掉大半），也对齐不背单词"首次复习 1~2 天后"；
末档 100 天对齐它"间隔超过 100 天即判定已掌握、停止安排"；中间按约 2 倍扩张，
是通用词汇阶梯的常见取法。

**组牌要认识到期词**（`pickWords`）：到期的先取（按逾期天数，欠得越久越靠前），
上限 `DUE_RATIO = 50%` —— 不给上限的话，背到后面到期堆越来越大，一组 20 个全是旧词，
新词永远排不进来。以前只有"按该练程度排序"，结果是**今天学完的词明天再也不会主动出现**，
除非它恰好烂到掉进错题本；间隔重复该由调度器决定什么时候回来，而不是等它自己烂掉。

翻译练习页（practice）的确认是另一条路：句子答对先**不落账**，
弹**两道**本地生成的确认题（`wordSession.toItem`，零 AI 成本）——
先「认得出」再「想得起」，**两关都对才 `commit('pass')`**；
第一关就没认出来则整题按 `fail` 落账（句子进错题本重练），不必再考第二关。
**确认期间会藏起参考答案与词义 chips** —— chips 里就是答案，不藏等于泄题。

两条练习链路**共用同一个巩固队列**：练习里过了确认，本题的目标词也走 `srs` 的调度
（在队列里就进一阶，不在队列里就先记账、等它在刷单词里正式过完三关再排期 ——
免得句子蒙对一次就把一个压根没背过的词当成学会了）。

### 「记错了」：答对之后可以反悔

`engine.revokePass()` + `iplus1.revokeMastery()`：

- 净效果 m −3（撤销答对的 +1，再按答错 −2）、今日 `correct` −1、按 `fail` 收进错题本
- **今日 `total` 不变** —— 改判不是"又做了一题"（这里刻意**不复用** `recordAnswer` 的
  `fail` 分支，那会把 `total` 再 +1，一题被记成两题）
- 确认会话里连击清零、已计入的进度回退、该词重新排队

### 顶部两条进度条

练习页（practice / word-drill）顶部各两条，**上面是"做了多少"，下面是"会了多少"**：

| 条 | 分子 | 分母 | 说明 |
| -- | -- | -- | -- |
| 已做 | 累计作答次数 | **无** | 只增不减，改判也不回退；超过组词数后进度条按"每做完一轮"循环填充，数值后带「第 N 轮」 |
| 会了 / 记住 | 确认达标的题（词）数 | 本组题量 | 只有三关（练习是两关）全过才 +1 |

为什么上面那条不设分母：确认机制下同一个词会来回确认，作答次数**必然**超过组词数，
写成"x / 组词数"会被卡住。所以数字只管累加，进度条循环推进。

（改成三关后，一组 20 词全对的总作答次数从 40 变成 60，上面那条的意义更大了 ——
它现在更能反映"确认机制到底多干了多少活"。）

### 「学会」计数与每日目标

新增 `days[今天].mastered`（与 `total` / `correct` 并列，**不动后两者** ——
正确率、连续天数、历史曲线还靠它们），唯一写入口是 `engine.addMasteredToday(±1)`（夹在 0 以上）：

- 刷单词：确认会话判 `done` 才 +1；「记错了」撤回了进度才 −1
- 练习：`commit('pass')` +1；「记错了」−1（确认没认出来走的是 `fail`，本来就没记）
- `wordbook.goalProgress().practice` 的 `done / pct / reached` 全读 `mastered`

所以**目标数的是"学会了多少"，蒙对刷不上去**。

### 两条进度条的颜色

`settings.theme.progressSync`（唯一读取口 `theme.barsSyncColors()`，只有显式 `false` 才算"分开"），
页面根节点 `:class="barsSync ? 'sync' : 'split'"`：

| 模式 | 已做（上） | 已会（下） |
| -- | -- | -- |
| `sync`（默认） | 主题色浅版 `rgba(var(--brand-rgb), .38)` | 主题色实心 `var(--brand)` |
| `split` | 主题色 `var(--brand)` | 绿色 `#2f9e6e` |

颜色**全部走 CSS 变量**，换主题色、切深色模式自动跟随，没有写死色值。
设置 → 外观 → 练习进度条：开关 + 同款实时预览（看到的即练到的）；
两个练习页在 `onShow` 里重读开关，从设置页返回立刻生效。

### 界面上怎么看见这套机制

机制藏起来等于没有，所以有三处把它摆到明面上：

- 刷单词页词卡顶部：琥珀色标签「第 2 / 3 关 · 想得起」—— 现在第几关、考的是哪种提取方式
- 答后揭示区：一行「巩固」显示「已巩固 2 / 7 次 · 下次 2026-10-17」，走完 7 次显示"出师了"
- 首页「刷单词」卡脚注：`全书 2834 词 · 已掌握 88 个（3%）· 今天该巩固 12 词`

**相关文件**：`utils/srs.js`（跨天调度，纯函数）、`utils/word-session.js`（三关会话 + 造题 + 组牌）、
`utils/engine.js`（`revokePass` / `addMasteredToday`）、`utils/iplus1.js`、`utils/wordbook.js`、
`utils/theme.js`（`barsSyncColors`）、
`pkgStudy/pages/practice/practice.vue`、`pkgStudy/pages/word-drill/word-drill.vue`、
`components/home-widgets/widget-worddrill.vue`
**校验**：`check-srs.js`（阶梯 / 日期 / 调度语义 / 到期判定 / 落盘 / 组牌 / 题型序列 / 造题结构）、
`check-word-drill.js`（第 11/12/13/14 组）、`check-practice.js`（第 9/10 组）、
`check-checkin.js`（目标口径）、`check-theme.js`（6b 配色开关）

## 四、底部导航（悬浮磨砂玻璃）

原生 tabBar 无法做圆角/悬浮/半透明，因此改为**隐藏原生栏 + 自绘胶囊**：

- `components/float-tabbar/float-tabbar.vue`：悬浮胶囊（`position: fixed` + 左右 24rpx 边距 +  
  `border-radius: 56rpx`），半透明底 `rgba(255,255,255,.68)` + `backdrop-filter: blur(12px) saturate(180%)`
  - 白色发丝描边 + 柔和投影；选中项是淡蓝胶囊底（`rgba(46,107,255,.10)`）+ 主色图标/文字
- 不支持 `backdrop-filter` 的环境（`@supports not`）自动退化为 93% 不透明白，保证可读性
- 适配安全区：`padding-bottom: calc(20rpx + env(safe-area-inset-bottom))`
- 用法：在每个 tab 页根节点末尾放 `<float-tabbar current="home|library|review|profile" />`  
  （已按显式 import 注册，不依赖 easycom，避免静默不渲染）
- 隐藏原生栏（分端处理，见 `utils/nav.js`）：
  - **H5**：App.vue 全局样式 `uni-tabbar { display: none }`（零闪烁）
  - **App**：`uni.hideTabBar()` —— 在 App onLaunch/onShow 与每个 tab 页 onShow 各调一次，  
    防止 switchTab 或回到前台后原生栏复现
- tab 页根节点加 `.page-tabbar` 类，底部预留 `220rpx + 安全区`，最后一个元素可滚出胶囊遮挡区

### 点击动画（三个真实 bug 的修复）

- **指示胶囊改为整格平移**：`.ftb-ind` 宽度固定 `25%`，内层 `.ftb-ind-pill` 用 `left/right: 6rpx`  
  留出与 `.ftb-item`（`flex:1 + margin: 6rpx`）完全一致的间距，平移只改 `transform: translateX(n*100%)`  
  —— 不再用 `left + calc`（每帧重排），也不会滑到后面的 tab 时错位累积
- **起点统一取模块级 `lastIndex`**：tab 页在 uni-app 里是常驻的（switchTab 不销毁），  
  每个页面各有一个组件实例，实例里的 `indIndex` 在切回来时是"自己这一页的位置"，  
  用它当起点会得到"本来就位" → 动画被吃掉（表现就是点了没反馈）。  
  现在起点一律取 `lastIndex`，首次进入才有动画
- **落到起点时必须关掉过渡**（`.no-anim`）：否则会先朝反方向滑一下再滑回来（指示器错位的根因）。  
  时序 = 无过渡落到起点 → 下一帧开过渡滑到目标
- **`sync()` 重复调用不打断**：mounted 一次 + 页面 onShow 一次，用 `__sliding` 记住"正在滑向哪里"
- **残留 pending 会清掉**：点击时的即时高亮 `pending` 存在常驻实例里，回到本页若不清理就会  
  高亮到别的 tab（选中态与页面不同步）。现在只有"导航在途"（`__navLock` 350ms）才保留
- **★ pending 落地即失效（2026-10-09）**：光靠 `sync()` 清理还不够 —— 清理发生在页面  
  **已经显示之后**，用户会看到高亮从错位置被拽回本页，配合 `.ftb-item.active .ftb-icon`  
  的 `ftb-pop` 弹跳动画，就是"滑动切换时底栏晃一下"。现在 `switchTab` 落地后 150ms  
  主动清掉自己的 pending，从源头不留残骸
- **★ 手势切页时胶囊立刻跟进（`preview()`）**：页面一决定切页就 `notifyPreview()` 通知底栏，  
  指示胶囊与内容同时开始动（原本要等新页显示约 200ms 后才追）。  
  `preview()` **只动胶囊、不碰 `pending`** —— 此刻页面还没切走，高亮仍属于当前页；  
  提前把高亮指到目标，等用户滑回本页时就会被拽回来，又是那一下"晃"
- 另有连点保护（350ms 内只导航一次）与点击当前 tab 直接返回

### 内容左右滑动（utils/tab-slide.js + utils/tab-slide-mixin.js）

- **方向由索引大小决定**：`markSwitch(from,to)` 记下意图，目标页 `onShow` 时 `takeEnterInfo(key)`
  取走 —— 索引变大 → right，变小 → left。意图一次性（取走即失效）且 1.5s 过期
- **只滑内容区**：每个 tab 页把内容包一层 `.page-slide`，顶栏与底栏留在外面不跟着滑。  
  **不能把 transform 加在页面根节点上** —— 根节点上有 fixed 的背景层，一旦被 transform，  
  fixed 会改以它为参照，背景就会跟着内容一起跑
- **★ 动画只做在"当前看得见的那一页"上（2026-10-09 二次重做的核心）**  
  tab 页在 App 端是独立 webview，切走后处于隐藏状态，**往隐藏页下发样式并不保证被画上去** ——  
  一旦起始帧没画准，看到的就是"先显示终点 → 跳回起点 → 滑进来"，即用户说的"一闪一闪"。  
  所以改成两段，且两段都在可见页上完成：
  1. **离场**（本页，可见）：`requestLeave()` → 轻移 40px + 淡出到 0，130ms；底栏在 **90ms 后**
     才 `switchTab`（此时旧内容已基本淡掉）
  2. **进场**（目标页）：它显示的**第一帧就是自己上次离场留下的状态**（透明 + 轻移，
     那时它可见、画得准），`onShow` 只需淡入归位（220ms）—— 不存在跳变
  3. **首次进入**的页面：data 初值 `slideOp: 0`，首屏渲染即透明 → 同样淡入，不会凭空一闪
- **手势松手**：先把内容沿手指方向**推出屏幕**（110~190ms，跟手连续），推出去之后内容已在屏幕外，
  此时再关掉过渡复位到"离场态"（这次复位用户看不见），最后才 `switchTab`
- **平级 tab 不做整屏飞行**：整屏位移一旦起始帧没画准，跳变极其明显；现在位移只留 40px 示意方向，
  主体交给不透明度 —— 即便某一帧没赶上，也只是"淡一点"的差别，不会闪
- **手势跟手**：横向位移 > 纵向 ×1.2 才判定为横滑；跟手区间 = 屏宽 45%；松手过 60px **或**轻扫够快
  （≥36px 且 ≥0.45px/ms，需两个采样点）才切页；首尾页只给 30% 位移提示"到头了"
- 动效时长由 JS 内联下发 → perf 档位压时长的规则必须带 `!important`；
  `.slide-enter` / `.dragging` 期间才挂 `will-change`
- 校验脚本：`_tools/check-tabbar.js`（13 组）、`_tools/check-tab-slide.js`（10 组 + 4b/4c/5b/5c/8b：
  离场参数 / 离场回调 / 离场淡出 / 兜底恢复 / 轻扫判定）


## 五、全局视觉统一：磨砂玻璃 + 去蓝色顶栏

- **顶部不再有蓝色条**：`pages.json` 的 `globalStyle` 改为  
  `navigationBarBackgroundColor: #F4F6F4`（与页面背景同色）+ `navigationBarTextStyle: black`；  
  App 端 `app-plus.titleNView` 同色并去掉分割线；H5 端由 App.vue 全局样式兜底  
  （`uni-page-head` 去边框/阴影）。保留原生标题与返回能力，视觉上不再出现"蓝色框"
- **卡片与所有方框统一到同一套令牌**（`App.vue` 全局样式）：
  - `.card`：`rgba(255,255,255,.72)` + `backdrop-filter: blur(12px) saturate(180%)`
    - 白色发丝边 + `border-radius: 28rpx` + 柔和投影
  - `.glass`：非卡片的方框（分段器 / 输入块 / 气泡 / 弹窗 / 内嵌面板）共用同一材质，圆角 20rpx
  - `@supports not` 退化：`.card/.glass/.btn-ghost` 退回 94% 不透明白
  - 胶囊语言统一：chips / 标签 / 筛选 / 分段 / 模式切换一律 `border-radius: 999rpx`，  
    与底部导航同形；内部块（输入框、textarea、示例块）统一 16-20rpx
  - 分割线/轨道等硬色改为 `rgba(23,32,26,.07~.08)` 半透明，避免玻璃上出现死板的实色边
  - 状态色块（蓝/紫/琥珀/新词等标签）统一为对应主色的 12%~14% 透明度淡底
  - 幽灵按钮 `.btn-ghost` 也改为半透明玻璃 + 主色描边；主按钮保持实心主色胶囊
  - 统计页柱状图去掉渐变改纯色主色（与"去 AI 痕迹/扁平克制"的既定风格一致）
  - 弹窗/加载遮罩加入 `backdrop-filter` 模糊，与底栏观感一致

### 悬浮顶栏（components/float-navbar）

- 每个页面（除封面）在 `pages.json` 里 `navigationStyle: custom`，  
  改用自绘悬浮胶囊：`height 88rpx` + `border-radius 44rpx` + 同一套磨砂玻璃材质
- 状态栏留白：JS 读 `uni.getSystemInfoSync().statusBarHeight` 写 inline `padding-top`；  
  CSS 变量 `--status-bar-height` 缺失时由 `utils/theme.js initStatusBarVar()` 兜底补写
- 返回键按页面栈深度自动显示（`getCurrentPages().length > 1`），  
  也可用 `:back="true/false"` 强制；无上一页时点返回回首页
- 页面根节点加 `.page-nav`（`padding-top: calc(var(--status-bar-height,0px) + 136rpx)`）

#### 首页搜索（顶栏改为搜索框）

- `<float-navbar search />`：中间渲染 `<input>`（`confirm-type="search"`），右侧 `×` 清空，  
  向页面 emit `input` / `search` / `clear` / `focus` / `blur`；组件另暴露 `blurInput()` 供页面主动收起

#### 练习页顶栏「随手查词」（components/word-search）

翻译练习 / 刷单词的顶栏平时是一行标题，**点一下原地变搜索框**（参考不背单词）：

- 组件 `components/word-search/word-search.vue` 包一层 `float-navbar`，  
  非搜索态右侧画一颗放大镜（`searchable` 打开），点标题或放大镜都 emit `title-tap` → `open()`
- **门禁不在组件里**，由页面用 `:locked` 传：练习页 `canSearch = finished || (answered && !confirming)`，  
  刷单词页 `canSearch = finished || answered`。锁着时入口**置灰不隐藏**，点了 toast 说明原因
  （没出结果就能搜 = 把答案摆在手边；练习页的确认关考的就是目标词的意思，更要挡住）
- 检索顺序与首页同源：`search.localSearch`（本地，最多 8 条）→ `aiCache.findWord`（本机缓存，不花额度）  
  → 停手 700ms 后 `explainWord()` 兜底；AI 结果**只展示、只进本机缓存**，收不收由用户在词条页决定
- 结果卡就地铺在顶栏下方（不盖住题目、不接管返回键）；点结果 `navigateTo` 单词详情（`w` + `book`）
- 页面 `onShow` 调 `collapse()`（从词条页返回别让面板杵在那儿）、`onUnload` 调 `close()`（清 AI 定时器）

##### 胶囊的「铺满 ↔ 收缩」

- **默认（没聚焦、也没关键词）**：左右两个图标槽 `width: 0`，输入框 `flex: 1` 铺满整个胶囊
- **点击输入框（或已有关键词）**：两个槽展开到 `76rpx`，输入框随之**只横向收缩**；  
  `height: 100%` 始终与胶囊同高（上下不动），两侧槽等宽 → 输入框始终**居中**
- 动画：`transition: width 260ms cubic-bezier(.22,.61,.36,1)` + 图标 `opacity/scale`，  
  收缩与还原双向都有；`prefers-reduced-motion` 下自动关闭
- 左槽用放大镜（**纯 CSS 画的**线性图标，不引图片资源，App/H5/小程序表现一致），  
  点击 = 执行搜索；右槽 `×` 仅在有内容时出现，行为与改造前一致
- 收缩态的判定是 `active = focused || value !== ''`：  
  有关键词时即使失焦也保持收缩，否则 `×` 会没地方放；清空后才动画还原成铺满
- 校验：`_tools/check-navbar.js`（9 组，含非搜索页左槽仍是返回键、不会误触搜索）
- 检索逻辑在 `utils/search.js`（与页面解耦、可单测），顺序：
  1. **当前词书**：`wordbook.bookWords(bookId)` 里命中词形（大小写不敏感）或中文释义，上限 20 条
  2. **词典兜底**：`dict.lookup()` 的内置词 / 常用词 / 词形还原；  
     刻意排除 `src === 'custom'`（别的词书的导入词不算本词书命中，否则会挡掉 AI 补词）
- 未接 AI：搜不到就是搜不到，只展示本地结果与"接入 AI 后会自动补充"的引导
- 已接 AI：本地 0 命中 → 防抖 700ms → `explainWord()` → **只写 `aiCache`（本机缓存）**，  
  页面上以卡片展示：词形 / 词性 / 释义 / 例句 / 发音按钮 / `本机缓存 · 未加入词书` 徽标
- **AI 补的词不自动进任何词书**。早期版本会顺手 `addWordToBook()` 塞进当前词书，  
  结果"临时查一个词"就把核心词书搞脏。现在归属权交回用户：想收，去单词详情页点「加入词书」
- 单词详情页（pages/word-detail）新增**「加入词书」**卡片，两个入口共用：
  - `加入当前词书`（不在本书时显示；已收录则显示「已在当前词书中」）
  - `加入其他词书…` → 统一 `app-dialog` 的 sheet 模式列出**尚未收录该词**的词书
  - 入库仍复用 `search.addWordToBook()`（去重 / `cw-` id / 点读缓存失效全部一致），
    但传 `{ allowKnown: true }`：**只按目标词书自身去重** ——
    核心词典里已有的词不能被重复塞回核心词书，却可以收进导入词书 / 自建词书
  - 该词已有的例句（导入词自带 或 AI 缓存）一并带过去，省掉一次生成请求
- 入库被拒（已在该词书 / 非英文 / 缺释义）时 toast 显示具体原因，不静默失败
- 校验：`_tools/check-word-detail.js` 第 6/7 组 + `_tools/check-search.js` 第 15/16 组

### 例句详情（pages/sentence-detail，我的收藏 → 点例句进入）

- 列表页点例句卡整卡跳转（`id` 走 `encodeURIComponent`，长句**不**走 URL，详情页回  
  `settings.favorites()` 查原文）；`移除` 按钮 `@tap.stop` 防止同时触发跳转，单词收藏不跳转
- 详情页：例句原文逐词拆分（`utils/tokenize.js`，与练习页**共用同一实现**），  
  点词 = 查词弹窗（音标 / 词性 / 释义 / 来源 / 原形）+ `speakWord(speakForm)` 发音；  
  整句朗读 = `speakSentence(en, { onDone })`；`onHide` / `onUnload` 一律 `tts.stop()`
- 弹窗大字展示**点到的词形**（保留大小写，`I` / `English` 不会被词典小写词头顶掉）；  
  仅当点到的是变形（signed → sign）才显示「原形」行 —— 分词结果与释义一一对应
- 取消收藏：`removeFavorite('sentence', id)` → toast → `navigateBack`（列表 onShow 自动刷新）
- 校验：`_tools/check-sentence-detail.js`（6 组：分词可逆 / 撇号归一 / 释义对应 / 页面契约 / 共用分词 / pages.json）

## 五之二、本地账号系统（纯本地，零网络请求）

> 只&#x5728;**「我的」**&#x91CC;登录，App 启动不强制登录；未登录时现有功能 100% 不受影响。

### 1. 分层

```
pages/profile  pages/login        ← 页面（UI，只调 services）
        │
services/auth.ts                  ← 业务层：校验 / 注册 / 登录 / 登出 / 会话恢复
        │
repositories/index.ts             ← 工厂：按环境选后端（未来加 cloud-*）
repositories/types.ts             ← 抽象接口（Repository / UserRepository / …）
        │
┌───────┴────────┐
local-sqlite.ts  local-kv.ts      ← 实现：plus.sqlite / 降级存储
db/sqlite.ts  db/schema.ts  db/sql.ts   ← 驱动与建表（唯一碰 plus.sqlite 的地方）
utils/hash.ts  utils/argon2.ts  utils/secure-storage.ts  utils/uuid.ts
```

业务层**只 import 接口**，永远拿不到 `SqliteUserRepository`、不写 SQL、不碰 storage。  
未来接云同步：新增 `cloud-user-repository.ts` 实现同一组接口，改 `repositories/index.ts` 的  
`createRepositories()` 即可，页面与 services 一行不用动。

### 2. 建表 SQL（`db/schema.ts`，逐条执行 —— Android 不支持 `;` 拼多条）

```sql
CREATE TABLE IF NOT EXISTS users (
  uuid           TEXT    PRIMARY KEY NOT NULL,
  user_id        TEXT    NOT NULL,            -- 用户自身的归属就是自己
  username       TEXT    NOT NULL,            -- 存归一值（trim + 小写）
  password_hash  TEXT    NOT NULL,            -- 单向哈希，绝不存明文
  nickname       TEXT    NOT NULL DEFAULT '',
  avatar         TEXT    NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_login_at  INTEGER NOT NULL DEFAULT 0,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  sync_status    TEXT    NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS study_records (
  uuid          TEXT PRIMARY KEY NOT NULL,
  user_id       TEXT NOT NULL,
  book_id       TEXT NOT NULL DEFAULT '',
  word_id       TEXT NOT NULL DEFAULT '',
  sentence_id   TEXT NOT NULL DEFAULT '',
  direction     TEXT NOT NULL DEFAULT '',   -- e2c 英译中 / c2e 中译英
  mode          TEXT NOT NULL DEFAULT '',   -- choice 选择题 / input 手动输入
  result        TEXT NOT NULL DEFAULT '',   -- pass / partial / fail
  score         INTEGER NOT NULL DEFAULT 0,
  user_answer   TEXT NOT NULL DEFAULT '',
  reference     TEXT NOT NULL DEFAULT '',
  practiced_at  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS word_favorite (
  uuid        TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL,
  ref_type    TEXT NOT NULL DEFAULT 'word',  -- word 单词 / sentence 例句
  ref_id      TEXT NOT NULL,
  word        TEXT NOT NULL DEFAULT '',
  meaning     TEXT NOT NULL DEFAULT '',
  en          TEXT NOT NULL DEFAULT '',
  zh          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_study_user_time ON study_records(user_id, practiced_at);
CREATE INDEX IF NOT EXISTS idx_fav_user_ref ON word_favorite(user_id, ref_type, ref_id);
```

- 三张表**都没有自增 id**，主键统一 `uuid TEXT`
- 公共列齐活：`uuid / user_id / created_at / updated_at / is_deleted / sync_status`
- `sync_status ∈ none | pending | synced | conflict`，本期全落 `pending`，只预留不实现

### 3. Repository 抽象接口（`repositories/types.ts`）

```ts
export interface Repository<Row extends BaseRow, Create, Patch> {
  readonly tableName: string;
  create(input: Create): Promise<Row>;
  findByUuid(uuid: string): Promise<Row | null>;
  update(uuid: string, patch: Patch): Promise<Row | null>;   // 自动 updated_at + pending
  softDelete(uuid: string): Promise<boolean>;                   // is_deleted = 1，不物理删
  listByUser(user_id: string, opts?: ListOptions): Promise<Row[]>;
  findPendingSync(user_id: string, limit?: number): Promise<Row[]>;
  markSynced(uuids: string[], status?: SyncStatus): Promise<number>;
}

export interface UserRepository {           // 多一个按用户名查询（登录用）
  create(input: CreateUserInput): Promise<UserRow>;
  findByUuid(uuid: string): Promise<UserRow | null>;
  findByUsername(username: string): Promise<UserRow | null>;
  update(uuid: string, patch: PatchUser): Promise<UserRow | null>;
  softDelete(uuid: string): Promise<boolean>;
  list(opts?: ListOptions): Promise<UserRow[]>;
  findPendingSync(limit?: number): Promise<UserRow[]>;
  markSynced(uuids: string[], status?: SyncStatus): Promise<number>;
}
```

LocalRepository（SQLite）实现要点：

```ts
export class SqliteUserRepository implements UserRepository {
  readonly tableName = 'users';

  async create(input: CreateUserInput): Promise<UserRow> {
    const t = now();
    const id = newUuid();
    const row = {
      uuid: id, user_id: id,
      username: normalizeUsername(input.username),
      password_hash: input.password_hash,
      nickname: input.nickname || input.username || '',
      avatar: input.avatar || '',
      created_at: t, updated_at: t, last_login_at: 0,
      is_deleted: 0, sync_status: 'pending'
    };
    await sqlite.exec(buildInsert('users', row));
    return asRow<UserRow>(row) as UserRow;
  }

  async update(uuid: string, patch: PatchUser): Promise<UserRow | null> {
    const cur = await this.findByUuid(uuid);
    if (!cur) return null;
    // 每次修改自动刷新 updated_at，并回标 pending 待同步
    await sqlite.exec(buildUpdate('users', uuid,
      Object.assign({}, patch, { updated_at: now(), sync_status: 'pending' as SyncStatus })));
    return this.findByUuid(uuid);
  }

  async softDelete(uuid: string): Promise<boolean> {
    if (!(await this.findByUuid(uuid))) return false;
    await sqlite.exec(buildSoftDelete('users', uuid, now()));  // UPDATE … is_deleted=1
    return true;
  }
}
```

驱动层（`db/sqlite.ts`）只暴露 `init / exec / select / transaction / close`，  
内部把 plus.sqlite 的 `success / fail` 回调包成 Promise，并兼容同步返回版本。

### 4. 后端选择与降级

| 环境                 | 后端       | 说明                                   |
| ------------------ | -------- | ------------------------------------ |
| App（Android / iOS） | `sqlite` | `plus.sqlite`，库文件 `_doc/beiwanci.db` |
| H5 预览 / 小程序 / 建库失败 | `kv`     | 三张表各存成一个 JSON 数组，接口完全一致              |

`manifest.json → app-plus.modules.SQLite` 已开启；用云打包时记得勾选 SQLite 模块，  
否则自定义基座 / 正式包里 `plus.sqlite` 可能为 undefined（会自动降级到 KV，功能不崩）。

### 5. 口令哈希

- 接口：`PasswordHasher { algo, hash(pw), verify(pw, encoded) }`，可插拔
- 默认：内置 **PBKDF2-HMAC-SHA256**（纯 TS，零依赖，120000 轮，16 字节随机盐）
- 升级：装上 `argon2-wasm` / `hash-wasm` 后按 `utils/argon2.ts` 的说明注册一次即可切到 argon2id
  ```
  npm i hash-wasm
  import { argon2id, argon2Verify } from 'hash-wasm'
  import { setPasswordHasher } from '@/utils/hash'
  import { fromHashWasm } from '@/utils/argon2'
  setPasswordHasher(fromHashWasm({ argon2id, argon2Verify }))
  ```
- 编码串自带算法与参数前缀（`$argon2id$v=19$m=…` / `$pbkdf2-sha256$i=…`），  
  所以新旧哈希可混存；`needsRehash()` 判定后在用户下次登录成功时静默重写

### 6. 会话与安全注意事项

- **token 只进 plus 安全存储**：`plus.navigator.setSecureData / getSecureData / removeSecureData`  
  （Android 走 KeyStore 加密、iOS 走 Keychain）；**不写 sqlite、不写普通 storage**，  
  校验脚本里有断言专门盯这一条
- 安全存储不可用时才降级到 `plus.storage` / `localStorage`，并把当前后端暴露给 UI  
  （登录页底部如实显示"数据库 / 会话存储 / 口令哈希"三行，避免用户误以为上了云）
- 密码**只留单向哈希**，`users` 表里没有明文、没有可逆加密、不进日志
- 用户名查重前先 `normalizeUsername()`（trim + 小写），登录与注册走同一函数，  
  否则会出现 `Tom` 和 `tom` 两个账号
- **登录失败不区分**"用户不存在"和"密码错误"，统一提示"用户名或密码不正确"，避免账号枚举
- 所有查询默认带 `is_deleted = 0`；删除一律 `UPDATE … is_deleted = 1`，库里没有 `DELETE FROM`
- `plus.sqlite` **没有参数绑定**，所有值必须过 `db/sql.ts` 的 `esc()`（单引号转义 + 去控制字符）
- 纯本地阶段**不发任何网络请求**；将来接云同步时再引入 https 与 token 校验


### 7. 相关文件与校验

- 新增：`db/sqlite.ts`、`db/schema.ts`、`db/sql.ts`、  
  `repositories/{types,local-sqlite,local-kv,index}.ts`、  
  `services/auth.ts`、`services/account-sync.ts`、  
  `utils/{uuid,random,time,hash,argon2,secure-storage}.ts`、`pages/login/login.vue`
- 改动：`pages/profile/profile.vue`（账号卡）、`pages/favorites`、`pages/library-detail`、  
  `pages/practice`（登录后镜像收藏 / 写学习记录）、`pages.json`、`manifest.json`、`App.vue`
- 页面脚本仍是 JS；新增领域层用 **TypeScript**（Vite 内置 esbuild 剥离类型，无需额外依赖）。  
  若 TS 文件想让 HBuilderX 做类型提示，可在项目根加一份 `tsconfig.json`  
  （`allowJs: true`、`checkJs: false`、`allowImportingTsExtensions: true`）。
- 校验：`node --experimental-strip-types _tools/check-auth.js`  
  （9 组：分层可加载 / SHA-256 与 HMAC 已知向量 / PBKDF2 编解码 / UUID /  
  Repository 软删除与 updated_at / auth 注册登录登出 / account-sync / SQL 转义与建表契约 / argon2 适配器）

### 主题色（设置 → 外观 → 主题色）

- `utils/theme.js` 的 `ACCENTS`：蓝 / 青 / 绿 / 紫 / 橙 / 玫红 / 墨绿灰，写入三个 CSS 变量  
  `--brand`（主色）、`--brand-strong`（深一档，用于文字）、`--brand-rgb`（用于 `rgba(var(--brand-rgb), α)`）
- 样式里全部用 `var(--x, 默认值)`，**每个用法都保留一行原值兜底**（老 webview 不支持变量时不会掉色）：
  ```css
  background: #2e6bff;                 /* 兜底 */
  background: var(--brand, #2e6bff);   /* 支持变量时覆盖 */
  ```
  批量迁移脚本：`_tools/apply-brand-vars.js`（只改 `<style>` 区块，不动 template/script）
- 只接受色值字符串的属性（switch `color`、slider `active-color`、`showModal.confirmColor`）  
  由设置页的 `brandMain` 计算属性提供十六进制值
- 封面渐变也改为主色的低透明度叠层，跟随主题色变化

### 全局背景（设置 → 外观 → 背景）

- `utils/theme.js`：`BACKGROUNDS` 预设（浅灰/浅蓝/薄荷/暖砂/淡紫/晨曦，支持纯色与渐变）
- **自定义图片**：`uni.chooseImage` 选图 → `uni.saveFile` 落本地 → 路径存 `settings.theme.bgImage`；  
  `--app-bg` 写成 `url(...) center/cover no-repeat fixed`；App 端用 `plus.io.convertLocalFileSystemURL`  
  把 `_doc/...` 转成 webview 可用的地址
- **背景固定不动**：上下滑动时只有窗体（卡片 / 胶囊）在动，背景纹丝不动。  
  实现上背景不画在会滚动的内容上，而是画在 `position: fixed` 的两层伪元素里：
  - `.app-root::before`（z-index -2）：背景层，读 `--bg-color` / `--bg-img`
  - `.app-root::after`（z-index -1）：蒙版层，读 `--bg-mask` / `--bg-blur`
  - 两个变量由 `theme.rootStyle()` 通过**根节点 inline style** 下发  
    （App 端逻辑层没有 document，写不了 CSS 变量；伪元素会继承宿主的自定义属性，两端都通）
  - 根节点自己再带一份同款背景 + `background-attachment: fixed` 作为兜底：  
    万一某端不吃 inline 自定义属性，观感一致；`page` 的兜底底色同样 `fixed`，回弹时不露白底
  - `.app-root` 必须是层叠上下文（`position: relative; z-index: 0`），  
    负 z-index 的伪元素才会落在"根节点背景之上、内容之下"
- 蒙版（淡化）强度 0-0.7，模糊 0-24px：因为蒙版层在背景之上、内容之下，  
  **自定义图与渐变预设同样能被淡化和模糊**（早先蒙版挂在 `page::before` 上，  
  会被根节点自己的背景图盖住，所以"图片淡化"看起来没作用——这才是那个 bug 的根因）
- 玻璃卡片、顶栏胶囊、底部胶囊保持半透明 + `backdrop-filter`，透出背景但与背景分层；  
  不支持 `backdrop-filter` 的端由 `@supports not` 退回高不透明度
- 切换即时生效并持久化到 `settings.theme.background`；同时调 `uni.setBackgroundColor`  
  同步 App 原生窗口底色（页面加载前的窗口色）
- 校验脚本：`_tools/check-theme.js`（预设完整性 / 主题色切换 / 未知 key 兜底 / 选图落库 /  
  蒙版钳制 / 清除还原 / **背景层 fixed + 蒙版层 z-index 契约** / 12 个页面根节点挂载检查）

### 深色模式（设置 → 外观 → 深色模式）

- 两个开关：**深色模式**（手动）+ **跟随系统**（跟随 `uni.getSystemInfoSync().theme` /  
  H5 的 `prefers-color-scheme`，运行期间用 `uni.onThemeChange` / `matchMedia` 监听切换）。  
  跟随系统开启时，深色开关显示系统当前值且不可手动改
- 主流做法不是"整体反色"，而是六件事：  
  ① 底色用 `#121513` 一档的深灰（纯黑会让玻璃卡片和背景糊在一起）  
  ② 文本三档反转 ③ 半透明面板换成深色半透明  
  ④ 发丝边从"白"改成"极淡的白"（沿用浅色的白边会很刺眼）  
  ⑤ 主色提亮（如 `#2e6bff → #6f9bff`）保证深色底上的对比度  
  ⑥ 背景图/渐变降亮度——蒙版由白色改成黑色，这正是"窗体透灰 + 背景降亮"的实现方式
- 实现：页面样式里的中性色全部写成 `var(--ink-1/2/3)`、`rgba(var(--surface-rgb), α)`、  
  `var(--hairline)`、`rgba(var(--neutral-rgb), α)`、`rgba(var(--shadow-rgb), α)`，  
  且**每行都保留原值兜底**，所以浅色下即使不定义变量也完全可用。  
  深色只需在 `.app-dark` 里重定义这几个变量，不需要逐条覆盖页面类  
  （迁移脚本：`_tools/apply-dark-vars.js`，15 个文件 / 274 行）
- **App 端逻辑层没有 DOM，写不了 CSS 变量**，所以深色靠根节点 class 生效：  
  `main.js` 全局 `app.mixin(themeMixin)`，每个页面根节点写  
  `:class="appTheme" :style="appBgStyle"`（`appTheme = 'app-root app-dark acc-blue'`）。  
  H5 两条通道并存，结果一致。新增页面记得挂这两个属性（`_tools/check-theme.js` 第 14 组会检查）
- 同时调 `uni.setNavigationBarColor`（状态栏文字转白）与 `uni.setBackgroundColor`（原生窗口底色），  
  覆盖 CSS 管不到的区域

#### App 端"跟随系统"要过的三道关（漏一个就完全没反应）

uni-app 的 App 端原生容器**默认锁在 light**，只写 CSS 是跟不动的：

1. `manifest.json` → `"app-plus": { "darkmode": true }`  
   没有它，`uni.getSystemInfoSync().theme` 恒为 `undefined`，`uni.onThemeChange` 也不会注册
2. 启动时调 `plus.nativeUI.setUIStyle('auto')`  
   容器不切成 auto，系统切到深色这边读到的还是 light（手动指定时传 `'dark'` / `'light'`）
3. 页面全是 `navigationStyle: custom`，`uni.setNavigationBarColor` 管不到状态栏，  
   只能用 `plus.navigator.setStatusBarStyle('light' | 'dark')`

另有一处容易漏：根节点 class/style 由 `theme-mixin` 持有，**运行期切主题不会自己重算**。
所以 `theme.apply()` 末尾会 `uni.$emit('theme:change')`，mixin 在 `onLoad` 订阅、`onUnload` 退订。

取值优先级：`getSystemInfoSync().theme` → `plus.nativeUI.getUIStyle()` → H5 `matchMedia`。
设置页在"跟随系统"打开时会把读到的值直接显示出来（`读取到深色` / `读取到浅色`），便于排查。

### 渲染性能：滑动帧率（`utils/perf.js` + `bg-flat`）

打完包在 Android WebView 上滑动只有 30 多帧，主因是 `backdrop-filter`：
每一帧都要把窗体背后的像素读回来做一次高斯模糊，卡片数量多、面积大时直接吃掉帧预算。
对策按"观感代价从零到有"排序：

1. **`bg-flat`（常驻，零观感代价）**  
   背景是平滑渐变时，模糊后的渐变和原渐变**肉眼没有差别**（渐变本身就是低频信号）。  
   所以没有自定义背景图时，`rootClass()` 下发 `bg-flat`，App.vue 用通配 + 伪元素 +  
   `!important` 把卡片的 `backdrop-filter` 全关掉，只保留半透明 —— 层次感不变，开销归零。  
   例外：顶栏 `.fnb` / 底栏 `.ftb` / 弹窗 `.pop-card` 面积小且叠在滚动内容之上，模糊才有意义，保留。  
   有自定义背景图时不加这个类（照片有高频细节，模糊看得出差别）。
2. **`--bg-blur` 下发 `none` 而不是 `blur(0px)`**  
   `blur(0px)` 依然会建立 backdrop root 并逐帧读背景，只有 `none` 才真的不参与绘制。
3. **流畅模式**（设置 → 性能）：全树关模糊 + 表面调实 0.94 + 投影收小 + 动效缩短，  
   另把根节点 `background-attachment` 改成 `scroll`（fixed 背景在 Android 上会逼着主线程逐帧重绘）。
4. **自动降级**：`utils/perf.js` 首次启动延迟 1.5s 做一次探测（CPU 算力 + `w×h×dpr²` 光栅化面积），  
   偏弱就自动打开流畅模式并记 `performance.auto`。用户亲手拨过开关会置 `manual`，之后不再被覆盖。  
   设置页可「重新检测」并显示档位与像素数。
   （App 端逻辑层没有 `requestAnimationFrame`，测不到真实帧率，所以测的是这两个强相关的量）
5. **手势节流**：`tab-slide-mixin` 把 `touchmove` 限制到每帧一次 —— 每次改 data 都是一次
   逻辑层 → 视图层通信，首页节点多时会把帧预算吃光。方向判定放在节流之前，保证手感灵敏。
6. **切页动画**：`.slide-in-*` / `.slide-prep` / `.dragging` 期间才挂 `will-change`，
   动画结束 class 被摘掉即失效，不会长期占着显存。

### 设置页：大胶囊分组

`pages/settings/settings.vue` 的每个大类都是一个**大胶囊**（`.sec`）：

- 收起时：只有"外观 / AI / 语音…"一行字的悬浮胶囊，右侧带一行状态摘要（如 `蓝 · 浅色`、`待配置`、`20:00`）
- 展开后：箭头 `›` 旋转 90° 并转主色，内容用 CSS 动画从 0 高度长出来
- **动画取舍**：圆角**不做过渡**（999rpx → 32rpx 瞬间切换）。因为内容一出现卡片就变高了，  
  若圆角还在从"全圆"过渡到"大圆角"的中间态，会看到"已经很高但四角还是巨圆"的畸形卡片。  
  展开感改由 `max-height + padding-bottom + opacity` 的关键帧给出（260ms，起步快的 ease-out，  
  起点由动画第一帧提供，无需 JS 量高度）；**收起走 `v-if` 直接移除，零延迟最跟手**。  
  系统开启"减少动效"时自动就位（`prefers-reduced-motion`）
- 手风琴式：一次只展开一个，再点当前胶囊即收起（状态存 `openSec`，不持久化）
- 材质与顶栏 / 底栏 / 玻璃卡片完全一致：半透明 `--surface-rgb` + `backdrop-filter` + `--hairline` 发丝边

| 胶囊    | 内容                                             |
| ----- | ---------------------------------------------- |
| 外观    | **界面语言**（中 / 英）+ 深色模式 + 跟随系统 + 主题色 + 背景预设 + 相册导入 + 图片淡化/模糊 |
| AI    | 启用开关、服务商、状态条+测试连接；**连接参数（地址/密钥/模型/语音模型）默认收起**  |
| 语音    | 使用 AI 朗读、音色、语速、试听；英文/中文朗读、本地语速                 |
| 通知    | 每日提醒 + 时间                                      |
| 数据与账号 | 本地存储说明、清除学习数据、退出登录（原「隐私」+「账号安全」合并）             |
| 关于    | 版本、介绍                                          |

六个分组**之外**，页面最底部还常驻一张「**支持 AWword**」卡（打赏入口，跳 `pages/donate/donate`）。
刻意不放进任何分组：折叠分组收起后就看不见了，而打赏希望常驻。
位置由 `_tools/check-donate.js` 守着（必须在「关于」之后、且不受 `openSec` 控制）。

### 界面语言（简体中文 / English）

设置 → 外观 → 第一行「界面语言」，用统一弹窗的菜单模式在两档之间切换，存 `settings.locale`。

- **`utils/i18n.js` 取了个巧：key 就是中文原文**。中文态直接把 key 显示出来，
  所以不需要再维护一份中文表 —— 省一半体积，也永远不会出现"中文表和模板对不上"。
  英文表（`utils/i18n-en.js`，485 条）查不到就回退中文，因此可以增量翻译，不会翻出空白
- **响应式**：模板里 `{{ $t('加入词书') }}` 只是个方法调用，本身不产生依赖，
  所以 `$t` 里读一下 `__lang`（全局 mixin 的响应式 data）建立渲染依赖；
  切语言时 `uni.$emit('i18n:change')`，所有页面自动重画，不用重进
- 脚本里用 `t()`（已从 `utils/i18n.js` 具名导入），带占位符：`t('已加入「{name}」', { name })`
- **带数字的整句必须整条进字典**（`t('练{a}次 · 对{b}次', {...})`），不能拼字符串 ——
  中英文序不一样，拼出来是 "Drilled 20 × correct 15 ×" 这种半吊子句子
- 星期 / 日期也走 i18n：`weekdays()`、`dateLabel()`（中文 `10月8日 · 周三` / 英文 `Oct 8 · Wed`）
- 底栏文案在 `utils/tab-slide.js` 的 `tabText()`；切语言时还会推一次 `uni.setTabBarItem`，
  让没被隐藏的原生 tabBar 也跟着变
- **学习内容与单词释义不翻译**（这是背单词 App，中文释义就是学习内容）
- 校验：`_tools/check-i18n.js`（引擎 / 字典 / 覆盖率-漏网扫描 / 接入点）
- 改造工具：`_tools/i18n-extract.js`（抽文案）+ `_tools/i18n-apply.js`（幂等套 `$t`）

模板改动后可用 `_tools/check-tpl-balance.js <file.vue>` 校验标签配平  
（注意要用 `lastIndexOf('</template>')` 取外层结束标签，页面里还有 `<template v-if>` 片段）。

## 五之三、首页自定义（跳转 / 小组件 / 拖拽收纳）

首页不再写死三个块，而是由**模块注册表 + 用户布局**驱动，顺序、增删都持久化。

### 数据模型与持久化

`utils/home-layout.ts` 是唯一真相来源，持久化挂在 `utils/settings.js` 的 `home.layout` 下  
（key `fj_app_settings_v1`，与学习进度 `store.js` 完全隔离）：

```ts
// 模块注册表：加新组件只改这里
export const MODULES = [
  { id: 'book',      name: '当前词书',   desc: '…', def: true  },
  { id: 'action',    name: '学习入口',   desc: '…', def: true  },
  { id: 'stats',     name: '今日数据',   desc: '…', def: true  },
  { id: 'goal',      name: '每日目标',   desc: '…', def: true  },
  { id: 'chart',     name: '打卡走势',   desc: '…', def: true  },
  { id: 'progress',  name: '掌握度概览', desc: '…', def: false },
  { id: 'favorites', name: '收藏速览',   desc: '…', def: false },
  { id: 'streak',    name: '打卡周历',   desc: '…', def: false }
];
```

对外接口：

| 函数                              | 说明                                |
| ------------------------------- | --------------------------------- |
| `defaultLayout()`               | 默认布局 = 所有 `def:true` 的模块          |
| `moduleOf(id)`                  | 取模块元信息（用于编辑态显示名字）                 |
| `normalize(list)`               | 去重 + 过滤非法 id + 空值兜底为默认（首页永不空白）    |
| `layout()` / `saveLayout(list)` | 读写（写后返回归一结果）                      |
| `stashed()`                     | 收纳区 = 全部模块 − 当前布局（只存一份状态，不会两边对不上） |
| `stash(id)` / `restore(id)`     | 移出首页 / 加回末尾                       |
| `move(from, to)`                | 拖拽换位（越界自动夹取，同位置幂等）                |
| `dropIndex(from, dy, heights)`  | 拖拽落点纯函数（不碰 DOM，可单测）               |

### 页面结构

```
pages/home/home.vue
├─ float-navbar（搜索 / AI 指令 双模式胶囊）
└─ .page-slide
   ├─ .cmd-bar（指令状态条：加载 / 结果 / 错误 / 撤销）
   ├─ .cmd-sug（指令态聚焦时的示例胶囊）
   ├─ 搜索结果卡（编辑态隐藏）
   └─ .mod-list                      ← v-for="(c,i) in renderCards" :key="c.id"
      └─ .mod-wrap  :style="wrapStyle(i)"
         ├─ .mod-bar（仅 editing）
         │   ├─ .mod-grip   @touchstart.stop.prevent="dragStart(i,$event)"
         │   ├─ .mod-name   {{ nameOf(c.id) }}
         │   └─ .mod-hide   @tap="stashModule(c.id)"
         ├─ app-card-blocks（AI 造的卡：c.builtin === false）
         └─ 内置模块（v-else-if 链：book / action / stats / goal / chart / progress / favorites / streak）
   └─ .home-foot（编辑态：＋添加组件 / 完成；否则：编辑首页）
（page-slide 之外）收纳区弹层 .sheet-mask
```

可选小组件放在 `components/home-widgets/`（含 `widget-worddrill` 刷单词、`widget-chat` 对话陪练）：

- `widget-progress.vue` 掌握度概览（已学 / 已掌握 / 全书 + 进度条）
- `widget-favorites.vue` 收藏速览（最近 5 条，点击朗读）
- `widget-streak.vue` 打卡周历（近 7 天圆点 + 当前连续）
- `widget-chart.vue` 打卡走势（股票式折线图，红涨绿跌，可切 7/30 天）
- `widget-goal.vue` 每日目标（今日新词 / **学会**进度）

**卡片跳转的两条纪律**（踩过坑，改卡片时照着做）：

1. **整卡可点**，右上角那颗小字只是顺带保留 —— 只挂一颗 22rpx 的「去词库 ›」，
   用户根本找不到（反馈原话："主页的卡片点不进"）。根上那次是因为 `goLibrary()`
   走的是 `switchTab('/pages/library/library')`：**只切到词库 tab 就停住了**，
   进词库详情要用 `navigateTo('/pkgManage/pages/library-detail/library-detail?tab=vocab|goal')`。
   右上角那颗记得加 `@tap.stop`，否则一次点击跳两回。
2. **tab 页常驻 → 必须订阅 `uni.$on('home:refresh', this.refresh)` 并在 `beforeDestroy` 里 `$off`**。
   `widget-progress` 以前没订阅，刷完一组回首页，"已学 / 已掌握"还是上一轮的数。
   编辑首页时 `.mod-shield` 屏蔽层会挡住点击，所以整卡可点不会和拖拽打架。
3. **右上角那颗如果是"另一件事"，要跟整卡点击明确分开**。当前词书卡是典型：
   整卡点击 → `library-detail?tab=batch`（看这本背到哪了），
   而「换词书 ›」→ `book-switch`（换一本）—— **一个看、一个换**，别让它们落到同一页。
   那颗做成 10/16rpx 的轻量胶囊并配自己的 `:active`（裸文字热区只有 22rpx 高，很难点），
   免得用户把它当成整卡行为的一部分。首页四张卡的落点：

   | 卡 | 整卡点击 | 右上角那颗 |
   | -- | -- | -- |
   | 当前词书（`home.vue` 内联 `book` 模块） | `library-detail?tab=batch` | `book-switch`（换词书） |
   | 掌握度概览（`widget-progress`） | `library-detail?tab=vocab` | 同左（去词库） |
   | 每日目标（`widget-goal`） | `library-detail?tab=goal` | 同左（「设置 ›」） |

### 打卡走势（股票式折线图）

`utils/checkin.js` 把每天的练习量折算成一条「学习指数」曲线，读法与股票分时图一致：

- 基点 `BASE = 100`；当天背了 → `+min(当天题量, GAIN_CAP)`；没背 → `-DECAY`
- 红涨绿跌（A 股习惯）。深色档由 `App.vue` 的 `--ck-up` / `--ck-down` 下发
- 虚线 = 基准线（区间首日指数），线在上方即"跑赢基准"
- 一条练习记录都没有 → 显示空态引导，而不是画一条一路向下的直线

**画法**：容器用 `padding-bottom` 锁死高宽比（= `checkin.RATIO`），所以每段折线的  
「长度% + 旋转角」可以在渲染前算准（`segments()` 做 `atan2`），不需要等 DOM 测量。  
不做 Canvas / SVG —— uni-app 各端对它们的支持不一致，且原生组件会脱离 CSS transform  
（首页切 tab 时内容是要整体滑动的）。

### 词书每日目标

目标**按词书维度**存（`state.books[bookId].goal`），切书互不干扰。  
入口：词库 → 词库详情 →「每日目标」；首页「每日目标」组件**整卡可点**直达。

| 字段         | 默认 | 范围    | 含义                                           |
| ---------- | -- | ----- | -------------------------------------------- |
| `newWords` | 20 | 5-300 | 每天要新认识多少个词（当天首次接触即计入，靠 mastery 记录里的 `fs` 字段） |
| `practice` | 10 | 5-300 | 每天要**学会**多少道题（`days[今天].mastered`，见下）      |

`practice` 同时决定**每组练习的出题量**（`practice.vue` 的 `sessionSize()`），  
所以"设置 15 题"既是目标也是每次练习的长度。

> **口径改过**：以前数的是 `days[今天].correct`（答对就 +1），
> 现在数 `days[今天].mastered` —— **只有确认通过的才 +1**（一遍蒙对、确认没认出来的都不算），
> 反悔点「记错了」会 −1。`total` / `correct` 保持"做了多少 / 答对多少"的原口径不动，
> 正确率、连续天数、历史曲线仍读它们 —— 两个口径彻底分家，别再混用。
> 详见「三之二、不背单词机制与双进度条」。

### AI 指令输入框（首页搜索框升级）

首页顶栏那颗胶囊既是查词框，也是「用一句话改首页」的指令框。  
详细设计见 `docs/page-command-design.md`，这里只记实现要点。

**四层结构（每层都不能被跳过）**

```
用户一句话
  → utils/intent.js        判定「搜索」还是「指令」
  → services/page-agent.js 自然语言 → JSON 信封 { say, commands[] }
  → utils/page-schema.js   op 白名单 + 参数校验（数值夹取、字符串截断、URL/颜色正则）
  → utils/page-command.js  不可变执行 → 新 pageDoc → Vue 渲染
```

**安全边界**：AI 只能改 `pageDoc`（`utils/page-doc.js` 描述的那份数据），  
页面是这份数据的纯函数渲染结果。链路里没有 `eval` / `new Function` /  
`innerHTML` / DOM 操作（回归脚本 `check-page-command.js` 第 10 组逐条扫描红线）。

**三个"让人放心"的机制**

| 机制    | 实现                                                        |
| ----- | --------------------------------------------------------- |
| 失败回退  | `apply()` 一律返回新对象；任一条指令失败就返回**原 doc**，页面一个字节都不变           |
| 上一步撤销 | `pageCommand.commit()` 前先入历史栈（上限 20），`undo()` 整体换回上一个 doc |
| 直接执行  | 用户选定"直接执行 + 可撤销"，所以跳过二次确认，把撤销按钮放在结果条上                     |

**判错的代价是不对称的**，所以意图识别按"宁可漏、不可错"设计：  
把"想改首页"判成查词，只是白搜一次；把"想查词"判成指令，会真的去改首页。

| 兜底手段        | 怎么用                                                    |
| ----------- | ------------------------------------------------------ |
| 顶栏模式键       | 输入框右侧常驻一颗「搜 / AI」键，键上写着什么，回车就走哪条路（所见即所得）              |
| 点过即锁定       | 手动切换后进入锁定态（键右上角一个小点），打字不再自动改判；**清空输入才解锁**             |
| 显式前缀        | `/` `:` `@` 强制指令，`#` 强制搜索 —— 优先级高于自动判定**和**手动锁定        |
| 艾特 AI       | `@AI 把背景换成蓝色`：开头的 `AI` 二字会被剥掉，只留正文当指令                 |
| 指令失败 → 改成查词 | 结果条上直接给「当成查词」，按原文重跑搜索，不用重新输入                           |
| 搜不到 → 改成指令  | 搜索空结果里给「当成指令试试」，一键按指令重跑                                |

接线：`float-navbar` 新增 `switchable` / `locked` 两个 prop 与 `mode-toggle` 事件，
只发事件、切到哪个模式由首页决定（它才知道当前输入该怎么判）。
`intent.detect()` 多返回一个 `forced` 字段，首页用它判断"前缀能不能盖过锁定"。

**19 条指令**（`schema.COMMAND_OPS`）：

- 结构 `card.add / remove / move / hide / show / restore / reset`
- 文案 `text.set / text.rewrite`，配图 `image.set`
- 样式 `style.card / style.text`
- 主题 `theme.set`（配色 / 深色 / 字体 / 动效 / 密度）
- 背景 `bg.set`（预设 / 图片 / 渐变 / 蒙版 / 模糊 / 心情）
- 学习 `goal.set`（当前词书每日目标）
- 快照 `skin.save / skin.apply`
- 场景 `macro.run`（exam / commute / bedtime / focus）
- 语音 `page.announce`

**AI 造的卡**由 13 种块拼出来（`utils/page-schema.js` 的 `BLOCK_SCHEMA`）：  
title / text / stat / kv / list / checklist / progress / countdown / quote /  
tags / image / divider / button。渲染器是 `components/app-card-blocks.vue`。  
块可以绑 `live`（今日题量 / 连续天数 / 今日新词…），显示的是真实数据而不是模型编的数字。

**背景图**：`services/image-gen.js` 先探测服务商是否提供 `/images/generations`  
（OpenAI 支持；DeepSeek / Kimi / 通义不支持；"自定义"需在设置里勾选「地址支持出图」）。  
支持就真出图并落到本地；不支持或失败 → `pageAgent` 让模型给出两个颜色，本地渲染渐变。

### 三个数据项跳转

| 数据项   | 目标页                             | 数据源                                          |
| ----- | ------------------------------- | -------------------------------------------- |
| 已练(题) | `pages/history/history`         | `engine.history()` + 登录后 `study_records` 明细  |
| 待复习   | `pages/review-list/review-list` | `engine.wrongList()`（答对自动移出）                 |
| 连续(天) | `pages/streak/streak`           | `engine.streak()` / `engine.longestStreak()` |

三个详情页都是 `navigationStyle: custom` + `float-navbar`，左侧返回按钮，可正常回首页。

### 拖拽实现要点

- 手柄 `@touchstart.stop.prevent`：阻止冒泡到页面根（避免和 tab 横滑手势打架）+ 阻止默认滚动
- 按下时用 `uni.createSelectorQuery().in(this).selectAll('.mod-wrap')` 量出各模块高度
- `touchmove` 只更新 `dragDy`（不加 transition，纯跟手）；`touchend` 才用 `dropIndex()` 算落点并 `move()` 落库
- 落点阈值 = 累计跨越高度 − 自身半高 + 目标半高（等高时即 `(h[a]+h[b])/2`）
- 位移只作用在 `.mod-wrap` 上，**不碰页面根节点**（根节点被 transform 会让内部 `fixed` 参照失效）
- 收纳区弹层放在 `.page-slide` 之外，避开滑动动画期间的 `fixed` 参照问题

### 相关文件

```
uniapp/utils/home-layout.ts                  ← 模块注册表 + 布局持久化 + dropIndex
uniapp/components/home-widgets/widget-progress.vue
uniapp/components/home-widgets/widget-favorites.vue
uniapp/components/home-widgets/widget-streak.vue
uniapp/pages/history/history.vue             ← 练习历史
uniapp/pages/review-list/review-list.vue     ← 待复习列表
uniapp/pages/streak/streak.vue               ← 连续打卡详情
uniapp/pages/home/home.vue                   ← 布局驱动 + 编辑态 + 拖拽
```

校验：

```bash
node --experimental-strip-types _tools/check-home.js
```

## 五之四、数据备份与换机迁移（`utils/backup.js` + `utils/backup-io.js`）

这是个**纯本地**应用：数据全在本机 storage，没有服务器、没有账号同步。
好处是"数据只属于你"，代价是**换手机就全没了** —— 之前没有任何补救办法。
所以设置 → **数据与账号**里加了一键导出 / 导入，把这条路径补上。

### 加密：防什么、不防什么

备份里含 AI 配置（地址 + 密钥）。密钥明文躺在导出文件里是不能接受的 ——
这个文件会被发到微信、存进网盘、留在下载目录。所以 **payload 整体是密文**，
信封里只有 `meta`（词数 / 错题数这类统计）是明文，方便导入前先确认这份备份对不对。

| 档位 | 密钥来源 | 迭代 | 防什么 |
|---|---|---|---|
| `standard`（默认，一键） | App 内置口令 | 10 000 | **防明文泄露，不防逆向**：文本编辑器打开只看到 base64，看不到 `sk-xxx`；反编译拿到内置口令就能解开 —— 这是有意的取舍，换手机时用户最需要的是"别让我再输一遍密码" |
| `password`（可选） | 用户自设密码 | 120 000 | 真机密性，代价是**忘了密码这份备份就废了**（没有任何找回途径，因为压根没有服务器） |

原语全部零依赖，复用项目里已有的实现：

- `sha256` / `hmacSha256` / `utf8Bytes` ← `utils/hash.ts`
- `randomBytes` ← `utils/random.ts`
- PBKDF2-HMAC-SHA256 与 HMAC 密钥流在 `backup.js` 里现搭（各十来行），**没有引入任何三方库**

构造：PBKDF2 派生 → 拆成 **enc / mac 两把子密钥**（不能拿同一把既加密又算 MAC）→
HMAC-SHA256 当 PRF 生成密钥流（counter mode）→ XOR → 密文 MAC。
每次导出都新生成 salt 与 nonce，所以 (key, nonce) 不会重复。
**先验 MAC 再解密**，被篡改的文件在这一步就被挡下。

### 传到另一台手机：调系统分享就够了

导出后转 `content://`（FileProvider）再发 `Intent.ACTION_SEND`：

```js
// 私有目录的 file:// 直接给别人，Android 7+ 会抛 FileUriExposedException
uri = FileProvider.getUriForFile(main, pkg + '.dc.fileprovider', file);
intent.setType(type); intent.putExtra(Intent.EXTRA_STREAM, uri);
intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
main.startActivity(Intent.createChooser(intent, '导出备份'));
```

Android 的**系统分享面板里自带**附近分享 / Quick Share，以及小米互传、华为分享、
OPPO / vivo 互传（四家已互通，走 Wi-Fi 直连，60~140 MB/s）。
也就是说**手机对手机无线直传不用自己实现** —— 调起系统分享就等于支持了。

> 已经查证过两条"看起来更酷"的路，都走不通：
> **Wi-Fi Direct** 在 uni-app 里做不了（Vue / H5 运行时层访问不到 `WifiP2pManager`，
> 没有成熟合规插件，iOS 更不开放）；**有线 OTG 手机连手机**在 Android 上不可靠。
> 而系统分享面板已经把这件事做得更好。

三端降级：`writeBackup` / `scanBackups` / `shareFile` 全部有失败路径 ——
写不出文件退回**复制备份内容**到剪贴板；H5 走 Blob 下载 + `<input type="file">`；
小程序没有通用文件 API，导出导入都走剪贴板（提示里会写清楚可能被截断）。

### 导入：先看你导的是什么，再问要不要覆盖

拿到一个文件就覆盖掉全部数据是很吓人的事，所以顺序是：

1. `peek(text)` —— 只读信封里的明文 `meta`，**不解密**：几个词的掌握度 / 几条错题 /
   几本自建词书 / 几天学习记录（含起止日期）/ 有没有 AI 配置 / 有没有对话记录
2. 弹二次确认：摘要 + 「导入会覆盖本机现有的全部学习数据与设置，不可撤销」，
   按钮写**「覆盖导入」**而不是「确定」
3. 确认后才 `decode` → `restore`。密码档的备份会先问密码（`input` 模式 + 掩码），
   密码错会**再给一次机会**，不会把人踢回第一步

`decode` 抛的是英文代号（`NEED_PASSWORD` / `BAD_PASSWORD` / `TAMPERED` /
`NEWER_VERSION` / `NOT_BACKUP` / `EMPTY` / `BROKEN`），由 `importErrText()` 翻成人话 ——
内部代号只进 console，不直接给用户看。

### 搬什么、不搬什么

```js
STORAGE_KEYS = {
  study:    'fj_eng_state_v1',   // 掌握度 / 错题 / 打卡 / 自建词书
  settings: 'fj_app_settings_v1',// 外观 / 语音 / AI 配置 / 收藏 / 首页布局
  chat:     'fj_chat_v1',
  usage:    'fj_usage_v1',
  apiUsage: 'fj_api_usage_v1'
}
```

AI 缓存 `fj_ai_cache_v1` **刻意不搬**：它有 7 天 TTL，本来就会过期，搬过去只是把文件撑大。

### 页面接线（设置页）

- 位置：「数据与账号」分组里，**「本地存储学习数据」之后、「清除学习数据」之前** ——
  想备份的人不该先看见一排红色
- 收起时分组右侧显示 `backupHint`：`未备份` / `上次备份 10-10`（存档在 `settings.backup.lastAt`）
- `backupBusy` 期间在行上显示进度文案（`正在打包…` / `正在查找备份…`），避免"点了没反应"
- 导出完成弹 **alert 模式**弹窗：文件名 + 是"已调起分享"还是"已存到手机（绝对路径）"

**相关文件**：`utils/backup.js`（收集 / 加密 / 信封 / 恢复）、`utils/backup-io.js`（跨端文件 IO）、
`pkgManage/pages/settings/settings.vue`、`utils/settings.js`（`backup.lastAt`）、
`components/app-dialog/app-dialog.vue`（新增 `password` 掩码输入与 `btn-mode="alert"`）
**校验**：`_tools/check-backup.js`（12 组：收集范围 / 信封 / 往返 / 密码档 / 拒绝形态 /
peek / 落盘 / 文件名 / 跨端契约 / 页面接线 / **页面运行时真跑方法** / backupHint 必须是 computed）

> 第 11 组"真跑方法"是最后一道防线：前 10 组只看源码字符串，会"假绿" ——
> 方法名写了但弹窗没弹出来、覆盖确认没走、密码错了却直接覆盖，读代码全都发现不了。
> 所以第 11 组把 `settings.vue` 的 `<script>` 真正 `loadCode` 起来，注入假 IO，
> 一路跑完 `askExport → onExportMenu → onConfirmYes → previewImport → doImport`，
> 断言弹窗形态、按钮文案、storage 落盘、错密码后再弹输入框、被篡改时"挡下即止不写半份数据"。

## 六、与原小程序的差异

- API 层由 `wx.*` 换成 `uni.*`，行为一致
- 模块从 CommonJS 改为 ESM（import/export）
- 页面从 WXML/WXSS 四件套改为 Vue 单文件组件，样式原样保留（rpx 通用）
- 数据不互通：App 与原小程序各自独立存储学习记录
