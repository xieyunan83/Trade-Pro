/**
 * CRM 删除墓碑：防止登录时从 GitHub / 背调历史把「用户已明确删除」的客户又合并回来。
 *
 * 硬规则：
 * - 仅按 local id 或「规范化网站 host」匹配（禁止仅用公司名匹配，易误伤同名客户）
 * - 墓碑只影响本机展示；不得驱动同步去删云端
 * - 若云端/合并结果里仍有该客户，应清除对应墓碑（跨设备收敛）
 */
import type { Client } from '../types';

const CRM_TOMBSTONE_KEY = 'trade_scout_crm_tombstones_v1';
const MAX_TOMBSTONES = 2000;

export type CrmTombstone = {
  id: string;
  website?: string;
  name?: string;
  deletedAt: number;
};

const normHost = (raw?: string) =>
  (raw || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

export const loadCrmTombstones = (): CrmTombstone[] => {
  try {
    const raw = localStorage.getItem(CRM_TOMBSTONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrmTombstone[]) : [];
  } catch {
    return [];
  }
};

const saveCrmTombstones = (list: CrmTombstone[]) => {
  try {
    const trimmed = list
      .slice()
      .sort((a, b) => b.deletedAt - a.deletedAt)
      .slice(0, MAX_TOMBSTONES);
    localStorage.setItem(CRM_TOMBSTONE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota */
  }
};

export const isCrmClientTombstoned = (
  client: Pick<Client, 'id' | 'website' | 'name'>,
  tombs: CrmTombstone[] = loadCrmTombstones()
): boolean => {
  if (!tombs.length) return false;
  const id = (client.id || '').trim();
  const host = normHost(client.website);
  return tombs.some((t) => {
    if (id && t.id && t.id === id) return true;
    if (host && t.website && normHost(t.website) === host) return true;
    return false;
  });
};

export const filterOutCrmTombstones = <T extends Pick<Client, 'id' | 'website' | 'name'>>(
  clients: T[],
  tombs: CrmTombstone[] = loadCrmTombstones()
): T[] => {
  if (!tombs.length) return clients;
  return clients.filter((c) => !isCrmClientTombstoned(c, tombs));
};

/** 记录删除墓碑（幂等）。仅用户明确删除时调用。 */
export const markCrmClientsDeleted = (
  clients: Array<Pick<Client, 'id' | 'website' | 'name'>>
): void => {
  if (!clients.length) return;
  const tombs = loadCrmTombstones();
  const now = Date.now();
  for (const c of clients) {
    const id = (c.id || '').trim();
    if (!id) continue;
    const host = normHost(c.website);
    for (let i = tombs.length - 1; i >= 0; i--) {
      const t = tombs[i];
      if (t.id === id) tombs.splice(i, 1);
      else if (host && normHost(t.website) === host) tombs.splice(i, 1);
    }
    tombs.push({
      id,
      website: host || undefined,
      name: (c.name || '').trim() || undefined,
      deletedAt: now,
    });
  }
  saveCrmTombstones(tombs);
};

/** 用户主动再导入 CRM 时清除匹配墓碑，允许重新出现 */
export const clearCrmTombstonesForClients = (
  clients: Array<Pick<Client, 'id' | 'website' | 'name'>>
): void => {
  if (!clients.length) return;
  let tombs = loadCrmTombstones();
  if (!tombs.length) return;
  for (const c of clients) {
    const id = (c.id || '').trim();
    const host = normHost(c.website);
    tombs = tombs.filter((t) => {
      if (id && t.id === id) return false;
      if (host && t.website && normHost(t.website) === host) return false;
      return true;
    });
  }
  saveCrmTombstones(tombs);
};

/**
 * 合并/拉取后：若客户仍在「权威列表」中，清掉对应墓碑。
 * 用于修复跨设备误写墓碑导致的条数漂移（不删云端任何行）。
 */
export const reconcileCrmTombstonesWithLiveClients = (
  liveClients: Array<Pick<Client, 'id' | 'website' | 'name'>>
): number => {
  const tombs = loadCrmTombstones();
  if (!tombs.length || !liveClients.length) return 0;
  const ids = new Set(liveClients.map((c) => (c.id || '').trim()).filter(Boolean));
  const hosts = new Set(
    liveClients.map((c) => normHost(c.website)).filter((h) => h.length > 0)
  );
  const next = tombs.filter((t) => {
    if (t.id && ids.has(t.id)) return false;
    if (t.website && hosts.has(normHost(t.website))) return false;
    return true;
  });
  const removed = tombs.length - next.length;
  if (removed > 0) saveCrmTombstones(next);
  return removed;
};
