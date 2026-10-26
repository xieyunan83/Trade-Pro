/**
 * 产品 AI 视频：DashScope 异步 video-synthesis（wan3.0-video）。
 * Key 优先「数据接入 · 视频生成 API」，否则回退万相图片 / 千问同账号 Key。
 */
import { env } from './env';
import { getActivePoolKey } from './apiKeyPool';
import {
  buildAliyunFetchHeaders,
  DEFAULT_TOKEN_PLAN_ORIGIN,
  isLocalDevHost,
  qwenCorsHint,
} from './qwenProxy';
import { loadDataProvider, loadDataProviderLocal } from './dataProviders';
import { extractAliyunOrigin } from './wanImageService';
import { compressImageDataUrl } from './catalogExcelService';
import { humanizeCreativeProviderError } from './providerErrorMessage';

export type VideoGenerateMode = 'text' | 'image' | 'reference';

export type VideoGenerateInput = {
  mode: VideoGenerateMode;
  prompt: string;
  sourceImage?: string;
  referenceImages?: string[];
  durationSec: 4 | 5 | 8 | 10 | 15;
  aspect: '16:9' | '9:16' | '1:1';
  resolution: '720P' | '1080P';
  tier: 'draft' | 'full';
  negativePrompt?: string;
  onProgress?: (pct: number, status: string) => void;
};

export type VideoGenerateResult = {
  taskId: string;
  videoUrl: string;
  raw?: unknown;
};

const VIDEO_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
const TASK_PATH = (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`;
/** 默认标准版；备注 / extra.modelId / 环境变量可覆盖 */
const DEFAULT_VIDEO_MODEL = 'wan3.0-video';

const sanitizeKey = (k: string) =>
  (k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const normalizeOrigin = (apiKey: string, rawBase: string): string => {
  let origin = extractAliyunOrigin(rawBase);
  if (apiKey.startsWith('sk-sp-') && !/token-plan/i.test(origin)) {
    origin = DEFAULT_TOKEN_PLAN_ORIGIN;
  }
  return origin;
};

const readLs = (key: string) =>
  typeof localStorage !== 'undefined' ? localStorage.getItem(key)?.trim() || '' : '';

/** 与千问同账号：不要求 wan_video 单独启用也能取到 Key */
const pickVideoApiKey = (): string => {
  const videoMeta = loadDataProviderLocal('wan_video');
  return sanitizeKey(
    (videoMeta.enabled && videoMeta.apiKey) ||
      videoMeta.apiKey ||
      getActivePoolKey('wan') ||
      getActivePoolKey('qwen') ||
      readLs('trade_scout_wan_api_key') ||
      readLs('trade_scout_qwen_api_key') ||
      env.wanApiKey ||
      env.qwenApiKey ||
      ''
  );
};

export const getVideoProviderStatus = (): { ready: boolean; detail: string } => {
  if (pickVideoApiKey()) {
    return { ready: true, detail: '视频生成服务已就绪' };
  }
  return { ready: false, detail: '请联系管理员在「数据接入」配置视频生成 API Key（可与通义同账号）' };
};

type ResolvedVideoConfig = { apiKey: string; origin: string; modelId: string };

const resolveVideoConfig = (): ResolvedVideoConfig => {
  const videoMeta = loadDataProviderLocal('wan_video');
  const apiKey = pickVideoApiKey();

  if (!apiKey) {
    throw new Error(
      '未配置视频生成 API。请管理员在「系统管理 → 数据接入」启用「视频生成 API」并填写 Key（可与通义图像同一账号）。'
    );
  }

  const rawBase =
    (videoMeta.enabled && videoMeta.apiBase) ||
    videoMeta.apiBase ||
    readLs('trade_scout_wan_base_url') ||
    readLs('trade_scout_qwen_base_url') ||
    env.wanBaseUrl ||
    env.qwenBaseUrl ||
    DEFAULT_TOKEN_PLAN_ORIGIN;

  const modelId =
    (videoMeta.extra?.modelId || '').trim() || env.wanVideoModelId || DEFAULT_VIDEO_MODEL;

  return { apiKey, origin: normalizeOrigin(apiKey, rawBase), modelId };
};

/** 与万相生图一致：强制同域代理，避免错误代理模式导致 Failed to fetch */
const buildUrl = (origin: string, path: string): { url: string; proxyOrigin: string } => {
  if (isLocalDevHost()) {
    return { url: `/qwen-api${path}`, proxyOrigin: origin };
  }
  return {
    url: `/api/qwen?__upstream=${encodeURIComponent(path)}`,
    proxyOrigin: origin || DEFAULT_TOKEN_PLAN_ORIGIN,
  };
};

/** 进入视频模块时拉取云端「视频生成」配置 */
export const hydrateVideoProvider = async (): Promise<ReturnType<typeof getVideoProviderStatus>> => {
  try {
    await loadDataProvider('wan_video');
  } catch {
    /* 本地即可 */
  }
  return getVideoProviderStatus();
};

const prepareVideoImage = async (img: string): Promise<string> => {
  if (!img.startsWith('data:image/')) return img;
  // 视频创建体会经同域代理，过大极易 Failed to fetch；压到可控体积
  if (img.length > 500_000) return compressImageDataUrl(img, 1024, 0.72);
  if (img.length > 280_000) return compressImageDataUrl(img, 1280, 0.78);
  return img;
};

const parseJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`视频接口返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
};

/** wan3.0：时长 2–15（样片短、正片可更长；超过 15 截断） */
const mapDuration = (sec: number): number => Math.max(2, Math.min(15, Math.round(sec) || 5));

const aspectToRatio = (aspect: VideoGenerateInput['aspect']): string => {
  if (aspect === '9:16') return '9:16';
  if (aspect === '1:1') return '1:1';
  return '16:9';
};

/**
 * wan3.0-video 统一模型；draft 可用 prime 加速（若账号未开通则仍走标准版由调用方重试）。
 */
const pickModel = (cfg: ResolvedVideoConfig): string => {
  const custom = (cfg.modelId || '').trim();
  if (custom) return custom;
  return DEFAULT_VIDEO_MODEL;
};

type MediaItem = { type: string; url: string };

const createAsyncTask = async (
  cfg: ResolvedVideoConfig,
  model: string,
  input: Record<string, unknown>,
  parameters: Record<string, unknown>
): Promise<string> => {
  const { url, proxyOrigin } = buildUrl(cfg.origin, VIDEO_PATH);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: cfg.apiKey,
    proxyOrigin: proxyOrigin || cfg.origin,
    extra: {
      'X-DashScope-Async': 'enable',
      'X-Upstream-Path': VIDEO_PATH,
    },
  });

  const bodyStr = JSON.stringify({ model, input, parameters });
  if (bodyStr.length > 3_800_000) {
    throw new Error('参考图过大导致请求超限，请改用更小的主图或先压缩后再试');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
  } catch (e: any) {
    throw new Error(humanizeCreativeProviderError(`视频任务创建失败：${e?.message || e}${qwenCorsHint(e?.message)}`));
  }

  const json = await parseJson(res);
  if (!res.ok) {
    const msg =
      json.message ||
      json.code ||
      json.error?.message ||
      json.error ||
      `创建视频任务失败 HTTP ${res.status}`;
    throw new Error(humanizeCreativeProviderError(String(msg)));
  }
  const taskId = json.output?.task_id || json.task_id;
  if (!taskId) throw new Error('创建成功但未返回 task_id');
  return String(taskId);
};

const pollTask = async (
  cfg: ResolvedVideoConfig,
  taskId: string,
  onProgress?: (pct: number, status: string) => void
): Promise<any> => {
  const path = TASK_PATH(taskId);
  const { url, proxyOrigin } = buildUrl(cfg.origin, path);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: cfg.apiKey,
    proxyOrigin: proxyOrigin || cfg.origin,
    extra: { 'X-Upstream-Path': path },
  });

  const maxAttempts = 180;
  for (let i = 0; i < maxAttempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (e: any) {
      throw new Error(`查询视频任务失败：${e?.message || e}${qwenCorsHint(e?.message)}`);
    }
    const json = await parseJson(res);
    if (!res.ok && !json.output) {
      throw new Error(json.message || `查询视频任务失败 HTTP ${res.status}`);
    }
    const out = json.output || json;
    const status = String(out.task_status || out.status || '').toUpperCase();
    const pct =
      status === 'SUCCEEDED' || status === 'SUCCESS'
        ? 100
        : status === 'RUNNING'
          ? Math.min(92, 15 + i * 1.2)
          : Math.min(20, 5 + i);
    onProgress?.(pct, status.toLowerCase());

    if (status === 'SUCCEEDED' || status === 'SUCCESS') return out;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new Error(out.message || out.code || `视频生成失败（${status}）`);
    }
    await sleep(3000);
  }
  throw new Error('视频生成超时。可缩短时长后重试，或稍后到供应商控制台查询任务。');
};

const pickVideoUrl = (out: any): string => {
  const url = out.video_url || out.results?.[0]?.url || out.result?.video_url || '';
  if (!url) throw new Error('任务完成但未返回视频地址');
  return String(url);
};

/**
 * 真实异步生成产品视频（wan3.0-video）。
 * - text：仅 prompt
 * - image：首帧 first_frame（与 reference_* 互斥）
 * - reference：全部用 reference_image
 */
export const generateProductVideo = async (input: VideoGenerateInput): Promise<VideoGenerateResult> => {
  const cfg = resolveVideoConfig();
  let prompt = (input.prompt || '').trim();
  if (!prompt) throw new Error('请填写画面与运镜描述');

  const model = pickModel(cfg);
  const duration = mapDuration(input.durationSec);
  const resolution = input.tier === 'draft' ? '720P' : input.resolution === '1080P' ? '1080P' : '720P';

  input.onProgress?.(3, 'queued');

  let taskInput: Record<string, unknown>;
  const parameters: Record<string, unknown> = {
    resolution,
    ratio: aspectToRatio(input.aspect),
    duration,
    prompt_extend: true,
  };

  if (input.mode === 'text') {
    taskInput = { prompt };
    if (input.negativePrompt?.trim()) {
      taskInput.negative_prompt = input.negativePrompt.trim();
    }
  } else {
    const imgs = [input.sourceImage, ...(input.referenceImages || [])]
      .filter(Boolean)
      .map((u) => String(u).trim()) as string[];
    if (!imgs.length) throw new Error('请至少上传一张参考图');

    input.onProgress?.(4, 'preparing');
    const prepared: string[] = [];
    for (const img of imgs.slice(0, input.mode === 'reference' ? 5 : 1)) {
      if (!/^https?:\/\//i.test(img) && !/^data:image\//i.test(img)) {
        throw new Error('参考图格式无效');
      }
      prepared.push(await prepareVideoImage(img));
    }

    // first_frame 与 reference_image 互斥，不可同请求
    const media: MediaItem[] =
      input.mode === 'reference'
        ? prepared.map((url) => ({ type: 'reference_image', url }))
        : [{ type: 'first_frame', url: prepared[0] }];

    if (input.mode === 'reference' && prepared.length > 1) {
      prompt = `${prompt}\n参考图顺序：图1起保持产品外观一致。`;
    }

    taskInput = { prompt, media };
    if (input.negativePrompt?.trim()) {
      taskInput.negative_prompt = input.negativePrompt.trim();
    }
  }

  try {
    const taskId = await createAsyncTask(cfg, model, taskInput, parameters);
    input.onProgress?.(8, 'running');
    const out = await pollTask(cfg, taskId, input.onProgress);
    return { taskId, videoUrl: pickVideoUrl(out), raw: out };
  } catch (e: any) {
    throw new Error(humanizeCreativeProviderError(e?.message || e));
  }
};
