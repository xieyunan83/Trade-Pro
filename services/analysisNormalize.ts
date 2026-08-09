import { AnalysisResult, DecisionMaker, EvidenceItem, HistoryItem } from '../types';

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const asStr = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);

/** 从历史条目取出可渲染的 AnalysisResult（兼容双重包裹 / 缺字段） */
export const extractHistoryAnalysis = (item: HistoryItem | null | undefined): AnalysisResult | null => {
  if (!item) return null;
  let raw: unknown = item.data;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // 误把整条 HistoryItem 存进 data 时再剥一层
  if (!obj.companyInfo && obj.data && typeof obj.data === 'object') {
    raw = obj.data;
  }
  return normalizeAnalysisResult(raw);
};

/** 补齐缺字段，避免打开历史报告时 React 崩溃整页空白 */
export const normalizeAnalysisResult = (raw: unknown): AnalysisResult => {
  const ai = (raw && typeof raw === 'object' ? raw : {}) as Partial<AnalysisResult> & Record<string, any>;
  const company = (ai.companyInfo || {}) as Record<string, any>;

  return {
    companyInfo: {
      name: asStr(company.name, 'Unknown'),
      headquarters: asStr(company.headquarters, 'N/A'),
      foundedYear: asStr(company.foundedYear, 'N/A'),
      nature: asStr(company.nature, 'N/A'),
      scale: asStr(company.scale, 'N/A'),
      website: asStr(company.website, 'N/A'),
      description: asStr(company.description, 'N/A'),
      employeeRange: asStr(company.employeeRange),
      city: asStr(company.city),
    },
    swot: {
      strengths: asArray(ai.swot?.strengths),
      weaknesses: asArray(ai.swot?.weaknesses),
      opportunities: asArray(ai.swot?.opportunities),
      threats: asArray(ai.swot?.threats),
    },
    financialTrends: asArray(ai.financialTrends),
    trafficAnalysis: asArray(ai.trafficAnalysis),
    websiteCategories: asArray(ai.websiteCategories),
    businessScope: {
      coreProducts: asArray(ai.businessScope?.coreProducts),
      relevantProducts: asArray(ai.businessScope?.relevantProducts),
      brandPositioning: asStr(ai.businessScope?.brandPositioning, 'N/A'),
      consumerGroup: asStr(ai.businessScope?.consumerGroup, 'N/A'),
      productVariety: (ai.businessScope?.productVariety as AnalysisResult['businessScope']['productVariety']) || 'Medium',
      priceSensitivity: asStr(ai.businessScope?.priceSensitivity, 'N/A'),
      websiteStructure: asStr(ai.businessScope?.websiteStructure, 'N/A'),
    },
    businessModel: {
      channels: asArray(ai.businessModel?.channels),
      hasDistributors: !!ai.businessModel?.hasDistributors,
      exhibitionHistory: asArray(ai.businessModel?.exhibitionHistory),
      ecommercePresence: asArray(ai.businessModel?.ecommercePresence),
      procurementInfo: asStr(ai.businessModel?.procurementInfo, 'N/A'),
    },
    supplyChain: {
      role: asStr(ai.supplyChain?.role, 'N/A'),
      serviceType: asStr(ai.supplyChain?.serviceType, 'N/A'),
    },
    tradeIntelligence: ai.tradeIntelligence
      ? {
          hsCodes: asArray(ai.tradeIntelligence.hsCodes),
          importCategories: asArray(ai.tradeIntelligence.importCategories),
          customsSummary: asStr(ai.tradeIntelligence.customsSummary, '公开信息未找到'),
          recentShipments: asArray(ai.tradeIntelligence.recentShipments),
          topSourceCountries: asArray(ai.tradeIntelligence.topSourceCountries),
          estimatedAnnualImport: asStr(ai.tradeIntelligence.estimatedAnnualImport, '公开信息未找到'),
          certifications: asArray(ai.tradeIntelligence.certifications),
          complianceNotes: asStr(ai.tradeIntelligence.complianceNotes),
          preferredIncoterms: asStr(ai.tradeIntelligence.preferredIncoterms, '公开信息未找到'),
          typicalMoq: asStr(ai.tradeIntelligence.typicalMoq, '公开信息未找到'),
          buyingSeasons: asStr(ai.tradeIntelligence.buyingSeasons, '公开信息未找到'),
          registrationId: asStr(ai.tradeIntelligence.registrationId),
          companyLinkedin: asStr(ai.tradeIntelligence.companyLinkedin),
          riskLevel: (ai.tradeIntelligence.riskLevel as any) || '未知',
          riskNotes: asStr(ai.tradeIntelligence.riskNotes),
        }
      : undefined,
    targetAudience: asArray(ai.targetAudience),
    financials: {
      revenueEstimate: asStr(ai.financials?.revenueEstimate, 'N/A'),
      paymentTerms: asStr(ai.financials?.paymentTerms, 'N/A'),
      ipInfo: asStr(ai.financials?.ipInfo, 'N/A'),
    },
    productSummary: ai.productSummary
      ? {
          marketPreference: asStr(ai.productSummary.marketPreference, 'N/A'),
          recommendedProducts: asStr(ai.productSummary.recommendedProducts, 'N/A'),
          packagingAnalysis: asStr(ai.productSummary.packagingAnalysis, 'N/A'),
          colorPreference: asStr(ai.productSummary.colorPreference, 'N/A'),
          featureAnalysis: asStr(ai.productSummary.featureAnalysis, 'N/A'),
        }
      : undefined,
    socials: ai.socials && typeof ai.socials === 'object' ? ai.socials : {},
    products: asArray(ai.products),
    marketTrends: asStr(ai.marketTrends, 'N/A'),
    decisionMakers: asArray<DecisionMaker>(ai.decisionMakers).filter(
      (d) =>
        !!(d.phone || '').trim() ||
        !!(d.whatsapp || '').trim() ||
        !!(d.emailGuess || '').includes('@')
    ),
    decisionMakerEmailSearchAt: ai.decisionMakerEmailSearchAt,
    decisionMakerEmailSearchHistory: asArray<number>(ai.decisionMakerEmailSearchHistory),
    searchKeyword: ai.searchKeyword,
    searchTags: asArray<string>(ai.searchTags).filter((t) => typeof t === 'string'),
    searchCountry: ai.searchCountry,
    strategy: {
      buyingOfficeLocation: asStr(ai.strategy?.buyingOfficeLocation, 'N/A'),
      actionPlan: asArray(ai.strategy?.actionPlan),
    },
    similarCompanies: asArray(ai.similarCompanies),
    generatedEmails: ai.generatedEmails,
    generatedEmailsAt: ai.generatedEmailsAt,
    evidenceChain: asArray(ai.evidenceChain)
      .filter((e: any) => e && typeof e.url === 'string' && e.url.trim())
      .map((e: any): EvidenceItem => ({
        title: asStr(e.title, e.url),
        url: asStr(e.url),
        source: (['tavily', 'anysearch', 'official', 'social', 'ai', 'other'].includes(e.source)
          ? e.source
          : 'other') as EvidenceItem['source'],
        snippet: e.snippet ? asStr(e.snippet) : undefined,
        confidence: typeof e.confidence === 'number' ? e.confidence : undefined,
      })),
    evidenceConfidence:
      typeof ai.evidenceConfidence === 'number' ? ai.evidenceConfidence : undefined,
    evidenceSummary: ai.evidenceSummary ? asStr(ai.evidenceSummary) : undefined,
  };
};

export const websiteHref = (website?: string | null): string => {
  const w = (website || '').trim();
  if (!w || w === 'N/A') return '#';
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
};
