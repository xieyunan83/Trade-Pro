/**
 * 产品投放档案：设计选品资料 + 匹配投放包 + 开发信 一体存档，
 * 供产品匹配 / 开发策略 / 邮件群发后续复用。
 */
import type { MailGroup } from '../types';
import type { GtmLaunchPack } from './gtmExpertStore';
import { loadGtmLaunchPacks } from './gtmExpertStore';
import {
  loadStrategyMailDraftHistory,
  type StrategyMailDraft,
} from './strategyMailDraftStore';

export type ProductCampaignSource = 'catalog' | 'upload' | 'design' | 'manual';

export type ProductCampaignRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  productName: string;
  category?: string;
  skuCode?: string;
  priceBand?: string;
  notes?: string;
  source?: ProductCampaignSource;
  /** 产品图（vault:/data:/https） */
  imageUrls: string[];
  /** 关联 GTM 投放包 */
  packId?: string;
  /** 已生成开发信摘要条数 */
  mailDraftCount: number;
  /** 最近一次开发信公司名 */
  lastMailCompany?: string;
  status: 'draft' | 'matched' | 'mailed';
};

const LS_KEY = 'trade_scout_product_campaigns_v1';
export const PRODUCT_CAMPAIGN_EVENT = 'tp-product-campaign';

const newId = () =>
  `pcamp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const loadProductCampaigns = (): ProductCampaignRecord[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as ProductCampaignRecord[]).slice(0, 80) : [];
  } catch {
    return [];
  }
};

export const saveProductCampaigns = (rows: ProductCampaignRecord[]) => {
  localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(0, 80)));
  try {
    window.dispatchEvent(new CustomEvent(PRODUCT_CAMPAIGN_EVENT));
  } catch {
    /* ignore */
  }
};

export const upsertProductCampaign = (
  patch: Partial<ProductCampaignRecord> &
    Pick<ProductCampaignRecord, 'productName'> & { id?: string }
): ProductCampaignRecord => {
  const all = loadProductCampaigns();
  const now = Date.now();
  const existing = patch.id ? all.find((r) => r.id === patch.id) : undefined;
  const row: ProductCampaignRecord = {
    id: existing?.id || patch.id || newId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    productName: patch.productName || existing?.productName || '未命名产品',
    category: patch.category ?? existing?.category,
    skuCode: patch.skuCode ?? existing?.skuCode,
    priceBand: patch.priceBand ?? existing?.priceBand,
    notes: patch.notes ?? existing?.notes,
    source: patch.source ?? existing?.source,
    imageUrls: patch.imageUrls ?? existing?.imageUrls ?? [],
    packId: patch.packId ?? existing?.packId,
    mailDraftCount: patch.mailDraftCount ?? existing?.mailDraftCount ?? 0,
    lastMailCompany: patch.lastMailCompany ?? existing?.lastMailCompany,
    status: patch.status ?? existing?.status ?? 'draft',
  };
  saveProductCampaigns([row, ...all.filter((r) => r.id !== row.id)]);
  return row;
};

export const getProductCampaign = (id: string): ProductCampaignRecord | undefined =>
  loadProductCampaigns().find((r) => r.id === id);

/** 匹配完成后把投放包与选品资料写入档案 */
export const linkCampaignToPack = (
  campaignId: string,
  pack: GtmLaunchPack
): ProductCampaignRecord => {
  const mailN =
    (pack.batchMailGroup ? 1 : 0) +
    pack.matches.filter((m) => m.mailGroup?.email1 || m.mailGroup?.subject1).length;
  const lastCo = pack.matches.find((m) => m.mailGroup)?.companyName;
  return upsertProductCampaign({
    id: campaignId,
    productName: pack.productName,
    category: pack.category,
    skuCode: pack.skuCode,
    priceBand: pack.priceBand,
    notes: pack.notes,
    packId: pack.id,
    mailDraftCount: mailN,
    lastMailCompany: lastCo,
    status: mailN > 0 ? 'mailed' : 'matched',
  });
};

export const findCampaignByPackId = (packId: string): ProductCampaignRecord | undefined =>
  loadProductCampaigns().find((r) => r.packId === packId);

/** 档案详情：投放包 + 相关开发信草稿 */
export const resolveCampaignBundle = (
  campaignId: string
): {
  campaign: ProductCampaignRecord;
  pack: GtmLaunchPack | null;
  mailDrafts: StrategyMailDraft[];
} | null => {
  const campaign = getProductCampaign(campaignId);
  if (!campaign) return null;
  const packs = loadGtmLaunchPacks();
  const pack = campaign.packId
    ? packs.find((p) => p.id === campaign.packId) || null
    : packs.find(
        (p) =>
          p.productName === campaign.productName &&
          (!campaign.skuCode || p.skuCode === campaign.skuCode)
      ) || null;
  const drafts = loadStrategyMailDraftHistory().filter((d) => {
    if (!pack) return d.companyName && campaign.productName;
    return (
      pack.matches.some((m) => m.companyName === d.companyName) ||
      d.companyName === pack.productName ||
      d.companyName.includes(campaign.productName)
    );
  });
  return { campaign, pack, mailDrafts: drafts };
};

export const extractMailGroupsFromPack = (
  pack: GtmLaunchPack
): Array<{ companyName: string; website?: string; mailGroup: MailGroup }> => {
  const out: Array<{ companyName: string; website?: string; mailGroup: MailGroup }> = [];
  if (pack.batchMailGroup?.email1 || pack.batchMailGroup?.subject1) {
    out.push({
      companyName: `${pack.productName} · 批量模板`,
      mailGroup: pack.batchMailGroup,
    });
  }
  for (const m of pack.matches) {
    if (m.mailGroup?.email1 || m.mailGroup?.subject1) {
      out.push({
        companyName: m.companyName,
        website: m.website,
        mailGroup: m.mailGroup,
      });
    }
  }
  return out;
};
