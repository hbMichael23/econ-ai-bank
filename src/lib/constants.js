export const SUBJECTS = ['微观经济学', '宏观经济学', '政治经济学', '未分类'];
export const QUESTION_TYPES = ['名词解释', '简答', '计算', '论述', '未分类'];
export const DIFFICULTIES = ['基础', '中档', '难题', '未分类'];

export const OPERATION_TYPES = [
  'photo_upload',
  'create_question',
  'update_question',
  'update_note',
  'edit_draft',
  'update_tags',
  'delete_question',
  'query_similar',
  'generate_variant',
  'view_question',
  'ai_classify',
  'migrate_key',
  'update_settings'
];

export const OPERATION_LABELS = {
  photo_upload: '拍照上传题目',
  create_question: '新建题目',
  update_question: '修改题干答案',
  update_note: '修改批注',
  edit_draft: '编辑草稿',
  update_tags: '修改标签',
  delete_question: '删除题目',
  query_similar: '查询相似题',
  generate_variant: 'AI 生成变式题',
  view_question: '查看题目',
  ai_classify: 'AI 自动分类',
  migrate_key: '迁移题库',
  update_settings: '修改设置'
};

export const OPERATION_COLORS = {
  photo_upload: '#8a622f',
  create_question: '#305c4b',
  update_question: '#315b78',
  update_note: '#5b5f8a',
  edit_draft: '#7a4e6c',
  update_tags: '#8a622f',
  delete_question: '#ab5f49',
  query_similar: '#2e6c61',
  generate_variant: '#7a5b1f',
  view_question: '#6b6256',
  ai_classify: '#6d4f8a',
  migrate_key: '#315b78',
  update_settings: '#6b6256'
};

export const IMAGE_MODES = [
  { value: 'text_only', label: '只存识别文字', desc: '原图不上传，数据库更轻，隐私更好' },
  { value: 'cloud', label: '云端保存原图', desc: '原图压缩后随题目保存在云端' }
];
