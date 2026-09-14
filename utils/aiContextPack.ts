import type { ChatMessage, KnowledgeFile } from '../types';

/** Supabase Edge / 代理常见请求体上限远低于 10MB；留余量避免 FUNCTION_PAYLOAD_TOO_LARGE */
export const SAFE_AI_PROXY_BODY_BYTES = 1_400_000;

const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json', 'tsv', 'log']);

export const approxJsonBytes = (value: unknown): number => {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return new TextEncoder().encode(s).length;
  } catch {
    return 0;
  }
};

const looksLikeBase64 = (s: string) =>
  s.length > 32 && !/[\s<>]/.test(s.slice(0, 200)) && /^[A-Za-z0-9+/=\r\n]+$/.test(s.slice(0, 400));

/** 知识库/附件：尽量还原可读文本（IndexedDB 常存 base64） */
export const decodeKnowledgeText = (file: KnowledgeFile, maxChars = 12_000): string => {
  const raw = (file.data || '').trim();
  if (!raw) return '';
  let text = raw;
  if (looksLikeBase64(raw)) {
    try {
      if (typeof atob === 'function') {
        const bin = atob(raw.replace(/\s/g, ''));
        // UTF-8
        try {
          text = decodeURIComponent(escape(bin));
        } catch {
          text = bin;
        }
      }
    } catch {
      text = raw;
    }
  }
  // 去掉 dataURL 前缀
  if (text.startsWith('data:')) {
    const i = text.indexOf(',');
    if (i >= 0) text = text.slice(i + 1);
  }
  text = text.replace(/\u0000/g, '').trim();
  if (text.length > maxChars) return `${text.slice(0, maxChars)}\n…(截断)`;
  return text;
};

export const isTextishKnowledgeFile = (file: KnowledgeFile): boolean => {
  const mime = (file.mimeType || '').toLowerCase();
  const ext = (file.type || file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (['application/json', 'application/csv', 'text/csv'].includes(mime)) return true;
  if (TEXT_EXTS.has(ext)) return true;
  if (file.name.toLowerCase().includes('(converted)')) return true;
  return false;
};

export const isImageKnowledgeFile = (file: KnowledgeFile): boolean => {
  const mime = (file.mimeType || '').toLowerCase();
  const ext = (file.type || '').toLowerCase();
  return mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext);
};

const PRODUCT_HINT_WORDS = [
  '产品',
  '优势',
  '规格',
  '报价',
  'catalog',
  'product',
  'advantage',
  'spec',
  'price',
  'moq',
  'oem',
  'odm',
  '开发信',
  'email',
  '玩具',
  'toy',
];

const scoreFileRelevance = (file: KnowledgeFile, hints: string[], previewText = ''): number => {
  const nameBlob = `${file.name} ${file.type} ${file.mimeType || ''}`.toLowerCase();
  const contentBlob = previewText.slice(0, 1200).toLowerCase();
  let score = 0;
  if (isTextishKnowledgeFile(file)) score += 20;
  if (/\.md$/i.test(file.name) || file.name.includes('(Converted)')) score += 15;
  if (isImageKnowledgeFile(file)) score -= 50;
  for (const h of hints) {
    const t = h.trim().toLowerCase();
    if (t.length < 2) continue;
    if (nameBlob.includes(t)) score += 14;
    if (contentBlob.includes(t)) score += 18;
  }
  for (const w of PRODUCT_HINT_WORDS) {
    if (nameBlob.includes(w) || contentBlob.includes(w)) score += 4;
  }
  // 略偏好较小文本文件
  if (file.size > 0 && file.size < 80_000) score += 3;
  if (file.size > 500_000) score -= 8;
  return score;
};

/**
 * 从系统知识库挑可读摘录（仅文本类；开发信/策略用小预算，避免慢+烧 Token）。
 */
export const buildKnowledgeExcerpts = (
  files: KnowledgeFile[],
  opts?: {
    maxTotalChars?: number;
    maxPerFile?: number;
    maxFiles?: number;
    hints?: string[];
    /** email = 更小预算默认 */
    purpose?: 'email' | 'chat' | 'general';
  }
): string => {
  const purpose = opts?.purpose || 'general';
  const defaults =
    purpose === 'email'
      ? { maxTotalChars: 2_400, maxPerFile: 600, maxFiles: 4 }
      : purpose === 'chat'
        ? { maxTotalChars: 3_500, maxPerFile: 700, maxFiles: 5 }
        : { maxTotalChars: 6_000, maxPerFile: 800, maxFiles: 8 };

  const maxTotal = opts?.maxTotalChars ?? defaults.maxTotalChars;
  const maxPerFile = opts?.maxPerFile ?? defaults.maxPerFile;
  const maxFiles = opts?.maxFiles ?? defaults.maxFiles;
  const hints = opts?.hints || [];

  // 只取文本/已转换 Markdown，绝不把 PDF/图片 base64 解码进 prompt
  const textCandidates = [...(files || [])].filter(
    (f) => f && (f.name || f.data) && isTextishKnowledgeFile(f)
  );

  const ranked = textCandidates
    .map((f) => {
      const preview = decodeKnowledgeText(f, 400);
      return { f, score: scoreFileRelevance(f, hints, preview), preview };
    })
    .filter((x) => x.preview.length >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles);

  const parts: string[] = [];
  let used = 0;
  for (const { f } of ranked) {
    if (used >= maxTotal) break;
    const budget = Math.min(maxPerFile, maxTotal - used);
    const body = decodeKnowledgeText(f, budget);
    if (!body || body.length < 8) continue;
    // 跳过仍像纯二进制/超长无空格的内容
    if (body.length > 200 && !/\s/.test(body.slice(0, 200))) continue;
    const block = `[KB: ${f.name}]\n${body}`;
    parts.push(block);
    used += block.length;
  }

  if (!parts.length && files?.length) {
    const names = files
      .filter((f) => isTextishKnowledgeFile(f))
      .slice(0, 20)
      .map((f) => f.name)
      .filter(Boolean)
      .join('、');
    if (!names) {
      return `（知识库 ${files.length} 个文件多为图片/PDF 原件，未内嵌正文。请上传产品说明 txt/md，或使用「转 Markdown」后再写开发信。）`;
    }
    return `（未匹配到足够相关的文本摘录。文本文件：${names}。请在提问中写明产品名/卖点，或单独附上资料。）`;
  }

  return parts.join('\n\n');
};

/** 仅保留可供 AI 摘录的文本类知识库文件（避免把整库大图载入内存后再丢弃） */
export const filterTextKnowledgeFiles = (files: KnowledgeFile[]): KnowledgeFile[] =>
  (files || []).filter((f) => isTextishKnowledgeFile(f));

/** 浏览器端压缩图片，降低代理 413 */
export const compressImageBase64 = async (
  data: string,
  mimeType = 'image/jpeg',
  opts?: { maxSide?: number; quality?: number }
): Promise<{ data: string; mimeType: string }> => {
  const maxSide = opts?.maxSide ?? 1280;
  const quality = opts?.quality ?? 0.72;
  if (typeof document === 'undefined') {
    return { data, mimeType };
  }

  const raw = data.includes(',') ? data.split(',')[1] : data;
  const srcMime = mimeType || 'image/jpeg';
  const srcUrl = data.startsWith('data:') ? data : `data:${srcMime};base64,${raw}`;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = srcUrl;
    });
    let { width, height } = img;
    if (!width || !height) return { data: raw, mimeType: srcMime };
    const scale = Math.min(1, maxSide / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { data: raw, mimeType: srcMime };
    ctx.drawImage(img, 0, 0, width, height);
    const outMime = 'image/jpeg';
    const dataUrl = canvas.toDataURL(outMime, quality);
    const out = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    // 若压缩后反而更大，保留原图（但截断极端超大）
    if (out.length >= raw.length && raw.length < 900_000) {
      return { data: raw, mimeType: srcMime };
    }
    return { data: out, mimeType: outMime };
  } catch {
    // 仍过大则截断无意义；返回原图由上层决定丢弃
    return { data: raw.length > 1_200_000 ? raw.slice(0, 1_200_000) : raw, mimeType: srcMime };
  }
};

/** 对话附件：压图、截断文本、丢弃音视频/超大 PDF */
export const prepareChatAttachments = async (
  attachments: KnowledgeFile[],
  opts?: { maxImages?: number; maxTextChars?: number }
): Promise<KnowledgeFile[]> => {
  const maxImages = opts?.maxImages ?? 2;
  const maxTextChars = opts?.maxTextChars ?? 6_000;
  const out: KnowledgeFile[] = [];
  let imageCount = 0;

  for (const file of attachments || []) {
    const mime = (file.mimeType || '').toLowerCase();
    if (mime.startsWith('video/') || mime.startsWith('audio/')) {
      out.push({
        ...file,
        data: '',
        mimeType: 'text/plain',
        type: 'txt',
        size: 0,
        name: `${file.name}（已省略音视频内容，仅保留文件名）`,
      });
      continue;
    }
    if (mime === 'application/pdf' || file.type === 'pdf') {
      out.push({
        ...file,
        data: '',
        mimeType: 'text/plain',
        type: 'txt',
        size: 0,
        name: `${file.name}（PDF 未内嵌全文，请用文字说明要点）`,
      });
      continue;
    }
    if (isImageKnowledgeFile(file)) {
      if (imageCount >= maxImages) continue;
      imageCount += 1;
      const compressed = await compressImageBase64(file.data, file.mimeType || 'image/jpeg', {
        maxSide: 1280,
        quality: 0.7,
      });
      out.push({
        ...file,
        data: compressed.data,
        mimeType: compressed.mimeType,
        type: 'jpg',
        size: Math.ceil((compressed.data.length * 3) / 4),
      });
      continue;
    }
    if (isTextishKnowledgeFile(file) || file.type === 'youtube') {
      if (file.type === 'youtube') {
        out.push(file);
        continue;
      }
      const text = decodeKnowledgeText(file, maxTextChars);
      out.push({
        ...file,
        data: text,
        mimeType: 'text/plain',
        type: 'txt',
        size: text.length,
      });
      continue;
    }
    out.push({
      ...file,
      data: '',
      mimeType: 'text/plain',
      type: 'txt',
      name: `${file.name}（类型未内嵌）`,
      size: 0,
    });
  }
  return out;
};

export const slimChatHistoryForAi = (
  history: ChatMessage[],
  opts?: { maxTurns?: number; maxCharsPerMsg?: number }
): Array<{ role: string; content: string }> => {
  const maxTurns = opts?.maxTurns ?? 12;
  const maxChars = opts?.maxCharsPerMsg ?? 5_000;
  return history
    .filter((m) => m.id !== 'init')
    .slice(-maxTurns)
    .map((m) => {
      let text = (m.text || '').trim();
      if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(历史消息已截断)`;
      const role = m.role === 'model' ? 'assistant' : m.role;
      return { role, content: text };
    });
};

/** 若请求体仍过大：按优先级削减 messages / 图片 */
export const shrinkMessagesToBudget = (
  messages: Array<{ role: string; content: unknown }>,
  extra: Record<string, unknown>,
  budgetBytes = SAFE_AI_PROXY_BODY_BYTES
): Array<{ role: string; content: unknown }> => {
  let msgs = messages.map((m) => ({ ...m }));
  const bodySize = () => approxJsonBytes({ model: 'x', messages: msgs, stream: true, ...extra });

  if (bodySize() <= budgetBytes) return msgs;

  // 1) 去掉 user 消息里的图片 part
  msgs = msgs.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const next = (m.content as Array<{ type?: string; text?: string }>).filter(
      (p) => p?.type !== 'image_url'
    );
    if (!next.length) return { ...m, content: '（图片已因体积限制省略，请用文字描述产品）' };
    return { ...m, content: next };
  });
  if (bodySize() <= budgetBytes) return msgs;

  // 2) 截断 system
  msgs = msgs.map((m) => {
    if (m.role !== 'system' || typeof m.content !== 'string') return m;
    const s = m.content;
    if (s.length <= 8_000) return m;
    return { ...m, content: `${s.slice(0, 8_000)}\n…(系统上下文已压缩)` };
  });
  if (bodySize() <= budgetBytes) return msgs;

  // 3) 只保留最近几轮
  const system = msgs.filter((m) => m.role === 'system');
  const rest = msgs.filter((m) => m.role !== 'system');
  msgs = [...system, ...rest.slice(-6)];
  if (bodySize() <= budgetBytes) return msgs;

  // 4) 极端：只留 system + 最后一条 user（再截断）
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const sys = system[0];
  const userContent =
    typeof lastUser?.content === 'string'
      ? lastUser.content.slice(0, 4_000)
      : '请基于已选市场/客户给出开发策略（附件因体积已省略）。';
  return [
    sys
      ? { role: 'system', content: String(sys.content).slice(0, 6_000) }
      : { role: 'system', content: '你是外贸策略顾问。' },
    { role: 'user', content: userContent },
  ];
};

export const isPayloadTooLargeError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /413|Request Entity Too Large|FUNCTION_PAYLOAD_TOO_LARGE|payload.?too.?large|entity too large/i.test(
    msg
  );
};
