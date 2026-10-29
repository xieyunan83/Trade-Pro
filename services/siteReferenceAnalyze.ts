/**
 * 从提示词提取参考网址，做轻量风格推断（不爬整站源码；避免跨域失败时仍可建站）。
 */
import type { SiteTemplateId } from './siteBuilderTemplates';

export type ReferenceAnalysis = {
  url: string | null;
  host: string | null;
  intentCopy: boolean;
  suggestedTemplate: SiteTemplateId;
  styleNotes: string[];
  briefAugment: string;
};

const URL_RE = /https?:\/\/[^\s<>"'）】\]]+/gi;

export const extractUrls = (text: string): string[] => {
  const m = text.match(URL_RE) || [];
  return [...new Set(m.map((u) => u.replace(/[.,;!?]+$/, '')))];
};

export const analyzeReferenceFromPrompt = (prompt: string): ReferenceAnalysis => {
  const urls = extractUrls(prompt);
  const url = urls[0] || null;
  let host: string | null = null;
  try {
    if (url) host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    host = null;
  }

  const lower = prompt.toLowerCase();
  const intentCopy = /copy|克隆|仿|参考|照着|同款|一模一样|借鉴/i.test(prompt);

  let suggestedTemplate: SiteTemplateId = 'trade_hero';
  const styleNotes: string[] = [];

  if (/shopify|woocommerce|catalog|product|sku|目录|货源|选品/i.test(lower + (host || ''))) {
    suggestedTemplate = 'catalog_grid';
    styleNotes.push('参考站偏产品目录，建议卡片网格突出 SKU');
  } else if (/form|inquiry|contact|询盘|表单|展会/i.test(lower)) {
    suggestedTemplate = 'inquiry_first';
    styleNotes.push('参考站偏转化，建议表单与信任背书前置');
  } else if (/about|story|brand|品牌|故事|oem/i.test(lower)) {
    suggestedTemplate = 'brand_story';
    styleNotes.push('参考站偏叙事品牌，建议长首屏与故事段落');
  } else if (/minimal|clean|landing|极简/i.test(lower)) {
    suggestedTemplate = 'minimal_clean';
    styleNotes.push('参考站偏极简落地，建议留白与单 CTA');
  } else if (host) {
    styleNotes.push(`将参考 ${host} 的信息架构与主色气质，按外贸展厅骨架重组（非逐像素盗站）`);
  }

  if (intentCopy && host) {
    styleNotes.push('已识别「参考/仿作」意图：保留版式节奏与模块组合，文案与品牌换成你的货盘');
  }

  if (/ce|astm|证书|认证/i.test(prompt)) {
    styleNotes.push('强调 CE / ASTM 等合规卖点条');
  }

  const briefAugment = [
    url ? `参考网址：${url}` : '',
    ...styleNotes,
    intentCopy ? '按参考站模块节奏生成，但使用用户自有品牌与产品。' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    url,
    host,
    intentCopy,
    suggestedTemplate,
    styleNotes,
    briefAugment,
  };
};

/** 对话改版：根据自然语言微调 sections 文案 / 语种意图 */
export const applyChatEditsToBrief = (
  prevBrief: string,
  userText: string,
  refNotes?: string
): string => {
  const parts = [prevBrief, userText.trim()];
  if (refNotes && !prevBrief.includes(refNotes.slice(0, 40))) {
    parts.push(refNotes);
  }
  return parts.filter(Boolean).join('\n').slice(-1200);
};
