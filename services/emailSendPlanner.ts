/**
 * 邮件群发计划：定时启动 + 分 N 批、每批 M 封、批间/批内间隔。
 */
import type { EmailCampaignRun, EmailTask } from '../types';

export type BuildCampaignRunInput = {
  templateId: string;
  taskIds: string[];
  emailsPerBatch: number;
  /** 0 = 发完为止 */
  batchCount?: number;
  delayBetweenBatchesMs?: number;
  delayWithinBatchMs?: number;
  /** 不传或已过期 = 立即开始 */
  scheduledAt?: number;
  name?: string;
  ownerUsername?: string;
  departmentId?: string;
};

export const DEFAULT_EMAILS_PER_BATCH = 20;
export const DEFAULT_DELAY_BETWEEN_BATCHES_MS = 10 * 60 * 1000;
export const DEFAULT_DELAY_WITHIN_BATCH_MS = 400;

export const buildCampaignRun = (input: BuildCampaignRunInput): EmailCampaignRun => {
  const emailsPerBatch = Math.max(1, Math.min(200, Math.floor(input.emailsPerBatch) || DEFAULT_EMAILS_PER_BATCH));
  const delayBetween =
    typeof input.delayBetweenBatchesMs === 'number'
      ? Math.max(0, input.delayBetweenBatchesMs)
      : DEFAULT_DELAY_BETWEEN_BATCHES_MS;
  const delayWithin =
    typeof input.delayWithinBatchMs === 'number'
      ? Math.max(0, input.delayWithinBatchMs)
      : DEFAULT_DELAY_WITHIN_BATCH_MS;
  const batchCount = Math.max(0, Math.floor(input.batchCount || 0));
  let taskIds = Array.from(new Set(input.taskIds.filter(Boolean)));
  if (batchCount > 0) {
    taskIds = taskIds.slice(0, batchCount * emailsPerBatch);
  }
  const now = Date.now();
  const scheduledAt =
    typeof input.scheduledAt === 'number' && input.scheduledAt > now + 5_000
      ? input.scheduledAt
      : now;
  return {
    id: `erun_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name:
      input.name ||
      `群发 ${new Date(scheduledAt).toLocaleString('zh-CN')} · ${taskIds.length} 封`,
    templateId: input.templateId,
    taskIds,
    emailsPerBatch,
    batchCount,
    delayBetweenBatchesMs: delayBetween,
    delayWithinBatchMs: delayWithin,
    scheduledAt,
    status: scheduledAt > now + 5_000 ? 'scheduled' : 'running',
    nextIndex: 0,
    createdAt: now,
    ownerUsername: input.ownerUsername,
    departmentId: input.departmentId,
  };
};

export const describeCampaignRun = (run: EmailCampaignRun): string => {
  const total = run.taskIds.length;
  const batches =
    run.batchCount > 0
      ? run.batchCount
      : Math.max(1, Math.ceil(total / Math.max(1, run.emailsPerBatch)));
  const start =
    run.scheduledAt > Date.now()
      ? `定时 ${new Date(run.scheduledAt).toLocaleString('zh-CN')}`
      : '立即开始';
  const gapMin = Math.round(run.delayBetweenBatchesMs / 60000);
  return `${start} · 共 ${total} 封 · 分约 ${batches} 批 · 每批 ${run.emailsPerBatch} 封 · 批间隔 ${
    gapMin > 0 ? `${gapMin} 分钟` : `${Math.round(run.delayBetweenBatchesMs / 1000)} 秒`
  }`;
};

export const markTasksScheduled = (
  tasks: EmailTask[],
  run: EmailCampaignRun
): EmailTask[] => {
  const idSet = new Set(run.taskIds);
  return tasks.map((t) =>
    idSet.has(t.id) && (t.status === 'pending' || t.status === 'failed' || t.status === 'scheduled')
      ? {
          ...t,
          status: 'scheduled' as const,
          scheduledAt: run.scheduledAt,
          campaignRunId: run.id,
          error: undefined,
        }
      : t
  );
};

/** 当前应发送的一小波 taskId（同批内） */
export const nextWaveTaskIds = (run: EmailCampaignRun): string[] => {
  if (run.status !== 'running' && run.status !== 'scheduled') return [];
  if (Date.now() < run.scheduledAt) return [];
  const start = run.nextIndex;
  if (start >= run.taskIds.length) return [];
  return run.taskIds.slice(start, start + run.emailsPerBatch);
};

export const advanceCampaignRun = (
  run: EmailCampaignRun,
  sentInWave: number
): EmailCampaignRun => {
  const nextIndex = Math.min(run.taskIds.length, run.nextIndex + sentInWave);
  const done = nextIndex >= run.taskIds.length;
  return {
    ...run,
    status: done ? 'completed' : 'running',
    nextIndex,
    scheduledAt: done
      ? run.scheduledAt
      : Date.now() + (run.delayBetweenBatchesMs || 0),
  };
};
