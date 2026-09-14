/**
 * Vercel Serverless：阿里云 DirectMail SingleSendMail 签名代理
 * 客户端提交 AK + 邮件内容，服务端 HMAC-SHA1 签名后转发（避免浏览器 CORS）。
 */
import crypto from 'crypto';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
};

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

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Only POST' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const accessKeyId = String(body.accessKeyId || process.env.ALIYUN_DM_ACCESS_KEY_ID || '').trim();
    const accessKeySecret = String(
      body.accessKeySecret || process.env.ALIYUN_DM_ACCESS_KEY_SECRET || ''
    ).trim();
    const accountName = String(body.accountName || process.env.ALIYUN_DM_ACCOUNT_NAME || '').trim();
    const toAddress = String(body.toAddress || '').trim();
    const subject = String(body.subject || '').trim();
    const htmlBody = String(body.htmlBody || body.textBody || '').trim();
    const regionId = String(body.regionId || 'cn-hangzhou').trim();

    if (!accessKeyId || !accessKeySecret || !accountName) {
      res.status(400).json({
        ok: false,
        error: '缺少 AccessKey / 发信地址。请在邮件模块配置，或设置服务端 ALIYUN_DM_* 环境变量。',
      });
      return;
    }
    if (!toAddress || !subject || !htmlBody) {
      res.status(400).json({ ok: false, error: '缺少 toAddress / subject / htmlBody' });
      return;
    }

    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: 'SingleSendMail',
      Format: 'JSON',
      Version: '2015-11-23',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: regionId,
      AccountName: accountName,
      AddressType: String(body.addressType === 0 ? 0 : 1),
      ReplyToAddress: body.replyToAddress ? 'true' : 'false',
      ToAddress: toAddress,
      Subject: subject,
      HtmlBody: htmlBody,
    };
    if (body.fromAlias) params.FromAlias = String(body.fromAlias);
    if (body.tagName) params.TagName = String(body.tagName);

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

    if (!upstream.ok || data.Code || data.Message && !data.RequestId) {
      // DirectMail 成功时通常有 RequestId 且无 Error Code
      if (data.Code) {
        res.status(400).json({
          ok: false,
          error: `${data.Code}: ${data.Message || 'DirectMail error'}`,
          RequestId: data.RequestId,
        });
        return;
      }
    }

    if (data.Code) {
      res.status(400).json({
        ok: false,
        error: `${data.Code}: ${data.Message || ''}`,
        RequestId: data.RequestId,
      });
      return;
    }

    res.status(200).json({ ok: true, RequestId: data.RequestId, EnvId: data.EnvId, ...data });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'DirectMail proxy failed' });
  }
}
