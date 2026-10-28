/**
 * 决策模型（System One）：结构化 choice / noul / score，不生成文本。
 * 复用千问 Token Plan Key + Base；默认模型 decision-model-preview（管理员可改）。
 * Endpoint: {compatible-mode/v1}/systemone
 */
import { sanitizeApiKey } from './geminiService';
import { env } from './env';
import { getActivePoolKey, listPoolKeys } from './apiKeyPool';
import {
  DEFAULT_TOKEN_PLAN_ORIGIN,
  resolveQwenRequestTarget,
  buildAliyunFetchHeaders,
} from './qwenProxy';

const LS_MODEL = 'trade_scout_decision_model_id';
export const DEFAULT_DECISION_MODEL = 'decision-model-preview';

/** 管理后台可选模型（默认定决策模型；也可选手动填写） */
export const DECISION_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'decision-model-preview', label: 'decision-model-preview（推荐·结构化决策）' },
  { id: 'qwen3.7-plus', label: 'qwen3.7-plus（勿作决策主路径）' },
  { id: 'qwen3.8-flash', label: 'qwen3.8-flash（勿作决策主路径）' },
];

export const getDecisionModelId = (): string => {
  try {
    const v = (localStorage.getItem(LS_MODEL) || '').trim();
    return v || DEFAULT_DECISION_MODEL;
  } catch {
    return DEFAULT_DECISION_MODEL;
  }
};

export const setDecisionModelId = (id: string) => {
  try {
    localStorage.setItem(LS_MODEL, (id || DEFAULT_DECISION_MODEL).trim());
  } catch {
    /* ignore */
  }
};

export type DecisionQuestionType = 'choice' | 'noul' | 'score';

export type DecisionQuestion = {
  type: DecisionQuestionType;
  instructions?: string;
  criteria?: Record<string, string> | string[] | { true?: string; false?: string };
};

export type DecisionAnswer = {
  type: DecisionQuestionType;
  choice?: string;
  noul?: number;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, string>;
};

export type DecisionModelResult = {
  model: string;
  requestId?: string;
  answers: Record<string, DecisionAnswer>;
  latencyMs?: number;
  inputTokens?: number;
};

const resolveDecisionEndpoint = async (): Promise<{
  url: string;
  apiKey: string;
  proxyOrigin?: string;
}> => {
  const poolKey = getActivePoolKey('qwen');
  const localKey =
    poolKey ||
    (typeof localStorage !== 'undefined'
      ? localStorage.getItem('trade_scout_qwen_api_key') || ''
      : '');
  const localBase =
    (typeof localStorage !== 'undefined'
      ? localStorage.getItem('trade_scout_qwen_base_url') || ''
      : '') || `${DEFAULT_TOKEN_PLAN_ORIGIN}/compatible-mode/v1`;

  const apiKey = sanitizeApiKey(localKey || env.qwenApiKey || '');
  if (!apiKey) {
    throw new Error('未配置千问 API Key，决策模型与对话共用同一把 Key');
  }

  let base = localBase.trim().replace(/\/$/, '');
  if (!base.includes('/compatible-mode')) {
    base = `${base}/compatible-mode/v1`;
  }
  // chat 路径 → 决策 systemone
  const systemoneAbsolute = base.includes('/chat/completions')
    ? base.replace(/\/chat\/completions\/?$/, '/systemone')
    : `${base}/systemone`;

  const target = resolveQwenRequestTarget(systemoneAbsolute);
  return { url: target.url, apiKey, proxyOrigin: target.proxyOrigin };
};

/**
 * 调用决策模型。questions 最多 16 个。
 */
export const callDecisionModel = async (
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, DecisionQuestion>,
  opts?: { modelId?: string; timeoutMs?: number }
): Promise<DecisionModelResult> => {
  const keys = Object.keys(questions || {});
  if (!keys.length) throw new Error('决策模型至少需要一个问题');
  if (keys.length > 16) throw new Error('决策模型单次最多 16 个问题');

  const { url, apiKey, proxyOrigin } = await resolveDecisionEndpoint();
  const model = (opts?.modelId || getDecisionModelId() || DEFAULT_DECISION_MODEL).trim();

  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey,
    proxyOrigin,
  });

  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        state,
        questions,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        text.slice(0, 280) ||
        `HTTP ${res.status}`;
      throw new Error(`决策模型失败: ${msg}`);
    }
    const answers = (data.answers || {}) as Record<string, DecisionAnswer>;
    return {
      model: data.model || model,
      requestId: data.request_id,
      answers,
      latencyMs: data.latency_ms,
      inputTokens: data.usage?.input_tokens,
    };
  } finally {
    window.clearTimeout(timer);
  }
};

/** 后台连通性短测 */
export const testDecisionModel = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    if (!listPoolKeys('qwen').length && !env.qwenApiKey) {
      return { ok: false, message: '请先配置千问 Key 池' };
    }
    const r = await callDecisionModel(
      { ping: 'connectivity test for trade platform decision layer' },
      {
        ok: {
          type: 'noul',
          instructions: '这是一次连通性测试，请返回接近 1 的概率表示服务可用',
        },
      },
      { timeoutMs: 45_000 }
    );
    const p = r.answers.ok?.noul;
    return {
      ok: true,
      message: `决策模型 OK · ${r.model} · noul=${p?.toFixed?.(3) ?? p} · ${r.latencyMs ?? '?'}ms`,
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
};
