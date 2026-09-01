/**
 * CRM 删除墓碑：防止登录时从 GitHub / Supabase / 背调历史把已删客户又合并回来。
 * 按 local id + 网址 + 公司名匹配。
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

const normName = (raw?: string) => (raw || '').trim().toLowerCase();

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
  const name = normName(client.name);
  return tombs.some((t) => {
    if (id && t.id && t.id === id) return true;
    if (host && t.website && normHost(t.website) === host) return true;
    if (name && t.name && normName(t.name) === name && name.length >= 2) return true;
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

/** 记录删除墓碑（幂等） */
export const markCrmClientsDeleted = (
  clients: Array<Pick<Client, 'id' | 'website' | 'name'>>
): void => {
  if (!clients.length) return;
  const tombs = loadCrmTombstones();
  const now = Date.now();
  for (const c of clients) {
    const id = (c.id || '').trim();
    if (!id) continue;
    // 去掉同 id / 同网站旧墓碑，再写入
    for (let i = tombs.length - 1; i >= 0; i--) {
      const t = tombs[i];
      if (t.id === id) tombs.splice(i, 1);
      else if (normHost(c.website) && normHost(t.website) === normHost(c.website)) tombs.splice(i, 1);
    }
    tombs.push({
      id,
      website: normHost(c.website) || undefined,
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
    const name = normName(c.name);
    tombs = tombs.filter((t) => {
      if (id && t.id === id) return false;
      if (host && t.website && normHost(t.website) === host) return false;
      if (name && t.name && normName(t.name) === name) return false;
      return true;
    });
  }
  saveCrmTombstones(tombs);
};
