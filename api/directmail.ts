/**
 * Vercel Serverless：阿里云 DirectMail 多 Action 签名代理
 * 支持 SingleSendMail + 额度/无效地址/统计/详情查询（避免浏览器 CORS）。
 */
import crypto from 'crypto';

import { enforceApiRateLimit } from './_firewall';
import { applyStrictCors, handleCorsPreflight } from './_cors';
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const ALLOWED_ACTIONS = new Set([
  'SingleSendMail',
  'DescAccountSummary',
  'QueryInvalidAddress',
  'DeleteInvalidAddress',
  'SenderStatisticsByTagNameAndBatchID',
  'SenderStatisticsDetailByParam',
]);

const percentEncode = (s: string): string =>
  encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

const signAliyun = (params: Record<string, string>, accessKeySecret: string): string => {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(sorted)}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
};

const endpointForRegion = (regionId: string): string => {
  const r = (regionId || 'cn-hangzhou').toLowerCase();
  if (r.includes('singapore') || r === 'ap-southeast-1') return 'https://dm.ap-southeast-1.aliyuncs.com/';
  return 'https://dm.aliyuncs.com/';
};

const apiVersionForRegion = (regionId: string): string => {
  const r = (regionId || 'cn-hangzhou').toLowerCase();
  if (r.includes('singapore') || r === 'ap-southeast-1') return '2017-06-22';
  return '2015-11-23';
};

const pickStr = (v: unknown): string => (v == null ? '' : String(v).trim());

const putIf = (params: Record<string, string>, key: string, value: unknown) => {
  const s = pickStr(value);
  if (s) params[key] = s;
};

export default async function handler(req: any, res: any) {
  try {
    if (handleCorsPreflight(req, res)) return;
    applyStrictCors(req, res);
    if (!enforceApiRateLimit(req, res, 'directmail')) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Only POST' });
      return;
    }

    let body: any = {};
    try {
      body =
        typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : req.body && typeof req.body === 'object'
            ? req.body
            : {};
    } catch {
      res.status(400).json({ ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const accessKeyId = pickStr(
      body.accessKeyId ||
        process.env.ALIYUN_DM_ACCESS_KEY_ID ||
        process.env.REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_ID
    );
    const accessKeySecret = pickStr(
      body.accessKeySecret ||
        process.env.ALIYUN_DM_ACCESS_KEY_SECRET ||
        process.env.REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_SECRET
    );
    const accountName = pickStr(
      body.accountName ||
        process.env.ALIYUN_DM_ACCOUNT_NAME ||
        process.env.REACT_APP_ALIYUN_EMAIL_FROM
    );
    const regionId = pickStr(body.regionId) || 'cn-hangzhou';
    const action = pickStr(body.action || body.Action) || 'SingleSendMail';

    if (!accessKeyId || !accessKeySecret) {
      res.status(400).json({
        ok: false,
        error: '缺少 AccessKey。请在邮件模块配置，或设置服务端 ALIYUN_DM_* 环境变量。',
      });
      return;
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      res.status(400).json({
        ok: false,
        error: `不支持的 Action: ${action}`,
      });
      return;
    }

    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: action,
      Format: 'JSON',
      Version: apiVersionForRegion(regionId),
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: regionId,
    };

    if (action === 'SingleSendMail') {
      const toAddress = pickStr(body.toAddress);
      const subject = pickStr(body.subject);
      const htmlBody = pickStr(body.htmlBody);
      const textBody = pickStr(body.textBody);
      if (!accountName) {
        res.status(400).json({
          ok: false,
          error: '缺少发信地址。请在邮件模块配置，或设置服务端 ALIYUN_DM_ACCOUNT_NAME。',
        });
        return;
      }
      if (!toAddress || !subject || (!htmlBody && !textBody)) {
        res.status(400).json({ ok: false, error: '缺少 toAddress / subject / htmlBody' });
        return;
      }
      params.AccountName = accountName;
      params.AddressType = String(body.addressType === 0 ? 0 : 1);
      params.ReplyToAddress = body.replyToAddress ? 'true' : 'false';
      params.ToAddress = toAddress;
      params.Subject = subject;
      if (htmlBody) params.HtmlBody = htmlBody;
      if (textBody) params.TextBody = textBody;
      putIf(params, 'FromAlias', body.fromAlias);
      putIf(params, 'TagName', body.tagName);
      putIf(params, 'ReplyAddress', body.replyAddress);
      putIf(params, 'ReplyAddressAlias', body.replyAddressAlias);
      // 点击追踪：需配合 TagName
      if (body.clickTrace === true || body.clickTrace === 1 || body.clickTrace === '1') {
        params.ClickTrace = '1';
      } else if (body.clickTrace === false || body.clickTrace === 0 || body.clickTrace === '0') {
        params.ClickTrace = '0';
      }
      putIf(params, 'UnSubscribeLinkType', body.unSubscribeLinkType);
      putIf(params, 'UnSubscribeFilterLevel', body.unSubscribeFilterLevel);
      // 真附件：Attachments.N.FileName + Attachments.N.Content（Base64）
      const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
      let ai = 0;
      for (const item of rawAtt.slice(0, 5)) {
        if (!item || typeof item !== 'object') continue;
        const fileName = pickStr((item as any).fileName || (item as any).name);
        let content = pickStr((item as any).content || (item as any).contentBase64);
        if (!fileName || !content) continue;
        // 去掉 data URL 前缀
        const comma = content.indexOf(',');
        if (content.startsWith('data:') && comma > 0) content = content.slice(comma + 1);
        // 单附件过大易签名失败 / 超时；约 3.5MB Base64
        if (content.length > 4_700_000) continue;
        ai += 1;
        params[`Attachments.${ai}.FileName`] = fileName;
        params[`Attachments.${ai}.Content`] = content;
      }
    } else if (action === 'DescAccountSummary') {
      // 无业务参数
    } else if (action === 'QueryInvalidAddress') {
      putIf(params, 'StartTime', body.startTime || body.StartTime);
      putIf(params, 'EndTime', body.endTime || body.EndTime);
      putIf(params, 'KeyWord', body.keyWord || body.KeyWord);
      putIf(params, 'Length', body.length ?? body.Length);
      putIf(params, 'NextStart', body.nextStart || body.NextStart);
    } else if (action === 'DeleteInvalidAddress') {
      putIf(params, 'ToAddress', body.toAddress || body.ToAddress);
      if (!params.ToAddress) {
        res.status(400).json({ ok: false, error: '缺少 ToAddress' });
        return;
      }
    } else if (action === 'SenderStatisticsByTagNameAndBatchID') {
      const startTime = pickStr(body.startTime || body.StartTime);
      const endTime = pickStr(body.endTime || body.EndTime);
      if (!startTime || !endTime) {
        res.status(400).json({ ok: false, error: '缺少 StartTime / EndTime' });
        return;
      }
      params.StartTime = startTime;
      params.EndTime = endTime;
      putIf(params, 'AccountName', body.accountNameFilter || body.AccountName || accountName);
      putIf(params, 'TagName', body.tagName || body.TagName);
      putIf(params, 'Domain', body.domain || body.Domain);
    } else if (action === 'SenderStatisticsDetailByParam') {
      // AccountName / TagName / ToAddress 至多填一个
      const detailAccount = pickStr(body.accountNameFilter || body.AccountName);
      const detailTag = pickStr(body.tagName || body.TagName);
      const detailTo = pickStr(body.toAddress || body.ToAddress);
      const filled = [detailAccount, detailTag, detailTo].filter(Boolean).length;
      if (filled > 1) {
        res.status(400).json({
          ok: false,
          error: '发信详情查询中 AccountName / TagName / ToAddress 只能任选其一',
        });
        return;
      }
      putIf(params, 'AccountName', detailAccount);
      putIf(params, 'TagName', detailTag);
      putIf(params, 'ToAddress', detailTo);
      putIf(params, 'StartTime', body.startTime || body.StartTime);
      putIf(params, 'EndTime', body.endTime || body.EndTime);
      if (body.status !== undefined && body.status !== null && body.status !== '') {
        params.Status = String(body.status);
      } else if (body.Status !== undefined && body.Status !== null && body.Status !== '') {
        params.Status = String(body.Status);
      }
      putIf(params, 'Length', body.length ?? body.Length ?? '50');
      putIf(params, 'NextStart', body.nextStart || body.NextStart);
    }

    params.Signature = signAliyun(params, accessKeySecret);

    const form = Object.keys(params)
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');

    const upstream = await fetch(endpointForRegion(regionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const text = await upstream.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (data.Code) {
      res.status(400).json({
        ok: false,
        error: `${data.Code}: ${data.Message || 'DirectMail error'}`,
        RequestId: data.RequestId,
        action,
      });
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status >= 400 ? upstream.status : 502).json({
        ok: false,
        error: data?.Message || data?.raw || `上游 HTTP ${upstream.status}`,
        action,
      });
      return;
    }

    res.status(200).json({ ok: true, action, RequestId: data.RequestId, ...data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'DirectMail proxy failed' });
  }
}
