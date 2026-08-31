import type { Client, DiscoveryState, User } from '../types';
import { canViewOwnedRecord, type OwnedRecordMeta } from '../services/permissions';
import type { Department } from '../types';
import { isClientRecordBefore } from './crmHistory';

export const emptyDiscoveryState = (): DiscoveryState => ({
  product: '',
  country: '',
  countries: [],
  industry: '',
  clientType: '',
  clientTypes: [],
  results: [],
  hasSearched: false,
});

const discoveryStateKey = (username: string) =>
  `trade_scout_discovery_state_v1_${username.trim().toLowerCase()}`;

export const loadUserDiscoveryState = (username: string): DiscoveryState | null => {
  try {
    const raw = localStorage.getItem(discoveryStateKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...emptyDiscoveryState(),
      ...parsed,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      countries: Array.isArray(parsed.countries) ? parsed.countries : [],
      clientTypes: Array.isArray(parsed.clientTypes) ? parsed.clientTypes : [],
    };
  } catch {
    return null;
  }
};

export const saveUserDiscoveryState = (username: string, state: DiscoveryState) => {
  try {
    localStorage.setItem(discoveryStateKey(username), JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
};

const CRM_ALL_KEY = 'tradeScoutClients';

export const loadAllCrmClients = (): Client[] => {
  try {
    const raw = localStorage.getItem(CRM_ALL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * 回填旧 CRM 归属，让「本部门主管」能按部门看到历史客户：
 * - 已有 owner、缺 departmentId → 按用户表补部门
 * - 完全无归属且系统只有 1 个部门 → 归入该部门（并尽量挂到部门主管名下）
 * - 多部门且无归属 → 不改，仅总管/管理员可见，需在后台指定部门后再给主管看
 */
export const migrateLegacyCrmOwnership = (
  clients: Client[],
  allUsers: User[],
  departments: Department[]
): { clients: Client[]; changed: boolean } => {
  if (!clients.length) return { clients, changed: false };

  const byName = new Map(
    allUsers.map((u) => [u.username.trim().toLowerCase(), u] as const)
  );
  const soleDept = departments.length === 1 ? departments[0] : undefined;
  let changed = false;

  const next = clients.map((c) => {
    const owner = (c.ownerUsername || '').trim();
    const dept = (c.departmentId || '').trim();
    const patch: Partial<Client> = {};

    if (owner) {
      const u = byName.get(owner.toLowerCase());
      if (u?.departmentId && !dept) {
        patch.departmentId = u.departmentId;
      }
    } else if (!dept && soleDept?.id) {
      patch.departmentId = soleDept.id;
      const mgr = (soleDept.managerUsername || '').trim();
      if (mgr) patch.ownerUsername = mgr;
    }

    if (Object.keys(patch).length === 0) return c;
    changed = true;
    return { ...c, ...patch };
  });

  if (changed) {
    try {
      localStorage.setItem(CRM_ALL_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  return { clients: next, changed };
};

/**
 * 合并保存 CRM：只替换当前用户可见的记录，保留其它部门/用户的数据，避免同浏览器串号覆盖。
 */
export const mergeSaveCrmClients = (
  viewer: User,
  scopedClients: Client[],
  allUsers: User[],
  departments: Department[]
): Client[] => {
  const existing = loadAllCrmClients();
  const kept = existing.filter((c) => !canViewOwnedRecord(viewer, c, allUsers, departments));
  const merged = [...scopedClients, ...kept];
  try {
    localStorage.setItem(CRM_ALL_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
};

/** 从全库 localStorage 删除早于 cutoff 的 CRM 客户（返回被删 id 列表） */
export const purgeAllCrmClientsBeforeDate = (
  cutoffMs: number
): { kept: Client[]; removedIds: string[] } => {
  const existing = loadAllCrmClients();
  const kept: Client[] = [];
  const removedIds: string[] = [];
  for (const c of existing) {
    if (isClientRecordBefore(c, cutoffMs)) {
      removedIds.push(c.id);
    } else {
      kept.push(c);
    }
  }
  if (removedIds.length) {
    try {
      localStorage.setItem(CRM_ALL_KEY, JSON.stringify(kept));
    } catch {
      /* ignore */
    }
  }
  return { kept, removedIds };
};

/** 当前用户是否「拥有」该任务（用于删除/清空时避免删掉别人的队列） */
export const isOwnedByViewer = (
  viewer: User,
  record: OwnedRecordMeta,
  allUsers: User[],
  departments: Department[]
) => canViewOwnedRecord(viewer, record, allUsers, departments);
