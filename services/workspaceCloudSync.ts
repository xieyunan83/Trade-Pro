/**
 * 工作区全量云同步：CRM / 背调历史 / 产品画像 / 背调作业队列
 * 登录与「同步全部资料」时：先拉取合并写本机（尽快出界面），再按需推上云端。
 */
import type { Client, CustomerProductProfile, HistoryItem } from '../types';
import { getAutomationQueue, getHistory, saveHistoryBulk, saveProductProfilesBulk } from './db';
import { loadProductCatalog } from './productCatalog';
import {
  getCrmClients,
  getInvestigationHistoryByLocalIds,
  getProductProfilesCloud,
  getSupabaseClient,
  isSupabaseConfigured,
  listInvestigationHistoryCloudMeta,
  saveCrmClientsBulk,
  saveProductProfileCloud,
  syncProductProfilesCloud,
} from './supabase';

/**
 * 单次同步上传/下载上限：禁止一次拉全表大 JSON（6000 条正文必超时）。
 * 索引差量 + 每轮限额，多点几次即可对齐。
 */
const CRM_UPLOAD_CAP_PER_SYNC = 400;
const HISTORY_UPLOAD_CAP_PER_SYNC = 250;
const HISTORY_DOWNLOAD_CAP_PER_SYNC = 400;
const PROFILE_UPLOAD_CAP_PER_SYNC = 300;
const AUTOMATION_UPLOAD_CAP_PER_SYNC = 300;
/** 全量正文拉取易卡死：失败要快失败，把时间留给差量传输 */
const CLOUD_PULL_TIMEOUT_MS = 25_000;
const CLOUD_META_TIMEOUT_MS = 90_000;
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
  /** 单轮同步硬超时（毫秒），默认 8 分钟 */
  timeoutMs?: number;
  /**
   * 仍有差量时自动续传的最大轮数（含首轮）。
   * 手动「同步全部资料」建议 12+，避免用户手点十几次。
   */
  autoContinueRounds?: number;
  /** 多轮合计最长时长（默认约 40 分钟） */
  totalTimeoutMs?: number;
};

/** 是否还有明显差量，值得自动续传 */
export const workspaceSyncNeedsContinue = (r: WorkspaceSyncReport): boolean => {
  const err = (r.errors || []).join('\n');
  if (/请再点同步续传|本轮已下载|云端多出|待传约|保守补种/.test(err)) return true;
  // 云端历史明显多于本机合并结果 → 还要下载
  if (r.history.cloud > 0 && r.history.cloud > r.history.merged + 30) return true;
  // 本机明显多于云端且本轮几乎没传上 → CRM/画像/作业仍可能待传
  if (r.crm.local > r.crm.cloud + 50 && r.crm.uploaded === 0 && /CRM/.test(err)) return true;
  if (r.profiles.local > r.profiles.cloud + 50 && r.profiles.uploaded > 0) return true;
  return false;
};

const mergeSyncReports = (
  acc: WorkspaceSyncReport,
  next: WorkspaceSyncReport,
  round: number
): WorkspaceSyncReport => {
  const sumBucket = (
    a: WorkspaceSyncReport['crm'],
    b: WorkspaceSyncReport['crm']
  ): WorkspaceSyncReport['crm'] => ({
    local: Math.max(a.local, b.local),
    cloud: Math.max(a.cloud, b.cloud),
    merged: Math.max(a.merged, b.merged),
    uploaded: (a.uploaded || 0) + (b.uploaded || 0),
  });
  const errors = [
    ...acc.errors.filter((e) => !/^自动续传/.test(e)),
    ...next.errors,
  ];
  if (round > 1) {
    errors.unshift(`自动续传完成 ${round} 轮（上传/下载条数已累加）`);
  }
  return {
    ok: next.ok && acc.ok,
    crm: sumBucket(acc.crm, next.crm),
    history: sumBucket(acc.history, next.history),
    profiles: sumBucket(acc.profiles, next.profiles),
    automation: sumBucket(acc.automation, next.automation),
    errors: Array.from(new Set(errors)).slice(0, 40),
  };
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

const mergeOneClientPair = (prev: Client | undefined, c: Client): Client => {
  if (!prev) return c;
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
  return {
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
  };
};

export const mergeClientsById = (local: Client[], cloud: Client[]): Client[] => {
  const map = new Map<string, Client>();
  for (const c of [...cloud, ...local]) {
    if (!c?.id) continue;
    map.set(c.id, mergeOneClientPair(map.get(c.id), c));
  }
  return Array.from(map.values());
};

/** 大库合并分片让出主线程，避免登录同步时整页假死 */
export const mergeClientsByIdAsync = async (
  local: Client[],
  cloud: Client[],
  opts?: { shouldAbort?: () => boolean; onProgress?: (message: string) => void }
): Promise<Client[]> => {
  const all = [...cloud, ...local];
  if (all.length <= 400) return mergeClientsById(local, cloud);
  const map = new Map<string, Client>();
  const slice = 250;
  for (let i = 0; i < all.length; i += slice) {
    if (opts?.shouldAbort?.()) throw new Error('同步超时或已取消');
    await pauseIfUserBusy(opts?.shouldAbort);
    const end = Math.min(i + slice, all.length);
    for (let j = i; j < end; j++) {
      const c = all[j];
      if (!c?.id) continue;
      map.set(c.id, mergeOneClientPair(map.get(c.id), c));
    }
    opts?.onProgress?.(
      `同步中：合并 CRM ${Math.min(end, all.length)}/${all.length}…`
    );
    await yieldToUi();
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
  onProgress?: (done: number, total: number) => void | Promise<void>
): Promise<number> => {
  if (!clients.length) return 0;
  let n = 0;
  for (const part of chunk(clients, 100)) {
    const ok = await saveCrmClientsBulk(part);
    if (!ok) throw new Error('CRM 分块上传失败');
    n += part.length;
    await onProgress?.(n, clients.length);
  }
  return n;
};

/** 分块批量上传背调历史（比逐条 upsert 快一个数量级） */
export const uploadHistoryChunked = async (
  items: HistoryItem[],
  onProgress?: (done: number, total: number) => void | Promise<void>
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
    await onProgress?.(n, items.length);
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

const cloneReport = (r: WorkspaceSyncReport): WorkspaceSyncReport => ({
  ok: r.ok,
  crm: { ...r.crm },
  history: { ...r.history },
  profiles: { ...r.profiles },
  automation: { ...r.automation },
  errors: [...r.errors],
});

/** 带超时的 Promise：超时抛错，不取消底层请求（仅放行同步流程） */
const withTimeout = async <T,>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}超时（>${Math.round(ms / 1000)}秒）`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** 超时弹窗用：优先内存快照（与界面条数一致），避免 IDB 忙时读成 0 吓人 */
const snapshotLocalCounts = async (): Promise<WorkspaceSyncReport> => {
  let localCrm = 0;
  let localHist = 0;
  let localProfiles = 0;
  let localAuto = 0;
  try {
    localCrm = loadAllCrmClients().length;
  } catch {
    /* ignore */
  }
  try {
    const { getAutomationQueueSnapshot } = await import('./automationQueueStore');
    localAuto = getAutomationQueueSnapshot().length;
  } catch {
    /* ignore */
  }
  try {
    localHist = await withTimeout(getHistory().then((h) => h.length), 8_000, '本机背调历史计数');
  } catch {
    /* ignore */
  }
  try {
    localProfiles = await withTimeout(
      loadProductCatalog().then((p) => p.length),
      8_000,
      '本机产品画像计数'
    );
  } catch {
    /* ignore */
  }
  if (!localAuto) {
    try {
      localAuto = await withTimeout(
        getAutomationQueue().then((t) => t.length),
        8_000,
        '本机作业队列计数'
      );
    } catch {
      /* ignore */
    }
  }
  return {
    ok: false,
    crm: { local: localCrm, cloud: 0, merged: localCrm, uploaded: 0 },
    history: { local: localHist, cloud: 0, merged: localHist, uploaded: 0 },
    profiles: { local: localProfiles, cloud: 0, merged: localProfiles, uploaded: 0 },
    automation: { local: localAuto, cloud: 0, merged: localAuto, uploaded: 0 },
    errors: [],
  };
};

const mergeTimeoutReport = (
  live: WorkspaceSyncReport,
  localSnap: WorkspaceSyncReport,
  timeoutMsg: string
): WorkspaceSyncReport => {
  const pick = (
    a: WorkspaceSyncReport['crm'],
    b: WorkspaceSyncReport['crm']
  ): WorkspaceSyncReport['crm'] => ({
    local: Math.max(a.local || 0, b.local || 0),
    cloud: Math.max(a.cloud || 0, b.cloud || 0),
    merged: Math.max(a.merged || 0, b.merged || 0),
    // 上传以 live 为准（快照恒为 0）
    uploaded: Math.max(a.uploaded || 0, b.uploaded || 0),
  });
  return {
    ok: false,
    crm: pick(live.crm, localSnap.crm),
    history: pick(live.history, localSnap.history),
    profiles: pick(live.profiles, localSnap.profiles),
    automation: pick(live.automation, localSnap.automation),
    errors: [timeoutMsg, ...live.errors.filter((e) => e !== timeoutMsg)],
  };
};

/** 同页串行队列，避免登录「先拉后推」与手动同步叠成写风暴；不丢任何一次 upload */
let syncChain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });

/** 用户正在点选/打字时，同步略停；上限约 12s，禁止再空等到吃光整轮超时 */
const pauseIfUserBusy = async (shouldAbort?: () => boolean) => {
  try {
    const { shouldDeferHeavyWork } = await import('./foregroundGuard');
    let spins = 0;
    while (shouldDeferHeavyWork()) {
      if (shouldAbort?.()) throw new Error('同步超时或已取消');
      await sleep(200);
      spins += 1;
      if (spins > 60) break;
    }
  } catch (e: any) {
    if (/超时|取消/.test(String(e?.message || e))) throw e;
  }
  await yieldToUi();
};

const DEFAULT_SYNC_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_TOTAL_TIMEOUT_MS = 40 * 60 * 1000;

/**
 * 全量同步：合并本机与云端，先写回本机，再按需推上云端。
 * 硬规则：本函数路径上绝不调用任何云端 delete；本机为空时只拉取，不覆盖云端。
 * 禁止用「空合并结果」覆盖本机已有数据（云端拉取失败时尤甚）。
 * 支持 autoContinueRounds：有差量时自动多轮续传，免手点。
 */
export const syncAllWorkspaceData = async (
  opts?: WorkspaceSyncOptions
): Promise<WorkspaceSyncReport> => {
  const wantUpload = opts?.upload !== false;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const onProgress = opts?.onProgress;
  const maxRounds = Math.max(1, Math.min(30, opts?.autoContinueRounds ?? 1));
  const totalTimeoutMs = opts?.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;

  const runOneRound = async (round: number): Promise<WorkspaceSyncReport> => {
    if (wantUpload) {
      await sleep(80 + Math.floor(Math.random() * 120));
    }
    let aborted = false;
    const secs = Math.round(timeoutMs / 1000);
    const timeoutMsg =
      maxRounds > 1
        ? `本轮同步超时（>${secs}秒）。已传部分保留，将自动续传…`
        : `同步已超时停止（>${secs}秒）。已上传的部分仍保留，再点一次可继续传剩余`;
    const live = emptyReport([]);

    const finalize = async (partial: WorkspaceSyncReport, msg: string) => {
      const snap = await snapshotLocalCounts();
      return mergeTimeoutReport(partial, snap, msg);
    };

    const work = (async (): Promise<WorkspaceSyncReport> => {
      try {
        const r = await runSyncAllWorkspaceData({
          upload: wantUpload,
          onProgress: (msg) => {
            onProgress?.(maxRounds > 1 ? `[第${round}轮] ${msg}` : msg);
          },
          shouldAbort: () => aborted,
          liveReport: live,
        });
        if (aborted || r.errors.some((e) => /超时|取消/.test(e))) {
          onProgress?.(timeoutMsg);
          return finalize(cloneReport(live), timeoutMsg);
        }
        return r;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (aborted || /超时|取消/.test(msg)) {
          onProgress?.(timeoutMsg);
          return finalize(cloneReport(live), timeoutMsg);
        }
        onProgress?.(`同步中断：${msg}`);
        return finalize(cloneReport(live), msg);
      }
    })();

    const timeoutGate = new Promise<WorkspaceSyncReport>((resolve) => {
      window.setTimeout(() => {
        aborted = true;
        onProgress?.(timeoutMsg);
        void finalize(cloneReport(live), timeoutMsg).then(resolve);
      }, timeoutMs);
    });

    return Promise.race([work, timeoutGate]);
  };

  const run = async (): Promise<WorkspaceSyncReport> => {
    const started = Date.now();
    let acc = await runOneRound(1);
    let round = 1;
    let last = acc;
    while (
      round < maxRounds &&
      workspaceSyncNeedsContinue(last) &&
      Date.now() - started < totalTimeoutMs
    ) {
      round += 1;
      onProgress?.(
        `自动续传第 ${round}/${maxRounds} 轮（无需再点同步）…`
      );
      await sleep(400);
      last = await runOneRound(round);
      acc = mergeSyncReports(acc, last, round);
    }
    if (round > 1 && workspaceSyncNeedsContinue(last)) {
      acc.errors.push(
        `已自动续传 ${round} 轮仍有剩余差量；可再点一次「同步全部资料」继续（仍会自动多轮）`
      );
      acc.ok = false;
    } else if (round > 1 && !workspaceSyncNeedsContinue(last)) {
      acc.ok = true;
      onProgress?.(`同步对齐完成（共 ${round} 轮）`);
    }
    return acc;
  };

  const p = syncChain.then(run, run) as Promise<WorkspaceSyncReport>;
  syncChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
};

const runSyncAllWorkspaceData = async (
  opts?: WorkspaceSyncOptions & {
    shouldAbort?: () => boolean;
    /** 与外层共享，超时弹窗可读到已完成阶段的条数 */
    liveReport?: WorkspaceSyncReport;
  }
): Promise<WorkspaceSyncReport> => {
  const doUpload = opts?.upload !== false;
  const onProgress = opts?.onProgress;
  const check = () => {
    if (opts?.shouldAbort?.()) {
      throw new Error('同步超时或已取消');
    }
  };
  const errors: string[] = [];
  const report: WorkspaceSyncReport = opts?.liveReport || {
    ok: true,
    crm: emptyBucket(),
    history: emptyBucket(),
    profiles: emptyBucket(),
    automation: emptyBucket(),
    errors,
  };
  report.ok = true;
  report.errors = errors;

  if (!isSupabaseConfigured()) {
    errors.push('云端未配置（Supabase）');
    report.ok = false;
    return report;
  }

  // 一进来先钉本机条数（CRM 同步读、作业内存快照），超时弹窗绝不靠猜
  try {
    const localCrmN = loadAllCrmClients().length;
    report.crm = { local: localCrmN, cloud: 0, merged: localCrmN, uploaded: 0 };
  } catch {
    /* ignore */
  }
  try {
    const { getAutomationQueueSnapshot } = await import('./automationQueueStore');
    const n = getAutomationQueueSnapshot().length;
    report.automation = { local: n, cloud: 0, merged: n, uploaded: 0 };
  } catch {
    /* ignore */
  }

  // —— 背调历史（最先：只走索引差量，禁止全表正文）——
  try {
    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    onProgress?.('同步中：读取本机背调历史…');
    const localHist = await getHistory();
    report.history = {
      local: localHist.length,
      cloud: 0,
      merged: localHist.length,
      uploaded: 0,
    };

    let cloudMeta: { id: string; stamp: number }[] = [];
    let cloudMetaOk = false;
    try {
      onProgress?.(`同步中：拉取云端背调索引（本机 ${localHist.length}）…`);
      cloudMeta = await withTimeout(
        listInvestigationHistoryCloudMeta(),
        CLOUD_META_TIMEOUT_MS,
        '背调历史云端索引'
      );
      cloudMetaOk = true;
      report.history.cloud = cloudMeta.length;
    } catch (e: any) {
      errors.push(`背调历史云端索引：${e?.message || String(e)}`);
    }

    const localById = new Map(localHist.filter((h) => h?.id).map((h) => [h.id, h]));
    const cloudIds = new Set(cloudMeta.map((m) => m.id));

    // 云有本无：按 id 限额下载（Mac 常见：云 6000+ / 本机更少）
    let downloaded = 0;
    let cloudPartial: HistoryItem[] = [];
    if (cloudMetaOk) {
      const missingLocal = cloudMeta
        .filter((m) => m.id && !localById.has(m.id))
        .sort((a, b) => (b.stamp || 0) - (a.stamp || 0));
      const pendingDown = missingLocal.length;
      const toFetch = missingLocal.slice(0, HISTORY_DOWNLOAD_CAP_PER_SYNC).map((m) => m.id);
      if (toFetch.length) {
        check();
        onProgress?.(
          `同步中：下载背调历史 0/${toFetch.length}${
            pendingDown > toFetch.length ? `（云端多出约 ${pendingDown}）` : ''
          }…`
        );
        try {
          cloudPartial = await getInvestigationHistoryByLocalIds(toFetch, {
            shouldAbort: opts?.shouldAbort,
            onProgress: (done, total) => {
              onProgress?.(`同步中：下载背调历史 ${done}/${total}…`);
              check();
            },
          });
          downloaded = cloudPartial.length;
          if (pendingDown > downloaded) {
            errors.push(
              `背调历史云端多出约 ${pendingDown} 条，本轮已下载 ${downloaded}，请再点同步续传`
            );
          }
        } catch (e: any) {
          errors.push(`背调历史差量下载：${e?.message || String(e)}`);
        }
      }
    }

    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    const mergedHist = cloudPartial.length
      ? mergeHistoryById(localHist, cloudPartial)
      : localHist;
    await yieldToUi();
    if (cloudPartial.length && mergedHist.length > 0) {
      await pauseIfUserBusy(opts?.shouldAbort);
      await saveHistoryBulk(mergedHist);
    }
    onProgress?.(
      `同步中：合并背调历史（本机 ${localHist.length} / 云 ${report.history.cloud} / 本轮下载 ${downloaded}）…`
    );

    let uploaded = 0;
    if (doUpload && mergedHist.length > 0) {
      check();
      await pauseIfUserBusy(opts?.shouldAbort);
      let dirty: HistoryItem[] = [];
      if (cloudMetaOk) {
        // 索引无 updated_at：只补「云端没有的 id」，避免误全量重传
        dirty = mergedHist.filter((h) => h?.id && !cloudIds.has(h.id));
      } else {
        dirty = mergedHist.slice();
        errors.push('背调历史云端索引不可用，本轮按限额补传本机历史；请再点同步续传');
      }

      const pending = dirty.length;
      dirty = dirty
        .slice()
        .sort((a, b) => histStamp(b) - histStamp(a))
        .slice(0, HISTORY_UPLOAD_CAP_PER_SYNC);

      if (dirty.length) {
        onProgress?.(
          `同步中：上传背调历史 0/${dirty.length}${
            pending > dirty.length ? `（共待传 ${pending}）` : ''
          }…`
        );
        uploaded = await uploadHistoryChunked(dirty, async (done, total) => {
          onProgress?.(`同步中：上传背调历史 ${done}/${total}…`);
          check();
          await pauseIfUserBusy(opts?.shouldAbort);
        });
        if (pending > uploaded) {
          errors.push(
            `背调历史待传约 ${pending} 条，本轮已传 ${uploaded}，请再点同步续传`
          );
        }
      } else if (cloudMetaOk && downloaded === 0) {
        onProgress?.('同步中：背调历史无需上传（云端已覆盖本机 id）…');
      }
    }
    if (downloaded > 0) {
      errors.push(`背调历史本轮从云端下载 ${downloaded} 条到本机`);
    }
    report.history = {
      local: localHist.length,
      cloud: report.history.cloud,
      merged: mergedHist.length || localHist.length,
      uploaded,
    };
  } catch (e: any) {
    errors.push(`背调历史：${e?.message || String(e)}`);
  }

  // —— 产品画像（仅脏数据 + 限额，禁止每轮 4000+ 全量）——
  try {
    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    onProgress?.('同步中：读取本机产品画像…');
    const localProfiles = await loadProductCatalog();
    report.profiles = {
      local: localProfiles.length,
      cloud: 0,
      merged: localProfiles.length,
      uploaded: 0,
    };
    onProgress?.(`同步中：拉取云端产品画像（本机已有 ${localProfiles.length}）…`);
    let cloudProfiles: CustomerProductProfile[] = [];
    let cloudProfilesOk = false;
    try {
      cloudProfiles = await withTimeout(
        getProductProfilesCloud(),
        CLOUD_PULL_TIMEOUT_MS,
        '产品画像云端拉取'
      );
      cloudProfilesOk = true;
    } catch (e: any) {
      errors.push(`产品画像云端拉取：${e?.message || String(e)}`);
    }
    const mergedProfiles = mergeProfilesById(localProfiles, cloudProfiles);
    if (mergedProfiles.length) await saveProductProfilesBulk(mergedProfiles);
    let uploaded = 0;
    if (doUpload && mergedProfiles.length) {
      check();
      const cloudById = new Map(cloudProfiles.map((p) => [p.id, p]));
      const profileStamp = (p: CustomerProductProfile) =>
        Math.max(Number((p as any).updatedAt) || 0, Number((p as any).createdAt) || 0, 0);
      let dirty = !cloudProfilesOk
        ? mergedProfiles.slice()
        : mergedProfiles.filter((p) => {
            const prev = cloudById.get(p.id);
            if (!prev) return true;
            return profileStamp(p) > profileStamp(prev);
          });
      const pending = dirty.length;
      const profileCap = !cloudProfilesOk
        ? Math.min(PROFILE_UPLOAD_CAP_PER_SYNC, 100)
        : PROFILE_UPLOAD_CAP_PER_SYNC;
      dirty = dirty
        .slice()
        .sort((a, b) => profileStamp(b) - profileStamp(a))
        .slice(0, profileCap);
      if (!cloudProfilesOk && pending > 0) {
        errors.push(
          `产品画像云拉失败，本轮保守补种 ${dirty.length}/${pending} 条，请再点同步续传`
        );
      }
      onProgress?.(
        `同步中：上传产品画像 0/${dirty.length}${
          pending > dirty.length ? `（共待传 ${pending}）` : ''
        }…`
      );
      uploaded = await syncProductProfilesCloud(dirty);
      if (!uploaded && dirty.length) {
        for (const p of dirty) {
          check();
          if (await saveProductProfileCloud(p)) uploaded += 1;
        }
      }
      if (pending > uploaded) {
        errors.push(
          `产品画像待传约 ${pending} 条，本轮已传 ${uploaded}，请再点同步续传`
        );
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

  // —— CRM（历史/画像之后：云拉易卡，失败本轮不盲传全量）——
  try {
    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    onProgress?.('同步中：读取本机 CRM…');
    const localCrm = loadAllCrmClients();
    report.crm = { local: localCrm.length, cloud: 0, merged: localCrm.length, uploaded: 0 };
    onProgress?.(`同步中：拉取云端 CRM（本机已有 ${localCrm.length}）…`);
    let cloudCrm: Client[] = [];
    let cloudOk = false;
    try {
      cloudCrm = await withTimeout(
        getCrmClients(),
        CLOUD_PULL_TIMEOUT_MS,
        'CRM 云端拉取'
      );
      cloudOk = true;
    } catch (e: any) {
      errors.push(`CRM 云端拉取：${e?.message || String(e)}`);
    }
    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    onProgress?.(`同步中：合并 CRM（本机 ${localCrm.length} / 云 ${cloudCrm.length}）…`);
    let mergedCrm = await mergeClientsByIdAsync(localCrm, cloudCrm, {
      shouldAbort: opts?.shouldAbort,
      onProgress,
    });
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
        // 同步路径禁止删云端 CRM（delete 默认 source=user 会真删）
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
      await pauseIfUserBusy(opts?.shouldAbort);
      const cloudById = new Map(cloudCrm.map((c) => [c.id, c]));
      // 云拉失败时仍限额补种，否则 CRM 云端会永远 0
      let dirty = !cloudOk
        ? mergedCrm.slice()
        : mergedCrm.filter((c) => {
            const prev = cloudById.get(c.id);
            if (!prev) return true;
            return clientStamp(c) > clientStamp(prev);
          });
      dirty = dirty.slice().sort((a, b) => clientStamp(b) - clientStamp(a));
      const pendingCrm = dirty.length;
      const cap = !cloudOk
        ? Math.min(CRM_UPLOAD_CAP_PER_SYNC, 150)
        : CRM_UPLOAD_CAP_PER_SYNC;
      if (pendingCrm > cap) {
        dirty = dirty.slice(0, cap);
        errors.push(
          `CRM 待传约 ${pendingCrm} 条，本轮限 ${cap} 条${
            !cloudOk ? '（云拉失败，保守补种）' : ''
          }，请再点同步续传`
        );
      }
      if (dirty.length) {
        onProgress?.(
          `同步中：上传 CRM 0/${dirty.length}${
            pendingCrm > dirty.length ? `（共待传 ${pendingCrm}）` : ''
          }…`
        );
        uploaded = await uploadCrmChunked(dirty, async (done, total) => {
          onProgress?.(`同步中：上传 CRM ${done}/${total}…`);
          check();
          await pauseIfUserBusy(opts?.shouldAbort);
        });
      }
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

  // —— 背调作业队列（最后 + 限额：不再每轮刷几千条占满超时）——
  try {
    check();
    await pauseIfUserBusy(opts?.shouldAbort);
    onProgress?.('同步中：读取本机背调作业…');
    const localAutoN = (await getAutomationQueue()).length;
    report.automation = {
      local: localAutoN,
      cloud: 0,
      merged: localAutoN,
      uploaded: 0,
    };
    onProgress?.(`同步中：合并/上传背调作业（本机已有 ${localAutoN}）…`);
    const synced = await pullMergePushAutomationQueue({
      upload: doUpload,
      uploadCap: AUTOMATION_UPLOAD_CAP_PER_SYNC,
      shouldAbort: opts?.shouldAbort,
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
