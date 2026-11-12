import { DIFFICULTIES, QUESTION_TYPES, SUBJECTS } from './constants.js';

const SUBJECT_RULES = [
  {
    subject: '微观经济学',
    words: ['效用', '消费者', '生产者', '需求', '供给', '弹性', '边际', '成本', '完全竞争', '垄断', '寡头', '博弈', '纳什', '生产函数', '替代效应', '收入效应', '市场均衡', '外部性', '公共品', '信息不对称', '价格歧视']
  },
  {
    subject: '宏观经济学',
    words: ['GDP', 'GNP', 'IS-LM', 'IS—LM', 'AD-AS', '总需求', '总供给', '通货膨胀', '失业', '财政政策', '货币政策', '索洛', '经济增长', '经济周期', '乘数', '凯恩斯', '货币供给', '菲利普斯', '开放经济', '汇率']
  },
  {
    subject: '政治经济学',
    words: ['剩余价值', '资本', '劳动价值', '价值规律', '剥削', '再生产', '平均利润', '利润率', '生产价格', '资本积累', '经济危机', '所有制', '商品', '货币转化为资本', '必要劳动', '剩余劳动']
  }
];

const TAG_RULES = [
  { tag: '效用函数', words: ['效用函数', '效用最大化', '边际效用', '消费者均衡'] },
  { tag: '消费者理论', words: ['消费者', '预算约束', '无差异曲线', '替代效应', '收入效应', '吉芬'] },
  { tag: '需求弹性', words: ['弹性', '需求价格弹性', '收入弹性', '交叉弹性'] },
  { tag: '生产函数', words: ['生产函数', '边际产量', '规模报酬', '等产量线', '柯布-道格拉斯', 'Cobb-Douglas'] },
  { tag: '成本函数', words: ['成本函数', '边际成本', '平均成本', '机会成本', '沉没成本'] },
  { tag: '市场结构', words: ['完全竞争', '垄断竞争', '寡头', '垄断', '市场结构', '价格歧视'] },
  { tag: '博弈论', words: ['博弈', '纳什均衡', '囚徒困境', '策略', '占优策略'] },
  { tag: '一般均衡', words: ['一般均衡', '帕累托', '社会福利', '埃奇沃思'] },
  { tag: '市场失灵', words: ['外部性', '公共品', '信息不对称', '逆向选择', '道德风险', '科斯定理'] },
  { tag: 'IS-LM', words: ['IS-LM', 'IS—LM', '产品市场', '货币市场', 'LM曲线', 'IS曲线'] },
  { tag: 'AD-AS', words: ['AD-AS', '总需求', '总供给', '总需求总供给', '短期均衡'] },
  { tag: '索洛模型', words: ['索洛', 'Solow', '稳态', '资本深化', '黄金律'] },
  { tag: '经济增长', words: ['经济增长', '增长核算', '内生增长', '收敛', '人均产出'] },
  { tag: '通货膨胀', words: ['通货膨胀', '通胀', 'CPI', '物价', '菲利普斯'] },
  { tag: '失业', words: ['失业', '自然失业率', '奥肯定律', '劳动力市场'] },
  { tag: '财政政策', words: ['财政政策', '政府支出', '税收', '赤字', '挤出效应', '乘数'] },
  { tag: '货币政策', words: ['货币政策', '货币供给', '利率', '中央银行', '公开市场', '存款准备金'] },
  { tag: '开放经济', words: ['汇率', '国际收支', '贸易', '蒙代尔', '开放经济'] },
  { tag: '剩余价值', words: ['剩余价值', '剩余劳动', '剥削', '必要劳动'] },
  { tag: '资本积累', words: ['资本积累', '资本有机构成', '原始积累', '扩大再生产'] },
  { tag: '平均利润', words: ['平均利润', '生产价格', '利润率', '利润平均化'] },
  { tag: '劳动价值论', words: ['劳动价值', '价值规律', '商品价值', '社会必要劳动时间'] },
  { tag: '经济危机', words: ['经济危机', '危机', '再生产周期'] }
];

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function textOf(question = {}) {
  return normalize([
    question.stem,
    ...(Array.isArray(question.options) ? question.options.map((item) => `${item.key || ''} ${item.text || ''}`) : []),
    question.answer,
    question.analysis,
    question.subject,
    question.question_type,
    ...(question.auto_tags || []),
    ...(question.manual_tags || [])
  ].filter(Boolean).join('\n'));
}

export function buildEmbeddingText(question = {}) {
  const tags = [...new Set([...(question.auto_tags || []), ...(question.manual_tags || [])])];
  return [
    `学科：${question.subject || '未分类'}`,
    `题型：${question.question_type || '未分类'}`,
    `难度：${question.difficulty || '未分类'}`,
    tags.length ? `考点：${tags.join('、')}` : '',
    `题目：${question.stem || ''}`,
    ...(Array.isArray(question.options) ? question.options.map((item) => `${item.key || ''}. ${item.text || ''}`) : []),
    question.answer ? `答案：${question.answer}` : '',
    question.analysis ? `解析：${question.analysis}` : ''
  ].filter(Boolean).join('\n');
}

export function classifyLocally(question = {}) {
  const text = textOf(question);
  let subject = '未分类';
  let best = 0;
  for (const rule of SUBJECT_RULES) {
    const score = rule.words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    if (score > best) {
      best = score;
      subject = rule.subject;
    }
  }

  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.words.some((word) => text.includes(word))) tags.push(rule.tag);
  }
  if (subject !== '未分类' && tags.length === 0) tags.push(subject);

  let questionType = '未分类';
  if (/名词解释|解释概念|什么是|定义/.test(text) && text.length < 180) questionType = '名词解释';
  else if (/计算|求解|求均衡|求产出|求利率|求弹性|已知|假定/.test(text)) questionType = '计算';
  else if (/论述|试述|评述|比较分析|结合实际|谈谈/.test(text)) questionType = '论述';
  else if (Array.isArray(question.options) && question.options.length >= 2) questionType = '简答';
  else if (text.length > 60) questionType = '简答';

  let difficulty = '未分类';
  if (/论述|证明|推导|综合/.test(text) || text.length > 520) difficulty = '难题';
  else if (/计算|分析|比较/.test(text) || text.length > 220) difficulty = '中档';
  else if (text.length > 0) difficulty = '基础';

  return {
    subject: SUBJECTS.includes(subject) ? subject : '未分类',
    question_type: QUESTION_TYPES.includes(questionType) ? questionType : '未分类',
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : '未分类',
    knowledge_tags: [...new Set(tags)].slice(0, 12)
  };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenizeForEmbedding(text) {
  const normalized = normalize(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = [];
  const words = normalized.match(/[a-z0-9]{2,}/g) || [];
  tokens.push(...words);
  const han = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < han.length; i += 1) {
    tokens.push(han[i]);
    if (i + 1 < han.length) tokens.push(han.slice(i, i + 2));
    if (i + 2 < han.length) tokens.push(han.slice(i, i + 3));
  }
  return tokens;
}

/**
 * 无 AI key 时的降级向量：1024 维 hashed lexical embedding。
 * 它不是真正的语义模型，但可以保证相似题/向量检索流程在纯前端也能运行。
 */
export function localEmbedding(text, dimensions = 1024) {
  const vector = new Float64Array(dimensions);
  const tokens = tokenizeForEmbedding(text);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const bucket = hash % dimensions;
    const sign = (hash & 0x80000000) ? -1 : 1;
    vector[bucket] += sign;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => Number((value / norm).toFixed(6)));
}
