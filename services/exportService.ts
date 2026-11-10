
import { AnalysisResult, KeywordExtractionResult, AutomationResult, DecisionMaker, Client } from '../types';
import { generateConsolidatedEmailStrategy } from './geminiService';
import { getAllFilesFromDB } from './db';
import { abbreviateEmailPlatform } from './permissions';
import {
  PPT_COLORS,
  sanitize,
  generateAnalysisSlides,
  addEmailStrategySlidesFromGroup,
  addAutomationSlides,
} from './pptxAnalysisSlides';

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

const COLORS = PPT_COLORS;

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
