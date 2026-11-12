<script setup>
defineProps({
  title: { type: String, default: '这里还没有内容' },
  description: { type: String, default: '' },
  mark: { type: String, default: '空' }
});
</script>

<template>
  <div class="empty-state">
    <div class="empty-mark">{{ mark }}</div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>
