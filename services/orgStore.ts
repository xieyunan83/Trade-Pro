import type { Department } from '../types';

const DEPTS_KEY = 'trade_scout_departments';
const DEPTS_UPDATED_KEY = 'trade_scout_departments_updated_at';

export function loadDepartmentsFromStorage(): Department[] {
  try {
    const raw = localStorage.getItem(DEPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getDepartmentsUpdatedAt(): number {
  const n = Number(localStorage.getItem(DEPTS_UPDATED_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

export function saveDepartmentsToStorage(departments: Department[], updatedAt: number = Date.now()): void {
  localStorage.setItem(DEPTS_KEY, JSON.stringify(departments));
  localStorage.setItem(DEPTS_UPDATED_KEY, String(updatedAt));
}

export function createDepartment(name: string, managerUsername?: string): Department {
  return {
    id: `dept_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    managerUsername: managerUsername?.trim() || undefined,
    createdAt: Date.now(),
  };
}
