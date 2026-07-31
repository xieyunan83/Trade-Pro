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
        if (!headers.authorization && !headers.Authorization) {
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
 */
export function aliyunDevProxyPlugin(
  fallbackOrigin = 'https://dashscope.aliyuncs.com',
  opts?: { anysearchApiKey?: string }
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
    },
  };
}
