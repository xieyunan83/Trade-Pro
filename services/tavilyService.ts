/**
 * Tavily — 联网搜索 / 网页提取（替代 Gemini Google grounding）
 * Key：管理后台 → localStorage / Supabase；请求经同域代理。
 */
import { getTavilyApiKey, saveTavilyApiKey } from './env';
import { isLocalDevHost } from './qwenProxy';
import { getApiConfig, isSupabaseConfigured } from './supabase';

const TIMEOUT_MS = 40_000;
const MAX_EVIDENCE_CHARS = 10_000;

export type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

export type TavilySearchResponse = {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
  response_time?: number;
};

const resolveTavilyUrl = (upstreamPath: string): string => {
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  if (isLocalDevHost()) return `/tavily-api${path}`;
  return `/api/tavily?__upstream=${encodeURIComponent(path)}`;
};

const authHeader = (): Record<string, string> => {
  const key = getTavilyApiKey().replace(/^Bearer\s+/i, '').trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
};

export const hasTavilyKey = (): boolean => Boolean(getTavilyApiKey().trim());

export const hydrateTavilyKeyFromCloud = async (): Promise<void> => {
  if (!isSupabaseConfigured()) return;
  try {
    const cloud = await getApiConfig('tavily');
    if (cloud?.apiKey?.trim()) saveTavilyApiKey(cloud.apiKey.trim());
  } catch {
    /* ignore */
  }
};

const tavilyPost = async <T = any>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS
): Promise<T> => {
  const key = getTavilyApiKey().replace(/^Bearer\s+/i, '').trim();
  if (!key) throw new Error('未配置 Tavily API Key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveTavilyUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Tavily 返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(json.error || json.detail || json.message || `Tavily HTTP ${res.status}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
};

export const tavilySearch = async (
  query: string,
  opts?: {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeAnswer?: boolean;
  }
): Promise<TavilySearchResponse> => {
  return tavilyPost<TavilySearchResponse>('/search', {
    query,
    search_depth: opts?.searchDepth || 'basic',
    max_results: Math.min(Math.max(opts?.maxResults ?? 8, 1), 15),
    include_answer: opts?.includeAnswer ?? true,
  });
};

export const tavilyExtract = async (urls: string[]): Promise<any> => {
  const clean = urls.map((u) => u.trim()).filter(Boolean).slice(0, 5);
  if (!clean.length) return { results: [] };
  return tavilyPost('/extract', { urls: clean });
};

/** 格式化为给大模型用的证据文本 */
export const formatTavilyEvidence = (data: TavilySearchResponse, label = 'TAVILY'): string => {
  const lines: string[] = [];
  if (data.answer?.trim()) lines.push(`Answer: ${data.answer.trim()}`);
  for (const r of data.results || []) {
    const title = (r.title || '').trim();
    const url = (r.url || '').trim();
    const content = (r.content || '').trim().slice(0, 500);
    if (!title && !url && !content) continue;
    lines.push(`- ${title}${url ? ` | ${url}` : ''}${content ? `\n  ${content}` : ''}`);
  }
  if (!lines.length) return '';
  const body = lines.join('\n');
  const clipped =
    body.length > MAX_EVIDENCE_CHARS ? `${body.slice(0, MAX_EVIDENCE_CHARS)}\n…(truncated)` : body;
  return `=== ${label} WEB EVIDENCE ===\n${clipped}\n=== END ${label} ===`;
};

/** 客户搜索：多查询取证 */
export const gatherTavilyLeadEvidence = async (opts: {
  productKeyword: string;
  country: string;
  industry?: string;
  clientType?: string;
}): Promise<string> => {
  if (!hasTavilyKey()) return '';
  const kw = (opts.productKeyword || '').trim();
  const country = (opts.country || '').trim();
  const industry = (opts.industry || '').trim();
  const ctype = (opts.clientType || 'distributor importer wholesaler').trim();
  if (!kw) return '';

  const queries = [
    `${kw} ${ctype} ${country} company website`.replace(/\s+/g, ' ').trim(),
    `${kw} buyer OR importer OR distributor ${country}`.replace(/\s+/g, ' ').trim(),
  ];
  if (industry) {
    queries.push(`${industry} ${kw} ${country} wholesale`.replace(/\s+/g, ' ').trim());
  }

  const chunks: string[] = [];
  for (const q of queries.slice(0, 2)) {
    try {
      const data = await tavilySearch(q, { maxResults: 8, searchDepth: 'basic', includeAnswer: true });
      const block = formatTavilyEvidence(data, `TAVILY:${q.slice(0, 40)}`);
      if (block) chunks.push(block);
    } catch (e) {
      console.warn('[tavily] lead search failed', q, e);
    }
  }
  return chunks.join('\n\n').slice(0, MAX_EVIDENCE_CHARS);
};

/** 背调：公司域名相关网页证据 */
export const gatherTavilyCompanyEvidence = async (opts: {
  domain: string;
  companyHint?: string;
  searchKeyword?: string;
  searchCountry?: string;
}): Promise<string> => {
  if (!hasTavilyKey()) return '';
  const domain = (opts.domain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  if (!domain) return '';
  const name = (opts.companyHint || domain).trim();
  const kw = (opts.searchKeyword || '').trim();
  const country = (opts.searchCountry || '').trim();

  const queries = [
    `site:${domain} about OR contact OR company`,
    `"${name}" ${country} headquarters OR company`.replace(/\s+/g, ' ').trim(),
  ];
  if (kw) queries.push(`"${name}" ${kw} ${country}`.replace(/\s+/g, ' ').trim());

  const chunks: string[] = [];
  let topUrls: string[] = [];
  for (const q of queries.slice(0, 2)) {
    try {
      const data = await tavilySearch(q, { maxResults: 6, searchDepth: 'basic', includeAnswer: true });
      const block = formatTavilyEvidence(data, `TAVILY:${q.slice(0, 40)}`);
      if (block) chunks.push(block);
      for (const r of data.results || []) {
        if (r.url && /https?:\/\//i.test(r.url) && topUrls.length < 3) {
          if (!topUrls.includes(r.url)) topUrls.push(r.url);
        }
      }
    } catch (e) {
      console.warn('[tavily] company search failed', q, e);
    }
  }

  // 优先抽取官网
  const official = `https://${domain}`;
  if (!topUrls.some((u) => u.includes(domain))) topUrls = [official, ...topUrls].slice(0, 3);
  try {
    const extracted = await tavilyExtract(topUrls);
    const results = extracted?.results || extracted?.data || [];
    if (Array.isArray(results) && results.length) {
      const parts = results
        .map((r: any) => {
          const url = r.url || '';
          const raw = String(r.raw_content || r.content || r.text || '').slice(0, 2500);
          return raw ? `EXTRACT ${url}:\n${raw}` : '';
        })
        .filter(Boolean);
      if (parts.length) chunks.push(`=== TAVILY EXTRACT ===\n${parts.join('\n\n')}\n=== END EXTRACT ===`);
    }
  } catch (e) {
    console.warn('[tavily] extract skipped', e);
  }

  return chunks.join('\n\n').slice(0, MAX_EVIDENCE_CHARS);
};

export const testTavilyApiKey = async (apiKey?: string): Promise<{ success: boolean; message: string }> => {
  const prev = getTavilyApiKey();
  const key = (apiKey || prev || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return { success: false, message: '请先填写 Tavily API Key' };
  try {
    if (apiKey?.trim()) saveTavilyApiKey(key);
    const data = await tavilySearch('trade distributor Poland website', {
      maxResults: 2,
      searchDepth: 'basic',
      includeAnswer: false,
    });
    const n = data.results?.length || 0;
    const sample = data.results?.[0]?.title || data.results?.[0]?.url || '';
    return {
      success: n > 0,
      message: n > 0 ? `Tavily 连接成功 ✅ ${n} 条结果${sample ? ` · ${sample.slice(0, 40)}` : ''}` : 'Tavily 返回空结果',
    };
  } catch (e: any) {
    return { success: false, message: `Tavily 测试失败: ${e?.message || String(e)}` };
  } finally {
    if (apiKey?.trim() && prev && prev !== key) {
      /* keep newly saved key */
    }
  }
};
