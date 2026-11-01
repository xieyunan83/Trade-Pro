/**
 * Excel 大批量背调：可选「仅夜间窗口」执行（上海 22:00–08:00），跨夜续跑直至完成。
 */
import type { AutomationResult } from '../types';

export const EXCEL_NIGHT_BATCH_THRESHOLD = 20;

const LS_KEY = 'trade_scout_excel_night_batches_v1';

export type ExcelNightBatchMeta = {
  id: string;
  total: number;
  createdAt: number;
  mode?: 'economy' | 'detailed';
  /** 全部终态后已弹窗 */
  notifiedAt?: number;
};

const readAll = (): ExcelNightBatchMeta[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeAll = (list: ExcelNightBatchMeta[]) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-40)));
  } catch {
    /* quota */
  }
};

export const newExcelNightBatchId = (): string =>
  `enb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const registerExcelNightBatch = (
  meta: Omit<ExcelNightBatchMeta, 'createdAt'> & { createdAt?: number }
): ExcelNightBatchMeta => {
  const row: ExcelNightBatchMeta = {
    id: meta.id,
    total: meta.total,
    mode: meta.mode,
    createdAt: meta.createdAt || Date.now(),
    notifiedAt: meta.notifiedAt,
  };
  const prev = readAll().filter((x) => x.id !== row.id);
  writeAll([row, ...prev]);
  return row;
};

export const getExcelNightBatch = (id: string): ExcelNightBatchMeta | undefined =>
  readAll().find((x) => x.id === id);

export const markExcelNightBatchNotified = (id: string): void => {
  const list = readAll().map((x) =>
    x.id === id ? { ...x, notifiedAt: Date.now() } : x
  );
  writeAll(list);
};

export type ExcelNightBatchProgress = {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  analyzing: number;
  done: boolean;
};

/** 根据任务列表判断某一夜间批次是否已全部终态 */
export const summarizeExcelNightBatch = (
  batchId: string,
  tasks: AutomationResult[]
): ExcelNightBatchProgress | null => {
  const meta = getExcelNightBatch(batchId);
  if (!meta) return null;
  const mine = tasks.filter((t) => t.nightBatchId === batchId);
  const completed = mine.filter((t) => t.status === 'completed').length;
  const failed = mine.filter((t) => t.status === 'failed').length;
  const pending = mine.filter((t) => t.status === 'pending').length;
  const analyzing = mine.filter((t) => t.status === 'analyzing').length;
  // 以注册总数为准；若任务尚未全部写入内存，不算完成
  const known = mine.length;
  const settled = completed + failed;
  const done =
    known >= meta.total &&
    pending === 0 &&
    analyzing === 0 &&
    settled >= meta.total;
  return {
    batchId,
    total: meta.total,
    completed,
    failed,
    pending,
    analyzing,
    done,
  };
};

/** 当前是否应执行该任务（夜间限定任务仅在 22:00–08:00） */
export const isAutomationTaskRunnableNow = (
  task: AutomationResult,
  inNightWindow: boolean
): boolean => {
  if (task.status !== 'pending') return false;
  if (task.nightWindowOnly && !inNightWindow) return false;
  return true;
};
