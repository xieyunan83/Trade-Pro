/**
 * 静默四通道获客引擎（Google 等价公开检索 / 海关 / 关键岗位 / 社媒主页）
 * - 用户侧不展示工作逻辑与供应商名，只提升线索与报告结果
 * - 不打开浏览器 Google；用平台公开网页检索拿到等价命中
 */
import type { AnalysisResult, ClientSearchResult, DecisionMaker } from '../types';
import { buildLeadDiscoveryQueries, type LeadSearchInput } from './leadDiscoverySources';
import { hasTavilyKey, tavilySearch, formatTavilyEvidence } from './tavilyService';
import { locateLinkedInEmployees } from './linkedinEmployeeLocator';
import { enrichDecisionMakersTitleAndWhatsApp } from './decisionMakerWebEnrich';
import { mergeDecisionMakers } from './multiModelMerge';
import {
  buildAcquisitionFormulaQueries,
  consumePreferredAcquisitionCategories,
} from './acquisitionMethods';
import {
  searchCustomsCacheForLeads,
  collectInternalLeads,
} from './internalLeadSources';

const MAX_AI_QUERIES = 10;
const MAX_EVIDENCE = 14_000;

const normalizeQ = (q: string) => q.replace(/\s+/g, ' ').trim();

/** 把「给 Google 用的高级指令」收敛为平台网页检索仍可用的查询 */
export const adaptSearchQueryForPlatform = (raw: string): string => {
  let q = normalizeQ(raw);
  if (!q) return '';
  // 去掉说明性前缀
  q = q.replace(/^(搜索目标[:：]|目标[:：]|query[:：]|指令\d*[:：])\s*/i, '');
  // 保留 site: / filetype: / intitle: / inurl:；去掉明显无效的空操作符
  q = q.replace(/\s+-\s+/g, ' -');
  // 平台侧不依赖 Google 专有 UI，保留减号排除
  return normalizeQ(q).slice(0, 240);
};

/** 规则通道：等价于图文中的 Google×海关×领英×Facebook 检索意图 */
export const buildSilentChannelQueries = (opts: LeadSearchInput): string[] => {
  const base = buildLeadDiscoveryQueries(opts);
  const kw = normalizeQ(opts.productKeyword);
  const country = normalizeQ(opts.country);
  const market = country && !/^(global|worldwide|国际|全球)$/i.test(country) ? country : '';
  const extra: string[] = [];
  const add = (q: string) => {
    const t = adaptSearchQueryForPlatform(q);
    if (t && !extra.includes(t) && !base.includes(t)) extra.push(t);
  };

  if (!kw) return base;

  // Google 等价：高级操作符风格（公开网页检索引擎可吃）
  add(`"${kw}" (importer OR distributor OR wholesaler OR "private label") ${market}`);
  add(`intitle:distributor "${kw}" ${market}`);
  add(`filetype:pdf ("exhibitor list" OR "buyer list" OR "member directory") ${kw} ${market}`);
  {
    const tld = guessTld(market);
    if (tld) add(`"${kw}" wholesale site:.${tld}`);
  }

  // 海关/贸易公开痕迹
  add(`${kw} ${market} (importer OR consignee OR "import from china" OR HS OR customs)`);
  add(`${kw} ${market} "bill of lading" OR shipment OR "import data"`);

  // 关键岗位（通过公开索引定位公司与采购角色，不爬登录墙）
  add(`${kw} importer site:linkedin.com/in "purchasing manager" ${market} -alibaba -made-in-china`);
  add(`${kw} distributor site:linkedin.com/company ${market}`);
  add(`"sourcing manager" OR "category manager" ${kw} ${market} site:linkedin.com/in`);

  // 社媒主页情报
  add(`${kw} (distributor OR wholesale OR "private label") site:facebook.com ${market}`);
  add(`${kw} drinkware OR toys OR wholesale phone site:facebook.com ${market}`);

  // 营销工具五类公式（领英/社媒/电商/母语/PDF）→ 平台内检索，不跳外网
  for (const q of buildAcquisitionFormulaQueries({
    productKeyword: kw,
    country: market,
    limit: 16,
  })) {
    add(q);
  }

  return [...base, ...extra].slice(0, 24);
};

const guessTld = (market: string): string => {
  const m = market.toLowerCase();
  if (/united\s*states|usa|美国/.test(m)) return 'com';
  if (/canada|加拿大/.test(m)) return 'ca';
  if (/united\s*kingdom|uk|英国/.test(m)) return 'uk';
  if (/germany|德国/.test(m)) return 'de';
  if (/france|法国/.test(m)) return 'fr';
  if (/australia|澳大利亚/.test(m)) return 'au';
  if (/japan|日本/.test(m)) return 'jp';
  return '';
};

/** 千问生成可执行网页检索式（失败则空，由规则通道兜底） */
export const generateAiLeadSearchQueries = async (opts: {
  productKeyword: string;
  country?: string;
  industry?: string;
  clientTypes?: string[];
}): Promise<string[]> => {
  const kw = normalizeQ(opts.productKeyword);
  if (!kw) return [];
  const market = normalizeQ(opts.country) || 'target export market';
  const types = (opts.clientTypes || []).filter(Boolean).join(', ') ||
    'Importer, Distributor, Wholesaler, Brand Owner';
  const prompt = `你是外贸 B2B 获客检索专家。请为「中国出口商」生成可直接用于公开网页检索的查询字符串（不是给用户看的说明）。
产品: ${kw}
行业: ${opts.industry || kw}
目标市场: ${market}
买家类型: ${types}

要求：
1. 输出 JSON 数组，仅字符串，12～16 条。
2. 综合使用：买家身份词、site:、intitle:、filetype:pdf、英文行业词；可含 -alibaba -made-in-china。
3. 覆盖四类意图：开放网页找公司、海关/进口痕迹、领英采购岗位相关公开页、Facebook 企业主页。
4. 不要编造公司名；不要输出解释；每条 ≤ 180 字符。
示例风格：["insulated bottle importer USA site:linkedin.com/in purchasing", "filetype:pdf exhibitor list drinkware"]`;

  try {
    const { callQwen } = await import('./geminiService');
    const text = await callQwen(prompt, {
      jsonMode: true,
      enableSearch: false,
      maxTokens: 900,
      timeoutMs: 55_000,
    });
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => adaptSearchQueryForPlatform(String(x || '')))
      .filter(Boolean)
      .slice(0, MAX_AI_QUERIES);
  } catch (e) {
    console.warn('[silent-acq] AI query gen failed', e);
    return [];
  }
};

/** 汇总四通道证据（静默），供客户搜索整理买家名单 */
export const gatherSilentLeadChannelEvidence = async (opts: {
  productKeyword: string;
  country: string;
  industry?: string;
  clientType?: string;
}): Promise<string> => {
  if (!hasTavilyKey()) return '';
  const preferredCats = consumePreferredAcquisitionCategories();
  const focusedQs = preferredCats?.length
    ? buildAcquisitionFormulaQueries({
        productKeyword: opts.productKeyword,
        country: opts.country,
        categories: preferredCats,
        limit: 14,
      })
    : [];
  const ruleQs = buildSilentChannelQueries({
    productKeyword: opts.productKeyword,
    country: opts.country,
    industry: opts.industry,
    clientType: opts.clientType,
  });
  let aiQs: string[] = [];
  try {
    aiQs = await generateAiLeadSearchQueries({
      productKeyword: opts.productKeyword,
      country: opts.country,
      industry: opts.industry,
      clientTypes: (opts.clientType || '')
        .split(/[,，|/]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  } catch {
    aiQs = [];
  }

  // 营销工具指定类别优先，再规则通道 / AI 式
  const queries = [...new Set([...focusedQs, ...ruleQs, ...aiQs])].slice(0, 14);
  const chunks: string[] = [];

  // 海关本地缓存摘要（静默注入，不展示来源品牌）
  try {
    const customs = searchCustomsCacheForLeads(opts.productKeyword, {
      country: opts.country,
      limit: 12,
    });
    if (customs.length) {
      const lines = customs.slice(0, 8).map((r, i) => {
        const name = r.linkedCompanyName || r.consignee || r.shipper || '—';
        return `${i + 1}. ${name} | ${r.productDesc || ''} | ${r.destCountry || r.originCountry || ''} | ${r.date || ''}`;
      });
      chunks.push(
        `=== TRADE_RECORD_HITS ===\n${lines.join('\n')}\n(Use only as candidate importers; verify current demand.)\n=== END ===`
      );
    }
  } catch {
    /* ignore */
  }

  const run = async (q: string) => {
    const data = await tavilySearch(q, {
      maxResults: 8,
      searchDepth: 'basic',
      includeAnswer: true,
    });
    const block = formatTavilyEvidence(data, `LEAD:${q.slice(0, 40)}`);
    if (block) chunks.push(block);
  };

  const settled = await Promise.allSettled(queries.map((q) => run(q)));
  for (const s of settled) {
    if (s.status === 'rejected') {
      const msg = String((s.reason as any)?.message || s.reason);
      if (msg.includes('TAVILY_POOL_EXHAUSTED')) break;
    }
  }

  return chunks.join('\n\n').slice(0, MAX_EVIDENCE);
};

export type SilentCompanyIntel = {
  socials: { linkedin?: string; facebook?: string };
  decisionMakers: DecisionMaker[];
  intelNotes: string[];
};

/** 单家公司：静默补社媒主页 + 关键岗位联系人种子（可无邮箱） */
export const gatherSilentCompanyChannelIntel = async (opts: {
  companyName: string;
  domain: string;
  productKeyword?: string;
  country?: string;
  existingDecisionMakers?: DecisionMaker[];
}): Promise<SilentCompanyIntel> => {
  const name = (opts.companyName || '').trim();
  const domain = (opts.domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();
  const out: SilentCompanyIntel = {
    socials: {},
    decisionMakers: opts.existingDecisionMakers || [],
    intelNotes: [],
  };
  if (!name && !domain) return out;

  // 1) 关键岗位联系人（公开检索占位）
  try {
    const located = await locateLinkedInEmployees({
      domain,
      companyName: name,
      productKeyword: opts.productKeyword,
      country: opts.country,
      existing: out.decisionMakers,
      maxQueries: 3,
    });
    // locate 内部已按同公司过滤；再记拒绝数便于排查串公司
    out.decisionMakers = located.decisionMakers;
    if (located.stats.rejectedOffCompany > 0) {
      out.intelNotes.push(`contacts-reject-offco:${located.stats.rejectedOffCompany}`);
    }
    if (located.stats.added > 0) {
      out.intelNotes.push(`contacts+${located.stats.added}`);
    }
  } catch (e) {
    console.warn('[silent-acq] contact locate skipped', e);
  }

  // 1b) 对齐联系人后必挖 WhatsApp + 补职位（公开信息）
  if (out.decisionMakers.length > 0) {
    try {
      const before = out.decisionMakers;
      const waBefore = before.filter((d) => (d.whatsapp || '').trim()).length;
      const titleBefore = before.filter(
        (d) => (d.title || '').trim() && !/待确认|待补充/i.test(d.title)
      ).length;
      const enriched = await enrichDecisionMakersTitleAndWhatsApp({
        domain,
        companyName: name,
        decisionMakers: before,
        limit: 10,
        requireWhatsApp: true,
      });
      out.decisionMakers = enriched;
      const waAfter = enriched.filter((d) => (d.whatsapp || '').trim()).length;
      const titleAfter = enriched.filter(
        (d) => (d.title || '').trim() && !/待确认|待补充/i.test(d.title)
      ).length;
      if (titleAfter > titleBefore) out.intelNotes.push(`titles+${titleAfter - titleBefore}`);
      if (waAfter > waBefore) out.intelNotes.push(`whatsapp+${waAfter - waBefore}`);
      const stillMissingWa = enriched.filter((d) => !(d.whatsapp || '').trim()).length;
      if (stillMissingWa > 0) {
        out.intelNotes.push(`whatsapp-miss:${stillMissingWa}`);
      }
    } catch (e) {
      console.warn('[silent-acq] title/whatsapp enrich skipped', e);
    }
  }

  // 1c) 用本公司「已验证邮箱」规则，为领英对齐、尚无邮箱的职员猜验补邮箱（仅校验通过才写入）
  if (domain && out.decisionMakers.some((d) => !d.emailGuess?.includes('@'))) {
    const hasVerified = out.decisionMakers.some(
      (d) =>
        d.emailGuess?.includes('@') &&
        (!!d.isVerified || String(d.emailStatus || '').toLowerCase() === 'valid')
    );
    if (hasVerified) {
      try {
        const { fillMissingEmailsByPatternGuess } = await import('./emailPatternGuess');
        const filled = await fillMissingEmailsByPatternGuess(out.decisionMakers, {
          domain,
          companyName: name,
          maxPeople: 6,
          useQwen: false, // 有公司规则时优先规则+校验，少烧模型
        });
        if (filled.filled > 0) {
          out.decisionMakers = filled.decisionMakers;
          out.intelNotes.push(`emails+${filled.filled}`);
        }
      } catch (e) {
        console.warn('[silent-acq] pattern email fill skipped', e);
      }
    }
  }

  if (!hasTavilyKey()) return out;

  // 2) 公司主页 / Facebook 公开页
  const socialQueries = [
    domain ? `${name || domain} ${domain} linkedin.com/company` : `${name} linkedin.com/company`,
    `${name || domain} site:facebook.com`,
    opts.productKeyword
      ? `"${name || domain}" ${opts.productKeyword} site:facebook.com`
      : '',
  ]
    .map(adaptSearchQueryForPlatform)
    .filter(Boolean)
    .slice(0, 3);

  for (const q of socialQueries) {
    try {
      const data = await tavilySearch(q, { maxResults: 5, searchDepth: 'basic', includeAnswer: false });
      for (const r of data.results || []) {
        const url = (r.url || '').trim();
        if (!out.socials.linkedin && /linkedin\.com\/company\//i.test(url)) {
          out.socials.linkedin = url.split('?')[0];
        }
        if (!out.socials.facebook && /facebook\.com\//i.test(url) && !/\/posts?\//i.test(url)) {
          out.socials.facebook = url.split('?')[0];
        }
      }
    } catch {
      /* ignore single query */
    }
  }

  return out;
};

/** 把静默情报合并进背调结果（不新增前台字段展示逻辑） */
export const mergeSilentIntelIntoAnalysis = (
  analysis: AnalysisResult,
  intel: SilentCompanyIntel
): AnalysisResult => {
  const socials = {
    ...(analysis.socials || {}),
    linkedin: analysis.socials?.linkedin || intel.socials.linkedin,
    facebook: analysis.socials?.facebook || intel.socials.facebook,
  };
  // 静默侧已含定位+职位/WhatsApp 补全，与背调原列表按字段择优合并
  const dms =
    (intel.decisionMakers?.length || 0) > 0
      ? mergeDecisionMakers(analysis.decisionMakers || [], intel.decisionMakers)
      : analysis.decisionMakers || [];
  let evidenceSummary = analysis.evidenceSummary || '';
  if (
    (intel.socials.facebook || intel.intelNotes.some((n) => /titles|whatsapp|contacts/i.test(n))) &&
    !/公开联系人|企业主页/i.test(evidenceSummary)
  ) {
    evidenceSummary = [evidenceSummary, '已核对公开企业主页与联系人线索']
      .filter(Boolean)
      .join(' · ');
  }
  return {
    ...analysis,
    socials,
    decisionMakers: dms,
    evidenceSummary: evidenceSummary || analysis.evidenceSummary,
    tradeIntelligence: analysis.tradeIntelligence
      ? {
          ...analysis.tradeIntelligence,
          companyLinkedin:
            analysis.tradeIntelligence.companyLinkedin || intel.socials.linkedin || '',
        }
      : analysis.tradeIntelligence,
  };
};

/** 静默海关优先线索（有缓存时） */
export const silentCustomsPriorityLeads = (opts: {
  productKeyword: string;
  country: string;
  limit: number;
}): ClientSearchResult[] =>
  collectInternalLeads({
    productKeyword: opts.productKeyword,
    country: opts.country,
    limit: opts.limit,
  });
