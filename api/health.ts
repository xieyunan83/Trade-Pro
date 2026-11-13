/**
 * 轻量健康检查：零外部依赖，用于确认 Serverless 是否可调起。
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
  memory: 256,
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'health',
    at: Date.now(),
    method: req?.method || 'GET',
  });
}
