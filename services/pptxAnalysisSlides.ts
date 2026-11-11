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

/**
 * 仅用于页眉/页脚等必须单行的装饰文案。
 * 报告正文禁止用此函数截断——应走 paginateText 续页。
 */
export const clipText = (str: any, maxChars: number): string => {
  const t = sanitize(str);
  if (!t) return '';
  if (maxChars <= 1) return t.slice(0, 1);
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars);
};

/**
 * 估算文本框可容纳字符数。
 * 偏「能装尽装」：略放大系数，避免过碎分页导致百页空报。
 */
export const estimateCharCapacity = (wIn: number, hIn: number, fontSize: number): number => {
  // 中英混排约 0.85–0.95em 宽；再给 12% 余量，优先同页塞满
  const cpl = Math.max(8, Math.floor((wIn * 72) / (fontSize * 0.88)));
  const lineH = (fontSize * 1.28) / 72;
  const lines = Math.max(1, Math.floor(hIn / lineH));
  return Math.max(24, Math.floor(cpl * lines * 1.12));
};

/** 按容量分页，优先在句读处分段；绝不加省略号，保证全文可续页展示 */
export const paginateText = (str: any, maxChars: number): string[] => {
  const t = sanitize(str);
  if (!t) return [];
  const budget = Math.max(12, Math.floor(maxChars));
  if (t.length <= budget) return [t];
  const pages: string[] = [];
  let rest = t;
  while (rest.length) {
    if (rest.length <= budget) {
      pages.push(rest);
      break;
    }
    const window = rest.slice(0, budget);
    const seps = ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', '、', '，', ', ', ' · ', ' / ', ' '];
    let cut = -1;
    for (const sep of seps) {
      const idx = window.lastIndexOf(sep);
      if (idx >= Math.floor(budget * 0.42)) {
        cut = idx + sep.length;
        break;
      }
    }
    if (cut < 0) cut = budget;
    const piece = rest.slice(0, cut).trim();
    if (piece) pages.push(piece);
    rest = rest.slice(cut).trim();
  }
  return pages.filter(Boolean);
};

const hostOfUrl = (url: string): string => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return sanitize(url);
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
  slide.addText(sanitize(title), {
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
  slide.addShape(pptx.ShapeType.ellipse, {
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
  slide.addShape(pptx.ShapeType.rect, {
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
  slide.addText(sanitize(text), {
    x,
    y,
    w,
    h: 0.28,
    fontSize: 13,
    bold: true,
    color,
    fontFace: FONT,
    margin: 0,
    fit: 'shrink',
  });
};

/** 全文分页卡片：仅在整页正文装不下时续页；短文绝不拆成空页 */
const addPagedBodySlides = (
  pptx: any,
  opts: {
    title: string;
    company: string;
    sectionLabel?: string;
    body: string;
    fontSize?: number;
  }
) => {
  const body = sanitize(opts.body);
  if (!body) return;
  const fontSize = opts.fontSize ?? 12;
  const textW = 8.7;
  const textH = opts.sectionLabel ? 3.25 : 3.5;
  const pages = paginateText(body, estimateCharCapacity(textW, textH, fontSize));
  pages.forEach((pageText, i) => {
    const slide = pptx.addSlide();
    paintChrome(
      pptx,
      slide,
      pages.length > 1 ? `${opts.title} (${i + 1}/${pages.length})` : opts.title,
      opts.company
    );
    card(pptx, slide, MX, TOP, 9.16, 4.0);
    if (opts.sectionLabel) {
      label(slide, opts.sectionLabel, MX + 0.22, TOP + 0.18, 8.7);
    }
    slide.addText(pageText, {
      x: MX + 0.22,
      y: opts.sectionLabel ? TOP + 0.55 : TOP + 0.25,
      w: textW,
      h: textH,
      ...bodyOpts(fontSize),
    });
  });
};

/**
 * 稠密多栏卡片：能塞进 2×2 的同页；单块过长才整页续写。
 * 禁止「每个字段拆一页」导致大量空白页。
 */
const addPagedQuadBlocks = (
  pptx: any,
  title: string,
  company: string,
  blocks: Array<{ t: string; b: string }>,
  opts?: { fontSize?: number }
) => {
  const usable = blocks.filter((b) => isMeaningful(b.b));
  if (!usable.length) return;
  const fontSize = opts?.fontSize ?? 12;
  const quarterCap = estimateCharCapacity(4.14, 1.25, fontSize);
  const halfCap = estimateCharCapacity(4.14, 3.2, fontSize);
  const fullCap = estimateCharCapacity(8.7, 3.25, fontSize);

  type Cell = { t: string; b: string; tall?: boolean };
  const queue: Cell[] = [];
  const flush = (pageTitle: string, cells: Cell[]) => {
    if (!cells.length) return;
    const slide = pptx.addSlide();
    paintChrome(pptx, slide, pageTitle, company);
    const tall = cells.length <= 2 || cells.some((c) => c.tall);
    cells.forEach((b, i) => {
      const col = i % 2;
      const row = tall ? 0 : Math.floor(i / 2);
      const x = MX + col * 4.7;
      const y = tall ? TOP : TOP + row * 2.02;
      const h = tall ? 4.05 : 1.9;
      // 单块占满整行宽
      if (cells.length === 1) {
        card(pptx, slide, MX, TOP, 9.16, 4.05);
        label(slide, b.t, MX + 0.2, TOP + 0.16, 8.7);
        slide.addText(b.b, {
          x: MX + 0.2,
          y: TOP + 0.55,
          w: 8.76,
          h: 3.3,
          ...bodyOpts(fontSize),
        });
        return;
      }
      card(pptx, slide, x, y, 4.5, h);
      label(slide, b.t, x + 0.18, y + 0.14, 4.1);
      slide.addText(b.b, {
        x: x + 0.18,
        y: y + 0.5,
        w: 4.14,
        h: h - 0.65,
        ...bodyOpts(fontSize),
      });
    });
  };

  let pageIdx = 0;
  let i = 0;
  while (i < usable.length) {
    const cur = usable[i];
    const len = sanitize(cur.b).length;

    // 超长：整页续写，不占四分之一空卡
    if (len > halfCap) {
      const pages = paginateText(cur.b, fullCap);
      pages.forEach((p, pi) => {
        pageIdx += 1;
        flush(
          pages.length > 1 || usable.length > 1
            ? `${title} · ${cur.t}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ''}`
            : title,
          [{ t: cur.t, b: p }]
        );
      });
      i += 1;
      continue;
    }

    // 中等偏长：本页最多 2 块（左右半屏）
    if (len > quarterCap) {
      const pair: Cell[] = [{ t: cur.t, b: cur.b, tall: true }];
      const next = usable[i + 1];
      if (next && sanitize(next.b).length <= halfCap && sanitize(next.b).length > quarterCap) {
        pair.push({ t: next.t, b: next.b, tall: true });
        i += 2;
      } else if (next && sanitize(next.b).length <= quarterCap) {
        // 把后面短块也并进半屏页（最多再塞 1 个短的会空，所以仍只 2 高卡）
        pair.push({ t: next.t, b: next.b, tall: true });
        i += 2;
      } else {
        i += 1;
      }
      pageIdx += 1;
      flush(usable.length > 2 ? `${title} (${pageIdx})` : title, pair);
      continue;
    }

    // 短块：尽量凑满 4 格
    const pack: Cell[] = [];
    while (i < usable.length && pack.length < 4) {
      const b = usable[i];
      if (sanitize(b.b).length > quarterCap) break;
      pack.push({ t: b.t, b: b.b });
      i += 1;
    }
    if (!pack.length) {
      // 保护：避免死循环
      i += 1;
      continue;
    }
    pageIdx += 1;
    const needNum =
      usable.length > 4 || pageIdx > 1 || i < usable.length;
    flush(needNum ? `${title} (${pageIdx})` : title, pack);
  }
};

/** 产品正文：合成单段，便于同卡展示、必要时整卡续页 */
const buildProductBody = (prod: any): string => {
  const lines = [
    [
      prod.keywordMatch ? '关键词相关' : '',
      textOf(prod.category),
      textOf(prod.role),
      listOf(prod.tags).join('、'),
    ]
      .filter(Boolean)
      .join(' · '),
    textOf(prod.features) ? `功能：${textOf(prod.features)}` : '',
    [textOf(prod.colors), textOf(prod.packaging)].filter(Boolean).length
      ? `颜色/包装：${[textOf(prod.colors), textOf(prod.packaging)].filter(Boolean).join(' · ')}`
      : '',
    [textOf(prod.pitchPoint), textOf(prod.pricingStrategy)].filter(Boolean).length
      ? `切入/定价：${[textOf(prod.pitchPoint), textOf(prod.pricingStrategy)].filter(Boolean).join(' · ')}`
      : '',
    textOf(prod.evidenceSnippet) ? `证据：${textOf(prod.evidenceSnippet)}` : '',
    textOf(prod.evidenceUrl) ? `链接：${textOf(prod.evidenceUrl)}` : '',
  ].filter(Boolean);
  return lines.join('\n');
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

/** 匹配原因：去库内冗余措辞，保留全部条目（由卡片容量分页展示） */
const formatMatchReasons = (reasons: string[]): string =>
  listOf(reasons)
    .map((r) =>
      r
        .replace(/（库内[^）]*）/g, '')
        .replace(/库内「[^」]*」/g, '客户SKU')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n');

export const addEmailStrategySlidesFromGroup = (pptx: any, mailGroup: any) => {
  if (!mailGroup) return;
  const analysisText = [textOf(mailGroup.analysis), mailGroup.sendTip ? `发送提示: ${textOf(mailGroup.sendTip)}` : '']
    .filter(Boolean)
    .join('\n\n');
  if (!analysisText && !textOf(mailGroup.email1) && !textOf(mailGroup.email2) && !textOf(mailGroup.email3)) return;

  if (analysisText) {
    addPagedBodySlides(pptx, {
      title: '开发信策略',
      company: '',
      sectionLabel: '策略逻辑',
      body: analysisText,
    });
  }
  for (const [title, body, sub] of [
    ['Email 1 · 匹配破冰', mailGroup.email1, mailGroup.subject1],
    ['Email 2 · 实力证明', mailGroup.email2, mailGroup.subject2],
    ['Email 3 · 钩子收口', mailGroup.email3, mailGroup.subject3],
  ] as const) {
    if (!textOf(body) && !textOf(sub)) continue;
    const content = textOf(sub) ? `Subject: ${textOf(sub)}\n\n${textOf(body)}` : textOf(body);
    addPagedBodySlides(pptx, { title, company: '', body: content });
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
      if (rows.length) {
        const slide = pptx.addSlide();
        paintChrome(pptx, slide, '企业速览', company);
        card(pptx, slide, MX, TOP, desc ? 4.25 : 9.16, 4.05);
        label(slide, '基本信息', MX + 0.2, TOP + 0.16, 3.8);
        slide.addTable(
          rows.map(([k, v]) => [
            { text: k, options: { bold: true, color: C.muted, fill: 'F3EEE4' } },
            { text: v, options: { color: C.ink } },
          ]),
          {
            x: MX + 0.18,
            y: TOP + 0.55,
            w: desc ? 3.9 : 8.8,
            colW: desc ? [1.25, 2.65] : [1.6, 7.2],
            fontSize: 11,
            fontFace: FONT,
            border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: C.line }, { pt: 0 }],
            valign: 'middle',
            rowH: Math.min(0.52, 3.2 / Math.max(rows.length, 1)),
          }
        );
        if (desc) {
          const descPages = paginateText(desc, estimateCharCapacity(4.28, 3.3, 12));
          const first = descPages[0] || '';
          card(pptx, slide, 4.9, TOP, 4.68, 4.05);
          label(slide, '企业简介', 5.1, TOP + 0.16, 4.2);
          slide.addText(first, {
            x: 5.1,
            y: TOP + 0.55,
            w: 4.28,
            h: 3.3,
            ...bodyOpts(12),
          });
          descPages.slice(1).forEach((pageText, i) => {
            const s2 = pptx.addSlide();
            paintChrome(
              pptx,
              s2,
              `企业简介 (${i + 2}/${descPages.length})`,
              company
            );
            card(pptx, s2, MX, TOP, 9.16, 4.05);
            label(s2, '企业简介', MX + 0.2, TOP + 0.16, 8.7);
            s2.addText(pageText, {
              x: MX + 0.2,
              y: TOP + 0.55,
              w: 8.76,
              h: 3.3,
              ...bodyOpts(12),
            });
          });
        }
      } else if (desc) {
        addPagedBodySlides(pptx, {
          title: '企业速览',
          company,
          sectionLabel: '企业简介',
          body: desc,
        });
      }
    }
  }

  // —— 证据链（摘要全文分页 + 来源卡片全量分页）——
  if (evidence.length) {
    const conf = data.evidenceConfidence;
    const summary = textOf(data.evidenceSummary) || textOf(data.decisionEnrichment?.summaryZh);
    const confTxt = conf != null && Number.isFinite(conf) ? `可信度 ${Math.round(Number(conf) * 100)}%` : '';
    if (summary || confTxt) {
      addPagedBodySlides(pptx, {
        title: '证据链 · 摘要',
        company,
        sectionLabel: '公开来源可信度',
        body: [confTxt, summary].filter(Boolean).join('\n\n'),
      });
    }
    chunk(evidence, 9).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1
          ? `证据链 · 来源 (${pi + 1}/${all.length})`
          : '证据链 · 公开来源',
        company
      );
      page.forEach((e, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = MX + col * 3.1;
        const y = TOP + row * 1.2;
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
        const titleText = textOf(e.title) || hostOfUrl(e.url || '');
        const urlLine = textOf(e.url) ? `\n${hostOfUrl(e.url || '')}` : '';
        slide.addText(titleText + urlLine, {
          x: x + 0.12,
          y: y + 0.36,
          w: 2.7,
          h: 0.66,
          ...bodyOpts(11),
        });
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

  // —— 客户产品画像（全文分页，不截品类列表）——
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
      const sellBody = [
        sellCats.length ? `品类：${sellCats.join('、')}` : '',
        sellTags.length ? `标签：${sellTags.join('、')}` : '',
        coreProducts.length ? `核心：${coreProducts.join('、')}` : '',
        textOf(data.businessScope?.brandPositioning)
          ? `定位：${textOf(data.businessScope.brandPositioning)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const buyBody = [
        procureCats.length ? `采购品类：${procureCats.join('、')}` : '',
        procureTags.length ? `标签：${procureTags.join('、')}` : '',
        textOf(data.businessModel?.procurementInfo)
          ? `习惯：${textOf(data.businessModel.procurementInfo)}`
          : '',
        textOf(data.supplyChain?.role) ? `角色：${textOf(data.supplyChain.role)}` : '',
        listOf(data.targetAudience).length
          ? `客群：${listOf(data.targetAudience).join('、')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      addPagedQuadBlocks(pptx, '客户产品画像', company, [
        { t: '在售 / 分销', b: sellBody || '见官网品类 / 产品明细' },
        { t: '采购 / 进口', b: buyBody || '暂无采购侧结构化线索' },
      ]);
    }
  }

  // —— 市场喜好（长文自动续页）——
  if (hasProductSummary && ps) {
    addPagedQuadBlocks(pptx, '市场喜好与产品策略', company, [
      { t: '终端市场喜好', b: textOf(ps.marketPreference) },
      { t: '推荐切入产品', b: textOf(ps.recommendedProducts) },
      { t: '功能 / 卖点', b: textOf(ps.featureAnalysis) },
      { t: '包装偏好', b: textOf(ps.packagingAnalysis) },
      { t: '颜色偏好', b: textOf(ps.colorPreference) },
    ]);
  }

  // —— 官网品类：每页 6 张；子项同卡展示，仅极端超长才附录续页 ——
  if (categories.length) {
    const overflowCats: Array<{ name: string; rest: string }> = [];
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
        slide.addText(sanitize(cat.categoryName), {
          x: x + 0.12,
          y: y + 0.1,
          w: price ? 1.9 : 2.7,
          h: 0.48,
          fontSize: 12,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
          valign: 'top',
        });
        if (price) {
          slide.addText(sanitize(price), {
            x: x + 2.05,
            y: y + 0.12,
            w: 0.78,
            h: 0.28,
            fontSize: 9,
            bold: true,
            color: C.signal,
            align: 'right',
            fontFace: FONT,
            margin: 0,
            fit: 'shrink',
          });
        }
        const itemsText = listOf(cat.items).join(' · ') || '—';
        const cap = estimateCharCapacity(2.7, 1.1, 10);
        const pages = paginateText(itemsText, cap);
        slide.addText(pages[0] || '—', {
          x: x + 0.12,
          y: y + 0.65,
          w: 2.7,
          h: 1.1,
          ...bodyOpts(10),
          color: C.muted,
        });
        if (pages.length > 1) {
          overflowCats.push({ name: sanitize(cat.categoryName), rest: pages.slice(1).join('\n') });
        }
      });
    });
    // 把各品类溢出子项合并成附录页，避免一页一个空续页
    if (overflowCats.length) {
      addPagedBodySlides(pptx, {
        title: '官网品类 · 子项附录',
        company,
        body: overflowCats.map((o) => `【${o.name}】\n${o.rest}`).join('\n\n'),
      });
    }
  }

  // —— 客户产品明细：默认每页 2 款；偏长独占一页；全文合成，禁止按字段拆空页 ——
  if (products.length) {
    const ordered = [...keywordProducts, ...products.filter((p) => !p.keywordMatch)];
    const dualCap = estimateCharCapacity(8.6, 1.15, 11);
    const soloCap = estimateCharCapacity(8.6, 3.1, 12);

    type ProdPack = { prod: (typeof ordered)[0]; body: string; solo: boolean };
    const packs: ProdPack[] = ordered.map((prod) => {
      const body = buildProductBody(prod);
      const solo = body.length > dualCap;
      return { prod, body, solo };
    });

    const pages: ProdPack[][] = [];
    let buf: ProdPack[] = [];
    const flushBuf = () => {
      if (buf.length) pages.push(buf);
      buf = [];
    };
    packs.forEach((p) => {
      if (p.solo) {
        flushBuf();
        pages.push([p]);
        return;
      }
      if (buf.length >= 2) flushBuf();
      buf.push(p);
    });
    flushBuf();

    pages.forEach((page, pi) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        pages.length > 1
          ? `客户产品明细 · ${products.length} (${pi + 1}/${pages.length})`
          : `客户产品明细 · ${products.length}`,
        company
      );
      page.forEach((pack, i) => {
        const solo = page.length === 1;
        const y = solo ? TOP : TOP + i * 2.05;
        const h = solo ? 4.05 : 1.95;
        const { prod, body } = pack;
        card(pptx, slide, MX, y, 9.16, h);
        slide.addShape(pptx.ShapeType.rect, {
          x: MX,
          y,
          w: 0.08,
          h,
          fill: prod.keywordMatch ? C.gold : C.teal,
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
        slide.addText(sanitize(prod.name), {
          x: MX + 0.25,
          y: y + 0.1,
          w: priceBits ? 6.5 : 8.6,
          h: 0.36,
          fontSize: solo ? 15 : 14,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
          fit: 'shrink',
        });
        if (priceBits) {
          slide.addText(priceBits, {
            x: MX + 6.7,
            y: y + 0.12,
            w: 2.2,
            h: 0.32,
            fontSize: 11,
            bold: true,
            color: C.signal,
            align: 'right',
            fontFace: FONT,
            margin: 0,
            fit: 'shrink',
          });
        }
        const bodyH = solo ? 3.35 : 1.35;
        const cap = solo ? soloCap : dualCap;
        const bodyPages = paginateText(body, cap);
        slide.addText(bodyPages[0] || '', {
          x: MX + 0.25,
          y: y + 0.5,
          w: 8.6,
          h: bodyH,
          ...bodyOpts(solo ? 12 : 11),
        });
        // 仅整卡仍装不下时续页（合并剩余，不再按字段拆）
        if (bodyPages.length > 1) {
          addPagedBodySlides(pptx, {
            title: `产品续 · ${sanitize(prod.name)}`,
            company,
            body: bodyPages.slice(1).join('\n'),
          });
        }
      });
    });
  }

  // —— 我方匹配：每页 3 张；原因同卡展示，溢出合并附录 ——
  if (skuHits.length) {
    const reasonAppendix: string[] = [];
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
        slide.addText(name, {
          x: x + 0.18,
          y: TOP + 0.14,
          w: 2.6,
          h: 0.5,
          fontSize: 13,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: x + 0.18,
          y: TOP + 0.72,
          w: 0.85,
          h: 0.32,
          fill: hit.score >= 80 ? C.goldSoft : 'D1FAE5',
          rectRadius: 0.06,
        });
        slide.addText(String(Math.round(hit.score)), {
          x: x + 0.18,
          y: TOP + 0.72,
          w: 0.85,
          h: 0.32,
          fontSize: 13,
          bold: true,
          color: C.ink,
          align: 'center',
          valign: 'middle',
          fontFace: FONT,
          margin: 0,
        });
        slide.addText('匹配分', {
          x: x + 1.15,
          y: TOP + 0.76,
          w: 1.5,
          h: 0.26,
          fontSize: 11,
          color: C.muted,
          fontFace: FONT,
          margin: 0,
        });
        const meta = [
          textOf(hit.sku.skuCode) ? `编码 ${textOf(hit.sku.skuCode)}` : '',
          hit.priceOverlap ? '价格带重合' : '',
          listOf(hit.matchedCategories).join(' / '),
        ]
          .filter(Boolean)
          .join('\n');
        slide.addText(meta || '品类相关', {
          x: x + 0.18,
          y: TOP + 1.2,
          w: 2.6,
          h: 0.7,
          ...bodyOpts(11),
          color: C.signal,
        });
        label(slide, '命中原因', x + 0.18, TOP + 2.0, 2.6);
        const reasonsFull = formatMatchReasons(hit.reasons) || '与客户品类/关键词匹配';
        const reasonPages = paginateText(reasonsFull, estimateCharCapacity(2.6, 1.7, 11));
        slide.addText(reasonPages[0], {
          x: x + 0.18,
          y: TOP + 2.35,
          w: 2.6,
          h: 1.5,
          ...bodyOpts(11),
        });
        if (reasonPages.length > 1) {
          reasonAppendix.push(`【${name}】\n${reasonPages.slice(1).join('\n')}`);
        }
      });
    });
    if (reasonAppendix.length) {
      addPagedBodySlides(pptx, {
        title: '匹配原因附录',
        company,
        body: reasonAppendix.join('\n\n'),
      });
    }
  } else if (products.length || categories.length || hasProductSummary) {
    const tips = [
      keyword ? `关键词「${keyword}」已用于筛选客户产品与切入点。` : '',
      keywordProducts.length
        ? `关键词相关产品 ${keywordProducts.length} 款，优先作为样品/报价包。`
        : products.length
          ? `客户站内产品 ${products.length} 款，可按品类挑选对标 SKU。`
          : '',
      textOf(ps?.recommendedProducts) ? `策略推荐：${textOf(ps?.recommendedProducts)}` : '',
      '在「产品库」维护我方 SKU 后，本页将自动输出匹配清单与得分。',
    ]
      .filter(Boolean)
      .join('\n\n');
    addPagedBodySlides(pptx, {
      title: '产品链接建议',
      company,
      body: tips,
      fontSize: 14,
    });
  }

  // —— 贸易情报：短字段表 + 长字段全文续页 ——
  if (data.tradeIntelligence) {
    const ti = data.tradeIntelligence;
    const shortRows: Array<[string, string]> = (
      [
        ['来源国', listOf(ti.topSourceCountries).join('、')],
        ['认证合规', listOf(ti.certifications).join('、')],
        ['Incoterms', textOf(ti.preferredIncoterms)],
        ['典型 MOQ', textOf(ti.typicalMoq)],
        ['采购季', textOf(ti.buyingSeasons)],
        ['采购办公室', textOf(data.strategy?.buyingOfficeLocation)],
        ['风险等级', textOf(ti.riskLevel)],
        ['预估年进口', textOf(ti.estimatedAnnualImport)],
      ] as Array<[string, string]>
    ).filter(([, v]) => isMeaningful(v));
    const longBlocks = [
      { t: '海关 / 进口摘要', b: textOf(ti.customsSummary) },
      {
        t: 'HS / 进口品类',
        b: [...listOf(ti.hsCodes), ...listOf(ti.importCategories)].join(' / '),
      },
      { t: '风险说明', b: textOf(ti.riskNotes) },
      { t: '合规备注', b: textOf(ti.complianceNotes) },
    ].filter((x) => isMeaningful(x.b));

    if (shortRows.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '贸易情报与合规', company);
      card(pptx, slide, MX, TOP, 9.16, 4.05);
      slide.addTable(
        shortRows.map(([k, v]) => [
          { text: k, options: { bold: true, color: C.muted, fill: 'F3EEE4' } },
          { text: v, options: { color: C.ink } },
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
          rowH: Math.min(0.42, 3.6 / Math.max(shortRows.length, 1)),
        }
      );
    }
    if (longBlocks.length) {
      addPagedBodySlides(pptx, {
        title: '贸易情报详述',
        company,
        body: longBlocks.map((b) => `【${b.t}】\n${b.b}`).join('\n\n'),
      });
    }
  }

  // —— 业务模式（全文分页）——
  {
    const ecom = listOf(data.businessModel?.ecommercePresence);
    const exhibits = listOf(data.businessModel?.exhibitionHistory);
    const priceSens = textOf(data.businessScope?.priceSensitivity);
    const brand = textOf(data.businessScope?.brandPositioning);
    addPagedQuadBlocks(pptx, '业务模式与渠道', company, [
      { t: '销售渠道', b: channels.join('、') },
      { t: '电商布局', b: ecom.join('、') },
      { t: '展会足迹', b: exhibits.join('、') },
      { t: '品牌定位', b: brand },
      { t: '价格敏感度', b: priceSens },
    ]);
  }

  // —— SWOT：全部条目，超长续页 ——
  {
    const quads = [
      { title: '优势', items: listOf(data.swot?.strengths), color: C.ok, bg: 'ECFDF5' },
      { title: '劣势', items: listOf(data.swot?.weaknesses), color: C.bad, bg: 'FEF2F2' },
      { title: '机会', items: listOf(data.swot?.opportunities), color: C.signal, bg: 'F0FDFA' },
      { title: '威胁', items: listOf(data.swot?.threats), color: C.warn, bg: 'FFFBEB' },
    ].filter((q) => q.items.length);
    if (quads.length) {
      addPagedQuadBlocks(
        pptx,
        'SWOT 态势',
        company,
        quads.map((q) => ({
          t: q.title,
          b: q.items.map((p) => `• ${p}`).join('\n'),
        }))
      );
    }
  }

  // —— 行动计划：每页最多 7 条；超长步骤用稍高行，禁止一步一续页 ——
  if (actionPlan.length) {
    chunk(actionPlan, 7).forEach((page, pi, all) => {
      const slide = pptx.addSlide();
      paintChrome(
        pptx,
        slide,
        all.length > 1 ? `建议行动计划 (${pi + 1}/${all.length})` : '建议行动计划',
        company
      );
      const rowH = Math.min(0.55, 3.95 / Math.max(page.length, 1));
      page.forEach((step, idx) => {
        const globalIdx = pi * 7 + idx;
        const y = TOP + idx * rowH;
        slide.addShape(pptx.ShapeType.rect, {
          x: MX,
          y: y + 0.04,
          w: 0.36,
          h: Math.max(0.32, rowH - 0.1),
          fill: C.signal,
          rectRadius: 0.06,
        });
        slide.addText(String(globalIdx + 1), {
          x: MX,
          y: y + 0.04,
          w: 0.36,
          h: Math.max(0.32, rowH - 0.1),
          align: 'center',
          valign: 'middle',
          color: C.white,
          bold: true,
          fontSize: 11,
          fontFace: FONT,
          margin: 0,
        });
        card(pptx, slide, MX + 0.48, y + 0.02, 8.68, Math.max(0.36, rowH - 0.06));
        slide.addText(step, {
          x: MX + 0.6,
          y: y + 0.02,
          w: 8.4,
          h: Math.max(0.36, rowH - 0.06),
          fontSize: 11,
          color: C.ink,
          fontFace: FONT,
          valign: 'middle',
          margin: 0,
          wrap: true,
        });
      });
    });
  }

  // —— 决策人：3×4=12 / 页 ——
  if (dms.length) {
    chunk(dms, 12).forEach((page, pi, all) => {
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
        slide.addText(textOf(dm.name, '联系人'), {
          x: x + 0.12,
          y: y + 0.08,
          w: 1.9,
          h: 0.24,
          fontSize: 12,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
          fit: 'shrink',
        });
        if (textOf(dm.type)) {
          slide.addText(textOf(dm.type), {
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
            fit: 'shrink',
          });
        }
        slide.addText(
          [textOf(dm.title), textOf(dm.emailGuess)].filter(Boolean).join('\n') || '邮箱待补充',
          {
            x: x + 0.12,
            y: y + 0.36,
            w: 2.7,
            h: 0.48,
            ...bodyOpts(10),
            color: C.muted,
          }
        );
      });
    });
  }

  // —— 同类：每页 6 ——
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
        slide.addText(sanitize(c.name), {
          x: x + 0.12,
          y: y + 0.12,
          w: 2.7,
          h: 0.48,
          fontSize: 12,
          bold: true,
          color: C.ink,
          fontFace: FONT,
          margin: 0,
        });
        const loc = [textOf(c.country), textOf(c.website)].filter(Boolean).join(' · ');
        if (loc) {
          slide.addText(loc, {
            x: x + 0.12,
            y: y + 0.65,
            w: 2.7,
            h: 0.3,
            fontSize: 10,
            color: C.signal,
            fontFace: FONT,
            margin: 0,
          });
        }
        if (textOf(c.mainProducts)) {
          slide.addText(textOf(c.mainProducts), {
            x: x + 0.12,
            y: y + 1.0,
            w: 2.7,
            h: 0.75,
            ...bodyOpts(11),
          });
        }
      });
    });
  }

  // —— 财务与社交（全文）——
  {
    const finRows = (
      [
        ['预估年营收', textOf(data.financials?.revenueEstimate)],
        ['结算偏好', textOf(data.financials?.paymentTerms)],
        ['品牌 / IP', textOf(data.financials?.ipInfo)],
      ] as Array<[string, string]>
    ).filter(([, v]) => isMeaningful(v));
    const socialLines = [
      textOf(data.socials?.linkedin) ? `LinkedIn: ${textOf(data.socials?.linkedin)}` : '',
      textOf(data.socials?.facebook) ? `Facebook: ${textOf(data.socials?.facebook)}` : '',
      textOf(data.socials?.instagram) ? `Instagram: ${textOf(data.socials?.instagram)}` : '',
      textOf(data.socials?.youtube) ? `YouTube: ${textOf(data.socials?.youtube)}` : '',
      textOf(data.socials?.similarWebTraffic)
        ? `流量: ${textOf(data.socials?.similarWebTraffic)}`
        : '',
    ].filter(Boolean);
    const traffic = (data.trafficAnalysis || []).filter(
      (t) => isMeaningful(t?.category) || isMeaningful(t?.topKeywords)
    );
    if (finRows.length) {
      const slide = pptx.addSlide();
      paintChrome(pptx, slide, '财务概况', company);
      card(pptx, slide, MX, TOP, 9.16, 4.05);
      slide.addTable(
        finRows.map(([k, v]) => [
          { text: k, options: { bold: true, color: C.muted, fill: 'F3EEE4' } },
          { text: v, options: { color: C.ink } },
        ]),
        {
          x: MX + 0.18,
          y: TOP + 0.35,
          w: 8.8,
          colW: [1.8, 7.0],
          fontSize: 12,
          fontFace: FONT,
          border: [{ pt: 0 }, { pt: 0 }, { pt: 0.5, color: C.line }, { pt: 0 }],
          valign: 'middle',
          rowH: 0.55,
        }
      );
    }
    if (socialLines.length) {
      addPagedBodySlides(pptx, {
        title: '社交与流量',
        company,
        body: socialLines.join('\n'),
      });
    }
    if (traffic.length) {
      chunk(traffic, 10).forEach((page, pi, all) => {
        const slide = pptx.addSlide();
        paintChrome(
          pptx,
          slide,
          all.length > 1 ? `流量关键词 (${pi + 1}/${all.length})` : '流量关键词',
          company
        );
        card(pptx, slide, MX, TOP, 9.16, 4.05);
        const headers = [
          { text: '分类', options: { bold: true, fill: C.ink, color: C.white } },
          { text: '类型', options: { bold: true, fill: C.ink, color: C.white } },
          { text: '关键词', options: { bold: true, fill: C.ink, color: C.white } },
        ];
        const trows = page.map((t) => [
          { text: textOf(t.category) },
          { text: textOf(t.trafficType) },
          { text: textOf(t.topKeywords) },
        ]);
        slide.addTable([headers, ...trows], {
          x: MX + 0.18,
          y: TOP + 0.25,
          w: 8.8,
          colW: [1.8, 1.5, 5.5],
          fontSize: 11,
          fontFace: FONT,
          border: [{ pt: 0.5, color: C.line }],
          valign: 'middle',
          rowH: 0.34,
        });
      });
    }
  }
};
