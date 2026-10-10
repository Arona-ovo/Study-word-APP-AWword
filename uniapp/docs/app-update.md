# App 自动覆盖更新方案（Android / uni-app）

面向本项目现状：HBuilderX 云打包 Android APK、无服务器、AppID 尚未获取、
`manifest.json` 当前 `versionName=1.1 Beta / versionCode=111`（与 `data/build-info.js` 的
`BUILD_INFO.version` 同步维护，`versionCode` 只涨不跌）、
`app-plus.distribute.android.permissions` 只有 `INTERNET`。

---

## 一、结论速览

推荐 **「wgt 热更新 + APK 整包更新」双通道**，服务端用 **一个静态 JSON + 对象存储**：

| | wgt 热更新 | APK 整包更新 |
|---|---|---|
| 能否自动覆盖旧版 | ✅ 安装后自动重启即生效 | ✅ 覆盖安装（装完询问是否打开） |
| 用户感知 | 几乎无感（几百 KB，秒级） | 有系统安装界面 |
| 能改什么 | JS / 页面 / 样式 / 图片 / 本地数据逻辑 | 一切（原生模块、权限、图标、启动图） |
| 不能改什么 | 原生模块、权限、图标、启动图、manifest 的 appid | —— |
| 需要用户授权 | 不需要 | Android 8+ 需「允许安装未知来源应用」 |
| 适用 | 日常改 bug、改界面、加功能（纯前端） | 加了原生能力（如 SQLite 模块、新权限） |

**日常迭代走 wgt，碰了原生配置才发 APK。** 两者共用一个版本接口，客户端按优先级判断。

如果不想自己写服务端：直接用 DCloud 官方的 **uni-upgrade-center**（uniCloud 版），
带管理后台，能同时管 wgt 与 APK，接入量最小。代价是绑定 uniCloud。

---

## 二、覆盖安装成立的三个硬条件（最重要，先看这个）

Android 判定「能覆盖安装」只看三件事，**任意一条不满足就装不上**：

1. **包名一致** —— 包名由 `manifest.json` 的 `appid` 决定（HBuilderX 获取 AppID 后固定）。
   一旦改 appid，就是另一个应用，只能并存或先卸载。
2. **`versionCode` 严格递增** —— 新包的 versionCode 必须 **大于** 已装包的。
   `versionName`（1.1.0 这种）只是给人看的，系统不看。
3. **签名一致** —— 新 APK 与已装 APK 必须用**同一把 keystore** 签名。
   不一致会直接弹「安装包签名不一致 / 安装失败」。

### ⚠️ 本项目当前的最大隐患：DCloud 公用测试证书

现在打的是 **DCloud 公用测试证书**，它是所有开发者共享的同一把测试证书，用途仅限调试：

- 不能上架任何应用商店；
- 任意第三方用同一把证书 + 同包名打的包，**可以覆盖掉你的 App**（安全性为零）；
- 一旦你后续换成自有证书，签名就变了，**老用户全部无法覆盖安装，只能卸载重装（本地学习数据会丢）**。

**建议：在发布第一个对外版本之前，先生成自有正式证书并在云打包里固定使用它，之后再也不换。**

生成（JDK 自带 keytool，一次生成、长期保存，丢失即无法再更新）：

```bash
keytool -genkey -alias beiwanci -keyalg RSA -keysize 2048 \
        -validity 36500 -keystore beiwanci.keystore
```

- `validity` 建议 25 年以上（Google Play 要求 2033 年后仍有效）；
- 把 `.keystore` 文件与密码**离线备份**（U 盘/密码管理器），丢了就等于 App 锁死；
- HBuilderX：「发行 → 原生App云打包 → 使用自有证书」，填别名与两个密码。

---

## 三、整体流程

```
App 启动（可延迟 3 秒，避免拖慢首屏）
        │
        ├─ 读本地版本：plus.runtime.version / versionCode / plus.runtime.getProperty
        │
        ├─ GET 版本清单 JSON { apk:{...}, wgt:{...} }
        │
        ├─ 失败/超时 → 静默放弃，不影响使用（最多重试 1 次）
        │
        └─ 拿到清单 → 比较 versionCode
              │
              ├─ 本地 >= minVersionCode？ → 无需更新
              │
              ├─ 存在 wgt 且 wgtVersion > 本地 wgtVersion
              │     且本地 apk versionCode >= 清单 apk.minVersionCode
              │           → 下载 wgt（后台）→ plus.runtime.install → restart
              │
              └─ 本地 versionCode < 清单 apk.versionCode
                    → 弹更新对话框（含更新说明、是否强制）
                          ├─ 强制：只能「立即更新」，取消则退出 App
                          └─ 非强制：可「稍后」，下次启动再提醒（一天一次）
                                → 下载 APK（带进度）
                                → 有安装权限？→ plus.runtime.install
                                → 无权限？→ 引导去设置开启「允许安装未知来源」
```

---

## 四、服务端：一个 JSON + 一个文件托管

### 4.1 版本清单 `update.json`

```json
{
  "apk": {
    "versionCode": 102,
    "versionName": "1.2.0",
    "url": "https://cdn.example.com/beiwanci/app-v1.2.0.apk",
    "size": 18765432,
    "md5": "8f3c...（可选，下载后校验）",
    "minVersionCode": 100,
    "force": false,
    "notes": ["新增首页自定义小组件", "修复中文朗读断续问题", "AI 生成词书支持不限数量"]
  },
  "wgt": {
    "version": "1.2.0",
    "minApkVersionCode": 102,
    "url": "https://cdn.example.com/beiwanci/1.2.0.wgt",
    "size": 524288
  }
}
```

字段说明：

- `apk.force`：`true` 时用户不能跳过；
- `apk.minVersionCode`：低于此版本的客户端**只能走 APK 整包**（因为它的原生基座太老）；
- `wgt.minApkVersionCode`：只有装了对应（或更新）基座的客户端，才允许应用这个 wgt —— 这是 wgt 热更最关键的一条约束，忽略它会让老基座装上不兼容的资源包而白屏。

### 4.2 文件托管选择

| 方式 | 成本 | 国内速度 | 说明 |
|---|---|---|---|
| **腾讯云 COS + CDN** | 几元/月 | 快 | 推荐，直链稳定，可配私有 + 临时密钥 |
| **uniCloud 云存储** | 有免费额度 | 快 | 与 uni-upgrade-center 搭配最省事 |
| GitHub Release | 免费 | 不稳定 | 仅适合小范围分发/自用 |
| 自建 Nginx | 服务器成本 | 取决于带宽 | 最可控 |

JSON 与安装包**不要放在同一个会被缓存的路径**上；CDN 上给 `update.json` 设置
`Cache-Control: no-store`（否则用户可能一直拿到旧清单）。

---

## 五、客户端实现要点

### 5.1 需要补的权限

`manifest.json` → `app-plus.distribute.android.permissions`：

```json
"<uses-permission android:name=\"android.permission.INTERNET\"/>",
"<uses-permission android:name=\"android.permission.REQUEST_INSTALL_PACKAGES\"/>",
"<uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\"/>"
```

> `REQUEST_INSTALL_PACKAGES` 是 **signature 级系统权限**，Manifest 里声明了也不会自动授予，
> 仍需在运行时检查并引导用户去设置页开启。App 逻辑层检查方式见 5.4。

### 5.2 读取本地版本

```js
// App 端（逻辑层）
const versionName = plus.runtime.version;                 // "1.1.0"（manifest 的 versionName）
const appid = plus.runtime.appid;
// versionCode 需要异步拿
plus.runtime.getProperty(appid, (info) => {
  // info.versionCode（101）/ info.version（versionName）/ info.versionName
});
```

注意：`plus.runtime.getProperty` 是**异步回调**，别在同步流程里直接读。

### 5.3 wgt 热更新

```js
uni.downloadFile({
  url: wgt.url,
  success: (res) => {
    if (res.statusCode === 200) {
      plus.runtime.install(res.tempFilePath, { force: true }, () => {
        plus.runtime.restart();     // 必须重启才生效
      }, (e) => { /* 安装失败 → 降级为提示用户去下载 APK */ });
    }
  }
});
```

- wgt 安装**不弹系统界面**，用户体验最好；
- 安装失败要有兜底：提示「更新失败，可下载完整安装包」；
- 生产环境建议把 wgt 先 `plus.io` 保存到本地再安装，避免 tempFilePath 被回收。

### 5.4 APK 整包更新 + 安装权限

```js
// Android 8+ 判断是否有「安装未知来源应用」权限（App 端）
function canInstallPackage() {
  if (plus.os.name !== 'Android') return true;
  const main = plus.android.runtimeMainActivity();
  const pm = main.getPackageManager();
  // Android 8.0（API 26）以下无需此权限
  if (plus.android.getAttribute(plus.android.newObject('android.os.Build$VERSION'), 'SDK_INT') < 26) return true;
  return plus.android.invoke(pm, 'canRequestPackageInstalls');
}
```

无权限时的两种处理：

- **引导式（简单）**：`uni.showModal` 提示后跳设置页
  ```js
  const Intent = plus.android.importClass('android.content.Intent');
  const Settings = plus.android.importClass('android.provider.Settings');
  const intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            plus.android.importClass('android.net.Uri').parse('package:' + pkgName));
  main.startActivity(intent);
  ```
- **App 内安装器（体验更好）**：用 Android `PackageInstaller` API（API 21+），
  授予了 `REQUEST_INSTALL_PACKAGES` 后可不跳设置、直接在 App 内走安装确认弹窗。
  实现较复杂（需要原生插件或 Native.js），一般先用引导式即可。

下载 + 安装：

```js
const task = uni.downloadFile({
  url: apk.url,
  success: (res) => {
    if (res.statusCode !== 200) return fail();
    // 可选：校验 size / md5
    plus.runtime.install(res.tempFilePath, { force: true }, () => {
      // 装完询问是否立即打开
      plus.runtime.restart();
    }, (e) => fail(e));
  },
  fail: fail
});
task.onProgressUpdate((r) => { /* r.progress → 进度条 */ });
```

### 5.5 触发时机与节流

- **不要放在 `onLaunch` 最前面**：先让首页渲染出来，延迟 2~3 秒再检查；
- 用 `onShow` 触发，但加**一天一次**的节流（记录上次检查日期到 storage）；
- 设置页给一个「检查更新」手动入口（用户会主动点）；
- 失败静默：网络错误、JSON 解析失败一律不影响正常使用。

### 5.6 建议的文件结构（落地时）

```
uniapp/utils/updater.js       // 版本检查 + wgt/apk 安装（默认关闭）
uniapp/components/update-dialog/update-dialog.vue   // 更新弹窗（进度条）
uniapp/pages/settings/settings.vue                   // 加「检查更新」入口
```

配置项建议复用现有 `utils/settings.js`，例如：

```js
update: {
  enabled: false,        // 默认关闭：与改造前一致
  checkUrl: '',          // 版本清单 JSON 地址（空则不检查）
  lastCheckAt: ''        // 节流：上次检查日期
}
```

---

## 六、版本治理（发布 checklist）

每次发版按顺序做：

1. `manifest.json`：**`versionCode` +1**（`101 → 102 → 103`，只增不减），`versionName` 按语义化递增；
2. 如果动过原生配置（权限、模块、图标、启动图、AppID、证书）→ **发 APK，同时把 `wgt` 节点清空**（否则老基座会错误地装上新 wgt）；
3. 如果只改前端 → 发 wgt，并正确填写 `wgt.minApkVersionCode`；
4. 上传文件到 COS，更新 `update.json`；
5. 先用一台装了旧版本的真机验证：
   - 覆盖安装后**本地学习数据是否还在**（这是本项目最关键的一点，见下）；
   - 首次启动、登录态、收藏、学习记录是否正常。

### 本项目特有的注意点：本地数据

本 App 的学习进度、账号、收藏**全部存在本地**（`uni.getStorageSync` / `_doc/beiwanci.db`）。
覆盖安装**不会清除** App 私有数据，所以只要签名一致，用户数据天然保留。

但有两个坑要提前防：

- **签名变更 = 必须卸载重装 = 数据全丢**。所以第二节强调的「早日固定自有证书」是硬要求；
- 将来若数据结构升级（比如 SQLite 表结构变更），`db/schema.ts` 里已有
  `SCHEMA_VERSION` 与 `MIGRATIONS`，走**数据库迁移**而不是重建，避免覆盖更新后用户数据被清空。

---

## 七、合规（国内 Android）

- 必须在弹窗里**明示**更新内容、包大小、是否需要 WiFi，用户点确认后才开始下载；
- 不允许静默下载 APK、不允许后台静默安装；
- 提供「暂不更新」入口（非强制更新时）；
- 若 App 对外分发（非仅自用），隐私政策里需说明「应用会检查更新并下载安装包」。

---

## 八、最省事的替代路线

如果不想自建服务端：

1. **uni-upgrade-center（uniCloud 版）**：DCloud 官方插件，自带管理后台，
   支持 wgt / APK、灰度、强制更新、按渠道分发，客户端几行代码接入；
2. **上架应用商店**：交给商店自动更新（但更新时机不可控、需要软著与合规材料）；
3. **最低成本**：`update.json` + APK 直接挂在 GitHub Release / 蓝奏云，
   客户端只做提示不改自动安装 —— 适合自用或小范围分发。

---

## 九、落地步骤（建议顺序）

1. **先固定证书与包名**：生成自有 keystore 并备份 → 云打包改用自有证书 → 固定 AppID；
2. **补齐安装权限声明**（`REQUEST_INSTALL_PACKAGES`）；
3. **搭版本清单**：选一个托管（推荐腾讯云 COS），写好 `update.json`；
4. **写 `utils/updater.js`**：默认关闭，通过 `settings.update.checkUrl` 启用；
5. **加更新弹窗组件 + 设置页「检查更新」入口**；
6. **真机全流程验证**：1.1.0 → 1.2.0 覆盖安装，确认数据未丢、wgt 与 APK 两条路都通；
7. 之后每次发版按第六节 checklist 走。
