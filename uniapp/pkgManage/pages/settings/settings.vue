<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('设置')" />

    <!-- ===== 外观：深色 / 主题色 / 背景（大胶囊，默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'appearance' }">
      <view class="sec-head" data-k="appearance" @tap="toggleSec">
        <text class="sec-name">{{ $t('外观') }}</text>
        <text v-if="openSec !== 'appearance'" class="sec-hint">{{ secHint('appearance') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'appearance'">
        <view class="row" @tap="pickLocale">
          <view class="row-main">
            <text class="row-title">{{ $t('界面语言') }}</text>
            <text class="row-desc">{{ $t('切换后全界面文案跟随（单词释义不受影响）') }}</text>
          </view>
          <text class="row-value">{{ localeName }}</text>
        </view>
        <view class="sub-title">{{ $t('深色模式') }}</view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('深色模式') }}</text>
            <text class="row-desc">{{ darkHint }}</text>
          </view>
          <switch
            :checked="darkOn"
            :disabled="followSystem"
            :color="brandMain"
            @change="e => toggleDark(e.detail.value)"
          />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('跟随系统') }}</text>
            <text class="row-desc">系统切换深浅时自动同步（当前系统：{{ systemDark ? $t('深色') : $t('浅色') }}）</text>
          </view>
          <switch :checked="followSystem" :color="brandMain" @change="e => toggleFollow(e.detail.value)" />
        </view>

        <view class="sub-title">{{ $t('主题色') }}</view>
        <view class="accent-row">
          <view
            v-for="a in accents"
            :key="a.key"
            class="accent"
            :class="{ active: accentKey === a.key }"
            :data-k="a.key"
            @tap="pickAccent"
          >
            <view class="accent-dot" :style="{ background: a.main }"></view>
            <text class="accent-name">{{ a.name }}</text>
          </view>
        </view>

        <view class="sub-title">{{ $t('背景') }}</view>
        <view class="bg-row">
          <view
            v-for="b in backgrounds"
            :key="b.key"
            class="bg-chip"
            :class="{ active: bgKey === b.key && !bgImage }"
            :style="{ background: bgSwatch(b) }"
            :data-k="b.key"
            @tap="pickBg"
          ><text class="bg-chip-name">{{ b.name }}</text></view>
          <!-- 自定义色：色块直接显示用户挑的那个颜色（深色下显示压暗变体） -->
          <view
            class="bg-chip"
            :class="{ active: bgKey === 'custom' && !bgImage }"
            :style="{ background: customSwatch }"
            @tap="pickCustomBg"
          ><text class="bg-chip-name">{{ $t('自定义') }}</text></view>
          <view class="bg-chip pick" @tap="chooseBg"><text class="bg-chip-name">{{ $t('相册') }}</text></view>
        </view>

        <!-- 自定义底色：快捷色板 + 色相 / 饱和度 / 明度 三根滑杆 -->
        <view class="cp" v-if="bgKey === 'custom'">
          <view class="cp-head">
            <view class="cp-dot" :style="{ background: customSwatch }"></view>
            <text class="cp-hex">{{ customHex }}</text>
            <text class="cp-reset" @tap="resetCustom">{{ $t('恢复默认') }}</text>
          </view>
          <view class="cp-sw">
            <view
              v-for="c in swatches"
              :key="c"
              class="cp-sw-item"
              :class="{ on: c === customHex }"
              :style="{ background: c }"
              :data-c="c"
              @tap="pickSwatch"
            ></view>
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('色相') }}</text>
            <slider
              class="slider"
              :min="0" :max="360" :step="1"
              :value="hsl.h"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('h', e, false)"
              @change="e => onHsl('h', e, true)"
            />
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('饱和度') }}</text>
            <slider
              class="slider"
              :min="0" :max="100" :step="1"
              :value="hsl.s"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('s', e, false)"
              @change="e => onHsl('s', e, true)"
            />
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('明度') }}</text>
            <slider
              class="slider"
              :min="20" :max="96" :step="1"
              :value="hsl.l"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('l', e, false)"
              @change="e => onHsl('l', e, true)"
            />
          </view>
          <view class="bg-hint">{{ $t('只改背景底色，卡片的磨砂玻璃与文字配色不变。明度别压太低，否则深色文字会读不清。深色模式下会自动换成同色相的压暗版本，不会为了深色丢掉你挑的颜色。') }}</view>
        </view>

        <view class="bg-actions" v-if="bgImage">
          <text class="bg-path">{{ $t('正在使用自定义图片') }}</text>
          <text class="bg-clear" @tap="clearBg">{{ $t('恢复预设') }}</text>
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? $t('图片淡化') : $t('背景淡化') }}</text>
          <slider
            class="slider"
            :min="0"
            :max="0.7"
            :step="0.05"
            :value="mask"
            :active-color="brandMain"
            show-value
            @change="onMask"
          />
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? $t('图片模糊') : $t('背景模糊') }}</text>
          <slider
            class="slider"
            :disabled="smooth"
            :min="0"
            :max="24"
            :step="1"
            :value="blur"
            :active-color="brandMain"
            show-value
            @change="onBlur"
          />
        </view>
        <view class="bg-hint">{{ $t('背景在最底层且固定不动：上下滑动时只有卡片、胶囊这些窗体在动。玻璃窗体透出背景的同时仍与背景分层；"淡化"在深色模式下叠的是黑色，用来给背景降亮度。') }}</view>

        <!-- 练习页顶部那两条进度条的颜色：默认跟主题走（浅色 / 主题色），
             也可以让"已会"那条单独用绿色，两条靠色相而不是深浅区分 -->
        <view class="sub-title">{{ $t('练习进度条') }}</view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('两条进度条同色系') }}</text>
            <text class="row-desc">{{ $t('开启：已做用浅色、已会用主题色；关闭：已会改用绿色') }}</text>
          </view>
          <switch :checked="progressSync" :color="brandMain" @change="e => setProgressSync(e.detail.value)" />
        </view>
        <view class="pg-preview">
          <view class="pg-line">
            <text class="pg-k">{{ $t('已做') }}</text>
            <view class="progress-track pg-track">
              <view class="progress-fill pg-fill-done" :class="{ sync: progressSync }" style="width: 62%"></view>
            </view>
            <text class="pg-v">{{ $t('{n} 题', { n: 24 }) }}</text>
          </view>
          <view class="pg-line">
            <text class="pg-k">{{ $t('会了') }}</text>
            <view class="progress-track pg-track">
              <view class="progress-fill pg-fill-know" :class="{ sync: progressSync }" style="width: 38%"></view>
            </view>
            <text class="pg-v">{{ $t('{n} 题', { n: 9 }) }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ===== 流畅模式（低端机退路） ===== -->
    <view class="sec" :class="{ open: openSec === 'perf' }">
      <view class="sec-head" data-k="perf" @tap="toggleSec">
        <text class="sec-name">{{ $t('流畅模式') }}</text>
        <text v-if="openSec !== 'perf'" class="sec-hint">{{ secHint('perf') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'perf'">
        <!-- 画质档位：先按机器挑一档，下面三个维度还能单独微调 -->
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('画质档位') }}</text>
            <text class="row-desc">{{ qualityHint }}</text>
          </view>
        </view>
        <view class="seg-row">
          <view
            v-for="q in qualityList"
            :key="q.key"
            class="seg-item"
            :class="{ on: quality === q.key }"
            @tap="onQuality(q.key)"
          >{{ $t(q.name) }}</view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('毛玻璃') }}</text>
          <view class="seg-row">
            <view
              v-for="o in glassList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.glass === o.v }"
              @tap="onFx('glass', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('动效') }}</text>
          <view class="seg-row">
            <view
              v-for="o in motionList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.motion === o.v }"
              @tap="onFx('motion', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('阴影') }}</text>
          <view class="seg-row">
            <view
              v-for="o in shadowList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.shadow === o.v }"
              @tap="onFx('shadow', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('流畅模式') }}</text>
            <text class="row-desc">{{ $t('一键关掉全部特效：等价于切到「轻量」档，上面的细分会跟着重置') }}</text>
          </view>
          <switch :checked="smooth" :color="brandMain" @change="onSmooth" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('设备性能检测') }}</text>
            <text class="row-desc">{{ perfText }}</text>
          </view>
          <text class="row-action" @tap="reprobe">{{ $t('重新检测') }}</text>
        </view>
        <view class="bg-hint">{{ $t('只改变观感：背景与卡片依然半透明、分层的玻璃质感保留，只是不再逐帧实时模糊。不影响任何功能，也不会清除学习数据。背景是渐变时卡片本来就不做实时模糊（渐变模糊前后的观感一致），这笔开销全省掉了。') }}</view>
      </view>
    </view>

    <!-- ===== AI（大胶囊，连接参数默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'ai' }">
      <view class="sec-head" data-k="ai" @tap="toggleSec">
        <text class="sec-name">AI</text>
        <text v-if="openSec !== 'ai'" class="sec-hint">{{ secHint('ai') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'ai'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('启用 AI 服务') }}</text>
            <text class="row-desc">{{ $t('开启后可用云端生成例句、点评与朗读') }}</text>
          </view>
          <switch :checked="ai.enabled" :color="brandMain" @change="e => setAI('enabled', e.detail.value)" />
        </view>

        <template v-if="ai.enabled">
          <view class="field">
            <text class="field-label">{{ $t('服务商') }}</text>
            <view class="chips">
              <view
                v-for="p in providers"
                :key="p.value"
                class="chip"
                :class="{ active: ai.provider === p.value }"
                @tap="selectProvider(p.value)"
              >{{ p.name }}</view>
            </view>
          </view>

          <!-- 状态校验 + 连通性测试：通过后明确显示"可正常使用" -->
          <view class="verify-box">
            <view class="verify-status" :class="status.cls">
              <text class="verify-dot"></text>
              <text class="verify-text">{{ status.text }}</text>
            </view>
            <button
              class="verify-btn"
              :class="{ disabled: !canTest }"
              :disabled="!canTest"
              @tap="runTest"
            >{{ testing ? $t('测试中…') : $t('测试连接') }}</button>
          </view>

          <view class="row adv-row" @tap="toggleAdv">
            <view class="row-main">
              <text class="row-title">{{ $t('连接参数') }}</text>
              <text class="row-desc">地址 / 密钥 / 模型{{ aiAdvanced ? '' : $t('（已配置则无需改动）') }}</text>
            </view>
            <text class="adv-toggle">{{ aiAdvanced ? $t('收起') : $t('展开') }}</text>
          </view>

          <!-- 用量：只统计本机实际发出去的调用，token 是估算值（看量级用，不对账） -->
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('本月用量') }}</text>
              <text class="row-desc">{{ apiUsageText }}</text>
            </view>
          </view>

          <template v-if="aiAdvanced">
            <view class="field">
              <text class="field-label">{{ $t('API 地址') }}</text>
              <input
                class="field-input"
                :value="ai.baseURL"
                :placeholder="$t('如 https://api.openai.com/v1')"
                @blur="e => setAI('baseURL', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">API Key</text>
              <input
                class="field-input"
                :value="ai.apiKey"
                :password="!showKey"
                :placeholder="$t('仅保存在本机，不会上传')"
                @blur="e => setAI('apiKey', e.detail.value)"
              />
              <text class="field-op" @tap="showKey = !showKey">{{ showKey ? $t('隐藏') : $t('显示') }}</text>
            </view>
            <view class="field">
              <text class="field-label">{{ $t('模型') }}</text>
              <input
                class="field-input"
                :value="ai.model"
                :placeholder="$t('例句生成用，如 gpt-4o-mini')"
                @blur="e => setAI('model', e.detail.value)"
              />
            </view>
            <view class="field" v-if="ai.provider === 'custom'">
              <view class="row-main">
                <text class="row-title">{{ $t('地址支持语音') }}</text>
                <text class="row-desc">{{ $t('若中转提供 /audio/speech，开启即可用云端音色（含中文）') }}</text>
              </view>
              <switch :checked="ai.customTTS" :color="brandMain" @change="e => setAI('customTTS', e.detail.value)" />
            </view>
            <view class="field" v-if="ai.provider === 'custom'">
              <view class="row-main">
                <text class="row-title">{{ $t('地址支持出图') }}</text>
                <text class="row-desc">{{ $t('若中转提供 /images/generations，首页指令就能真的生成背景图；不开则用本地渐变') }}</text>
              </view>
              <switch :checked="ai.customImage" :color="brandMain" @change="e => setAI('customImage', e.detail.value)" />
            </view>
            <view class="field" v-if="imageSupported">
              <text class="field-label">{{ $t('出图模型') }}</text>
              <view class="chips">
                <view
                  v-for="m in imageModels"
                  :key="m"
                  class="chip"
                  :class="{ active: (ai.imageModel || imageModels[0]) === m }"
                  @tap="setAI('imageModel', m)"
                >{{ m }}</view>
              </view>
            </view>
            <block v-if="ttsSupported">
              <view class="field">
                <text class="field-label">{{ $t('语音模型') }}</text>
                <view class="chips">
                  <view
                    v-for="m in ttsModels"
                    :key="m"
                    class="chip"
                    :class="{ active: ai.ttsModel === m }"
                    @tap="setAI('ttsModel', m)"
                  >{{ m }}</view>
                </view>
              </view>
              <view class="field">
                <text class="field-label">{{ $t('或手填') }}</text>
                <input
                  class="field-input"
                  :value="ai.ttsModel"
                  :placeholder="$t('默认 tts-1')"
                  @blur="e => setAI('ttsModel', e.detail.value)"
                />
              </view>
            </block>
          </template>

          <view class="field-note" v-if="!ttsSupported">
            {{ $t('该服务商为文本大模型，不提供云端语音；朗读仍使用本地发音。') }}
          </view>
          <view class="field-note" v-if="!imageSupported">
            {{ $t('该服务商不支持出图；首页「生成背景图」类指令会自动改成 AI 配色 + 本地渐变。') }}
          </view>

          <!-- ===== AI 功能分项开关（二级胶囊，默认收起） ===== -->
          <!-- 一个 App 里用到 AI 的地方有八处，消耗天差地别：生成词书一次几千 token，
               例句是每次出题都可能触发，查词补释义却很便宜。以前只有总开关，
               想省钱只能整个关掉。这里逐项开放，用到哪开哪。 -->
          <view class="field-col">
            <view class="sub-head" @tap="toggleAiFn">
              <text class="sub-name">{{ $t('AI 功能') }}</text>
              <text v-if="aiFnOff" class="sub-hint dim">{{ $t('已关闭 {n} 项', { n: aiFnOff }) }}</text>
              <text v-else class="sub-hint">{{ $t('全部开启') }}</text>
              <text class="sub-arrow" :class="{ rot: aiFnOpen }">›</text>
            </view>
            <view class="sub-body" v-if="aiFnOpen">
              <view class="field-note">
                {{ $t('关掉的功能不再调用模型、不消耗额度。查词命中本机缓存时依然可用（缓存不花钱）。') }}
              </view>
              <view class="fn-ops">
                <text class="fn-op" :class="{ disabled: aiFnOff === 0 }" @tap="setAllFeatures(true)">{{ $t('全部开启') }}</text>
                <text class="fn-op" :class="{ disabled: aiFnOff >= aiFnList.length }" @tap="setAllFeatures(false)">{{ $t('全部关闭') }}</text>
              </view>
              <view class="row fn-row" v-for="f in aiFnList" :key="f.key">
                <view class="row-main">
                  <text class="row-title">{{ $t(f.name) }}</text>
                  <text class="row-desc">{{ $t(f.desc) }}</text>
                </view>
                <view class="fn-side">
                  <text class="fn-tag" :class="'lv-' + f.level">{{ $t(f.levelLabel) }}</text>
                  <switch :checked="f.on" :color="brandMain" @change="e => toggleFeature(f.key, e.detail.value)" />
                </view>
              </view>
              <view class="field-note">
                {{ $t('AI 朗读用的是「语音」里的独立开关，不在这里 —— 它决定要不要更自然的人声，跟生不生成内容是两回事。') }}
              </view>
            </view>
          </view>
        </template>
      </view>
    </view>

    <!-- ===== 语音（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'voice' }">
      <view class="sec-head" data-k="voice" @tap="toggleSec">
        <text class="sec-name">{{ $t('语音') }}</text>
        <text v-if="openSec !== 'voice'" class="sec-hint">{{ secHint('voice') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'voice'">
        <view class="row">
          <view class="row-main">
            <text class="row-title" :class="{ muted: !aiReady }">{{ $t('使用 AI 朗读') }}</text>
            <text class="row-desc">{{ aiReady ? $t('更自然接近真人；失败自动回退本地发音') : $t('需先完成 AI 配置（地址 + 密钥）后才可使用') }}</text>
          </view>
          <switch :checked="voice.useAI && aiReady" :disabled="!aiReady" :color="brandMain" @change="e => setVoice('useAI', e.detail.value)" />
        </view>

        <template v-if="voice.useAI && aiReady">
          <block v-if="ttsSupported">
            <view class="field">
              <text class="field-label">{{ $t('音色') }}</text>
              <view class="chips">
                <view
                  v-for="v in voices"
                  :key="v"
                  class="chip"
                  :class="{ active: ai.ttsVoice === v }"
                  @tap="setAI('ttsVoice', v)"
                >{{ v }}</view>
              </view>
            </view>
            <view class="field slider-field">
              <text class="field-label">{{ $t('语速') }}</text>
              <slider
                class="slider"
                :min="0.5"
                :max="2"
                :step="0.1"
                :value="ai.ttsSpeed"
                :active-color="brandMain"
                show-value
                @change="e => setAI('ttsSpeed', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">{{ $t('试听音色') }}</text>
              <view class="try-row">
                <view class="try-btn" @tap="tryVoice('zh')">{{ $t('中文示例') }}</view>
                <view class="try-btn" @tap="tryVoice('en')">{{ $t('英文示例') }}</view>
              </view>
            </view>
            <view class="field-note">{{ $t('云端音色对中文的自然度通常明显好于手机自带引擎；首次约 1-2 秒，之后同句走缓存。') }}</view>
          </block>
          <view v-else class="field-note">{{ $t('当前服务商不支持云端语音，朗读将使用本地发音。') }}</view>
        </template>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('答题音效') }}</text>
            <text class="row-desc">{{ $t('答对 / 半对 / 答错各响一声') }}</text>
          </view>
          <switch :checked="voice.sfx !== false" :color="brandMain" @change="e => setVoice('sfx', e.detail.value)" />
        </view>
        <view v-if="voice.sfx !== false" class="row sfx-preview-row">
          <view class="row-main">
            <text class="row-desc">{{ $t('点一下试听') }}</text>
          </view>
          <view class="sfx-preview">
            <view class="sfx-dot ok" @tap="previewSfx('correct')">{{ $t('答对') }}</view>
            <view class="sfx-dot half" @tap="previewSfx('partial')">{{ $t('半对') }}</view>
            <view class="sfx-dot no" @tap="previewSfx('wrong')">{{ $t('答错') }}</view>
          </view>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('英文朗读') }}</text>
            <text class="row-desc">{{ $t('关闭后英文题干不再自动朗读（点击仍可发音）') }}</text>
          </view>
          <switch :checked="voice.englishRead" :color="brandMain" @change="e => setVoice('englishRead', e.detail.value)" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('中文朗读') }}</text>
            <text class="row-desc">{{ $t('关闭后中文内容不再自动朗读（点击仍可发音）') }}</text>
          </view>
          <switch :checked="voice.chineseRead" :color="brandMain" @change="e => setVoice('chineseRead', e.detail.value)" />
        </view>
        <view class="field">
          <text class="field-label">{{ $t('整句朗读引擎') }}</text>
          <view class="chips">
            <view
              v-for="e in engines"
              :key="e.key"
              class="chip"
              :class="{ active: engineKey === e.key }"
              :data-k="e.key"
              @tap="setEngine"
            >{{ e.name }}</view>
          </view>
          <view class="field-note">
            {{ $t('系统语音一次合成整句，中间没有网络请求，听感连贯；在线发音遇到整句取不到时会退化为逐词连读，听起来一顿一顿。') }}
          </view>
        </view>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('系统语音状态') }}</text>
            <text class="row-desc">{{ engineStatusText }}</text>
          </view>
          <view class="row-action" @tap="recheckEngine">{{ $t('重新检测') }}</view>
        </view>

        <view class="field slider-field">
          <text class="field-label">{{ $t('本地语速') }}</text>
          <slider
            class="slider"
            :min="0.5"
            :max="2"
            :step="0.1"
            :value="voice.speed"
            :active-color="brandMain"
            show-value
            @change="e => setVoice('speed', e.detail.value)"
          />
        </view>
      </view>
    </view>

    <!-- ===== 通知（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'notify' }">
      <view class="sec-head" data-k="notify" @tap="toggleSec">
        <text class="sec-name">{{ $t('通知') }}</text>
        <text v-if="openSec !== 'notify'" class="sec-hint">{{ secHint('notify') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'notify'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('每日学习提醒') }}</text>
            <text class="row-desc">{{ $t('仅在本机生效，不会推送服务器通知') }}</text>
          </view>
          <switch :checked="notifications.daily" :color="brandMain" @change="e => setNotifications('daily', e.detail.value)" />
        </view>
        <view class="field" v-if="notifications.daily">
          <text class="field-label">{{ $t('提醒时间') }}</text>
          <picker mode="time" :value="notifications.time" @change="e => setNotifications('time', e.detail.value)">
            <view class="picker-value">{{ notifications.time }}</view>
          </picker>
        </view>
      </view>
    </view>

    <!-- ===== AI 缓存（整体清除，不做逐条删除） ===== -->
    <view class="sec" :class="{ open: openSec === 'cache' }">
      <view class="sec-head" data-k="cache" @tap="toggleSec">
        <text class="sec-name">{{ $t('AI 缓存') }}</text>
        <text v-if="openSec !== 'cache'" class="sec-hint">{{ cacheHint }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'cache'">
        <view class="row" @tap="askClear('words')">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清空缓存单词') }}</text>
            <text class="row-desc">搜索 / AI 释义缓存过的单词（{{ cacheStats.words }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="askClear('sentences')">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清空缓存例句') }}</text>
            <text class="row-desc">练习与释义生成过的 AI 例句（{{ cacheStats.sentences }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 数据与账号（原「隐私」+「账号安全」合并，大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'data' }">
      <view class="sec-head" data-k="data" @tap="toggleSec">
        <text class="sec-name">{{ $t('数据与账号') }}</text>
        <text v-if="openSec !== 'data'" class="sec-hint">{{ secHint('data') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'data'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('本地存储学习数据') }}</text>
            <text class="row-desc">{{ $t('学习进度仅保存在本机，卸载即清除') }}</text>
          </view>
          <switch :checked="privacy.storeLocal" :color="brandMain" disabled />
        </view>

        <!-- ===== 导出 / 导入：换手机时唯一的迁移路径 =====
             放在「清除 / 退出」这些危险项之前 —— 真要清数据的人会往下翻，
             但想备份的人不该先看到一排红色。 -->
        <view class="row" @tap="askExport">
          <view class="row-main">
            <text class="row-title">{{ $t('导出数据') }}</text>
            <text class="row-desc">{{ $t('学习进度、词书、错题、设置与 AI 配置打包成一个加密文件') }}</text>
          </view>
          <text class="row-value">{{ backupHint }}</text>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="askImport">
          <view class="row-main">
            <text class="row-title">{{ $t('导入数据') }}</text>
            <text class="row-desc">{{ $t('从备份恢复，导入前会先显示备份里有什么') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view v-if="backupBusy" class="row">
          <view class="row-main">
            <text class="row-title muted">{{ backupStage }}</text>
          </view>
        </view>
        <view class="backup-note">
          <text class="backup-note-text">{{ $t('导出时会调起系统分享，可以直接选「附近分享 / 互传」发给另一台手机；也可以存下来手动传。文件里不会出现明文密钥。') }}</text>
        </view>

        <view class="row" @tap="clearLearningData">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清除学习数据') }}</text>
            <text class="row-desc">{{ $t('重置掌握度、错题与统计，不可恢复') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="logout">
          <view class="row-main">
            <text class="row-title danger">{{ $t('退出登录') }}</text>
            <text class="row-desc">{{ $t('重置个人资料与设置（学习数据保留）') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 关于（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'about' }">
      <view class="sec-head" data-k="about" @tap="toggleSec">
        <text class="sec-name">{{ $t('关于') }}</text>
        <text v-if="openSec !== 'about'" class="sec-hint">{{ secHint('about') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'about'">
        <!-- 版本行可点：连点若干下出彩蛋（tapVersion） -->
        <view class="row" @tap="tapVersion">
          <view class="row-main">
            <text class="row-title">{{ $t('版本') }}</text>
          </view>
          <text class="row-value">{{ version }}</text>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('介绍') }}</text>
          </view>
          <text class="row-value">{{ $t('背单词 · 本地离线可用的翻译练习工具') }}</text>
        </view>
        <view class="row" @tap="replayGuide">
          <view class="row-main">
            <text class="row-title">{{ $t('新手引导') }}</text>
            <text class="row-desc">{{ $t('回首页重新走一遍功能介绍') }}</text>
          </view>
          <text class="row-value">{{ $t('重看 ›') }}</text>
        </view>
      </view>
    </view>

    <!-- ===== 支持 AWword（打赏）：独立挂在页面最外层底部 =====
         不放进任何折叠分组 —— 分组收起就看不见了，而打赏是常驻入口 -->
    <view class="card donate-card" @tap="openDonate">
      <view class="dc-main">
        <text class="dc-title">{{ $t('支持 AWword') }}</text>
        <text class="dc-desc">{{ $t('请作者喝一杯 · 支付宝 / 微信扫码') }}</text>
      </view>
      <text class="dc-arrow">{{ $t('打赏 ›') }}</text>
    </view>

    <!-- ===== App 交流群：群号常驻可见，点一下直接复制 =====
         和打赏卡一样挂在最外层底部：折叠分组收起后就找不到了 -->
    <view class="card qq-card" @tap="copyQQGroup">
      <view class="dc-main">
        <text class="dc-title">{{ $t('App 交流群') }}</text>
        <text class="dc-desc">{{ $t('QQ 群 · 点一下复制群号') }}</text>
      </view>
      <text class="dc-num">{{ qqGroup }}</text>
    </view>

    <!-- 危险操作确认 / 语言选择（统一弹窗，替代系统 showModal / showActionSheet） -->
    <app-dialog
      :show="confirm.show"
      :mode="confirm.mode"
      :title="confirm.title"
      :content="confirm.content"
      :confirm-text="confirm.confirmText"
      :items="confirm.items"
      :danger="confirm.danger"
      :seq="confirm.seq"
      :btn-mode="confirm.btnMode"
      :value="confirm.value"
      :placeholder="confirm.placeholder"
      :password="confirm.password"
      :maxlength="confirm.maxlength"
      @confirm="onConfirmYes"
      @cancel="confirm.show = false"
    />

    <!-- ===== 彩蛋：连点「版本」触发 =====
         fixed 浮层，挂在页面最外层（不随内容滚动）。
         材质直接复用 App.vue 的 .pop-mask/.pop-card，这里只写内容层。 -->
    <view v-if="eggShow" class="pop-mask egg-mask" @tap="closeEgg">
      <view class="pop-card egg-card" @tap.stop="noop">
        <!-- 撒花：纯 view + transform 位移，不用 Canvas/SVG
             —— 各端支持不一致，且原生组件脱离 CSS transform（首页切 tab 要整体滑） -->
        <view class="egg-rain">
          <text
            v-for="(p, i) in eggPieces"
            :key="'eg' + i"
            class="egg-piece"
            :style="p.style"
          >{{ p.ch }}</text>
        </view>
        <text class="egg-emoji">{{ eggEmoji }}</text>
        <text class="egg-title">{{ $t('彩蛋') }}</text>
        <text class="egg-line">{{ eggLine }}</text>
        <view class="egg-stats">
          <view v-for="(s, i) in eggStats" :key="'es' + i" class="egg-stat">
            <text class="egg-stat-k">{{ s.k }}</text>
            <text class="egg-stat-v">{{ s.v }}</text>
          </view>
        </view>
        <text class="egg-btn" @tap="closeEgg">{{ $t('收起来') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import { LOCALES, current as currentLocale, setLocale } from '../../../utils/i18n.js';
import * as settings from '../../../utils/settings'
import * as store from '../../../utils/store'
import { stop as voiceStop, status as voiceStatus, resetVoice } from '../../../services/voice.js'
import { validateKeyFormat, testAIConnection } from '../../../services/ai-content.js'
import { PROVIDER_PRESETS, providerSupportsTTS, TTS_MODELS } from '../../../services/config.js'
import { IMAGE_MODELS, supportsImage } from '../../../services/image-gen.js'
import { AI_FEATURES, featureMap, setFeature, setAll as setAllAiFeatures, offCount } from '../../../services/ai-gate.js'
import { resetBreaker } from '../../../services/http.js'
import * as aiCache from '../../../utils/ai-cache.js'
import * as apiUsage from '../../../utils/api-usage.js'
import * as onboarding from '../../../utils/onboarding.js'
import { speakSentence as aiSpeak } from '../../../services/voice.js'
import * as sfx from '../../../utils/sfx.js'
import * as backup from '../../../utils/backup.js'
import * as backupIO from '../../../utils/backup-io.js'
// 只有几百字节的规模快照：设置页在分包里，不能为了显示几个数字去 import 语料本身
import { BUILD_INFO } from '../../../data/build-info.js'
import {
  BACKGROUNDS, ACCENTS, SWATCHES,
  CUSTOM_KEY, DEFAULT_CUSTOM,
  current as currentBg, setBackground, backgroundOf,
  currentAccent, setAccent,
  currentBgImage, currentMask, setMask, currentBlur, setBlur,
  currentCustomColor, setCustomColor,
  chooseBackgroundImage, clearBgImage,
  isDark, systemPrefersDark, currentDark, currentFollowSystem, setDark, setFollowSystem,
  barsSyncColors,
  currentSmooth, setSmooth
} from '../../../utils/theme.js'
import { hexToHsl, hslToHex, darkVariant } from '../../../utils/color.js'
import * as perf from '../../../utils/perf.js'
import { QUALITY, glassText, motionText, shadowText } from '../../../utils/perf.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

const TRY_TEXT = {
  zh: t('这个词的意思是不可避免的，中文发音应该更自然一些。'),
  en: 'This sentence should sound much more natural.'
}

// ---------------------------------------------------------------- 彩蛋
// 连点「关于 › 版本」触发。阈值 7 下、窗口 2.5 秒：
// 够长让人不至于手滑误触，够短不至于让人以为点了没反应。
const EGG_TAPS = 7
const EGG_WINDOW = 2500

// 台词：中文原文即 i18n key（见 i18n-en.js），英文态自动取译文。
// 第一次固定给 EGG_LINES[0]（ welcome 口吻），之后随机，让每次重开都不一样。
const EGG_LINES = [
  '被你找到了。这张卡就是全部彩蛋，没有下一层了。',
  '据说连点七下的人，四级都过了。',
  '词表是离线打包进 App 的 —— 断网、飞行模式、地铁里，照样能背。',
  '开发者也在用这个 App 背单词，进度比你慢。',
  '这行字是手敲的，不是 AI 生成的。值两毛。',
  '别翻了，隐藏功能就这一张卡；剩下的都是 bug。'
]
const EGG_EMOJIS = ['🎉', '✨', '🥚', '', '🍳', '🎈']

// 撒花：8 片，错开水平位置与启动延迟，避免"整排一起掉"的廉价感。
// 用 view + transform 而不是 Canvas —— 各端支持不一致，且原生组件脱离 CSS transform。
const EGG_PIECES = ['🎉', '✨', '🎊', '🥚', '⭐', '🎈', '✨', '🎉'].map((ch, i) => ({
  ch,
  style: 'left:' + (i * 11 + 6) + '%;animation-delay:' + (i * 0.19).toFixed(2) + 's'
}))

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      // App 交流群（QQ 群号）：点一下复制，不跳外链
      qqGroup: '177437072',
      // 危险确认（confirm 模式）与语言选择（sheet 模式）共用一张弹窗
      confirm: {
        show: false, mode: 'confirm', title: '', content: '',
        confirmText: t('确定'), items: [], danger: true, seq: 0, action: '',
        // input / alert 模式用（导出密码、导入完成提示）
        btnMode: 'confirm', value: '', placeholder: '', password: false, maxlength: 24
      },
      // ---------- 数据导出 / 导入（换手机迁移） ----------
      // busy 期间行上显示一行进度文案（打包中 / 正在查找备份…），避免"点了没反应"
      backupBusy: false,
      backupStage: '',
      // 待导入的备份原文：先预览摘要、二次确认后才真正解密写入
      pendingImport: '',
      lastBackupAt: 0,
      // 外观
      accents: ACCENTS,
      accentKey: 'blue',
      backgrounds: BACKGROUNDS,
      bgKey: 'default',
      bgImage: '',
      mask: 0.35,
      blur: 0,
      // 自定义底色：色板 + 三根滑杆（HSL）
      swatches: SWATCHES,
      customHex: DEFAULT_CUSTOM,
      hsl: hexToHsl(DEFAULT_CUSTOM),
      // 大胶囊分组：一次只展开一个（'' 表示全部收起）
      openSec: '',
      darkOn: false,
      followSystem: false,
      systemDark: false,
      // 练习页顶部两条进度条是否同色系（false = 已会那条用绿色，与已做那条分开）
      progressSync: true,
      // AI
      ai: {},
      ttsModels: TTS_MODELS,
      imageModels: IMAGE_MODELS,
      showKey: false,
      aiAdvanced: false,
      providers: PROVIDER_PRESETS,
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      testing: false,
      // 语音 / 通知 / 隐私
      voice: {},
      engines: [
        { key: 'auto', name: t('自动（系统优先）') },
        { key: 'native', name: t('只用系统语音') },
        { key: 'online', name: t('只用在线发音') }
      ],
      engineStatus: null,
      notifications: {},
      privacy: {},
      // AI 缓存：只暴露条数，内容按类别整体清除
      cacheStats: { words: 0, sentences: 0, updatedAt: 0 },
      apiUsageText: '',
      // 流畅模式：关闭毛玻璃模糊（低端机退路）
      smooth: false,
      perfText: t('未检测'),
      // 画质档位：'auto' 表示听性能检测的；下面三个维度可以在档位之上单独改
      quality: 'auto',
      fx: { glass: 'full', motion: 'full', shadow: 'full' },
      qualityList: [
        { key: 'auto', name: '自动' },
        { key: 'high', name: '高画质' },
        { key: 'clear', name: '清透' },
        { key: 'balanced', name: '均衡' },
        { key: 'lite', name: '轻量' },
        { key: 'eco', name: '省电' },
        { key: 'minimal', name: '极简' }
      ],
      glassList: [
        { v: 'full', n: '全部' },
        { v: 'key', n: '仅关键处' },
        { v: 'off', n: '关闭' }
      ],
      motionList: [
        { v: 'full', n: '完整' },
        { v: 'reduced', n: '精简' },
        { v: 'off', n: '关闭' }
      ],
      shadowList: [
        { v: 'full', n: '完整' },
        { v: 'slim', n: '收窄' },
        { v: 'none', n: '无' }
      ],
      version: BUILD_INFO.version,
      // AI 功能分项开关：默认收起；aiTick 是让 computed 跟着开关变化重算的响应式令牌
      aiFnOpen: false,
      aiTick: 0,
      // 彩蛋
      eggShow: false,
      eggPieces: EGG_PIECES,
      eggEmoji: EGG_EMOJIS[0],
      eggLineKey: EGG_LINES[0],
      eggFound: 0,
      eggTaps: 0,
      eggLastAt: 0
    }
  },
  computed: {
    // 当前语言的显示名（如「简体中文」）
    localeName() {
      void this.__lang;   // 切语言后要跟着重算
      const k = currentLocale();
      const hit = LOCALES.filter(x => x.key === k)[0];
      return hit ? hit.name : k;
    },
    // 当前主题色的十六进制（用于 switch / slider / modal 等只接受色值的组件属性）
    brandMain() {
      const a = ACCENTS.find(x => x.key === this.accentKey)
      return a ? a.main : '#2e6bff'
    },
    // 自定义色块：深色模式下显示压暗变体，和实际铺在屏幕上的底色一致
    customSwatch() {
      const hex = this.customHex || DEFAULT_CUSTOM;
      return this.darkOn ? darkVariant(hex) : hex;
    },
    ttsSupported() {
      return providerSupportsTTS(this.ai.provider);
    },
    // 出图：只有明确支持的服务商才显示模型选择（其余走本地渐变兜底）
    // 先读 this.ai，保证切服务商 / 改开关后这个 computed 会重新求值
    imageSupported() {
      const p = this.ai && this.ai.provider;
      return !!p && supportsImage();
    },
    // AI 是否已具备基本可用条件（总开关 + 地址 + 密钥）
    aiReady() {
      return !!(this.ai.enabled && this.ai.baseURL && this.ai.apiKey);
    },
    // AI 功能清单：把开关状态预先摊平成数组。
    // uni 模板（小程序端）不支持在插值里调用函数，所以这里一次性算好，
    // 模板只做属性读取。
    aiFnList() {
      void this.aiTick;
      const f = featureMap();
      return AI_FEATURES.map(x => ({
        key: x.key,
        name: x.name,
        desc: x.desc,
        level: x.level,
        levelLabel: x.levelLabel,
        on: f[x.key] !== false
      }));
    },
    aiFnOff() {
      void this.aiTick;
      return offCount();
    },
    // 彩蛋台词：存的是中文 key，译文在这里取 —— 弹窗开着时切语言也能跟着变
    eggLine() {
      void this.__lang;
      return t(this.eggLineKey);
    },
    // 彩蛋里的规模面板。数字来自 data/build-info.js（几百字节的快照），
    // 不直接引语料 —— 设置页在分包里，引了会把上百 KB 语料复制一份进分包。
    eggStats() {
      void this.__lang;
      const B = BUILD_INFO;
      return [
        { k: t('版本'), v: B.version },
        { k: t('内置词条'), v: t('{n} 条', { n: B.lexCount }) },
        { k: t('考试词书'), v: t('{n} 本', { n: B.bookCount }) },
        { k: t('练习例句'), v: t('{n} 条', { n: B.sentenceCount }) },
        { k: t('发现次数'), v: t('第 {n} 次', { n: this.eggFound }) }
      ];
    },
    // 收起时的缓存摘要：单词 / 例句 各多少条。
    // 必须是 computed —— 模板里 {{ cacheHint }} 是按属性取的，写在 methods 里
    // 会把函数本体渲染成 "function () { [native code] }"
    cacheHint() {
      void this.__lang;   // 摘要文案跟语言走，切语言要重算
      const n = (this.cacheStats.words || 0) + (this.cacheStats.sentences || 0);
      return n ? t('{n} 条', { n: n }) : t('暂无');
    },
    // 档位说明：说清这档到底砍了什么，加上"当前是否有手工微调"
    qualityHint() {
      void this.__lang;
      const fx = perf.getFx() || {};
      const q = perf.currentQualityKey();
      const base = QUALITY[q] || QUALITY.high;
      const parts = [t(base.name)];
      parts.push(t(base.desc));
      // 三个维度里只要有一个偏离了档位默认值，就提示用户"已自定义"
      const off = [];
      if (fx.glass && fx.glass !== base.glass) off.push(t('毛玻璃') + '·' + glassText(fx.glass));
      if (fx.motion && fx.motion !== base.motion) off.push(t('动效') + '·' + motionText(fx.motion));
      if (fx.shadow && fx.shadow !== base.shadow) off.push(t('阴影') + '·' + shadowText(fx.shadow));
      if (off.length) parts.push(t('已自定义：{list}', { list: off.join(' / ') }));
      return parts.join(' · ');
    },
    // 输入格式校验（纯本地，不发请求）
    keyFormat() {
      return validateKeyFormat({
        baseURL: this.ai.baseURL,
        apiKey: this.ai.apiKey,
        model: this.ai.model
      });
    },
    canTest() {
      return !this.testing && !!this.ai.enabled && this.keyFormat.ok;
    },
    // 统一状态：idle（未验证）/ ok（可正常使用）/ warn（格式问题）/ fail（连接失败）
    status() {
      if (!this.ai.enabled) return { cls: 'idle', text: t('AI 服务已关闭') };
      if (!this.keyFormat.ok) return { cls: 'warn', text: this.keyFormat.reason };
      const v = this.ai.verify;
      if (v && v.sig === this.configSig()) {
        if (v.ok) {
          return { cls: 'ok', text: t('可正常使用') + (v.latency ? '（' + v.latency + ' ms）' : '') };
        }
        return { cls: 'fail', text: v.msg || t('连接失败') };
      }
      return { cls: 'idle', text: t('格式校验通过，点击「测试连接」验证') };
    },
    // 跟随系统时，深色开关显示的是"系统当前值"，不允许手动改
    darkHint() {
      // 跟随系统时把读到的值直接摆出来：读不到就是配置/内核问题，一眼能看出来
      if (this.followSystem) return t('已跟随系统 · 读取到') + (this.systemDark ? t('深色') : t('浅色'));
      return this.darkOn ? t('底色转深灰，文字转亮，背景图自动降亮度') : t('当前为浅色');
    },
    // 上次导出的日期。没备份过就把"未备份"摆出来 —— 换手机时这行字是最值钱的提醒。
    // 必须是 computed：模板按属性 {{ backupHint }} 取，写进 methods 会被渲染成函数源码。
    backupHint() {
      if (!this.lastBackupAt) return t('未备份')
      const d = new Date(this.lastBackupAt)
      const p = (n) => (n < 10 ? '0' : '') + n
      return t('上次备份 {s}', { s: p(d.getMonth() + 1) + '-' + p(d.getDate()) })
    },
    engineKey() {
      return this.voice.engine || 'auto';
    },
    engineStatusText() {
      const s = this.engineStatus;
      if (!s) return t('点击「重新检测」查看');
      if (!s.provider || s.provider === 'youdao-only') {
        return t('未启用系统语音（当前设置只用在线发音）');
      }
      if (!s.nativeReady) return t('系统语音未就绪，将回退在线发音');
      const l = s.lang || {};
      const zh = l.zh === false ? t('中文不可用') : t('中文可用');
      const en = l.en === false ? t('英文不可用') : t('英文可用');
      const head = t('系统语音已就绪 · {zh} / {en}', { zh: zh, en: en });
      return l.device ? head + t('（设备语言 {d}）', { d: l.device }) : head;
    }
  },
  onShow() {
    this.refresh()
    this.accentKey = currentAccent()
    this.bgKey = currentBg()
    this.bgImage = currentBgImage()
    this.customHex = currentCustomColor() || DEFAULT_CUSTOM
    this.hsl = hexToHsl(this.customHex)
    this.mask = currentMask()
    this.blur = currentBlur()
    this.darkOn = isDark()
    this.followSystem = currentFollowSystem()
    this.systemDark = systemPrefersDark()
    this.progressSync = barsSyncColors()
    this.version = this.readVersion()
  },
  methods: {
    // 背景色块：深色模式下显示压暗变体，与实际背景一致、各预设之间也能区分开
    bgSwatch(b) {
      return this.darkOn ? (b.darkCss || b.css) : b.css
    },
    // ---------- 大胶囊分组 ----------
    toggleSec(e) {
      const k = e.currentTarget.dataset.k
      this.openSec = this.openSec === k ? '' : k
    },

    // 打赏页（设置 → 关于 → 支持 AWword）
    openDonate() {
      uni.navigateTo({ url: '/pkgManage/pages/donate/donate' })
    },
    // 重看新手引导：清掉完成标记后跳回首页，首页 onShow 检测到未完成会自动放一遍。
    // switchTab 会关掉设置页（非 tab 页），正好回到干净的首页。
    replayGuide() {
      try { onboarding.restart() } catch (e) { /* 清标记失败就当看过 */ }
      uni.switchTab({ url: '/pages/home/home' })
    },
    /**
     * 复制 QQ 群号。不跳外部链接 —— 只是把号码放进剪贴板，
     * 用户自己去 QQ 里加群；这样既不依赖任何第三方 SDK，也不会跳出 App。
     */
    copyQQGroup() {
      const n = String(this.qqGroup || '')
      try {
        uni.setClipboardData({ data: n })
        uni.showToast({ title: t('群号已复制'), icon: 'none' })
      } catch (e) {
        // 剪贴板不可用时至少把号码显示出来，用户还能手抄
        uni.showToast({ title: n, icon: 'none' })
      }
    },
    // 收起时在胶囊右侧显示一行摘要，展开后由内容自己表达
    secHint(k) {
      if (k === 'appearance') {
        const a = ACCENTS.find(x => x.key === this.accentKey)
        return (a ? a.name : '') + ' · ' + (this.darkOn ? t('深色') : t('浅色'))
      }
      if (k === 'ai') return this.ai.enabled ? (this.aiReady ? t('已开启') : t('待配置')) : t('未开启')
      if (k === 'voice') return this.voice.useAI && this.aiReady ? t('AI 朗读') : t('本地发音')
      if (k === 'notify') return this.notifications.daily ? this.notifications.time : t('已关闭')
      if (k === 'about') return 'v' + this.version
      if (k === 'cache') return this.cacheHint
      if (k === 'perf') return this.smooth ? t('已开启') : t('已关闭')
      // 收起时最该看见的是"我这数据备份过没有"
      if (k === 'data') return this.backupHint
      return ''
    },

    // 画质档位：先按机器挑一档，下面三个维度还能单独微调
    loadFx() {
      try {
        this.quality = perf.rawQuality();
        const fx = perf.getFx() || {};
        this.fx = {
          glass: fx.glass || 'full',
          motion: fx.motion || 'full',
          shadow: fx.shadow || 'full'
        };
      } catch (e) {}
    },
    onQuality(k) {
      try { perf.setQuality(k, true); } catch (e) {}
      this.loadFx();
      this.smooth = currentSmooth();
      if (this.smooth) this.blur = 0;
      try { this.refreshAppTheme(); } catch (e) {}
    },
    // 单独改某一维（毛玻璃 / 动效 / 阴影）。
    // 值与档位默认值相同 → 那一维的"自定义"标记自动消失
    onFx(part, v) {
      try { perf.setFxPart(part, v); } catch (e) {}
      this.loadFx();
      try { this.refreshAppTheme(); } catch (e) {}
    },

    // 设备性能检测：立刻跑一次，跑完把结果和"要不要开流畅模式"一起写回。
    // rematch=true：重新检测的语义就是"按当前设备重新匹配画质"，
    // 旧的手动档位（可能是在别的机器上选的）一并清掉，回到自动。
    reprobe() {
      this.perfText = t('检测中…')
      // 让"检测中"先渲染出来，再跑阻塞主线程约 60ms 的测算
      setTimeout(() => {
        try {
          const r = perf.autoDowngrade(true, { rematch: true })
          this.smooth = !!r.smooth
          this.blur = this.smooth ? 0 : this.blur
        } catch (e) {}
        this.perfText = perf.summary().text
        // 重测会重写推荐的档位，界面上的档位选择要跟着变
        this.loadFx()
        try { this.refreshAppTheme() } catch (e) {}
      }, 60)
    },

    // 流畅模式：只影响观感（关掉毛玻璃模糊），不动任何数据
    onSmooth(e) {
      // 手动拨的开关：auto 置 false，之后自动检测不再覆盖这个选择
      this.smooth = setSmooth(e.detail.value, false)
      // 背景模糊在流畅模式下被强制归零，滑块要跟着回弹
      if (this.smooth) this.blur = 0
      // 根节点 class 变了要立刻重算，否则当前页要等下次 onShow 才生效
      try { this.refreshAppTheme() } catch (err) {}
    },

    // ---------- AI 缓存（按类别整体清除，不支持逐条删） ----------
    askClear(kind) {
      const isWord = kind === 'words'
      const n = isWord ? this.cacheStats.words : this.cacheStats.sentences
      if (!n) {
        uni.showToast({ title: isWord ? t('暂无缓存单词') : t('暂无缓存例句'), icon: 'none' })
        return
      }
      // 数量用占位符塞进整句里：英文语序和中文不一样，拼接出来的句子读不通
      const detail = isWord
        ? t('将删除 {n} 条缓存单词的定义，', { n: n })
        : t('将删除 {n} 条缓存例句，', { n: n })
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: isWord ? t('清空缓存单词') : t('清空缓存例句'),
        content: detail + t('不会影响当前词书与学习进度。缓存内容无法逐条删除，只能按类别清空。'),
        confirmText: t('清空'),
        action: isWord ? 'clear-words' : 'clear-sentences'
      })
    },

    doClear(kind) {
      if (kind === 'words') aiCache.clearWords()
      else aiCache.clearSentences()
      this.cacheStats = aiCache.stats()
      uni.showToast({
        title: kind === 'words' ? t('已清空缓存单词') : t('已清空缓存例句'),
        icon: 'success'
      })
    },

    // ================= 数据导出 / 导入（换手机迁移） =================
    //
    // 这是个纯本机应用：没有服务器、没有账号，换手机原本等于数据全没。
    // 迁移路径必须存在，而且必须比"重新背一遍"省力：
    //   导出 → 得到一个整体加密的文件 → 系统分享（附近分享 / 互传 / 微信）→ 新手机导入。
    // 全程离线，不经任何服务器 —— 也确实没有服务器可以经。

    // 导出入口：三选一。默认那档就叫"一键"，因为绝大多数人只想按一下。
    askExport() {
      if (this.backupBusy) return
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        mode: 'sheet',
        danger: false,
        title: t('导出数据'),
        content: t('学习进度、词书、错题、设置与 AI 配置会打包成一个文件，内容整体加密。'),
        items: [
          { label: t('一键导出（推荐）'), key: 'quick' },
          { label: t('加密码导出'), key: 'pwd' },
          { label: t('复制备份内容'), key: 'copy' }
        ],
        action: 'export-menu'
      })
    },

    onExportMenu(key) {
      if (key === 'quick') return this.doExport('', false)
      if (key === 'copy') return this.doExport('', true)
      // 加密码：先问密码，并把"没有找回途径"说清楚，别让人随手设一个然后忘掉
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        mode: 'input',
        danger: false,
        title: t('设置备份密码'),
        content: t('导入时要输入同一个密码才能解开。没有找回途径，请务必记住。'),
        confirmText: t('导出'),
        placeholder: t('至少 4 位'),
        password: true,
        maxlength: 32,
        action: 'export-pwd'
      })
    },

    async doExport(password, clipboardOnly) {
      if (this.backupBusy) return
      this.backupBusy = true
      this.backupStage = t('正在打包…')
      try {
        const text = backup.encode(backup.collect(), password)
        const name = backup.fileName()
        // 只复制到剪贴板（用户明确选了这条）
        if (clipboardOnly) {
          const ok = await backupIO.copyToClipboard(text)
          this.backupBusy = false
          uni.showToast({ title: ok ? t('备份内容已复制') : t('复制失败，请改用导出到文件'), icon: ok ? 'success' : 'none' })
          return
        }
        const w = await backupIO.writeBackup(text, name)
        if (!w.ok) {
          // 写不出文件（小程序端没有文件 API）：退到剪贴板，至少数据还能带走
          const ok = await backupIO.copyToClipboard(text)
          this.backupBusy = false
          uni.showToast({ title: ok ? t('这台设备不能写文件，已复制到剪贴板') : t('导出失败，请稍后再试'), icon: 'none' })
          return
        }
        this.backupStage = t('已保存')
        // 调起系统分享 —— 这一步才是"传到另一台手机"的实现：
        // Android 分享面板里自带附近分享 / Quick Share 与各家的互传，
        // 走的都是 Wi-Fi 直连，比我们自己实现任何传输都快也稳。
        const shared = await backupIO.shareFile(w.path)
        this.backupBusy = false
        this.markBackupDone(name)
        this.showExportResult(shared, name, w.path, !!password)
      } catch (e) {
        this.backupBusy = false
        uni.showToast({ title: t('导出失败，请稍后再试'), icon: 'none' })
      }
    },

    showExportResult(shared, name, path, withPwd) {
      const where = shared
        ? t('已调起系统分享，可以选「附近分享 / 互传」直接发给另一台手机。')
        : t('已存到手机：') + (backupIO.toAbsolutePath(path) || name)
      const extra = withPwd ? t('这份备份有密码，导入时要输入同一个密码。') : ''
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        btnMode: 'alert',
        danger: false,
        title: t('导出完成'),
        content: name + '\n' + where + extra,
        confirmText: t('好的'),
        action: ''
      })
    },

    markBackupDone(name) {
      this.lastBackupAt = Date.now()
      try { settings.set({ backup: { lastAt: this.lastBackupAt, lastFile: String(name || '') } }) } catch (e) {}
    },

    // 导入入口：App 端先把手机上已有的备份扫出来让用户挑；H5 走文件选择器；
    // 小程序没有通用文件 API，只能从剪贴板读。
    async askImport() {
      if (this.backupBusy) return
      const p = backupIO.platform()
      if (p === 'h5') {
        const text = await backupIO.pickFile()
        if (!text) return
        return this.previewImport(text)
      }
      if (p === 'app') {
        this.backupBusy = true
        this.backupStage = t('正在查找备份…')
        const files = await backupIO.scanBackups()
        this.backupBusy = false
        this.backupStage = ''
        if (!files.length) return this.readImportFromClipboard(t('手机上还没找到备份文件，请先复制备份内容'))
        const items = files.slice(0, 8).map(f => ({ label: f.name, key: f.path }))
        items.push({ label: t('从剪贴板导入'), key: '__clipboard__' })
        this.confirm = Object.assign(this.blankConfirm(), {
          show: true,
          mode: 'sheet',
          danger: false,
          title: t('选择备份文件'),
          content: t('在手机上找到 {n} 份备份', { n: files.length }),
          items: items,
          action: 'import-pick'
        })
        return
      }
      return this.readImportFromClipboard('')
    },

    async readImportFromClipboard(emptyTip) {
      const text = await backupIO.readClipboard()
      if (!text) {
        uni.showToast({ title: emptyTip || t('剪贴板里没有备份内容'), icon: 'none' })
        return
      }
      this.previewImport(text)
    },

    async readImportFile(path) {
      this.backupBusy = true
      this.backupStage = t('正在读取备份…')
      const text = await backupIO.readFile(path)
      this.backupBusy = false
      this.backupStage = ''
      if (!text) {
        uni.showToast({ title: t('读不到这个备份文件'), icon: 'none' })
        return
      }
      this.previewImport(text)
    },

    // 摘要用信封里的明文 meta 拼。拿到一个文件就覆盖全部数据是很吓人的事，
    // 先让人看清"这份备份里到底是什么"，再问要不要覆盖。
    summaryText(meta) {
      const m = meta || {}
      const parts = [t('{n} 个词的掌握度', { n: m.words || 0 })]
      if (m.wrong) parts.push(t('{n} 条错题', { n: m.wrong }))
      if (m.userBooks) parts.push(t('{n} 本自建词书', { n: m.userBooks }))
      if (m.customWords) parts.push(t('{n} 个导入词', { n: m.customWords }))
      if (m.dayCount) parts.push(t('{a} 天学习记录（{b} ~ {c}）', { a: m.dayCount, b: m.from, c: m.to }))
      if (m.hasSettings) parts.push(t('设置与 AI 配置'))
      if (m.hasChat) parts.push(t('对话陪练记录'))
      return parts.join('，') + '。'
    },

    previewImport(text) {
      const info = backup.peek(text)
      if (!info) {
        uni.showToast({ title: t('这不是 AWword 的备份文件'), icon: 'none' })
        return
      }
      if (Number(info.v) > backup.BACKUP_VERSION) {
        uni.showToast({ title: t('备份来自更新版本的 App，请先升级'), icon: 'none' })
        return
      }
      this.pendingImport = text
      const sum = this.summaryText(info.meta)
      if (info.enc === 'password') {
        this.confirm = Object.assign(this.blankConfirm(), {
          show: true, mode: 'input', danger: false,
          title: t('这份备份有密码'),
          content: sum + t('输入导出时设的密码才能解开。'),
          confirmText: t('解密并导入'),
          placeholder: t('备份密码'),
          password: true, maxlength: 32,
          action: 'import-pwd'
        })
        return
      }
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('导入这份备份？'),
        content: sum + t('导入会覆盖本机现有的全部学习数据与设置，不可撤销。'),
        confirmText: t('覆盖导入'),
        action: 'import-go'
      })
    },

    async doImport(password) {
      if (this.backupBusy) return
      this.backupBusy = true
      this.backupStage = t('正在导入…')
      try {
        const decoded = backup.decode(this.pendingImport, password)
        const r = backup.restore(decoded)
        this.backupBusy = false
        this.pendingImport = ''
        if (r.failed && r.failed.length) {
          uni.showToast({ title: t('部分数据导入失败，请重试'), icon: 'none' })
          return
        }
        this.refresh()
        uni.showToast({ title: t('导入完成'), icon: 'success' })
      } catch (e) {
        this.backupBusy = false
        const code = String((e && e.message) || '')
        uni.showToast({ title: this.importErrText(code), icon: 'none' })
        // 密码错了再给一次机会：pendingImport 还留着，把输入框原样弹回来
        if (code === 'BAD_PASSWORD' || code === 'NEED_PASSWORD') this.previewImport(this.pendingImport)
      }
    },

    // decode 抛的是英文代号，给用户的必须是人话
    importErrText(code) {
      if (code === 'NEED_PASSWORD') return t('这份备份设有密码')
      if (code === 'BAD_PASSWORD') return t('密码不对，再试一次')
      if (code === 'TAMPERED') return t('备份文件被改动过，已拒绝导入')
      if (code === 'NEWER_VERSION') return t('备份来自更新版本的 App，请先升级')
      if (code === 'NOT_BACKUP') return t('这不是 AWword 的备份文件')
      if (code === 'EMPTY') return t('备份内容为空')
      return t('备份文件已损坏')
    },

    // ---------- 外观 ----------
    pickAccent(e) {
      const key = e.currentTarget.dataset.k
      this.accentKey = key
      setAccent(key)
      this.refreshAppTheme()
    },
    pickBg(e) {
      const key = e.currentTarget.dataset.k
      this.bgKey = key
      this.bgImage = ''
      setBackground(key)
      this.refreshAppTheme()
    },
    // ---------- 自定义底色 ----------
    // 起点用"当前这一档的底色"：从某个预设切过来时不会突然跳到一个陌生颜色，
    // 滑杆也落在一个真实存在的颜色上。
    pickCustomBg() {
      const seed = currentCustomColor() || backgroundOf(this.bgKey, false).solid || DEFAULT_CUSTOM
      this.customHex = seed
      this.hsl = hexToHsl(seed)
      this.applyCustom(seed)
    },
    pickSwatch(e) {
      const c = e.currentTarget.dataset.c
      if (!c) return
      this.hsl = hexToHsl(c)
      this.applyCustom(c)
    },
    // 三根滑杆：拖动中只动预览（不写盘、不重算背景），松手才真正应用，
    // 否则一次拖动会连着写几十次 storage 并整屏重算背景。
    onHsl(k, e, commit) {
      const v = Number(e.detail.value)
      if (!isFinite(v)) return
      const h = { h: this.hsl.h, s: this.hsl.s, l: this.hsl.l }
      h[k] = Math.round(v)
      this.hsl = h
      const hex = hslToHex(h.h, h.s, h.l)
      if (commit) this.applyCustom(hex)
      else this.customHex = hex
    },
    applyCustom(hex) {
      // setCustomColor 顺手把 background 切到 custom 档并清掉背景图
      this.customHex = setCustomColor(hex)
      this.bgKey = CUSTOM_KEY
      this.bgImage = ''
      this.refreshAppTheme()
    },
    resetCustom() {
      this.hsl = hexToHsl(DEFAULT_CUSTOM)
      this.applyCustom(DEFAULT_CUSTOM)
    },
    async chooseBg() {
      const p = await chooseBackgroundImage()
      if (p) {
        this.bgImage = p
        this.mask = currentMask()
        this.blur = currentBlur()
        this.refreshAppTheme()
        uni.showToast({ title: t('已应用背景图'), icon: 'success' })
      }
    },
    clearBg() {
      clearBgImage()
      this.bgImage = ''
      this.refreshAppTheme()
    },
    onMask(e) {
      const v = Number(e.detail.value) || 0
      this.mask = v
      setMask(v)
      this.refreshAppTheme()
    },
    onBlur(e) {
      const v = Number(e.detail.value) || 0
      this.blur = v
      setBlur(v)
      this.refreshAppTheme()
    },
    toggleDark(v) {
      if (this.followSystem) return
      setDark(!!v)
      this.darkOn = isDark()
      this.refreshAppTheme()
    },
    toggleFollow(v) {
      setFollowSystem(!!v)
      this.followSystem = currentFollowSystem()
      this.darkOn = isDark()
      this.systemDark = systemPrefersDark()
      this.refreshAppTheme()
    },
    /**
     * 两条进度条要不要同色系。
     * 只写 settings（theme.progressSync），不需要重下发 CSS 变量 ——
     * 两个练习页靠 class 切两套颜色，进页面时各读一次这个开关。
     */
    setProgressSync(v) {
      const on = v === false ? false : true
      this.progressSync = on
      try { settings.set({ theme: { progressSync: on } }) } catch (e) { /* 存不上不影响本次预览 */ }
    },
    // ---------- AI ----------
    toggleAdv() {
      this.aiAdvanced = !this.aiAdvanced
    },
    // 试听云端音色：直接用当前配置朗读一句中/英示例（未配置会自动降级本地）
    tryVoice(lang) {
      try { voiceStop() } catch (e) {}
      aiSpeak(TRY_TEXT[lang] || TRY_TEXT.en, { lang })
    },
    refresh() {
      const s = settings.get()
      this.ai = Object.assign({}, s.ai)
      this.voice = Object.assign({}, s.voice)
      this.notifications = Object.assign({}, s.notifications)
      this.privacy = Object.assign({}, s.privacy)
      this.cacheStats = aiCache.stats()
      this.apiUsageText = apiUsage.brief()
      this.smooth = currentSmooth()
      this.perfText = perf.summary().text
      this.loadFx()
      this.readEngineStatus()
      // 彩蛋发现次数（老数据没有 egg 字段，兜 0）
      this.eggFound = ((s.egg || {}).found || 0)
      // 上次导出的时间（老数据没有 backup 字段，兜 0 = 从未备份）
      this.lastBackupAt = Number(((s.backup || {}).lastAt) || 0)
    },
    // 配置指纹：地址/模型/密钥任一变化即视为"未验证"
    configSig() {
      return [this.ai.baseURL || '', this.ai.model || '', this.ai.apiKey || ''].join('|')
    },
    // ---------- AI 功能分项开关 ----------
    toggleAiFn() {
      this.aiFnOpen = !this.aiFnOpen;
    },
    toggleFeature(key, on) {
      setFeature(key, !!on);
      this.aiTick++;
    },
    setAllFeatures(on) {
      setAllAiFeatures(!!on);
      this.aiTick++;
    },

    setAI(key, value) {
      const patch = { [key]: value }
      // 影响可用性的字段变更后，清除上一次的验证结果
      if (key === 'baseURL' || key === 'apiKey' || key === 'model') {
        patch.verify = { sig: '', ok: false, msg: '', latency: 0, ts: 0 }
        // 换了地址 / 密钥 / 模型，之前攒下的失败记录就不再代表这个配置了，
        // 复位熔断，否则刚改好还得干等 60s 冷却
        resetBreaker()
      }
      settings.set({ ai: patch })
      this.refresh()
      // 密钥填完（格式通过）时自动校验一次，让"可正常使用"自动出现
      if (key === 'apiKey' && this.canTest) {
        this.runTest()
      }
    },
    // 一键选择预设：自动填入该服务商的地址/模型（自定义除外，留给用户手填）
    selectProvider(value) {
      const preset = PROVIDER_PRESETS.find(p => p.value === value)
      const patch = { provider: value, verify: { sig: '', ok: false, msg: '', latency: 0, ts: 0 } }
      if (preset && preset.value !== 'custom') {
        patch.baseURL = preset.baseURL
        patch.model = preset.model
        patch.ttsModel = preset.ttsModel
      }
      settings.set({ ai: patch })
      // 换服务商 = 换了地址，熔断记录同样作废
      resetBreaker()
      this.refresh()
    },
    // 连通性测试：真实调用一次（max_tokens=8），成功即写入"可正常使用"
    async runTest() {
      if (!this.canTest) return
      this.testing = true
      const sig = this.configSig()
      try {
        const r = await testAIConnection()
        settings.set({ ai: { verify: { sig, ok: true, msg: '', latency: r.latencyMs || 0, ts: Date.now() } } })
        this.refresh()
        uni.showToast({ title: t('可正常使用'), icon: 'success' })
      } catch (e) {
        const msg = (e && e.message) ? e.message : t('连接失败')
        settings.set({ ai: { verify: { sig, ok: false, msg, latency: 0, ts: Date.now() } } })
        this.refresh()
      } finally {
        this.testing = false
      }
    },
    setVoice(key, value) {
      settings.set({ voice: { [key]: value } })
      this.refresh()
      // 语速变化即时生效到本地 TTS
      if (key === 'speed') {
        try { voiceStop() } catch (e) {}
      }
      // 音效开关：打开时立即试听一声，否则用户不知道自己开了什么
      if (key === 'sfx' && value) {
        try { sfx.play('correct') } catch (e) {}
      }
    },
    // 试听三种音效（答对 / 半对 / 答错）
    previewSfx(kind) {
      try { sfx.play(kind) } catch (e) {}
    },
    setEngine(e) {
      const k = e && e.currentTarget ? e.currentTarget.dataset.k : ''
      if (!k) return
      settings.set({ voice: { engine: k } })
      try { voiceStop() } catch (err) {}
      this.refresh()
      this.readEngineStatus()
    },
    recheckEngine() {
      // 清掉"语言不可用 / 初始化失败"的缓存后重新预热，再读一次状态
      try { this.engineStatus = resetVoice() } catch (e) { this.readEngineStatus() }
      try { uni.showToast({ title: t('已重新检测'), icon: 'none', duration: 1200 }) } catch (e) {}
    },
    readEngineStatus() {
      try { this.engineStatus = voiceStatus ? voiceStatus() : null } catch (e) { this.engineStatus = null }
    },
    setNotifications(key, value) {
      settings.set({ notifications: { [key]: value } })
      this.refresh()
    },
    readVersion() {
      // 三端统一显示 data/build-info.js 里的版本号（manifest.json 的 versionName 同步维护）。
      // 之前 App 端读 plus.runtime.version、其余端读 uni.getSystemInfoSync().appVersion ——
      // 后者在微信小程序里返回的是**微信自己的版本号**（如 8.0.5），跟本 App 毫不相干。
      return BUILD_INFO.version
    },
    // ---------- 彩蛋：连点「版本」 ----------
    // 前 3 下完全静默（手滑点两下不该有反应），第 4 下起提示还差几下，第 7 下开奖。
    tapVersion() {
      const now = Date.now()
      if (now - this.eggLastAt > EGG_WINDOW) this.eggTaps = 0
      this.eggLastAt = now
      this.eggTaps += 1
      if (this.eggTaps >= EGG_TAPS) {
        this.eggTaps = 0
        this.eggLastAt = 0
        this.openEgg()
        return
      }
      if (this.eggTaps >= 4) {
        const left = EGG_TAPS - this.eggTaps
        try { uni.showToast({ title: t('再点 {n} 下…', { n: left }), icon: 'none', duration: 900 }) } catch (e) {}
      }
    },
    openEgg() {
      const st = settings.get() || {}
      const found = ((st.egg || {}).found || 0) + 1
      // 计数落盘：只为了第 N 次打开时台词不一样，不影响任何功能
      try { settings.set({ egg: { found } }) } catch (e) {}
      this.eggFound = found
      // 第一次固定第一条（"被你找到了"的口吻），之后随机
      this.eggLineKey = found === 1
        ? EGG_LINES[0]
        : EGG_LINES[1 + Math.floor(Math.random() * (EGG_LINES.length - 1))]
      this.eggEmoji = EGG_EMOJIS[Math.floor(Math.random() * EGG_EMOJIS.length)]
      this.eggShow = true
      // 开奖音：两声 "叮叮"。走 sfx 是为了尊重设置里的音效开关（关掉就真的一点声都没有）
      try {
        sfx.play('correct')
        setTimeout(() => { try { sfx.play('correct') } catch (e) {} }, 190)
      } catch (e) {}
    },
    closeEgg() {
      this.eggShow = false
    },
    // 弹窗内部点一下不该穿透到遮罩把弹窗关掉（和结构里 app-dialog 的 noop 同款）
    noop() {},
    clearLearningData() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('清除学习数据'),
        content: t('将重置全部掌握度、错题与统计，且不可恢复。确定继续？'),
        confirmText: t('清除'),
        action: 'clear'
      })
    },
    logout() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('退出登录'),
        content: t('将重置个人资料与全部设置（AI 配置、朗读偏好等），学习数据保留。确定继续？'),
        confirmText: t('退出'),
        action: 'logout'
      })
    },

    // 弹窗初始态：confirm（危险确认）与 sheet（选语言）共用一张卡片，
    // 每次开弹窗都从这张空白表起，避免上一轮的 items / mode 串味
    // input / alert 这几个字段也必须各自归零：上一轮弹的是密码框（password=true），
    // 下一轮如果只覆盖 title，用户会看到一个莫名被掩码的输入框
    blankConfirm() {
      return {
        show: false, mode: 'confirm', title: '', content: '',
        confirmText: t('确定'), items: [], danger: true,
        seq: (this.confirm && this.confirm.seq || 0) + 1, action: '',
        btnMode: 'confirm', value: '', placeholder: '', password: false, maxlength: 24
      }
    },

    // 语言选择：sheet 模式列出两档语言
    pickLocale() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        mode: 'sheet',
        danger: false,
        title: t('界面语言'),
        items: LOCALES.map(l => ({ label: l.name, key: l.key })),
        action: 'locale'
      })
    },

    // payload 语义随 mode 变：sheet → 选中下标，confirm → true
    onConfirmYes(payload) {
      const act = this.confirm.action
      const items = this.confirm.items || []
      this.confirm.show = false
      if (act === 'locale') {
        const pick = items[payload]
        if (pick && pick.key) {
          setLocale(pick.key)
          uni.showToast({ title: pick.label, icon: 'none' })
        }
        return
      }
      if (act === 'clear') {
        store.reset()
        uni.showToast({ title: t('已清除'), icon: 'success' })
      } else if (act === 'logout') {
        settings.reset()
        this.refresh()
        uni.showToast({ title: t('已退出'), icon: 'success' })
      } else if (act === 'clear-words') {
        this.doClear('words')
      } else if (act === 'clear-sentences') {
        this.doClear('sentences')
      } else if (act === 'export-menu') {
        // sheet：载荷是选中下标
        const pick = items[payload]
        if (pick && pick.key) this.onExportMenu(pick.key)
      } else if (act === 'export-pwd') {
        // input：载荷是文本
        const pwd = String(payload || '')
        if (pwd.length < 4) {
          uni.showToast({ title: t('密码至少 4 位'), icon: 'none' })
          return
        }
        this.doExport(pwd, false)
      } else if (act === 'import-pick') {
        const pick = items[payload]
        if (!pick) return
        if (pick.key === '__clipboard__') this.readImportFromClipboard('')
        else this.readImportFile(pick.key)
      } else if (act === 'import-pwd') {
        this.doImport(String(payload || ''))
      } else if (act === 'import-go') {
        this.doImport('')
      }
    }
  }
}
</script>

<style>
/* ===== 大胶囊分组 ===== */
/* 收起时 = 只有名字的悬浮胶囊（和顶栏/底栏同一套玻璃语言）；
   展开后 = 一张可调的大卡片，圆角从"全圆"过渡到"大圆角"。 */
/* ===== 支持 AWword（打赏）：最外层底部的独立卡 =====
   用大圆角胶囊的材质，但常驻可见 —— 折叠分组收起后就找不到了 */
.donate-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
  padding: 30rpx 34rpx;
  border-radius: 32rpx;
}

.dc-main { flex: 1; min-width: 0; }

.dc-title {
  display: block;
  font-size: 29rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.dc-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.dc-arrow {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

/* 交流群：群号用衬线数字，和打赏卡的"箭头"区分开（它是要抄走的号码） */
.qq-card { align-items: center; }

.dc-num {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

.sec {
  margin-bottom: 20rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 10rpx 30rpx rgba(23, 32, 26, 0.07), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  box-sizing: border-box;
  /* 圆角不做过渡：内容一出现卡片就变高了，此时如果圆角还在 999rpx→32rpx 的中间态，
     会看到"已经很高但四个角还是巨圆"的畸形卡片。改成瞬间切换，展开感交给内容生长。 */
}


.sec.open { border-radius: 32rpx; }

.sec-head {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 40rpx;
}

.sec-name {
  flex: 1;              /* 占满剩余空间：没有摘要的分组（数据与账号）箭头也不会贴到标题上 */
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sec-hint {
  margin-left: auto;
  margin-right: 18rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sec-arrow {
  font-size: 34rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: transform 220ms ease;
}

.sec.open .sec-arrow {
  transform: rotate(90deg);
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

/* 展开：内容从 0 高度长出来（max-height 动画，起点由 CSS 动画第一帧给出，不需要 JS 量高度）。
   用"起步快"的 ease-out，视觉上 200ms 左右就到位，剩下的时长只是把 max-height 推到上限，
   不再有可见变化——既有展开感又不拖沓。收起走 v-if 直接移除，零延迟、最跟手。 */
.sec-body {
  padding: 0 40rpx 40rpx;
  overflow: hidden;
  animation: sec-open 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@keyframes sec-open {
  from {
    max-height: 0;
    padding-bottom: 0;
    opacity: 0;
    transform: translateY(-8rpx);
  }
  to {
    max-height: 4000rpx;
    padding-bottom: 40rpx;
    opacity: 1;
    transform: none;
  }
}

/* 系统开启"减少动效"时直接就位 */
@media (prefers-reduced-motion: reduce) {
  .sec-body { animation: none; }
}

.sec-body .row:last-child { border-bottom: none; }
.sec-body .field:last-child { border-bottom: none; }

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  margin: 32rpx 0 20rpx;
}

.group { padding: 8rpx 36rpx; }

.sub-title {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
  padding: 24rpx 0 4rpx;
}

/* 主题色：一行小圆点 */
.accent-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.accent {
  width: 20%;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 18rpx;
}

.accent-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border: 4rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.9));
  box-shadow: 0 4rpx 12rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  transition: transform 180ms ease;
}

.accent.active .accent-dot { transform: scale(1.12); }

.accent-name {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.accent.active .accent-name {
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
}

/* 背景：横向胶囊色板 + 相册入口 */
.bg-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.bg-chip {
  width: 30%;
  height: 88rpx;
  border-radius: 20rpx;
  margin: 0 3% 16rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid rgba(255, 255, 255, 0.85);
  border: 3rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.85));
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  overflow: hidden;
}

.bg-chip:nth-child(3n) { margin-right: 0; }

.bg-chip.active {
  border-color: var(--brand, #2e6bff);
  box-shadow: 0 6rpx 18rpx rgba(var(--brand-rgb, 46, 107, 255), 0.24);
}

.bg-chip-name {
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  /* 深色模式下色块变深，给标签加一圈浅描边保持分离感 */
  border: 2rpx solid rgba(255, 255, 255, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 16rpx;
}

.bg-chip.pick {
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-style: dashed;
}

.bg-chip.pick .bg-chip-name {
  color: var(--brand-strong, #1d4fd8);
  background: transparent;
}

.bg-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4rpx 0 8rpx;
}

.bg-path { font-size: 22rpx; color: #5a6560; }
.bg-path { font-size: 22rpx; color: var(--ink-2, #5a6560); }

.bg-clear {
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
}

.bg-hint {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
  padding: 4rpx 0 24rpx;
}

/* ===== 练习进度条配色预览 =====
   两条就是练习页顶部那两条：上面「已做」、下面「会了」。
   颜色规则与练习页完全一致（同色系 = 浅版 / 主题色；分开 = 主题色 / 绿色），
   所以这里看到什么样，练的时候就是什么样。 */
.pg-preview {
  padding: 20rpx 24rpx 8rpx;
  margin: 4rpx 0 8rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.pg-line { display: flex; align-items: center; }
.pg-line + .pg-line { margin-top: 16rpx; }

.pg-k {
  flex-shrink: 0;
  width: 72rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.pg-track { flex: 1; height: 10rpx; margin: 0 16rpx; }

.pg-v {
  flex-shrink: 0;
  min-width: 100rpx;
  text-align: right;
  font-size: 22rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* 同步：浅版 / 主题色 */
.pg-fill-done.sync { background: rgba(var(--brand-rgb, 46, 107, 255), 0.38); }
.pg-fill-know.sync { background: var(--brand, #2e6bff); }
/* 分开：主题色 / 绿色 */
.pg-fill-done { background: var(--brand, #2e6bff); }
.pg-fill-know { background: #2f9e6e; }

/* ===== 自定义底色：色板 + 三根滑杆 =====
   六列排布：6 × 15% + 5 × 2% = 100%，第 6n 个去掉右边距。
   选中的那格用主色描边 + 一圈外发光，比"打勾"省地方。 */
.cp {
  padding: 20rpx 22rpx 6rpx;
  margin: 4rpx 0 8rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.cp-head {
  display: flex;
  align-items: center;
}

.cp-dot {
  width: 44rpx;
  height: 44rpx;
  margin-right: 14rpx;
  border-radius: 50%;
  border: 2rpx solid rgba(23, 32, 26, 0.12);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.12));
}

/* hex 用等宽的衬线体：和项目里"英文走 Georgia"的习惯一致，也不会跳动 */
.cp-hex {
  flex: 1;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28rpx;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cp-reset {
  font-size: 24rpx;
  padding: 6rpx 10rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.cp-reset:active { opacity: 0.5; }

.cp-sw {
  display: flex;
  flex-wrap: wrap;
  margin: 16rpx 0 6rpx;
}

.cp-sw-item {
  width: 15%;
  height: 56rpx;
  margin: 0 2% 14rpx 0;
  border-radius: 14rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.cp-sw-item:nth-child(6n) { margin-right: 0; }

.cp-sw-item.on {
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
  box-shadow: 0 0 0 4rpx rgba(46, 107, 255, 0.18);
  box-shadow: 0 0 0 4rpx rgba(var(--brand-rgb, 46, 107, 255), 0.18);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.group .row:last-child { border-bottom: none; }

.row-main { flex: 1; min-width: 0; margin-right: 20rpx; }

.row-title { display: block; font-size: 30rpx; color: #17201a; }
.row-title { display: block; font-size: 30rpx; color: var(--ink-1, #17201a); }

.row-title.danger { color: #e5484d; }

.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; line-height: 1.5; }
.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); line-height: 1.5; }

/* 答题音效试听：三个小胶囊，颜色跟练习页的判定色一致（对=蓝 / 半对=琥珀 / 错=红） */
/* 贴紧上面的开关行，视觉上算同一组（分隔线保留，跟其它行一致） */
.sfx-preview-row { padding-top: 12rpx; }
.sfx-preview { display: flex; flex-shrink: 0; gap: 12rpx; }
.sfx-dot {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  font-weight: 500;
  border: 2rpx solid transparent;
}
/* 用半透明底色而不是实底：深色模式下这几个小标签才不会变成突兀的亮块 */
.sfx-dot.ok {
  color: #3b74ff;
  background: rgba(46, 107, 255, 0.14);
  border-color: rgba(46, 107, 255, 0.3);
}
.sfx-dot.half {
  color: #d98324;
  background: rgba(247, 144, 9, 0.16);
  border-color: rgba(247, 144, 9, 0.34);
}
.sfx-dot.no {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.14);
  border-color: rgba(229, 72, 77, 0.3);
}

.row-value { font-size: 24rpx; color: #5a6560; flex-shrink: 0; text-align: right; }
.row-value { font-size: 24rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; text-align: right; }

.row-arrow { font-size: 32rpx; color: #c8cdc9; flex-shrink: 0; }

/* 导出 / 导入下面那句说明：比 row-desc 更淡一号，且不带分隔线，
   读起来像"注"，不像又一行设置 */
.backup-note {
  padding: 20rpx 0 26rpx;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.backup-note-text {
  display: block;
  font-size: 22rpx;
  line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 行内文字按钮（如"重新检测"） */
.row-action {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
}
.row-action:active { opacity: 0.6; }

.adv-row { border-top: 2rpx solid rgba(23, 32, 26, 0.07); }
.adv-row { border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.adv-toggle {
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  flex-shrink: 0;
}

.field {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.field:last-child { border-bottom: none; }

.field-note {
  font-size: 22rpx;
  color: #f79009;
  line-height: 1.5;
  padding: 4rpx 0 20rpx;
}

.row-title.muted { color: #b0b7b2; }

/* ===== 画质档位：分段控件 =====
   三个选项以内可以横排一行，七个（含"自动"）也放得下 —— rpx 随屏宽等比缩放，
   每格约 87rpx，最长项「高画质」72rpx 恒放得下；等宽 flex 文字短时自然留白。 */
.seg-group {
  padding: 18rpx 0 6rpx;
  border-bottom: 1rpx solid rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
}

.seg-label {
  display: block;
  font-size: 26rpx;
  color: var(--ink-2, #5a6560);
  margin-bottom: 14rpx;
}

.seg-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 4rpx 0 18rpx;
}

.seg-item {
  flex: 1;
  min-width: 0;
  text-align: center;
  padding: 12rpx 0;
  font-size: 24rpx;
  line-height: 1.2;
  border-radius: 16rpx;
  color: var(--ink-2, #5a6560);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  border: 1rpx solid rgba(var(--shadow-rgb, 23, 32, 26), 0.08);
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.seg-item:active { opacity: 0.7; }

/* 选中态：用 --brand 而不是写死主色 —— 换强调色 / 切深色时会跟着变
   （深色档的主色由 App.vue 的 .app-dark.acc-* 提供，比浅色档提亮一档） */
.seg-item.on {
  background: var(--brand, #2e6bff);
  border-color: var(--brand, #2e6bff);
  color: #fff;
  font-weight: 500;
}

/* ===== 状态校验 + 测试连接 ===== */
.verify-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 8rpx;
}

.verify-status {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  margin-right: 20rpx;
}

.verify-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #c8cdc9;
  flex-shrink: 0;
  margin-right: 12rpx;
}

.verify-text { font-size: 24rpx; color: #98a19b; line-height: 1.4; }
.verify-text { font-size: 24rpx; color: var(--ink-3, #98a19b); line-height: 1.4; }

.verify-status.ok .verify-dot { background: var(--brand-strong, #1d4fd8); }
.verify-status.ok .verify-text { color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.verify-status.warn .verify-dot { background: #f79009; }
.verify-status.warn .verify-text { color: #b54708; }

.verify-status.fail .verify-dot { background: #e5484d; }
.verify-status.fail .verify-text { color: #e5484d; }

.verify-btn {
  flex-shrink: 0;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 32rpx;
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
  border-radius: 999rpx;
}

.verify-btn::after { border: none; }

.verify-btn.disabled {
  color: #b0b7b2;
  background: rgba(255, 255, 255, 0.4);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.4);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-color: rgba(23, 32, 26, 0.1);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}

.field-label { width: 150rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 150rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

/* 输入块 / 选择器：与卡片同一套玻璃语言 */
.field-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.field-op { font-size: 24rpx; color: var(--brand, #2e6bff); margin-left: 16rpx; flex-shrink: 0; }

/* 试听按钮 */
.try-row { display: flex; flex: 1; }

.try-btn {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
  border-radius: 999rpx;
  padding: 12rpx 0;
  margin-right: 16rpx;
}
.try-btn:last-child { margin-right: 0; }
.try-btn:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.slider-field { align-items: center; }

.slider { flex: 1; margin: 0; }

.chips { display: flex; flex-wrap: wrap; flex: 1; }

.chip {
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 22rpx;
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  margin: 0 12rpx 12rpx 0;
  transition: background 200ms ease, color 200ms ease;
}

.chip.active {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}

.picker-value {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* ===== 彩蛋（连点「关于 › 版本」） =====
   遮罩与卡片的材质直接复用 App.vue 的 .pop-mask/.pop-card（全 App 弹窗唯一来源），
   这里只写内容层，不改那两个类的尺寸/圆角/内边距。 */
.egg-mask { z-index: 120; }

/* 卡片内要裁掉飘出边界的撒花，所以自己开 overflow —— .pop-card 不能为它开 */
.egg-card {
  position: relative;
  overflow: hidden;
  padding-top: 60rpx;
}

.egg-rain {
  position: absolute;
  left: 0; right: 0; top: 0; bottom: 0;
  /* 撒花只是背景，不能挡住底下按钮的点击 */
  pointer-events: none;
}

.egg-piece {
  position: absolute;
  top: -40rpx;
  font-size: 28rpx;
  opacity: 0;
  animation: egg-fall 1.9s linear infinite;
}

@keyframes egg-fall {
  0% { transform: translateY(0) rotate(0deg); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translateY(560rpx) rotate(320deg); opacity: 0; }
}

.egg-emoji {
  display: block;
  font-size: 74rpx;
  line-height: 1.15;
  animation: egg-pop 520ms cubic-bezier(0.22, 1.2, 0.36, 1) both;
}

@keyframes egg-pop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.14); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.egg-title {
  display: block;
  margin-top: 10rpx;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.egg-line {
  display: block;
  margin-top: 14rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.egg-stats {
  margin-top: 30rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.08);
  border-top: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}

.egg-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10rpx 0;
}

.egg-stat-k {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 数字用衬线：和正文的无衬线拉开，一眼看出是"读数" */
.egg-stat-v {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 27rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.egg-btn {
  display: block;
  margin-top: 32rpx;
  padding: 16rpx 0;
  border-radius: 999rpx;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

/* ===== AI 功能分项开关（AI 大胶囊里的二级胶囊） ===== */
/* 比 sec 矮一号（72rpx），留边框区分层级，避免看起来像第三层大分组 */
.sub-head {
  display: flex;
  align-items: center;
  height: 72rpx;
  padding: 0 26rpx;
  border-radius: 22rpx;
  background: rgba(46, 107, 255, 0.06);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.06);
}

.sub-name {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sub-hint {
  margin-left: auto;
  margin-right: 12rpx;
  font-size: 21rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.sub-hint.dim {
  color: #f79009;
  color: var(--warn, #f79009);
}

.sub-arrow {
  font-size: 30rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: transform 200ms ease;
}

.sub-arrow.rot {
  transform: rotate(90deg);
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.sub-body {
  padding: 22rpx 0 0;
}

/* 全开 / 全关：不做成按钮，避免跟下面的 switch 抢视觉重量 */
.fn-ops {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 0 26rpx 4rpx;
}

.fn-op {
  font-size: 23rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  letter-spacing: 1rpx;
}

.fn-op.disabled {
  color: #b8c0bb;
  color: var(--ink-4, #b8c0bb);
}

.fn-row { align-items: center; }

.fn-side {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

/* 开销档位：暖色 = 更费 token，让"关哪个最省"一眼可见 */
.fn-tag {
  min-width: 56rpx;
  text-align: center;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  line-height: 1.4;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(90, 101, 96, 0.1);
}

.fn-tag.lv-high {
  color: #854f0b;
  background: rgba(247, 144, 9, 0.16);
}

.fn-tag.lv-max {
  color: #a32d2d;
  background: rgba(229, 72, 77, 0.16);
}
</style>
