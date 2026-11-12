import {
  AI_FUNCTION_URL,
  SUPABASE_ANON_KEY,
  isSupabaseConfigured
} from './supabase.js';
import { getSession } from './session.js';
import {
  buildEmbeddingText,
  classifyLocally,
  localEmbedding
} from './local-ai.js';
import { DIFFICULTIES, QUESTION_TYPES, SUBJECTS } from './constants.js';

export class AiNotConfiguredError extends Error {
  constructor(message = 'AI 服务尚未配置。请先部署 ai Edge Function 并设置模型密钥。') {
    super(message);
    this.code = 'ai_not_configured';
    this.name = 'AiNotConfiguredError';
  }
}

function cleanList(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 16);
}

function normalizeClassification(data = {}) {
  return {
    subject: cleanList(data.subject, SUBJECTS, '未分类'),
    question_type: cleanList(data.question_type, QUESTION_TYPES, '未分类'),
    difficulty: cleanList(data.difficulty, DIFFICULTIES, '未分类'),
    knowledge_tags: normalizeTags(data.knowledge_tags || data.tags)
  };
}

async function callAi(action, payload) {
  if (!isSupabaseConfigured || !AI_FUNCTION_URL) {
    throw new AiNotConfiguredError();
  }
  const token = getSession().token;
  if (!token) throw new Error('设备 token 尚未初始化。');

  const response = await fetch(AI_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-token': token
    },
    body: JSON.stringify({ action, payload })
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `AI 服务返回 ${response.status}`;
    if (response.status === 503 || data?.code === 'ai_not_configured') {
      throw new AiNotConfiguredError(message);
    }
    const error = new Error(message);
    error.code = data?.code || `ai_http_${response.status}`;
    throw error;
  }
  return data;
}

/**
 * AI 分类；没有配置或调用失败时自动降级到本地关键词分类。
 */
export async function analyzeQuestion(question) {
  try {
    const response = await callAi('classify', {
      stem: question.stem,
      options: question.options || [],
      answer: question.answer || '',
      analysis: question.analysis || ''
    });
    return {
      ...normalizeClassification(response.data || response),
      source: 'ai',
      warning: ''
    };
  } catch (error) {
    const local = classifyLocally(question);
    return {
      ...local,
      source: 'local',
      warning: error?.code === 'ai_not_configured'
        ? '未配置 AI 模型，已使用本地关键词分类；可在设置中部署 AI Edge Function。'
        : `AI 分类失败，已降级为本地关键词分类：${error.message}`
    };
  }
}

function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 1024) {
    throw new Error(`embedding 维度不是 1024（实际 ${Array.isArray(vector) ? vector.length : '未知'}）`);
  }
  return vector.map((value) => Number(value));
}

/**
 * 优先使用向量模型；未配置或调用失败时使用本地 hashed embedding。
 * 返回的 provider 会显示在界面上，方便判断相似检索质量。
 */
export async function embedQuestion(question) {
  const text = buildEmbeddingText(question);
  try {
    const response = await callAi('embed', { text });
    return {
      vector: validateVector(response.embedding || response.data?.embedding),
      provider: 'ai',
      model: response.model || 'embedding',
      warning: ''
    };
  } catch (error) {
    return {
      vector: localEmbedding(text),
      provider: 'local',
      model: 'local-hashed-1024',
      warning: error?.code === 'ai_not_configured'
        ? '未配置 embedding 模型，使用本地向量；相似题仍可用，但语义质量有限。'
        : `embedding 调用失败，使用本地向量：${error.message}`
    };
  }
}

export async function generateVariants(question, options = {}) {
  const count = Math.min(5, Math.max(1, Number(options.count) || 3));
  const difficultyMode = ['same', 'harder', 'easier'].includes(options.difficultyMode)
    ? options.difficultyMode
    : 'same';

  const response = await callAi('variants', {
    stem: question.stem,
    options: question.options || [],
    answer: question.answer || '',
    analysis: question.analysis || '',
    subject: question.subject || '未分类',
    question_type: question.question_type || '未分类',
    difficulty: question.difficulty || '未分类',
    tags: [...new Set([...(question.auto_tags || []), ...(question.manual_tags || [])])],
    count,
    difficultyMode
  });

  const list = Array.isArray(response.variants) ? response.variants : response.data?.variants;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('AI 没有返回有效变式题，请重试。');
  }

  return list.slice(0, count).map((item, index) => {
    const optionList = Array.isArray(item.options)
      ? item.options.map((option, optionIndex) => ({
          key: String(option?.key || String.fromCharCode(65 + optionIndex)).slice(0, 4),
          text: String(option?.text || '').trim()
        })).filter((option) => option.text)
      : [];
    return {
      clientId: `variant-${Date.now()}-${index}`,
      stem: String(item.stem || '').trim(),
      options: optionList,
      answer: String(item.answer || '').trim(),
      analysis: String(item.analysis || '').trim(),
      subject: cleanList(item.subject, SUBJECTS, question.subject || '未分类'),
      question_type: cleanList(item.question_type, QUESTION_TYPES, question.question_type || '未分类'),
      difficulty: cleanList(item.difficulty, DIFFICULTIES, question.difficulty || '未分类'),
      knowledge_tags: normalizeTags(item.knowledge_tags || item.tags)
    };
  }).filter((item) => item.stem);
}

export function aiModeLabel(source) {
  return source === 'ai' ? 'AI 模型' : '本地降级';
}
