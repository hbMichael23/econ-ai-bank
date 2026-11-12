<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { MagicStick, Check } from '@element-plus/icons-vue';
import MathText from './MathText.vue';
import { embedQuestion, generateVariants } from '../lib/ai.js';
import { createQuestion, logOperation } from '../lib/questions.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  question: { type: Object, default: null }
});
const emit = defineEmits(['update:modelValue', 'saved']);

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const count = ref(3);
const difficultyMode = ref('same');
const loading = ref(false);
const variants = ref([]);
const error = ref('');
const savedIds = ref(new Set());
const savingId = ref('');

function close() {
  open.value = false;
}

async function generate() {
  if (!props.question) return;
  loading.value = true;
  error.value = '';
  variants.value = [];
  savedIds.value = new Set();
  const started = Date.now();
  try {
    const result = await generateVariants(props.question, {
      count: count.value,
      difficultyMode: difficultyMode.value
    });
    variants.value = result;
    await logOperation('generate_variant', props.question.id, {
      count: result.length,
      difficulty_mode: difficultyMode.value,
      duration_ms: Date.now() - started,
      status: 'success'
    });
    if (!result.length) error.value = 'AI 没有返回可用变式，请调整参数后重试。';
  } catch (err) {
    error.value = err?.message || '变式生成失败，请稍后重试。';
    await logOperation('generate_variant', props.question.id, {
      difficulty_mode: difficultyMode.value,
      duration_ms: Date.now() - started,
      status: 'failed',
      error: error.value
    });
  } finally {
    loading.value = false;
  }
}

async function saveVariant(variant) {
  if (savedIds.value.has(variant.clientId) || savingId.value) return;
  savingId.value = variant.clientId;
  try {
    const payload = {
      stem: variant.stem,
      options: variant.options,
      answer: variant.answer,
      analysis: variant.analysis,
      subject: variant.subject,
      question_type: variant.question_type,
      difficulty: variant.difficulty,
      auto_tags: variant.knowledge_tags,
      manual_tags: [],
      source: 'variant',
      image_data: null,
      image_mime: null,
      ocr_text: ''
    };
    const embedding = await embedQuestion(payload);
    payload.embedding = embedding.vector;
    const id = await createQuestion(payload);
    savedIds.value = new Set([...savedIds.value, variant.clientId]);
    await logOperation('create_question', id, {
      source: 'variant',
      parent_question_id: props.question.id,
      embedding_provider: embedding.provider
    });
    ElMessage.success('变式题已保存进私有题库');
    emit('saved', id);
  } catch (err) {
    ElMessage.error(err?.message || '保存变式题失败');
  } finally {
    savingId.value = '';
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    width="min(860px, 94vw)"
    :close-on-click-modal="!loading"
    class="variant-dialog"
    destroy-on-close
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-mark">变</span>
        <div>
          <h2>AI 变式训练</h2>
          <p>只基于当前题目生成同考点训练，不会访问外部题库。</p>
        </div>
      </div>
    </template>

    <div class="variant-controls">
      <div class="control-item">
        <span class="field-label">生成数量</span>
        <el-select v-model="count" size="default" style="width: 100px">
          <el-option v-for="n in 5" :key="n" :label="`${n} 道`" :value="n" />
        </el-select>
      </div>
      <div class="control-item">
        <span class="field-label">难度策略</span>
        <el-radio-group v-model="difficultyMode">
          <el-radio-button value="easier">降低</el-radio-button>
          <el-radio-button value="same">不变</el-radio-button>
          <el-radio-button value="harder">提升</el-radio-button>
        </el-radio-group>
      </div>
      <el-button type="primary" :loading="loading" class="generate-btn" @click="generate">
        <el-icon><MagicStick /></el-icon>
        {{ loading ? 'AI 正在出题…' : '生成变式题' }}
      </el-button>
    </div>

    <div v-if="error" class="inline-error">{{ error }}</div>

    <div v-if="variants.length" class="variant-list">
      <article v-for="(variant, index) in variants" :key="variant.clientId" class="variant-card">
        <div class="variant-card-head">
          <span class="variant-index">变式 {{ index + 1 }}</span>
          <div class="variant-tags">
            <span class="subject-badge">{{ variant.subject }}</span>
            <span class="type-badge">{{ variant.question_type }}</span>
            <span class="difficulty-badge" :data-level="variant.difficulty">{{ variant.difficulty }}</span>
          </div>
        </div>
        <MathText :text="variant.stem" />
        <div v-if="variant.options.length" class="variant-options">
          <p v-for="option in variant.options" :key="option.key">
            <strong>{{ option.key }}.</strong> {{ option.text }}
          </p>
        </div>
        <details class="variant-answer">
          <summary>查看参考答案与解析</summary>
          <MathText :text="variant.answer" placeholder="暂无答案" />
          <MathText :text="variant.analysis" placeholder="暂无解析" />
        </details>
        <div class="variant-card-foot">
          <div class="tag-row">
            <span v-for="tag in variant.knowledge_tags" :key="tag" class="tag-chip tag-auto">{{ tag }}</span>
          </div>
          <el-button
            size="small"
            :type="savedIds.has(variant.clientId) ? 'success' : 'primary'"
            :loading="savingId === variant.clientId"
            :disabled="savedIds.has(variant.clientId)"
            @click="saveVariant(variant)"
          >
            <el-icon v-if="savedIds.has(variant.clientId)"><Check /></el-icon>
            {{ savedIds.has(variant.clientId) ? '已保存' : '保存到题库' }}
          </el-button>
        </div>
      </article>
    </div>

    <div v-else-if="!loading" class="variant-empty">
      <p>选择数量和难度，让 AI 围绕「{{ question?.subject || '当前考点' }}」生成 1–5 道同考点变式。</p>
      <span>生成内容会先预览，确认后才写入题库。</span>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>
