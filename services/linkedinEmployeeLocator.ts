/**
 * 领英员工公开检索 → 决策人占位（姓名/职位/主页），供后续邮箱深挖。
 * 仅用公开网页检索索引，不爬取登录墙后的私密页。
 * 硬规则：命中必须能证明属于「当前目标公司」，禁止把别家采购经理塞进本客户。
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
  rejectedOffCompany: number;
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

const LEGAL_SUFFIX_RE =
  /\b(ltd|llc|inc|gmbh|co|corp|corporation|company|group|sa|bv|oy|ab|pty|limited|plc|ag|srl|spa|kk|co\.?\s*ltd\.?)\b/gi;

const cleanDomain = (d?: string) =>
  (d || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

const normalizeCompanyToken = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const significantCompanyTokens = (company: string): string[] => {
  const stop = new Set([
    'the',
    'and',
    'of',
    'for',
    'toy',
    'toys',
    'store',
    'shop',
    'trading',
    'import',
    'imports',
    'export',
    'exports',
    'international',
    'global',
  ]);
  return normalizeCompanyToken(company)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
};

/** 从「Purchasing Manager at Vamos Toys」类文案抽出雇主名 */
export const extractEmployerFromText = (raw?: string): string | null => {
  const t = (raw || '').trim();
  if (!t) return null;
  const patterns = [
    /\bat\s+([^|·\n,]{2,90}?)(?:\s*[|·,]|\s*[-–—]\s*LinkedIn|\s*$)/i,
    /\b(?:works?\s+at|employed\s+at|currently\s+at)\s+([^|·\n,]{2,90})/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const emp = m[1].replace(/\s+/g, ' ').trim();
      if (emp.length >= 2 && !BUYER_TITLE_RE.test(emp)) return emp;
    }
  }
  return null;
};

export const companiesFuzzyMatch = (a: string, b: string): boolean => {
  const na = normalizeCompanyToken(a);
  const nb = normalizeCompanyToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = significantCompanyTokens(a);
  const tb = significantCompanyTokens(b);
  if (!ta.length || !tb.length) return false;
  // 核心词重叠：短名要求全覆盖，长名要求 ≥2 且过半
  const overlap = ta.filter((t) => tb.some((u) => u === t || u.includes(t) || t.includes(u)));
  if (ta.length === 1 || tb.length === 1) return overlap.length >= 1 && overlap[0].length >= 4;
  const need = Math.min(2, Math.ceil(Math.min(ta.length, tb.length) * 0.5));
  return overlap.length >= need;
};

/**
 * 检索命中是否属于目标公司。
 * - 标题/摘要里若写明「at 别的公司」→ 一律拒绝
 * - strict（新检索）：还要求公司名显著词或域名出现在证据里
 * - lenient（清洗已入库）：无明确串公司证据则保留，避免误删仅有「Purchasing Manager」的本司占位
 */
export const hitBelongsToTargetCompany = (opts: {
  pageTitle?: string;
  snippet?: string;
  jobTitle?: string;
  companyName?: string;
  domain?: string;
  emailGuess?: string;
  mode?: 'strict' | 'lenient';
}): boolean => {
  const mode = opts.mode || 'strict';
  const company = (opts.companyName || '').trim();
  const domain = cleanDomain(opts.domain);
  const blob = `${opts.pageTitle || ''} ${opts.snippet || ''} ${opts.jobTitle || ''}`.toLowerCase();
  const email = (opts.emailGuess || '').trim().toLowerCase();

  if (domain && email.includes('@')) {
    const host = email.split('@')[1] || '';
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }

  const employer =
    extractEmployerFromText(opts.jobTitle) ||
    extractEmployerFromText(opts.pageTitle) ||
    extractEmployerFromText(opts.snippet);

  if (employer && company) {
    if (companiesFuzzyMatch(employer, company)) return true;
    // 明确写了别的雇主 → 拒（两种模式都适用）
    return false;
  }

  if (mode === 'lenient') {
    // 没有「at 别家」字样 → 保留
    return true;
  }

  if (domain && domain.includes('.') && blob.includes(domain)) return true;

  if (company) {
    const normBlob = normalizeCompanyToken(blob);
    const normCo = normalizeCompanyToken(company);
    if (normCo && normBlob.includes(normCo)) return true;
    const tokens = significantCompanyTokens(company);
    if (!tokens.length) return false;
    const hits = tokens.filter((t) => blob.includes(t) || normBlob.includes(t));
    if (tokens.length === 1) return hits.length === 1 && tokens[0].length >= 4;
    return hits.length >= Math.min(2, Math.ceil(tokens.length * 0.5));
  }

  if (domain) {
    const slug = domain.split('.')[0] || '';
    return slug.length >= 4 && blob.includes(slug);
  }

  return false;
};

/** 过滤掉明确属于别家公司的决策人（展示/入库前必跑，默认 lenient） */
export const filterDecisionMakersForCompany = (
  list: DecisionMaker[],
  opts: { companyName?: string; domain?: string; mode?: 'strict' | 'lenient' }
): DecisionMaker[] => {
  const company = (opts.companyName || '').trim();
  const domain = cleanDomain(opts.domain);
  if (!company && !domain) return list;
  const mode = opts.mode || 'lenient';
  return (list || []).filter((d) =>
    hitBelongsToTargetCompany({
      pageTitle: `${d.name || ''} ${d.title || ''}`,
      jobTitle: d.title,
      snippet: [d.department, d.source, d.linkedin].filter(Boolean).join(' '),
      companyName: company,
      domain,
      emailGuess: d.emailGuess,
      mode,
    })
  );
};

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
    if (parts.length >= 3 && companyHint) {
      const c = companyHint.toLowerCase();
      if (parts[1].toLowerCase().includes(c) && !BUYER_TITLE_RE.test(parts[1])) {
        job = parts[2];
      }
    }
  }

  if (/^(purchasing|buyer|procurement|manager|director|ceo|owner)\b/i.test(name) && !job) {
    job = name;
    name = '';
  }

  name = name.replace(/\s+/g, ' ').trim();
  job = job.replace(/\s+/g, ' ').trim();

  if (!name && !job) return null;
  if (name.length > 80) name = name.slice(0, 80);
  if (job.length > 120) job = job.slice(0, 120);

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

/** 职位文案去掉错误的「at 别家公司」；同公司可保留简短岗位名 */
const sanitizeJobTitle = (title: string, companyName?: string): string => {
  let t = (title || '').replace(/\s+/g, ' ').trim();
  const emp = extractEmployerFromText(t);
  if (emp && companyName && !companiesFuzzyMatch(emp, companyName)) {
    t = t.replace(/\s+at\s+.+$/i, '').trim();
  }
  return t.slice(0, 120);
};

export const decisionMakerFromLinkedInHit = (opts: {
  url: string;
  pageTitle: string;
  snippet?: string;
  companyName?: string;
  domain?: string;
}): DecisionMaker | null => {
  const linkedin = normalizeLinkedInUrl(opts.url);
  if (!linkedin) return null;
  const parsed = parseLinkedInHitTitle(opts.pageTitle, opts.companyName);
  if (!parsed) return null;

  let title = parsed.title;
  if ((!title || title === '待确认职位') && opts.snippet) {
    const m = opts.snippet.match(
      /\b(Purchasing Manager|Buyer|Procurement|Import Manager|Sourcing Manager|Owner|CEO|Founder)[^.\n|]{0,40}/i
    );
    if (m) title = m[0].trim().slice(0, 80);
  }

  if (
    !hitBelongsToTargetCompany({
      pageTitle: opts.pageTitle,
      snippet: opts.snippet,
      jobTitle: title,
      companyName: opts.companyName,
      domain: opts.domain,
    })
  ) {
    return null;
  }

  title = sanitizeJobTitle(title, opts.companyName);
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
  companyName?: string,
  domain?: string
): { kept: DecisionMaker[]; rejected: number } => {
  const out: DecisionMaker[] = [];
  let rejected = 0;
  for (const r of data.results || []) {
    const url = (r.url || '').trim();
    const title = (r.title || '').trim();
    const content = (r.content || '').trim();
    const dm = decisionMakerFromLinkedInHit({
      url,
      pageTitle: title,
      snippet: content,
      companyName,
      domain,
    });
    if (dm) out.push(dm);
    else if (normalizeLinkedInUrl(url)) rejected += 1;

    const extra = content.match(/https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/gi) || [];
    for (const u of extra.slice(0, 3)) {
      const extraDm = decisionMakerFromLinkedInHit({
        url: u,
        pageTitle: title || u,
        snippet: content,
        companyName,
        domain,
      });
      if (extraDm) out.push(extraDm);
      else rejected += 1;
    }
  }
  return { kept: out, rejected };
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
  const existing = filterDecisionMakersForCompany(opts.existing || [], {
    companyName,
    domain,
  });
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
    rejectedOffCompany: 0,
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
      const { kept, rejected } = collectHitsFromTavily(data, companyName, domain);
      stats.resultHits += kept.length;
      stats.rejectedOffCompany += rejected;
      found.push(...kept);
    } catch (e) {
      console.warn('[linkedin-locate] search failed', q, e);
    }
  }

  const beforeKeys = new Set(
    existing.map((d) => (d.linkedin || d.emailGuess || d.name || '').toLowerCase()).filter(Boolean)
  );
  const merged = filterDecisionMakersForCompany(mergeDecisionMakers(existing, found), {
    companyName,
    domain,
  });
  for (const d of merged) {
    const k = (d.linkedin || d.emailGuess || d.name || '').toLowerCase();
    if (!k) continue;
    if (beforeKeys.has(k)) stats.merged += 1;
    else if (d.source === 'LinkedIn' || (d.linkedin && /linkedin\.com\/in\//i.test(d.linkedin))) {
      stats.added += 1;
    }
  }

  const ranked = [...merged].sort((a, b) => {
    const score = (d: DecisionMaker) =>
      (d.influenceScore || 0) * 10 +
      (d.emailGuess?.includes('@') ? 5 : 0) +
      (d.linkedin ? 3 : 0) +
      (d.type === 'Buyer' ? 2 : 0) +
      (d.type === 'CEO' ? 1 : 0);
    return score(b) - score(a);
  });

  if (stats.rejectedOffCompany > 0) {
    console.info(
      `[linkedin-locate] rejected ${stats.rejectedOffCompany} off-company hits for ${companyName || domain}`
    );
  }

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
