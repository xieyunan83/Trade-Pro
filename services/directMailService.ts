/**
 * 邮件推送：经 /api/directmail 同源代理签名调用
 * 发送用 SingleSendMail；另含额度、无效地址、统计、投递详情。
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

export type DirectMailAccountSummary = {
  dailyQuota: number;
  monthQuota: number;
  remainFreeQuota: number;
  dailyRemainFreeQuota: number;
  quotaLevel: number;
  maxQuotaLevel: number;
  userStatus: number;
  domains: number;
  mailAddresses: number;
  tags: number;
  templates: number;
};

export type DirectMailInvalidAddress = {
  toAddress: string;
  lastUpdateTime?: string;
  utcLastUpdateTime?: number;
};

export type DirectMailStatRow = {
  createTime: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
  unavailableCount: number;
  succeededPercent: string;
  unavailablePercent: string;
};

export type DirectMailDeliveryDetail = {
  toAddress: string;
  accountName?: string;
  subject?: string;
  status: number;
  statusLabel: string;
  message?: string;
  lastUpdateTime?: string;
  errorClassification?: string;
};

export type DirectMailApiFail = { ok: false; error?: string; RequestId?: string };
type ProxyPayload = Record<string, unknown> & { ok: true; RequestId?: string };

const resolveProxyUrl = (): string => {
  if (typeof window === 'undefined') return '/api/directmail';
  return `${window.location.origin}/api/directmail`;
};

const authPayload = (config: AliyunConfig) => ({
  accessKeyId: config.accessKeyId,
  accessKeySecret: config.accessKeySecret,
  accountName: config.accountName || '',
  regionId: config.regionId || 'cn-hangzhou',
  tagName: config.tagName || '',
});

const callDirectMailProxy = async (
  config: AliyunConfig,
  action: string,
  extra: Record<string, unknown> = {}
): Promise<ProxyPayload | DirectMailApiFail> => {
  if (!config?.accessKeyId || !config?.accessKeySecret) {
    return { ok: false, error: '请先在「接口配置」填写 AccessKey' };
  }
  try {
    const res = await fetch(resolveProxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...authPayload(config),
        action,
        ...extra,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        error: String(data?.error || data?.Message || `请求失败 HTTP ${res.status}`),
        RequestId: data?.RequestId ? String(data.RequestId) : undefined,
      };
    }
    return { ...data, ok: true, RequestId: data?.RequestId ? String(data.RequestId) : undefined };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ||
        '无法连接发信服务代理。本地请用 vercel dev / 已部署环境；或检查 /api/directmail。',
    };
  }
};

const isProxyFail = (v: ProxyPayload | DirectMailApiFail): v is DirectMailApiFail =>
  v.ok === false;

export const sendDirectMail = async (input: DirectMailSendInput): Promise<DirectMailSendResult> => {
  const { config, toAddress, subject, htmlBody, fromAlias } = input;
  if (!config?.accessKeyId || !config?.accessKeySecret || !config?.accountName) {
    return { ok: false, error: '请先在「接口配置」填写 AccessKey、发信地址' };
  }
  if (!toAddress?.includes('@')) {
    return { ok: false, error: '收件人邮箱无效' };
  }

  const data = await callDirectMailProxy(config, 'SingleSendMail', {
    toAddress,
    subject,
    htmlBody,
    fromAlias: fromAlias || config.fromAlias || '',
    replyToAddress: !!config.replyToAddress,
    addressType: config.addressType === 0 ? 0 : 1,
    tagName: config.tagName || '',
  });
  if (isProxyFail(data)) {
    return { ok: false, error: data.error, requestId: data.RequestId };
  }
  return {
    ok: true,
    requestId: data.RequestId || (typeof data.requestId === 'string' ? data.requestId : undefined),
  };
};

export const isDirectMailConfigured = (config: AliyunConfig | null | undefined): boolean =>
  !!(config?.accessKeyId?.trim() && config?.accessKeySecret?.trim() && config?.accountName?.trim());

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const userStatusLabel = (status: number): string => {
  switch (status) {
    case 0:
      return '正常';
    case 1:
      return '冻结';
    case 2:
      return '欠费';
    case 4:
      return '受限';
    case 8:
      return '已停用';
    default:
      return `状态 ${status}`;
  }
};

export const deliveryStatusLabel = (status: number): string => {
  switch (status) {
    case 0:
      return '成功';
    case 2:
      return '无效地址';
    case 3:
      return '垃圾举报';
    case 4:
      return '失败';
    default:
      return `状态 ${status}`;
  }
};

export const fetchAccountSummary = async (
  config: AliyunConfig
): Promise<{ ok: true; summary: DirectMailAccountSummary } | DirectMailApiFail> => {
  const data = await callDirectMailProxy(config, 'DescAccountSummary');
  if (isProxyFail(data)) return data;
  return {
    ok: true,
    summary: {
      dailyQuota: num(data.DailyQuota),
      monthQuota: num(data.MonthQuota),
      remainFreeQuota: num(data.RemainFreeQuota),
      dailyRemainFreeQuota: num(data.DailyRemainFreeQuota),
      quotaLevel: num(data.QuotaLevel),
      maxQuotaLevel: num(data.MaxQuotaLevel, 10),
      userStatus: num(data.UserStatus),
      domains: num(data.Domains),
      mailAddresses: num(data.MailAddresses),
      tags: num(data.Tags),
      templates: num(data.Templates),
    },
  };
};

const asArray = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return [v as T];
  return [];
};

export const queryInvalidAddresses = async (
  config: AliyunConfig,
  opts: {
    keyWord?: string;
    startTime?: string;
    endTime?: string;
    length?: number;
    nextStart?: string;
  } = {}
): Promise<
  | {
      ok: true;
      items: DirectMailInvalidAddress[];
      totalCount: number;
      nextStart?: string;
    }
  | DirectMailApiFail
> => {
  const data = await callDirectMailProxy(config, 'QueryInvalidAddress', {
    keyWord: opts.keyWord || '',
    startTime: opts.startTime || '',
    endTime: opts.endTime || '',
    length: opts.length ?? 50,
    nextStart: opts.nextStart || '',
  });
  if (isProxyFail(data)) return data;
  const nested = data.data as { mailDetail?: unknown } | undefined;
  const mailDetail = nested?.mailDetail;
  const items = asArray<any>(mailDetail)
    .map((row) => ({
      toAddress: String(row.ToAddress || row.toAddress || ''),
      lastUpdateTime: row.LastUpdateTime || row.lastUpdateTime,
      utcLastUpdateTime: num(row.UtcLastUpdateTime || row.utcLastUpdateTime, 0) || undefined,
    }))
    .filter((x) => x.toAddress.includes('@'));
  return {
    ok: true,
    items,
    totalCount: num(data.TotalCount, items.length),
    nextStart: data.NextStart ? String(data.NextStart) : undefined,
  };
};

/** 拉取多页无效地址，用于群发前过滤（最多 maxPages 页） */
export const loadInvalidAddressSet = async (
  config: AliyunConfig,
  maxPages = 5,
  pageSize = 100
): Promise<{ ok: true; emails: Set<string>; totalHint: number } | DirectMailApiFail> => {
  const emails = new Set<string>();
  let nextStart: string | undefined;
  let totalHint = 0;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await queryInvalidAddresses(config, {
      length: pageSize,
      nextStart,
    });
    if (page.ok === false) {
      if (i === 0) return { ok: false, error: page.error, RequestId: page.RequestId };
      break;
    }
    totalHint = Math.max(totalHint, page.totalCount);
    for (const item of page.items) {
      emails.add(item.toAddress.toLowerCase());
    }
    if (!page.nextStart || page.items.length === 0) break;
    nextStart = page.nextStart;
  }
  return { ok: true, emails, totalHint };
};

export const deleteInvalidAddress = async (
  config: AliyunConfig,
  toAddress: string
): Promise<DirectMailSendResult> => {
  const data = await callDirectMailProxy(config, 'DeleteInvalidAddress', { toAddress });
  if (isProxyFail(data)) return { ok: false, error: data.error, requestId: data.RequestId };
  return { ok: true, requestId: data.RequestId };
};

const formatYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatYmdHm = (d: Date): string => `${formatYmd(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const fetchSenderStatistics = async (
  config: AliyunConfig,
  opts: { startTime?: string; endTime?: string; days?: number } = {}
): Promise<{ ok: true; rows: DirectMailStatRow[] } | DirectMailApiFail> => {
  const end = opts.endTime || formatYmd(new Date());
  const start =
    opts.startTime ||
    formatYmd(new Date(Date.now() - (Math.max(1, opts.days || 7) - 1) * 24 * 60 * 60 * 1000));
  const data = await callDirectMailProxy(config, 'SenderStatisticsByTagNameAndBatchID', {
    startTime: start,
    endTime: end,
    accountNameFilter: config.accountName || '',
  });
  if (isProxyFail(data)) return data;
  const nested = data.data as { stat?: unknown } | undefined;
  const rows = asArray<any>(nested?.stat)
    .map((row) => ({
      createTime: String(row.CreateTime || row.createTime || ''),
      requestCount: num(row.requestCount),
      successCount: num(row.successCount),
      failedCount: num(row.faildCount ?? row.failedCount),
      unavailableCount: num(row.unavailableCount),
      succeededPercent: String(row.succeededPercent || '—'),
      unavailablePercent: String(row.unavailablePercent || '—'),
    }))
    .sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
  return { ok: true, rows };
};

export const fetchDeliveryDetails = async (
  config: AliyunConfig,
  opts: {
    startTime?: string;
    endTime?: string;
    status?: number | '';
    toAddress?: string;
    length?: number;
    nextStart?: string;
    days?: number;
  } = {}
): Promise<
  | {
      ok: true;
      items: DirectMailDeliveryDetail[];
      nextStart?: string;
    }
  | DirectMailApiFail
> => {
  const endDate = new Date();
  const startDate = new Date(Date.now() - (Math.max(1, opts.days || 7) - 1) * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);
  const startTime = opts.startTime || formatYmdHm(startDate);
  const endTime = opts.endTime || formatYmdHm(endDate);

  const extra: Record<string, unknown> = {
    startTime,
    endTime,
    length: opts.length ?? 50,
    nextStart: opts.nextStart || '',
  };
  // AccountName / TagName / ToAddress 只能其一；默认不传，查全部
  if (opts.toAddress?.includes('@')) {
    extra.toAddress = opts.toAddress.trim();
  }

  if (opts.status !== undefined && opts.status !== '') {
    extra.status = opts.status;
  }

  const data = await callDirectMailProxy(config, 'SenderStatisticsDetailByParam', extra);
  if (isProxyFail(data)) return data;
  const nested = data.data as { mailDetail?: unknown } | undefined;
  const items = asArray<any>(nested?.mailDetail).map((row) => {
    const status = num(row.Status ?? row.status, -1);
    return {
      toAddress: String(row.ToAddress || ''),
      accountName: row.AccountName ? String(row.AccountName) : undefined,
      subject: row.Subject ? String(row.Subject) : undefined,
      status,
      statusLabel: deliveryStatusLabel(status),
      message: row.Message ? String(row.Message) : undefined,
      lastUpdateTime: row.LastUpdateTime ? String(row.LastUpdateTime) : undefined,
      errorClassification: row.ErrorClassification
        ? String(row.ErrorClassification)
        : undefined,
    };
  });
  return {
    ok: true,
    items,
    nextStart: data.NextStart ? String(data.NextStart) : undefined,
  };
};

/** 发送失败文案是否像无效地址（系统侧通常会自动入库） */
export const looksLikeInvalidAddressError = (error?: string): boolean => {
  const s = (error || '').toLowerCase();
  return (
    /invalid|无效地址|bounce|nxdomain|mailbox.*not|user.*unknown|smtpnxbox|accountlevelbounce/i.test(
      s
    )
  );
};
