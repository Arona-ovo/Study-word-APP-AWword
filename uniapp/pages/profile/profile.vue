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
      <!-- 头像可点：直接换（用户反馈「不能改图片」。
           本来只有昵称/签名能编辑，头像压根没有入口） -->
      <view class="avatar-hit" @tap="chooseAvatar">
        <image class="avatar" :src="avatarSrc" mode="aspectFit" />
      </view>
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
      <!-- 头像：这里是"能改头像"的正经入口 —— 光把左上角那张图做成可点，
           新用户不会想到去点它（用户反馈「用户不能改图片」就是这么来的） -->
      <view class="field field-tap" @tap="chooseAvatar">
        <text class="field-label">{{ $t('头像') }}</text>
        <view class="field-avatar-box">
          <image class="field-avatar" :src="avatarSrc" mode="aspectFit" />
        </view>
        <text class="field-pick">{{ $t('相册 / 拍照 ›') }}</text>
      </view>
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
      <!-- 换过才给"恢复默认"：否则那一栏永远是死的，反而让人以为默认图被换了 -->
      <text v-if="profile.avatar" class="avatar-reset" @tap="resetAvatar">{{ $t('恢复默认头像') }}</text>
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
        <!-- 有新版本可更新时的红点。只在真的有更新时才出现（入口类 UI 不藏起来，
             但也不该凭空挂一个假的） -->
        <view v-if="updateDot" class="menu-dot"></view>
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
import * as updater from '../../utils/updater.js'
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
      // 「设置」入口的红点：有新版本待更新（utils/updater.js 的 pending 标记）
      updateDot: false,
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
      // 没设过头像就用本地默认图：**整幅**看板娘缩进方框（1024 原画等比缩到 86%），
      // 配合上面的 mode="aspectFit" —— 圆框里呈现的是完整的一幅，不裁不放大。
      //
      // 历史（别走回头路）：
      //   · 最早直接用 static/mascot.jpg（800x480 横图）→ aspectFill 裁中间方块，
      //     人物又小又偏，光环和蝴蝶结都被切掉；
      //   · 然后改成专门裁一张方形头像（把脸摆圆心）→ 用户反馈「默认图片显示偏大」，
      //     裁切=放大，画面顶到圆的边缘，头上的蝴蝶结尖 / 右上光环 / 左下围裙都在圆外；
      //   · 现在是"整幅缩进去不裁切"（_tools/gen-avatar.py 的 FIT 模式）。
      // 所以：既别换回 mascot.jpg，也别把 gen-avatar.py 改回裁切。
      return this.profile.avatar || '/static/avatar-default.jpg'
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 红点每次进「我的」都重读：装完新版本后 pending 会自动失效（版本号不再比本机新），
    // 红点自己就消失了 —— 不需要在别处再记一笔"已经看过"。
    this.updateDot = updater.hasPending()
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
    /**
     * 换头像：相册或拍照 → 落到本机 → 写进 profile.avatar。
     *
     * 为什么不写成"进 draft、跟昵称一起保存"：
     * 头像是个有副作用的重动作（拉起相册），用户选完图却还要再点一次「保存」才生效，
     * 会觉得"选了没用"；而它是**立刻可见**的图，取消反而更奇怪。
     * 所以它走自己的立即生效路径，昵称/签名仍走 draft。
     *
     * chooseImage 给的是临时路径，App 重启后可能被清掉，所以先 saveFile 落到
     * 本机的持久目录（与 services/image-gen.js 落图同一套路）；存不下就先用临时路径，
     * 本次会话可见 —— 总比什么都不显示强。
     */
    chooseAvatar() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (r) => {
          const tmp = (r && r.tempFilePaths && r.tempFilePaths[0]) || ''
          if (!tmp) return
          try {
            uni.saveFile({
              tempFilePath: tmp,
              success: (s) => this.setAvatar((s && s.savedFilePath) || tmp),
              fail: () => this.setAvatar(tmp)
            })
          } catch (e) {
            this.setAvatar(tmp)
          }
        },
        fail: () => { /* 用户取消选图，静默 */ }
      })
    },
    /** 落盘 + 立刻刷新（profile.avatar 是 computed avatarSrc 的源） */
    setAvatar(path) {
      const p = String(path || '').trim()
      if (!p) return
      settings.set({ profile: { avatar: p } })
      this.refresh()
      uni.showToast({ title: t('已更新头像'), icon: 'success' })
    },
    /**
     * 恢复默认头像。
     * 注意 settings.set() 是**深合并**（项目约定 14）：想恢复默认必须显式写回目标值
     * （空串 = 没设过头像 → avatarSrc 回落 static/avatar-default.jpg），
     * 靠"删掉这个 key"是删不掉的。
     */
    resetAvatar() {
      settings.set({ profile: { avatar: '' } })
      this.refresh()
      uni.showToast({ title: t('已恢复默认头像'), icon: 'none' })
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
  /* aspectFit 会留边，底色要和卡片同一族（默认图自带一圈同色留白，看不出接缝） */
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
}

/* 头像可点：给个按压缩放，别让人以为那是张纯展示的图 */
.avatar-hit {
  flex-shrink: 0;
  transition: transform 140ms ease;
}

.avatar-hit:active { transform: scale(0.94); }

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

/* 头像那一行：点整行都能换（不只是那个小圆图），比抠 68rpx 的小目标好点得多 */
.field-tap {
  padding: 8rpx 0;
  border-radius: 16rpx;
}

.field-tap:active { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05); }

.field-avatar-box {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
}

.field-avatar { width: 100%; height: 100%; border-radius: 50%; }

.field-pick {
  margin-left: 20rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.avatar-reset {
  display: block;
  margin-top: 18rpx;
  text-align: center;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

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

/* 「设置」入口的更新红点：8px 实心圆点，不写数字 ——
   它只表达"这儿有新东西"，具体是几版用户点进去看（设置页那两行有文字角标）。 */
.menu-dot {
  flex-shrink: 0;
  width: 16rpx;
  height: 16rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #e5484d;
}

.menu-main { flex: 1; min-width: 0; }

.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; }
.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.menu-disabled .menu-title { color: #b0b7b2; }

.menu-disabled .menu-arrow { color: #dfe3e0; }
</style>
