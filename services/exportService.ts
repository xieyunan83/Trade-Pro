
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

/**
 * Helper: Sanitize text for PPT
 */
const sanitize = (str: any) => {
    if (str === null || str === undefined) return "暂无数据";
    if (typeof str !== 'string') return String(str);
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
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

        let slide = strategyPptx.addSlide();
        slide.background = { color: COLORS.DARK_BG };
        slide.addText("MASTER OUTREACH STRATEGY", { x: 0.5, y: 1.5, fontSize: 36, bold: true, color: "FFFFFF", align: 'center' });
        slide.addText("批量客户开发策略汇总", { x: 0.5, y: 2.2, fontSize: 24, color: "CBD5E1", align: 'center' });

        // Try to generate a consolidated strategy if we have KB files
        try {
           let kbFiles = [];
           try { kbFiles = await getAllFilesFromDB(); } catch(e) {}
           
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
        let slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.0, fill: COLORS.DARK_BG });
        slide.addText("开发信策略分析 (Outreach Strategy)", { x: 0.5, y: 0.3, fontSize: 20, bold: true, color: "FFFFFF", valign: 'middle' });
        
        slide.addText("AI 策略逻辑:", { x: 0.5, y: 1.3, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.6, w: 9, h: 3.5, fill: "F8FAFC", line: { color: "E2E8F0" } });
        slide.addText(sanitize(mailGroup.analysis), { 
            x: 0.6, y: 1.7, w: 8.8, h: 3.3, 
            fontSize: 10, color: COLORS.TEXT_MAIN, valign: 'top' 
        });

        createEmailSlide(pptx, "Email 1: The Hook (破冰)", mailGroup.email1);
        createEmailSlide(pptx, "Email 2: Value Prop (价值)", mailGroup.email2);
        createEmailSlide(pptx, "Email 3: Case Study (证明)", mailGroup.email3);
    }
};

const createEmailSlide = (pptx: any, title: string, content: string) => {
    let slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: COLORS.ACCENT_BLUE });
    slide.addText(title, { x: 0.5, y: 0.1, h: 0.6, fontSize: 18, bold: true, color: "FFFFFF", valign: 'middle' });
    
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.0, w: 9, h: 4.2, fill: "F8FAFC", line: { color: "CBD5E1", dashType: "solid" } });
    
    slide.addText(sanitize(content), { 
        x: 0.7, y: 1.2, w: 8.6, h: 3.8, 
        fontSize: 10, color: "1E293B", 
        fontFace: "Courier New", valign: 'top' 
    });
};

/**
 * CORE ANALYSIS SLIDES GENERATOR
 */
const generateAnalysisSlides = (pptx: any, data: AnalysisResult) => {
    const addFooter = (slide: any) => {
        slide.addText(`楠哥的小助理 深度报告 | ${sanitize(data.companyInfo.name)}`, { x: 0.5, y: 5.3, w: 9, h: 0.3, fontSize: 8, color: "94A3B8", align: "center", valign: "middle" });
    };

    const headerStyle = { x: 0.5, y: 0.2, h: 0.4, fontSize: 18, bold: true, color: "FFFFFF", valign: "middle" as const };
    const headerRect = { x: 0, y: 0, w: 10, h: 0.8, fill: COLORS.DARK_BG };

    // --- SLIDE 1: COVER ---
    let slide = pptx.addSlide();
    slide.background = { color: COLORS.DARK_BG };
    slide.addText("楠哥的小助理", { x: 0.5, y: 0.5, h: 0.5, fontSize: 10, bold: true, color: COLORS.ACCENT_BLUE, letterSpacing: 2, align: 'center', valign: 'middle' });
    slide.addText(sanitize(data.companyInfo.name), { x: 0.5, y: 1.8, w: 9, h: 1.2, fontSize: 32, bold: true, color: "FFFFFF", align: 'center', valign: 'middle' });
    slide.addText("全球贸易情报深度分析报告", { x: 0.5, y: 3.0, w: 9, h: 0.5, fontSize: 20, color: "94A3B8", align: 'center', valign: 'middle' });
    slide.addShape(pptx.ShapeType.line, { x: 3.0, y: 3.6, w: 4, h: 0, line: { color: COLORS.ACCENT_BLUE, width: 3 } });
    slide.addText(`官网: ${sanitize(data.companyInfo.website)}`, { x: 0.5, y: 4.0, w: 9, h: 0.3, fontSize: 11, color: "CBD5E1", align: 'center', valign: 'middle' });
    slide.addText(`总部: ${sanitize(data.companyInfo.headquarters)}`, { x: 0.5, y: 4.3, w: 9, h: 0.3, fontSize: 11, color: "CBD5E1", align: 'center', valign: 'middle' });

    // --- SLIDE 2: COMPANY PROFILE (企业概况) ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("企业概况 (Company Profile)", headerStyle);

    // Left Column: Basic Info
    slide.addText("基本信息", { x: 0.5, y: 1.0, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
    const infoTable = [
        [{ text: "成立时间", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.companyInfo.foundedYear), options: { valign: "middle" } }],
        [{ text: "企业性质", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.companyInfo.nature), options: { valign: "middle" } }],
        [{ text: "人员规模", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.companyInfo.scale), options: { valign: "middle" } }],
        [{ text: "总部地点", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.companyInfo.headquarters), options: { valign: "middle" } }],
    ];
    slide.addTable(infoTable, { x: 0.5, y: 1.3, w: 4.0, fontSize: 10, rowH: 0.5, border: { pt: 1, color: "E2E8F0" }, align: 'left', valign: 'middle' });

    // Right Column: Description
    slide.addText("企业简介", { x: 4.8, y: 1.0, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
    slide.addShape(pptx.ShapeType.rect, { x: 4.8, y: 1.3, w: 4.7, h: 3.5, fill: "F8FAFC", line: { color: "E2E8F0" } });
    slide.addText(sanitize(data.companyInfo.description), { 
        x: 4.9, y: 1.4, w: 4.5, h: 3.3, 
        fontSize: 10, color: COLORS.TEXT_MAIN, valign: 'middle', align: 'left', wrap: true 
    });

    // --- SLIDE 3: FINANCIALS & TRAFFIC (财务与流量) ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("财务与流量分析 (Financials & Traffic)", headerStyle);

    // Financials
    slide.addText("财务概况", { x: 0.5, y: 1.0, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
    const finTable = [
        [{ text: "预估年营收", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.financials.revenueEstimate), options: { valign: "middle" } }],
        [{ text: "常见付款方式", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.financials.paymentTerms), options: { valign: "middle" } }],
        [{ text: "信用/知识产权", options: { bold: true, fill: "F1F5F9", valign: "middle" } }, { text: sanitize(data.financials.ipInfo), options: { valign: "middle" } }],
    ];
    slide.addTable(finTable, { x: 0.5, y: 1.3, w: 4.0, fontSize: 10, rowH: 0.5, border: { pt: 1, color: "E2E8F0" }, valign: 'middle' });

    // Traffic Table
    slide.addText("流量来源与关键词", { x: 4.8, y: 1.0, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
    if (data.trafficAnalysis && data.trafficAnalysis.length > 0) {
        const trafficHeaders = [
            { text: "分类", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 1.0, valign: "middle" } },
            { text: "流量类型", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 1.2, valign: "middle" } },
            { text: "核心关键词", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 1.5, valign: "middle" } },
            { text: "量级", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 0.8, valign: "middle" } }
        ];
        const trafficRows = data.trafficAnalysis.slice(0, 5).map(t => [
            { text: sanitize(t.category), options: { valign: "middle" } },
            { text: sanitize(t.trafficType), options: { valign: "middle" } },
            { text: sanitize(t.topKeywords), options: { valign: "middle" } },
            { text: sanitize(t.volumeEst), options: { valign: "middle" } }
        ]);
        slide.addTable([trafficHeaders, ...trafficRows], { x: 4.8, y: 1.3, w: 4.7, fontSize: 8, rowH: 0.4, border: { pt: 1, color: "E2E8F0" }, valign: 'middle' });
    } else {
        slide.addText("暂无流量数据", { x: 4.8, y: 1.5, fontSize: 10, color: COLORS.TEXT_MUTED });
    }

    // --- SLIDE 3.5: FINANCIAL TRENDS & FORECAST (NEW) ---
    if (data.financialTrends && data.financialTrends.length > 0) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("财务趋势与预测 (Financial Trends & Forecast)", headerStyle);

        const labels = data.financialTrends.map(t => t.year);
        const revenueData = data.financialTrends.map(t => {
            const val = t.revenue || 0;
            return val > 1000000 ? val / 1000000 : val;
        });
        const procureData = data.financialTrends.map(t => {
            const val = t.procurement || 0;
            return val > 1000000 ? val / 1000000 : val;
        });

        const chartData = [
            {
                name: "Total Revenue (Sales) - USD Millions",
                labels: labels,
                values: revenueData
            },
            {
                name: "Est. Procurement - USD Millions",
                labels: labels,
                values: procureData
            }
        ];

        slide.addChart(pptx.ChartType.bar, chartData, {
            x: 0.5, y: 1.2, w: 9.0, h: 3.5,
            barDir: 'col',
            barGrouping: 'clustered',
            showLegend: true,
            legendPos: 'b',
            showTitle: false,
            chartColors: [COLORS.ACCENT_BLUE, COLORS.ACCENT_PURPLE],
            showValue: true
        });

        slide.addText("分析说明: 图表单位为百万美元 (USD Millions)。展示了该企业过去5年的财务估算及未来2年的AI预测趋势。", { 
            x: 0.5, y: 4.8, w: 9, h: 0.5, 
            fontSize: 10, color: COLORS.TEXT_MUTED, align: 'center', italic: true 
        });
    }

    // --- SLIDE 4: BUSINESS MODEL & SCOPE ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("商业模式与供应链 (Business Model)", headerStyle);

    const boxStyle = { fill: "FFFFFF", line: { color: "E2E8F0" } };
    const titleStyle = { fontSize: 10, bold: true, color: COLORS.ACCENT_BLUE };
    const contentStyle = { fontSize: 9, color: COLORS.TEXT_MAIN, valign: "middle" as const };

    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.2, w: 4.4, h: 1.8, ...boxStyle });
    slide.addText("业务范围 (Scope)", { x: 0.6, y: 1.3, ...titleStyle });
    slide.addText(`核心产品: ${data.businessScope.coreProducts.join(', ')}\n\n定位: ${data.businessScope.brandPositioning}\n\n价格敏感度: ${data.businessScope.priceSensitivity}`, 
        { x: 0.6, y: 1.5, w: 4.2, h: 1.4, ...contentStyle, wrap: true });

    slide.addShape(pptx.ShapeType.rect, { x: 5.1, y: 1.2, w: 4.4, h: 1.8, ...boxStyle });
    slide.addText("供应链角色 (Supply Chain)", { x: 5.2, y: 1.3, ...titleStyle });
    slide.addText(`角色: ${data.supplyChain.role}\n\n服务模式: ${data.supplyChain.serviceType}\n\n目标客户: ${data.targetAudience.join(', ')}`,
        { x: 5.2, y: 1.5, w: 4.2, h: 1.4, ...contentStyle, wrap: true });

    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.2, w: 9.0, h: 1.5, ...boxStyle });
    slide.addText("销售渠道与采购 (Channels & Procurement)", { x: 0.6, y: 3.3, ...titleStyle });
    slide.addText(`销售渠道: ${data.businessModel.channels.join(', ')}\n\n电商平台: ${data.businessModel.ecommercePresence.join(', ')}\n\n采购习惯: ${data.businessModel.procurementInfo}`,
        { x: 0.6, y: 3.5, w: 8.8, h: 1.1, ...contentStyle, wrap: true });


    // --- SLIDE 5: SWOT ANALYSIS ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("SWOT 态势分析", headerStyle);

    const drawQuad = (title: string, items: string[], x: number, y: number, color: string) => {
        slide.addShape(pptx.ShapeType.rect, { x, y, w: 4.4, h: 2.0, fill: "FFFFFF", line: { color: color, width: 2 } });
        slide.addText(title, { x: x+0.1, y: y+0.1, fontSize: 11, bold: true, color: color });
        const bulletText = items && items.length ? items.map(p => `• ${sanitize(p)}`).join('\n') : "• 暂无数据";
        slide.addText(bulletText, { x: x+0.1, y: y+0.4, w: 4.2, h: 1.5, fontSize: 9, color: COLORS.TEXT_MAIN, valign: 'middle', wrap: true });
    };

    drawQuad("STRENGTHS (优势)", data.swot?.strengths, 0.5, 1.1, "10B981");
    drawQuad("WEAKNESSES (劣势)", data.swot?.weaknesses, 5.1, 1.1, "EF4444");
    drawQuad("OPPORTUNITIES (机会)", data.swot?.opportunities, 0.5, 3.3, "3B82F6");
    drawQuad("THREATS (威胁)", data.swot?.threats, 5.1, 3.3, "F59E0B");


    // --- SLIDE 6: DECISION MAKERS ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("关键决策人 (Key Decision Makers)", headerStyle);

    if (data.decisionMakers && data.decisionMakers.length > 0) {
        const headers = [
            { text: "姓名", options: { bold: true, fill: "E2E8F0", w: 2.0, valign: "middle" } },
            { text: "职位", options: { bold: true, fill: "E2E8F0", w: 2.5, valign: "middle" } },
            { text: "预估邮箱", options: { bold: true, fill: "E2E8F0", w: 3.5, valign: "middle" } },
            { text: "类型", options: { bold: true, fill: "E2E8F0", w: 1.0, valign: "middle" } }
        ];
        
        const rows = data.decisionMakers.slice(0, 10).map(dm => [
            { text: sanitize(dm.name), options: { valign: "middle" } },
            { text: sanitize(dm.title), options: { valign: "middle" } },
            { text: sanitize(dm.emailGuess || "-"), options: { valign: "middle" } },
            { text: sanitize(dm.type), options: { valign: "middle" } }
        ]);

        slide.addTable([headers, ...rows], { x: 0.5, y: 1.2, w: 9.0, fontSize: 9, rowH: 0.35, border: { pt: 1, color: "CBD5E1" }, valign: "middle" });
    } else {
        slide.addText("未在公开渠道发现关键联系人信息。", { x: 0.5, y: 2.5, w: 9, align: 'center', fontSize: 14, color: COLORS.TEXT_MUTED });
    }

    // --- SLIDE 6.5: WEBSITE PRODUCT CATALOG ---
    if (data.websiteCategories && data.websiteCategories.length > 0) {
        slide = pptx.addSlide();
        addFooter(slide);
        slide.addShape(pptx.ShapeType.rect, headerRect);
        slide.addText("官网产品目录 (Website Product Catalog)", headerStyle);

        const catHeaders = [
            { text: "产品类别 (Category)", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 3.0, valign: "middle", align: 'center' } },
            { text: "包含产品 (Key Items)", options: { bold: true, fill: COLORS.ACCENT_BLUE, color: "FFFFFF", w: 6.0, valign: "middle", align: 'center' } }
        ];

        const catRows = data.websiteCategories.slice(0, 10).map(cat => [
            { text: sanitize(cat.categoryName), options: { valign: "middle", align: 'center' } },
            { text: sanitize(cat.items.join(', ')), options: { valign: "middle", align: 'center' } }
        ]);

        slide.addTable([catHeaders, ...catRows], { 
            x: 0.5, y: 1.2, w: 9.0, 
            fontSize: 9, rowH: 0.4, 
            border: { pt: 1, color: "CBD5E1" }, 
            valign: 'middle',
            align: 'center' 
        });
    }

    // --- SLIDE 7: PRODUCTS ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("产品与市场策略 (Products & Strategy)", headerStyle);

    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.0, w: 9, h: 0.8, fill: "F0F9FF", line: { color: "BAE6FD" } });
    slide.addText(`市场趋势: ${sanitize(data.marketTrends)}`, { x: 0.6, y: 1.1, w: 8.8, h: 0.6, fontSize: 9, color: "0C4A6E", wrap: true, valign: "middle" });

    if (data.products && data.products.length > 0) {
        data.products.slice(0, 3).forEach((prod, i) => {
            const x = 0.5 + i * 3.1;
            const y = 2.0;
            
            slide.addShape(pptx.ShapeType.rect, { x, y, w: 2.9, h: 3.0, fill: "FFFFFF", line: { color: "E2E8F0" } });
            
            slide.addText(sanitize(prod.name), { x: x+0.1, y: y+0.1, w: 2.7, h: 0.5, fontSize: 10, bold: true, valign: 'top' });
            slide.addText(`零售价: ${sanitize(prod.retailPrice)}`, { x: x+0.1, y: y+0.6, fontSize: 9, color: COLORS.TEXT_MUTED });
            slide.addText(`预估FOB: ¥${sanitize(prod.estimatedFOBPriceCNY)}`, { x: x+0.1, y: y+0.9, fontSize: 9, color: "D97706", bold: true });
            
            slide.addText("切入点:", { x: x+0.1, y: y+1.3, fontSize: 9, bold: true });
            slide.addText(sanitize(prod.pitchPoint || "暂无"), { x: x+0.1, y: y+1.5, w: 2.7, h: 0.6, fontSize: 8, color: COLORS.TEXT_MAIN, wrap: true, valign: 'top' });
            
            slide.addText("定价策略:", { x: x+0.1, y: y+2.1, fontSize: 9, bold: true });
            slide.addText(sanitize(prod.pricingStrategy || "暂无"), { x: x+0.1, y: y+2.3, w: 2.7, h: 0.6, fontSize: 8, color: COLORS.TEXT_MAIN, wrap: true, valign: 'top' });
        });
    }

    // --- SLIDE 8: ACTION PLAN ---
    slide = pptx.addSlide();
    addFooter(slide);
    slide.addShape(pptx.ShapeType.rect, headerRect);
    slide.addText("建议行动计划 (Action Plan)", headerStyle);

    if (data.strategy && data.strategy.actionPlan && data.strategy.actionPlan.length > 0) {
        data.strategy.actionPlan.forEach((step, idx) => {
            const y = 1.2 + idx * 0.6;
            if (y > 5.0) return;
            
            slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: y, w: 0.4, h: 0.4, fill: COLORS.ACCENT_PURPLE, r: 0.1 });
            slide.addText(String(idx + 1), { x: 0.5, y: y, w: 0.4, h: 0.4, align: 'center', color: "FFFFFF", bold: true, fontSize: 10, valign: "middle" });
            
            slide.addShape(pptx.ShapeType.rect, { x: 1.1, y: y, w: 8.4, h: 0.4, fill: "F1F5F9" });
            slide.addText(sanitize(step), { x: 1.2, y: y, w: 8.2, h: 0.4, fontSize: 10, valign: 'middle' });
        });
    } else {
        slide.addText("暂无具体行动计划。", { x: 0.5, y: 2.5, w: 9, align: 'center', color: COLORS.TEXT_MUTED });
    }
    
    if (data.similarCompanies && data.similarCompanies.length > 0) {
        const yStart = 3.5;
        slide.addText("潜在竞品/同行 (Competitors)", { x: 0.5, y: yStart, fontSize: 12, bold: true, color: COLORS.ACCENT_BLUE });
        
        const headers = [
            { text: "公司名", options: { bold: true, fill: "E2E8F0", w: 2.0, valign: "middle" } },
            { text: "国家", options: { bold: true, fill: "E2E8F0", w: 1.5, valign: "middle" } },
            { text: "主营产品", options: { bold: true, fill: "E2E8F0", w: 5.5, valign: "middle" } }
        ];
        const rows = data.similarCompanies.slice(0, 3).map(c => [
            { text: sanitize(c.name), options: { valign: "middle" } },
            { text: sanitize(c.country), options: { valign: "middle" } },
            { text: sanitize(c.mainProducts), options: { valign: "middle" } }
        ]);
        slide.addTable([headers, ...rows], { x: 0.5, y: yStart + 0.4, w: 9.0, fontSize: 9, rowH: 0.4, border: { pt: 1, color: "CBD5E1" }, valign: "middle" });
    }
};
