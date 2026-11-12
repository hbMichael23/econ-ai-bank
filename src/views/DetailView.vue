<script setup>
import { nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft,
  EditPen,
  Delete,
  MagicStick,
  Search,
  Plus,
  Check,
  Close,
  ChatLineSquare,
  Picture
} from '@element-plus/icons-vue';
import MathText from '../components/MathText.vue';
import DraftCanvas from '../components/DraftCanvas.vue';
import VariantDialog from '../components/VariantDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import { formatDateTime } from '../lib/format.js';
import { uid } from '../lib/device.js';
import {
  findSimilarQuestions,
  getNoteRow,
  getQuestion,
  logOperation,
  saveNoteRow,
  softDeleteQuestions
} from '../lib/questions.js';

const route = useRoute();
const router = useRouter();

const question = ref(null);
const noteRow = ref(null);
const notes = ref([]);
const draftData = ref('');
const loading = ref(true);
const noteInput = ref('');
const addingNote = ref(false);
const editingId = ref('');
const editingContent = ref('');
const savingNotes = ref(false);
const draftSaving = ref(false);
let pendingDraft = '';
const canvasRef = ref(null);
const similar = ref([]);
const similarLoading = ref(false);
const similarLoaded = ref(false);
const variantOpen = ref(false);

function syncNotes(row) {
  noteRow.value = row || null;
  notes.value = Array.isArray(row?.notes) ? row.notes.map((item) => ({ ...item })) : [];
  draftData.value = row?.draft_data || '';
}

async function loadQuestion() {
  loading.value = true;
  similarLoaded.value = false;
  similar.value = [];
  try {
    const result = await getQuestion(route.params.id);
    if (!result) {
      ElMessage.error('题目不存在或已删除');
      router.replace('/bank');
      return;
    }
    question.value = result;
    const row = await getNoteRow(result.id);
    syncNotes(row);
    logOperation('view_question', result.id, {
      subject: result.subject,
      question_type: result.question_type
    });
  } catch (error) {
    ElMessage.error(error.message || '加载题目失败');
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push('/bank');
}

async function persistNotes() {
  if (!question.value) return;
  savingNotes.value = true;
  try {
    const row = await saveNoteRow(question.value.id, notes.value);
    noteRow.value = row;
    await logOperation('update_note', question.value.id, {
      note_count: notes.value.length
    });
  } catch (error) {
    ElMessage.error(error.message || '保存批注失败');
    throw error;
  } finally {
    savingNotes.value = false;
  }
}

async function addNote() {
  const content = noteInput.value.trim();
  if (!content) {
    ElMessage.warning('批注不能为空');
    return;
  }
  addingNote.value = true;
  const now = new Date().toISOString();
  notes.value = [
    ...notes.value,
    { id: uid(), content, created_at: now, updated_at: now }
  ];
  try {
    noteInput.value = '';
    await persistNotes();
    ElMessage.success('批注已保存到云端');
  } catch {
    notes.value = notes.value.slice(0, -1);
  } finally {
    addingNote.value = false;
  }
}

function beginEdit(note) {
  editingId.value = note.id;
  editingContent.value = note.content;
  nextTick(() => document.getElementById('note-edit-input')?.focus());
}

function cancelEdit() {
  editingId.value = '';
  editingContent.value = '';
}

async function saveEdit(note) {
  const content = editingContent.value.trim();
  if (!content) {
    ElMessage.warning('批注不能为空');
    return;
  }
  const previous = note.content;
  note.content = content;
  note.updated_at = new Date().toISOString();
  try {
    await persistNotes();
    cancelEdit();
    ElMessage.success('批注已更新');
  } catch {
    note.content = previous;
  }
}

async function removeNote(note) {
  try {
    await ElMessageBox.confirm('删除这条批注？该操作会同步到所有设备。', '删除批注', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  const previous = notes.value;
  notes.value = notes.value.filter((item) => item.id !== note.id);
  try {
    await persistNotes();
    ElMessage.success('批注已删除');
  } catch {
    notes.value = previous;
  }
}

async function saveDraft(dataUrl) {
  if (!question.value || !dataUrl) return;
  if (draftSaving.value) {
    pendingDraft = dataUrl;
    return;
  }
  draftSaving.value = true;
  try {
    const row = await saveNoteRow(question.value.id, notes.value, dataUrl, 'image/png');
    noteRow.value = row;
    draftData.value = row?.draft_data || dataUrl;
    canvasRef.value?.markSaved?.();
    await logOperation('edit_draft', question.value.id, {
      bytes: dataUrl.length
    });
  } catch (error) {
    ElMessage.error(error.message || '草稿保存失败');
  } finally {
    draftSaving.value = false;
    if (pendingDraft) {
      const next = pendingDraft;
      pendingDraft = '';
      setTimeout(() => saveDraft(next), 0);
    }
  }
}

async function loadSimilar() {
  if (!question.value) return;
  similarLoading.value = true;
  try {
    const rows = await findSimilarQuestions(question.value.id, 8);
    similar.value = rows;
    similarLoaded.value = true;
    await logOperation('query_similar', question.value.id, { count: rows.length });
    if (!rows.length) {
      ElMessage.info('暂时没有相似题。新题保存时会自动生成向量；可先编辑保存一次再试。');
    }
  } catch (error) {
    ElMessage.error(error.message || '相似题检索失败');
  } finally {
    similarLoading.value = false;
  }
}

async function deleteQuestion() {
  try {
    await ElMessageBox.confirm('删除后将从题库隐藏，操作日志会保留，系统不会自动清理数据。确认删除？', '删除题目', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  try {
    await softDeleteQuestions([question.value.id]);
    await logOperation('delete_question', question.value.id, { mode: 'single' });
    ElMessage.success('题目已删除');
    router.replace('/bank');
  } catch (error) {
    ElMessage.error(error.message || '删除失败');
  }
}

function openSimilar(item) {
  if (item?.id) router.push(`/questions/${item.id}`);
}

watch(() => route.params.id, () => {
  if (route.name === 'question-detail') loadQuestion();
});

onMounted(loadQuestion);
</script>

<template>
  <div v-loading="loading" class="page-stack detail-page">
    <template v-if="question">
      <div class="page-heading detail-heading">
        <div class="heading-left">
          <button type="button" class="back-link" @click="goBack">
            <el-icon><ArrowLeft /></el-icon> 返回题库
          </button>
          <h2>题目详情</h2>
          <p>批注、草稿和标签都会随题目同步到同一套题库的其他设备。</p>
        </div>
        <div class="heading-actions">
          <el-button @click="variantOpen = true">
            <el-icon><MagicStick /></el-icon> AI 变式
          </el-button>
          <el-button type="primary" @click="router.push(`/questions/${question.id}/edit`)">
            <el-icon><EditPen /></el-icon> 编辑
          </el-button>
          <el-button type="danger" plain @click="deleteQuestion">
            <el-icon><Delete /></el-icon> 删除
          </el-button>
        </div>
      </div>

      <section class="paper-card question-detail-card">
        <div class="detail-kicker-row">
          <span class="subject-badge">{{ question.subject }}</span>
          <span class="type-badge">{{ question.question_type }}</span>
          <span class="difficulty-badge" :data-level="question.difficulty">{{ question.difficulty }}</span>
          <span class="detail-date">录入于 {{ formatDateTime(question.created_at) }}</span>
          <span v-if="question.image_mime" class="has-image-label"><el-icon><Picture /></el-icon> 含原图</span>
        </div>

        <div class="question-stem">
          <MathText :text="question.stem" placeholder="暂无题干" />
        </div>

        <div v-if="question.options?.length" class="detail-options">
          <div v-for="option in question.options" :key="option.key" class="detail-option">
            <span class="option-letter">{{ option.key }}</span>
            <MathText :text="option.text" />
          </div>
        </div>

        <div v-if="question.image_data" class="detail-image">
          <img :src="question.image_data" alt="题目原图" />
        </div>

        <div class="answer-grid">
          <div class="answer-block">
            <span class="block-label">参考答案</span>
            <MathText :text="question.answer" placeholder="暂未填写参考答案" />
          </div>
          <div class="answer-block">
            <span class="block-label">解析 / 复盘</span>
            <MathText :text="question.analysis" placeholder="暂未填写解析" />
          </div>
        </div>

        <div class="detail-tags">
          <div v-if="question.auto_tags?.length" class="tag-line">
            <span class="tag-line-label">AI 标签</span>
            <span v-for="tag in question.auto_tags" :key="`auto-${tag}`" class="tag-chip tag-auto">{{ tag }}</span>
          </div>
          <div v-if="question.manual_tags?.length" class="tag-line">
            <span class="tag-line-label">手动标签</span>
            <span v-for="tag in question.manual_tags" :key="`manual-${tag}`" class="tag-chip tag-manual">{{ tag }}</span>
          </div>
        </div>
      </section>

      <div class="detail-split">
        <section class="paper-card notes-card">
          <div class="card-heading">
            <div>
              <span class="section-kicker">批注区</span>
              <h3>复盘、踩坑点、背诵口诀</h3>
            </div>
            <span class="note-count">{{ notes.length }} 条</span>
          </div>

          <div class="note-composer">
            <el-input
              v-model="noteInput"
              type="textarea"
              :rows="3"
              maxlength="3000"
              show-word-limit
              placeholder="写下这道题的易错点、解题套路或口诀…支持 LaTeX"
              @keydown.ctrl.enter="addNote"
              @keydown.meta.enter="addNote"
            />
            <div class="note-composer-foot">
              <span>Ctrl / ⌘ + Enter 保存</span>
              <el-button type="primary" size="small" :loading="addingNote" @click="addNote">
                <el-icon><Plus /></el-icon> 添加批注
              </el-button>
            </div>
          </div>

          <div v-if="notes.length" class="note-list">
            <article v-for="note in notes" :key="note.id" class="note-item">
              <div v-if="editingId === note.id" class="note-edit">
                <el-input
                  id="note-edit-input"
                  v-model="editingContent"
                  type="textarea"
                  :rows="4"
                  maxlength="3000"
                />
                <div class="note-edit-actions">
                  <el-button size="small" :icon="Close" @click="cancelEdit">取消</el-button>
                  <el-button size="small" type="primary" :icon="Check" :loading="savingNotes" @click="saveEdit(note)">保存</el-button>
                </div>
              </div>
              <template v-else>
                <MathText :text="note.content" />
                <div class="note-meta">
                  <span>{{ formatDateTime(note.updated_at || note.created_at) }}</span>
                  <div class="note-actions">
                    <button type="button" @click="beginEdit(note)">编辑</button>
                    <button type="button" class="danger-text" @click="removeNote(note)">删除</button>
                  </div>
                </div>
              </template>
            </article>
          </div>
          <div v-else class="notes-empty">
            <el-icon><ChatLineSquare /></el-icon>
            <span>还没有批注。第一条批注往往是最有价值的复盘。</span>
          </div>
        </section>

        <section class="paper-card draft-card">
          <div class="card-heading">
            <div>
              <span class="section-kicker">草稿纸</span>
              <h3>供需图、IS-LM、生产函数草图</h3>
            </div>
            <span v-if="draftSaving" class="draft-saving">保存中…</span>
          </div>
          <DraftCanvas
            ref="canvasRef"
            :model-value="draftData"
            :saving="draftSaving"
            @save="saveDraft"
          />
        </section>
      </div>

      <section class="paper-card similar-card">
        <div class="card-heading">
          <div>
            <span class="section-kicker">私有语义检索</span>
            <h3>库内相似题</h3>
            <p class="section-desc">只检索当前 token 下的题目，不访问外部题库。</p>
          </div>
          <el-button :loading="similarLoading" @click="loadSimilar">
            <el-icon><Search /></el-icon> {{ similarLoaded ? '重新检索' : '查找相似题' }}
          </el-button>
        </div>

        <div v-if="similar.length" class="similar-list">
          <button
            v-for="item in similar"
            :key="item.id"
            type="button"
            class="similar-item"
            @click="openSimilar(item)"
          >
            <div class="similar-head">
              <span class="similar-score">{{ Math.round((item.similarity || 0) * 100) }}%</span>
              <span class="subject-badge">{{ item.subject }}</span>
              <span class="type-badge">{{ item.question_type }}</span>
              <span class="difficulty-badge" :data-level="item.difficulty">{{ item.difficulty }}</span>
            </div>
            <MathText :text="item.stem" compact />
            <div class="tag-row">
              <span v-for="tag in [...(item.auto_tags || []), ...(item.manual_tags || [])].slice(0, 4)" :key="tag" class="tag-chip tag-auto">{{ tag }}</span>
            </div>
          </button>
        </div>
        <div v-else-if="similarLoaded && !similarLoading" class="similar-empty">
          暂时没有相似题。库内题目越多、向量生成越完整，检索效果越好。
        </div>
        <div v-else class="similar-empty">
          点击「查找相似题」，在自己的题库中找同考点历史题。
        </div>
      </section>

      <VariantDialog v-model="variantOpen" :question="question" @saved="() => {}" />
    </template>

    <EmptyState
      v-else-if="!loading"
      title="题目打不开"
      description="它可能已经被删除，或不属于当前设备题库。"
      mark="失"
    >
      <el-button type="primary" @click="goBack">返回题库</el-button>
    </EmptyState>
  </div>
</template>
