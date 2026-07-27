import { User } from '../types';
import { isSupabaseConfigured, fetchAppUsersFromCloud, saveAppUsersToCloud } from './supabase';
import { fetchUsersFromCloud, saveUsersToCloud } from './githubService';

const USERS_KEY = 'trade_scout_users';
const USERS_UPDATED_KEY = 'trade_scout_users_updated_at';

export async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) return false;
  return (await hashPassword(password)) === storedHash;
}

export function loadUsersFromStorage(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getUsersUpdatedAt(): number {
  const n = Number(localStorage.getItem(USERS_UPDATED_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

export function saveUsersToStorage(users: User[], updatedAt: number = Date.now()): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  localStorage.setItem(USERS_UPDATED_KEY, String(updatedAt));
}

/** 本地 + 云端（Supabase / GitHub）一并持久化，保证手机与电脑账号一致 */
export async function persistUsers(users: User[], updatedAt: number = Date.now()): Promise<User[]> {
  saveUsersToStorage(users, updatedAt);
  try {
    if (isSupabaseConfigured()) {
      await saveAppUsersToCloud(users, updatedAt);
    }
  } catch (e) {
    console.warn('Supabase 用户同步失败', e);
  }
  try {
    await saveUsersToCloud(users);
  } catch (e) {
    console.warn('GitHub 用户同步失败', e);
  }
  return users;
}

export function findUserByName(users: User[], username: string): User | undefined {
  const key = username.trim().toLowerCase();
  return users.find(u => u.username.trim().toLowerCase() === key);
}

/** 为旧数据中没有 password 的默认账号补哈希（仅 admin / user） */
export async function ensureUserPasswords(users: User[]): Promise<User[]> {
  const legacy: Record<string, string> = { admin: 'admin123', user: 'user123' };
  return Promise.all(
    users.map(async (u) => {
      if (u.password?.trim()) return u;
      const pwd = legacy[u.username.trim().toLowerCase()];
      if (!pwd) return u;
      return { ...u, password: await hashPassword(pwd), isFirstLogin: true };
    })
  );
}

async function fetchGitHubUsersBundle(): Promise<{ users: User[]; updatedAt: number } | null> {
  try {
    const users = await fetchUsersFromCloud();
    if (!users?.length) return null;
    // GitHub 无独立时间戳时用用户 createdAt 最大值近似
    const updatedAt = Math.max(0, ...users.map((u) => u.createdAt || 0));
    return { users, updatedAt };
  } catch {
    return null;
  }
}

async function isStillDefaultPasswords(users: User[]): Promise<boolean> {
  const admin = findUserByName(users, 'admin');
  if (!admin?.password) return true;
  const defaultAdminHash = await hashPassword('admin123');
  // 只要 admin 仍是默认密码，视为「未定制」；避免用手机端默认账号覆盖电脑端已改密码
  if (admin.password !== defaultAdminHash) return false;
  // 若有额外用户，也算已定制
  if (users.some((u) => u.username.trim().toLowerCase() !== 'admin' && u.username.trim().toLowerCase() !== 'user')) {
    return false;
  }
  const user = findUserByName(users, 'user');
  if (user?.password) {
    const defaultUserHash = await hashPassword('user123');
    if (user.password !== defaultUserHash) return false;
  }
  return true;
}

/**
 * 合并本地与云端用户：以「更新时间更新」的一方为准。
 * 解决手机/电脑各自 localStorage 导致账号密码不一致。
 */
export async function syncUsersAcrossDevices(): Promise<User[]> {
  let local = loadUsersFromStorage();
  let localAt = getUsersUpdatedAt();

  if (local.length === 0) {
    local = await createDefaultUsers();
    localAt = Date.now();
    saveUsersToStorage(local, localAt);
  } else {
    const migrated = await ensureUserPasswords(local);
    if (JSON.stringify(migrated) !== JSON.stringify(local)) {
      local = migrated;
      localAt = Date.now();
      saveUsersToStorage(local, localAt);
    }
  }

  let cloud: { users: User[]; updatedAt: number } | null = null;
  if (isSupabaseConfigured()) {
    cloud = await fetchAppUsersFromCloud();
  }
  if (!cloud?.users?.length) {
    cloud = await fetchGitHubUsersBundle();
  }

  if (cloud?.users?.length) {
    const cloudUsers = await ensureUserPasswords(cloud.users);
    const localDefault = await isStillDefaultPasswords(local);
    const cloudDefault = await isStillDefaultPasswords(cloudUsers);

    // 一端已改密码、另一端仍是默认 → 保留已改的那端
    if (!localDefault && cloudDefault) {
      await persistUsers(local, Date.now());
      return local;
    }
    if (localDefault && !cloudDefault) {
      saveUsersToStorage(cloudUsers, cloud.updatedAt || Date.now());
      return cloudUsers;
    }

    // 都已定制或都是默认：按更新时间
    if (cloud.updatedAt >= localAt) {
      saveUsersToStorage(cloudUsers, cloud.updatedAt || Date.now());
      return cloudUsers;
    }
  }

  // 本地更新（或云端为空）→ 推到云端
  if (local.length) {
    await persistUsers(local, localAt || Date.now());
  }
  return local;
}

export async function loadUsersWithMigration(): Promise<User[]> {
  try {
    return await syncUsersAcrossDevices();
  } catch (e) {
    console.error('用户同步失败，回退本地', e);
    const stored = loadUsersFromStorage();
    if (stored.length === 0) {
      const defaults = await createDefaultUsers();
      saveUsersToStorage(defaults);
      return defaults;
    }
    const migrated = await ensureUserPasswords(stored);
    if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
      saveUsersToStorage(migrated);
    }
    return migrated;
  }
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const trimmedUser = username.trim();
  const trimmedPwd = password.trim();
  if (!trimmedUser || !trimmedPwd) return null;

  // 登录前先拉云端，避免手机/电脑仍用各自旧密码
  let users = loadUsersFromStorage();
  try {
    users = await syncUsersAcrossDevices();
  } catch (e) {
    console.warn('登录前同步用户失败，使用本地账号', e);
    if (!users.length) users = await loadUsersWithMigration();
  }

  const user = findUserByName(users, trimmedUser);
  if (!user?.password?.trim()) return null;
  const ok = await verifyPassword(trimmedPwd, user.password);
  return ok ? user : null;
}

export function updateUserPassword(users: User[], username: string, hashedPassword: string): User[] {
  const key = username.trim().toLowerCase();
  return users.map(u =>
    u.username.trim().toLowerCase() === key ? { ...u, password: hashedPassword } : u
  );
}

export async function createDefaultUsers(): Promise<User[]> {
  const now = Date.now();
  return [
    {
      username: 'admin',
      role: 'admin',
      password: await hashPassword('admin123'),
      isFirstLogin: true,
      createdAt: now,
    },
    {
      username: 'user',
      role: 'user',
      password: await hashPassword('user123'),
      isFirstLogin: true,
      createdAt: now,
    },
  ];
}
