/**
 * 毅冰式 Mail Group 方法论（方法论蒸馏，非米课原文照搬）
 * 目标：提高回复率 + 压缩提示词 Token
 */
import type { AnalysisResult, MailGroup } from '../types';

/** 极短规则：嵌入 system / user prompt，避免长文烧 Token */
export const YIBING_MAIL_GROUP_RULES = `Mail Group（毅冰思路蒸馏）:
- 目的=敲门曝光，不是一次成交；多封短信、多角度证明专业。
- 先调研客户在卖什么/市场痛点，再匹配我方产品；禁止空泛自我介绍。
- 每封只讲一个点；口语化英文；无废话（勿写美丽城市/悠久历史）。
- 主题具体、多变、非推销腔；勿全大写/虚假夸张。
- 同日连发一组；末封必须有「钩子」引导回复（样品/报价单/视频链接/方案等）。
- 禁止：长篇、堆认证清单、催促式 follow-up、编造未提供的价格/客户名。`;

export const YIBING_MAIL_GROUP_ANGLES = [
  {
    key: 'fit',
    label: '匹配破冰',
    focus: '来源/身份 + 对方在售品类 + 1款匹配产品 + 粗价带/利润空间暗示',
  },
  {
    key: 'proof',
    label: '实力证明',
    focus: '工厂/产能/交期/验厂或大客户市场占比（仅用已知事实）',
  },
  {
    key: 'hook',
    label: '钩子收口',
    focus: '亮点图/包装或更多SKU暗示 + 明确钩子邀请回复',
  },
] as const;

/** 从背调结果抽极简事实卡，避免把整份报告塞进 prompt */
export const buildCompactClientBrief = (client: AnalysisResult): string => {
  const info = client.companyInfo || ({} as AnalysisResult['companyInfo']);
  const products = (client.businessScope?.coreProducts || []).slice(0, 5).join(', ') || '—';
  const weaknesses = (client.swot?.weaknesses || []).slice(0, 3).join('; ') || '—';
  const dms = (client.decisionMakers || [])
    .slice(0, 3)
    .map((d) => [d.name, d.title].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join(' | ');
  const lines = [
    `Buyer: ${info.name || 'Unknown'}`,
    `Site: ${info.website || '—'}`,
    `HQ/City: ${info.headquarters || '—'} / ${info.city || '—'}`,
    `Type/Scale: ${info.nature || '—'} / ${info.scale || '—'}`,
    `MarketKW: ${client.searchKeyword || '—'}`,
    `Country: ${client.searchCountry || '—'}`,
    `Sells: ${products}`,
    `Pain: ${weaknesses}`,
    dms ? `Buyers: ${dms}` : '',
  ].filter(Boolean);
  return lines.join('\n');
};

export const buildCompactOurOfferBrief = (kbSnippet: string, productContext?: string): string => {
  const parts: string[] = [];
  if (productContext?.trim()) parts.push(`Offer note: ${productContext.trim().slice(0, 280)}`);
  if (kbSnippet?.trim()) parts.push(`KB:\n${kbSnippet.trim().slice(0, 1800)}`);
  return parts.join('\n') || 'Offer: (use only generic factory advantages; do NOT invent prices/certs)';
};

/** 单客户 Mail Group 生成 prompt（短） */
export const buildYibingMailGroupPrompt = (opts: {
  clientBrief: string;
  offerBrief: string;
  mode?: 'single' | 'batch';
  batchContext?: string;
}): string => {
  const mode = opts.mode || 'single';
  const angles = YIBING_MAIL_GROUP_ANGLES.map(
    (a, i) => `${i + 1}) ${a.label}: ${a.focus}`
  ).join('\n');

  return `Task: Write a 3-email Mail Group (${mode === 'batch' ? 'batch template' : 'for one buyer'}).
Each email body: English, 70-110 words, 3 short paragraphs max. Sign as "Best regards," + [Your Name].

Angles:
${angles}

${mode === 'batch' ? `Campaign: ${(opts.batchContext || '').slice(0, 200)}\n` : ''}Buyer card:
${opts.clientBrief}

Our side:
${opts.offerBrief}

Also invent 3 distinct English subject lines (specific, not "Inquiry from China").
analysis: 2 Chinese sentences — angle rationale + send tip (same-day group; last mail needs hook).

JSON only:
{"analysis":"...","subject1":"...","subject2":"...","subject3":"...","email1":"...","email2":"...","email3":"...","sendTip":"..."}`;
};

/** 策略对话：用户要写开发信时注入的短指引 */
export const YIBING_STRATEGY_CHAT_HINT = `写开发信/Mail Group时：用毅冰思路——短、具体、多角度、末封带钩子；主题多变；英文口语；不要长篇自我介绍。优先输出可直接复制的 Subject + Body。`;

export const normalizeMailGroupResult = (res: Record<string, any>): MailGroup => ({
  analysis: String(res.analysis || 'Mail Group 已生成').trim(),
  email1: String(res.email1 || '').trim() || 'Draft 1',
  email2: String(res.email2 || '').trim() || 'Draft 2',
  email3: String(res.email3 || '').trim() || 'Draft 3',
  subject1: res.subject1 ? String(res.subject1).trim() : undefined,
  subject2: res.subject2 ? String(res.subject2).trim() : undefined,
  subject3: res.subject3 ? String(res.subject3).trim() : undefined,
  sendTip: res.sendTip ? String(res.sendTip).trim() : undefined,
});

export const isColdEmailIntent = (text: string): boolean =>
  /开发信|mail\s*group|cold\s*email|outreach|破冰信|询盘信/i.test(text || '');
