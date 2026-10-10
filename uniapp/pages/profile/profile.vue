<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <float-navbar :title="$t('我的')" />

    <!-- 内容区：切 tab 时整体左右滑动 -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <!-- 个人信息卡 -->
    <view class="card profile-card">
      <image class="avatar" :src="avatarSrc" mode="aspectFill" />
      <view class="p-info">
        <view class="p-name">{{ profile.nickname }}</view>
        <view class="p-account">账号：{{ profile.account }}</view>
        <view class="p-bio" v-if="profile.bio">{{ profile.bio }}</view>
      </view>
      <text class="p-edit" @tap="startEdit">{{ $t('编辑资料 ›') }}</text>
    </view>

    <!-- 账号卡：未登录→登录/注册；已登录→账号名 + 退出登录 -->
    <view class="card account-card">
      <block v-if="account.logged">
        <view class="ac-main">
          <text class="ac-name">{{ account.username }}</text>
          <text class="ac-sub">{{ $t('本机账号 · 数据只存在这台设备') }}</text>
        </view>
        <text class="ac-action" @tap="doLogout">{{ $t('退出登录') }}</text>
      </block>
      <block v-else>
        <view class="ac-main">
          <text class="ac-name">{{ $t('未登录') }}</text>
          <text class="ac-sub">{{ $t('登录后学习记录与收藏会写入本机账号') }}</text>
        </view>
        <view class="ac-btn" @tap="goLogin">{{ $t('登录 / 注册') }}</view>
      </block>
    </view>

    <!-- 编辑资料（内联展开） -->
    <view v-if="editing" class="card edit-card">
      <view class="field">
        <text class="field-label">{{ $t('昵称') }}</text>
        <input class="field-input" :value="draft.nickname" maxlength="20" @input="e => draft.nickname = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">{{ $t('个性签名') }}</text>
        <input class="field-input" :value="draft.bio" maxlength="40" :placeholder="$t('一句话介绍自己')" @input="e => draft.bio = e.detail.value" />
      </view>
      <view class="edit-actions">
        <button class="btn-ghost cancel-btn" @tap="cancelEdit">{{ $t('取消') }}</button>
        <button class="btn-primary save-btn" @tap="saveEdit">{{ $t('保存') }}</button>
      </view>
    </view>

    <!-- 学习数据条 -->
    <view class="card stat-strip">
      <view class="st-item">
        <text class="st-num">{{ overview.mastered }}</text>
        <text class="st-label">{{ $t('已掌握') }}</text>
      </view>
      <view class="st-item">
        <text class="st-num">{{ overview.streak }}</text>
        <text class="st-label">{{ $t('连续天') }}</text>
      </view>
      <view class="st-item">
        <text class="st-num">{{ overview.wrongCount }}</text>
        <text class="st-label">{{ $t('待复习') }}</text>
      </view>
    </view>

    <!-- 功能入口 -->
    <view class="card menu-card">
      <view class="menu-item" @tap="goStats">
        <text class="menu-title">{{ $t('学习记录') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="goReview">
        <text class="menu-title">{{ $t('我的错题') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgStudy/pages/favorites/favorites')">
        <text class="menu-title">{{ $t('我的收藏') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" :class="{ 'menu-disabled': !aiEnabled }" @tap="goChat">
        <view class="menu-main">
          <text class="menu-title">{{ $t('AI 对话陪练') }}</text>
          <text class="menu-hint" v-if="!aiEnabled">{{ aiReason }}</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgManage/pages/settings/settings')">
        <text class="menu-title">{{ $t('设置') }}</text>
        <text class="menu-arrow">›</text>
      </view>
    </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="profile" />
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
import * as settings from '../../utils/settings'
import * as wordbook from '../../utils/wordbook'
import * as auth from '../../services/auth'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import { aiGateReason } from '../../services/config.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

// 未设置昵称时的默认显示（与 utils/settings.js 的 defaults().profile.nickname 保持一致）
const DEFAULT_NICKNAME = 'arona'

export default {
  components: { FloatTabbar, FloatNavbar },
  mixins: [tabSlideMixin('profile')],
  data() {
    return {
      profile: { avatar: '', nickname: DEFAULT_NICKNAME, account: '', bio: '' },
      overview: { mastered: 0, streak: 0, wrongCount: 0 },
      editing: false,
      draft: { nickname: '', bio: '' },
      aiEnabled: false,
      aiReason: '',
      account: { logged: false, username: '' }
    }
  },
  computed: {
    avatarSrc() {
      // 没设过头像就用本地默认图：512x512 正方形（圆的看板娘脸），
      // 不能用 static/mascot.jpg —— 那是 800x480 横图，塞进 110rpx 正圆会被 aspectFill 裁烂。
      return this.profile.avatar || '/static/avatar-default.jpg'
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    this.refresh()
    // 订阅登录态：登录页登录成功后这里能立刻更新（不依赖页面重新加载）
    if (!this.__authOff) {
      this.__authOff = auth.onChange(() => {
        this.account = this.readAccount()
      })
    }
  },
  onUnload() {
    if (this.__authOff) { this.__authOff(); this.__authOff = null }
  },
  methods: {
    readAccount() {
      const u = auth.currentUser()
      return u ? { logged: true, username: u.nickname || u.username } : { logged: false, username: '' }
    },
    goLogin() {
      uni.navigateTo({ url: '/pkgManage/pages/login/login' })
    },
    async doLogout() {
      try {
        const s = auth.session()
        await auth.logout()
        this.account = { logged: false, username: '' }
        uni.showToast({ title: s ? t('已退出登录') : t('当前未登录'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: t('退出失败'), icon: 'none' })
      }
    },
    refresh() {
      this.account = this.readAccount()
      this.profile = Object.assign({}, settings.get().profile)
      const ov = wordbook.homeOverview()
      this.overview = {
        mastered: ov.mastered,
        streak: ov.streak,
        wrongCount: ov.wrongCount
      }
      const r = aiGateReason()
      this.aiReason = r
      this.aiEnabled = !r
    },
    startEdit() {
      this.draft = { nickname: this.profile.nickname, bio: this.profile.bio }
      this.editing = true
    },
    cancelEdit() {
      this.editing = false
    },
    saveEdit() {
      const nickname = String(this.draft.nickname || '').trim()
      if (!nickname) {
        uni.showToast({ title: t('昵称不能为空'), icon: 'none' })
        return
      }
      settings.set({ profile: { nickname, bio: String(this.draft.bio || '').trim() } })
      this.editing = false
      this.refresh()
      uni.showToast({ title: t('已保存'), icon: 'success' })
    },
    goStats() {
      uni.navigateTo({ url: '/pkgStudy/pages/stats/stats' })
    },
    goReview() {
      // 错题是 tabBar 页面，需 switchTab
      uni.switchTab({ url: '/pages/review/review' })
    },
    goChat() {
      if (!this.aiEnabled) {
        uni.showToast({ title: t('请先在设置中完成 AI 配置（') + this.aiReason + '）', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pkgManage/pages/chat/chat' })
    },
    go(url) {
      uni.navigateTo({ url })
    }
  }
}
</script>

<style>
.profile-card {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.avatar {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(255, 255, 255, 0.8);
  border: 3rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  flex-shrink: 0;
  background: #e4e9e4;
}

.p-info { flex: 1; margin-left: 26rpx; min-width: 0; }

.p-name {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.p-account { margin-top: 8rpx; font-size: 22rpx; color: #98a19b; }
.p-account { margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.p-bio {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-edit { font-size: 26rpx; color: #1d4fd8; flex-shrink: 0; }
.p-edit { font-size: 26rpx; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }

/* 账号卡 */
.account-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.ac-main { flex: 1; min-width: 0; }

.ac-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ac-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ac-btn {
  flex-shrink: 0;
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 14rpx 36rpx;
}

.ac-action {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.edit-card { margin-bottom: 20rpx; }

.field { display: flex; align-items: center; margin-bottom: 20rpx; }

.field-label { width: 140rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 140rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

.field-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.edit-actions { display: flex; }

.cancel-btn { width: 30%; margin-right: 20rpx; height: 80rpx; font-size: 28rpx; }

.save-btn { flex: 1; height: 80rpx; font-size: 28rpx; }

.stat-strip { display: flex; padding: 30rpx 0; margin-bottom: 20rpx; }

.st-item { flex: 1; display: flex; flex-direction: column; align-items: center; }

.st-num { font-size: 38rpx; font-weight: 700; color: #2e6bff; }
.st-num { font-size: 38rpx; font-weight: 700; color: var(--brand, #2e6bff); }

.st-label { font-size: 22rpx; color: #5a6560; margin-top: 6rpx; }
.st-label { font-size: 22rpx; color: var(--ink-2, #5a6560); margin-top: 6rpx; }

.menu-card { padding: 8rpx 36rpx; }

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.menu-item:last-child { border-bottom: none; }

.menu-title { font-size: 30rpx; color: #17201a; }
.menu-title { font-size: 30rpx; color: var(--ink-1, #17201a); }

.menu-arrow { font-size: 32rpx; color: #c8cdc9; }

.menu-main { flex: 1; min-width: 0; }

.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; }
.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.menu-disabled .menu-title { color: #b0b7b2; }

.menu-disabled .menu-arrow { color: #dfe3e0; }
</style>
