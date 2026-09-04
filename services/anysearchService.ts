/**
 * AnySearch — 背调身份补全（search / batch_search / extract）
 * Key：管理后台 → Supabase 加密存储 → 启动时 hydrate 到 localStorage；
 * 请求经同域代理转发，Authorization 仅发往代理/上游，不落日志。
 */
import { getAnysearchApiKey, saveAnysearchApiKey } from './env';
import { isLocalDevHost } from './qwenProxy';
import { getApiConfig, isSupabaseConfigured } from './supabase';
import { buildLeadDiscoveryQueries } from './leadDiscoverySources';

const CLIENT_HEADER = 'trade-pro/1.0';
const TIMEOUT_MS = 40_000;
const MAX_EVIDENCE_CHARS = 12_000;
const MAX_EXTRACT_CHARS = 6_000;
const MAX_SEARCH_CHARS = 4_000;

export type AnysearchQueryItem = {
  query: string;
  domain?: string;
  sub_domain?: string;
  sub_domain_params?: Record<string, string>;
  max_results?: number;
};

const resolveAnysearchUrl = (): string => {
  if (isLocalDevHost()) return '/anysearch-api/mcp';
  return '/api/anysearch';
};

const parseToolText = (json: any): string => {
  if (!json || typeof json !== 'object') return '';
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  const content = json.result?.content;
  if (Array.isArray(content)) {
    const textItem = content.find((c: any) => c?.type === 'text' && c?.text);
    if (textItem?.text) return String(textItem.text);
  }
  if (typeof json.result === 'string') return json.result;
  if (json.result != null) return JSON.stringify(json.result, null, 2);
  return '';
};

const buildAuthHeader = (): Record<string, string> => {
  const key = getAnysearchApiKey().replace(/^Bearer\s+/i, '').trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
};

/** JSON-RPC tools/call */
export const anysearchToolsCall = async (
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveAnysearchUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Anysearch-Client': CLIENT_HEADER,
        ...buildAuthHeader(),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`AnySearch 返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(json.error || json.message || `AnySearch HTTP ${res.status}`);
    }
    return parseToolText(json);
  } finally {
    clearTimeout(timer);
  }
};

export const anysearchSearch = async (
  query: string,
  opts?: { maxResults?: number; domain?: string; subDomain?: string }
): Promise<string> => {
  const args: Record<string, unknown> = {
    query,
    max_results: Math.min(opts?.maxResults ?? 5, 10),
  };
  if (opts?.domain) args.domain = opts.domain;
  if (opts?.subDomain) args.sub_domain = opts.subDomain;
  return anysearchToolsCall('search', args);
};

export const anysearchBatchSearch = async (queries: AnysearchQueryItem[]): Promise<string> => {
  const items = queries.slice(0, 5).map((q) => ({
    ...q,
    max_results: Math.min(q.max_results ?? 5, 10),
  }));
  return anysearchToolsCall('batch_search', { queries: items });
};

export const anysearchExtract = async (url: string): Promise<string> => {
  return anysearchToolsCall('extract', { url });
};

const clip = (s: string, max: number) => {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
};

/**
 * 为背调拉取身份证据：官网抽页 + 并行检索总部线索。
 * 任一失败不影响其它；全部失败返回空字符串。
 */
export const gatherIdentityEvidence = async (
  domain: string,
  opts?: { companyHint?: string; searchCountry?: string }
): Promise<string> => {
  // 确保云端 Key 已同步（线上用户本机可能尚无缓存）
  if (!getAnysearchApiKey().trim() && isSupabaseConfigured()) {
    try {
      const cfg = await getApiConfig('anysearch');
      if (cfg?.apiKey?.trim()) saveAnysearchApiKey(cfg.apiKey.trim());
    } catch (e) {
      console.warn('[AnySearch] cloud key hydrate failed', e);
    }
  }
  if (!getAnysearchApiKey().trim()) {
    console.info('[AnySearch] skip identity evidence: no API key (configure in Admin → cloud)');
    return '';
  }

  const clean = (domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  if (!clean || !clean.includes('.')) return '';

  const site = `https://${clean}`;
  const siteWww = `https://www.${clean}`;
  const nameHint = (opts?.companyHint || clean.split('.')[0] || clean).trim();
  const countryHint = (opts?.searchCountry || '').trim();

  const queries: AnysearchQueryItem[] = [
    {
      query: `${clean} company headquarters address official`,
      max_results: 5,
    },
    {
      query: `${nameHint} ${clean} headquarters city country`,
      max_results: 5,
    },
    {
      query: countryHint
        ? `${nameHint} ${clean} ${countryHint} official company location`
        : `site:${clean} contact OR about OR impressum address`,
      max_results: 5,
    },
  ];

  const parts: string[] = [];

  const [batchRes, homeRes, aboutRes] = await Promise.allSettled([
    anysearchBatchSearch(queries),
    anysearchExtract(siteWww).catch(() => anysearchExtract(site)),
    anysearchExtract(`${siteWww}/about`).catch(() =>
      anysearchExtract(`${site}/about`).catch(() =>
        anysearchExtract(`${siteWww}/contact`).catch(() => anysearchExtract(`${site}/contact`))
      )
    ),
  ]);

  if (batchRes.status === 'fulfilled' && batchRes.value.trim()) {
    parts.push(`## Web search (batch)\n${clip(batchRes.value, MAX_SEARCH_CHARS)}`);
  } else if (batchRes.status === 'rejected') {
    console.warn('[AnySearch] batch_search failed:', batchRes.reason?.message || batchRes.reason);
  }

  if (homeRes.status === 'fulfilled' && homeRes.value.trim()) {
    parts.push(`## Official homepage extract (${siteWww})\n${clip(homeRes.value, MAX_EXTRACT_CHARS)}`);
  } else if (homeRes.status === 'rejected') {
    console.warn('[AnySearch] extract homepage failed:', homeRes.reason?.message || homeRes.reason);
  }

  if (aboutRes.status === 'fulfilled' && aboutRes.value.trim()) {
    parts.push(`## About/Contact extract\n${clip(aboutRes.value, MAX_EXTRACT_CHARS)}`);
  } else if (aboutRes.status === 'rejected') {
    console.warn('[AnySearch] extract about/contact failed:', aboutRes.reason?.message || aboutRes.reason);
  }

  if (!parts.length) return '';

  const evidence = [
    `ANYSEARCH IDENTITY EVIDENCE for domain ${clean} (trust official site extract over third-party snippets; never mix same-name brands in other countries):`,
    ...parts,
  ].join('\n\n');

  return clip(evidence, MAX_EVIDENCE_CHARS);
};

/**
 * 客户搜索补充证据：Tavily 偏少或未配置时，用 AnySearch 拉目录/买家网页摘要。
 * 失败时返回空字符串，不影响主流程。
 */
export const gatherAnysearchLeadEvidence = async (opts: {
  productKeyword: string;
  country?: string;
  industry?: string;
  clientType?: string;
}): Promise<string> => {
  if (!getAnysearchApiKey().trim() && !isSupabaseConfigured()) return '';
  const kw = (opts.productKeyword || '').trim();
  if (!kw) return '';

  try {
    const queries = buildLeadDiscoveryQueries({
      productKeyword: kw,
      country: opts.country,
      industry: opts.industry,
      clientType: opts.clientType,
    })
      .slice(0, 4)
      .map((query) => ({ query, max_results: 6 }));

    if (!queries.length) return '';
    const text = await anysearchBatchSearch(queries);
    if (!text?.trim()) return '';
    console.log('[anysearch] lead evidence chars:', text.length);
    return clip(
      `=== ANYSEARCH LEAD WEB RESULTS ===\n${text.trim()}\n=== END ANYSEARCH ===`,
      MAX_EVIDENCE_CHARS
    );
  } catch (e) {
    console.warn('[anysearch] lead evidence skipped', e);
    return '';
  }
};

/** 管理后台连通性探测（调用前请已把 Key 写入 localStorage / getAnysearchApiKey） */
export const testAnysearchConnection = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    if (!getAnysearchApiKey().trim()) {
      return {
        ok: false,
        message: '未配置 AnySearch API Key。请在管理后台填写并保存到云端。',
      };
    }
    const text = await anysearchSearch('hello world', { maxResults: 1 });
    if (!text.trim()) return { ok: false, message: 'AnySearch 返回空结果' };
    return { ok: true, message: `AnySearch 连通成功 ✅ ${text.slice(0, 80)}` };
  } catch (e: any) {
    return {
      ok: false,
      message: `AnySearch 失败: ${e?.message || String(e)}`,
    };
  }
};
