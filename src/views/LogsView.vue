<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Document, Refresh } from '@element-plus/icons-vue';
import EmptyState from '../components/EmptyState.vue';
import { formatDateTime } from '../lib/format.js';
import { listLogs } from '../lib/questions.js';
import { OPERATION_COLORS, OPERATION_LABELS, OPERATION_TYPES } from '../lib/constants.js';

const router = useRouter();
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const loading = ref(false);
const operationType = ref('');
let loadSeq = 0;

const filterLabel = computed(() => (operationType.value ? OPERATION_LABELS[operationType.value] : '全部操作'));

function detailSummary(log) {
  const detail = log.detail || {};
  const parts = [];
  if (detail.subject) parts.push(detail.subject);
  if (detail.question_type) parts.push(detail.question_type);
  if (detail.difficulty) parts.push(detail.difficulty);
  if (Array.isArray(detail.tags) && detail.tags.length) parts.push(detail.tags.slice(0, 3).join('、'));
  if (detail.note_count !== undefined) parts.push(`${detail.note_count} 条批注`);
  if (detail.count !== undefined) parts.push(`${detail.count} 道`);
  if (detail.status === 'failed') parts.push('调用失败');
  if (detail.error) parts.push(detail.error);
  if (detail.has_image) parts.push('含原图');
  if (detail.embedding_provider) parts.push(detail.embedding_provider === 'ai' ? 'AI 向量' : '本地向量');
  return parts.join(' · ');
}

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const result = await listLogs({
      page: page.value,
      pageSize,
      operationType: operationType.value
    });
    if (seq !== loadSeq) return;
    rows.value = result.rows;
    total.value = result.count;
  } catch (error) {
    if (seq === loadSeq) ElMessage.error(error.message || '加载操作记录失败');
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function changePage(next) {
  page.value = next;
  load();
}

function openQuestion(log) {
  if (log.question_id) router.push(`/questions/${log.question_id}`);
}

watch(operationType, () => {
  page.value = 1;
  load();
});

onMounted(load);
</script>

<template>
  <div class="page-stack logs-page">
    <div class="page-heading">
      <div class="heading-left">
        <span class="page-kicker">CLOUD AUDIT TRAIL</span>
        <h2>操作记录</h2>
        <p>上传、修改、批注、草稿、删除、相似检索和 AI 调用都会留下云端记录。日志不可手动删除。</p>
      </div>
      <div class="heading-actions">
        <el-select v-model="operationType" clearable placeholder="全部操作类型" style="width: 170px">
          <el-option
            v-for="type in OPERATION_TYPES"
            :key="type"
            :label="OPERATION_LABELS[type]"
            :value="type"
          />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="log-summary paper-card">
      <div class="log-summary-icon"><el-icon><Document /></el-icon></div>
      <div>
        <strong>{{ total }}</strong>
        <span>条云端记录 · {{ filterLabel }}</span>
      </div>
      <p>同一套 token / 迁移密钥下，所有设备看到同一份审计记录。</p>
    </div>

    <div v-loading="loading" class="log-list">
      <article v-for="log in rows" :key="log.id" class="log-row paper-card">
        <div class="log-time">
          <span>{{ formatDateTime(log.operation_time).slice(0, 10) }}</span>
          <b>{{ formatDateTime(log.operation_time).slice(11) }}</b>
        </div>
        <div class="log-line">
          <span
            class="log-dot"
            :style="{ background: OPERATION_COLORS[log.operation_type] || '#6b6256' }"
          ></span>
          <div class="log-content">
            <div class="log-title-row">
              <strong>{{ OPERATION_LABELS[log.operation_type] || log.operation_type }}</strong>
              <span class="log-device">{{ log.device_label || '未知设备' }}</span>
            </div>
            <p v-if="detailSummary(log)" class="log-detail">{{ detailSummary(log) }}</p>
            <p v-else class="log-detail muted">无附加详情</p>
          </div>
          <button
            v-if="log.question_id"
            type="button"
            class="log-question-link"
            @click="openQuestion(log)"
          >
            题目 {{ String(log.question_id).slice(0, 8) }} →
          </button>
        </div>
      </article>

      <EmptyState
        v-if="!rows.length && !loading"
        title="还没有操作记录"
        description="录入第一道题后，云端会自动记录每一步操作。"
        mark="录"
      />
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
