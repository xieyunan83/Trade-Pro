/**
 * 营销文案流水线：分析功能 → 查阅同类介绍 → 生成方案 → 校验 → 白名单写入海报/图面。
 * 避免生图模型自行「编造英文乱码」。前台进度文案保持中性，不暴露供应商名。
 */
import { callQwen } from './geminiService';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';
import { loadDataProviderLocal } from './dataProviders';
import { lockedOnImageCopyBlock } from './creativeQualityKit';

export type MarketingCopyPipelineInput = {
  productName?: string;
  skuCode?: string;
  category?: string;
  specs?: string;
  userHighlight?: string;
  locale?: 'zh' | 'en';
  /** 已有用户填好的短句（海报表单等），优先纳入白名单 */
  seedLines?: string[];
  skipSearch?: boolean;
  onProgress?: (msg: string) => void;
};

export type MarketingCopyPlan = {
  productSummaryZh: string;
  functions: string[];
  approvedOnImageEn: string[];
  panelCaptionZh: string;
  panelCaptionEn: string;
  qaPassed: boolean;
  qaNotes: string[];
  /** 可直接拼进生图提示 */
  onImageLockBlock: string;
  engine: 'llm' | 'seed' | 'fallback';
};

const looksLikeGibberish = (line: string): boolean => {
  const s = line.trim();
  if (!s) return true;
  if (/[\u4e00-\u9fff]/.test(s)) return false; // 中文另计
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  let bad = 0;
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z']/g, '');
    if (bare.length < 2) continue;
    // 罕见辅音串 / 元音极少 → 疑似乱码
    if (!/[aeiouyAEIOUY]/.test(bare) && bare.length >= 4) bad += 1;
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(bare)) bad += 1;
    if (/^[A-Za-z]{12,}$/.test(bare) && !/ing$|tion$|ment$|ness$/i.test(bare)) bad += 1;
  }
  return bad >= Math.max(1, Math.ceil(words.length * 0.35));
};

const normalizeLine = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/^[\d.\-•*)\]]+\s*/, '')
    .trim()
    .slice(0, 64);

const filterApprovedLines = (lines: string[], seeds: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...seeds, ...lines]) {
    const line = normalizeLine(String(raw || ''));
    if (!line || line.length < 2) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    if (looksLikeGibberish(line)) continue;
    // 拒超长段落
    if (line.split(/\s+/).length > 10) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 6) break;
  }
  return out;
};

export const isMarketingCopyServiceReady = (): boolean => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) return true;
  return listPoolKeys('qwen').length > 0 || !!(env.qwenApiKey || '').trim();
};

const gatherSimilarIntroEvidence = async (
  productHint: string,
  onProgress?: (msg: string) => void
): Promise<string> => {
  try {
    const { hasTavilyKey, tavilySearch } = await import('./tavilyService');
    if (!hasTavilyKey()) return '';
    onProgress?.('正在查阅同类产品介绍…');
    const q = `${productHint} interactive toy features benefits product description`;
    const data = await tavilySearch(q, {
      maxResults: 5,
      searchDepth: 'basic',
      includeAnswer: true,
    });
    const bits = (data?.results || [])
      .slice(0, 5)
      .map((r: any) => `${r.title || ''}\n${(r.content || '').slice(0, 280)}`)
      .filter(Boolean);
    if (data?.answer) bits.unshift(String(data.answer).slice(0, 400));
    return bits.join('\n---\n').slice(0, 3500);
  } catch {
    return '';
  }
};

const SYSTEM = `你是澄海玩具出口目录文案专家。必须严格按流水线工作：
1) 分析产品功能与卖点；2) 参考同类产品如何介绍；3) 生成可印在海报上的短英文；4) 自检拼写与语义。
只输出 JSON（不要 markdown）：
{
  "productSummaryZh": "一句话中文产品理解",
  "functions": ["功能1", "功能2"],
  "approvedOnImageEn": ["NEW for 2026", "Interactive Robot Dog", "Walk Talk Light"],
  "panelCaptionZh": "给业务员看的中文说明（不上图）",
  "panelCaptionEn": "optional longer English for UI panels only",
  "qaNotes": ["spelling ok", "no gibberish"]
}
approvedOnImageEn 硬性规则：
- 每条 2～8 个英文单词，真实词典词，禁止乱码/假词/拉丁胡拼
- 最多 6 条；优先：年份钩子 / 品名 / 2～3 个功能卖点
- 禁止假认证、假奖项、长段落、参数表
- 若不确定英文拼写，宁可少写，也不要编造`;

/**
 * 分析 → 搜索 → 方案 → 校验 → 返回图面白名单文案。
 */
export const runMarketingCopyPipeline = async (
  input: MarketingCopyPipelineInput
): Promise<MarketingCopyPlan> => {
  const seeds = (input.seedLines || []).map(normalizeLine).filter(Boolean);
  const productHint =
    [input.productName, input.category, input.skuCode].filter(Boolean).join(' ') ||
    input.userHighlight ||
    'toy product';

  const fallbackLines = filterApprovedLines(
    [
      input.productName || '',
      input.skuCode ? `Model ${input.skuCode}` : '',
      ...seeds,
    ],
    []
  );

  const emptyLock = lockedOnImageCopyBlock([]);
  if (!isMarketingCopyServiceReady()) {
    const approved = fallbackLines.length ? fallbackLines : [];
    return {
      productSummaryZh: input.productName || '产品',
      functions: [],
      approvedOnImageEn: approved,
      panelCaptionZh: input.userHighlight || '',
      panelCaptionEn: '',
      qaPassed: approved.length > 0,
      qaNotes: ['文案服务未就绪，仅使用品名/表单短句'],
      onImageLockBlock: lockedOnImageCopyBlock(approved),
      engine: approved.length ? 'seed' : 'fallback',
    };
  }

  input.onProgress?.('正在分析产品功能…');
  let evidence = '';
  if (!input.skipSearch) {
    evidence = await gatherSimilarIntroEvidence(productHint, input.onProgress);
  }

  input.onProgress?.('正在生成并校验文案方案…');
  const user = [
    `品名：${input.productName || '（未填）'}`,
    input.skuCode ? `型号：${input.skuCode}` : '',
    input.category ? `品类：${input.category}` : '',
    input.specs ? `规格/备注：${input.specs.slice(0, 400)}` : '',
    input.userHighlight ? `用户强调：${input.userHighlight.slice(0, 500)}` : '',
    seeds.length ? `用户已填可上图短句：\n${seeds.join('\n')}` : '',
    evidence
      ? `同类介绍摘录（仅参考措辞，勿照抄品牌名）：\n${evidence}`
      : '（无外部摘录，请结合玩具外贸常识；必要时用联网能力核实功能表述）',
    `语种偏好：${input.locale === 'en' ? 'English on-image' : '中文说明 + 英文上图短句'}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await callQwen(`${SYSTEM}\n\n---\n${user}`, {
      jsonMode: true,
      task: 'analysis',
      timeoutMs: 90_000,
      maxTokens: 2048,
      enableSearch: !evidence && !input.skipSearch,
      forcedSearch: !evidence && !input.skipSearch,
    });

    let parsed: {
      productSummaryZh?: string;
      functions?: string[];
      approvedOnImageEn?: string[];
      panelCaptionZh?: string;
      panelCaptionEn?: string;
      qaNotes?: string[];
    } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    const approved = filterApprovedLines(
      Array.isArray(parsed.approvedOnImageEn) ? parsed.approvedOnImageEn.map(String) : [],
      seeds.length ? seeds : fallbackLines
    );

    // 二次校验：再让模型挑出错词；失败则本地规则已滤
    let qaPassed = approved.length > 0 && !approved.some(looksLikeGibberish);
    const qaNotes = [
      ...(Array.isArray(parsed.qaNotes) ? parsed.qaNotes.map(String) : []),
      qaPassed ? 'local-spell-gate:pass' : 'local-spell-gate:fail→trimmed',
    ];

    if (approved.length && qaPassed) {
      try {
        input.onProgress?.('正在复核海报短句…');
        const checkRaw = await callQwen(
          `Check these English poster lines. Reply JSON {"ok":true|false,"fixed":["..."],"bad":["..."]}.
Reject gibberish / non-words. Keep meaning. Max 6 lines, 2-8 words each.
Lines:\n${approved.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
          {
            jsonMode: true,
            task: 'analysis',
            timeoutMs: 45_000,
            maxTokens: 1024,
            enableSearch: false,
          }
        );
        let check: { ok?: boolean; fixed?: string[]; bad?: string[] } = {};
        try {
          check = JSON.parse(checkRaw);
        } catch {
          const m = checkRaw.match(/\{[\s\S]*\}/);
          if (m) check = JSON.parse(m[0]);
        }
        if (Array.isArray(check.fixed) && check.fixed.length) {
          const fixed = filterApprovedLines(check.fixed.map(String), seeds);
          if (fixed.length) {
            return {
              productSummaryZh: (parsed.productSummaryZh || '').trim() || productHint,
              functions: Array.isArray(parsed.functions)
                ? parsed.functions.map(String).slice(0, 8)
                : [],
              approvedOnImageEn: fixed,
              panelCaptionZh: (parsed.panelCaptionZh || '').trim(),
              panelCaptionEn: (parsed.panelCaptionEn || '').trim(),
              qaPassed: check.ok !== false,
              qaNotes: [...qaNotes, check.ok === false ? 'recheck:rewrote' : 'recheck:ok'],
              onImageLockBlock: lockedOnImageCopyBlock(fixed),
              engine: 'llm',
            };
          }
        }
        if (check.ok === false) qaPassed = false;
      } catch {
        /* 复核失败仍用本地过滤结果 */
      }
    }

    const finalLines = approved.length ? approved : fallbackLines;
    return {
      productSummaryZh: (parsed.productSummaryZh || '').trim() || productHint,
      functions: Array.isArray(parsed.functions) ? parsed.functions.map(String).slice(0, 8) : [],
      approvedOnImageEn: finalLines,
      panelCaptionZh: (parsed.panelCaptionZh || '').trim(),
      panelCaptionEn: (parsed.panelCaptionEn || '').trim(),
      qaPassed: finalLines.length > 0 && !finalLines.some(looksLikeGibberish),
      qaNotes,
      onImageLockBlock: lockedOnImageCopyBlock(finalLines),
      engine: finalLines.length ? (approved.length ? 'llm' : 'seed') : 'fallback',
    };
  } catch (e) {
    console.warn('[marketingCopyPipeline] failed', e);
    return {
      productSummaryZh: productHint,
      functions: [],
      approvedOnImageEn: fallbackLines,
      panelCaptionZh: input.userHighlight || '',
      panelCaptionEn: '',
      qaPassed: fallbackLines.length > 0,
      qaNotes: ['pipeline-error:fallback-to-seed'],
      onImageLockBlock: fallbackLines.length
        ? lockedOnImageCopyBlock(fallbackLines)
        : emptyLock,
      engine: fallbackLines.length ? 'seed' : 'fallback',
    };
  }
};
