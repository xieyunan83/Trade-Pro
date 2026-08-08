/**
 * 知识库文档 → Markdown 转换（浏览器端：mammoth + SheetJS）
 */
import type { KnowledgeFile } from '../types';

declare global {
  interface Window {
    mammoth?: {
      convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages?: unknown[] }>;
      extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    };
  }
}

declare const XLSX: any;

const BINARY_TYPES = new Set([
  'docx',
  'doc',
  'xlsx',
  'xls',
  'ppt',
  'pptx',
  'pdf',
  'odt',
  'ods',
  'odp',
]);

/** 可转为 Markdown 的源类型（已是 md 的跳过） */
/** 浏览器端可可靠转换的类型（.doc / PDF / PPT 需先另存） */
export const CONVERTIBLE_KB_TYPES = new Set([
  'docx',
  'xlsx',
  'xls',
  'csv',
  'txt',
  'rtf',
  'json',
]);

export const isConvertibleKbFile = (file: KnowledgeFile): boolean => {
  const t = (file.type || '').toLowerCase();
  if (t === 'md' || t === 'markdown' || t === 'youtube') return false;
  return CONVERTIBLE_KB_TYPES.has(t);
};

export type KbConvertOutcome = {
  ok: boolean;
  original: KnowledgeFile;
  markdown?: string;
  newFile?: KnowledgeFile;
  error?: string;
  skipped?: boolean;
};

const suggestedMdName = (name: string) => {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'document';
  return `${base}.md`;
};

const decodeBase64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const cleaned = b64.includes('base64,') ? b64.split('base64,')[1] : b64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const filePayloadToArrayBuffer = (file: KnowledgeFile): ArrayBuffer => {
  const t = (file.type || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  const looksBinary =
    BINARY_TYPES.has(t) ||
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    mime.includes('spreadsheet') ||
    mime.includes('pdf') ||
    mime.includes('octet-stream');

  // 文本类入库是 UTF-8 字符串；二进制是 base64
  if (!looksBinary && (t === 'txt' || t === 'csv' || t === 'json' || t === 'rtf' || t === 'md')) {
    return new TextEncoder().encode(file.data).buffer;
  }

  // 启发式：不像 base64 则当文本
  if (!looksBinary && /[\u4e00-\u9fff\n\r]/.test(file.data.slice(0, 200))) {
    return new TextEncoder().encode(file.data).buffer;
  }

  try {
    return decodeBase64ToArrayBuffer(file.data);
  } catch {
    return new TextEncoder().encode(file.data).buffer;
  }
};

const filePayloadToText = (file: KnowledgeFile): string => {
  const t = (file.type || '').toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'rtf'].includes(t)) {
    // 可能误存成 base64
    if (/^[A-Za-z0-9+/=\s]+$/.test(file.data.slice(0, 80)) && file.data.length > 200 && !file.data.includes('\n')) {
      try {
        return new TextDecoder().decode(decodeBase64ToArrayBuffer(file.data));
      } catch {
        /* fallthrough */
      }
    }
    return file.data;
  }
  try {
    return new TextDecoder().decode(filePayloadToArrayBuffer(file));
  } catch {
    return file.data;
  }
};

const sheetToMarkdown = (sheetName: string, sheet: any): string => {
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) return `## ${sheetName}\n\n_(空表)_\n`;
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const norm = rows.map((r) => {
    const cells = [...r];
    while (cells.length < maxCols) cells.push('');
    return cells.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim());
  });
  const header = norm[0].every((c) => !c) ? norm[0].map((_, i) => `列${i + 1}`) : norm[0];
  const body = norm[0].every((c) => !c) ? norm.slice(1) : norm.slice(1);
  const sep = header.map(() => '---');
  const lines = [
    `## ${sheetName}`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.slice(0, 500).map((r) => `| ${r.join(' | ')} |`),
  ];
  if (body.length > 500) lines.push('', `_…其余 ${body.length - 500} 行已省略_`);
  return lines.join('\n');
};

const convertDocxToMarkdown = async (buffer: ArrayBuffer): Promise<string> => {
  if (!window.mammoth) throw new Error('Mammoth 未加载，请刷新页面后重试');
  try {
    const result = await window.mammoth.convertToMarkdown({ arrayBuffer: buffer });
    const md = (result.value || '').trim();
    if (md) return md;
  } catch (e) {
    console.warn('[kb→md] convertToMarkdown failed, fallback extractRawText', e);
  }
  const raw = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  const text = (raw.value || '').trim();
  if (!text) throw new Error('Word 文档无可用文本');
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
};

const convertSpreadsheetToMarkdown = (buffer: ArrayBuffer, name: string): string => {
  if (typeof XLSX === 'undefined') throw new Error('XLSX 未加载，请刷新页面后重试');
  const wb = XLSX.read(buffer, { type: 'array' });
  const parts = [`# ${name.replace(/\.[^.]+$/, '')}`, ''];
  for (const sheetName of wb.SheetNames) {
    parts.push(sheetToMarkdown(sheetName, wb.Sheets[sheetName]));
    parts.push('');
  }
  return parts.join('\n').trim();
};

const convertCsvTextToMarkdown = (text: string, name: string): string => {
  if (typeof XLSX === 'undefined') {
    return `# ${name.replace(/\.[^.]+$/, '')}\n\n\`\`\`csv\n${text.slice(0, 80_000)}\n\`\`\``;
  }
  const wb = XLSX.read(text, { type: 'string' });
  const parts = [`# ${name.replace(/\.[^.]+$/, '')}`, ''];
  for (const sheetName of wb.SheetNames) {
    parts.push(sheetToMarkdown(sheetName, wb.Sheets[sheetName]));
    parts.push('');
  }
  return parts.join('\n').trim();
};

const convertJsonToMarkdown = (text: string, name: string): string => {
  try {
    const obj = JSON.parse(text);
    return `# ${name.replace(/\.[^.]+$/, '')}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2).slice(0, 100_000)}\n\`\`\``;
  } catch {
    return `# ${name.replace(/\.[^.]+$/, '')}\n\n\`\`\`\n${text.slice(0, 80_000)}\n\`\`\``;
  }
};

const stripRtf = (rtf: string): string =>
  rtf
    .replace(/\{\\.*?\}/g, ' ')
    .replace(/\\[a-z]+\d* ?/gi, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 将单个知识库文件转为 Markdown 文本。
 * PDF / PPT 目前无法在浏览器可靠提取，会返回明确错误。
 */
export async function convertKnowledgeFileToMarkdown(
  file: KnowledgeFile
): Promise<{ markdown: string; suggestedName: string }> {
  const t = (file.type || '').toLowerCase();
  const suggestedName = suggestedMdName(file.name);

  if (t === 'pdf') {
    throw new Error('PDF 请先用本地工具转为 Word/TXT 后再转换（浏览器端暂不支持 PDF 文字提取）');
  }
  if (t === 'ppt' || t === 'pptx') {
    throw new Error('PPT 请导出为 PDF/Word 或复制文本为 .txt/.md 后再转换');
  }
  if (t === 'doc') {
    // mammoth 仅可靠支持 docx
    throw new Error('旧版 .doc 请另存为 .docx 后再转换');
  }

  if (t === 'docx') {
    const buffer = filePayloadToArrayBuffer(file);
    const md = await convertDocxToMarkdown(buffer);
    return { markdown: md, suggestedName };
  }

  if (t === 'xlsx' || t === 'xls') {
    const buffer = filePayloadToArrayBuffer(file);
    const md = convertSpreadsheetToMarkdown(buffer, file.name);
    return { markdown: md, suggestedName };
  }

  if (t === 'csv') {
    const text = filePayloadToText(file);
    return { markdown: convertCsvTextToMarkdown(text, file.name), suggestedName };
  }

  if (t === 'json') {
    return { markdown: convertJsonToMarkdown(filePayloadToText(file), file.name), suggestedName };
  }

  if (t === 'rtf') {
    const text = stripRtf(filePayloadToText(file));
    return {
      markdown: `# ${file.name.replace(/\.[^.]+$/, '')}\n\n${text}`,
      suggestedName,
    };
  }

  if (t === 'txt') {
    const text = filePayloadToText(file).trim();
    return {
      markdown: text.startsWith('#') ? text : `# ${file.name.replace(/\.[^.]+$/, '')}\n\n${text}`,
      suggestedName,
    };
  }

  throw new Error(`暂不支持转换此类型：.${t || '?'}`);
}

export async function convertKnowledgeFileToMdEntry(
  file: KnowledgeFile
): Promise<KbConvertOutcome> {
  if (!isConvertibleKbFile(file)) {
    return { ok: false, skipped: true, original: file, error: '跳过（非可转换文档）' };
  }
  try {
    const { markdown, suggestedName } = await convertKnowledgeFileToMarkdown(file);
    const newFile: KnowledgeFile = {
      id: crypto.randomUUID(),
      name: suggestedName,
      type: 'md',
      mimeType: 'text/markdown',
      data: markdown,
      size: new TextEncoder().encode(markdown).length,
    };
    return { ok: true, original: file, markdown, newFile };
  } catch (e: any) {
    return { ok: false, original: file, error: e?.message || String(e) };
  }
}
