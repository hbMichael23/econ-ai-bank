import { requireSupabase } from './supabase.js';
import { getSession } from './session.js';

const LIST_FIELDS = [
  'id',
  'stem',
  'options',
  'answer',
  'subject',
  'question_type',
  'difficulty',
  'auto_tags',
  'manual_tags',
  'tags',
  'created_at',
  'source',
  'image_mime'
].join(',');

const DETAIL_FIELDS = [
  'id',
  'user_set_id',
  'user_token',
  'stem',
  'options',
  'answer',
  'analysis',
  'auto_tags',
  'manual_tags',
  'tags',
  'subject',
  'question_type',
  'difficulty',
  'image_data',
  'image_mime',
  'ocr_text',
  'source',
  'created_at',
  'updated_at'
].join(',');

function sessionOrThrow() {
  const session = getSession();
  if (!session.token || !session.userSetId) {
    throw new Error('本地设备 token 尚未初始化，请刷新页面。');
  }
  return session;
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function isVectorInputError(error) {
  return /vector|invalid input syntax/i.test(String(error?.message || ''));
}

function vectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

function questionPayload(payload, embeddingValue) {
  return { ...payload, embedding: embeddingValue };
}

export async function listQuestions(filters = {}) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize) || 12));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('question')
    .select(LIST_FIELDS, { count: 'exact' })
    .eq('user_token', session.token)
    .is('deleted_at', null);

  if (filters.subject) query = query.eq('subject', filters.subject);
  if (filters.questionType) query = query.eq('question_type', filters.questionType);
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
  if (filters.tag) query = query.contains('tags', [filters.tag]);
  if (filters.search) query = query.ilike('stem', `%${escapeLike(filters.search.trim())}%`);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { rows: data || [], count: count || 0, page, pageSize };
}

export async function getQuestion(id) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('question')
    .select(DETAIL_FIELDS)
    .eq('id', id)
    .eq('user_token', session.token)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createQuestion(payload) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const base = {
    ...payload,
    user_set_id: session.userSetId,
    user_token: session.token,
    updated_at: new Date().toISOString()
  };

  let { data, error } = await supabase
    .from('question')
    .insert(base)
    .select('id')
    .single();

  // PostgREST 对 vector 的 JSON 序列化可能因版本不同；数组失败时退化为
  // pgvector 文本字面量 "[0.1,0.2,...]"。
  if (error && payload.embedding && isVectorInputError(error)) {
    const retry = await supabase
      .from('question')
      .insert(questionPayload(base, vectorLiteral(payload.embedding)))
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data.id;
}

export async function updateQuestion(id, payload) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const base = {
    ...payload,
    user_token: session.token,
    updated_at: new Date().toISOString()
  };

  const run = (value) => supabase
    .from('question')
    .update(questionPayload(base, value))
    .eq('id', id)
    .eq('user_token', session.token)
    .is('deleted_at', null)
    .select('id')
    .single();

  let { data, error } = await run(base.embedding);

  if (error && payload.embedding && isVectorInputError(error)) {
    const retry = await run(vectorLiteral(payload.embedding));
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data.id;
}

export async function softDeleteQuestions(ids) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return 0;
  const { data, error } = await supabase
    .from('question')
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .in('id', uniqueIds)
    .eq('user_token', session.token)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}

export async function logOperation(operationType, questionId = null, detail = {}) {
  try {
    const session = sessionOrThrow();
    const supabase = requireSupabase();
    const { error } = await supabase
      .from('operation_log')
      .insert({
        user_set_id: session.userSetId,
        user_token: session.token,
        operation_type: operationType,
        question_id: questionId,
        device_label: session.deviceLabel || '未知设备',
        detail: detail || {}
      });
    if (error) console.warn('写入操作日志失败', error);
  } catch (error) {
    console.warn('写入操作日志失败', error);
  }
}

export async function listQuestionTags() {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('list_question_tags');
  if (error) throw error;
  return (data || []).map((row) => row.tag).filter(Boolean);
}

export async function findSimilarQuestions(questionId, limit = 8) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('match_questions_for_question', {
    p_question_id: questionId,
    p_limit: limit
  });
  if (error) throw error;
  return data || [];
}

export async function getNoteRow(questionId) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('question_note')
    .select('*')
    .eq('question_id', questionId)
    .eq('user_token', session.token)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function saveNoteRow(questionId, notes, draftData = undefined, draftMime = 'image/png') {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const payload = {
    question_id: questionId,
    user_set_id: session.userSetId,
    user_token: session.token,
    updated_at: new Date().toISOString()
  };
  // 批注与草稿是同一行的两个独立字段。分开 upsert，避免草稿自动保存
  // 用旧的 notes 覆盖刚编辑的批注（或相反）。
  if (draftData !== undefined) {
    payload.draft_data = draftData;
    payload.draft_mime = draftMime;
  } else {
    payload.notes = Array.isArray(notes) ? notes : [];
  }
  const { data, error } = await supabase
    .from('question_note')
    .upsert(payload, { onConflict: 'question_id' })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listLogs(filters = {}) {
  const session = sessionOrThrow();
  const supabase = requireSupabase();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize) || 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('operation_log')
    .select('id,user_token,operation_type,question_id,operation_time,device_label,detail', { count: 'exact' })
    .eq('user_token', session.token);

  if (filters.operationType) query = query.eq('operation_type', filters.operationType);

  const { data, error, count } = await query
    .order('operation_time', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { rows: data || [], count: count || 0, page, pageSize };
}
