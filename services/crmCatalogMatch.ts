/**
 * CRM 存量客户：扫描背调报告中的网站产品/类目/价格，
 * 与阿里玩具类目 + 我方产品库匹配，并按背调关键词打标。
 */
import type { AnalysisResult, Client } from '../types';
import { loadCatalogSkus } from './productCatalogTypes';
import {
  buildProductProfileFromAnalysis,
  matchCatalogSkusToClientProfile,
  type CatalogSkuClientHit,
} from './productCatalog';
import {
  extractClientProductSignals,
  matchClientSignalsToAlibabaCategories,
  suggestToyCategoriesFromKeyword,
  type ClientAlibabaCategoryHit,
} from './toyCategoryMatch';

const PRICE_BANDS: Array<{ key: string; lo: number; hi: number }> = [
  { key: '¥0-10', lo: 0, hi: 10 },
  { key: '¥10-30', lo: 10, hi: 30 },
  { key: '¥30-50', lo: 30, hi: 50 },
  { key: '¥50-100', lo: 50, hi: 100 },
  { key: '¥100+', lo: 100, hi: 1e9 },
];

const parsePrice = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  const n = Number(String(v || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const bandOf = (price: number): string => {
  for (const b of PRICE_BANDS) {
    if (price >= b.lo && price < b.hi) return b.key;
  }
  return '¥100+';
};

export type CrmCatalogMatchReport = {
  productCount: number;
  categoryCounts: Record<string, number>;
  priceBandCounts: Record<string, number>;
  priceMinCny?: number;
  priceMaxCny?: number;
  alibabaHits: ClientAlibabaCategoryHit[];
  skuHits: CatalogSkuClientHit[];
  keywordHits: string[];
  tags: string[];
  note: string;
};

const collectClientKeywords = (client: Client, analysis?: AnalysisResult | null): string[] => {
  const out: string[] = [];
  const push = (s?: string) => {
    const t = (s || '').trim();
    if (t && t.length >= 2 && !/^(crm batch|excel batch|manual|discovery batch|n\/a)$/i.test(t)) {
      out.push(t);
    }
  };
  push(client.searchKeyword);
  for (const k of client.searchedKeywords || []) push(k);
  push(analysis?.searchKeyword);
  for (const t of analysis?.searchTags || []) {
    if (typeof t === 'string' && t.startsWith('关键词:')) push(t.replace(/^关键词:/, ''));
    else push(t);
  }
  push(client.productType);
  return [...new Set(out)].slice(0, 24);
};

const keywordMatchesSignal = (kw: string, signals: string[]): boolean => {
  const k = kw.toLowerCase();
  if (k.length < 2) return false;
  return signals.some((s) => {
    const x = s.toLowerCase();
    return x.includes(k) || k.includes(x) || x.split(/\s+/).some((w) => w.length >= 3 && k.includes(w));
  });
};

/** 从报告 + CRM 字段生成匹配报告与打标 */
export const buildCrmCatalogMatchReport = (
  client: Client,
  analysis?: AnalysisResult | null,
  opts?: { ownerUsername?: string; departmentId?: string; historyId?: string }
): CrmCatalogMatchReport | null => {
  const products = analysis?.products || [];
  const categoryCounts: Record<string, number> = {};
  const priceBandCounts: Record<string, number> = {};
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  for (const p of products) {
    const cat = (p.category || p.name || '').trim() || '未分类';
    if (/公开信息未找到/i.test(cat)) continue;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    const lo =
      parsePrice(p.priceMinCNY) ??
      parsePrice(p.retailPriceCNY) ??
      parsePrice(p.retailPrice) ??
      parsePrice(p.estimatedFOBPriceCNY);
    const hi = parsePrice(p.priceMaxCNY) ?? lo;
    if (lo != null) {
      priceMin = priceMin == null ? lo : Math.min(priceMin, lo);
      priceBandCounts[bandOf(lo)] = (priceBandCounts[bandOf(lo)] || 0) + 1;
    }
    if (hi != null) priceMax = priceMax == null ? hi : Math.max(priceMax, hi);
  }

  // 网站类目也计入
  for (const c of analysis?.websiteCategories || []) {
    const name = typeof c === 'string' ? c : (c as any)?.name || (c as any)?.title || '';
    const cat = String(name || '').trim();
    if (!cat || /公开信息未找到/i.test(cat)) continue;
    if (!categoryCounts[cat]) categoryCounts[cat] = 1;
  }

  const signals = [
    ...extractClientProductSignals(analysis),
    client.productType || '',
    client.industry || '',
    ...Object.keys(categoryCounts),
  ].filter(Boolean);

  if (!signals.length && !products.length && !(client.searchKeyword || '').trim()) {
    return null;
  }

  const alibabaHits = matchClientSignalsToAlibabaCategories(signals, { limit: 10, minScore: 18 });

  let profile = analysis
    ? buildProductProfileFromAnalysis(analysis, {
        historyId: opts?.historyId,
        crmClientId: client.id,
        ownerUsername: opts?.ownerUsername || client.ownerUsername,
        departmentId: opts?.departmentId || client.departmentId,
      })
    : null;

  const skus = loadCatalogSkus();
  const skuHits =
    profile && skus.length
      ? matchCatalogSkusToClientProfile(skus, profile, { limit: 16, minScore: 20 })
      : [];

  const keywords = collectClientKeywords(client, analysis);
  const keywordHits: string[] = [];
  for (const kw of keywords) {
    if (keywordMatchesSignal(kw, signals)) {
      keywordHits.push(kw);
      continue;
    }
    // 关键词本身能落到阿里类目也算匹配
    const sug = suggestToyCategoriesFromKeyword(kw, 1)[0];
    if (sug && sug.score >= 24) keywordHits.push(kw);
  }

  const tags: string[] = [];
  const topCats = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [cat, n] of topCats) {
    tags.push(`站内品类:${cat.slice(0, 24)}${n > 1 ? `×${n}` : ''}`);
  }
  const topBands = Object.entries(priceBandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  for (const [band, n] of topBands) {
    tags.push(`价格带:${band}×${n}`);
  }
  if (priceMin != null && priceMax != null) {
    tags.push(`价格区间:¥${Math.round(priceMin)}-${Math.round(priceMax)}`);
  }
  if (products.length) tags.push(`网站产品:${products.length}`);

  for (const h of alibabaHits.slice(0, 5)) {
    tags.push(`类目:${h.l1.slice(0, 28)}/${h.l2.slice(0, 28)}`);
  }
  for (const h of skuHits.slice(0, 4)) {
    tags.push(`匹配SKU:${(h.sku.skuCode || h.sku.name || '').slice(0, 28)}`);
  }
  if (skuHits.length) tags.push(`产品匹配:${skuHits.length}`);
  for (const kw of keywordHits.slice(0, 5)) {
    tags.push(`关键词匹配:${kw.slice(0, 28)}`);
  }

  const note = [
    products.length ? `网站产品 ${products.length}` : '',
    topCats.length ? `品类 ${topCats.length}` : '',
    topBands.length ? `价格带 ${topBands.map(([b, n]) => `${b}×${n}`).join('/')}` : '',
    alibabaHits.length ? `阿里类目 ${alibabaHits.length}` : '',
    skuHits.length ? `产品库命中 ${skuHits.length}` : '',
    keywordHits.length ? `关键词命中 ${keywordHits.length}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    productCount: products.length,
    categoryCounts,
    priceBandCounts,
    priceMinCny: priceMin,
    priceMaxCny: priceMax,
    alibabaHits,
    skuHits,
    keywordHits,
    tags: [...new Set(tags)].slice(0, 28),
    note: note || '已扫描，信号较弱',
  };
};

export const applyCatalogMatchTagsToClient = (
  client: Client,
  report: CrmCatalogMatchReport
): Client => {
  const prevTags = (client.tags || []).filter(
    (t) =>
      !/^(站内品类:|价格带:|价格区间:|网站产品:|类目:|匹配SKU:|产品匹配:|关键词匹配:)/.test(t)
  );
  return {
    ...client,
    tags: Array.from(new Set([...prevTags, ...report.tags])).slice(0, 80),
    activityLog:
      (client.activityLog || '') +
      `\n[品类全量匹配 ${new Date().toLocaleString('zh-CN')}] ${report.note}` +
      (report.alibabaHits[0]
        ? ` · 首选 ${report.alibabaHits[0].l1}/${report.alibabaHits[0].l2}`
        : ''),
  };
};
