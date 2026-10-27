/**
 * 阶段 C：CRM 空白客户「设计信号」轻量补全队列。
 * 可持久化到 localStorage，页面刷新后继续（适合 Windows 通宵挂机）。
 */
import { digDesignSignals } from './geminiService';
import { isRateLimitError, noteRateLimited, withRateLimitRetry } from './rateLimitGate';
import type { AnalysisResult, Client, HistoryItem } from '../types';

export type DesignSignalJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DesignSignalJob {
  id: string;
  clientId: string;
  clientName: string;
  domain: string;
  searchKeyword?: string;
  searchCountry?: string;
  status: DesignSignalJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: AnalysisResult;
  historyId?: string;
}

export type DesignSignalCompletePayload = {
  job: DesignSignalJob;
  clientId: string;
  domain: string;
  result: AnalysisResult;
  previousHistoryId?: string;
};

type Listener = (jobs: DesignSignalJob[]) => void;
type OnComplete = (payload: DesignSignalCompletePayload) => void | Promise<void>;
type ResolveHistory = (clientId: string) => HistoryItem | undefined;

const LS_KEY = 'trade_scout_design_signal_queue_v1';
const MAX_CONCURRENT = 1;
const JOB_STALE_MS = 18 * 60 * 1000;
const JOB_GAP_MS = 4_000;

let jobs: DesignSignalJob[] = [];
const listeners = new Set<Listener>();
let onCompleteHandler: OnComplete | null = null;
let resolveHistoryHandler: ResolveHistory | null = null;
let pumping = false;
let shouldStop = false;

const persistable = (list: DesignSignalJob[]): DesignSignalJob[] =>
  list.map((j) => ({
    id: j.id,
    clientId: j.clientId,
    clientName: j.clientName,
    domain: j.domain,
    searchKeyword: j.searchKeyword,
    searchCountry: j.searchCountry,
    status: j.status === 'running' ? 'queued' : j.status,
    createdAt: j.createdAt,
    startedAt: j.status === 'running' ? undefined : j.startedAt,
    finishedAt: j.finishedAt,
    error: j.error,
    historyId: j.historyId,
    // 不持久化 result，避免撑爆 localStorage
  }));

const saveJobs = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify(persistable(jobs).slice(0, 120)));
  } catch (e) {
    console.warn('[designSignalQueue] persist failed', e);
  }
};

const loadJobs = (): DesignSignalJob[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((j: any) => ({
        id: String(j.id || ''),
        clientId: String(j.clientId || ''),
        clientName: String(j.clientName || ''),
        domain: String(j.domain || ''),
        searchKeyword: j.searchKeyword || undefined,
        searchCountry: j.searchCountry || undefined,
        status: (j.status === 'completed' || j.status === 'failed' || j.status === 'queued'
          ? j.status
          : 'queued') as DesignSignalJobStatus,
        createdAt: Number(j.createdAt) || Date.now(),
        startedAt: j.startedAt ? Number(j.startedAt) : undefined,
        finishedAt: j.finishedAt ? Number(j.finishedAt) : undefined,
        error: j.error || undefined,
        historyId: j.historyId || undefined,
      }))
      .filter((j: DesignSignalJob) => j.id && j.clientId && j.domain);
  } catch {
    return [];
  }
};

const notify = () => {
  saveJobs();
  const snapshot = jobs.map((j) => ({ ...j }));
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.error('designSignalQueue listener error', e);
    }
  });
};

const failStaleRunningJobs = () => {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    const started = job.startedAt || job.createdAt;
    if (now - started > JOB_STALE_MS) {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '补全超时，可重新加入队列';
      changed = true;
    }
  }
  if (changed) notify();
};

/** 启动时恢复未完成任务 */
export const hydrateDesignSignalQueue = () => {
  if (jobs.length) return;
  jobs = loadJobs();
  for (const j of jobs) {
    if (j.status === 'running') j.status = 'queued';
  }
  if (jobs.some((j) => j.status === 'queued')) {
    shouldStop = false;
    notify();
    void pump();
  } else if (jobs.length) {
    notify();
  }
};

export const subscribeDesignSignalJobs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(jobs.map((j) => ({ ...j })));
  return () => {
    listeners.delete(listener);
  };
};

export const getDesignSignalJobs = (): DesignSignalJob[] => jobs.map((j) => ({ ...j }));

export const getDesignSignalProgress = () => {
  failStaleRunningJobs();
  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const running = jobs.find((j) => j.status === 'running');
  return {
    total,
    completed,
    failed,
    active,
    runningName: running?.clientName || running?.domain || '',
  };
};

export const setDesignSignalHistoryResolver = (fn: ResolveHistory | null) => {
  resolveHistoryHandler = fn;
};

export const setDesignSignalOnComplete = (fn: OnComplete | null) => {
  onCompleteHandler = fn;
};

export type EnqueueDesignSignalInput = {
  client: Pick<Client, 'id' | 'name' | 'website' | 'country' | 'searchKeyword'>;
  authorized?: boolean;
};

export const enqueueDesignSignal = (
  input: EnqueueDesignSignalInput
): { ok: true; job: DesignSignalJob } | { ok: false; reason: string; job?: DesignSignalJob } => {
  if (input.authorized === false) {
    return { ok: false, reason: '没有补全权限，请联系管理员开通。' };
  }
  const domain = (input.client.website || '').trim();
  if (!domain) {
    return { ok: false, reason: '客户缺少官网，无法补全' };
  }

  failStaleRunningJobs();
  const clientId = input.client.id;
  const active = jobs.find(
    (j) => j.clientId === clientId && (j.status === 'queued' || j.status === 'running')
  );
  if (active) {
    return {
      ok: false,
      reason: `「${input.client.name || domain}」已在补全队列中`,
      job: active,
    };
  }

  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.clientId === clientId && (j.status === 'completed' || j.status === 'failed')) {
      jobs.splice(i, 1);
    }
  }

  const job: DesignSignalJob = {
    id: `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    clientId,
    clientName: input.client.name || domain,
    domain,
    searchKeyword: input.client.searchKeyword || undefined,
    searchCountry: input.client.country || undefined,
    status: 'queued',
    createdAt: Date.now(),
  };

  jobs.unshift(job);
  if (jobs.length > 120) {
    const removable = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
    while (jobs.length > 120 && removable.length) {
      const old = removable.pop();
      if (!old) break;
      const idx = jobs.findIndex((j) => j.id === old.id);
      if (idx >= 0) jobs.splice(idx, 1);
    }
  }

  shouldStop = false;
  notify();
  void pump();
  return { ok: true, job };
};

export const enqueueDesignSignalBatch = (
  clients: EnqueueDesignSignalInput['client'][],
  opts: { authorized?: boolean }
): { queued: number; skipped: number; reasons: string[] } => {
  let queued = 0;
  let skipped = 0;
  const reasons: string[] = [];
  for (const client of clients) {
    const res = enqueueDesignSignal({ client, authorized: opts.authorized });
    if (res.ok === true) {
      queued += 1;
    } else {
      skipped += 1;
      if (res.reason && reasons.length < 8) reasons.push(res.reason);
    }
  }
  return { queued, skipped, reasons };
};

export const stopDesignSignalQueue = () => {
  shouldStop = true;
  notify();
};

export const resumeDesignSignalQueue = () => {
  shouldStop = false;
  void pump();
};

export const dismissDesignSignalJob = (id: string) => {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const job = jobs[idx];
  if (job.status === 'running' || job.status === 'queued') return;
  jobs.splice(idx, 1);
  notify();
};

export const clearFinishedDesignSignalJobs = () => {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'completed' || jobs[i].status === 'failed') {
      jobs.splice(i, 1);
    }
  }
  notify();
};

const runOne = async (job: DesignSignalJob) => {
  job.status = 'running';
  job.startedAt = Date.now();
  notify();

  try {
    const hist = resolveHistoryHandler?.(job.clientId);
    const merged = await withRateLimitRetry(() =>
      digDesignSignals(job.domain, hist?.data || null, {
        searchKeyword: job.searchKeyword || hist?.data?.searchKeyword,
        searchCountry: job.searchCountry || hist?.data?.searchCountry,
      })
    );

    job.status = 'completed';
    job.finishedAt = Date.now();
    job.result = merged;
    job.historyId = hist?.id;
    notify();

    if (onCompleteHandler) {
      await onCompleteHandler({
        job,
        clientId: job.clientId,
        domain: job.domain,
        result: merged,
        previousHistoryId: hist?.id,
      });
    }
  } catch (e: any) {
    console.error('[designSignalQueue] failed', job.domain, e);
    job.status = 'failed';
    job.finishedAt = Date.now();
    job.error = e?.message || String(e);
    if (isRateLimitError(e)) noteRateLimited();
    notify();
  }
};

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    while (!shouldStop) {
      failStaleRunningJobs();
      const runningCount = jobs.filter((j) => j.status === 'running').length;
      const slots = MAX_CONCURRENT - runningCount;
      if (slots <= 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      const next = jobs.filter((j) => j.status === 'queued').slice(0, slots);
      if (!next.length) {
        if (runningCount === 0) break;
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      await Promise.all(next.map((job) => runOne(job)));
      await new Promise((r) => setTimeout(r, JOB_GAP_MS));
    }
  } finally {
    pumping = false;
    if (!shouldStop && jobs.some((j) => j.status === 'queued')) {
      void pump();
    }
  }
};

export const isDesignSignalQueueBusy = () =>
  jobs.some((j) => j.status === 'queued' || j.status === 'running');
