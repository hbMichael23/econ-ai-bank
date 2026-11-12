import { recognize } from 'tesseract.js';

const MAX_IMAGE_BYTES = 1_800_000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张图片。'));
    };
    image.src = url;
  });
}

/**
 * 压缩为 JPEG data URL：手机拍照很大，直接入库/OCR 都会很慢。
 */
export async function compressImage(file, options = {}) {
  if (!file) throw new Error('没有选择图片。');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('只支持 JPG / PNG / WebP 图片。');
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('图片超过 25 MB，请压缩后再上传。');
  }

  const maxSide = options.maxSide || 1800;
  const image = await loadImage(file);
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.84;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > MAX_IMAGE_BYTES) {
    throw new Error('压缩后图片仍然过大，请裁剪题目区域后重试。');
  }

  return {
    dataUrl,
    mime: 'image/jpeg',
    width,
    height,
    bytes: Math.round((dataUrl.length * 3) / 4)
  };
}

function statusLabel(status = '') {
  if (status.includes('loading tesseract core')) return '加载 OCR 引擎';
  if (status.includes('initializing tesseract')) return '初始化 OCR';
  if (status.includes('loading language')) return '加载中英文识别模型';
  if (status.includes('initializing api')) return '准备识别';
  if (status.includes('recognizing text')) return '正在识别文字';
  return '处理中';
}

export async function recognizeText(dataUrl, onProgress) {
  const result = await recognize(dataUrl, 'chi_sim+eng', {
    logger: (message) => {
      if (!onProgress) return;
      const progress = Number(message?.progress || 0);
      onProgress({
        stage: message?.status || 'working',
        label: statusLabel(message?.status || ''),
        progress: Number.isFinite(progress) ? progress : 0
      });
    }
  });
  return String(result?.data?.text || '').trim();
}

/**
 * 把 OCR 文本拆成题干 + A/B/C/D 选项。
 * 识别结果只是草稿，必须允许人工修改后再保存。
 */
export function parseOcrText(rawText) {
  const text = String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return { stem: '', options: [], rawText: text };

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const optionPattern = /^([A-H])\s*[.、．:：）)]\s*(.+)$/;
  const firstOption = lines.findIndex((line) => optionPattern.test(line));

  if (firstOption < 0) {
    return { stem: text, options: [], rawText: text };
  }

  const options = [];
  for (const line of lines.slice(firstOption)) {
    const match = line.match(optionPattern);
    if (match) {
      options.push({ key: match[1], text: match[2].trim() });
    } else if (options.length) {
      options[options.length - 1].text += ` ${line}`;
    }
  }

  return {
    stem: lines.slice(0, firstOption).join('\n').trim(),
    options: options.filter((option) => option.text),
    rawText: text
  };
}

export async function ocrImage(file, onProgress) {
  const compressed = await compressImage(file);
  const text = await recognizeText(compressed.dataUrl, onProgress);
  const parsed = parseOcrText(text);
  return { ...compressed, ...parsed, ocrText: text };
}
