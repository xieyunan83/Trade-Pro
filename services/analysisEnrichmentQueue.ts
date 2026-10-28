/**
 * 背调补全队列：旧报告 →（按需）品类深挖 + 设计信号 → 决策模型结构化判定 → 回写历史/CRM/画像。
 * 可持久化到 localStorage，刷新后续跑。
 */
import { digDesignSignals, digProductIntelligence } from './geminiService';
import {
  enrichAnalysisWithDecision,
  localNeedsDesignFill,
  localNeedsProductDig,
} from './analysisDecisionEnrich';
import { isRateLimitError, noteRateLimited, withRateLimitRetry } from './rateLimitGate';
import type { AnalysisResult, Client, HistoryItem } from '../types';

export type EnrichmentJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface EnrichmentJob {
  id: string;
  clientId: string;
  clientName: string;
  domain: string;
  searchKeyword?: string;
  searchCountry?: string;
  status: EnrichmentJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: AnalysisResult;
  historyId?: string;
  steps?: string;
}

export type EnrichmentCompletePayload = {
  job: EnrichmentJob;
  clientId: string;
  domain: string;
  result: AnalysisResult;
  previousHistoryId?: string;
};

type Listener = (jobs: EnrichmentJob[]) => void;
type OnComplete = (payload: EnrichmentCompletePayload) => void | Promise<void>;
type ResolveHistory = (clientId: string) => HistoryItem | undefined;

const LS_KEY = 'trade_scout_analysis_enrichment_queue_v1';
const MAX_CONCURRENT = 1;
const JOB_STALE_MS = 30 * 60 * 1000;
const JOB_GAP_MS = 3_000;

let jobs: EnrichmentJob[] = [];
const listeners = new Set<Listener>();
let onCompleteHandler: OnComplete | null = null;
let resolveHistoryHandler: ResolveHistory | null = null;
let pumping = false;
let shouldStop = false;

const persistable = (list: EnrichmentJob[]): EnrichmentJob[] =>
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
    steps: j.steps,
  }));

const saveJobs = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify(persistable(jobs).slice(0, 150)));
  } catch (e) {
    console.warn('[enrichmentQueue] persist failed', e);
  }
};

const loadJobs = (): EnrichmentJob[] => {
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
          : 'queued') as EnrichmentJobStatus,
        createdAt: Number(j.createdAt) || Date.now(),
        finishedAt: j.finishedAt ? Number(j.finishedAt) : undefined,
        error: j.error || undefined,
        historyId: j.historyId || undefined,
        steps: j.steps || undefined,
      }))
      .filter((j: EnrichmentJob) => j.id && j.clientId);
  } catch {
    return [];
  }
};

const notify = () => {
  saveJobs();
  const snap = jobs.map((j) => ({ ...j }));
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.error('[enrichmentQueue] listener', e);
    }
  });
};

export const hydrateEnrichmentQueue = () => {
  if (jobs.length) return;
  jobs = loadJobs();
  if (jobs.some((j) => j.status === 'queued')) {
    shouldStop = false;
    void pump();
  }
  notify();
};

export const subscribeEnrichmentJobs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(jobs.map((j) => ({ ...j })));
  return () => listeners.delete(listener);
};

export const getEnrichmentProgress = () => {
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

export const isEnrichmentQueueBusy = () =>
  jobs.some((j) => j.status === 'queued' || j.status === 'running');

export const setEnrichmentOnComplete = (fn: OnComplete | null) => {
  onCompleteHandler = fn;
};

export const setEnrichmentHistoryResolver = (fn: ResolveHistory | null) => {
  resolveHistoryHandler = fn;
};

export const stopEnrichmentQueue = () => {
  shouldStop = true;
};

export const clearFinishedEnrichmentJobs = () => {
  jobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  notify();
};

const cleanDomain = (domain: string) =>
  (domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

export type EnqueueEnrichmentInput = {
  client: Client;
  authorized: boolean;
};

export const enqueueEnrichment = (
  input: EnqueueEnrichmentInput
): { ok: boolean; reason?: string } => {
  if (!input.authorized) return { ok: false, reason: '无权限' };
  const client = input.client;
  const domain = cleanDomain(client.website || client.name || '');
  if (!domain) return { ok: false, reason: '缺少官网/公司名' };
  const exists = jobs.some(
    (j) =>
      j.clientId === client.id && (j.status === 'queued' || j.status === 'running')
  );
  if (exists) return { ok: false, reason: '已在队列中' };

  jobs.push({
    id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    clientId: client.id,
    clientName: client.name || domain,
    domain,
    searchKeyword: client.searchKeyword || client.productType,
    searchCountry: client.country,
    status: 'queued',
    createdAt: Date.now(),
  });
  shouldStop = false;
  notify();
  void pump();
  return { ok: true };
};

export const enqueueEnrichmentBatch = (
  clients: Client[],
  opts: { authorized: boolean }
): { queued: number; skipped: number; reasons: string[] } => {
  let queued = 0;
  let skipped = 0;
  const reasons: string[] = [];
  for (const client of clients) {
    const res = enqueueEnrichment({ client, authorized: opts.authorized });
    if (res.ok) queued += 1;
    else {
      skipped += 1;
      if (res.reason && reasons.length < 5) reasons.push(`${client.name || client.id}: ${res.reason}`);
    }
  }
  return { queued, skipped, reasons };
};

const failStale = () => {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    if (now - (job.startedAt || job.createdAt) > JOB_STALE_MS) {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '补全超时，可重新加入队列';
      changed = true;
    }
  }
  if (changed) notify();
};

const runOne = async (job: EnrichmentJob) => {
  job.status = 'running';
  job.startedAt = Date.now();
  job.steps = '准备';
  notify();

  try {
    const hist = resolveHistoryHandler?.(job.clientId);
    let data = hist?.data || null;
    const kw = job.searchKeyword || hist?.data?.searchKeyword;
    const country = job.searchCountry || hist?.data?.searchCountry;

    if (!data) {
      // 无历史：先轻量设计信号拉骨架，再决策（品类深挖需要已有分析时更稳）
      job.steps = '公开信息补全';
      notify();
      data = await withRateLimitRetry(() =>
        digDesignSignals(job.domain, null, { searchKeyword: kw, searchCountry: country })
      );
    } else {
      if (localNeedsProductDig(data)) {
        job.steps = '补采品类价带';
        notify();
        data = await withRateLimitRetry(() =>
          digProductIntelligence(job.domain, data, {
            searchKeyword: kw,
            searchCountry: country,
          })
        );
      }
      if (localNeedsDesignFill(data)) {
        job.steps = '补全设计信号';
        notify();
        data = await withRateLimitRetry(() =>
          digDesignSignals(job.domain, data, {
            searchKeyword: kw,
            searchCountry: country,
          })
        );
      }
    }

    job.steps = '决策模型判定';
    notify();
    const { analysis } = await withRateLimitRetry(() => enrichAnalysisWithDecision(data!));

    job.status = 'completed';
    job.finishedAt = Date.now();
    job.result = analysis;
    job.historyId = hist?.id;
    job.steps = analysis.decisionEnrichment?.summaryZh || '完成';
    notify();

    if (onCompleteHandler) {
      await onCompleteHandler({
        job,
        clientId: job.clientId,
        domain: job.domain,
        result: analysis,
        previousHistoryId: hist?.id,
      });
    }
  } catch (e: any) {
    console.error('[enrichmentQueue] failed', job.domain, e);
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
      failStale();
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
    if (!shouldStop && jobs.some((j) => j.status === 'queued')) void pump();
  }
};
