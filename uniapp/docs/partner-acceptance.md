# AWword ↔ PWstudy 联动：第 7 节验收清单（AWword 侧）

> 对接文档（需求侧）：`PWstudy/uniapp/docs/partner-handoff-awword.md`
> 实现：`utils/partner.js` / `utils/link.js` / `pages/home/home.vue` /
> `pkgManage/pages/settings/settings.vue` / `pkgStudy/pages/practice/practice.vue`
> 自动校验：`node _tools/check-partner.js`（含三段真跑）+ `node _tools/check-link.js`

**状态图例**
- ✅ 自动 —— 已有断言，跑 `bash _tools/_run-all.bash` 能复现（`check-partner.js` 第 9/10/11/12 组）
- 🖐 真机 —— 依赖两个 APK 同时安装，只能人点（下面给出每一步的判据）

---

## 一、AWword 侧清单（文档第 7 节）

| # | 验收项 | 状态 | 怎么验 |
|---|---|---|---|
| 1 | 只装 AWword 不装 PWstudy：一切正常，联动完全不可见 | ✅ | `未检测到 PWstudy` + 无弹窗 + 「伙伴 App」收起态写「未检测到」；`check-partner` 第 12 组前半 |
| 2 | 装上 PWstudy 后首次打开 AWword：弹三选一 | ✅ | 假页栈 + 假安装桩，跑通 `maybePartnerAsk()` → `partnerAsk.show = true` |
| 3 | 延迟 1.2 秒，不是进首页就糊 | ✅ | 断言 `delays == 1200`（把 `setTimeout` 换成同步执行后仍能读出这个毫秒数） |
| 4 | 选项 0「打通（推荐）」→ `linked` | ✅ | `onPartnerAsk(0)` 后 `partner.state().state === 'linked'` |
| 5 | 选项 1「以后再说」→ 不改意愿，但计数 +1 | ✅ | 状态仍 `undecided`，`askedCount` 累加（第 3 次后置 `declined` 级别的闭嘴） |
| 6 | 选项 2「不用了，我就专心背」→ 永不再自动弹 | ✅ | 落到 `declined`；把 `askedCount` 清零也不再问 |
| 7 | 已有弹窗 / 新手引导 / 收纳抽屉时不抢 | ✅ | 三组让路断言 |
| 8 | **练习中不弹窗** | ✅ | 页栈顶是练习页 → 不弹、也不消耗次数 |
| 9 | 设置页四态显示正确 | 🖐 | 「伙伴 App」分组逐个对照：未检测到 / 未设置 / 已关联 / 已关闭 |
| 10 | 取消关联：二次确认 + 数据保留 | ✅ | 确认框 `action='unlink'`，确认后 store 数据一字未动 + 文案明说"原样保留" |
| 11 | 取消后「重新关联」：能回来且看得到上次同步 | ✅ | `doLink()` → 立刻 `linked`；状态行「今天 N 分钟 · M 词 · X 分钟前同步」 |
| 12 | 从 PWstudy 跳过来：顶部出现来路横幅 | 🖐 | adb 起链接：`adb shell am start -a android.intent.action.VIEW -d "awword://study?minutes=25&v=1&linked=1&task=t1&back=pwstudy%3A%2F%2Fvocab-done%3Ftask%3Dt1"` |
| 13 | `linked=1`：学完自动回跳并带回 `min` / `words` | ✅ + 🖐 | 字段级：`finish(7)` 生成的 URL 含 `min=`、`words=7`、`task=`；真机看 PWstudy 弹的那条 Toast |
| 14 | `linked=0`：不自动跳，但「回去」按钮能用 | ✅ + 🖐 | `onUnload` 分支断言（linked=1 → `finish()`；linked=0 → `clearCtx()`）；真机看横幅降级 + 按钮仍在 |

### 端到端（需两个 APK）

| 验收项 | 判据 |
|---|---|
| 跳过去学完回来：PWstudy 统计页出现「背单词 N 分 · M 词」 | PWstudy 那边 toast：「背单词 N 分钟 · M 词，已记入今日」 |
| 回到 PWstudy 设置页：能看到「上次同步 X 分钟前」 | 取决于 PWstudy 侧自己的 `lastSyncAt`（它收到回传时记账，与我们无关） |
| 我们这边「上次同步」同时更新 | `finish()` 里调了 `partner.noteSync(min, words)` ✅ |

---

## 二、必须 6 条的落点

| 条 | 落地 | 文件 |
|---|---|---|
| 11.1 包名 | `"packageName": "com.AWword"`（**已核**：从 `unpackage/debug/android_debug.apk` 的 `AndroidManifest.xml` 里读出来的就是这个） | `manifest.json` |
| 11.2 包可见性 | `<queries>` 里加 `<package android:name="com.pwstudy.app" />` | `uniapp/AndroidManifest.xml` |
| 11.3 协议字段 | 认 `minutes/task/back/linked/v`，多出来的字段一律忽略 | `utils/link.js` |
| 11.6 对称询问 | 本地意愿状态机 + 首页三选一 | `utils/partner.js`、`pages/home/home.vue` |
| 11.7 对称入口 | 「伙伴 App」分组，四态四动作 | `pkgManage/pages/settings/settings.vue` |
| 11.8 `linked=0` | 横幅降级 + 手动「回去」 | `pkgStudy/pages/practice/practice.vue` |

**增强两条（本次未做）**：11.4 回跳补 `due/streak/todayWords/book`、11.5 反向入口 `awword://sync`。
要做的话建议先做 `due`（对 PWstudy 的「今日紧迫度」是唯一有额外价值的数据点）。

---

## 三、真机自测最短路径

```bash
# 1) 未装 PWstudy
adb shell pm uninstall com.pwstudy.app 2>/dev/null
#    → 打开 AWword：「伙伴 App」= 未检测到；首页不弹任何东西

# 2) 装上 PWstudy 后冷启动 AWword
#    → 1.2 秒后弹三选一；选「不用了」→ 再开几次都不再弹；设置页显示「已关闭」

# 3) 设置页点「重新关联」→ 「已关联」+ 状态行
#    → 点「去 PWstudy」应当真的切过去（靠包名 launchApplication，其次 pwstudy://）

# 4) linked=1
adb shell am start -a android.intent.action.VIEW \
  -d 'awword://study?minutes=25&v=1&linked=1&task=t1&back=pwstudy%3A%2F%2Fvocab-done%3Ftask%3Dt1'
#    → 顶部横幅「来自 PWstudy 的学习任务」；退出练习页自动带回 min/words

# 5) linked=0
adb shell am start -a android.intent.action.VIEW \
  -d 'awword://study?minutes=25&linked=0&task=t2&back=pwstudy%3A%2F%2Fvocab-done%3Ftask%3Dt2'
#    → 横幅降级（淡底 + 「回去」）；退出练习页**不自动跳**，点「回去」才跳
```

> ⚠️ 这些改动里有两类**只有云打包/自定义基座才生效**：manifest 的 `packageName` 与
> `AndroidManifest.xml` 的 `<queries>`。标准基座真机跑，检测安装一律走默认行为。
