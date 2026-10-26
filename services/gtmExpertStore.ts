/**
 * 市调专家 + 产品经理 · 投放包本地存档（不碰 CRM 主数据）
 */
import type { MailGroup } from '../types';

export type GtmCountryRec = {
  name: string;
  priority: number;
  reasons: string[];
  channels: string[];
};

export type GtmMarketBrief = {
  productName: string;
  categories: string[];
  countries: GtmCountryRec[];
  trends: string[];
  risks: string[];
  /** 给设计 Agent 的市场约束（中文，无供应商名） */
  designImplications: string[];
};

export type GtmPmBrief = {
  positioning: string;
  buyerPersonas: string[];
  valueProps: string[];
  designMustHaves: string[];
  listingAngles: string[];
  competitiveDifferentiation: string[];
};

export type GtmClientMatch = {
  clientId?: string;
  companyName: string;
  country: string;
  website?: string;
  score: number;
  reasons: string[];
  source: 'crm' | 'product_profile' | 'both';
  historyId?: string;
  productType?: string;
  mailGroup?: MailGroup;
};

export type GtmLaunchPack = {
  id: string;
  createdAt: number;
  productName: string;
  category?: string;
  priceBand?: string;
  skuCode?: string;
  notes?: string;
  market: GtmMarketBrief;
  pm: GtmPmBrief;
  matches: GtmClientMatch[];
  /** 可复用的批量开发信模板 */
  batchMailGroup?: MailGroup;
};

const LS_PACKS = 'trade_scout_gtm_launch_packs_v1';

export const newGtmId = (prefix = 'gtm') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const loadGtmLaunchPacks = (): GtmLaunchPack[] => {
  try {
    const raw = localStorage.getItem(LS_PACKS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 30) : [];
  } catch {
    return [];
  }
};

export const saveGtmLaunchPacks = (packs: GtmLaunchPack[]) => {
  localStorage.setItem(LS_PACKS, JSON.stringify(packs.slice(0, 30)));
};

export const upsertGtmLaunchPack = (pack: GtmLaunchPack) => {
  const prev = loadGtmLaunchPacks().filter((p) => p.id !== pack.id);
  saveGtmLaunchPacks([pack, ...prev]);
  return pack;
};
