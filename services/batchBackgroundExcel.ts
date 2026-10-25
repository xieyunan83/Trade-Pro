/**
 * 背景调查 · Excel 批量导入：模板下载、解析、与 CRM/历史去重分类。
 */
import type { AnalysisResult, Client, HistoryItem } from '../types';
import { lookupBackgroundCheck, normalizeCrmHost } from '../utils/crmHistory';

declare const XLSX: any;

export type BatchBgExcelRow = {
  rowIndex: number;
  companyName: string;
  website: string;
  country: string;
  keyword: string;
  note: string;
};

export type BatchBgRowClass =
  | 'need_analyze'
  | 'skip_crm'
  | 'skip_history'
  | 'invalid';

export type ClassifiedBatchBgRow = BatchBgExcelRow & {
  class: BatchBgRowClass;
  reason: string;
  /** 命中历史时可直接入 CRM，无需再烧 Token */
  historyItem?: HistoryItem;
};

const TEMPLATE_HEADERS = [
  '公司名称',
  '官网网址',
  '国家/地区',
  '产品关键词',
  '备注',
] as const;

const SAMPLE_ROWS: Array<Record<(typeof TEMPLATE_HEADERS)[number], string>> = [
  {
    公司名称: 'Acme Toys Inc',
    官网网址: 'https://www.example-toys.com',
    '国家/地区': '美国',
    产品关键词: 'plush toy',
    备注: '示例行，上传前请删除',
  },
  {
    公司名称: 'Nordic Kids Wholesale',
    官网网址: '',
    '国家/地区': '德国',
    产品关键词: 'wooden toys',
    备注: '无网址时可用公司名背调',
  },
];

const HEADER_ALIASES: Record<keyof Omit<BatchBgExcelRow, 'rowIndex'>, string[]> = {
  companyName: ['公司名称', '公司名', '客户名称', '企业名称', 'name', 'company', 'company name'],
  website: ['官网网址', '网址', '网站', '官网', 'website', 'url', 'domain', 'web'],
  country: ['国家/地区', '国家', '地区', '市场', 'country', 'region', 'market'],
  keyword: ['产品关键词', '关键词', '产品', '品类', 'keyword', 'product', 'keywords'],
  note: ['备注', '说明', 'note', 'remark', 'comments'],
};

const ensureXlsx = () => {
  if (typeof XLSX === 'undefined') {
    throw new Error('Excel 引擎未加载，请刷新页面后重试');
  }
};

/** 下载可填写的批量背调模板 */
export const downloadBatchBackgroundTemplate = () => {
  ensureXlsx();
  const wsData = [
    [...TEMPLATE_HEADERS],
    ...SAMPLE_ROWS.map((r) => TEMPLATE_HEADERS.map((h) => r[h])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 28 }, { wch: 36 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];

  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 请在「批量背调」工作表填写客户；至少填写「公司名称」或「官网网址」之一。'],
    ['2. 「产品关键词」用于产品分析与检索偏好，建议填写（如 plush / STEM toy）。'],
    ['3. 已在 CRM 背调过、或系统内已有背调报告的客户会自动跳过，不消耗额度。'],
    ['4. 背调完成后将自动写入 CRM；跳过但仅有历史报告、尚未入 CRM 的会自动补入库。'],
    ['5. 删除示例行后再上传。支持 .xlsx / .xls / .csv。'],
  ]);
  guide['!cols'] = [{ wch: 90 }];

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
    const keyword = pickField(row, headerMap, 'keyword');
    const note = pickField(row, headerMap, 'note');
    if (!companyName && !website && !country && !keyword && !note) return;
    // 跳过仍留在表里的示例
    if (
      /example-toys\.com/i.test(website) ||
      (/示例/.test(note) && /acme|nordic/i.test(companyName))
    ) {
      return;
    }
    out.push({
      rowIndex: i + 2,
      companyName,
      website,
      country,
      keyword,
      note,
    });
  });

  if (!out.length) throw new Error('没有有效客户行（请至少填写公司名称或官网）');
  return out;
};

const targetKey = (website: string, name: string) => {
  const host = normalizeCrmHost(website);
  if (host) return `h:${host}`;
  const n = (name || '').trim().toLowerCase();
  return n ? `n:${n}` : '';
};

/** 分类：需背调 / 跳过 / 无效；同表内去重 */
export const classifyBatchBackgroundRows = (
  rows: BatchBgExcelRow[],
  history: HistoryItem[],
  crmClients: Client[]
): ClassifiedBatchBgRow[] => {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row.companyName.trim() && !row.website.trim()) {
      return { ...row, class: 'invalid' as const, reason: '缺少公司名称与官网' };
    }
    const key = targetKey(row.website, row.companyName);
    if (key && seen.has(key)) {
      return { ...row, class: 'invalid' as const, reason: '表内重复，已忽略' };
    }
    if (key) seen.add(key);

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
        reason: '已有背调报告，跳过分析；将自动补入 CRM',
        historyItem: lookup.historyItem,
      };
    }
    return {
      ...row,
      class: 'need_analyze' as const,
      reason: '待背调 + 产品分析',
    };
  });
};

export type BatchBgClassifyStats = {
  total: number;
  needAnalyze: number;
  skipCrm: number;
  skipHistory: number;
  invalid: number;
};

export const summarizeBatchBgClasses = (rows: ClassifiedBatchBgRow[]): BatchBgClassifyStats => ({
  total: rows.length,
  needAnalyze: rows.filter((r) => r.class === 'need_analyze').length,
  skipCrm: rows.filter((r) => r.class === 'skip_crm').length,
  skipHistory: rows.filter((r) => r.class === 'skip_history').length,
  invalid: rows.filter((r) => r.class === 'invalid').length,
});

/** 队列目标：优先官网，否则公司名 */
export const batchBgQueueTarget = (row: BatchBgExcelRow): string =>
  (row.website || row.companyName || '').trim();

export type AnalysisLike = AnalysisResult;
