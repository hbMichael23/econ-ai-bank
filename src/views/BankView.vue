<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Delete, Refresh, Select } from '@element-plus/icons-vue';
import QuestionCard from '../components/QuestionCard.vue';
import EmptyState from '../components/EmptyState.vue';
import { listQuestions, listQuestionTags, logOperation, softDeleteQuestions } from '../lib/questions.js';
import { DIFFICULTIES, QUESTION_TYPES, SUBJECTS } from '../lib/constants.js';

const router = useRouter();
const filters = reactive({
  search: '',
  subject: '',
  questionType: '',
  difficulty: '',
  tag: ''
});
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 12;
const loading = ref(false);
const tags = ref([]);
const selectMode = ref(false);
const selected = ref(new Set());
const deleting = ref(false);

let filterTimer = null;
let loadSeq = 0;

const selectedIds = computed(() => [...selected.value]);
const allPageSelected = computed(() => rows.value.length > 0 && rows.value.every((row) => selected.value.has(row.id)));
const somePageSelected = computed(() => rows.value.some((row) => selected.value.has(row.id)) && !allPageSelected.value);
const hasFilters = computed(() => Boolean(filters.search || filters.subject || filters.questionType || filters.difficulty || filters.tag));

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const result = await listQuestions({
      page: page.value,
      pageSize,
      search: filters.search,
      subject: filters.subject,
      questionType: filters.questionType,
      difficulty: filters.difficulty,
      tag: filters.tag
    });
    if (seq !== loadSeq) return;
    rows.value = result.rows;
    total.value = result.count;
    if (!result.rows.length && page.value > 1) {
      page.value = Math.max(1, Math.ceil(result.count / pageSize));
      await load();
    }
  } catch (error) {
    if (seq === loadSeq) ElMessage.error(error.message || '加载题库失败');
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function loadTags() {
  try {
    tags.value = await listQuestionTags();
  } catch {
    tags.value = [];
  }
}

function resetAndLoad() {
  page.value = 1;
  selected.value = new Set();
  load();
}

function resetFilters() {
  filters.search = '';
  filters.subject = '';
  filters.questionType = '';
  filters.difficulty = '';
  filters.tag = '';
  resetAndLoad();
}

function changePage(next) {
  page.value = next;
  selected.value = new Set();
  load();
}

function openQuestion(question) {
  if (selectMode.value) {
    toggleOne(question.id);
    return;
  }
  router.push(`/questions/${question.id}`);
}

function toggleOne(id) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAll() {
  if (allPageSelected.value) {
    const next = new Set(selected.value);
    for (const row of rows.value) next.delete(row.id);
    selected.value = next;
  } else {
    selected.value = new Set([...selected.value, ...rows.value.map((row) => row.id)]);
  }
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) selected.value = new Set();
}

async function deleteSelected() {
  const ids = selectedIds.value;
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(
      `将删除选中的 ${ids.length} 道题目。题目会从题库隐藏，但操作日志保留；系统不会自动清理数据。确认删除？`,
      '批量删除题目',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    );
  } catch {
    return;
  }
  deleting.value = true;
  try {
    const deleted = await softDeleteQuestions(ids);
    await Promise.all(ids.map((id) => logOperation('delete_question', id, { mode: 'batch' })));
    ElMessage.success(`已删除 ${deleted} 道题目`);
    selected.value = new Set();
    selectMode.value = false;
    await load();
    await loadTags();
  } catch (error) {
    ElMessage.error(error.message || '删除失败');
  } finally {
    deleting.value = false;
  }
}

watch(
  () => [filters.search, filters.subject, filters.questionType, filters.difficulty, filters.tag],
  () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(resetAndLoad, 280);
  }
);

onMounted(async () => {
  await Promise.all([load(), loadTags()]);
});
</script>

<template>
  <div class="page-stack bank-page">
    <section class="bank-hero">
      <div class="bank-hero-copy">
        <span class="page-kicker">YOUR PRIVATE ECONOMICS BANK</span>
        <h2>把每一道题，<em>变成自己的知识结构。</em></h2>
        <p>拍照识别、AI 分类、批注草稿、相似题与变式训练，全部只属于这一套私有题库。</p>
      </div>
      <div class="bank-hero-actions">
        <el-button size="large" type="primary" @click="router.push('/questions/new')">
          <el-icon><Plus /></el-icon> 录入新题
        </el-button>
        <span class="hero-count"><b>{{ total }}</b> 道题目已沉淀</span>
      </div>
    </section>

    <section class="paper-card filter-card">
      <div class="filter-search">
        <el-input
          v-model="filters.search"
          clearable
          size="large"
          placeholder="搜索题干关键词…"
          :prefix-icon="Search"
        />
      </div>
      <div class="filter-selects">
        <el-select v-model="filters.subject" clearable placeholder="学科" style="width: 138px">
          <el-option v-for="item in SUBJECTS" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="filters.questionType" clearable placeholder="题型" style="width: 126px">
          <el-option v-for="item in QUESTION_TYPES" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="filters.difficulty" clearable placeholder="难度" style="width: 118px">
          <el-option v-for="item in DIFFICULTIES" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="filters.tag" clearable filterable placeholder="知识点标签" style="width: 170px">
          <el-option v-for="tag in tags" :key="tag" :label="tag" :value="tag" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" aria-label="刷新题库" @click="load" />
      </div>
    </section>

    <div class="bank-toolbar">
      <div class="list-summary">
        <strong>{{ hasFilters ? '筛选结果' : '全部题目' }}</strong>
        <span>{{ total }} 道</span>
        <span v-if="hasFilters" class="filter-active">已启用筛选</span>
      </div>
      <div class="toolbar-actions">
        <el-button size="small" :type="selectMode ? 'primary' : 'default'" @click="toggleSelectMode">
          <el-icon><Select /></el-icon> {{ selectMode ? '退出批量' : '批量选择' }}
        </el-button>
      </div>
    </div>

    <div v-if="selectMode" class="batch-bar">
      <el-checkbox
        :model-value="allPageSelected"
        :indeterminate="somePageSelected"
        @change="toggleAll"
      >
        全选本页
      </el-checkbox>
      <span>已选 {{ selected.size }} 道</span>
      <el-button type="danger" size="small" :disabled="!selected.size" :loading="deleting" @click="deleteSelected">
        <el-icon><Delete /></el-icon> 删除选中
      </el-button>
    </div>

    <div v-loading="loading" class="question-grid-wrap">
      <div v-if="rows.length" class="question-grid">
        <QuestionCard
          v-for="question in rows"
          :key="question.id"
          :question="question"
          :selectable="selectMode"
          :selected="selected.has(question.id)"
          @open="openQuestion"
          @toggle="toggleOne"
        />
      </div>
      <EmptyState
        v-else-if="!loading"
        :title="hasFilters ? '没有符合条件的题目' : '题库还是空的'"
        :description="hasFilters ? '换一个关键词或清除筛选条件试试。' : '拍一张真题或错题，OCR 后 AI 会自动分类打标签。'"
        :mark="hasFilters ? '筛' : '题'"
      >
        <el-button v-if="hasFilters" @click="resetFilters">清除筛选</el-button>
        <el-button v-else type="primary" @click="router.push('/questions/new')">录入第一道题</el-button>
      </EmptyState>
    </div>

    <div v-if="total > pageSize" class="pagination-row">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        background
        layout="prev, pager, next"
        @current-change="changePage"
      />
    </div>
  </div>
</template>
