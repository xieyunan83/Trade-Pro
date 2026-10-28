/**
 * 商机证据层 · 类型占位（线上货架 × 线下进口/渠道）。
 * 接通数据商后写入本地/云缓存；生产与销售建议以此为「硬支撑」。
 * 前台文案勿暴露供应商名；本文件供后台与后续匹配引擎使用。
 */

/** 渠道大类：线上平台 vs 线下贸易/渠道 */
export type MarketChannelKind =
  | 'online_marketplace'
  | 'import_trade'
  | 'wholesale'
  | 'retail'
  | 'hybrid';

/** 线上平台（后台配置 / 对内；前台可用「优选电商平台」等中性词） */
export type MarketplacePlatform =
  | 'amazon'
  | 'tiktok'
  | 'walmart'
  | 'shopify'
  | 'other';

/** 证据可信度：A 结构化源 / B 可核验公开页 / C 模型推断 */
export type EvidenceTier = 'A' | 'B' | 'C';

/**
 * 对齐键：把「平台 listing / 海关提单 / CRM 公司」串成一条商机。
 * 接通后优先用强键；弱键仅作候选需人工确认。
 */
export type MarketJoinKeys = {
  companyName?: string;
  domain?: string;
  brandName?: string;
  /** 海关收发货人标准化名 */
  consigneeNorm?: string;
  hsCodes?: string[];
  /** 平台商品 ID（如 ASIN） */
  listingIds?: string[];
  gtins?: string[];
  marketplaceSellerIds?: string[];
  country?: string;
  channelKind?: MarketChannelKind;
};

/** 线上：品类机会卡（对标站内选品工具的「类目趋势」切片，非全站运营后台） */
export type MarketplaceCategorySignal = {
  id: string;
  platform: MarketplacePlatform;
  country: string;
  categoryPath: string;
  keyword?: string;
  /** 价带展示用原文，如 "$8–15" / "¥…" */
  priceBand?: string;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  /** 相对增速 / 热度档，接通 API 后填数值 */
  demandLabel?: string;
  demandScore?: number;
  reviewPainPoints?: string[];
  competitorHints?: string[];
  sampleListingIds?: string[];
  evidenceTier: EvidenceTier;
  sourceNote?: string;
  observedAt?: number;
  createdAt: number;
};

/** 线下：进口行为卡（与 CustomsShipment 对齐，可挂 CRM） */
export type ImportBehaviorSignal = {
  id: string;
  companyName: string;
  domain?: string;
  country?: string;
  hsCodes?: string[];
  productHints?: string[];
  shipmentCount?: number;
  volumeLabel?: string;
  topOrigins?: string[];
  lastShipmentAt?: string;
  evidenceTier: EvidenceTier;
  sourceNote?: string;
  /** 关联海关缓存行 id */
  customsRowIds?: string[];
  createdAt: number;
};

/** 一条可展示的「商机证据包」：机会 + 买家行为 + 对齐状态 */
export type MarketEvidenceBundle = {
  id: string;
  title: string;
  joinKeys: MarketJoinKeys;
  online?: MarketplaceCategorySignal[];
  offlineImport?: ImportBehaviorSignal[];
  /** 是否已与 CRM / 产品画像对齐 */
  linkedCrmClientId?: string;
  linkedProfileId?: string;
  alignmentStatus: 'unlinked' | 'candidate' | 'confirmed';
  /** 给生产 / 销售建议用的摘要（接通后由规则或模型填写） */
  productionHints?: string[];
  salesHints?: string[];
  updatedAt: number;
};

export type MarketEvidenceQuery = {
  keyword?: string;
  country?: string;
  platform?: MarketplacePlatform;
  hsCode?: string;
  companyName?: string;
  domain?: string;
};

export type MarketEvidenceProviderResult = {
  ok: boolean;
  message: string;
  online: MarketplaceCategorySignal[];
  offlineImport: ImportBehaviorSignal[];
};
