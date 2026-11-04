/**
 * 营销文案流水线：分析功能 → 查阅同类介绍 → 生成方案 → 校验 → 白名单写入海报/图面。
 * 避免生图模型自行「编造英文乱码」。前台进度文案保持中性，不暴露供应商名。
 *
 * 重点来源：① 生成该产品时的提示词/二次创作改点 ② 同类产品公开介绍 ③ 去 AI 腔的人感短句。
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
  /**
   * 生成该产品时的提示词 / 二次创作改点 / 画布资产 prompt。
   * 含功能、外观、互动重点，比纯网搜更贴近本款。
   */
  generationPromptHints?: string[];
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

/** 常见外贸海报可用词根（宽松）；长词若不沾边更易判假词 */
const COMMON_STEM =
  /new|toy|robot|dog|cat|car|kids?|child|fun|play|smart|learn|voice|talk|walk|dance|light|music|educat|english|program|interact|inspire|creat|remote|control|safe|age|model|series|feature|bonus|pack|gift|export|oem|odm|b2b|for|and|with|the|a|an|of|to|in|on|by/i;

const looksLikeGibberishWord = (bare: string): boolean => {
  if (bare.length < 2) return false;
  if (!/[aeiouyAEIOUY]/.test(bare) && bare.length >= 4) return true;
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(bare)) return true;
  if (/^[A-Za-z]{11,}$/.test(bare) && !/ing$|tion$|ment$|ness$|able$/i.test(bare)) return true;
  if (bare.length >= 7 && !COMMON_STEM.test(bare) && /[aeiou].*[aeiou].*[aeiou]/i.test(bare)) {
    if (/([a-z])\1/i.test(bare) && /(ipees|tipees|lish|ectipe|ommect)/i.test(bare)) return true;
    if (/(ipees|tipees|ommect|paglish|sofs|soice)/i.test(bare)) return true;
  }
  if (/^(sofs|soice|suo|paglish|commectipees|edricatiore|fnmbrating)$/i.test(bare)) return true;
  return false;
};

const looksLikeGibberish = (line: string): boolean => {
  const s = line.trim();
  if (!s) return true;
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  let bad = 0;
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z']/g, '');
    if (bare.length < 2) continue;
    if (looksLikeGibberishWord(bare)) bad += 1;
  }
  return bad >= 1;
};

const normalizeLine = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/^[\d.\-•*)\]]+\s*/, '')
    .trim()
    .slice(0, 48);

const nearDuplicate = (a: string, b: string): boolean => {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(/\s+/));
  const wb = nb.split(/\s+/);
  const overlap = wb.filter((w) => wa.has(w)).length;
  return overlap >= Math.max(2, Math.ceil(wb.length * 0.7));
};

const SAFE_FEATURE_BANK = [
  'NEW for 2026',
  'Smart Educational Robot',
  'Voice Interactive Learning',
  'Fun English Learning',
  'Programmable Dance Moves',
  'Walk Talk Light',
  'Inspire Kids Creativity',
  'Remote Control Play',
  'Early Learning Fun',
  'Catalog Ready Quality',
];

/** 从生图/二次创作提示词里抽出可读卖点线索（去掉工程约束块） */
export const distillGenerationPromptHints = (rawHints: string[]): string => {
  const scrub = (s: string) =>
    s
      .replace(/NEGATIVE CONSTRAINTS[\s\S]*$/gi, '')
      .replace(/IDENTITY LOCK[\s\S]*?(?=\n[A-Z]{3,}|\n$)/gi, '')
      .replace(/ON-IMAGE TEXT POLICY[\s\S]*?(?=\n[A-Z]{3,}|\n$)/gi, '')
      .replace(/TYPOGRAPHY SAFE LAYOUT[\s\S]*?(?=\n[A-Z]{3,}|\n$)/gi, '')
      .replace(/PRODUCT COMPOSITE[\s\S]*?(?=\n[A-Z]{3,}|\n$)/gi, '')
      .replace(/MULTI-IMAGE ROLES[\s\S]*?(?=\n[A-Z]{3,}|\n$)/gi, '')
      .replace(/REFERENCE: Image[^\n]*/gi, '')
      .replace(/Also avoid:[^\n]*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const chunks = (rawHints || [])
    .map((h) => scrub(String(h || '')))
    .filter((h) => h.length >= 12)
    .slice(0, 6)
    .map((h) => h.slice(0, 900));
  if (!chunks.length) return '';
  return chunks.join('\n---\n').slice(0, 2800);
};

const filterApprovedLines = (lines: string[], seeds: string[]): string[] => {
  const out: string[] = [];
  for (const raw of [...seeds, ...lines]) {
    const line = normalizeLine(String(raw || ''));
    if (!line || line.length < 2) continue;
    if (looksLikeGibberish(line)) continue;
    if (line.split(/\s+/).length > 8) continue;
    if (out.some((x) => nearDuplicate(x, line))) continue;
    out.push(line);
    if (out.length >= 6) break;
  }
  return out;
};

/** 白名单过短时用安全卖点库补齐（仍过乱码/去重门） */
const ensureMinCopyLines = (
  lines: string[],
  opts: { productName?: string; min?: number }
): string[] => {
  const min = opts.min ?? 4;
  let out = [...lines];
  const fillers = [opts.productName || '', ...SAFE_FEATURE_BANK];
  for (const f of fillers) {
    if (out.length >= min) break;
    const line = normalizeLine(f);
    if (!line || looksLikeGibberish(line)) continue;
    if (out.some((x) => nearDuplicate(x, line))) continue;
    out.push(line);
  }
  return out.slice(0, 6);
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

const SYSTEM = `你是澄海玩具厂的资深业务文案，给展会目录和海报写短句。口吻要像真人同事写的：具体、好记、有一点温度，不要公关腔或 AI 腔。

必须严格按流水线工作：
1) 先读「本品生成提示词」——这是本款外形、功能、互动的第一真相；
2) 再参考同类产品介绍的常见卖点说法（勿照抄品牌名）；
3) 抽出 4～6 条可印在海报上的英文短句；
4) 自检拼写与语义，并写一句给业务员看的中文说明。

只输出 JSON（不要 markdown）：
{
  "productSummaryZh": "一句话中文产品理解（口语、有温度）",
  "functions": ["功能1", "功能2"],
  "approvedOnImageEn": ["NEW for 2026", "Walks And Talks", "Early Learning Fun"],
  "panelCaptionZh": "给业务员看的中文说明（不上图，像人说话）",
  "panelCaptionEn": "optional longer English for UI panels only — warm, concrete",
  "qaNotes": ["spelling ok", "grounded in generation prompts"]
}

approvedOnImageEn 硬性规则：
- 每条 2～6 个英文单词，真实词典词，禁止乱码/假词/拉丁胡拼
- 必须 4～6 条且禁止重复或近义重复
- 优先顺序：年份钩子 → 品名/品类 → 来自生成提示词的核心功能（走路/对话/灯光/遥控/编程等）→ 学习/陪伴价值
- 禁止假认证、假奖项、长段落、参数表
- 禁止 AI 套话：revolutionize / unleash / elevate / seamless / dive into / next-level / game-changer / empower / unlock potential
- 用孩子能玩到的具体动作或家长听得懂的好处（Walks And Talks、Voice Interactive Learning）
- 若提示词与网搜冲突，以本品生成提示词为准
- 若不确定某句拼写，换一句真实卖点，不要整份留空

panelCaptionZh / productSummaryZh：像业务员微信里跟客户介绍，短、暖、不堆形容词。`;

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

  const distilledHints = distillGenerationPromptHints(input.generationPromptHints || []);

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
    const approved = ensureMinCopyLines(fallbackLines, {
      productName: input.productName,
      min: 4,
    });
    return {
      productSummaryZh: input.productName || '产品',
      functions: [],
      approvedOnImageEn: approved,
      panelCaptionZh: input.userHighlight || '',
      panelCaptionEn: '',
      qaPassed: approved.length >= 4,
      qaNotes: ['文案服务未就绪，使用品名+安全卖点库'],
      onImageLockBlock: lockedOnImageCopyBlock(approved),
      engine: approved.length ? 'seed' : 'fallback',
    };
  }

  input.onProgress?.('正在分析产品功能…');
  let evidence = '';
  if (!input.skipSearch) {
    evidence = await gatherSimilarIntroEvidence(productHint, input.onProgress);
  }

  input.onProgress?.('正在结合本品提示词生成文案…');
  const user = [
    `品名：${input.productName || '（未填）'}`,
    input.skuCode ? `型号：${input.skuCode}` : '',
    input.category ? `品类：${input.category}` : '',
    input.specs ? `规格/备注：${input.specs.slice(0, 400)}` : '',
    input.userHighlight ? `用户强调：${input.userHighlight.slice(0, 500)}` : '',
    seeds.length ? `用户已填可上图短句：\n${seeds.join('\n')}` : '',
    distilledHints
      ? `【本品生成提示词 / 二次创作重点 — 优先采信】\n${distilledHints}`
      : '（无生成提示词摘录；请结合用户强调与玩具常识）',
    evidence
      ? `同类介绍摘录（仅参考措辞与常见卖点结构，勿照抄品牌名；与本品提示词冲突时以本品为准）：\n${evidence}`
      : '（无外部摘录；以本品提示词 + 外贸常识为主）',
    `语种偏好：${input.locale === 'en' ? 'English on-image' : '中文说明 + 英文上图短句'}`,
    '文风：去 AI 化，像真人写的目录短句；上图只短句，不要段落。',
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

    let approved = ensureMinCopyLines(
      filterApprovedLines(
        Array.isArray(parsed.approvedOnImageEn) ? parsed.approvedOnImageEn.map(String) : [],
        seeds.length ? seeds : fallbackLines
      ),
      { productName: input.productName, min: 4 }
    );

    let qaPassed = approved.length >= 4 && !approved.some(looksLikeGibberish);
    const qaNotes = [
      ...(Array.isArray(parsed.qaNotes) ? parsed.qaNotes.map(String) : []),
      distilledHints ? 'used-generation-prompts' : 'no-generation-prompts',
      qaPassed ? 'local-spell-gate:pass' : 'local-spell-gate:fail→topped-up',
    ];

    if (approved.length) {
      try {
        input.onProgress?.('正在复核海报短句…');
        const checkRaw = await callQwen(
          `Check these English poster lines for a toy catalog.
Reply JSON {"ok":true|false,"fixed":["..."],"bad":["..."]}.
Reject gibberish / non-words / duplicates / AI buzzwords (revolutionize, unleash, elevate, seamless, game-changer).
Keep 4-6 UNIQUE warm concrete marketing lines, 2-6 real dictionary words each. Do NOT return empty.
Prefer features grounded in: ${(input.productName || productHint).slice(0, 80)}
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
          const fixed = ensureMinCopyLines(
            filterApprovedLines(check.fixed.map(String), seeds),
            { productName: input.productName, min: 4 }
          );
          if (fixed.length >= 4) {
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

    const finalLines = ensureMinCopyLines(
      approved.length ? approved : fallbackLines,
      { productName: input.productName, min: 4 }
    );
    return {
      productSummaryZh: (parsed.productSummaryZh || '').trim() || productHint,
      functions: Array.isArray(parsed.functions) ? parsed.functions.map(String).slice(0, 8) : [],
      approvedOnImageEn: finalLines,
      panelCaptionZh: (parsed.panelCaptionZh || '').trim(),
      panelCaptionEn: (parsed.panelCaptionEn || '').trim(),
      qaPassed: finalLines.length >= 4 && !finalLines.some(looksLikeGibberish),
      qaNotes,
      onImageLockBlock: lockedOnImageCopyBlock(finalLines),
      engine: finalLines.length ? (approved.length ? 'llm' : 'seed') : 'fallback',
    };
  } catch (e) {
    console.warn('[marketingCopyPipeline] failed', e);
    const finalLines = ensureMinCopyLines(fallbackLines, {
      productName: input.productName,
      min: 4,
    });
    return {
      productSummaryZh: productHint,
      functions: [],
      approvedOnImageEn: finalLines,
      panelCaptionZh: input.userHighlight || '',
      panelCaptionEn: '',
      qaPassed: finalLines.length >= 4,
      qaNotes: ['pipeline-error:fallback-to-seed-bank'],
      onImageLockBlock: finalLines.length
        ? lockedOnImageCopyBlock(finalLines)
        : emptyLock,
      engine: finalLines.length ? 'seed' : 'fallback',
    };
  }
};
