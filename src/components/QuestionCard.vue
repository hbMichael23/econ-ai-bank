<script setup>
import { computed } from 'vue';
import { Picture, MagicStick } from '@element-plus/icons-vue';
import MathText from './MathText.vue';
import { formatRelative, truncate } from '../lib/format.js';

const props = defineProps({
  question: { type: Object, required: true },
  selectable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  similarity: { type: Number, default: null }
});

defineEmits(['open', 'toggle']);

const tags = computed(() => {
  const seen = new Set();
  const list = [];
  for (const text of (props.question.manual_tags || [])) {
    if (!seen.has(text)) { seen.add(text); list.push({ text, kind: 'manual' }); }
  }
  for (const text of (props.question.auto_tags || [])) {
    if (!seen.has(text)) { seen.add(text); list.push({ text, kind: 'auto' }); }
  }
  return list.slice(0, 5);
});

const moreTags = computed(() => {
  const total = new Set([
    ...(props.question.auto_tags || []),
    ...(props.question.manual_tags || [])
  ]).size;
  return Math.max(0, total - tags.value.length);
});

const excerpt = computed(() => truncate(props.question.stem, 190));
</script>

<template>
  <article
    class="question-card"
    :class="{ selected, 'is-similar': similarity !== null }"
    tabindex="0"
    @click="$emit('open', question)"
    @keydown.enter="$emit('open', question)"
  >
    <div v-if="selectable" class="question-select" @click.stop>
      <el-checkbox
        :model-value="selected"
        aria-label="选择题目"
        @change="$emit('toggle', question.id)"
      />
    </div>

    <div class="question-card-topline">
      <div class="question-kinds">
        <span class="subject-badge">{{ question.subject || '未分类' }}</span>
        <span class="type-badge">{{ question.question_type || '未分类' }}</span>
        <span class="difficulty-badge" :data-level="question.difficulty">{{ question.difficulty || '未分类' }}</span>
      </div>
      <div class="question-meta">
        <span v-if="similarity !== null" class="similarity-badge">
          <el-icon><MagicStick /></el-icon>
          {{ Math.round((similarity || 0) * 100) }}%
        </span>
        <span v-if="question.image_mime" class="image-mark" title="含原图"><el-icon><Picture /></el-icon></span>
        <span>{{ formatRelative(question.created_at) }}</span>
      </div>
    </div>

    <div class="question-excerpt">
      <MathText :text="excerpt" compact />
    </div>

    <div class="question-card-bottom">
      <div class="tag-row">
        <span
          v-for="tag in tags"
          :key="`${tag.kind}-${tag.text}`"
          class="tag-chip"
          :class="tag.kind === 'manual' ? 'tag-manual' : 'tag-auto'"
        >
          {{ tag.text }}
        </span>
        <span v-if="moreTags" class="tag-more">+{{ moreTags }}</span>
      </div>
      <span class="open-hint">查看详情 →</span>
    </div>
  </article>
</template>
