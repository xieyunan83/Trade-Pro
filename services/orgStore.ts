import type { Department, Enterprise, UserPlan } from '../types';

const DEPTS_KEY = 'trade_scout_departments';
const DEPTS_UPDATED_KEY = 'trade_scout_departments_updated_at';
const ENTERPRISES_KEY = 'trade_scout_enterprises';
const ENTERPRISES_UPDATED_KEY = 'trade_scout_enterprises_updated_at';
const PLANS_KEY = 'trade_scout_user_plans';
const PLANS_UPDATED_KEY = 'trade_scout_user_plans_updated_at';

export const DEFAULT_ENTERPRISE_ID = 'ent_default';

export function ensureDefaultEnterprise(list: Enterprise[]): Enterprise[] {
  if (list.some((e) => e.id === DEFAULT_ENTERPRISE_ID)) return list;
  return [
    {
      id: DEFAULT_ENTERPRISE_ID,
      name: '默认企业',
      displayName: '默认企业',
      createdAt: Date.now(),
    },
    ...list,
  ];
}

export function loadEnterprisesFromStorage(): Enterprise[] {
  try {
    const raw = localStorage.getItem(ENTERPRISES_KEY);
    if (!raw) return ensureDefaultEnterprise([]);
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? (parsed as Enterprise[]) : [];
    return ensureDefaultEnterprise(list);
  } catch {
    return ensureDefaultEnterprise([]);
  }
}

export function getEnterprisesUpdatedAt(): number {
  const n = Number(localStorage.getItem(ENTERPRISES_UPDATED_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

export function saveEnterprisesToStorage(
  enterprises: Enterprise[],
  updatedAt: number = Date.now()
): void {
  const list = ensureDefaultEnterprise(enterprises);
  localStorage.setItem(ENTERPRISES_KEY, JSON.stringify(list));
  localStorage.setItem(ENTERPRISES_UPDATED_KEY, String(updatedAt));
}

export function createEnterprise(name: string): Enterprise {
  return {
    id: `ent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    displayName: name.trim(),
    createdAt: Date.now(),
  };
}

export function loadDepartmentsFromStorage(): Department[] {
  try {
    const raw = localStorage.getItem(DEPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? (parsed as Department[]) : [];
    // 旧数据无 enterpriseId → 挂到默认企业
    return list.map((d) =>
      d.enterpriseId ? d : { ...d, enterpriseId: DEFAULT_ENTERPRISE_ID }
    );
  } catch {
    return [];
  }
}

export function getDepartmentsUpdatedAt(): number {
  const n = Number(localStorage.getItem(DEPTS_UPDATED_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

export function saveDepartmentsToStorage(
  departments: Department[],
  updatedAt: number = Date.now()
): void {
  const normalized = departments.map((d) =>
    d.enterpriseId ? d : { ...d, enterpriseId: DEFAULT_ENTERPRISE_ID }
  );
  localStorage.setItem(DEPTS_KEY, JSON.stringify(normalized));
  localStorage.setItem(DEPTS_UPDATED_KEY, String(updatedAt));
}

export function createDepartment(
  name: string,
  opts?: { managerUsername?: string; enterpriseId?: string }
): Department {
  return {
    id: `dept_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    enterpriseId: opts?.enterpriseId || DEFAULT_ENTERPRISE_ID,
    managerUsername: opts?.managerUsername?.trim() || undefined,
    createdAt: Date.now(),
  };
}

export function loadPlansFromStorage(): UserPlan[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    if (!raw) return defaultPlans();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as UserPlan[]) : defaultPlans();
  } catch {
    return defaultPlans();
  }
}

export function savePlansToStorage(plans: UserPlan[], updatedAt: number = Date.now()): void {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  localStorage.setItem(PLANS_UPDATED_KEY, String(updatedAt));
}

export function createUserPlan(
  name: string,
  quotas: Partial<Pick<UserPlan, 'searchQuotaMonthly' | 'digQuotaMonthly' | 'unlockQuotaMonthly'>> = {}
): UserPlan {
  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    searchQuotaMonthly: quotas.searchQuotaMonthly ?? 100,
    digQuotaMonthly: quotas.digQuotaMonthly ?? 50,
    unlockQuotaMonthly: quotas.unlockQuotaMonthly ?? 50,
    createdAt: Date.now(),
  };
}

function defaultPlans(): UserPlan[] {
  return [
    {
      id: 'plan_trial',
      name: '试用版',
      searchQuotaMonthly: 30,
      digQuotaMonthly: 10,
      unlockQuotaMonthly: 10,
      createdAt: Date.now(),
    },
    {
      id: 'plan_standard',
      name: '标准版',
      searchQuotaMonthly: 300,
      digQuotaMonthly: 100,
      unlockQuotaMonthly: 100,
      createdAt: Date.now(),
    },
    {
      id: 'plan_pro',
      name: '专业版',
      searchQuotaMonthly: -1,
      digQuotaMonthly: -1,
      unlockQuotaMonthly: -1,
      createdAt: Date.now(),
    },
  ];
}
