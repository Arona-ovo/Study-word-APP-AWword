<template>
  <!-- 搜索历史：刚点开搜索框、还没打字时给的一屏"最近查过"，
       省得想再查同一个词还要重新拼一遍拼写 -->
  <view v-if="items.length" class="sh">
    <view class="sh-head">
      <text class="sh-title">{{ $t('搜索历史') }}</text>
      <text class="sh-clear" @tap="clearAll">{{ $t('清空') }}</text>
    </view>
    <view class="sh-list">
      <view v-for="(it, i) in items" :key="i" class="sh-chip" @tap="pick(i)">
        <text class="sh-word">{{ it.w }}</text>
        <!-- × 是"删掉这一条"，不是"查这个词"：必须 .stop，否则会顺手搜一遍 -->
        <text class="sh-del" @tap.stop="del(i)">×</text>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js'
import * as history from '../../utils/search-history.js'

/**
 * 「最近查过」标签云（首页搜索面板 / 做题页顶栏查词共用）。
 *
 * 数据存在本机（utils/search-history.js），组件只负责显示与增删：
 * 父组件在记了一笔之后调 refresh() 就能同步过来。
 * 一条都没有时整块不渲染 —— 空占位只会占掉结果的位置。
 */
export default {
  name: 'SearchHistory',
  data() {
    return { items: [] }
  },
  created() {
    this.refresh()
  },
  methods: {
    refresh() {
      try { this.items = history.list() || [] } catch (e) { this.items = [] }
    },
    pick(i) {
      const it = this.items[i]
      if (!it || !it.w) return
      this.$emit('pick', it.w)
    },
    del(i) {
      const it = this.items[i]
      if (!it || !it.w) return
      try { history.remove(it.w) } catch (e) { /* 删不掉就让它留着 */ }
      this.refresh()
    },
    clearAll() {
      try { history.clear() } catch (e) { /* 同上 */ }
      this.refresh()
      try {
        uni.showToast({ title: t('已清空搜索历史'), icon: 'none' })
      } catch (e) { /* 没 toast 也不影响 */ }
    }
  }
}
</script>

<style scoped>
.sh {
  padding: 4rpx 0 8rpx;
}

.sh-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4rpx;
}

.sh-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sh-clear {
  padding: 6rpx 8rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.sh-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

/* 胶囊标签：一行排不下自动换行，比竖列表省地方（点开搜索框第一眼要看完） */
.sh-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 12rpx 16rpx 0 0;
  padding: 12rpx 18rpx 12rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

.sh-chip:active { opacity: 0.6; }

.sh-word {
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
}

.sh-del {
  margin-left: 12rpx;
  padding: 0 6rpx;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
