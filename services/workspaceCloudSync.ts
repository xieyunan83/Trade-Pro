/**
 * 工作区全量云同步：CRM / 背调历史 / 产品画像 / 背调作业队列
 * 登录与「同步全部资料」时调用：本机 ∪ 云端合并 → 写回本机 → 再推上云端。
 */
import type { Client, CustomerProductProfile, HistoryItem } from '../types';
import { getHistory, saveHistory, saveProductProfilesBulk } from './db';
import { loadProductCatalog } from './productCatalog';
import {
  getCrmClients,
  getInvestigationHistory,
  getProductProfilesCloud,
  isSupabaseConfigured,
  saveCrmClientsBulk,
  saveInvestigationHistory,
  saveProductProfileCloud,
  syncProductProfilesCloud,
} from './supabase';
import { loadAllCrmClients, saveAllCrmClients } from '../utils/workspaceScope';
import { filterOutCrmTombstones } from '../utils/crmTombstones';
import { pullMergePushAutomationQueue } from './automationQueueCloud';

export type WorkspaceSyncReport = {
  ok: boolean;
  crm: { local: number; cloud: number; merged: number; uploaded: number };
  history: { local: number; cloud: number; merged: number; uploaded: number };
  profiles: { local: number; cloud: number; merged: number; uploaded: number };
  automation: { local: number; cloud: number; merged: number; uploaded: number };
  errors: string[];
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const clientStamp = (c: Client): number =>
  Math.max(
    Number(c.lastBackgroundCheckAt) || 0,
    ...(c.activityEvents || []).map((e) => Number(e.at) || 0),
    0
  );

export const mergeClientsById = (local: Client[], cloud: Client[]): Client[] => {
  const map = new Map<string, Client>();
  for (const c of [...cloud, ...local]) {
    if (!c?.id) continue;
    const prev = map.get(c.id);
    if (!prev) {
      map.set(c.id, c);
      continue;
    }
    // 保留联系人/标签更全、时间戳更新的一方，字段做并集
    const preferLocal = clientStamp(c) >= clientStamp(prev);
    const a = preferLocal ? c : prev;
    const b = preferLocal ? prev : c;
    map.set(c.id, {
      ...b,
      ...a,
      contacts: (a.contacts?.length || 0) >= (b.contacts?.length || 0) ? a.contacts : b.contacts,
      tags: Array.from(new Set([...(b.tags || []), ...(a.tags || [])])),
      searchedKeywords: Array.from(
        new Set([...(b.searchedKeywords || []), ...(a.searchedKeywords || [])])
      ),
      activityEvents: [...(b.activityEvents || []), ...(a.activityEvents || [])]
        .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
        .sort((x, y) => (y.at || 0) - (x.at || 0))
        .slice(0, 200),
    });
  }
  return Array.from(map.values());
};

export const mergeHistoryById = (local: HistoryItem[], cloud: HistoryItem[]): HistoryItem[] => {
  const map = new Map<string, HistoryItem>();
  for (const h of [...cloud, ...local]) {
    if (!h?.id) continue;
    const prev = map.get(h.id);
    if (!prev) {
      map.set(h.id, h);
      continue;
    }
    const dmA = h.data?.decisionMakers?.length || 0;
    const dmB = prev.data?.decisionMakers?.length || 0;
    const richer = dmA !== dmB ? (dmA > dmB ? h : prev) : (h.timestamp || 0) >= (prev.timestamp || 0) ? h : prev;
    map.set(h.id, richer);
  }
  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
};

export const mergeProfilesById = (
  local: CustomerProductProfile[],
  cloud: CustomerProductProfile[]
): CustomerProductProfile[] => {
  const map = new Map<string, CustomerProductProfile>();
  for (const p of [...cloud, ...local]) {
    const id = (p.id || '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev || Number(p.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
      map.set(id, p);
    }
  }
  return Array.from(map.values());
};

/** 分块上传 CRM（避免单次 payload 过大） */
export const uploadCrmChunked = async (clients: Client[]): Promise<number> => {
  if (!clients.length) return 0;
  let n = 0;
  for (const part of chunk(clients, 100)) {
    const ok = await saveCrmClientsBulk(part);
    if (!ok) throw new Error('CRM 分块上传失败');
    n += part.length;
  }
  return n;
};

/** 分块上传背调历史 */
export const uploadHistoryChunked = async (items: HistoryItem[]): Promise<number> => {
  let n = 0;
  for (const part of chunk(items, 40)) {
    await Promise.all(
      part.map(async (item) => {
        const ok = await saveInvestigationHistory(item);
        if (ok) n += 1;
      })
    );
  }
  return n;
};

/**
 * 全量同步：合并本机与云端，写回本机，再推上云端。
 * 解决「网页有数据、客户端没有」——只要在资料最全的一端先跑一次。
 */
export const syncAllWorkspaceData = async (): Promise<WorkspaceSyncReport> => {
  const errors: string[] = [];
  const empty = { local: 0, cloud: 0, merged: 0, uploaded: 0 };
  const report: WorkspaceSyncReport = {
    ok: true,
    crm: { ...empty },
    history: { ...empty },
    profiles: { ...empty },
    automation: { ...empty },
    errors,
  };

  if (!isSupabaseConfigured()) {
    errors.push('云端未配置（Supabase）');
    report.ok = false;
    return report;
  }

  // —— CRM ——
  try {
    const localCrm = filterOutCrmTombstones(loadAllCrmClients());
    const cloudCrm = filterOutCrmTombstones(await getCrmClients());
    const mergedCrm = mergeClientsById(localCrm, cloudCrm);
    saveAllCrmClients(mergedCrm);
    const uploaded = await uploadCrmChunked(mergedCrm);
    report.crm = {
      local: localCrm.length,
      cloud: cloudCrm.length,
      merged: mergedCrm.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`CRM：${e?.message || String(e)}`);
  }

  // —— 背调历史 ——
  try {
    const localHist = await getHistory();
    const cloudHist = await getInvestigationHistory();
    const mergedHist = mergeHistoryById(localHist, cloudHist);
    for (const item of mergedHist) {
      try {
        await saveHistory(item);
      } catch {
        /* quota */
      }
    }
    const uploaded = await uploadHistoryChunked(mergedHist);
    report.history = {
      local: localHist.length,
      cloud: cloudHist.length,
      merged: mergedHist.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`背调历史：${e?.message || String(e)}`);
  }

  // —— 产品画像 ——
  try {
    const localProfiles = await loadProductCatalog();
    const cloudProfiles = await getProductProfilesCloud();
    const mergedProfiles = mergeProfilesById(localProfiles, cloudProfiles);
    if (mergedProfiles.length) await saveProductProfilesBulk(mergedProfiles);
    let uploaded = 0;
    if (mergedProfiles.length) {
      uploaded = await syncProductProfilesCloud(mergedProfiles);
      if (!uploaded) {
        for (const p of mergedProfiles) {
          if (await saveProductProfileCloud(p)) uploaded += 1;
        }
      }
    }
    report.profiles = {
      local: localProfiles.length,
      cloud: cloudProfiles.length,
      merged: mergedProfiles.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`产品画像：${e?.message || String(e)}`);
  }

  // —— 背调作业队列 ——
  try {
    const synced = await pullMergePushAutomationQueue();
    report.automation = {
      local: synced.local,
      cloud: synced.cloud,
      merged: synced.merged,
      uploaded: synced.uploaded,
    };
    if (synced.error) errors.push(`背调作业：${synced.error}`);
  } catch (e: any) {
    errors.push(`背调作业：${e?.message || String(e)}`);
  }

  report.ok = errors.length === 0;
  return report;
};

export const formatWorkspaceSyncReport = (r: WorkspaceSyncReport): string => {
  const line = (name: string, x: { local: number; cloud: number; merged: number; uploaded: number }) =>
    `${name}：本机 ${x.local} / 云端 ${x.cloud} → 合并 ${x.merged}（上传 ${x.uploaded}）`;
  const parts = [
    line('CRM 客户', r.crm),
    line('背调历史', r.history),
    line('产品画像', r.profiles),
    line('背调作业队列', r.automation),
  ];
  if (r.errors.length) parts.push('问题：\n- ' + r.errors.join('\n- '));
  return parts.join('\n');
};
