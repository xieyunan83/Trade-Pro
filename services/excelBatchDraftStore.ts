/**
 * Excel 批量背调草稿：解析/域名推断完成后落盘，休眠或刷新后可恢复，避免白干。
 */
import type { ClassifiedBatchBgRow, BatchBgClassifyStats } from './batchBackgroundExcel';

const LS_KEY = 'trade_scout_excel_batch_draft_v1';

export type ExcelBatchDraft = {
  savedAt: number;
  fileName: string;
  mode: 'economy' | 'detailed';
  stats: BatchBgClassifyStats;
  rows: ClassifiedBatchBgRow[];
  msg?: string;
};

export const saveExcelBatchDraft = (draft: ExcelBatchDraft): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn('[excel-draft] save failed (quota?)', e);
  }
};

export const loadExcelBatchDraft = (): ExcelBatchDraft | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rows || !Array.isArray(parsed.rows) || !parsed.stats) return null;
    return parsed as ExcelBatchDraft;
  } catch {
    return null;
  }
};

export const clearExcelBatchDraft = (): void => {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
};
