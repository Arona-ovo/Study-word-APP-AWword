// _tools/check-home.js - 首页自定义 / 跳转 / 拖拽收纳 校验（只读）
// 运行：node --experimental-strip-types _tools/check-home.js
//
// 覆盖：
//  1) utils/home-layout.ts 模块注册表与持久化（normalize / stash / restore / move / stashed）
//  2) dropIndex 拖拽落点纯函数（上下、边界、零位移、高度不等）
//  3) pages/home/home.vue 模板：布局驱动渲染 + 三个数据项跳转 + 编辑态手柄/收纳 + 收纳区面板
//  4) pages/home/home.vue 脚本：组件注册 + 方法齐全 + 生命周期刷新布局
//  5) 三个详情页存在（history / review-list / streak）且已注册进 pages.json
//  6) 三个详情页有返回入口，数据源与首页一致
//  6b) 首页卡片跳转契约：整卡可点、直连详情页（不走 switchTab）、
//      右上角那颗（去词库 / 换词书 / 设置）用 @tap.stop 与整卡点击分开

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 默认布局：必须与 home-layout.ts 的 MODULES(def:true) 顺序一致
const DEF_LAYOUT = ['book', 'action', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage'];

/* ---------------- mock：uni 存储 ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a);
  const s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

(async () => {
  /* ---------- 1. 模块注册表与持久化 ---------- */
  console.log('== 1. 首页模块注册表 / 持久化 ==');
  const L = await import(P('utils/home-layout.ts'));
  const needFns = ['MODULES', 'defaultLayout', 'moduleOf', 'normalize', 'layout',
    'saveLayout', 'stashed', 'stash', 'restore', 'move', 'dropIndex'];
  needFns.forEach(f => assert(typeof L[f] === 'function' || Array.isArray(L[f]), '导出 ' + f));

  eq(L.defaultLayout(), DEF_LAYOUT, '默认布局');
  // 上面那条的期望是写死的（防止有人悄悄改顺序）；这一条防止 defaultLayout 与
  // MODULES 的 def 标记对不上 —— 新增模块时只改上面的常量即可，这里会自动跟上
  eq(L.defaultLayout(), L.MODULES.filter(m => m.def).map(m => m.id), '默认布局 = MODULES 里 def:true 的那几项');
  assert(L.MODULES.length >= 8, '可选组件数量 = ' + L.MODULES.length + '（≥8）');
  assert(L.MODULES.filter(m => m.def).length === DEF_LAYOUT.length, '默认上首页的模块 = ' + DEF_LAYOUT.length);
  assert(L.MODULES.every(m => m.id && m.name && m.desc), '每个模块都有 id/name/desc');
  eq(L.layout(), DEF_LAYOUT, '首次读取 = 默认');

  // 归一化：去重 / 过滤非法 / 空值兜底
  eq(L.normalize(['stats', 'book', 'stats', 'xxx', 'action']), ['stats', 'book', 'action'], '去重并过滤非法 id');
  eq(L.normalize(null), DEF_LAYOUT, 'null 兜底为默认');
  eq(L.normalize([]), DEF_LAYOUT, '空数组兜底为默认');

  // 收纳：移出首页 → 出现在收纳区
  let lay = L.stash('action');
  eq(lay, ['book', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage'], '收纳 action 后布局');
  assert(L.stashed().some(m => m.id === 'action'), 'action 进入收纳区');
  eq(L.stashed().length, L.MODULES.length - lay.length, '收纳区数量 = 全部 - 首页');

  // 重新加回：追加到末尾
  lay = L.restore('action');
  eq(lay, ['book', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage', 'action'], '加回 action（追加到末尾）');
  eq(L.restore('action'), ['book', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage', 'action'], '重复添加幂等');

  // 拖拽换位
  L.saveLayout(['book', 'action', 'stats']);
  eq(L.move(0, 2), ['action', 'stats', 'book'], 'move(0→2)');
  eq(L.move(2, 0), ['book', 'action', 'stats'], 'move(2→0)');
  eq(L.move(1, 1), ['book', 'action', 'stats'], 'move 同位置不变');
  eq(L.move(0, 99), ['action', 'stats', 'book'], 'move 越界夹取到末尾');
  eq(L.move(-1, 0), ['action', 'stats', 'book'], 'move 非法起点不变');

  // 持久化：重新读一次仍在
  eq(L.layout(), ['action', 'stats', 'book'], '布局已持久化');
  L.saveLayout(['book', 'action', 'stats']);

  /* ---------- 2. dropIndex 拖拽落点 ---------- */
  console.log('== 2. dropIndex 拖拽落点 ==');
  const H = [100, 100, 100];
  eq(L.dropIndex(0, 0, H), 0, '零位移不换位');
  eq(L.dropIndex(0, 40, H), 0, '向下 40 < 阈值 100 不换位');
  eq(L.dropIndex(0, 120, H), 1, '向下 120 → 落到 1');
  eq(L.dropIndex(0, 320, H), 2, '向下 320 → 落到 2');
  eq(L.dropIndex(2, -120, H), 1, '向上 120 → 落到 1');
  eq(L.dropIndex(2, -320, H), 0, '向上 320 → 落到 0');
  eq(L.dropIndex(0, -50, H), 0, '首项向上越界仍为 0');
  eq(L.dropIndex(2, 500, H), 2, '末项向下越界仍为末位');
  // 高度不等：[120, 60]
  const H2 = [120, 60];
  eq(L.dropIndex(0, 50, H2), 0, '不等高：向下 50 < (120+60)/2=90 不换位');
  eq(L.dropIndex(0, 100, H2), 1, '不等高：向下 100 > 90 → 落到 1');

  /* ---------- 3. home.vue 模板 ---------- */
  console.log('== 3. pages/home/home.vue 模板 ==');
  const home = R('pages/home/home.vue');
  const tpl = home.slice(0, home.indexOf('\n<script'));
  assert(/class="mod-list"/.test(tpl), '存在模块容器 .mod-list');
  assert(/v-for="\(c, i\) in renderCards"/.test(tpl), '按 pageDoc.cards 顺序循环渲染卡片');
  assert(/@touchmove="dragMove"/.test(tpl) && /@touchend="dragEnd"/.test(tpl), '容器绑定拖拽移动/结束');
  // 整行把手：touch + H5 鼠标双路径；收纳按钮用 .stop 挡住拖拽启动
  assert(/@touchstart="dragStart\(i, \$event\)"/.test(tpl), '把手绑定 touchstart 拖拽');
  assert(/@mousedown="dragStartMouse\(i, \$event\)"/.test(tpl), '把手绑定 mousedown（H5 桌面鼠标）');
  assert(/mod-hide"[^>]*@touchstart\.stop="noop"/.test(tpl.replace(/\n\s*/g, ' ')) ||
         (/@touchstart\.stop="noop"/.test(tpl) && /@tap="stashModule\(c\.id\)"/.test(tpl)), '收纳按钮阻断拖拽冒泡');
  assert(/class="mod-grip"/.test(tpl) && /拖动/.test(tpl), '拖拽把手有视觉标识（≡ + 拖动文案）');
  assert(/touch-action:\s*none/.test(home), '把手区域 touch-action: none（拖动时页面不跟滚）');
  assert(/class="mod-hide"[^>]*@tap="stashModule\(c\.id\)"/.test(tpl) || /@tap="stashModule\(c\.id\)"/.test(tpl), '收纳按钮');
  assert(/@tap="goHistory"/.test(tpl), '「已练」跳转 goHistory');
  assert(/@tap="goReviewList"/.test(tpl), '「待复习」跳转 goReviewList');
  assert(/@tap="goStreak"/.test(tpl), '「连续天数」跳转 goStreak');
  ['book', 'action', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage', 'progress', 'favorites', 'streak'].forEach(id => {
    assert(tpl.indexOf("c.type === '" + id + "'") >= 0, '模板分支 c.type === ' + id);
  });
  assert(/class="foot-btn ghost"[^>]*@tap="openSheet"/.test(home) || /@tap="openSheet"/.test(home), '「＋ 添加组件」入口');
  assert(/@tap="finishEdit"/.test(home), '「完成」退出编辑态');
  assert(/@tap="toggleEdit"/.test(home), '「编辑首页」进入编辑态');
  assert(/class="sheet-mask"/.test(tpl) && /@tap="restoreModule\(m\.id\)"/.test(tpl), '收纳区面板 + 加回首页面板项');
  assert(/v-if="sheetShow"/.test(tpl), '收纳区按 sheetShow 显隐');
  assert(/v-if="editing"/.test(tpl), '编辑态条件渲染手柄行');
  // 拖拽时包裹层位移
  assert(/:style="wrapStyle\(i\)"/.test(tpl), '包裹层绑定 wrapStyle(i)');
  assert(/class="mod-shield"/.test(tpl), '编辑态遮罩 .mod-shield 屏蔽模块内部点击');

  /* ---------- 4. home.vue 脚本 ---------- */
  console.log('== 4. pages/home/home.vue 脚本 ==');
  const sc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
  ['WidgetProgress', 'WidgetFavorites', 'WidgetStreak', 'WidgetChart', 'WidgetGoal', 'WidgetUsage', 'WidgetWorddrill', 'WidgetChat'].forEach(c => {
    assert(new RegExp('import\\s+' + c + '\\s+from').test(sc), '导入组件 ' + c);
    assert(new RegExp('components:\\s*\\{[\\s\\S]*' + c).test(sc), '注册组件 ' + c);
  });
  // 模块注册表：期望值要写死，不能拿 MODULES.map(m => m.id) 当参照（那样恒真、等于没查）
  const REGISTERED = ['book', 'action', 'worddrill', 'chat', 'stats', 'goal', 'chart', 'usage',
    'progress', 'favorites', 'streak'];
  REGISTERED.forEach(id => assert(L.MODULES.some(m => m.id === id),
    '模块注册表含 ' + id));
  assert(/from\s+'[^']*home-layout\.ts'/.test(sc), '导入 utils/home-layout.ts');
  assert(!/import\s+\*\s+as\s+ai\s+from[^']*services\/index/.test(sc), '未走 services 门面 namespace（避免 H5 丢成员）');
  ['layout', 'editing', 'sheetShow', 'sheetList', 'dragIndex', 'dragDy', 'dragStartY', 'dragHeights']
    .forEach(k => assert(new RegExp('\\b' + k + '\\s*:').test(sc), 'data 含 ' + k));
  ['refreshDoc', 'has', 'nameOf', 'toggleEdit', 'finishEdit', 'openSheet', 'closeSheet',
    'stashModule', 'restoreModule', 'beginDrag', 'dragStart', 'dragStartMouse', 'dragMove', 'dragEnd',
    'wrapStyle', 'cardStyle', 'noop', 'goHistory', 'goReviewList', 'goStreak']
    .forEach(m => assert(new RegExp('\\b' + m + '\\s*\\(').test(sc), 'method ' + m));
  assert(/typeof document === 'undefined'/.test(sc), '鼠标路径在 App 端自动跳过（无 document）');
  assert(/onLoad\s*\(\)\s*\{[\s\S]*refreshDoc\(\)/.test(sc), 'onLoad 读取页面文档');
  assert(/onShow\s*\(\)\s*\{[\s\S]*refreshDoc\(\)/.test(sc), 'onShow 刷新页面文档');
  assert(/homeLayout\.saveLayout\(pageDoc\.builtinOrder/.test(sc), '内置顺序回写 homeLayout（兼容老入口）');
  assert(/onHide\s*\(\)[\s\S]*editing\s*=\s*false/.test(sc), 'onHide 退出编辑态');
  assert(/createSelectorQuery/.test(sc), '拖拽前测量各模块高度');
  assert(/dropIndex\(/.test(sc), '落点复用 home-layout.dropIndex');
  // 编辑态下所有跳转型方法都要失效，避免拖动时误触
  const guarded = (sc.match(/if \(this\.editing\) return/g) || []).length;
  assert(guarded >= 6, '编辑态跳转守卫 = ' + guarded + ' 处（≥6：练习/复习/专练/换词书/历史/待复习/打卡）');

  /* ---------- 4b. AI 卡片：与内置模块同权编辑，删除收进「添加组件」面板 ---------- */
  console.log('== 4b. AI 卡片同权编辑 / 面板删除 ==');
  // 编辑态渲染全部可见卡（内置 + AI），AI 卡不再被排除在编辑态之外
  assert(/renderCards\(\)\s*\{[^}]*return cs\.filter\(c => c\.visible !== false\)/.test(sc),
    'renderCards 编辑态也是全部可见卡（AI 卡可拖拽 / 收纳）');
  assert(!/renderCards\(\)\s*\{[^}]*builtin/.test(sc), 'renderCards 不再按 builtin 过滤');
  // 拖拽下标换算与渲染口径一致（口径不一致会拖错卡片）
  assert(/const idx = this\.visibleIndexes\(\)/.test(sc), 'dragEnd 用 visibleIndexes 换算真实下标');
  assert(!/builtinIndexes/.test(sc), '旧的 builtinIndexes（只算内置卡）已移除');
  // 名字：内置卡查注册表，AI 卡用标题
  assert(/\$t\(moduleName\(c\)\)/.test(tpl) && /moduleName\(c\)\s*\{/.test(sc),
    'moduleName：内置查注册表、AI 用标题');
  // 收纳区面板：AI 分区 + 添加 / 删除双操作
  assert(/v-for="c in aiSheetList"/.test(tpl) && /aiSheetList\(\)/.test(sc),
    '收纳区有 AI 卡片分区（aiSheetList computed）');
  assert(/@tap="restoreModule\(c\.id\)"/.test(tpl), 'AI 卡片在面板里可加回');
  assert(/@tap="deleteAiCard\(c\.id\)"/.test(tpl) && /sheet-del/.test(home), 'AI 卡片在面板里可删除（红色描边按钮）');
  assert(/AI 生成的卡片/.test(tpl), '面板里有 AI 分区标题（与原生组件区分）');
  // 删除要走统一弹窗（AppDialog）确认，且内置卡永远没有删除入口
  const delFn = sc.match(/deleteAiCard\(id\)\s*\{[\s\S]*?\n    \},/);
  assert(!!delFn, '存在 deleteAiCard');
  assert(!!delFn && /delConfirm/.test(delFn[0]), '删除前先弹 AppDialog 确认（delConfirm，不可恢复）');
  assert(!!delFn && /card\.builtin\) return/.test(delFn[0]), '内置卡没有删除入口（原生组件只能收纳）');
  assert(/onDeleteConfirm\(\)/.test(sc) && /pageDoc\.removeCard\(this\.doc, id\)/.test(sc),
    '确认后走 pageDoc.removeCard');
  assert(/<app-dialog/.test(tpl) && /:danger="true"/.test(tpl), '确认弹窗是统一 AppDialog（危险色）');
  assert(!/uni\.showModal/.test(sc), '不调用系统弹窗（全 App 弹窗统一）');
  assert(!/onCardRemove/.test(home) && !/removable/.test(home),
    '旧的卡片表面移除链路（onCardRemove / removable）已清理');

  /* ---------- 4c. 刷单词：入口唯一（只留在专属卡里，不在「学习入口」重复） ---------- */
  console.log('== 4c. 刷单词入口唯一 ==');
  // 2026-10-09 用户反馈：「句子练习」下面那颗「刷单词（背词义）」小胶囊与
  // 下方的「刷单词」卡完全重复，而且三颗胶囊并排会挤到换行、字被固定高度裁掉。
  // 这里把"入口只留一个"钉住，防止以后又顺手加回来。
  assert(!/goWordDrill/.test(tpl), '「学习入口」不再挂重复的刷单词按钮');
  assert(!/goWordDrill/.test(sc), 'goWordDrill 方法已随之删除（不留死代码）');
  const actionTpl = tpl.match(/c\.type === 'action'([\s\S]*?)<\/view>\s*<\/view>/);
  assert(!!actionTpl && !/goWordDrill/.test(actionTpl[1]) && !/刷单词/.test(actionTpl[1]),
    '主行动区里没有任何刷单词入口（连文案都不许出现）');
  assert(!!actionTpl && /@tap="startPractice"/.test(actionTpl[1]), '主行动区保留翻译练习主按钮');
  assert(!!actionTpl && /@tap="goDrill"/.test(actionTpl[1]), '主行动区保留 AI 薄弱点专练');
  // 「复习错题」常驻：错题数归零时不许整颗胶囊消失（用户会以为功能被删了，实际只是没题可复习）
  assert(!/v-if="wrongCount > 0"/.test(tpl), '「复习错题」不再随错题数整颗隐藏');
  assert(!/v-if="wrongCount/.test((actionTpl || [])[1] || ''), '主行动区没有会隐藏复习入口的条件渲染');
  assert(/entry-disabled':\s*wrongCount === 0/.test(tpl), '零错题时置灰（与 AI 专练未配置时的形态一致）');
  assert(/\$t\('复习错题'\)/.test(tpl), '零错题时文案去掉数字，只留「复习错题」');
  const grFn = (sc.match(/goReview\(\)\s*\{[\s\S]*?\n    \},/) || [])[0] || '';
  assert(/if \(this\.editing\) return/.test(grFn), 'goReview 仍有编辑态守卫（拖动时不误触）');
  assert(/if \(!this\.wrongCount\)/.test(grFn) && /showToast/.test(grFn),
    '零错题时不进空练习页，直接提示错题从哪来');
  // 小胶囊：与「刷单词」卡里的 .wb-mini **完全同款**（用户要求全页只有一种小胶囊）。
  // 直接跨文件比对两条 CSS 的关键属性 —— 光断言"有 nowrap"守不住两边各自漂移。
  const cssBlock = (src, sel) => (src.match(new RegExp('\\.' + sel + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  const prop = (block, name) => {
    const m = block.match(new RegExp('(?:^|[;{\\s])' + name + ':\\s*([^;]+)'));
    return m ? m[1].trim() : '';
  };
  const mini = cssBlock(home, 'btn-mini');
  const wmini = cssBlock(R('components/home-widgets/widget-worddrill.vue'), 'wb-mini');
  assert(!!mini && !!wmini, '两处小胶囊样式都能取到');
  ['height', 'font-size', 'flex', 'border-radius', 'margin', 'padding', 'white-space'].forEach((p) => {
    eq(prop(mini, p), prop(wmini, p), '小胶囊 ' + p + ' 两边一致');
  });
  // 描边色带 alpha 的优先行（后写的带 var 兜底行，取第一行是写死的 rgba）
  const borderOf = (b) => (b.match(/border:\s*2rpx solid rgba\(46, 107, 255, ([0-9.]+)\)/) || [])[1] || '';
  eq(borderOf(mini), borderOf(wmini), '小胶囊描边透明度一致');
  eq(borderOf(mini), '0.34', '描边用的是 34%（0.28 会显得发灰）');
  assert(!!mini && /white-space:\s*nowrap/.test(mini), '小胶囊单行显示（不会在胶囊内折行被裁）');
  assert(!!mini && /flex:\s*1\s*;/.test(mini), '小胶囊等分撑满一行（与卡内两颗同款）');

  // 词书卡：刻意比通用 .card 矮一档，标题/链接字号对齐「刷单词」卡
  const bc = cssBlock(home, 'book-head-card');
  assert(/padding:\s*26rpx 32rpx/.test(bc), '词书卡内边距收紧到 26/32rpx（默认 40/36 太占地方）');
  eq(prop(cssBlock(home, 'book-name'), 'font-size'), '28rpx', '词书卡标题 28rpx');
  eq(prop(cssBlock(R('components/home-widgets/widget-worddrill.vue'), 'wdg-title'), 'font-size'), '28rpx',
    '「刷单词」卡标题 28rpx');
  eq(prop(cssBlock(home, 'switch-link'), 'font-size'), '22rpx', '词书卡右上角链接 22rpx');
  eq(prop(cssBlock(R('components/home-widgets/widget-worddrill.vue'), 'wdg-link'), 'font-size'), '22rpx',
    '「刷单词」卡右上角链接 22rpx');
  // 专属入口本身（唯一入口）必须完好
  assert(/c\.type === 'worddrill'/.test(tpl) && /<widget-worddrill/.test(tpl),
    '独立「刷单词」卡有渲染分支');
  const wdFn = (R('components/home-widgets/widget-worddrill.vue').match(/open\(src\)\s*\{[\s\S]*?\n    \}/) || [])[0] || '';
  assert(/word-drill\/word-drill\?source=/.test(wdFn), '「刷单词」卡是唯一入口且能带 source 进页');
  // AI 卡按钮动作也能进：老规格 action 映射 + 新规格 navigate 白名单
  assert(/worddrill: '\/pkgStudy\/pages\/word-drill\/word-drill\?source=daily'/.test(sc),
    'onCardAction 的 action 映射含 worddrill');
  const routeM = R('utils/card-spec.js').match(/wordDrill:\s*\{\s*url:\s*'([^']+)',\s*tab:\s*false\s*\}/);
  assert(!!routeM && routeM[1] === '/pkgStudy/pages/word-drill/word-drill', 'card-spec PAGE_ROUTES 含 wordDrill');
  const pjStr = R('pages.json');
  assert(pjStr.indexOf('"pages/word-drill/word-drill"') >= 0, 'pages.json 注册 pages/word-drill/word-drill');
  assert(fs.existsSync(path.join(ROOT, 'pkgStudy', 'pages', 'word-drill', 'word-drill.vue')),
    '页面文件存在 pkgStudy/pages/word-drill/word-drill.vue');

  /* ---------- 5. 页面注册 ---------- */
  console.log('== 5. 详情页与路由注册 ==');
  const pj = R('pages.json');
  // 分包后：pages.json 里仍是相对分包的 'pages/x/x'，磁盘上则多一层 pkgStudy/
  ['pages/history/history', 'pages/review-list/review-list', 'pages/streak/streak']
    .forEach(p => {
      assert(pj.indexOf('"' + p + '"') >= 0, 'pages.json 注册 ' + p);
      assert(fs.existsSync(path.join(ROOT, 'pkgStudy', p + '.vue')), '文件存在 pkgStudy/' + p + '.vue');
    });
  assert(pj.indexOf('"pages/cover/cover"') >= 0, '首屏仍为 cover');

  /* ---------- 6. 详情页内容 ---------- */
  console.log('== 6. 详情页内容 ==');
  const his = R('pkgStudy/pages/history/history.vue');
  assert(/engine\.history/.test(his), 'history 读 engine.history()');
  assert(/studyRecords/.test(his), 'history 登录后额外读 study_records');
  assert(/<float-navbar/.test(his), 'history 有导航条（可返回）');

  const rl = R('pkgStudy/pages/review-list/review-list.vue');
  assert(/engine\.wrongList/.test(rl), 'review-list 读 engine.wrongList()');
  assert(/<float-navbar/.test(rl), 'review-list 有导航条（可返回）');
  assert(/practice\?source=review/.test(rl), 'review-list 可跳练习页复习');

  const st = R('pkgStudy/pages/streak/streak.vue');
  assert(/engine\.streak/.test(st), 'streak 读 engine.streak()');
  assert(/longestStreak/.test(st), 'streak 读最长连续');
  assert(/<float-navbar/.test(st), 'streak 有导航条（可返回）');

  // engine 导出契约
  const eg = R('utils/engine.js');
  ['history', 'longestStreak', 'streak', 'dateStr', 'wrongList', 'addMasteredToday'].forEach(f => {
    assert(new RegExp('\\b' + f + '\\b').test(eg.slice(eg.indexOf('export {'))), 'engine 导出 ' + f);
  });

  /* ---------- 6b. 首页小组件卡片：点得进详情 ---------- */
  // 回归点（用户反馈）：「主页的卡片点不进词库详情」。
  // 根因两条：① 掌握度概览卡的「去词库 ›」走的是 switchTab —— 只切到词库 tab 就停住；
  // ② 只有右上角那颗 22rpx 的小字可点，点卡片主体毫无反应。
  // 现在整卡 + 右上那颗都直连详情页；编辑首页时有屏蔽层，拖卡片不会误触发跳转。
  console.log('== 6b. 首页小组件卡片跳转 ==');
  const homeRaw = R('pages/home/home.vue');
  assert(/v-if="editing"[\s\S]{0,40}class="mod-shield"/.test(homeRaw),
    '编辑态有屏蔽层（拖卡片时不会误触发卡片自身的点击）');

  const wp = R('components/home-widgets/widget-progress.vue');
  const wpTpl = wp.slice(0, wp.indexOf('\n<script'));
  assert(/library-detail\/library-detail\?tab=vocab/.test(wp), '掌握度概览卡 → 词库详情（tab=vocab）');
  assert(!/switchTab\(\{\s*url:\s*'\/pages\/library\/library'/.test(wp),
    '不再只切到词库 tab（那就是"点不进详情"的根因）');
  assert(/@tap="goLibrary"/.test(wpTpl), '整卡可点（不只右上角那颗小字）');
  assert(/@tap\.stop="goLibrary"/.test(wpTpl), '右上角那颗用 .stop（否则一次点击跳两回）');
  assert(/uni\.\$on\('home:refresh', this\.refresh\)/.test(wp),
    '掌握度概览订阅 home:refresh（刷完一组回首页数字要跟着变）');
  assert(/uni\.\$off\('home:refresh', this\.refresh\)/.test(wp), '掌握度概览退订（tab 页常驻）');

  const wg = R('components/home-widgets/widget-goal.vue');
  const wgTpl = wg.slice(0, wg.indexOf('\n<script'));
  assert(/library-detail\/library-detail\?tab=goal/.test(wg), '每日目标卡 → 词库详情（tab=goal）');
  assert(/@tap="goSetting"/.test(wgTpl) && /@tap\.stop="goSetting"/.test(wgTpl),
    '每日目标整卡可点（右上角那颗也保留）');
  // 目标口径改了：数的是"学会了多少"，不是"答对多少"
  assert(/\$t\('学会'\)/.test(wgTpl) && !/\$t\('练习通过'\)/.test(wgTpl), '目标第二行按新口径叫「学会」');
  assert(/今日已做 \{a\} 题 · 学会 \{b\} 题/.test(wg), '脚注改成"做了多少 / 学会多少"');
  const ld = R('pkgManage/pages/library-detail/library-detail.vue');
  assert(/\$t\('每日学会题量'\)/.test(ld), '词库详情的目标名同步改成「每日学会题量」');

  // 当前词书卡（home.vue 内联的 book 模块）：整卡进详情，右上角那颗换词书 —— 两件事必须分开。
  // 回归点（用户反馈）：「主页这个卡片点进去最好能直接到词库详情里面去，不然无法点击光看没什么用。
  // 注意跟旁边的换词书区别开。」以前整卡没有点击处理，只有 22rpx 的「换词书 ›」可点。
  const bookTpl = homeRaw.slice(
    homeRaw.indexOf("c.type === 'book'"),
    homeRaw.indexOf("c.type === 'action'")
  );
  assert(bookTpl.length > 100, '能抠出当前词书卡模板');
  // URL 在方法体里（模板只挂 @tap），所以这条对全文测，并限定在 goBookDetail 方法体内
  assert(/goBookDetail\(\)\s*\{[\s\S]{0,200}library-detail\/library-detail\?tab=batch/.test(homeRaw),
    '当前词书卡整卡 → 词库详情（tab=batch，卡片主体就是批次进度）');
  assert(!/switchTab/.test(bookTpl), '词书卡不再走 switchTab（tabBar 页只切 tab 就停住 = 点了没反应）');
  assert(/@tap="goBookDetail"/.test(bookTpl), '整卡可点（不只右上角那颗小字）');
  assert(/@tap\.stop="goBooks"/.test(bookTpl), '「换词书」用 .stop（否则一次点击换页又叠详情）');
  assert(/goBookDetail\(\)\s*\{[\s\S]{0,120}if \(this\.editing\) return/.test(homeRaw),
    'goBookDetail 编辑态不跳（拖卡片不会误开详情）');
  assert(/book-switch\/book-switch/.test(homeRaw), '「换词书」仍去选择词书页（与整卡点击是两件事）');
  assert(/\.book-head-card\.tappable:active/.test(homeRaw), '整卡有按下反馈样式（让人知道能点）');
  assert(/\.switch-link:active/.test(homeRaw), '「换词书」有独立按压反馈（看得出是另一个操作）');

  /* ---------- 7. 顶部输入框：空内容回车不做事 ---------- */
  console.log('== 7. 顶部输入框：空内容回车不做事 ==');
  // 回归点：空串回车以前会走到 runSearch('') → onSearchInput('') → clearSearch()，
  // 而 clearSearch 会调顶栏 blurInput() 强制失焦 → 胶囊收起 → 右侧模式键被一起
  // 收成 width:0 + pointer-events:none，于是"按了下回车，切换键就点不动了"。
  const homeSrc = R('pages/home/home.vue');
  const om = homeSrc.match(/\n    onSubmit\(v\) \{([\s\S]*?)\n    \},/);
  assert(!!om, '能抠出 onSubmit 方法体');
  if (om) {
    const intentMod = await import(P('utils/intent.js'));
    // t / uni 也要传进去：onSubmit 在没有 AI 时会 toast 一句"怎么手动加"（见下面第 3 条用例）
    const toasts = [];
    const onSubmit = new Function('intent', 't', 'uni', 'return function (v) {' + om[1] + '\n};')(
      intentMod,
      (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m)),
      { showToast: (o) => toasts.push(o && o.title) }
    );
    // 只记录"真的按下去了什么"：runSearch / runCommand 各记一笔
    // 回车时会读到的状态：本地那条 / 缓存 / AI 结果 / 防抖定时器 / AI 开关。
    // 少给一个就是"桩不全"，会炸成 ReferenceError 而不是逻辑错（踩过：加了 aiLookup 分支后
    // onSubmit 里的 t() 在依赖袋里没有，整个第 7 组直接挂掉）。
    const mk = (mode) => {
      const log = [];
      return {
        log: log,
        inputMode: mode, keyword: '', modeLocked: false, lastCmdText: '',
        searchTimer: 0, aiEnabled: false, cached: null, aiResult: null,
        // results / openWord 是 onSubmit 新增用到的：回车时本地已有**一模一样**的
        // 那条就直接进词条页（data 里本来就有这两个，桩要跟上，否则是桩不全而不是逻辑错）
        results: [],
        pickText: (v) => (typeof v === 'string' ? v : String(v == null ? '' : v)),
        // rememberSearch 是"搜索历史"加的：回车 / 点开某条结果都记一笔。
        // 桩不跟上就是"桩不全"，不是逻辑错（这条本身就带动过的那几条断言一起验顺序）
        rememberSearch: (w) => log.push('history:' + w),
        runSearch: (v) => log.push('search:' + v),
        runCommand: (v) => log.push('command:' + v),
        openWord: (it) => log.push('open:' + ((it && it.w) || '')),
        // 本地查不到时回车会立刻去问 AI（2026-10-11 补：以前只再跑一遍检索，等于没反应）
        aiLookup: (w) => log.push('ai:' + w)
      };
    };
    let c = mk('search');
    onSubmit.call(c, '');
    eq(c.log, [], '空串回车：既不查词也不跑指令');
    c = mk('search');
    onSubmit.call(c, '   ');
    eq(c.log, [], '纯空格回车：同样不做事');
    c = mk('command');
    onSubmit.call(c, '');
    eq(c.log, [], '指令模式下空回车：不做事');
    c = mk('search');
    onSubmit.call(c, '/');
    eq(c.log, [], '只打了个前缀（正文为空）：不做事');
    c = mk('search');
    onSubmit.call(c, 'apple');
    eq(c.log, ['history:apple', 'search:apple'], '有内容时照常查词（并顺手记一笔历史）');
    // 回车要有一个"看得见"的动作：本地已经有**一模一样**的那条就直接进词条页。
    // 以前一律 runSearch（把同样的检索再跑一遍、界面纹丝不动），用户只会觉得回车坏了。
    c = mk('search');
    c.results = [{ w: 'apple', pos: 'n.', m: '苹果' }, { w: 'applesauce', pos: '', m: '苹果酱' }];
    onSubmit.call(c, 'Apple');
    eq(c.log, ['history:Apple', 'open:apple'], '本地已有这个词 → 回车直接进词条页（不是把检索再跑一遍）');
    c = mk('search');
    c.results = [{ w: 'applesauce', pos: '', m: '苹果酱' }];
    onSubmit.call(c, 'apple');
    eq(c.log, ['history:apple', 'search:apple'], '只有相近的 → 回车照旧去检索（精确命中才直达）');
    c = mk('command');
    onSubmit.call(c, '把背景换成安静的蓝色渐变');
    eq(c.log, ['command:把背景换成安静的蓝色渐变'], '指令模式下照常执行（指令不是查词，不进搜索历史）');
    // 所见即所得：回车只走界面上显示的模式，自动改判发生在打字时（onSearchInput）
    c = mk('search');
    onSubmit.call(c, '把背景换成安静的蓝色渐变');
    eq(c.log, ['history:把背景换成安静的蓝色渐变', 'search:把背景换成安静的蓝色渐变'], '界面显示「搜」时回车就查词（不擅自改判成指令）');
    c = mk('search');
    onSubmit.call(c, '/把背景换成安静的蓝色渐变');
    eq(c.log, ['command:把背景换成安静的蓝色渐变'], '显式前缀能盖过界面上的模式');
    // 空回车不能顺手把模式 / 锁定状态改掉（否则用户锁了 AI 一按回车就没了）
    c = mk('command');
    c.modeLocked = true;
    onSubmit.call(c, '');
    eq([c.inputMode, c.modeLocked], ['command', true], '空回车不动模式与锁定态');
    // 2026-10-11 实测反馈：搜 "en" 时本地只有一堆相近的词，回车却什么都没发生 ——
    // 一半原因是回车退化成 runSearch（把同样的检索再跑一遍，界面纹丝不动），
    // 另一半是打字那条链路有长度门槛（AI_NEAR_MIN_LEN=3），短词压根没去问过 AI。
    // 回车是用户明确的动作：不受那条门槛限制，本地没有就立刻问。
    c = mk('search');
    c.aiEnabled = true;
    c.results = [{ w: 'ending', pos: '', m: '结局' }];
    toasts.length = 0;
    onSubmit.call(c, 'en');
    eq(c.log, ['history:en', 'ai:en'], '★ 本地只有相近的 + 已接 AI → 回车立刻问 AI（短词也不被门槛拦住）');
    // AI 关着就没有上面那条出路了：至少把本地检索跑满，别让人觉得回车坏了
    c = mk('search');
    c.results = [{ w: 'ending', pos: '', m: '结局' }];
    toasts.length = 0;
    onSubmit.call(c, 'en');
    eq(c.log, ['history:en', 'search:en'], '没接 AI → 回车仍把本地检索跑满（不是什么都不做）');
    eq(toasts.length, 0, '本地还有相近的结果时不啰嗦（列表就摆在眼前）');
    c = mk('search');
    toasts.length = 0;
    onSubmit.call(c, 'zzqqxx');
    eq(c.log, ['history:zzqqxx', 'search:zzqqxx'], '本地一条都没有 → 检索照旧跑，再给一句怎么手动加');
    assert(toasts.length === 1 && /自己填释义/.test(toasts[0] || ''),
      '★ 一条都没有时才提示「可在词条页自己填释义」：' + toasts.join('|'));
  }
  assert(/clearSearch\(\) \{/.test(homeSrc), '清空入口 clearSearch 仍在（× / 收起照常可用）');

  /* ---------- 8. 搜索独立成屏 + 搜索历史 ---------- */
  // 回归点（用户反馈）：「搜索出来的结果滑到底下发现还是在首页」—— 以前结果卡
  // 就塞在 .page-slide 里，往下滚是卡片后面的首页内容。现在整屏铺一层 .sr-page，
  // 自己滚动，跟首页彻底分开；并且没输入任何东西时先显示历史记录。
  console.log('== 8. 搜索独立成屏 + 搜索历史 ==');
  assert(/<view\s+v-if="searching && !editing"\s+class="sr-page"/.test(homeSrc),
    '整屏搜索面板 .sr-page 存在（不再是首页里的一张卡）');
  const srRule = (homeSrc.match(/\.sr-page \{[\s\S]*?\n\}/) || [''])[0];
  assert(srRule.length > 80, '能抠出 .sr-page 样式块');
  assert(/position:\s*fixed/.test(srRule),
    '.sr-page 是 fixed（脱离首页文档流，滚到底也不会露出首页）');
  assert(/overflow-y:\s*auto/.test(srRule),
    '.sr-page 自己滚（内容是它内部在滚，不是滚首页）');
  assert(/background:\s*var\(--app-bg/.test(srRule),
    '.sr-page 铺了不透明背景（CSS 变量没继承到时的兜底）');
  assert(/z-index:\s*350/.test(srRule),
    '.sr-page 盖在内容之上，但低于顶栏(400)/底栏(500)（z-index 350）');
  // ⚠️ 这两条钉的是第二起真机事故（用户：「还能看到主页」「滑的是背后的主页不是列表」）：
  //   ① top 曾经写成 `calc(var(--status-bar-height) + 136rpx)`，变量在本层没继承到就整体
  //      上移，顶栏底下露出首页那两行小字 —— 改成 top/bottom 全贴 0，不依赖任何变量；
  //   ② 面板内容不够高（只命中 4 条）时 overflow 容器滚不动，手势穿透给背后的页面 ——
  //      靠 .sr-body 的 `min-height: calc(100% + 2rpx)` 保证面板"永远能滚"。
  assert(/top:\s*0\s*;/.test(srRule) && /bottom:\s*0\s*;/.test(srRule),
    '.sr-page 四条边全贴 0（不靠 --status-bar-height 定位，物理上盖满整屏）');
  assert(!/top:\s*calc\(/.test(srRule),
    '.sr-page 的 top 不再读 CSS 变量（变量没继承到就会露出首页，踩过一次）');
  assert(/overscroll-behavior:\s*contain/.test(srRule),
    '.sr-page 切断滚动链（滚到两端也不传给首页）');
  assert(/:style="appBgStyle"/.test(
    homeSrc.slice(homeSrc.indexOf('class="sr-page"'), homeSrc.indexOf('class="sr-page"') + 260)),
    '.sr-page 复用首页那一套背景（:style="appBgStyle"）—— 换背景/深色/自定义图才和首页一致');
  const srBody = (homeSrc.match(/\.sr-body \{[\s\S]*?\n\}/) || [''])[0];
  assert(/min-height:\s*calc\(100%\s*\+\s*2rpx\)/.test(srBody),
    '.sr-body 撑满一屏再多 2rpx → 面板永远是"最内层的可滚容器"，手势不会穿透给首页');
  assert(/padding:\s*calc\(var\(--status-bar-height[^;]*136rpx\)[^;]*env\(safe-area-inset-bottom\)/.test(srBody),
    '.sr-body 上下留白顺势让出顶栏与底栏（与 .page-nav / .page-tabbar 同一套数字）');
  // touch 事件要拦住，否则在结果上滑动会带着后面的首页一起滚
  ['touchstart.stop', 'touchmove.stop', 'touchend.stop'].forEach(ev =>
    assert(homeSrc.indexOf('@' + ev) >= 0, '拦住 ' + ev + '（不带着首页一起滚）'));
  // 搜索面板必须排在 float-navbar 之后、且在 .page-slide 之外（约定 4）
  const iSr = homeSrc.indexOf('class="sr-page"');
  const iNav = homeSrc.indexOf('float-navbar');
  const iSlide = homeSrc.indexOf('class="page-slide"');
  assert(iSr > iNav, '搜索面板在 float-navbar 之后');
  assert(iSlide > iSr, '搜索面板在 .page-slide 之前 → 不在里面（不然跟着一起左右滑）');
  const srBlock = homeSrc.slice(iSr, iSlide);
  assert(srBlock.indexOf('search-card') > 0, '结果卡挂在这层里（不是留在首页卡槽）');

  // 历史记录组件
  const sh = R('components/search-history/search-history.vue');
  const shMod = R('utils/search-history.js');
  assert(/SearchHistory/.test(homeSrc) && /components:\s*\{[\s\S]{0,400}SearchHistory/.test(homeSrc),
    '首页注册了 SearchHistory 组件');
  assert(/<search-history[^>]*@pick="onHistoryPick"/.test(homeSrc), '首页接住 history 的 pick 事件');
  assert(/<search-history[^>]*v-if="!lastQuery"/.test(homeSrc),
    '还没搜过（lastQuery 为空）才显示历史；有结果了就让位给结果');
  assert(/refreshHistory\(\)/.test(homeSrc) && /onHistoryPick\(w\)/.test(homeSrc),
    '有 refreshHistory / onHistoryPick 两个方法');
  assert(/onHistoryPick\(w\) \{[\s\S]{0,120}runSearch/.test(homeSrc),
    '点历史条目直接按那个词重新搜（不用再敲一遍）');
  assert(/onInputFocus\(\) \{[\s\S]{0,700}searching\s*=\s*true/.test(homeSrc),
    '点输入框就把搜索面板铺开（不是等打完字才出）');
  assert(/onInputFocus\(\) \{[\s\S]{0,700}refreshHistory\(\)/.test(homeSrc),
    '铺开的同时把历史读一遍（第一眼就是"最近查过"）');
  assert(/@tap\.stop="del\(i\)"/.test(sh) && /脱手|删除|del/.test(sh),
    '每条历史右侧 × 不冒泡（点了不会再点亮整条）');
  assert(/clearAll/.test(sh) && /清空/.test(sh), '有「清空」入口');
  // 空输入不再退回首页：把字全删了是"想换个词再查"，退回首屏会让人以为搜索被取消了
  const oi = homeSrc.match(/\n    onSearchInput\(v\) \{([\s\S]*?)\n    \},/);
  assert(!!oi, '能抠出 onSearchInput 方法体');
  if (oi) {
    const emptyBranch = oi[1].slice(oi[1].indexOf('if (!v.trim())'), oi[1].indexOf('if (!v.trim())') + 400);
    assert(!/searching\s*=\s*false/.test(emptyBranch),
      '清空输入不退出搜索屏（还在搜索里，能看到历史重新选）');
    assert(!/clearSearch\(\)/.test(emptyBranch),
      '清空输入不整屏收起（不把键盘 / 模式一起收掉）');
  }
  // 记历史的时机：回车 + 点开某条结果。边打字边记会把半成品词灌进来
  assert(/this\.rememberSearch\(text\)/.test(homeSrc), '回车提交记一笔');
  // openWord 是最后一个方法，收尾是 `    }` 没有逗号，所以这里到 `\n    }` 为止
  const owBody = homeSrc.match(/\n    openWord\(it\) \{([\s\S]*?)\n    \}/);
  assert(!!owBody, '能抠出 openWord 方法体');
  assert(!!owBody && /rememberSearch/.test(owBody[1]), '点开某条结果也记一笔');
  assert(!!owBody && !/rememberSearch/.test(oi ? oi[1] : ''),
    '打字过程不记历史（否则 ru / runn 这类半成品会灌满）');
  // 历史模块本身
  const HS = await import(P('utils/search-history.js'));
  ['list', 'add', 'remove', 'clear'].forEach(f =>
    assert(typeof HS[f] === 'function', 'search-history 导出 ' + f));
  const words = () => HS.list().map(x => x.w);
  HS.clear();
  HS.add('apple');
  HS.add('banana');
  HS.add('Apple');
  eq(words(), ['Apple', 'banana'], '同一个词再查一次 → 提到最前、不重复占两格');
  eq(HS.add('   '), false, '空白不算一个词');
  eq(HS.add('***'), false, '纯标点不算一个词');
  eq(words().length, 2, '没写进去就不占位');
  for (let i = 0; i < 40; i++) HS.add('w' + i);
  assert(HS.list().length <= 20, '历史有上限（' + HS.list().length + ' ≤ 20）');
  eq(words()[0], 'w39', '最新的一条在最前');
  eq(words().indexOf('w0'), -1, '超上限丢的是最旧的');
  HS.remove('w39');
  eq(words().indexOf('w39'), -1, '单条能删');
  HS.clear();
  eq(HS.list(), [], '能一次性清空');

  console.log('');
  console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});
