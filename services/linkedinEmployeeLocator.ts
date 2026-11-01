/**
 * 领英员工公开检索 → 决策人占位（姓名/职位/主页），供后续邮箱深挖。
 * 仅用公开网页检索索引，不爬取登录墙后的私密页。
 */
import type { DecisionMaker } from '../types';
import { buildCompanyLinkedInQueries } from './acquisitionMethods';
import { mergeDecisionMakers } from './multiModelMerge';
import { tavilySearch, type TavilySearchResponse } from './tavilyService';

export type LinkedInLocateStats = {
  added: number;
  merged: number;
  queryCount: number;
  resultHits: number;
};

export type LinkedInLocateResult = {
  decisionMakers: DecisionMaker[];
  queries: string[];
  searchedAt: number;
  stats: LinkedInLocateStats;
};

const LI_IN_RE = /https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)\/?/i;

const BUYER_TITLE_RE =
  /\b(purchasing|procurement|buyer|import\s*manager|sourcing|category\s*manager|owner|founder|ceo|director|manager)\b/i;

const cleanDomain = (d?: string) =>
  (d || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

const normalizeLinkedInUrl = (url: string): string | null => {
  const m = url.match(LI_IN_RE);
  if (!m) return null;
  const slug = decodeURIComponent(m[1] || '')
    .replace(/\/+$/, '')
    .trim();
  if (!slug || /^(pub|dir|company|school|jobs|sales|talent)$/i.test(slug)) return null;
  return `https://www.linkedin.com/in/${slug}`;
};

const stripLinkedInNoise = (raw: string) =>
  raw
    .replace(/\|\s*LinkedIn\s*$/i, '')
    .replace(/\s*[-–—]\s*LinkedIn\s*$/i, '')
    .replace(/\s+on LinkedIn\s*$/i, '')
    .trim();

/** 从检索标题解析「姓名 - 职位 - 公司」 */
export const parseLinkedInHitTitle = (
  title: string,
  companyHint?: string
): { name: string; title: string } | null => {
  const cleaned = stripLinkedInNoise(title || '');
  if (!cleaned || cleaned.length < 3) return null;

  const parts = cleaned
    .split(/\s+[-–—|·]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  let name = parts[0];
  let job = '';

  if (parts.length >= 2) {
    job = parts[1];
    // 若第二段像公司名、第三段才是职位，做一次交换启发
    if (parts.length >= 3 && companyHint) {
      const c = companyHint.toLowerCase();
      if (parts[1].toLowerCase().includes(c) && !BUYER_TITLE_RE.test(parts[1])) {
        job = parts[2];
      }
    }
  }

  // 标题偶发「职位 at 公司」无姓名
  if (/^(purchasing|buyer|procurement|manager|director|ceo|owner)\b/i.test(name) && !job) {
    job = name;
    name = '';
  }

  name = name.replace(/\s+/g, ' ').trim();
  job = job.replace(/\s+/g, ' ').trim();

  if (!name && !job) return null;
  if (name.length > 80) name = name.slice(0, 80);
  if (job.length > 120) job = job.slice(0, 120);

  // 拒绝明显非人名的噪声
  if (name && /^(linkedin|profile|search|results?|people)$/i.test(name)) return null;

  return {
    name: name || job || '待确认员工',
    title: job || (BUYER_TITLE_RE.test(name) ? name : '待确认职位'),
  };
};

const classifyType = (title: string): DecisionMaker['type'] => {
  if (/\b(ceo|owner|founder|president|managing\s*director)\b/i.test(title)) return 'CEO';
  if (BUYER_TITLE_RE.test(title)) return 'Buyer';
  return 'Other';
};

const splitName = (full: string): { firstName?: string; lastName?: string } => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const influenceFromTitle = (title: string): number => {
  if (/\b(owner|ceo|founder|president)\b/i.test(title)) return 5;
  if (/\b(purchasing|procurement|buyer|import)\b/i.test(title)) return 4;
  if (/\b(director|vp|head)\b/i.test(title)) return 4;
  return 3;
};

export const decisionMakerFromLinkedInHit = (opts: {
  url: string;
  pageTitle: string;
  snippet?: string;
  companyName?: string;
}): DecisionMaker | null => {
  const linkedin = normalizeLinkedInUrl(opts.url);
  if (!linkedin) return null;
  const parsed = parseLinkedInHitTitle(opts.pageTitle, opts.companyName);
  if (!parsed) return null;

  // 片段里再抠职位
  let title = parsed.title;
  if ((!title || title === '待确认职位') && opts.snippet) {
    const m = opts.snippet.match(
      /\b(Purchasing Manager|Buyer|Procurement|Import Manager|Sourcing Manager|Owner|CEO|Founder)[^.\n|]{0,40}/i
    );
    if (m) title = m[0].trim().slice(0, 80);
  }

  const { firstName, lastName } = splitName(parsed.name);
  return {
    name: parsed.name,
    firstName,
    lastName,
    title: title || '待确认职位',
    linkedin,
    type: classifyType(title || parsed.name),
    source: 'LinkedIn',
    emailStatus: 'unverified',
    isVerified: false,
    influenceScore: influenceFromTitle(title || ''),
  };
};

const collectHitsFromTavily = (
  data: TavilySearchResponse,
  companyName?: string
): DecisionMaker[] => {
  const out: DecisionMaker[] = [];
  for (const r of data.results || []) {
    const url = (r.url || '').trim();
    const title = (r.title || '').trim();
    const content = (r.content || '').trim();
    const dm = decisionMakerFromLinkedInHit({
      url,
      pageTitle: title,
      snippet: content,
      companyName,
    });
    if (dm) out.push(dm);
    // 正文里偶发额外 in/ 链接
    const extra = content.match(/https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/gi) || [];
    for (const u of extra.slice(0, 3)) {
      const extraDm = decisionMakerFromLinkedInHit({
        url: u,
        pageTitle: title || u,
        snippet: content,
        companyName,
      });
      if (extraDm) out.push(extraDm);
    }
  }
  return out;
};

/**
 * 公开检索定位目标公司领英员工，合并进现有决策人列表（占位，可无邮箱）。
 */
export const locateLinkedInEmployees = async (opts: {
  companyName?: string;
  domain?: string;
  productKeyword?: string;
  country?: string;
  existing?: DecisionMaker[];
  maxQueries?: number;
}): Promise<LinkedInLocateResult> => {
  const searchedAt = Date.now();
  const domain = cleanDomain(opts.domain);
  const companyName = (opts.companyName || '').trim();
  const existing = opts.existing || [];
  const queries = buildCompanyLinkedInQueries({
    companyName,
    domain,
    productKeyword: opts.productKeyword,
    country: opts.country,
  }).slice(0, Math.max(1, Math.min(opts.maxQueries ?? 5, 8)));

  const stats: LinkedInLocateStats = {
    added: 0,
    merged: 0,
    queryCount: queries.length,
    resultHits: 0,
  };

  if (!domain && !companyName) {
    return { decisionMakers: existing, queries, searchedAt, stats };
  }

  const found: DecisionMaker[] = [];
  for (const q of queries) {
    try {
      const data = await tavilySearch(q, {
        maxResults: 8,
        searchDepth: 'basic',
        includeAnswer: false,
      });
      const hits = collectHitsFromTavily(data, companyName);
      stats.resultHits += hits.length;
      found.push(...hits);
    } catch (e) {
      console.warn('[linkedin-locate] search failed', q, e);
    }
  }

  const beforeKeys = new Set(
    existing.map((d) => (d.linkedin || d.emailGuess || d.name || '').toLowerCase()).filter(Boolean)
  );
  const merged = mergeDecisionMakers(existing, found);
  for (const d of merged) {
    const k = (d.linkedin || d.emailGuess || d.name || '').toLowerCase();
    if (!k) continue;
    if (beforeKeys.has(k)) stats.merged += 1;
    else if (d.source === 'LinkedIn' || (d.linkedin && /linkedin\.com\/in\//i.test(d.linkedin))) {
      stats.added += 1;
    }
  }

  // 采购相关优先排序
  const ranked = [...merged].sort((a, b) => {
    const score = (d: DecisionMaker) =>
      (d.influenceScore || 0) * 10 +
      (d.emailGuess?.includes('@') ? 5 : 0) +
      (d.linkedin ? 3 : 0) +
      (d.type === 'Buyer' ? 2 : 0) +
      (d.type === 'CEO' ? 1 : 0);
    return score(b) - score(a);
  });

  return {
    decisionMakers: ranked,
    queries,
    searchedAt,
    stats: {
      ...stats,
      added: Math.max(0, ranked.length - existing.length),
      merged: Math.min(existing.length, ranked.length),
    },
  };
};
