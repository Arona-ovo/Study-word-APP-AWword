# _vocab — 内置词书语料的生成工程

这个目录**不属于 App 运行时**（不在 `uniapp/` 里，不会被打包进小程序/App），
它的作用是从开源词表加工出 App 内置词书的数据文件，产物写到：

```
uniapp/data/lexicon-data.js   共享词条表（word|pos|释义），一行一条
uniapp/data/bookdata.js       每本词书的词条索引（定长 base36）
uniapp/data/extra-words.js    查词补充词表（同上格式，**不属于任何词书**）
uniapp/data/build-info.js     语料规模快照（设置页彩蛋用）
```

##### extra-words.js：没被任何词书挑中的那批词

源词表一共 7022 个候选，但每本词书都有 `size` 上限、还剔了初中词（`exclude`），
真正被某本词书引用的只有 3893 个 —— 剩下那批（见下，含 everyday.txt）同样是带中文释义的词，
以前在 App 里**彻底搜不到**（用户实测反馈"本地查词完全搜不到"）。

为什么不直接塞进 `lexicon-data.js`：共享表的**行号就是用户的学习进度索引**
（`id = 行号 + LEX_START`，掌握度按 id 存在本机），往中间插一行会让老用户已背记录全部错位。
所以独立成文件，只给 `utils/dict.js` 当最后一层查词兜底，**绝不产生新的词书 id**。


##### everyday.txt：日常短词 / 口语 / 缩略语

`STOP` 表会把 hi / oh / vs / nor / net 这类"功能词"剔掉 —— **对词书而言完全正确**：
没有人需要把 "hi" 做成一张卡片去背。可词典是另一回事，
用户实测反馈里"随手敲一个短词什么都查不到"，一半原因就是这批词在本地词典里压根不存在
（它们既不在考试词表、也不在常用词表里）。

所以这里手写校了一张 `src/everyday.txt`，行格式与其余源表一致（`单词\t词性 释义`），
但**不走主合并链**（那样会被 `STOP` 整批剔掉），而是单独读、单独喂给 `extra-words.js`：
**进词典、不进任何词书** —— 既不占共享表行号，也不给谁多塞一张要背的卡片。

写这一页的两条规矩：

- 释义必须是**两个汉字以上**：`buildEntry` 把单个汉字当成"被切碎的残渣"整条丢弃，
  `oh int. 哦` 这种写法看着没问题，生成出来是一条都不会收的；
- 已经在 `data/common-words.js` 或共享表里的（hello / please / thanks / mr / am …）不必再写，
  生成时会自动去重（`[extra] 日常短词 … 补 N 条` 的 N 小于候选数是正常的，看 `N / 候选` 即可）。
读取/解码/缓存写在 `uniapp/data/lexicon.js`（手写），分批与词书注册在 `uniapp/data/wordbooks.js`（手写）。
**重新生成只会覆盖上面两个 `*_data / bookdata` 文件，不会动任何手写代码。**

## 重新生成

```bash
node build.js
```

会打印每本词书的候选量、实收量、产物体积，以及抽查样本。
改完记得跑一遍：`_tools/check-builtin-books.js`、`check-batches.js`、`check-bundle-size.js`。

### ⚠️ 重生成后必须做的行序校验

**`lexicon-data.js` 的行号就是用户的学习进度索引** —— `bookdata.js` 里每本书存的只是行号，
掌握度也是按 id（= `LEX_START` + 行号）存在本机上的。行序一旦位移，老用户已背的记录全部错位且不报错。

所以每次重生成，比对一下新旧 `lexicon-data.js`（`LEX_RAW` 里每行形如 `word|pos|释义`）：

```bash
cp uniapp/data/lexicon-data.js /tmp/old.js
node build.js
node -e "
const fs=require('fs');
const p=f=>{const m=fs.readFileSync(f,'utf8').match(/const LEX_RAW\s*=\s*\`([\s\S]*?)\`/);
  return m[1].split('\n').filter(l=>l.trim()).map(l=>l.split('|'))};
const a=p('/tmp/old.js'), b=p('uniapp/data/lexicon-data.js');
console.log('行数', a.length, '→', b.length);
let w=0,pos=0; for(let i=0;i<Math.min(a.length,b.length);i++){
  if(a[i][0]!==b[i][0])w++; if(a[i][1]!==b[i][1])pos++; }
console.log('word 列位移', w, '/ pos 列位移', pos, '（都必须是 0）');
"
```

`word` 与 `pos` 两列必须零差异；只有第 3 列（释义文本）允许变化。
`bookdata.js` 在行序不变的前提下应该字节级一致（可用 `diff` 快速确认）。

**哪些改动会动到行序**（改之前要有心理准备，意味着要接受老用户重置进度）：
改 `BOOKS` 里的 `size`/`union`/`exclude`、改 `score()` 的权重、动 `STOP` / `SENSITIVE`、
换 `src/` 语料。反之，只放宽 `MAX_MEAN`（释义长度）是安全的 —— 前提是
`clipMean()` 还在：它截的是「不超过上限的最长合法前缀」，保证原来留下来的行一定还留得下来。
**千万别把它改回 `raw.slice(0, MAX_MEAN)` 那种生切** —— 生切会让某些行因为切出来的片段
含非法字符而被整条丢弃，后面所有行一起位移。

## 数据来源

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `src/junior.txt` | 初中 / 中考词条 + 中文释义 | KyleBing/english-vocabulary |
| `src/senior.txt` | 高中 / 高考词条 + 中文释义 | 同上 |
| `src/cet4.txt` | 四级词条 + 中文释义 | 同上 |
| `src/cet6.txt` | 六级词条 + 中文释义 | 同上 |
| `src/kaoyan.txt` | 考研词条 + 中文释义 | 同上 |
| `src/freq-web-20k.txt` | 词频排名（网页语料） | first20hours/google-10000-english |
| `src/freq-subtitle-50k.txt` | 词频排名（影视字幕语料） | hermitdave/FrequencyWords |

两份词频表合起来能覆盖候选词条的 97%，用于**排序**（高频先学）；
**收不收录只看该词在不在对应考试词表里** —— 词频表有领域偏向（网页语料里 http/html 排名很高），
拿它决定收录会把噪声带进词书。

## 加工规则（`build.js` 里的关键取舍）

1. **释义只存一份。** 多本词书重合词条很多，共享表 + 每本书存「词条序号」，
   比每本各存一份全量词条省一半以上体积。
2. **功能词不收。** 冠词/代词/be/助动词/纯结构介词等约 230 个词在 `STOP` 里，
   否则第一组会变成 "the / of / and"。这些词的释义在 `data/common-words.js` 里仍然查得到。
3. **义项宽进严出。** 源表里一个词条有多个来源的多条释义，逐条过滤：
   没中文的丢、含拉丁字母/半角括号的丢（音译人名最多）、括号不成对的丢、互相包含的只留一条；
   最后按 `MAX_MEAN`（16 字）限长合并。宁可义项少一点，也不要出现「(Have)人名；芬)哈韦」这种脏内容。
4. **剥词性标记时补分隔符。** 源表有 `adv. 到处，周围 prep. 关于` 这种写法，
   直接剥掉标记会粘成 `到处，周围关于` —— 这是脏数据最大的来源。
5. **`lv` 和 `id` 都不落文件。** 行已按词频排好序，`lv` 按行号四等分算出来即可；
   `id = 行号 + 10001`，省掉每行一个数字。

## 注意

- **词条序号变了 = 用户的学习记录错位。** 掌握度是按词 id 记在用户本地的，
  一旦增删词条导致行号整体位移，老用户已学记录会挂到别的词上。
  要调整内容时，尽量只做「往后追加」，不要重排。
- 产物体积受 `_tools/check-bundle-size.js` 盯着（微信小程序主包 2MB 的余量换算出的预算）。
  调大 `MAX_MEAN` 或词书 `size` 之前，先跑一遍那个脚本确认还有余量。
