/**
 * 产品库入库后：按官方类目自动匹配已背调/已爬取产品的客户，并分级（重点一对一 vs EDM 测品）
 */
import type { Client } from '../types';
import type { CustomerProductProfile } from '../types';
import { loadProductCatalog, matchOurProductToProfiles } from './productCatalog';
import { loadCatalogSkus, skuHasOfficialTaxonomy, type CatalogSku } from './productCatalogTypes';
import { matchCrmClientsForProduct, type GtmProductInput } from './gtmExpertService';
import type { GtmClientMatch, GtmMarketBrief } from './gtmExpertStore';
import { formatTaxonomyLabel } from '../data/productTaxonomy';
import { gradeOutreachChannel, type OutreachChannel } from './outreachGrade';

export type { OutreachChannel };
export { gradeOutreachChannel, attachOutreachGrades } from './outreachGrade';

export type CatalogAutoMatchHit = GtmClientMatch & {
  channel: OutreachChannel;
  gradeReasons: string[];
  outreachAdvice: string;
  skuCodes: string[];
};

export type CatalogAutoMatchReport = {
  at: number;
  skuCount: number;
  skippedNoTaxonomy: number;
  matchCount: number;
  priorityCount: number;
  edmCount: number;
  hits: CatalogAutoMatchHit[];
};

const LS_REPORT = 'trade_scout_catalog_auto_match_v1';

const stubMarket = (category?: string): GtmMarketBrief => ({
  productName: category || 'catalog',
  categories: category ? [category] : [],
  countries: [],
  trends: [],
  risks: [],
  designImplications: [],
});

const enrichFromProfile = (
  m: GtmClientMatch,
  profiles: CustomerProductProfile[]
): { volumeSignal?: string; catalogQuality?: number; revenueHint?: string } => {
  const hit = profiles.find(
    (p) =>
      (m.historyId && p.historyId === m.historyId) ||
      (m.clientId && p.crmClientId === m.clientId) ||
      (p.website && m.website && p.website.toLowerCase() === m.website.toLowerCase()) ||
      (p.companyName.toLowerCase() === (m.companyName || '').toLowerCase())
  );
  return {
    volumeSignal: hit?.volumeSignal,
    catalogQuality: hit?.catalogQuality,
    revenueHint: hit?.priceMaxCny != null ? `参考价带至 ¥${hit.priceMaxCny}` : undefined,
  };
};

const mergeByCompany = (hits: CatalogAutoMatchHit[]): CatalogAutoMatchHit[] => {
  const map = new Map<string, CatalogAutoMatchHit>();
  for (const h of hits) {
    const key = `${(h.website || '').toLowerCase()}|${h.companyName.toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, h);
      continue;
    }
    const score = Math.min(99, Math.max(prev.score, h.score) + 4);
    const channel: OutreachChannel =
      prev.channel === 'priority_1to1' || h.channel === 'priority_1to1'
        ? 'priority_1to1'
        : 'edm_test';
    map.set(key, {
      ...prev,
      ...h,
      score,
      channel,
      source: prev.source === h.source ? prev.source : 'both',
      reasons: [...new Set([...prev.reasons, ...h.reasons])].slice(0, 8),
      gradeReasons: [...new Set([...prev.gradeReasons, ...h.gradeReasons])].slice(0, 6),
      outreachAdvice:
        channel === 'priority_1to1'
          ? '建议一对一精准开发：结合背调报告定制开发信与样品方案，优先人工跟进。'
          : prev.outreachAdvice,
      skuCodes: [...new Set([...prev.skuCodes, ...h.skuCodes])],
      mailGroup: prev.mailGroup || h.mailGroup,
    });
  }
  return [...map.values()].sort((a, b) => {
    if (a.channel !== b.channel) return a.channel === 'priority_1to1' ? -1 : 1;
    return b.score - a.score;
  });
};

/** 对已挂官方类目的 SKU 批量匹配已背调客户 */
export const runCatalogSkusAutoMatch = async (
  skus: CatalogSku[],
  crmClients: Client[]
): Promise<CatalogAutoMatchReport> => {
  const withTax = skus.filter(skuHasOfficialTaxonomy);
  const skippedNoTaxonomy = skus.length - withTax.length;
  const profiles = await loadProductCatalog();
  const usableProfiles = profiles
    .filter(
      (p) =>
        (p.catalogQuality ?? 0) >= 8 &&
        ((p.categoryIds || []).length > 0 ||
          (p.sellCategoryIds || []).length > 0 ||
          (p.procureCategoryIds || []).length > 0 ||
          (p.categories || []).length > 0 ||
          (p.skus || []).length > 0)
    )
    .sort((a, b) => (b.catalogQuality || 0) - (a.catalogQuality || 0))
    .slice(0, 900);

  const raw: CatalogAutoMatchHit[] = [];

  for (const sku of withTax.slice(0, 80)) {
    const category =
      sku.category || formatTaxonomyLabel(sku.categoryL2Id || sku.categoryL1Id) || sku.name;
    const categoryIds =
      sku.categoryIds?.length
        ? sku.categoryIds
        : ([sku.categoryRootId, sku.categoryL1Id, sku.categoryL2Id].filter(Boolean) as string[]);
    const input: GtmProductInput = {
      productName: sku.name,
      category,
      categoryIds,
      skuCode: sku.skuCode,
      priceBand:
        sku.factoryPrice != null
          ? `${sku.factoryPrice} ${sku.currency || 'USD'}`
          : undefined,
      packagingHints: sku.packing ? [sku.packing] : undefined,
      colorHints: sku.colors
        ? sku.colors
            .split(/[/／,，、]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    };
    const market = stubMarket(category);

    const profileHits = matchOurProductToProfiles(
      {
        name: sku.name,
        category,
        categoryIds,
        packagingHints: input.packagingHints,
        colorHints: input.colorHints,
        notes: sku.specs,
      },
      usableProfiles
    ).map(
      (h): GtmClientMatch => ({
        clientId: h.profile.crmClientId,
        companyName: h.profile.companyName,
        country: h.profile.country || '—',
        website: h.profile.website,
        score: h.score,
        reasons: h.reasons,
        source: 'product_profile',
        historyId: h.profile.historyId,
        productType: (h.matchedCategories || []).slice(0, 2).join(' / '),
      })
    );

    const crmHits = matchCrmClientsForProduct(input, market, crmClients);

    for (const m of [...profileHits, ...crmHits]) {
      const enrich = enrichFromProfile(m, usableProfiles);
      const crm = crmClients.find((c) => c.id === m.clientId);
      const graded = gradeOutreachChannel({
        score: m.score,
        reasons: m.reasons,
        companyName: m.companyName,
        country: m.country,
        volumeSignal: enrich.volumeSignal,
        estimatedScale: crm?.priceRange,
        revenueEstimate: enrich.revenueHint,
        catalogQuality: enrich.catalogQuality,
        priceRange: crm?.priceRange,
        tags: crm?.tags,
      });
      raw.push({
        ...m,
        channel: graded.channel,
        gradeReasons: graded.gradeReasons,
        outreachAdvice: graded.outreachAdvice,
        skuCodes: [sku.skuCode],
      });
    }
  }

  const hits = mergeByCompany(raw).slice(0, 60);
  const report: CatalogAutoMatchReport = {
    at: Date.now(),
    skuCount: withTax.length,
    skippedNoTaxonomy,
    matchCount: hits.length,
    priorityCount: hits.filter((h) => h.channel === 'priority_1to1').length,
    edmCount: hits.filter((h) => h.channel === 'edm_test').length,
    hits,
  };
  saveCatalogAutoMatchReport(report);
  return report;
};

/** 对整库中「有类目」的 SKU 跑一轮 */
export const runAutoMatchForRecentCatalog = async (
  crmClients: Client[],
  opts?: { onlySkuCodes?: string[] }
): Promise<CatalogAutoMatchReport> => {
  const all = loadCatalogSkus();
  const skus = opts?.onlySkuCodes?.length
    ? all.filter((s) => opts.onlySkuCodes!.includes(s.skuCode))
    : all.filter(skuHasOfficialTaxonomy).slice(0, 80);
  return runCatalogSkusAutoMatch(skus, crmClients);
};

export const saveCatalogAutoMatchReport = (report: CatalogAutoMatchReport) => {
  try {
    localStorage.setItem(
      LS_REPORT,
      JSON.stringify({ ...report, hits: report.hits.slice(0, 60) })
    );
  } catch {
    /* ignore quota */
  }
};

export const loadCatalogAutoMatchReport = (): CatalogAutoMatchReport | null => {
  try {
    const raw = localStorage.getItem(LS_REPORT);
    if (!raw) return null;
    const p = JSON.parse(raw) as CatalogAutoMatchReport;
    if (!p?.at || !Array.isArray(p.hits)) return null;
    return p;
  } catch {
    return null;
  }
};
