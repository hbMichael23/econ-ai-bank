<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument, Key, Cloudy, Monitor, Moon, Sunny, Connection } from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user.js';
import { formatDateTime } from '../lib/format.js';
import { IMAGE_MODES } from '../lib/constants.js';

const userStore = useUserStore();
const migrationInput = ref('');
const importing = ref(false);
const savingImageMode = ref(false);

const shortToken = computed(() => {
  const token = userStore.userSet?.user_token || '';
  return token ? `${token.slice(0, 10)}…${token.slice(-6)}` : '—';
});
const shortFingerprint = computed(() => {
  const value = userStore.device?.fingerprint || userStore.userSet?.device_fingerprint || '';
  return value ? `${value.slice(0, 12)}…` : '—';
});

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  ElMessage.success('已复制到剪贴板');
}

async function copyMigrationKey() {
  if (!userStore.migrationKey) {
    ElMessage.warning('迁移密钥尚未加载');
    return;
  }
  await copyText(userStore.migrationKey);
}

async function importKey() {
  const key = migrationInput.value.trim();
  if (!key) {
    ElMessage.warning('请输入迁移密钥');
    return;
  }
  importing.value = true;
  try {
    await userStore.importMigrationKey(key);
  } catch (error) {
    ElMessage.error(error.message || '迁移密钥导入失败');
  } finally {
    importing.value = false;
  }
}

async function chooseImageMode(mode) {
  if (mode === userStore.imageMode || savingImageMode.value) return;
  savingImageMode.value = true;
  try {
    await userStore.setImageMode(mode);
    ElMessage.success('已更新原图存储策略');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    savingImageMode.value = false;
  }
}
</script>

<template>
  <div class="page-stack settings-page">
    <div class="page-heading">
      <div class="heading-left">
        <span class="page-kicker">PRIVATE DEVICE VAULT</span>
        <h2>设置与迁移</h2>
        <p>没有账号密码。设备 token 是这台浏览器的身份；迁移密钥用于换设备时绑定同一套云端题库。</p>
      </div>
    </div>

    <div class="settings-grid">
      <section class="paper-card settings-card migration-card">
        <div class="card-heading">
          <div>
            <span class="section-kicker">换设备</span>
            <h3>迁移密钥</h3>
            <p class="section-desc">在新设备打开网站，进入设置粘贴这个密钥，即可绑定同一套题库。</p>
          </div>
          <el-icon class="heading-icon"><Key /></el-icon>
        </div>

        <div class="key-display">
          <code>{{ userStore.migrationKey || '加载中…' }}</code>
          <el-button :icon="CopyDocument" @click="copyMigrationKey">复制</el-button>
        </div>
        <div class="key-warning">
          迁移密钥等同于题库访问权，请不要发给别人，也不要截图公开发布。遗失后无法通过邮箱找回。
        </div>

        <div class="import-block">
          <span class="field-label">在新设备导入迁移密钥</span>
          <div class="key-import-row">
            <el-input
              v-model="migrationInput"
              placeholder="粘贴 mk_ 开头的迁移密钥"
              clearable
              @keydown.enter="importKey"
            />
            <el-button type="primary" :loading="importing" @click="importKey">绑定题库</el-button>
          </div>
          <p class="muted">导入后当前页面会切换到目标题库并刷新。此设备会使用同一套 token 访问云端。</p>
        </div>
      </section>

      <section class="paper-card settings-card">
        <div class="card-heading">
          <div>
            <span class="section-kicker">隐私与存储</span>
            <h3>原图保存策略</h3>
            <p class="section-desc">题目文字始终保存云端；原图可以选择不入库。</p>
          </div>
          <el-icon class="heading-icon"><Cloudy /></el-icon>
        </div>

        <div class="mode-list">
          <button
            v-for="mode in IMAGE_MODES"
            :key="mode.value"
            type="button"
            class="mode-option"
            :class="{ active: userStore.imageMode === mode.value }"
            :disabled="savingImageMode"
            @click="chooseImageMode(mode.value)"
          >
            <span class="mode-radio"></span>
            <span>
              <strong>{{ mode.label }}</strong>
              <small>{{ mode.desc }}</small>
            </span>
          </button>
        </div>
        <p class="muted image-storage-note">
          当前实现把原图压缩后以 base64 存在 question.image_data；选择“只存文字”可显著降低数据库体积。1000+ 题建议保持只存文字，除非确实需要回看原图。
        </p>
      </section>

      <section class="paper-card settings-card">
        <div class="card-heading">
          <div>
            <span class="section-kicker">显示</span>
            <h3>深色 / 浅色</h3>
            <p class="section-desc">移动端优先，自动记住当前设备的选择。</p>
          </div>
          <el-icon class="heading-icon"><Monitor /></el-icon>
        </div>
        <div class="theme-toggle-row">
          <button
            type="button"
            class="theme-choice"
            :class="{ active: !userStore.isDark }"
            @click="userStore.setTheme('light')"
          >
            <el-icon><Sunny /></el-icon>
            <span>浅色模式</span>
          </button>
          <button
            type="button"
            class="theme-choice"
            :class="{ active: userStore.isDark }"
            @click="userStore.setTheme('dark')"
          >
            <el-icon><Moon /></el-icon>
            <span>深色模式</span>
          </button>
        </div>
      </section>

      <section class="paper-card settings-card">
        <div class="card-heading">
          <div>
            <span class="section-kicker">当前设备</span>
            <h3>云端绑定信息</h3>
          </div>
          <el-icon class="heading-icon"><Connection /></el-icon>
        </div>
        <dl class="device-info">
          <div><dt>设备标识</dt><dd>{{ userStore.deviceLabel }}</dd></div>
          <div><dt>设备指纹</dt><dd><code>{{ shortFingerprint }}</code></dd></div>
          <div><dt>Token（脱敏）</dt><dd><code>{{ shortToken }}</code></dd></div>
          <div><dt>题库创建</dt><dd>{{ formatDateTime(userStore.userSet?.created_at) || '—' }}</dd></div>
          <div><dt>最近连接</dt><dd>{{ formatDateTime(userStore.userSet?.last_seen_at) || '刚刚' }}</dd></div>
          <div><dt>AI 模式</dt><dd>未配置 key 时分类/向量自动本地降级</dd></div>
        </dl>
        <p class="muted device-note">
          设备指纹只用于设备标识和日志，不作为唯一身份凭证；云端访问由 256-bit 随机 token 与 RLS 控制。
        </p>
      </section>
    </div>

    <section class="paper-card legal-card">
      <h3>这个题库的边界</h3>
      <div class="legal-grid">
        <p><strong>不登录</strong>没有账号、手机号、邮箱、验证码。</p>
        <p><strong>不公开</strong>没有社区、分享、排行榜、评论。</p>
        <p><strong>不清理</strong>题目、批注、草稿和日志不会自动过期删除。</p>
        <p><strong>不跨库</strong>相似检索只查当前 token 自己的题目。</p>
      </div>
    </section>
  </div>
</template>
