/**
 * 决策人邮箱后台搜索队列：可并行、不阻塞页面浏览。
 */
import {
  researchDecisionMakerEmails,
  type DecisionMakerResearchStats,
} from './geminiService';
import type { DecisionMaker } from '../types';

export type DmEmailSearchJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DmEmailSearchJob {
  id: string;
  historyId?: string | null;
  domain: string;
  companyName: string;
  companyLinkedin?: string;
  status: DmEmailSearchJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  stats?: DecisionMakerResearchStats;
  /** 入队时的联系人快照 */
  existingSnapshot: DecisionMaker[];
  /** 完成后的联系人（供 UI 立即合并） */
  resultDecisionMakers?: DecisionMaker[];
  searchedAt?: number;
  searchHistoryAppend?: number;
}

type Listener = (jobs: DmEmailSearchJob[]) => void;

const MAX_CONCURRENT = 3;
/** 超过该时长仍为 running 的任务视为卡住，允许重新入队 */
const JOB_STALE_MS = 20 * 60 * 1000;
const jobs: DmEmailSearchJob[] = [];
const listeners = new Set<Listener>();
let pumping = false;

const notify = () => {
  const snapshot = jobs.map((j) => ({ ...j }));
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.error('dmEmailSearchQueue listener error', e);
    }
  });
};

const cleanDomain = (domain: string) =>
  domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];

const failStaleRunningJobs = () => {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    const started = job.startedAt || job.createdAt;
    if (now - started > JOB_STALE_MS) {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '搜索超时，可再次点击「深挖邮箱」重试';
      changed = true;
    }
  }
  if (changed) notify();
};

export const getLatestDmJobForDomain = (domain: string): DmEmailSearchJob | undefined => {
  const key = cleanDomain(domain || '').toLowerCase();
  if (!key) return undefined;
  return jobs.find((j) => cleanDomain(j.domain).toLowerCase() === key);
};

export const hasCompletedDmSearchForDomain = (domain: string): boolean => {
  const key = cleanDomain(domain || '').toLowerCase();
  if (!key) return false;
  return jobs.some(
    (j) =>
      cleanDomain(j.domain).toLowerCase() === key &&
      (j.status === 'completed' || j.status === 'failed')
  );
};

export const subscribeDmEmailSearchJobs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(jobs.map((j) => ({ ...j })));
  return () => {
    listeners.delete(listener);
  };
};

export const getDmEmailSearchJobs = (): DmEmailSearchJob[] => jobs.map((j) => ({ ...j }));

export const getActiveDmJobForDomain = (domain: string): DmEmailSearchJob | undefined => {
  failStaleRunningJobs();
  const key = cleanDomain(domain || '').toLowerCase();
  if (!key) return undefined;
  return jobs.find(
    (j) =>
      cleanDomain(j.domain).toLowerCase() === key &&
      (j.status === 'queued' || j.status === 'running')
  );
};

export type EnqueueDmEmailSearchInput = {
  domain: string;
  companyName: string;
  companyLinkedin?: string;
  historyId?: string | null;
  existingDecisionMakers?: DecisionMaker[];
  /** 调用方已校验 feature.dm_email_search；false 时拒绝入队 */
  authorized?: boolean;
  /** 任务真正开始前再取一次最新联系人（避免浏览其它报告时覆盖错） */
  resolveExisting?: () => DecisionMaker[] | Promise<DecisionMaker[]>;
  /** 完成后写回报告 */
  onComplete?: (job: DmEmailSearchJob) => void | Promise<void>;
};

const onCompleteHandlers = new Map<string, EnqueueDmEmailSearchInput['onComplete']>();
const resolveExistingHandlers = new Map<string, EnqueueDmEmailSearchInput['resolveExisting']>();

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      const running = jobs.filter((j) => j.status === 'running').length;
      if (running >= MAX_CONCURRENT) break;
      const next = jobs.find((j) => j.status === 'queued');
      if (!next) break;

      next.status = 'running';
      next.startedAt = Date.now();
      notify();

      // 并行启动，不 await 在循环里串行
      void (async (job) => {
        try {
          const resolver = resolveExistingHandlers.get(job.id);
          let existing = job.existingSnapshot || [];
          if (resolver) {
            try {
              existing = (await resolver()) || existing;
            } catch {
              /* keep snapshot */
            }
          }

          const research = await researchDecisionMakerEmails({
            domain: job.domain,
            existing,
            companyName: job.companyName,
            reverifyNonAnymail: true,
          });

          job.status = 'completed';
          job.finishedAt = Date.now();
          job.stats = research.stats;
          job.resultDecisionMakers = research.decisionMakers;
          job.searchedAt = research.searchedAt;
          job.searchHistoryAppend = research.searchedAt;
          notify();

          const handler = onCompleteHandlers.get(job.id);
          if (handler) {
            try {
              await handler(job);
            } catch (e) {
              console.error('dm email search onComplete failed', e);
            }
          }
        } catch (e: any) {
          job.status = 'failed';
          job.finishedAt = Date.now();
          job.error = String(e?.message || e);
          notify();
        } finally {
          onCompleteHandlers.delete(job.id);
          resolveExistingHandlers.delete(job.id);
          // 触发下一轮排队任务
          void pump();
        }
      })(next);
    }
  } finally {
    pumping = false;
    // 若仍有空位与排队，再泵一次（处理竞态）
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.some((j) => j.status === 'queued');
    if (queued && running < MAX_CONCURRENT) {
      setTimeout(() => {
        void pump();
      }, 0);
    }
  }
};

export const enqueueDmEmailSearch = (
  input: EnqueueDmEmailSearchInput
): { ok: true; job: DmEmailSearchJob } | { ok: false; reason: string; job?: DmEmailSearchJob } => {
  if (input.authorized === false) {
    return {
      ok: false,
      reason: '你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。',
    };
  }

  const domain = cleanDomain(input.domain || '');
  if (!domain || !domain.includes('.')) {
    return { ok: false, reason: '缺少有效公司域名，无法搜索决策人邮箱' };
  }

  failStaleRunningJobs();

  const existingActive = getActiveDmJobForDomain(domain);
  if (existingActive) {
    const phase = existingActive.status === 'queued' ? '排队' : '搜索';
    return {
      ok: false,
      reason: `「${input.companyName || domain}」正在后台${phase}中，请稍候；完成后可再次点击「深挖邮箱」继续查找更多联系人。`,
      job: existingActive,
    };
  }

  // 移除同域名已完成/失败记录，便于再次深挖
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (
      cleanDomain(j.domain).toLowerCase() === domain.toLowerCase() &&
      (j.status === 'completed' || j.status === 'failed')
    ) {
      jobs.splice(i, 1);
    }
  }

  const job: DmEmailSearchJob = {
    id: `dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    historyId: input.historyId || null,
    domain,
    companyName: input.companyName || domain,
    companyLinkedin: input.companyLinkedin || '',
    status: 'queued',
    createdAt: Date.now(),
    existingSnapshot: [...(input.existingDecisionMakers || [])],
  };

  jobs.unshift(job);
  // 只保留最近 40 条记录，避免列表过长
  if (jobs.length > 40) {
    const removable = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
    while (jobs.length > 40 && removable.length) {
      const old = removable.pop();
      if (!old) break;
      const idx = jobs.findIndex((j) => j.id === old.id);
      if (idx >= 0) jobs.splice(idx, 1);
    }
  }

  if (input.onComplete) onCompleteHandlers.set(job.id, input.onComplete);
  if (input.resolveExisting) resolveExistingHandlers.set(job.id, input.resolveExisting);

  notify();
  void pump();
  return { ok: true, job };
};

export const dismissDmEmailSearchJob = (id: string) => {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const job = jobs[idx];
  if (job.status === 'running' || job.status === 'queued') return;
  jobs.splice(idx, 1);
  notify();
};

export const clearFinishedDmEmailSearchJobs = () => {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'completed' || jobs[i].status === 'failed') {
      jobs.splice(i, 1);
    }
  }
  notify();
};
