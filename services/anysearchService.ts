/**
 * AnySearch — 背调身份补全（search / batch_search / extract）
 * Key 优先由服务端代理注入（ANYSEARCH_API_KEY）；失败时软降级，不阻断背调。
 */
import { isLocalDevHost } from './qwenProxy';

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

/** 管理后台连通性探测 */
export const testAnysearchConnection = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    const text = await anysearchSearch('hello world', { maxResults: 1 });
    if (!text.trim()) return { ok: false, message: 'AnySearch 返回空结果' };
    return { ok: true, message: `AnySearch 连通成功 ✅ ${text.slice(0, 80)}` };
  } catch (e: any) {
    return {
      ok: false,
      message: `AnySearch 失败: ${e?.message || String(e)}（请确认 ANYSEARCH_API_KEY 与 /api/anysearch 代理）`,
    };
  }
};
