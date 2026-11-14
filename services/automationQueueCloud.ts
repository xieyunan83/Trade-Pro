/**
 * 背调作业队列云端同步（IndexedDB ↔ Supabase automation_queue）
 * 解决：浏览器与桌面客户端各自本地库导致条数不一致。
 */
import type { AutomationResult } from '../types';
import {
  deleteAutomationTask,
  getAutomationQueue,
  saveAutomationTask,
  saveAutomationTasksBulk,
} from './db';
import { getCloudWorkspaceId } from './workspaceId';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { selectAllRows } from './supabasePaginate';

const cloudUid = () => getCloudWorkspaceId();

/** 去掉过大字段，降低云端体积（完整报告仍在背调历史 / 本机 IndexedDB） */
export const slimAutomationTaskForCloud = (task: AutomationResult): AutomationResult => {
  const { productImages: _imgs, mailGroup: _mail, analysis: _analysis, ...rest } = task;
  return {
    ...rest,
    productImages: undefined,
    mailGroup: undefined,
    // 队列云端只同步状态与元数据；analysis 体积过大易拖垮 upsert / 配额
    analysis: undefined,
  };
};

const taskStamp = (t: AutomationResult): number =>
  Math.max(Number(t.completedAt) || 0, Number(t.createdAt) || 0, 0);

/**
 * 状态优先级（高者胜出）。
 * 旧逻辑把 analyzing/pending 排在 completed 之上，云同步会把已完成结果打回待处理/失败，
 * Windows 客户端与浏览器互相同步时尤其明显。
 */
const automationStatusRank = (t: AutomationResult): number => {
  if (t.status === 'completed' && t.analysis) return 50;
  if (t.status === 'completed') return 40;
  if (t.status === 'generating_email') return 32;
  if (t.status === 'analyzing') return 28;
  if (t.status === 'pending') return 20;
  if (t.status === 'failed') return 10;
  return 0;
};

/** 云端残留的僵尸 analyzing（崩溃/关客户端）降为 pending，避免压过本机 failed/completed */
const normalizeForMerge = (t: AutomationResult): AutomationResult => {
  if (t.status !== 'analyzing') return t;
  const stamp = taskStamp(t);
  const ageMs = stamp ? Date.now() - stamp : Number.POSITIVE_INFINITY;
  if (ageMs > 45 * 60 * 1000) {
    return { ...t, status: 'pending' };
  }
  return t;
};

export const mergeAutomationQueues = (
  local: AutomationResult[],
  cloud: AutomationResult[]
): AutomationResult[] => {
  const map = new Map<string, AutomationResult>();
  for (const raw of [...cloud, ...local]) {
    const t = normalizeForMerge(raw);
    const id = (t.id || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, t);
      continue;
    }
    // 本机刚失败时，云端可能仍残留 analyzing：按时间戳取较新者，避免失败被僵尸 analyzing 盖掉
    if (
      (t.status === 'analyzing' && prev.status === 'failed') ||
      (t.status === 'failed' && prev.status === 'analyzing')
    ) {
      const tTime = t.status === 'failed' ? Number(t.failedAt) || taskStamp(t) : taskStamp(t);
      const pTime =
        prev.status === 'failed' ? Number(prev.failedAt) || taskStamp(prev) : taskStamp(prev);
      const newer = tTime >= pTime ? t : prev;
      map.set(id, {
        ...newer,
        analysis: t.analysis || prev.analysis,
        error: newer.status === 'failed' ? newer.error || t.error || prev.error : undefined,
      });
      continue;
    }

    const rt = automationStatusRank(t);
    const rp = automationStatusRank(prev);
    if (rt > rp) {
      // 已完成报告优先保留；analyzing 不得覆盖 completed
      map.set(id, {
        ...t,
        analysis: t.analysis || prev.analysis,
        error: t.status === 'failed' ? t.error || prev.error : undefined,
      });
      continue;
    }
    if (rt === rp && taskStamp(t) >= taskStamp(prev)) {
      const analysis = t.analysis || prev.analysis;
      map.set(id, {
        ...prev,
        ...t,
        analysis,
        error: t.status === 'failed' ? t.error || prev.error : t.error,
      });
    } else if (rt === rp && !prev.analysis && t.analysis) {
      map.set(id, { ...prev, ...t, analysis: t.analysis });
    }
  }
  return Array.from(map.values()).sort((a, b) => taskStamp(b) - taskStamp(a));
};

export const pushAutomationTaskToCloud = async (task: AutomationResult): Promise<boolean> => {
  if (!isSupabaseConfigured() || !(task.id || '').trim()) return false;
  try {
    const slim = slimAutomationTaskForCloud(task);
    const { error } = await getSupabaseClient().from('automation_queue').upsert(
      {
        user_id: cloudUid(),
        local_id: slim.id,
        task_data: slim,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,local_id' }
    );
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[automation-cloud] push one failed', e);
    return false;
  }
};

export const deleteAutomationTaskFromCloud = async (
  localId: string,
  opts?: { source?: 'user' | 'sync' }
): Promise<boolean> => {
  if (!isSupabaseConfigured() || !localId.trim()) return false;
  if ((opts?.source || 'user') === 'sync') {
    const local = await getAutomationQueue();
    const { guardCloudWrite, logCloudSafetyBlock } = await import('./cloudDataSafety');
    const decision = guardCloudWrite({
      kind: 'delete',
      localCount: local.length,
      payloadCount: 1,
      label: 'automation_queue',
    });
    if (!decision.allow) {
      logCloudSafetyBlock(decision);
      return false;
    }
  }
  try {
    const { error } = await getSupabaseClient()
      .from('automation_queue')
      .delete()
      .eq('user_id', cloudUid())
      .eq('local_id', localId.trim());
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[automation-cloud] delete failed', e);
    return false;
  }
};

export const fetchAutomationQueueFromCloud = async (): Promise<AutomationResult[]> => {
  if (!isSupabaseConfigured()) return [];
  // 与 CRM/背调历史一致：拉取全表再按 local_id 合并。
  // 旧逻辑按 user_id(=workspace) 过滤，两台客户端若 workspace 不一致会各看各的，表现为「数据库不共用」。
  const { rows, error } = await selectAllRows<{ task_data: AutomationResult }>(
    getSupabaseClient(),
    'automation_queue',
    'task_data, updated_at',
    { orderCol: 'updated_at', ascending: false }
  );
  if (error) {
    if (/automation_queue|schema cache|does not exist/i.test(error)) {
      console.warn(
        '[automation-cloud] 缺少表 automation_queue，请在 SQL Editor 执行 scripts/supabase-automation-queue.sql'
      );
    }
    throw new Error(error);
  }
  return rows
    .map((row) => row.task_data)
    .filter((t) => t && (t.id || '').trim());
};

/** 分批上传本地队列到云端 */
export const syncAutomationQueueToCloud = async (
  tasks: AutomationResult[],
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; uploaded: number; error?: string }> => {
  if (!isSupabaseConfigured()) return { ok: false, uploaded: 0, error: '云端未配置' };
  if (!tasks.length) return { ok: true, uploaded: 0 };
  const client = getSupabaseClient();
  const uid = cloudUid();
  const chunkSize = 100;
  let uploaded = 0;
  try {
    for (let i = 0; i < tasks.length; i += chunkSize) {
      const slice = tasks.slice(i, i + chunkSize).map((t) => {
        const slim = slimAutomationTaskForCloud(t);
        return {
          user_id: uid,
          local_id: slim.id,
          task_data: slim,
          updated_at: new Date().toISOString(),
        };
      });
      const { error } = await client.from('automation_queue').upsert(slice, {
        onConflict: 'user_id,local_id',
      });
      if (error) throw error;
      uploaded += slice.length;
      onProgress?.(uploaded, tasks.length);
    }
    return { ok: true, uploaded };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return { ok: false, uploaded, error: msg };
  }
};

/**
 * 作业队列同步。
 * - writeLocal=false：只对照云端上传本机多出的（①补全云端），不写回本机
 * - writeLocal=true：合并后写本机；可用 scopeFilter 按权限裁剪云端集（②下拉）
 */
export const pullMergePushAutomationQueue = async (opts?: {
  upload?: boolean;
  /** 默认 true。①补云端阶段应 false，避免先把无权限数据灌进本机 */
  writeLocal?: boolean;
  /** 下拉时按权限过滤云端行 */
  scopeFilter?: (rows: AutomationResult[]) => AutomationResult[];
  /** 单次最多上传条数；不设则全量（易拖死整次同步） */
  uploadCap?: number;
  onProgress?: (message: string) => void;
  shouldAbort?: () => boolean;
}): Promise<{
  tasks: AutomationResult[];
  local: number;
  cloud: number;
  merged: number;
  uploaded: number;
  error?: string;
}> => {
  const doUpload = opts?.upload !== false;
  const writeLocal = opts?.writeLocal !== false;
  const onProgress = opts?.onProgress;
  const check = () => {
    if (opts?.shouldAbort?.()) throw new Error('同步超时或已取消');
  };
  onProgress?.('同步中：拉取背调作业…');
  const local = await getAutomationQueue();
  let cloud: AutomationResult[] = [];
  let cloudError: string | undefined;
  try {
    cloud = await fetchAutomationQueueFromCloud();
  } catch (e: any) {
    cloudError = e?.message || String(e);
    console.warn('[automation-cloud] fetch failed', e);
  }
  const scopedCloud = opts?.scopeFilter ? opts.scopeFilter(cloud) : cloud;
  onProgress?.(
    `同步中：合并背调作业（本机 ${local.length} / 云 ${scopedCloud.length}${
      scopedCloud.length !== cloud.length ? `，权限裁剪自 ${cloud.length}` : ''
    }）…`
  );
  const merged = mergeAutomationQueues(local, scopedCloud);

  if (writeLocal) {
    if (merged.length > 0) {
      await saveAutomationTasksBulk(merged);
    } else if (local.length > 0) {
      return {
        tasks: local,
        local: local.length,
        cloud: cloud.length,
        merged: local.length,
        uploaded: 0,
        error: cloudError || '合并结果为空，已保留本机队列',
      };
    }
  }

  let uploaded = 0;
  let pushError = cloudError;
  // 上传对照用「全量云端」（补全主库），不按权限裁剪
  if (doUpload && local.length > 0) {
    check();
    const cloudById = new Map(cloud.map((t) => [t.id, t]));
    let dirty = cloudError
      ? local.slice()
      : local.filter((t) => {
          const prev = cloudById.get(t.id);
          if (!prev) return true;
          return taskStamp(t) > taskStamp(prev);
        });
    dirty = dirty.slice().sort((a, b) => taskStamp(b) - taskStamp(a));
    const cap = opts?.uploadCap;
    const pending = dirty.length;
    if (typeof cap === 'number' && cap > 0 && dirty.length > cap) {
      dirty = dirty.slice(0, cap);
      pushError = [
        pushError,
        `作业队列待传约 ${pending} 条，本轮限 ${cap} 条，将自动续传`,
      ]
        .filter(Boolean)
        .join('；');
    }
    if (dirty.length) {
      onProgress?.(
        `同步中：上传背调作业 0/${dirty.length}${
          pending > dirty.length ? `（共待传 ${pending}）` : ''
        }…`
      );
      const push = await syncAutomationQueueToCloud(dirty, (done, total) => {
        onProgress?.(`同步中：上传背调作业 ${done}/${total}…`);
        check();
      });
      uploaded = push.uploaded;
      if (push.error) pushError = push.error;
    }
  }

  return {
    tasks: writeLocal ? (merged.length ? merged : local) : local,
    local: writeLocal ? merged.length || local.length : local.length,
    cloud: cloud.length,
    merged: writeLocal ? merged.length || local.length : local.length,
    uploaded,
    error: pushError,
  };
};

export const removeAutomationTaskEverywhere = async (id: string): Promise<void> => {
  await deleteAutomationTask(id);
  void deleteAutomationTaskFromCloud(id);
};
