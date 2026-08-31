/**
 * 产品品类深挖后台队列：不阻塞 CRM / 其它页面操作。
 */
import { digProductIntelligence } from './geminiService';
import { isRateLimitError, noteRateLimited, withRateLimitRetry } from './rateLimitGate';
import type { AnalysisResult, Client, HistoryItem } from '../types';

export type ProductDigJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ProductDigJob {
  id: string;
  clientId: string;
  clientName: string;
  domain: string;
  searchKeyword?: string;
  searchCountry?: string;
  status: ProductDigJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** 深挖后的分析（供 UI 合并历史 / CRM / 产品库） */
  result?: AnalysisResult;
  historyId?: string;
}

export type ProductDigCompletePayload = {
  job: ProductDigJob;
  clientId: string;
  domain: string;
  result: AnalysisResult;
  previousHistoryId?: string;
};

type Listener = (jobs: ProductDigJob[]) => void;
type OnComplete = (payload: ProductDigCompletePayload) => void | Promise<void>;
type ResolveHistory = (clientId: string) => HistoryItem | undefined;

const MAX_CONCURRENT = 1; // 产品深挖较重，串行更稳，仍不阻塞 UI
const JOB_STALE_MS = 25 * 60 * 1000;
const jobs: ProductDigJob[] = [];
const listeners = new Set<Listener>();
const onCompleteHandlers = new Map<string, OnComplete>();
let resolveHistoryHandler: ResolveHistory | null = null;
let pumping = false;
let shouldStop = false;

const notify = () => {
  const snapshot = jobs.map((j) => ({ ...j }));
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.error('productDigQueue listener error', e);
    }
  });
};

const cleanDomain = (domain: string) =>
  (domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

const failStaleRunningJobs = () => {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    const started = job.startedAt || job.createdAt;
    if (now - started > JOB_STALE_MS) {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '深挖超时，可重新加入队列重试';
      changed = true;
    }
  }
  if (changed) notify();
};

export const subscribeProductDigJobs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(jobs.map((j) => ({ ...j })));
  return () => {
    listeners.delete(listener);
  };
};

export const getProductDigJobs = (): ProductDigJob[] => jobs.map((j) => ({ ...j }));

export const getProductDigProgress = () => {
  failStaleRunningJobs();
  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const running = jobs.find((j) => j.status === 'running');
  return { total, completed, failed, active, runningName: running?.clientName || running?.domain || '' };
};

export const setProductDigHistoryResolver = (fn: ResolveHistory | null) => {
  resolveHistoryHandler = fn;
};

export type EnqueueProductDigInput = {
  client: Pick<Client, 'id' | 'name' | 'website' | 'country' | 'searchKeyword'>;
  authorized?: boolean;
  onComplete?: OnComplete;
};

export const enqueueProductDig = (
  input: EnqueueProductDigInput
): { ok: true; job: ProductDigJob } | { ok: false; reason: string; job?: ProductDigJob } => {
  if (input.authorized === false) {
    return { ok: false, reason: '你没有「产品品类深挖」权限，请联系管理员开通。' };
  }
  const domain = (input.client.website || input.client.name || '').trim();
  if (!domain) {
    return { ok: false, reason: '客户缺少网址/名称，无法深挖' };
  }

  failStaleRunningJobs();
  const clientId = input.client.id;
  const active = jobs.find(
    (j) => j.clientId === clientId && (j.status === 'queued' || j.status === 'running')
  );
  if (active) {
    return {
      ok: false,
      reason: `「${input.client.name || domain}」已在产品深挖队列中`,
      job: active,
    };
  }

  // 清理同客户已完成记录，便于再次深挖
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.clientId === clientId && (j.status === 'completed' || j.status === 'failed')) {
      jobs.splice(i, 1);
    }
  }

  const job: ProductDigJob = {
    id: `pd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    clientId,
    clientName: input.client.name || domain,
    domain,
    searchKeyword: input.client.searchKeyword || undefined,
    searchCountry: input.client.country || undefined,
    status: 'queued',
    createdAt: Date.now(),
  };

  jobs.unshift(job);
  if (jobs.length > 50) {
    const removable = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
    while (jobs.length > 50 && removable.length) {
      const old = removable.pop();
      if (!old) break;
      const idx = jobs.findIndex((j) => j.id === old.id);
      if (idx >= 0) jobs.splice(idx, 1);
    }
  }

  if (input.onComplete) onCompleteHandlers.set(job.id, input.onComplete);
  shouldStop = false;
  notify();
  void pump();
  return { ok: true, job };
};

export const enqueueProductDigBatch = (
  clients: EnqueueProductDigInput['client'][],
  opts: { authorized?: boolean; onComplete?: OnComplete }
): { queued: number; skipped: number; reasons: string[] } => {
  let queued = 0;
  let skipped = 0;
  const reasons: string[] = [];
  for (const client of clients) {
    const res = enqueueProductDig({
      client,
      authorized: opts.authorized,
      onComplete: opts.onComplete,
    });
    if (res.ok === true) {
      queued += 1;
    } else {
      skipped += 1;
      if (res.reason && reasons.length < 5) reasons.push(res.reason);
    }
  }
  return { queued, skipped, reasons };
};

export const stopProductDigQueue = () => {
  shouldStop = true;
};

export const dismissProductDigJob = (id: string) => {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const job = jobs[idx];
  if (job.status === 'running' || job.status === 'queued') return;
  jobs.splice(idx, 1);
  notify();
};

export const clearFinishedProductDigJobs = () => {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'completed' || jobs[i].status === 'failed') {
      jobs.splice(i, 1);
    }
  }
  notify();
};

const runOne = async (job: ProductDigJob) => {
  job.status = 'running';
  job.startedAt = Date.now();
  notify();

  try {
    const hist = resolveHistoryHandler?.(job.clientId);
    const merged = await withRateLimitRetry(() =>
      digProductIntelligence(job.domain, hist?.data || null, {
        searchKeyword: job.searchKeyword || hist?.data?.searchKeyword,
        searchCountry: job.searchCountry || hist?.data?.searchCountry,
      })
    );

    job.status = 'completed';
    job.finishedAt = Date.now();
    job.result = merged;
    job.historyId = hist?.id;
    notify();

    const handler = onCompleteHandlers.get(job.id);
    onCompleteHandlers.delete(job.id);
    if (handler) {
      await handler({
        job,
        clientId: job.clientId,
        domain: job.domain,
        result: merged,
        previousHistoryId: hist?.id,
      });
    }
  } catch (e: any) {
    console.error('[productDigQueue] failed', job.domain, e);
    job.status = 'failed';
    job.finishedAt = Date.now();
    job.error = e?.message || String(e);
    if (isRateLimitError(e)) noteRateLimited();
    onCompleteHandlers.delete(job.id);
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
      // 任务间隔，降低限流
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    pumping = false;
    // 若停止后又有新任务，且未要求停止，可再启动
    if (!shouldStop && jobs.some((j) => j.status === 'queued')) {
      void pump();
    }
  }
};

export const isProductDigQueueBusy = () =>
  jobs.some((j) => j.status === 'queued' || j.status === 'running');
