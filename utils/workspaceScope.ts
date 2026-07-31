import type { Client, DiscoveryState, User } from '../types';
import { canViewOwnedRecord, type OwnedRecordMeta } from '../services/permissions';
import type { Department } from '../types';

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

/** 当前用户是否「拥有」该任务（用于删除/清空时避免删掉别人的队列） */
export const isOwnedByViewer = (
  viewer: User,
  record: OwnedRecordMeta,
  allUsers: User[],
  departments: Department[]
) => canViewOwnedRecord(viewer, record, allUsers, departments);
