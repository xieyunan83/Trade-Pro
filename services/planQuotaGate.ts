/**
 * 套餐额度闸门（骨架）：
 * - 未绑定 planId：不按套餐计量（内部账号）
 * - 绑定后按月扣减 search / dig / unlock
 * - 额度 -1：不限
 * 背调成功后喂主库；「解锁」用于从主库取完整资料（后续产品化）。
 */
import type { User, UserPlan } from '../types';
import { loadPlansFromStorage } from './orgStore';

export type PlanQuotaKind = 'search' | 'dig' | 'unlock';

export type PlanQuotaCheck = {
  allowed: boolean;
  unlimited: boolean;
  /** 无套餐时为 true：不拦截 */
  skipped: boolean;
  current: number;
  max: number;
  plan: UserPlan | null;
  message?: string;
};

const kindLabel = (k: PlanQuotaKind) =>
  k === 'search' ? '搜索' : k === 'dig' ? '背调' : '主库解锁';

const monthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const usageStorageKey = (username: string) =>
  `trade_scout_plan_usage:${username.trim().toLowerCase()}:${monthKey()}`;

type MonthUsage = { search: number; dig: number; unlock: number };

const emptyUsage = (): MonthUsage => ({ search: 0, dig: 0, unlock: 0 });

const readUsage = (username: string): MonthUsage => {
  try {
    const raw = localStorage.getItem(usageStorageKey(username));
    if (!raw) return emptyUsage();
    const parsed = JSON.parse(raw) as Partial<MonthUsage>;
    return {
      search: Math.max(0, Number(parsed.search) || 0),
      dig: Math.max(0, Number(parsed.dig) || 0),
      unlock: Math.max(0, Number(parsed.unlock) || 0),
    };
  } catch {
    return emptyUsage();
  }
};

const writeUsage = (username: string, usage: MonthUsage) => {
  localStorage.setItem(usageStorageKey(username), JSON.stringify(usage));
};

export const getPlanForUser = (
  user: User | null | undefined,
  plans?: UserPlan[]
): UserPlan | null => {
  if (!user?.planId) return null;
  const list = plans?.length ? plans : loadPlansFromStorage();
  return list.find((p) => p.id === user.planId) || null;
};

const quotaOf = (plan: UserPlan, kind: PlanQuotaKind): number => {
  if (kind === 'search') return plan.searchQuotaMonthly;
  if (kind === 'dig') return plan.digQuotaMonthly;
  return plan.unlockQuotaMonthly;
};

export const checkPlanQuota = (
  user: User | null | undefined,
  kind: PlanQuotaKind,
  plans?: UserPlan[]
): PlanQuotaCheck => {
  if (!user || user.disabled) {
    return {
      allowed: false,
      unlimited: false,
      skipped: false,
      current: 0,
      max: 0,
      plan: null,
      message: '账号不可用',
    };
  }
  // 超管 / 总监：业务全量，不按套餐卡
  if (user.role === 'admin' || user.role === 'director') {
    return {
      allowed: true,
      unlimited: true,
      skipped: true,
      current: 0,
      max: -1,
      plan: getPlanForUser(user, plans),
    };
  }
  const plan = getPlanForUser(user, plans);
  if (!plan) {
    return {
      allowed: true,
      unlimited: true,
      skipped: true,
      current: 0,
      max: -1,
      plan: null,
    };
  }
  const max = quotaOf(plan, kind);
  if (max < 0) {
    return {
      allowed: true,
      unlimited: true,
      skipped: false,
      current: 0,
      max: -1,
      plan,
    };
  }
  const usage = readUsage(user.username);
  const current = usage[kind];
  const allowed = current < max;
  return {
    allowed,
    unlimited: false,
    skipped: false,
    current,
    max,
    plan,
    message: allowed
      ? undefined
      : `${plan.name}本月${kindLabel(kind)}额度已用尽（${current}/${max}）。升级套餐或下月再试。`,
  };
};

export const incrementPlanUsage = (
  user: User | null | undefined,
  kind: PlanQuotaKind
): void => {
  if (!user?.planId) return;
  if (user.role === 'admin' || user.role === 'director') return;
  const plan = getPlanForUser(user);
  if (!plan) return;
  if (quotaOf(plan, kind) < 0) return;
  const usage = readUsage(user.username);
  usage[kind] = (usage[kind] || 0) + 1;
  writeUsage(user.username, usage);
};

/** 背调入口：套餐 dig 额度 */
export const assertCanDig = (user: User | null | undefined): PlanQuotaCheck =>
  checkPlanQuota(user, 'dig');

/** 搜索入口：套餐 search 额度 */
export const assertCanSearch = (user: User | null | undefined): PlanQuotaCheck =>
  checkPlanQuota(user, 'search');

/** 从主库解锁完整资料 */
export const assertCanUnlock = (user: User | null | undefined): PlanQuotaCheck =>
  checkPlanQuota(user, 'unlock');

export const describePlanUsage = (
  user: User | null | undefined,
  plans?: UserPlan[]
): string => {
  const plan = getPlanForUser(user, plans);
  if (!user) return '未登录';
  if (!plan) return '未绑定套餐（不限）';
  const usage = readUsage(user.username);
  const fmt = (n: number) => (n < 0 ? '不限' : String(n));
  return `${plan.name} · 搜索 ${usage.search}/${fmt(plan.searchQuotaMonthly)} · 背调 ${usage.dig}/${fmt(plan.digQuotaMonthly)} · 解锁 ${usage.unlock}/${fmt(plan.unlockQuotaMonthly)}`;
};
