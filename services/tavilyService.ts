/**
 * Tavily — 多 Key 池联网搜索 / 网页提取
 * - 管理后台可添加多把 tvly Key（各账号月额度独立）
 * - 某把触发额度/付费限制时自动标记本月耗尽并切下一把
 * - 全部耗尽后返回空证据，由上层回退千问联网
 */
import { getTavilyApiKeys, saveTavilyApiKeys, getTavilyApiKey } from './env';
import { isLocalDevHost } from './qwenProxy';
import { getApiConfig, isSupabaseConfigured } from './supabase';
import { buildLeadDiscoveryQueries } from './leadDiscoverySources';

const TIMEOUT_MS = 40_000;
const MAX_EVIDENCE_CHARS = 14_000;
/** 客户搜索证据可稍长，便于目录站多公司抽取 */
const MAX_LEAD_EVIDENCE_CHARS = 18_000;
const LS_EXHAUSTED = 'trade_scout_tavily_exhausted';
const LS_ACTIVE_IDX = 'trade_scout_tavily_active_idx';

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

export type TavilyKeyStatus = {
  key: string;
  label: string;
  exhausted: boolean;
  active: boolean;
};

const monthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const maskKey = (key: string): string => {
  const k = (key || '').trim();
  if (k.length <= 10) return '••••';
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
};

const resolveTavilyUrl = (upstreamPath: string): string => {
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  if (isLocalDevHost()) return `/tavily-api${path}`;
  return `/api/tavily?__upstream=${encodeURIComponent(path)}`;
};

type ExhaustedMap = { month: string; keys: string[] };

const readExhausted = (): Set<string> => {
  try {
    const raw = localStorage.getItem(LS_EXHAUSTED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as ExhaustedMap;
    if (parsed.month !== monthKey()) {
      localStorage.removeItem(LS_EXHAUSTED);
      return new Set();
    }
    return new Set((parsed.keys || []).map((k) => k.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeExhausted = (set: Set<string>) => {
  if (typeof localStorage === 'undefined') return;
  const payload: ExhaustedMap = { month: monthKey(), keys: [...set] };
  localStorage.setItem(LS_EXHAUSTED, JSON.stringify(payload));
};

export const markTavilyKeyExhausted = (key: string) => {
  const k = (key || '').replace(/^Bearer\s+/i, '').trim();
  if (!k) return;
  const set = readExhausted();
  set.add(k);
  writeExhausted(set);
  console.warn('[tavily] key exhausted this month:', maskKey(k));
};

export const clearTavilyExhausted = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LS_EXHAUSTED);
};

export const isQuotaExhaustedError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /402|429|payment|quota|credit|limit|insufficient|exceeded|usage|余额|额度|用尽|耗尽/i.test(msg);
};

/** 规范化后的全部 Key（去重） */
export const listTavilyKeys = (): string[] => {
  const fromPool = getTavilyApiKeys();
  const legacy = getTavilyApiKey().trim();
  const merged = [...fromPool];
  if (legacy && !merged.includes(legacy)) merged.unshift(legacy);
  return [...new Set(merged.map((k) => k.replace(/^Bearer\s+/i, '').trim()).filter(Boolean))];
};

export const getUsableTavilyKeys = (): string[] => {
  const exhausted = readExhausted();
  return listTavilyKeys().filter((k) => !exhausted.has(k));
};

export const hasTavilyKey = (): boolean => getUsableTavilyKeys().length > 0;

export const getTavilyKeyStatuses = (): TavilyKeyStatus[] => {
  const all = listTavilyKeys();
  const exhausted = readExhausted();
  const usable = getUsableTavilyKeys();
  const active = usable[0] || '';
  return all.map((key) => ({
    key,
    label: maskKey(key),
    exhausted: exhausted.has(key),
    active: key === active,
  }));
};

export const setTavilyKeyPool = (keys: string[]) => {
  const cleaned = [
    ...new Set(keys.map((k) => k.replace(/^Bearer\s+/i, '').trim()).filter(Boolean)),
  ];
  saveTavilyApiKeys(cleaned);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_ACTIVE_IDX, '0');
  }
};

export const hydrateTavilyKeyFromCloud = async (): Promise<void> => {
  if (!isSupabaseConfigured()) return;
  try {
    const cloud = await getApiConfig('tavily');
    if (!cloud?.apiKey?.trim()) return;
    const raw = cloud.apiKey.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setTavilyKeyPool(parsed.map(String));
        return;
      }
    } catch {
      /* single key string */
    }
    setTavilyKeyPool([raw]);
  } catch {
    /* ignore */
  }
};

const tavilyPostWithKey = async <T = any>(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs = TIMEOUT_MS
): Promise<T> => {
  const key = apiKey.replace(/^Bearer\s+/i, '').trim();
  if (!key) throw new Error('未配置 Tavily API Key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveTavilyUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
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
      const detail = json.error || json.detail || json.message || `Tavily HTTP ${res.status}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 带 Key 池轮换的请求：当前 Key 额度用尽则标记并换下一把。
 * 全部用尽时抛出 TAVILY_POOL_EXHAUSTED。
 */
const tavilyPost = async <T = any>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS
): Promise<T> => {
  const keys = getUsableTavilyKeys();
  if (!keys.length) {
    throw new Error('TAVILY_POOL_EXHAUSTED');
  }

  let lastErr: unknown;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const result = await tavilyPostWithKey<T>(path, body, key, timeoutMs);
      // 成功则把该 Key 记为当前首选（移到列表前）
      if (i > 0) {
        const all = listTavilyKeys();
        const rest = all.filter((k) => k !== key);
        setTavilyKeyPool([key, ...rest]);
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (isQuotaExhaustedError(e)) {
        markTavilyKeyExhausted(key);
        console.warn(`[tavily] rotate after quota on ${maskKey(key)}`);
        continue;
      }
      // 非额度错误：也尝试下一把（防单 Key 临时故障），但不标记耗尽
      console.warn(`[tavily] key ${maskKey(key)} failed, try next:`, (e as any)?.message || e);
      continue;
    }
  }

  if (!getUsableTavilyKeys().length) {
    throw new Error('TAVILY_POOL_EXHAUSTED');
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Tavily 全部 Key 调用失败'));
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

export const gatherTavilyLeadEvidence = async (opts: {
  productKeyword: string;
  country: string;
  industry?: string;
  clientType?: string;
}): Promise<string> => {
  if (!hasTavilyKey()) return '';
  const kw = (opts.productKeyword || '').trim();
  if (!kw) return '';

  // 多源查询：开放网页 + 目录站 + 展会（控制次数，避免打爆额度）
  const allQueries = buildLeadDiscoveryQueries({
    productKeyword: kw,
    country: opts.country,
    industry: opts.industry,
    clientType: opts.clientType,
  });
  // 优先跑前 4 条；若证据偏少再补 1 条
  const primary = allQueries.slice(0, 4);
  const backup = allQueries.slice(4, 5);

  const chunks: string[] = [];
  const runQuery = async (q: string) => {
    const data = await tavilySearch(q, {
      maxResults: 10,
      searchDepth: 'basic',
      includeAnswer: true,
    });
    const block = formatTavilyEvidence(data, `TAVILY:${q.slice(0, 48)}`);
    if (block) chunks.push(block);
  };

  for (const q of primary) {
    try {
      await runQuery(q);
    } catch (e) {
      if (String((e as any)?.message || e).includes('TAVILY_POOL_EXHAUSTED')) {
        console.warn('[tavily] pool exhausted, fall back to Qwen web search');
        return chunks.join('\n\n').slice(0, MAX_LEAD_EVIDENCE_CHARS);
      }
      console.warn('[tavily] lead search failed', q, e);
    }
  }

  const joinedLen = chunks.join('\n\n').length;
  if (joinedLen < 2200 && backup.length) {
    for (const q of backup) {
      try {
        await runQuery(q);
      } catch (e) {
        if (String((e as any)?.message || e).includes('TAVILY_POOL_EXHAUSTED')) break;
        console.warn('[tavily] lead backup search failed', q, e);
      }
    }
  }

  console.log(
    `[tavily] lead evidence queries=${primary.length + (joinedLen < 2200 ? backup.length : 0)} chunks=${chunks.length} chars≈${chunks.join('\n\n').length}`
  );
  return chunks.join('\n\n').slice(0, MAX_LEAD_EVIDENCE_CHARS);
};

export type TavilyCompanyEvidenceBundle = {
  text: string;
  items: Array<{ title: string; url: string; snippet?: string; score?: number }>;
};

export const gatherTavilyCompanyEvidence = async (opts: {
  domain: string;
  companyHint?: string;
  searchKeyword?: string;
  searchCountry?: string;
}): Promise<string> => {
  const bundle = await gatherTavilyCompanyEvidenceBundle(opts);
  return bundle.text;
};

/** 带结构化链接的公司证据（供背调证据链） */
export const gatherTavilyCompanyEvidenceBundle = async (opts: {
  domain: string;
  companyHint?: string;
  searchKeyword?: string;
  searchCountry?: string;
}): Promise<TavilyCompanyEvidenceBundle> => {
  if (!hasTavilyKey()) return { text: '', items: [] };
  const domain = (opts.domain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  if (!domain) return { text: '', items: [] };
  const name = (opts.companyHint || domain).trim();
  const kw = (opts.searchKeyword || '').trim();
  const country = (opts.searchCountry || '').trim();

  const queries = [
    // 优先全站品类/目录/商城页（先全量，再关键词）
    `site:${domain} (shop OR products OR catalog OR collections OR category OR categories OR 产品 OR 目录 OR 分类)`,
    `site:${domain} (menu OR departments OR browse OR buy OR store OR wholesale OR price OR 价格)`,
    `site:${domain} about OR contact OR company`,
    `"${name}" ${country} (product range OR catalog OR assortment OR wholesale OR import OR distributor)`.replace(/\s+/g, ' ').trim(),
  ];
  if (kw) {
    // 关键词查询仅作补充匹配，不替代全站品类采集
    queries.push(`site:${domain} ${kw} (price OR shop OR product OR catalog OR buy)`);
    queries.push(`"${name}" ${kw} ${country}`.replace(/\s+/g, ' ').trim());
  }

  const chunks: string[] = [];
  const items: TavilyCompanyEvidenceBundle['items'] = [];
  const seenUrls = new Set<string>();
  let topUrls: string[] = [];
  for (const q of queries.slice(0, 5)) {
    try {
      const data = await tavilySearch(q, { maxResults: 6, searchDepth: 'basic', includeAnswer: true });
      const block = formatTavilyEvidence(data, `TAVILY:${q.slice(0, 40)}`);
      if (block) chunks.push(block);
      for (const r of data.results || []) {
        const url = (r.url || '').trim();
        if (url && /https?:\/\//i.test(url) && !seenUrls.has(url)) {
          seenUrls.add(url);
          items.push({
            title: (r.title || '').trim() || url,
            url,
            snippet: (r.content || '').trim().slice(0, 180),
            score: typeof r.score === 'number' ? r.score : undefined,
          });
        }
        if (url && /https?:\/\//i.test(url) && topUrls.length < 3) {
          if (!topUrls.includes(url)) topUrls.push(url);
        }
      }
    } catch (e) {
      if (String((e as any)?.message || e).includes('TAVILY_POOL_EXHAUSTED')) {
        console.warn('[tavily] pool exhausted, fall back to Qwen web search');
        return { text: '', items: [] };
      }
      console.warn('[tavily] company search failed', q, e);
    }
  }

  const official = `https://${domain}`;
  // 优先抽取商品相关路径
  const productPathHints = [
    '/shop',
    '/products',
    '/catalog',
    '/collections',
    '/product',
    '/store',
    '/buy',
    '/category',
    '/categories',
    '/department',
  ];
  const productish = [...seenUrls].filter((u) =>
    productPathHints.some((h) => u.toLowerCase().includes(h))
  );
  topUrls = [...new Set([official, ...productish, ...topUrls])].slice(0, 6);
  if (!seenUrls.has(official)) {
    seenUrls.add(official);
    items.unshift({ title: `官方网站 ${domain}`, url: official });
  }
  try {
    const extracted = await tavilyExtract(topUrls);
    const results = extracted?.results || extracted?.data || [];
    if (Array.isArray(results) && results.length) {
      const parts = results
        .map((r: any) => {
          const url = r.url || '';
          const raw = String(r.raw_content || r.content || r.text || '').slice(0, 3200);
          return raw ? `EXTRACT ${url}:\n${raw}` : '';
        })
        .filter(Boolean);
      if (parts.length) chunks.push(`=== TAVILY EXTRACT (prefer product/catalog pages) ===\n${parts.join('\n\n')}\n=== END EXTRACT ===`);
    }
  } catch (e) {
    if (String((e as any)?.message || e).includes('TAVILY_POOL_EXHAUSTED')) {
      return { text: chunks.join('\n\n').slice(0, MAX_EVIDENCE_CHARS), items };
    }
    console.warn('[tavily] extract skipped', e);
  }

  return { text: chunks.join('\n\n').slice(0, MAX_EVIDENCE_CHARS), items };
};

/** 测试单把 Key（不写入耗尽状态以外的池顺序） */
export const testTavilyApiKey = async (apiKey?: string): Promise<{ success: boolean; message: string }> => {
  const key = (apiKey || getUsableTavilyKeys()[0] || getTavilyApiKey() || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!key) return { success: false, message: '请先填写 Tavily API Key' };
  try {
    const data = await tavilyPostWithKey<TavilySearchResponse>(
      '/search',
      {
        query: 'trade distributor Poland website',
        search_depth: 'basic',
        max_results: 2,
        include_answer: false,
      },
      key
    );
    const n = data.results?.length || 0;
    const sample = data.results?.[0]?.title || data.results?.[0]?.url || '';
    return {
      success: n > 0,
      message: n > 0
        ? `Tavily 连接成功 ✅ ${maskKey(key)} · ${n} 条${sample ? ` · ${String(sample).slice(0, 36)}` : ''}`
        : 'Tavily 返回空结果',
    };
  } catch (e: any) {
    if (isQuotaExhaustedError(e)) {
      markTavilyKeyExhausted(key);
      return { success: false, message: `Key 额度已用尽（已标记本月跳过）: ${maskKey(key)}` };
    }
    return { success: false, message: `Tavily 测试失败: ${e?.message || String(e)}` };
  }
};

export const testTavilyKeyPool = async (): Promise<{ success: boolean; message: string }> => {
  const all = listTavilyKeys();
  if (!all.length) return { success: false, message: '请先添加至少一把 Tavily Key' };
  const lines: string[] = [];
  let ok = 0;
  for (const key of all) {
    const r = await testTavilyApiKey(key);
    if (r.success) ok += 1;
    lines.push(`${maskKey(key)}: ${r.success ? '✓' : '✗'} ${r.message.replace(/^Tavily[^:]*[:：]?\s*/, '').slice(0, 60)}`);
  }
  const usable = getUsableTavilyKeys().length;
  return {
    success: ok > 0,
    message: `池内 ${all.length} 把 · 可用 ${usable} · 成功 ${ok}\n${lines.join('\n')}`,
  };
};
