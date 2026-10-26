/**
 * 本地开发：/api/landing 与 Vercel Serverless 同逻辑
 */
import type { Plugin } from 'vite';
import { buildLandingPayload } from './services/landingDataCore';

export function landingDevPlugin(): Plugin {
  return {
    name: 'trade-pro-landing-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/landing')) return next();
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'content-type, x-industry-token');
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'GET only' }));
          return;
        }
        try {
          const token = String(req.headers['x-industry-token'] || '').trim();
          const payload = await buildLandingPayload({
            industryToken: token || undefined,
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(payload));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
        }
      });
    },
  };
}
