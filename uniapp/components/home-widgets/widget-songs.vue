<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('今日歌曲') }}</text>
      <text class="wdg-link" @tap="nextBatch">{{ $t('换一批 ›') }}</text>
    </view>

    <block v-if="list.length">
      <view class="sg-item" v-for="(it, i) in list" :key="i" @tap="copySong(it)">
        <view class="sg-top">
          <text class="sg-name">{{ it.song }}</text>
          <text class="sg-kind" v-if="it.kind === 'exact'">{{ $t('同名') }}</text>
        </view>
        <text class="sg-artist">{{ it.artist }}</text>
        <view class="sg-word" @tap.stop="say(it.word)">
          <text class="sg-w">{{ it.word }}</text>
          <text class="sg-m" v-if="it.mean">{{ it.mean }}</text>
        </view>
      </view>
      <!-- 版权边界写给用户看：这条说明本身就是功能的一部分，别删 -->
      <text class="wdg-foot">{{ footText }}</text>
    </block>

    <view v-else class="sg-empty">
      <text class="sg-empty-text">{{ $t('这本词书暂时配不出歌名') }}</text>
      <text class="sg-empty-hint">{{ $t('多背几个词，或者换一本词书试试') }}</text>
    </view>
  </view>
</template>

<script lang="ts">
// 首页小组件：今日歌曲
//
// 干什么：从**当前词书**里挑出几个"正好是某首英文歌歌名（或出现在歌名里）"的词，
//         每天推 3 首，用一首歌帮着记住一个词。
//
// 边界（改这个组件前请先看 data/song-links.js 的头部注释）：
//   · 歌名来自内置表，**不交给 AI 现编** —— 编出来的歌搜不到，比没有更伤
//   · 只给「歌名 + 演唱者」，不播放、不给歌词、不给封面（那三样各有各的权利人）
//   · 歌名表是死的，所以用「已学过的词」做匹配池，而不是「今天背的词」——
//     今天背的十几个词里大概率一个都配不上歌，卡片会开天窗
import { t } from '../../utils/i18n.js';
import * as wordbook from '../../utils/wordbook';
import * as songLinks from '../../data/song-links.js';
import { speakWord } from '../../services/voice.js';

// 刷新批次：同一天内点「换一批」才递增，跨天自动归零（新的一天就该是新的一批）。
// 放在组件实例上而不是模块级：卡片卸载后没理由还记着上一次刷到第几批。
const WANT = 3;

export default {
  name: 'WidgetSongs',
  data() {
    return {
      list: [] as Array<{ word: string; mean: string; song: string; artist: string; kind: string }>,
      day: '',
      offset: 0,
      footText: ''
    };
  },
  created() {
    this.refresh();
    // 刷完一组词回首页，「已学过的词」变多了 —— 重算一次，让新词有机会进推荐
    try { uni.$on('home:refresh', this.refresh); } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh); } catch (e) {}
  },
  methods: {
    today() {
      const d = new Date();
      const p = (n: number) => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    refresh() {
      try {
        const now = this.today();
        if (now !== this.day) {
          this.day = now;
          this.offset = 0; // 换天了，批次从头开始
        }
        const v: any = wordbook.bookVocab();
        const all: any[] = (v && v.list) || [];
        // 匹配池：已学过的词优先；一个都配不上（比如刚建的空词书）才退回整本书
        const learned = all.filter((x: any) => x.status && x.status !== 'new');
        let picked = songLinks.recommend(learned, WANT, this.seed());
        if (!picked.length) picked = songLinks.recommend(all, WANT, this.seed());
        this.list = picked.map((x: any) => ({
          word: x.word,
          mean: x.mean || '',
          song: x.song,
          artist: x.artist,
          kind: x.kind
        }));
        this.footText = t('只给歌名，不播放 · 点一下复制，去音乐 App 搜');
      } catch (e) {
        /* 词书读不出来就留空态，不影响首页其它卡片 */
      }
    },
    seed() {
      return this.day + (this.offset > 0 ? '#' + this.offset : '');
    },
    nextBatch() {
      this.offset++;
      const before = this.list.map((x: any) => x.song).join('|');
      this.refresh();
      // 池子太小，怎么刷都是同一批 —— 别让用户白点（提示一下，并且把 offset 留在原位）
      if (this.list.length && this.list.map((x: any) => x.song).join('|') === before) {
        this.offset--;
        uni.showToast({ title: t('能配上的歌就这几首，多背点词再来'), icon: 'none' });
      }
    },
    copySong(it: any) {
      const text = String((it && it.song) || '');
      if (!text) return;
      const full = text + (it && it.artist ? ' ' + it.artist : '');
      try {
        uni.setClipboardData({
          data: full,
          success: () => {
            uni.showToast({ title: t('已复制，去音乐 App 搜'), icon: 'none' });
          }
        });
      } catch (e) {
        uni.showToast({ title: full, icon: 'none' });
      }
    },
    // 方法名别和 import 进来的 speakWord 同名：简写方法不会遮蔽外层绑定，
    // 但读代码的人（包括下一个人）一眼看不出调的是谁 —— 这里就曾经差点写成自调
    say(w: string) {
      if (w) speakWord(w);
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.wdg-link { font-size: 22rpx; color: #1d4fd8; }
.wdg-link { font-size: 22rpx; color: var(--brand-strong, #1d4fd8); }

.sg-item {
  padding: 16rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
}

.sg-item:last-child { border-bottom: none; }

.sg-top { display: flex; align-items: center; }

.sg-name {
  font-size: 29rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.sg-kind {
  margin-left: 12rpx;
  font-size: 18rpx;
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}

.sg-artist {
  display: block;
  margin-top: 4rpx;
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.sg-word {
  display: flex;
  align-items: baseline;
  margin-top: 8rpx;
}

.sg-w {
  font-size: 24rpx;
  font-weight: 600;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.sg-m {
  margin-left: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wdg-foot {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sg-empty { padding: 24rpx 0 8rpx; }

.sg-empty-text {
  display: block;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.sg-empty-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
