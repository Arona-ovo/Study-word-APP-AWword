// utils/settings.js - 应用设置 / 个人资料 / 收藏 的本地状态
// 独立于学习进度（store.js），单独存一个 storage key，互不干扰。
// 所有 AI 相关密钥仅存于此处（或部署环境变量），源码不出现任何字面量密钥。

const KEY = 'fj_app_settings_v1';
let cache = null;

// 未设置昵称时的默认显示（与 pages/profile/profile.vue 的 DEFAULT_NICKNAME 保持一致）
const DEFAULT_NICKNAME = 'arona';
// 老版本沿用过的默认昵称，仅用于一次性迁移
const LEGACY_NICKNAME = '学习者';

function defaults() {
  return {
    // 界面语言：'zh' | 'en'（见 utils/i18n.js）。
    // zh 态直接显示中文原文，en 态查 utils/i18n-en.js —— 查不到就回退中文。
    locale: 'zh',
    // 个人资料（纯本地，无后端）；改默认值时记得同步 pages/profile/profile.vue 的 DEFAULT_NICKNAME
    profile: { avatar: '', nickname: DEFAULT_NICKNAME, account: '', bio: '' },
    // 收藏：{ type:'word'|'sentence', id, word?, en?, zh? }
    favorites: [],
    // 首页模块顺序（可自定义 / 收纳），id 见 utils/home-layout.ts 的 MODULES。
    // 默认留空 → 由 home-layout 的 defaultLayout() 决定，保证新增模块能自动出现在首页。
    // seenBuiltins：这张首页"见过"哪些内置卡（见 page-doc.js 的 ensureBuiltins），
    // 用来区分「新模块还没加进来」和「用户自己收纳掉了」—— 后者不能再塞回去。
    // 默认 null（不是 []）：表示"从没记过"= 老数据，新增模块才需要补进来。
    home: { layout: [], seenBuiltins: null },
    // 新手引导：首次进首页放一遍（步骤定义见 utils/onboarding.js，
    // 渲染见 components/onboarding-mask.vue）。done = 看完或跳过；
    // v 记步骤版本，以后改版可以据此让老用户再看一次；设置页可「重看」。
    onboarding: { done: false, v: 0, at: 0 },
    // 通知
    notifications: { daily: false, time: '20:00' },
    // 彩蛋：连点设置 › 关于 › 版本 触发。found 只是"被发现过几次"的计数，
    // 纯粹为了让第 N 次打开时的台词不一样，不影响任何功能。
    egg: { found: 0 },
    // 隐私
    privacy: { storeLocal: true },
    // 数据备份（换手机迁移，见 utils/backup.js）。
    // 只记"上次导出过什么"，纯粹用于设置页显示一行提示；
    // 备份内容本身在文件 / 剪贴板里，不在这里。
    backup: { lastAt: 0, lastFile: '' },
    // 外观：主题色 / 背景（key 见 utils/theme.js 的 ACCENTS 与 BACKGROUNDS）
    theme: {
      accent: 'blue',      // 主题色
      // 首次进入的默认背景 = 浅蓝（sky）。
      // 只影响**从没改过背景的用户**：settings.set 是深合并、load 是 deepMerge(defaults(), 存档)，
      // 老用户存档里写着的 background 会原样保留，不会被这个改动顶掉。
      background: 'sky',     // 背景预设（'custom' = 用下面这个自定义色）
      bgColor: '',         // 自定义底色（#rrggbb；空 = 还没挑过，用 DEFAULT_CUSTOM）
      bgImage: '',         // 自定义背景图（本地路径，空则用预设）
      bgMask: 0.35,        // 背景图上的蒙版强度（0-0.8；浅色叠白、深色叠黑）
      bgBlur: 0,           // 背景模糊半径（px，0-24）
      dark: false,         // 深色模式（followSystem 为 true 时被系统值覆盖）
      followSystem: false, // 跟随系统深色模式
      font: 'system',      // 字体：system | serif | rounded（AI 指令 theme.set 可改）
      density: 'cozy',     // 密度：compact | cozy | relaxed（AI 指令 theme.set 可改）
      // 练习页顶部两条进度条（已做 / 已会）要不要同色系。
      //   true  同色系：已做 = 主题色的浅版，已会 = 主题色实心（整体跟主题走）
      //   false 分开：已做仍是主题色，已会改用「成了」的绿色 —— 和"学会"的语义色对齐，
      //         两条靠色相区分，不靠深浅（色弱用户也分得清）
      // 读法见 utils/theme.js 的 barsSyncColors()（脏值统一回落到 true）
      progressSync: true
    },
    // 性能：画质档位 + 流畅模式总开关 —— 低端机的退路，
    // 只影响观感，不改变任何功能与数据。
    //   smooth  旧的一刀切开关（== 档位里的 lightweight / minimal），保留做总开关
    //   其它探测字段（probed/auto/cpu/px/tier/score）由 utils/perf.js 首次探测写入
    //   manual  用户亲手拨过 → 自动检测不再改这个值
    //   quality 用户选的档位：'auto' 跟随探测结果，或 high/balanced/lite/minimal
    //   level   quality 解析后的实际档位（auto 消解掉）
    //   fx      合成后的三个维度 + 两级模糊半径，theme.js 直接读它下发 CSS 变量
    //   fxOverride 在档位之上单独改过的维度（改回档位默认值时该项会被删掉）
    performance: {
      smooth: false,
      probed: false,
      auto: false,
      manual: false,
      cpu: 0,
      px: 0,
      tier: '',
      score: 0,
      quality: 'auto',
      level: 'high',
      fx: { glass: 'full', motion: 'full', shadow: 'full', blurSm: 8, blurLg: 12, maxBgBlur: 24 },
      fxOverride: {}
    },
    // 学习偏好：记住用户挑过的作答方式，省得每换一题都重挑一遍。
    // 注意 settings.set 是深合并 —— 加新键不会顶掉老用户的存档，老用户也会拿到这个默认值。
    // 两个消费方：刷单词页（drillMode）、翻译练习页（practiceMode），
    // 都通过下面的 studyMode() 读取，脏值 / 缺省统一回落到选义。
    study: {
      // 刷单词的作答方式：choice 选义 | spell 拼写 | self 自评
      drillMode: 'choice',
      // 翻译练习的作答方式：choice 选择题 | input 手动输入
      practiceMode: 'choice'
    },
    // 朗读偏好
    voice: {
      chineseRead: true,   // 自动朗读中文
      englishRead: true,   // 自动朗读英文
      speed: 1.0,          // 本地语音语速（原生/有道）
      engine: 'auto',      // 整句朗读引擎：auto 系统优先 / native 只用系统 / online 只用在线
      useAI: false,        // 是否启用云端 AI 朗读
      sfx: true            // 答题音效（答对/半对/答错各一声，见 utils/sfx.js）
    },
    // AI 服务配置（统一服务层读取）
    ai: {
      enabled: false,
      provider: 'openai',  // openai | custom（均为 OpenAI 兼容接口）
      baseURL: '',
      apiKey: '',
      model: '',           // 大模型（例句生成），空则用环境变量默认
      ttsModel: '',        // 语音模型，空则默认 tts-1
      ttsVoice: 'alloy',   // 音色
      ttsSpeed: 1.0,       // 云端语速
      customTTS: false     // 仅 provider=custom 时生效：用户声明该地址提供 /audio/speech
    }
  };
}

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return Array.isArray(over) ? over.slice() : base;
  if (typeof base === 'object' && base !== null && typeof over === 'object' && over !== null) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(k => {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }
  return over;
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && typeof v === 'object') {
      const st = deepMerge(defaults(), v);
      // 迁移：老版本把默认昵称写死成「学习者」，改默认值后老数据不会自动跟着变，
      // 所以读档时兜一次 —— 只动"从没改过昵称 / 昵称为空"的那批，
      // 用户自己设过的名字一律不动。
      const nick = st.profile && typeof st.profile.nickname === 'string'
        ? st.profile.nickname.trim() : '';
      if (!nick || nick === LEGACY_NICKNAME) {
        st.profile = Object.assign({}, st.profile, { nickname: DEFAULT_NICKNAME });
        cache = st;
        save();
      }
      return st;
    }
  } catch (e) {
    console.error('读取设置失败', e);
  }
  return defaults();
}

function init() {
  cache = load();
  if (!cache.profile.account) {
    cache.profile.account = 'local_' + Math.random().toString(36).slice(2, 10);
    save();
  }
}

function get() {
  if (!cache) cache = load();
  return cache;
}

function save() {
  try { uni.setStorageSync(KEY, cache); } catch (e) { console.error('保存设置失败', e); }
}

// patch 形式更新（浅层合并即可，调用方传完整子对象）
function set(patch) {
  const next = deepMerge(get(), patch);
  cache = next;
  save();
  return next;
}

function reset() {
  cache = defaults();
  try { uni.removeStorageSync(KEY); } catch (e) {}
  // 重置后补一个本地账号
  init();
  return cache;
}

// ---------- 收藏 ----------
function favorites() {
  return get().favorites || [];
}

function isFavorite(type, id) {
  return favorites().some(f => f.type === type && f.id === id);
}

function addFavorite(item) {
  const list = favorites();
  if (list.some(f => f.type === item.type && f.id === item.id)) return list;
  list.push(item);
  set({ favorites: list });
  return list;
}

function removeFavorite(type, id) {
  const list = favorites().filter(f => !(f.type === type && f.id === id));
  set({ favorites: list });
  return list;
}

function toggleFavorite(item) {
  return isFavorite(item.type, item.id) ? removeFavorite(item.type, item.id) : addFavorite(item);
}

/**
 * 读一个"枚举型学习偏好"（settings.study.*）。
 * 存档里的值可能是旧版本写的、也可能被手改脏了 —— 不在 allowed 里就一律回落到 fallback，
 * 绝不让脏值漏进界面（否则会出现三种作答方式一个都没选中的空白态）。
 * @param {string} key study 下的键名
 * @param {string[]} allowed 允许值
 * @param {string} fallback 兜底值（调用方保证它一定在 allowed 里）
 */
function studyMode(key, allowed, fallback) {
  let v = '';
  try { v = String((get().study || {})[key] || ''); } catch (e) { v = ''; }
  return allowed.indexOf(v) >= 0 ? v : fallback;
}

export {
  init, get, set, save, reset,
  defaults,
  favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite,
  studyMode
};
