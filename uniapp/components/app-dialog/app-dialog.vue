<template>
  <view class="pop-mask" v-if="show" @tap="onMaskTap">
    <view class="pop-card" @tap.stop="noop">
      <view class="dlg-title" v-if="title">{{ title }}</view>
      <view class="dlg-content" v-if="content">{{ content }}</view>

      <!-- 输入模式 -->
      <input
        v-if="mode === 'input'"
        class="dlg-input"
        :value="draft"
        :focus="show"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :password="password"
        @input="onInput"
        @confirm="onConfirm"
      />

      <view class="dlg-err" v-if="error">{{ error }}</view>

      <!-- 操作菜单模式 -->
      <view class="dlg-sheet" v-if="mode === 'sheet'">
        <view
          v-for="(it, i) in normItems"
          :key="i"
          class="dlg-sheet-item"
          :class="{ danger: it.danger, multi: multi, picked: multi && picked[i] }"
          hover-class="dlg-sheet-hover"
          :hover-stay-time="60"
          @tap="pick(i)"
        >
          <text class="dlg-sheet-label">{{ it.label }}</text>
          <view v-if="multi" class="dlg-check" :class="{ on: picked[i] }">
            <text class="dlg-check-mark" v-if="picked[i]">✓</text>
          </view>
        </view>
      </view>

      <!-- 底部按钮：确认 / 危险确认 / 仅提示（multi 菜单也需要确认按钮） -->
      <view class="dlg-btns" v-if="mode !== 'sheet' || multi">
        <view
          v-if="btnMode !== 'alert'"
          class="dlg-btn ghost"
          hover-class="dlg-btn-ghost-hover"
          :hover-stay-time="60"
          @tap="onCancel"
        >{{ cancelText }}</view>
        <view
          class="dlg-btn"
          :class="danger ? 'danger' : 'primary'"
          :style="btnMode === 'alert' ? 'flex:1;' : ''"
          hover-class="dlg-btn-solid-hover"
          :hover-stay-time="60"
          @tap="onConfirm"
        >{{ confirmText }}</view>
      </view>

      <!-- 菜单模式的取消（multi 走上面的按钮行，不重复显示） -->
      <view class="dlg-sheet-cancel" v-if="mode === 'sheet' && !multi">
        <view
          class="dlg-btn ghost"
          hover-class="dlg-btn-ghost-hover"
          :hover-stay-time="60"
          @tap="onCancel"
        >{{ $t('取消') }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
// components/app-dialog/app-dialog.vue - 全 App 统一的弹窗
//
// 为什么不用 uni.showModal / showActionSheet：
//   这两个 API 在 App 端走的是原生弹窗，样式由系统决定，和项目这套
//   「毛玻璃卡片 + 发丝边 + 大圆角」的视觉完全脱节；而且无法定制危险色、
//   无法在弹窗里放输入框（新建/重命名词书当初只能自己再写一套 pop-card）。
//   结果就是 App 里并存两套风格：一半系统弹窗、一半自绘弹窗。
//
// 统一成一个组件后：确认框 / 操作菜单 / 输入框共用同一张卡片，
//   危险操作统一用 --danger 色，视觉与卡片、胶囊完全一致。
//
// 用法：
//   <app-dialog
//     :show="dlg.show" :mode="dlg.mode"        // confirm | sheet | input
//     :title="dlg.title" :content="dlg.content"
//     :confirm-text="dlg.confirmText" :cancel-text="dlg.cancelText"
//     :danger="dlg.danger" :items="dlg.items"
//     :value="dlg.value" :placeholder="dlg.placeholder" :error="dlg.error"
//     :btn-mode="dlg.btnMode" :password="dlg.password" :maxlength="dlg.maxlength"
//     @confirm="onConfirm" @cancel="onCancel" @input="onInput" />
//
// confirm 事件载荷随 mode 变化：sheet → 下标(number)，input → 文本(string)，confirm → true
export default {
  name: 'AppDialog',
  props: {
    show: { type: Boolean, default: false },
    // confirm = 双按钮确认框；sheet = 操作菜单；input = 带输入框的弹窗
    mode: { type: String, default: 'confirm' },
    // alert = 只有一个「好的」按钮（提示用，不可取消）
    btnMode: { type: String, default: 'confirm' },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    confirmText: { type: String, default: t('确定') },
    cancelText: { type: String, default: t('取消') },
    danger: { type: Boolean, default: false },
    items: { type: Array, default: () => [] },
    // 多选菜单：项可勾选切换（初始勾选态读 items[i].checked），
    // 点按只切换不关弹窗，确认时回传选中下标数组
    multi: { type: Boolean, default: false },
    value: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    error: { type: String, default: '' },
    // 输入模式：掩码输入（备份密码这类）。默认明文 —— 大多数输入框输的是名字。
    password: { type: Boolean, default: false },
    maxlength: { type: Number, default: 24 },
    // 点遮罩是否关闭（确认框默认不关，避免误触；菜单默认关）
    maskClosable: { type: Boolean, default: false },
    // 每次打开 +1：组件用 v-if 挂载，从"菜单"直接切到"输入框"时不会重新挂载，
    // 光靠 show / value 的 watch 可能同步不到（值恰好没变时），用它兜底。
    seq: { type: Number, default: 0 }
  },
  data() {
    return { draft: '', picked: {} }
  },
  computed: {
    normItems() {
      return (this.items || []).map(it =>
        typeof it === 'string' ? { label: it, danger: false } : { label: it.label, danger: !!it.danger }
      )
    }
  },
  watch: {
    // 每次弹出时把外部传入的值同步进输入框（编辑场景要带出旧名字）；
    // 多选菜单则按 items[].checked 重置勾选态
    show(v) {
      if (v) {
        this.draft = String(this.value || '')
        this.syncPicked()
      }
    },
    value(v) {
      this.draft = String(v || '')
    },
    seq() {
      this.draft = String(this.value || '')
      this.syncPicked()
    }
  },
  methods: {
    noop() {},
    syncPicked() {
      if (!this.multi) return
      const p = {}
      ;(this.items || []).forEach((it, i) => {
        if (it && typeof it === 'object' && it.checked) p[i] = true
      })
      this.picked = p
    },
    onInput(e) {
      const v = String((e && e.detail && e.detail.value) || '')
      this.draft = v
      this.$emit('input', v)
      return v
    },
    pick(i) {
      // 多选菜单：只切换勾选态，不关弹窗；确认时统一回传
      if (this.multi) {
        const p = Object.assign({}, this.picked)
        if (p[i]) delete p[i]
        else p[i] = true
        this.picked = p
        return
      }
      this.$emit('confirm', i)
    },
    onConfirm() {
      if (this.mode === 'sheet' && !this.multi) return
      if (this.multi) {
        const sel = []
        ;(this.items || []).forEach((it, i) => { if (this.picked[i]) sel.push(i) })
        this.$emit('confirm', sel)
        return
      }
      this.$emit('confirm', this.mode === 'input' ? String(this.draft || '') : true)
    },
    onCancel() {
      this.$emit('cancel')
    },
    onMaskTap() {
      if (!this.maskClosable) return
      this.$emit('cancel')
    }
  }
}
</script>

<style>
/* ===== 统一弹窗视觉 =====
   与 .card / .glass 同一套令牌：半透明表面 + backdrop-filter 模糊 +
   发丝边 + 大圆角 + 投影。所有页面的确认框 / 菜单 / 输入框都复用这里。 */
.dlg-content {
  margin-top: 18rpx;
  font-size: 26rpx;
  line-height: 1.65;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  text-align: center;
}

/* 操作菜单 */
.dlg-sheet {
  margin-top: 26rpx;
  border-radius: 20rpx;
  overflow: hidden;
  border: 2rpx solid rgba(23, 32, 26, 0.07);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}

.dlg-sheet-item {
  height: 92rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}

.dlg-sheet-item + .dlg-sheet-item {
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}

.dlg-sheet-item.danger {
  color: #e5484d;
  font-weight: 600;
}

.dlg-sheet-hover {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}

/* 多选菜单：文案靠左、勾选框靠右 */
.dlg-sheet-item.multi {
  justify-content: space-between;
  padding: 0 30rpx;
}

.dlg-sheet-item.multi .dlg-sheet-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  text-indent: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dlg-sheet-item.multi.picked .dlg-sheet-label {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  font-weight: 600;
}

.dlg-check {
  flex-shrink: 0;
  width: 38rpx;
  height: 38rpx;
  margin-left: 20rpx;
  border-radius: 10rpx;
  border: 3rpx solid rgba(23, 32, 26, 0.22);
  border: 3rpx solid var(--hairline-strong, rgba(23, 32, 26, 0.22));
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dlg-check.on {
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

.dlg-check-mark {
  font-size: 24rpx;
  font-weight: 600;
  color: #ffffff;
  line-height: 1;
}

.dlg-sheet-cancel {
  margin-top: 20rpx;
}

.dlg-btn-ghost-hover { opacity: 0.7; }
.dlg-btn-solid-hover { opacity: 0.85; }
</style>
