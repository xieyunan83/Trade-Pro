#!/usr/bin/env node
/**
 * 长时阿里云 / Anymail 中转（解决线上 Supabase Edge Function HTTP 546）
 *
 * 用法：
 *   node scripts/aliyun-proxy-server.mjs
 *   PORT=8787 node scripts/aliyun-proxy-server.mjs
 *
 * 然后在管理后台「千问长时中转」填：http://你的服务器IP:8787
 * 或用 Nginx 反代到 https://你的域名 ，模式选「同域 /qwen-api」。
 *
 * 路径：
 *   POST /qwen-api/...     → X-Qwen-Origin 指定的阿里云域名
 *   POST /anymail-api/...  → https://api.anymailfinder.com
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import dns from 'node:dns/promises';

const PORT = Number(process.env.PORT || 8787);
const FALLBACK_QWEN = 'https://token-plan.cn-beijing.maas.aliyuncs.com';
const ANYMAIL_ORIGIN = 'https://api.anymailfinder.com';
const DNS_SERVERS = ['223.5.5.5', '223.6.6.6', '8.8.8.8'];
const TIMEOUT_MS = 400_000;

const HOP = new Set([
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

async function resolveHost(hostname) {
  try {
    return (await dns.lookup(hostname)).address;
  } catch {
    const r = new dns.Resolver();
    r.setServers(DNS_SERVERS);
    const list = await r.resolve4(hostname);
    if (!list[0]) throw new Error(`DNS ENOTFOUND ${hostname}`);
    return list[0];
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, apikey'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxy(req, res, targetOrigin, stripPrefix) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  let origin = targetOrigin;
  const hdr = req.headers['x-qwen-origin'];
  if (typeof hdr === 'string' && /^https:\/\//i.test(hdr)) {
    try {
      origin = new URL(hdr).origin;
    } catch {
      /* keep */
    }
  }

  const rawUrl = req.url || '/';
  const path = rawUrl.startsWith(stripPrefix) ? rawUrl.slice(stripPrefix.length) || '/' : rawUrl;
  const target = new URL(path.startsWith('/') ? path : `/${path}`, origin + '/');
  const body = await readBody(req);
  const ip = await resolveHost(target.hostname);
  const lib = target.protocol === 'https:' ? https : http;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null || HOP.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers.host = target.host;
  headers['content-length'] = body.length;

  await new Promise((resolve) => {
    const upstream = lib.request(
      {
        protocol: target.protocol,
        hostname: ip,
        servername: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method || 'POST',
        headers,
        timeout: TIMEOUT_MS,
      },
      (upRes) => {
        res.statusCode = upRes.statusCode || 502;
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (v == null) continue;
          const key = k.toLowerCase();
          if (key === 'transfer-encoding' || key === 'connection') continue;
          res.setHeader(k, v);
        }
        res.setHeader('X-Proxied-To', target.origin);
        cors(res);
        upRes.pipe(res);
        upRes.on('end', resolve);
      }
    );
    upstream.on('timeout', () => {
      upstream.destroy(new Error('upstream timeout'));
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        cors(res);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err.message, target: target.origin }));
      }
      resolve();
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    if (url.startsWith('/qwen-api')) {
      await proxy(req, res, FALLBACK_QWEN, '/qwen-api');
      return;
    }
    if (url.startsWith('/anymail-api')) {
      await proxy(req, res, ANYMAIL_ORIGIN, '/anymail-api');
      return;
    }
    if (url === '/' || url === '/health') {
      cors(res);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, service: 'aliyun-proxy-server', port: PORT }));
      return;
    }
    res.statusCode = 404;
    cors(res);
    res.end('not found');
  } catch (e) {
    res.statusCode = 500;
    cors(res);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[aliyun-proxy] http://0.0.0.0:${PORT}`);
  console.log(`  /qwen-api/*     → Aliyun (X-Qwen-Origin)`);
  console.log(`  /anymail-api/*  → ${ANYMAIL_ORIGIN}`);
  console.log(`在管理后台「千问长时中转」填写: http://服务器IP:${PORT}`);
});
