/**
 * 阿里云邮件推送 SingleSendMail（经 /api/directmail 同源代理签名发送）
 */
import type { AliyunConfig } from '../types';

export type DirectMailSendInput = {
  config: AliyunConfig;
  toAddress: string;
  subject: string;
  htmlBody: string;
  fromAlias?: string;
};

export type DirectMailSendResult = {
  ok: boolean;
  requestId?: string;
  error?: string;
};

const resolveProxyUrl = (): string => {
  if (typeof window === 'undefined') return '/api/directmail';
  const origin = window.location.origin;
  // 本地 Vite 也可走同路径（需 vercel dev 或另行代理）；无代理时 API 会失败并给出提示
  return `${origin}/api/directmail`;
};

export const sendDirectMail = async (input: DirectMailSendInput): Promise<DirectMailSendResult> => {
  const { config, toAddress, subject, htmlBody, fromAlias } = input;
  if (!config?.accessKeyId || !config?.accessKeySecret || !config?.accountName) {
    return { ok: false, error: '请先在「接口配置」填写 AccessKey、发信地址' };
  }
  if (!toAddress?.includes('@')) {
    return { ok: false, error: '收件人邮箱无效' };
  }

  try {
    const res = await fetch(resolveProxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        accountName: config.accountName,
        fromAlias: fromAlias || config.fromAlias || '',
        replyToAddress: !!config.replyToAddress,
        addressType: config.addressType === 0 ? 0 : 1,
        tagName: config.tagName || '',
        regionId: config.regionId || 'cn-hangzhou',
        toAddress,
        subject,
        htmlBody,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        error: data?.error || data?.Message || `发送失败 HTTP ${res.status}`,
        requestId: data?.RequestId,
      };
    }
    return { ok: true, requestId: data?.RequestId || data?.requestId };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ||
        '无法连接 DirectMail 代理。本地请用 vercel dev / 已部署环境；或检查 /api/directmail。',
    };
  }
};

export const isDirectMailConfigured = (config: AliyunConfig | null | undefined): boolean =>
  !!(config?.accessKeyId?.trim() && config?.accessKeySecret?.trim() && config?.accountName?.trim());
