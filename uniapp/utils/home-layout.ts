// utils/home-layout.ts - 首页模块（桌面式小组件）的顺序与收纳
//
// 职责：
//   · 维护一张「模块注册表」：首页能放的组件就这些，加新组件只改这里
//   · 读写用户的首页布局（顺序）与收纳区（未放进首页的模块）
//   · 持久化挂在 settings 里（utils/settings.js），与学习进度互不干扰
//
// 收纳区不单独存：stashed = 所有模块 - 当前布局，避免两份状态对不上。
import * as settings from './settings.js';

export interface HomeModule {
  id: string;
  name: string;
  desc: string;
  /** 是否默认就在首页里 */
  def: boolean;
}

/** 首页可选组件（顺序 = 首次进入的默认顺序） */
export const MODULES: HomeModule[] = [
  { id: 'book', name: '当前词书', desc: '词书名、当前批次进度与全书记忆量', def: true },
  { id: 'action', name: '学习入口', desc: '开始 / 继续背单词、复习错题、AI 专练', def: true },
  { id: 'worddrill', name: '刷单词', desc: '独立的背单词入口：选义 / 拼写 / 自评，与刷题句子分开', def: true },
  { id: 'chat', name: 'AI 对话陪练', desc: '用英文和 AI 自由聊，聊到的好句子能收进收藏', def: true },
  { id: 'stats', name: '今日数据', desc: '已练习 / 待复习 / 连续天数，可点进详情', def: true },
  { id: 'goal', name: '每日目标', desc: '今日新词 / 学会进度，可点进去改目标', def: true },
  { id: 'chart', name: '打卡走势', desc: '股票式折线图：背了就涨、没背就跌，可切 7/30 天', def: true },
  { id: 'usage', name: '停留时长', desc: '今日在 App 里待了多久 · 圆环一整圈 = 1 小时', def: true },
  { id: 'songs', name: '今日歌曲', desc: '词书里的词配上真实英文歌名，每天 3 首，可换一批', def: true },
  { id: 'progress', name: '掌握度概览', desc: '已学 / 已掌握 / 全书进度条', def: false },
  { id: 'favorites', name: '收藏速览', desc: '收藏数量与最近收藏的几个词', def: false },
  { id: 'streak', name: '打卡周历', desc: '近 7 天的打卡圆点与当前连续天数', def: false }
];

const IDS: string[] = MODULES.map(m => m.id);

export function defaultLayout(): string[] {
  return MODULES.filter(m => m.def).map(m => m.id);
}

export function moduleOf(id: string): HomeModule | null {
  for (const m of MODULES) {
    if (m.id === id) return m;
  }
  return null;
}

export function normalize(list: any): string[] {
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  for (const id of arr) {
    const key = String(id || '');
    if (IDS.indexOf(key) >= 0 && out.indexOf(key) < 0) out.push(key);
  }
  // 兜底：被清空或全是非法值时，恢复默认布局，避免首页变成空白
  return out.length ? out : defaultLayout();
}

/** 当前布局（已归一） */
export function layout(): string[] {
  const st: any = settings.get() || {};
  const home = st.home || {};
  return normalize(home.layout);
}

/** 保存布局，返回归一后的结果 */
export function saveLayout(list: string[]): string[] {
  const next = normalize(list);
  settings.set({ home: { layout: next } });
  return next;
}

/** 收纳区：没被放进首页的模块 */
export function stashed(): HomeModule[] {
  const cur = layout();
  return MODULES.filter(m => cur.indexOf(m.id) < 0);
}

/** 把模块移出首页（收纳） */
export function stash(id: string): string[] {
  const cur = layout().filter(x => x !== id);
  return saveLayout(cur);
}

/** 从收纳区加回首页（追加到末尾） */
export function restore(id: string): string[] {
  const cur = layout();
  if (cur.indexOf(id) >= 0) return cur;
  cur.push(id);
  return saveLayout(cur);
}

/**
 * 拖拽落点：根据手指位移 dy（px，正=向下）与各模块实际高度，算出松手后应落在第几位。
 * 纯函数，不碰 DOM，方便单测；页面只需把 touchmove 的位移喂进来。
 */
export function dropIndex(from: number, dy: number, heights: number[]): number {
  const hs = Array.isArray(heights) ? heights : [];
  const n = hs.length;
  if (!n || from < 0 || from >= n || !dy) return from;
  let to = from;
  if (dy > 0) {
    let s = 0;
    for (let i = from + 1; i < n; i++) {
      s += hs[i - 1];
      // 越过目标一半高度即认为该换位
      if (dy > s - hs[from] / 2 + hs[i] / 2) to = i;
      else break;
    }
  } else {
    let s = 0;
    for (let i = from - 1; i >= 0; i--) {
      s += hs[i + 1];
      if (-dy > s - hs[from] / 2 + hs[i] / 2) to = i;
      else break;
    }
  }
  return to;
}

/** 拖拽换位：把 from 位置移动到 to 位置 */
export function move(from: number, to: number): string[] {
  const cur = layout();
  if (from < 0 || from >= cur.length) return cur;
  if (to < 0) to = 0;
  if (to >= cur.length) to = cur.length - 1;
  if (from === to) return cur;
  const item = cur.splice(from, 1)[0];
  cur.splice(to, 0, item);
  return saveLayout(cur);
}

export { settings };
