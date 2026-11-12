<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Collection,
  EditPen,
  Document,
  Setting,
  Plus,
  Moon,
  Sunny
} from '@element-plus/icons-vue';
import { useUserStore } from '../stores/user.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const navItems = [
  { name: 'bank', label: '题库', icon: Collection, to: '/bank' },
  { name: 'question-new', label: '录入', icon: EditPen, to: '/questions/new' },
  { name: 'logs', label: '记录', icon: Document, to: '/logs' },
  { name: 'settings', label: '设置', icon: Setting, to: '/settings' }
];

const title = computed(() => route.meta?.title || '题库');
const activeName = computed(() => {
  if (route.name === 'question-detail' || route.name === 'question-edit') return 'bank';
  return route.name;
});

function openNew() {
  if (route.name !== 'question-new') router.push('/questions/new');
}
</script>

<template>
  <div class="app-frame">
    <aside class="side-rail">
      <RouterLink to="/bank" class="brand-block">
        <span class="brand-mark">经</span>
        <span class="brand-copy">
          <strong>经研题库</strong>
          <small>PRIVATE AI ECON VAULT</small>
        </span>
      </RouterLink>

      <nav class="side-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="side-nav-item"
          :class="{ active: activeName === item.name }"
        >
          <el-icon :size="17"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <i v-if="activeName === item.name" class="nav-dot"></i>
        </RouterLink>
      </nav>

      <div class="side-note">
        <div class="side-note-line">
          <span class="live-dot"></span>
          <span>私有云端已连接</span>
        </div>
        <p>没有账号，没有公开分享。换设备时在「设置」用迁移密钥绑定同一套题库。</p>
        <span class="side-device">{{ userStore.deviceLabel }}</span>
      </div>
    </aside>

    <div class="work-area">
      <header class="top-bar">
        <div class="top-mobile-brand">
          <span class="brand-mark small">经</span>
          <strong>经研题库</strong>
        </div>
        <div class="top-title">
          <span class="top-eyebrow">ECONOMICS · PRIVATE BANK</span>
          <h1>{{ title }}</h1>
        </div>
        <div class="top-actions">
          <button
            type="button"
            class="icon-action"
            :title="userStore.isDark ? '切换到浅色模式' : '切换到深色模式'"
            :aria-label="userStore.isDark ? '切换到浅色模式' : '切换到深色模式'"
            @click="userStore.toggleTheme()"
          >
            <el-icon :size="18"><Sunny v-if="userStore.isDark" /><Moon v-else /></el-icon>
          </button>
          <button
            type="button"
            class="new-question-btn"
            aria-label="录入新题目"
            @click="openNew"
          >
            <el-icon><Plus /></el-icon>
            <span>录入题目</span>
          </button>
        </div>
      </header>

      <main class="main-content">
        <slot />
      </main>

      <nav class="mobile-nav" aria-label="移动端导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="mobile-nav-item"
          :class="{ active: activeName === item.name }"
        >
          <el-icon :size="20"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </div>
  </div>
</template>
