<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { RefreshLeft, Delete, Check, EditPen } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  saving: { type: Boolean, default: false }
});
const emit = defineEmits(['save']);

const canvas = ref(null);
const tool = ref('pen');
const color = ref('#20332a');
const lineWidth = ref(3);
const dirty = ref(false);
const hasStrokes = ref(false);

let context = null;
let backgroundImage = null;
let lastLoadedData = '';
let drawing = false;
let currentStroke = null;
let lastPoint = null;
let saveTimer = null;

const CANVAS_W = 1200;
const CANVAS_H = 800;
const COLORS = ['#20332a', '#a84f3f', '#315b78', '#8a622f', '#6d4f8a'];

function pointFromEvent(event) {
  const rect = canvas.value.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_H
  };
}

function drawGrid() {
  context.save();
  context.strokeStyle = '#f0ece2';
  context.lineWidth = 1;
  for (let x = 40; x < CANVAS_W; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, CANVAS_H);
    context.stroke();
  }
  for (let y = 40; y < CANVAS_H; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(CANVAS_W, y);
    context.stroke();
  }
  context.restore();
}

function drawStroke(stroke) {
  if (!stroke) return;
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (stroke.tool === 'line') {
    context.beginPath();
    context.moveTo(stroke.start.x, stroke.start.y);
    context.lineTo(stroke.end.x, stroke.end.y);
    context.stroke();
  } else if (stroke.tool === 'rect') {
    context.strokeRect(
      stroke.start.x,
      stroke.start.y,
      stroke.end.x - stroke.start.x,
      stroke.end.y - stroke.start.y
    );
  } else if (stroke.tool === 'ellipse') {
    const cx = (stroke.start.x + stroke.end.x) / 2;
    const cy = (stroke.start.y + stroke.end.y) / 2;
    const rx = Math.abs(stroke.end.x - stroke.start.x) / 2;
    const ry = Math.abs(stroke.end.y - stroke.start.y) / 2;
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (stroke.points?.length) {
    context.beginPath();
    stroke.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    if (stroke.points.length === 1) {
      context.arc(stroke.points[0].x, stroke.points[0].y, Math.max(1, stroke.width / 2), 0, Math.PI * 2);
      context.fill();
    } else {
      context.stroke();
    }
  }
  context.restore();
}

function redraw(preview = null) {
  if (!context) return;
  context.clearRect(0, 0, CANVAS_W, CANVAS_H);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawGrid();
  if (backgroundImage) {
    context.drawImage(backgroundImage, 0, 0, CANVAS_W, CANVAS_H);
  }
  for (const stroke of strokes.value) drawStroke(stroke);
  if (preview) drawStroke(preview);
}

const strokes = ref([]);

function markDirty() {
  dirty.value = true;
  hasStrokes.value = strokes.value.length > 0 || Boolean(backgroundImage);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (dirty.value) emit('save', exportDataUrl());
  }, 1300);
}

function setTool(next) {
  tool.value = next;
  currentStroke = null;
}

function startStroke(event) {
  if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return;
  event.preventDefault();
  canvas.value.setPointerCapture?.(event.pointerId);
  drawing = true;
  const point = pointFromEvent(event);
  lastPoint = point;
  currentStroke = {
    tool: tool.value,
    color: color.value,
    width: tool.value === 'eraser' ? Math.max(14, lineWidth.value * 3.2) : lineWidth.value,
    points: tool.value === 'pen' || tool.value === 'eraser' ? [point] : undefined,
    start: point,
    end: point
  };

  if (tool.value === 'pen' || tool.value === 'eraser') {
    strokes.value.push(currentStroke);
  } else {
    redraw(currentStroke);
  }
}

function moveStroke(event) {
  if (!drawing || !currentStroke) return;
  event.preventDefault();
  const point = pointFromEvent(event);
  if (tool.value === 'pen' || tool.value === 'eraser') {
    const previous = lastPoint;
    lastPoint = point;
    if (previous) {
      context.save();
      context.strokeStyle = tool.value === 'eraser' ? '#ffffff' : color.value;
      context.lineWidth = currentStroke.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.restore();
    }
    currentStroke.points.push(point);
  } else {
    currentStroke.end = point;
    redraw(currentStroke);
  }
}

function endStroke(event) {
  if (!drawing) return;
  drawing = false;
  if (tool.value !== 'pen' && tool.value !== 'eraser' && currentStroke) {
    strokes.value.push(currentStroke);
  }
  currentStroke = null;
  lastPoint = null;
  redraw();
  markDirty();
  try { canvas.value.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
}

function undo() {
  if (!strokes.value.length) return;
  strokes.value.pop();
  redraw();
  markDirty();
}

async function clearAll() {
  if (!strokes.value.length && !backgroundImage) return;
  try {
    await ElMessageBox.confirm('清空后当前草稿内容会被覆盖，是否继续？', '清空草稿', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  strokes.value = [];
  backgroundImage = null;
  lastLoadedData = '';
  hasStrokes.value = false;
  redraw();
  markDirty();
}

function exportDataUrl() {
  if (!canvas.value) return '';
  return canvas.value.toDataURL('image/png');
}

function loadBackground(dataUrl) {
  if (!dataUrl) {
    backgroundImage = null;
    redraw();
    return;
  }
  const image = new Image();
  image.onload = () => {
    backgroundImage = image;
    redraw();
  };
  image.src = dataUrl;
}

function markSaved() {
  dirty.value = false;
}

defineExpose({ markSaved, exportDataUrl });

watch(() => props.modelValue, (value) => {
  if (value === lastLoadedData) return;
  lastLoadedData = value || '';
  if (!dirty.value) {
    strokes.value = [];
    loadBackground(value || '');
  }
});

onMounted(() => {
  context = canvas.value.getContext('2d');
  lastLoadedData = props.modelValue || '';
  loadBackground(props.modelValue || '');
});

onBeforeUnmount(() => {
  clearTimeout(saveTimer);
});
</script>

<template>
  <div class="draft-panel">
    <div class="draft-toolbar">
      <div class="draft-tool-group">
        <button type="button" class="draft-tool" :class="{ active: tool === 'pen' }" @click="setTool('pen')">
          <el-icon><EditPen /></el-icon> 画笔
        </button>
        <button type="button" class="draft-tool" :class="{ active: tool === 'line' }" @click="setTool('line')">直线</button>
        <button type="button" class="draft-tool" :class="{ active: tool === 'rect' }" @click="setTool('rect')">矩形</button>
        <button type="button" class="draft-tool" :class="{ active: tool === 'ellipse' }" @click="setTool('ellipse')">椭圆</button>
        <button type="button" class="draft-tool" :class="{ active: tool === 'eraser' }" @click="setTool('eraser')">橡皮</button>
      </div>

      <div class="draft-tool-group draft-colors">
        <button
          v-for="item in COLORS"
          :key="item"
          type="button"
          class="color-swatch"
          :class="{ active: color === item }"
          :style="{ '--swatch': item }"
          :aria-label="`画笔颜色 ${item}`"
          @click="color = item"
        ></button>
        <select v-model.number="lineWidth" class="draft-width" aria-label="画笔粗细">
          <option :value="2">细</option>
          <option :value="3">中</option>
          <option :value="5">粗</option>
          <option :value="8">特粗</option>
        </select>
      </div>

      <div class="draft-tool-group draft-actions">
        <button type="button" class="draft-tool" :disabled="!hasStrokes" @click="undo">
          <el-icon><RefreshLeft /></el-icon> 撤销
        </button>
        <button type="button" class="draft-tool danger" @click="clearAll">
          <el-icon><Delete /></el-icon> 清空
        </button>
        <button type="button" class="draft-save" :disabled="saving" @click="emit('save', exportDataUrl())">
          <el-icon><Check /></el-icon> {{ saving ? '保存中…' : '保存草稿' }}
        </button>
      </div>
    </div>

    <div class="draft-canvas-wrap">
      <canvas
        ref="canvas"
        :width="CANVAS_W"
        :height="CANVAS_H"
        @pointerdown="startStroke"
        @pointermove="moveStroke"
        @pointerup="endStroke"
        @pointercancel="endStroke"
        @pointerleave="drawing && endStroke($event)"
      ></canvas>
      <span v-if="!hasStrokes && !modelValue" class="draft-placeholder">在这里画供需图、IS-LM、生产函数或手写推导…</span>
    </div>
    <div class="draft-foot">
      <span>支持触屏手写 · 图形工具 · 自动保存</span>
      <span :class="dirty ? 'draft-dirty' : 'draft-saved'">{{ dirty ? '有改动，即将保存' : '已保存到云端' }}</span>
    </div>
  </div>
</template>
