/**
 * 产品匹配客户 · 开发通道分级（重点一对一 vs EDM 测品）
 */
import type { Client, CustomerProductProfile } from '../types';
import type { GtmClientMatch, GtmOutreachChannel } from './gtmExpertStore';

export type OutreachChannel = GtmOutreachChannel;

const SCALE_HINT =
  /连锁|商超|超市|retail chain|walmart|target|costco|amazon|批发|分销|importer|distributor|集团|集团采购|年采|万件|container|柜|知名|品牌|brand|连锁卖场|采购额|million|billion|规模大|大型/i;

/** 按匹配分 + 体量/采购信号分级 */
export const gradeOutreachChannel = (opts: {
  score: number;
  reasons: string[];
  companyName: string;
  country?: string;
  volumeSignal?: string;
  estimatedScale?: string;
  revenueEstimate?: string;
  catalogQuality?: number;
  priceRange?: string;
  tags?: string[];
}): { channel: OutreachChannel; gradeReasons: string[]; outreachAdvice: string } => {
  const gradeReasons: string[] = [];
  const blob = [
    opts.volumeSignal,
    opts.estimatedScale,
    opts.revenueEstimate,
    opts.priceRange,
    ...(opts.tags || []),
    ...opts.reasons,
  ]
    .filter(Boolean)
    .join(' ');

  const scaleHit = SCALE_HINT.test(blob);
  const quality = opts.catalogQuality ?? 0;
  let priorityScore = opts.score;
  if (scaleHit) {
    priorityScore += 12;
    gradeReasons.push('公开信息含体量/渠道/知名度信号');
  }
  if (quality >= 55) {
    priorityScore += 6;
    gradeReasons.push(`背调产品画像较完整（质量 ${quality}）`);
  }
  if (opts.volumeSignal?.trim()) {
    gradeReasons.push(`采购/进口量线索：${opts.volumeSignal.trim().slice(0, 48)}`);
  }
  if (opts.score >= 70) gradeReasons.push(`类目匹配度高（${opts.score} 分）`);
  else if (opts.score >= 55) gradeReasons.push(`类目匹配较好（${opts.score} 分）`);

  const isPriority = priorityScore >= 72 || (opts.score >= 62 && scaleHit);
  if (isPriority) {
    if (!gradeReasons.length) gradeReasons.push('高匹配优先精准跟进');
    return {
      channel: 'priority_1to1',
      gradeReasons,
      outreachAdvice: '建议一对一精准开发：结合背调报告定制开发信与样品方案，优先人工跟进。',
    };
  }
  return {
    channel: 'edm_test',
    gradeReasons: gradeReasons.length
      ? gradeReasons
      : [`匹配度 ${opts.score} 分，适合先批量触达`],
    outreachAdvice: '可先简化资料做 EDM 邮件测品：用统一卖点模板群发，按回复再升维一对一。',
  };
};

/** 给 GTM 匹配结果挂上分级字段 */
export const attachOutreachGrades = (
  matches: GtmClientMatch[],
  enrich?: {
    profiles?: CustomerProductProfile[];
    crmClients?: Client[];
  }
): Array<GtmClientMatch & { channel: OutreachChannel; gradeReasons: string[]; outreachAdvice: string }> =>
  matches.map((m) => {
    const profileHit = enrich?.profiles?.find(
      (p) =>
        (m.historyId && p.historyId === m.historyId) ||
        (m.clientId && p.crmClientId === m.clientId) ||
        (p.website && m.website && p.website.toLowerCase() === m.website.toLowerCase())
    );
    const crm = enrich?.crmClients?.find((c) => c.id === m.clientId);
    const graded = gradeOutreachChannel({
      score: m.score,
      reasons: m.reasons,
      companyName: m.companyName,
      country: m.country,
      volumeSignal: profileHit?.volumeSignal,
      estimatedScale: crm?.priceRange,
      catalogQuality: profileHit?.catalogQuality,
      priceRange: crm?.priceRange,
      tags: crm?.tags,
    });
    return {
      ...m,
      channel: graded.channel,
      gradeReasons: graded.gradeReasons,
      outreachAdvice: graded.outreachAdvice,
    };
  });
