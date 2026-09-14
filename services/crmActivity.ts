/**
 * CRM 活动时间线：在保留 activityLog 字符串兼容的同时，结构化追加事件。
 */
import type { Client } from '../types';

export type CrmActivityKind =
  | 'note'
  | 'email_sent'
  | 'mail_group'
  | 'background_check'
  | 'dm_search'
  | 'sample'
  | 'status_change'
  | 'import';

export interface CrmActivityEvent {
  id: string;
  at: number;
  kind: CrmActivityKind;
  summary: string;
  detail?: string;
  by?: string;
}

const EVENTS_KEY = '__activityEvents';

/** 从 Client 读取结构化事件（存在 client 扩展字段或 JSON 前缀） */
export const getClientActivityEvents = (client: Client): CrmActivityEvent[] => {
  const anyClient = client as Client & { activityEvents?: CrmActivityEvent[] };
  if (Array.isArray(anyClient.activityEvents)) return anyClient.activityEvents;
  return [];
};

export const appendClientActivity = (
  client: Client,
  event: Omit<CrmActivityEvent, 'id' | 'at'> & { at?: number; id?: string }
): Client => {
  const prev = getClientActivityEvents(client);
  const nextEvent: CrmActivityEvent = {
    id: event.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: event.at || Date.now(),
    kind: event.kind,
    summary: event.summary,
    detail: event.detail,
    by: event.by,
  };
  const activityEvents = [nextEvent, ...prev].slice(0, 200);
  const line = `[${new Date(nextEvent.at).toLocaleString('zh-CN')}] ${nextEvent.summary}`;
  const activityLog = client.activityLog?.trim()
    ? `${line}\n${client.activityLog}`
    : line;

  const patch: Client & { activityEvents: CrmActivityEvent[] } = {
    ...client,
    activityLog,
    activityEvents,
  };
  return patch;
};

export const markEmailSentOnClient = (
  client: Client,
  opts: { to: string; subject?: string; by?: string }
): Client => {
  const today = new Date().toISOString().slice(0, 10);
  return appendClientActivity(
    {
      ...client,
      lastContactSent: today,
    },
    {
      kind: 'email_sent',
      summary: `已发送开发信 → ${opts.to}`,
      detail: opts.subject,
      by: opts.by,
    }
  );
};

/** 按公司名/域名匹配 CRM 并回写发信 */
export const applyEmailSentToCrmList = (
  clients: Client[],
  match: { companyName?: string; website?: string },
  opts: { to: string; subject?: string; by?: string }
): { next: Client[]; updatedIds: string[] } => {
  const name = (match.companyName || '').trim().toLowerCase();
  const site = (match.website || '').trim().toLowerCase().replace(/^https?:\/\//, '');
  const updatedIds: string[] = [];
  const next = clients.map((c) => {
    const cName = (c.name || '').trim().toLowerCase();
    const cSite = (c.website || '').trim().toLowerCase().replace(/^https?:\/\//, '');
    const hit =
      (name && cName && (cName === name || cName.includes(name) || name.includes(cName))) ||
      (site && cSite && (cSite === site || cSite.includes(site) || site.includes(cSite)));
    if (!hit) return c;
    updatedIds.push(c.id);
    return markEmailSentOnClient(c, opts);
  });
  return { next, updatedIds };
};

export { EVENTS_KEY };
