/**
 * 产品匹配 → 开发策略 / 邮件群发 的跨模块交接。
 * 投放包、开发信组、收件人线索同一份资料互通。
 */
import type { Client, EmailTask, EmailTemplate, MailGroup } from '../types';
import type { GtmClientMatch, GtmLaunchPack } from './gtmExpertStore';
import {
  extractMailGroupsFromPack,
  linkCampaignToPack,
  upsertProductCampaign,
} from './productCampaignStore';
import { saveStrategyMailDraftsFromPack } from './strategyMailDraftStore';

export type GtmOutreachIntent = 'strategy' | 'email_campaign' | 'both';

export type GtmOutreachMatch = {
  clientId?: string;
  companyName: string;
  country: string;
  website?: string;
  score: number;
  reasons: string[];
  mailGroup?: MailGroup;
};

export type GtmOutreachHandoff = {
  packId: string;
  productName: string;
  category?: string;
  skuCode?: string;
  priceBand?: string;
  notes?: string;
  positioning?: string;
  valueProps: string[];
  designMustHaves: string[];
  matches: GtmOutreachMatch[];
  batchMailGroup?: MailGroup;
  intent: GtmOutreachIntent;
  at: number;
};

const LS_KEY = 'trade_scout_gtm_outreach_handoff_v1';
export const GTM_OUTREACH_EVENT = 'tp-gtm-outreach-handoff';

export const buildGtmOutreachHandoff = (
  pack: GtmLaunchPack,
  intent: GtmOutreachIntent
): GtmOutreachHandoff => ({
  packId: pack.id,
  productName: pack.productName,
  category: pack.category,
  skuCode: pack.skuCode,
  priceBand: pack.priceBand,
  notes: pack.notes,
  positioning: pack.pm?.positioning,
  valueProps: pack.pm?.valueProps || [],
  designMustHaves: pack.pm?.designMustHaves || [],
  matches: (pack.matches || []).map((m: GtmClientMatch) => ({
    clientId: m.clientId,
    companyName: m.companyName,
    country: m.country,
    website: m.website,
    score: m.score,
    reasons: m.reasons || [],
    mailGroup: m.mailGroup,
  })),
  batchMailGroup: pack.batchMailGroup,
  intent,
  at: Date.now(),
});

/**
 * 发布交接：写入开发信历史 + 产品档案，供策略/邮件模块读取。
 * campaignId 可选；无则按品名新建/更新档案。
 */
export const publishGtmOutreachHandoff = (
  pack: GtmLaunchPack,
  intent: GtmOutreachIntent = 'both',
  opts?: { campaignId?: string }
): GtmOutreachHandoff => {
  const handoff = buildGtmOutreachHandoff(pack, intent);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(handoff));
  } catch {
    /* quota */
  }

  const campaign =
    opts?.campaignId || pack.campaignId
      ? linkCampaignToPack(opts?.campaignId || pack.campaignId!, pack)
      : upsertProductCampaign({
          productName: pack.productName,
          category: pack.category,
          skuCode: pack.skuCode,
          priceBand: pack.priceBand,
          notes: pack.notes,
          imageUrls: pack.imageUrls || [],
          source: pack.productSource,
          packId: pack.id,
          status: 'matched',
        });

  const mailItems = extractMailGroupsFromPack(pack).map((x) => ({
    ...x,
    productName: pack.productName,
    packId: pack.id,
    campaignId: campaign.id,
  }));
  if (mailItems.length) {
    saveStrategyMailDraftsFromPack(mailItems);
    linkCampaignToPack(campaign.id, pack);
  }

  try {
    window.dispatchEvent(new CustomEvent(GTM_OUTREACH_EVENT, { detail: handoff }));
  } catch {
    /* ignore */
  }
  return handoff;
};

export const peekGtmOutreachHandoff = (): GtmOutreachHandoff | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as GtmOutreachHandoff;
    if (!p?.packId || !p.at) return null;
    return p;
  } catch {
    return null;
  }
};

/** 读取并可选清除；intent 过滤时不匹配则保留 */
export const consumeGtmOutreachHandoff = (
  intent?: GtmOutreachIntent
): GtmOutreachHandoff | null => {
  const cur = peekGtmOutreachHandoff();
  if (!cur) return null;
  if (intent && cur.intent !== 'both' && cur.intent !== intent) return null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  return cur;
};

const mailToTemplateParts = (g: MailGroup, productName: string, companyLabel: string) => {
  const rows = [
    { label: '匹配破冰', subject: g.subject1, body: g.email1 },
    { label: '实力证明', subject: g.subject2, body: g.email2 },
    { label: '钩子收口', subject: g.subject3, body: g.email3 },
  ].filter((x) => (x.body || '').trim() || (x.subject || '').trim());
  return rows.map((r, i) => ({
    name: `${productName} · ${companyLabel} · ${r.label}`.slice(0, 80),
    subject: (r.subject || `${productName} — for {{company_name}}`).slice(0, 200),
    body: (r.body || '').replace(/\n/g, '<br/>'),
    sort: i,
  }));
};

/** 把投放包里的开发信组变成邮件模板草稿 */
export const templatesFromGtmOutreach = (
  handoff: GtmOutreachHandoff,
  owner: { username: string; departmentId?: string }
): EmailTemplate[] => {
  const out: EmailTemplate[] = [];
  const now = Date.now();
  const push = (parts: ReturnType<typeof mailToTemplateParts>) => {
    for (const p of parts) {
      out.push({
        id: `gtm_tpl_${now}_${out.length}_${Math.random().toString(36).slice(2, 6)}`,
        name: p.name,
        subject: p.subject,
        body: p.body,
        lastUpdated: now,
        ownerUsername: owner.username,
        departmentId: owner.departmentId,
      });
    }
  };

  if (handoff.batchMailGroup) {
    push(mailToTemplateParts(handoff.batchMailGroup, handoff.productName, '批量模板'));
  }
  for (const m of handoff.matches.slice(0, 3)) {
    if (!m.mailGroup) continue;
    push(mailToTemplateParts(m.mailGroup, handoff.productName, m.companyName));
  }
  return out;
};

/** 匹配客户 × CRM 联系人邮箱 → 群发待发送任务 */
export const emailTasksFromGtmOutreach = (
  handoff: GtmOutreachHandoff,
  crmClients: Client[],
  owner: { username: string; departmentId?: string },
  existingEmails: Set<string> = new Set()
): EmailTask[] => {
  const byId = new Map(crmClients.map((c) => [c.id, c]));
  const byName = new Map(
    crmClients.map((c) => [(c.name || '').trim().toLowerCase(), c] as const)
  );
  const tasks: EmailTask[] = [];
  const seen = new Set([...existingEmails].map((e) => e.toLowerCase()));

  for (const m of handoff.matches) {
    const client =
      (m.clientId && byId.get(m.clientId)) ||
      byName.get((m.companyName || '').trim().toLowerCase()) ||
      undefined;
    const contacts = client?.contacts || [];
    for (const contact of contacts) {
      const email = (contact.emailGuess || '').trim();
      if (!email || !email.includes('@')) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({
        id: `gtm_task_${Date.now()}_${tasks.length}_${Math.random().toString(36).slice(2, 6)}`,
        recipientEmail: email,
        recipientName:
          contact.name ||
          [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
          email.split('@')[0],
        recipientTitle: contact.title || contact.type || '',
        companyName: client?.name || m.companyName,
        clientId: client?.id || m.clientId,
        status: 'pending',
        ownerUsername: client?.ownerUsername || owner.username,
        departmentId: client?.departmentId || owner.departmentId,
      });
    }
  }
  return tasks;
};

/** 给开发策略助手的上下文短文 */
export const gtmOutreachStrategyBrief = (handoff: GtmOutreachHandoff): string => {
  const countries = Array.from(
    new Set(handoff.matches.map((m) => m.country).filter(Boolean))
  ).slice(0, 8);
  const top = handoff.matches.slice(0, 5);
  return [
    `【产品匹配投放包】${handoff.productName}`,
    handoff.skuCode ? `货号：${handoff.skuCode}` : '',
    handoff.category ? `品类：${handoff.category}` : '',
    handoff.priceBand ? `价格带：${handoff.priceBand}` : '',
    handoff.positioning ? `定位：${handoff.positioning}` : '',
    handoff.valueProps.length ? `卖点：${handoff.valueProps.join('；')}` : '',
    handoff.designMustHaves.length
      ? `设计必须项：${handoff.designMustHaves.join('；')}`
      : '',
    countries.length ? `匹配国家：${countries.join('、')}` : '',
    top.length
      ? `优先客户：\n${top
          .map(
            (m) =>
              `- ${m.companyName}${m.country ? `（${m.country}）` : ''} · 匹配度 ${m.score}${
                m.website ? ` · ${m.website}` : ''
              }`
          )
          .join('\n')}`
      : '',
    '请基于以上产品与客户写/润色开发信组；语气专业、短、可直接群发。',
  ]
    .filter(Boolean)
    .join('\n');
};
