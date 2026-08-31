/**
 * 客户产品画像库：从背调报告抽取品类/价格 → 入库 → 新品反查匹配
 */
import type {
  AnalysisResult,
  CustomerProductProfile,
  CustomerProductSku,
  HistoryItem,
  OurProductMatchQuery,
  ProductMatchHit,
} from '../types';
import { INDUSTRY_OPTIONS } from '../data/industries';
import {
  deleteProductProfile,
  getProductProfiles,
  saveProductProfile,
  saveProductProfilesBulk,
} from './db';
import {
  deleteProductProfileCloud,
  saveProductProfileCloud,
  syncProductProfilesCloud,
} from './supabase';

const domainKey = (raw?: string) =>
  (raw || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

/** 常见玩具/消费品同义词 → 标准品类（中文标签） */
const CATEGORY_ALIASES: Array<{ keys: string[]; label: string }> = [
  { keys: ['diecast', '合金车', '合金小车', '金属车', 'toy car', 'car toy', 'pull back', '回力车'], label: '合金/回力车玩具' },
  { keys: ['rc car', 'remote control', '遥控车', '遥控玩具'], label: '遥控玩具' },
  { keys: ['plush', '软玩具', '毛绒', 'stuffed'], label: '毛绒玩具' },
  { keys: ['educational toy', '益智', 'stem toy', 'learning toy'], label: '益智教育玩具' },
  { keys: ['bubble', '泡泡'], label: '泡泡 / 派对玩具' },
  { keys: ['party favor', '派对礼品', 'party supply'], label: '派对用品' },
  { keys: ['outdoor play', '户外游乐', 'playground'], label: '户外游乐设施' },
  { keys: ['baby', 'infant', '母婴', 'nursery', '喂养'], label: '母婴用品' },
  { keys: ['stationery', '文具'], label: '文具办公用品' },
  { keys: ['kitchen', '厨具', 'tableware', '餐具'], label: '厨具餐具' },
  { keys: ['pet', '宠物'], label: '宠物用品' },
  { keys: ['toy', '玩具', 'games'], label: '玩具与游戏' },
];

const normalizeText = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/+&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeCategoryLabel = (raw?: string): string => {
  const t = (raw || '').trim();
  if (!t || /^(n\/?a|未知|公开信息未找到|none|null)$/i.test(t)) return '';
  const low = normalizeText(t);

  for (const a of CATEGORY_ALIASES) {
    if (a.keys.some((k) => low.includes(normalizeText(k)))) return a.label;
  }

  for (const opt of INDUSTRY_OPTIONS) {
    const en = normalizeText(opt.en);
    const zh = normalizeText(opt.zh);
    if ((en && low.includes(en)) || (zh && (low.includes(zh) || zh.includes(low)))) {
      return opt.zh;
    }
  }

  // 截断过长自由文本
  return t.length > 48 ? `${t.slice(0, 46)}…` : t;
};

const parseMoney = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
    }
  }
  return undefined;
};

const skuId = (companyKey: string, name: string, idx: number) =>
  `${companyKey}__${idx}_${normalizeText(name).slice(0, 24).replace(/\s+/g, '_') || 'sku'}`;

/** 从背调报告抽取客户产品画像 */
export const buildProductProfileFromAnalysis = (
  analysis: AnalysisResult,
  meta?: {
    historyId?: string;
    crmClientId?: string;
    ownerUsername?: string;
    departmentId?: string;
  }
): CustomerProductProfile | null => {
  const website = domainKey(analysis.companyInfo?.website) || domainKey(meta?.historyId);
  const companyName = (analysis.companyInfo?.name || website || '').trim();
  if (!website && !companyName) return null;

  const id = website || `name:${normalizeText(companyName).replace(/\s+/g, '_')}`;
  const skus: CustomerProductSku[] = [];
  const categorySet = new Set<string>();
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  const bumpPrice = (lo?: number, hi?: number) => {
    if (lo != null && lo > 0) priceMin = priceMin == null ? lo : Math.min(priceMin, lo);
    if (hi != null && hi > 0) priceMax = priceMax == null ? hi : Math.max(priceMax, hi);
  };

  const pushCat = (
    raw?: string,
    source: CustomerProductSku['source'] = 'category',
    price?: { min?: number; max?: number }
  ) => {
    const cat = normalizeCategoryLabel(raw);
    if (!cat) return;
    categorySet.add(cat);
    bumpPrice(price?.min, price?.max);
    const existing = skus.find((s) => s.source === source && s.category === cat && s.name === cat);
    if (existing) {
      if (price?.min != null && (existing.priceMinCny == null || price.min < existing.priceMinCny)) {
        existing.priceMinCny = price.min;
      }
      if (price?.max != null && (existing.priceMaxCny == null || price.max > existing.priceMaxCny)) {
        existing.priceMaxCny = price.max;
      }
      return;
    }
    skus.push({
      id: skuId(id, cat, skus.length),
      name: cat,
      category: cat,
      categoryRaw: raw,
      priceMinCny: price?.min,
      priceMaxCny: price?.max,
      source,
    });
  };

  (analysis.products || []).forEach((p, idx) => {
    const name = (p.name || '').trim();
    if (!name || /公开信息未找到/i.test(name)) return;
    const cat = normalizeCategoryLabel(p.category) || normalizeCategoryLabel(name) || '未分类产品';
    categorySet.add(cat);
    const retail = parseMoney(p.retailPriceCNY) ?? parseMoney(p.retailPrice);
    const fob = parseMoney(p.estimatedFOBPriceCNY);
    const lo = parseMoney(p.priceMinCNY) ?? (retail != null && fob != null ? Math.min(retail, fob) : retail ?? fob);
    const hi = parseMoney(p.priceMaxCNY) ?? (retail != null && fob != null ? Math.max(retail, fob) : retail ?? fob);
    bumpPrice(lo, hi);
    skus.push({
      id: skuId(id, name, idx),
      name,
      category: cat,
      categoryRaw: p.category,
      priceMinCny: lo,
      priceMaxCny: hi,
      retailPrice: p.retailPrice,
      retailPriceCNY: retail,
      estimatedFOBPriceCNY: fob,
      source: 'sku',
      keywordMatch: !!p.keywordMatch,
    });
  });

  (analysis.businessScope?.coreProducts || []).forEach((c) => pushCat(c, 'core'));
  (analysis.businessScope?.relevantProducts || []).forEach((c) => pushCat(c, 'core'));
  (analysis.tradeIntelligence?.importCategories || []).forEach((c) => pushCat(c, 'trade'));
  (analysis.websiteCategories || []).forEach((wc) => {
    const lo = parseMoney(wc.priceMinCNY);
    const hi = parseMoney(wc.priceMaxCNY);
    pushCat(wc.categoryName, 'website', { min: lo, max: hi });
    (wc.items || []).slice(0, 8).forEach((item) => pushCat(item, 'website', { min: lo, max: hi }));
  });

  if (analysis.searchKeyword) pushCat(analysis.searchKeyword, 'category');

  const categories = [...categorySet];
  if (!skus.length && !categories.length) return null;

  const priceBand =
    priceMin != null || priceMax != null
      ? `¥${priceMin ?? '?'}–${priceMax ?? '?'}`
      : analysis.businessScope?.priceSensitivity || undefined;

  const searchKeywords = [
    ...(analysis.searchKeyword ? [analysis.searchKeyword] : []),
    ...((analysis.searchTags || [])
      .filter((t) => t.startsWith('关键词:'))
      .map((t) => t.replace(/^关键词:/, '').trim())
      .filter(Boolean) as string[]),
  ];

  return {
    id,
    companyName: companyName || id,
    website: website || '',
    country:
      analysis.searchCountry ||
      analysis.companyInfo?.headquarters?.split(',').pop()?.trim() ||
      analysis.companyInfo?.city ||
      undefined,
    historyId: meta?.historyId,
    crmClientId: meta?.crmClientId,
    categories,
    priceMinCny: priceMin,
    priceMaxCny: priceMax,
    priceBand,
    skus: skus.slice(0, 80),
    importCategories: analysis.tradeIntelligence?.importCategories,
    hsCodes: analysis.tradeIntelligence?.hsCodes,
    coreProducts: analysis.businessScope?.coreProducts,
    searchKeywords: [...new Set(searchKeywords)],
    updatedAt: Date.now(),
    ownerUsername: meta?.ownerUsername,
    departmentId: meta?.departmentId,
  };
};

export const upsertProductProfile = async (
  profile: CustomerProductProfile,
  syncCloud = true
): Promise<void> => {
  await saveProductProfile(profile);
  if (syncCloud) {
    void saveProductProfileCloud(profile).catch((e) =>
      console.warn('[productCatalog] cloud save failed', e)
    );
  }
};

/** 背调完成后写入产品库 */
export const indexAnalysisIntoProductCatalog = async (
  analysis: AnalysisResult,
  meta?: {
    historyId?: string;
    crmClientId?: string;
    ownerUsername?: string;
    departmentId?: string;
  }
): Promise<CustomerProductProfile | null> => {
  const profile = buildProductProfileFromAnalysis(analysis, meta);
  if (!profile) return null;
  await upsertProductProfile(profile);
  return profile;
};

/** 从历史记录批量重建产品库（不覆盖更新时间更近的已有条目，除非 force） */
export const rebuildProductCatalogFromHistory = async (
  history: HistoryItem[],
  opts?: { force?: boolean; ownerUsername?: string; departmentId?: string }
): Promise<{ upserted: number; skipped: number }> => {
  const existing = await getProductProfiles();
  const map = new Map(existing.map((p) => [p.id, p]));
  let upserted = 0;
  let skipped = 0;
  const batch: CustomerProductProfile[] = [];

  for (const h of history) {
    if (!h?.data) {
      skipped += 1;
      continue;
    }
    const built = buildProductProfileFromAnalysis(h.data, {
      historyId: h.id,
      ownerUsername: h.ownerUsername || opts?.ownerUsername,
      departmentId: h.departmentId || opts?.departmentId,
    });
    if (!built) {
      skipped += 1;
      continue;
    }
    const prev = map.get(built.id);
    if (!opts?.force && prev && (prev.updatedAt || 0) > (h.timestamp || 0) && prev.skus.length >= built.skus.length) {
      skipped += 1;
      continue;
    }
    const next = {
      ...built,
      updatedAt: Math.max(built.updatedAt, h.timestamp || 0),
      historyId: h.id,
    };
    map.set(next.id, next);
    batch.push(next);
    upserted += 1;
  }

  if (batch.length) {
    await saveProductProfilesBulk(batch);
    void syncProductProfilesCloud(batch).catch((e) =>
      console.warn('[productCatalog] bulk cloud sync failed', e)
    );
  }
  return { upserted, skipped };
};

const tokensOf = (s: string) =>
  normalizeText(s)
    .split(/[\s,/|+\-，、&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

const priceRangesOverlap = (
  aMin?: number,
  aMax?: number,
  bMin?: number,
  bMax?: number
): boolean => {
  if (aMin == null && aMax == null) return false;
  if (bMin == null && bMax == null) return false;
  const aLo = aMin ?? aMax!;
  const aHi = aMax ?? aMin!;
  const bLo = bMin ?? bMax!;
  const bHi = bMax ?? bMin!;
  // 允许 30% 容差
  const pad = (v: number) => v * 0.3;
  return aLo - pad(aLo) <= bHi + pad(bHi) && bLo - pad(bLo) <= aHi + pad(aHi);
};

/** 本地打分匹配：新品 → 客户产品库 */
export const matchOurProductToProfiles = (
  query: OurProductMatchQuery,
  profiles: CustomerProductProfile[]
): ProductMatchHit[] => {
  const name = (query.name || '').trim();
  const category = normalizeCategoryLabel(query.category) || normalizeCategoryLabel(name);
  const qTokens = [...new Set([...tokensOf(name), ...tokensOf(query.category || '')])];
  const countries = (query.countries || []).map((c) => c.trim().toLowerCase()).filter(Boolean);

  const hits: ProductMatchHit[] = [];

  for (const profile of profiles) {
    if (countries.length) {
      const pc = (profile.country || '').toLowerCase();
      if (pc && !countries.some((c) => pc.includes(c) || c.includes(pc))) continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const matchedCategories: string[] = [];

    // 品类精确 / 包含
    for (const cat of profile.categories) {
      const nCat = normalizeCategoryLabel(cat) || cat;
      if (category && (nCat === category || nCat.includes(category) || category.includes(nCat))) {
        score += 42;
        matchedCategories.push(nCat);
        reasons.push(`品类命中：${nCat}`);
        break;
      }
    }

    // SKU / 关键词 token
    const blob = [
      ...profile.categories,
      ...profile.skus.map((s) => s.name),
      ...(profile.coreProducts || []),
      ...(profile.searchKeywords || []),
      ...(profile.importCategories || []),
    ]
      .join(' ')
      .toLowerCase();

    let tokenHits = 0;
    for (const t of qTokens) {
      if (blob.includes(t)) tokenHits += 1;
    }
    if (tokenHits > 0) {
      const add = Math.min(28, tokenHits * 8);
      score += add;
      reasons.push(`关键词重合 ${tokenHits} 项`);
    }

    // 近义品类（同 alias 组）
    if (category && !matchedCategories.length) {
      for (const a of CATEGORY_ALIASES) {
        const inQuery = a.keys.some((k) => normalizeText(category).includes(normalizeText(k))) || a.label === category;
        if (!inQuery) continue;
        const hit = profile.categories.some((c) => {
          const nc = normalizeCategoryLabel(c) || c;
          return nc === a.label || a.keys.some((k) => normalizeText(c).includes(normalizeText(k)));
        });
        if (hit) {
          score += 26;
          matchedCategories.push(a.label);
          reasons.push(`近义品类：${a.label}`);
          break;
        }
      }
    }

    const priceOverlap = priceRangesOverlap(
      query.priceMinCny,
      query.priceMaxCny,
      profile.priceMinCny,
      profile.priceMaxCny
    );
    if (priceOverlap) {
      score += 22;
      reasons.push(`价格区间重叠（客户 ${profile.priceBand || '有价位线索'}）`);
    } else if (
      (query.priceMinCny != null || query.priceMaxCny != null) &&
      (profile.priceMinCny != null || profile.priceMaxCny != null)
    ) {
      // 有价但无重叠：轻微扣分不至于清零
      score = Math.max(0, score - 4);
    }

    // 有 SKU 级数据加一点可信度
    if (profile.skus.some((s) => s.source === 'sku')) {
      score += 6;
      reasons.push('含具体 SKU 价格线索');
    }

    score = Math.min(100, Math.round(score));
    if (score < 18) continue;

    hits.push({
      profile,
      score,
      reasons: reasons.slice(0, 5),
      matchedCategories: [...new Set(matchedCategories)],
      priceOverlap,
    });
  }

  return hits.sort((a, b) => b.score - a.score);
};

export const loadProductCatalog = async (): Promise<CustomerProductProfile[]> => {
  const local = await getProductProfiles();
  return local.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const removeProductProfile = async (id: string): Promise<void> => {
  await deleteProductProfile(id);
  void deleteProductProfileCloud(id).catch(() => undefined);
};

export { domainKey as productCatalogDomainKey };

/**
 * 报告是否已含「全站品类 + 价格」可用数据。
 * 新背调应达到此标准；未达标的旧报告才需要「产品深挖」补做。
 */
export const hasRichProductCatalog = (analysis?: AnalysisResult | null): boolean => {
  if (!analysis) return false;
  const cats = analysis.websiteCategories || [];
  const products = analysis.products || [];

  const catsWithPrice = cats.filter((c) => {
    const band = (c.priceBand || '').trim();
    if (band && band !== '待补价格' && !/^n\/?a$/i.test(band)) return true;
    return (
      (typeof c.priceMinCNY === 'number' && c.priceMinCNY > 0) ||
      (typeof c.priceMaxCNY === 'number' && c.priceMaxCNY > 0)
    );
  });

  const productsPriced = products.filter((p) => {
    const hasCat = !!(p.category || '').trim();
    const hasPrice =
      (typeof p.priceMinCNY === 'number' && p.priceMinCNY > 0) ||
      (typeof p.priceMaxCNY === 'number' && p.priceMaxCNY > 0) ||
      (typeof p.retailPriceCNY === 'number' && p.retailPriceCNY > 0) ||
      (typeof p.estimatedFOBPriceCNY === 'number' && p.estimatedFOBPriceCNY > 0) ||
      !!(p.retailPrice || '').trim();
    return hasCat && hasPrice;
  });

  if (catsWithPrice.length >= 3) return true;
  if (productsPriced.length >= 5) return true;
  if (cats.length >= 4 && productsPriced.length >= 3) return true;
  if (catsWithPrice.length >= 2 && productsPriced.length >= 4) return true;
  return false;
};

