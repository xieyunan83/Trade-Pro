import type { Client, DiscoveryArchiveItem, DiscoveryState, User } from '../types';
import { canViewOwnedRecord, type OwnedRecordMeta } from '../services/permissions';
import type { Department } from '../types';
import { splitCrmClientsByCutoff } from './crmHistory';
import { DEFAULT_INDUSTRY_EN } from '../data/industries';

export const emptyDiscoveryState = (): DiscoveryState => ({
  product: '',
  country: '',
  countries: [],
  industry: DEFAULT_INDUSTRY_EN,
  categoryL1: '',
  categoryL2: '',
  clientType: '',
  clientTypes: [],
  results: [],
  hasSearched: false,
  updatedAt: 0,
});

const discoveryStateKey = (username: string) =>
  `trade_scout_discovery_state_v1_${username.trim().toLowerCase()}`;

/** 本机「当前搜索会话」归档 id 前缀（不进记录面板列表） */
export const discoverySessionArchiveId = (username: string) =>
  `__discovery_session__${username.trim().toLowerCase()}`;

export const isDiscoverySessionArchiveId = (id?: string) =>
  !!id && id.startsWith('__discovery_session__');

export const loadUserDiscoveryState = (username: string): DiscoveryState | null => {
  try {
    const raw = localStorage.getItem(discoveryStateKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const industry =
      typeof parsed.industry === 'string' && parsed.industry.trim()
        ? parsed.industry
        : DEFAULT_INDUSTRY_EN;
    return {
      ...emptyDiscoveryState(),
      ...parsed,
      industry,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      countries: Array.isArray(parsed.countries) ? parsed.countries : [],
      clientTypes: Array.isArray(parsed.clientTypes) ? parsed.clientTypes : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
};

const slimDiscoveryResults = (state: DiscoveryState): DiscoveryState => ({
  ...state,
  results: (state.results || []).slice(0, 60).map((r) => ({
    ...r,
    // 截断可能撑爆 localStorage 的超长字段
    description: (r.description || '').slice(0, 400),
    mainProducts: (r.mainProducts || '').slice(0, 300),
    fitReason: (r.fitReason || '').slice(0, 200),
  })),
});

export const saveUserDiscoveryState = (username: string, state: DiscoveryState) => {
  const payload: DiscoveryState = {
    ...state,
    updatedAt: state.updatedAt && state.updatedAt > 0 ? state.updatedAt : Date.now(),
  };
  try {
    localStorage.setItem(discoveryStateKey(username), JSON.stringify(payload));
    return;
  } catch (e) {
    console.warn('[discovery] localStorage full, retry slim', e);
  }
  try {
    localStorage.setItem(discoveryStateKey(username), JSON.stringify(slimDiscoveryResults(payload)));
  } catch (e2) {
    console.warn('[discovery] localStorage save failed', e2);
  }
};

/** 归档 → 当前搜索界面（含 updatedAt，便于与本机会话比较新旧） */
export const archiveToDiscoveryState = (a: DiscoveryArchiveItem): DiscoveryState => ({
  product: a.product || '',
  country: a.country || (a.countries || []).join(', '),
  countries: a.countries || [],
  industry: a.industry?.trim() || DEFAULT_INDUSTRY_EN,
  clientType: a.clientType || (a.clientTypes || []).join(', '),
  clientTypes: a.clientTypes || [],
  results: a.results || [],
  hasSearched: true,
  updatedAt: a.timestamp || Date.now(),
});

/**
 * 登录恢复当前搜索结果：优先本机最新会话，避免用「很久以前的归档」冲掉刚搜完的结果。
 * 注意：不得在水合完成前把归档写回 localStorage。
 */
export const resolveDiscoveryStateOnLogin = (
  username: string,
  archives: DiscoveryArchiveItem[]
): DiscoveryState => {
  const saved = loadUserDiscoveryState(username);
  const sessionId = discoverySessionArchiveId(username);
  const sessionArch =
    archives.find((a) => a.id === sessionId) ||
    archives.find((a) => isDiscoverySessionArchiveId(a.id));
  const latestArch =
    sessionArch ||
    archives.find((a) => !isDiscoverySessionArchiveId(a.id)) ||
    null;

  const savedOk = !!(saved?.hasSearched && (saved.results?.length || 0) > 0);
  const archOk = !!(latestArch && (latestArch.results?.length || 0) > 0);
  const savedAt = saved?.updatedAt || 0;
  const archAt = latestArch?.timestamp || 0;

  if (savedOk && archOk && latestArch) {
    // 归档明显更新（例如他机同步）→ 用归档；否则保留本机会话（通常含多国合并结果）
    if (archAt > savedAt + 3_000) {
      const fromArch = archiveToDiscoveryState(latestArch);
      // 本机结果更多且时间接近时，仍偏本机（防单国归档盖掉多国合并）
      if (
        !isDiscoverySessionArchiveId(latestArch.id) &&
        (saved!.results?.length || 0) > (latestArch.results?.length || 0) &&
        savedAt + 60_000 >= archAt
      ) {
        return saved!;
      }
      return fromArch;
    }
    return saved!;
  }
  if (savedOk && saved) return saved;
  if (archOk && latestArch) return archiveToDiscoveryState(latestArch);
  if (saved) return { ...emptyDiscoveryState(), ...saved, industry: saved.industry || DEFAULT_INDUSTRY_EN };
  return emptyDiscoveryState();
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
 * 回填旧业务数据归属，让「本部门主管」能按部门看到历史记录：
 * - 已有 owner、缺 departmentId → 按用户表补部门
 * - 完全无归属且系统只有 1 个部门 → 归入该部门（并尽量挂到部门主管名下）
 * - 多部门且无归属 → 不改，仅总管/管理员可见
 */
export const migrateLegacyOwnership = <T extends OwnedRecordMeta>(
  items: T[],
  allUsers: User[],
  departments: Department[]
): { items: T[]; changed: boolean } => {
  if (!items.length) return { items, changed: false };

  const byName = new Map(
    allUsers.map((u) => [u.username.trim().toLowerCase(), u] as const)
  );
  const soleDept = departments.length === 1 ? departments[0] : undefined;
  let changed = false;

  const next = items.map((c) => {
    const owner = (c.ownerUsername || '').trim();
    const dept = (c.departmentId || '').trim();
    const patch: Partial<OwnedRecordMeta> = {};

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

  return { items: next, changed };
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
  const { items, changed } = migrateLegacyOwnership(clients, allUsers, departments);
  if (changed) {
    try {
      localStorage.setItem(CRM_ALL_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }
  return { clients: items, changed };
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
  // 防误清空：可见列表为空时，若本机仍有该用户可见数据，不覆盖
  if (!scopedClients.length) {
    const viewable = existing.filter((c) =>
      canViewOwnedRecord(viewer, c, allUsers, departments)
    );
    if (viewable.length > 0) return existing;
  }
  const kept = existing.filter((c) => !canViewOwnedRecord(viewer, c, allUsers, departments));
  const merged = [...scopedClients, ...kept];
  try {
    localStorage.setItem(CRM_ALL_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
};

/** 写入全库 CRM（不过滤部门，用于清理后整库覆盖） */
export const saveAllCrmClients = (clients: Client[]): void => {
  try {
    localStorage.setItem(CRM_ALL_KEY, JSON.stringify(clients));
  } catch {
    /* ignore */
  }
};

/** 从全库 localStorage 删除早于 cutoff 的 CRM 客户（保守规则，返回被删 id 列表） */
export const purgeAllCrmClientsBeforeDate = (
  cutoffMs: number
): { kept: Client[]; removedIds: string[] } => {
  const existing = loadAllCrmClients();
  const { kept, removed } = splitCrmClientsByCutoff(existing, cutoffMs, true);
  const removedIds = removed.map((c) => c.id);
  if (removedIds.length) saveAllCrmClients(kept);
  return { kept, removedIds };
};

/** 对任意 CRM 列表按 cutoff 清理（forPurge=true 保守规则） */
export const purgeCrmListBeforeDate = (
  allClients: Client[],
  cutoffMs: number
): { kept: Client[]; removedIds: string[] } => {
  const { kept, removed } = splitCrmClientsByCutoff(allClients, cutoffMs, true);
  const removedIds = removed.map((c) => c.id);
  if (removedIds.length) saveAllCrmClients(kept);
  return { kept, removedIds };
};

/** 预览将删除多少条（不写库） */
export const previewPurgeCrmBeforeDate = (
  allClients: Client[],
  cutoffMs: number
): { kept: number; removed: number } => {
  const { kept, removed } = splitCrmClientsByCutoff(allClients, cutoffMs, true);
  return { kept: kept.length, removed: removed.length };
};

/** 当前用户是否「拥有」该任务（用于删除/清空时避免删掉别人的队列） */
export const isOwnedByViewer = (
  viewer: User,
  record: OwnedRecordMeta,
  allUsers: User[],
  departments: Department[]
) => canViewOwnedRecord(viewer, record, allUsers, departments);
