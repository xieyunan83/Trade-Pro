/**
 * 背调 PPT 幻灯片生成（产品链接客户主轴）
 * 规范见 .cursor/skills/pptx-report/SKILL.md
 */
import type { AnalysisResult, AutomationResult } from '../types';
import { loadCatalogSkus } from './productCatalogTypes';
import {
  buildProductProfileFromAnalysis,
  matchCatalogSkusToClientProfile,
  type CatalogSkuClientHit,
} from './productCatalog';

/** Trade Command：墨海军 + 信号青绿 + 琥珀金（Sharp & Compact） */
export const PPT_COLORS = {
  ink: '0B1C24',
  inkSoft: '132A36',
  signal: '0F766E',
  teal: '14B8A6',
  gold: 'C9A227',
  goldSoft: 'F5E6B8',
  paper: 'F6F1E8',
  card: 'FFFCF7',
  muted: '5B6B73',
  line: 'E7E0D4',
  ok: '047857',
  bad: 'B91C1C',
  warn: 'B45309',
  white: 'FFFFFF',
  // 兼容旧 batch 封面引用
  DARK_BG: '0B1C24',
  ACCENT_BLUE: '0F766E',
  ACCENT_PURPLE: '0F766E',
  TEXT_MAIN: '0B1C24',
  TEXT_MUTED: '5B6B73',
  BG_LIGHT: 'F6F1E8',
  SUCCESS: '047857',
  WARNING: 'B45309',
  ERROR: 'B91C1C',
};

const C = PPT_COLORS;
const FONT = 'Microsoft YaHei';
const TOP = 0.92;
const BOTTOM = 5.12;
const MX = 0.42;
const R = 0.04; // Sharp

const EMPTY_RE =
  /^(n\/a|na|n\.a\.|暂无|暂无数据|公开信息未找到|未找到|无|none|null|undefined|unknown|待补充|—|–|-|\/|\.)$/i;

export const sanitize = (str: any): string => {
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

const textOf = (str: any, fallback = ''): string => (isMeaningful(str) ? sanitize(str) : fallback);

const listOf = (arr?: any[]): string[] =>
  (arr || []).map((x) => sanitize(x)).filter((x) => isMeaningful(x));

/** 按字符硬截断，避免卡片出框（中文按字计） */
export const clipText = (str: any, maxChars: number): string => {
  const t = sanitize(str);
  if (!t) return '';
  if (maxChars <= 1) return '…';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
};

/** 按行预算截断：约 charsPerLine × maxLines */
const fitLines = (str: any, maxLines: number, charsPerLine: number): string =>
  clipText(str, Math.max(6, maxLines * charsPerLine));

const hostOfUrl = (url: string): string => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return clipText(url, 36);
  }
};

const evidenceSourceLabel = (src?: string): string => {
  const s = (src || '').toLowerCase();
  if (s === 'official') return '官网';
  if (s === 'social') return '社交';
  if (s === 'ai') return '推断';
  return '公开来源';
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const bodyOpts = (fontSize = 12) => ({
  fontSize,
  color: C.ink,
  fontFace: FONT,
  valign: 'top' as const,
  wrap: true,
  margin: 0,
  bold: false,
  lineSpacing: Math.round(fontSize * 1.35),
});

let pageCounter = 0;

const resetPages = () => {
  pageCounter = 0;
};

const paintChrome = (pptx: any, slide: any, title: string, company = '', opts?: { dark?: boolean }) => {
  pageCounter += 1;
  const dark = !!opts?.dark;
  slide.background = { color: dark ? C.ink : C.paper };
  // 顶栏
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.72,
    fill: dark ? C.inkSoft : C.ink,
  });
  // 左信号条（非顶彩条）
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.1,
    h: 5.625,
    fill: C.teal,
  });
  slide.addText(clipText(title, 42), {
    x: 0.32,
    y: 0.16,
    w: 8.6,
    h: 0.42,
    fontSize: 20,
    bold: true,
    color: C.white,
    fontFace: FONT,
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  });
  // 页码徽章
  slide.addShape(pptx.ShapeType.oval, {
    x: 9.28,
    y: 5.15,
    w: 0.36,
    h: 0.36,
    fill: C.signal,
  });
  slide.addText(String(pageCounter), {
    x: 9.28,
    y: 5.15,
    w: 0.36,
    h: 0.36,
    fontSize: 11,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
    fontFace: FONT,
    margin: 0,
  });
  if (company) {
    slide.addText(`产品链接客户 · ${clipText(company, 28)}`, {
      x: MX,
      y: 5.22,
      w: 8.6,
      h: 0.22,
      fontSize: 9,
      color: dark ? '94A3B8' : C.muted,
      fontFace: FONT,
      margin: 0,
    });
  }
};

const card = (pptx: any, slide: any, x: number, y: number, w: number, h: number, fill = C.card) => {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill,
    line: { color: C.line, width: 1 },
    rectRadius: R,
  });
};

const label = (slide: any, text: string, x: number, y: number, w: number, color = C.signal) => {
  slide.addText(clipText(text, 28), {
    x,
    y,
    w,
    h: 0.28,
    fontSize: 13,
    bold: true,
    color,
    fontFace: FONT,
    margin: 0,
  });
};

const resolveOurSkuMatches = (data: AnalysisResult): CatalogSkuClientHit[] => {
  try {
    const skus = loadCatalogSkus();
    if (!skus.length) return [];
    const profile = buildProductProfileFromAnalysis(data, {});
    if (!profile) return [];
    return matchCatalogSkusToClientProfile(skus, profile, { limit: 12, minScore: 20 });
  } catch (e) {
    console.warn('[pptx] sku match skipped', e);
    return [];
  }
};

/** 精简匹配原因：去掉冗长「库内…」嵌套句 */
const compactReasons = (reasons: string[]): string => {
  const cleaned = listOf(reasons)
    .map((r) =>
      r
        .replace(/（库内[^）]*）/g, '')
        .replace(/库内「[^」]*」/g, '客户SKU')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
  // 最多 3 条短因
  return fitLines(cleaned.slice(0, 3).join('；'), 3, 18);
};

export const addEmailStrategySlidesFromGroup = (pptx: any, mailGroup: any) => {
  if (!mailGroup) return;
  const analysisText = [textOf(mailGroup.analysis), mailGroup.sendTip ? `发送提示: ${textOf(mailGroup.sendTip)}` : '']
    .filter(Boolean)
    .join('\n\n');
  if (!analysisText && !textOf(mailGroup.email1) && !textOf(mailGroup.email2) && !textOf(mailGroup.email3)) return;

  if (analysisText) {
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, '开发信策略');
    card(pptx, slide, MX, TOP, 9.16, 4.0);
    label(slide, '策略逻辑', MX + 0.22, TOP + 0.18, 8.7);
    slide.addText(fitLines(analysisText, 14, 42), {
      x: MX + 0.22,
      y: TOP + 0.55,
      w: 8.7,
      h: 3.25,
      ...bodyOpts(12),
    });
  }
  for (const [title, body, sub] of [
    ['Email 1 · 匹配破冰', mailGroup.email1, mailGroup.subject1],
    ['Email 2 · 实力证明', mailGroup.email2, mailGroup.subject2],
    ['Email 3 · 钩子收口', mailGroup.email3, mailGroup.subject3],
  ] as const) {
    if (!textOf(body) && !textOf(sub)) continue;
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, title);
    card(pptx, slide, MX, TOP, 9.16, 4.0);
    const content = textOf(sub) ? `Subject: ${textOf(sub)}\n\n${textOf(body)}` : textOf(body);
    slide.addText(fitLines(content, 16, 44), {
      x: MX + 0.25,
      y: TOP + 0.25,
      w: 8.66,
      h: 3.5,
      ...bodyOpts(12),
    });
  }
};

export const addAutomationSlides = (pptx: any, result: AutomationResult) => {
  if (result.analysis) generateAnalysisSlides(pptx, result.analysis);
  if (result.mailGroup) addEmailStrategySlidesFromGroup(pptx, result.mailGroup);
};

export const generateAnalysisSlides = (pptx: any, data: AnalysisResult) => {
  resetPages();
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

  // —— COVER ——
  {
    const slide = pptx.addSlide();
    slide.background = { color: C.ink };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: 5.625, fill: C.teal });
    slide.addShape(pptx.ShapeType.rect, { x: 7.35, y: 0, w: 2.65, h: 5.625, fill: C.inkSoft });
    slide.addText('外贸智慧协同', {
      x: 0.5,
      y: 0.48,
      w: 6.5,
      h: 0.32,
      fontSize: 13,
      bold: true,
      color: C.teal,
      fontFace: FONT,
      margin: 0,
    });
    slide.addText(clipText(company, 28), {
      x: 0.5,
      y: 1.15,
      w: 6.6,
      h: 0.95,
      fontSize: 36,
      bold: true,
      color: C.white,
      fontFace: FONT,
      margin: 0,
      fit: 'shrink',
    });
    slide.addText('背调报告  ·  产品链接客户', {
      x: 0.5,
      y: 2.2,
      w: 6.6,
      h: 0.4,
      fontSize: 18,
      color: C.gold,
      fontFace: FONT,
      margin: 0,
    });
    slide.addText(
      [
        website ? `官网 ${website}` : '',
        hq || city ? `总部 ${hq || city}` : '',
        country ? `市场 ${country}` : '',
        keyword ? `关键词 ${keyword}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        x: 0.5,
        y: 3.0,
        w: 6.6,
        h: 1.4,
        ...bodyOpts(13),
        color: 'A8B5BD',
      }
    );
    slide.addText(new Date().toLocaleDateString('zh-CN'), {
      x: 0.5,
      y: 5.05,
      w: 6.5,
      h: 0.28,
      fontSize: 11,
      color: '64748B',
      fontFace: FONT,
      margin: 0,
    });
    const kpis: Array<{ v: string; l: string }> = [];
    if (products.length) kpis.push({ v: String(products.length), l: '客户产品' });
    if (categories.length) kpis.push({ v: String(categories.length), l: '官网品类' });
    if (skuHits.length) kpis.push({ v: String(skuHits.length), l: '我方匹配' });
    if (keywordProducts.length) kpis.push({ v: String(keywordProducts.length), l: '关键词命中' });
    kpis.slice(0, 4).forEach((k, i) => {
      const y = 0.55 + i * 1.15;
      slide.addText(k.v, {
        x: 7.5,
        y,
        w: 2.3,
        h: 0.5,
        fontSize: 32,
        bold: true,
        color: C.gold,
        align: 'center',
        fontFace: FONT,
        margin: 0,
      });
      slide.addText(k.l, {
        x: 7.5,
        y: y + 0.48,
        w: 2.3,
        h: 0.28,
        fontSize: 12,
        color: '94A3B8',
        align: 'center',
        fontFace: FONT,
        margin: 0,
      });
    });
  }

  // —— 企业速览 ——
  {
    const rows: Array<[string, string]> = (
      [
        ['成立时间', textOf(data.companyInfo?.foundedYear)],
        ['企业性质', textOf(data.companyInfo?.nature)],
        ['人员规模', textOf(data.companyInfo?.scale)],
        ['总部 / 城市', [hq, city].filter(Boolean).join(' / ')],
        ['官网', website],
      ] as Array<[string, string]>
    ).filter(([, v]) => isMeaningful(v));
    const desc = textOf(data.companyInfo?.description);
    if (rows.length || desc) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '企业速览', company);
      if (rows.length) {
        card(pptx, slide, MX, TOP, 4.25, 4.05);
        label(slide, '基本信息', MX + 0.2, TOP + 0.16, 3.8);
        slide.addTable(
          rows.map(([k, v]) => [
            { text: k, options: { bold: true, color: C.muted, fill: 'F3EEE4' } },
            { text: clipText(v, 36), options: { color: C.ink } },
          ]),
          {
            x: MX + 0.18,
            y: TOP + 0.55,
            w: 3.9,
            colW: [1.25, 2.65],
            fontSize: 11,
            fontFace: FONT,
            border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: C.line }, { pt: 0 }],
            valign: 'middle',
            rowH: Math.min(0.52, 3.2 / Math.max(rows.length, 1)),
          }
        );
      }
      if (desc) {
        const x = rows.length ? 4.9 : MX;
        const w = rows.length ? 4.68 : 9.16;
        card(pptx, slide, x, TOP, w, 4.05);
        label(slide, '企业简介', x + 0.2, TOP + 0.16, w - 0.4);
        slide.addText(fitLines(desc, 12, 28), {
          x: x + 0.2,
          y: TOP + 0.55,
          w: w - 0.4,
          h: 3.3,
          ...bodyOpts(12),
        });
      }
    }
  }

  // —— 证据链 ——
  if (evidence.length) {
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, '证据链 · 公开来源', company);
    const conf = data.evidenceConfidence;
    const summary = textOf(data.evidenceSummary) || textOf(data.decisionEnrichment?.summaryZh);
    let startY = TOP;
    if (summary || conf != null) {
      card(pptx, slide, MX, TOP, 9.16, 0.62, C.goldSoft);
      const confTxt = conf != null && Number.isFinite(conf) ? `可信度 ${Math.round(Number(conf) * 100)}%` : '';
      slide.addText(fitLines([confTxt, summary].filter(Boolean).join('  ·  '), 2, 48), {
        x: MX + 0.2,
        y: TOP + 0.16,
        w: 8.76,
        h: 0.36,
        fontSize: 12,
        color: C.ink,
        fontFace: FONT,
        margin: 0,
      });
      startY = TOP + 0.78;
    }
    evidence.slice(0, 9).forEach((e, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = MX + col * 3.1;
      const y = startY + row * 1.2;
      if (y + 1.1 > BOTTOM) return;
      card(pptx, slide, x, y, 2.95, 1.1);
      slide.addText(evidenceSourceLabel(e.source), {
        x: x + 0.12,
        y: y + 0.1,
        w: 2.7,
        h: 0.22,
        fontSize: 10,
        bold: true,
        color: C.signal,
        fontFace: FONT,
        margin: 0,
      });
      slide.addText(fitLines(textOf(e.title) || hostOfUrl(e.url || ''), 3, 16), {
        x: x + 0.12,
        y: y + 0.38,
        w: 2.7,
        h: 0.58,
        ...bodyOpts(11),
      });
    });
  }

  // —— SECTION: 产品链接 ——
  {
    const slide = pptx.addSlide();
    slide.background = { color: C.ink };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: 5.625, fill: C.gold });
    slide.addText('PRODUCT LINK', {
      x: 0.55,
      y: 1.7,
      w: 9,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: C.teal,
      fontFace: FONT,
      margin: 0,
    });
    slide.addText('产品链接客户', {
      x: 0.55,
      y: 2.2,
      w: 9,
      h: 0.7,
      fontSize: 40,
      bold: true,
      color: C.white,
      fontFace: FONT,
      margin: 0,
    });
    slide.addText('客户在售 / 采购画像  →  我方 SKU 命中  →  可执行切入', {
      x: 0.55,
      y: 3.1,
      w: 9,
      h: 0.4,
      fontSize: 14,
      color: 'A8B5BD',
      fontFace: FONT,
      margin: 0,
    });
    pageCounter += 1;
  }

  // —— 客户产品画像 ——
  {
    const hasIntel =
      sellCats.length ||
      procureCats.length ||
      sellTags.length ||
      procureTags.length ||
      coreProducts.length ||
      textOf(data.businessScope?.brandPositioning) ||
      textOf(data.businessModel?.procurementInfo);
    if (hasIntel) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '客户产品画像', company);
      card(pptx, slide, MX, TOP, 4.48, 4.05);
      label(slide, '在售 / 分销', MX + 0.18, TOP + 0.16, 4.1);
      const sellBody = [
        sellCats.length ? `品类：${sellCats.slice(0, 10).join('、')}` : '',
        sellTags.length ? `标签：${sellTags.slice(0, 8).join('、')}` : '',
        coreProducts.length && !sellCats.length ? `核心：${coreProducts.slice(0, 8).join('、')}` : '',
        textOf(data.businessScope?.brandPositioning)
          ? `定位：${textOf(data.businessScope.brandPositioning)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      slide.addText(fitLines(sellBody || '见官网品类 / 产品明细', 11, 22), {
        x: MX + 0.18,
        y: TOP + 0.55,
        w: 4.12,
        h: 3.3,
        ...bodyOpts(12),
      });

      card(pptx, slide, 5.1, TOP, 4.48, 4.05);
      label(slide, '采购 / 进口', 5.28, TOP + 0.16, 4.1);
      const buyBody = [
        procureCats.length ? `采购品类：${procureCats.slice(0, 10).join('、')}` : '',
        procureTags.length ? `标签：${procureTags.slice(0, 8).join('、')}` : '',
        textOf(data.businessModel?.procurementInfo)
          ? `习惯：${textOf(data.businessModel.procurementInfo)}`
          : '',
        textOf(data.supplyChain?.role) ? `角色：${textOf(data.supplyChain.role)}` : '',
        listOf(data.targetAudience).length ? `客群：${listOf(data.targetAudience).slice(0, 6).join('、')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      slide.addText(fitLines(buyBody || '暂无采购侧结构化线索', 11, 22), {
        x: 5.28,
        y: TOP + 0.55,
        w: 4.12,
        h: 3.3,
        ...bodyOpts(12),
      });
    }
  }

  // —— 市场喜好 ——
  if (hasProductSummary && ps) {
    const blocks = [
      { t: '终端市场喜好', b: textOf(ps.marketPreference) },
      { t: '推荐切入产品', b: textOf(ps.recommendedProducts) },
      { t: '功能 / 卖点', b: textOf(ps.featureAnalysis) },
      { t: '包装偏好', b: textOf(ps.packagingAnalysis) },
      { t: '颜色偏好', b: textOf(ps.colorPreference) },
    ].filter((b) => b.b);
    chunk(blocks, 4).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1 ? `市场喜好与产品策略 (${pi + 1}/${all.length})` : '市场喜好与产品策略',
        company
      );
      page.forEach((b, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MX + col * 4.7;
        const y = TOP + row * 2.02;
        card(pptx, slide, x, y, 4.5, 1.9);
        label(slide, b.t, x + 0.18, y + 0.14, 4.1);
        slide.addText(fitLines(b.b, 5, 24), {
          x: x + 0.18,
          y: y + 0.5,
          w: 4.14,
          h: 1.25,
          ...bodyOpts(12),
        });
      });
    });
  }

  // —— 官网品类：每页 6 ——
  if (categories.length) {
    chunk(categories, 6).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1
          ? `官网品类 · ${categories.length} (${pi + 1}/${all.length})`
          : `官网品类 · ${categories.length}`,
        company
      );
      page.forEach((cat, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MX + col * 3.1;
        const y = TOP + row * 2.02;
        card(pptx, slide, x, y, 2.95, 1.9);
        const price =
          textOf(cat.priceBand) ||
          (cat.priceMinCNY != null && cat.priceMaxCNY != null
            ? `¥${cat.priceMinCNY}–${cat.priceMaxCNY}`
            : '');
        slide.addText(fitLines(cat.categoryName, 2, 12), {
          x: x + 0.14,
          y: y + 0.14,
          w: price ? 1.85 : 2.65,
          h: 0.48,
          fontSize: 13,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        if (price) {
          slide.addShape(pptx.ShapeType.roundRect, {
            x: x + 2.0,
            y: y + 0.16,
            w: 0.8,
            h: 0.28,
            fill: C.goldSoft,
            rectRadius: 0.06,
          });
          slide.addText(clipText(price, 10), {
            x: x + 2.0,
            y: y + 0.16,
            w: 0.8,
            h: 0.28,
            fontSize: 9,
            bold: true,
            color: C.ink,
            align: 'center',
            valign: 'middle',
            fontFace: FONT,
            margin: 0,
          });
        }
        slide.addText(fitLines(listOf(cat.items).slice(0, 8).join(' · ') || '—', 5, 14), {
          x: x + 0.14,
          y: y + 0.72,
          w: 2.65,
          h: 1.0,
          ...bodyOpts(11),
          color: C.muted,
        });
      });
    });
  }

  // —— 客户产品明细：每页 2 大卡，字段硬截断 ——
  if (products.length) {
    const ordered = [...keywordProducts, ...products.filter((p) => !p.keywordMatch)];
    chunk(ordered, 2).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1
          ? `客户产品明细 · ${products.length} (${pi + 1}/${all.length})`
          : `客户产品明细 · ${products.length}`,
        company
      );
      page.forEach((prod, i) => {
        const y = TOP + i * 2.05;
        card(pptx, slide, MX, y, 9.16, 1.95);
        // 左色条
        slide.addShape(pptx.ShapeType.rect, {
          x: MX,
          y,
          w: 0.08,
          h: 1.95,
          fill: prod.keywordMatch ? C.gold : C.teal,
        });
        const title = fitLines(prod.name, 1, 36);
        slide.addText(title, {
          x: MX + 0.25,
          y: y + 0.12,
          w: 6.4,
          h: 0.34,
          fontSize: 15,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
          fit: 'shrink',
        });
        const priceBits = [
          textOf(prod.retailPrice),
          prod.estimatedFOBPriceCNY ? `FOB≈¥${prod.estimatedFOBPriceCNY}` : '',
          prod.priceMinCNY != null && prod.priceMaxCNY != null
            ? `¥${prod.priceMinCNY}-${prod.priceMaxCNY}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (priceBits) {
          slide.addText(clipText(priceBits, 34), {
            x: MX + 6.7,
            y: y + 0.14,
            w: 2.25,
            h: 0.3,
            fontSize: 11,
            bold: true,
            color: C.signal,
            align: 'right',
            fontFace: FONT,
            margin: 0,
          });
        }
        const tags = [
          prod.keywordMatch ? '关键词相关' : '',
          textOf(prod.category),
        ]
          .filter(Boolean)
          .join(' · ');
        if (tags) {
          slide.addText(clipText(tags, 40), {
            x: MX + 0.25,
            y: y + 0.48,
            w: 8.6,
            h: 0.24,
            fontSize: 11,
            color: C.signal,
            fontFace: FONT,
            margin: 0,
          });
        }
        // 三列短字段，避免垂直堆叠出框
        const cols = [
          { t: '功能', b: textOf(prod.features) },
          { t: '颜色 / 包装', b: [textOf(prod.colors), textOf(prod.packaging)].filter(Boolean).join(' · ') },
          { t: '切入 / 定价', b: [textOf(prod.pitchPoint), textOf(prod.pricingStrategy)].filter(Boolean).join(' · ') },
        ].filter((c) => c.b);
        cols.slice(0, 3).forEach((c, ci) => {
          const cx = MX + 0.25 + ci * 3.0;
          slide.addText(c.t, {
            x: cx,
            y: y + 0.8,
            w: 2.85,
            h: 0.22,
            fontSize: 10,
            bold: true,
            color: C.muted,
            fontFace: FONT,
            margin: 0,
          });
          slide.addText(fitLines(c.b, 3, 16), {
            x: cx,
            y: y + 1.05,
            w: 2.85,
            h: 0.75,
            ...bodyOpts(11),
          });
        });
      });
    });
  }

  // —— 我方匹配：每页 3 张，原因压缩 ——
  if (skuHits.length) {
    chunk(skuHits, 3).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1
          ? `推荐我方产品 · ${skuHits.length} (${pi + 1}/${all.length})`
          : `推荐我方产品 · ${skuHits.length}`,
        company
      );
      page.forEach((hit, i) => {
        const x = MX + i * 3.1;
        card(pptx, slide, x, TOP, 2.98, 4.05);
        slide.addShape(pptx.ShapeType.rect, {
          x,
          y: TOP,
          w: 0.08,
          h: 4.05,
          fill: hit.score >= 80 ? C.gold : C.teal,
        });
        const name = textOf(hit.sku.name) || textOf(hit.sku.skuCode) || 'SKU';
        slide.addText(fitLines(name, 2, 12), {
          x: x + 0.2,
          y: TOP + 0.18,
          w: 2.55,
          h: 0.55,
          fontSize: 14,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        // 分数徽章
        slide.addShape(pptx.ShapeType.roundRect, {
          x: x + 0.2,
          y: TOP + 0.85,
          w: 0.9,
          h: 0.36,
          fill: hit.score >= 80 ? C.goldSoft : 'D1FAE5',
          rectRadius: 0.06,
        });
        slide.addText(String(Math.round(hit.score)), {
          x: x + 0.2,
          y: TOP + 0.85,
          w: 0.9,
          h: 0.36,
          fontSize: 14,
          bold: true,
          color: C.ink,
          align: 'center',
          valign: 'middle',
          fontFace: FONT,
          margin: 0,
        });
        slide.addText('匹配分', {
          x: x + 1.2,
          y: TOP + 0.9,
          w: 1.5,
          h: 0.28,
          fontSize: 11,
          color: C.muted,
          fontFace: FONT,
          margin: 0,
        });
        const meta = [
          textOf(hit.sku.skuCode) ? `编码 ${textOf(hit.sku.skuCode)}` : '',
          hit.priceOverlap ? '价格带重合' : '',
          listOf(hit.matchedCategories).slice(0, 2).join(' / '),
        ]
          .filter(Boolean)
          .join('\n');
        slide.addText(fitLines(meta || '品类相关', 3, 14), {
          x: x + 0.2,
          y: TOP + 1.4,
          w: 2.55,
          h: 0.75,
          ...bodyOpts(11),
          color: C.signal,
        });
        label(slide, '命中原因', x + 0.2, TOP + 2.25, 2.55);
        slide.addText(compactReasons(hit.reasons) || '与客户品类/关键词匹配', {
          x: x + 0.2,
          y: TOP + 2.6,
          w: 2.55,
          h: 1.2,
          ...bodyOpts(11),
        });
      });
    });
  } else if (products.length || categories.length || hasProductSummary) {
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, '产品链接建议', company);
    card(pptx, slide, MX, TOP, 9.16, 4.05);
    const tips = [
      keyword ? `关键词「${keyword}」已用于筛选客户产品与切入点。` : '',
      keywordProducts.length
        ? `关键词相关产品 ${keywordProducts.length} 款，优先作为样品/报价包。`
        : products.length
          ? `客户站内产品 ${products.length} 款，可按品类挑选对标 SKU。`
          : '',
      textOf(ps?.recommendedProducts) ? `策略推荐：${fitLines(ps?.recommendedProducts, 3, 40)}` : '',
      '在「产品库」维护我方 SKU 后，本页将自动输出匹配清单与得分。',
    ]
      .filter(Boolean)
      .join('\n\n');
    slide.addText(fitLines(tips, 12, 40), {
      x: MX + 0.35,
      y: TOP + 0.4,
      w: 8.45,
      h: 3.3,
      ...bodyOpts(14),
    });
  }

  // —— 贸易情报 ——
  if (data.tradeIntelligence) {
    const ti = data.tradeIntelligence;
    const rows = (
      [
        ['海关 / 进口摘要', textOf(ti.customsSummary)],
        ['HS / 品类', [...listOf(ti.hsCodes), ...listOf(ti.importCategories)].slice(0, 10).join(' / ')],
        ['来源国', listOf(ti.topSourceCountries).join('、')],
        ['认证合规', listOf(ti.certifications).join('、')],
        ['Incoterms', textOf(ti.preferredIncoterms)],
        ['典型 MOQ', textOf(ti.typicalMoq)],
        ['采购季', textOf(ti.buyingSeasons)],
        ['采购办公室', textOf(data.strategy?.buyingOfficeLocation)],
        ['风险', [textOf(ti.riskLevel), textOf(ti.riskNotes)].filter(Boolean).join(' — ')],
        ['预估年进口', textOf(ti.estimatedAnnualImport)],
      ] as Array<[string, string]>
    ).filter(([, v]) => isMeaningful(v));
    if (rows.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '贸易情报与合规', company);
      card(pptx, slide, MX, TOP, 9.16, 4.05);
      slide.addTable(
        rows.map(([k, v]) => [
          { text: k, options: { bold: true, color: C.muted, fill: 'F3EEE4' } },
          { text: clipText(v, 90), options: { color: C.ink } },
        ]),
        {
          x: MX + 0.18,
          y: TOP + 0.22,
          w: 8.8,
          colW: [1.9, 6.9],
          fontSize: 11,
          fontFace: FONT,
          border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: C.line }, { pt: 0 }],
          valign: 'middle',
          rowH: Math.min(0.4, 3.6 / Math.max(rows.length, 1)),
        }
      );
    }
  }

  // —— 业务模式 ——
  {
    const ecom = listOf(data.businessModel?.ecommercePresence);
    const exhibits = listOf(data.businessModel?.exhibitionHistory);
    const priceSens = textOf(data.businessScope?.priceSensitivity);
    const brand = textOf(data.businessScope?.brandPositioning);
    const blocks = [
      { t: '销售渠道', b: channels.join('、') },
      { t: '电商布局', b: ecom.join('、') },
      { t: '展会足迹', b: exhibits.join('、') },
      { t: '品牌定位', b: brand },
      { t: '价格敏感度', b: priceSens },
    ].filter((x) => x.b);
    if (blocks.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '业务模式与渠道', company);
      blocks.slice(0, 4).forEach((b, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MX + col * 4.7;
        const y = TOP + row * 2.02;
        card(pptx, slide, x, y, 4.5, 1.9);
        label(slide, b.t, x + 0.18, y + 0.16, 4.1);
        slide.addText(fitLines(b.b, 5, 24), {
          x: x + 0.18,
          y: y + 0.55,
          w: 4.14,
          h: 1.2,
          ...bodyOpts(12),
        });
      });
    }
  }

  // —— SWOT ——
  {
    const quads = [
      { title: '优势', items: listOf(data.swot?.strengths), color: C.ok, bg: 'ECFDF5' },
      { title: '劣势', items: listOf(data.swot?.weaknesses), color: C.bad, bg: 'FEF2F2' },
      { title: '机会', items: listOf(data.swot?.opportunities), color: C.signal, bg: 'F0FDFA' },
      { title: '威胁', items: listOf(data.swot?.threats), color: C.warn, bg: 'FFFBEB' },
    ].filter((q) => q.items.length);
    if (quads.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, 'SWOT 态势', company);
      quads.slice(0, 4).forEach((q, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = MX + col * 4.7;
        const y = TOP + row * 2.02;
        card(pptx, slide, x, y, 4.5, 1.9, q.bg);
        slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: 1.9, fill: q.color });
        slide.addText(q.title, {
          x: x + 0.22,
          y: y + 0.14,
          w: 4.05,
          h: 0.28,
          fontSize: 13,
          bold: true,
          color: q.color,
          fontFace: FONT,
          margin: 0,
        });
        slide.addText(fitLines(q.items.slice(0, 4).map((p) => `• ${p}`).join('\n'), 5, 24), {
          x: x + 0.22,
          y: y + 0.5,
          w: 4.05,
          h: 1.25,
          ...bodyOpts(11),
        });
      });
    }
  }

  // —— 行动计划 ——
  if (actionPlan.length) {
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, '建议行动计划', company);
    actionPlan.slice(0, 6).forEach((step, idx) => {
      const y = TOP + idx * 0.65;
      if (y + 0.55 > BOTTOM) return;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: MX,
        y,
        w: 0.4,
        h: 0.4,
        fill: C.signal,
        rectRadius: 0.08,
      });
      slide.addText(String(idx + 1), {
        x: MX,
        y,
        w: 0.4,
        h: 0.4,
        align: 'center',
        valign: 'middle',
        color: C.white,
        bold: true,
        fontSize: 12,
        fontFace: FONT,
        margin: 0,
      });
      card(pptx, slide, MX + 0.52, y, 8.64, 0.52);
      slide.addText(fitLines(step, 2, 48), {
        x: MX + 0.65,
        y,
        w: 8.35,
        h: 0.52,
        fontSize: 12,
        color: C.ink,
        fontFace: FONT,
        valign: 'middle',
        margin: 0,
      });
    });
  }

  // —— 决策人 3×4 ——
  if (dms.length) {
    const per = 12;
    chunk(dms, per).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1 ? `关键决策人 · ${dms.length} (${pi + 1}/${all.length})` : `关键决策人 · ${dms.length}`,
        company
      );
      page.forEach((dm, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MX + col * 3.1;
        const y = TOP + row * 1.0;
        card(pptx, slide, x, y, 2.95, 0.92);
        slide.addText(fitLines(textOf(dm.name, '联系人'), 1, 14), {
          x: x + 0.12,
          y: y + 0.08,
          w: 1.9,
          h: 0.24,
          fontSize: 12,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        if (textOf(dm.type)) {
          slide.addText(clipText(dm.type, 8), {
            x: x + 2.0,
            y: y + 0.08,
            w: 0.8,
            h: 0.22,
            fontSize: 9,
            bold: true,
            color: C.signal,
            align: 'right',
            fontFace: FONT,
            margin: 0,
          });
        }
        slide.addText(
          fitLines([textOf(dm.title), textOf(dm.emailGuess)].filter(Boolean).join('\n') || '邮箱待补充', 2, 18),
          {
            x: x + 0.12,
            y: y + 0.38,
            w: 2.7,
            h: 0.46,
            ...bodyOpts(10),
            color: C.muted,
          }
        );
      });
    });
  }

  // —— 同类 ——
  if (similar.length) {
    chunk(similar, 6).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1 ? `同类公司 · ${similar.length} (${pi + 1}/${all.length})` : `同类公司 · ${similar.length}`,
        company
      );
      page.forEach((c, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MX + col * 3.1;
        const y = TOP + row * 2.02;
        card(pptx, slide, x, y, 2.95, 1.9);
        slide.addText(fitLines(c.name, 2, 12), {
          x: x + 0.14,
          y: y + 0.14,
          w: 2.65,
          h: 0.5,
          fontSize: 13,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        const loc = [textOf(c.country), textOf(c.website)].filter(Boolean).join(' · ');
        if (loc) {
          slide.addText(clipText(loc, 36), {
            x: x + 0.14,
            y: y + 0.7,
            w: 2.65,
            h: 0.28,
            fontSize: 10,
            color: C.signal,
            fontFace: FONT,
            margin: 0,
          });
        }
        if (textOf(c.mainProducts)) {
          slide.addText(fitLines(c.mainProducts, 4, 14), {
            x: x + 0.14,
            y: y + 1.05,
            w: 2.65,
            h: 0.7,
            ...bodyOpts(11),
          });
        }
      });
    });
  }

  // —— 财务（有数据才） ——
  {
    const finRows = (
      [
        ['预估年营收', textOf(data.financials?.revenueEstimate)],
        ['结算偏好', textOf(data.financials?.paymentTerms)],
        ['品牌 / IP', textOf(data.financials?.ipInfo)],
      ] as Array<[string, string]>
    ).filter(([, v]) => isMeaningful(v));
    const socialLines = [
      textOf(data.socials?.linkedin) ? `LinkedIn: ${clipText(data.socials?.linkedin, 40)}` : '',
      textOf(data.socials?.facebook) ? `Facebook: ${clipText(data.socials?.facebook, 40)}` : '',
      textOf(data.socials?.instagram) ? `Instagram: ${clipText(data.socials?.instagram, 40)}` : '',
      textOf(data.socials?.similarWebTraffic)
        ? `流量: ${clipText(data.socials?.similarWebTraffic, 40)}`
        : '',
    ].filter(Boolean);
    const traffic = (data.trafficAnalysis || []).filter(
      (t) => isMeaningful(t?.category) || isMeaningful(t?.topKeywords)
    );
    if (finRows.length || socialLines.length || traffic.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '财务与流量', company);
      let x = MX;
      if (finRows.length) {
        card(pptx, slide, x, TOP, 4.4, socialLines.length ? 2.2 : 4.05);
        label(slide, '财务概况', x + 0.18, TOP + 0.16, 4.0);
        slide.addTable(
          finRows.map(([k, v]) => [
            { text: k, options: { bold: true, color: C.muted } },
            { text: clipText(v, 28), options: { color: C.ink } },
          ]),
          {
            x: x + 0.18,
            y: TOP + 0.55,
            w: 4.0,
            fontSize: 11,
            fontFace: FONT,
            border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: C.line }, { pt: 0 }],
            valign: 'middle',
            rowH: 0.4,
          }
        );
        if (socialLines.length) {
          card(pptx, slide, x, TOP + 2.4, 4.4, 1.65);
          label(slide, '社交与流量', x + 0.18, TOP + 2.55, 4.0);
          slide.addText(fitLines(socialLines.join('\n'), 4, 28), {
            x: x + 0.18,
            y: TOP + 2.95,
            w: 4.0,
            h: 0.95,
            ...bodyOpts(11),
          });
        }
        x = 5.05;
      }
      if (traffic.length) {
        card(pptx, slide, x, TOP, finRows.length ? 4.53 : 9.16, 4.05);
        label(slide, '流量关键词', x + 0.18, TOP + 0.16, 4.2);
        const headers = [
          { text: '分类', options: { bold: true, fill: C.ink, color: C.white } },
          { text: '类型', options: { bold: true, fill: C.ink, color: C.white } },
          { text: '关键词', options: { bold: true, fill: C.ink, color: C.white } },
        ];
        const trows = traffic.slice(0, 8).map((t) => [
          { text: clipText(t.category, 12) },
          { text: clipText(t.trafficType, 10) },
          { text: clipText(t.topKeywords, 28) },
        ]);
        slide.addTable([headers, ...trows], {
          x: x + 0.15,
          y: TOP + 0.55,
          w: finRows.length ? 4.2 : 8.85,
          fontSize: 10,
          fontFace: FONT,
          border: [{ pt: 0.5, color: C.line }],
          valign: 'middle',
          rowH: 0.35,
        });
      }
    }
  }
};
