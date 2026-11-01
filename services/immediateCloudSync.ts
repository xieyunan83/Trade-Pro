/**
 * 背调/CRM 完成一条即上传云端（await + 有限重试），避免只落本机后死机白做。
 */
import type { Client, HistoryItem, AutomationResult, CustomerProductProfile } from '../types';
import { isSupabaseConfigured, saveInvestigationHistory, saveProductProfileCloud } from './supabase';
import { pushAutomationTaskToCloud } from './automationQueueCloud';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withRetry = async <T,>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T | null> => {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(400 * (i + 1) * (i + 1));
    }
  }
  console.warn(`[immediate-cloud] ${label} failed after ${attempts} attempts`, last);
  return null;
};

/** 单条 CRM upsert（完成一个同步一个） */
export const pushCrmClientToCloudNow = async (client: Client | null | undefined): Promise<boolean> => {
  if (!client?.id || !isSupabaseConfigured()) return false;
  const { saveCrmClientOne } = await import('./supabase');
  const ok = await withRetry(`crm:${client.id}`, () => saveCrmClientOne(client));
  return ok === true;
};

/** 背调历史已由 persistHistoryItem await；此处供显式补推 */
export const pushHistoryToCloudNow = async (item: HistoryItem | null | undefined): Promise<boolean> => {
  if (!item?.id || !isSupabaseConfigured()) return false;
  const ok = await withRetry(`history:${item.id}`, () => saveInvestigationHistory(item));
  return ok === true;
};

export const pushAutomationToCloudNow = async (
  task: AutomationResult | null | undefined
): Promise<boolean> => {
  if (!task?.id || !isSupabaseConfigured()) return false;
  const ok = await withRetry(`automation:${task.id}`, () => pushAutomationTaskToCloud(task));
  return ok === true;
};

export const pushProductProfileToCloudNow = async (
  profile: CustomerProductProfile | null | undefined
): Promise<boolean> => {
  if (!profile?.id || !isSupabaseConfigured()) return false;
  const ok = await withRetry(`profile:${profile.id}`, () => saveProductProfileCloud(profile));
  return ok === true;
};

/** 串行 CRM 推送，避免批量并发打爆 upsert */
let crmPushChain: Promise<unknown> = Promise.resolve();

export const enqueueCrmClientCloudPush = (client: Client): Promise<boolean> => {
  const run = async () => pushCrmClientToCloudNow(client);
  const p = crmPushChain.then(run, run) as Promise<boolean>;
  crmPushChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
};
