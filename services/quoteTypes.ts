/**
 * 外贸报价单 · 类型、本地存储与计算（对齐工厂 FOB 报价习惯）
 */
import type { CatalogSku } from './productCatalogTypes';

export type QuoteLine = {
  id: string;
  skuId: string;
  skuCode: string;
  /** 英文品名（对外） */
  nameEn: string;
  /** 中文品名（内部） */
  nameZh?: string;
  /** 包装方式 */
  packing?: string;
  /** 外箱装量 PCS */
  cartonQty: number;
  /** 内盒数 */
  innerBox: number;
  /** 对外单价（结算币种） */
  unitPrice: number;
  /** 出厂价底价（可选，用于加点回溯） */
  factoryPrice?: number;
  currency: string;
  /** 样品/产品尺寸 cm */
  pkgL?: number;
  pkgW?: number;
  pkgH?: number;
  /** 外箱尺寸 cm */
  ctnL?: number;
  ctnW?: number;
  ctnH?: number;
  /** 立方英尺 / 立方米（可手改；默认可由外箱推算） */
  cft?: number;
  cbm?: number;
  gwKg?: number;
  nwKg?: number;
  certificates?: string;
  imageDataUrl?: string;
  remark?: string;
  /** 行数量（柜量估算用；导出样表按「货号清单」时常为 1 行一货号） */
  qty: number;
};

export type QuoteDoc = {
  id: string;
  quoteNo: string;
  title: string;
  clientName?: string;
  crmClientId?: string;
  attn?: string;
  quoteDate: string; // YYYY-MM-DD
  validUntil?: string;
  validDays: number;
  currency: string;
  exchangeRate: number;
  /** 佣金/加点 %（行价 = 出厂价 × (1+commission/100)，可被行单价覆盖） */
  commissionPercent: number;
  priceType: 'factory' | 'fob' | 'manual';
  tradeTerm: string;
  portOfLoading: string;
  containerType: string;
  paymentTerms: string;
  externalRemarks: string;
  internalRemarks: string;
  /** 表头价条款说明（英文） */
  priceBasisText: string;
  lines: QuoteLine[];
  status: 'draft' | 'sent' | 'accepted' | 'expired';
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

/** 按登录用户区分的卖方抬头 */
export type QuoteCompanyProfile = {
  username: string;
  companyName: string;
  companyNameZh?: string;
  address: string;
  tel: string;
  fax?: string;
  email: string;
  website?: string;
  defaultPort: string;
  defaultTradeTerm: string;
  defaultCurrency: string;
  defaultCommissionPercent: number;
  defaultPaymentTerms: string;
  defaultPriceBasisText: string;
  logoDataUrl?: string;
  updatedAt: number;
};

const QUOTES_LS = 'trade_scout_quotes_v1';
const PROFILES_LS = 'trade_scout_quote_company_profiles_v1';

export const loadQuotes = (): QuoteDoc[] => {
  try {
    const raw = localStorage.getItem(QUOTES_LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateQuoteDoc);
  } catch {
    return [];
  }
};

export const saveQuotes = (rows: QuoteDoc[]) => {
  localStorage.setItem(QUOTES_LS, JSON.stringify(rows));
};

export const loadCompanyProfiles = (): Record<string, QuoteCompanyProfile> => {
  try {
    const raw = localStorage.getItem(PROFILES_LS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const saveCompanyProfile = (profile: QuoteCompanyProfile) => {
  const all = loadCompanyProfiles();
  all[profile.username] = profile;
  localStorage.setItem(PROFILES_LS, JSON.stringify(all));
};

export const defaultCompanyProfile = (username: string): QuoteCompanyProfile => ({
  username,
  companyName: '',
  companyNameZh: '',
  address: '',
  tel: '',
  email: '',
  website: '',
  defaultPort: 'SHANTOU',
  defaultTradeTerm: 'FOB',
  defaultCurrency: 'USD',
  defaultCommissionPercent: 0,
  defaultPaymentTerms: 'FCL: 30% DEPOSIT AND BALANCE UPON B/L COPY',
  defaultPriceBasisText:
    'The price is base on FOB Shantou full container loading,accepted by both parties.',
  updatedAt: Date.now(),
});

export const getCompanyProfileForUser = (username: string): QuoteCompanyProfile => {
  const all = loadCompanyProfiles();
  return all[username] || defaultCompanyProfile(username);
};

const ymd = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const addDaysYmd = (base: string, days: number): string => {
  const d = new Date(`${base}T00:00:00`);
  if (Number.isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + days);
  return ymd(d);
};

export const newQuoteId = () => `qt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
export const newLineId = () => `ql_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const nextQuoteNo = (existing: QuoteDoc[]): string => {
  const year = String(new Date().getFullYear()).slice(2);
  const prefix = `QTN${year}`;
  let max = 0;
  for (const q of existing) {
    const m = String(q.quoteNo || '').match(/QTN\d{2}(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
};

/** 解析「33x22.3x31」「33×22.3×31」「33*22.3*31」 */
export const parseDimsCm = (
  raw?: string
): { l?: number; w?: number; h?: number } => {
  if (!raw) return {};
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)/);
  if (!m) return {};
  return { l: Number(m[1]), w: Number(m[2]), h: Number(m[3]) };
};

/** 解析「11.8/11.4」或「毛11.8 净11.4」 */
export const parseGwNw = (raw?: string): { gw?: number; nw?: number } => {
  if (!raw) return {};
  const slash = String(raw).match(/(\d+(?:\.\d+)?)\s*[\/／]\s*(\d+(?:\.\d+)?)/);
  if (slash) return { gw: Number(slash[1]), nw: Number(slash[2]) };
  const nums = [...String(raw).matchAll(/(\d+(?:\.\d+)?)/g)].map((x) => Number(x[1]));
  if (nums.length >= 2) return { gw: nums[0], nw: nums[1] };
  if (nums.length === 1) return { gw: nums[0] };
  return {};
};

export const parseFirstNumber = (raw?: string): number => {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
};

/** CBM = L*W*H / 1e6；CFT ≈ CBM * 35.315 */
export const calcCbmCft = (
  l?: number,
  w?: number,
  h?: number
): { cbm: number; cft: number } => {
  if (!(l && w && h) || l <= 0 || w <= 0 || h <= 0) return { cbm: 0, cft: 0 };
  const cbm = (l * w * h) / 1_000_000;
  return { cbm: Math.round(cbm * 1000) / 1000, cft: Math.round(cbm * 35.315 * 100) / 100 };
};

export const applyLineLogistics = (line: QuoteLine): QuoteLine => {
  const { cbm, cft } = calcCbmCft(line.ctnL, line.ctnW, line.ctnH);
  return {
    ...line,
    cbm: line.cbm != null && line.cbm > 0 ? line.cbm : cbm,
    cft: line.cft != null && line.cft > 0 ? line.cft : cft,
  };
};

export const quoteLineFromSku = (
  sku: CatalogSku,
  opts: { currency: string; commissionPercent: number }
): QuoteLine => {
  const dims = parseDimsCm(sku.cartonSpec);
  const pkg = parseDimsCm(sku.specs);
  const wn = parseGwNw(sku.grossNetKg);
  const factory = sku.factoryPrice != null ? Number(sku.factoryPrice) : 0;
  const commission = opts.commissionPercent || 0;
  const unit =
    factory > 0 ? Math.round(factory * (1 + commission / 100) * 1000) / 1000 : 0;
  const logistics = applyLineLogistics({
    id: newLineId(),
    skuId: sku.id,
    skuCode: sku.skuCode,
    nameEn: (sku.nameEn || sku.name || '').trim(),
    nameZh: sku.name,
    packing: sku.packing || '',
    cartonQty: parseFirstNumber(sku.cartonQty) || sku.moq || 0,
    innerBox: parseFirstNumber(sku.innerBox),
    unitPrice: unit,
    factoryPrice: factory || undefined,
    currency: sku.currency || opts.currency,
    pkgL: pkg.l,
    pkgW: pkg.w,
    pkgH: pkg.h,
    ctnL: dims.l,
    ctnW: dims.w,
    ctnH: dims.h,
    gwKg: wn.gw,
    nwKg: wn.nw,
    certificates: (sku.certificates || []).join(', '),
    imageDataUrl: sku.images?.[0],
    qty: 1,
  });
  return logistics;
};

export const sumQuoteVolumeCbm = (lines: QuoteLine[]): number =>
  Math.round(lines.reduce((s, l) => s + (Number(l.cbm) || 0) * Math.max(1, l.qty || 1), 0) * 1000) /
  1000;

export const sumQuoteAmount = (lines: QuoteLine[]): number =>
  Math.round(lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * Math.max(1, l.qty || 1), 0) * 1000) /
  1000;

/** 20GP≈28 / 40GP≈56 / 40HQ≈68 CBM 常用估算 */
export const CONTAINER_CBM: Record<string, number> = {
  '20GP': 28,
  '40GP': 56,
  '40HQ': 68,
  LCL: 0,
};

export const containerFillRatio = (cbm: number, containerType: string): number | null => {
  const cap = CONTAINER_CBM[containerType];
  if (!cap) return null;
  return Math.round((cbm / cap) * 1000) / 10;
};

export const createBlankQuote = (
  existing: QuoteDoc[],
  profile: QuoteCompanyProfile,
  owner: { username: string; departmentId?: string }
): QuoteDoc => {
  const quoteDate = ymd();
  const validDays = 30;
  return {
    id: newQuoteId(),
    quoteNo: nextQuoteNo(existing),
    title: '外贸报价单',
    clientName: '',
    attn: '',
    quoteDate,
    validUntil: addDaysYmd(quoteDate, validDays),
    validDays,
    currency: profile.defaultCurrency || 'USD',
    exchangeRate: 1,
    commissionPercent: profile.defaultCommissionPercent || 0,
    priceType: 'fob',
    tradeTerm: profile.defaultTradeTerm || 'FOB',
    portOfLoading: profile.defaultPort || 'SHANTOU',
    containerType: '20GP',
    paymentTerms: profile.defaultPaymentTerms || '',
    externalRemarks: '',
    internalRemarks: '',
    priceBasisText:
      profile.defaultPriceBasisText ||
      `The price is base on ${(profile.defaultTradeTerm || 'FOB').toUpperCase()} ${(
        profile.defaultPort || 'Shantou'
      ).replace(/^./, (c) => c.toUpperCase())} full container loading,accepted by both parties.`,
    lines: [],
    status: 'draft',
    ownerUsername: owner.username,
    departmentId: owner.departmentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

/** 兼容旧版极简 QuoteDoc */
function migrateQuoteDoc(raw: any): QuoteDoc {
  if (raw && raw.quoteNo && Array.isArray(raw.lines)) {
    return {
      ...createBlankQuote([], defaultCompanyProfile(raw.ownerUsername || 'unknown'), {
        username: raw.ownerUsername || 'unknown',
        departmentId: raw.departmentId,
      }),
      ...raw,
      lines: (raw.lines as any[]).map((l) =>
        applyLineLogistics({
          id: l.id || newLineId(),
          skuId: l.skuId || '',
          skuCode: l.skuCode || '',
          nameEn: l.nameEn || l.name || '',
          nameZh: l.nameZh || l.name,
          packing: l.packing || '',
          cartonQty: Number(l.cartonQty) || 0,
          innerBox: Number(l.innerBox) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          factoryPrice: l.factoryPrice,
          currency: l.currency || raw.currency || 'USD',
          pkgL: l.pkgL,
          pkgW: l.pkgW,
          pkgH: l.pkgH,
          ctnL: l.ctnL,
          ctnW: l.ctnW,
          ctnH: l.ctnH,
          cft: l.cft,
          cbm: l.cbm,
          gwKg: l.gwKg,
          nwKg: l.nwKg,
          certificates: l.certificates,
          imageDataUrl: l.imageDataUrl,
          remark: l.remark,
          qty: Number(l.qty) || 1,
        })
      ),
    };
  }
  // 旧字段：markupPercent + 简行
  const quoteDate = ymd(raw?.createdAt ? new Date(raw.createdAt) : new Date());
  const commission = Number(raw?.markupPercent) || 0;
  return {
    id: raw?.id || newQuoteId(),
    quoteNo: raw?.quoteNo || `QTN${String(Date.now()).slice(-7)}`,
    title: raw?.title || '选品报价单',
    clientName: raw?.clientName,
    crmClientId: raw?.crmClientId,
    attn: '',
    quoteDate,
    validUntil: addDaysYmd(quoteDate, 30),
    validDays: 30,
    currency: raw?.currency || 'USD',
    exchangeRate: 1,
    commissionPercent: commission,
    priceType: 'fob',
    tradeTerm: 'FOB',
    portOfLoading: 'SHANTOU',
    containerType: '20GP',
    paymentTerms: '',
    externalRemarks: '',
    internalRemarks: '',
    priceBasisText: 'The price is base on FOB Shantou full container loading,accepted by both parties.',
    lines: Array.isArray(raw?.lines)
      ? raw.lines.map((l: any) =>
          applyLineLogistics({
            id: newLineId(),
            skuId: l.skuId || '',
            skuCode: l.skuCode || '',
            nameEn: l.name || '',
            nameZh: l.name,
            packing: '',
            cartonQty: 0,
            innerBox: 0,
            unitPrice: Number(l.unitPrice) || 0,
            currency: l.currency || raw?.currency || 'USD',
            remark: l.remark,
            qty: Number(l.qty) || 1,
          })
        )
      : [],
    status: raw?.status || 'draft',
    ownerUsername: raw?.ownerUsername,
    departmentId: raw?.departmentId,
    createdAt: raw?.createdAt || Date.now(),
    updatedAt: raw?.updatedAt || Date.now(),
  };
}
