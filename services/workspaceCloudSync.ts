/**
 * 工作区全量云同步：CRM / 背调历史 / 产品画像 / 背调作业队列
 * 登录与「同步全部资料」时：先拉取合并写本机（尽快出界面），再按需推上云端。
 */
import type { Client, CustomerProductProfile, HistoryItem } from '../types';
import { getHistory, saveHistoryBulk, saveProductProfilesBulk } from './db';
import { loadProductCatalog } from './productCatalog';
import {
  getCrmClients,
  getInvestigationHistory,
  getProductProfilesCloud,
  getSupabaseClient,
  isSupabaseConfigured,
  saveCrmClientsBulk,
  saveProductProfileCloud,
  syncProductProfilesCloud,
} from './supabase';
import { getCloudWorkspaceId } from './workspaceId';
import { loadAllCrmClients, saveAllCrmClients } from '../utils/workspaceScope';
import { reconcileCrmTombstonesWithLiveClients } from '../utils/crmTombstones';
import { pullMergePushAutomationQueue } from './automationQueueCloud';
import { mergeHistoryPreferDmRich } from './dmSearchPersist';

export type WorkspaceSyncReport = {
  ok: boolean;
  crm: { local: number; cloud: number; merged: number; uploaded: number };
  history: { local: number; cloud: number; merged: number; uploaded: number };
  profiles: { local: number; cloud: number; merged: number; uploaded: number };
  automation: { local: number; cloud: number; merged: number; uploaded: number };
  errors: string[];
};

export type WorkspaceSyncOptions = {
  /** 默认 true。登录时可 false：只拉云端写本机，上传放到后台，避免界面卡在 0 */
  upload?: boolean;
  /** 阶段进度（给按钮旁状态条用） */
  onProgress?: (message: string) => void;
  /** 整次同步硬超时（毫秒），超时返回部分结果并放行队列，默认 6 分钟 */
  timeoutMs?: number;
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

const histStamp = (h: HistoryItem): number =>
  Math.max(Number(h.timestamp) || 0, Number((h as any).updatedAt) || 0, 0);

const isWeakProductType = (s?: string) =>
  !s ||
  !String(s).trim() ||
  /^(n\/?a|公开信息未找到|未知|待补充|global|-)$/i.test(String(s).trim());

export const mergeClientsById = (local: Client[], cloud: Client[]): Client[] => {
  const map = new Map<string, Client>();
  for (const c of [...cloud, ...local]) {
    if (!c?.id) continue;
    const prev = map.get(c.id);
    if (!prev) {
      map.set(c.id, c);
      continue;
    }
    const preferLocal = clientStamp(c) >= clientStamp(prev);
    const a = preferLocal ? c : prev;
    const b = preferLocal ? prev : c;
    // 品类字段：勿让「公开信息未找到」盖掉另一端已采到的品类
    const productType =
      !isWeakProductType(a.productType)
        ? a.productType
        : !isWeakProductType(b.productType)
          ? b.productType
          : a.productType || b.productType;
    map.set(c.id, {
      ...b,
      ...a,
      productType,
      // 归属：保留已有拥有人，避免后登录端把自己写成拥有人盖掉同事
      ownerUsername: (a.ownerUsername || '').trim() || (b.ownerUsername || '').trim() || undefined,
      departmentId: (a.departmentId || '').trim() || (b.departmentId || '').trim() || undefined,
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

export const mergeHistoryById = (local: HistoryItem[], cloud: HistoryItem[]): HistoryItem[] =>
  // 与登录路径一致：品类深挖与决策人深挖字段级合并，避免跨端互相盖掉
  mergeHistoryPreferDmRich(local, cloud);

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
export const uploadCrmChunked = async (
  clients: Client[],
  onProgress?: (done: number, total: number) => void
): Promise<number> => {
  if (!clients.length) return 0;
  let n = 0;
  for (const part of chunk(clients, 100)) {
    const ok = await saveCrmClientsBulk(part);
    if (!ok) throw new Error('CRM 分块上传失败');
    n += part.length;
    onProgress?.(n, clients.length);
  }
  return n;
};

/** 分块批量上传背调历史（比逐条 upsert 快一个数量级） */
export const uploadHistoryChunked = async (
  items: HistoryItem[],
  onProgress?: (done: number, total: number) => void
): Promise<number> => {
  if (!items.length) return 0;
  if (!isSupabaseConfigured()) return 0;
  const client = getSupabaseClient();
  const uid = getCloudWorkspaceId();
  let n = 0;
  for (const part of chunk(items, 20)) {
    const rows = part.map((item) => ({
      user_id: uid,
      local_id: item.id,
      domain: item.domain || '',
      module_type: item.type,
      report_data: item,
    }));
    const { error } = await client.from('investigation_history').upsert(rows, {
      onConflict: 'user_id,local_id',
    });
    if (error) throw error;
    n += part.length;
    onProgress?.(n, items.length);
  }
  return n;
};

const emptyBucket = () => ({ local: 0, cloud: 0, merged: 0, uploaded: 0 });

const emptyReport = (errors: string[]): WorkspaceSyncReport => ({
  ok: false,
  crm: emptyBucket(),
  history: emptyBucket(),
  profiles: emptyBucket(),
  automation: emptyBucket(),
  errors,
});

/** 同页串行队列，避免登录「先拉后推」与手动同步叠成写风暴；不丢任何一次 upload */
let syncChain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_SYNC_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * 全量同步：合并本机与云端，先写回本机，再按需推上云端。
 * 硬规则：本函数路径上绝不调用任何云端 delete；本机为空时只拉取，不覆盖云端。
 * 禁止用「空合并结果」覆盖本机已有数据（云端拉取失败时尤甚）。
 */
export const syncAllWorkspaceData = async (
  opts?: WorkspaceSyncOptions
): Promise<WorkspaceSyncReport> => {
  const wantUpload = opts?.upload !== false;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const onProgress = opts?.onProgress;

  const run = async (): Promise<WorkspaceSyncReport> => {
    if (wantUpload) {
      // 轻微错峰即可，勿再随机等到近 2 秒（手动同步会像「没反应」）
      await sleep(80 + Math.floor(Math.random() * 120));
    }
    let aborted = false;
    const timer = window.setTimeout(() => {
      aborted = true;
      onProgress?.(`同步超时（>${Math.round(timeoutMs / 1000)}s），已停止后续上传`);
    }, timeoutMs);

    try {
      return await runSyncAllWorkspaceData({
        upload: wantUpload,
        onProgress,
        shouldAbort: () => aborted,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      onProgress?.(`同步中断：${msg}`);
      return emptyReport([msg]);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const p = syncChain.then(run, run) as Promise<WorkspaceSyncReport>;
  syncChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
};

const runSyncAllWorkspaceData = async (
  opts?: WorkspaceSyncOptions & { shouldAbort?: () => boolean }
): Promise<WorkspaceSyncReport> => {
  const doUpload = opts?.upload !== false;
  const onProgress = opts?.onProgress;
  const check = () => {
    if (opts?.shouldAbort?.()) {
      throw new Error('同步超时或已取消');
    }
  };
  const errors: string[] = [];
  const report: WorkspaceSyncReport = {
    ok: true,
    crm: emptyBucket(),
    history: emptyBucket(),
    profiles: emptyBucket(),
    automation: emptyBucket(),
    errors,
  };

  if (!isSupabaseConfigured()) {
    errors.push('云端未配置（Supabase）');
    report.ok = false;
    return report;
  }

  // —— CRM ——
  try {
    check();
    onProgress?.('同步中：拉取 CRM…');
    const localCrm = loadAllCrmClients();
    let cloudCrm: Client[] = [];
    let cloudOk = false;
    try {
      cloudCrm = await getCrmClients();
      cloudOk = true;
    } catch (e: any) {
      errors.push(`CRM 云端拉取：${e?.message || String(e)}`);
    }
    check();
    onProgress?.(`同步中：合并 CRM（本机 ${localCrm.length} / 云 ${cloudCrm.length}）…`);
    let mergedCrm = mergeClientsById(localCrm, cloudCrm);
    try {
      const { mergeCrmClientsByDomain } = await import('../utils/crmHistory');
      const domainMerged = mergeCrmClientsByDomain(mergedCrm);
      if (domainMerged.removedCount > 0) {
        console.info(
          `[workspace-sync] CRM domain dedupe: groups=${domainMerged.mergedGroups} removed=${domainMerged.removedCount}`
        );
        mergedCrm = domainMerged.clients;
        try {
          const { remapEmailTaskClientIds } = await import('./emailCampaignStore');
          remapEmailTaskClientIds(domainMerged.remaps);
        } catch {
          /* ignore */
        }
        const loserIds = Object.keys(domainMerged.remaps);
        if (loserIds.length) {
          const { deleteCrmClient } = await import('./supabase');
          await Promise.all(loserIds.map((id) => deleteCrmClient(id).catch(() => false)));
        }
      }
    } catch (e) {
      console.warn('[workspace-sync] CRM domain dedupe skipped', e);
    }
    if (mergedCrm.length > 0) {
      const cleared = reconcileCrmTombstonesWithLiveClients(mergedCrm);
      if (cleared > 0) {
        console.info(`[workspace-sync] cleared ${cleared} stale CRM tombstones after union merge`);
      }
      saveAllCrmClients(mergedCrm);
    } else if (localCrm.length > 0) {
      errors.push('CRM：合并结果为空，已保留本机数据');
    } else if (!cloudOk) {
      errors.push('CRM：云端不可用且本机为空');
    }
    let uploaded = 0;
    if (doUpload && mergedCrm.length > 0) {
      check();
      // 仅上传相对云端更新过的，避免每次全量重传卡死
      const cloudById = new Map(cloudCrm.map((c) => [c.id, c]));
      const dirty = !cloudOk
        ? mergedCrm
        : mergedCrm.filter((c) => {
            const prev = cloudById.get(c.id);
            if (!prev) return true;
            return clientStamp(c) > clientStamp(prev);
          });
      onProgress?.(`同步中：上传 CRM 0/${dirty.length}…`);
      uploaded = await uploadCrmChunked(dirty, (done, total) => {
        onProgress?.(`同步中：上传 CRM ${done}/${total}…`);
        check();
      });
    }
    report.crm = {
      local: localCrm.length,
      cloud: cloudCrm.length,
      merged: mergedCrm.length || localCrm.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`CRM：${e?.message || String(e)}`);
  }

  // —— 背调历史 ——
  try {
    check();
    onProgress?.('同步中：拉取背调历史…');
    const localHist = await getHistory();
    let cloudHist: HistoryItem[] = [];
    let cloudHistOk = false;
    try {
      cloudHist = await getInvestigationHistory();
      cloudHistOk = true;
    } catch (e: any) {
      errors.push(`背调历史云端拉取：${e?.message || String(e)}`);
    }
    check();
    onProgress?.(
      `同步中：合并背调历史（本机 ${localHist.length} / 云 ${cloudHist.length}）…`
    );
    const mergedHist = mergeHistoryById(localHist, cloudHist);
    if (mergedHist.length > 0) {
      await saveHistoryBulk(mergedHist);
    } else if (localHist.length > 0) {
      errors.push('背调历史：合并结果为空，已保留本机数据');
    }
    let uploaded = 0;
    if (doUpload && mergedHist.length > 0) {
      check();
      const cloudById = new Map(cloudHist.map((h) => [h.id, h]));
      const dirty = !cloudHistOk
        ? mergedHist
        : mergedHist.filter((h) => {
            const prev = cloudById.get(h.id);
            if (!prev) return true;
            return histStamp(h) > histStamp(prev);
          });
      onProgress?.(`同步中：上传背调历史 0/${dirty.length}…`);
      uploaded = await uploadHistoryChunked(dirty, (done, total) => {
        onProgress?.(`同步中：上传背调历史 ${done}/${total}…`);
        check();
      });
    }
    report.history = {
      local: localHist.length,
      cloud: cloudHist.length,
      merged: mergedHist.length || localHist.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`背调历史：${e?.message || String(e)}`);
  }

  // —— 产品画像 ——
  try {
    check();
    onProgress?.('同步中：产品画像…');
    const localProfiles = await loadProductCatalog();
    let cloudProfiles: CustomerProductProfile[] = [];
    try {
      cloudProfiles = await getProductProfilesCloud();
    } catch (e: any) {
      errors.push(`产品画像云端拉取：${e?.message || String(e)}`);
    }
    const mergedProfiles = mergeProfilesById(localProfiles, cloudProfiles);
    if (mergedProfiles.length) await saveProductProfilesBulk(mergedProfiles);
    let uploaded = 0;
    if (doUpload && mergedProfiles.length) {
      check();
      onProgress?.(`同步中：上传产品画像 ${mergedProfiles.length}…`);
      uploaded = await syncProductProfilesCloud(mergedProfiles);
      if (!uploaded) {
        for (const p of mergedProfiles) {
          check();
          if (await saveProductProfileCloud(p)) uploaded += 1;
        }
      }
    }
    report.profiles = {
      local: localProfiles.length,
      cloud: cloudProfiles.length,
      merged: mergedProfiles.length || localProfiles.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`产品画像：${e?.message || String(e)}`);
  }

  // —— 背调作业队列 ——
  try {
    check();
    onProgress?.('同步中：背调作业队列…');
    const synced = await pullMergePushAutomationQueue({
      upload: doUpload,
      onProgress: (msg) => {
        onProgress?.(msg);
        check();
      },
    });
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
  onProgress?.(
    report.ok
      ? `同步完成 · CRM ${report.crm.merged} · 作业 ${report.automation.merged}`
      : `同步结束（有问题 ${errors.length}）· CRM ${report.crm.merged} · 作业 ${report.automation.merged}`
  );
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
