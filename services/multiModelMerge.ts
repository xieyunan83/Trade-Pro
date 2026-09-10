import { AnalysisResult, ClientSearchResult, DecisionMaker, ProductAnalysis, SimilarCompany, WebsiteCategory } from '../types';
import { normalizeCrmHost } from '../utils/crmHistory';

const PLACEHOLDER_RE =
  /^(n\/?a|na|none|null|unknown|未知|暂无|未发现|公开信息未找到|公开信息待核实|待核实|-|—|－)$/i;

/** 空占位文案（含 N/A、公开信息未找到 等） */
export const isEmptyPlaceholder = (v: unknown): boolean => {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return v.length === 0;
  const s = String(v).trim();
  if (!s) return true;
  return PLACEHOLDER_RE.test(s);
};

const asStr = (v: unknown): string => (v == null ? '' : String(v).trim());

/** 取更充实的非占位字符串 */
export const preferString = (...cands: unknown[]): string => {
  let best = '';
  for (const c of cands) {
    const s = asStr(c);
    if (isEmptyPlaceholder(s)) continue;
    if (s.length > best.length) best = s;
  }
  return best;
};

const unionStrings = (...lists: unknown[][]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list || []) {
      const s = asStr(item);
      if (isEmptyPlaceholder(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
};

const scoreProduct = (p: ProductAnalysis | Record<string, any>): number => {
  let n = 0;
  if (!isEmptyPlaceholder(p?.name)) n += 2;
  if (!isEmptyPlaceholder(p?.category)) n += 1;
  if (typeof p?.retailPriceCNY === 'number' && p.retailPriceCNY > 0) n += 2;
  if (typeof p?.priceMinCNY === 'number' && p.priceMinCNY > 0) n += 1;
  if (typeof p?.priceMaxCNY === 'number' && p.priceMaxCNY > 0) n += 1;
  if (!isEmptyPlaceholder(p?.features)) n += 1;
  if (p?.keywordMatch) n += 1;
  return n;
};

const mergeProducts = (a: any[], b: any[]): ProductAnalysis[] => {
  const map = new Map<string, any>();
  const put = (p: any) => {
    if (!p || isEmptyPlaceholder(p.name)) return;
    const key = `${asStr(p.name).toLowerCase()}|${asStr(p.category).toLowerCase()}`;
    const prev = map.get(key);
    if (!prev || scoreProduct(p) > scoreProduct(prev)) {
      map.set(key, {
        ...prev,
        ...p,
        name: preferString(p.name, prev?.name),
        category: preferString(p.category, prev?.category),
        features: preferString(p.features, prev?.features),
        colors: preferString(p.colors, prev?.colors),
        packaging: preferString(p.packaging, prev?.packaging),
        pitchPoint: preferString(p.pitchPoint, prev?.pitchPoint),
        keywordMatch: !!(p.keywordMatch || prev?.keywordMatch),
      });
    } else if (prev) {
      map.set(key, {
        ...p,
        ...prev,
        name: preferString(prev.name, p.name),
        category: preferString(prev.category, p.category),
        features: preferString(prev.features, p.features),
        colors: preferString(prev.colors, p.colors),
        packaging: preferString(prev.packaging, p.packaging),
        pitchPoint: preferString(prev.pitchPoint, p.pitchPoint),
        keywordMatch: !!(prev.keywordMatch || p.keywordMatch),
      });
    }
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return [...map.values()];
};

const mergeCategories = (a: any[], b: any[]): WebsiteCategory[] => {
  const map = new Map<string, WebsiteCategory>();
  const put = (c: any) => {
    if (!c) return;
    const name = preferString(c.categoryName, c.name);
    if (isEmptyPlaceholder(name)) return;
    const key = name.toLowerCase();
    const prev = map.get(key);
    const items = unionStrings(prev?.items || [], c.items || []);
    const priceMinCNY =
      typeof c.priceMinCNY === 'number' && c.priceMinCNY > 0
        ? c.priceMinCNY
        : prev?.priceMinCNY;
    const priceMaxCNY =
      typeof c.priceMaxCNY === 'number' && c.priceMaxCNY > 0
        ? c.priceMaxCNY
        : prev?.priceMaxCNY;
    map.set(key, {
      categoryName: name,
      items,
      priceMinCNY,
      priceMaxCNY,
      priceBand: preferString(c.priceBand, prev?.priceBand),
    });
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return [...map.values()];
};

/** 合并决策人列表（邮箱 / LinkedIn / 姓名去重） */
export const mergeDecisionMakers = (a: any[], b: any[]): DecisionMaker[] => {
  const map = new Map<string, any>();
  const keyOf = (dm: any) => {
    const email = asStr(dm.emailGuess).toLowerCase();
    if (email.includes('@')) return `e:${email}`;
    const li = asStr(dm.linkedin).toLowerCase();
    if (li) return `l:${li}`;
    const phone = asStr(dm.phone || dm.whatsapp);
    if (phone) return `p:${phone}`;
    return `n:${asStr(dm.name).toLowerCase()}|${asStr(dm.title).toLowerCase()}`;
  };
  const put = (dm: any) => {
    if (!dm) return;
    const name = preferString(dm.name, [dm.firstName, dm.lastName].filter(Boolean).join(' '));
    if (isEmptyPlaceholder(name) && !asStr(dm.emailGuess).includes('@')) return;
    const k = keyOf({ ...dm, name });
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...dm, name });
      return;
    }
    map.set(k, {
      ...prev,
      ...dm,
      name: preferString(prev.name, name),
      title: preferString(prev.title, dm.title),
      emailGuess: preferString(prev.emailGuess, dm.emailGuess),
      phone: preferString(prev.phone, dm.phone),
      whatsapp: preferString(prev.whatsapp, dm.whatsapp),
      linkedin: preferString(prev.linkedin, dm.linkedin),
      department: preferString(prev.department, dm.department),
    });
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return [...map.values()];
};

const mergeSimilar = (a: any[], b: any[]): SimilarCompany[] => {
  const map = new Map<string, SimilarCompany>();
  const put = (c: any) => {
    if (!c) return;
    const host = normalizeCrmHost(c.website) || asStr(c.name).toLowerCase();
    if (!host) return;
    const prev = map.get(host);
    map.set(host, {
      name: preferString(c.name, prev?.name) || 'Unknown',
      website: preferString(c.website, prev?.website),
      country: preferString(c.country, prev?.country),
      mainProducts: preferString(c.mainProducts, prev?.mainProducts),
    });
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return [...map.values()].slice(0, 20);
};

const looksLikeShipmentId = (s: string): boolean =>
  /^(BOL|BL|AWB|CONTAINER)[-_\s]?\w{5,}$/i.test(s.trim()) ||
  /^[A-Z]{4}\d{7,}$/.test(s.trim());

/**
 * 合并多模型背调原始 JSON（字段级：非占位优先，列表并集去重）
 * 海关单号类字段：仅当两侧一致或像真实线索时保留，避免编造
 */
export const mergeAnalysisRaws = (...raws: Record<string, any>[]): Record<string, any> => {
  const list = raws.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!list.length) return {};
  if (list.length === 1) return list[0];

  return list.reduce((acc, cur) => {
    const a = acc || {};
    const b = cur || {};
    const aCi = a.companyInfo || {};
    const bCi = b.companyInfo || {};
    const aTi = a.tradeIntelligence || {};
    const bTi = b.tradeIntelligence || {};

    const regA = asStr(aTi.registrationId);
    const regB = asStr(bTi.registrationId);
    let registrationId = '';
    if (regA && regB && regA === regB) registrationId = regA;
    else if (regA && !looksLikeShipmentId(regA) && !isEmptyPlaceholder(regA)) registrationId = regA;
    else if (regB && !looksLikeShipmentId(regB) && !isEmptyPlaceholder(regB)) registrationId = regB;

    return {
      ...a,
      ...b,
      companyInfo: {
        ...aCi,
        ...bCi,
        name: preferString(aCi.name, bCi.name),
        headquarters: preferString(aCi.headquarters, bCi.headquarters),
        foundedYear: preferString(aCi.foundedYear, bCi.foundedYear),
        nature: preferString(aCi.nature, bCi.nature),
        scale: preferString(aCi.scale, bCi.scale),
        website: preferString(aCi.website, bCi.website),
        description: preferString(aCi.description, bCi.description),
        employeeRange: preferString(aCi.employeeRange, bCi.employeeRange),
        city: preferString(aCi.city, bCi.city),
      },
      swot: {
        strengths: unionStrings(a.swot?.strengths || [], b.swot?.strengths || []),
        weaknesses: unionStrings(a.swot?.weaknesses || [], b.swot?.weaknesses || []),
        opportunities: unionStrings(a.swot?.opportunities || [], b.swot?.opportunities || []),
        threats: unionStrings(a.swot?.threats || [], b.swot?.threats || []),
      },
      financialTrends:
        (Array.isArray(a.financialTrends) ? a.financialTrends : []).length >=
        (Array.isArray(b.financialTrends) ? b.financialTrends : []).length
          ? a.financialTrends || []
          : b.financialTrends || [],
      trafficAnalysis:
        (Array.isArray(a.trafficAnalysis) ? a.trafficAnalysis : []).length >=
        (Array.isArray(b.trafficAnalysis) ? b.trafficAnalysis : []).length
          ? a.trafficAnalysis || []
          : b.trafficAnalysis || [],
      websiteCategories: mergeCategories(a.websiteCategories || [], b.websiteCategories || []),
      businessScope: {
        ...(a.businessScope || {}),
        ...(b.businessScope || {}),
        coreProducts: unionStrings(
          a.businessScope?.coreProducts || [],
          b.businessScope?.coreProducts || []
        ),
        relevantProducts: unionStrings(
          a.businessScope?.relevantProducts || [],
          b.businessScope?.relevantProducts || []
        ),
        brandPositioning: preferString(
          a.businessScope?.brandPositioning,
          b.businessScope?.brandPositioning
        ),
        consumerGroup: preferString(a.businessScope?.consumerGroup, b.businessScope?.consumerGroup),
        productVariety: preferString(
          a.businessScope?.productVariety,
          b.businessScope?.productVariety
        ) || a.businessScope?.productVariety || b.businessScope?.productVariety || 'Medium',
        priceSensitivity: preferString(
          a.businessScope?.priceSensitivity,
          b.businessScope?.priceSensitivity
        ),
        websiteStructure: preferString(
          a.businessScope?.websiteStructure,
          b.businessScope?.websiteStructure
        ),
      },
      businessModel: {
        ...(a.businessModel || {}),
        ...(b.businessModel || {}),
        channels: unionStrings(a.businessModel?.channels || [], b.businessModel?.channels || []),
        hasDistributors: !!(a.businessModel?.hasDistributors || b.businessModel?.hasDistributors),
        exhibitionHistory: unionStrings(
          a.businessModel?.exhibitionHistory || [],
          b.businessModel?.exhibitionHistory || []
        ),
        ecommercePresence: unionStrings(
          a.businessModel?.ecommercePresence || [],
          b.businessModel?.ecommercePresence || []
        ),
        procurementInfo: preferString(
          a.businessModel?.procurementInfo,
          b.businessModel?.procurementInfo
        ),
      },
      supplyChain: {
        role: preferString(a.supplyChain?.role, b.supplyChain?.role),
        serviceType: preferString(a.supplyChain?.serviceType, b.supplyChain?.serviceType),
      },
      tradeIntelligence: {
        ...aTi,
        ...bTi,
        hsCodes: unionStrings(aTi.hsCodes || [], bTi.hsCodes || []),
        importCategories: unionStrings(aTi.importCategories || [], bTi.importCategories || []),
        customsSummary: preferString(aTi.customsSummary, bTi.customsSummary),
        recentShipments:
          (Array.isArray(aTi.recentShipments) ? aTi.recentShipments : []).length >=
          (Array.isArray(bTi.recentShipments) ? bTi.recentShipments : []).length
            ? aTi.recentShipments || []
            : bTi.recentShipments || [],
        topSourceCountries: unionStrings(aTi.topSourceCountries || [], bTi.topSourceCountries || []),
        estimatedAnnualImport: preferString(aTi.estimatedAnnualImport, bTi.estimatedAnnualImport),
        certifications: unionStrings(aTi.certifications || [], bTi.certifications || []),
        complianceNotes: preferString(aTi.complianceNotes, bTi.complianceNotes),
        preferredIncoterms: preferString(aTi.preferredIncoterms, bTi.preferredIncoterms),
        typicalMoq: preferString(aTi.typicalMoq, bTi.typicalMoq),
        buyingSeasons: preferString(aTi.buyingSeasons, bTi.buyingSeasons),
        registrationId,
        companyLinkedin: preferString(aTi.companyLinkedin, bTi.companyLinkedin, a.socials?.linkedin, b.socials?.linkedin),
        riskLevel: preferString(aTi.riskLevel, bTi.riskLevel) || '未知',
        riskNotes: preferString(aTi.riskNotes, bTi.riskNotes),
      },
      targetAudience: unionStrings(a.targetAudience || [], b.targetAudience || []),
      financials: {
        revenueEstimate: preferString(a.financials?.revenueEstimate, b.financials?.revenueEstimate),
        paymentTerms: preferString(a.financials?.paymentTerms, b.financials?.paymentTerms),
        ipInfo: preferString(a.financials?.ipInfo, b.financials?.ipInfo),
      },
      productSummary: {
        marketPreference: preferString(
          a.productSummary?.marketPreference,
          b.productSummary?.marketPreference
        ),
        recommendedProducts: preferString(
          a.productSummary?.recommendedProducts,
          b.productSummary?.recommendedProducts
        ),
        packagingAnalysis: preferString(
          a.productSummary?.packagingAnalysis,
          b.productSummary?.packagingAnalysis
        ),
        colorPreference: preferString(
          a.productSummary?.colorPreference,
          b.productSummary?.colorPreference
        ),
        featureAnalysis: preferString(
          a.productSummary?.featureAnalysis,
          b.productSummary?.featureAnalysis
        ),
      },
      socials: {
        linkedin: preferString(a.socials?.linkedin, b.socials?.linkedin),
        facebook: preferString(a.socials?.facebook, b.socials?.facebook),
        instagram: preferString(a.socials?.instagram, b.socials?.instagram),
        youtube: preferString(a.socials?.youtube, b.socials?.youtube),
        similarWebTraffic: preferString(a.socials?.similarWebTraffic, b.socials?.similarWebTraffic),
      },
      products: mergeProducts(a.products || [], b.products || []),
      marketTrends: preferString(a.marketTrends, b.marketTrends),
      decisionMakers: mergeDecisionMakers(a.decisionMakers || [], b.decisionMakers || []),
      strategy: {
        buyingOfficeLocation: preferString(
          a.strategy?.buyingOfficeLocation,
          b.strategy?.buyingOfficeLocation
        ),
        actionPlan: unionStrings(a.strategy?.actionPlan || [], b.strategy?.actionPlan || []),
      },
      similarCompanies: mergeSimilar(a.similarCompanies || [], b.similarCompanies || []),
      evidenceSummary: preferString(a.evidenceSummary, b.evidenceSummary),
    };
  });
};

const scoreLead = (r: ClientSearchResult): number => {
  let n = typeof r.fitScore === 'number' ? r.fitScore : 0;
  if (!isEmptyPlaceholder(r.description)) n += 2;
  if (!isEmptyPlaceholder(r.mainProducts)) n += 2;
  if (!isEmptyPlaceholder(r.fitReason)) n += 1;
  if (!isEmptyPlaceholder(r.city)) n += 1;
  if (!isEmptyPlaceholder(r.linkedinCompanyUrl)) n += 1;
  if (!isEmptyPlaceholder(r.contactHint)) n += 1;
  if (!isEmptyPlaceholder(r.website)) n += 3;
  return n;
};

/** 合并多模型客户搜索名单（按官网域名去重，字段取更充实一侧） */
export const mergeClientSearchResults = (
  lists: ClientSearchResult[][],
  opts?: { limit?: number }
): ClientSearchResult[] => {
  const map = new Map<string, ClientSearchResult>();
  for (const list of lists) {
    for (const r of list || []) {
      const host = normalizeCrmHost(r.website) || asStr(r.name).toLowerCase();
      if (!host) continue;
      const prev = map.get(host);
      if (!prev) {
        map.set(host, { ...r });
        continue;
      }
      const useNew = scoreLead(r) > scoreLead(prev);
      const base = useNew ? r : prev;
      const other = useNew ? prev : r;
      map.set(host, {
        ...other,
        ...base,
        name: preferString(base.name, other.name) || base.name,
        website: preferString(base.website, other.website),
        description: preferString(base.description, other.description),
        country: preferString(base.country, other.country),
        clientType: preferString(base.clientType, other.clientType),
        mainProducts: preferString(base.mainProducts, other.mainProducts),
        estimatedScale: preferString(base.estimatedScale, other.estimatedScale),
        city: preferString(base.city, other.city),
        linkedinCompanyUrl: preferString(base.linkedinCompanyUrl, other.linkedinCompanyUrl),
        contactHint: preferString(base.contactHint, other.contactHint),
        fitScore: Math.max(
          typeof base.fitScore === 'number' ? base.fitScore : 0,
          typeof other.fitScore === 'number' ? other.fitScore : 0
        ),
        fitReason: preferString(base.fitReason, other.fitReason),
        searchKeyword: preferString(base.searchKeyword, other.searchKeyword) || undefined,
        searchCountry: preferString(base.searchCountry, other.searchCountry) || undefined,
      });
    }
  }
  const merged = [...map.values()].sort(
    (a, b) => (b.fitScore || 0) - (a.fitScore || 0) || scoreLead(b) - scoreLead(a)
  );
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : merged.length;
  return merged.slice(0, limit);
};

/** 供类型检查：合并后可再走 normalizeAnalysisResult */
export type MergedAnalysisRaw = Partial<AnalysisResult> & Record<string, any>;
