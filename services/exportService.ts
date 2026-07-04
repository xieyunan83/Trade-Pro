
import { AnalysisResult, KeywordExtractionResult, AutomationResult, DecisionMaker, Client } from '../types';
import { generateConsolidatedEmailStrategy } from './geminiService';
import { getAllFilesFromDB } from './db';

declare global {
  interface Window {
    PptxGenJS: any;
    JSZip: any;
    saveAs: any;
  }
}

declare const PptxGenJS: any;
declare const XLSX: any;
declare const JSZip: any;
declare const saveAs: any;

const COLORS = { 
    DARK_BG: "0F172A", 
    ACCENT_BLUE: "3B82F6", 
    ACCENT_PURPLE: "8B5CF6",
    TEXT_MAIN: "1E293B", 
    TEXT_MUTED: "64748B",
    BG_LIGHT: "F8FAFC",
    SUCCESS: "10B981",
    WARNING: "F59E0B",
    ERROR: "EF4444"
};

/** PptxGenJS lineSpacing 单位为 pt，不是倍数；中文正文建议 fontSize * 1.5 左右 */
const PPT_FONT = 'Microsoft YaHei';
const bodyTextOpts = (fontSize = 9) => ({
    fontSize,
    color: COLORS.TEXT_MAIN,
    fontFace: PPT_FONT,
    valign: 'top' as const,
    wrap: true,
    lineSpacing: Math.round(fontSize * 1.55),
});

/**
 * Helper: Sanitize text for PPT
 * Simplified to prevent "garbled" text while removing problematic null bytes
 */
const sanitize = (str: any) => {
    if (str === null || str === undefined) return "暂无数据";
    if (typeof str !== 'string') return String(str);
    return str.replace(/\0/g, "").replace(/\r\n/g, "\n").trim();
};

/**
 * Export Clients to Excel (CRM)
 */
export const exportClientsToExcel = (clients: Client[]) => {
    if (typeof XLSX === 'undefined') {
        alert("Excel engine not loaded. Please try again.");
        return;
    }

    if (clients.length === 0) {
        alert("No clients to export.");
        return;
    }

    const data = clients.map(c => ({
        "Company Name": c.name,
        "Website": c.website || '', // Added Website column
        "Country": c.country,
        "Type": c.type,
        "Status": c.status,
        "Product Type": c.productType,
        "Price Range": c.priceRange,
        "Sample Needed": c.isSampleNeeded ? 'Yes' : 'No',
        "Analyzed": c.hasAnalyzed ? 'Yes' : 'No',
        "Next Follow Up": c.nextFollowUpDate,
        "Last Sent": c.lastContactSent,
        "Last Received": c.lastContactReceived,
        "Activity Log": c.activityLog
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    // Auto-width columns
    const wscols = Object.keys(data[0]).map(k => ({ wch: 20 }));
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    
    XLSX.writeFile(wb, `CRM_Clients_Export_${Date.now()}.xlsx`);
};

/**
 * Export Contacts to Excel
 */
export const exportContactsToExcel = (contacts: DecisionMaker[], companyName: string) => {
    if (typeof XLSX === 'undefined') {
        alert("Excel engine not loaded. Please try again.");
        return;
    }

    const data = contacts.map(c => ({
        Name: c.name,
        Title: c.title,
        Email: c.emailGuess || '',
        Type: c.type,
        Source: c.source,
        Verified: c.isVerified ? 'Yes' : 'No',
        LinkedIn: c.linkedin || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    
    const safeName = companyName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    XLSX.writeFile(wb, `${safeName}_Contacts_${Date.now()}.xlsx`);
};

/**
 * Export Keywords to Excel
 */
export const exportKeywordsToExcel = (result: KeywordExtractionResult) => {
    if (typeof XLSX === 'undefined') {
        alert("Excel engine not loaded. Please try again.");
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

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Keywords");
    
    XLSX.writeFile(wb, `Keywords_Analysis_${Date.now()}.xlsx`);
};

/**
 * Standard Company Analysis PPT (Single)
 */
export const exportToPPT = (data: AnalysisResult) => {
  try {
    if (!window.PptxGenJS) {
        alert("PPT 引擎加载中... 请稍后重试。");
        return;
    }
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = '楠哥的小助理';
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
    if (!window.PptxGenJS || !window.JSZip || !window.saveAs) {
        alert("Export engines (PptxGenJS/JSZip) loading... Please wait.");
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
            pptx.author = '楠哥的小助理';
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
        strategyPptx.author = '楠哥的小助理';
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
export const exportAutomationReportToPPT = (result: AutomationResult) => {
    if (!window.PptxGenJS) {
        alert("PPT 引擎加载中... 请稍后重试。");
        return;
    }
    
    if (!result.analysis) {
        alert("分析数据不完整，无法生成报告。");
        return;
    }

    try {
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';
        pptx.author = '楠哥的小助理';
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
    // Only add individual email slides if they exist (Detailed Mode)
    if (result.mailGroup) {
        addEmailStrategySlidesFromGroup(pptx, result.mailGroup);
    }
};

const addEmailStrategySlidesFromGroup = (pptx: any, mailGroup: any) => {
    if (mailGroup) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.0, fill: COLORS.DARK_BG });
        slide.addText("开发信策略分析 (Outreach Strategy)", { x: 0.5, y: 0.3, fontSize: 20, bold: true, color: "FFFFFF", valign: 'middle' });
        
        slide.addText("AI 策略逻辑:", { x: 0.5, y: 1.3, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.6, w: 9, h: 3.5, fill: "F8FAFC", line: { color: "E2E8F0" } });
        slide.addText(sanitize(mailGroup.analysis), { 
            x: 0.6, y: 1.7, w: 8.8, h: 3.3, 
            ...bodyTextOpts(10),
        });

        createEmailSlide(pptx, "Email 1: The Hook (破冰)", mailGroup.email1);
        createEmailSlide(pptx, "Email 2: Value Prop (价值)", mailGroup.email2);
        createEmailSlide(pptx, "Email 3: Case Study (证明)", mailGroup.email3);
    }
};

const createEmailSlide = (pptx: any, title: string, content: string) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: COLORS.ACCENT_BLUE });
    slide.addText(title, { x: 0.5, y: 0.1, h: 0.6, fontSize: 18, bold: true, color: "FFFFFF", valign: 'middle' });
    
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.0, w: 9, h: 4.2, fill: "F8FAFC", line: { color: "CBD5E1", dashType: "solid" } });
    
    slide.addText(sanitize(content), { 
        x: 0.7, y: 1.2, w: 8.6, h: 3.8, 
        ...bodyTextOpts(9),
    });
};

/**
 * CORE ANALYSIS SLIDES GENERATOR
 */
const generateAnalysisSlides = (pptx: any, data: AnalysisResult) => {
    const addFooter = (slide: any) => {
        slide.addText(`楠哥的小助理 深度报告 | ${sanitize(data.companyInfo.name)} | 机密资料`, { 
            x: 0.5, y: 5.3, w: 9, h: 0.3, 
            fontSize: 8, color: "94A3B8", align: "center", valign: "middle" 
        });
    };

    const headerStyle = { x: 0.5, y: 0.2, h: 0.4, fontSize: 18, bold: true, color: "FFFFFF", valign: "middle" as const };
    const headerRect = { x: 0, y: 0, w: 10, h: 0.8, fill: COLORS.DARK_BG };

    // --- SLIDE 1: COVER ---
    let slide = pptx.addSlide();
    slide.background = { color: COLORS.DARK_BG };
    
    // Decorative elements
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.1, h: 5.6, fill: COLORS.ACCENT_BLUE });
    slide.addShape(pptx.ShapeType.triangle, { x: 8.5, y: 0, w: 1.5, h: 1.5, fill: COLORS.ACCENT_BLUE, flipV: true });
    
    slide.addText("楠哥的小助理 · TRADE SCOUT PRO", { 
        x: 0.5, y: 0.5, h: 0.5, 
        fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE, 
        letterSpacing: 2, align: 'left', valign: 'middle' 
    });
    
    slide.addText(sanitize(data.companyInfo.name), { 
        x: 0.5, y: 1.5, w: 9, h: 1.2, 
        fontSize: 36, bold: true, color: "FFFFFF", 
        align: 'left', valign: 'middle' 
    });
    
    slide.addText("全球贸易情报深度分析报告", { 
        x: 0.5, y: 2.6, w: 9, h: 0.5, 
        fontSize: 22, color: "CBD5E1", 
        align: 'left', valign: 'middle' 
    });
    
    slide.addShape(pptx.ShapeType.line, { 
        x: 0.5, y: 3.3, w: 3, h: 0, 
        line: { color: COLORS.ACCENT_BLUE, width: 4 } 
    });
    
    const coverInfo = [
        `官网: ${sanitize(data.companyInfo.website)}`,
        `总部: ${sanitize(data.companyInfo.headquarters)}`,
        `日期: ${new Date().toLocaleDateString()}`
    ].join("  |  ");
    
    slide.addText(coverInfo, { 
        x: 0.5, y: 4.5, w: 9, h: 0.4, 
        fontSize: 12, color: "94A3B8", 
        align: 'left', valign: 'middle' 
    });

    // --- SLIDE 2: COMPANY PROFILE (企业概况) ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("01 企业概况 (Company Profile)", headerStyle);

    // Left Column: Basic Info Card
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.0, w: 4.0, h: 4.0, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
    slide.addText("基本信息", { x: 0.7, y: 1.2, fontSize: 14, bold: true, color: COLORS.ACCENT_BLUE });
    
    const infoTable = [
        [{ text: "成立时间", options: { bold: true, fill: "F8FAFC", color: COLORS.TEXT_MUTED } }, { text: sanitize(data.companyInfo.foundedYear) }],
        [{ text: "企业性质", options: { bold: true, fill: "F8FAFC", color: COLORS.TEXT_MUTED } }, { text: sanitize(data.companyInfo.nature) }],
        [{ text: "人员规模", options: { bold: true, fill: "F8FAFC", color: COLORS.TEXT_MUTED } }, { text: sanitize(data.companyInfo.scale) }],
        [{ text: "总部地点", options: { bold: true, fill: "F8FAFC", color: COLORS.TEXT_MUTED } }, { text: sanitize(data.companyInfo.headquarters) }],
    ];
    slide.addTable(infoTable, { 
        x: 0.7, y: 1.6, w: 3.6, 
        fontSize: 10, rowH: 0.6, 
        border: { pt: 0.5, color: "F1F5F9" }, 
        valign: 'middle' 
    });

    // Right Column: Description Card
    slide.addShape(pptx.ShapeType.rect, { x: 4.8, y: 1.0, w: 4.7, h: 4.0, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
    slide.addText("企业简介", { x: 5.0, y: 1.2, fontSize: 14, bold: true, color: COLORS.ACCENT_BLUE });
    slide.addText(sanitize(data.companyInfo.description), { 
        x: 5.0, y: 1.6, w: 4.3, h: 3.2, 
        ...bodyTextOpts(10),
        align: 'left',
    });

    // --- SLIDE 3: FINANCIALS & TRAFFIC (财务与流量) ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("02 财务与流量分析 (Financials & Traffic)", headerStyle);

    // Financials Card
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.0, w: 4.0, h: 2.0, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
    slide.addText("财务概况", { x: 0.7, y: 1.2, fontSize: 13, bold: true, color: COLORS.ACCENT_BLUE });
    const finTable = [
        [{ text: "预估年营收", options: { bold: true, fill: "F8FAFC" } }, { text: sanitize(data.financials.revenueEstimate) }],
        [{ text: "结算方式", options: { bold: true, fill: "F8FAFC" } }, { text: sanitize(data.financials.paymentTerms) }],
        [{ text: "知识产权", options: { bold: true, fill: "F8FAFC" } }, { text: sanitize(data.financials.ipInfo) }],
    ];
    slide.addTable(finTable, { x: 0.7, y: 1.5, w: 3.6, fontSize: 9, rowH: 0.4, border: { pt: 0.5, color: "F1F5F9" }, valign: 'middle' });

    // Socials Card
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.2, w: 4.0, h: 1.8, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
    slide.addText("社交媒体", { x: 0.7, y: 3.4, fontSize: 13, bold: true, color: COLORS.ACCENT_BLUE });
    const socialText = [
        data.socials.linkedin ? `LinkedIn: ${data.socials.linkedin}` : "",
        data.socials.facebook ? `Facebook: ${data.socials.facebook}` : "",
        data.socials.instagram ? `Instagram: ${data.socials.instagram}` : "",
        data.socials.similarWebTraffic ? `SimilarWeb: ${data.socials.similarWebTraffic}` : ""
    ].filter(Boolean).join("\n");
    slide.addText(socialText || "未发现公开社交账号", { x: 0.7, y: 3.7, w: 3.6, fontSize: 9, color: COLORS.TEXT_MAIN });

    // Traffic Table Card
    slide.addShape(pptx.ShapeType.rect, { x: 4.8, y: 1.0, w: 4.7, h: 4.0, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
    slide.addText("流量来源与关键词", { x: 5.0, y: 1.2, fontSize: 13, bold: true, color: COLORS.ACCENT_BLUE });
    if (data.trafficAnalysis && data.trafficAnalysis.length > 0) {
        const trafficHeaders = [
            { text: "分类", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", valign: "middle" } },
            { text: "类型", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", valign: "middle" } },
            { text: "核心关键词", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", valign: "middle" } }
        ];
        const trafficRows = data.trafficAnalysis.slice(0, 7).map(t => [
            { text: sanitize(t.category), options: { valign: "middle" } },
            { text: sanitize(t.trafficType), options: { valign: "middle" } },
            { text: sanitize(t.topKeywords), options: { valign: "middle" } }
        ]);
        slide.addTable([trafficHeaders, ...trafficRows], { 
            x: 5.0, y: 1.5, w: 4.3, 
            fontSize: 8, rowH: 0.45, 
            border: { pt: 0.5, color: "F1F5F9" }, 
            valign: 'middle' 
        });
    } else {
        slide.addText("暂无流量数据", { x: 5.0, y: 2.0, w: 4.3, align: 'center', fontSize: 10, color: COLORS.TEXT_MUTED });
    }

    // --- SLIDE 3.5: FINANCIAL TRENDS (财务趋势) ---
    if (data.financialTrends && data.financialTrends.length > 0) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("03 财务趋势与预测 (Financial Trends)", headerStyle);

        const labels = data.financialTrends.map(t => t.year);
        const revenueData = data.financialTrends.map(t => (t.revenue || 0) / 1000000);
        const procureData = data.financialTrends.map(t => (t.procurement || 0) / 1000000);

        slide.addChart(pptx.ChartType.bar, [
            { name: "营收 (百万美元)", labels, values: revenueData },
            { name: "采购 (百万美元)", labels, values: procureData }
        ], {
            x: 0.5, y: 1.2, w: 9.0, h: 3.5,
            barDir: 'col', barGrouping: 'clustered',
            showLegend: true, legendPos: 'b',
            chartColors: [COLORS.ACCENT_BLUE, COLORS.ACCENT_PURPLE],
            showValue: true
        });

        slide.addText("注: 以上财务数据基于企业规模及行业平均水平的 AI 估算，仅供参考。", { 
            x: 0.5, y: 4.8, w: 9, fontSize: 9, color: COLORS.TEXT_MUTED, align: 'center', italic: true 
        });
    }

    // --- SLIDE 4: BUSINESS MODEL & SCOPE ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("04 商业模式与供应链 (Business Model)", headerStyle);

    const boxStyle = { fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 };
    const titleStyle = { fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE, fontFace: PPT_FONT };
    const contentStyle = { ...bodyTextOpts(9), valign: "top" as const };

    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.2, w: 4.4, h: 1.8, ...boxStyle });
    slide.addText("业务范围 (Scope)", { x: 0.7, y: 1.4, ...titleStyle });
    slide.addText(`核心产品: ${data.businessScope.coreProducts.join(', ')}\n\n品牌定位: ${data.businessScope.brandPositioning}\n\n价格敏感度: ${data.businessScope.priceSensitivity}`, 
        { x: 0.7, y: 1.7, w: 4.0, h: 1.2, ...contentStyle });

    slide.addShape(pptx.ShapeType.rect, { x: 5.1, y: 1.2, w: 4.4, h: 1.8, ...boxStyle });
    slide.addText("供应链角色 (Supply Chain)", { x: 5.3, y: 1.4, ...titleStyle });
    slide.addText(`角色: ${data.supplyChain.role}\n\n服务模式: ${data.supplyChain.serviceType}\n\n目标群体: ${data.targetAudience.join(', ')}`,
        { x: 5.3, y: 1.7, w: 4.0, h: 1.2, ...contentStyle });

    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.2, w: 9.0, h: 1.8, ...boxStyle });
    slide.addText("销售渠道与采购习惯 (Channels & Procurement)", { x: 0.7, y: 3.4, ...titleStyle });
    slide.addText(`销售渠道: ${data.businessModel.channels.join(', ')}\n\n电商布局: ${data.businessModel.ecommercePresence.join(', ')}\n\n采购习惯: ${data.businessModel.procurementInfo}`,
        { x: 0.7, y: 3.7, w: 8.6, h: 1.2, ...contentStyle });

    // --- SLIDE 5: PRODUCT DEPTH ANALYSIS (背调重点 - NEW) ---
    if (data.productSummary) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("05 产品深度分析 (Product Depth Analysis)", headerStyle);

        const summaryBox = (title: string, content: string, x: number, y: number, w: number, h: number, icon: string) => {
            slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: "FFFFFF", line: { color: COLORS.ACCENT_BLUE, width: 1 }, r: 0.1 });
            slide.addText(`${icon} ${title}`, { x: x + 0.15, y: y + 0.12, w: w - 0.3, fontSize: 11, bold: true, color: COLORS.ACCENT_BLUE, fontFace: PPT_FONT });
            slide.addText(sanitize(content), { 
                x: x + 0.15, y: y + 0.48, w: w - 0.3, h: h - 0.58, 
                ...bodyTextOpts(9),
            });
        };

        summaryBox("市场喜好 (Market Preference)", data.productSummary.marketPreference, 0.5, 1.0, 4.4, 1.75, "📊");
        summaryBox("功能分析 (Feature Analysis)", data.productSummary.featureAnalysis, 5.1, 1.0, 4.4, 1.75, "⚙️");
        summaryBox("推荐产品 (Recommended)", data.productSummary.recommendedProducts, 0.5, 2.85, 4.4, 1.75, "💡");
        summaryBox("包装风格 (Packaging)", data.productSummary.packagingAnalysis, 5.1, 2.85, 4.4, 1.75, "📦");
        summaryBox("颜色偏好 (Color Preference)", data.productSummary.colorPreference, 0.5, 4.7, 9.0, 0.75, "🎨");
    }

    // --- SLIDE 5.5: ACTION PLAN (Separated to avoid overlap) ---
    if (data.strategy && data.strategy.actionPlan && data.strategy.actionPlan.length > 0) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.background = { color: "FFFFFF" };
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("06 建议行动计划 (Action Plan)", headerStyle);

        data.strategy.actionPlan.forEach((step, idx) => {
            const y = 1.2 + idx * 0.7;
            if (y > 5.0) return;
            
            slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: y, w: 0.4, h: 0.4, fill: COLORS.ACCENT_PURPLE, r: 0.1 });
            slide.addText(String(idx + 1), { x: 0.5, y: y, w: 0.4, h: 0.4, align: 'center', color: "FFFFFF", bold: true, fontSize: 10, valign: "middle" });
            
            slide.addShape(pptx.ShapeType.rect, { x: 1.1, y: y, w: 8.4, h: 0.5, fill: "F8FAFC", line: { color: "F1F5F9" }, r: 0.05 });
            slide.addText(sanitize(step), { x: 1.2, y: y, w: 8.2, h: 0.5, fontSize: 10, color: COLORS.TEXT_MAIN, valign: 'middle' });
        });
    }

    // --- SLIDE 6: SWOT ANALYSIS ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("07 SWOT 态势分析", headerStyle);

    const drawQuad = (title: string, items: string[], x: number, y: number, color: string, bgColor: string) => {
        slide.addShape(pptx.ShapeType.rect, { x, y, w: 4.4, h: 2.0, fill: bgColor, line: { color: color, width: 2 }, r: 0.1 });
        slide.addText(title, { x: x+0.15, y: y+0.15, fontSize: 12, bold: true, color: color });
        const bulletText = items && items.length ? items.map(p => `• ${sanitize(p)}`).join('\n') : "• 暂无数据";
        slide.addText(bulletText, { 
            x: x+0.15, y: y+0.5, w: 4.1, h: 1.4, 
            ...bodyTextOpts(9),
        });
    };

    drawQuad("STRENGTHS (优势)", data.swot?.strengths, 0.5, 1.1, COLORS.SUCCESS, "F0FDF4");
    drawQuad("WEAKNESSES (劣势)", data.swot?.weaknesses, 5.1, 1.1, COLORS.ERROR, "FEF2F2");
    drawQuad("OPPORTUNITIES (机会)", data.swot?.opportunities, 0.5, 3.3, COLORS.ACCENT_BLUE, "EFF6FF");
    drawQuad("THREATS (威胁)", data.swot?.threats, 5.1, 3.3, COLORS.WARNING, "FFFBEB");

    // --- SLIDE 7: DECISION MAKERS ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("08 关键决策人 (Key Decision Makers)", headerStyle);

    if (data.decisionMakers && data.decisionMakers.length > 0) {
        const headers = [
            { text: "姓名", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 2.0 } },
            { text: "职位", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 2.5 } },
            { text: "预估邮箱", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 3.5 } },
            { text: "类型", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 1.0 } }
        ];
        
        const rows = data.decisionMakers.slice(0, 10).map(dm => [
            { text: sanitize(dm.name) },
            { text: sanitize(dm.title) },
            { text: sanitize(dm.emailGuess || "待补充") },
            { text: sanitize(dm.type) }
        ]);

        slide.addTable([headers, ...rows], { 
            x: 0.5, y: 1.2, w: 9.0, 
            fontSize: 9, rowH: 0.38, 
            border: { pt: 0.5, color: "E2E8F0" }, 
            valign: "middle" 
        });
    } else {
        slide.addText("未在公开渠道发现关键联系人信息。", { x: 0.5, y: 2.5, w: 9, align: 'center', fontSize: 14, color: COLORS.TEXT_MUTED });
    }

    // --- SLIDE 8: PRODUCTS & STRATEGY ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("09 产品详情与切入策略 (Products & Strategy)", headerStyle);

    if (data.products && data.products.length > 0) {
        data.products.slice(0, 3).forEach((prod, i) => {
            const x = 0.5 + i * 3.1;
            const y = 1.1;
            
            slide.addShape(pptx.ShapeType.rect, { x, y, w: 2.9, h: 4.0, fill: "FFFFFF", line: { color: "E2E8F0" }, r: 0.1 });
            
            slide.addText(sanitize(prod.name), { x: x+0.1, y: y+0.1, w: 2.7, h: 0.5, fontSize: 10, bold: true, color: COLORS.ACCENT_BLUE, valign: 'top' });
            slide.addText(`零售价: ${sanitize(prod.retailPrice)}`, { x: x+0.1, y: y+0.6, fontSize: 8, color: COLORS.TEXT_MUTED });
            slide.addText(`预估FOB: ¥${sanitize(prod.estimatedFOBPriceCNY)}`, { x: x+0.1, y: y+0.85, fontSize: 9, color: COLORS.WARNING, bold: true });
            
            slide.addShape(pptx.ShapeType.line, { x: x+0.1, y: y+1.1, w: 2.7, h: 0, line: { color: "F1F5F9" } });
            
            slide.addText("产品特征:", { x: x+0.1, y: y+1.2, fontSize: 8, bold: true });
            slide.addText(`功能: ${sanitize(prod.features || "暂无")}\n颜色: ${sanitize(prod.colors || "暂无")}\n包装: ${sanitize(prod.packaging || "暂无")}`, 
                { x: x+0.1, y: y+1.4, w: 2.7, h: 0.8, ...bodyTextOpts(8) });
            
            slide.addText("开发切入点:", { x: x+0.1, y: y+2.3, fontSize: 8, bold: true, fontFace: PPT_FONT });
            slide.addText(sanitize(prod.pitchPoint || "暂无"), { x: x+0.1, y: y+2.5, w: 2.7, h: 0.6, ...bodyTextOpts(8) });
            
            slide.addText("定价建议:", { x: x+0.1, y: y+3.2, fontSize: 8, bold: true, fontFace: PPT_FONT });
            slide.addText(sanitize(prod.pricingStrategy || "暂无"), { x: x+0.1, y: y+3.4, w: 2.7, h: 0.5, ...bodyTextOpts(8) });
        });
    }

    // --- SLIDE 10: COMPETITORS (Separated to avoid overlap) ---
    if (data.similarCompanies && data.similarCompanies.length > 0) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("10 潜在竞品/同行 (Competitors)", headerStyle);
        
        const headers = [
            { text: "公司名", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 2.5 } },
            { text: "国家", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 1.0 } },
            { text: "主营产品", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 3.5 } },
            { text: "网址", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 2.0 } }
        ];
        const rows = data.similarCompanies.slice(0, 8).map(c => [
            { text: sanitize(c.name) },
            { text: sanitize(c.country) },
            { text: sanitize(c.mainProducts) },
            { text: sanitize(c.website) }
        ]);
        slide.addTable([headers, ...rows], { 
            x: 0.5, y: 1.2, w: 9.0, 
            fontSize: 10, rowH: 0.45, 
            border: { pt: 0.5, color: "E2E8F0" }, 
            valign: "middle" 
        });
    }

    // --- SLIDE 11: END ---
};
