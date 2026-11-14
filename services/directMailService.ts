/**
 * 邮件推送：经 /api/directmail 同源代理签名调用
 * 发送用 SingleSendMail；另含额度、无效地址、统计、投递详情。
 */
import type { AliyunConfig } from '../types';

export type DirectMailAttachmentPayload = {
  fileName: string;
  /** Base64（可含 data: 前缀） */
  content: string;
};

export type DirectMailSendInput = {
  config: AliyunConfig;
  toAddress: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromAlias?: string;
  attachments?: DirectMailAttachmentPayload[];
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
      const detail = String(
        data?.error || data?.Message || (res.status ? `发信代理异常 HTTP ${res.status}` : '发信代理异常')
      );
      // 本地代理未升级时常见：查询接口被当成发信 → 提示更明确
      const hint =
        /缺少 toAddress|Only POST|DirectMail/i.test(detail) && action !== 'SingleSendMail'
          ? '（若在本地开发，请重启 dev 服务以加载多 Action 发信代理）'
          : '';
      return {
        ok: false,
        error: `${detail}${hint}`,
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
  const { config, toAddress, subject, htmlBody, textBody, fromAlias, attachments } = input;
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
    textBody: textBody || '',
    fromAlias: fromAlias || config.fromAlias || '',
    replyToAddress: !!config.replyToAddress,
    addressType: config.addressType === 0 ? 0 : 1,
    tagName: config.tagName || '',
    clickTrace: !!config.clickTrace,
    replyAddress: config.replyAddress || '',
    replyAddressAlias: config.replyAddressAlias || '',
    attachments: (attachments || [])
      .filter((a) => a?.fileName && a?.content)
      .slice(0, 5)
      .map((a) => ({ fileName: a.fileName, content: a.content })),
  });
  if (isProxyFail(data)) {
    return { ok: false, error: data.error, requestId: data.RequestId };
  }
  return {
    ok: true,
    requestId: data.RequestId || (typeof data.requestId === 'string' ? data.requestId : undefined),
  };
};

/** 把模板附件拆成：真附件（≤约 3.2MB）+ 正文内嵌块（大文件/视频） */
export const splitAttachmentsForSend = (
  attachments: Array<{
    name: string;
    mime?: string;
    kind?: string;
    contentBase64?: string;
    dataUrl?: string;
    size?: number;
  }> = []
): { apiAttachments: DirectMailAttachmentPayload[]; htmlExtra: string } => {
  const apiAttachments: DirectMailAttachmentPayload[] = [];
  const htmlParts: string[] = [];
  const maxBytes = 3_200_000;
  for (const a of attachments) {
    const raw = a.contentBase64 || a.dataUrl || '';
    if (!raw) continue;
    let b64 = raw;
    const comma = b64.indexOf(',');
    if (b64.startsWith('data:') && comma > 0) b64 = b64.slice(comma + 1);
    const approxBytes = Math.floor((b64.length * 3) / 4);
    const isVideo = a.kind === 'video' || /^video\//i.test(a.mime || '');
    const tooBig = approxBytes > maxBytes || (a.size || 0) > maxBytes;
    if (!isVideo && !tooBig && apiAttachments.length < 5) {
      apiAttachments.push({ fileName: a.name, content: b64 });
      continue;
    }
    // 过大或视频：正文提供本地 data URL 预览/下载提示（收件端若剥链则仍建议改用网盘）
    const href = a.dataUrl || (a.contentBase64?.startsWith('data:') ? a.contentBase64 : '');
    if (isVideo && href) {
      htmlParts.push(
        `<div style="margin:12px 0;padding:12px;border:1px solid #e2e8f0;border-radius:8px"><div style="font-weight:700;margin-bottom:6px">视频：${escapeHtml(
          a.name
        )}</div><video controls src="${href}" style="max-width:100%;border-radius:6px"></video></div>`
      );
    } else if (a.kind === 'image' && href) {
      htmlParts.push(
        `<div style="margin:12px 0"><img src="${href}" alt="${escapeHtml(
          a.name
        )}" style="max-width:100%;border-radius:6px"/></div>`
      );
    } else if (href) {
      htmlParts.push(
        `<div style="margin:12px 0"><a href="${href}" download="${escapeHtml(
          a.name
        )}">下载附件：${escapeHtml(a.name)}</a></div>`
      );
    } else {
      htmlParts.push(
        `<div style="margin:12px 0;color:#64748b">附件「${escapeHtml(
          a.name
        )}」体积较大，未能随信投递，请改用网盘链接放入正文。</div>`
      );
    }
  }
  return {
    apiAttachments,
    htmlExtra: htmlParts.length
      ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/><div>${htmlParts.join(
          ''
        )}</div>`
      : '',
  };
};

const escapeHtml = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
