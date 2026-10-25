/**
 * 自有买家库 / 海关缓存 → 客户搜索优先命中。
 * 前台无独立入口；仅在「客户搜索」按产品关键词检索时注入结果。
 */
import type { ClientSearchResult } from '../types';
import { loadBuyerRecords, type BuyerRecord } from './buyerLibraryTypes';
import { loadCustomsCache, type CustomsShipment } from './customsTypes';

export type InternalLeadSource = 'buyer_library' | 'customs';

const normHost = (website?: string) =>
  (website || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();

const tokensOf = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[\s,，;/|+\-_.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

const blobMatch = (blob: string, tokens: string[]): boolean => {
  if (!tokens.length) return false;
  const b = blob.toLowerCase();
  // 任一 token 命中即可（品类/公司名片段）
  return tokens.some((t) => b.includes(t));
};

const countryOk = (recordCountry: string | undefined, targetCountry: string): boolean => {
  const t = (targetCountry || '').trim().toLowerCase();
  if (!t || t === 'global' || t === 'worldwide' || t === '全球') return true;
  const c = (recordCountry || '').trim().toLowerCase();
  if (!c) return true;
  return c.includes(t) || t.includes(c);
};

/** 按产品关键词检索自有买家库 */
export const searchBuyerLibraryForLeads = (
  productKeyword: string,
  opts: { country?: string; industry?: string; limit?: number } = {}
): BuyerRecord[] => {
  const tokens = [
    ...tokensOf(productKeyword),
    ...tokensOf(opts.industry || ''),
  ];
  const uniq = Array.from(new Set(tokens));
  if (!uniq.length) return [];
  const rows = loadBuyerRecords();
  const hits = rows.filter((r) => {
    if (!countryOk(r.country, opts.country || '')) return false;
    const blob = [r.companyName, r.domain, r.industry, r.country, ...(r.emails || [])].join(' ');
    return blobMatch(blob, uniq);
  });
  return hits.slice(0, opts.limit ?? 40);
};

/** 按产品关键词检索海关本地缓存 */
export const searchCustomsCacheForLeads = (
  productKeyword: string,
  opts: { country?: string; limit?: number } = {}
): CustomsShipment[] => {
  const tokens = tokensOf(productKeyword);
  if (!tokens.length) return [];
  const rows = loadCustomsCache();
  const hits = rows.filter((r) => {
    const market = r.destCountry || r.originCountry || '';
    if (!countryOk(market, opts.country || '')) return false;
    const blob = [
      r.consignee,
      r.shipper,
      r.productDesc,
      r.hsCode,
      r.linkedCompanyName,
      r.originCountry,
      r.destCountry,
    ].join(' ');
    return blobMatch(blob, tokens);
  });
  return hits.slice(0, opts.limit ?? 40);
};

const buyerToLead = (r: BuyerRecord, productKeyword: string): ClientSearchResult => {
  const emails = (r.emails || []).filter(Boolean);
  const phones = (r.phones || []).filter(Boolean);
  const contactBits = [
    emails[0] ? `邮箱 ${emails[0]}` : '',
    phones[0] ? `电话 ${phones[0]}` : '',
  ].filter(Boolean);
  return {
    name: r.companyName,
    website: r.domain || '',
    description: r.industry
      ? `优选线索 · 行业/品类：${r.industry}`
      : '优选线索 · 已匹配产品关键词',
    country: r.country || '',
    clientType: '',
    mainProducts: r.industry || productKeyword,
    estimatedScale: '',
    city: '',
    contactHint: contactBits.join(' · ') || undefined,
    fitScore: 5,
    fitReason: '与搜索目标匹配的优选线索',
    searchKeyword: productKeyword,
    searchCountry: r.country || undefined,
    leadSource: 'buyer_library',
  };
};

const customsToLead = (r: CustomsShipment, productKeyword: string): ClientSearchResult => {
  const name =
    (r.linkedCompanyName || r.consignee || r.shipper || '').trim() || '海关关联企业';
  const market = r.destCountry || r.originCountry || '';
  const contactBits = [
    r.contactEmail ? `邮箱 ${r.contactEmail}` : '',
    r.contactPhone ? `电话 ${r.contactPhone}` : '',
  ].filter(Boolean);
  return {
    name,
    website: '',
    description: r.productDesc
      ? `贸易相关 · ${r.productDesc.slice(0, 120)}`
      : `贸易相关${r.hsCode ? ` · HS ${r.hsCode}` : ''}`,
    country: market,
    clientType: r.consignee ? 'Importer' : 'Exporter',
    mainProducts: r.productDesc || productKeyword,
    estimatedScale: r.weightKg ? `货重约 ${r.weightKg} kg` : '',
    city: '',
    contactHint: contactBits.join(' · ') || undefined,
    fitScore: 5,
    fitReason: `贸易相关线索${r.date ? `（${r.date}）` : ''}`,
    searchKeyword: productKeyword,
    searchCountry: market || undefined,
    leadSource: 'customs',
  };
};

const leadKey = (r: ClientSearchResult) => {
  const host = normHost(r.website);
  if (host) return `h:${host}`;
  return `n:${(r.name || '').toLowerCase().trim()}`;
};

/**
 * 收集与本次产品关键词相关的库内线索（买家库 + 海关），去重后置顶。
 */
export const collectInternalLeads = (opts: {
  productKeyword: string;
  country?: string;
  industry?: string;
  limit?: number;
}): ClientSearchResult[] => {
  const limit = opts.limit ?? 18;
  const kw = (opts.productKeyword || '').trim();
  if (!kw) return [];

  const buyers = searchBuyerLibraryForLeads(kw, {
    country: opts.country,
    industry: opts.industry,
    limit: limit * 2,
  });
  const customs = searchCustomsCacheForLeads(kw, {
    country: opts.country,
    limit: limit * 2,
  });

  const out: ClientSearchResult[] = [];
  const seen = new Set<string>();

  for (const r of buyers.map((b) => buyerToLead(b, kw))) {
    const k = leadKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) return out;
  }
  for (const r of customs.map((c) => customsToLead(c, kw))) {
    const k = leadKey(r);
    if (!k || seen.has(k)) continue;
    // 海关若只有公司名、买家库已有同名，跳过
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) return out;
  }
  return out;
};

/** 合并：库内优先；同域名/同名时保留库内字段并标记来源 */
export const mergeInternalOverOnline = (
  internal: ClientSearchResult[],
  online: ClientSearchResult[],
  limit: number
): ClientSearchResult[] => {
  const map = new Map<string, ClientSearchResult>();
  for (const r of internal) {
    const k = leadKey(r);
    if (!k) continue;
    map.set(k, r);
  }
  for (const r of online) {
    const k = leadKey(r);
    if (!k) continue;
    const existing = map.get(k);
    if (existing?.leadSource === 'buyer_library' || existing?.leadSource === 'customs') {
      // 库内优先：仅用在线结果补空字段
      map.set(k, {
        ...r,
        ...existing,
        website: existing.website || r.website,
        description: existing.description || r.description,
        contactHint: existing.contactHint || r.contactHint,
        mainProducts: existing.mainProducts || r.mainProducts,
        fitScore: Math.max(existing.fitScore || 0, r.fitScore || 0) || existing.fitScore,
        leadSource: existing.leadSource,
        fitReason: existing.fitReason || '与搜索目标匹配的优选线索',
      });
      continue;
    }
    if (!existing) {
      map.set(k, { ...r, leadSource: r.leadSource || 'online' });
    }
  }
  const ranked = Array.from(map.values()).sort((a, b) => {
    const rank = (s?: string) =>
      s === 'buyer_library' ? 0 : s === 'customs' ? 1 : 2;
    const d = rank(a.leadSource) - rank(b.leadSource);
    if (d !== 0) return d;
    return (b.fitScore || 0) - (a.fitScore || 0);
  });
  return ranked.slice(0, limit);
};
