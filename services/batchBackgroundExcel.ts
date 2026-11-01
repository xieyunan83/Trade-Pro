/**
 * 背景调查 · Excel 批量导入：模板下载、解析、与 CRM/历史去重分类。
 * 库内已有背调 → 合并补充（联系人等），不重跑全量背调；无记录才入队分析。
 */
import type { Client, DecisionMaker, HistoryItem } from '../types';
import { lookupBackgroundCheck, normalizeCrmHost } from '../utils/crmHistory';
import { mergeDecisionMakers } from './multiModelMerge';
import { enrichImportRowsWithGuessedDomains } from './domainGuessVerify';

declare const XLSX: any;

export type BatchBgImportSeed = {
  contacts: DecisionMaker[];
  industry: string;
  clientType: string;
  productType: string;
  note: string;
  profile: string;
  address: string;
  postalCode: string;
  fax: string;
};

export type BatchBgExcelRow = {
  rowIndex: number;
  companyName: string;
  website: string;
  country: string;
  /** 公司地址（可选，用于缺域名时与官网内容交叉校验） */
  address: string;
  postalCode: string;
  fax: string;
  /** 企业简介 */
  profile: string;
  keyword: string;
  note: string;
  industry: string;
  clientType: string;
  productType: string;
  contacts: DecisionMaker[];
  /** 域名由邮箱后缀/公司名推断并核验通过 */
  domainGuessed?: boolean;
};

export type BatchBgRowClass =
  | 'need_analyze'
  | 'merge_update'
  | 'skip_crm'
  | 'skip_history'
  | 'invalid';

export type ClassifiedBatchBgRow = BatchBgExcelRow & {
  class: BatchBgRowClass;
  reason: string;
  /** 命中历史时可直接入 CRM / 合并，无需再烧 Token */
  historyItem?: HistoryItem;
};

/**
 * 模板列顺序对齐外贸常用展会/名录表：
 * 公司名称 · 国家 · 企业简介 · 联系人 · 地址 · 邮编 · 电话 · 传真 · 邮件 · 网站
 * 另附岗位/关键词等可选列，便于背调与 CRM 合并。
 */
const TEMPLATE_HEADERS = [
  '公司名称',
  '国家',
  '企业简介',
  '联系人',
  '岗位',
  '地址',
  '邮政编码',
  '电话',
  '传真',
  '邮件地址',
  '网站地址',
  '产品关键词',
  '客户类型',
  'WhatsApp',
  'LinkedIn',
  '联系人2',
  '联系人2岗位',
  '联系人2邮箱',
  '联系人2电话',
  '备注',
] as const;

type HeaderKey = (typeof TEMPLATE_HEADERS)[number];

const SAMPLE_ROWS: Array<Record<HeaderKey, string>> = [
  {
    公司名称: 'FIRMA PAWEX',
    国家: 'Poland',
    企业简介: 'We are international trade company',
    联系人: 'PAWEL GASIOR',
    岗位: 'Buyer',
    地址: 'UL. PRZEMYSLOWA 4, Wadowice',
    邮政编码: '34-100',
    电话: '0048-33-8733108',
    传真: '0048-33-8733109',
    邮件地址: 'PAWEX@PAWEX.COM.PL',
    网站地址: 'WWW.PAWEX.COM.PL',
    产品关键词: 'toys',
    客户类型: '进口商',
    WhatsApp: '',
    LinkedIn: '',
    联系人2: '',
    联系人2岗位: '',
    联系人2邮箱: '',
    联系人2电话: '',
    备注: '示例行，上传前请删除',
  },
  {
    公司名称: 'CHINA V LTD.',
    国家: 'Spain',
    企业简介: 'IMPORT & TRADING',
    联系人: 'EDDIE KWOK',
    岗位: '',
    地址: 'C/ ISLAS CANARIAS, 51 BAJO',
    邮政编码: '03790',
    电话: '0034-96-6471212',
    传真: '0034-96-6471313',
    邮件地址: 'eddie@chinav-demo.es',
    网站地址: '',
    产品关键词: 'party items',
    客户类型: '进口商',
    WhatsApp: '',
    LinkedIn: '',
    联系人2: '',
    联系人2岗位: '',
    联系人2邮箱: '',
    联系人2电话: '',
    备注: '无网站时可用邮件@后缀猜域名并核验；示例行请删除',
  },
  {
    公司名称: 'MILTON ENTERPRISES, INC.',
    国家: 'United States',
    企业简介: 'BALLOONS, PARTY ITEMS',
    联系人: 'DEEPAK SABNANI',
    岗位: 'Purchasing',
    地址: '123 Commerce Blvd, New Jersey',
    邮政编码: '07001',
    电话: '001-201-5550100',
    传真: '',
    邮件地址: 'deepak@miltonenterprises-demo.com',
    网站地址: 'WWW.MILTONENTERPRISES.COM',
    产品关键词: 'balloons',
    客户类型: '批发商',
    WhatsApp: '',
    LinkedIn: '',
    联系人2: '',
    联系人2岗位: '',
    联系人2邮箱: '',
    联系人2电话: '',
    备注: '示例行，上传前请删除',
  },
];

const HEADER_ALIASES: Record<
  | 'companyName'
  | 'website'
  | 'country'
  | 'address'
  | 'postalCode'
  | 'fax'
  | 'profile'
  | 'keyword'
  | 'note'
  | 'industry'
  | 'clientType'
  | 'productType'
  | 'contactName'
  | 'contactTitle'
  | 'contactEmail'
  | 'contactPhone'
  | 'contactWhatsapp'
  | 'contactLinkedin'
  | 'contact2Name'
  | 'contact2Title'
  | 'contact2Email'
  | 'contact2Phone',
  string[]
> = {
  companyName: ['公司名称', '公司名', '客户名称', '企业名称', 'name', 'company', 'company name'],
  website: [
    '网站地址',
    '官网网址',
    '网址',
    '网站',
    '官网',
    'website',
    'url',
    'domain',
    'web',
    'website address',
  ],
  country: ['国家', '国家/地区', '地区', '市场', 'country', 'region', 'market'],
  address: ['地址', '公司地址', '办公地址', 'address', 'street', 'location'],
  postalCode: ['邮政编码', '邮编', '邮递区号', 'zip', 'zipcode', 'postal code', 'postcode'],
  fax: ['传真', '传真号码', 'fax', 'facsimile'],
  profile: ['企业简介', '公司简介', '简介', '介绍', 'profile', 'about', 'description', 'company profile'],
  keyword: ['产品关键词', '关键词', '产品', '品类', 'keyword', 'product', 'keywords'],
  note: ['备注', '说明', 'note', 'remark', 'comments'],
  industry: ['行业', 'industry', 'sector'],
  clientType: ['客户类型', '类型', 'client type', 'type', 'company type'],
  productType: ['主营品类', '产品类型', '品类名称', 'product type', 'category'],
  contactName: [
    '联系人',
    '联系人姓名',
    '决策人',
    '姓名',
    'contact',
    'contact name',
    'decision maker',
    'contact person',
  ],
  contactTitle: ['岗位', '职位', '职务', 'title', 'position', 'job title'],
  contactEmail: [
    '邮件地址',
    '邮箱',
    '电子邮箱',
    '邮件',
    '电子邮件',
    'email',
    'e-mail',
    'mail',
    'email address',
  ],
  contactPhone: ['电话', '手机', '联系电话', 'phone', 'tel', 'mobile', 'telephone'],
  contactWhatsapp: ['whatsapp', 'wa', '微信国际'],
  contactLinkedin: ['linkedin', '领英', 'linkedin网址'],
  contact2Name: ['联系人2', '联系人2姓名', '联系人二', 'contact2', 'contact 2 name'],
  contact2Title: ['联系人2岗位', '联系人2职位', 'contact2 title', 'contact 2 title'],
  contact2Email: ['联系人2邮箱', 'contact2 email', 'contact 2 email'],
  contact2Phone: ['联系人2电话', 'contact2 phone', 'contact 2 phone'],
};

const ensureXlsx = () => {
  if (typeof XLSX === 'undefined') {
    throw new Error('Excel 引擎未加载，请刷新页面后重试');
  }
};

/** 下载可填写的批量背调模板（对齐外贸名录常用字段） */
export const downloadBatchBackgroundTemplate = () => {
  ensureXlsx();
  const wsData = [
    [...TEMPLATE_HEADERS],
    ...SAMPLE_ROWS.map((r) => TEMPLATE_HEADERS.map((h) => r[h])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => {
    if (/网站|邮件|地址|简介|LinkedIn/i.test(h)) return { wch: 28 };
    if (/公司名称|联系人/i.test(h)) return { wch: 22 };
    if (/电话|传真|邮编|邮政/i.test(h)) return { wch: 16 };
    return { wch: 12 };
  });

  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 「批量背调」表字段对齐常见外贸名录：公司名称、国家、企业简介、联系人、地址、邮政编码、电话、传真、邮件地址、网站地址。'],
    ['2. 至少填写「公司名称」「网站地址」「邮件地址」之一；岗位 / 产品关键词 / 客户类型 / WhatsApp / LinkedIn / 联系人2 均可空。'],
    ['3. 无网站地址时：系统用邮件地址 @ 后缀（外贸常见即官网）并结合公司名猜测域名，打开网页且与公司名/地址/电话/联系人对得上才采纳。'],
    ['4. Gmail / Hotmail / Outlook 等个人邮箱后缀不会当作公司官网。'],
    ['5. 你现有的展会/买家名录表若列名相近（如「邮箱」「官网网址」），可直接上传，系统会自动识别别名。'],
    ['6. 库内已有背调的客户只做信息补充；超过 20 家待背调时可改夜间静默（22:00–08:00）跨夜续跑。'],
    ['7. 删除全部示例行后再上传。支持 .xlsx / .xls / .csv。'],
  ]);
  guide['!cols'] = [{ wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '批量背调');
  XLSX.utils.book_append_sheet(wb, guide, '填写说明');
  XLSX.writeFile(wb, `批量背调导入模板_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

const normalizeHeader = (h: unknown): string =>
  String(h || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();

const pickField = (
  row: Record<string, unknown>,
  headerMap: Record<string, string>,
  field: keyof typeof HEADER_ALIASES
): string => {
  for (const alias of HEADER_ALIASES[field]) {
    const key = headerMap[normalizeHeader(alias)];
    if (key && row[key] != null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return '';
};

const guessDmType = (title: string): DecisionMaker['type'] => {
  const t = (title || '').toLowerCase();
  if (/ceo|founder|owner|president|managing director|总经理|创始/.test(t)) return 'CEO';
  if (/buy|purchas|procure|sourcing|采购|买手/.test(t)) return 'Buyer';
  return 'Other';
};

const buildContact = (opts: {
  name: string;
  title: string;
  email: string;
  phone: string;
  whatsapp?: string;
  linkedin?: string;
}): DecisionMaker | null => {
  const name = (opts.name || '').trim();
  const email = (opts.email || '').trim();
  const title = (opts.title || '').trim();
  const phone = (opts.phone || '').trim();
  const whatsapp = (opts.whatsapp || '').trim();
  const linkedin = (opts.linkedin || '').trim();
  if (!name && !email && !phone && !whatsapp && !linkedin) return null;
  const hasEmail = email.includes('@');
  return {
    name: name || (hasEmail ? email.split('@')[0] : '联系人'),
    title: title || '待确认',
    emailGuess: hasEmail ? email : undefined,
    phone: phone || undefined,
    whatsapp: whatsapp || undefined,
    linkedin: linkedin || undefined,
    type: guessDmType(title),
    source: 'Manual',
    emailSource: hasEmail ? 'Manual' : undefined,
    emailStatus: hasEmail ? 'unverified' : undefined,
    isVerified: false,
  };
};

const parseContactsFromRow = (
  row: Record<string, unknown>,
  headerMap: Record<string, string>
): DecisionMaker[] => {
  const c1 = buildContact({
    name: pickField(row, headerMap, 'contactName'),
    title: pickField(row, headerMap, 'contactTitle'),
    email: pickField(row, headerMap, 'contactEmail'),
    phone: pickField(row, headerMap, 'contactPhone'),
    whatsapp: pickField(row, headerMap, 'contactWhatsapp'),
    linkedin: pickField(row, headerMap, 'contactLinkedin'),
  });
  const c2 = buildContact({
    name: pickField(row, headerMap, 'contact2Name'),
    title: pickField(row, headerMap, 'contact2Title'),
    email: pickField(row, headerMap, 'contact2Email'),
    phone: pickField(row, headerMap, 'contact2Phone'),
  });
  return [c1, c2].filter(Boolean) as DecisionMaker[];
};

export const seedFromBatchRow = (row: BatchBgExcelRow): BatchBgImportSeed => ({
  contacts: row.contacts || [],
  industry: (row.industry || '').trim(),
  clientType: (row.clientType || '').trim(),
  productType: (row.productType || '').trim(),
  note: (row.note || '').trim(),
  profile: (row.profile || '').trim(),
  address: (row.address || '').trim(),
  postalCode: (row.postalCode || '').trim(),
  fax: (row.fax || '').trim(),
});

export const rowHasImportSeed = (row: BatchBgExcelRow): boolean => {
  const s = seedFromBatchRow(row);
  return !!(
    s.contacts.length ||
    s.industry ||
    s.clientType ||
    s.productType ||
    s.note ||
    s.profile ||
    s.address ||
    s.postalCode ||
    s.fax
  );
};

/** 解析上传的 Excel/CSV 为标准行 */
export const parseBatchBackgroundExcel = async (file: File): Promise<BatchBgExcelRow[]> => {
  ensureXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n: string) => /批量|背调|客户|import|batch/i.test(n)) ||
    wb.SheetNames[0];
  if (!sheetName) throw new Error('表格为空');
  const sheet = wb.Sheets[sheetName];
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
  if (!rawRows.length) throw new Error('未读到数据行，请确认已填写「批量背调」表');

  const first = rawRows[0];
  const headerMap: Record<string, string> = {};
  for (const k of Object.keys(first)) {
    headerMap[normalizeHeader(k)] = k;
  }

  const out: BatchBgExcelRow[] = [];
  rawRows.forEach((row, i) => {
    const companyName = pickField(row, headerMap, 'companyName');
    const website = pickField(row, headerMap, 'website');
    const country = pickField(row, headerMap, 'country');
    const address = pickField(row, headerMap, 'address');
    const postalCode = pickField(row, headerMap, 'postalCode');
    const fax = pickField(row, headerMap, 'fax');
    const profile = pickField(row, headerMap, 'profile');
    const keyword = pickField(row, headerMap, 'keyword');
    const note = pickField(row, headerMap, 'note');
    const industry = pickField(row, headerMap, 'industry');
    const clientType = pickField(row, headerMap, 'clientType');
    const productType = pickField(row, headerMap, 'productType');
    const contacts = parseContactsFromRow(row, headerMap);
    if (
      !companyName &&
      !website &&
      !country &&
      !address &&
      !profile &&
      !keyword &&
      !note &&
      !industry &&
      !contacts.length
    ) {
      return;
    }
    // 跳过仍留在表里的示例
    const emailBlob = contacts.map((c) => c.emailGuess || '').join(' ');
    if (
      /example-toys\.com|miltonenterprises-demo|chinav-demo/i.test(website + emailBlob) ||
      (/示例/.test(note) && /pawex|china v|milton|acme|nordic/i.test(companyName))
    ) {
      return;
    }
    out.push({
      rowIndex: i + 2,
      companyName,
      website,
      country,
      address,
      postalCode,
      fax,
      profile,
      keyword,
      note,
      industry,
      clientType,
      productType,
      contacts,
    });
  });

  if (!out.length) throw new Error('没有有效客户行（请至少填写公司名称、网站地址或邮件地址）');
  return out;
};

const emailHostKey = (contacts?: DecisionMaker[]) => {
  for (const c of contacts || []) {
    const e = (c.emailGuess || '').trim().toLowerCase();
    const at = e.lastIndexOf('@');
    if (at > 0) {
      const host = e.slice(at + 1).replace(/^www\./, '');
      if (host.includes('.')) return `e:${host}`;
    }
  }
  return '';
};

const targetKey = (website: string, name: string, contacts?: DecisionMaker[]) => {
  const host = normalizeCrmHost(website);
  if (host) return `h:${host}`;
  const n = (name || '').trim().toLowerCase();
  if (n) return `n:${n}`;
  return emailHostKey(contacts);
};

/** 同表内按域名/名称/邮箱后缀合并多行联系人 */
export const coalesceBatchBgRows = (rows: BatchBgExcelRow[]): BatchBgExcelRow[] => {
  const map = new Map<string, BatchBgExcelRow>();
  const orphan: BatchBgExcelRow[] = [];
  for (const row of rows) {
    const key = targetKey(row.website, row.companyName, row.contacts);
    if (!key) {
      orphan.push(row);
      continue;
    }
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row, contacts: [...(row.contacts || [])] });
      continue;
    }
    map.set(key, {
      ...prev,
      companyName: prev.companyName || row.companyName,
      website: prev.website || row.website,
      country: prev.country || row.country,
      address: prev.address || row.address,
      postalCode: prev.postalCode || row.postalCode,
      fax: prev.fax || row.fax,
      profile: prev.profile || row.profile,
      keyword: prev.keyword || row.keyword,
      note: [prev.note, row.note].filter(Boolean).join('；'),
      industry: prev.industry || row.industry,
      clientType: prev.clientType || row.clientType,
      productType: prev.productType || row.productType,
      domainGuessed: prev.domainGuessed || row.domainGuessed,
      contacts: mergeDecisionMakers(prev.contacts || [], row.contacts || []),
    });
  }
  return [...map.values(), ...orphan];
};

/**
 * 缺官网时：邮箱@后缀优先 + 公司名候选 → 探测可打开且与表格字段挂勾后写回 website
 */
export const enrichBatchRowsMissingDomains = async (
  rows: BatchBgExcelRow[],
  onProgress?: (done: number, total: number) => void
): Promise<{ rows: BatchBgExcelRow[]; guessed: number }> => {
  const forGuess = rows.map((r) => ({
    ...r,
    address: [r.address, r.postalCode].filter(Boolean).join(' '),
  }));
  const { rows: next, guessed } = await enrichImportRowsWithGuessedDomains(forGuess, {
    concurrency: 2,
    onProgress,
  });
  const marked = next.map((r) => {
    const orig = rows.find((x) => x.rowIndex === r.rowIndex);
    // 保留原始 address/邮编分列，只采纳推断出的 website
    const restored: BatchBgExcelRow = {
      ...r,
      address: orig?.address || r.address,
      postalCode: orig?.postalCode || r.postalCode,
    };
    if (orig && !normalizeCrmHost(orig.website) && normalizeCrmHost(r.website)) {
      return { ...restored, domainGuessed: true };
    }
    return restored;
  });
  return { rows: marked, guessed };
};

const mapClientType = (t?: string): Client['type'] | undefined => {
  const s = (t || '').toLowerCase();
  if (!s) return undefined;
  if (/零售|retail/.test(s)) return '零售商';
  if (/批发|wholesale/.test(s)) return '批发商';
  if (/分销|distribut/.test(s)) return '分销商';
  if (/进口|import/.test(s)) return '进口商';
  return undefined;
};

/** 把 Excel 种子字段合并进已有 CRM 客户 */
export const applyBatchSeedToClient = (client: Client, seed: BatchBgImportSeed): Client => {
  const contacts = mergeDecisionMakers(client.contacts || [], seed.contacts || []);
  const mappedType = mapClientType(seed.clientType);
  const addrLine = [seed.address, seed.postalCode].filter(Boolean).join(' · ');
  const logBits = [
    seed.contacts.length ? `联系人+${seed.contacts.length}` : '',
    seed.industry || seed.productType || seed.clientType ? '档案字段' : '',
    seed.profile ? `简介:${seed.profile.slice(0, 60)}` : '',
    addrLine ? `地址:${addrLine.slice(0, 50)}` : '',
    seed.fax ? `传真:${seed.fax}` : '',
    seed.note ? `备注:${seed.note.slice(0, 40)}` : '',
  ].filter(Boolean);
  const industry =
    seed.industry ||
    (!client.industry && seed.profile ? seed.profile.slice(0, 80) : '') ||
    client.industry;
  return {
    ...client,
    industry,
    productType: seed.productType || client.productType,
    type: mappedType || client.type,
    contacts,
    activityLog:
      (client.activityLog || '') +
      (logBits.length
        ? `\n[Excel补充 ${new Date().toLocaleString('zh-CN')}] ${logBits.join(' · ')}`
        : ''),
  };
};

/** 分类：需背调 / 仅合并补充 / 无效 */
export const classifyBatchBackgroundRows = (
  rows: BatchBgExcelRow[],
  history: HistoryItem[],
  crmClients: Client[]
): ClassifiedBatchBgRow[] => {
  const coalesced = coalesceBatchBgRows(rows);
  return coalesced.map((row) => {
    const hasEmail = (row.contacts || []).some((c) => (c.emailGuess || '').includes('@'));
    if (!row.companyName.trim() && !row.website.trim() && !hasEmail) {
      return { ...row, class: 'invalid' as const, reason: '缺少公司名称、官网与邮箱' };
    }
    // 仅有邮箱、无公司名、且域名推断未通过 → 无法立户
    if (!row.companyName.trim() && !row.website.trim() && hasEmail) {
      return {
        ...row,
        class: 'invalid' as const,
        reason: '未能根据邮箱后缀核验出可用官网，请补公司名或网址',
      };
    }

    const lookup = lookupBackgroundCheck(row.website, row.companyName, history, crmClients);
    if (lookup.checked) {
      const inCrm = crmClients.some((c) => {
        const cHost = normalizeCrmHost(c.website);
        const rHost = normalizeCrmHost(row.website);
        const cName = (c.name || '').trim().toLowerCase();
        const rName = (row.companyName || '').trim().toLowerCase();
        if (rHost && cHost && rHost === cHost) return true;
        if (rName && cName && rName === cName) return true;
        return false;
      });
      const hasSeed = rowHasImportSeed(row);
      if (hasSeed) {
        return {
          ...row,
          class: 'merge_update' as const,
          reason: inCrm
            ? '库内已有 · 合并表格信息（不重跑背调）'
            : '已有报告 · 合并表格并补入 CRM（不重跑背调）',
          historyItem: lookup.historyItem,
        };
      }
      if (inCrm) {
        return {
          ...row,
          class: 'skip_crm' as const,
          reason: 'CRM 已有背调，跳过以节省额度',
          historyItem: lookup.historyItem,
        };
      }
      return {
        ...row,
        class: 'skip_history' as const,
        reason: '已有背调报告；将自动补入 CRM',
        historyItem: lookup.historyItem,
      };
    }
    const guessHint = row.domainGuessed ? ' · 域名已推断核验' : '';
    return {
      ...row,
      class: 'need_analyze' as const,
      reason: row.contacts?.length
        ? `待背调 + 产品分析（含 ${row.contacts.length} 位导入联系人）${guessHint}`
        : `待背调 + 产品分析${guessHint}`,
    };
  });
};

export type BatchBgClassifyStats = {
  total: number;
  needAnalyze: number;
  mergeUpdate: number;
  skipCrm: number;
  skipHistory: number;
  invalid: number;
};

export const summarizeBatchBgClasses = (rows: ClassifiedBatchBgRow[]): BatchBgClassifyStats => ({
  total: rows.length,
  needAnalyze: rows.filter((r) => r.class === 'need_analyze').length,
  mergeUpdate: rows.filter((r) => r.class === 'merge_update').length,
  skipCrm: rows.filter((r) => r.class === 'skip_crm').length,
  skipHistory: rows.filter((r) => r.class === 'skip_history').length,
  invalid: rows.filter((r) => r.class === 'invalid').length,
});

/** 队列目标：优先官网，否则公司名 */
export const batchBgQueueTarget = (row: BatchBgExcelRow): string =>
  (row.website || row.companyName || '').trim();
