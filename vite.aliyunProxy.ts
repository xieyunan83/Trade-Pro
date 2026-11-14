import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { URL } from 'node:url';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'x-qwen-origin',
]);

const FALLBACK_DNS = ['223.5.5.5', '223.6.6.6', '8.8.8.8'];

/** 系统 DNS 失败时改用阿里/谷歌 DNS，避免 ENOTFOUND */
async function resolveHostname(hostname: string): Promise<{ address: string; via: string }> {
  try {
    const r = await dns.lookup(hostname);
    return { address: r.address, via: 'system' };
  } catch (sysErr: any) {
    const resolver = new dns.Resolver();
    resolver.setServers(FALLBACK_DNS);
    try {
      const v4 = await resolver.resolve4(hostname);
      if (v4[0]) return { address: v4[0], via: '223.5.5.5' };
    } catch {
      /* fallthrough */
    }
    throw new Error(
      `DNS 无法解析 ${hostname}（${sysErr?.code || sysErr?.message}）。` +
        `请把电脑 DNS 改为 223.5.5.5，或关闭干扰 DNS 的代理/VPN 后重试。`
    );
  }
}

type MountProxyOptions = {
  /** 若请求未带 Authorization，注入服务端 Key（如 AnySearch） */
  injectAuthorization?: () => string | undefined;
  extraHeaders?: Record<string, string>;
  /** Gemini 等：禁止转发 Authorization，只保留 x-goog-api-key */
  stripAuthorization?: boolean;
};

function mountOriginProxy(
  server: ViteDevServer,
  mountPath: string,
  resolveOrigin: (req: IncomingMessage) => string,
  options?: MountProxyOptions
) {
  server.middlewares.use(mountPath, (req, res) => {
    let origin = resolveOrigin(req).replace(/\/$/, '');
    try {
      origin = new URL(origin).origin;
    } catch {
      /* keep */
    }

    const pathAndQuery = req.url || '/';
    const target = new URL(pathAndQuery, origin + '/');

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const isHttps = target.protocol === 'https:';
        const lib = isHttps ? https : http;

        let resolvedHost = target.hostname;
        let dnsVia = 'direct';
        try {
          const resolved = await resolveHostname(target.hostname);
          resolvedHost = resolved.address;
          dnsVia = resolved.via;
        } catch (dnsErr: any) {
          if (!res.writableEnded) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: dnsErr?.message || String(dnsErr),
                target: target.origin,
              })
            );
          }
          return;
        }

        const headers: Record<string, string | number | string[] | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined) continue;
          if (HOP_BY_HOP.has(k.toLowerCase())) continue;
          headers[k] = v;
        }
        headers.host = target.host;
        headers['content-length'] = body.length;
        if (!headers['content-type'] && body.length) {
          headers['content-type'] = 'application/json';
        }
        if (options?.extraHeaders) {
          for (const [k, v] of Object.entries(options.extraHeaders)) {
            if (!headers[k.toLowerCase()]) headers[k] = v;
          }
        }
        if (options?.stripAuthorization) {
          for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'authorization') delete headers[k];
          }
        } else if (!headers.authorization && !headers.Authorization) {
          const injected = options?.injectAuthorization?.();
          if (injected) headers.authorization = injected;
        }

        const proxyReq = lib.request(
          {
            protocol: target.protocol,
            hostname: resolvedHost,
            servername: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            path: target.pathname + target.search,
            method: req.method || 'POST',
            headers,
            timeout: 360_000,
          },
          (proxyRes) => {
            if (res.writableEnded) {
              proxyRes.resume();
              return;
            }
            res.statusCode = proxyRes.statusCode || 502;
            for (const [k, v] of Object.entries(proxyRes.headers)) {
              if (v === undefined) continue;
              const key = k.toLowerCase();
              if (key === 'transfer-encoding' || key === 'connection') continue;
              res.setHeader(k, v);
            }
            res.setHeader('X-Proxied-To', target.origin);
            res.setHeader('X-Dns-Via', dnsVia);
            proxyRes.pipe(res);
          }
        );

        proxyReq.setTimeout(360_000, () => {
          proxyReq.destroy(new Error('Upstream timeout (360s)'));
        });

        proxyReq.on('error', (err) => {
          if (res.writableEnded) return;
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          const hint =
            /ENOTFOUND|EAI_AGAIN/i.test(err.message)
              ? '电脑 DNS 解析失败，请把 DNS 改为 223.5.5.5 后重启 npm run dev。'
              : '';
          res.end(
            JSON.stringify({
              error: `Proxy error: ${err.message}${hint ? ' — ' + hint : ''}`,
              target: target.origin,
            })
          );
        });

        req.on('aborted', () => {
          proxyReq.destroy();
        });
        res.on('close', () => {
          if (!res.writableEnded) proxyReq.destroy();
        });

        if (body.length) proxyReq.write(body);
        proxyReq.end();
      })();
    });
  });
}

/**
 * 开发环境代理：
 * - /qwen-api → 阿里云（X-Qwen-Origin 动态路由）
 * - /anymail-api → api.anymailfinder.com（解决浏览器 CORS Failed to fetch）
 * - /anysearch-api → api.anysearch.com（背调身份补全；Key 从 env 注入）
 * - /gemini-api → generativelanguage.googleapis.com（仅 x-goog-api-key，禁 Bearer）
 * - /tavily-api → api.tavily.com（联网搜索）
 */
export function aliyunDevProxyPlugin(
  fallbackOrigin = 'https://dashscope.aliyuncs.com',
  opts?: {
    anysearchApiKey?: string;
    directMailEnv?: {
      accessKeyId?: string;
      accessKeySecret?: string;
      accountName?: string;
    };
  }
): Plugin {
  return {
    name: 'aliyun-dev-proxy',
    configureServer(server: ViteDevServer) {
      mountOriginProxy(server, '/qwen-api', (req) => {
        const originHeader = req.headers['x-qwen-origin'];
        if (typeof originHeader === 'string' && /^https:\/\//i.test(originHeader)) {
          return originHeader;
        }
        return fallbackOrigin;
      });

      mountOriginProxy(server, '/anymail-api', () => 'https://api.anymailfinder.com');
      mountOriginProxy(server, '/hunter-api', () => 'https://api.hunter.io');
      mountOriginProxy(server, '/anysearch-api', () => 'https://api.anysearch.com', {
        extraHeaders: { 'X-Anysearch-Client': 'trade-pro/1.0' },
        injectAuthorization: () => {
          const k = (opts?.anysearchApiKey || process.env.ANYSEARCH_API_KEY || '').trim();
          return k ? `Bearer ${k.replace(/^Bearer\s+/i, '')}` : undefined;
        },
      });
      // Gemini：转发 x-goog-api-key；显式去掉 Authorization，避免 AQ. Key 被当成 OAuth
      mountOriginProxy(server, '/gemini-api', () => 'https://generativelanguage.googleapis.com', {
        stripAuthorization: true,
      });
      mountOriginProxy(server, '/tavily-api', () => 'https://api.tavily.com');
      // 图生 3D OpenAPI（Authorization: Bearer tsk_***）
      mountOriginProxy(server, '/tripo-api', () => 'https://api.tripo3d.ai');
      // 混元生 3D TokenHub
      mountOriginProxy(server, '/tokenhub-api', () => 'https://tokenhub.tencentmaas.com');
      // 发文发布：LinkedIn / Meta Graph / X
      mountOriginProxy(server, '/linkedin-api', () => 'https://api.linkedin.com');
      mountOriginProxy(server, '/meta-api', () => 'https://graph.facebook.com');
      mountOriginProxy(server, '/x-api', () => 'https://api.x.com');

      // 本地 DirectMail：与生产 /api/directmail 同路径，便于 npm run dev 真发信
      server.middlewares.use('/api/directmail', (req, res) => {
        void handleLocalDirectMail(req, res, opts?.directMailEnv);
      });

      // 本地百炼临时图上传（与生产 /api/dashscope-upload 对齐）
      server.middlewares.use('/api/dashscope-upload', (req, res) => {
        void handleLocalDashscopeUpload(req, res);
      });
    },
  };
}

async function handleLocalDashscopeUpload(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Only POST' }));
    return;
  }
  try {
    const raw = await readReqBody(req);
    const body = JSON.parse(raw || '{}') as {
      model?: string;
      origin?: string;
      contentType?: string;
      contentBase64?: string;
      filename?: string;
    };
    const apiKey = String(req.headers.authorization || '')
      .replace(/^Bearer\s+/i, '')
      .replace(/\s+/g, '')
      .trim();
    if (!apiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing Authorization' }));
      return;
    }
    const model = (body.model || 'Tripo/Tripo-H3.1').trim();
    const b64 = String(body.contentBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'contentBase64 required' }));
      return;
    }
    const contentType = body.contentType || 'image/jpeg';
    const filename =
      body.filename ||
      `ref_${Date.now()}.${contentType.includes('png') ? 'png' : 'jpg'}`;
    const origins = [
      body.origin,
      'https://dashscope.aliyuncs.com',
    ].filter(Boolean) as string[];
    const unique = [...new Set(origins.map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    }))];

    let lastErr = '';
    for (const origin of unique) {
      try {
        const policyUrl = `${origin}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`;
        const polRes = await fetch(policyUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        const polJson: any = await polRes.json().catch(() => ({}));
        if (!polRes.ok) {
          lastErr = polJson.message || polJson.code || `getPolicy HTTP ${polRes.status}`;
          continue;
        }
        const data = polJson.data || polJson;
        if (!data?.upload_host || !data?.policy) {
          lastErr = 'policy missing fields';
          continue;
        }
        const key = `${String(data.upload_dir).replace(/\/$/, '')}/${filename}`;
        const buf = Buffer.from(b64, 'base64');
        const form = new FormData();
        form.append('OSSAccessKeyId', data.oss_access_key_id);
        form.append('Signature', data.signature);
        form.append('policy', data.policy);
        form.append('x-oss-object-acl', data.x_oss_object_acl);
        form.append('x-oss-forbid-overwrite', data.x_oss_forbid_overwrite);
        form.append('key', key);
        form.append('success_action_status', '200');
        form.append('file', new Blob([buf], { type: contentType }), filename);
        const up = await fetch(data.upload_host, { method: 'POST', body: form });
        if (!up.ok) {
          lastErr = `OSS upload HTTP ${up.status}`;
          continue;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: `oss://${key}` }));
        return;
      } catch (e: any) {
        lastErr = e?.message || String(e);
      }
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: lastErr || 'upload failed' }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'upload crashed' }));
  }
}

type DirectMailEnv = {
  accessKeyId?: string;
  accessKeySecret?: string;
  accountName?: string;
};

async function readReqBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

const DM_ALLOWED_ACTIONS = new Set([
  'SingleSendMail',
  'DescAccountSummary',
  'QueryInvalidAddress',
  'DeleteInvalidAddress',
  'SenderStatisticsByTagNameAndBatchID',
  'SenderStatisticsDetailByParam',
]);

/** 本地 DirectMail：与 api/directmail.ts 多 Action 对齐（额度/无效地址/统计/发信） */
async function handleLocalDirectMail(
  req: IncomingMessage,
  res: ServerResponse,
  envKeys?: DirectMailEnv
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Only POST' }));
    return;
  }

  const json = (code: number, payload: Record<string, unknown>) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  try {
    const crypto = await import('node:crypto');
    const raw = await readReqBody(req);
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      json(400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const pick = (v: unknown) => (v == null ? '' : String(v).trim());
    const putIf = (params: Record<string, string>, key: string, value: unknown) => {
      const s = pick(value);
      if (s) params[key] = s;
    };

    const accessKeyId = pick(
      body.accessKeyId || envKeys?.accessKeyId || process.env.ALIYUN_DM_ACCESS_KEY_ID
    );
    const accessKeySecret = pick(
      body.accessKeySecret ||
        envKeys?.accessKeySecret ||
        process.env.ALIYUN_DM_ACCESS_KEY_SECRET
    );
    const accountName = pick(
      body.accountName || envKeys?.accountName || process.env.ALIYUN_DM_ACCOUNT_NAME
    );
    const regionId = pick(body.regionId) || 'cn-hangzhou';
    const action = pick(body.action || body.Action) || 'SingleSendMail';

    if (!accessKeyId || !accessKeySecret) {
      json(400, {
        ok: false,
        error:
          '缺少 AccessKey。请在 .env.local 填写 REACT_APP_ALIYUN_EMAIL_*，或邮件模块「接口配置」。',
      });
      return;
    }
    if (!DM_ALLOWED_ACTIONS.has(action)) {
      json(400, { ok: false, error: `不支持的 Action: ${action}` });
      return;
    }

    const percentEncode = (s: string) =>
      encodeURIComponent(s)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');

    const apiVersion =
      regionId.includes('singapore') || regionId === 'ap-southeast-1'
        ? '2017-06-22'
        : '2015-11-23';

    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: action,
      Format: 'JSON',
      Version: apiVersion,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: regionId,
    };

    if (action === 'SingleSendMail') {
      const toAddress = pick(body.toAddress);
      const subject = pick(body.subject);
      const htmlBody = pick(body.htmlBody);
      const textBody = pick(body.textBody);
      if (!accountName) {
        json(400, { ok: false, error: '缺少发信地址（AccountName）' });
        return;
      }
      if (!toAddress || !subject || (!htmlBody && !textBody)) {
        json(400, { ok: false, error: '缺少 toAddress / subject / htmlBody' });
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
      if (body.clickTrace === true || body.clickTrace === 1 || body.clickTrace === '1') {
        params.ClickTrace = '1';
      } else if (body.clickTrace === false || body.clickTrace === 0 || body.clickTrace === '0') {
        params.ClickTrace = '0';
      }
      putIf(params, 'UnSubscribeLinkType', body.unSubscribeLinkType);
      putIf(params, 'UnSubscribeFilterLevel', body.unSubscribeFilterLevel);
      const rawAtt = Array.isArray(body.attachments) ? body.attachments : [];
      let ai = 0;
      for (const item of rawAtt.slice(0, 5)) {
        if (!item || typeof item !== 'object') continue;
        const fileName = pick((item as any).fileName || (item as any).name);
        let content = pick((item as any).content || (item as any).contentBase64);
        if (!fileName || !content) continue;
        const comma = content.indexOf(',');
        if (content.startsWith('data:') && comma > 0) content = content.slice(comma + 1);
        if (content.length > 4_700_000) continue;
        ai += 1;
        params[`Attachments.${ai}.FileName`] = fileName;
        params[`Attachments.${ai}.Content`] = content;
      }
    } else if (action === 'QueryInvalidAddress') {
      putIf(params, 'StartTime', body.startTime || body.StartTime);
      putIf(params, 'EndTime', body.endTime || body.EndTime);
      putIf(params, 'KeyWord', body.keyWord || body.KeyWord);
      putIf(params, 'Length', body.length ?? body.Length);
      putIf(params, 'NextStart', body.nextStart || body.NextStart);
    } else if (action === 'DeleteInvalidAddress') {
      putIf(params, 'ToAddress', body.toAddress || body.ToAddress);
      if (!params.ToAddress) {
        json(400, { ok: false, error: '缺少 ToAddress' });
        return;
      }
    } else if (action === 'SenderStatisticsByTagNameAndBatchID') {
      const startTime = pick(body.startTime || body.StartTime);
      const endTime = pick(body.endTime || body.EndTime);
      if (!startTime || !endTime) {
        json(400, { ok: false, error: '缺少 StartTime / EndTime' });
        return;
      }
      params.StartTime = startTime;
      params.EndTime = endTime;
      putIf(params, 'AccountName', body.accountNameFilter || body.AccountName || accountName);
      putIf(params, 'TagName', body.tagName || body.TagName);
      putIf(params, 'Domain', body.domain || body.Domain);
    } else if (action === 'SenderStatisticsDetailByParam') {
      const detailAccount = pick(body.accountNameFilter || body.AccountName);
      const detailTag = pick(body.tagName || body.TagName);
      const detailTo = pick(body.toAddress || body.ToAddress);
      if ([detailAccount, detailTag, detailTo].filter(Boolean).length > 1) {
        json(400, {
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

    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');
    const stringToSign = `POST&${percentEncode('/')}&${percentEncode(sorted)}`;
    params.Signature = crypto
      .createHmac('sha1', `${accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');

    const form = Object.keys(params)
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');

    const endpoint =
      regionId.includes('singapore') || regionId === 'ap-southeast-1'
        ? 'https://dm.ap-southeast-1.aliyuncs.com/'
        : 'https://dm.aliyuncs.com/';

    const upstream = await fetch(endpoint, {
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
      json(400, {
        ok: false,
        error: `${data.Code}: ${data.Message || ''}`,
        RequestId: data.RequestId,
        action,
      });
      return;
    }
    if (!upstream.ok) {
      json(upstream.status >= 400 ? upstream.status : 502, {
        ok: false,
        error: data?.Message || data?.raw || `上游 HTTP ${upstream.status}`,
        action,
      });
      return;
    }
    json(200, { ok: true, action, RequestId: data.RequestId, ...data });
  } catch (e: any) {
    json(500, { ok: false, error: e?.message || 'DirectMail local proxy failed' });
  }
}
