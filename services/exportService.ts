
import { AnalysisResult, KeywordExtractionResult, AutomationResult, DecisionMaker, Client } from '../types';
import { generateConsolidatedEmailStrategy } from './geminiService';
import { getAllFilesFromDB } from './db';
import { abbreviateEmailPlatform } from './permissions';
import { loadCatalogSkus } from './productCatalogTypes';
import {
  buildProductProfileFromAnalysis,
  matchCatalogSkusToClientProfile,
  type CatalogSkuClientHit,
} from './productCatalog';

declare global {
  interface Window {
    PptxGenJS: any;
    JSZip: any;
    saveAs: any;
    XLSX?: any;
    __TP_ENSURE_EXPORT_LIBS?: () => Promise<unknown>;
  }
}

declare const PptxGenJS: any;
declare const XLSX: any;
declare const JSZip: any;
declare const saveAs: any;

/** 首屏不再预拉导出 CDN；导出前再确保加载 */
const ensureExportLibs = async (): Promise<void> => {
  try {
    if (typeof window.__TP_ENSURE_EXPORT_LIBS === 'function') {
      await window.__TP_ENSURE_EXPORT_LIBS();
    }
  } catch (e) {
    console.warn('[export] ensure libs failed', e);
  }
};

const getXLSX = (): any => {
  try {
    if (typeof XLSX !== 'undefined' && XLSX) return XLSX;
  } catch {
    /* ignore */
  }
  return window.XLSX;
};

/** 与平台背调 UI 对齐：海军底 + 青绿强调，避免旧版蓝紫「AI 模板」感 */
const COLORS = {
    DARK_BG: "0B1F2A",
    ACCENT: "0D9488",
    ACCENT_SOFT: "CCFBF1",
    ACCENT_DEEP: "0F766E",
    TEXT_MAIN: "0F172A",
    TEXT_MUTED: "64748B",
    BG_PAGE: "F1F5F9",
    BG_CARD: "FFFFFF",
    BORDER: "E2E8F0",
    SUCCESS: "059669",
    WARNING: "D97706",
    ERROR: "DC2626",
    /** 兼容旧引用 */
    ACCENT_BLUE: "0D9488",
    ACCENT_PURPLE: "0F766E",
    BG_LIGHT: "F8FAFC",
};

const PPT_FONT = 'Microsoft YaHei';
const CONTENT_TOP = 0.95;
const CONTENT_BOTTOM = 5.15;
const MARGIN_X = 0.4;

const bodyTextOpts = (fontSize = 11) => ({
    fontSize,
    color: COLORS.TEXT_MAIN,
    fontFace: PPT_FONT,
    valign: 'top' as const,
    wrap: true,
    margin: 0,
    lineSpacing: Math.round(fontSize * 1.45),
});

const EMPTY_RE =
  /^(n\/a|na|n\.a\.|暂无|暂无数据|公开信息未找到|未找到|无|none|null|undefined|unknown|待补充|—|–|-|\/|\.)$/i;

const sanitize = (str: any): string => {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') return String(str).replace(/\0/g, '').trim();
    return str.replace(/\0/g, '').replace(/\r\n/g, '\n').trim();
};

const isMeaningful = (str: any): boolean => {
    const t = sanitize(str);
    if (!t) return false;
    if (EMPTY_RE.test(t)) return false;
    if (/^公开信息未找到/.test(t)) return false;
    return true;
};

const textOf = (str: any, fallback = ''): string =>
  isMeaningful(str) ? sanitize(str) : fallback;

const listOf = (arr?: any[]): string[] =>
  (arr || []).map((x) => sanitize(x)).filter((x) => isMeaningful(x));

const hostOfUrl = (url: string): string => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return sanitize(url).slice(0, 40);
  }
};

const evidenceSourceLabel = (src?: string): string => {
  const s = (src || '').toLowerCase();
  if (s === 'official') return '官网';
  if (s === 'social') return '社交';
  if (s === 'ai') return '推断';
  if (s === 'tavily' || s === 'anysearch' || s === 'other') return '公开检索';
  return '公开来源';
};

const formatExportTime = (ms?: number) => {
    if (!ms || !Number.isFinite(ms)) return '';
    try {
        return new Date(ms).toLocaleString('zh-CN', { hour12: false });
    } catch {
        return '';
    }
};

/**
 * Export Clients to Excel (CRM) — one row per contact (company fields repeated).
 * Columns: company, type, industry, country, keyword source, contact, email, phone, title, etc.
 */
export const exportClientsToExcel = async (clients: Client[]) => {
    await ensureExportLibs();
    const X = getXLSX();
    if (!X) {
        alert("Excel 引擎加载中，请稍后再试。");
        return;
    }

    if (clients.length === 0) {
        alert("No clients to export.");
        return;
    }

    const rows: Record<string, string | number>[] = [];
    for (const c of clients) {
        const keywordSource = [
            c.searchKeyword,
            ...(c.searchedKeywords || []),
            ...(c.tags || []).filter((t) => typeof t === 'string' && t.startsWith('关键词:')),
        ]
            .filter(Boolean)
            .map((s) => String(s).replace(/^关键词:/, ''))
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .join(' | ');

        const base = {
            客户公司名: c.name || '',
            客户类型: c.type || '',
            公司所属行业: c.industry || '',
            所属国家: c.country || '',
            网址: c.website || '',
            关键词搜索来源: keywordSource,
            跟进状态: c.status || '',
            产品类型: c.productType || '',
            已背调: c.hasBackgroundCheck || c.hasAnalyzed ? '是' : '否',
            背调时间: formatExportTime(c.lastBackgroundCheckAt),
            下次跟进: c.nextFollowUpDate || '',
            标签: (c.tags || []).join(' | '),
        };

        const contacts = c.contacts?.filter(Boolean) || [];
        if (contacts.length === 0) {
            rows.push({
                ...base,
                联系人名称: '',
                职位: '',
                邮箱地址: '',
                电话: '',
                LinkedIn: '',
                邮箱来源: '',
                邮箱状态: '',
            });
            continue;
        }
        for (const dm of contacts) {
            rows.push({
                ...base,
                联系人名称: dm.name || '',
                职位: dm.title || '',
                邮箱地址: dm.emailGuess || '',
                电话: dm.phone || '',
                LinkedIn: dm.linkedin || '',
                邮箱来源: abbreviateEmailPlatform(dm.emailSource || dm.source),
                邮箱状态: dm.emailStatus || (dm.isVerified ? 'valid' : ''),
            });
        }
    }

    const ws = X.utils.json_to_sheet(rows);
    const keys = Object.keys(rows[0] || {});
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(36, Math.max(12, k.length + 4)) }));

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "客户资料");
    X.writeFile(wb, `CRM_客户资料_${Date.now()}.xlsx`);
};

/**
 * Export completed automation / 背调 queue rows to Excel (same column schema as CRM).
 */
export const exportAutomationResultsToExcel = (tasks: AutomationResult[]) => {
    const clients: Client[] = tasks
        .filter((t) => t.status === 'completed' && t.analysis)
        .map((t) => {
            const a = t.analysis!;
            return {
                id: t.id,
                name: a.companyInfo?.name || t.clientName || '',
                website: a.companyInfo?.website || t.website || '',
                country: a.searchCountry || t.country || a.companyInfo?.city || '',
                type: '进口商' as const,
                status: '新建/潜在' as const,
                productType: a.searchKeyword || t.keyword || '',
                industry: a.companyInfo?.nature || '',
                priceRange: '',
                isSampleNeeded: false,
                hasBackgroundCheck: true,
                hasAnalyzed: true,
                lastBackgroundCheckAt: t.completedAt || t.createdAt,
                lastOrderDate: '',
                lastContactSent: '',
                lastContactReceived: '',
                nextFollowUpDate: '',
                activityLog: '',
                contacts: a.decisionMakers || [],
                searchKeyword: a.searchKeyword || t.keyword,
                searchedKeywords: a.searchKeyword ? [a.searchKeyword] : undefined,
                tags: a.searchTags || [],
            } satisfies Client;
        });
    exportClientsToExcel(clients);
};

/**
 * Export Contacts to Excel
 */
export const exportContactsToExcel = async (contacts: DecisionMaker[], companyName: string) => {
    await ensureExportLibs();
    const X = getXLSX();
    if (!X) {
        alert("Excel 引擎加载中，请稍后再试。");
        return;
    }

    const data = contacts.map(c => ({
        Name: c.name,
        Title: c.title,
        Email: c.emailGuess || '',
        Type: c.type,
        ContactSource: c.source,
        EmailSource: abbreviateEmailPlatform(c.emailSource || c.source),
        EmailStatus: c.emailStatus || (c.isVerified ? 'valid' : 'unverified'),
        Verified: c.isVerified ? 'Yes' : 'No',
        LinkedIn: c.linkedin || ''
    }));

    const ws = X.utils.json_to_sheet(data);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Contacts");
    
    const safeName = companyName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    X.writeFile(wb, `${safeName}_Contacts_${Date.now()}.xlsx`);
};

/**
 * Export Keywords to Excel
 */
export const exportKeywordsToExcel = async (result: KeywordExtractionResult) => {
    await ensureExportLibs();
    const X = getXLSX();
    if (!X) {
        alert("Excel 引擎加载中，请稍后再试。");
        return;
    }

    const maxLen = Math.max(result.industryTerms.length, result.tier1Keywords.length, result.tier2Keywords.length);
    const data = [];
    for (let i = 0; i < maxLen; i++) {
        data.push({
            "Industry Terms": result.industryTerms[i] || "",
            "Tier 1 (High Intent)": result.tier1Keywords[i] || "",
            "Tier 2 (Long Tail)": result.tier2Keywords[i] || ""
        });
    }

    const ws = X.utils.json_to_sheet(data);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Keywords");
    
    X.writeFile(wb, `Keywords_Analysis_${Date.now()}.xlsx`);
};

/**
 * Standard Company Analysis PPT (Single)
 */
export const exportToPPT = async (data: AnalysisResult) => {
  try {
    await ensureExportLibs();
    if (!window.PptxGenJS) {
        alert("PPT 引擎加载中，请稍后再试。");
        return;
    }
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = '外贸智慧协同';
    pptx.title = sanitize(data.companyInfo.name);

    generateAnalysisSlides(pptx, data);
    
    // For single export, we still include the email strategy if it exists
    if (data.generatedEmails) {
        addEmailStrategySlidesFromGroup(pptx, data.generatedEmails);
    }

    const safeName = sanitize(data.companyInfo.name).replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    pptx.writeFile({ fileName: `${safeName}_背调报告_${Date.now()}.pptx` });
  } catch (e: any) {
    console.error("PPT Export Error", e);
    alert(`Failed to generate PPT: ${e.message}`);
  }
};

/**
 * BATCH EXPORT ANALYSIS REPORTS (FROM CRM)
 * Takes pure AnalysisResult objects.
 */
export const exportBatchAnalysisToPPT = async (analyses: AnalysisResult[]) => {
    await ensureExportLibs();
    if (!window.PptxGenJS || !window.JSZip || !window.saveAs) {
        alert("导出引擎加载中，请稍后再试。");
        return;
    }

    if (analyses.length === 0) {
        alert("没有可用的分析报告数据 (No analysis data provided).");
        return;
    }

    try {
        const zip = new JSZip();
        const folder = zip.folder("Analysis_Reports");

        for (const analysis of analyses) {
            const pptx = new PptxGenJS();
            pptx.layout = 'LAYOUT_16x9';
            pptx.author = '外贸智慧协同';
            pptx.title = `${sanitize(analysis.companyInfo.name)} Analysis`;

            generateAnalysisSlides(pptx, analysis);
            
            // If email strategy exists in the analysis object, add it
            if (analysis.generatedEmails) {
                addEmailStrategySlidesFromGroup(pptx, analysis.generatedEmails);
            }

            const blob = await pptx.write({ outputType: 'blob' });
            const safeName = sanitize(analysis.companyInfo.name).replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
            folder.file(`${safeName}_Analysis.pptx`, blob);
        }

        // Generate Master Strategy from all analyses
        // NOTE: This uses the first client's "businessScope" as rudimentary context if available
        const strategyPptx = new PptxGenJS();
        strategyPptx.layout = 'LAYOUT_16x9';
        strategyPptx.author = '外贸智慧协同';
        strategyPptx.title = `Master Outreach Strategy`;

        const slide = strategyPptx.addSlide();
        slide.background = { color: COLORS.DARK_BG };
        slide.addText("MASTER OUTREACH STRATEGY", { x: 0.5, y: 1.5, fontSize: 36, bold: true, color: "FFFFFF", align: 'center' });
        slide.addText("批量客户开发策略汇总", { x: 0.5, y: 2.2, fontSize: 24, color: "CBD5E1", align: 'center' });

        // Try to generate a consolidated strategy if we have KB files
        try {
           let kbFiles = [];
           try { kbFiles = await getAllFilesFromDB(); } catch(e) {
               console.warn("Failed to get files from DB", e);
           }
           
           if (kbFiles.length > 0) {
               const mailGroup = await generateConsolidatedEmailStrategy(analyses, kbFiles, "Consolidated CRM Batch");
               addEmailStrategySlidesFromGroup(strategyPptx, mailGroup);
           }
        } catch(e) {
            console.error("Failed to generate consolidated strategy for batch", e);
        }

        const strategyBlob = await strategyPptx.write({ outputType: 'blob' });
        zip.file("Master_Strategy_Suggestion.pptx", strategyBlob);

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `Batch_Analysis_Reports_${Date.now()}.zip`);

    } catch (e: any) {
        console.error("Batch Analysis Export Error", e);
        alert(`Failed to generate Zip: ${e.message}`);
    }
};

/**
 * AUTOMATION FULL REPORT PPT (Single)
 */
export const exportAutomationReportToPPT = async (result: AutomationResult) => {
    await ensureExportLibs();
    if (!window.PptxGenJS) {
        alert("PPT 引擎加载中，请稍后再试。");
        return;
    }
    
    if (!result.analysis) {
        alert("分析数据不完整，无法生成报告。");
        return;
    }

    try {
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';
        pptx.author = '外贸智慧协同';
        pptx.title = `${sanitize(result.clientName)} - 开发报告`;

        addAutomationSlides(pptx, result);

        const safeName = sanitize(result.clientName).replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
        pptx.writeFile({ fileName: `${safeName}_开发报告_${Date.now()}.pptx` });

    } catch (e: any) {
        console.error("Full Report Gen Error", e);
        alert(`Failed to generate Full Report PPT: ${e.message}`);
    }
};

/**
 * BATCH EXPORT: 
 * 1. Individual Analysis PPTs for each client.
 * 2. ONE Separate PPT for Email Strategy (Consolidated or Collection).
 */
export const exportBatchAutomationReportsToPPT = async (results: AutomationResult[]) => {
    const completed = results.filter(r => r.status === 'completed' && r.analysis);
    const analyses = completed.map(r => r.analysis).filter(Boolean) as AnalysisResult[];
    if (analyses.length === 0) {
         alert("没有已完成的报告可供导出 (No completed reports).");
         return;
    }
    await exportBatchAnalysisToPPT(analyses);
};

// --- INTERNAL HELPERS ---

const addAutomationSlides = (pptx: any, result: AutomationResult) => {
  if (result.analysis) {
    generateAnalysisSlides(pptx, result.analysis);
  }
  if (result.mailGroup) {
    addEmailStrategySlidesFromGroup(pptx, result.mailGroup);
  }
};

const addEmailStrategySlidesFromGroup = (pptx: any, mailGroup: any) => {
  if (!mailGroup) return;
  const analysisText = [textOf(mailGroup.analysis), mailGroup.sendTip ? `发送提示: ${textOf(mailGroup.sendTip)}` : '']
    .filter(Boolean)
    .join('\n\n');
  if (!analysisText && !textOf(mailGroup.email1) && !textOf(mailGroup.email2) && !textOf(mailGroup.email3)) {
    return;
  }

  if (analysisText) {
    const slide = pptx.addSlide();
    paintSlideChrome(pptx, slide, '开发信策略', sanitize((mailGroup as any)?.companyName || ''));
    addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 9.2, 4.0);
    slide.addText('策略逻辑', {
      x: MARGIN_X + 0.2,
      y: CONTENT_TOP + 0.15,
      w: 8.8,
      h: 0.32,
      fontSize: 13,
      bold: true,
      color: COLORS.ACCENT,
      fontFace: PPT_FONT,
      margin: 0,
    });
    slide.addText(analysisText, {
      x: MARGIN_X + 0.2,
      y: CONTENT_TOP + 0.55,
      w: 8.8,
      h: 3.3,
      ...bodyTextOpts(11),
    });
  }

  if (textOf(mailGroup.email1)) createEmailSlide(pptx, 'Email 1 · 匹配破冰', mailGroup.email1, mailGroup.subject1);
  if (textOf(mailGroup.email2)) createEmailSlide(pptx, 'Email 2 · 实力证明', mailGroup.email2, mailGroup.subject2);
  if (textOf(mailGroup.email3)) createEmailSlide(pptx, 'Email 3 · 钩子收口', mailGroup.email3, mailGroup.subject3);
};

const createEmailSlide = (pptx: any, title: string, content: string, subject?: string) => {
  if (!textOf(content) && !textOf(subject)) return;
  const slide = pptx.addSlide();
  paintSlideChrome(pptx, slide, title);
  addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 9.2, 4.0);
  const body = textOf(subject) ? `Subject: ${textOf(subject)}\n\n${textOf(content)}` : textOf(content);
  slide.addText(body, {
    x: MARGIN_X + 0.25,
    y: CONTENT_TOP + 0.25,
    w: 8.7,
    h: 3.5,
    ...bodyTextOpts(11),
  });
};

const paintSlideChrome = (pptx: any, slide: any, title: string, companyName = '') => {
  slide.background = { color: COLORS.BG_PAGE };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.78,
    fill: COLORS.DARK_BG,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.12,
    h: 0.78,
    fill: COLORS.ACCENT,
  });
  slide.addText(title, {
    x: 0.35,
    y: 0.18,
    w: 9.2,
    h: 0.42,
    fontSize: 22,
    bold: true,
    color: 'FFFFFF',
    fontFace: PPT_FONT,
    valign: 'middle',
    margin: 0,
  });
  const foot = companyName
    ? `外贸智慧协同 · 产品链接客户 | ${companyName}`
    : '外贸智慧协同 · 产品链接客户';
  slide.addText(foot, {
    x: MARGIN_X,
    y: 5.28,
    w: 9.2,
    h: 0.25,
    fontSize: 9,
    color: '94A3B8',
    align: 'center',
    fontFace: PPT_FONT,
    margin: 0,
  });
};

const addCard = (pptx: any, slide: any, x: number, y: number, w: number, h: number, fill = COLORS.BG_CARD) => {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: fill,
    line: { color: COLORS.BORDER, width: 1 },
    rectRadius: 0.08,
  });
};

const addSectionLabel = (slide: any, text: string, x: number, y: number, w: number, color = COLORS.ACCENT) => {
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.3,
    fontSize: 13,
    bold: true,
    color,
    fontFace: PPT_FONT,
    margin: 0,
  });
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const resolveOurSkuMatches = (data: AnalysisResult): CatalogSkuClientHit[] => {
  try {
    const skus = loadCatalogSkus();
    if (!skus.length) return [];
    const profile = buildProductProfileFromAnalysis(data, {});
    if (!profile) return [];
    return matchCatalogSkusToClientProfile(skus, profile, { limit: 12, minScore: 20 });
  } catch (e) {
    console.warn('[export PPT] sku match skipped', e);
    return [];
  }
};

/**
 * CORE ANALYSIS SLIDES — 以「产品分析 + 产品×客户匹配」为主轴
 */
const generateAnalysisSlides = (pptx: any, data: AnalysisResult) => {
  const company = textOf(data.companyInfo?.name, '目标客户');
  const website = textOf(data.companyInfo?.website);
  const hq = textOf(data.companyInfo?.headquarters);
  const city = textOf(data.companyInfo?.city);
  const keyword = textOf(data.searchKeyword);
  const country = textOf(data.searchCountry);
  const products = (data.products || []).filter((p) => isMeaningful(p?.name));
  const keywordProducts = products.filter((p) => p.keywordMatch);
  const categories = (data.websiteCategories || []).filter((c) => isMeaningful(c?.categoryName));
  const skuHits = resolveOurSkuMatches(data);
  const sellCats = listOf(data.productIntel?.sell?.categories);
  const procureCats = listOf(data.productIntel?.procure?.categories);
  const sellTags = listOf(data.productIntel?.sell?.tags);
  const procureTags = listOf(data.productIntel?.procure?.tags);
  const coreProducts = listOf(data.businessScope?.coreProducts);
  const channels = listOf(data.businessModel?.channels);
  const actionPlan = listOf(data.strategy?.actionPlan);
  const dms = (data.decisionMakers || []).filter((d) => isMeaningful(d?.name) || isMeaningful(d?.emailGuess));
  const similar = (data.similarCompanies || []).filter((c) => isMeaningful(c?.name));
  const evidence = (data.evidenceChain || []).filter((e) => isMeaningful(e?.title) || isMeaningful(e?.url));
  const ps = data.productSummary;
  const hasProductSummary = !!(
    textOf(ps?.marketPreference) ||
    textOf(ps?.recommendedProducts) ||
    textOf(ps?.packagingAnalysis) ||
    textOf(ps?.colorPreference) ||
    textOf(ps?.featureAnalysis)
  );

  // —— 1. 封面：突出产品链接客户 ——
  {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.DARK_BG };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.14,
      h: 5.625,
      fill: COLORS.ACCENT,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 7.6,
      y: 0,
      w: 2.4,
      h: 5.625,
      fill: '082028',
    });
    slide.addText('外贸智慧协同', {
      x: 0.55,
      y: 0.55,
      w: 6.5,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: COLORS.ACCENT,
      fontFace: PPT_FONT,
      margin: 0,
    });
    slide.addText(company, {
      x: 0.55,
      y: 1.35,
      w: 6.8,
      h: 1.0,
      fontSize: 34,
      bold: true,
      color: 'FFFFFF',
      fontFace: PPT_FONT,
      margin: 0,
      valign: 'middle',
    });
    slide.addText('背调报告 · 产品链接客户', {
      x: 0.55,
      y: 2.45,
      w: 6.8,
      h: 0.4,
      fontSize: 18,
      color: 'CBD5E1',
      fontFace: PPT_FONT,
      margin: 0,
    });
    const metaBits = [
      website ? `官网 ${website}` : '',
      hq || city ? `总部 ${hq || city}` : '',
      country ? `市场 ${country}` : '',
      keyword ? `关键词 ${keyword}` : '',
      new Date().toLocaleDateString('zh-CN'),
    ].filter(Boolean);
    slide.addText(metaBits.join('  ·  '), {
      x: 0.55,
      y: 4.55,
      w: 6.8,
      h: 0.4,
      fontSize: 11,
      color: '94A3B8',
      fontFace: PPT_FONT,
      margin: 0,
    });
    const kpis: Array<{ label: string; value: string }> = [];
    if (products.length) kpis.push({ label: '客户产品', value: String(products.length) });
    if (categories.length) kpis.push({ label: '官网品类', value: String(categories.length) });
    if (skuHits.length) kpis.push({ label: '我方匹配', value: String(skuHits.length) });
    if (keywordProducts.length) kpis.push({ label: '关键词命中', value: String(keywordProducts.length) });
    kpis.slice(0, 4).forEach((k, i) => {
      const y = 0.7 + i * 1.05;
      slide.addText(k.value, {
        x: 7.85,
        y,
        w: 1.9,
        h: 0.45,
        fontSize: 28,
        bold: true,
        color: COLORS.ACCENT,
        fontFace: PPT_FONT,
        align: 'center',
        margin: 0,
      });
      slide.addText(k.label, {
        x: 7.85,
        y: y + 0.42,
        w: 1.9,
        h: 0.28,
        fontSize: 11,
        color: '94A3B8',
        fontFace: PPT_FONT,
        align: 'center',
        margin: 0,
      });
    });
  }

  // —— 2. 企业速览（仅有实质字段时） ——
  {
    const rows: Array<[string, string]> = [
      ['成立时间', textOf(data.companyInfo?.foundedYear)],
      ['企业性质', textOf(data.companyInfo?.nature)],
      ['人员规模', textOf(data.companyInfo?.scale)],
      ['总部 / 城市', [hq, city].filter(Boolean).join(' / ')],
      ['官网', website],
    ].filter(([, v]) => isMeaningful(v)) as Array<[string, string]>;
    const desc = textOf(data.companyInfo?.description);
    if (rows.length || desc) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '01  企业速览', company);
      if (rows.length) {
        addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 4.3, 4.0);
        addSectionLabel(slide, '基本信息', MARGIN_X + 0.2, CONTENT_TOP + 0.15, 3.9);
        const table = rows.map(([k, v]) => [
          { text: k, options: { bold: true, color: COLORS.TEXT_MUTED, fill: 'F8FAFC'  } },
          { text: v, options: { color: COLORS.TEXT_MAIN } },
        ]);
        slide.addTable(table, {
          x: MARGIN_X + 0.2,
          y: CONTENT_TOP + 0.55,
          w: 3.9,
          colW: [1.3, 2.6],
          fontSize: 11,
          fontFace: PPT_FONT,
          border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: COLORS.BORDER }, { pt: 0 }],
          valign: 'middle',
          rowH: Math.min(0.55, 3.2 / Math.max(rows.length, 1)),
        });
      }
      if (desc) {
        const x = rows.length ? 4.95 : MARGIN_X;
        const w = rows.length ? 4.65 : 9.2;
        addCard(pptx, slide, x, CONTENT_TOP, w, 4.0);
        addSectionLabel(slide, '企业简介', x + 0.2, CONTENT_TOP + 0.15, w - 0.4);
        slide.addText(desc, {
          x: x + 0.2,
          y: CONTENT_TOP + 0.55,
          w: w - 0.4,
          h: 3.25,
          ...bodyTextOpts(12),
        });
      }
    }
  }

  // —— 3. 证据链（有则写） ——
  if (evidence.length) {
    const slide = pptx.addSlide();
    paintSlideChrome(pptx, slide, '02  证据链 · 公开来源', company);
    const conf = data.evidenceConfidence;
    const summary = textOf(data.evidenceSummary) || textOf(data.decisionEnrichment?.summaryZh);
    if (summary || conf != null) {
      addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 9.2, 0.7, COLORS.ACCENT_SOFT);
      const confTxt = conf != null && Number.isFinite(conf) ? `可信度 ${Math.round(conf * 100)}%` : '';
      slide.addText([confTxt, summary].filter(Boolean).join('  ·  '), {
        x: MARGIN_X + 0.2,
        y: CONTENT_TOP + 0.18,
        w: 8.8,
        h: 0.4,
        fontSize: 12,
        color: COLORS.ACCENT_DEEP,
        fontFace: PPT_FONT,
        margin: 0,
      });
    }
    const items = evidence.slice(0, 9);
    const cols = 3;
    const cardW = 2.95;
    const cardH = 1.15;
    const gap = 0.15;
    const startY = summary || conf != null ? CONTENT_TOP + 0.9 : CONTENT_TOP;
    items.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN_X + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      if (y + cardH > CONTENT_BOTTOM) return;
      addCard(pptx, slide, x, y, cardW, cardH);
      slide.addText(evidenceSourceLabel(e.source), {
        x: x + 0.12,
        y: y + 0.1,
        w: cardW - 0.24,
        h: 0.22,
        fontSize: 10,
        bold: true,
        color: COLORS.ACCENT,
        fontFace: PPT_FONT,
        margin: 0,
      });
      slide.addText(textOf(e.title) || hostOfUrl(e.url || ''), {
        x: x + 0.12,
        y: y + 0.35,
        w: cardW - 0.24,
        h: 0.65,
        ...bodyTextOpts(11),
      });
    });
  }

  // —— 4. 客户产品画像（核心） ——
  {
    const hasIntel = sellCats.length || procureCats.length || sellTags.length || procureTags.length || coreProducts.length;
    if (hasIntel || textOf(data.businessScope?.brandPositioning) || textOf(data.businessModel?.procurementInfo)) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '03  客户产品画像（链接核心）', company);

      addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 4.5, 4.0);
      addSectionLabel(slide, '在售 / 分销侧', MARGIN_X + 0.18, CONTENT_TOP + 0.15, 4.1);
      const sellBody = [
        sellCats.length ? `品类：${sellCats.slice(0, 12).join('、')}` : '',
        sellTags.length ? `标签：${sellTags.slice(0, 12).join('、')}` : '',
        coreProducts.length && !sellCats.length ? `核心产品：${coreProducts.slice(0, 10).join('、')}` : '',
        textOf(data.businessScope?.brandPositioning) ? `定位：${textOf(data.businessScope.brandPositioning)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      slide.addText(sellBody || '暂无在售侧结构化品类（见官网品类/产品明细页）', {
        x: MARGIN_X + 0.18,
        y: CONTENT_TOP + 0.55,
        w: 4.15,
        h: 3.25,
        ...bodyTextOpts(11),
      });

      addCard(pptx, slide, 5.15, CONTENT_TOP, 4.45, 4.0);
      addSectionLabel(slide, '采购 / 进口侧', 5.35, CONTENT_TOP + 0.15, 4.1, COLORS.ACCENT_DEEP);
      const buyBody = [
        procureCats.length ? `采购品类：${procureCats.slice(0, 12).join('、')}` : '',
        procureTags.length ? `标签：${procureTags.slice(0, 10).join('、')}` : '',
        textOf(data.businessModel?.procurementInfo) ? `采购习惯：${textOf(data.businessModel.procurementInfo)}` : '',
        textOf(data.supplyChain?.role) ? `供应链角色：${textOf(data.supplyChain.role)}` : '',
        listOf(data.targetAudience).length ? `目标客群：${listOf(data.targetAudience).join('、')}` : '',
        textOf(data.productIntel?.sourceNote) ? `说明：${textOf(data.productIntel?.sourceNote)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      slide.addText(buyBody || '暂无采购侧结构化线索', {
        x: 5.35,
        y: CONTENT_TOP + 0.55,
        w: 4.05,
        h: 3.25,
        ...bodyTextOpts(11),
      });
    }
  }

  // —— 5. 市场喜好与产品策略（核心） ——
  if (hasProductSummary && ps) {
    const blocks: Array<{ title: string; body: string }> = [
      { title: '终端市场喜好', body: textOf(ps.marketPreference) },
      { title: '推荐切入产品', body: textOf(ps.recommendedProducts) },
      { title: '功能 / 卖点', body: textOf(ps.featureAnalysis) },
      { title: '包装偏好', body: textOf(ps.packagingAnalysis) },
      { title: '颜色偏好', body: textOf(ps.colorPreference) },
    ].filter((b) => b.body);

    const pages = chunk(blocks, 4);
    pages.forEach((pageBlocks, pageIdx) => {
      const slide = pptx.addSlide();
      paintSlideChrome(
        pptx,
        slide,
        pages.length > 1 ? `04  市场喜好与产品策略 (${pageIdx + 1}/${pages.length})` : '04  市场喜好与产品策略',
        company
      );
      pageBlocks.forEach((b, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MARGIN_X + col * 4.7;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 4.5, 1.85);
        addSectionLabel(slide, b.title, x + 0.18, y + 0.12, 4.1);
        slide.addText(b.body, {
          x: x + 0.18,
          y: y + 0.48,
          w: 4.15,
          h: 1.22,
          ...bodyTextOpts(11),
        });
      });
    });
  }

  // —— 6. 官网品类一览（核心） ——
  if (categories.length) {
    const perPage = 9;
    chunk(categories, perPage).forEach((page, pageIdx) => {
      const slide = pptx.addSlide();
      const totalPages = Math.ceil(categories.length / perPage);
      paintSlideChrome(
        pptx,
        slide,
        totalPages > 1
          ? `05  官网品类一览 · ${categories.length} 类 (${pageIdx + 1}/${totalPages})`
          : `05  官网品类一览 · ${categories.length} 类`,
        company
      );
      page.forEach((cat, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MARGIN_X + col * 3.1;
        const y = CONTENT_TOP + row * 1.3;
        addCard(pptx, slide, x, y, 2.95, 1.18);
        const price =
          textOf(cat.priceBand) ||
          (cat.priceMinCNY != null && cat.priceMaxCNY != null
            ? `¥${cat.priceMinCNY}–${cat.priceMaxCNY}`
            : '');
        slide.addText(textOf(cat.categoryName), {
          x: x + 0.12,
          y: y + 0.1,
          w: price ? 1.7 : 2.7,
          h: 0.32,
          fontSize: 12,
          bold: true,
          color: COLORS.TEXT_MAIN,
          fontFace: PPT_FONT,
          margin: 0,
        });
        if (price) {
          slide.addShape(pptx.ShapeType.roundRect, {
            x: x + 1.85,
            y: y + 0.1,
            w: 0.95,
            h: 0.28,
            fill: COLORS.ACCENT_SOFT,
            line: { color: COLORS.ACCENT_SOFT },
            rectRadius: 0.08,
          });
          slide.addText(price, {
            x: x + 1.85,
            y: y + 0.1,
            w: 0.95,
            h: 0.28,
            fontSize: 9,
            bold: true,
            color: COLORS.ACCENT_DEEP,
            align: 'center',
            valign: 'middle',
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        const items = listOf(cat.items).slice(0, 6).join(' · ');
        slide.addText(items || '—', {
          x: x + 0.12,
          y: y + 0.48,
          w: 2.7,
          h: 0.58,
          ...bodyTextOpts(10),
          color: COLORS.TEXT_MUTED,
        });
      });
    });
  }

  // —— 7. 客户产品明细（核心，关键词命中优先） ——
  if (products.length) {
    const ordered = [
      ...keywordProducts,
      ...products.filter((p) => !p.keywordMatch),
    ];
    const perPage = 4;
    chunk(ordered, perPage).forEach((page, pageIdx) => {
      const slide = pptx.addSlide();
      const totalPages = Math.ceil(ordered.length / perPage);
      paintSlideChrome(
        pptx,
        slide,
        totalPages > 1
          ? `06  客户产品明细 · ${products.length} SKU (${pageIdx + 1}/${totalPages})`
          : `06  客户产品明细 · ${products.length} SKU`,
        company
      );
      page.forEach((prod, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MARGIN_X + col * 4.7;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 4.5, 1.85);
        const title = textOf(prod.name);
        slide.addText(title, {
          x: x + 0.15,
          y: y + 0.1,
          w: 3.0,
          h: 0.32,
          fontSize: 12,
          bold: true,
          color: COLORS.TEXT_MAIN,
          fontFace: PPT_FONT,
          margin: 0,
        });
        const priceBits = [
          textOf(prod.retailPrice) ? `${textOf(prod.retailPrice)}` : '',
          prod.estimatedFOBPriceCNY ? `FOB≈¥${prod.estimatedFOBPriceCNY}` : '',
          prod.priceMinCNY != null && prod.priceMaxCNY != null
            ? `区间¥${prod.priceMinCNY}-${prod.priceMaxCNY}`
            : '',
        ].filter(Boolean);
        if (priceBits.length) {
          slide.addText(priceBits.join(' · '), {
            x: x + 3.1,
            y: y + 0.1,
            w: 1.25,
            h: 0.32,
            fontSize: 10,
            bold: true,
            color: COLORS.ACCENT_DEEP,
            align: 'right',
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        const tags: string[] = [];
        if (prod.keywordMatch) tags.push('关键词相关');
        if (textOf(prod.category)) tags.push(textOf(prod.category));
        if (tags.length) {
          slide.addText(tags.join(' · '), {
            x: x + 0.15,
            y: y + 0.42,
            w: 4.2,
            h: 0.22,
            fontSize: 10,
            color: COLORS.ACCENT,
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        const detail = [
          textOf(prod.features) ? `功能：${textOf(prod.features)}` : '',
          textOf(prod.colors) ? `颜色：${textOf(prod.colors)}` : '',
          textOf(prod.packaging) ? `包装：${textOf(prod.packaging)}` : '',
          textOf(prod.pitchPoint) ? `切入：${textOf(prod.pitchPoint)}` : '',
          textOf(prod.pricingStrategy) ? `定价：${textOf(prod.pricingStrategy)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        if (detail) {
          slide.addText(detail, {
            x: x + 0.15,
            y: y + 0.68,
            w: 4.2,
            h: 1.05,
            ...bodyTextOpts(10),
          });
        }
      });
    });
  }

  // —— 8. 我方产品匹配（差异化核心） ——
  if (skuHits.length) {
    const perPage = 6;
    chunk(skuHits, perPage).forEach((page, pageIdx) => {
      const slide = pptx.addSlide();
      const totalPages = Math.ceil(skuHits.length / perPage);
      paintSlideChrome(
        pptx,
        slide,
        totalPages > 1
          ? `07  推荐我方产品 · 匹配 ${skuHits.length} (${pageIdx + 1}/${totalPages})`
          : `07  推荐我方产品 · 匹配 ${skuHits.length}`,
        company
      );
      page.forEach((hit, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MARGIN_X + col * 3.1;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 2.95, 1.85);
        const name = textOf(hit.sku.name) || textOf(hit.sku.skuCode) || 'SKU';
        slide.addText(name, {
          x: x + 0.12,
          y: y + 0.1,
          w: 2.0,
          h: 0.4,
          fontSize: 12,
          bold: true,
          color: COLORS.TEXT_MAIN,
          fontFace: PPT_FONT,
          margin: 0,
        });
        slide.addShape(pptx.ShapeType.roundRect, {
          x: x + 2.05,
          y: y + 0.12,
          w: 0.75,
          h: 0.28,
          fill: hit.score >= 80 ? 'D1FAE5' : hit.score >= 60 ? 'FEF3C7' : COLORS.ACCENT_SOFT,
          line: { color: COLORS.BORDER, width: 0 },
          rectRadius: 0.08,
        });
        slide.addText(String(Math.round(hit.score)), {
          x: x + 2.05,
          y: y + 0.12,
          w: 0.75,
          h: 0.28,
          fontSize: 11,
          bold: true,
          color: COLORS.ACCENT_DEEP,
          align: 'center',
          valign: 'middle',
          fontFace: PPT_FONT,
          margin: 0,
        });
        const meta = [
          textOf(hit.sku.skuCode) ? `编码 ${textOf(hit.sku.skuCode)}` : '',
          hit.priceOverlap ? '价格带重合' : '',
          listOf(hit.matchedCategories).slice(0, 2).join(' / '),
        ]
          .filter(Boolean)
          .join(' · ');
        if (meta) {
          slide.addText(meta, {
            x: x + 0.12,
            y: y + 0.55,
            w: 2.7,
            h: 0.28,
            fontSize: 10,
            color: COLORS.ACCENT,
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        const reasons = listOf(hit.reasons).slice(0, 4).join('；');
        slide.addText(reasons || '与客户品类/关键词匹配', {
          x: x + 0.12,
          y: y + 0.88,
          w: 2.7,
          h: 0.8,
          ...bodyTextOpts(10),
        });
      });
    });
  } else if (products.length || categories.length || hasProductSummary) {
    // 有客户产品但无我方库匹配时，给一页「匹配提示」而不是空页堆砌
    const slide = pptx.addSlide();
    paintSlideChrome(pptx, slide, '07  产品链接建议', company);
    addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 9.2, 4.0);
    const tips = [
      keyword ? `当前关键词「${keyword}」已用于筛选客户产品与切入点。` : '',
      keywordProducts.length
        ? `关键词相关产品 ${keywordProducts.length} 款，优先作为样品/报价切入。`
        : products.length
          ? `客户站内产品 ${products.length} 款，可按品类挑选对标 SKU 做报价包。`
          : '',
      textOf(ps?.recommendedProducts) ? `策略推荐：${textOf(ps?.recommendedProducts)}` : '',
      '提示：在「产品库」维护我方 SKU 后，本页将自动生成「推荐我方产品」匹配清单与得分。',
    ]
      .filter(Boolean)
      .join('\n\n');
    slide.addText(tips, {
      x: MARGIN_X + 0.3,
      y: CONTENT_TOP + 0.4,
      w: 8.6,
      h: 3.3,
      ...bodyTextOpts(13),
    });
  }

  // —— 9. 贸易情报（仅实质行） ——
  if (data.tradeIntelligence) {
    const ti = data.tradeIntelligence;
    const rows: Array<[string, string]> = [
      ['海关 / 进口摘要', textOf(ti.customsSummary)],
      ['HS / 品类', [...listOf(ti.hsCodes), ...listOf(ti.importCategories)].join(' / ')],
      ['来源国', listOf(ti.topSourceCountries).join('、')],
      ['认证合规', listOf(ti.certifications).join('、')],
      ['Incoterms', textOf(ti.preferredIncoterms)],
      ['典型 MOQ', textOf(ti.typicalMoq)],
      ['采购季', textOf(ti.buyingSeasons)],
      ['采购办公室', textOf(data.strategy?.buyingOfficeLocation)],
      [
        '风险',
        [textOf(ti.riskLevel), textOf(ti.riskNotes)].filter(Boolean).join(' — '),
      ],
      ['预估年进口', textOf(ti.estimatedAnnualImport)],
    ].filter(([, v]) => isMeaningful(v)) as Array<[string, string]>;

    if (rows.length) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '08  贸易情报与合规', company);
      addCard(pptx, slide, MARGIN_X, CONTENT_TOP, 9.2, 4.0);
      slide.addTable(
        rows.map(([k, v]) => [
          { text: k, options: { bold: true, color: COLORS.TEXT_MUTED, fill: 'F8FAFC'  } },
          { text: v, options: { color: COLORS.TEXT_MAIN } },
        ]),
        {
          x: MARGIN_X + 0.2,
          y: CONTENT_TOP + 0.25,
          w: 8.8,
          colW: [2.0, 6.8],
          fontSize: 11,
          fontFace: PPT_FONT,
          border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: COLORS.BORDER }, { pt: 0 }],
          valign: 'middle',
          rowH: Math.min(0.42, 3.5 / Math.max(rows.length, 1)),
        }
      );
    }
  }

  // —— 10. 业务模式（有内容才写） ——
  {
    const ecom = listOf(data.businessModel?.ecommercePresence);
    const exhibits = listOf(data.businessModel?.exhibitionHistory);
    const priceSens = textOf(data.businessScope?.priceSensitivity);
    const brand = textOf(data.businessScope?.brandPositioning);
    if (channels.length || ecom.length || exhibits.length || priceSens || brand) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '09  业务模式与渠道', company);
      const blocks: Array<{ t: string; b: string }> = [
        { t: '销售渠道', b: channels.join('、') },
        { t: '电商布局', b: ecom.join('、') },
        { t: '展会足迹', b: exhibits.join('、') },
        { t: '品牌定位', b: brand },
        { t: '价格敏感度', b: priceSens },
      ].filter((x) => x.b);
      blocks.slice(0, 4).forEach((b, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MARGIN_X + col * 4.7;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 4.5, 1.85);
        addSectionLabel(slide, b.t, x + 0.18, y + 0.15, 4.1);
        slide.addText(b.b, {
          x: x + 0.18,
          y: y + 0.55,
          w: 4.15,
          h: 1.15,
          ...bodyTextOpts(12),
        });
      });
    }
  }

  // —— 11. SWOT（仅非空象限） ——
  {
    const quads: Array<{ title: string; items: string[]; color: string; bg: string }> = [
      { title: '优势 Strengths', items: listOf(data.swot?.strengths), color: COLORS.SUCCESS, bg: 'ECFDF5' },
      { title: '劣势 Weaknesses', items: listOf(data.swot?.weaknesses), color: COLORS.ERROR, bg: 'FEF2F2' },
      { title: '机会 Opportunities', items: listOf(data.swot?.opportunities), color: COLORS.ACCENT_DEEP, bg: 'F0FDFA' },
      { title: '威胁 Threats', items: listOf(data.swot?.threats), color: COLORS.WARNING, bg: 'FFFBEB' },
    ].filter((q) => q.items.length);
    if (quads.length) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '10  SWOT 态势', company);
      quads.slice(0, 4).forEach((q, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MARGIN_X + col * 4.7;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 4.5, 1.85, q.bg);
        slide.addShape(pptx.ShapeType.rect, {
          x,
          y,
          w: 0.1,
          h: 1.85,
          fill: q.color,
        });
        slide.addText(q.title, {
          x: x + 0.25,
          y: y + 0.12,
          w: 4.05,
          h: 0.3,
          fontSize: 13,
          bold: true,
          color: q.color,
          fontFace: PPT_FONT,
          margin: 0,
        });
        slide.addText(q.items.map((p) => `• ${p}`).join('\n'), {
          x: x + 0.25,
          y: y + 0.5,
          w: 4.05,
          h: 1.2,
          ...bodyTextOpts(11),
        });
      });
    }
  }

  // —— 12. 行动计划 ——
  if (actionPlan.length) {
    const slide = pptx.addSlide();
    paintSlideChrome(pptx, slide, '11  建议行动计划', company);
    actionPlan.slice(0, 6).forEach((step, idx) => {
      const y = CONTENT_TOP + idx * 0.65;
      if (y + 0.55 > CONTENT_BOTTOM) return;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: MARGIN_X,
        y,
        w: 0.42,
        h: 0.42,
        fill: COLORS.ACCENT,
        rectRadius: 0.1,
      });
      slide.addText(String(idx + 1), {
        x: MARGIN_X,
        y,
        w: 0.42,
        h: 0.42,
        align: 'center',
        valign: 'middle',
        color: 'FFFFFF',
        bold: true,
        fontSize: 12,
        fontFace: PPT_FONT,
        margin: 0,
      });
      addCard(pptx, slide, MARGIN_X + 0.55, y, 8.65, 0.55);
      slide.addText(step, {
        x: MARGIN_X + 0.7,
        y,
        w: 8.35,
        h: 0.55,
        fontSize: 12,
        color: COLORS.TEXT_MAIN,
        fontFace: PPT_FONT,
        valign: 'middle',
        margin: 0,
      });
    });
  }

  // —— 13. 决策人：多列卡片，分页，不溢出 ——
  if (dms.length) {
    const cols = 3;
    const rows = 4;
    const perPage = cols * rows;
    chunk(dms, perPage).forEach((page, pageIdx) => {
      const slide = pptx.addSlide();
      const totalPages = Math.ceil(dms.length / perPage);
      paintSlideChrome(
        pptx,
        slide,
        totalPages > 1
          ? `12  关键决策人 · ${dms.length} 人 (${pageIdx + 1}/${totalPages})`
          : `12  关键决策人 · ${dms.length} 人`,
        company
      );
      const cardW = 2.95;
      const cardH = 0.95;
      const gapX = 0.15;
      const gapY = 0.1;
      page.forEach((dm, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = MARGIN_X + col * (cardW + gapX);
        const y = CONTENT_TOP + row * (cardH + gapY);
        addCard(pptx, slide, x, y, cardW, cardH);
        const name = textOf(dm.name, '联系人');
        const title = textOf(dm.title);
        const email = textOf(dm.emailGuess);
        const typ = textOf(dm.type);
        slide.addText(name, {
          x: x + 0.12,
          y: y + 0.08,
          w: 1.9,
          h: 0.26,
          fontSize: 12,
          bold: true,
          color: COLORS.TEXT_MAIN,
          fontFace: PPT_FONT,
          margin: 0,
        });
        if (typ) {
          slide.addText(typ, {
            x: x + 2.0,
            y: y + 0.1,
            w: 0.8,
            h: 0.22,
            fontSize: 9,
            bold: true,
            color: COLORS.ACCENT_DEEP,
            align: 'right',
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        slide.addText([title, email].filter(Boolean).join('\n') || '邮箱待补充', {
          x: x + 0.12,
          y: y + 0.38,
          w: 2.7,
          h: 0.48,
          ...bodyTextOpts(10),
          color: COLORS.TEXT_MUTED,
        });
      });
    });
  }

  // —— 14. 同类公司 ——
  if (similar.length) {
    const perPage = 6;
    chunk(similar, perPage).forEach((page, pageIdx) => {
      const slide = pptx.addSlide();
      const totalPages = Math.ceil(similar.length / perPage);
      paintSlideChrome(
        pptx,
        slide,
        totalPages > 1
          ? `13  同类公司推荐 · ${similar.length} (${pageIdx + 1}/${totalPages})`
          : `13  同类公司推荐 · ${similar.length}`,
        company
      );
      page.forEach((c, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MARGIN_X + col * 3.1;
        const y = CONTENT_TOP + row * 2.0;
        addCard(pptx, slide, x, y, 2.95, 1.85);
        slide.addText(textOf(c.name), {
          x: x + 0.12,
          y: y + 0.12,
          w: 2.7,
          h: 0.4,
          fontSize: 13,
          bold: true,
          color: COLORS.TEXT_MAIN,
          fontFace: PPT_FONT,
          margin: 0,
        });
        const loc = [textOf(c.country), textOf(c.website)].filter(Boolean).join(' · ');
        if (loc) {
          slide.addText(loc, {
            x: x + 0.12,
            y: y + 0.55,
            w: 2.7,
            h: 0.28,
            fontSize: 10,
            color: COLORS.ACCENT,
            fontFace: PPT_FONT,
            margin: 0,
          });
        }
        if (textOf(c.mainProducts)) {
          slide.addText(textOf(c.mainProducts), {
            x: x + 0.12,
            y: y + 0.9,
            w: 2.7,
            h: 0.75,
            ...bodyTextOpts(11),
          });
        }
      });
    });
  }

  // —— 15. 财务 / 流量：仅有真实数据时 ——
  {
    const finRows: Array<[string, string]> = [
      ['预估年营收', textOf(data.financials?.revenueEstimate)],
      ['结算偏好', textOf(data.financials?.paymentTerms)],
      ['品牌 / IP', textOf(data.financials?.ipInfo)],
    ].filter(([, v]) => isMeaningful(v)) as Array<[string, string]>;
    const socialLines = [
      textOf(data.socials?.linkedin) ? `LinkedIn: ${textOf(data.socials?.linkedin)}` : '',
      textOf(data.socials?.facebook) ? `Facebook: ${textOf(data.socials?.facebook)}` : '',
      textOf(data.socials?.instagram) ? `Instagram: ${textOf(data.socials?.instagram)}` : '',
      textOf(data.socials?.youtube) ? `YouTube: ${textOf(data.socials?.youtube)}` : '',
      textOf(data.socials?.similarWebTraffic) ? `流量: ${textOf(data.socials?.similarWebTraffic)}` : '',
    ].filter(Boolean);
    const traffic = (data.trafficAnalysis || []).filter(
      (t) => isMeaningful(t?.category) || isMeaningful(t?.topKeywords)
    );
    const trends = (data.financialTrends || []).filter((t) => t && (t.revenue || t.procurement));

    if (finRows.length || socialLines.length || traffic.length || trends.length) {
      const slide = pptx.addSlide();
      paintSlideChrome(pptx, slide, '14  财务与流量（有数据）', company);
      let x = MARGIN_X;
      if (finRows.length) {
        addCard(pptx, slide, x, CONTENT_TOP, 4.4, socialLines.length ? 2.2 : 4.0);
        addSectionLabel(slide, '财务概况', x + 0.18, CONTENT_TOP + 0.15, 4.0);
        slide.addTable(
          finRows.map(([k, v]) => [
            { text: k, options: { bold: true, color: COLORS.TEXT_MUTED } },
            { text: v, options: { color: COLORS.TEXT_MAIN } },
          ]),
          {
            x: x + 0.18,
            y: CONTENT_TOP + 0.55,
            w: 4.0,
            fontSize: 11,
            fontFace: PPT_FONT,
            border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: COLORS.BORDER }, { pt: 0 }],
            valign: 'middle',
            rowH: 0.4,
          }
        );
        if (socialLines.length) {
          addCard(pptx, slide, x, CONTENT_TOP + 2.4, 4.4, 1.6);
          addSectionLabel(slide, '社交与流量', x + 0.18, CONTENT_TOP + 2.55, 4.0);
          slide.addText(socialLines.join('\n'), {
            x: x + 0.18,
            y: CONTENT_TOP + 2.95,
            w: 4.0,
            h: 0.9,
            ...bodyTextOpts(11),
          });
        }
        x = 5.05;
      }
      if (traffic.length) {
        addCard(pptx, slide, x, CONTENT_TOP, finRows.length ? 4.55 : 9.2, 4.0);
        addSectionLabel(slide, '流量关键词', x + 0.18, CONTENT_TOP + 0.15, 4.2);
        const headers = [
          { text: '分类', options: { bold: true, fill: COLORS.DARK_BG, color: 'FFFFFF' } },
          { text: '类型', options: { bold: true, fill: COLORS.DARK_BG, color: 'FFFFFF' } },
          { text: '关键词', options: { bold: true, fill: COLORS.DARK_BG, color: 'FFFFFF' } },
        ];
        const trows = traffic.slice(0, 8).map((t) => [
          { text: textOf(t.category) },
          { text: textOf(t.trafficType) },
          { text: textOf(t.topKeywords) },
        ]);
        slide.addTable([headers, ...trows], {
          x: x + 0.15,
          y: CONTENT_TOP + 0.55,
          w: (finRows.length ? 4.25 : 8.9),
          fontSize: 10,
          fontFace: PPT_FONT,
          border: [{ pt: 0.5, color: COLORS.BORDER }],
          valign: 'middle',
          rowH: 0.35,
        });
      } else if (trends.length) {
        // chart only when we have numeric trends and no traffic block filling space
        const labels = trends.map((t) => String(t.year));
        const revenueData = trends.map((t) => (t.revenue || 0) / 1_000_000);
        const procureData = trends.map((t) => (t.procurement || 0) / 1_000_000);
        slide.addChart(
          pptx.ChartType.bar,
          [
            { name: '营收 (百万)', labels, values: revenueData },
            { name: '采购 (百万)', labels, values: procureData },
          ],
          {
            x: x,
            y: CONTENT_TOP,
            w: finRows.length ? 4.55 : 9.2,
            h: 3.8,
            barDir: 'col',
            barGrouping: 'clustered',
            showLegend: true,
            legendPos: 'b',
            chartColors: [COLORS.ACCENT, COLORS.ACCENT_DEEP],
            showValue: false,
          }
        );
      }
    }
  }
};
