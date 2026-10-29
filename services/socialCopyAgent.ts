/**
 * 发文素材：调用对话模型写 caption / 话题 / CTA；可选生图做渠道封面。
 */
import { callQwen } from './geminiService';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';
import { loadDataProviderLocal } from './dataProviders';
import type { SocialPlatform } from './creativeStudioStore';
import { SOCIAL_PLATFORM_META } from './creativeStudioStore';
import { generateDesignImages, getDesignAgentConfigStatus } from './designAgentService';
import { tryPersistMediaUrl } from './creativeAssetVault';

export type SocialCopyLlmInput = {
  platform: SocialPlatform;
  productName: string;
  highlight?: string;
  locale: 'zh' | 'en';
  skuCode?: string;
  hasProductImage?: boolean;
  hasReferenceImage?: boolean;
  onProgress?: (msg: string) => void;
};

export type SocialCopyLlmResult = {
  caption: string;
  hashtags: string[];
  cta: string;
  titleLine: string;
  engine: 'llm';
};

export const getSocialLlmStatus = (): { ready: boolean; detail: string } => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) {
    return { ready: true, detail: '文案服务已就绪' };
  }
  if (listPoolKeys('qwen').length > 0 || (env.qwenApiKey || '').trim()) {
    return { ready: true, detail: '文案服务已就绪' };
  }
  return {
    ready: false,
    detail: '文案服务未就绪，请联系管理员开通后再生成素材。',
  };
};

const SYSTEM = `你是澄海玩具出口场景的社媒文案编辑，服务外贸业务员发帖。
只输出严格 JSON（不要 markdown）：
{
  "titleLine": "素材短标题，含品名，不超过 36 字",
  "caption": "正文，贴合渠道调性，禁止水印乱码，禁止出现任何大模型/云厂商商品名",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4"],
  "cta": "一句行动号召"
}
要求：突出 OEM/ODM、MOQ、进口商可信度；英文帖用自然英文；中文帖用简洁中文；话题 3～6 个。`;

const platformBrief = (platform: SocialPlatform, locale: 'zh' | 'en'): string => {
  const meta = SOCIAL_PLATFORM_META.find((p) => p.id === platform);
  const size = meta?.size || '';
  const map: Record<SocialPlatform, string> = {
    linkedin:
      locale === 'en'
        ? 'LinkedIn B2B post: professional, 80-160 words, soft sell, trust signals.'
        : 'LinkedIn 风格 B2B：专业、80～160 字、软性卖点与信任。',
    instagram:
      locale === 'en'
        ? 'Instagram caption: punchy, emoji sparingly, line breaks, under 100 words.'
        : 'Instagram：短句换行、适度 emoji、百字内。',
    facebook:
      locale === 'en'
        ? 'Facebook link-post style: clear offer, friendly tone.'
        : 'Facebook：清楚卖点，语气亲和。',
    tiktok:
      locale === 'en'
        ? 'Short-video COVER / hook text for vertical 9:16: one strong hook + 1-2 benefit lines, under 40 words.'
        : '短视频竖版封面钩子：一句钩子 + 1～2 卖点，40 字内。',
    whatsapp:
      locale === 'en'
        ? 'WhatsApp sales opener: 2-4 short lines, ask permission to send MOQ/price.'
        : 'WhatsApp 开场：2～4 短句，征求发 MOQ/报价。',
    x:
      locale === 'en'
        ? 'X/Twitter: under 220 chars, sharp, 2-3 hashtags max in array.'
        : 'X：极短，锐利，话题少而准。',
  };
  return `${map[platform]} Canvas ${size}.`;
};

export const generateSocialCopyWithLlm = async (
  input: SocialCopyLlmInput
): Promise<SocialCopyLlmResult> => {
  const status = getSocialLlmStatus();
  if (!status.ready) throw new Error(status.detail);

  input.onProgress?.('正在调用文案模型…');
  const user = [
    `渠道：${input.platform}`,
    platformBrief(input.platform, input.locale),
    `语种：${input.locale === 'zh' ? '中文' : 'English'}`,
    `品名：${input.productName}`,
    input.skuCode ? `SKU：${input.skuCode}` : '',
    input.highlight ? `卖点：${input.highlight}` : '',
    input.hasProductImage ? '已附产品图' : '无产品图',
    input.hasReferenceImage ? '已附参考形态图' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callQwen(`${SYSTEM}\n\n---\n${user}`, {
    jsonMode: true,
    task: 'analysis',
    timeoutMs: 90_000,
    maxTokens: 2048,
    enableSearch: false,
    forcedSearch: false,
  });

  let parsed: {
    titleLine?: string;
    caption?: string;
    hashtags?: string[];
    cta?: string;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }

  const caption = (parsed.caption || '').trim();
  if (!caption || caption.length < 8) {
    throw new Error('文案模型未返回有效正文，请重试');
  }
  const hashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
    .map((h) => String(h).trim())
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .slice(0, 8);
  if (!hashtags.length) {
    hashtags.push(input.locale === 'zh' ? '#OEM' : '#OEM', '#B2B');
  }

  return {
    caption,
    hashtags,
    cta: (parsed.cta || '').trim() || (input.locale === 'zh' ? '私信获取报价单' : 'DM for catalog & quote'),
    titleLine:
      (parsed.titleLine || '').trim() ||
      `${SOCIAL_PLATFORM_META.find((p) => p.id === input.platform)?.label || 'Post'} · ${input.productName.slice(0, 24)}`,
    engine: 'llm',
  };
};

/** 按渠道画幅生成一张封面主图（有生图服务时）；失败返回 undefined 不阻断文案 */
export const generateSocialCoverImage = async (opts: {
  platform: SocialPlatform;
  productName: string;
  highlight?: string;
  locale: 'zh' | 'en';
  referenceImages?: string[];
  onProgress?: (msg: string) => void;
}): Promise<string | undefined> => {
  const st = getDesignAgentConfigStatus();
  if (!st.configured) return undefined;

  const meta = SOCIAL_PLATFORM_META.find((p) => p.id === opts.platform);
  const vertical = opts.platform === 'tiktok';
  const square = opts.platform === 'instagram' || opts.platform === 'whatsapp';

  opts.onProgress?.('正在生成渠道配图…');
  const prompt = [
    vertical
      ? 'Vertical 9:16 short-video cover poster for toy export marketing'
      : square
        ? 'Square 1:1 social product post visual'
        : 'Landscape social share image for B2B toy wholesale',
    `Product: ${opts.productName}`,
    opts.highlight ? `Highlight: ${opts.highlight}` : '',
    'Commercial toy product photography style, clean background, bold but sparse cover typography area left empty (no readable garbled text), no watermark, no logos of AI vendors',
    opts.locale === 'zh' ? '适合中国玩具外贸社媒' : 'for global toy importers feed',
    meta ? `Target canvas ${meta.size}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  try {
    const result = await generateDesignImages({
      prompt,
      size: '1K',
      n: 1,
      thinkingMode: false,
      referenceImages: opts.referenceImages?.slice(0, 2),
    });
    const url = result.images[0];
    if (!url) return undefined;
    return await tryPersistMediaUrl(url, 'image');
  } catch (e) {
    console.warn('[socialCopyAgent] cover image failed', e);
    return undefined;
  }
};
