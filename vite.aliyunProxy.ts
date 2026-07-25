import type { Plugin, ViteDevServer } from 'vite';
import http from 'node:http';
import https from 'node:https';
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

/**
 * 开发环境阿里云代理：根据 X-Qwen-Origin 动态转发到 Token Plan / MaaS / DashScope。
 * Vite 自带 proxy.router 在部分版本不可靠，会导致 sk-sp Key 打到 dashscope 而 401。
 */
export function aliyunDevProxyPlugin(fallbackOrigin = 'https://dashscope.aliyuncs.com'): Plugin {
  return {
    name: 'aliyun-dev-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/qwen-api', (req, res) => {
        const originHeader = req.headers['x-qwen-origin'];
        let origin =
          typeof originHeader === 'string' && /^https:\/\//i.test(originHeader)
            ? originHeader.replace(/\/$/, '')
            : fallbackOrigin.replace(/\/$/, '');

        try {
          origin = new URL(origin).origin;
        } catch {
          origin = fallbackOrigin;
        }

        const pathAndQuery = req.url || '/';
        const target = new URL(pathAndQuery, origin + '/');

        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const isHttps = target.protocol === 'https:';
          const lib = isHttps ? https : http;

          const headers: Record<string, string | number | string[] | undefined> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (v === undefined) continue;
            if (HOP_BY_HOP.has(k.toLowerCase())) continue;
            headers[k] = v;
          }
          headers.host = target.host;
          headers['content-length'] = body.length;
          // 避免上游因缺 content-type 拒收
          if (!headers['content-type'] && body.length) {
            headers['content-type'] = 'application/json';
          }

          const proxyReq = lib.request(
            {
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port || (isHttps ? 443 : 80),
              path: target.pathname + target.search,
              method: req.method || 'POST',
              headers,
              // 联网搜索可能很慢
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
              proxyRes.pipe(res);
            }
          );

          proxyReq.setTimeout(360_000, () => {
            proxyReq.destroy(new Error('Upstream timeout (360s)'));
          });

          proxyReq.on('error', (err) => {
            if (res.writableEnded) return;
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}`, target: target.origin }));
          });

          // 浏览器取消请求时，立刻掐断上游，避免占连接
          req.on('aborted', () => {
            proxyReq.destroy();
          });
          res.on('close', () => {
            if (!res.writableEnded) proxyReq.destroy();
          });

          if (body.length) proxyReq.write(body);
          proxyReq.end();
        });
      });
    },
  };
}
