/**
 * 建站「专业润色」Pass：去 AI 模板感，保留区块结构与已嵌入素材。
 * 设计工序参考 Damir Sokolovsky 的 unslop（CC BY 4.0）思想，改编为外贸展厅站规则；
 * 前台仅展示「专业润色」等中性文案。
 * @see https://github.com/heydamir/unslop
 */
import {
  extractHtmlDocument,
  generateSiteHtmlWithLlm,
  getSiteVibeLlmStatus,
  hardenPreviewHtml,
  type SiteVibeGenerateResult,
} from './siteVibeAgent';
import { SITE_ANTI_SLOP_RULES } from './siteAntiSlopRules';

export { SITE_ANTI_SLOP_RULES } from './siteAntiSlopRules';

/** 用户可选的视觉处理方式 */
export type SiteVisualProcessMode = 'fast' | 'direction' | 'polish' | 'direction_polish';

export type SiteDirectionPreset = {
  character: string;
  world: string;
  moment: string;
  signature: string;
};

export const SITE_VISUAL_PROCESS_OPTS: Array<{
  id: SiteVisualProcessMode;
  label: string;
  tip: string;
  badge?: string;
}> = [
  {
    id: 'fast',
    label: '快速出站',
    tip: '直接生成成品站，最快、最省算力',
  },
  {
    id: 'direction',
    label: '先定风格再生成',
    tip: '先选气质与场景，一次定调后再写站',
  },
  {
    id: 'polish',
    label: '先出站再专业润色',
    tip: '先出成品，再去模板感；多数人推荐',
    badge: '推荐',
  },
  {
    id: 'direction_polish',
    label: '定风格 + 专业润色',
    tip: '最稳，耗时与额度略高',
  },
];

export const DIRECTION_CHARACTER_OPTS = ['稳重务实', '潮玩活泼', '精品克制', '科技利落'] as const;
export const DIRECTION_WORLD_OPTS = [
  '澄海注塑工厂',
  '海外买手展厅',
  '精品玩具店',
  '集装箱出口现场',
] as const;
export const DIRECTION_MOMENT_OPTS = [
  '首屏真产品静物',
  '产线与质检',
  '证书与验厂背书',
  '询盘互动焦点',
] as const;
export const DIRECTION_SIGNATURE_OPTS = [
  'WhatsApp 联系绿点',
  'MOQ 角标',
  '工厂编号条',
  '不需要签名细节',
] as const;

export const defaultSiteDirection = (): SiteDirectionPreset => ({
  character: '稳重务实',
  world: '澄海注塑工厂',
  moment: '首屏真产品静物',
  signature: 'WhatsApp 联系绿点',
});

export const needsDirectionFields = (mode: SiteVisualProcessMode): boolean =>
  mode === 'direction' || mode === 'direction_polish';

export const needsPolishPass = (mode: SiteVisualProcessMode): boolean =>
  mode === 'polish' || mode === 'direction_polish';

export const formatDirectionForPrompt = (d?: Partial<SiteDirectionPreset> | null): string => {
  if (!d) return '';
  const character = (d.character || '').trim();
  const world = (d.world || '').trim();
  const moment = (d.moment || '').trim();
  const signature = (d.signature || '').trim();
  if (!character && !world && !moment && !signature) return '';
  return [
    '【视觉方向 · 必须遵守】',
    character ? `- 性格：${character}（禁止用「现代/简约/高端/高级感」等空词凑数）` : '',
    world ? `- 世界/材质场景：${world}；中性色与主色从此场景取材` : '',
    moment ? `- 视觉高潮：${moment}（颜色与细节砸在这里，其它区域安静）` : '',
    signature && !/不需要/.test(signature) ? `- 签名细节（全站一致用一次即可）：${signature}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const POLISH_INSTRUCTION = `任务：在上一版完整 HTML 基础上做「专业润色」，去掉 AI 模板感，输出完整可运行 HTML（不要只给 diff）。

硬性要求：
1. 保留原有区块顺序与功能：导航、首屏、产品、优势/证书、关于、询盘表单；不要删询盘。
2. 保留所有已有图片/视频/3D 的 src URL（含 data: 与 http），禁止换成占位或抽象装饰。
3. 按顺序落实：间距节奏 → 色板安静化 → 去 emoji/贴纸 → 文案去喊话 → 字体层级 → 布局不居中堆叠堆 → 真产品视觉优先 → 动效克制。
4. ${SITE_ANTI_SLOP_RULES.replace(/\n/g, ' ')}
5. 只输出完整 HTML 文档。`;

/**
 * 对已有整站 HTML 做专业润色（路径 A）。
 */
export const polishSiteHtmlWithLlm = async (opts: {
  html: string;
  brandHint?: string;
  direction?: Partial<SiteDirectionPreset> | null;
  onProgress?: (msg: string) => void;
}): Promise<SiteVibeGenerateResult> => {
  const status = getSiteVibeLlmStatus();
  if (!status.ready) throw new Error(status.detail);
  const prev = (opts.html || '').trim();
  if (prev.length < 400) throw new Error('当前页面过短，无法润色。请先生成网站。');

  opts.onProgress?.('正在专业润色（去模板感）…');
  const directionBlock = formatDirectionForPrompt(opts.direction);
  const result = await generateSiteHtmlWithLlm({
    userPrompt: [POLISH_INSTRUCTION, directionBlock].filter(Boolean).join('\n\n'),
    previousHtml: prev,
    brandHint: opts.brandHint,
    onProgress: opts.onProgress,
  });
  const html = hardenPreviewHtml(extractHtmlDocument(result.html));
  if (html.length < 400) throw new Error('润色结果过短，请重试');
  return {
    ...result,
    html,
    summaryZh: '已完成专业润色（去模板感）',
  };
};
