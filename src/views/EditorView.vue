<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft,
  Camera,
  Upload,
  MagicStick,
  Plus,
  Delete,
  Picture,
  Check
} from '@element-plus/icons-vue';
import MathText from '../components/MathText.vue';
import { useUserStore } from '../stores/user.js';
import { DIFFICULTIES, QUESTION_TYPES, SUBJECTS } from '../lib/constants.js';
import { normalizeOptions } from '../lib/format.js';
import { ocrImage } from '../lib/ocr.js';
import { analyzeQuestion, embedQuestion } from '../lib/ai.js';
import {
  createQuestion,
  getQuestion,
  listQuestionTags,
  logOperation,
  updateQuestion
} from '../lib/questions.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const isEdit = computed(() => Boolean(route.params.id));

const form = reactive({
  stem: '',
  options: [],
  answer: '',
  analysis: '',
  subject: '未分类',
  question_type: '未分类',
  difficulty: '未分类',
  auto_tags: [],
  manual_tags: [],
  image_data: null,
  image_mime: null,
  ocr_text: '',
  source: 'manual'
});

const tagOptions = ref([]);
const imagePreview = ref('');
const pendingImage = ref('');
const saveImage = ref(userStore.imageMode === 'cloud');
const ocrRunning = ref(false);
const ocrProgress = ref(0);
const ocrLabel = ref('');
const analyzing = ref(false);
const aiSource = ref('');
const aiWarning = ref('');
const saving = ref(false);
const loading = ref(false);
const original = ref(null);
const fileInput = ref(null);
const cameraInput = ref(null);

const pageTitle = computed(() => (isEdit.value ? '编辑题目' : '录入新题'));
const hasImage = computed(() => Boolean(imagePreview.value));
const canSave = computed(() => form.stem.trim().length > 0 && !saving.value);

function goBack() {
  if (isEdit.value) router.push(`/questions/${route.params.id}`);
  else router.push('/bank');
}

function applyQuestion(question) {
  original.value = question;
  form.stem = question.stem || '';
  form.options = Array.isArray(question.options) ? question.options.map((item) => ({ ...item })) : [];
  form.answer = question.answer || '';
  form.analysis = question.analysis || '';
  form.subject = question.subject || '未分类';
  form.question_type = question.question_type || '未分类';
  form.difficulty = question.difficulty || '未分类';
  form.auto_tags = [...(question.auto_tags || [])];
  form.manual_tags = [...(question.manual_tags || [])];
  form.image_data = question.image_data || null;
  form.image_mime = question.image_mime || null;
  form.ocr_text = question.ocr_text || '';
  form.source = question.source || 'manual';
  imagePreview.value = question.image_data || '';
  pendingImage.value = '';
  saveImage.value = Boolean(question.image_data);
}

async function loadQuestion() {
  if (!isEdit.value) return;
  loading.value = true;
  try {
    const question = await getQuestion(route.params.id);
    if (!question) {
      ElMessage.error('题目不存在或已删除');
      router.replace('/bank');
      return;
    }
    applyQuestion(question);
  } catch (error) {
    ElMessage.error(error.message || '加载题目失败');
  } finally {
    loading.value = false;
  }
}

function triggerFile() {
  if (ocrRunning.value) return;
  fileInput.value?.click();
}

function triggerCamera() {
  if (ocrRunning.value) return;
  cameraInput.value?.click();
}

async function handleFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  ocrRunning.value = true;
  ocrProgress.value = 0;
  ocrLabel.value = '准备图片';
  aiWarning.value = '';
  try {
    const result = await ocrImage(file, (progress) => {
      ocrLabel.value = progress.label;
      ocrProgress.value = progress.progress;
    });
    imagePreview.value = result.dataUrl;
    pendingImage.value = result.dataUrl;
    form.image_mime = result.mime;
    form.ocr_text = result.ocrText;
    form.source = 'photo';
    if (result.stem) form.stem = result.stem;
    if (result.options?.length) form.options = result.options;
    ElMessage.success('OCR 完成，请校对题干和选项');
    if (form.stem.trim()) await autoAnalyze(true);
  } catch (error) {
    ElMessage.error(error.message || 'OCR 失败，可以先手动输入题目');
  } finally {
    ocrRunning.value = false;
    ocrProgress.value = 0;
    ocrLabel.value = '';
  }
}

function removeImage() {
  imagePreview.value = '';
  pendingImage.value = '';
  form.image_data = null;
  form.image_mime = null;
  if (fileInput.value) fileInput.value.value = '';
  if (cameraInput.value) cameraInput.value.value = '';
}

function addOption() {
  const nextKey = String.fromCharCode(65 + form.options.length);
  form.options.push({ key: nextKey, text: '' });
}

function removeOption(index) {
  form.options.splice(index, 1);
  form.options.forEach((option, idx) => {
    option.key = String.fromCharCode(65 + idx);
  });
}

async function autoAnalyze(silent = false) {
  if (!form.stem.trim()) {
    if (!silent) ElMessage.warning('请先输入或识别题干');
    return;
  }
  analyzing.value = true;
  aiWarning.value = '';
  try {
    const result = await analyzeQuestion({
      ...form,
      options: normalizeOptions(form.options)
    });
    form.subject = result.subject || '未分类';
    form.question_type = result.question_type || '未分类';
    form.difficulty = result.difficulty || '未分类';
    form.auto_tags = result.knowledge_tags || [];
    aiSource.value = result.source;
    aiWarning.value = result.warning || '';
    if (isEdit.value) {
      await logOperation('ai_classify', route.params.id, {
        source: result.source,
        subject: result.subject,
        question_type: result.question_type,
        difficulty: result.difficulty,
        tags: result.knowledge_tags || []
      });
    }
    if (!silent) {
      ElMessage.success(result.source === 'ai' ? 'AI 分类完成，可继续手动修改' : '已使用本地规则分类');
    }
  } catch (error) {
    aiWarning.value = error.message || '自动分类失败';
    if (!silent) ElMessage.error(aiWarning.value);
  } finally {
    analyzing.value = false;
  }
}

async function loadTags() {
  try {
    tagOptions.value = await listQuestionTags();
  } catch {
    tagOptions.value = [];
  }
}

async function save() {
  if (!form.stem.trim()) {
    ElMessage.warning('题干不能为空');
    return;
  }
  saving.value = true;
  try {
    const options = normalizeOptions(form.options);
    const imageData = saveImage.value ? (pendingImage.value || imagePreview.value || null) : null;
    const payload = {
      stem: form.stem.trim(),
      options,
      answer: form.answer || '',
      analysis: form.analysis || '',
      subject: form.subject || '未分类',
      question_type: form.question_type || '未分类',
      difficulty: form.difficulty || '未分类',
      auto_tags: [...new Set(form.auto_tags.map((tag) => String(tag).trim()).filter(Boolean))],
      manual_tags: [...new Set(form.manual_tags.map((tag) => String(tag).trim()).filter(Boolean))],
      image_data: imageData,
      image_mime: imageData ? (form.image_mime || 'image/jpeg') : null,
      ocr_text: form.ocr_text || '',
      source: form.source === 'variant' ? 'variant' : (form.source || 'manual')
    };

    const embedding = await embedQuestion(payload);
    payload.embedding = embedding.vector;

    let id = route.params.id;
    if (isEdit.value) {
      const originalTags = [...(original.value?.auto_tags || []), ...(original.value?.manual_tags || [])].sort();
      const nextTags = [...payload.auto_tags, ...payload.manual_tags].sort();
      await updateQuestion(id, payload);
      await logOperation('update_question', id, {
        fields: ['stem', 'options', 'answer', 'analysis', 'subject', 'difficulty', 'image'],
        embedding_provider: embedding.provider
      });
      if (JSON.stringify(originalTags) !== JSON.stringify(nextTags)) {
        await logOperation('update_tags', id, {
          auto_tags: payload.auto_tags,
          manual_tags: payload.manual_tags
        });
      }
    } else {
      id = await createQuestion(payload);
      await logOperation(payload.source === 'photo' ? 'photo_upload' : 'create_question', id, {
        subject: payload.subject,
        question_type: payload.question_type,
        difficulty: payload.difficulty,
        tags: [...payload.auto_tags, ...payload.manual_tags],
        has_image: Boolean(imageData),
        embedding_provider: embedding.provider
      });
      if (aiSource.value) {
        await logOperation('ai_classify', id, {
          source: aiSource.value,
          subject: payload.subject,
          question_type: payload.question_type,
          difficulty: payload.difficulty,
          tags: payload.auto_tags
        });
      }
    }

    if (embedding.warning) console.warn(embedding.warning);
    ElMessage.success(isEdit.value ? '题目已更新' : '题目已保存到云端');
    router.replace(`/questions/${id}`);
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadQuestion(), loadTags()]);
});
</script>

<template>
  <div class="page-stack editor-page" v-loading="loading">
    <div class="page-heading">
      <div class="heading-left">
        <button type="button" class="back-link" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          {{ isEdit ? '返回题目' : '返回题库' }}
        </button>
        <h2>{{ pageTitle }}</h2>
        <p>拍照识别 → AI 分类 → 校对内容 → 保存云端。所有识别和标签都可以手动修改。</p>
      </div>
      <div class="heading-actions">
        <el-button @click="goBack">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">
          <el-icon><Check /></el-icon>
          {{ isEdit ? '保存修改' : '保存到云端' }}
        </el-button>
      </div>
    </div>

    <div class="editor-grid">
      <div class="editor-main">
        <section class="paper-card form-card">
          <div class="card-heading">
            <div>
              <span class="section-kicker">01 · 题目原文</span>
              <h3>题干与选项</h3>
            </div>
            <span class="form-hint">支持 LaTeX：$...$ 行内，$$...$$ 独立公式</span>
          </div>

          <label class="field-label" for="stem-input">题干 *</label>
          <el-input
            id="stem-input"
            v-model="form.stem"
            type="textarea"
            :rows="8"
            resize="vertical"
            placeholder="输入或粘贴题干。OCR 结果不准确时直接修改。"
          />

          <div class="options-block">
            <div class="options-head">
              <span class="field-label">选项</span>
              <el-button text size="small" @click="addOption">
                <el-icon><Plus /></el-icon> 添加选项
              </el-button>
            </div>
            <div v-if="!form.options.length" class="options-empty">这道题没有选项时可以不填。</div>
            <div v-for="(option, index) in form.options" :key="index" class="option-row">
              <el-input v-model="option.key" class="option-key" maxlength="3" />
              <el-input v-model="option.text" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="选项内容" />
              <button type="button" class="icon-delete" aria-label="删除选项" @click="removeOption(index)">
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </div>

          <div class="two-col-fields">
            <div>
              <label class="field-label" for="answer-input">参考答案</label>
              <el-input id="answer-input" v-model="form.answer" type="textarea" :rows="4" placeholder="填写答案；支持公式" />
            </div>
            <div>
              <label class="field-label" for="analysis-input">解析 / 复盘</label>
              <el-input id="analysis-input" v-model="form.analysis" type="textarea" :rows="4" placeholder="解题步骤、易错点、结论" />
            </div>
          </div>

          <div v-if="form.stem" class="content-preview">
            <span class="preview-label">排版预览</span>
            <MathText :text="form.stem" />
          </div>
        </section>

        <section class="paper-card form-card">
          <div class="card-heading">
            <div>
              <span class="section-kicker">02 · 分类与标签</span>
              <h3>AI 自动判断，可完全手动覆盖</h3>
            </div>
            <el-button size="small" :loading="analyzing" @click="autoAnalyze(false)">
              <el-icon><MagicStick /></el-icon> AI 重新分析
            </el-button>
          </div>

          <div class="three-col-fields">
            <div>
              <span class="field-label">学科</span>
              <el-select v-model="form.subject" style="width: 100%">
                <el-option v-for="item in SUBJECTS" :key="item" :label="item" :value="item" />
              </el-select>
            </div>
            <div>
              <span class="field-label">题型</span>
              <el-select v-model="form.question_type" style="width: 100%">
                <el-option v-for="item in QUESTION_TYPES" :key="item" :label="item" :value="item" />
              </el-select>
            </div>
            <div>
              <span class="field-label">难度</span>
              <el-select v-model="form.difficulty" style="width: 100%">
                <el-option v-for="item in DIFFICULTIES" :key="item" :label="item" :value="item" />
              </el-select>
            </div>
          </div>

          <div class="tag-editor-block">
            <span class="field-label">AI 自动标签 <em>可删改</em></span>
            <el-select
              v-model="form.auto_tags"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="AI 会生成知识点标签，也可以自己输入"
              style="width: 100%"
            >
              <el-option v-for="tag in tagOptions" :key="tag" :label="tag" :value="tag" />
            </el-select>
          </div>

          <div class="tag-editor-block">
            <span class="field-label">手动标签 <em>以你的判断为准</em></span>
            <el-select
              v-model="form.manual_tags"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="例如：易错点、待背诵、真题 2024"
              style="width: 100%"
            >
              <el-option v-for="tag in tagOptions" :key="`manual-${tag}`" :label="tag" :value="tag" />
            </el-select>
          </div>

          <div v-if="aiWarning" class="inline-warning">{{ aiWarning }}</div>
          <div v-else-if="aiSource" class="ai-source-line">
            <span class="source-dot"></span>
            本次分类：{{ aiSource === 'ai' ? 'AI 模型' : '本地关键词降级' }}
          </div>
        </section>
      </div>

      <aside class="editor-side">
        <section class="paper-card image-card">
          <div class="card-heading compact">
            <div>
              <span class="section-kicker">图片 / OCR</span>
              <h3>拍照识别</h3>
            </div>
            <el-icon class="heading-icon"><Picture /></el-icon>
          </div>

          <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFile" />
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="handleFile" />

          <div v-if="imagePreview" class="image-preview">
            <img :src="imagePreview" alt="题目原图预览" />
            <button type="button" class="image-remove" aria-label="移除图片" @click="removeImage">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
          <div v-else class="image-drop">
            <span class="image-drop-mark">OCR</span>
            <p>拍照或选择题目图片</p>
            <small>建议只拍题目区域，识别更准确</small>
          </div>

          <div class="image-actions">
            <el-button :disabled="ocrRunning" @click="triggerCamera">
              <el-icon><Camera /></el-icon> 拍照
            </el-button>
            <el-button :disabled="ocrRunning" @click="triggerFile">
              <el-icon><Upload /></el-icon> 相册 / 文件
            </el-button>
          </div>

          <div v-if="ocrRunning" class="ocr-progress">
            <div class="ocr-progress-head">
              <span>{{ ocrLabel || '正在识别' }}</span>
              <span>{{ Math.round(ocrProgress * 100) }}%</span>
            </div>
            <el-progress :percentage="Math.round(ocrProgress * 100)" :show-text="false" />
            <small>首次识别会加载中英文模型，请保持页面打开。</small>
          </div>

          <div class="image-mode-block">
            <div class="switch-row">
              <div>
                <strong>云端保存原图</strong>
                <small>{{ saveImage ? '压缩后的原图随题目保存' : '只保存识别文字，原图不上传' }}</small>
              </div>
              <el-switch v-model="saveImage" />
            </div>
            <p class="image-mode-note">
              全局默认：{{ userStore.imageModeLabel }}。关闭时仅保留 OCR 文字；开启时原图压缩后写入云端题目数据。
            </p>
          </div>
        </section>

        <section class="paper-card side-summary">
          <span class="section-kicker">保存检查</span>
          <ul>
            <li :class="{ done: form.stem.trim() }">题干已填写</li>
            <li :class="{ done: form.subject !== '未分类' }">学科已判断</li>
            <li :class="{ done: form.auto_tags.length || form.manual_tags.length }">至少一个知识点标签</li>
            <li :class="{ done: form.answer.trim() }">参考答案（可选）</li>
          </ul>
          <el-button type="primary" class="side-save" :loading="saving" :disabled="!canSave" @click="save">
            保存到云端
          </el-button>
        </section>
      </aside>
    </div>
  </div>
</template>
