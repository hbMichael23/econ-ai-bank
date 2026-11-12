<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';

const props = defineProps({
  text: { type: String, default: '' },
  placeholder: { type: String, default: '暂无内容' },
  compact: { type: Boolean, default: false }
});

const root = ref(null);
marked.setOptions({ breaks: true, gfm: true });

const html = computed(() => {
  if (!props.text) return '';
  return DOMPurify.sanitize(marked.parse(props.text), {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }
  });
});

function typeset() {
  if (!root.value || !html.value) return;
  renderMathInElement(root.value, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,
    strict: 'ignore',
    trust: false
  });
}

onMounted(() => nextTick(typeset));
watch(html, () => nextTick(typeset));
</script>

<template>
  <div
    v-if="text"
    ref="root"
    class="math-text"
    :class="{ 'is-compact': compact }"
    v-html="html"
  ></div>
  <span v-else class="math-empty">{{ placeholder }}</span>
</template>
