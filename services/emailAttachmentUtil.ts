/** 邮件附件读取与种类判定 */
import type { EmailAttachment } from '../types';

const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 单文件上限（过大走正文提示）

export const classifyAttachmentKind = (
  mime: string,
  name: string
): EmailAttachment['kind'] => {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)$/i.test(n)) return 'video';
  return 'file';
};

export const readFileAsEmailAttachment = (file: File): Promise<EmailAttachment> =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('未选择文件'));
      return;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      reject(
        new Error(
          `「${file.name}」超过 ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)}MB。请压缩后上传，或把网盘链接写进正文。`
        )
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      const contentBase64 =
        dataUrl.startsWith('data:') && comma > 0 ? dataUrl.slice(comma + 1) : dataUrl;
      resolve({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        kind: classifyAttachmentKind(file.type, file.name),
        contentBase64,
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  });
