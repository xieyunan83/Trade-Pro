/**
 * 背调作业队列云端同步（IndexedDB ↔ Supabase automation_queue）
 * 解决：浏览器与桌面客户端各自本地库导致条数不一致。
 */
import type { AutomationResult } from '../types';
import {
  deleteAutomationTask,
  getAutomationQueue,
  saveAutomationTask,
} from './db';
import { getCloudWorkspaceId } from './workspaceId';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { selectAllRows } from './supabasePaginate';

const cloudUid = () => getCloudWorkspaceId();

/** 去掉过大字段，降低云端体积（完整报告仍在背调历史 / 本机） */
export const slimAutomationTaskForCloud = (task: AutomationResult): AutomationResult => {
  const { productImages: _imgs, mailGroup: _mail, ...rest } = task;
  return { ...rest, productImages: undefined, mailGroup: undefined };
};

const taskStamp = (t: AutomationResult): number =>
  Math.max(Number(t.completedAt) || 0, Number(t.createdAt) || 0, 0);

export const mergeAutomationQueues = (
  local: AutomationResult[],
  cloud: AutomationResult[]
): AutomationResult[] => {
  const map = new Map<string, AutomationResult>();
  for (const t of [...cloud, ...local]) {
    const id = (t.id || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, t);
      continue;
    }
    // 进行中优先保留；否则取时间戳更新的
    const rank = (s: AutomationResult['status']) =>
      s === 'analyzing' ? 3 : s === 'pending' ? 2 : s === 'completed' ? 1 : 0;
    if (rank(t.status) > rank(prev.status)) {
      map.set(id, t);
      continue;
    }
    if (rank(t.status) === rank(prev.status) && taskStamp(t) >= taskStamp(prev)) {
      // 合并时保留更完整的 analysis
      const analysis = t.analysis || prev.analysis;
      map.set(id, { ...prev, ...t, analysis });
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

export const deleteAutomationTaskFromCloud = async (localId: string): Promise<boolean> => {
  if (!isSupabaseConfigured() || !localId.trim()) return false;
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
  try {
    const { rows, error } = await selectAllRows<{ task_data: AutomationResult }>(
      getSupabaseClient(),
      'automation_queue',
      'task_data, updated_at',
      { orderCol: 'updated_at', ascending: false, eq: { user_id: cloudUid() } }
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
  } catch (e) {
    console.warn('[automation-cloud] fetch failed', e);
    return [];
  }
};

/** 分批上传本地队列到云端 */
export const syncAutomationQueueToCloud = async (
  tasks: AutomationResult[]
): Promise<{ ok: boolean; uploaded: number; error?: string }> => {
  if (!isSupabaseConfigured()) return { ok: false, uploaded: 0, error: '云端未配置' };
  if (!tasks.length) return { ok: true, uploaded: 0 };
  const client = getSupabaseClient();
  const uid = cloudUid();
  const chunkSize = 80;
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
    }
    return { ok: true, uploaded };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return { ok: false, uploaded, error: msg };
  }
};

/**
 * 拉取云端 ∪ 合并本机 → 写回本机；再把合并结果推上云端。
 * 登录/打开营销工具时调用，保证 Windows 客户端与浏览器条数一致。
 */
export const pullMergePushAutomationQueue = async (): Promise<{
  tasks: AutomationResult[];
  local: number;
  cloud: number;
  merged: number;
  uploaded: number;
  error?: string;
}> => {
  const local = await getAutomationQueue();
  const cloud = await fetchAutomationQueueFromCloud();
  const merged = mergeAutomationQueues(local, cloud);

  for (const t of merged) {
    await saveAutomationTask(t, { skipCloud: true });
  }

  // 本机有、合并后仍在的都推上去（含首次从 Mac 灌云端）
  const push = await syncAutomationQueueToCloud(merged);
  return {
    tasks: merged,
    local: local.length,
    cloud: cloud.length,
    merged: merged.length,
    uploaded: push.uploaded,
    error: push.error,
  };
};

export const removeAutomationTaskEverywhere = async (id: string): Promise<void> => {
  await deleteAutomationTask(id);
  void deleteAutomationTaskFromCloud(id);
};
